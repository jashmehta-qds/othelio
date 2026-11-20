'use client';

import React from 'react';
import { AdminOperationsResponse, AdminOperationQueueItem, settlementAdapterAbi } from '@othelio/shared';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { BaseError } from 'viem';
import { useAdminAuth } from '../context/AdminAuthContext';

interface OperationsViewProps {
  operations: AdminOperationsResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function OperationsView({ operations, isLoading, onRefresh }: OperationsViewProps) {
  const { expiryQueue, settlementAuditTrail, incidentAlerts, asOfBlock, riskSplitIndexer } = operations || {
    expiryQueue: [],
    settlementAuditTrail: [],
    incidentAlerts: [],
    asOfBlock: 0,
    riskSplitIndexer: undefined,
  };

  const { writeContractAsync, isPending } = useWriteContract();
  const { address } = useAccount();
  const { chainId } = useAdminAuth();
  const publicClient = usePublicClient({ chainId });
  const [isWaitingReceipt, setIsWaitingReceipt] = React.useState(false);
  const [attempt, setAttempt] = React.useState<{ series: string; message: string; confirmed: boolean } | null>(null);

  const handleSettle = async (item: AdminOperationQueueItem) => {
    if (!item.settlementReady || !item.settlementPreviewTx || isWaitingReceipt || isPending) return;

    setIsWaitingReceipt(true);
    setAttempt(null);
    try {
      if (!publicClient || !address || item.settlementPreviewTx.chainId !== chainId) throw new Error('Connect a wallet on the authenticated chain first.');
      const tx = item.settlementPreviewTx;
      const request = await publicClient.simulateContract({
        account: address,
        address: tx.target,
        abi: settlementAdapterAbi,
        functionName: 'settleSeries',
        args: [item.seriesAddress as `0x${string}`, BigInt(item.candidateFixingRound!.roundId)],
      });
      const hash = await writeContractAsync(request.request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Settlement transaction ${hash} reverted.`);
      setAttempt({ series: item.seriesAddress, message: 'Settlement confirmed onchain.', confirmed: true });
    } catch (error) {
      const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'Settlement failed.';
      setAttempt({ series: item.seriesAddress, message: message.split('\n', 1)[0].slice(0, 240), confirmed: false });
    } finally {
      setIsWaitingReceipt(false);
      onRefresh();
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#292a27] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Operations & Settlement Monitor</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Automated fixing verification, settlement execution queue, and protocol audit trail.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="self-start sm:self-auto px-3 py-1.5 rounded bg-[#161715] hover:bg-[#292a27] border border-[#292a27] text-xs font-mono text-zinc-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Incident & Health Alerts Banner */}
      {incidentAlerts && incidentAlerts.length > 0 && (
        <div className="space-y-2">
          {incidentAlerts.map((alert, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between ${
                alert.severity === 'ERROR'
                  ? 'bg-red-950/40 text-red-300 border-red-800'
                  : 'bg-amber-950/40 text-amber-300 border-amber-800'
              }`}
            >
              <span>⚠ {alert.message}</span>
              <span className="text-[10px] text-zinc-400">{new Date(alert.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Indexers Health & Independent Cursor Status */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wider uppercase font-mono text-white">
            Protocol Indexer Subsystems
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Independent block synchronization cursors and pause state monitors.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          {/* Main & Upside Indexer */}
          <div className="p-4 rounded-lg bg-[#10110f] border border-[#292a27] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Main / Upside Indexer</span>
              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-800">
                ACTIVE
              </span>
            </div>
            <div className="text-zinc-400 flex justify-between">
              <span>Current Block:</span>
              <span className="text-white font-bold">#{asOfBlock || '—'}</span>
            </div>
            <p className="text-[10px] text-zinc-500 pt-1 border-t border-[#292a27]/50">
              Continuously indexes Baskets, asset price observations, and Upside rounds.
            </p>
          </div>

          {/* Risk Split Indexer */}
          <div className="p-4 rounded-lg bg-[#10110f] border border-[#292a27] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Risk Split Indexer</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] border ${
                  riskSplitIndexer?.status === 'PAUSED'
                    ? 'bg-amber-950/40 text-amber-400 border-amber-800'
                    : 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                }`}
              >
                {riskSplitIndexer?.status || 'ACTIVE'}
              </span>
            </div>
            <div className="text-zinc-400 flex justify-between">
              <span>Resume Cursor:</span>
              <span className="text-white font-bold">
                {riskSplitIndexer ? `#${riskSplitIndexer.lastIndexedBlock}` : '—'}
              </span>
            </div>
            <div className="text-zinc-400 flex justify-between">
              <span>Block Lag:</span>
              <span className={riskSplitIndexer && riskSplitIndexer.blockLag > 0 ? 'text-amber-400' : 'text-zinc-300'}>
                {riskSplitIndexer ? `${riskSplitIndexer.blockLag} blocks` : '—'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 pt-1 border-t border-[#292a27]/50">
              {riskSplitIndexer?.isPaused
                ? 'PAUSED via RISK_SPLIT_INDEXING_ENABLED=false. Cursor safely preserved without affecting other protocols.'
                : 'Active independent cursor (worker: risksplit).'}
            </p>
          </div>
        </div>
      </div>

      {/* Expiry & Settlement Queue */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wider uppercase font-mono text-white">
            Settlement Action Queue ({expiryQueue.length})
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Series approaching or past expiry requiring fixing verification and settlement execution.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#292a27] text-zinc-500 uppercase tracking-wider">
                <th className="pb-3">Series</th>
                <th className="pb-3">Underlying</th>
                <th className="pb-3">Expiry</th>
                <th className="pb-3">Fixing Candidate</th>
                <th className="pb-3">Pre-Expiry Verified</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292a27] text-zinc-300">
              {expiryQueue.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No series pending settlement.
                  </td>
                </tr>
              ) : (
                expiryQueue.map((item) => (
                  <tr key={item.seriesAddress} className="hover:bg-[#1c1d1a]">
                    <td className="py-3 font-semibold text-white">
                      {item.seriesAddress.slice(0, 6)}...{item.seriesAddress.slice(-4)}
                    </td>
                    <td className="py-3 text-zinc-200">{item.underlyingSymbol}</td>
                    <td className="py-3">
                      <div>{new Date(item.expiryTimestamp * 1000).toLocaleDateString()}</div>
                      <div className={`text-[10px] ${item.isExpired ? 'text-amber-400' : 'text-zinc-500'}`}>
                        {item.isExpired ? 'Expired' : 'Active'}
                      </div>
                    </td>
                    <td className="py-3">
                      {item.candidateFixingRound ? (
                        <div>
                          <div className="font-semibold text-white">{item.candidateFixingRound.formattedPrice}</div>
                          <div className="text-[10px] text-zinc-500">Round #{item.candidateFixingRound.roundId}</div>
                        </div>
                      ) : (
                        <span className="text-zinc-500">Awaiting Observation</span>
                      )}
                    </td>
                    <td className="py-3">
                      {item.candidateFixingRound?.isPreExpiry ? (
                        <span className="text-emerald-400">✓ Verified Pre-Expiry</span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {item.isExpired && item.settlementReady && !(attempt?.confirmed && attempt.series === item.seriesAddress) && (
                        <button
                          onClick={() => handleSettle(item)}
                          disabled={isPending || isWaitingReceipt}
                          className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-colors disabled:opacity-50"
                        >
                          {isPending || isWaitingReceipt ? 'Settling...' : attempt?.series === item.seriesAddress ? 'Retry Settlement' : 'Settle Series'}
                        </button>
                      )}
                      {item.settlementBlocker && <div className="max-w-60 ml-auto text-zinc-400">{item.settlementBlocker}</div>}
                      {attempt?.series === item.seriesAddress && <div role="status" className="max-w-60 ml-auto break-words">{attempt.message}</div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settlement Audit Trail */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wider uppercase font-mono text-white">
            Settlement Audit Trail ({settlementAuditTrail.length})
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Confirmed onchain settlements with immutable fixing proofs and audit status.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#292a27] text-zinc-500 uppercase tracking-wider">
                <th className="pb-3">Series</th>
                <th className="pb-3">Settled Price</th>
                <th className="pb-3">Fixing Round</th>
                <th className="pb-3">Observed At</th>
                <th className="pb-3">Audit Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292a27] text-zinc-300">
              {settlementAuditTrail.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    No settled series in audit trail yet.
                  </td>
                </tr>
              ) : (
                settlementAuditTrail.map((audit) => (
                  <tr key={audit.seriesAddress} className="hover:bg-[#1c1d1a]">
                    <td className="py-3 font-semibold text-white">
                      {audit.seriesAddress.slice(0, 6)}...{audit.seriesAddress.slice(-4)}
                    </td>
                    <td className="py-3 font-semibold text-emerald-400">{audit.settledPrice}</td>
                    <td className="py-3 text-zinc-300">#{audit.settledRoundId}</td>
                    <td className="py-3 text-zinc-400">
                      {audit.settledFeedUpdatedAt
                        ? new Date(audit.settledFeedUpdatedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] border bg-emerald-950/40 text-emerald-400 border-emerald-800">
                        {audit.auditStatus}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
