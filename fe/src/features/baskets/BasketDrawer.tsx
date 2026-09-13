import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useSendTransaction, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets, updateBasketWeights, depositBasket, withdrawBasket, getSlippageTolerance, type Basket } from "@/lib/baskets";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { confirmBasketRebalance, fetchSwapQuote } from "@/lib/api";
import { toRawAmount, USDC_DECIMALS } from "@/types/shared";

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
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { isConnected, address } = useAccount();
  const [targets, setTargets] = useState<Record<string, number>>(() =>
    Object.fromEntries(basket.holdings.map((asset) => [asset.symbol, asset.target]))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const total = useMemo(() => Object.values(targets).reduce((sum, value) => sum + value, 0), [targets]);

  const { isPending: isSendPending, sendTransactionAsync } = useSendTransaction();

  const [activeHash, setActiveHash] = useState<`0x${string}` | null>(null);
  const [submittedTargets, setSubmittedTargets] = useState<Array<{ assetAddress: string; targetWeightBps: number }>>([]);
  const hash = activeHash;
  const isPending = isSendPending;
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  const processedHash = useRef<string | null>(null);
  const [countdown, setCountdown] = useState<number>(10);

  useEffect(() => {
    if (isSuccess && hash && processedHash.current !== hash) {
      processedHash.current = hash;
      updateBasketWeights(basket.address, targets);
      const activeChain = chainId as keyof typeof CONTRACT_ADDRESSES;
      const moduleAddress = CONTRACT_ADDRESSES[activeChain]?.module;
      if (moduleAddress && submittedTargets.length > 0) {
        void confirmBasketRebalance(basket.address, {
          chainId: activeChain,
          moduleAddress,
          txHash: hash,
          targetWeights: submittedTargets,
        }).then(() => Promise.all([
          queryClient.invalidateQueries({ queryKey: ["basket", basket.address] }),
          queryClient.invalidateQueries({ queryKey: ["basket-positions", basket.address] }),
          queryClient.invalidateQueries({ queryKey: ["baskets"] }),
        ])).catch((error) => {
          setExecutionError(error instanceof Error ? error.message : "Rebalance confirmed, but its allocation could not be refreshed.");
        });
      }
    }
  }, [isSuccess, basket.address, targets, hash, chainId, submittedTargets, queryClient]);

  useEffect(() => {
    if (isSuccess) {
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
      setExecutionError(null);
      if (!(chainId in CONTRACT_ADDRESSES)) {
        throw new Error(`Rebalance is unavailable on unsupported chain ${chainId}.`);
      }
      const activeChain = chainId as keyof typeof CONTRACT_ADDRESSES;
      const targetModule = CONTRACT_ADDRESSES[activeChain]?.module;
      if (!targetModule || /^0x0{40}$/i.test(targetModule)) {
        throw new Error("No verified basket module is configured for this network.");
      }

      const targetWeights = selected.map((s) => ({
        assetAddress: supportedAssets.find((a) => a.symbol === s.symbol)?.address || s.address || "0x0000000000000000000000000000000000000000",
        targetWeightBps: (targets[s.symbol] || 0) * 100,
      }));

      const res = await fetchSwapQuote(basket.address, {
        action: 'rebalance',
        chainId: activeChain,
        moduleAddress: targetModule,
        callerAddress: address,
        targetWeights,
        slippageBps: getSlippageTolerance() * 100,
      });

      const quote = res?.data;
      const plan = quote?.plan;
      const call = plan?.calls[0];
      const isCurrent = plan
        && plan.action === "SPOT_REBALANCE"
        && plan.chainId === activeChain
        && plan.accountAddress.toLowerCase() === basket.address.toLowerCase()
        && plan.snapshot.basketAddress.toLowerCase() === basket.address.toLowerCase();
      const moduleIsBoundedV3 = quote?.module?.moduleVersion === 3
        && quote.module.supportsBoundedExecution
        && quote.module.address.toLowerCase() === targetModule.toLowerCase();
      const callMatchesModule = call?.to.toLowerCase() === targetModule.toLowerCase();
      const isFreshAndSimulated = plan?.simulation.status === "SUCCEEDED"
        && new Date(plan.expiresAt).getTime() > Date.now();

      if (!res.executionAllowed || !isCurrent || !moduleIsBoundedV3 || !callMatchesModule || !isFreshAndSimulated || !call) {
        throw new Error("This rebalance is not a fresh, simulated bounded-execution plan. Request a new quote.");
      }

      const tx = await sendTransactionAsync({
        to: call.to as `0x${string}`,
        data: call.calldata as `0x${string}`,
        value: BigInt(call.valueBaseUnits),
      });
      setSubmittedTargets(targetWeights);
      setActiveHash(tx);
    } catch (err) {
      console.error("Rebalance execution error:", err);
      setExecutionError(err instanceof Error ? err.message : "The bounded rebalance plan could not be prepared.");
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
                <strong>Typed Aerodrome Execution</strong>
                <small>Executes reviewed constrained Aerodrome Slipstream routes through the portfolio module.</small>
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
            {executionError && <p role="alert" style={{ color: "#ef4444", fontSize: "13px" }}>{executionError}</p>}
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
  const queryClient = useQueryClient();
  const isMint = kind === "mint";
  const { address: userAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const chainConfig = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES] || CONTRACT_ADDRESSES[8453];
  const usdcAddress = (chainConfig.usdc || CONTRACT_ADDRESSES[8453].usdc) as `0x${string}`;
  const moduleAddr = (chainConfig.module || CONTRACT_ADDRESSES[8453].module) as `0x${string}`;

  const [withdrawInUsdc, setWithdrawInUsdc] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: usdcBalanceRaw, isLoading: isBalanceLoading, refetch: refetchDrawerUsdc } = useReadContract({
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

  const [depositAmount, setDepositAmount] = useState<string>(isMint ? "1000" : (basket.value > 0 ? (basket.value * 0.25).toFixed(0) : "1000"));

  const { isPending: isWritePending, writeContractAsync } = useWriteContract();
  const { isPending: isSendPending, sendTransactionAsync } = useSendTransaction();

  const [activeHash, setActiveHash] = useState<`0x${string}` | null>(null);
  const hash = activeHash;
  const isPending = isWritePending || isSendPending;
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  const formattedBalance = usdcBalanceRaw !== undefined && userAddress
    ? `${Number(formatUnits(usdcBalanceRaw as bigint, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
    : "0.00 USDC";

  const processedHash = useRef<string | null>(null);
  const [countdown, setCountdown] = useState<number>(10);

  useEffect(() => {
    if (isSuccess && hash && processedHash.current !== hash) {
      processedHash.current = hash;
      const val = Number(depositAmount || 0);
      refetchDrawerUsdc();
      refetchAllowance();
      queryClient.invalidateQueries();
      window.dispatchEvent(new Event("basket_updated"));
      if (isMint) {
        depositBasket(basket.address, val, hash);
      } else {
        withdrawBasket(basket.address, val, hash);
      }
    }
  }, [isSuccess, isMint, depositAmount, basket.address, hash, refetchDrawerUsdc, refetchAllowance, withdrawInUsdc, queryClient]);

  useEffect(() => {
    if (isSuccess) {
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

  const publicClient = usePublicClient();

  const handleExecuteAmountAction = async () => {
    setActionError(null);
    if (!isConnected || !userAddress) {
      alert("Please connect your Web3 wallet first.");
      return;
    }

    if (isMint) {
      try {
        if (!(chainId in CONTRACT_ADDRESSES)) {
          throw new Error(`Add funds is unavailable on unsupported chain ${chainId}.`);
        }
        const holdingsPayload = basket.holdings.map((h) => ({
          address: supportedAssets.find((a) => a.symbol === h.symbol)?.address || "0x0000000000000000000000000000000000000000",
          symbol: h.symbol,
          targetWeightBps: Math.round((h.target || 0) * 100),
        }));

        const usdcAmount = toRawAmount(depositAmount || "0", USDC_DECIMALS);
        const amountRaw = usdcAmount.toString();
        const currentAllowance = (allowanceRaw as bigint) || BigInt(0);
        if (currentAllowance < usdcAmount) {
          const approveTxHash = await writeContractAsync({
            address: usdcAddress,
            abi: [{ inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }],
            functionName: 'approve',
            args: [moduleAddr, usdcAmount],
          });
          if (!publicClient) throw new Error("Wallet client is unavailable on this network.");
          await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
          await refetchAllowance();
        }

        const res = await fetchSwapQuote(basket.address, {
          action: 'mint',
          chainId,
          moduleAddress: moduleAddr,
          callerAddress: userAddress,
          inputAmount: amountRaw,
          slippageBps: getSlippageTolerance() * 100,
          holdings: holdingsPayload,
        });

        const quote = res?.data;
        const plan = quote?.plan;
        const call = plan?.calls[0];
        const routeExpired = !plan || new Date(plan.expiresAt).getTime() <= Date.now();
        const callMatchesModule = Boolean(call && plan?.calls.length === 1 && call.to.toLowerCase() === moduleAddr.toLowerCase());
        const planMatchesBasket = plan?.chainId === chainId
          && plan.accountAddress.toLowerCase() === basket.address.toLowerCase()
          && plan.snapshot.basketAddress.toLowerCase() === basket.address.toLowerCase();
        const moduleIsBoundedV3 = quote?.module?.moduleVersion === 3
          && quote.module.supportsBoundedExecution
          && quote.module.address.toLowerCase() === moduleAddr.toLowerCase();
        if (!res.executionAllowed || plan?.action !== 'FUND' || plan.simulation.status !== 'SUCCEEDED' || routeExpired || !callMatchesModule || !planMatchesBasket || !moduleIsBoundedV3 || !call) {
          throw new Error(quote?.preparationReason || "The funding route was not verified for execution.");
        }
        if (moduleAddr && moduleAddr !== '0x0000000000000000000000000000000000000000') {
          try {
            if (quote?.inputAsset?.toLowerCase() !== usdcAddress.toLowerCase() || quote.inputAmount !== amountRaw) {
              throw new Error("The simulated funding plan no longer matches the requested input amount.");
            }
            // Submit the exact v3 calldata which the backend simulated at the canonical snapshot.
            const mintTx = await sendTransactionAsync({
              to: call.to as `0x${string}`,
              data: call.calldata as `0x${string}`,
              value: BigInt(call.valueBaseUnits),
            });
            setActiveHash(mintTx);
            return;
          } catch (contractErr) {
            throw contractErr;
          }
        }
        throw new Error("No verified basket module is configured for this network.");
      } catch (err) {
        console.error("Mint execution error:", err);
        setActionError(err instanceof Error ? err.message : "The funding action could not be prepared.");
      }
    } else {
      if (withdrawInUsdc) {
        setActionError("USDC withdrawal needs a simulated multi-route bounded-execution quote.");
        return;
      }
      try {
        if (!(chainId in CONTRACT_ADDRESSES)) {
          throw new Error(`Withdrawal is unavailable on unsupported chain ${chainId}.`);
        }
        const withdrawValueUsdE8 = toRawAmount(depositAmount || "0", 8).toString();
        const res = await fetchSwapQuote(basket.address, {
          action: 'withdraw',
          chainId,
          moduleAddress: moduleAddr,
          callerAddress: userAddress,
          recipientAddress: userAddress,
          withdrawValueUsdE8,
        });
        const quote = res.data;
        const plan = quote.plan;
        const call = plan?.calls[0];
        const valid = res.executionAllowed
          && plan?.action === 'WITHDRAW_LIQUID'
          && plan.simulation.status === 'SUCCEEDED'
          && plan.calls.length === 1
          && new Date(plan.expiresAt).getTime() > Date.now()
          && plan.chainId === chainId
          && plan.accountAddress.toLowerCase() === basket.address.toLowerCase()
          && plan.snapshot.basketAddress.toLowerCase() === basket.address.toLowerCase()
          && quote.module?.moduleVersion === 3
          && quote.module.supportsBoundedExecution
          && quote.module.address.toLowerCase() === moduleAddr.toLowerCase()
          && quote.recipientAddress?.toLowerCase() === userAddress.toLowerCase()
          && quote.withdrawValueUsdE8 === withdrawValueUsdE8
          && call?.to.toLowerCase() === moduleAddr.toLowerCase();
        if (!valid || !call) throw new Error("The in-kind withdrawal plan was not verified for execution.");
        const withdrawTx = await sendTransactionAsync({
          to: call.to as `0x${string}`,
          data: call.calldata as `0x${string}`,
          value: BigInt(call.valueBaseUnits),
        });
        setActiveHash(withdrawTx);
      } catch (err) {
        console.error("Withdrawal execution error:", err);
        setActionError(err instanceof Error ? err.message : "The in-kind withdrawal could not be prepared.");
      }
    }
  };

  return (
    <aside className="rebalance-drawer amount-drawer" aria-label={`${isMint ? "Add funds to" : "Withdraw from"} ${basket.name}`}>
      <div className="drawer-scroll">
        <header>
          <div>
            <h2>{isMint ? "Add funds" : "Withdraw"}</h2>
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
              Successfully {isMint ? `added $${depositAmount} USDC to ${basket.name}` : `withdrawn $${depositAmount} from ${basket.name}`}.
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
              {isMint
                ? "Deposit USDC to acquire the basket’s current asset mix."
                : "Redeem value from your portfolio directly to your wallet."}
            </p>

            <label className="amount-field">
              <span>{isMint ? "You deposit" : "Withdrawal Amount"}</span>
              <div>
                <input
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
                <b>{isMint ? "USDC" : "USD ($)"}</b>
              </div>
              <small>
                {isMint
                  ? `Available: ${isBalanceLoading ? "Loading..." : formattedBalance}`
                  : `Basket Value: $${basket.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </small>
            </label>

            {/* Quick Percentage Presets for Withdrawal */}
            {!isMint && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", margin: "12px 0 16px" }}>
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setDepositAmount(Math.round(basket.value * (pct / 100)).toString())}
                    style={{
                      padding: "7px 4px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      background: "var(--panel-2)",
                      color: "var(--ink)",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {pct === 100 ? "Max" : `${pct}%`}
                  </button>
                ))}
              </div>
            )}

            {/* Receive in USDC Switch with Hover Tooltip */}
            {!isMint && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  background: "var(--panel-2)",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                  marginBottom: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>Receive in USDC</span>
                  <div style={{ position: "relative", display: "inline-block", cursor: "pointer" }} className="has-tooltip">
                    <span
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        background: "var(--line)",
                        color: "var(--muted-ink)",
                        fontSize: "11px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ?
                    </span>
                    <div
                      className="tooltip-box"
                      style={{
                        position: "absolute",
                        bottom: "125%",
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: "220px",
                        padding: "8px 10px",
                        background: "#1c1d1a",
                        border: "1px solid var(--line)",
                        borderRadius: "8px",
                        color: "var(--foreground)",
                        fontSize: "11px",
                        lineHeight: 1.4,
                        boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
                        zIndex: 30,
                        pointerEvents: "none",
                        visibility: "hidden",
                        opacity: 0,
                        transition: "opacity 0.2s ease, visibility 0.2s ease",
                      }}
                    >
                      Assets will be converted to USDC with your set slippage and delivered directly to your wallet.
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setWithdrawInUsdc(!withdrawInUsdc)}
                  aria-pressed={withdrawInUsdc}
                  aria-label="Receive withdrawal in USDC"
                  style={{
                    width: "48px",
                    height: "26px",
                    borderRadius: "13px",
                    background: withdrawInUsdc ? "var(--accent)" : "var(--line)",
                    border: "none",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "3px",
                      left: withdrawInUsdc ? "25px" : "3px",
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      background: withdrawInUsdc ? "#0b0c0a" : "var(--muted-ink)",
                      transition: "left 0.2s ease",
                    }}
                  />
                </button>
              </div>
            )}

            <div className="quote-summary">
              <div>
                <span>{isMint ? "Funding amount" : "Delivery Method"}</span>
                <strong>
                  {isMint
                    ? `${Number(depositAmount || 0).toLocaleString("en-US")} USDC`
                    : withdrawInUsdc
                    ? "Converted to USDC"
                    : "Direct Stock Tokens"}
                </strong>
              </div>
              {!isMint && (
                <div>
                  <span>Remaining Portfolio Value</span>
                  <strong>
                    ${Math.max(0, basket.value - Number(depositAmount || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
              )}
              <div>
                <span>DEX Route Optimization</span>
                <strong style={{ color: "#10b981", fontSize: "12px" }}>
                  Best rate via 0x / Aerodrome
                </strong>
              </div>
              <div>
                <span>Est. Network Gas Fee</span>
                <strong>~$0.04 (Base L2)</strong>
              </div>
              <div>
                <span>Max Slippage Tolerance</span>
                <strong>0.5%</strong>
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
            {actionError && <p role="alert" style={{ color: "#ef4444", fontSize: "13px" }}>{actionError}</p>}
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
            <button className="primary" disabled={isPending || isConfirming} onClick={handleExecuteAmountAction}>
              {isPending ? "Confirming..." : "Submit"} <AppIcon type="arrow" />
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}
