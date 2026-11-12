'use client';

import React, { useState } from 'react';
import { AdminUpsideMarketItem, upsideFixingAdapterAbi } from '@othelio/shared';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

interface UpsideMarketsViewProps {
  markets: AdminUpsideMarketItem[];
  isLoading: boolean;
  onRefresh: () => void;
  isOwner: boolean;
  adapterAddress?: string;
}

export function UpsideMarketsView({
  markets,
  isLoading,
  onRefresh,
  isOwner,
  adapterAddress,
}: UpsideMarketsViewProps) {
  const [settlingSeries, setSettlingSeries] = useState<string | null>(null);

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const handleSettleSeries = async (market: AdminUpsideMarketItem) => {
    if (!publicClient || !address) return;
    setSettlingSeries(market.seriesAddress);

    try {
      const targetAdapter = (adapterAddress || '0xF62849F9A0B5Bf2913b396098F7c7019b51A820a') as `0x${string}`;

      // In fixing adapter, get candidate fixing round for expiry
      const fixing = await publicClient.readContract({
        address: targetAdapter,
        abi: upsideFixingAdapterAbi,
        functionName: 'getFixingRound',
        args: [BigInt(market.expiryTimestamp)],
      });

      const hash = await writeContractAsync({
        address: targetAdapter,
        abi: upsideFixingAdapterAbi,
        functionName: 'settleSeries',
        args: [market.seriesAddress as `0x${string}`, (fixing as any).roundId],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      onRefresh();
    } catch (err: any) {
      alert(`Settlement failed: ${err?.message || err}`);
    } finally {
      setSettlingSeries(null);
    }
  };

  const nowSecs = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#292a27] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Upside Strike Markets</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Continuous Claim series, strike levels, and fixing settlement statuses.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="self-start sm:self-auto px-3 py-1.5 rounded bg-[#161715] hover:bg-[#292a27] border border-[#292a27] text-xs font-mono text-zinc-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Markets Table */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#292a27] text-zinc-500 uppercase tracking-wider bg-[#10110f]/50">
                <th className="py-3 px-4">Series</th>
                <th className="py-3 px-4">Round</th>
                <th className="py-3 px-4">Strike Price</th>
                <th className="py-3 px-4">Target Label</th>
                <th className="py-3 px-4">Expiry</th>
                <th className="py-3 px-4">Tokens</th>
                <th className="py-3 px-4">Settlement</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292a27] text-zinc-300">
              {markets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">
                    {isLoading ? 'Loading markets...' : 'No strike markets deployed yet.'}
                  </td>
                </tr>
              ) : (
                markets.map((m) => {
                  const isExpired = nowSecs >= m.expiryTimestamp;
                  return (
                    <tr key={m.seriesAddress} className="hover:bg-[#1c1d1a]">
                      <td className="py-3.5 px-4 font-semibold text-white">
                        {m.seriesAddress.slice(0, 6)}...{m.seriesAddress.slice(-4)}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-zinc-400">#{m.roundId}</td>
                      <td className="py-3.5 px-4 font-bold text-white">${m.strikePriceFormatted}</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-[#243528] text-emerald-400 font-semibold text-[10px]">
                          {m.targetLabel || 'Target'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-400">
                        {new Date(m.expiryTimestamp * 1000).toISOString().slice(0, 10)}
                      </td>
                      <td className="py-3.5 px-4 text-[10px] text-zinc-500">
                        <div>UP: {m.upsideTokenAddress.slice(0, 6)}...</div>
                        <div>RES: {m.residualTokenAddress.slice(0, 6)}...</div>
                      </td>
                      <td className="py-3.5 px-4">
                        {m.isSettled ? (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-purple-950/40 text-purple-300 border border-purple-800">
                            Settled @ ${m.settledPriceFormatted}
                          </span>
                        ) : isExpired ? (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950/40 text-amber-300 border border-amber-800">
                            Ready to Settle
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-800">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {!m.isSettled && isExpired ? (
                          <button
                            onClick={() => handleSettleSeries(m)}
                            disabled={settlingSeries === m.seriesAddress}
                            className="px-2 py-1 rounded bg-[#ff5729] hover:bg-[#ff693f] text-black font-semibold text-[10px] disabled:opacity-50"
                          >
                            {settlingSeries === m.seriesAddress ? 'Settling...' : 'Settle'}
                          </button>
                        ) : (
                          <span className="text-zinc-600 text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
