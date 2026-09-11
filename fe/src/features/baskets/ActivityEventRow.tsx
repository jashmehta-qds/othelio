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
  if (!/^\d+$/.test(String(amount))) return { symbol, quantity: "Unknown", usd: null };
  const quantity = Number(formatUnits(BigInt(String(amount)), symbol === "USDC" ? 6 : 18));
  return {
    symbol,
    quantity: quantity.toLocaleString("en-US", { maximumFractionDigits: 6 }),
    usd: asset && assetPrices[symbol] ? quantity * assetPrices[symbol] : null,
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
      {isNew && <span className="activity-new-token">New position</span>}
      {movement.usd !== null && <small>≈ ${movement.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>}
    </div>;
  });

  if (["CREATED", "BASKETCREATED"].includes(type)) return <div className="activity-detail-body"><p>Basket Safe created for {formatAddress(event.actor_address)}.</p></div>;
  return <div className="activity-detail-body">
    {isFund && payload.inputAmount ? <p>{(Number(payload.inputAmount) / 1e6).toLocaleString()} USDC allocated into:</p> : null}
    {isFund && lines(boughtAssets, boughtAmounts, "in")}
    {isRebalance && <p>Portfolio movement</p>}
    {isRebalance && lines(assetsFor("soldAssets"), amountsFor("soldAmounts"), "out")}
    {isRebalance && lines(boughtAssets, boughtAmounts, "in")}
    {isWithdraw && <p>{assetsFor("withdrawnAssets").length === 1 && tokenMovement(assetsFor("withdrawnAssets")[0], amountsFor("withdrawnAmounts")[0]).symbol === "USDC" ? "Delivered as USDC" : "Delivered in kind to the recipient wallet"}</p>}
    {isWithdraw && lines(assetsFor("withdrawnAssets"), amountsFor("withdrawnAmounts"), "out")}
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
