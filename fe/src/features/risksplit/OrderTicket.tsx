"use client";

import React, { useState } from "react";
import { useAccount, useChainId, usePublicClient, useSignTypedData, useReadContract, useWriteContract } from "wagmi";
import {
  BASE_USDC_ADDRESS,
  LIMIT_ORDER_EIP712_TYPES,
  ZERO_EX_EIP712_DOMAIN,
  ZERO_EX_EXCHANGE_PROXY_BASE,
  ZERO_EX_LIMIT_ORDER_ABI,
  ZeroExLimitOrder,
  ZeroExSignature,
  toZeroExAbiOrder,
} from "@othelio/shared";
import { parseUnits, formatUnits, getAddress, parseAbi, maxUint256 } from "viem";
import { BookLevel } from "./useRiskSplitBook";
import { computeSingleOrderTrade, formatSignedDifference } from "./tradeTicketLogic";
import styles from "./RiskSplitMarkets.module.css";
import { WalletConnectModal } from "@/components/WalletConnectModal";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

interface OrderTicketProps {
  seriesAddress: string;
  claimType: "protected" | "upside";
  claimTokenAddress: string;
  claimDecimals: number | null;
  symbol: string;
  seriesExpiryTimestamp: number;
  scenarioPrice: number;
  scenarioPayoffPerClaim: number;
  selectedOrder: BookLevel | null;
  isBookLoading: boolean;
  isBookError: boolean;
  side: "BUY" | "SELL";
  onChangeSide: (newSide: "BUY" | "SELL") => void;
  onOrderCreated?: () => void;
}

export function OrderTicket({
  seriesAddress,
  claimType,
  claimTokenAddress,
  claimDecimals,
  symbol,
  seriesExpiryTimestamp,
  scenarioPrice,
  scenarioPayoffPerClaim,
  selectedOrder,
  isBookLoading,
  isBookError,
  side,
  onChangeSide,
  onOrderCreated,
}: OrderTicketProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  const { writeContractAsync, isPending: isTxPending } = useWriteContract();

  const [isLimitMode, setIsLimitMode] = useState(false);
  const [limitPriceInput, setLimitPriceInput] = useState("");
  const [amountClaimsInput, setAmountClaimsInput] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWaitingReceipt, setIsWaitingReceipt] = useState(false);

  const isBuy = side === "BUY";
  const claimLabel = claimType === "protected" ? "Protected" : "Upside";
  const userToken = isBuy ? BASE_USDC_ADDRESS : claimTokenAddress;
  const userDecimals = isBuy ? 6 : (claimDecimals ?? 0);

  // Read balance and allowance for 0x ExchangeProxy
  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    address: userToken as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && userToken) },
  });

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: userToken as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, ZERO_EX_EXCHANGE_PROXY_BASE] : undefined,
    query: { enabled: Boolean(address && userToken) },
  });

  const userBalanceStr = balanceData && (isBuy || claimDecimals !== null)
    ? formatUnits(balanceData, userDecimals)
    : "0";
  const userAllowance = allowanceData ?? BigInt(0);

  // Metrics for Immediate Fill mode
  const fillMetrics = computeSingleOrderTrade({
    side,
    requestedAmountClaims: amountClaimsInput,
    selectedOrder,
    scenarioPayoffPerClaim,
  });

  // Metrics for Limit Order mode
  const limitPriceNum = parseFloat(limitPriceInput) || 0;
  const requestedAmtNum = parseFloat(amountClaimsInput) || 0;
  const limitTotalUsdc = requestedAmtNum * limitPriceNum;
  const limitScenarioWorth = requestedAmtNum * scenarioPayoffPerClaim;
  const limitDiff = isBuy ? limitScenarioWorth - limitTotalUsdc : limitScenarioWorth;
  const hasLimitQuote = requestedAmtNum > 0 && limitPriceNum > 0;
  const totalDisplay = isLimitMode
    ? hasLimitQuote ? `$${limitTotalUsdc.toFixed(2)}` : "—"
    : fillMetrics.isValid ? `$${fillMetrics.totalUsdc.toFixed(2)}` : "—";
  const scenarioDisplay = isLimitMode
    ? hasLimitQuote ? `$${limitScenarioWorth.toFixed(2)}` : "—"
    : fillMetrics.isValid ? `$${fillMetrics.scenarioWorth.toFixed(2)}` : "—";

  // Compute required units for onchain approval and fill
  let claimUnits = BigInt(0);
  let totalUsdcUnits = BigInt(0);
  const activeAmountStr = isLimitMode ? amountClaimsInput : fillMetrics.effectiveAmountClaims;
  const activePriceStr = isLimitMode ? limitPriceInput : fillMetrics.priceUsd;

  try {
    if (claimDecimals !== null && claimDecimals >= 0 && claimDecimals <= 36 && activeAmountStr) {
      claimUnits = parseUnits(activeAmountStr, claimDecimals);
    }
    if (activePriceStr) {
      const priceE6 = parseUnits(activePriceStr, 6);
      if (claimDecimals !== null) {
        totalUsdcUnits = (claimUnits * priceE6) / (BigInt(10) ** BigInt(claimDecimals));
      }
    }
  } catch {
    // handled gracefully via validation checks
  }

  const requiredUnits = isBuy ? totalUsdcUnits : claimUnits;
  const needsApproval = isConnected && userAllowance < requiredUnits && requiredUnits > BigInt(0);

  const handleMax = () => {
    if (!isLimitMode && selectedOrder) {
      const availableInOrder = parseFloat(selectedOrder.amountClaim) || 0;
      if (!isBuy) {
        const userBal = parseFloat(userBalanceStr) || 0;
        const maxFill = Math.min(userBal, availableInOrder);
        setAmountClaimsInput(maxFill.toString());
      } else {
        const orderPrice = parseFloat(fillMetrics.priceUsd) || 0;
        const userUsdc = parseFloat(userBalanceStr) || 0;
        if (orderPrice > 0) {
          const maxAfford = userUsdc / orderPrice;
          const maxFill = Math.min(maxAfford, availableInOrder);
          setAmountClaimsInput(maxFill.toFixed(4));
        } else {
          setAmountClaimsInput(selectedOrder.amountClaim);
        }
      }
    } else {
      if (!isBuy) {
        setAmountClaimsInput(userBalanceStr);
      } else if (limitPriceNum > 0) {
        const userUsdc = parseFloat(userBalanceStr) || 0;
        const maxClaims = userUsdc / limitPriceNum;
        setAmountClaimsInput(maxClaims.toFixed(4));
      }
    }
  };

  const handleApprove = async () => {
    setErrorMessage(null);
    try {
      if (!publicClient) throw new Error("Wallet RPC is unavailable");
      const hash = await writeContractAsync({
        address: userToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ZERO_EX_EXCHANGE_PROXY_BASE, maxUint256],
      });
      setIsWaitingReceipt(true);
      setStatusMessage("Waiting for approval confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Token approval reverted");
      await refetchAllowance();
      setStatusMessage("Approval confirmed");
      setTimeout(() => setStatusMessage(null), 3500);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Token approval failed");
    } finally {
      setIsWaitingReceipt(false);
    }
  };

  const handleFillOrder = async () => {
    if (!address || !isConnected) {
      setErrorMessage("Please connect your wallet first.");
      return;
    }
    if (!selectedOrder?.orderHash) {
      setErrorMessage("No fillable order selected. Choose an available order in the book.");
      return;
    }
    if (claimDecimals === null || claimUnits <= BigInt(0) || totalUsdcUnits <= BigInt(0)) {
      setErrorMessage("Please enter a valid claim amount to fill.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage("Preparing fill transaction…");

    try {
      if (!publicClient) throw new Error("Wallet RPC is unavailable");
      const takerFillUnits = isBuy ? totalUsdcUnits : claimUnits;

      const buildRes = await fetch(
        `${API_BASE}/v1/orders/${selectedOrder.orderHash}/build-fill?chainId=${chainId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            takerAddress: address,
            takerTokenFillAmount: takerFillUnits.toString(),
          }),
        }
      );

      if (!buildRes.ok) {
        const errJson = await buildRes.json().catch(() => ({}));
        throw new Error(errJson.message || "Failed to build fill transaction");
      }

      const fillData = await buildRes.json();
      setStatusMessage("Confirming fill transaction in wallet…");

      const txHash = await writeContractAsync({
        address: fillData.target as `0x${string}`,
        abi: ZERO_EX_LIMIT_ORDER_ABI,
        functionName: "fillLimitOrder",
        args: [toZeroExAbiOrder(fillData.args[0]), fillData.args[1], BigInt(fillData.args[2])],
      });

      setIsWaitingReceipt(true);
      setStatusMessage(`Waiting for onchain fill ${txHash.slice(0, 10)}…`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Order fill reverted");

      const reconcileRes = await fetch(`${API_BASE}/v1/orders/${selectedOrder.orderHash}/reconcile-fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      if (!reconcileRes.ok) {
        const errorJson = await reconcileRes.json().catch(() => ({}));
        throw new Error(errorJson.message || "Fill confirmed, but book reconciliation failed");
      }

      setStatusMessage("Fill confirmed and book reconciled!");
      setAmountClaimsInput("");
      await Promise.all([refetchBalance(), refetchAllowance()]);
      onOrderCreated?.();
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Fill execution failed");
      setStatusMessage(null);
    } finally {
      setIsWaitingReceipt(false);
    }
  };

  const handlePlaceLimitOrder = async () => {
    if (!address || !isConnected) {
      setErrorMessage("Please connect your wallet first.");
      return;
    }
    if (claimDecimals === null || claimUnits <= BigInt(0) || totalUsdcUnits <= BigInt(0)) {
      setErrorMessage("Enter a valid claim amount and limit price.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage("Preparing signed limit order…");

    try {
      const takerAmountUnits = isBuy ? claimUnits : totalUsdcUnits;
      const orderExpiry = Math.min(
        Math.floor(Date.now() / 1000) + 7 * 86400,
        seriesExpiryTimestamp
      );
      const salt = BigInt(Math.floor(Date.now() * 1000 + Math.random() * 1000)).toString();

      const order: ZeroExLimitOrder = {
        makerToken: (isBuy ? BASE_USDC_ADDRESS : claimTokenAddress) as `0x${string}`,
        takerToken: (isBuy ? claimTokenAddress : BASE_USDC_ADDRESS) as `0x${string}`,
        makerAmount: requiredUnits.toString(),
        takerAmount: takerAmountUnits.toString(),
        takerTokenFeeAmount: "0",
        maker: address,
        taker: "0x0000000000000000000000000000000000000000",
        sender: "0x0000000000000000000000000000000000000000",
        feeRecipient: "0x0000000000000000000000000000000000000000",
        pool: "0x0000000000000000000000000000000000000000000000000000000000000000",
        expiry: orderExpiry,
        salt,
      };

      const rawSig = await signTypedDataAsync({
        domain: ZERO_EX_EIP712_DOMAIN,
        types: LIMIT_ORDER_EIP712_TYPES,
        primaryType: "LimitOrder",
        message: {
          makerToken: getAddress(order.makerToken),
          takerToken: getAddress(order.takerToken),
          makerAmount: BigInt(order.makerAmount),
          takerAmount: BigInt(order.takerAmount),
          takerTokenFeeAmount: BigInt(0),
          maker: getAddress(order.maker),
          taker: getAddress(order.taker),
          sender: getAddress(order.sender),
          feeRecipient: getAddress(order.feeRecipient),
          pool: order.pool as `0x${string}`,
          expiry: BigInt(order.expiry),
          salt: BigInt(order.salt),
        },
      });

      const signature: ZeroExSignature = {
        signatureType: 2,
        v: parseInt(rawSig.slice(130, 132), 16),
        r: rawSig.slice(0, 66) as `0x${string}`,
        s: ("0x" + rawSig.slice(66, 130)) as `0x${string}`,
      };

      setStatusMessage("Broadcasting order to order book…");

      const res = await fetch(`${API_BASE}/v1/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order,
          signature,
          chainId,
          seriesAddress,
          claimType: claimType.toUpperCase(),
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.message || "Failed to post order to book");
      }

      setStatusMessage("Order posted successfully to the book!");
      setAmountClaimsInput("");
      setLimitPriceInput("");
      setTimeout(() => setStatusMessage(null), 3500);
      onOrderCreated?.();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to sign or submit order");
      setStatusMessage(null);
    }
  };

  const [showConnect, setShowConnect] = useState(false);
  const isBusy = isSigning || isTxPending || isWaitingReceipt;

  return (
    <aside className={styles.ticketCard} aria-label="Trade ticket">
      {/* Side Toggle: Buy / Sell */}
      <div className={styles.ticketSideToggle} role="group" aria-label="Trade direction">
        <button
          type="button"
          onClick={() => onChangeSide("BUY")}
          className={`${styles.ticketSideBtn} ${isBuy ? styles.ticketSideBtnActive : ""}`}
          aria-pressed={isBuy}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => onChangeSide("SELL")}
          className={`${styles.ticketSideBtn} ${!isBuy ? styles.ticketSideBtnActive : ""}`}
          aria-pressed={!isBuy}
        >
          Sell
        </button>
      </div>

      <h2 className={styles.ticketTitle}>
        3. {isBuy ? "Buy" : "Sell"} {claimLabel}
      </h2>
      <div className={styles.ticketModeRow}>
        <span>Order type</span>
        <div className={styles.ticketModeToggle} role="group" aria-label="Order type">
          <button type="button" className={!isLimitMode ? styles.ticketModeActive : ""} aria-pressed={!isLimitMode} onClick={() => { setIsLimitMode(false); setErrorMessage(null); }}>Trade now</button>
          <button type="button" className={isLimitMode ? styles.ticketModeActive : ""} aria-pressed={isLimitMode} onClick={() => { setIsLimitMode(true); setErrorMessage(null); }}>Set my price</button>
        </div>
      </div>
      {/* Available Balance in Wallet */}
      <div className={styles.ticketBalanceRow}>
        <span>In wallet:</span>
        <b>
          {userBalanceStr} {isBuy ? "USDC" : `${claimLabel} claims`}
        </b>
      </div>

      {/* Amount Input */}
      <div className={styles.ticketField}>
        <div className={styles.ticketFieldHeader}>
          <label htmlFor="ticket-amount">How many claims?</label>
          <button type="button" onClick={handleMax} className={styles.maxLink}>
            Max
          </button>
        </div>
        <div className={styles.ticketInputWrapper}>
          <input
            id="ticket-amount"
            type="number"
            min="0.0001"
            step="0.01"
            placeholder="0.00"
            value={amountClaimsInput}
            onChange={(e) => setAmountClaimsInput(e.target.value)}
            inputMode="decimal"
          />
          <span className={styles.ticketInputUnit}>claims</span>
        </div>
      </div>

      {/* Capped Warning if user asks for more than selected order */}
      {!isLimitMode && fillMetrics.isCapped && (
        <div className={styles.cappedNotice} role="note">
          Limited to {fillMetrics.availableInOrder} claims in this order.
        </div>
      )}

      {/* Limit Price Input (when in limit mode) */}
      {isLimitMode && (
        <div className={styles.ticketField}>
          <div className={styles.ticketFieldHeader}>
            <label htmlFor="ticket-limit-price">Price per claim</label>
          </div>
          <div className={styles.ticketInputWrapper}>
            <input
              id="ticket-limit-price"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={limitPriceInput}
              onChange={(e) => setLimitPriceInput(e.target.value)}
              inputMode="decimal"
            />
            <span className={styles.ticketInputUnit}>USDC</span>
          </div>
          <p className={styles.limitDisclaimer}>
            Your order waits in the book and may not fill.
          </p>
        </div>
      )}

      {!isLimitMode && !selectedOrder && <p className={styles.limitDisclaimer} role="status">{isBookLoading ? "Finding available prices…" : isBookError ? "Prices unavailable. Try again shortly." : `No ${isBuy ? "offers" : "bids"} yet. Choose Set my price to leave an order.`}</p>}
      {/* Financial Summary */}
      <div className={styles.ticketSummary}>
        <div className={styles.summaryRow}>
          <span>{isLimitMode ? "Limit price" : isBuy ? "Buy price" : "Sell price"}</span>
          <b>{isLimitMode ? (limitPriceNum ? `$${limitPriceNum.toFixed(2)}` : "—") : isBookLoading ? <span className={styles.numberSkeleton} role="status" aria-label="Loading price" /> : selectedOrder ? `$${fillMetrics.priceUsd}` : "—"}</b>
        </div>
        <div className={styles.summaryRow}>
          <span>{isBuy ? "You pay" : "You receive"}</span>
          <b>{totalDisplay}</b>
        </div>
        <div className={`${styles.summaryRow} ${styles.summaryHighlight}`}>
          <span>Value if stock ends at ${scenarioPrice.toFixed(2)}</span>
          <b>{scenarioDisplay}</b>
        </div>
        <div className={styles.summaryRow}>
          <span>{isBuy ? "Gain / loss at that price" : "Value given up"}</span>
          <b>
            {isLimitMode
              ? hasLimitQuote ? isBuy ? formatSignedDifference(limitDiff) : `$${limitScenarioWorth.toFixed(2)}` : "—"
              : fillMetrics.isValid
              ? isBuy
                ? formatSignedDifference(fillMetrics.differenceFromCost)
                : `$${fillMetrics.scenarioWorth.toFixed(2)}`
              : "—"}
          </b>
        </div>
      </div>

      <p className={styles.ticketExplain}>
        {isBuy
          ? `Max loss: amount paid. Redeems in ${symbol}.`
          : `Selling gives up this claim’s ${symbol} payout.`}
      </p>

      {/* Messages */}
      {statusMessage && <div className={styles.statusBox}>{statusMessage}</div>}
      {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

      {/* Primary Action Button */}
      <div className={styles.ticketActionArea}>
        {!isConnected ? (
          <button type="button" className={`ui-button ${styles.primaryActionBtn}`} onClick={() => setShowConnect(true)}>Connect wallet</button>
        ) : needsApproval ? (
          <button
            type="button"
            onClick={handleApprove}
            disabled={isBusy}
            className={`ui-button ${styles.primaryActionBtn}`}
          >
            {isBusy ? "Approving in Wallet…" : `Approve ${isBuy ? "USDC" : "Claims"} for Trading`}
          </button>
        ) : !isLimitMode ? (
          <button
            type="button"
            onClick={handleFillOrder}
            disabled={
              isBusy ||
              !selectedOrder ||
              !fillMetrics.isValid ||
              claimDecimals === null ||
              claimUnits <= BigInt(0)
            }
            className={`ui-button ${styles.primaryActionBtn}`}
          >
            {isBusy
              ? "Executing Fill…"
              : !selectedOrder
              ? `No ${isBuy ? "Offers" : "Bids"} to Fill`
              : requestedAmtNum <= 0
              ? "Enter Amount"
              : `${isBuy ? "Buy" : "Sell"} ${fillMetrics.effectiveAmountClaims} ${claimLabel}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlaceLimitOrder}
            disabled={
              isBusy ||
              claimDecimals === null ||
              claimUnits <= BigInt(0) ||
              limitPriceNum <= 0 ||
              totalUsdcUnits <= BigInt(0)
            }
            className={`ui-button ${styles.primaryActionBtn}`}
          >
            {isBusy ? "Signing in Wallet…" : `Sign Limit ${side} Order`}
          </button>
        )}
      </div>

      <WalletConnectModal isOpen={showConnect} onClose={() => setShowConnect(false)} />
    </aside>
  );
}
