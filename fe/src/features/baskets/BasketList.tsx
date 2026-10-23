"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useChainId } from "wagmi";
import { useBasketsList } from "@/hooks/useBaskets";
import { useHydrated } from "@/hooks/useHydrated";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";
import { networkLabelForChainId } from "@/lib/network";
import { formatCompactNumber } from "@/lib/baskets";
import { BasketLogo } from "./BasketLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { State } from "@/components/ui/State";
import { basketListTotal } from "./basket-list-value";

export function BasketList() {
  const chainId = useChainId() || Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
  const { address, isConnected } = useAccount();
  const hydrated = useHydrated();
  const restoring = useWalletRestoring();
  const connected = hydrated && isConnected && Boolean(address);
  const [connecting, setConnecting] = useState(false);
  const [search, setSearch] = useState("");
  const query = useBasketsList(chainId, connected ? address : undefined);
  const baskets = connected ? query.data?.data ?? [] : [];
  const total = connected && query.data ? basketListTotal(baskets) : null;
  const visible = baskets.filter((basket) => `${basket.name} ${basket.symbol} ${basket.address}`.toLowerCase().includes(search.trim().toLowerCase()));
  const loading = restoring || (connected && query.isLoading);
  return <section className="app-page-frame">
    <header className="ui-page-header"><div><h1 className="page-title">Your baskets</h1><p>Choose what you own. Manage it together.</p></div><Link className="ui-button" href="/app/baskets/create"><AppIcon type="plus" />Create basket</Link></header>
    {connected && <div className="portfolio-strip"><span>Total basket value</span><strong>{loading ? "…" : total === null ? "—" : `$${formatCompactNumber(total)}`}</strong><p><span>{baskets.length} basket{baskets.length === 1 ? "" : "s"} · {networkLabelForChainId(chainId)}</span></p></div>}
    {query.isError && connected && baskets.length > 0 && <div className="ui-notice" data-tone="error" role="status">Couldn’t refresh. Showing the last available values.<button className="ui-button" data-variant="ghost" onClick={() => void query.refetch()}>Retry</button></div>}
    {loading ? <State tone="loading" title={restoring ? "Restoring your wallet" : "Loading your baskets"} description="Your balances will appear here shortly." /> : !connected ? <State title="Bring your baskets into view" description="Connect the wallet you use with Othelio to see your balances and manage your baskets." action={<button className="ui-button" onClick={() => setConnecting(true)}>Connect wallet<AppIcon type="arrow" /></button>} /> : query.isError && !query.data ? <State tone="error" title="Your baskets couldn’t load" description="Your assets are unaffected. Try refreshing the connection." action={<button className="ui-button" onClick={() => void query.refetch()}>Try again</button>} /> : baskets.length === 0 ? <State title="Your first basket starts here" description="Choose your assets and allocations. You can add funds after creating the basket." action={<Link className="ui-button" href="/app/baskets/create">Create a basket<AppIcon type="arrow" /></Link>} /> : <>
      <div className="ui-toolbar"><span>{baskets.length} basket{baskets.length === 1 ? "" : "s"}</span><input className="ui-search" type="search" aria-label="Search baskets" placeholder="Find a basket…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="basket-list-head" aria-hidden="true"><span>Basket</span><span>Value</span><span>Assets</span><span /></div>
      <div className="basket-list">{visible.map((basket) => <Link key={basket.address} href={`/app/baskets/${basket.address}`}><span className="basket-name"><BasketLogo name={basket.name} size="small" /><span><strong>{basket.name}</strong><small>{basket.symbol || "OTH"} · {networkLabelForChainId(chainId)}</small></span></span><strong>{basket.totalNavUsdcMicro === null ? "Unavailable" : `$${formatCompactNumber(Number(basket.totalNavUsdcMicro) / 1e6)}`}</strong><span className="ui-basket-count">{basket.holdingCount}</span><span style={{ width: 18 }}><AppIcon type="arrow" /></span></Link>)}</div>
      {visible.length === 0 && <State title="No matching baskets" description="Try a different name, symbol, or address." action={<button className="ui-button" data-variant="secondary" onClick={() => setSearch("")}>Clear search</button>} />}
    </>}
    <WalletConnectModal isOpen={connecting} onClose={() => setConnecting(false)} />
  </section>;
}
