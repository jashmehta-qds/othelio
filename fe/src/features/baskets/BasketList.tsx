"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useBasketsList } from "@/hooks/useBaskets";
import { useHydrated } from "@/hooks/useHydrated";
import { formatCompactNumber } from "@/lib/baskets";
import { BasketLogo } from "./BasketLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { CreateBasketModal } from "@/components/CreateBasketModal";

export function BasketList() {
  const { address, isConnected } = useAccount();
  const isHydrated = useHydrated();
  const hasConnectedWallet = isHydrated && isConnected && Boolean(address);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  
  // Fetch indexed baskets directly from smart contract / indexer service
  const { data: apiResponse, isLoading } = useBasketsList(31337, hasConnectedWallet ? address : undefined);
  const displayBaskets = useMemo(() => {
    if (!hasConnectedWallet || !address) return [];

    return (apiResponse?.data ?? []).map((ib) => ({
      name: ib.name,
      symbol: ib.symbol || 'OTH',
      value: ib.snapshot?.total_nav_usdc ? Number(ib.snapshot.total_nav_usdc) : Number(ib.seed_amount || 0),
      change: 0,
      updated: "Just now",
      address: ib.address,
      holdingsCount: ib.assets ? ib.assets.length : 0,
      isIndexed: true,
    }));
  }, [hasConnectedWallet, address, apiResponse]);

  const totalPortfolioValue = displayBaskets.reduce((acc, b) => acc + b.value, 0);

  return (
    <section className="app-page-frame">
      <CreateBasketModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <header className="index-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Your baskets</h1>
          <p className="page-description">Baskets created and managed by your wallet.</p>
        </div>
        <Link
          href="/app/baskets/create"
          className="primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "10px 18px",
            fontSize: "13px",
            fontWeight: 600,
            borderRadius: "10px",
            textDecoration: "none",
            whiteSpace: "nowrap"
          }}
        >
          + Create Basket
        </Link>
      </header>

      <div className="portfolio-strip">
        <span>Personal Portfolio Value</span>
        <strong>
          {`$${formatCompactNumber(totalPortfolioValue)}`}
        </strong>
        <p>
          <span>{displayBaskets.length} active basket{displayBaskets.length === 1 ? '' : 's'}</span>
        </p>
      </div>

      <div className="basket-list-head">
        <span>Basket</span>
        <span>Value</span>
        <span>30d</span>
        <span>Assets</span>
        <span>Updated</span>
        <span />
      </div>

      <div className="basket-list">
        {hasConnectedWallet && isLoading && displayBaskets.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', opacity: 0.6, fontSize: '13px' }}>
            Loading your created baskets...
          </div>
        ) : displayBaskets.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--muted-ink)' }}>
            {hasConnectedWallet ? <>
              <p style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>
                No Baskets Created Yet
              </p>
              <p style={{ fontSize: '12px' }}>
                Your connected wallet has not deployed any baskets on this network yet.
              </p>
            </> : <>
              <p style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>
                Connect your wallet to see your baskets
              </p>
              <p style={{ fontSize: '12px' }}>
                Your portfolio and activity appear after you connect.
              </p>
            </>}
          </div>
        ) : (
          displayBaskets.map((basket) => (
            <Link key={basket.address} href={`/app/baskets/${basket.address}`}>
              <span className="basket-name">
                <BasketLogo name={basket.name} size="small" />
                <span>
                  <strong>{basket.name}</strong>
                  <small>{basket.symbol} · Base Local</small>
                </span>
              </span>
              <strong>${formatCompactNumber(basket.value)}</strong>
              <span className="positive">+{basket.change}%</span>
              <span>{basket.holdingsCount}</span>
              <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', fontSize: '12px' }}>
                <span>{basket.updated}</span>
                {!basket.isIndexed && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: '#eab308',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontWeight: 600,
                    }}
                    title="Submitted on-chain, waiting for network confirmation"
                  >
                    <span style={{ width: '10px', height: '10px', display: 'inline-flex' }}>
                      <AppIcon type="clock" />
                    </span>
                    Confirming...
                  </span>
                )}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
