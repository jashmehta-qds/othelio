'use client';

import React, { useState } from 'react';
import {
  AdminAssetItem,
  AdminUpsideRoundItem,
} from '@othelio/shared';
import { UpsideRoundModal } from './UpsideRoundModal';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { deployPresetStrikes } from '../lib/upside-launch';
import { useAdminAuth } from '../context/AdminAuthContext';

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
  const [resuming, setResuming] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const { contracts } = useAdminAuth();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const resume = async (round: AdminUpsideRoundItem) => {
    const factory = contracts?.upside;
    if (!isOwner || !address || !publicClient || !factory || factory.toLowerCase() !== round.factoryAddress.toLowerCase()) return;
    setResuming(round.roundId);
    try {
      await deployPresetStrikes(publicClient, address, factory, BigInt(round.roundId), writeContractAsync, (index, total) =>
        setStatus(`Round #${round.roundId}: checking preset strike ${index}/${total}…`));
      setStatus(`Round #${round.roundId}: all preset strikes confirmed onchain. Indexing may take a moment.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not finish preset strikes.');
    } finally {
      setResuming(null);
      onRefresh();
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

      {status && <p role="status" className="text-xs font-mono text-zinc-300">{status}</p>}
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
                <th className="py-3 px-4">Creation Policy</th>
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
                      {isOwner && !round.isExpired && contracts?.upside?.toLowerCase() === round.factoryAddress.toLowerCase() && (
                        <button type="button" onClick={() => void resume(round)} disabled={resuming !== null}
                          className="block mt-2 text-[10px] text-[#ff5729] disabled:opacity-50">
                          Finish preset strikes
                        </button>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-zinc-500">Owner only</span>
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

      {isModalOpen && <UpsideRoundModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={onRefresh}
        assets={assets}
        isOwner={isOwner}
        chainId={chainId}
      />}
    </div>
  );
}
