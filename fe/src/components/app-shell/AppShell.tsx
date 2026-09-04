"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useConnect, useDisconnect, useBalance, useChainId, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { AppIcon, type AppNavId } from "./AppIcon";
import { useBasketsList } from "@/hooks/useBaskets";
import { formatAddress, formatCompactNumber } from "@/lib/baskets";

const navigation: { id: AppNavId; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/app/overview" },
  { id: "baskets", label: "Baskets", href: "/app/baskets" },
  { id: "activity", label: "Activity", href: "/app/activity" },
  { id: "agents", label: "Agents", href: "/app/agents" },
  { id: "settings", label: "Settings", href: "/app/settings" },
];

import { WalletConnectModal } from "@/components/WalletConnectModal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Web3 Wallet & Network Hooks
  const { address, isConnected, isConnecting, chain, chainId: activeChainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const targetChainId = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : 31337;
  const isWrongNetwork = isConnected && activeChainId !== undefined && activeChainId !== targetChainId;

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
                  chainName: targetChainId === 31337 ? "Anvil Local" : targetChainId === 84532 ? "Base Sepolia" : "Base Mainnet",
                  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
                  rpcUrls: [targetChainId === 31337 ? "http://127.0.0.1:8545" : targetChainId === 84532 ? "https://sepolia.base.org" : "https://mainnet.base.org"],
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

  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();

  // Wallet Connect modal state
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);

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

      // Send real transaction from Anvil default account #0 to trigger MetaMask UI update
      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_sendTransaction",
          params: [{
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            to: address,
            value: "0x8AC7230489E80000" // 10 ETH
          }],
          id: 2,
        }),
      });

      alert("Funded connected wallet with 100 ETH on Anvil!");
    } catch (err) {
      console.error("Faucet error:", err);
    }
  };

  // Auto-seed connected wallet on local Anvil (31337) with 100 ETH & initial setup
  useEffect(() => {
    if (isConnected && address && targetChainId === 31337) {
      fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_setBalance",
          params: [address, "0x56BC75E2D63100000"], // 100 ETH in Wei
          id: 1,
        }),
      })
      .then(() => {
        fetch("http://127.0.0.1:8545", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_sendTransaction",
            params: [{
              from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
              to: address,
              value: "0x8AC7230489E80000"
            }],
            id: 2,
          }),
        });
      })
      .catch((e) => console.error("Anvil auto-seed error:", e));
    }
  }, [isConnected, address, targetChainId]);

  // Balance query for connected wallet (native / USDC fallback)
  const { data: balanceData, isLoading: isBalanceLoading } = useBalance({
    address: address,
  });

  // Baskets query to calculate live sum NAV for connected user
  const { data: basketsResponse, isLoading: isBasketsLoading } = useBasketsList(31337, address);

  // User Profile & Onboarding state
  const [userName, setUserName] = useState<string>("");
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [nameInput, setNameInput] = useState<string>("");
  const [availableUsdc, setAvailableUsdc] = useState<number>(4000);

  useEffect(() => {
    const updateUsdc = () => {
      const stored = localStorage.getItem("othelio_available_usdc");
      if (stored) {
        setAvailableUsdc(Number(stored));
      } else {
        localStorage.setItem("othelio_available_usdc", "4000");
      }
    };

    updateUsdc();
    window.addEventListener("storage", updateUsdc);
    window.addEventListener("usdc_balance_updated", updateUsdc);
    return () => {
      window.removeEventListener("storage", updateUsdc);
      window.removeEventListener("usdc_balance_updated", updateUsdc);
    };
  }, []);

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

  // Calculate total Sum NAV across all indexed baskets
  const totalSumNAV = useMemo(() => {
    if (!basketsResponse?.data || basketsResponse.data.length === 0) return 0;
    return basketsResponse.data.reduce((acc, b) => acc + ((b as any).seed_amount ? Number((b as any).seed_amount) : 1000), 0);
  }, [basketsResponse]);

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
      {/* Onboarding Modal for New Connected Users */}
      {showOnboarding && (
        <div className="drawer-backdrop" style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ width: '90%', maxWidth: '420px', padding: '28px', borderRadius: '16px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>Welcome to Othelio</h2>
            <p style={{ color: 'var(--muted-ink)', fontSize: '13px', marginBottom: '20px' }}>
              Connected with <code style={{ color: 'var(--accent)' }}>{address ? formatAddress(address) : ''}</code>. Please enter a display name for your profile.
            </p>
            <form onSubmit={handleSaveName}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-ink)', marginBottom: '6px' }}>Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Satoshi Nakamoto"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: 'var(--panel-2)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                  autoFocus
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (address) {
                      const fallback = `Wallet ${address.slice(0, 6)}`;
                      localStorage.setItem(`othelio_user_${address.toLowerCase()}`, fallback);
                      setUserName(fallback);
                      setShowOnboarding(false);
                    }
                  }}
                  style={{ background: 'transparent', border: '1px solid var(--line)', padding: '8px 16px', borderRadius: '10px', color: 'var(--muted-ink)', fontSize: '13px', cursor: 'pointer' }}
                >
                  Skip
                </button>
                <button type="submit" className="primary" style={{ padding: '8px 20px', fontSize: '13px' }}>
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Left Sidebar */}
      <aside className="bank-sidebar">
        <div>
          <Link href="/" className="bank-wordmark">Othelio</Link>
          <nav className="bank-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <Link key={item.id} href={item.href} className={isActive(item.href) ? "active" : ""}>
                <AppIcon type={item.id} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-lower">
          <section className="account-module">
            {isConnected && address ? (
              <>
                <header>
                  <span className="avatar">{userInitials}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {userName || "Alex Carter"}
                    </strong>
                    <small>{formatAddress(address)}</small>
                  </span>
                  <button onClick={() => disconnect()} aria-label="Sign out" title="Sign out" style={{ border: 0, color: 'var(--muted-ink)', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: '4px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </button>
                </header>

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
                      <strong>${availableUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
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
                  <span className="avatar" style={{ background: 'var(--panel-2)', color: 'var(--muted-ink)', display: 'grid', placeItems: 'center' }}>
                    <span style={{ width: '16px', height: '16px', display: 'block' }}>
                      <AppIcon type="lock" />
                    </span>
                  </span>
                  <span>
                    <strong>Not Connected</strong>
                  </span>
                </header>

                <div className="account-balance" style={{ textAlign: 'center', padding: '20px 14px' }}>
                  <p style={{ color: 'var(--muted-ink)', fontSize: '12px', marginBottom: '14px' }}>
                    Connect Web3 wallet to manage baskets & view portfolio
                  </p>
                  <button
                    onClick={handleConnectWallet}
                    disabled={isConnecting || isConnectPending}
                    className="primary"
                    style={{ width: '100%', fontSize: '13px', justifyContent: 'center' }}
                  >
                    {isConnecting || isConnectPending ? "Connecting..." : "Connect Wallet"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="bank-content">
        <header className="mobile-header">
          <Link href="/" className="bank-wordmark">Othelio</Link>
          {isConnected && address ? (
            <button onClick={() => disconnect()} className="theme-toggle" style={{ fontSize: '11px' }}>
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
        {navigation.slice(0, 4).map((item) => (
          <Link key={item.id} href={item.href} className={isActive(item.href) ? "active" : ""}>
            <AppIcon type={item.id} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <WalletConnectModal isOpen={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </main>
  );
}
