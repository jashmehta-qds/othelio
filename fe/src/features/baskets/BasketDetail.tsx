"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId } from "wagmi";
import AllocationSankey from "@/components/AllocationSankey";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { asset30dChanges, formatAddress, supportedAssets, type Basket, type BasketActivity, type Holding } from "@/lib/baskets";
import { useBasketDetails, useBasketActivity, type IndexedHolding } from "@/hooks/useBaskets";
import { BasketDrawer, type BasketAction } from "./BasketDrawer";
import { BasketLogo } from "./BasketLogo";
import { PortfolioDrift } from "./PortfolioDrift";
import { ActivityEventRow } from "./ActivityEventRow";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";
import { networkLabelForChainId } from "@/lib/network";
import { deriveBasketDetailState } from "./basket-detail-state";

const USDC_MICRO_DECIMALS = 6;

function decimalStringParts(rawAmount: string): { value: bigint; fractionalDigits: number } | null {
  const normalized = rawAmount.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fractional = ''] = unsigned.split('.');
  const digits = `${whole}${fractional}`.replace(/^0+(?=\d)/, '');
  const value = BigInt(digits || '0');
  return { value: negative ? -value : value, fractionalDigits: fractional.length };
}

function displayUsdcMicro(rawAmount: string | null): number | null {
  if (rawAmount === null) return null;
  const parsed = decimalStringParts(rawAmount);
  return parsed
    ? Number(formatUnits(parsed.value, USDC_MICRO_DECIMALS + parsed.fractionalDigits))
    : null;
}

function displayAverageCost(rawMicroPerToken: string | null): number | null {
  if (rawMicroPerToken === null) return null;
  const parsed = decimalStringParts(rawMicroPerToken);
  if (!parsed) return null;
  return Number(formatUnits(parsed.value, USDC_MICRO_DECIMALS + parsed.fractionalDigits));
}

function formatUsdPrice(val: number): string {
  if (!Number.isFinite(val) || val === 0) return "$0.00";
  const absVal = Math.abs(val);
  const maxDigits = absVal < 0.0001 ? 8 : absVal < 0.01 ? 6 : 2;
  return `${val < 0 ? "-" : ""}$${absVal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDigits,
  })}`;
}

export function BasketDetail({ basket: fallbackBasket, initialAction = null }: { basket: Basket; initialAction?: BasketAction }) {
  const defaultChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
  const chainId = useChainId() || defaultChainId;
  const { address, isConnected } = useAccount();
  const isWalletRestoring = useWalletRestoring();
  const [action, setAction] = useState<BasketAction>(initialAction);
  const { data: apiDetails, isLoading: isBasketDetailsLoading, isError: isBasketDetailsError } = useBasketDetails(fallbackBasket.address, chainId, isConnected ? address : undefined);
  const detail = apiDetails?.data;
  const canManageBasket = Boolean(detail?.summary.controller && detail.summary.controller.toLowerCase() === address?.toLowerCase());
  const { data: fetchedActivity } = useBasketActivity(fallbackBasket.address, chainId, isConnected ? address : undefined);
  const apiActivity = fetchedActivity;

  const basketDetailState = deriveBasketDetailState({
    isWalletRestoring,
    isConnected,
    isLoading: isBasketDetailsLoading,
    isError: isBasketDetailsError,
    isIndexed: Boolean(detail),
  });
  const apiEvents: BasketActivity[] = (apiActivity?.data ?? []).map((evt) => ({
    eventType: evt.eventType === "FUNDED" ? "BasketFunded" : evt.eventType === "CREATED" ? "BasketCreated" : evt.eventType,
    actorAddress: evt.actorAddress || "Wallet execution",
    txHash: evt.txHash,
    chainId: evt.chainId,
    basketAddress: evt.basketAddress,
    logIndex: evt.logIndex,
    blockNumber: evt.blockNumber ? Number(evt.blockNumber) : undefined,
    blockHash: evt.blockHash,
    payload: evt.payload,
    occurredAt: evt.occurredAt,
  }));

  const combinedEvents = apiEvents;
  const events = combinedEvents.filter((evt, idx, self) => {
    const normType = evt.eventType.toLowerCase();
    const normHash = (evt.txHash || "").toLowerCase();
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    return idx === self.findIndex((other) => {
      const otherHash = (other.txHash || "").toLowerCase();
      const otherType = other.eventType.toLowerCase();
      if (normHash && normHash !== zeroHash && normHash === otherHash && normType === otherType) {
        return true;
      }
      if (
        (normType === "basketcreated" || normType === "created") &&
        (otherType === "basketcreated" || otherType === "created")
      ) {
        return true;
      }
      return false;
    });
  }).sort((a, b) => {
    const blockA = a.blockNumber ? Number(a.blockNumber) : 0;
    const blockB = b.blockNumber ? Number(b.blockNumber) : 0;
    if (blockA !== blockB) return blockB - blockA;
    return new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime();
  });

  const positionHoldings: Holding[] = (detail?.holdings ?? []).map((holding: IndexedHolding) => {
    const quantity = Number(formatUnits(BigInt(holding.quantityBaseUnits), holding.decimals));
    const value = holding.valueUsdcMicro === null ? 0 : Number(holding.valueUsdcMicro) / 1e6;
    const target = (detail?.targets ?? []).find((targetAsset) => targetAsset.assetAddress.toLowerCase() === holding.assetAddress.toLowerCase());
    const symbol = holding.symbol ?? supportedAssets.find((asset) => asset.address?.toLowerCase() === holding.assetAddress.toLowerCase())?.symbol ?? formatAddress(holding.assetAddress);
    const metadata = supportedAssets.find((asset) => asset.address?.toLowerCase() === holding.assetAddress.toLowerCase());
    return {
      symbol,
      name: metadata?.name || symbol,
      address: holding.assetAddress,
      target: (target?.targetWeightBps ?? 0) / 100,
      current: (holding.currentWeightBps ?? 0) / 100,
      quantity,
      value,
      color: metadata?.color || "#8aa4ff",
    };
  });
  const targetOnlyHoldings: Holding[] = (detail?.targets ?? []).filter((target) =>
    !(detail?.holdings ?? []).some((holding) => holding.assetAddress.toLowerCase() === target.assetAddress.toLowerCase()))
    .map((target) => {
      const metadata = supportedAssets.find((asset) => asset.address?.toLowerCase() === target.assetAddress.toLowerCase());
      const symbol = metadata?.symbol ?? formatAddress(target.assetAddress);
      return {
        symbol,
        name: metadata?.name ?? symbol,
        address: target.assetAddress,
        target: target.targetWeightBps / 100,
        current: 0,
        quantity: 0,
        value: 0,
        color: metadata?.color ?? "#8aa4ff",
      };
    });
  const mappedIndexedHoldings = [...positionHoldings, ...targetOnlyHoldings];

  const holdingsCalculated = (detail?.holdings ?? []).map((indexedHolding) => {
    const h = mappedIndexedHoldings.find((holding) => holding.address?.toLowerCase() === indexedHolding.assetAddress.toLowerCase());
    if (!h) return null;
    const priceFromE8 = indexedHolding.priceUsdE8 != null ? Number(BigInt(indexedHolding.priceUsdE8)) / 1e8 : null;
    const tokenPrice = priceFromE8 ?? (h.quantity > 0 ? h.value / h.quantity : 0);
    const assetValue = h.value;
    const averageCost = indexedHolding.averageCostUsdcMicroPerBaseUnit === null ? null : displayAverageCost(indexedHolding.averageCostUsdcMicroPerBaseUnit);
    const unrealisedPnl = indexedHolding.unrealizedPnlUsdcMicro === null ? null : displayUsdcMicro(indexedHolding.unrealizedPnlUsdcMicro);
    return {
      ...h,
      quantity: h.quantity,
      tokenPrice,
      assetValue,
      averageCost,
      unrealisedPnl,
      accountingIssue: indexedHolding.status === 'COMPLETE' ? null : indexedHolding.status,
    };
  }).filter((holding): holding is NonNullable<typeof holding> => holding !== null && holding.quantity > 0);

  const fallbackHoldings = fallbackBasket.holdings || [];

  const displayHoldings = holdingsCalculated.length > 0
    ? holdingsCalculated
    : !detail ? fallbackHoldings.filter((h) => h.quantity > 0).map((h) => {
        const tokenPrice = h.quantity > 0 ? h.value / h.quantity : 0;
        return {
          ...h,
          tokenPrice,
          assetValue: h.value,
          averageCost: null,
          unrealisedPnl: null,
          accountingIssue: null,
        };
      }) : [];
  const hasActualHoldings = displayHoldings.length > 0;

  const calculatedTotalValue = displayHoldings.reduce((total, holding) => total + holding.assetValue, 0);

  const navFromDetail = detail?.valuation?.totalNavUsdcMicro != null
    ? Number(detail.valuation.totalNavUsdcMicro) / 1e6
    : null;

  const activeBasketValue = (navFromDetail !== null && navFromDetail > 0)
    ? navFromDetail
    : calculatedTotalValue > 0
      ? calculatedTotalValue
      : (fallbackBasket.value || 0);

  const basket: Basket = {
    name: detail?.summary.name ?? fallbackBasket.name,
    symbol: detail?.summary.symbol ?? fallbackBasket.symbol,
    value: activeBasketValue,
    change: fallbackBasket.change,
    updated: fallbackBasket.updated,
    address: detail?.summary.address ?? fallbackBasket.address,
    holdings: (mappedIndexedHoldings.length > 0)
      ? mappedIndexedHoldings
      : fallbackHoldings,
  };
  const allocation = mappedIndexedHoldings.length > 0 ? mappedIndexedHoldings : (fallbackHoldings.length > 0 ? fallbackHoldings : null);
  const hasTargetAllocation = basket.holdings.some((holding) => (holding.target || 0) > 0);
  const targetAllocation = basket.holdings.filter((holding) => (holding.target || 0) > 0);

  // A partial total would look authoritative while omitting assets whose accounting
  // reconciliation is incomplete. Keep the aggregate unavailable until all displayed
  // holdings have a complete weighted-average basis.
  const totalUnrealisedPnl = displayHoldings.length > 0 && displayHoldings.every(
    (holding) => holding.unrealisedPnl !== null,
  )
    ? displayHoldings.reduce((total, holding) => total + (holding.unrealisedPnl ?? 0), 0)
    : null;

  const targetWeightSum = basket.holdings.reduce((sum, h) => sum + (h.target || 0), 0);
  const weighted30dChange = targetWeightSum > 0
    ? basket.holdings.reduce((sum, h) => sum + ((h.target || 0) / targetWeightSum) * (asset30dChanges[h.symbol] ?? 0), 0)
    : 0;

  const displayChangePct = basket.change !== 0 ? basket.change : weighted30dChange;
  const isChangePositive = displayChangePct >= 0;

  return (
    <div className="app-page-frame">
      <div className="dashboard-head">
        <div className="crumbs">
          <Link href="/app/baskets">Baskets</Link>
          <i>/</i>
          <strong>{basket.name}</strong>
        </div>
      </div>

      {basketDetailState === "disconnected" && (
        <div className="basket-surface-notice disconnected">
          <span className="basket-surface-notice-icon"><AppIcon type="lock" /></span>
          <div><strong>Connect your wallet to view live basket data</strong><span>Basket details are scoped to the connected controller wallet.</span></div>
        </div>
      )}
      {basketDetailState === "error" && (
        <div className="basket-surface-notice error">
          <span className="basket-surface-notice-icon"><AppIcon type="alert" /></span>
          <div><strong>Live basket data is unavailable</strong><span>Try again later. The values below may reflect the last available basket snapshot.</span></div>
        </div>
      )}
      {basketDetailState === "indexing" && (
        <div className="basket-surface-notice indexing">
          <span className="basket-surface-notice-icon"><AppIcon type="clock" /></span>
          <div><strong>Confirming transaction...</strong><span>Your basket was submitted on-chain. Network confirmation in progress.</span></div>
        </div>
      )}

      <section className="basket-hero">
        <div className="basket-hero-layout">
          <div className="basket-hero-main">
            <div className="basket-title-row">
              <BasketLogo name={basket.name} />
              <div>
                <h1 className="page-title basket-title">
                  {basket.name}
                  {basketDetailState === "indexing" && <span className="basket-title-status"><AppIcon type="clock" />Confirming...</span>}
                </h1>
                <p>
                  {networkLabelForChainId(chainId)} <i /> {formatAddress(basket.address)}
                </p>
              </div>
            </div>

            <div className="basket-balance" style={{ marginTop: 0 }}>
              <span>Basket value</span>
              <div>
                <strong>${basket.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <p>
                  <b style={{ color: isChangePositive ? "#10b981" : "#ef4444" }}>
                    {isChangePositive ? "+" : ""}{displayChangePct.toFixed(2)}%
                  </b>
                  <span>this month</span>
                </p>
              </div>
            </div>
          </div>

          <div className="basket-hero-side">
            {hasActualHoldings && (
              <div className="basket-drift-slot">
                {allocation && <PortfolioDrift holdings={allocation} />}
              </div>
            )}

            <div className="basket-actions">
              <button
                className="primary"
                disabled={!canManageBasket || !hasTargetAllocation}
                title={!hasTargetAllocation ? "This basket has no saved target allocation." : undefined}
                onClick={() => setAction("mint")}
              >
                <AppIcon type="plus" />Add funds
              </button>
              <button disabled={!canManageBasket} onClick={() => setAction("withdraw")}>Withdraw</button>
              <button disabled={!canManageBasket} onClick={() => setAction("rebalance")}>Rebalance</button>
            </div>
          </div>
        </div>
      </section>
      {!hasActualHoldings && hasTargetAllocation && (
        <section className="allocation-block target-allocation-preview">
          <div className="section-title">
            <div>
              <h2>Target allocation</h2>
              <p>Your saved composition. Add funds to purchase these assets.</p>
            </div>
            <span className="target-allocation-status">Ready to fund</span>
          </div>
          <div className="target-allocation-card">
            <div className="target-allocation-bar" aria-label="Saved target allocation">
              {targetAllocation.map((holding) => (
                <span
                  key={holding.address ?? holding.symbol}
                  title={`${holding.symbol} ${holding.target.toFixed(2)}%`}
                  style={{ width: `${holding.target}%`, background: holding.color }}
                />
              ))}
            </div>
            <div className="target-allocation-assets">
              {targetAllocation.map((holding) => (
                <div className="target-allocation-chip" key={holding.address ?? holding.symbol}>
                  <StockLogo symbol={holding.symbol} size={22} />
                  <span>{holding.symbol}</span>
                  <strong>{holding.target.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {hasActualHoldings && <>
      <section className="allocation-block basket-holdings-block">
        <div className="section-title">
          <div>
            <h2>Basket Holdings</h2>
            <p>Detailed asset quantities, spot valuation, and weighted-average portfolio accounting</p>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left", color: "var(--ink-3)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <th style={{ padding: "12px 16px" }}>Asset</th>
                <th style={{ padding: "12px 16px" }}>Current Price</th>
                <th style={{ padding: "12px 16px" }}>Avg Cost</th>
                <th style={{ padding: "12px 16px" }}>Units Held</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Value ($)</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Unrealized P&L</th>
              </tr>
            </thead>
            <tbody>
              {isBasketDetailsLoading && !detail ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)" }}>
                    Loading live holdings...
                  </td>
                </tr>
              ) : displayHoldings.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)" }}>
                    This basket has no current holdings.
                  </td>
                </tr>
              ) : (
                displayHoldings.map((h) => {
                  return (
                    <tr key={h.symbol} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
                        <StockLogo symbol={h.symbol} size={24} />
                        <div>
                          <span>{h.name}</span>
                          <small style={{ display: "block", color: "var(--ink-3)", fontSize: "11px", fontWeight: 400 }}>{h.symbol}</small>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {formatUsdPrice(h.tokenPrice)}
                      </td>
                      <td style={{ padding: "12px 16px", color: h.averageCost === null ? "var(--ink-3)" : "var(--ink-1)" }}>
                        {h.averageCost === null ? "—" : formatUsdPrice(h.averageCost)}
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {h.quantity > 0 && h.quantity < 0.0001
                          ? h.quantity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
                          : h.quantity > 0 && h.quantity < 1
                            ? h.quantity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
                            : h.quantity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {h.symbol}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>
                        ${h.assetValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", color: h.unrealisedPnl === null ? "var(--ink-3)" : h.unrealisedPnl >= 0 ? "#10b981" : "#ef4444" }}>
                        {h.unrealisedPnl === null ? "—" : `${h.unrealisedPnl >= 0 ? "+" : "-"}$${Math.abs(h.unrealisedPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", background: "rgba(255,255,255,0.02)" }}>
                <td style={{ padding: "14px 16px", fontWeight: 700, fontSize: "13px" }}>Total Portfolio</td>
                <td style={{ padding: "14px 16px", color: "var(--ink-3)" }}>—</td>
                <td style={{ padding: "14px 16px", color: "var(--ink-3)" }}>—</td>
                <td style={{ padding: "14px 16px", color: "var(--ink-3)" }}>—</td>
                <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 700, fontSize: "14px", color: "var(--ink)" }}>
                  {`$${calculatedTotalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </td>
                <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 700, fontSize: "14px", color: totalUnrealisedPnl === null ? "var(--ink-3)" : totalUnrealisedPnl >= 0 ? "#10b981" : "#ef4444" }}>
                  {totalUnrealisedPnl === null ? "—" : `${totalUnrealisedPnl >= 0 ? "+" : "-"}$${Math.abs(totalUnrealisedPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="allocation-block">
        <div className="section-title">
          <div>
            <h2>Allocation flow</h2>
            <p>Indexed target weights compared with current liquid onchain balances</p>
          </div>
        </div>
        <div className="allocation-visual">
          {allocation ? <AllocationSankey allocations={allocation} theme="dark" /> : (
            <div className="sankey-wrap" style={{ padding: "36px 20px", textAlign: "center", color: "var(--muted-ink)", fontSize: "13px" }}>
              No target allocation is configured for this basket.
            </div>
          )}
        </div>

        <footer className="allocation-footer">
          <span>{allocation ? "Target vs. current allocation" : "Target allocation unavailable"}</span>
          <span>{allocation && detail?.freshness?.priceObservedAt ? `Live as of ${new Date(detail.freshness.priceObservedAt).toLocaleString()}` : allocation ? "Awaiting onchain data" : "No saved targets"}</span>
        </footer>
      </section>
      </>}

      <section className="activity-block">
        <div className="section-title">
          <div>
            <h2>Recent activity</h2>
            <p>Confirmed basket operations</p>
          </div>
          <Link href="/app/activity">View all</Link>
        </div>
        <div className="activity-table">
          {events.length > 0 ? (
            events.slice(0, 5).map((evt, idx) => (
              <ActivityEventRow key={`${evt.txHash}-${idx}`} event={evt} olderEvents={events.slice(idx + 1)} />
            ))
          ) : (
            <p className="activity-empty">No confirmed basket operations yet.</p>
          )}
        </div>
      </section>
      {action && canManageBasket && <BasketDrawer basket={basket} action={action} onClose={() => setAction(null)} />}
    </div>
  );
}
