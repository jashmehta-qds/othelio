"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useConnect } from "wagmi";
import { useBasketsList } from "@/hooks/useBaskets";
import { formatCompactNumber } from "@/lib/baskets";
import { BasketLogo } from "./BasketLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { CreateBasketModal } from "@/components/CreateBasketModal";

export function BasketList() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  
  // Filter baskets strictly by the connected wallet controller address
  const { data: apiResponse, isLoading } = useBasketsList(31337, address);
  const indexedBaskets = apiResponse?.data ?? [];

  const displayBaskets = indexedBaskets.map(b => ({
    name: b.name,
    symbol: b.symbol || 'OTH',
    value: (b as any).seed_amount ? Number((b as any).seed_amount) : 1000,
    change: 0.0,
    updated: new Date(b.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    address: b.address,
    holdingsCount: 4,
  }));

  const totalPortfolioValue = displayBaskets.reduce((acc, b) => acc + b.value, 0);

  return (
    <section className="basket-index">
      <CreateBasketModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <header className="index-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Your baskets</h1>
          <p>Baskets created and managed by your wallet.</p>
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
          {isConnected ? `$${formatCompactNumber(totalPortfolioValue)}` : "$0.00"}
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
        {!isConnected ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--muted-ink)' }}>
            <p style={{ fontSize: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--ink)' }}>
              <span style={{ width: '16px', height: '16px', display: 'inline-block', color: 'var(--muted-ink)' }}>
                <AppIcon type="lock" />
              </span>
              <b>Not Connected</b>
            </p>
            <p style={{ fontSize: '12px' }}>
              Connect your Web3 wallet to view and manage your created baskets.
            </p>
          </div>
        ) : isLoading ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', opacity: 0.6, fontSize: '13px' }}>
            Loading your created baskets...
          </div>
        ) : displayBaskets.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--muted-ink)' }}>
            <p style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>
              No Baskets Created Yet
            </p>
            <p style={{ fontSize: '12px' }}>
              Your connected wallet (<code>{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}</code>) has not deployed any baskets on this network yet.
            </p>
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
              <span>{basket.updated}</span>
              <span aria-hidden="true">→</span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}


