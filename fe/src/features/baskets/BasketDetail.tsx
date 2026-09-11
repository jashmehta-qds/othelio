"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId } from "wagmi";
import AllocationSankey from "@/components/AllocationSankey";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { assetPrices, asset30dChanges, formatAddress, getBasket, getCreatedBaskets, getLocalActivity, supportedAssets, type Basket, type BasketActivity, type Holding } from "@/lib/baskets";
import { useBasketDetails, useBasketActivity, useBasketsList, useAssetPrices, usePortfolioPositions } from "@/hooks/useBaskets";
import { BasketDrawer, type BasketAction } from "./BasketDrawer";
import { BasketLogo } from "./BasketLogo";
import { PortfolioDrift } from "./PortfolioDrift";
import { ActivityEventRow } from "./ActivityEventRow";

export function BasketDetail({ basket: fallbackBasket, initialAction = null }: { basket: Basket; initialAction?: BasketAction }) {
  const chainId = useChainId() || 31337;
  const { address, isConnected } = useAccount();
  const [action, setAction] = useState<BasketAction>(initialAction);
  const [localBasket, setLocalBasket] = useState<Basket | null>(null);

  // Live queries for basket details and activity by contract address
  const { data: ownedBasketsResponse } = useBasketsList(31337, isConnected ? address : undefined);
  const ownedBasket = ownedBasketsResponse?.data.find((candidate) =>
    candidate.address.toLowerCase() === fallbackBasket.address.toLowerCase()
    && candidate.controller.toLowerCase() === address?.toLowerCase(),
  );
  const canManageBasket = Boolean(ownedBasket);
  // A basket address is the public, shareable read surface. Activity and
  // browser-local drafts are controller-session data and remain private.
  const { data: apiDetails } = useBasketDetails(fallbackBasket.address, 31337);
  const { data: fetchedActivity } = useBasketActivity(fallbackBasket.address, 31337, canManageBasket);
  const { data: priceMap } = useAssetPrices();
  const { data: portfolioResponse } = usePortfolioPositions(fallbackBasket.address, chainId);
  const apiActivity = canManageBasket ? fetchedActivity : undefined;
  const portfolioSnapshot = portfolioResponse?.data;

  useEffect(() => {
    const loadBasket = () => {
      // Browser-stored drafts belong to the connected owner session and are
      // never part of the public basket view.
      if (typeof window !== "undefined" && canManageBasket) {
        const created = getCreatedBaskets();
        const found = created.find(
          (b: Basket) => b.address.toLowerCase() === fallbackBasket.address.toLowerCase() ||
            b.name.toLowerCase() === fallbackBasket.name.toLowerCase()
        ) ?? getBasket(fallbackBasket.address);
        if (found) setLocalBasket({ ...found });
      } else {
        setLocalBasket(null);
      }
    };
    loadBasket();
    window.addEventListener("basket_updated", loadBasket);
    return () => window.removeEventListener("basket_updated", loadBasket);
  }, [fallbackBasket.address, fallbackBasket.name, canManageBasket]);

  const indexedBasket = apiDetails?.data ?? ownedBasket;
  const isBasketIndexed = Boolean(indexedBasket) || Boolean(localBasket);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const localEvents = mounted && canManageBasket ? getLocalActivity(fallbackBasket.address) : [];
  const apiEvents: BasketActivity[] = (apiActivity?.data ?? []).map((evt) => ({
    ...evt,
    event_type: evt.event_type === "FUNDED" ? "BasketFunded" : evt.event_type === "CREATED" ? "BasketCreated" : evt.event_type,
    actor_address: evt.actor_address || "Wallet execution",
    block_number: evt.block_number ? Number(evt.block_number) : undefined,
  }));

  const combinedEvents = [...apiEvents, ...localEvents];
  const events = combinedEvents.filter((evt, idx, self) => {
    const normType = evt.event_type.toLowerCase();
    const normHash = (evt.tx_hash || "").toLowerCase();
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    return idx === self.findIndex((other) => {
      const otherHash = (other.tx_hash || "").toLowerCase();
      const otherType = other.event_type.toLowerCase();
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
    const blockA = a.block_number ? Number(a.block_number) : 0;
    const blockB = b.block_number ? Number(b.block_number) : 0;
    if (blockA !== blockB) return blockB - blockA;
    return new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime();
  });

  const apiPositions: any[] = (indexedBasket as any)?.positions ?? [];
  const totalIndexedRealizedPnl = apiPositions.reduce((acc: number, pos: any) => acc + Number(pos.realized_pnl_usdc || 0), 0);

  const eventInputAmount = (indexedBasket as any)?.snapshot?.holdings?.inputAmount
    ? Number((indexedBasket as any).snapshot.holdings.inputAmount) / 1e6
    : (indexedBasket as any)?.snapshot?.total_nav_usdc
      ? Number((indexedBasket as any).snapshot.total_nav_usdc)
      : 0;

  const canonicalEquity = portfolioSnapshot?.equityUsdE8 === null || portfolioSnapshot?.equityUsdE8 === undefined
    ? null
    : Number(formatUnits(BigInt(portfolioSnapshot.equityUsdE8), 8));
  const activeBasketValue = canonicalEquity !== null
    ? canonicalEquity
    : (indexedBasket && 'snapshot' in indexedBasket && Number((indexedBasket as any).snapshot?.total_nav_usdc) > 0)
    ? Number((indexedBasket as any).snapshot.total_nav_usdc)
    : (localBasket && localBasket.value > 0)
      ? localBasket.value
      : (eventInputAmount > 0)
        ? eventInputAmount
        : (fallbackBasket.value || 0);

  const indexedAssets = (indexedBasket as any)?.assets;
  const mappedIndexedHoldings: Holding[] = indexedAssets && Array.isArray(indexedAssets) && indexedAssets.length > 0
    ? indexedAssets.map((ast: any) => {
      const rawAddr = ast.asset_address ? String(ast.asset_address).trim() : "";
      const knownMeta = supportedAssets.find((sa) =>
        sa.symbol.toLowerCase() === rawAddr.toLowerCase() ||
        (sa.address && sa.address.toLowerCase() === rawAddr.toLowerCase())
      );
      const symbolStr = knownMeta?.symbol || (rawAddr.startsWith("0x") ? `${rawAddr.slice(0, 6)}…` : rawAddr || "USDC");
      const targetWeight = (ast.target_weight_bps || 0) / 100;
      const val = (activeBasketValue * targetWeight) / 100;
      const price = priceMap?.[symbolStr] ?? assetPrices[symbolStr] ?? 100;
      const qty = price > 0 ? Number((val / price).toFixed(4)) : 0;
      return {
        symbol: symbolStr,
        name: knownMeta?.name || symbolStr,
        target: targetWeight,
        current: targetWeight,
        quantity: qty,
        value: val,
        color: knownMeta?.color || "#8aa4ff",
      };
    })
    : [];

  // Active basket properties with fallback
  const basket: Basket = {
    name: localBasket?.name ?? indexedBasket?.name ?? fallbackBasket.name,
    symbol: localBasket?.symbol ?? indexedBasket?.symbol ?? fallbackBasket.symbol,
    ensDomain: localBasket?.ensDomain ?? `${(localBasket?.name ?? indexedBasket?.name ?? fallbackBasket.name).toLowerCase().replace(/[^a-z0-9]/g, '')}.othelio.eth`,
    value: activeBasketValue,
    change: localBasket?.change ?? fallbackBasket.change,
    updated: localBasket?.updated ?? fallbackBasket.updated,
    address: localBasket?.address ?? indexedBasket?.address ?? fallbackBasket.address,
    holdings: (mappedIndexedHoldings.length > 0)
      ? mappedIndexedHoldings
      : (localBasket && localBasket.holdings && localBasket.holdings.length > 0)
        ? localBasket.holdings
        : (fallbackBasket.holdings || []),
    realizedGains: localBasket?.realizedGains ?? (totalIndexedRealizedPnl > 0 ? totalIndexedRealizedPnl : fallbackBasket.realizedGains ?? 0),
  };

  // Pre-calculate holdings math for balance card and holdings table
  let calculatedTotalValue = 0;
  let calculatedCostBasis = 0;

  const holdingsCalculated = basket.holdings.map((h) => {
    const tokenPrice = priceMap?.[h.symbol] ?? assetPrices[h.symbol] ?? 100;
    const matchedPos = apiPositions.find((p: any) => p.symbol?.toLowerCase() === h.symbol?.toLowerCase() || (h.address && p.asset_address?.toLowerCase() === h.address.toLowerCase()));

    // Derive exact units held from asset value / price if quantity is zero or mismatched
    const realQuantity = (h.quantity > 0 && Math.abs(h.quantity * tokenPrice - h.value) < 1.0)
      ? h.quantity
      : (tokenPrice > 0 ? Number((h.value / tokenPrice).toFixed(4)) : 0);

    const avgCost = matchedPos?.avg_cost_usdc && Number(matchedPos.avg_cost_usdc) > 0
      ? Number(matchedPos.avg_cost_usdc)
      : (h.avgCost ?? (h.symbol === "USDC" ? 1.0 : tokenPrice));
    const assetValue = h.value;
    const costBasis = realQuantity * avgCost;
    const gainUsd = assetValue - costBasis;
    const gainPct = costBasis > 0 ? (gainUsd / costBasis) * 100 : 0;

    calculatedTotalValue += assetValue;
    calculatedCostBasis += costBasis;

    return {
      ...h,
      quantity: realQuantity,
      tokenPrice,
      avgCost,
      assetValue,
      costBasis,
      gainUsd,
      gainPct,
    };
  });

  const totalGainUsd = calculatedTotalValue - calculatedCostBasis;
  const totalGainPct = calculatedCostBasis > 0 ? (totalGainUsd / calculatedCostBasis) * 100 : 0;

  // Compute 30-day weighted market index change from target weights
  const targetWeightSum = basket.holdings.reduce((sum, h) => sum + (h.target || 0), 0);
  const weighted30dChange = targetWeightSum > 0
    ? basket.holdings.reduce((sum, h) => sum + ((h.target || 0) / targetWeightSum) * (asset30dChanges[h.symbol] ?? 0), 0)
    : 0;

  const displayChangePct = calculatedCostBasis > 0 ? totalGainPct : (basket.change !== 0 ? basket.change : weighted30dChange);
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

      {!isBasketIndexed && (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(234,179,8,0.08)",
            border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: "12px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px",
            color: "#eab308",
          }}
        >
          <span style={{ width: "18px", height: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AppIcon type="clock" />
          </span>
          <div>
            <strong>Confirming transaction...</strong>
            <span style={{ display: "block", fontSize: "12px", opacity: 0.85, marginTop: "2px" }}>
              Your basket was submitted on-chain. Network confirmation in progress.
            </span>
          </div>
        </div>
      )}

      <section className="basket-hero" style={{ paddingBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "32px", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "24px" }}>
            <div className="basket-title-row">
              <BasketLogo name={basket.name} />
              <div>
                <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {basket.name}
                  {!isBasketIndexed && (
                    <span
                      style={{
                        fontSize: "11px",
                        background: "rgba(234,179,8,0.15)",
                        color: "#eab308",
                        border: "1px solid rgba(234,179,8,0.3)",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <span style={{ width: "12px", height: "12px", display: "inline-flex" }}>
                        <AppIcon type="clock" />
                      </span>
                      Confirming...
                    </span>
                  )}
                </h1>
                <p>
                  <span style={{ color: "#d7ff46", fontWeight: 700, fontFamily: "monospace" }}>
                    {basket.ensDomain || `${basket.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.othelio.eth`}
                  </span>{" "}
                  <i /> Base Local <i /> {formatAddress(basket.address)}
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
              <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>Realized P&L:</span>
                <strong style={{ color: (basket.realizedGains ?? 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 600, fontSize: "13px" }}>
                  {(basket.realizedGains ?? 0) >= 0 ? "+" : "-"}${Math.abs(basket.realizedGains ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </div>
            </div>
          </div>

          <div style={{ flex: "0 1 380px", minWidth: "300px", display: "flex", flexDirection: "column", gap: "16px", alignItems: "flex-end" }}>
            <div style={{ width: "100%" }}>
              <PortfolioDrift holdings={basket.holdings} />
            </div>

            <div className="basket-actions" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="primary" disabled={!canManageBasket} onClick={() => setAction("mint")}>
                <AppIcon type="plus" />Add funds
              </button>
              <button disabled={!canManageBasket} onClick={() => setAction("withdraw")}>Withdraw</button>
              <button disabled={!canManageBasket} onClick={() => setAction("rebalance")}>Rebalance</button>
            </div>
          </div>
        </div>
      </section>
      <section className="allocation-block" style={{ marginTop: "24px" }}>
        <div className="section-title">
          <div>
            <h2>Basket Holdings</h2>
            <p>Detailed asset quantities, cost basis, unrealized P&L, and portfolio valuation</p>
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
              {holdingsCalculated.map((h) => {
                const isPositive = h.gainUsd >= 0;
                const hasQuantity = h.quantity > 0;
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
                      ${h.tokenPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 500, color: hasQuantity ? "var(--ink-2)" : "var(--ink-3)" }}>
                      {hasQuantity ? `$${h.avgCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                      {h.quantity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {h.symbol}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>
                      ${h.assetValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {hasQuantity ? (
                        <>
                          <div style={{ fontWeight: 600, color: isPositive ? "#10b981" : "#ef4444" }}>
                            {isPositive ? "+" : "-"}${Math.abs(h.gainUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <small style={{ display: "block", color: isPositive ? "#10b981" : "#ef4444", fontSize: "11px", fontWeight: 500 }}>
                            {isPositive ? "+" : ""}{h.gainPct.toFixed(2)}%
                          </small>
                        </>
                      ) : (
                        <span style={{ color: "var(--ink-3)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", background: "rgba(255,255,255,0.02)" }}>
                <td style={{ padding: "14px 16px", fontWeight: 700, fontSize: "13px" }}>Total Portfolio</td>
                <td style={{ padding: "14px 16px", color: "var(--ink-3)" }}>—</td>
                <td style={{ padding: "14px 16px", color: "var(--ink-3)" }}>—</td>
                <td style={{ padding: "14px 16px", color: "var(--ink-3)" }}>—</td>
                <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 700, fontSize: "14px", color: "var(--ink)" }}>
                  ${calculatedTotalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td style={{ padding: "14px 16px", textAlign: "right" }}>
                  {calculatedCostBasis > 0 ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: totalGainUsd >= 0 ? "#10b981" : "#ef4444" }}>
                        {totalGainUsd >= 0 ? "+" : "-"}${Math.abs(totalGainUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <small style={{ display: "block", color: totalGainUsd >= 0 ? "#10b981" : "#ef4444", fontSize: "11px", fontWeight: 600 }}>
                        {totalGainUsd >= 0 ? "+" : ""}{totalGainPct.toFixed(2)}%
                      </small>
                    </>
                  ) : (
                    <span style={{ color: "var(--ink-3)" }}>—</span>
                  )}
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
            <p>Target weights compared with current onchain balances</p>
          </div>
        </div>
        <div className="allocation-visual">
          <AllocationSankey allocations={basket.holdings} theme="dark" />
        </div>

        <footer className="allocation-footer">
          <span>100% allocated</span>
          <span>Last priced {basket.updated}</span>
        </footer>
      </section>


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
              <ActivityEventRow key={`${evt.tx_hash}-${idx}`} event={evt} olderEvents={events.slice(idx + 1)} />
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
