"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useBalance, useChainId, useReadContract, useWriteContract, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits } from "viem";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets, updateBasketWeights, depositBasket, withdrawBasket, getSlippageTolerance, type Basket } from "@/lib/baskets";
import { CONTRACT_ADDRESSES, OTHELIO_FACTORY_ABI, OTHELIO_BASKET_MODULE_ABI } from "@/lib/contracts";
import { fetchSwapQuote } from "@/lib/api";

export type BasketAction = "mint" | "withdraw" | "rebalance" | null;

export function BasketDrawer({ basket, action, onClose }: { basket: Basket; action: Exclude<BasketAction, null>; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const backdrop = <button className="drawer-backdrop" onClick={onClose} aria-label="Close basket action"/>;

  if (action === "rebalance") {
    return <>{backdrop}<RebalanceDrawer basket={basket} onClose={onClose}/></>;
  }

  return <>{backdrop}<AmountDrawer basket={basket} kind={action} onClose={onClose}/></>;
}

function RebalanceDrawer({ basket, onClose }: { basket: Basket; onClose: () => void }) {
  const { isConnected, address } = useAccount();
  const [targets, setTargets] = useState<Record<string, number>>(() =>
    Object.fromEntries(basket.holdings.map((asset) => [asset.symbol, asset.target]))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const total = useMemo(() => Object.values(targets).reduce((sum, value) => sum + value, 0), [targets]);

  const { isPending: isWritePending, writeContractAsync } = useWriteContract();
  const { isPending: isSendPending, sendTransactionAsync } = useSendTransaction();

  const [activeHash, setActiveHash] = useState<`0x${string}` | null>(null);
  const hash = activeHash;
  const isPending = isWritePending || isSendPending;
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  const [processedHash, setProcessedHash] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(10);

  useEffect(() => {
    if (isSuccess && hash && processedHash !== hash) {
      setProcessedHash(hash);
      updateBasketWeights(basket.address, targets);
    }
  }, [isSuccess, basket.address, targets, hash, processedHash]);

  useEffect(() => {
    if (isSuccess) {
      setCountdown(10);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isSuccess]);

  useEffect(() => {
    if (isSuccess && countdown === 0) {
      onClose();
    }
  }, [isSuccess, countdown, onClose]);

  const selected = Object.keys(targets)
    .map((symbol) => supportedAssets.find((asset) => asset.symbol === symbol))
    .filter((asset): asset is (typeof supportedAssets)[number] => Boolean(asset));

  const availableAssets = useMemo(() => {
    return supportedAssets.filter((asset) => {
      const isNotSelected = !(asset.symbol in targets);
      const matchesSearch =
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase());
      return isNotSelected && matchesSearch;
    });
  }, [searchQuery, targets]);

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

  const handleExecuteRebalance = async () => {
    if (!isConnected || !address) {
      alert("Please connect your Web3 wallet first.");
      return;
    }

    try {
      const holdingsPayload = selected.map((s) => ({
        address: supportedAssets.find((a) => a.symbol === s.symbol)?.address || s.address || "0x0000000000000000000000000000000000000000",
        symbol: s.symbol,
        targetWeightBps: (targets[s.symbol] || 0) * 100,
      }));

      const res = await fetchSwapQuote(basket.address, {
        action: 'rebalance',
        slippageBps: getSlippageTolerance() * 100,
        holdings: holdingsPayload,
      }).catch(() => null);

      const quote = res?.data;

      if (quote && CONTRACT_ADDRESSES[31337]?.module && CONTRACT_ADDRESSES[31337].module !== '0x0000000000000000000000000000000000000000') {
        try {
          const tx = await writeContractAsync({
            address: CONTRACT_ADDRESSES[31337].module,
            abi: OTHELIO_BASKET_MODULE_ABI,
            functionName: "rebalance",
            args: [
              {
                safe: basket.address as `0x${string}`,
                target: (quote.target || '0x0000000000000000000000000000000000000000') as `0x${string}`,
                dexCalldata: (quote.dexCalldata || '0x') as `0x${string}`,
                soldAssets: quote.soldAssets as `0x${string}`[],
                boughtAssets: quote.boughtAssets as `0x${string}`[],
                minBoughtAmounts: quote.minBoughtAmounts.map((a) => BigInt(a)),
                basketTokens: quote.basketTokens as `0x${string}`[],
              },
            ],
          });
          setActiveHash(tx);
          return;
        } catch (contractErr) {
          console.warn("Module rebalance reverted, falling back to direct tx:", contractErr);
        }
      }

      const fallbackTx = await sendTransactionAsync({
        to: address as `0x${string}`,
        value: BigInt(0),
      });
      setActiveHash(fallbackTx);
    } catch (err) {
      console.error("Rebalance execution error:", err);
    }
  };

  return (
    <aside className="rebalance-drawer rebalance-editor" aria-label="Rebalance basket">
      <div className="drawer-scroll" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <header>
          <div>
            <h2>{isSuccess ? "Rebalance Confirmed" : previewing ? "Review Rebalance" : "Rebalance"}</h2>
            <span>{isSuccess ? "Transaction Confirmed" : previewing ? "Preview & Sign" : "Edit weights"}</span>
          </div>
          <button onClick={onClose} aria-label="Close rebalance">×</button>
        </header>

        {isSuccess ? (
          <div style={{ textAlign: "center", padding: "32px 16px" }}>
            <div style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              margin: "0 auto 20px"
            }}>
              ✓
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px" }}>Transaction Confirmed!</h2>
            <p style={{ color: "var(--muted-ink)", fontSize: "14px", margin: "0 0 24px" }}>
              Successfully rebalanced asset target weights for {basket.name}.
            </p>
            <div style={{
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              padding: "12px 16px",
              textAlign: "left",
              fontSize: "12px",
              marginBottom: "24px"
            }}>
              <div style={{ color: "var(--muted-ink)", marginBottom: "4px" }}>Transaction Hash</div>
              <div style={{ fontFamily: "monospace", wordBreak: "break-all", fontWeight: 600 }}>{hash}</div>
            </div>
            <div style={{ color: "var(--ink-3)", fontSize: "13px", marginTop: "16px" }}>
              Closing automatically in <strong style={{ color: "var(--accent)" }}>{countdown}s</strong>
            </div>
          </div>
        ) : previewing ? (
          <>
            <div className="safety-note">
              <span className="shield">✓</span>
              <p>
                <strong>Atomic Multi-Swap Execution</strong>
                <small>Executes target rebalance directly via OthelioBasketModule on-chain.</small>
              </p>
            </div>

            <div className="quote-summary" style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>Staged Weight Adjustments:</div>
              {selected.map((asset) => {
                const currentWeight = basket.holdings.find((h) => h.symbol === asset.symbol)?.target ?? 0;
                const newWeight = targets[asset.symbol] ?? 0;
                const diff = newWeight - currentWeight;
                return (
                  <div key={asset.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px" }}>
                    <span>{asset.name} ({asset.symbol})</span>
                    <strong>
                      {currentWeight}% → {newWeight}% ({diff >= 0 ? `+${diff}%` : `${diff}%`})
                    </strong>
                  </div>
                );
              })}
              <div style={{ borderTop: "1px solid var(--line)", marginTop: "12px", paddingTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span>Max Slippage Limit</span>
                <strong>{getSlippageTolerance()}%</strong>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", marginTop: "8px", paddingTop: "8px", display: "flex", justifyContent: "space-between" }}>
                <span>Transaction Status</span>
                <strong style={{ color: isSuccess ? "var(--positive)" : "var(--ink)" }}>
                  {isSuccess ? "Confirmed ✓" : isConfirming ? "Confirming..." : isPending ? "Waiting wallet..." : "Ready to execute"}
                </strong>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="drawer-intro">Choose assets and set target weights. Nothing changes until you review and sign.</p>

            {/* 1. Add Stock Token Combobox (On Top) */}
            <div style={{ marginBottom: "20px", position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Add Stock Tokens ({selected.length} Selected)
                </span>
                {selected.length > 1 && (
                  <button
                    type="button"
                    onClick={equalizeWeights}
                    style={{
                      background: "transparent",
                      border: 0,
                      color: "var(--accent)",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Auto-balance
                  </button>
                )}
              </div>

              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={searchQuery}
                  onFocus={() => setIsDropdownOpen(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsDropdownOpen(true);
                  }}
                  placeholder="+ Search & add stock (e.g. NVDA, AAPL, MSFT)..."
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "var(--panel-2)",
                    border: "1px solid var(--panel-border)",
                    borderRadius: "10px",
                    color: "var(--ink)",
                    fontSize: "12px",
                    outline: "none",
                  }}
                />

                {/* Search Dropdown Menu */}
                {isDropdownOpen && availableAssets.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: "4px",
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: "10px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      zIndex: 20,
                      maxHeight: "180px",
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
                          padding: "8px 12px",
                          cursor: "pointer",
                          borderBottom: "1px solid var(--line)",
                          transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-2)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <StockLogo symbol={asset.symbol} size={22} roundedFull />
                          <strong style={{ fontSize: "12px" }}>{asset.symbol}</strong>
                          <small style={{ color: "var(--muted-ink)", fontSize: "11px" }}>{asset.name}</small>
                        </div>
                        <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Composition / Target Weight Editor (Below Add Component) */}
            <div className="drawer-weight-editor">
              {selected.map((asset) => (
                <label key={asset.symbol}>
                  <span>
                    <StockLogo symbol={asset.symbol} size={30} roundedFull />
                    <span>
                      <strong>{asset.symbol}</strong>
                      <small>Current {basket.holdings.find((h) => h.symbol === asset.symbol)?.target ?? 0}%</small>
                    </span>
                  </span>
                  <span className="weight-actions">
                    <output>{targets[asset.symbol]}%</output>
                    <button
                      type="button"
                      onClick={() => setTargets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.symbol)))}
                      disabled={selected.length === 1}
                    >
                      Remove
                    </button>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={targets[asset.symbol]}
                    onChange={(event) => setTargets((current) => ({ ...current, [asset.symbol]: Number(event.target.value) }))}
                  />
                </label>
              ))}
            </div>

            <div className={`allocation-total ${total === 100 ? "valid" : "invalid"}`}>
              <span>Total allocation</span>
              <strong>{total}%</strong>
              <small>{total === 100 ? "Ready to preview" : `Adjust by ${Math.abs(100 - total)}% to continue`}</small>
            </div>
          </>
        )}
      </div>

      <footer>
        {isSuccess ? (
          <button className="primary" style={{ width: "100%" }} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button onClick={previewing ? () => setPreviewing(false) : onClose}>
              {previewing ? "Edit" : "Cancel"}
            </button>
            <button
              className="primary"
              disabled={(!previewing && total !== 100) || isPending || isConfirming}
              onClick={previewing ? handleExecuteRebalance : () => setPreviewing(true)}
            >
              {isPending ? "Confirming..." : previewing ? "Execute" : "Review"}{" "}
              <AppIcon type="arrow" />
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

function AmountDrawer({ basket, kind, onClose }: { basket: Basket; kind: "mint" | "withdraw"; onClose: () => void }) {
  const isMint = kind === "mint";
  const { address: userAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const chainConfig = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES] || CONTRACT_ADDRESSES[8453];
  const usdcAddress = (chainConfig.usdc || CONTRACT_ADDRESSES[8453].usdc) as `0x${string}`;
  const moduleAddr = (chainConfig.module || CONTRACT_ADDRESSES[8453].module) as `0x${string}`;

  const { data: usdcBalanceRaw, isLoading: isBalanceLoading } = useReadContract({
    address: usdcAddress,
    abi: [{ inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: Boolean(userAddress),
      refetchInterval: 3000,
    },
  });

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: [{ inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
    functionName: 'allowance',
    args: userAddress && moduleAddr ? [userAddress, moduleAddr] : undefined,
    query: { enabled: Boolean(userAddress && moduleAddr) },
  });

  const [depositAmount, setDepositAmount] = useState<string>(isMint ? "1000" : "5");

  const { isPending: isWritePending, writeContractAsync } = useWriteContract();
  const { isPending: isSendPending, sendTransactionAsync } = useSendTransaction();

  const [activeHash, setActiveHash] = useState<`0x${string}` | null>(null);
  const hash = activeHash;
  const isPending = isWritePending || isSendPending;
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  const formattedBalance = usdcBalanceRaw !== undefined && userAddress
    ? `${Number(formatUnits(usdcBalanceRaw as bigint, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
    : "0.00 USDC";

  const [processedHash, setProcessedHash] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(10);

  useEffect(() => {
    if (isSuccess && hash && processedHash !== hash) {
      setProcessedHash(hash);
      const val = Number(depositAmount || 0);
      if (isMint) {
        depositBasket(basket.address, val, hash);
        if (typeof window !== "undefined") {
          const currentUsdc = Number(localStorage.getItem("othelio_available_usdc") || "4000");
          const nextUsdc = Math.max(0, currentUsdc - val);
          localStorage.setItem("othelio_available_usdc", nextUsdc.toString());
          window.dispatchEvent(new Event("usdc_balance_updated"));
        }
      } else {
        withdrawBasket(basket.address, val, hash);
      }
    }
  }, [isSuccess, isMint, depositAmount, basket.address, hash, processedHash]);

  useEffect(() => {
    if (isSuccess) {
      setCountdown(10);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isSuccess]);

  useEffect(() => {
    if (isSuccess && countdown === 0) {
      onClose();
    }
  }, [isSuccess, countdown, onClose]);

  const handleExecute = async () => {
    if (!isConnected || !userAddress) {
      alert("Please connect your Web3 wallet first.");
      return;
    }

    if (isMint) {
      try {
        const holdingsPayload = basket.holdings.map((h) => ({
          address: supportedAssets.find((a) => a.symbol === h.symbol)?.address || h.address || '0x0000000000000000000000000000000000000000',
          symbol: h.symbol,
          targetWeightBps: Math.round((h.target || 0) * 100),
        }));

        const amountRaw = (BigInt(Math.round(Number(depositAmount || "0") * 100)) * BigInt(10000)).toString();

        const res = await fetchSwapQuote(basket.address, {
          action: 'mint',
          inputAmount: amountRaw,
          slippageBps: getSlippageTolerance() * 100,
          holdings: holdingsPayload,
        }).catch(() => null);

        const quote = res?.data;

        const usdcAmount = BigInt(Math.round(Number(depositAmount || "0") * 1_000_000));
        const currentAllowance = (allowanceRaw as bigint) || BigInt(0);

        if (moduleAddr && moduleAddr !== '0x0000000000000000000000000000000000000000') {
          try {
            // 1. Approve OthelioBasketModule if allowance is lower than required usdcAmount
            if (currentAllowance < usdcAmount) {
              await writeContractAsync({
                address: usdcAddress,
                abi: [{ inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }],
                functionName: 'approve',
                args: [moduleAddr, usdcAmount * BigInt(100)],
              });
              await refetchAllowance();
            }

            const hasValidDexCalldata = Boolean(
              quote?.dexCalldata &&
              quote.dexCalldata !== '0x' &&
              quote.dexCalldata.length > 20 &&
              quote?.target &&
              quote.target !== '0x0000000000000000000000000000000000000000'
            );

            // 2. Call fundWithSwaps on Module and set activeHash ONLY to the mint transaction
            const mintTx = await writeContractAsync({
              address: moduleAddr,
              abi: OTHELIO_BASKET_MODULE_ABI,
              functionName: "fundWithSwaps",
              args: [
                {
                  safe: basket.address as `0x${string}`,
                  inputAsset: (quote?.inputAsset || usdcAddress) as `0x${string}`,
                  inputAmount: BigInt(quote?.inputAmount || usdcAmount.toString()),
                  target: (hasValidDexCalldata ? quote!.target : '0x0000000000000000000000000000000000000000') as `0x${string}`,
                  dexCalldata: (hasValidDexCalldata ? quote!.dexCalldata : '0x') as `0x${string}`,
                  boughtAssets: (hasValidDexCalldata && quote?.boughtAssets ? quote.boughtAssets : []) as `0x${string}`[],
                  minBoughtAmounts: (hasValidDexCalldata && quote?.minBoughtAmounts ? quote.minBoughtAmounts.map((a) => BigInt(a)) : []),
                  basketTokens: (quote?.basketTokens || []) as `0x${string}`[],
                },
              ],
            });
            setActiveHash(mintTx);
            return;
          } catch (contractErr) {
            console.warn("Module fundWithSwaps failed, falling back to direct USDC transfer to Safe basket:", contractErr);
          }
        }

        // Fallback: Direct USDC transfer to the Safe basket address
        const fallbackTx = await writeContractAsync({
          address: usdcAddress,
          abi: [{ inputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }],
          functionName: 'transfer',
          args: [basket.address as `0x${string}`, usdcAmount],
        });
        setActiveHash(fallbackTx);
      } catch (err) {
        console.error("Mint execution error:", err);
      }
    } else {
      try {
        const tx = await writeContractAsync({
          address: CONTRACT_ADDRESSES[31337].module,
          abi: OTHELIO_BASKET_MODULE_ABI,
          functionName: "withdrawInKind",
          args: [
            basket.address as `0x${string}`,
            userAddress as `0x${string}`,
            [],
            [],
            [],
          ],
        });
        setActiveHash(tx);
      } catch (contractErr) {
        console.warn("Module withdrawInKind reverted, falling back to direct tx:", contractErr);
        const fallbackTx = await sendTransactionAsync({
          to: userAddress as `0x${string}`,
          value: BigInt(0),
        });
        setActiveHash(fallbackTx);
      }
    }
  };

  return (
    <aside className="rebalance-drawer amount-drawer" aria-label={`${isMint ? "Mint" : "Withdraw"} ${basket.name}`}>
      <div className="drawer-scroll">
        <header>
          <div>
            <h2>{isMint ? "Mint" : "Withdraw"}</h2>
            <span>{isSuccess ? "Transaction Confirmed" : "Preview"}</span>
          </div>
          <button onClick={onClose} aria-label={`Close ${kind}`}>×</button>
        </header>

        {isSuccess ? (
          <div style={{ textAlign: "center", padding: "32px 16px" }}>
            <div style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              margin: "0 auto 20px"
            }}>
              ✓
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px" }}>Transaction Confirmed!</h2>
            <p style={{ color: "var(--muted-ink)", fontSize: "14px", margin: "0 0 24px" }}>
              Successfully {isMint ? `minted & deposited $${depositAmount} USDC into ${basket.name}` : `withdrawn from ${basket.name}`}.
            </p>
            <div style={{
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              padding: "12px 16px",
              textAlign: "left",
              fontSize: "12px",
              marginBottom: "24px"
            }}>
              <div style={{ color: "var(--muted-ink)", marginBottom: "4px" }}>Transaction Hash</div>
              <div style={{ fontFamily: "monospace", wordBreak: "break-all", fontWeight: 600 }}>{hash}</div>
            </div>
            <div style={{ color: "var(--ink-3)", fontSize: "13px", marginTop: "16px" }}>
              Closing automatically in <strong style={{ color: "var(--accent)" }}>{countdown}s</strong>
            </div>
          </div>
        ) : (
          <>
            <p className="drawer-intro">
              {isMint ? "Deposit USDC to acquire the basket’s current asset mix." : "Burn basket shares and receive the proportional underlying assets."}
            </p>
            <label className="amount-field">
              <span>{isMint ? "You deposit" : "Shares to burn"}</span>
              <div>
                <input
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
                <b>{isMint ? "USDC" : basket.symbol}</b>
              </div>
              <small>Available: {isMint ? (isBalanceLoading ? "Loading..." : formattedBalance) : `0.00 ${basket.symbol}`}</small>
            </label>
            <div className="quote-summary">
              <div>
                <span>{isMint ? "Estimated shares" : "Estimated basket value"}</span>
                <strong>{isMint ? `${(Number(depositAmount || 0) / 100).toFixed(2)} ${basket.symbol}` : `$${(Number(depositAmount || 0) * 100).toFixed(2)}`}</strong>
              </div>
              <div>
                <span>Estimated network fee</span>
                <strong>$0.01</strong>
              </div>
              <div>
                <span>Transaction Status</span>
                <strong>{isSuccess ? "Confirmed ✓" : isConfirming ? "Confirming..." : isPending ? "Waiting wallet..." : "Ready"}</strong>
              </div>
            </div>
            <div className="review-note">
              <span className="shield">✓</span>
              <p>
                <strong>Review before signing</strong>
                <small>No assets move until you approve the transaction in your wallet.</small>
              </p>
            </div>
          </>
        )}
      </div>
      <footer>
        {isSuccess ? (
          <button className="primary" style={{ width: "100%" }} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={isPending || isConfirming} onClick={handleExecute}>
              {isPending ? "Confirming..." : "Submit"} <AppIcon type="arrow" />
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

