'use client';

import React, { useState, useEffect } from 'react';
import {
  AdminAssetItem,
  AdminUpsideRoundPreviewResponse,
  upsideFactoryAbi,
} from '@othelio/shared';
import { adminApi } from '../lib/api';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

interface UpsideRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assets: AdminAssetItem[];
  factoryAddress?: string;
  isOwner: boolean;
  chainId: number;
}

export function UpsideRoundModal({
  isOpen,
  onClose,
  onSuccess,
  assets,
  factoryAddress,
  isOwner,
  chainId,
}: UpsideRoundModalProps) {
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [customExpectedMove, setCustomExpectedMove] = useState<string>('');

  const [preview, setPreview] = useState<AdminUpsideRoundPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [stepStatus, setStepStatus] = useState<string | null>(null);

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Set default asset
  useEffect(() => {
    if (!selectedAsset && assets.length > 0) {
      const msft = assets.find((a) => a.symbol === 'MSFTc') || assets[0];
      setSelectedAsset(msft.address);
    }
  }, [assets, selectedAsset]);

  // Calculate default future Friday at 16:00 ET (20:00 UTC)
  const computeExpiryTimestamp = (days: number): number => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    // Find Friday
    const day = d.getDay();
    const diff = (5 - day + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 && days > 0 ? 0 : diff));
    d.setUTCHours(20, 0, 0, 0); // 16:00 ET
    return Math.floor(d.getTime() / 1000);
  };

  // Fetch preview when parameters change
  useEffect(() => {
    if (!isOpen || !selectedAsset) return;

    let isMounted = true;
    const loadPreview = async () => {
      setIsLoadingPreview(true);
      setPreviewError(null);
      try {
        const expiryTimestamp = computeExpiryTimestamp(expiryDays);
        const expectedMoveWei = customExpectedMove
          ? (BigInt(Math.floor(parseFloat(customExpectedMove) * 1e8))).toString()
          : undefined;

        const res = await adminApi.previewUpsideRound({
          chainId,
          underlying: selectedAsset,
          expiryTimestamp,
          expectedMove: expectedMoveWei,
        });
        if (isMounted) setPreview(res);
      } catch (err: any) {
        if (isMounted) setPreviewError(err?.message || 'Failed to fetch round preview');
      } finally {
        if (isMounted) setIsLoadingPreview(false);
      }
    };

    loadPreview();
    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedAsset, expiryDays, customExpectedMove, chainId]);

  if (!isOpen) return null;

  const handleRegisterAndCreateMarkets = async () => {
    if (!preview || !publicClient || !address) return;
    setIsSubmitting(true);
    setStepStatus('Simulating registerRound transaction...');

    try {
      const txPreview = preview.transactions[0];
      const targetFactory = (factoryAddress || preview.factoryAddress) as `0x${string}`;

      // Step 1: registerRound
      setStepStatus('Sending registerRound to UpsideFactory...');
      const registerHash = await writeContractAsync({
        address: targetFactory,
        abi: upsideFactoryAbi,
        functionName: 'registerRound',
        args: txPreview.args as any,
      });

      setStepStatus('Waiting for registerRound confirmation...');
      const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
      if (registerReceipt.status !== 'success') {
        throw new Error('registerRound transaction reverted');
      }

      // Read totalRounds from factory to get the newly created roundId
      const totalRounds = await publicClient.readContract({
        address: targetFactory,
        abi: upsideFactoryAbi,
        functionName: 'totalRounds',
      });
      const newRoundId = totalRounds;

      // Step 2: createMarket for each of the 4 strikes
      for (let i = 0; i < preview.strikes.length; i++) {
        const s = preview.strikes[i];
        setStepStatus(`Deploying strike market ${i + 1}/4 (${s.targetLabel}: $${s.strikePriceFormatted})...`);

        const createMarketHash = await writeContractAsync({
          address: targetFactory,
          abi: upsideFactoryAbi,
          functionName: 'createMarket',
          args: [newRoundId, BigInt(s.strikePrice)],
        });

        await publicClient.waitForTransactionReceipt({ hash: createMarketHash });
      }

      setStepStatus('All strikes successfully created!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      alert(`Failed to launch round: ${err?.message || err}`);
      setStepStatus(null);
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
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded bg-[#10110f] border border-[#292a27] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#ff5729]"
            >
              {assets.map((a) => (
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
              disabled={isSubmitting}
              className="w-full rounded bg-[#10110f] border border-[#292a27] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#ff5729]"
            >
              <option value={7}>Next Friday (7 Days)</option>
              <option value={14}>Two Weeks (14 Days)</option>
              <option value={21}>Three Weeks (21 Days)</option>
              <option value={28}>Monthly (28 Days)</option>
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
              disabled={isSubmitting}
              className="w-full rounded bg-[#10110f] border border-[#292a27] px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-[#ff5729]"
            />
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
            Cancel
          </button>

          <button
            onClick={handleRegisterAndCreateMarkets}
            disabled={!preview || isLoadingPreview || isSubmitting || !isOwner}
            className="px-5 py-2 rounded text-xs font-mono font-semibold uppercase tracking-wider bg-[#ff5729] hover:bg-[#ff693f] text-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {!isOwner
              ? 'Connect Factory Owner Wallet'
              : isSubmitting
              ? 'Launching...'
              : 'Launch Round & 4 Strikes'}
          </button>
        </div>
      </div>
    </div>
  );
}
