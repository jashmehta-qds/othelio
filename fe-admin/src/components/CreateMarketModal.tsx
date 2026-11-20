'use client';

import React, { useState, useEffect } from 'react';
import {
  AdminMarketPreviewResponse,
  AdminAssetItem,
  AdminRiskSplitSetupResponse,
  AdminTransactionPreview,
  seriesFactoryAbi,
} from '@othelio/shared';
import { adminApi } from '../lib/api';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { BaseError, decodeFunctionData, parseEventLogs } from 'viem';
import { useAdminAuth } from '../context/AdminAuthContext';

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

function shortError(error: unknown): string {
  return (error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'Risk Split request failed.')
    .split('\n', 1)[0].slice(0, 240);
}

interface CreateMarketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (confirmation: string) => void;
  isOwner: boolean;
  assets: AdminAssetItem[];
}

export function CreateMarketModal({ isOpen, onClose, onSuccess, isOwner, assets }: CreateMarketModalProps) {
  const tokenOptions = assets.filter((asset) => asset.registryStatus.isSupported && asset.isCoinbaseB20);
  const [selectedToken, setSelectedToken] = useState('');
  const underlying = tokenOptions.some((asset) => asset.address === selectedToken)
    ? selectedToken : (tokenOptions.find((asset) => asset.symbol === 'MSFTc') ?? tokenOptions[0])?.address;
  const [floorPercent, setFloorPercent] = useState<number>(80);
  const [capPercent, setCapPercent] = useState<number>(120);

  const [expiryTimestamp, setExpiryTimestamp] = useState<number>(nextFridayNewYorkClose);
  const [preview, setPreview] = useState<AdminMarketPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { writeContractAsync, isPending: isTxPending } = useWriteContract();
  const { chainId, contracts } = useAdminAuth();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const [isWaitingReceipt, setIsWaitingReceipt] = useState(false);

  const [setup, setSetup] = useState<AdminRiskSplitSetupResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const busy = isTxPending || isWaitingReceipt;
  const formKey = [underlying, floorPercent, capPercent, expiryTimestamp, chainId, refresh].join(':');
  const [loadedKey, setLoadedKey] = useState('');

  useEffect(() => {
    if (!isOpen || !underlying) return;
    let active = true;
    setIsLoadingPreview(true);
    setPreview(null);
    setSetup(null);
    setSetupError(null);
    setPreviewError(null);
    setTxError(null);
    const params = { underlying, chainId, expiryTimestamp };
    void Promise.allSettled([
      adminApi.previewRiskSplitSetup(params),
      adminApi.previewMarket({ ...params, floorPercent, capPercent }),
    ]).then(([setupResult, marketResult]) => {
      if (!active) return;
      if (setupResult.status === 'fulfilled') setSetup(setupResult.value);
      else setSetupError(shortError(setupResult.reason));
      if (marketResult.status === 'fulfilled') setPreview(marketResult.value);
      else setPreviewError(shortError(marketResult.reason));
      setLoadedKey(formKey);
      setIsLoadingPreview(false);
    });
    return () => { active = false; };
  }, [isOpen, underlying, floorPercent, capPercent, expiryTimestamp, chainId, formKey]);

  const execute = async (tx: AdminTransactionPreview) => {
    if (!isOwner || busy || formKey !== loadedKey) return;
    setIsWaitingReceipt(true);
    setTxError(null);
    try {
      if (!publicClient || !address || tx.chainId !== chainId || tx.target.toLowerCase() !== contracts?.riskSplit?.toLowerCase()) {
        throw new Error('Configured factory or wallet RPC is unavailable.');
      }
      const contract = { address: tx.target, abi: seriesFactoryAbi, account: address } as const;
      const simulateAndWrite = async () => {
        if (tx.method === 'createSeries') {
          const [asset, floor, cap, expiry, adapter] = tx.args;
          const { request } = await publicClient.simulateContract({
            ...contract, functionName: 'createSeries',
            args: [asset as `0x${string}`, BigInt(floor), BigInt(cap), BigInt(expiry), adapter as `0x${string}`],
          });
          return writeContractAsync(request);
        }
        if (!tx.data) throw new Error('Missing approval transaction data.');
        const decoded = decodeFunctionData({ abi: seriesFactoryAbi, data: tx.data });
        if (decoded.functionName === 'setApprovedAdapter' && tx.method === decoded.functionName) {
          const { request } = await publicClient.simulateContract({ ...contract, functionName: decoded.functionName, args: decoded.args });
          return writeContractAsync(request);
        }
        if (decoded.functionName === 'setApprovedExpiry' && tx.method === decoded.functionName) {
          const { request } = await publicClient.simulateContract({ ...contract, functionName: decoded.functionName, args: decoded.args });
          return writeContractAsync(request);
        }
        throw new Error('Unexpected approval transaction.');
      };
      const hash = await simulateAndWrite();
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`);
      if (tx.method === 'createSeries') {
        const [created] = parseEventLogs({
          abi: seriesFactoryAbi, eventName: 'SeriesCreated',
          logs: receipt.logs.filter((log) => log.address.toLowerCase() === tx.target.toLowerCase()),
        });
        onSuccess(created ? `Series confirmed: ${created.args.seriesAddress}` : `Creation confirmed: ${hash}; awaiting indexed address.`);
      } else {
        setRefresh((count) => count + 1);
      }
    } catch (error) {
      setTxError(shortError(error));
    } finally {
      setIsWaitingReceipt(false);
    }
  };

  if (!isOpen) return null;
  const current = formKey === loadedKey && !isLoadingPreview;
  const createTx = current && setup?.adapterApproved && setup.expiryApproved && !setup.adapterBlocker && !setup.expiryBlocker
    ? preview?.transactions.find((tx) => tx.method === 'createSeries') : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#161715] border border-[#292a27] rounded-xl max-w-2xl w-full p-6 space-y-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-[#292a27] pb-4">
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide">Launch Live Risk Split Series</h2>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Deterministic payoff vault with verified reference fixing and owner-approved expiry schedule.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-zinc-500 hover:text-white font-mono text-sm">
            ✕
          </button>
        </div>

        {/* Inputs */}
        <fieldset disabled={busy} className="space-y-4 text-xs font-mono">
          {/* Token Selector */}
          <div>
            <label className="text-zinc-400 uppercase tracking-wider block mb-1">Underlying Asset</label>
            <select
              value={underlying ?? ''}
              onChange={(e) => setSelectedToken(e.target.value)}
              className="w-full bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729]"
            >
              {!underlying && <option value="">No supported assets</option>}
              {tokenOptions.map((token) => (
                <option key={token.address} value={token.address}>
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
        </fieldset>

        {/* Preview Results */}
        {isLoadingPreview && (
          <div className="p-4 bg-[#10110f] border border-[#292a27] rounded text-center text-xs font-mono text-zinc-400">
            Evaluating calendar rules and reference pricing...
          </div>
        )}

        {(setupError || previewError || txError) && (
          <div className="p-3 bg-red-950/40 border border-red-900 rounded text-xs font-mono text-red-400">
            {[...new Set([setupError, previewError, txError].filter(Boolean))].join(' ')}
          </div>
        )}

        {current && setup && (
          <div className="space-y-2 rounded border border-[#292a27] p-3 text-xs font-mono text-zinc-300">
            <div className="break-all">Adapter: {setup.adapterAddress || 'Not configured'} — {setup.adapterApproved ? 'Approved' : 'Not approved'}</div>
            {setup.adapterBlocker && <div className="text-amber-400">{setup.adapterBlocker}</div>}
            <div>Exact expiry: {setup.expiryApproved ? 'Approved' : 'Not approved'}</div>
            {setup.expiryBlocker && <div className="text-amber-400">{setup.expiryBlocker}</div>}
            <div className="flex flex-wrap gap-2">
              {setup.transactions.map((tx) => (
                <button key={tx.method} type="button" disabled={busy || !isOwner} onClick={() => void execute(tx)}
                  className="rounded bg-[#292a27] px-3 py-2 text-zinc-200 disabled:opacity-50">{tx.description}</button>
              ))}
            </div>
          </div>
        )}

        {current && preview && (
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

            {preview.duplicateTermsDetected && <p className="text-xs text-amber-400">A series with these exact terms already exists.</p>}
            <button type="button" disabled={busy || !isOwner || !createTx} onClick={() => createTx && void execute(createTx)}
              className="w-full rounded bg-[#ff5729] py-2.5 text-xs font-semibold uppercase text-black disabled:opacity-50">
              {busy ? 'Confirming onchain…' : 'Create Risk Split Series'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
