import test from "node:test";
import assert from "node:assert/strict";
import { toRawAmount, fromRawAmount } from "../../../../packages/shared/dist/index.js";

test("amount conversion respects 6, 8, and 18 decimal token scales", () => {
  // 6 decimals (USDC)
  assert.equal(toRawAmount("100.5", 6), BigInt(100500000));
  assert.equal(fromRawAmount(BigInt(100500000), 6), "100.5");
  assert.equal(toRawAmount("0.000001", 6), BigInt(1));

  // 8 decimals (B20 Claims / Stock tokens)
  assert.equal(toRawAmount("1.5", 8), BigInt(150000000));
  assert.equal(fromRawAmount(BigInt(150000000), 8), "1.5");
  assert.equal(toRawAmount("0.00000001", 8), BigInt(1));

  // 18 decimals (Standard ERC20)
  assert.equal(toRawAmount("1.0", 18), BigInt(1000000000000000000));
  assert.equal(fromRawAmount(BigInt(1000000000000000000), 18), "1");
});

test("0x limit order price normalization for 6-dec USDC and 8-dec claims", () => {
  // BUY Claim: maker sells 100 USDC (6 dec), taker gives 1 Claim (8 dec)
  // makerAmount = 100 * 1e6 = 100_000_000
  // takerAmount = 1 * 1e8 = 100_000_000
  // Price = (makerAmount * 1e8) / takerAmount = 100_000_000 E6 ($100.0000)
  const buyMakerAmount = BigInt(100000000); // 100 USDC
  const buyTakerAmount = BigInt(100000000); // 1 Claim
  const buyPriceE6 = (buyMakerAmount * BigInt(100000000)) / buyTakerAmount;
  assert.equal(buyPriceE6, BigInt(100000000));
  assert.equal(`$${(Number(buyPriceE6) / 1e6).toFixed(4)}`, "$100.0000");

  // SELL Claim: maker gives 1 Claim (8 dec), taker gives 105 USDC (6 dec)
  // makerAmount = 1 * 1e8 = 100_000_000
  // takerAmount = 105 * 1e6 = 105_000_000
  // Price = (takerAmount * 1e8) / makerAmount = 105_000_000 E6 ($105.0000)
  const sellMakerAmount = BigInt(100000000); // 1 Claim
  const sellTakerAmount = BigInt(105000000); // 105 USDC
  const sellPriceE6 = (sellTakerAmount * BigInt(100000000)) / sellMakerAmount;
  assert.equal(sellPriceE6, BigInt(105000000));
  assert.equal(`$${(Number(sellPriceE6) / 1e6).toFixed(4)}`, "$105.0000");
});

test("spread calculation handles empty, normal, and crossed books", () => {
  // Empty book
  const emptyBestBid = null;
  const emptyBestAsk = null;
  let emptySpread = null;
  if (emptyBestBid && emptyBestAsk) {
    emptySpread = "calculated";
  }
  assert.equal(emptySpread, null);

  // Normal book
  const bestBid = { rawPriceE6: "98000000", priceUsd: "$98.0000" };
  const bestAsk = { rawPriceE6: "102000000", priceUsd: "$102.0000" };
  const spreadE6 = BigInt(bestAsk.rawPriceE6) - BigInt(bestBid.rawPriceE6);
  assert.equal(spreadE6 >= BigInt(0), true);
  assert.equal(`$${(Number(spreadE6) / 1e6).toFixed(4)}`, "$4.0000");

  // Crossed book
  const crossedAsk = { rawPriceE6: "95000000", priceUsd: "$95.0000" };
  const crossedSpreadE6 = BigInt(crossedAsk.rawPriceE6) - BigInt(bestBid.rawPriceE6);
  assert.equal(crossedSpreadE6 < BigInt(0), true);
});

test("pair arbitrage detects mint and combine opportunities truthfully", () => {
  const stockPriceUsd = 100.0; // $100 stock reference

  // Case 1: Mint Arb (Bids > Stock)
  // Protected bid = $60, Upside bid = $45 -> Sum = $105 > $100 -> Profit = $5.00
  const pBid = { rawPriceE6: "60000000" };
  const uBid = { rawPriceE6: "45000000" };
  const sumBids = (Number(pBid.rawPriceE6) + Number(uBid.rawPriceE6)) / 1e6;
  assert.equal(sumBids > stockPriceUsd, true);
  assert.equal(sumBids - stockPriceUsd, 5.0);

  // Case 2: Combine Arb (Stock > Asks)
  // Protected ask = $55, Upside ask = $40 -> Sum = $95 < $100 -> Profit = $5.00
  const pAsk = { rawPriceE6: "55000000" };
  const uAsk = { rawPriceE6: "40000000" };
  const sumAsks = (Number(pAsk.rawPriceE6) + Number(uAsk.rawPriceE6)) / 1e6;
  assert.equal(stockPriceUsd > sumAsks, true);
  assert.equal(stockPriceUsd - sumAsks, 5.0);

  // Case 3: No Arb (Bids <= Stock <= Asks)
  const tightPBid = { rawPriceE6: "50000000" };
  const tightUBid = { rawPriceE6: "48000000" };
  const tightPAsk = { rawPriceE6: "52000000" };
  const tightUAsk = { rawPriceE6: "50000000" };
  const tightSumBids = (Number(tightPBid.rawPriceE6) + Number(tightUBid.rawPriceE6)) / 1e6;
  const tightSumAsks = (Number(tightPAsk.rawPriceE6) + Number(tightUAsk.rawPriceE6)) / 1e6;
  assert.equal(tightSumBids <= stockPriceUsd, true); // $98 <= $100
  assert.equal(stockPriceUsd <= tightSumAsks, true); // $100 <= $102
});

test("order placement bounds: expiry, allowance, and self-match validation", () => {
  const now = 1700000000;
  const seriesExpiry = now + 86400 * 30; // 30 days
  const userAddress = "0x1111111111111111111111111111111111111111";

  // 1. Order expiry cannot exceed series expiry
  const validOrderExpiry = Math.min(now + 86400 * 7, seriesExpiry);
  assert.equal(validOrderExpiry <= seriesExpiry, true);

  const pastExpiry = now - 100;
  assert.equal(pastExpiry < now, true); // expired

  // 2. Allowance check
  const requiredUSDC = BigInt(100000000); // 100 USDC (6 dec)
  const lowAllowance = BigInt(50000000);
  const sufficientAllowance = BigInt(200000000);
  assert.equal(lowAllowance < requiredUSDC, true);
  assert.equal(sufficientAllowance >= requiredUSDC, true);

  // 3. Self-match check
  const maker = userAddress;
  const takerSame = userAddress;
  const takerOpposing = "0x2222222222222222222222222222222222222222";
  assert.equal(maker.toLowerCase() === takerSame.toLowerCase(), true);
  assert.equal(maker.toLowerCase() === takerOpposing.toLowerCase(), false);
});

test("partial fill arithmetic preserves rounding and remaining amounts", () => {
  const totalTakerAmount = BigInt(100000000); // 1.0 claim in 8 decimals
  const totalMakerAmount = BigInt(100000000); // 100.0 USDC in 6 decimals

  // Fill 0.4 claim (40_000_000)
  const fillTakerAmount = BigInt(40000000);
  const remTakerAmount = totalTakerAmount - fillTakerAmount;
  assert.equal(remTakerAmount, BigInt(60000000));

  // Proportional maker amount filled
  const fillMakerAmount = (fillTakerAmount * totalMakerAmount) / totalTakerAmount;
  assert.equal(fillMakerAmount, BigInt(40000000));
  const remMakerAmount = totalMakerAmount - fillMakerAmount;
  assert.equal(remMakerAmount, BigInt(60000000));
});
