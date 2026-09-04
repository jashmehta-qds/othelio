"use client";

import Link from "next/link";
import { useState } from "react";
import AllocationSankey from "@/components/AllocationSankey";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { formatAddress, type Basket } from "@/lib/baskets";
import { useBasketDetails, useBasketActivity } from "@/hooks/useBaskets";
import { BasketDrawer, type BasketAction } from "./BasketDrawer";
import { BasketLogo } from "./BasketLogo";

export function BasketDetail({ basket: fallbackBasket, initialAction = null }: { basket: Basket; initialAction?: BasketAction }) {
  const [action, setAction] = useState<BasketAction>(initialAction);

  // Live queries for basket details and activity by contract address
  const { data: apiDetails } = useBasketDetails(fallbackBasket.address, 31337);
  const { data: apiActivity } = useBasketActivity(fallbackBasket.address, 31337);

  const indexedBasket = apiDetails?.data;
  const events = apiActivity?.data ?? [];

  // Active basket properties with fallback
  const basket: Basket = {
    name: indexedBasket?.name ?? fallbackBasket.name,
    symbol: indexedBasket?.symbol ?? fallbackBasket.symbol,
    value: indexedBasket?.snapshot ? Number(indexedBasket.snapshot.total_nav_usdc) : fallbackBasket.value,
    change: fallbackBasket.change,
    updated: indexedBasket?.created_at ? new Date(indexedBasket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : fallbackBasket.updated,
    address: indexedBasket?.address ?? fallbackBasket.address,
    holdings: fallbackBasket.holdings,
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
      <section className="basket-hero">
        <div className="basket-title-row">
          <BasketLogo name={basket.name} />
          <div>
            <h1>{basket.name}</h1>
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
      <section className="allocation-block">
        <div className="section-title">
          <div>
            <h2>Allocation flow</h2>
            <p>Target weights compared with current onchain balances</p>
          </div>
          <div className="allocation-legend">
            <span><i className="target-key" />Target</span>
            <span><i className="current-key" />Current</span>
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
            events.map((evt) => (
              <div key={`${evt.tx_hash}-${evt.log_index}`} className="activity-row">
                <span className="activity-time">Block {evt.block_number}</span>
                <span>
                  <strong>{evt.event_type}</strong>
                  <small>{formatAddress(evt.actor_address || evt.tx_hash)}</small>
                </span>
                <span className="activity-amount">Confirmed</span>
                <span className="status completed">Completed</span>
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

