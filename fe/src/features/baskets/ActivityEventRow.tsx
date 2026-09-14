import { formatUnits } from "viem";
import { assetPrices, formatAddress, formatEventLabel, formatEventMetadata, supportedAssets, type BasketActivity } from "@/lib/baskets";

function payloadOf(event: BasketActivity): Record<string, unknown> {
  if (typeof event.payload === "string") {
    try { return JSON.parse(event.payload); } catch { return {}; }
  }
  return event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
}

function tokenMovement(address: unknown, amount: unknown) {
  const asset = supportedAssets.find((item) => item.address?.toLowerCase() === String(address).toLowerCase());
  const symbol = asset?.symbol ?? formatAddress(String(address));
  if (!/^\d+$/.test(String(amount))) return { symbol, quantity: "Unknown", priceFormatted: null, usd: null };
  const quantity = Number(formatUnits(BigInt(String(amount)), symbol === "USDC" ? 6 : 18));
  const price = asset ? (assetPrices[symbol] ?? null) : (symbol === "USDC" ? 1 : null);
  const priceFormatted = price ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  return {
    symbol,
    quantity: quantity.toLocaleString("en-US", { maximumFractionDigits: 6 }),
    priceFormatted,
    usd: price ? quantity * price : null,
  };
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

function ActivityDetails({ event, olderEvents }: { event: BasketActivity; olderEvents: BasketActivity[] }) {
  const type = event.event_type.toUpperCase();
  const payload = payloadOf(event);
  const seen = priorAssets(olderEvents);
  const isFund = ["FUNDED", "BASKETFUNDED", "MINTED", "DEPOSIT"].includes(type);
  const isRebalance = ["WEIGHTS_UPDATED", "REBALANCED", "BASKETREBALANCED"].includes(type);
  const isWithdraw = ["WITHDRAWN", "BASKETWITHDRAWN", "WITHDRAW"].includes(type);
  const assetsFor = (key: string, alias?: string) => Array.isArray(payload[key]) ? payload[key] as unknown[] : alias && Array.isArray(payload[alias]) ? payload[alias] as unknown[] : [];
  const amountsFor = (key: string, alias?: string) => Array.isArray(payload[key]) ? payload[key] as unknown[] : alias && Array.isArray(payload[alias]) ? payload[alias] as unknown[] : [];
  const boughtAssets = assetsFor("boughtAssets", "acquiredAssets");
  const boughtAmounts = amountsFor("boughtAmounts", "acquiredAmounts");

  const lines = (assets: unknown[], amounts: unknown[], direction: "in" | "out") => assets.map((address, index) => {
    const movement = tokenMovement(address, amounts[index]);
    const isNew = isRebalance && direction === "in" && !seen.has(String(address).toLowerCase());
    return <div className="activity-detail-line" key={`${String(address)}-${index}`}>
      <span className={`activity-move ${direction}`}>{direction === "in" ? "Received" : "Sent"}</span>
      <strong>{movement.quantity} {movement.symbol}</strong>
      {movement.priceFormatted ? <span style={{ color: "var(--muted-ink)", fontSize: "11px" }}>@ ${movement.priceFormatted}</span> : (isNew ? <span className="activity-new-token">New position</span> : <span />)}
      {movement.usd !== null && <span style={{ textAlign: "right", color: "var(--muted-ink)", fontSize: "11px" }}>≈ ${movement.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
    </div>;
  });

  if (["CREATED", "BASKETCREATED"].includes(type)) return <div className="activity-detail-body"><p>Basket Safe created for {formatAddress(event.actor_address)}.</p></div>;

  const redeemedUsd = payload.navRedeemed ? Number(payload.navRedeemed) / 1e6 : (payload.remainingNAV ? Number(payload.remainingNAV) / 1e6 : null);
  const isDeliveredUsdc = assetsFor("withdrawnAssets").length === 1 && tokenMovement(assetsFor("withdrawnAssets")[0], amountsFor("withdrawnAmounts")[0]).symbol === "USDC";

  const totalInputUsd = payload.inputAmount ? Number(payload.inputAmount) / 1e6 : null;
  const aerodromeSwapFee = totalInputUsd ? totalInputUsd * 0.005 : null;

  return <div className="activity-detail-body">
    {isFund && payload.inputAmount ? <p>Paid ${(Number(payload.inputAmount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC allocated into target assets:</p> : null}
    {isFund && lines(boughtAssets, boughtAmounts, "in")}

    {isRebalance && <p>Portfolio rebalance movement:</p>}
    {isRebalance && lines(assetsFor("soldAssets"), amountsFor("soldAmounts"), "out")}
    {isRebalance && lines(boughtAssets, boughtAmounts, "in")}

    {isWithdraw && (
      <p>
        {isDeliveredUsdc
          ? `Withdrawal redeemed for ${redeemedUsd !== null ? `$${redeemedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC` : "USDC"}`
          : `Assets redeemed and delivered to wallet${redeemedUsd !== null ? ` ($${redeemedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total NAV)` : ""}:`}
      </p>
    )}
    {isWithdraw && lines(assetsFor("withdrawnAssets"), amountsFor("withdrawnAmounts"), "out")}

    {(isFund || isRebalance) && (
      <div className="activity-detail-line">
        <span className="activity-move" style={{ color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
          Fees
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
              <div>Swap fees charged by Aerodrome.</div>
              <div style={{ color: "var(--muted-ink)", marginTop: "2px" }}>Othelio platform fee: $0.00</div>
              <div style={{ color: "var(--muted-ink)", marginTop: "2px" }}>Gas Excluded</div>
            </div>
          </div>
        </span>
        <span />
        <span />
        <span style={{ textAlign: "right", color: "var(--muted-ink)", fontSize: "11px" }}>
          ${(aerodromeSwapFee ?? 1.88).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
    )}
  </div>;
}

export function ActivityEventRow({ event, basketSymbol, olderEvents = [], full = false }: { event: BasketActivity; basketSymbol?: string; olderEvents?: BasketActivity[]; full?: boolean }) {
  const meta = formatEventMetadata(event);
  return <details className={`activity-event ${full ? "full" : "compact"}`}>
    <summary className="activity-row">
      <span className="activity-time">{event.block_number ? `Block ${full ? "#" : ""}${event.block_number}` : "Pending index"}</span>
      {full && <span className="activity-basket" title={event.basket_address}>{basketSymbol ?? "Unknown basket"}</span>}
      <span className="activity-operation"><strong>{formatEventLabel(event.event_type)}</strong><small>{full ? `Safe: ${formatAddress(event.basket_address || "")} · Actor: ${formatAddress(event.actor_address)}` : formatAddress(event.actor_address)}</small></span>
      <span className="activity-amount">{meta.amountText && <strong className={meta.isPositive ? "positive" : meta.isPositive === false ? "negative" : ""}>{meta.amountText}</strong>}<small>{formatAddress(event.tx_hash)}{Number(event.chain_id) === 31337 ? " · Anvil" : ""}</small></span>
      <span className="activity-row-state">{event.block_number ? "Confirmed" : "Pending"}<svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4" /></svg></span>
    </summary>
    <ActivityDetails event={event} olderEvents={olderEvents} />
  </details>;
}
