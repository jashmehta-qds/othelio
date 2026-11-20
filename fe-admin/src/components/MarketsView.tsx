'use client';

import React, { useState } from 'react';
import { AdminAssetItem, AdminMarketItem } from '@othelio/shared';
import { CreateMarketModal } from './CreateMarketModal';
import { seriesFactoryAbi } from '@othelio/shared';
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { useAdminAuth } from '../context/AdminAuthContext';

interface MarketsViewProps {
  markets: AdminMarketItem[];
  assets: AdminAssetItem[];
  isLoading: boolean;
  onRefresh: () => void;
  isOwner: boolean;
}

export function MarketsView({ markets, assets, isLoading, onRefresh, isOwner }: MarketsViewProps) {
  const { factoryAddress } = useAdminAuth();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isConfigPending } = useWriteContract();
  const [configError, setConfigError] = useState<string | null>(null);
  const [isWaitingConfigReceipt, setIsWaitingConfigReceipt] = useState(false);
  const factory = factoryAddress as `0x${string}` | null;
  const { data: publicCreationEnabled, refetch: refetchCreationFlag } = useReadContract({
    address: factory || undefined,
    abi: seriesFactoryAbi,
    functionName: 'publicCreationEnabled',
    query: { enabled: Boolean(factory) },
  });
  const handleTogglePublicCreation = async () => {
    try {
      if (!factory || !publicClient || !address) throw new Error('Factory or owner wallet RPC is unavailable.');
      setConfigError(null);
      const request = await publicClient.simulateContract({
        address: factory,
        account: address,
        abi: seriesFactoryAbi,
        functionName: 'setPublicCreationEnabled',
        args: [!Boolean(publicCreationEnabled)],
      });
      const hash = await writeContractAsync(request.request);
      setIsWaitingConfigReceipt(true);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Creation flag transaction ${hash} reverted.`);
      await refetchCreationFlag();
    } catch (error: any) {
      setConfigError(error?.message || 'Failed to update public creation flag.');
    } finally {
      setIsWaitingConfigReceipt(false);
    }
  };
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'settled'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const filteredMarkets = markets.filter((m) => {
    if (filter === 'active') return !m.isExpired && !m.isSettled;
    if (filter === 'expired') return m.isExpired && !m.isSettled;
    if (filter === 'settled') return m.isSettled;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#292a27] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Risk Split Series Management</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Operator-launched markets on Base with verified reference rounds and deterministic fixing.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded bg-[#161715] hover:bg-[#292a27] border border-[#292a27] text-xs font-mono text-zinc-300 transition-colors"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-1.5 rounded bg-[#ff5729] hover:bg-[#ff6f47] text-black font-semibold text-xs font-mono tracking-wider uppercase transition-colors"
          >
            + Create Series
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[#292a27] bg-[#161715] p-4 text-xs font-mono text-zinc-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong>Public market creation: {publicCreationEnabled === undefined ? 'Loading' : publicCreationEnabled ? 'Enabled' : 'Disabled'}</strong>
            <p className="mt-1 text-zinc-500">The factory owner can change this onchain. Operator creation remains available while disabled.</p>
          </div>
          <button type="button" onClick={handleTogglePublicCreation}
            disabled={!isOwner || publicCreationEnabled === undefined || isConfigPending || isWaitingConfigReceipt}
            className="rounded bg-[#292a27] px-3 py-2 text-white disabled:opacity-50">
            {isConfigPending || isWaitingConfigReceipt ? 'Confirming…' : publicCreationEnabled ? 'Disable public creation' : 'Enable public creation'}
          </button>
        </div>
        {configError && <p className="mt-2 text-red-400">{configError}</p>}
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2 border-b border-[#292a27] pb-2 text-xs font-mono">
        {(['all', 'active', 'expired', 'settled'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1 rounded uppercase tracking-wider transition-colors ${
              filter === tab
                ? 'bg-[#292a27] text-white font-medium'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab} ({
              markets.filter((m) => {
                if (tab === 'active') return !m.isExpired && !m.isSettled;
                if (tab === 'expired') return m.isExpired && !m.isSettled;
                if (tab === 'settled') return m.isSettled;
                return true;
              }).length
            })
          </button>
        ))}
      </div>

      {/* Markets Table */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg overflow-hidden">
        {isLoading && markets.length === 0 ? (
          <div className="py-12 text-center text-xs font-mono text-zinc-500">
            Loading Risk Split markets...
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="py-12 text-center text-xs font-mono text-zinc-500">
            No series found matching filter &quot;{filter}&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#292a27] bg-[#10110f] text-zinc-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Series</th>
                  <th className="py-3 px-4">Underlying</th>
                  <th className="py-3 px-4">Floor / Cap</th>
                  <th className="py-3 px-4">Expiry</th>
                  <th className="py-3 px-4">Reference Round</th>
                  <th className="py-3 px-4">Fixing / Settled</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292a27] text-zinc-300">
                {filteredMarkets.map((market) => {
                  let statusBadge = (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-emerald-950/40 text-emerald-400 border-emerald-800">
                      ACTIVE
                    </span>
                  );
                  if (market.isSettled) {
                    statusBadge = (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-zinc-900 text-zinc-400 border-[#292a27]">
                        SETTLED
                      </span>
                    );
                  } else if (market.isExpired) {
                    statusBadge = (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-amber-950/40 text-amber-400 border-amber-800">
                        EXPIRED
                      </span>
                    );
                  }

                  return (
                    <tr key={market.seriesAddress} className="hover:bg-[#1c1d1a] transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">
                          {market.seriesAddress.slice(0, 6)}...{market.seriesAddress.slice(-4)}
                        </div>
                        <div className="text-[10px] text-zinc-500">Block #{market.lastIndexedBlock}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-200">{market.underlying.symbol}</div>
                        <div className="text-[10px] text-zinc-500">{market.underlying.decimals} dec</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-emerald-400 font-semibold">{market.floorFormatted}</div>
                        <div className="text-cyan-400">{market.capFormatted}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div>{new Date(market.expiryTimestamp * 1000).toLocaleDateString()}</div>
                        <div className="text-[10px] text-zinc-500">
                          {new Date(market.expiryTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          {market.referencePrice ? `$${(Number(market.referencePrice) / 1e8).toFixed(2)}` : '—'}
                        </div>
                        <div className="text-[10px] text-zinc-500 truncate max-w-[100px]">
                          #{market.referenceRoundId || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {market.isSettled ? (
                          <div>
                            <div className="font-semibold text-white">
                              ${(Number(market.settledPrice || 0) / 1e8).toFixed(2)}
                            </div>
                            <div className="text-[10px] text-zinc-500">Fixing #{market.settledRoundId}</div>
                          </div>
                        ) : (
                          <div className="text-zinc-500">Pending Expiry</div>
                        )}
                      </td>
                      <td className="py-3 px-4">{statusBadge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Creation Modal */}
      <CreateMarketModal
        assets={assets}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false);
          onRefresh();
        }}
        isOwner={isOwner}
      />
    </div>
  );
}
