'use client';

import React, { useState } from 'react';
import {
  AdminAssetItem,
  AdminUpsideRoundItem,
} from '@othelio/shared';
import { UpsideRoundModal } from './UpsideRoundModal';
import { adminApi } from '../lib/api';
import { usePublicClient, useWriteContract } from 'wagmi';
import { upsideFactoryAbi } from '@othelio/shared';

interface UpsideRoundsViewProps {
  rounds: AdminUpsideRoundItem[];
  assets: AdminAssetItem[];
  isLoading: boolean;
  onRefresh: () => void;
  isOwner: boolean;
  chainId: number;
}

export function UpsideRoundsView({
  rounds,
  assets,
  isLoading,
  onRefresh,
  isOwner,
  chainId,
}: UpsideRoundsViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [togglingRoundId, setTogglingRoundId] = useState<number | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const handleTogglePublicCreation = async (round: AdminUpsideRoundItem) => {
    if (!isOwner || !publicClient) return;
    const targetState = !round.publicCreationEnabled;
    setTogglingRoundId(round.roundId);

    try {
      const hash = await writeContractAsync({
        address: round.factoryAddress as `0x${string}`,
        abi: upsideFactoryAbi,
        functionName: 'setPublicCreationEnabled',
        args: [BigInt(round.roundId), targetState],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      onRefresh();
    } catch (err: any) {
      alert(`Failed to update public creation setting: ${err?.message || err}`);
    } finally {
      setTogglingRoundId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#292a27] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Stock Upside Rounds</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Approved weekly expiries, reference observations, and continuous strike series.
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
            className="px-4 py-1.5 rounded bg-[#ff5729] hover:bg-[#ff693f] text-black text-xs font-mono font-semibold uppercase tracking-wider disabled:opacity-50 transition-colors"
          >
            + New Round
          </button>
        </div>
      </div>

      {/* Rounds Table */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#292a27] text-zinc-500 uppercase tracking-wider bg-[#10110f]/50">
                <th className="py-3 px-4">Round</th>
                <th className="py-3 px-4">Underlying</th>
                <th className="py-3 px-4">Reference P0</th>
                <th className="py-3 px-4">Expected Move ±</th>
                <th className="py-3 px-4">Expiry</th>
                <th className="py-3 px-4">Strikes</th>
                <th className="py-3 px-4">Public Creation</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292a27] text-zinc-300">
              {rounds.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">
                    {isLoading ? 'Loading rounds...' : 'No Upside rounds registered yet. Launch the first round above.'}
                  </td>
                </tr>
              ) : (
                rounds.map((round) => (
                  <tr key={round.roundId} className="hover:bg-[#1c1d1a]">
                    <td className="py-3.5 px-4 font-bold text-white">#{round.roundId}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white">{round.underlying.symbol}</div>
                      <div className="text-[10px] text-zinc-500">{round.underlying.address.slice(0, 8)}...</div>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-white">${round.referencePriceFormatted}</td>
                    <td className="py-3.5 px-4 text-emerald-400 font-semibold">${round.expectedMoveFormatted}</td>
                    <td className="py-3.5 px-4 text-zinc-300">
                      <div>{new Date(round.expiryTimestamp * 1000).toISOString().slice(0, 10)}</div>
                      <div className="text-[10px] text-zinc-500">
                        {round.isExpired ? 'Expired' : 'Active'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-[#292a27] text-white font-semibold">
                        {round.marketsCount} strikes
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {isOwner ? (
                        <button
                          onClick={() => handleTogglePublicCreation(round)}
                          disabled={togglingRoundId === round.roundId}
                          className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                            round.publicCreationEnabled
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800 hover:bg-emerald-900/60'
                              : 'bg-zinc-800/40 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                          }`}
                        >
                          {togglingRoundId === round.roundId
                            ? 'Updating...'
                            : round.publicCreationEnabled
                            ? 'Enabled'
                            : 'Admin Only'}
                        </button>
                      ) : (
                        <span className="text-zinc-500">
                          {round.publicCreationEnabled ? 'Enabled' : 'Admin Only'}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {round.isSettled ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-purple-950/40 text-purple-300 border border-purple-800">
                          Settled
                        </span>
                      ) : round.isExpired ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950/40 text-amber-300 border border-amber-800">
                          Awaiting Settlement
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-800">
                          Trading
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <UpsideRoundModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={onRefresh}
        assets={assets}
        isOwner={isOwner}
        chainId={chainId}
      />
    </div>
  );
}
