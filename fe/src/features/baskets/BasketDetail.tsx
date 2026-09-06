"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AllocationSankey from "@/components/AllocationSankey";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { formatAddress, getBasket, getCreatedBaskets, getLocalActivity, type Basket } from "@/lib/baskets";
import { useBasketDetails, useBasketActivity, useBasketsList } from "@/hooks/useBaskets";
import { BasketDrawer, type BasketAction } from "./BasketDrawer";
import { BasketLogo } from "./BasketLogo";
import { PortfolioDrift } from "./PortfolioDrift";

export function BasketDetail({ basket: fallbackBasket, initialAction = null }: { basket: Basket; initialAction?: BasketAction }) {
  const [action, setAction] = useState<BasketAction>(initialAction);
  const [localBasket, setLocalBasket] = useState<Basket | null>(null);

  useEffect(() => {
    const loadBasket = () => {
      if (typeof window !== "undefined") {
        const created = getCreatedBaskets();
        const found = created.find(
          (b: Basket) => b.address.toLowerCase() === fallbackBasket.address.toLowerCase() ||
                         b.name.toLowerCase() === fallbackBasket.name.toLowerCase()
        ) ?? getBasket(fallbackBasket.address);
        if (found) setLocalBasket({ ...found });
      }
    };
    loadBasket();
    window.addEventListener("basket_updated", loadBasket);
    return () => {
      window.removeEventListener("basket_updated", loadBasket);
    };
  }, [fallbackBasket.address, fallbackBasket.name]);

  // Live queries for basket details and activity by contract address
  const { data: apiDetails } = useBasketDetails(fallbackBasket.address, 31337);
  const { data: apiList } = useBasketsList(31337);
  const { data: apiActivity } = useBasketActivity(fallbackBasket.address, 31337);

  const indexedBasket = apiDetails?.data ?? apiList?.data?.find(
    (b) => b.address.toLowerCase() === fallbackBasket.address.toLowerCase() ||
           (localBasket && b.name.toLowerCase() === localBasket.name.toLowerCase())
  );
  const isBasketIndexed = Boolean(indexedBasket) || Boolean(localBasket);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const localEvents = mounted ? getLocalActivity(fallbackBasket.address) : [];
  const rawEvents = [...localEvents, ...(apiActivity?.data ?? [])];
  const events = rawEvents.sort((a, b) => {
    if (!a.block_number && b.block_number) return -1;
    if (a.block_number && !b.block_number) return 1;
    const blockDiff = (b.block_number || 0) - (a.block_number || 0);
    if (blockDiff !== 0) return blockDiff;
    return new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime();
  });

  // Active basket properties with fallback
  const basket: Basket = {
    name: localBasket?.name ?? indexedBasket?.name ?? fallbackBasket.name,
    symbol: localBasket?.symbol ?? indexedBasket?.symbol ?? fallbackBasket.symbol,
    value: (localBasket && localBasket.value > 0)
      ? localBasket.value
      : (indexedBasket && 'snapshot' in indexedBasket && (indexedBasket as any).snapshot?.total_nav_usdc > 0)
        ? Number((indexedBasket as any).snapshot.total_nav_usdc)
        : (fallbackBasket.value || 1000),
    change: localBasket?.change ?? fallbackBasket.change,
    updated: localBasket?.updated ?? fallbackBasket.updated,
    address: localBasket?.address ?? indexedBasket?.address ?? fallbackBasket.address,
    holdings: (localBasket && localBasket.holdings && localBasket.holdings.length > 0)
      ? localBasket.holdings
      : fallbackBasket.holdings,
  };

  return (
    <>
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

      <section className="basket-hero">
        <div className="basket-title-row">
          <BasketLogo name={basket.name} />
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            <p>Base Local <i /> {formatAddress(basket.address)}</p>
          </div>
        </div>
        <div className="basket-balance">
          <span>Basket value</span>
          <div>
            <strong>${basket.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
            <p>
              <b>+{basket.change}%</b>
              <span>this month</span>
            </p>
          </div>
        </div>
        <div className="basket-actions">
          <button className="primary" onClick={() => setAction("mint")}>
            <AppIcon type="plus" />Mint
          </button>
          <button onClick={() => setAction("withdraw")}>Withdraw</button>
          <button onClick={() => setAction("rebalance")}>Rebalance</button>
        </div>
      </section>

      <PortfolioDrift holdings={basket.holdings} onRebalance={() => setAction("rebalance")} />

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

      <section className="allocation-block" style={{ marginTop: "24px" }}>
        <div className="section-title">
          <div>
            <h2>Portfolio Holdings</h2>
            <p>Detailed asset quantities and portfolio valuation</p>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left", color: "var(--ink-3)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <th style={{ padding: "12px 16px" }}>Asset</th>
                <th style={{ padding: "12px 16px" }}>Target %</th>
                <th style={{ padding: "12px 16px" }}>Current %</th>
                <th style={{ padding: "12px 16px" }}>Units Held</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Value ($)</th>
              </tr>
            </thead>
            <tbody>
              {basket.holdings.map((h) => (
                <tr key={h.symbol} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
                    <StockLogo symbol={h.symbol} size={24} />
                    <div>
                      <span>{h.name}</span>
                      <small style={{ display: "block", color: "var(--ink-3)", fontSize: "11px", fontWeight: 400 }}>{h.symbol}</small>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>{h.target}%</td>
                  <td style={{ padding: "12px 16px" }}>{h.current}%</td>
                  <td style={{ padding: "12px 16px", fontWeight: 600 }}>{h.quantity.toLocaleString("en-US", { minimumFractionDigits: 2 })} {h.symbol}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>${h.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            events.map((evt, idx) => (
              <div key={`${evt.tx_hash}-${idx}`} className="activity-row">
                <span className="activity-time">{evt.block_number ? `Block ${evt.block_number}` : "Pending Index"}</span>
                <span>
                  <strong>{evt.event_type}</strong>
                  <small>{formatAddress(evt.actor_address)}</small>
                </span>
                <span className="activity-amount">
                  <a
                    href={`https://etherscan.io/tx/${evt.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: "monospace",
                      fontSize: "12px",
                      color: "var(--muted-ink)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-ink)")}
                  >
                    {formatAddress(evt.tx_hash)}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </span>
                <span className={`status ${evt.block_number ? "completed" : "pending"}`}>
                  {evt.block_number ? "Completed" : "Pending"}
                </span>
              </div>
            ))
          ) : (
            <>
              <div className="activity-row">
                <span className="activity-time">Block 2</span>
                <span>
                  <strong>BasketCreated</strong>
                  <small>Registered on-chain via Factory</small>
                </span>
                <span className="activity-amount">+1 basket</span>
                <span className="status completed">Completed</span>
              </div>
            </>
          )}
        </div>
      </section>
      {action && <BasketDrawer basket={basket} action={action} onClose={() => setAction(null)} />}
    </>
  );
}

