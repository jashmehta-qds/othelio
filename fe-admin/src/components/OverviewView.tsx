'use client';

import React from 'react';
import { AdminOverviewResponse } from '@othelio/shared';

interface OverviewViewProps {
  overview: AdminOverviewResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function OverviewView({ overview, isLoading, onRefresh }: OverviewViewProps) {
  if (isLoading && !overview) {
    return (
      <div className="py-12 flex justify-center items-center text-zinc-500 font-mono text-sm">
        Loading operator overview...
      </div>
    );
  }

  const { activeWallets, basketsCount, supportedAssetsCount, riskSplit, governedContracts, indexerHealth, asOfBlock } =
    overview || {
      activeWallets: { last24h: 0, last7d: 0, last30d: 0, allTime: 0 },
      basketsCount: 0,
      supportedAssetsCount: 0,
      riskSplit: {
        totalSeries: 0,
        openSeries: 0,
        expiredSeries: 0,
        settledSeries: 0,
        totalMintVolumeUnderlying: '0',
        totalRedemptionVolumeUnderlying: '0',
        activeCollateralUnderlying: '0',
        failedSettlementCount: 0,
        indexingAlerts: 0,
      },
      governedContracts: {
        factory: {
          address: '—',
          owner: '—',
          pendingOwner: null,
          publicCreationEnabled: false,
        },
      },
      indexerHealth: {
        isFresh: true,
        observedHeadBlock: 0,
        lastIndexedBlock: 0,
        blockLag: 0,
      },
      asOfBlock: 0,
    };

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#292a27] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">System Overview</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Confirmed protocol state as of block #{asOfBlock}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="self-start sm:self-auto px-3 py-1.5 rounded bg-[#161715] hover:bg-[#292a27] border border-[#292a27] text-xs font-mono text-zinc-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Wallets Card */}
        <div className="bg-[#161715] border border-[#292a27] rounded-lg p-5">
          <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Active Wallets</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{activeWallets.last24h}</span>
            <span className="text-xs text-zinc-400 font-mono">24h</span>
          </div>
          <div className="mt-4 pt-3 border-t border-[#292a27] grid grid-cols-3 gap-2 text-xs font-mono">
            <div>
              <div className="text-zinc-500">7D</div>
              <div className="text-zinc-200 mt-0.5">{activeWallets.last7d}</div>
            </div>
            <div>
              <div className="text-zinc-500">30D</div>
              <div className="text-zinc-200 mt-0.5">{activeWallets.last30d}</div>
            </div>
            <div>
              <div className="text-zinc-500">ALL</div>
              <div className="text-zinc-200 mt-0.5">{activeWallets.allTime}</div>
            </div>
          </div>
        </div>

        {/* Risk Split Markets Card */}
        <div className="bg-[#161715] border border-[#292a27] rounded-lg p-5">
          <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Risk Split Series</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">{riskSplit.openSeries}</span>
            <span className="text-xs text-zinc-400 font-mono">Open</span>
          </div>
          <div className="mt-4 pt-3 border-t border-[#292a27] grid grid-cols-3 gap-2 text-xs font-mono">
            <div>
              <div className="text-zinc-500">TOTAL</div>
              <div className="text-zinc-200 mt-0.5">{riskSplit.totalSeries}</div>
            </div>
            <div>
              <div className="text-zinc-500">EXPIRED</div>
              <div className="text-zinc-200 mt-0.5">{riskSplit.expiredSeries}</div>
            </div>
            <div>
              <div className="text-zinc-500">SETTLED</div>
              <div className="text-zinc-200 mt-0.5">{riskSplit.settledSeries}</div>
            </div>
          </div>
        </div>

        {/* Collateral & Activity */}
        <div className="bg-[#161715] border border-[#292a27] rounded-lg p-5">
          <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Baskets & Assets</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{basketsCount}</span>
            <span className="text-xs text-zinc-400 font-mono">Baskets</span>
          </div>
          <div className="mt-4 pt-3 border-t border-[#292a27] flex justify-between text-xs font-mono">
            <div>
              <div className="text-zinc-500">B20 ASSETS</div>
              <div className="text-zinc-200 mt-0.5">{supportedAssetsCount} Verified</div>
            </div>
            <div>
              <div className="text-zinc-500">ALERTS</div>
              <div className="text-zinc-200 mt-0.5">
                {riskSplit.failedSettlementCount > 0 ? (
                  <span className="text-red-400">{riskSplit.failedSettlementCount} Failed</span>
                ) : (
                  <span className="text-emerald-400">0 None</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Indexer Sync Health */}
        <div className="bg-[#161715] border border-[#292a27] rounded-lg p-5">
          <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Indexer Health</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                indexerHealth.isFresh ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {indexerHealth.isFresh ? 'HEALTHY' : 'LAGGING'}
            </span>
          </div>
          <div className="mt-4 pt-3 border-t border-[#292a27] flex justify-between text-xs font-mono">
            <div>
              <div className="text-zinc-500">LAG</div>
              <div className="text-zinc-200 mt-0.5">{indexerHealth.blockLag} blocks</div>
            </div>
            <div>
              <div className="text-zinc-500">CHAIN HEAD</div>
              <div className="text-zinc-200 mt-0.5">#{indexerHealth.observedHeadBlock}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Governed Contracts Section */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg p-6">
        <h2 className="text-sm font-semibold tracking-wider uppercase font-mono text-zinc-300 mb-4">
          Governed Protocol Contracts
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#292a27] text-zinc-500 uppercase tracking-wider">
                <th className="pb-3">Contract</th>
                <th className="pb-3">Address</th>
                <th className="pb-3">Onchain Owner</th>
                <th className="pb-3">Pending Owner</th>
                <th className="pb-3">Public Creation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292a27] text-zinc-300">
              <tr>
                <td className="py-3 font-medium text-white">SeriesFactory</td>
                <td className="py-3 font-mono text-zinc-400">{governedContracts.factory.address}</td>
                <td className="py-3 font-mono text-emerald-400">{governedContracts.factory.owner}</td>
                <td className="py-3 font-mono text-zinc-500">
                  {governedContracts.factory.pendingOwner || 'None'}
                </td>
                <td className="py-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                      governedContracts.factory.publicCreationEnabled
                        ? 'bg-amber-950/40 text-amber-400 border-amber-800'
                        : 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                    }`}
                  >
                    {governedContracts.factory.publicCreationEnabled ? 'ENABLED' : 'DISABLED (RESTRICTED)'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
