'use client';

import React, { useState, useEffect } from 'react';
import {
  AdminMarketPreviewResponse,
  TOKEN_FEED_REGISTRY,
  seriesFactoryAbi,
} from '@othelio/shared';
import { adminApi } from '../lib/api';
import { usePublicClient, useWriteContract } from 'wagmi';

function nextFridayNewYorkClose(): number {
  const earliest = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const start = new Date(earliest);
  const easternHour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
  });
  for (let offset = 0; offset < 15; offset++) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset));
    if (day.getUTCDay() !== 5) continue;
    const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 21);
    const localHour = Number(easternHour.formatToParts(guess).find((part) => part.type === 'hour')?.value);
    const close = guess + (16 - localHour) * 60 * 60 * 1000;
    if (close > earliest) return Math.floor(close / 1000);
  }
  throw new Error('Could not determine the next New York Friday close.');
}

interface CreateMarketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  isOwner: boolean;
}

export function CreateMarketModal({ isOpen, onClose, onSuccess, isOwner }: CreateMarketModalProps) {
  const tokenOptions = Object.values(TOKEN_FEED_REGISTRY);

  const [selectedToken, setSelectedToken] = useState(tokenOptions[7] || tokenOptions[0]); // Default MSFTc
  const [floorPercent, setFloorPercent] = useState<number>(80);
  const [capPercent, setCapPercent] = useState<number>(120);

  const [expiryTimestamp, setExpiryTimestamp] = useState<number>(nextFridayNewYorkClose);
  const [preview, setPreview] = useState<AdminMarketPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { writeContractAsync, isPending: isTxPending } = useWriteContract();
  const publicClient = usePublicClient();
  const [isWaitingReceipt, setIsWaitingReceipt] = useState(false);

  const handleFetchPreview = async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);

    try {
      const res = await adminApi.previewMarket({
        underlying: selectedToken.tokenAddress,
        floorPercent,
        capPercent,
        expiryTimestamp,
      });
      setPreview(res);
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to generate market creation preview');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleFetchPreview();
    }
  }, [isOpen, selectedToken, floorPercent, capPercent, expiryTimestamp]);

  const handleExecuteApproval = async (target: `0x${string}`, underlying: string, expiry: number) => {
    try {
      if (!publicClient) throw new Error('Wallet RPC is unavailable.');
      const hash = await writeContractAsync({
        address: target,
        abi: seriesFactoryAbi,
        functionName: 'setApprovedExpiry',
        args: [underlying as `0x${string}`, BigInt(expiry), true],
      });
      setIsWaitingReceipt(true);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Expiry approval ${hash} reverted.`);
      await handleFetchPreview();
    } catch (err: any) {
      alert(`Approval failed: ${err?.message}`);
    } finally {
      setIsWaitingReceipt(false);
    }
  };

  const handleExecuteCreate = async (
    target: `0x${string}`,
    underlying: string,
    floor: string,
    cap: string,
    expiry: number,
    adapter: string
  ) => {
    try {
      if (!publicClient) throw new Error('Wallet RPC is unavailable.');
      const hash = await writeContractAsync({
        address: target,
        abi: seriesFactoryAbi,
        functionName: 'createSeries',
        args: [underlying as `0x${string}`, BigInt(floor), BigInt(cap), BigInt(expiry), adapter as `0x${string}`],
      });
      setIsWaitingReceipt(true);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Series creation ${hash} reverted.`);
      onSuccess();
    } catch (err: any) {
      alert(`Create series failed: ${err?.message}`);
    } finally {
      setIsWaitingReceipt(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#161715] border border-[#292a27] rounded-xl max-w-2xl w-full p-6 space-y-6 my-8">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-[#292a27] pb-4">
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide">Launch Live Risk Split Series</h2>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Deterministic payoff vault with verified reference fixing and owner-approved expiry schedule.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white font-mono text-sm">
            ✕
          </button>
        </div>

        {/* Inputs */}
        <div className="space-y-4 text-xs font-mono">
          {/* Token Selector */}
          <div>
            <label className="text-zinc-400 uppercase tracking-wider block mb-1">Underlying Asset</label>
            <select
              value={selectedToken.tokenAddress}
              onChange={(e) => {
                const found = tokenOptions.find((t) => t.tokenAddress === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="w-full bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729]"
            >
              {tokenOptions.map((token) => (
                <option key={token.tokenAddress} value={token.tokenAddress}>
                  {token.symbol} — {token.name}
                </option>
              ))}
            </select>
          </div>

          {/* Floor & Cap Percentages */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-zinc-400 uppercase tracking-wider block mb-1">
                Floor (% of spot)
              </label>
              <input
                type="number"
                value={floorPercent}
                onChange={(e) => setFloorPercent(Number(e.target.value))}
                min={10}
                max={99}
                className="w-full bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729]"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Full protection below this price</span>
            </div>
            <div>
              <label className="text-zinc-400 uppercase tracking-wider block mb-1">
                Cap (% of spot)
              </label>
              <input
                type="number"
                value={capPercent}
                onChange={(e) => setCapPercent(Number(e.target.value))}
                min={101}
                max={300}
                className="w-full bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729]"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Protected claim capped at this price</span>
            </div>
          </div>

          {/* Expiry Selector & NY Close Buffer */}
          <div>
            <label className="text-zinc-400 uppercase tracking-wider block mb-1">
              Expiry Timestamp (Friday 16:00 ET Close)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={expiryTimestamp}
                onChange={(e) => setExpiryTimestamp(Number(e.target.value))}
                className="flex-1 bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729]"
              />
              <button
                type="button"
                onClick={() => setExpiryTimestamp(nextFridayNewYorkClose())}
                className="px-3 py-2 bg-[#292a27] hover:bg-[#3f413c] text-zinc-300 rounded"
              >
                Next Friday
              </button>
            </div>
            <div className="text-[10px] text-zinc-400 mt-1">
              UTC: {new Date(expiryTimestamp * 1000).toUTCString()}
            </div>
          </div>
        </div>

        {/* Preview Results */}
        {isLoadingPreview && (
          <div className="p-4 bg-[#10110f] border border-[#292a27] rounded text-center text-xs font-mono text-zinc-400">
            Evaluating calendar rules and reference pricing...
          </div>
        )}

        {previewError && (
          <div className="p-3 bg-red-950/40 border border-red-900 rounded text-xs font-mono text-red-400">
            {previewError}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {/* Term Summary */}
            <div className="p-4 bg-[#10110f] border border-[#292a27] rounded-lg space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-zinc-500">Spot Reference Price:</span>
                <span className="text-white font-semibold">{preview.referenceObservation.formattedPrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Floor Price (Floor):</span>
                <span className="text-emerald-400 font-semibold">{preview.floorFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Cap Price (Cap):</span>
                <span className="text-emerald-400 font-semibold">{preview.capFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Market Close Window:</span>
                <span className="text-zinc-300">{preview.calendarCheck.localTimeStr}</span>
              </div>
              {preview.calendarCheck.note && (
                <div className="text-[10px] text-emerald-500 pt-1 border-t border-[#292a27]">
                  ✓ {preview.calendarCheck.note}
                </div>
              )}
            </div>

            {/* Payoff Simulation Table */}
            <div>
              <div className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">
                Payoff Regime Verification
              </div>
              <div className="border border-[#292a27] rounded overflow-hidden">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="bg-[#10110f] text-zinc-500 border-b border-[#292a27]">
                    <tr>
                      <th className="py-2 px-3">Regime</th>
                      <th className="py-2 px-3">Spot</th>
                      <th className="py-2 px-3 text-emerald-400">Protected</th>
                      <th className="py-2 px-3 text-cyan-400">Upside</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#292a27] text-zinc-300">
                    {preview.payoffScenarios.map((sc, i) => (
                      <tr key={i} className="hover:bg-[#1c1d1a]">
                        <td className="py-1.5 px-3 text-zinc-400">{sc.regime}</td>
                        <td className="py-1.5 px-3">${(Number(sc.spotPrice) / 1e8).toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-emerald-400">
                          ${(Number(sc.protectedPayout) / 1e8).toFixed(2)}
                        </td>
                        <td className="py-1.5 px-3 text-cyan-400">
                          ${(Number(sc.upsidePayout) / 1e8).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Execution Buttons */}
            <div className="space-y-3 pt-2">
              {!preview.expiryAlreadyApproved && (
                <div className="p-3 bg-amber-950/30 border border-amber-900/60 rounded flex items-center justify-between">
                  <div className="text-xs font-mono text-amber-300">
                    Step 1: Expiry date must be authorized by factory owner
                  </div>
                  <button
                    onClick={() =>
                      handleExecuteApproval(
                        preview.transactions[0].target,
                        preview.underlying.address,
                        preview.expiryTimestamp
                      )
                    }
                    disabled={isTxPending || isWaitingReceipt || !isOwner}
                    className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs font-mono transition-colors disabled:opacity-50"
                  >
                    Approve Expiry
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  const createTx = preview.transactions.find((t) => t.method === 'createSeries');
                  if (createTx) {
                    handleExecuteCreate(
                      createTx.target,
                      createTx.args[0],
                      createTx.args[1],
                      createTx.args[2],
                      createTx.args[3],
                      createTx.args[4]
                    );
                  }
                }}
                disabled={isTxPending || isWaitingReceipt || !isOwner}
                className="w-full py-2.5 rounded bg-[#ff5729] hover:bg-[#ff6f47] disabled:opacity-50 text-black font-semibold text-xs font-mono tracking-wider uppercase transition-colors"
              >
                {isTxPending || isWaitingReceipt
                  ? 'Confirming on Base...'
                  : isOwner
                  ? 'Deploy Risk Split Series'
                  : 'Restricted: Connect Factory Owner'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
