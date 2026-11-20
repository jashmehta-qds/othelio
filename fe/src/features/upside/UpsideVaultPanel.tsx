'use client';

import React, { useState } from 'react';
import styles from './UpsideMarkets.module.css';
import { upsideSeriesAbi } from '@/types/shared';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { getAddress, parseAbi } from 'viem';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

interface UpsideVaultPanelProps {
  seriesAddress: string;
  underlyingAddress: string;
  symbol: string;
  isSettled: boolean;
  settledPriceFormatted: string | null;
  onSuccess?: () => void;
}

export function UpsideVaultPanel({
  seriesAddress,
  underlyingAddress,
  symbol,
  isSettled,
  onSuccess,
}: UpsideVaultPanelProps) {
  const [activeTab, setActiveTab] = useState<'MINT' | 'COMBINE' | 'REDEEM'>(isSettled ? 'REDEEM' : 'COMBINE');
  const [amount, setAmount] = useState<string>('1.0');
  const [isPending, setIsPending] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const handleMint = async () => {
    if (!publicClient || !address) return;
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    setIsPending(true);
    setStatusMessage('Checking underlying token allowance...');

    try {
      const amountBig = BigInt(Math.floor(val * 1e8));
      const targetSeries = getAddress(seriesAddress);
      const targetUnderlying = getAddress(underlyingAddress);

      const allowance = await publicClient.readContract({
        address: targetUnderlying,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, targetSeries],
      });

      if (allowance < amountBig) {
        setStatusMessage(`Approving ${symbol} deposit...`);
        const appHash = await writeContractAsync({
          address: targetUnderlying,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [targetSeries, BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')],
        });
        await publicClient.waitForTransactionReceipt({ hash: appHash });
      }

      setStatusMessage(`Minting 1:1 Claim Pair (UP + RES)...`);
      const mintHash = await writeContractAsync({
        address: targetSeries,
        abi: upsideSeriesAbi,
        functionName: 'mint',
        args: [amountBig],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintHash });

      setStatusMessage('Claims minted successfully!');
      setTimeout(() => {
        setStatusMessage(null);
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err: unknown) {
      alert(`Mint failed: ${err instanceof Error ? err.message : 'Please try again.'}`);
      setStatusMessage(null);
    } finally {
      setIsPending(false);
    }
  };

  const handleCombineAndWithdraw = async () => {
    if (!publicClient || !address) return;
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    setIsPending(true);
    setStatusMessage('Burning 1 UP + 1 RES pair to retrieve underlying stock...');

    try {
      const amountBig = BigInt(Math.floor(val * 1e8));
      const targetSeries = getAddress(seriesAddress);

      const hash = await writeContractAsync({
        address: targetSeries,
        abi: upsideSeriesAbi,
        functionName: 'combineAndWithdraw',
        args: [amountBig],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setStatusMessage('Pair burned, collateral retrieved!');
      setTimeout(() => {
        setStatusMessage(null);
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err: unknown) {
      alert(`Combine failed: ${err instanceof Error ? err.message : 'Please try again.'}`);
      setStatusMessage(null);
    } finally {
      setIsPending(false);
    }
  };

  const handleRedeem = async (type: 'UPSIDE' | 'RESIDUAL') => {
    if (!publicClient || !address) return;
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    setIsPending(true);
    setStatusMessage(`Redeeming settled ${type} claims...`);

    try {
      const amountBig = BigInt(Math.floor(val * 1e8));
      const targetSeries = getAddress(seriesAddress);

      const hash = await writeContractAsync({
        address: targetSeries,
        abi: upsideSeriesAbi,
        functionName: type === 'UPSIDE' ? 'redeemUpside' : 'redeemResidual',
        args: [amountBig],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setStatusMessage('Redeemed successfully!');
      setTimeout(() => {
        setStatusMessage(null);
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err: unknown) {
      alert(`Redemption failed: ${err instanceof Error ? err.message : 'Please try again.'}`);
      setStatusMessage(null);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={styles.vaultPanel}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-white">Manage your stock</h2>
          <span className={styles.helperText}>
            Turn stock into both claims, combine both back into stock, or collect a settled payout.
          </span>
        </div>

        {/* Tab switch */}
        <div className={styles.vaultTabs}>
          <button
            type="button"
            onClick={() => setActiveTab('MINT')}
            className={`${styles.bookTab} ${activeTab === 'MINT' ? styles.bookTabActive : ''}`}
          >
            Create both claims
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('COMBINE')}
            className={`${styles.bookTab} ${activeTab === 'COMBINE' ? styles.bookTabActive : ''}`}
          >
            Get stock back
          </button>
          {isSettled && (
            <button
              type="button"
              onClick={() => setActiveTab('REDEEM')}
              className={`${styles.bookTab} ${activeTab === 'REDEEM' ? styles.bookTabActive : ''}`}
            >
              Collect payout
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className={styles.inputGroup}>
          <label>
            <span>
              {activeTab === 'MINT'
                ? `Stock to deposit (${symbol})`
                : activeTab === 'COMBINE'
                ? 'Pairs to combine (Upside + Remaining value)'
                : 'Claims to redeem'}
            </span>
            <span>Amount</span>
          </label>
          <div className={styles.inputWrapper}>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isPending}
            />
            <span className={styles.inputUnit}>Units</span>
          </div>
        </div>

        {statusMessage && (
          <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 animate-pulse text-center">
            {statusMessage}
          </div>
        )}

        {!isConnected ? (
          <button type="button" disabled className={styles.actionButton}>
            Connect Wallet
          </button>
        ) : activeTab === 'MINT' ? (
          <button
            type="button"
            onClick={handleMint}
            disabled={isPending}
            className={styles.actionButton}
          >
            {isPending ? 'Processing...' : `Deposit ${amount} ${symbol} → Create ${amount} of each claim`}
          </button>
        ) : activeTab === 'COMBINE' ? (
          <button
            type="button"
            onClick={handleCombineAndWithdraw}
            disabled={isPending}
            className={styles.actionButton}
          >
            {isPending ? 'Processing...' : `Combine ${amount} pairs → Get ${symbol} back`}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleRedeem('UPSIDE')}
              disabled={isPending}
              className={styles.actionButton}
            >
              Collect Upside
            </button>
            <button
              type="button"
              onClick={() => handleRedeem('RESIDUAL')}
              disabled={isPending}
              className={styles.actionButton}
            >
              Collect remaining value
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
