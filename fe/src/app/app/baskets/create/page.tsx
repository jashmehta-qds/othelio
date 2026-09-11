"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets } from "@/lib/baskets";
import { fetchCreateSeedQuote, receiptCreatesAndFunds, registerConfirmedBasket } from "@/lib/createSeed";
import { useSupportedAssets } from "@/hooks/useBaskets";
import { useHydrated } from "@/hooks/useHydrated";

export default function CreateBasketPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const isHydrated = useHydrated();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [depositAmount, setDepositAmount] = useState("");

  // Search & add tokens
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Default start with 0 stocks or initial preset
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const { data: remoteAssets } = useSupportedAssets();

  const allSupportedAssets = useMemo(() => {
    if (remoteAssets?.data && remoteAssets.data.length > 0) {
      return remoteAssets.data.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        target: 0,
        current: 0,
        quantity: 0,
        value: 0,
        color: item.color,
        address: item.address,
      }));
    }
    return supportedAssets;
  }, [remoteAssets]);

  const selectedSymbols = Object.keys(targets);
  const total = useMemo(() => Object.values(targets).reduce((sum, value) => sum + value, 0), [targets]);

  const selectedAssets = selectedSymbols
    .map((s) => allSupportedAssets.find((asset) => asset.symbol === s))
    .filter((asset): asset is (typeof allSupportedAssets)[number] => Boolean(asset));

  const availableAssets = useMemo(() => {
    return allSupportedAssets.filter((asset) => {
      const isNotSelected = !(asset.symbol in targets);
      const matchesSearch =
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase());
      return isNotSelected && matchesSearch;
    });
  }, [searchQuery, targets, allSupportedAssets]);

  const publicClient = usePublicClient();
  const { isPending: isApproving, writeContractAsync } = useWriteContract();
  const { isPending: isSending, sendTransactionAsync } = useSendTransaction();
  const isPending = isApproving || isSending;
  const hasValidDeposit = Number.isFinite(Number(depositAmount)) && Number(depositAmount) > 0;
  const hasConnectedWallet = isHydrated && isConnected && Boolean(address);

  const addToken = (tokenSymbol: string) => {
    setTargets((current) => {
      const next = { ...current, [tokenSymbol]: 0 };
      const keys = Object.keys(next);
      const equalShare = Math.floor(100 / keys.length);
      const remainder = 100 - equalShare * keys.length;
      keys.forEach((k, idx) => {
        next[k] = equalShare + (idx === 0 ? remainder : 0);
      });
      return next;
    });
    setSearchQuery("");
    setIsDropdownOpen(false);
  };

  const removeToken = (tokenSymbol: string) => {
    setTargets((current) => {
      const next = { ...current };
      delete next[tokenSymbol];
      const keys = Object.keys(next);
      if (keys.length === 0) return {};
      const equalShare = Math.floor(100 / keys.length);
      const remainder = 100 - equalShare * keys.length;
      keys.forEach((k, idx) => {
        next[k] = equalShare + (idx === 0 ? remainder : 0);
      });
      return next;
    });
  };

  const equalizeWeights = () => {
    const keys = Object.keys(targets);
    if (keys.length === 0) return;
    const equalShare = Math.floor(100 / keys.length);
    const remainder = 100 - equalShare * keys.length;
    const next: Record<string, number> = {};
    keys.forEach((k, idx) => {
      next[k] = equalShare + (idx === 0 ? remainder : 0);
    });
    setTargets(next);
  };

  const handleExecute = async () => {
    if (!hasConnectedWallet || !address) {
      setTransactionError("Connect your wallet before creating and funding a basket.");
      return;
    }

    setTransactionError(null);
    try {
      const cleanName = name.trim() || "Custom Basket";
      const chainId = 31337;
      const config = CONTRACT_ADDRESSES[chainId];
      const inputAmount = parseUnits(depositAmount, 6);
      if (!publicClient) throw new Error("Wallet client is unavailable on this network.");
      const approval = await writeContractAsync({
        address: config.usdc,
        abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "approve",
        args: [config.module, inputAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approval });
      const clientSalt = `0x${crypto.getRandomValues(new Uint8Array(32)).reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), "")}`;
      const quote = await fetchCreateSeedQuote({
        chainId,
        factoryAddress: config.factory,
        moduleAddress: config.module,
        ownerAddress: address,
        name: cleanName,
        clientSalt,
        inputAsset: config.usdc,
        inputAmount: inputAmount.toString(),
        targetWeights: selectedAssets.map((asset) => ({
          assetAddress: asset.address,
          targetWeightBps: (targets[asset.symbol] ?? 0) * 100,
        })),
      });
      const { data } = quote;
      const call = data.plan.calls[0];
      if (!quote.executionAllowed || data.plan.action !== "FUND" || data.plan.chainId !== chainId || data.plan.accountAddress.toLowerCase() !== data.predictedBasketAddress.toLowerCase() || data.factory.address.toLowerCase() !== config.factory.toLowerCase() || call?.to.toLowerCase() !== config.factory.toLowerCase() || data.module.moduleVersion !== 3 || !data.module.supportsBoundedExecution || new Date(data.plan.expiresAt).getTime() <= Date.now()) {
        throw new Error("The create-and-seed plan is no longer executable.");
      }
      if (data.plan.approvals.length !== 1 || data.plan.approvals[0].spenderAddress.toLowerCase() !== config.module.toLowerCase() || data.plan.approvals[0].maxAmountBaseUnits !== inputAmount.toString()) {
        throw new Error("The planned approval does not match the exact seed input.");
      }
      const tx = await sendTransactionAsync({ to: call.to as `0x${string}`, data: call.calldata as `0x${string}`, value: BigInt(call.valueBaseUnits) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success" || !receiptCreatesAndFunds(receipt, config.factory, config.module, data.predictedBasketAddress)) {
        throw new Error("The receipt did not contain the expected BasketCreated and BasketFunded events.");
      }
      await registerConfirmedBasket({
        chainId,
        address: data.predictedBasketAddress,
        controller: address,
        name: cleanName,
        symbol: symbol.trim() ? `OTH-${symbol.trim()}` : "OTH",
        createdBlock: Number(receipt.blockNumber),
        createdBlockHash: receipt.blockHash,
        createdTx: receipt.transactionHash,
        assets: selectedAssets.map((asset) => ({ address: asset.address as string, targetWeightBps: (targets[asset.symbol] ?? 0) * 100 })),
      });
      router.push(`/app/baskets/${data.predictedBasketAddress}`);
    } catch (error) {
      setTransactionError(error instanceof Error ? error.message : "Unable to create and fund the basket.");
    }
  };

  return (
    <div className="app-page-frame">
      {/* Top Navigation Breadcrumbs */}
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/app/baskets"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            color: "var(--muted-ink)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          ← Back to Baskets
        </Link>
      </div>

      <header style={{ marginBottom: "32px" }}>
        <h1 className="page-title">
          Create New Basket
        </h1>
        <p className="page-description">
          Define basket identity, ENS subdomain, seed capital, and target asset weights on-chain.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "32px", alignItems: "start" }}>
        {/* Main Creation Form Area */}
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          {/* Section 1: Basket Identity & ENS */}
          <div
            style={{
              padding: "24px",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "16px" }}>1. Identity & ENS Subdomain</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "14px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Basket Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Momentum Tech Core"
                    style={{
                      padding: "11px 14px",
                      background: "var(--panel-2)",
                      border: "1px solid var(--panel-border)",
                      borderRadius: "10px",
                      color: "var(--ink)",
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Symbol</span>
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    placeholder="MCORE"
                    style={{
                      padding: "11px 14px",
                      background: "var(--panel-2)",
                      border: "1px solid var(--panel-border)",
                      borderRadius: "10px",
                      color: "var(--ink)",
                      fontSize: "14px",
                      outline: "none",
                      fontWeight: 700,
                    }}
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>ENS Subdomain</span>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type="text"
                      value={subdomain}
                      onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      placeholder="mcore"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        paddingRight: "105px",
                        background: "var(--panel-2)",
                        border: "1px solid var(--panel-border)",
                        borderRadius: "10px",
                        color: "var(--ink)",
                        fontSize: "14px",
                        outline: "none",
                        fontWeight: 600,
                      }}
                    />
                    <span style={{ position: "absolute", right: "14px", fontSize: "12px", fontWeight: 700, color: "var(--muted-ink)", pointerEvents: "none" }}>.othelio.eth</span>
                  </div>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Initial Seed Capital</span>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="1000"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        paddingRight: "65px",
                        background: "var(--panel-2)",
                        border: "1px solid var(--panel-border)",
                        borderRadius: "10px",
                        color: "var(--ink)",
                        fontSize: "14px",
                        outline: "none",
                        fontWeight: 700,
                      }}
                    />
                    <span style={{ position: "absolute", right: "14px", fontSize: "12px", fontWeight: 700, color: "var(--accent)", pointerEvents: "none" }}>USDC</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Section 2: Basket Composition */}
          <div
            style={{
              padding: "24px",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 700 }}>2. Basket Composition</h3>
                <span style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Select tokenized stocks to include in index</span>
              </div>
              {selectedSymbols.length > 1 && (
                <button
                  type="button"
                  onClick={equalizeWeights}
                  style={{
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent)",
                    color: "var(--accent)",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: "6px 12px",
                    borderRadius: "8px",
                  }}
                >
                  Auto-balance
                </button>
              )}
            </div>

            {/* Combobox Search */}
            <div style={{ position: "relative", marginBottom: "20px" }}>
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setIsDropdownOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                }}
                placeholder="+ Search & add stock token (e.g. NVDA, AAPL, MSFT, TSLA)..."
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--panel-border)",
                  borderRadius: "10px",
                  color: "var(--ink)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />

              {isDropdownOpen && availableAssets.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: "6px",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                    zIndex: 30,
                    maxHeight: "220px",
                    overflowY: "auto",
                  }}
                >
                  {availableAssets.map((asset) => (
                    <div
                      key={asset.symbol}
                      onClick={() => addToken(asset.symbol)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--line)",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <StockLogo symbol={asset.symbol} size={24} roundedFull />
                        <strong style={{ fontSize: "13px" }}>{asset.symbol}</strong>
                        <small style={{ color: "var(--muted-ink)", fontSize: "12px" }}>{asset.name}</small>
                      </div>
                      <span style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live Progress Bar */}
            {selectedAssets.length > 0 && (
              <div style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px", color: "var(--muted-ink)" }}>
                  <span>Weight Allocation Breakdown</span>
                  <strong style={{ color: total === 100 ? "var(--positive)" : "var(--danger)" }}>{total}% Total</strong>
                </div>
                <div style={{ height: "10px", width: "100%", borderRadius: "99px", background: "var(--panel-2)", display: "flex", overflow: "hidden", gap: "2px" }}>
                  {selectedAssets.map((asset) => (
                    <div
                      key={asset.symbol}
                      style={{
                        width: `${targets[asset.symbol] ?? 0}%`,
                        height: "100%",
                        background: asset.color || "var(--accent)",
                      }}
                      title={`${asset.symbol}: ${targets[asset.symbol] ?? 0}%`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sliders list */}
            {selectedAssets.length === 0 ? (
              <div
                style={{
                  padding: "36px 20px",
                  textAlign: "center",
                  background: "var(--panel-2)",
                  borderRadius: "12px",
                  border: "1px dashed var(--line)",
                }}
              >
                <p style={{ margin: 0, fontSize: "13px", color: "var(--muted-ink)" }}>
                  No stock tokens added yet. Use the search field above to pick your basket assets.
                </p>
              </div>
            ) : (
              <div className="drawer-weight-editor">
                {selectedAssets.map((asset) => (
                  <label key={asset.symbol} style={{ padding: "16px 0" }}>
                    <span>
                      <StockLogo symbol={asset.symbol} size={32} roundedFull />
                      <span>
                        <strong style={{ fontSize: "14px" }}>{asset.symbol}</strong>
                        <small>{asset.name}</small>
                      </span>
                    </span>
                    <span className="weight-actions">
                      <output style={{ fontSize: "22px" }}>{targets[asset.symbol] ?? 0}%</output>
                      <button
                        type="button"
                        onClick={() => removeToken(asset.symbol)}
                      >
                        Remove
                      </button>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={targets[asset.symbol] ?? 0}
                      onChange={(event) =>
                        setTargets((current) => ({
                          ...current,
                          [asset.symbol]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Right Column Summary Card */}
        <div style={{ position: "sticky", top: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              padding: "24px",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Basket Summary</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px", borderBottom: "1px solid var(--line)", paddingBottom: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Name</span>
                <strong>{name || "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Symbol</span>
                <strong>{symbol || "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>ENS Handle</span>
                <strong style={{ color: "var(--accent)" }}>{subdomain ? `${subdomain}.othelio.eth` : "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Seed Deposit</span>
                <strong>${Number(depositAmount || 0).toLocaleString()} USDC</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Composition</span>
                <strong>{selectedAssets.length} Assets</strong>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontSize: "13px", color: "var(--muted-ink)" }}>Total Allocation</span>
              <div style={{ textAlign: "right" }}>
                <strong style={{ fontSize: "18px", display: "block", color: total === 100 && selectedAssets.length > 0 ? "var(--positive)" : "var(--danger)" }}>
                  {total}%
                </strong>
                <small style={{ fontSize: "11px", color: total === 100 && selectedAssets.length > 0 ? "var(--positive)" : "var(--danger)" }}>
                  {selectedAssets.length === 0
                    ? "Add 1+ stock"
                    : total === 100
                    ? ""
                    : `${total > 100 ? "-" : "+"}${Math.abs(100 - total)}% needed`}
                </small>
              </div>
            </div>

            <button
              className="primary"
              disabled={!hasConnectedWallet || total !== 100 || selectedAssets.length === 0 || !hasValidDeposit || isPending}
              onClick={handleExecute}
              style={{
                width: "100%",
                padding: "14px",
                fontSize: "14px",
                fontWeight: 700,
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              {isPending ? "Waiting Wallet..." : !hasConnectedWallet ? "Connect wallet first" : "Create & Fund Basket"}
              <AppIcon type="arrow" />
            </button>

            {transactionError && (
              <p style={{ color: "#ef4444", fontSize: "12px", marginTop: "12px", textAlign: "center" }}>
                {transactionError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
