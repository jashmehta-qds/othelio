import { Dialog } from "@/components/ui/Dialog";
import "@/components/transactions.css";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useSendTransaction, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { decodeFunctionData, formatUnits, parseUnits } from "viem";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets, depositBasket, withdrawBasket, getSlippageTolerance, type Basket, type Holding } from "@/lib/baskets";
import { CONTRACT_ADDRESSES, OTHELIO_PORTFOLIO_MODULE_ABI } from "@/lib/contracts";
import { fetchSwapQuote, fetchAccountSettingsApi, type PriceReferenceWarning, type DustTradesSkippedWarning } from "@/lib/api";
import { useBasketDetails, useBasketActivity, useWalletUsdcBalance, useSupportedAssets } from "@/hooks/useBaskets";
import { toRawAmount, USDC_DECIMALS } from "@/types/shared";

export type BasketAction = "mint" | "withdraw" | "rebalance" | null;

type ConsentStage = { key: string; fingerprint: string; mode: 'allow' | 'warn' | 'reject'; approved: boolean; startedAt: number; expiresAt: number };

type QuoteFingerprintInput = {
  inputAsset?: string;
  inputAmount?: string;
  withdrawValueUsdE8?: string;
  minBoughtAmounts?: string[];
  slippageBps?: number;
  route?: { provider?: string; target?: string; allowanceSpender?: string; recipient?: string; sellAsset?: string; buyAsset?: string; maxSellAmount?: string; minBuyAmount?: string };
  rebalance?: { soldAssets?: string[]; maxSoldAmounts?: string[]; boughtAssets?: string[]; minBoughtAmounts?: string[]; basketTokens?: string[] };
  withdrawal?: unknown;
  plan?: { action?: string; chainId?: number; accountAddress?: string; snapshot?: unknown; calls?: Array<{ to: string; valueBaseUnits: string }>; limits?: unknown; expectedAfterState?: unknown };
};

function staleQuoteFingerprint(warnings: PriceReferenceWarning[], quote: unknown): string {
  const data = quote as QuoteFingerprintInput;
  const references = warnings.flatMap((warning) => warning.code === 'STALE_PRICE_REFERENCE'
    ? warning.assets.map(({ assetAddress, priceUsdE8, feedUpdatedAt, feedRoundId }) => ({ assetAddress: assetAddress.toLowerCase(), priceUsdE8, feedUpdatedAt, feedRoundId }))
    : []).sort((a, b) => a.assetAddress.localeCompare(b.assetAddress));
  const route = data.route;
  const plan = data.plan;
  return JSON.stringify({
    references,
    inputAsset: data.inputAsset,
    inputAmount: data.inputAmount,
    withdrawValueUsdE8: data.withdrawValueUsdE8,
    route: route && { provider: route.provider, target: route.target, allowanceSpender: route.allowanceSpender, recipient: route.recipient, sellAsset: route.sellAsset, buyAsset: route.buyAsset, maxSellAmount: route.maxSellAmount, minBuyAmount: route.minBuyAmount },
    minBoughtAmounts: data.minBoughtAmounts,
    rebalance: data.rebalance && { soldAssets: data.rebalance.soldAssets, maxSoldAmounts: data.rebalance.maxSoldAmounts, boughtAssets: data.rebalance.boughtAssets, minBoughtAmounts: data.rebalance.minBoughtAmounts, basketTokens: data.rebalance.basketTokens },
    withdrawal: data.withdrawal,
    plan: plan && { action: plan.action, chainId: plan.chainId, accountAddress: plan.accountAddress, snapshot: plan.snapshot && { chainId: (plan.snapshot as { chainId?: number }).chainId, basketAddress: (plan.snapshot as { basketAddress?: string }).basketAddress }, calls: plan.calls?.map((call: { to: string; valueBaseUnits: string }) => ({ to: call.to, valueBaseUnits: call.valueBaseUnits })), limits: plan.limits, expectedAfterState: plan.expectedAfterState },
    slippageBps: data.slippageBps,
  });
}

function useStalePriceConsent(wallet: string | undefined, inputKey: string) {
  const [storedStage, setStage] = useState<ConsentStage | null>(null);
  const [now, setNow] = useState(0);
  const key = `${wallet?.toLowerCase() ?? ''}:${inputKey}`;
  const stage = storedStage?.key === key ? storedStage : null;
  useEffect(() => {
    if (!stage || stage.mode !== 'allow') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [stage]);
  const remaining = stage?.mode === 'allow' ? Math.max(0, Math.ceil(15 - (now - stage.startedAt) / 1000)) : 0;
  const authorize = async (warnings: PriceReferenceWarning[], fingerprint: string, expiresAt: string): Promise<boolean> => {
    const stale = warnings.some((warning) => warning.code === 'STALE_PRICE_REFERENCE');
    if (!stale) { setStage(null); return true; }
    if (!wallet) throw new Error('Connect a wallet to load its stale-price trade preference.');
    const settings = await fetchAccountSettingsApi(wallet);
    const mode = settings.data.stalePriceTrades ?? 'warn';
    if (mode === 'reject') {
      setStage({ key, fingerprint, mode, approved: false, startedAt: Date.now(), expiresAt: new Date(expiresAt).getTime() });
      return false;
    }
    if (!stage || stage.fingerprint !== fingerprint || stage.mode !== mode || Date.now() >= stage.expiresAt) {
      setStage({ key, fingerprint, mode, approved: false, startedAt: Date.now(), expiresAt: new Date(expiresAt).getTime() });
      setNow(Date.now());
      return false;
    }
    if (mode === 'warn' && !stage.approved) return false;
    if (mode === 'allow' && remaining > 0) return false;
    return true;
  };
  return { stage, remaining, setApproval: (approved: boolean) => setStage((current) => current?.key === key ? { ...current, approved } : current), authorize, clear: () => setStage(null) };
}

const QUOTE_EXPIRED_MESSAGE = "This execution quote expired before it reached the chain. Get a fresh quote, review it, and sign again.";

function isQuoteExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("quoteexpired") || message.toLowerCase().includes("0x8727a7f9");
}

function userFacingExecutionError(error: unknown, fallback: string): string {
  return isQuoteExpiredError(error)
    ? QUOTE_EXPIRED_MESSAGE
    : error instanceof Error
      ? error.message
      : fallback;
}

function isCanonicalLiquidWithdrawalError(message: string | null, isMint: boolean): boolean {
  return !isMint && Boolean(message?.toLowerCase().includes("canonical liquid basket value"));
}

function formatPaddedPercent(val: number): string {
  const rounded = Math.round(Math.abs(val) * 100) / 100;
  const parts = rounded.toFixed(2).split(".");
  const integerPart = parts[0].padStart(2, "0");
  return `${integerPart}.${parts[1]}`;
}

function formatWeight(val: number): string {
  return formatPaddedPercent(val);
}

function formatWeightDelta(diff: number): string {
  const rounded = Math.round(diff * 100) / 100;
  const formatted = formatPaddedPercent(rounded);
  if (rounded > 0) return `+${formatted}%`;
  if (rounded < 0) return `-${formatted}%`;
  return `00.00%`;
}

function formatMinimumOutputs(assetAddresses: string[] | undefined, amounts: string[] | undefined): string[] {
  return (amounts ?? []).map((amount, index) => {
    const address = assetAddresses?.[index];
    const asset = address ? supportedAssets.find((item) => item.address?.toLowerCase() === address.toLowerCase()) : undefined;
    return `${asset?.symbol ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : `Output ${index + 1}`)}: ${amount} base units`;
  });
}

function PriceReferenceNotice({ warnings, minimums = [], slippageBps, stage, remaining, onApprovalChange, onCancel }: { warnings: PriceReferenceWarning[]; minimums?: string[]; slippageBps?: number; stage: ConsentStage | null; remaining: number; onApprovalChange: (approved: boolean) => void; onCancel: () => void }) {
  const warning = warnings.find((item) => item.code === "STALE_PRICE_REFERENCE");
  if (!warning) return null;

  const assetRows = warning.assets.map((item) => {
    const symbol = supportedAssets.find((asset) => asset.address?.toLowerCase() === item.assetAddress.toLowerCase())?.symbol
      ?? `${item.assetAddress.slice(0, 6)}…${item.assetAddress.slice(-4)}`;
    const dollars = Number(item.priceUsdE8) / 100_000_000;
    const age = item.ageSeconds >= 86400
      ? `${Math.floor(item.ageSeconds / 86400)}d ${Math.floor((item.ageSeconds % 86400) / 3600)}h old`
      : item.ageSeconds >= 3600
        ? `${Math.floor(item.ageSeconds / 3600)}h ${Math.floor((item.ageSeconds % 3600) / 60)}m old`
        : `${Math.floor(item.ageSeconds / 60)}m old`;
    return { ...item, symbol, dollars, age };
  });
  const referenceTime = new Date(warning.lastPriceReferenceAt);
  const formattedReference = Number.isNaN(referenceTime.getTime())
    ? warning.lastPriceReferenceAt
    : referenceTime.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const blocked = stage?.mode === 'reject';

  return (
    <div className="price-reference-notice" role="region" aria-labelledby="stale-price-heading">
      <div className="price-reference-icon" aria-hidden="true"><AppIcon type="clock" /></div>
      <div className="price-reference-content">
        <h3 id="stale-price-heading">This quote uses older price references</h3>
        <p className="price-reference-summary">Prices below were last referenced {formattedReference}. Review them before continuing.</p>
        <div className="price-reference-assets" role="list" aria-label="Stale quote price references">
          {assetRows.map((item) => (
            <div className="price-reference-asset" role="listitem" key={item.assetAddress}>
              <strong>{item.symbol}</strong>
              <span>${item.dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
              <small>{item.age}</small>
            </div>
          ))}
        </div>
        {(minimums.length > 0 || slippageBps !== undefined) && (
          <details className="price-reference-details">
            <summary>Quote limits</summary>
            {minimums.map((minimum, index) => <small key={`${index}-${minimum}`}>Minimum output: {minimum}</small>)}
            {slippageBps !== undefined && <small>Maximum DEX slippage: {(slippageBps / 100).toFixed(2)}%</small>}
          </details>
        )}
        <p className="price-reference-caveat">These are quote-time references. The oracle may update before the trade executes; route minimums and the onchain loss check still apply.</p>
        {blocked ? (
          <div className="price-reference-blocked" role="alert">
            <strong>Trade blocked by your stale-price preference.</strong>
            <a href="/app/settings">Change this in Settings</a>
          </div>
        ) : stage?.mode === 'allow' ? (
          remaining > 0 ? (
            <div className="price-reference-wait" role="status">
              <span>Trade available in {remaining}s</span>
              <progress max="15" value={15 - remaining} aria-label={`${remaining} seconds remaining before trade is available`} />
              <button type="button" onClick={onCancel}>Cancel trade</button>
            </div>
          ) : (
            <div className="price-reference-ready" role="status">
              <strong>Ready to confirm this trade.</strong>
              <button type="button" onClick={onCancel}>Cancel trade</button>
            </div>
          )
        ) : stage?.mode === 'warn' ? (
          <label className="price-reference-consent">
            <input type="checkbox" checked={stage.approved} onChange={(event) => onApprovalChange(event.currentTarget.checked)} />
            <span>I accept using these displayed stale quote-time references for this trade.</span>
          </label>
        ) : (
          <p className="price-reference-loading" role="status">Continue with “Review stale quote” to load the consent step.</p>
        )}
      </div>
    </div>
  );
}

function DustTradesNotice({ warnings }: { warnings: PriceReferenceWarning[] }) {
  const warning = warnings.find((item): item is DustTradesSkippedWarning => item.code === "DUST_TRADES_SKIPPED");
  if (!warning) return null;

  const labels = warning.assets.map((item) => {
    const symbol = supportedAssets.find((asset) => asset.address?.toLowerCase() === item.assetAddress.toLowerCase())?.symbol;
    return symbol ?? `${item.assetAddress.slice(0, 6)}…${item.assetAddress.slice(-4)}`;
  });
  const uniqueLabels = Array.from(new Set(labels));

  return (
    <div
      className="price-reference-notice dust-notice"
      role="status"
      style={{
        borderColor: "rgba(234, 179, 8, 0.35)",
        background: "rgba(234, 179, 8, 0.07)",
        marginTop: "10px",
      }}
    >
      <AppIcon type="alert" />
      <p>
        <strong style={{ color: "var(--warning, #eab308)" }}>Dust adjustments skipped (&lt; $0.05)</strong>
        <span>
          Minor rebalance deltas under $0.05 were skipped ({uniqueLabels.join(", ")}) to protect against DEX slippage and transaction failure.
        </span>
        <small>Only meaningful position swaps are routed to DEX pools.</small>
      </p>
    </div>
  );
}

function useCatalogHoldings(): Holding[] {
  const { data: catalogData } = useSupportedAssets();
  return useMemo(() => {
    if (!catalogData?.data?.length) return supportedAssets;
    return catalogData.data.map((item) => {
      const fallback = supportedAssets.find((a) => a.symbol === item.symbol || a.address?.toLowerCase() === item.assetAddress.toLowerCase());
      return {
        symbol: item.symbol ?? fallback?.symbol ?? "",
        name: item.name ?? fallback?.name ?? "",
        target: 0,
        current: 0,
        quantity: 0,
        value: 0,
        color: fallback?.color ?? "#8aa4ff",
        address: item.assetAddress ?? fallback?.address,
        tradeable: item.tradeable ?? (item.status !== "UNAVAILABLE" && item.priceUsdE8 != null),
      };
    });
  }, [catalogData]);
}

export function BasketDrawer({ basket, action, onClose }: { basket: Basket; action: Exclude<BasketAction, null>; onClose: () => void }) {
  return action === "rebalance" ? <RebalanceDrawer basket={basket} onClose={onClose} /> : <AmountDrawer basket={basket} kind={action} onClose={onClose} />;
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
  const [priceWarnings, setPriceWarnings] = useState<PriceReferenceWarning[]>([]);
  const [quoteMinimums, setQuoteMinimums] = useState<string[]>([]);
  const [quoteSlippageBps, setQuoteSlippageBps] = useState<number | undefined>();
  const staleConsent = useStalePriceConsent(address, `${basket.address}:${JSON.stringify(targets)}`);
  const clearQuoteNotice = () => {
    setPriceWarnings([]);
    setQuoteMinimums([]);
    setQuoteSlippageBps(undefined);
    staleConsent.clear();
  };
  const total = useMemo(() => Object.values(targets).reduce((sum, value) => sum + value, 0), [targets]);

  const { isPending: isSendPending, sendTransactionAsync } = useSendTransaction();

  const [activeHash, setActiveHash] = useState<`0x${string}` | null>(null);
  const hash = activeHash;
  const isPending = isSendPending;
  const { data: receipt, isError: isReceiptError, error: receiptError, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });
  const { data: indexedDetails } = useBasketDetails(basket.address, chainId, address, Boolean(isPending || isConfirming || isSuccess));
  useBasketActivity(basket.address, chainId, address, Boolean(isPending || isConfirming || isSuccess));
  const isAllocationIndexed = Boolean(isSuccess && receipt && indexedDetails?.data?.targets);

  const processedHash = useRef<string | null>(null);
  const [countdown, setCountdown] = useState<number>(10);

  useEffect(() => {
    if (isSuccess && hash && processedHash.current !== hash) {
      processedHash.current = hash;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["basket", basket.address] }),
        queryClient.invalidateQueries({ queryKey: ["basket-positions", basket.address.toLowerCase()] }),
        queryClient.invalidateQueries({ queryKey: ["baskets"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["all-activity"] }),
      ]);
    }
  }, [isSuccess, basket.address, hash, queryClient]);

  useEffect(() => {
    if (isAllocationIndexed) {
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
  }, [isAllocationIndexed]);

  useEffect(() => {
    if (isAllocationIndexed && countdown === 0) {
      onClose();
    }
  }, [isAllocationIndexed, countdown, onClose]);

  useEffect(() => {
    if (!isReceiptError) return;
    setExecutionError(userFacingExecutionError(receiptError, "The rebalance transaction reverted on-chain."));
    setActiveHash(null);
  }, [isReceiptError, receiptError]);

  const allAssets = useCatalogHoldings();

  const selected = Object.keys(targets)
    .map((symbol) => allAssets.find((asset) => asset.symbol === symbol))
    .filter((asset): asset is Holding => Boolean(asset));

  const availableAssets = useMemo(() => {
    return allAssets
      .filter((asset) => {
        const isNotSelected = !(asset.symbol in targets);
        const matchesSearch =
          asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          asset.name.toLowerCase().includes(searchQuery.toLowerCase());
        return isNotSelected && matchesSearch;
      })
      .sort((a, b) => {
        const aTradeable = a.tradeable !== false;
        const bTradeable = b.tradeable !== false;
        if (aTradeable !== bTradeable) return aTradeable ? -1 : 1;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [allAssets, searchQuery, targets]);

  const inoperableAssets = useMemo(() => {
    return selected.filter((asset) => (targets[asset.symbol] ?? 0) > 0 && asset.tradeable === false);
  }, [selected, targets]);

  const hasInoperableAssets = inoperableAssets.length > 0;

  const addToken = (tokenSymbol: string) => {
    const asset = allAssets.find((a) => a.symbol === tokenSymbol);
    if (asset && asset.tradeable === false) return;

    clearQuoteNotice();
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
    const operableKeys = Object.keys(targets).filter((sym) => {
      const asset = allAssets.find((a) => a.symbol === sym);
      return asset?.tradeable !== false;
    });
    if (operableKeys.length === 0) return;
    const equalShare = Math.floor(100 / operableKeys.length);
    const remainder = 100 - equalShare * operableKeys.length;
    const next: Record<string, number> = {};
    Object.keys(targets).forEach((sym) => {
      next[sym] = 0;
    });
    operableKeys.forEach((k, idx) => {
      next[k] = equalShare + (idx === 0 ? remainder : 0);
    });
    clearQuoteNotice();
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

      const inoperable = selected.find((s) => (targets[s.symbol] || 0) > 0 && s.tradeable === false);
      if (inoperable) {
        throw new Error(`Asset ${inoperable.symbol} is not operable on Base mainnet. Set target weight to 0% or remove to proceed.`);
      }

      const targetWeights = selected.map((s) => ({
        assetAddress: allAssets.find((a) => a.symbol === s.symbol)?.address || s.address || "0x0000000000000000000000000000000000000000",
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
      setPriceWarnings(quote?.warnings ?? []);
      setQuoteMinimums(formatMinimumOutputs(quote?.boughtAssets ?? quote?.rebalance?.boughtAssets ?? (quote?.route?.buyAsset ? [quote.route.buyAsset] : undefined), quote?.minBoughtAmounts?.length ? quote.minBoughtAmounts : quote?.rebalance?.minBoughtAmounts?.length ? quote.rebalance.minBoughtAmounts : quote?.route?.minBuyAmount ? [quote.route.minBuyAmount] : []));
      setQuoteSlippageBps(quote?.slippageBps);
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

      const approved = await staleConsent.authorize(quote?.warnings ?? [], staleQuoteFingerprint(quote?.warnings ?? [], quote ?? {}), plan.expiresAt);
      if (!approved) return;

      const tx = await sendTransactionAsync({
        to: call.to as `0x${string}`,
        data: call.calldata as `0x${string}`,
        value: BigInt(call.valueBaseUnits),
      });
      setActiveHash(tx);
    } catch (err) {
      console.error("Rebalance execution error:", err);
      setExecutionError(userFacingExecutionError(err, "The bounded rebalance plan could not be prepared."));
    }
  };

  return (
    <Dialog open onClose={onClose} title={isAllocationIndexed ? "Rebalance confirmed" : isSuccess ? "Updating allocation" : previewing ? "Review rebalance" : "Rebalance basket"} description={basket.name} kind="sheet" size="wide" footer={<div className="transaction-actions">
        {isAllocationIndexed ? (
          <button className="ui-button" style={{ width: "100%" }} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="ui-button" data-variant="secondary" onClick={previewing ? () => setPreviewing(false) : onClose}>
              {previewing ? "Edit" : "Cancel"}
            </button>
            <button
              className="ui-button"
              disabled={(!previewing && (total !== 100 || hasInoperableAssets)) || isPending || isConfirming || isSuccess || staleConsent.remaining > 0 || Boolean(staleConsent.stage?.mode === 'warn' && !staleConsent.stage.approved) || staleConsent.stage?.mode === 'reject'}
              onClick={previewing ? handleExecuteRebalance : () => setPreviewing(true)}
            >
              {isSuccess ? "Updating allocation…" : isConfirming ? "Waiting for confirmation…" : isPending ? "Waiting for wallet…" : previewing ? (staleConsent.stage && (staleConsent.stage.mode === 'warn' ? staleConsent.stage.approved : staleConsent.stage.mode === 'allow' ? staleConsent.remaining === 0 : false) ? "Confirm trade" : priceWarnings.some((warning) => warning.code === "STALE_PRICE_REFERENCE") ? "Review stale quote" : "Confirm in wallet") : "Review"}{" "}
              <AppIcon type="arrow" />
            </button>
          </>
        )}
      </div>}>
      <div className="transaction-drawer-content">


        {isAllocationIndexed ? (
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
            <div className="quote-summary" style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "10px", color: "var(--ink)" }}>Staged Weight Adjustments</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {selected.map((asset) => {
                  const currentWeight = basket.holdings.find((h) => h.symbol === asset.symbol)?.target ?? 0;
                  const newWeight = targets[asset.symbol] ?? 0;
                  const diff = newWeight - currentWeight;
                  const roundedDiff = Math.round(diff * 100) / 100;
                  const isPositive = roundedDiff > 0;
                  const isNegative = roundedDiff < 0;

                  return (
                    <div
                      key={asset.symbol}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        background: "var(--panel-2)",
                        borderRadius: "8px",
                        border: "1px solid var(--panel-border)",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1, marginRight: "12px" }}>
                        <StockLogo symbol={asset.symbol} size={22} roundedFull />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>{asset.symbol}</div>
                          <div style={{ fontSize: "11px", color: "var(--muted-ink)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                            {asset.name}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        <span style={{ fontSize: "13px", color: "var(--ink)" }}>
                          <span style={{ color: "var(--muted-ink)" }}>{formatWeight(currentWeight)}%</span>
                          <span style={{ margin: "0 6px", color: "var(--muted-ink)", opacity: 0.6 }}>→</span>
                          <strong style={{ fontWeight: 600 }}>{formatWeight(newWeight)}%</strong>
                        </span>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            fontVariantNumeric: "tabular-nums",
                            background: isPositive
                              ? "rgba(16, 185, 129, 0.12)"
                              : isNegative
                                ? "rgba(239, 68, 68, 0.12)"
                                : "rgba(255, 255, 255, 0.06)",
                            color: isPositive
                              ? "#10b981"
                              : isNegative
                                ? "#ef4444"
                                : "var(--muted-ink)",
                          }}
                        >
                          {formatWeightDelta(diff)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ borderTop: "1px solid var(--line)", marginTop: "12px", paddingTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span>Max Slippage Limit</span>
                <strong>{getSlippageTolerance()}%</strong>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", marginTop: "8px", paddingTop: "8px", display: "flex", justifyContent: "space-between" }}>
                <span>Transaction Status</span>
                <strong style={{ color: isSuccess ? "var(--positive)" : "var(--ink)" }}>
                  {isSuccess ? "Waiting for indexed allocation..." : isConfirming ? "Confirming..." : isPending ? "Waiting wallet..." : "Ready to execute"}
                </strong>
              </div>
            </div>
            <PriceReferenceNotice warnings={priceWarnings} minimums={quoteMinimums} slippageBps={quoteSlippageBps} stage={staleConsent.stage} remaining={staleConsent.remaining} onApprovalChange={staleConsent.setApproval} onCancel={staleConsent.clear} />
            <DustTradesNotice warnings={priceWarnings} />
            {executionError && (
              <div role="alert" style={{ marginTop: "16px", padding: "12px", borderRadius: "10px", background: "rgba(217, 255, 70, 0.10)", color: "var(--ink)", fontSize: "13px" }}>
                <strong style={{ display: "block", marginBottom: "4px" }}>{executionError === QUOTE_EXPIRED_MESSAGE ? "Quote expired" : "Rebalance needs attention"}</strong>
                <span>{executionError}</span>
                {executionError === QUOTE_EXPIRED_MESSAGE && (
                  <button type="button" onClick={handleExecuteRebalance} disabled={isPending || isConfirming} style={{ display: "block", marginTop: "10px", padding: "6px 10px", border: 0, borderRadius: "6px", background: "var(--accent)", color: "var(--coal)", fontWeight: 700, cursor: "pointer" }}>
                    Get fresh quote
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="drawer-intro">Choose assets and set target weights. Nothing changes until you review and sign.</p>

            {/* 1. Add Stock Token Combobox (On Top) */}
            <div className="rebalance-asset-picker">
              <div className="rebalance-asset-picker-head">
                <span className="rebalance-selection-label">
                  Add Stock Tokens ({selected.length} Selected)
                </span>
                <button
                  type="button"
                  className="equalize-weights-button"
                  onClick={equalizeWeights}
                  disabled={selected.length < 2}
                >
                  <AppIcon type="sync" />
                  Split evenly
                </button>
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
                    {availableAssets.map((asset) => {
                      const isTradeable = asset.tradeable !== false;
                      return (
                        <div
                          key={asset.symbol}
                          onClick={() => isTradeable && addToken(asset.symbol)}
                          title={isTradeable ? undefined : "This asset is not currently enabled for trading on Base mainnet."}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            cursor: isTradeable ? "pointer" : "not-allowed",
                            opacity: isTradeable ? 1 : 0.5,
                            borderBottom: "1px solid var(--line)",
                            transition: "background 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (isTradeable) e.currentTarget.style.background = "var(--panel-2)";
                          }}
                          onMouseLeave={(e) => {
                            if (isTradeable) e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <StockLogo symbol={asset.symbol} size={22} roundedFull />
                            <strong style={{ fontSize: "12px" }}>{asset.symbol}</strong>
                            <small style={{ color: "var(--muted-ink)", fontSize: "11px" }}>{asset.name}</small>
                          </div>
                          {isTradeable ? (
                            <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
                          ) : (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "var(--muted-ink)",
                                background: "var(--panel-2)",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                border: "1px solid var(--panel-border)",
                                fontWeight: 600,
                              }}
                            >
                              Unavailable
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Composition / Target Weight Editor (Below Add Component) */}
            <div className="drawer-weight-editor">
              {selected.map((asset) => {
                const isTradeable = asset.tradeable !== false;
                const isTargetingInoperable = !isTradeable && (targets[asset.symbol] ?? 0) > 0;
                return (
                  <label
                    key={asset.symbol}
                    style={isTargetingInoperable ? { border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: "8px", padding: "8px" } : undefined}
                  >
                    <span>
                      <StockLogo symbol={asset.symbol} size={30} roundedFull />
                      <span>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <strong>{asset.symbol}</strong>
                          {!isTradeable && (
                            <span style={{
                              fontSize: "10px",
                              color: "var(--muted-ink)",
                              background: "var(--panel-2)",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              border: "1px solid var(--panel-border)",
                              fontWeight: 600,
                            }}>
                              Coming Soon!
                            </span>
                          )}
                        </span>
                        <small>Current {formatWeight(basket.holdings.find((h) => h.symbol === asset.symbol)?.target ?? 0)}%</small>
                      </span>
                    </span>
                    <span className="weight-actions">
                      <output style={isTargetingInoperable ? { color: "var(--danger)" } : undefined}>
                        {formatWeight(targets[asset.symbol] ?? 0)}%
                      </output>
                      <button
                        type="button"
                        onClick={() => { clearQuoteNotice(); setTargets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.symbol))); }}
                        disabled={selected.length === 1}
                      >
                        Remove
                      </button>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      disabled={!isTradeable}
                      value={targets[asset.symbol]}
                      onChange={(event) => { clearQuoteNotice(); setTargets((current) => ({ ...current, [asset.symbol]: Number(event.target.value) })); }}
                    />
                  </label>
                );
              })}
            </div>

            <div className={`allocation-total ${total === 100 && !hasInoperableAssets ? "valid" : "invalid"}`}>
              <span>Total allocation</span>
              <strong>{total}%</strong>
              <small>
                {hasInoperableAssets
                  ? `${inoperableAssets.map((a) => a.symbol).join(", ")} cannot be allocated (not operable on Base). Set weight to 0% or remove.`
                  : total === 100
                    ? "Ready to preview"
                    : `Adjust by ${Math.abs(100 - total)}% to continue`}
              </small>
            </div>
          </>
        )}
      </div>


    </Dialog>
  );
}

function AmountDrawer({ basket, kind, onClose }: { basket: Basket; kind: "mint" | "withdraw"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isMint = kind === "mint";
  const { address: userAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const chainConfig = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];
  const usdcAddress = chainConfig?.usdc as `0x${string}` | undefined;
  const moduleAddr = chainConfig?.module as `0x${string}` | undefined;

  const [withdrawInUsdc, setWithdrawInUsdc] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [priceWarnings, setPriceWarnings] = useState<PriceReferenceWarning[]>([]);
  const [quoteMinimums, setQuoteMinimums] = useState<string[]>([]);
  const [quoteSlippageBps, setQuoteSlippageBps] = useState<number | undefined>();
  const isCanonicalLiquidError = isCanonicalLiquidWithdrawalError(actionError, isMint);

  const {
    data: usdcBalanceRaw,
    isLoading: isBalanceLoading,
    isError: isBalanceError,
    refetch: refetchDrawerUsdc,
  } = useWalletUsdcBalance();

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: [{ inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
    functionName: 'allowance',
    args: userAddress && moduleAddr ? [userAddress, moduleAddr] : undefined,
    query: { enabled: Boolean(userAddress && moduleAddr) },
  });

  const [depositAmount, setDepositAmount] = useState<string>(isMint ? "1000" : (basket.value > 0 ? (basket.value * 0.25).toFixed(0) : "1000"));
  const staleConsent = useStalePriceConsent(userAddress, `${basket.address}:${kind}:${depositAmount}:${withdrawInUsdc}`);
  const clearQuoteNotice = () => {
    setPriceWarnings([]);
    setQuoteMinimums([]);
    setQuoteSlippageBps(undefined);
    staleConsent.clear();
  };

  const { isPending: isWritePending, writeContractAsync } = useWriteContract();
  const { isPending: isSendPending, sendTransactionAsync } = useSendTransaction();

  const [activeHash, setActiveHash] = useState<`0x${string}` | null>(null);
  const hash = activeHash;
  const isPending = isWritePending || isSendPending;
  const { isError: isReceiptError, error: receiptError, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });
  useBasketDetails(basket.address, chainId, userAddress, Boolean(isPending || isConfirming || isSuccess));
  useBasketActivity(basket.address, chainId, userAddress, Boolean(isPending || isConfirming || isSuccess));

  const formattedBalance = usdcBalanceRaw !== undefined && userAddress
    ? `${Number(formatUnits(usdcBalanceRaw as bigint, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
    : "Unavailable";

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

  useEffect(() => {
    if (!isReceiptError) return;
    setActionError(userFacingExecutionError(receiptError, "The transaction reverted on-chain."));
    setActiveHash(null);
  }, [isReceiptError, receiptError]);

  const publicClient = usePublicClient();

  const allAssets = useCatalogHoldings();

  const handleExecuteAmountAction = async () => {
    setActionError(null);
    if (!isConnected || !userAddress) {
      alert("Please connect your Web3 wallet first.");
      return;
    }
    if (!chainConfig || !usdcAddress || !moduleAddr) {
      setActionError(`Othelio is not configured for chain ${chainId}.`);
      return;
    }

    if (isMint) {
      try {
        if (!(chainId in CONTRACT_ADDRESSES)) {
          throw new Error(`Add funds is unavailable on unsupported chain ${chainId}.`);
        }
        const holdingsPayload = basket.holdings.filter((h) => (h.target || 0) > 0).map((h) => ({
          address: h.address || allAssets.find((a) => a.symbol === h.symbol)?.address || "0x0000000000000000000000000000000000000000",
          symbol: h.symbol,
          targetWeightBps: Math.round((h.target || 0) * 100),
        }));
        const inoperableHolding = holdingsPayload.find((h) => {
          const asset = allAssets.find((a) => a.symbol === h.symbol || a.address?.toLowerCase() === h.address.toLowerCase());
          return asset?.tradeable === false;
        });
        if (inoperableHolding) {
          throw new Error(`Basket includes ${inoperableHolding.symbol}, which is not operable on Base mainnet. Please rebalance the basket to tradeable assets before adding funds.`);
        }

        const usdcAmount = parseUnits(depositAmount.trim() || "0", USDC_DECIMALS);
        if (usdcAmount <= BigInt(0)) {
          throw new Error("Enter a USDC amount greater than zero.");
        }
        const amountRaw = usdcAmount.toString();
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
        setPriceWarnings(quote?.warnings ?? []);
        setQuoteMinimums(formatMinimumOutputs(quote?.boughtAssets ?? quote?.rebalance?.boughtAssets ?? (quote?.route?.buyAsset ? [quote.route.buyAsset] : undefined), quote?.minBoughtAmounts?.length ? quote.minBoughtAmounts : quote?.rebalance?.minBoughtAmounts?.length ? quote.rebalance.minBoughtAmounts : quote?.route?.minBuyAmount ? [quote.route.minBuyAmount] : []));
        setQuoteSlippageBps(quote?.slippageBps);
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
        const consented = await staleConsent.authorize(quote?.warnings ?? [], staleQuoteFingerprint(quote?.warnings ?? [], quote ?? {}), plan.expiresAt);
        if (!consented) return;
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
          setActionError("Allowance set. Review the fresh quote, then confirm the trade.");
          return;
        }
        if (moduleAddr && moduleAddr !== '0x0000000000000000000000000000000000000000') {
          try {
            if (quote?.inputAsset?.toLowerCase() !== usdcAddress.toLowerCase() || quote.inputAmount !== amountRaw) {
              throw new Error("The simulated funding plan no longer matches the requested input amount.");
            }
            const decodedFunding = decodeFunctionData({
              abi: OTHELIO_PORTFOLIO_MODULE_ABI,
              data: call.calldata as `0x${string}`,
            });
            if (decodedFunding.functionName !== "fundAerodromePortfolio") {
              throw new Error("The funding quote returned an unexpected module call.");
            }
            const encodedFundingAmount = (decodedFunding.args as readonly unknown[])[2] as bigint;
            if (encodedFundingAmount !== usdcAmount) {
              throw new Error(`Funding calldata amount mismatch: expected ${amountRaw} USDC base units, received ${encodedFundingAmount.toString()}.`);
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
        setActionError(userFacingExecutionError(err, "The funding action could not be prepared."));
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
        // The drawer amount is entered in USDC (6 decimals), while the quote
        // planner accepts the requested USD value in 8 decimal fixed point.
        const withdrawValueUsdE8 = (toRawAmount(depositAmount || "0", USDC_DECIMALS) * BigInt(100)).toString();
        const res = await fetchSwapQuote(basket.address, {
          action: 'withdraw',
          chainId,
          moduleAddress: moduleAddr,
          callerAddress: userAddress,
          recipientAddress: userAddress,
          withdrawValueUsdE8,
        });
        const quote = res.data;
        setPriceWarnings(quote?.warnings ?? []);
        setQuoteMinimums(formatMinimumOutputs(quote?.boughtAssets ?? quote?.rebalance?.boughtAssets ?? (quote?.route?.buyAsset ? [quote.route.buyAsset] : undefined), quote?.minBoughtAmounts?.length ? quote.minBoughtAmounts : quote?.rebalance?.minBoughtAmounts?.length ? quote.rebalance.minBoughtAmounts : quote?.route?.minBuyAmount ? [quote.route.minBuyAmount] : []));
        setQuoteSlippageBps(quote?.slippageBps);
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
        const consented = await staleConsent.authorize(quote?.warnings ?? [], staleQuoteFingerprint(quote?.warnings ?? [], quote ?? {}), plan.expiresAt);
        if (!consented) return;
        const withdrawTx = await sendTransactionAsync({
          to: call.to as `0x${string}`,
          data: call.calldata as `0x${string}`,
          value: BigInt(call.valueBaseUnits),
        });
        setActiveHash(withdrawTx);
      } catch (err) {
        const message = userFacingExecutionError(err, "The in-kind withdrawal could not be prepared.");
        if (!isCanonicalLiquidWithdrawalError(message, isMint)) {
          console.error("Withdrawal execution error:", err);
        }
        setActionError(message);
      }
    }
  };

  return (
    <Dialog open onClose={onClose} title={isMint ? "Add funds" : "Withdraw funds"} description={basket.name} kind="sheet" size="wide" footer={<div className="transaction-actions">
        {isSuccess ? (
          <button className="ui-button" style={{ width: "100%" }} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="ui-button" data-variant="secondary" onClick={onClose}>Cancel</button>
            <button className="ui-button" disabled={isPending || isConfirming || staleConsent.remaining > 0 || Boolean(staleConsent.stage?.mode === 'warn' && !staleConsent.stage.approved) || staleConsent.stage?.mode === 'reject'} onClick={handleExecuteAmountAction}>
              {isConfirming ? "Waiting for confirmation…" : isPending ? "Waiting for wallet…" : staleConsent.stage && (staleConsent.stage.mode === 'warn' ? staleConsent.stage.approved : staleConsent.stage.mode === 'allow' ? staleConsent.remaining === 0 : false) ? "Confirm trade" : priceWarnings.some((warning) => warning.code === "STALE_PRICE_REFERENCE") ? "Review stale quote" : "Confirm in wallet"} <AppIcon type="arrow" />
            </button>
          </>
        )}
      </div>}>
      <div className="transaction-drawer-content">


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

            <label
              className="amount-field drawer-amount-field"
              style={{
                border: isCanonicalLiquidError ? "1px solid #ef4444" : "none",
                boxShadow: isCanonicalLiquidError ? "0 0 0 3px rgba(239, 68, 68, 0.12)" : "none",
                outline: "none",
              }}
            >
              <span>{isMint ? "You deposit" : "Withdrawal Amount"}</span>
              <div>
                <input
                  inputMode="decimal"
                  value={depositAmount}
                  aria-invalid={isCanonicalLiquidError}
                  onChange={(e) => {
                    clearQuoteNotice();
                    setDepositAmount(e.target.value);
                    if (actionError) setActionError(null);
                  }}
                  style={{
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    ...(isCanonicalLiquidError ? { color: "#ef4444" } : {}),
                  }}
                />
                <b>USDC</b>
              </div>
              <small>
                {isMint
                  ? `Available: ${isBalanceLoading ? "Loading..." : isBalanceError ? "Unavailable" : formattedBalance}`
                  : `Basket Value: $${basket.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </small>
              {isCanonicalLiquidError && (
                <small role="alert" style={{ display: "block", marginTop: "8px", color: "#ef4444", fontWeight: 700 }}>
                  {actionError}
                </small>
              )}
            </label>

            {/* Quick Percentage Presets for Withdrawal */}
            {!isMint && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", margin: "12px 0 16px" }}>
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      clearQuoteNotice();
                      setDepositAmount(Math.round(basket.value * (pct / 100)).toString());
                      if (actionError) setActionError(null);
                    }}
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
                  onClick={() => { clearQuoteNotice(); setWithdrawInUsdc(!withdrawInUsdc); }}
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
              {isMint && (
                <div>
                  <span>DEX Route Optimization</span>
                  <strong style={{ color: "#10b981", fontSize: "12px" }}>
                    Best rate via 0x / Aerodrome
                  </strong>
                </div>
              )}
              <div>
                <span>Est. Network Gas Fee</span>
                <strong>~$0.04 (Base L2)</strong>
              </div>
              {isMint && (
                <div>
                  <span>Max Slippage Tolerance</span>
                  <strong>0.5%</strong>
                </div>
              )}
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
            <PriceReferenceNotice warnings={priceWarnings} minimums={quoteMinimums} slippageBps={quoteSlippageBps} stage={staleConsent.stage} remaining={staleConsent.remaining} onApprovalChange={staleConsent.setApproval} onCancel={staleConsent.clear} />
            <DustTradesNotice warnings={priceWarnings} />
            {actionError && !isCanonicalLiquidError && (
              <div role="alert" style={{ marginTop: "16px", padding: "12px", borderRadius: "10px", background: "rgba(217, 255, 70, 0.10)", color: "var(--ink)", fontSize: "13px" }}>
                <strong style={{ display: "block", marginBottom: "4px" }}>{actionError === QUOTE_EXPIRED_MESSAGE ? "Quote expired" : "Transaction needs attention"}</strong>
                <span>{actionError}</span>
                {actionError === QUOTE_EXPIRED_MESSAGE && (
                  <button type="button" onClick={handleExecuteAmountAction} disabled={isPending || isConfirming} style={{ display: "block", marginTop: "10px", padding: "6px 10px", border: 0, borderRadius: "6px", background: "var(--accent)", color: "var(--coal)", fontWeight: 700, cursor: "pointer" }}>
                    Get fresh quote
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

    </Dialog>
  );
}
