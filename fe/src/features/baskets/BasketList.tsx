import Link from "next/link";
import { baskets, portfolioValue } from "@/lib/baskets";
import { BasketLogo } from "./BasketLogo";

export function BasketList() {
  return <section className="basket-index">
    <header className="index-head"><div><h1>Your baskets</h1><p>Create, fund, and manage tokenized stock exposure in one place.</p></div></header>
    <div className="portfolio-strip"><span>Portfolio value</span><strong>${portfolioValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong><p><b>+$2,294.36</b><span>+3.14% this month</span></p></div>
    <div className="basket-list-head"><span>Basket</span><span>Value</span><span>30d</span><span>Assets</span><span>Updated</span><span/></div>
    <div className="basket-list">{baskets.map((basket) => <Link key={basket.address} href={`/app/baskets/${basket.address}`}><span className="basket-name"><BasketLogo name={basket.name} size="small"/><span><strong>{basket.name}</strong><small>{basket.symbol} · Base Sepolia</small></span></span><strong>${basket.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong><span className="positive">+{basket.change}%</span><span>{basket.holdings.length}</span><span>{basket.updated}</span><span aria-hidden="true">→</span></Link>)}</div>
  </section>;
}
