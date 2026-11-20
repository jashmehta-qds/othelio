# Risk Split Market UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Track each checkbox. Read `AGENTS.md`, `.trellis/workflow.md` and the frontend guidelines before editing. Preserve unrelated work in the current tree.

**Goal:** Make one Risk Split market understandable and tradable from one calm screen, using the interaction hierarchy in the [HTML concept](../../../.codex-visuals/stock-risk-split-concept.html).

**Architecture:** Redesign the existing `/app/risk-split/[seriesAddress]` frontend around a claim choice, an exact expiry scenario, one visible selected-claim book, and a focused Buy/Sell ticket. Keep the deployed V1 contracts and existing backend API. The HTML is an approximate journey/layout template; shipped colors, typography, spacing and components follow the Othelio app.

**Tech Stack:** Next.js 16, React 19, TypeScript, wagmi/viem, TanStack Query, CSS modules, existing Risk Split `/v1/risksplit/*` and `/v1/orders/*` endpoints. Add a small frontend component-test harness (Vitest, Testing Library and jsdom) if none is available; keep the existing Node tests for pure calculations.

**Spec:** `.codex-visuals/stock-risk-split-concept.html`, `docs/risksplit/original-v1.md`, and the decisions in this plan.

## Global Constraints

- **UI scope:** Keep V1 contracts, ABIs, series address, settlement adapter, database schema and API meaning intact. Existing Risk Split and Upside routes remain available. Do not alter the separate Upside feature.
- **Financial truth:** “Protected” is the V1 token name, not a guaranteed loss floor. It can lose value when MSFTc falls. Never describe `floorPrice` as a minimum redemption or `capPrice` as a ceiling on stock price. The two claims together own the escrowed underlying. Settlement redeems underlying stock fractions, not guaranteed USDC.
- **Payoff:** For fixing `S`, floor parameter `F` and cap parameter `C`: `S=0 → (P,U)=(0,0)`; `0<S<F → (S,0)`; `F≤S<2F → (F,S−F)`; `2F≤S<2C → (S/2,S/2)`; `S≥2C → (C,S−C)`. `P+U=S` throughout. Use the contract's actual feed scale and series values, never the mock's sample numbers as live data.
- **Trade truth:** The current V1 backend builds a fill for **one selected 0x order** (`POST /v1/orders/:hash/build-fill`). The concept's multi-level total is illustrative. This UI must not promise one-click sweeping across several levels or label such a preview executable until a separate reviewed V1 batch-fill endpoint exists. For this plan, default Buy/Sell selects the best **single** fillable order, clamps amount to that order's available size and shows its exact total; users can click another visible level. Limit orders remain available behind “Set your own price.”
- **Market data:** Distinguish current stock observation, expiry scenario, claim premium, and payout. Empty book, unavailable book, stale indexer, expired series, wrong network and missing wallet are distinct states. No synthetic chart or quote in the live UI.
- **Operations:** Keep pre-expiry split/combine and post-fixing redemption reachable under “Your position.” Settlement triggering remains accessible as a secondary operation when eligible. Do not hide a necessary recovery action.
- **Design:** Reuse the current AppShell frame, typography, surface tokens, spacing and responsive conventions. The HTML file is a prototype; do not paste its CSS or illustrative balances into the app. Avoid a second, duplicate Risk Split design system.

## Review Focus

1. **Misleading protection:** At `F=435.37,C=653.05,S=400`, Protected is worth `$400`, not `$435.37`; Task 1 pins copy and math.
2. **Price confusion:** Stock reference `$546.94`, claim ask `$113.10` and hypothetical fixing `$660` must never share one unlabeled “price” slot; Tasks 2–3 pin labels.
3. **False execution:** Amount `1.2` when the best ask has only `0.6` cannot display a one-click multi-level total; Task 3 must cap or ask the user to choose another order.
4. **Stale book:** A 503 or paused indexer is not “No offers.” Task 3 renders unavailable/retry and disables executable actions.
5. **Lifecycle:** At expiry, Split is unavailable; before fixing, individual redemption is unavailable; combine remains available until settlement. Task 4 checks each state.

## File Map

| Responsibility | Intended files |
| --- | --- |
| Exact V1 scenario math and display values | New `fe/src/features/risksplit/riskSplitPayoff.ts` and focused test |
| Market composition and claim selection | `RiskSplitMarketDetail.tsx`, `RiskSplitMarkets.module.css`; small focused components under `fe/src/features/risksplit/` if the page would otherwise grow |
| Selected claim depth and honest take-order flow | `OrderBook.tsx`, `OrderTicket.tsx`, `useRiskSplitBook.ts`, their focused tests |
| Position actions | `RiskSplitActionPanel.tsx`, `MyOrders.tsx`, component CSS |
| Existing navigation and data | Read `AppShell.tsx`, `useRiskSplit.ts`, `useRiskSplitMarkets.ts`; change only for a demonstrated need |
| Interaction test harness | `fe/package.json`, `fe/vitest.config.ts`, focused `*.test.tsx` files if no existing component runner can exercise React interactions |

## Task 1: One authoritative payoff preview

**Interfaces:** Export `riskSplitPayoff(floorE8: bigint, capE8: bigint, fixingE8: bigint): { protectedValueE8: bigint; upsideValueE8: bigint }` and a separately named display conversion for stock fractions, using integer-aware rounding. The UI may choose a scenario price; it must never write or imply an oracle fixing.

- [ ] Write a focused failing test for all five regimes, boundaries `F,2F,2C`, `S=0`, and value conservation. Pin the market example `F=435.37,C=653.05,S=660 → P=435.37,U=224.63`; also pin `S=400 → P=400,U=0`.
- [ ] Run that test and confirm the intended assertion fails; implement the helper; rerun it and the existing `riskSplitMarket.test.mjs`.
- [ ] Make the scenario UI state explicit: user-entered hypothetical stock price, both dollar-equivalent payouts, both underlying fractions, and “Receives MSFTc at settlement.” Replace the current detached payoff chart's competing formula with this helper or keep its curve as secondary detail fed by the same helper.
- [ ] Commit only this math/preview unit after tests pass.

## Task 2: Recompose the market page

**Interfaces:** Existing `RiskSplitMarketDetail({seriesAddress})` remains the route entry. The page owns one `selectedClaim: 'protected'|'upside'` state shared by side cards, book, trade ticket and payout emphasis.

- [ ] Establish a focused component runner if needed, then add an interaction test that selecting Upside changes the book/ticket claim while leaving the series address and expiry unchanged. Assert stock observation, expiry and payoff scenario have separate labels.
- [ ] Run it red; rebuild the hierarchy: compact stock/expiry header → two selectable claims with executable best bid/ask or honest empty state → interactive expiry scenario → selected book alongside sticky trade ticket → “Your position” → expandable full payoff/technical details.
- [ ] Keep real wallet balances at the action that needs them. Remove the three-balance header strip, duplicate “Market terms” block, exchange protocol jargon from the primary view and the four operational tabs above the payoff. Preserve the exact V1 parameters and addresses in expandable details.
- [ ] Run interaction test, existing Risk Split tests and `npx tsc --noEmit -p fe/tsconfig.json`; commit the composition.

## Task 3: Make the book and ticket a truthful single-order trade

**Interfaces:** Keep `useRiskSplitBook(seriesAddress, claimType)` and existing `/v1/orders` methods. A book row selects its actual `orderHash`, side and price. The default immediate ticket selects the first fillable order on the relevant side; its maximum is that order's remaining claim amount. A signed limit order is a distinct mode, with its own editable price.

- [ ] Write focused tests for best ask → Buy, best bid → Sell, switching claims, row selection, fractional amount, 6/18-decimal amounts, no order, book error/stale response, wallet/network failure, and a requested quantity larger than the selected order. Verify no multi-level quote is shown as one executable transaction.
- [ ] Run tests red; adapt `OrderBook`, `OrderTicket` and book hook to the shared selected claim and order. Show best price, selected order size, total USDC, estimated claim quantity and scenario value. Keep the order book visible, showing a compact initial depth and “See full book” for more rows.
- [ ] Put “Set your own price” behind a disclosure. Its confirmation must say the order may remain unfilled. Keep onchain approval, wallet confirmation, fill receipt and cancel states visible in the ticket/My Orders without exposing 0x terms in primary copy.
- [ ] Run focused FE tests and `npx tsc --noEmit -p fe/tsconfig.json`; manually verify the backend's `build-fill` response matches the chosen order and amount. Commit.

## Task 4: Move stockholder and settlement actions into context

**Interfaces:** “Your position” shows actual underlying/Protected/Upside balances. Action availability follows onchain state, not a frontend timer alone: Split before expiry; Combine matching claims before settlement; Redeem individual claims after verified settlement; Settle only when the adapter allows it.

- [ ] Write focused lifecycle tests for wallet disconnected, wrong chain, no underlying, no pair, expired/unsettled, settled and claim ownership. Check that the labels describe stock tokens received and that Split approval is a separate step when needed.
- [ ] Run tests red; transform `RiskSplitActionPanel` into a secondary position workflow with only currently relevant actions prominent. Keep the same `useRiskSplit.actions` calls. Place technical settlement under expandable operations rather than a peer of Buy/Sell.
- [ ] Verify transaction pending/success/error messages and the direct `/app/risk-split/[seriesAddress]` route, then commit.

## Task 5: Responsive, accessible and real-data acceptance

**Files:** Focused FE tests, `RiskSplitMarkets.module.css`, `RiskSplitComponents.module.css`, and minimal copy updates in the redesigned components.

- [ ] Check desktop and phone widths: side choice, scenario and trade ticket fit without horizontal scroll; on phone, Buy/Sell stays discoverable and the book remains reachable. Use keyboard to select each claim, edit the scenario, choose an order and open the limit/position disclosures. Respect reduced motion.
- [ ] Check book loading/empty/error, paused indexer, expired/unsettled/settled series, zero balances, large numbers and long stock names. Never replace failed data with sample prices. Label all HTML-concept values illustrative in the standalone reference only.
- [ ] Run focused FE tests, `npx tsc --noEmit -p fe/tsconfig.json`, frontend lint/build, and Risk Split regression tests. Compare any lint failures against the pre-change baseline; fix introduced failures. Review the live page against the reference in one desktop/mobile pass, then one correction pass if needed.
- [ ] Verify on Base or a Base fork that choosing a real resting order, approving, partially filling, posting a limit order, cancelling, splitting and redeeming reflect onchain/API state. Capture the exact transaction and UI state; do not claim completion from a static screenshot. Commit scoped UI work and record remaining backend gaps.

## Explicit follow-on: multi-level market sweep

The standalone HTML simulates taking several prices for a larger quantity. V1 currently exposes only `fillLimitOrder` for one order; Upside has a separate sweep quote/router. A later reviewed backend task may reuse shared 0x primitives for Risk Split, but it must add an exact quote, atomic batch transaction, slippage cap, race handling, reconciliation and tests before this UI can offer “Buy any amount” across levels. Until then, the immediate ticket trades one selected order and says so plainly.
