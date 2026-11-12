'use client';

import React, { useState, useEffect } from 'react';
import styles from './UpsideMarkets.module.css';
import {
  fetchSweepQuote,
  submitLimitOrder,
} from './useUpside';
import {
  UpsideSweepQuoteResponse,
  ZERO_EX_EXCHANGE_PROXY_BASE,
} from '@/types/shared';
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from 'wagmi';
import { parseUnits, parseSignature, getAddress, parseAbi } from 'viem';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

interface UpsideOrderTicketProps {
  chainId: number;
  seriesAddress: string;
  strikeFormatted: string;
  targetLabel: string;
  upsideTokenAddress: string;
  residualTokenAddress: string;
  onTradeSuccess?: () => void;
}

export function UpsideOrderTicket({
  chainId,
  seriesAddress,
  strikeFormatted,
  targetLabel,
  upsideTokenAddress,
  residualTokenAddress,
  onTradeSuccess,
}: UpsideOrderTicketProps) {
  const [ticketMode, setTicketMode] = useState<'BUY' | 'SELL' | 'LIMIT'>('BUY');
  const [claimType, setClaimType] = useState<'UPSIDE' | 'RESIDUAL'>('UPSIDE');
  const [quantity, setQuantity] = useState<string>('1.0');
  const [limitPrice, setLimitPrice] = useState<string>('4.50');
  const [limitExpiryDays, setLimitExpiryDays] = useState<number>(7);

  const [sweepQuote, setSweepQuote] = useState<UpsideSweepQuoteResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const activeClaimToken = claimType === 'UPSIDE' ? upsideTokenAddress : residualTokenAddress;
  const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  // Fetch sweep quote for BUY / SELL
  useEffect(() => {
    if (ticketMode === 'LIMIT' || !seriesAddress) {
      setSweepQuote(null);
      return;
    }

    const parsedQty = parseFloat(quantity);
    if (!parsedQty || parsedQty <= 0) {
      setSweepQuote(null);
      return;
    }

    let isMounted = true;
    const loadQuote = async () => {
      setIsQuoting(true);
      setQuoteError(null);
      try {
        const unitsWei = (BigInt(Math.floor(parsedQty * 1e8))).toString();
        const res = await fetchSweepQuote(chainId, seriesAddress, {
          seriesAddress: seriesAddress as `0x${string}`,
          takerAddress: (address || '0x0000000000000000000000000000000000000000') as `0x${string}`,
          claimType,
          side: ticketMode,
          requestedUnits: unitsWei,
        });
        if (isMounted) setSweepQuote(res);
      } catch (err: any) {
        if (isMounted) {
          setSweepQuote(null);
          setQuoteError(err?.message || 'No available liquidity for requested size');
        }
      } finally {
        if (isMounted) setIsQuoting(false);
      }
    };

    const timer = setTimeout(loadQuote, 250);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [ticketMode, claimType, quantity, seriesAddress, chainId, address]);

  // Execute Market Sweep (BUY / SELL)
  const handleExecuteSweep = async () => {
    if (!sweepQuote || !publicClient || !address) return;
    setIsExecuting(true);
    setStatusMessage('Checking token allowances...');

    try {
      const spenderAddress = sweepQuote.to as `0x${string}`;

      // Allowance check: if BUY, user gives USDC; if SELL, user gives ClaimToken
      if (ticketMode === 'BUY') {
        const usdcCostBig = BigInt(sweepQuote.totalCostUsdc);
        const allowance = await publicClient.readContract({
          address: getAddress(usdcAddress),
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, spenderAddress],
        });

        if (allowance < usdcCostBig) {
          setStatusMessage('Approving USDC for trade router...');
          const appHash = await writeContractAsync({
            address: getAddress(usdcAddress),
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spenderAddress, BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')],
          });
          await publicClient.waitForTransactionReceipt({ hash: appHash });
        }
      } else {
        const unitsBig = BigInt(sweepQuote.requestedUnits);
        const allowance = await publicClient.readContract({
          address: getAddress(activeClaimToken),
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, spenderAddress],
        });

        if (allowance < unitsBig) {
          setStatusMessage('Approving Claim tokens for trade router...');
          const appHash = await writeContractAsync({
            address: getAddress(activeClaimToken),
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spenderAddress, BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')],
          });
          await publicClient.waitForTransactionReceipt({ hash: appHash });
        }
      }

      // Execute transaction
      setStatusMessage('Sending fill transaction to Base...');
      if (!sweepQuote.transactionData || !sweepQuote.to) {
        throw new Error('Transaction data not available in quote');
      }

      // Send raw transaction
      const txHash = await (window as any).ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: address,
            to: sweepQuote.to,
            data: sweepQuote.transactionData,
            value: '0x0',
          },
        ],
      });

      setStatusMessage('Waiting for Base confirmation...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setStatusMessage('Trade executed successfully!');
      setTimeout(() => {
        setStatusMessage(null);
        if (onTradeSuccess) onTradeSuccess();
      }, 1500);
    } catch (err: any) {
      alert(`Trade failed: ${err?.message || err}`);
      setStatusMessage(null);
    } finally {
      setIsExecuting(false);
    }
  };

  // Submit Limit Order
  const handlePlaceLimitOrder = async () => {
    if (!address || !publicClient) return;
    const parsedQty = parseFloat(quantity);
    const parsedPrice = parseFloat(limitPrice);
    if (!parsedQty || !parsedPrice) {
      alert('Enter valid quantity and price');
      return;
    }

    setIsExecuting(true);
    setStatusMessage('Preparing EIP-712 limit order...');

    try {
      const claimAmountBig = BigInt(Math.floor(parsedQty * 1e8)); // 8 dec
      const usdcAmountBig = BigInt(Math.floor(parsedQty * parsedPrice * 1e6)); // 6 dec
      const expiry = Math.floor(Date.now() / 1000) + limitExpiryDays * 86400;
      const salt = Math.floor(Math.random() * 1e9).toString();

      // Check maker approval to 0x Exchange Proxy
      const zeroExProxy = ZERO_EX_EXCHANGE_PROXY_BASE as `0x${string}`;
      const tokenToApprove = ticketMode === 'SELL' ? activeClaimToken : usdcAddress;
      const amountToApprove = ticketMode === 'SELL' ? claimAmountBig : usdcAmountBig;

      const allowance = await publicClient.readContract({
        address: getAddress(tokenToApprove),
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, zeroExProxy],
      });

      if (allowance < amountToApprove) {
        setStatusMessage('Approving 0x Exchange Proxy for limit order...');
        const appHash = await writeContractAsync({
          address: getAddress(tokenToApprove),
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [zeroExProxy, BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')],
        });
        await publicClient.waitForTransactionReceipt({ hash: appHash });
      }

      // Maker vs Taker token assignment
      const makerToken = ticketMode === 'SELL' ? activeClaimToken : usdcAddress;
      const takerToken = ticketMode === 'SELL' ? usdcAddress : activeClaimToken;
      const makerAmount = ticketMode === 'SELL' ? claimAmountBig.toString() : usdcAmountBig.toString();
      const takerAmount = ticketMode === 'SELL' ? usdcAmountBig.toString() : claimAmountBig.toString();

      const orderData = {
        makerToken: getAddress(makerToken),
        takerToken: getAddress(takerToken),
        makerAmount: BigInt(makerAmount),
        takerAmount: BigInt(takerAmount),
        takerTokenFeeAmount: BigInt(0),
        maker: getAddress(address),
        taker: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        sender: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        feeRecipient: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        pool: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        expiry: BigInt(expiry),
        salt: BigInt(salt),
      };

      // Sign typed data
      setStatusMessage('Sign EIP-712 limit order in wallet...');
      const sigHex = await signTypedDataAsync({
        domain: {
          name: 'ZeroEx',
          version: '1.0.0',
          chainId: BigInt(chainId),
          verifyingContract: zeroExProxy,
        },
        types: {
          LimitOrder: [
            { name: 'makerToken', type: 'address' },
            { name: 'takerToken', type: 'address' },
            { name: 'makerAmount', type: 'uint128' },
            { name: 'takerAmount', type: 'uint128' },
            { name: 'takerTokenFeeAmount', type: 'uint128' },
            { name: 'maker', type: 'address' },
            { name: 'taker', type: 'address' },
            { name: 'sender', type: 'address' },
            { name: 'feeRecipient', type: 'address' },
            { name: 'pool', type: 'bytes32' },
            { name: 'expiry', type: 'uint64' },
            { name: 'salt', type: 'uint256' },
          ],
        },
        primaryType: 'LimitOrder',
        message: orderData,
      });

      const parsedSig = parseSignature(sigHex);
      const formattedSig = {
        r: parsedSig.r,
        s: parsedSig.s,
        v: Number(parsedSig.v),
        signatureType: 2,
      };

      setStatusMessage('Submitting order to orderbook...');
      await submitLimitOrder(
        chainId,
        seriesAddress,
        claimType,
        {
          makerToken: orderData.makerToken,
          takerToken: orderData.takerToken,
          makerAmount: orderData.makerAmount.toString(),
          takerAmount: orderData.takerAmount.toString(),
          takerTokenFeeAmount: '0',
          maker: orderData.maker,
          taker: orderData.taker,
          sender: orderData.sender,
          feeRecipient: orderData.feeRecipient,
          pool: orderData.pool,
          expiry: orderData.expiry.toString(),
          salt: orderData.salt.toString(),
        },
        formattedSig,
      );

      setStatusMessage('Limit order resting on book!');
      setTimeout(() => {
        setStatusMessage(null);
        if (onTradeSuccess) onTradeSuccess();
      }, 1500);
    } catch (err: any) {
      alert(`Order placement failed: ${err?.message || err}`);
      setStatusMessage(null);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className={styles.ticketPanel}>
      {/* Mode Switcher */}
      <div className={styles.ticketTypeTabs}>
        <button
          type="button"
          onClick={() => setTicketMode('BUY')}
          className={`${styles.ticketTypeTab} ${ticketMode === 'BUY' ? styles.ticketTypeTabActive : ''}`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setTicketMode('SELL')}
          className={`${styles.ticketTypeTab} ${ticketMode === 'SELL' ? styles.ticketTypeTabActive : ''}`}
        >
          Sell
        </button>
        <button
          type="button"
          onClick={() => setTicketMode('LIMIT')}
          className={`${styles.ticketTypeTab} ${ticketMode === 'LIMIT' ? styles.ticketTypeTabActive : ''}`}
        >
          Limit
        </button>
      </div>

      {/* Claim Type Switcher */}
      <div className={styles.ticketClaimTabs}>
        <button
          type="button"
          onClick={() => setClaimType('UPSIDE')}
          className={`${styles.ticketClaimTab} ${claimType === 'UPSIDE' ? styles.ticketClaimTabActive : ''}`}
        >
          Upside Claim (UP)
        </button>
        <button
          type="button"
          onClick={() => setClaimType('RESIDUAL')}
          className={`${styles.ticketClaimTab} ${claimType === 'RESIDUAL' ? styles.ticketClaimTabActive : ''}`}
        >
          Residual Claim (RES)
        </button>
      </div>

      {/* Target Info Pill */}
      <div className="p-3 rounded-lg bg-[#10110f] border border-[#292a27] mb-4 text-xs font-mono flex justify-between items-center">
        <span className="text-zinc-400">Selected Target:</span>
        <span className="text-white font-bold">{targetLabel} (${strikeFormatted})</span>
      </div>

      {/* Quantity Input */}
      <div className={styles.inputGroup}>
        <label>
          <span>Quantity to {ticketMode === 'SELL' ? 'Sell' : 'Buy'}</span>
          <span>Units</span>
        </label>
        <div className={styles.inputWrapper}>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={isExecuting}
          />
          <span className={styles.inputUnit}>Claims</span>
        </div>
      </div>

      {/* Limit Price Input if in LIMIT mode */}
      {ticketMode === 'LIMIT' && (
        <div className={styles.inputGroup}>
          <label>
            <span>Limit Price</span>
            <span>USDC / Unit</span>
          </label>
          <div className={styles.inputWrapper}>
            <input
              type="number"
              step="0.05"
              min="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              disabled={isExecuting}
            />
            <span className={styles.inputUnit}>USDC</span>
          </div>
        </div>
      )}

      {/* Sweep Quote Summary (BUY / SELL) */}
      {ticketMode !== 'LIMIT' && (
        <div className={styles.sweepSummary}>
          {isQuoting ? (
            <div className="py-2 text-center text-zinc-500 font-mono animate-pulse">
              Calculating sweep across levels...
            </div>
          ) : quoteError ? (
            <div className="text-red-400 font-mono text-[11px]">{quoteError}</div>
          ) : sweepQuote ? (
            <>
              <div className={styles.summaryRow}>
                <span>Average Price</span>
                <strong>${sweepQuote.averagePriceUsdc.toFixed(4)} USDC</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Total Cost</span>
                <strong>${(Number(sweepQuote.totalCostUsdc) / 1e6).toFixed(2)} USDC</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Levels Swept</span>
                <span className="font-mono text-zinc-400">{sweepQuote.levels.length} order level(s)</span>
              </div>
            </>
          ) : (
            <div className="text-zinc-500 text-center py-1">Enter quantity to view sweep quote</div>
          )}
        </div>
      )}

      {/* Status banner */}
      {statusMessage && (
        <div className="mb-4 p-3 rounded bg-emerald-950/40 border border-emerald-800 text-xs font-mono text-emerald-300 animate-pulse text-center">
          {statusMessage}
        </div>
      )}

      {/* Action Button */}
      {!isConnected ? (
        <button type="button" disabled className={styles.actionButton}>
          Connect Wallet to Trade
        </button>
      ) : ticketMode === 'LIMIT' ? (
        <button
          type="button"
          onClick={handlePlaceLimitOrder}
          disabled={isExecuting}
          className={styles.actionButton}
        >
          {isExecuting ? 'Processing...' : 'Sign & Place Limit Order'}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleExecuteSweep}
          disabled={!sweepQuote || isQuoting || isExecuting}
          className={styles.actionButton}
        >
          {isExecuting
            ? 'Executing...'
            : `${ticketMode === 'BUY' ? 'Buy' : 'Sell'} ${quantity} ${claimType === 'UPSIDE' ? 'UP' : 'RES'} Claims`}
        </button>
      )}
    </div>
  );
}
