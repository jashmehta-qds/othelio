# Risk Split market interface

**Design for review · 31 October 2026**

## Intent

Make `/app/risk-split` a market discovery and trading entry point for any supported stock token, rather than an MSFTc payoff dashboard. A user should immediately see which Risk Split series are actually open, their terms and expiry, and whether there are executable Protected and Upside quotes. Selecting a series opens a dedicated market page for minting a pair and, once an order-book venue exists, buying or selling either claim.

This is a standalone stock-token product. No basket workflow is involved.

## Agreed decisions

- List **only real deployed, open series** as markets. Placeholder addresses and mock series never appear as live markets. If none exist, show an explicit empty state.
- Profile tabs use the existing contract's absolute Protected `floorPrice` and `capPrice`, interpreted as percentages of a **verified creation-time feed price recorded in immutable series metadata**. Example: a $100 creation reference, floor $85 and cap $125 map to `−15% / +25%`. The cap is Protected's cap; it is not a separate Upside floor. Older series without verified metadata appear under `Other`.
- Support eligible underlying ERC-20s with **any decimal count**, including 6, 8 and 18. The claim token must use the underlying's decimals so one displayed Protected and one displayed Upside correspond to one displayed underlying token.
- Use a **dedicated route** for each series, linked from the market list.
- Build the market interface first. Order entry and matching remain disabled until a real order-book data and settlement integration exists. The UI must not fabricate bids, asks, depth, fills, or arbitrage.

## Approaches considered

1. **List plus dedicated market page — selected.** A scannable market table handles discovery; one series page has room for books, order entry, minting, balances and payoff terms. The URL is shareable and a trading task does not compete with other rows.
2. Expand a market row into a detail panel. This keeps one route but compresses the book and order ticket into a table and performs poorly on phones.
3. Keep the current single-series dashboard and add a token selector. This is smaller to implement but hides the range of open markets and keeps the payoff explainer ahead of trading.

## Market list: `/app/risk-split`

The page opens with a compact header, profile tabs, search, and a market table. Market discovery is public and does not require a wallet. Wallet balances are shown only on the selected series page, where they inform minting and claim management.

Profile tabs: `All`, `−15% / +25%`, `−50% / +50%`, `−25% / +10%`, and `Other` if deployed terms do not match a named profile. Counts are based on actual open series. Do not classify a series using the *current* stock price; that would silently change its profile as the market moves. A series missing its verified creation reference appears in `Other` until its metadata is verified. The reference record includes feed address, round ID, observed timestamp, block, normalized USD price and provenance; classification validates that the onchain floor/cap match the selected percentage pair at that reference within an explicit integer rounding tolerance.

Each market row displays stock logo, symbol and name; the exact floor/cap profile; expiry date and timezone; stock reference price with source/freshness label; best Protected bid/ask; best Upside bid/ask; and an arbitrage indicator. The row navigates to `/app/risk-split/[seriesAddress]`. Search works by symbol/name.

Market quote cells have three explicit states: executable quote, loading, or `—` with `Book unavailable`. No implied zero prices. Stock catalog oracle values are **reference prices**, not executable buy/sell quotes. The arbitrage cell is `—` until both claim books and an executable stock route are available. Once available, compute both directions using *executable sizes and fees*: `stock bid − (Protected ask + Upside ask)` for buying/recombining claims, and `(Protected bid + Upside bid) − stock ask` for buying/splitting stock. Show only positive net opportunities after gas, venue fees, and slippage at a stated size. Never label a difference against a non-executable oracle mark as arbitrage.

Empty and error states distinguish no deployed markets, no markets in the selected profile, delayed market data, and network failure. The market table must remain legible on mobile: identity/profile/expiry lead, and claim quotes move into a compact second line or stacked card without horizontal clipping.

## Series detail: `/app/risk-split/[seriesAddress]`

Top of page: breadcrumb to all markets, stock and series identity, profile, expiry/status, stock reference with timestamp, and wallet balances for underlying, Protected and Upside. The primary working area has two claim books (`Protected/USDC`, `Upside/USDC`) with best bid/ask, depth and recent trades, paired with a buy/sell limit-order ticket. Until an order-book venue is connected, show a clear `Order book not connected` state and disabled buy/sell submission; do not show invented levels or a misleading signable order.

Keep the existing functional `Split stock` action as `Mint pair` on this page, bound to the **selected** series. Show the underlying token, wallet balance, amount, allowance/approval, and receipt of equal Protected and Upside units. Keep `Combine pair` and post-expiry single-claim redemption in a secondary `Manage claims` area. The settlement trigger belongs in a low-priority technical section, not the main trading ticket. Disable mint at or after expiry and show chain and contract address before wallet actions. Read decimals from the selected underlying and matching claims; use that count for balances, amounts, approvals and redemptions.

Place the payoff chart in a lower `Payoff & terms` section on the series page, reachable from a compact `Understand payoff` link beside the order ticket. Preserve the exact payoff formula, current series floor/cap, simulation slider, and clear distinction between expiry payout and current trade price. The chart must work for arbitrary floor/cap values and a scale derived from the chosen stock, rather than MSFTc-specific constants.

## Data and trust boundary

Use the existing asset catalog for stock identity, decimals and reference price, and connected-wallet ERC-20 reads for balances. Use the Risk Split series registry/API only for real series discovered from deployed factory events or verified registrations. Remove the current sample-address fallback from production market discovery; do not turn API failure into a fake active market. Define `creationReferencePriceUsdE8` and `profileKey` as immutable series metadata, with the feed round/source/block described above, before putting a series into a named profile tab. The existing contracts store absolute floor/cap and expiry, so this metadata needs a trustworthy creation path and is not inferred from spot prices. Treat any metadata whose source cannot be verified as absent.

The current `ClaimToken` inherits a fixed 18 decimals from OpenZeppelin. Extend construction to mirror the underlying ERC-20 decimals, and have the factory verify and pass them when it creates both claims. Keep mint/burn in the same raw units as the underlying, then prove one whole underlying token mints one whole unit of each claim for 6, 8 and 18 decimal examples. Reject tokens whose decimal metadata is unavailable or whose transfer behavior violates the vault's exact-balance assumption. Existing deployed claims, if any, do not change decimals; only new series use the corrected construction.

The current repository has no Risk Split order-book service, order endpoint, or onchain matching integration. Book data and order actions must therefore be represented as unavailable in this phase. A later trading phase adds a typed market-data contract, book subscription/indexing, signed orders, cancellations, fills and settlement receipts; it must not alter the vault's payout rights.

## Boundaries and acceptance

This design changes the Risk Split discovery and detail UI, its series and asset data wiring, the API changes needed to exclude placeholders and expose verified profile metadata, and claim-token decimal construction with targeted tests. It does not choose or integrate Clober or another exchange, create markets, fabricate order-book prices, deploy contracts, or change the payoff formula.

Acceptance: the list contains no hard-coded MSFTc identity; only actual open series appear; the three named profile tabs filter on verified creation terms; quote and arbitrage cells never imply live execution without executable data; selecting a row opens its series page; mint/combine/redeem target that series with correct token decimals; 6/8/18 decimal contract tests pass; the payoff remains available below the trading area; the layout works on desktop and mobile; empty/loading/error states are clear.
