'use client';

import React, { useState } from 'react';
import styles from './UpsideMarkets.module.css';
import {
  useUpsideUserOrders,
  useUpsideUserPositions,
  submitCancelIntent,
} from './useUpside';
import { useAccount, usePublicClient, useSendTransaction } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { formatUnits } from 'viem';

interface UpsideMyOrdersProps {
  chainId?: number;
  seriesAddress?: string;
}

export function UpsideMyOrders({
  chainId = 8453,
  seriesAddress,
}: UpsideMyOrdersProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();

  const [cancellingHash, setCancellingHash] = useState<string | null>(null);

  const {
    data: ordersData,
    isLoading: isLoadingOrders,
    refetch: refetchOrders,
  } = useUpsideUserOrders(chainId, address);

  const {
    data: positionsData,
    isLoading: isLoadingPositions,
    refetch: refetchPositions,
  } = useUpsideUserPositions(chainId, address);

  if (!isConnected || !address) {
    return null;
  }

  const allOrders = ordersData?.data || [];
  const activeOrders = allOrders.filter((o) => {
    if (seriesAddress && o.seriesAddress.toLowerCase() !== seriesAddress.toLowerCase()) {
      return false;
    }
    const remaining = o.side === 'BUY' ? o.remainingTakerAmount : o.remainingMakerAmount;
    return (
      o.orderStatus === 'FILLABLE' &&
      !o.isLocallyHidden &&
      BigInt(remaining || '0') > BigInt(0)
    );
  });

  const allPositions = positionsData?.data || [];
  const relevantPositions = allPositions.filter((p) => {
    if (seriesAddress && p.seriesAddress.toLowerCase() !== seriesAddress.toLowerCase()) {
      return false;
    }
    return (
      BigInt(p.upsideBalance || '0') > BigInt(0) ||
      BigInt(p.residualBalance || '0') > BigInt(0) ||
      BigInt(p.totalMinted || '0') > BigInt(0)
    );
  });

  const handleCancel = async (orderHash: string) => {
    if (!address) return;
    setCancellingHash(orderHash);

    try {
      // 1. Submit cancel intent to backend (locally hides order)
      const res = await submitCancelIntent(orderHash, address);

      // 2. Execute onchain cancellation if transaction data returned
      if (res?.cancelTransactionData?.to && res?.cancelTransactionData?.data && publicClient) {
        const hash = await sendTransactionAsync({
          to: res.cancelTransactionData.to as `0x${string}`,
          data: res.cancelTransactionData.data as `0x${string}`,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      // 3. Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['upside-user-orders'] });
      queryClient.invalidateQueries({ queryKey: ['upside-orderbook'] });
    } catch (err: any) {
      console.error('Cancel order failed:', err);
      alert(`Cancel order failed: ${err?.message || err}`);
    } finally {
      setCancellingHash(null);
    }
  };

  const handleRefresh = () => {
    refetchOrders();
    refetchPositions();
  };

  return (
    <div className={styles.ordersPanel}>
      <div className={styles.ordersHeader}>
        <h3>Your Orders & Balances</h3>
        <button
          type="button"
          onClick={handleRefresh}
          className={styles.refreshButton}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Balances / Positions Section */}
      {relevantPositions.length > 0 && (
        <div className="mb-6">
          <div className="text-xs uppercase font-bold text-zinc-400 mb-2">
            Your Active Claims & Collateral
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.ordersTable}>
              <thead>
                <tr>
                  <th>Series</th>
                  <th>Upside Claim</th>
                  <th>Residual Claim</th>
                  <th>Total Minted</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {relevantPositions.map((pos) => {
                  const upFormatted = (Number(formatUnits(BigInt(pos.upsideBalance || '0'), 8))).toFixed(4);
                  const resFormatted = (Number(formatUnits(BigInt(pos.residualBalance || '0'), 8))).toFixed(4);
                  const mintedFormatted = (Number(formatUnits(BigInt(pos.totalMinted || '0'), 8))).toFixed(4);
                  const shortSeries = `${pos.seriesAddress.slice(0, 6)}...${pos.seriesAddress.slice(-4)}`;

                  return (
                    <tr key={pos.seriesAddress}>
                      <td className="font-mono text-zinc-300">{shortSeries}</td>
                      <td className="font-semibold text-emerald-400">{upFormatted} UP</td>
                      <td className="font-semibold text-amber-400">{resFormatted} RES</td>
                      <td className="text-zinc-400">{mintedFormatted} tokens</td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            pos.isSettled ? 'bg-zinc-800 text-zinc-400' : 'bg-emerald-950/60 text-emerald-400'
                          }`}
                        >
                          {pos.isSettled ? 'Settled' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Open Limit Orders Section */}
      <div>
        <div className="text-xs uppercase font-bold text-zinc-400 mb-2">
          Open Limit Orders ({activeOrders.length})
        </div>
        {isLoadingOrders && activeOrders.length === 0 ? (
          <div className={styles.emptyStateText}>Loading open orders...</div>
        ) : activeOrders.length === 0 ? (
          <div className={styles.emptyStateText}>
            No open limit orders for this market.
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.ordersTable}>
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Claim</th>
                  <th>Limit Price</th>
                  <th>Remaining</th>
                  <th>Expires</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeOrders.map((ord) => {
                  const remainingClaims =
                    ord.side === 'BUY'
                      ? Number(formatUnits(BigInt(ord.remainingTakerAmount || '0'), 8)).toFixed(4)
                      : Number(formatUnits(BigInt(ord.remainingMakerAmount || '0'), 8)).toFixed(4);

                  const expiryDate = new Date(ord.expiryTimestamp * 1000).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <tr key={ord.orderHash}>
                      <td>
                        <span className={ord.side === 'BUY' ? styles.sideBuyText : styles.sideSellText}>
                          {ord.side}
                        </span>
                      </td>
                      <td className="font-semibold text-zinc-300">{ord.claimType}</td>
                      <td className="font-bold text-white">${ord.priceUsd}</td>
                      <td>{remainingClaims}</td>
                      <td className="text-zinc-400">{expiryDate}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => handleCancel(ord.orderHash)}
                          disabled={cancellingHash === ord.orderHash}
                          className={styles.cancelBtn}
                        >
                          {cancellingHash === ord.orderHash ? 'Cancelling...' : 'Cancel'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
