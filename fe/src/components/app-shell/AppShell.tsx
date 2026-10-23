"use client";

import Link from "next/link";
import { OthelioLogo } from "@/components/brand/OthelioLogo";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { AppIcon, type AppNavId } from "./AppIcon";
import { useBasketsList, useWalletUsdcBalance } from "@/hooks/useBaskets";
import { useQueryClient } from "@tanstack/react-query";
import { formatAddress, formatCompactNumber } from "@/lib/baskets";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";

const navigation: { id: AppNavId; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/app/overview" },
  { id: "baskets", label: "Baskets", href: "/app/baskets" },
  { id: "activity", label: "Activity", href: "/app/activity" },
  { id: "agents", label: "Agents", href: "/app/agents" },
  { id: "settings", label: "Settings", href: "/app/settings" },
];

import { WalletConnectModal } from "@/components/WalletConnectModal";
import { useAuth } from "@/context/AuthContext";
import { Dialog } from "@/components/ui/Dialog";
import { networkLabelForChainId } from "@/lib/network";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const [mounted, setMounted] = useState<boolean>(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Web3 Wallet & Network Hooks
  const { address, isConnected, isConnecting, chain, chainId: activeChainId } = useAccount();
  const isWalletRestoring = useWalletRestoring();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { isAuthenticated, isAuthenticating, authError, login, logout } = useAuth();
  const queryClient = useQueryClient();
  const { switchChain } = useSwitchChain();
  const targetChainId = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : 31337;
  const isWrongNetwork = mounted && isConnected && activeChainId !== undefined && activeChainId !== targetChainId;
  const isWalletConnecting = mounted && (isConnecting || isConnectPending || isAuthenticating);

  const handleSwitchNetwork = async () => {
    const hexChainId = `0x${targetChainId.toString(16)}`;
    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChainId }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902 || switchError.code === -32603 || switchError.message?.toLowerCase().includes("unrecognized") || switchError.message?.toLowerCase().includes("unknown")) {
          try {
            await (window as any).ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: hexChainId,
                  chainName: targetChainId === 31337 ? "Anvil Local" : "Base Mainnet",
                  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
                  rpcUrls: [targetChainId === 31337 ? "http://127.0.0.1:8545" : "https://mainnet.base.org"],
                },
              ],
            });
          } catch (addError) {
            console.error("Failed to add network to wallet:", addError);
          }
        } else if (switchChain) {
          switchChain({ chainId: targetChainId });
        }
      }
    } else if (switchChain) {
      switchChain({ chainId: targetChainId });
    }
  };

  // Wallet Connect modal state
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  // Dynamic chain ID & USDC Contract address
  const currentChainId = activeChainId || targetChainId;
  const usdcAddr = (CONTRACT_ADDRESSES[currentChainId as keyof typeof CONTRACT_ADDRESSES]?.usdc || CONTRACT_ADDRESSES[8453].usdc) as `0x${string}`;

  // On-chain USDC balance query for connected wallet
  const { data: usdcBalanceRaw, refetch: refetchUsdc } = useWalletUsdcBalance();

  const formattedUsdcBalance = useMemo(() => {
    if (usdcBalanceRaw !== undefined && usdcBalanceRaw !== null) {
      return Number(formatUnits(usdcBalanceRaw as bigint, 6));
    }
    return 0;
  }, [usdcBalanceRaw]);

  const handleFaucet = async () => {
    if (!address) return;
    try {
      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_setBalance",
          params: [address, "0x56BC75E2D63100000"], // 100 ETH
          id: 1,
        }),
      });

      const vault = "0xf977814e90da44bfa03b6295a0616a897441acec";
      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_impersonateAccount",
          params: [vault],
          id: 2,
        }),
      });
      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_setBalance",
          params: [vault, "0xDE0B6B3A7640000"], // 1 ETH for gas
          id: 3,
        }),
      });

      const cleanAddr = address.substring(2).toLowerCase().padStart(64, '0');
      const transferCalldata = `0xa9059cbb${cleanAddr}00000000000000000000000000000000000000000000000000000002540be400`;

      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_sendTransaction",
          params: [{
            from: vault,
            to: usdcAddr,
            data: transferCalldata,
          }],
          id: 4,
        }),
      });

      await refetchUsdc();
      alert("Funded wallet with 10,000 USDC + 100 ETH on Anvil!");
    } catch (err) {
      console.error("Faucet error:", err);
    }
  };

  // Baskets query to calculate live sum NAV for connected user
  const { data: basketsResponse, isLoading: isBasketsLoading } = useBasketsList(targetChainId, isConnected ? address : undefined);

  const handleDisconnect = () => {
    // Detail/activity responses are wallet-specific in the app. Remove them
    // immediately instead of leaving a previous wallet's cache on screen.
    queryClient.clear();
    logout();
  };

  // User Profile & Onboarding state
  const [userName, setUserName] = useState<string>("");
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [nameInput, setNameInput] = useState<string>("");

  const handleConnectWallet = () => {
    setShowConnectModal(true);
  };

  useEffect(() => {
    if (isConnected && address) {
      const storedName = localStorage.getItem(`othelio_user_${address.toLowerCase()}`);
      if (storedName) {
        setUserName(storedName);
        setShowOnboarding(false);
      } else {
        setUserName("");
        setShowOnboarding(true);
      }
    } else {
      setShowOnboarding(false);
    }
  }, [isConnected, address]);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || !address) return;
    const cleanName = nameInput.trim();
    localStorage.setItem(`othelio_user_${address.toLowerCase()}`, cleanName);
    setUserName(cleanName);
    setShowOnboarding(false);
  };

  // Calculate total Sum NAV across all indexed baskets for connected wallet
  const totalSumNAV = useMemo(() => {
    if (!mounted || !isConnected || !address) return 0;

    let total = 0;

    if (basketsResponse?.data && Array.isArray(basketsResponse.data)) {
      basketsResponse.data.forEach((ib: any) => {
        if (ib.controller && ib.controller.toLowerCase() !== address.toLowerCase()) {
          return;
        }
        total += ib.totalNavUsdcMicro === null ? 0 : Number(ib.totalNavUsdcMicro) / 1e6;
      });
    }

    return total;
  }, [mounted, isConnected, address, basketsResponse]);

  // Derive monthly gain dynamically based on basket holdings/activity
  const monthlyGainText = useMemo(() => {
    if (!basketsResponse?.data || basketsResponse.data.length === 0) return "+$0.00";
    // For newly deployed on-chain baskets without historical pricing drift
    return "+$0.00";
  }, [basketsResponse]);

  const userInitials = useMemo(() => {
    if (!userName) return address ? address.slice(2, 4).toUpperCase() : "??";
    return userName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [userName, address]);



  return (
    <main className="bank-app" data-theme="dark">
      <a href="#workspace-content" className="ui-skip-link">Skip to content</a>
      <Dialog open={showOnboarding} onClose={() => setShowOnboarding(false)} title="Make yourself at home" description="Add an optional display name. It stays on this device.">
        <form onSubmit={handleSaveName}>
          <label className="ui-field"><span>Display name</span><input value={nameInput} onChange={(event) => setNameInput(event.target.value)} placeholder="Your name" maxLength={48} required /></label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="ui-button" data-variant="ghost" onClick={() => {
              if (address) localStorage.setItem(`othelio_user_${address.toLowerCase()}`, `Wallet ${address.slice(0, 6)}`);
              setShowOnboarding(false);
            }}>Skip for now</button>
            <button type="submit" className="ui-button">Save name</button>
          </div>
        </form>
      </Dialog>

      {/* Left Sidebar */}
      <aside className="bank-sidebar">
        <div>
          <Link href="/" className="bank-wordmark">
            <OthelioLogo size={28} />
            <span>Othelio</span>
          </Link>
          <nav className="bank-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <Link key={item.id} href={item.href} className={isActive(item.href) ? "active" : ""} aria-current={isActive(item.href) ? "page" : undefined}>
                <AppIcon type={item.id} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-lower">
          <section className="account-module">
            {isWalletRestoring ? (
              <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px" }}>
                <div style={{ height: "14px", width: "58%", borderRadius: "4px", background: "var(--panel-2)" }} />
                <div style={{ height: "11px", width: "78%", borderRadius: "4px", background: "var(--panel-2)" }} />
                <span style={{ color: "var(--muted-ink)", fontSize: "12px" }}>Restoring wallet…</span>
              </div>
            ) : mounted && isConnected && address ? (
              <>
                <header>
                  <span className="avatar">{userInitials}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {userName || "Alex Carter"}
                    </strong>
                    <small>{formatAddress(address)}</small>
                  </span>
                  <button onClick={handleDisconnect} aria-label="Sign out" title="Sign out" style={{ border: 0, color: 'var(--muted-ink)', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: '4px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </button>
                </header>

                {!isAuthenticated && (
                  <div className="account-available" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px', marginTop: '12px' }}>
                    <span style={{ color: 'var(--muted-ink)', fontSize: '12px' }}>Wallet connected. Sign in to use Othelio.</span>
                    {authError && (
                      <span role="status" style={{ color: '#ef4444', fontSize: '11px', lineHeight: 1.4 }}>{authError}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void login()}
                      disabled={isAuthenticating}
                      className="primary"
                      style={{ width: '100%', padding: '8px 10px', fontSize: '12px', justifyContent: 'center' }}
                    >
                      {isAuthenticating ? 'Waiting for signature...' : 'Sign in'}
                    </button>
                  </div>
                )}

                <div className="account-balance">
                  <span>Total portfolio</span>
                  <strong>
                    {isBasketsLoading ? (
                      <span className="animate-pulse" style={{ opacity: 0.5 }}>Calculated...</span>
                    ) : (
                      `$${formatCompactNumber(totalSumNAV)}`
                    )}
                  </strong>
                  <small>
                    <b>{monthlyGainText}</b> this month
                  </small>
                </div>

                {isWrongNetwork ? (
                  <div className="account-available">
                    <span style={{ color: '#ef4444' }}>Wrong Network</span>
                    <button
                      onClick={handleSwitchNetwork}
                      title="Click to switch network"
                      aria-label="Switch Network"
                      style={{
                        background: 'transparent',
                        border: 0,
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: 0,
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="account-available" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <span>Available USDC</span>
                      <strong>${formattedUsdcBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                    {targetChainId === 31337 && (
                      <button
                        onClick={handleFaucet}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '8px',
                          border: '1px solid var(--accent)',
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      >
                        Faucet (+100 ETH)
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <header>
                  <span className="avatar" style={{ background: 'rgba(219, 255, 117, 0.15)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                    <span style={{ width: '16px', height: '16px', display: 'block' }}>
                      <AppIcon type="lock" />
                    </span>
                  </span>
                  <span>
                    <strong style={{ color: 'var(--ink)' }}>Not Connected</strong>
                  </span>
                </header>

                <div className="account-balance" style={{ textAlign: 'center', padding: '16px 14px 14px' }}>
                  {authError && (
                    <div style={{ color: "#ef4444", fontSize: "11px", marginBottom: "12px", lineHeight: 1.4, padding: "8px 10px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.25)", textAlign: "left" }}>
                      {authError}
                    </div>
                  )}
                  <button
                    onClick={handleConnectWallet}
                    disabled={isWalletConnecting}
                    className="secondary connect-wallet-button"
                    style={{
                      width: '100%',
                      minHeight: '38px',
                      fontSize: '13px',
                      fontWeight: 600,
                      justifyContent: 'center',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'var(--panel-2)',
                      border: '1px solid var(--line)',
                      color: 'var(--ink)',
                      cursor: isWalletConnecting ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {isWalletConnecting ? "Authenticating..." : "Connect Wallet"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="bank-content" id="workspace-content" tabIndex={-1}>
        <header className="mobile-header">
          <Link href="/" className="bank-wordmark">
            <OthelioLogo size={26} />
            <span>Othelio</span>
          </Link>
          {isWalletRestoring ? (
            <span style={{ color: "var(--muted-ink)", fontSize: "12px" }}>Restoring…</span>
          ) : mounted && isConnected && address ? (
            <button onClick={handleDisconnect} className="theme-toggle" style={{ fontSize: '11px' }}>
              {formatAddress(address)} (Disconnect)
            </button>
          ) : (
            <button onClick={handleConnectWallet} className="primary" style={{ minHeight: '32px', fontSize: '12px' }}>
              Connect
            </button>
          )}
        </header>

        {children}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => (
          <Link key={item.id} href={item.href} className={isActive(item.href) ? "active" : ""} aria-current={isActive(item.href) ? "page" : undefined}>
            <AppIcon type={item.id} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <WalletConnectModal isOpen={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </main>
  );
}
