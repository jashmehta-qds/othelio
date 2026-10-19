import { formatUnits } from "viem";
import { formatAddress, formatEventLabel, formatEventMetadata, supportedAssets, type BasketActivity } from "@/lib/baskets";
import StockLogo from "@/components/StockLogo";
import { networkLabelForChainId } from "@/lib/network";
import { allocationChangesForActivity, type ActivityAllocationChange } from "./activityAllocation";
import { formatActivityTime } from "./activityTime";

function payloadOf(event: BasketActivity): Record<string, unknown> {
  if (typeof event.payload === "string") {
    try { return JSON.parse(event.payload); } catch { return {}; }
  }
  return event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
}

function tokenMovement(address: unknown, amount: unknown) {
  const addrStr = String(address).toLowerCase();
  const asset = supportedAssets.find((item) => item.address?.toLowerCase() === addrStr);
  const symbol = asset?.symbol ?? formatAddress(String(address));
  if (!/^\d+$/.test(String(amount))) return { address: addrStr, symbol, quantity: "Unknown", quantityValue: null };
  const isB20 = addrStr.startsWith("0xb200000000000000000000") || symbol.endsWith("c");
  const decimals = isB20 ? 8 : (symbol === "USDC" ? 6 : 18);
  const quantity = Number(formatUnits(BigInt(String(amount)), decimals));
  return {
    address: addrStr,
    symbol,
    quantity: quantity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
    quantityValue: quantity,
  };
}

type ExecutionRoute = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  inputOracleValueUsdc: number | null;
  outputOracleValueUsdc: number | null;
  executionCostUsdc: number | null;
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function executionRoutes(payload: Record<string, unknown>): ExecutionRoute[] {
  if (!Array.isArray(payload.executionRoutes)) return [];
  return payload.executionRoutes.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const route = candidate as Record<string, unknown>;
    if (typeof route.tokenIn !== "string" || typeof route.tokenOut !== "string"
      || !/^\d+$/.test(String(route.amountIn)) || !/^\d+$/.test(String(route.amountOut))) return [];
    return [{
      tokenIn: route.tokenIn.toLowerCase(),
      tokenOut: route.tokenOut.toLowerCase(),
      amountIn: String(route.amountIn),
      amountOut: String(route.amountOut),
      inputOracleValueUsdc: finiteNumber(route.inputOracleValueUsdc),
      outputOracleValueUsdc: finiteNumber(route.outputOracleValueUsdc),
      executionCostUsdc: finiteNumber(route.executionCostUsdc),
    }];
  });
}

function routeForMovement(routes: ExecutionRoute[], address: unknown, amount: unknown, direction: "in" | "out", index: number) {
  const addressKey = String(address).toLowerCase();
  const amountKey = String(amount);
  const aligned = routes[index];
  const routeMatches = (route: ExecutionRoute) => direction === "in"
    ? route.tokenOut === addressKey && route.amountOut === amountKey
    : route.tokenIn === addressKey && route.amountIn === amountKey;
  return aligned && routeMatches(aligned) ? aligned : routes.find(routeMatches) ?? null;
}

function executionDisplay(route: ExecutionRoute | null, direction: "in" | "out") {
  if (!route) return { rate: null, valueUsd: null };
  const input = tokenMovement(route.tokenIn, route.amountIn);
  const output = tokenMovement(route.tokenOut, route.amountOut);
  const quantity = direction === "in" ? output.quantityValue : input.quantityValue;
  const counterpartyValueUsd = direction === "in" ? route.inputOracleValueUsdc : route.outputOracleValueUsdc;
  const exactUsdcValue = direction === "in" && input.symbol === "USDC" ? input.quantityValue
    : direction === "out" && output.symbol === "USDC" ? output.quantityValue
      : null;
  const valueUsd = exactUsdcValue ?? counterpartyValueUsd;
  const rate = quantity && valueUsd !== null ? valueUsd / quantity : null;
  return {
    rate: rate !== null && Number.isFinite(rate)
      ? `$${rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null,
    valueUsd,
  };
}

function recordedSlippageBps(payload: Record<string, unknown>): number | null {
  const candidate = payload.maxSlippageBps ?? payload.slippageBps;
  const bps = typeof candidate === "number" ? candidate : Number(candidate);
  return Number.isInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : null;
}

function priorAssets(events: BasketActivity[]) {
  const seen = new Set<string>();
  events.forEach((event) => {
    const payload = payloadOf(event);
    ["boughtAssets", "acquiredAssets"].forEach((key) => {
      if (Array.isArray(payload[key])) payload[key].forEach((asset) => seen.add(String(asset).toLowerCase()));
    });
  });
  return seen;
}

function formatAllocationPercent(weightBps: number) {
  return `${(weightBps / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function ActivityAllocation({ changes, sourceAmount }: { changes: ActivityAllocationChange[]; sourceAmount?: string }) {
  return <section className="activity-allocation">
    {sourceAmount && <div className="activity-allocation-row activity-allocation-source">
      <StockLogo symbol="USDC" size={16} roundedFull />
      <strong>{sourceAmount} USDC</strong>
      <span aria-hidden="true">→</span>
    </div>}
    {changes.map(({ assetAddress, previousWeightBps, weightBps }) => {
      const symbol = supportedAssets.find((asset) => asset.address?.toLowerCase() === assetAddress.toLowerCase())?.symbol ?? formatAddress(assetAddress);
      const isNew = (previousWeightBps === null || previousWeightBps === 0) && weightBps > 0;
      const isExited = previousWeightBps !== null && weightBps === 0;
      return <div className={`activity-allocation-row${isNew ? " is-new" : isExited ? " is-exited" : ""}`} key={assetAddress.toLowerCase()}>
        <StockLogo symbol={symbol} address={assetAddress} size={16} roundedFull />
        <strong>{symbol}</strong>
        {previousWeightBps === null
          ? <strong className="activity-allocation-terminal">{formatAllocationPercent(weightBps)}</strong>
          : <span className="activity-allocation-change">
            <span>{formatAllocationPercent(previousWeightBps)}</span>
            <span aria-hidden="true">→</span>
            <strong>{formatAllocationPercent(weightBps)}</strong>
          </span>}
      </div>;
    })}
  </section>;
}

function ActivityDetails({ event, olderEvents }: { event: BasketActivity; olderEvents: BasketActivity[] }) {
  const type = event.eventType.toUpperCase();
  const payload = payloadOf(event);
  const seen = priorAssets(olderEvents);
  const isFund = ["FUNDED", "BASKETFUNDED", "MINTED", "DEPOSIT"].includes(type);
  const isRebalance = ["WEIGHTS_UPDATED", "REBALANCED", "BASKETREBALANCED"].includes(type);
  const isWithdraw = ["WITHDRAWN", "BASKETWITHDRAWN", "WITHDRAW"].includes(type);
  const assetsFor = (key: string, alias?: string) => Array.isArray(payload[key]) ? payload[key] as unknown[] : alias && Array.isArray(payload[alias]) ? payload[alias] as unknown[] : [];
  const amountsFor = (key: string, alias?: string) => Array.isArray(payload[key]) ? payload[key] as unknown[] : alias && Array.isArray(payload[alias]) ? payload[alias] as unknown[] : [];
  const boughtAssets = assetsFor("boughtAssets", "acquiredAssets");
  const boughtAmounts = amountsFor("boughtAmounts", "acquiredAmounts");
  const routes = executionRoutes(payload);
  const targetWeights = Array.isArray(payload.targetWeights)
    ? payload.targetWeights.filter((item): item is { assetAddress: string; weightBps: number } =>
      Boolean(item && typeof item === "object" && typeof item.assetAddress === "string" && typeof item.weightBps === "number"))
    : [];
  const rebalanceAllocationChanges = allocationChangesForActivity(payload, olderEvents.map(payloadOf));
  const fundedAllocation = targetWeights.map(({ assetAddress, weightBps }) => ({
    assetAddress,
    weightBps,
    previousWeightBps: null,
  }));
  const fundedUsdc = isFund && payload.inputAmount
    ? (Number(payload.inputAmount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const targetSummary = targetWeights.map(({ assetAddress, weightBps }) => {
    const symbol = supportedAssets.find((asset) => asset.address?.toLowerCase() === assetAddress.toLowerCase())?.symbol ?? formatAddress(assetAddress);
    return `${symbol} ${(weightBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  }).join(" · ");

  const lines = (assets: unknown[], amounts: unknown[], direction: "in" | "out") => assets.map((address, index) => {
    const movement = tokenMovement(address, amounts[index]);
    const isNew = isRebalance && direction === "in" && !seen.has(String(address).toLowerCase());
    const execution = executionDisplay(routeForMovement(routes, address, amounts[index], direction, index), direction);
    return <div className="activity-detail-line" key={`${String(address)}-${index}`}>
      <span className={`activity-move ${direction}`}>{direction === "in" ? "Received" : "Sent"}</span>
      <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><StockLogo symbol={movement.symbol} size={18} roundedFull />{movement.quantity} {movement.symbol}</strong>
      {execution.rate ? <span style={{ color: "var(--muted-ink)", fontSize: "11px" }}>@ {execution.rate}</span> : (isNew ? <span className="activity-new-token">New position</span> : <span />)}
      <span style={{ textAlign: "right", color: "var(--muted-ink)", fontSize: "11px" }}>
        {execution.valueUsd === null
          ? "—"
          : `≈ $${execution.valueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </span>
    </div>;
  });

  if (["CREATED", "BASKETCREATED"].includes(type)) return <div className="activity-detail-body"><p>Basket Safe created for {formatAddress(event.actorAddress || "")}.</p>{targetSummary && <p>Target: {targetSummary}</p>}</div>;

  // This is deliberately not called a fee: reference-value deltas can include
  // LP fees, price impact, and movement between the quote and execution.
  const routeCosts = routes.map((route) => route.executionCostUsdc);
  const executionCostUsd = routeCosts.length > 0 && routeCosts.every((cost): cost is number => cost !== null)
    ? Math.max(0, routeCosts.reduce((total, cost) => total + cost, 0))
    : null;
  const maxSlippageBps = recordedSlippageBps(payload);

  return <div className="activity-detail-body">
    {isFund && fundedAllocation.length > 0 && <ActivityAllocation changes={fundedAllocation} sourceAmount={fundedUsdc ?? undefined} />}
    {isFund && lines(boughtAssets, boughtAmounts, "in")}
    {isRebalance && rebalanceAllocationChanges.length > 0 && <ActivityAllocation changes={rebalanceAllocationChanges} />}

    {isRebalance && lines(assetsFor("soldAssets"), amountsFor("soldAmounts"), "out")}
    {isRebalance && lines(boughtAssets, boughtAmounts, "in")}

    {isWithdraw && lines(assetsFor("withdrawnAssets"), amountsFor("withdrawnAmounts"), "out")}

    {(isFund || isRebalance) && (
      <div className="activity-detail-line">
        <span className="activity-move" style={{ color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
          Tx cost
          <div style={{ position: "relative", display: "inline-flex", cursor: "pointer" }} className="has-tooltip">
            <span
              style={{
                width: "13px",
                height: "13px",
                borderRadius: "50%",
                background: "rgba(255,255,255,0.12)",
                color: "var(--ink)",
                fontSize: "9px",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ⓘ
            </span>
            <div
              className="tooltip-box"
              style={{
                position: "absolute",
                bottom: "140%",
                left: "0",
                transform: "translateX(-20%)",
                width: "210px",
                padding: "8px 10px",
                background: "#18191c",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                color: "var(--ink)",
                fontSize: "11px",
                lineHeight: "1.45",
                visibility: "hidden",
                opacity: 0,
                transition: "all 0.15s ease",
                zIndex: 999,
                pointerEvents: "none",
                whiteSpace: "normal",
                fontWeight: 400,
                textAlign: "left",
              }}
            >
              <div>Reference-value difference between assets sent and received.</div>
              <div style={{ color: "var(--muted-ink)", marginTop: "2px" }}>May include Aerodrome pool fees, price impact, and quote-to-execution movement.</div>
              <div style={{ color: "var(--muted-ink)", marginTop: "2px" }}>
                {maxSlippageBps === null
                  ? "Maximum slippage was not recorded for this transaction."
                  : `Maximum slippage: ${(maxSlippageBps / 100).toFixed(2)}% — a limit, not a fee.`}
              </div>
              <div style={{ color: "var(--muted-ink)", marginTop: "2px" }}>Network gas excluded.</div>
            </div>
          </div>
        </span>
        <span />
        <span />
        <span style={{ textAlign: "right", color: "var(--muted-ink)", fontSize: "11px" }}>
          {executionCostUsd === null
            ? "Unavailable"
            : `$${executionCostUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </span>
      </div>
    )}
  </div>;
}

export function ActivityEventRow({ event, basketSymbol, olderEvents = [], full = false }: { event: BasketActivity; basketSymbol?: string; olderEvents?: BasketActivity[]; full?: boolean }) {
  const meta = formatEventMetadata(event);
  return <details className={`activity-event ${full ? "full" : "compact"}`}>
    <summary className="activity-row">
      <span className="activity-time"><time dateTime={event.occurredAt} title={event.occurredAt}>{formatActivityTime(event.occurredAt)}</time></span>
      {full && <span className="activity-basket" title={event.basketAddress}>{basketSymbol ?? "Unknown basket"}</span>}
      <span className="activity-operation"><strong>{formatEventLabel(event.eventType)}</strong></span>
      <span className="activity-amount">{meta.amountText && <strong className={meta.isPositive ? "positive" : meta.isPositive === false ? "negative" : ""}>{meta.amountText}</strong>}<small><a
        href={`https://basescan.org/tx/${event.txHash}`}
        target="_blank"
        rel="noreferrer"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
      >{formatAddress(event.txHash)}</a>{event.chainId ? ` · ${networkLabelForChainId(Number(event.chainId))}` : ""}</small></span>
      <span className="activity-row-state">{event.blockNumber ? "Confirmed" : "Pending"}<svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4" /></svg></span>
    </summary>
    <ActivityDetails event={event} olderEvents={olderEvents} />
  </details>;
}
