"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import type { BasketAction, MarketPosition } from "@/types/shared";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { useBasketsList, usePortfolioPositions } from "@/hooks/useBaskets";
import { AAVE_UI_ENABLED, CONTRACT_ADDRESSES, OTHELIO_PORTFOLIO_MODULE_ABI } from "@/lib/contracts";
import { formatAddress } from "@/lib/baskets";
import { recordLendingSubmission } from "@/lib/api";

type RecoveryKind = Extract<BasketAction, "REPAY" | "RELEASE_COLLATERAL">;
type TxState = { kind: RecoveryKind; hash?: `0x${string}`; message: string } | null;

function identityKey(position: MarketPosition) {
  const { chainId, basketAddress, protocol, marketAddress, assetAddress } = position.identity;
  return `${chainId}:${basketAddress}:${protocol}:${marketAddress}:${assetAddress}`.toLowerCase();
}

function displayAmount(value: string | null, decimals: number, symbol: string) {
  if (value === null) return "Unknown";
  const amount = Number(formatUnits(BigInt(value), decimals));
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;
}

function displayUsdE8(value: string | null) {
  if (value === null) return "Unknown";
  return `$${Number(formatUnits(BigInt(value), 8)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function BasketBorrowManagement({ basketId }: { basketId: string }) {
  const chainId = useChainId();
  const activeChainId = chainId;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isWalletPending } = useWriteContract();
  const { data: ownedBaskets, isLoading: isLoadingOwnership } = useBasketsList(activeChainId, isConnected ? address : undefined);
  const ownsBasket = Boolean(ownedBaskets?.data?.some((basket) =>
    basket.address.toLowerCase() === basketId.toLowerCase()
    && basket.controller.toLowerCase() === address?.toLowerCase(),
  ));
  const { data, isLoading, isFetching, error, refetch } = usePortfolioPositions(basketId, activeChainId, ownsBasket);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [txState, setTxState] = useState<TxState>(null);

  const snapshot = data?.data;
  const capabilities = data?.capabilities;
  const tokensByAddress = useMemo(
    () => new Map((snapshot?.tokens ?? []).map((token) => [token.assetAddress.toLowerCase(), token])),
    [snapshot?.tokens],
  );

  if (!AAVE_UI_ENABLED) {
    return (
      <section className="app-page-frame">
        <h1 className="page-title">Aave is not enabled yet</h1>
        <p style={{ color: "var(--muted-ink)", marginTop: "10px" }}>Lending actions remain unavailable pending launch review.</p>
      </section>
    );
  }

  if (!ownsBasket) {
    return (
      <section className="app-page-frame">
        <h1 className="page-title">{isLoadingOwnership ? "Checking basket access…" : "Lending recovery unavailable"}</h1>
        <p style={{ color: "var(--muted-ink)", marginTop: "10px" }}>
          {isLoadingOwnership
            ? "Verifying the connected wallet owns this basket."
            : "Connect the owner wallet to view or manage an existing lending position."}
        </p>
      </section>
    );
  }

  const submitRecovery = async (kind: RecoveryKind, position: MarketPosition) => {
    const key = `${identityKey(position)}:${kind}`;
    const token = tokensByAddress.get(position.identity.assetAddress.toLowerCase());
    const amount = inputs[key]?.trim();
    const capability = capabilities?.actions[kind];
    const moduleAddress = CONTRACT_ADDRESSES[activeChainId as keyof typeof CONTRACT_ADDRESSES]?.module;

    if (!isConnected || !address) {
      setTxState({ kind, message: "Connect the owner wallet before preparing a recovery transaction." });
      return;
    }
    if (!amount || Number(amount) <= 0 || !token) {
      setTxState({ kind, message: "Enter a valid amount for this exact market position." });
      return;
    }
    if (!capability || capability.availability !== "AVAILABLE") {
      setTxState({ kind, message: capability?.reason ?? "This recovery action has not been verified as available." });
      return;
    }
    if (position.identity.protocol !== "AAVE_V3") {
      setTxState({ kind, message: `Recovery for ${position.identity.protocol} requires its protocol adapter.` });
      return;
    }
    if (!moduleAddress || /^0x0{40}$/i.test(moduleAddress) || !publicClient) {
      setTxState({ kind, message: "The recovery module is unavailable on this network." });
      return;
    }

    try {
      const amountBaseUnits = parseUnits(amount, token.decimals);
      const debt = position.accruedDebtAmountBaseUnits === null ? null : BigInt(position.accruedDebtAmountBaseUnits);
      const supplied = position.suppliedAmountBaseUnits === null ? null : BigInt(position.suppliedAmountBaseUnits);
      const liquid = token.liquidAmountBaseUnits === null ? null : BigInt(token.liquidAmountBaseUnits);
      if (kind === "REPAY" && (debt === null || liquid === null || amountBaseUnits > debt || amountBaseUnits > liquid)) {
        setTxState({ kind, message: "Repayment must be a known positive amount no greater than both this exact debt and the basket's known balance of the debt asset." });
        return;
      }
      if (kind === "RELEASE_COLLATERAL" && (supplied === null || debt === null || debt !== BigInt(0) || amountBaseUnits > supplied)) {
        setTxState({ kind, message: "Collateral release requires verified zero debt and a specific amount no greater than the known supplied balance. Full withdrawal is not inferred." });
        return;
      }
      setTxState({ kind, message: "Waiting for wallet approval…" });
      const hash = kind === "REPAY"
        ? await writeContractAsync({
            address: moduleAddress,
            abi: OTHELIO_PORTFOLIO_MODULE_ABI,
            functionName: "repayAave",
            args: [basketId as `0x${string}`, position.identity.assetAddress as `0x${string}`, amountBaseUnits],
          })
        : await writeContractAsync({
            address: moduleAddress,
            abi: OTHELIO_PORTFOLIO_MODULE_ABI,
            functionName: "withdrawAaveCollateral",
            args: [basketId as `0x${string}`, position.identity.assetAddress as `0x${string}`, amountBaseUnits, BigInt("1250000000000000000")],
          });

      const submission = await recordLendingSubmission(basketId, {
        chainId: activeChainId,
        action: kind === "REPAY" ? "REPAY" : "WITHDRAW",
        assetAddress: position.identity.assetAddress,
        amount: amountBaseUnits.toString(),
        winningProvider: "AaveV3",
        winningPool: position.identity.marketAddress,
        txHash: hash,
      });
      setTxState({ kind, hash, message: submission.lifecycle.status === "SUBMITTED" ? "Submitted to the canonical lifecycle. Waiting for an onchain receipt…" : `Lifecycle is ${submission.lifecycle.status}. Refreshing receipt state…` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setTxState({ kind, hash, message: "The transaction reverted. Canonical positions were not changed." });
        return;
      }
      await refetch();
      setTxState({ kind, hash, message: "Receipt succeeded and positions were refreshed. Lending history remains submitted until canonical receipt reconciliation confirms it." });
      setInputs((current) => ({ ...current, [key]: "" }));
    } catch (submissionError) {
      setTxState({
        kind,
        message: submissionError instanceof Error ? submissionError.message : "The recovery transaction could not be completed.",
      });
    }
  };

  return (
    <section className="app-page-frame">
      <div className="dashboard-head">
        <div className="crumbs"><Link href="/app/baskets">Baskets</Link><i>/</i><strong>Lending recovery</strong></div>
      </div>

      <section className="allocation-block" style={{ marginTop: "16px" }}>
        <div className="section-title">
          <div>
            <h1 className="page-title">Existing lending positions</h1>
            <p className="page-description">New borrowing is not offered in this app. Existing owner accounts remain unrestricted onchain; verified repayment and collateral release stay available here.</p>
          </div>
          <button onClick={() => refetch()} disabled={isFetching} aria-label="Refresh canonical positions">
            <AppIcon type="sync" /> {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {isLoading && <p role="status">Loading canonical positions…</p>}
        {error && (
          <div role="alert" style={{ padding: "14px", border: "1px solid rgba(239,68,68,.35)", borderRadius: "10px" }}>
            Positions could not be loaded. Debt and collateral remain unknown until the endpoint is available.
          </div>
        )}

        {snapshot && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", margin: "18px 0" }}>
              {[
                ["Gross assets", displayUsdE8(snapshot.grossAssetsUsdE8)],
                ["Accrued debt", displayUsdE8(snapshot.accruedDebtUsdE8)],
                ["Equity", displayUsdE8(snapshot.equityUsdE8)],
              ].map(([label, value]) => (
                <div key={label} style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px" }}>
                  <small style={{ color: "var(--muted-ink)" }}>{label}</small>
                  <strong style={{ display: "block", marginTop: "6px", fontSize: "18px" }}>{value}</strong>
                </div>
              ))}
            </div>

            <p style={{ color: "var(--muted-ink)", fontSize: "12px" }}>
              Read {snapshot.readCompleteness.toLowerCase()} · valuation {snapshot.valuationStatus.toLowerCase()} · block {snapshot.blockNumber || "unknown"}
            </p>
            {snapshot.issues.length > 0 && (
              <div role="status" style={{ padding: "12px 14px", background: "rgba(234,179,8,.08)", border: "1px solid rgba(234,179,8,.25)", borderRadius: "10px", marginBottom: "16px" }}>
                {snapshot.issues.join(" · ")}
              </div>
            )}

            {snapshot.markets.length === 0 ? (
              <div style={{ padding: "28px 0", color: "var(--muted-ink)" }}>
                {snapshot.readCompleteness === "COMPLETE"
                  ? "No existing lending positions were found."
                  : "Lending positions are unknown. An empty result is not proof of zero debt."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px", marginTop: "20px" }}>
                {snapshot.markets.map((position) => {
                  const key = identityKey(position);
                  const token = tokensByAddress.get(position.identity.assetAddress.toLowerCase());
                  const symbol = token?.symbol ?? formatAddress(position.identity.assetAddress);
                  const decimals = token?.decimals ?? 18;
                  const repayKey = `${key}:REPAY`;
                  const releaseKey = `${key}:RELEASE_COLLATERAL`;
                  const repayCapability = capabilities?.actions.REPAY;
                  const releaseCapability = capabilities?.actions.RELEASE_COLLATERAL;
                  const knownLiquid = token?.liquidAmountBaseUnits;
                  const canRepay = position.accruedDebtAmountBaseUnits !== null && BigInt(position.accruedDebtAmountBaseUnits) > BigInt(0) && knownLiquid !== null && knownLiquid !== undefined && knownLiquid !== "0";
                  const canRelease = position.suppliedAmountBaseUnits !== null && BigInt(position.suppliedAmountBaseUnits) > BigInt(0) && position.accruedDebtAmountBaseUnits === "0";
                  const adapterSupported = position.identity.protocol === "AAVE_V3";

                  return (
                    <article key={key} style={{ border: "1px solid var(--line)", borderRadius: "14px", padding: "18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
                        <div>
                          <strong>{position.identity.protocol} · {symbol}</strong>
                          <small style={{ display: "block", color: "var(--muted-ink)", fontFamily: "monospace", marginTop: "5px" }}>
                            Market {formatAddress(position.identity.marketAddress)} · Asset {formatAddress(position.identity.assetAddress)}
                          </small>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ display: "block" }}>Supplied {displayAmount(position.suppliedAmountBaseUnits, decimals, symbol)}</span>
                          <span style={{ display: "block" }}>Debt {displayAmount(position.accruedDebtAmountBaseUnits, decimals, symbol)}</span>
                        </div>
                      </div>

                      {!adapterSupported && <p role="status">This exact position is visible, but its recovery adapter is not available.</p>}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginTop: "16px" }}>
                        <label style={{ display: "grid", gap: "7px" }}>
                          <span>Repay {symbol}</span>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <input value={inputs[repayKey] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [repayKey]: event.target.value }))} inputMode="decimal" placeholder="0.00" aria-label={`Repay amount for ${symbol}`} />
                            <button onClick={() => submitRecovery("REPAY", position)} disabled={isWalletPending || !canRepay || !adapterSupported || repayCapability?.availability !== "AVAILABLE"}>Repay</button>
                          </div>
                          <small style={{ color: "var(--muted-ink)" }}>{repayCapability?.reason ?? "Capability status unavailable."} Debt tokens must already be held by the basket.</small>
                        </label>

                        <label style={{ display: "grid", gap: "7px" }}>
                          <span>Release {symbol}</span>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <input value={inputs[releaseKey] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [releaseKey]: event.target.value }))} inputMode="decimal" placeholder="0.00" aria-label={`Collateral release amount for ${symbol}`} />
                            <button onClick={() => submitRecovery("RELEASE_COLLATERAL", position)} disabled={isWalletPending || !canRelease || !adapterSupported || releaseCapability?.availability !== "AVAILABLE"}>Release</button>
                          </div>
                          <small style={{ color: "var(--muted-ink)" }}>{releaseCapability?.reason ?? "Capability status unavailable."}</small>
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {txState && (
          <div role="status" aria-live="polite" style={{ marginTop: "16px", padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "10px" }}>
            <strong>{txState.kind === "REPAY" ? "Repayment" : "Collateral release"}</strong>
            <span style={{ display: "block", marginTop: "4px" }}>{txState.message}</span>
            {txState.hash && <small style={{ display: "block", marginTop: "5px", fontFamily: "monospace", wordBreak: "break-all" }}>{txState.hash}</small>}
          </div>
        )}
      </section>
    </section>
  );
}
