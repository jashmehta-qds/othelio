'use client';

import React, { useState } from 'react';
import { AdminAssetItem, AdminMarketItem } from '@othelio/shared';
import { CreateMarketModal } from './CreateMarketModal';
import { SeriesMetrics } from './SeriesMetrics';

interface MarketsViewProps {
  markets: AdminMarketItem[];
  assets: AdminAssetItem[];
  isLoading: boolean;
  onRefresh: () => void;
  isOwner: boolean;
}

export function MarketsView({ markets, assets, isLoading, onRefresh, isOwner }: MarketsViewProps) {
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'settled' | 'failed'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  const marketStatus = (m: AdminMarketItem) => m.isSettled ? 'settled'
    : m.operationsAuditStatus === 'SETTLEMENT_FAILED' ? 'failed' : m.isExpired ? 'expired' : 'active';
  const filteredMarkets = markets.filter((m) => filter === 'all' || marketStatus(m) === filter);

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
            disabled={!isOwner}
            className="px-4 py-1.5 rounded bg-[#ff5729] hover:bg-[#ff6f47] text-black font-semibold text-xs font-mono tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            + Create Series
          </button>
        </div>
      </div>
      {confirmation && <p role="status" className="break-all text-xs font-mono text-emerald-400">{confirmation}</p>}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[#292a27] pb-2 text-xs font-mono">
        {(['all', 'active', 'expired', 'settled', 'failed'] as const).map((tab) => (
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
              markets.filter((m) => tab === 'all' || marketStatus(m) === tab).length
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
                  <th className="py-3 px-4">Status / Details</th>
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
                  } else if (marketStatus(market) === 'failed') {
                    statusBadge = <span className="text-red-400">SETTLEMENT FAILED</span>;
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
                        <div className="text-[10px] text-zinc-500">Indexed block #{market.lastIndexedBlock}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-200">{assets.find((asset) => asset.address.toLowerCase() === market.underlying.address.toLowerCase())?.symbol ?? market.underlying.symbol}</div>
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
                              {market.settledPrice ? `$${(Number(market.settledPrice) / 1e8).toFixed(2)}` : 'Not indexed'}
                            </div>
                            <div className="text-[10px] text-zinc-500">Fixing #{market.settledRoundId}</div>
                          </div>
                        ) : (
                          <div className="text-zinc-500">{market.isExpired ? 'Awaiting settlement' : 'Pending expiry'}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {statusBadge}
                        <details className="mt-2 max-w-sm space-y-1 break-all text-xs text-zinc-400">
                          <summary className="cursor-pointer">Indexed history and metrics</summary>
                          <div>Series: {market.seriesAddress}</div>
                          <div>Reference feed: {market.referenceFeed ?? 'Unavailable'} ({market.referenceBlock ? `block #${market.referenceBlock}` : 'block unavailable'})</div>
                          <div>Fixing update: {market.settledFeedUpdatedAt ?? 'Unavailable'}</div>
                          <div>Protected token: {market.protectedTokenAddress ?? 'Unavailable'}</div>
                          <div>Upside token: {market.upsideTokenAddress ?? 'Unavailable'}</div>
                          <div>Audit: {market.operationsAuditStatus}{market.operationsAuditNote && ` — ${market.operationsAuditNote}`}</div>
                          <SeriesMetrics metrics={market.metrics} claims={['Protected', 'Upside']} />
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {isOwner && isModalOpen && <CreateMarketModal
        assets={assets}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={(message) => {
          setConfirmation(message);
          setIsModalOpen(false);
          onRefresh();
        }}
        isOwner={isOwner}
      />}
    </div>
  );
}
