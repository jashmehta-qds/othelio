"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { portfolioValue } from "@/lib/baskets";
import { AppIcon, type AppNavId } from "./AppIcon";

const navigation: { id: AppNavId; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/app/overview" },
  { id: "baskets", label: "Baskets", href: "/app/baskets" },
  { id: "activity", label: "Activity", href: "/app/activity" },
  { id: "agents", label: "Agents", href: "/app/agents" },
  { id: "settings", label: "Settings", href: "/app/settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return <main className="bank-app" data-theme="dark">
    <aside className="bank-sidebar">
      <div>
        <Link href="/" className="bank-wordmark">Othelio</Link>
        <nav className="bank-nav" aria-label="Primary navigation">
          {navigation.map((item) => <Link key={item.id} href={item.href} className={isActive(item.href) ? "active" : ""}><AppIcon type={item.id}/><span>{item.label}</span></Link>)}
        </nav>
      </div>
      <div className="sidebar-lower">
        <section className="account-module"><header><span className="avatar">AC</span><span><strong>Alex Carter</strong><small>0x7fA3…9cB2</small></span><button aria-label="Wallet options">•••</button></header><div className="account-balance"><span>Total portfolio</span><strong>${portfolioValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong><small><b>+$842.18</b> this month</small></div><div className="account-available"><span>Available USDC</span><strong>$2,140.00</strong></div></section>
      </div>
    </aside>
    <section className="bank-content">
      <header className="mobile-header"><Link href="/" className="bank-wordmark">Othelio</Link></header>
      {children}
    </section>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.slice(0, 4).map((item) => <Link key={item.id} href={item.href} className={isActive(item.href) ? "active" : ""}><AppIcon type={item.id}/><span>{item.label}</span></Link>)}</nav>
  </main>;
}
