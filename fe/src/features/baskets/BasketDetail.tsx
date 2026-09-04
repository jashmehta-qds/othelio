"use client";

import Link from "next/link";
import { useState } from "react";
import AllocationSankey from "@/components/AllocationSankey";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { formatAddress, type Basket } from "@/lib/baskets";
import { BasketDrawer, type BasketAction } from "./BasketDrawer";
import { BasketLogo } from "./BasketLogo";

export function BasketDetail({ basket, initialAction = null }: { basket: Basket; initialAction?: BasketAction }) {
  const [action, setAction] = useState<BasketAction>(initialAction);
  return <>
    <div className="dashboard-head"><div className="crumbs"><Link href="/app/baskets">Baskets</Link><i>/</i><strong>{basket.name}</strong></div></div>
    <section className="basket-hero"><div className="basket-title-row"><BasketLogo name={basket.name}/><div><h1>{basket.name}</h1><p>Base Sepolia <i/> {formatAddress(basket.address)}</p></div></div><div className="basket-balance"><span>Basket value <b>Preview</b></span><div><strong>${basket.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong><p><b>+{basket.change}%</b><span>this month</span></p></div></div><div className="basket-actions"><button className="primary" onClick={() => setAction("mint")}><AppIcon type="plus"/>Mint</button><button onClick={() => setAction("withdraw")}>Withdraw</button><button onClick={() => setAction("rebalance")}>Rebalance</button></div></section>
    <section className="allocation-block"><div className="section-title"><div><h2>Allocation flow</h2><p>Target weights compared with current onchain balances</p></div><div className="allocation-legend"><span><i className="target-key"/>Target</span><span><i className="current-key"/>Current</span></div></div><div className="allocation-visual"><AllocationSankey allocations={basket.holdings} theme="dark"/></div><footer className="allocation-footer"><span>100% allocated</span><span>Last priced Sep 3, 2026 · 10:15 AM UTC</span></footer></section>
    <section className="activity-block"><div className="section-title"><div><h2>Recent activity</h2><p>Confirmed basket operations</p></div><Link href="/app/activity">View all</Link></div><div className="activity-table"><div className="activity-row"><span className="activity-time">Yesterday</span><span><strong>Mint</strong><small>1,000 USDC deposited</small></span><span className="activity-amount">+9.84 shares</span><span className="status completed">Completed</span></div><div className="activity-row"><span className="activity-time">Aug 31</span><span><strong>Rebalance</strong><small>Across {basket.holdings.length} assets</small></span><span className="activity-amount">−410.75 USDC</span><span className="status completed">Completed</span></div></div></section>
    {action && <BasketDrawer basket={basket} action={action} onClose={() => setAction(null)}/>} 
  </>;
}
