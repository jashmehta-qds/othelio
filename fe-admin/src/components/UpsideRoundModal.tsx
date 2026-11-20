'use client';

import React, { useState, useEffect } from 'react';
import {
  AdminAssetItem,
  AdminUpsideRoundPreviewResponse,
  upsideFactoryAbi,
} from '@othelio/shared';
import { adminApi } from '../lib/api';
import { deployPresetStrikes } from '../lib/upside-launch';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { decodeFunctionData, encodeFunctionData, parseEventLogs, parseUnits, type Hash } from 'viem';
import { useAdminAuth } from '../context/AdminAuthContext';

interface UpsideRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assets: AdminAssetItem[];
  isOwner: boolean;
  chainId: number;
}

export function UpsideRoundModal({
  isOpen,
  onClose,
  onSuccess,
  assets,
  isOwner,
  chainId,
}: UpsideRoundModalProps) {
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [expiryDays, setExpiryDays] = useState<number>(1);
  const [customExpectedMove, setCustomExpectedMove] = useState<string>('');
  const [allowPublicCreation, setAllowPublicCreation] = useState<boolean>(false);

  const [preview, setPreview] = useState<AdminUpsideRoundPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [stepStatus, setStepStatus] = useState<string | null>(null);
  const [registerHash, setRegisterHash] = useState<Hash | null>(null);
  const [completed, setCompleted] = useState(false);

  const { address } = useAccount();
  const { contracts } = useAdminAuth();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const eligibleAssets = assets.filter((asset) => asset.registryStatus.isSupported && asset.isCoinbaseB20);
  const underlying = eligibleAssets.some((asset) => asset.address === selectedAsset)
    ? selectedAsset : (eligibleAssets.find((asset) => asset.symbol === 'MSFTc') ?? eligibleAssets[0])?.address;
  const launchBusy = isSubmitting || Boolean(registerHash);

  useEffect(() => {
    if (!isOpen || !underlying || registerHash) return;
    let active = true;
    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + expiryDays);
    date.setUTCDate(date.getUTCDate() + (5 - date.getUTCDay() + 7) % 7);
    date.setUTCHours(20, 0, 0, 0);
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
    }).format(date));
    date.setUTCHours(20 + 16 - hour);
    const load = async () => {
      try {
        const response = await adminApi.previewUpsideRound({
          chainId,
          underlying,
          expiryTimestamp: date.getTime() / 1000,
          expectedMove: customExpectedMove ? parseUnits(customExpectedMove, 8).toString() : undefined,
          publicCreationEnabled: allowPublicCreation,
        });
        if (active) setPreview(response);
      } catch (err) {
        if (active) setPreviewError(err instanceof Error ? err.message : 'Failed to fetch round preview.');
      } finally {
        if (active) setIsLoadingPreview(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [isOpen, underlying, expiryDays, customExpectedMove, allowPublicCreation, chainId, registerHash]);

  if (!isOpen) return null;

  const handleRegisterAndCreateMarkets = async () => {
    const transaction = preview?.transactions[0];
    if (!transaction?.data || !address || !publicClient || !isOwner || transaction.chainId !== chainId ||
        transaction.target !== contracts?.upside) return;
    setIsSubmitting(true);
    setPreviewError(null);
    try {
      const factory = transaction.target;
      const decoded = decodeFunctionData({ abi: upsideFactoryAbi, data: transaction.data });
      if (decoded.functionName !== 'registerRound') throw new Error('Invalid round preview calldata.');
      setStepStatus('Confirming round registration…');
      let hash = registerHash;
      if (!hash) {
        const { request } = await publicClient.simulateContract({
          address: factory, abi: upsideFactoryAbi, functionName: 'registerRound', args: decoded.args, account: address,
        });
        hash = await writeContractAsync(request);
        setRegisterHash(hash);
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        setRegisterHash(null);
        throw new Error('Round registration reverted. Refresh the preview before retrying.');
      }
      const [event] = parseEventLogs({
        abi: upsideFactoryAbi, eventName: 'RoundRegistered',
        logs: receipt.logs.filter((log) => log.address.toLowerCase() === factory.toLowerCase()),
      });
      if (!event || encodeFunctionData({
        abi: upsideFactoryAbi, functionName: 'registerRound', args: [event.args.config],
      }) !== transaction.data) throw new Error('Confirmed registration does not match the preview.');
      const roundId = event.args.roundId;
      await deployPresetStrikes(publicClient, address, factory, roundId, writeContractAsync, (index, total) =>
        setStepStatus(`Round #${roundId} confirmed. Checking strike ${index}/${total}…`));
      setStepStatus(`Round #${roundId} and all preset strikes are confirmed onchain. Indexing may take a moment.`);
      setCompleted(true);
      onSuccess();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Round launch failed.');
      onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#292a27] bg-[#161715] p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-[#292a27] pb-4">
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide">Launch New Upside Round</h2>
            <p className="text-xs font-mono text-zinc-400 mt-0.5">
              Approved weekly expiry with 4 standard continuous strikes.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-zinc-500 hover:text-white font-mono text-sm"
          >
            ✕
          </button>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono text-zinc-400 mb-1">Underlying Asset</label>
            <select
              value={underlying ?? ''}
              onChange={(e) => setSelectedAsset(e.target.value)}
              disabled={launchBusy}
              className="w-full rounded bg-[#10110f] border border-[#292a27] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#ff5729]"
            >
              {!underlying && <option value="">No supported assets</option>}
              {eligibleAssets.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.symbol} ({a.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono text-zinc-400 mb-1">Expiry Horizon</label>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              disabled={launchBusy}
              className="w-full rounded bg-[#10110f] border border-[#292a27] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#ff5729]"
            >
              <option value={1}>Next Friday</option>
              <option value={8}>Friday after next</option>
              <option value={15}>In three weeks</option>
              <option value={22}>In four weeks</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono text-zinc-400 mb-1">
              Expected Move (USD) <span className="text-zinc-500 font-normal">Optional</span>
            </label>
            <input
              type="number"
              step="0.5"
              placeholder={preview ? preview.expectedMoveFormatted : 'Auto (5%)'}
              value={customExpectedMove}
              onChange={(e) => setCustomExpectedMove(e.target.value)}
              disabled={launchBusy}
              className="w-full rounded bg-[#10110f] border border-[#292a27] px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-[#ff5729]"
            />
          </div>

          <div className="flex items-center space-x-3 pt-5">
            <input
              type="checkbox"
              id="publicCreation"
              checked={allowPublicCreation}
              onChange={(e) => setAllowPublicCreation(e.target.checked)}
              disabled={launchBusy}
              className="h-4 w-4 rounded border-[#292a27] bg-[#10110f] text-[#ff5729] focus:ring-0"
            />
            <label htmlFor="publicCreation" className="text-xs font-mono text-zinc-300">
              Allow Public Strike Creation
            </label>
          </div>
        </div>

        {/* Preview State */}
        {isLoadingPreview && (
          <div className="py-6 text-center text-xs font-mono text-zinc-500 animate-pulse">
            Calculating reference prices and 4 continuous strikes...
          </div>
        )}

        {previewError && (
          <div className="p-3 rounded bg-red-950/40 border border-red-900 text-xs font-mono text-red-300">
            {previewError}
          </div>
        )}

        {preview && !isLoadingPreview && (
          <div className="space-y-4">
            {/* Reference info */}
            <div className="p-3 rounded-lg bg-[#10110f] border border-[#292a27] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div>
                <span className="text-zinc-500 block">Reference Price P0</span>
                <span className="text-white font-semibold">${preview.referencePriceFormatted}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Expected Move ±</span>
                <span className="text-emerald-400 font-semibold">${preview.expectedMoveFormatted}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Expiry UTC</span>
                <span className="text-zinc-300">{new Date(preview.expiryTimestamp * 1000).toISOString().slice(0, 16)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Calendar Check</span>
                <span className={preview.calendarCheck.valid ? 'text-emerald-400' : 'text-amber-400'}>
                  {preview.calendarCheck.valid ? 'Valid Friday' : 'Weekend Warning'}
                </span>
              </div>
            </div>

            {/* Strikes Breakdown */}
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400 mb-2">
                Standard Four Target Strikes
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {preview.strikes.map((s, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded border border-[#292a27] bg-[#10110f] text-center"
                  >
                    <span className="text-[10px] uppercase font-mono text-zinc-500 block">{s.targetLabel}</span>
                    <span className="text-sm font-bold font-mono text-white">${s.strikePriceFormatted}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Submission / Status */}
        {stepStatus && (
          <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800 text-xs font-mono text-emerald-300 animate-pulse">
            {stepStatus}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-[#292a27] pt-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded text-xs font-mono text-zinc-400 hover:text-white"
          >
            {completed ? 'Close' : 'Cancel'}
          </button>

          <button
            onClick={handleRegisterAndCreateMarkets}
            disabled={!underlying || !preview || isLoadingPreview || isSubmitting || !isOwner || completed}
            className="px-5 py-2 rounded text-xs font-mono font-semibold uppercase tracking-wider bg-[#ff5729] hover:bg-[#ff693f] text-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {!isOwner
              ? 'Connect Factory Owner Wallet'
              : isSubmitting
              ? 'Launching...'
              : completed ? 'Confirmed' : registerHash ? 'Retry missing strikes' : 'Launch Round & 4 Strikes'}
          </button>
        </div>
      </div>
    </div>
  );
}
