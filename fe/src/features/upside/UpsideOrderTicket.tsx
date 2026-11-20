"use client";

import React, { useState, useEffect } from "react";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import styles from "./UpsideMarkets.module.css";
import { fetchSweepQuote, submitLimitOrder, useUpsideOrderbook } from "./useUpside";
import {
  UpsideSweepQuoteResponse,
  ZERO_EX_EXCHANGE_PROXY_BASE,
} from "@/types/shared";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useSendTransaction,
  useWriteContract,
} from "wagmi";
import { parseUnits, parseSignature, getAddress, parseAbi } from "viem";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

interface UpsideOrderTicketProps {
  chainId: number;
  seriesAddress: string;
  strikeFormatted: string;
  claimType: "UPSIDE" | "RESIDUAL";
  symbol: string;
  scenarioPrice: number;
  scenarioPayout: number;
  tradingClosed: boolean;
  expiryTimestamp: number;
  upsideTokenAddress: string;
  residualTokenAddress: string;
  onTradeSuccess?: () => void;
}

export function UpsideOrderTicket({
  chainId,
  seriesAddress,
  claimType,
  symbol,
  scenarioPrice,
  scenarioPayout,
  tradingClosed,
  expiryTimestamp,
  upsideTokenAddress,
  residualTokenAddress,
  onTradeSuccess,
}: UpsideOrderTicketProps) {
  const [ticketMode, setTicketMode] = useState<"BUY" | "SELL">("BUY");
  const [isLimitMode, setIsLimitMode] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [quantity, setQuantity] = useState<string>("1.0");
  const [limitPrice, setLimitPrice] = useState<string>("");

  const [quoteState, setQuoteState] = useState<{
    key: string;
    quote?: UpsideSweepQuoteResponse;
    error?: string;
  } | null>(null);
  const quantityValid =
    /^\d*(?:\.\d{0,8})?$/.test(quantity) &&
    Number.isFinite(Number(quantity)) &&
    Number(quantity) > 0;
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { data: book, errorUpdatedAt: bookFailureRevision, isUnavailable: bookUnavailable } =
    useUpsideOrderbook(chainId, seriesAddress, claimType);
  const matchingLevels = ticketMode === "BUY" ? book?.asks : book?.bids;
  const hasMatchingLiquidity = !!matchingLevels?.length;
  // Refresh when the executable side changes, not on every identical book poll.
  const liquidityKey = JSON.stringify(matchingLevels ?? null);

  const activeClaimToken =
    claimType === "UPSIDE" ? upsideTokenAddress : residualTokenAddress;
  const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  // Bind every quote to its inputs so changing sides/size never displays or executes an old price.
  const quoteKey = [
    chainId,
    seriesAddress,
    claimType,
    ticketMode,
    quantity,
    address,
    isLimitMode,
    quoteRevision,
    bookFailureRevision,
    bookUnavailable,
    liquidityKey,
  ].join(":");
  const sweepQuote =
    hasMatchingLiquidity && quoteState?.key === quoteKey ? quoteState.quote : undefined;
  const quoteError = bookUnavailable
    ? "Order book unavailable. Retry the book to refresh your price."
    : book && !hasMatchingLiquidity
      ? `No ${ticketMode === "BUY" ? "offers" : "bids"} yet. Choose Limit to leave an order.`
      : quoteState?.key === quoteKey ? quoteState.error : undefined;
  const isQuoting =
    !isLimitMode &&
    !tradingClosed &&
    !bookUnavailable &&
    (!book || hasMatchingLiquidity) &&
    quantityValid &&
    quoteState?.key !== quoteKey;
  const claimLabel = claimType === "UPSIDE" ? "Upside" : "Remaining value";
  const validLimit =
    Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0;
  const completeQuote =
    !!sweepQuote &&
    BigInt(sweepQuote.executableUnits) >=
      parseUnits(quantityValid ? quantity : "0", 8) &&
    BigInt(sweepQuote.executableUnits) > BigInt(0);
  const totalCost = isLimitMode
    ? validLimit
      ? Number(limitPrice) * Number(quantity)
      : null
    : sweepQuote && completeQuote
      ? Number(sweepQuote.totalCostUsdc) / 1e6
      : null;
  const scenarioValue = scenarioPayout * (quantityValid ? Number(quantity) : 0);

  useEffect(() => {
    if (isLimitMode || tradingClosed || !quantityValid || bookUnavailable || !hasMatchingLiquidity) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const quote = await fetchSweepQuote(chainId, seriesAddress, {
          seriesAddress: seriesAddress as `0x${string}`,
          takerAddress: address || "0x0000000000000000000000000000000000000000",
          claimType,
          side: ticketMode,
          requestedUnits: parseUnits(quantity, 8).toString(),
        });
        if (!cancelled) setQuoteState({ key: quoteKey, quote });
      } catch {
        if (!cancelled)
          setQuoteState({
            key: quoteKey,
            error:
              "No price available for this amount. Try a smaller amount or set your own price.",
          });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    chainId,
    seriesAddress,
    address,
    claimType,
    ticketMode,
    quantity,
    isLimitMode,
    tradingClosed,
    quantityValid,
    bookUnavailable,
    hasMatchingLiquidity,
    quoteKey,
  ]);

  // Execute Market Sweep (BUY / SELL)
  const handleExecuteSweep = async () => {
    if (
      !sweepQuote ||
      !publicClient ||
      !address ||
      !completeQuote ||
      tradingClosed ||
      Date.now() / 1000 >= expiryTimestamp
    )
      return;
    if (Date.now() / 1000 >= sweepQuote.quoteExpiry) {
      setQuoteRevision((revision) => revision + 1);
      setStatusMessage("Price expired. Refreshing your quote…");
      return;
    }
    setIsExecuting(true);
    setStatusMessage("Checking token allowances...");

    try {
      const spenderAddress = sweepQuote.to as `0x${string}`;

      // Allowance check: if BUY, user gives USDC; if SELL, user gives ClaimToken
      if (ticketMode === "BUY") {
        const usdcCostBig = BigInt(sweepQuote.totalCostUsdc);
        const allowance = await publicClient.readContract({
          address: getAddress(usdcAddress),
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, spenderAddress],
        });

        if (allowance < usdcCostBig) {
          setStatusMessage("Approving USDC for trade router...");
          const appHash = await writeContractAsync({
            address: getAddress(usdcAddress),
            abi: ERC20_ABI,
            functionName: "approve",
            args: [
              spenderAddress,
              BigInt(
                "115792089237316195423570985008687907853269984665640564039457584007913129639935",
              ),
            ],
          });
          await publicClient.waitForTransactionReceipt({ hash: appHash });
        }
      } else {
        const unitsBig = BigInt(sweepQuote.requestedUnits);
        const allowance = await publicClient.readContract({
          address: getAddress(activeClaimToken),
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, spenderAddress],
        });

        if (allowance < unitsBig) {
          setStatusMessage("Approving Claim tokens for trade router...");
          const appHash = await writeContractAsync({
            address: getAddress(activeClaimToken),
            abi: ERC20_ABI,
            functionName: "approve",
            args: [
              spenderAddress,
              BigInt(
                "115792089237316195423570985008687907853269984665640564039457584007913129639935",
              ),
            ],
          });
          await publicClient.waitForTransactionReceipt({ hash: appHash });
        }
      }

      // Execute transaction
      setStatusMessage("Sending fill transaction to Base...");
      if (!sweepQuote.transactionData || !sweepQuote.to) {
        throw new Error("Transaction data not available in quote");
      }

      // Send raw transaction
      const txHash = await sendTransactionAsync({
        to: sweepQuote.to,
        data: sweepQuote.transactionData,
        value: BigInt(0),
      });

      setStatusMessage("Waiting for Base confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setStatusMessage("Trade completed.");
      setQuoteRevision((revision) => revision + 1);
      setTimeout(() => {
        setStatusMessage(null);
        if (onTradeSuccess) onTradeSuccess();
      }, 1500);
    } catch (err: unknown) {
      alert(
        `Trade failed: ${err instanceof Error ? err.message : "Please try again."}`,
      );
      setStatusMessage(null);
    } finally {
      setIsExecuting(false);
    }
  };

  // Submit Limit Order
  const handlePlaceLimitOrder = async () => {
    if (
      !address ||
      !publicClient ||
      !quantityValid ||
      !validLimit ||
      tradingClosed ||
      Date.now() / 1000 >= expiryTimestamp
    )
      return;
    const parsedQty = parseFloat(quantity);
    const parsedPrice = parseFloat(limitPrice);
    if (!parsedQty || !parsedPrice) {
      alert("Enter valid quantity and price");
      return;
    }

    setIsExecuting(true);
    setStatusMessage("Preparing EIP-712 limit order...");

    try {
      const claimAmountBig = parseUnits(quantity, 8); // 8 dec
      const usdcAmountBig = BigInt(Math.floor(parsedQty * parsedPrice * 1e6)); // 6 dec
      const expiry = Math.min(
        Math.floor(Date.now() / 1000) + 7 * 86400,
        expiryTimestamp,
      );
      const salt = Math.floor(Math.random() * 1e9).toString();

      // Check maker approval to 0x Exchange Proxy
      const zeroExProxy = ZERO_EX_EXCHANGE_PROXY_BASE as `0x${string}`;
      const tokenToApprove =
        ticketMode === "SELL" ? activeClaimToken : usdcAddress;
      const amountToApprove =
        ticketMode === "SELL" ? claimAmountBig : usdcAmountBig;

      const allowance = await publicClient.readContract({
        address: getAddress(tokenToApprove),
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, zeroExProxy],
      });

      if (allowance < amountToApprove) {
        setStatusMessage("Approving 0x Exchange Proxy for limit order...");
        const appHash = await writeContractAsync({
          address: getAddress(tokenToApprove),
          abi: ERC20_ABI,
          functionName: "approve",
          args: [
            zeroExProxy,
            BigInt(
              "115792089237316195423570985008687907853269984665640564039457584007913129639935",
            ),
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: appHash });
      }

      // Maker vs Taker token assignment
      const makerToken = ticketMode === "SELL" ? activeClaimToken : usdcAddress;
      const takerToken = ticketMode === "SELL" ? usdcAddress : activeClaimToken;
      const makerAmount =
        ticketMode === "SELL"
          ? claimAmountBig.toString()
          : usdcAmountBig.toString();
      const takerAmount =
        ticketMode === "SELL"
          ? usdcAmountBig.toString()
          : claimAmountBig.toString();

      const orderData = {
        makerToken: getAddress(makerToken),
        takerToken: getAddress(takerToken),
        makerAmount: BigInt(makerAmount),
        takerAmount: BigInt(takerAmount),
        takerTokenFeeAmount: BigInt(0),
        maker: getAddress(address),
        taker: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        sender: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        feeRecipient:
          "0x0000000000000000000000000000000000000000" as `0x${string}`,
        pool: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        expiry: BigInt(expiry),
        salt: BigInt(salt),
      };

      // Sign typed data
      setStatusMessage("Sign EIP-712 limit order in wallet...");
      const sigHex = await signTypedDataAsync({
        domain: {
          name: "ZeroEx",
          version: "1.0.0",
          chainId: BigInt(chainId),
          verifyingContract: zeroExProxy,
        },
        types: {
          LimitOrder: [
            { name: "makerToken", type: "address" },
            { name: "takerToken", type: "address" },
            { name: "makerAmount", type: "uint128" },
            { name: "takerAmount", type: "uint128" },
            { name: "takerTokenFeeAmount", type: "uint128" },
            { name: "maker", type: "address" },
            { name: "taker", type: "address" },
            { name: "sender", type: "address" },
            { name: "feeRecipient", type: "address" },
            { name: "pool", type: "bytes32" },
            { name: "expiry", type: "uint64" },
            { name: "salt", type: "uint256" },
          ],
        },
        primaryType: "LimitOrder",
        message: orderData,
      });

      const parsedSig = parseSignature(sigHex);
      const formattedSig = {
        r: parsedSig.r,
        s: parsedSig.s,
        v: Number(parsedSig.v),
        signatureType: 2,
      };

      setStatusMessage("Submitting order to orderbook...");
      await submitLimitOrder(
        chainId,
        seriesAddress,
        claimType,
        {
          makerToken: orderData.makerToken,
          takerToken: orderData.takerToken,
          makerAmount: orderData.makerAmount.toString(),
          takerAmount: orderData.takerAmount.toString(),
          takerTokenFeeAmount: "0",
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

      setStatusMessage("Order placed. Waiting for a match.");
      setTimeout(() => {
        setStatusMessage(null);
        if (onTradeSuccess) onTradeSuccess();
      }, 1500);
    } catch (err: unknown) {
      alert(
        `Order placement failed: ${err instanceof Error ? err.message : "Please try again."}`,
      );
      setStatusMessage(null);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className={styles.ticketPanel} data-order-type={isLimitMode ? "limit" : "market"}>
      <div
        className={styles.ticketTypeTabs}
        role="group"
        aria-label="Trade direction"
      >
        {(["BUY", "SELL"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={ticketMode === side}
            disabled={isExecuting}
            onClick={() => setTicketMode(side)}
            className={`${styles.ticketTypeTab} ${ticketMode === side ? styles.ticketTypeTabActive : ""}`}
          >
            {side === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <h2 className={styles.sectionTitle}>{ticketMode === "BUY" ? "Buy" : "Sell"} {claimLabel}</h2>
      <div className={styles.orderTypeRow}>
        <div className={styles.orderTypeToggle} role="group" aria-label="Order type">
          {([false, true] as const).map((limit) => (
            <button
              key={String(limit)}
              type="button"
              aria-pressed={isLimitMode === limit}
              disabled={isExecuting || tradingClosed}
              onClick={() => setIsLimitMode(limit)}
            >
              {limit ? "Limit" : "Market"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.inputGroup}>
        <label htmlFor="upside-quantity">Quantity</label>
        <div className={styles.inputWrapper}>
          <input
            id="upside-quantity"
            type="number"
            step="0.01"
            min="0.00000001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={isExecuting || tradingClosed}
            inputMode="decimal"
          />
          <span className={styles.inputUnit}>{claimLabel} claims</span>
        </div>
      </div>
      {isLimitMode && (
        <div className={styles.inputGroup}>
          <label htmlFor="upside-limit">Price per claim</label>
          <div className={styles.inputWrapper}>
            <input
              id="upside-limit"
              type="number"
              min="0.01"
              step="0.01"
              value={limitPrice}
              placeholder="0.00"
              onChange={(e) => setLimitPrice(e.target.value)}
              disabled={isExecuting}
            />
            <span className={styles.inputUnit}>USDC</span>
          </div>
          <p className={styles.helperText}>
            Your order waits for a match and may not fill. Expires in up to 7
            days, or when this market ends.
          </p>
        </div>
      )}
      {!isLimitMode && !tradingClosed && (!quantityValid || isQuoting || quoteError || (sweepQuote && !completeQuote)) && (
        <p className={styles.helperText} role="status">
          {!quantityValid
            ? "Enter an amount with up to 8 decimal places."
            : isQuoting
              ? "Finding the best available price…"
              : (quoteError ??
                (sweepQuote && !completeQuote
                  ? "Not enough available at this amount. Try fewer claims."
                  : ""))}
        </p>
      )}
      <div className={styles.sweepSummary} aria-live="polite">
        <div className={`${styles.summaryRow} ${styles.totalSummary}`}>
          <span>
            {ticketMode === "BUY" ? "You pay" : "You receive"}
            {isLimitMode ? " if filled" : ""}
          </span>
          <strong>
            {totalCost === null || !quantityValid
              ? "—"
              : `$${totalCost.toFixed(2)}`}
          </strong>
        </div>
      </div>
      <details className={styles.ticketPayout}>
        <summary>Trade outcome details</summary>
        <div className={styles.summaryRow}>
          <span>Value if stock ends at ${scenarioPrice.toFixed(2)}</span>
          <strong>
            {quantityValid ? `$${scenarioValue.toFixed(2)}` : "—"}
          </strong>
        </div>
        {ticketMode === "BUY" && (
          <div className={styles.summaryRow}>
            <span>Gain / loss at that price</span>
            <strong>
              {totalCost === null || !quantityValid
                ? "—"
                : `${scenarioValue - totalCost >= 0 ? "+" : "−"}$${Math.abs(scenarioValue - totalCost).toFixed(2)}`}
            </strong>
          </div>
        )}
        <p className={styles.helperText}>Values exclude network fees.</p>
      </details>
      {statusMessage && (
        <p className={styles.helperText} role="status">
          {statusMessage}
        </p>
      )}
      {tradingClosed ? (
        <p className={styles.helperText}>
          Trading has ended. After settlement, open Redeem / claim to collect your stock tokens.
        </p>
      ) : !isConnected ? (
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setShowConnect(true)}
        >
          Connect wallet
        </button>
      ) : (
        <button
          type="button"
          className={styles.actionButton}
          onClick={isLimitMode ? handlePlaceLimitOrder : handleExecuteSweep}
          disabled={
            isExecuting ||
            !quantityValid ||
            (isLimitMode ? !validLimit : !completeQuote || isQuoting)
          }
        >
          {isExecuting
            ? "Confirm in your wallet…"
            : isLimitMode
              ? `Place ${ticketMode === "BUY" ? "buy" : "sell"} order`
              : `${ticketMode === "BUY" ? "Buy" : "Sell"} ${claimLabel}`}
        </button>
      )}
      <p className={styles.ticketRisk}>{ticketMode === "BUY" ? "Full amount at risk" : "Selling gives up the payout"} · Pays in {symbol}, not cash</p>
      <WalletConnectModal
        isOpen={showConnect}
        onClose={() => setShowConnect(false)}
      />
    </div>
  );
}
