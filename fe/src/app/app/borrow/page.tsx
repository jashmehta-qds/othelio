"use client";

import Link from "next/link";
import { useAccount, useChainId } from "wagmi";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { useBasketsList } from "@/hooks/useBaskets";
import { formatAddress } from "@/lib/baskets";

export default function LendingRecoveryPage() {
  const { address } = useAccount();
  const chainId = useChainId() || 31337;
  const { data, isLoading, error } = useBasketsList(chainId, address);

  return (
    <section className="basket-index" style={{ maxWidth: "1040px", margin: "0 auto", padding: "16px 0 48px" }}>
      <div className="dashboard-head">
        <div>
          <p className="eyebrow">Portfolio-only release</p>
          <h1>Lending recovery</h1>
          <p>New borrowing, collateral supply, and reinvestment are not offered in this app.</p>
        </div>
      </div>

      <section className="allocation-block" style={{ marginTop: "20px" }}>
        <div className="section-title">
          <div>
            <h2>Manage existing positions</h2>
            <p>Existing owner accounts remain unrestricted onchain. Choose a basket to view verified debt and collateral, then repay or release collateral through its original market.</p>
          </div>
        </div>

        {isLoading && <p role="status">Loading your baskets…</p>}
        {error && <p role="alert">Baskets could not be loaded. Existing positions may still exist onchain.</p>}
        {!isLoading && !error && (data?.data.length ?? 0) === 0 && (
          <p style={{ color: "var(--muted-ink)" }}>No baskets are available for this connected wallet.</p>
        )}
        <div style={{ display: "grid", gap: "10px", marginTop: "16px" }}>
          {(data?.data ?? []).map((basket) => (
            <Link
              key={`${basket.chain_id}:${basket.address}`}
              href={`/app/borrow/${basket.address}`}
              className="button-link"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "16px", border: "1px solid var(--line)", borderRadius: "12px", color: "var(--ink)", textDecoration: "none" }}
            >
              <span>
                <strong style={{ display: "block" }}>{basket.name}</strong>
                <small style={{ color: "var(--muted-ink)", fontFamily: "monospace" }}>{formatAddress(basket.address)}</small>
              </span>
              <span style={{ width: "18px", height: "18px", display: "inline-flex" }}><AppIcon type="arrow" /></span>
            </Link>
          ))}
        </div>
      </section>
    </section>
  );
}
