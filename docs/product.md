# Personal tokenized stock baskets — product plan

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16, React 19, TypeScript, and Tailwind CSS. The frontend lives in `fe/` and is currently an uncustomized application scaffold.

## Users

The first real launch user is a crypto user who already understands wallets and onchain assets and wants to create and manage personalized tokenized-stock exposure. Developers and user-controlled agents are a second audience: they need constrained, inspectable investment operations without receiving unrestricted wallet access.

The initial launch jurisdiction and its corresponding eligibility policy remain open decisions.

## Product Purpose

Othelio lets a user build a personally managed basket of tokenized stocks, hold the basket as one transferable token, and operate it through the same product interface or MCP-enabled agent workflows. Success means users can fund, understand, rebalance, transfer, and redeem baskets confidently, then return to use those workflows at transparent costs.

## Positioning

Othelio combines a portable onchain claim on a user-selected stock basket with enforceable, operation-level permissions for agentic investment workflows. It executes user intent; it does not recommend portfolios or act as an autonomous investment strategist.

## Operating Context

The core experience is a compact finance application closer to a trading terminal than a multi-page consumer website. Users move through a small number of coherent surfaces to create and fund baskets, monitor holdings and NAV, preview and authorize rebalances, redeem or transfer shares, and manage agent permissions. MCP servers expose the same domain operations for wallet interfaces and user-controlled agents.

## Brand Commitments

The confirmed customer-facing name is **Othelio**. The product should feel modern, sleek, and easy to use, with fewer pages and a focused trading-terminal character. Dense financial information must remain legible and operational rather than decorative. No other binding brand assets or voice rules have been established.

## Evidence on Hand

- `docs/product.md` contains the current working product specification and reviewed documentation references.
- `fe/` proves the selected frontend stack but does not yet provide an incumbent product interface or validated visual system.
- No deployments, liquidity integrations, customer testimonials, usage benchmarks, or production partnerships have been independently verified; future work must not fabricate them.

## Product Principles

- Keep users in control: preparation is side-effect-free, economic actions are explicit, and delegated authority is narrow and revocable.
- Make financial state inspectable: distinguish targets from fills, deposits from returns, reference value from executable value, and friendly names from contract identity.
- Prefer one coherent operating environment over a maze of pages; surface complexity progressively around the task at hand.
- Preserve exit and recovery paths: core redemption and permission revocation must not depend on the frontend, ENS, research tools, or optional automation.
- Treat integrations as dependencies to verify, not credibility to imply.

Updated September 2, 2026. Selected direction: Coinbase Tokenized Stocks using B20 on Base, with Base Sepolia for prototyping. Working specification; documentation has been reviewed, but deployments, liquidity, and integrations have not been independently tested or built.

## 1. Product definition

An app and developer API for creating and operating personally managed portfolios of Coinbase Tokenized Stocks on Base. Each basket has its own vault, fungible ownership token, holdings history, and calculated net asset value (NAV). Users choose assets and allocations through the UI or their own agents. The product executes instructions; it does not recommend portfolios or supply investment strategies.

The constituents use B20, Base's ERC-20-compatible native token standard. Our basket shares will initially use a conventional ERC-20 implementation. Holding B20 constituents does not require issuing B20 basket shares. The basket app is independently built; this plan does not imply Coinbase endorsement or partnership.

**Promise:** Build your own stock basket, hold it as one token, and manage it through the app or your agent.

The same functionality is available through both interfaces. Using an agent is optional. ENS adds readable portfolio names. CRE can execute user-defined automation involving protected inputs. Borrowing is a later integration with independently funded lending markets.

“Personal” means each basket starts with a single creator and designated controller. Because shares are transferable, it can subsequently have multiple holders. Those holders share the same assets and management policy; transferring shares does not create a new independent portfolio. “Basket” is the preferred product term: a manually selected portfolio is not necessarily a rules-based index or an ETF.

## 2. Customer and problem hypotheses

Initial audience: eligible investors who already hold stablecoins and want to manage customized equity exposure from their wallets. A second audience is developers building agents or wallet interfaces that need portfolio execution and accounting.

Problems to validate:

- Buying, tracking, and rebalancing multiple tokenized equities requires repetitive transactions and fragmented accounting.
- Users want a portable claim representing the whole portfolio.
- Agent developers need a predictable portfolio API with enforceable permissions rather than unrestricted wallet keys.

The token's utility must be demonstrated through ownership, transfer, redemption, and integrations. Simply displaying a collection as one token is not sufficient differentiation. ENS and MCP improve access; they do not establish customer demand by themselves.

## 3. Initial product scope

| Included in the first complete prototype | Subsequent releases |
| --- | --- |
| Base Sepolia prototype with 5–10 self-created B20 test assets and test USDC; Base mainnet target | More assets and chains after liquidity and integration checks |
| Personal vault creation and its basket token | Public discovery and third-party subscriptions, if justified |
| User-specified allocations; USDC funding | Recurring deposits and scheduled execution |
| Holdings, NAV, fees, transaction and performance history | More advanced portfolio analytics |
| Rebalance preview and user-approved execution | Revocable delegated execution with budgets |
| Proportional redemption into underlying assets | Additional exit routes and execution methods |
| USDC redemption when quotes and liquidity are available | Borrowing against approved basket types |
| Basket-share transfers and clear controller identity | Explicit whole-portfolio control transfer flow |
| UI and API/MCP parity | Additional wallet and agent integrations |
| ENSv2 naming on Ethereum Sepolia pointing to Base Sepolia baskets | Production ENS deployment appropriate to launch status |

The first live release excludes leverage inside the basket, arbitrary external protocols, platform-generated recommendations, public strategy rankings, and performance-fee arrangements. These are scope decisions, not claims about legal exemptions.

The live asset shortlist includes AAPLc, NVDAc, MSFTc, and other officially documented Coinbase stock tokens, subject to verification and executable liquidity. Testnet constituents must be visibly labeled as simulated, unbacked assets; they are not Coinbase-issued stocks. No official stock-token testnet faucet has been verified.

## 4. Core user journeys

### Create and fund

1. Connect a wallet; establish eligibility for the actual launch jurisdiction and venue.
2. Enter a basket name and optional description.
3. Select supported Coinbase stock tokens and weights that total 100%, including any USDC reserve.
4. Enter a USDC budget and review estimated fills, costs, residual cash, and actual expected weights.
5. Approve and submit creation/funding. A deployed but unfunded basket must appear as unfunded, not invested.
6. Receive basket shares backed by the acquired assets. Display the vault and share-token addresses, controller, and current NAV.
7. Optionally register an ENS subname. A naming failure must not invalidate or strand an already funded basket.

### Monitor

The basket page shows total assets, the user's share of them, shares outstanding, NAV per share, current and target weights, controller and delegated permissions, cost basis, performance, and activity. Price timestamps and unavailable valuations are visible.

Separate deposits and withdrawals from investment return. A $500 deposit is not a $500 profit. Token transfers require appropriate cost-basis treatment; unavailable basis must not be invented. Calculate time-weighted basket performance separately from the investor's cash-flow-dependent return.

News is optional context. Users can read ticker-linked source material in the UI or use external news/LLM tools through their agents. Display sourced news as information; the platform does not transform headlines into recommended trades.

### Rebalance

1. The controller edits weights in the UI or submits them through an authorized agent.
2. The planner reads current holdings and computes net buys and sells.
3. The execution service obtains quotes and returns a preview with expected balances, fees, minimum outputs, and expiration.
4. The user authorizes the specific plan, or an existing scoped authorization permits it.
5. The vault validates the request and executes trades through restricted adapters.
6. Update actual balances, NAV, and transaction history. Target weights remain intentions; achieved weights reflect fills and costs.

For small baskets, use atomic execution where supported: all trades succeed within limits or the transaction reverts. Do not promise atomicity across chains or independent transactions. If larger baskets later need multiple transactions, introduce an explicit rebalance state machine and protect deposits/redemptions against intermediate accounting states.

Example before costs: a $1,000 basket with $600 NVDAc, $300 AAPLc, and $100 MSFTc changes to 40/40/20 by selling $200 NVDAc and buying $100 each of AAPLc and MSFTc. No basket shares are minted or burned by the rebalance itself.

### Redeem

The holder burns shares and receives the corresponding fraction of all tracked assets, including cash. The basic path does not require a market for the basket token, a live research API, or CRE. It still depends on the chain and underlying assets permitting transfers.

A convenience route sells that entitlement into USDC with an explicit minimum output. A failed USDC quote or unavailable liquidity should leave the user able to choose in-kind redemption; never silently change their selected output.

Distinguish basket redemption from issuer redemption. Our redemption returns existing constituent tokens or their sale proceeds; it does not redeem Coinbase tokens for the underlying equities. If a constituent's policy blocks a transfer, an atomic redemption can fail. Do not burn shares and silently omit that asset. Any later partial-exit mechanism must preserve the holder's remaining claim and receive separate review.

### Transfer

Transfer a specified number of basket shares to an eligible destination under the launch policy. The receiver obtains the proportional economic claim and redemption rights. The existing controller continues managing the common portfolio. Clearly disclose that fact before the transfer.

Transferring all shares does not automatically transfer management authority or the ENS name. A later explicit handover flow can coordinate those operations and revoke old delegations.

## 5. Basket mechanics and accounting

### Ownership and control

- Each basket has its own vault and ERC-20 share identity; a vault contract may itself implement the share token.
- Only the designated controller can choose allocations or appoint/revoke scoped executors.
- Holders redeem their own shares. The controller cannot seize other holders' assets or arbitrarily mint shares.
- A share transfer grants no automatic management rights.
- Start with creator-authorized funding and no public subscription interface. If additional subscribers are introduced, review product permissions and economics explicitly.
- Restrict controllers and delegates to approved assets and trading routes. They must not gain arbitrary calls, arbitrary approvals, or asset-sweep powers over backing assets.

### Valuation

NAV per share = (value of tracked holdings and cash − accrued liabilities) / shares outstanding.

No debt is permitted in the initial vault. If fees create liabilities or dilution, make their accounting explicit. Treat token market prices, underlying stock reference prices, and executable quotes as distinct observations; stock prices alone cannot guarantee the token's liquidation value.

### B20 integration facts and resulting design

Base documents the following behaviors for Coinbase stock tokens:

- Corporate actions change a multiplier; raw token balances remain constant.
- Its documented Chainlink feeds already include the multiplier. Do not multiply their output again.
- Transfers can be restricted by policies or pauses even when allowance exists.
- Feeds may freeze off-hours or during corporate actions; check freshness and pause state.
- Names and symbols can change; identify constituents by chain and token address.

[Tokenized Stocks on Base](https://docs.base.org/specifications/b20/tokenized-stocks-on-base)

Our accounting should store raw quantities and compute display values separately. After normalizing token and feed decimals, value equals raw token quantity times the adjusted token price. If using a raw equity price instead, apply the current multiplier exactly once. Validate this with a split simulation that preserves economic value and a dividend simulation that changes entitlement without minting basket shares.

Expose last-known reference NAV with a timestamp when feeds are frozen. Price-dependent funding and rebalances must reject unusable pricing under a documented execution policy; do not substitute a cached dashboard value. Proportional in-kind redemption can remain independent of price feeds when all constituent transfers are allowed. A future lending integration must define how it handles periods without a usable liquidation price.

NAV is an estimate of backing value, not a guaranteed sale price. Rebalancing costs reduce backing; issuance, redemption, and rounding must not dilute existing holders unfairly. Initial supply is a denomination choice: do not promise a permanent $1 token or use that value for later issuance.

### Prefer proportional issuance and redemption in the core

Evaluate a core that mints a requested quantity of shares in exchange for a proportional contribution of the vault's current constituents. A USDC router acquires those constituents, issues the shares, and returns unused input. This avoids relying on a stale displayed dollar NAV to allocate ownership. Initial issuance establishes the basket and initial share supply separately.

The router can size an affordable share amount from the user's USDC budget. Subsequent proportional funding preserves the current allocation; restoring target weights is a separately quoted rebalance. Core accounting must use verified balances, safe rounding, and explicit treatment of donations, dust, and supported token behavior.

Do not automatically label this multi-asset interface ERC-4626. ERC-4626 standardizes a single deposit/accounting asset. A USDC-denominated strategy vault can potentially implement it, but multi-asset issuance and in-kind redemption need additional design. Decide after comparing reusable implementations, rather than forcing the label. [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)

## 6. Proposed technical architecture

| Layer | Responsibility |
| --- | --- |
| Factory | Deploy recognized basket instances and emit registration events |
| Vault/share contract | Hold constituents; manage shares, issuance, redemption, and permitted operations |
| Authorization module | Verify controller signatures, scopes, revocation, deadlines, nonces, and chain/vault binding |
| Issuance/redemption router | Convert USDC to or from constituent assets with bounded execution |
| Rebalance adapters | Trade through explicitly supported routes; verify received balances and limits |
| B20 asset and price adapters | Track raw balances, multiplier changes, policy/pause state, and adjusted price feeds |
| Indexer | Build holdings/history views from confirmed events and reconcile against onchain state |
| Execution service | Quote, simulate, prepare, submit where authorized, and reconcile transactions |
| API/MCP + web UI | Expose the same domain operations and permissions |
| ENS integration | Resolve readable names to verified chain/vault identities and metadata |
| Optional CRE integration | Run user-configured automation and protected external API workflows |

Selected networks: Base mainnet (8453) for the intended live product; Base Sepolia (84532) for the prototype; Ethereum Sepolia (11155111) for the separate ENSv2 naming deployment. Names resolve to an explicitly recorded Base chain/vault identity; no asset bridge is required for naming.

Production onboarding should use an allowlisted asset registry verified against official Coinbase/Base sources and live state. B20 creation events are discovery inputs, not proof an asset was issued by Coinbase. Its factory also supports unrelated issuers.

B20 tokens run as native precompiles and may have no EVM bytecode. Generic token checks based solely on code length may reject them. Audit library and adapter assumptions and validate recognized precompiles through appropriate calls rather than removing contract checks indiscriminately. [B20 specification](https://docs.base.org/specifications/b20/specification-overview)

### Base Sepolia development setup

Use Base's B20-compatible Foundry tools (`base-forge`, `base-cast`, and `base-anvil`) and the release-pinned library specified by the current guide. Standard Foundry simulation is not sufficient for native B20 calls. Check activation of the required B20 features on the target network before creating test tokens.

Create clearly labeled B20 test constituents through the documented factory, plus test USDC, controlled price fixtures, and a test swap venue. Simulate scheduled multiplier updates, blocked recipients, pauses, frozen feeds, and failed fills. These fixtures prove our mechanics, not production liquidity or access to Coinbase's issuer services. [B20 launch and testnet guide](https://docs.base.org/specifications/b20/launch-a-b20-token)

Evaluate Reserve and Enzyme components before developing a new vault engine. Their existing basket/vault capabilities are both competition and potential implementation starting points. Reuse requires checking licenses, deployed versions, audits, token behavior, and whether controller permissions fit this product. Existing audits do not cover new adapters or modifications. [Reserve](https://docs.reserve.org/reserve-index), [Enzyme](https://docs.enzyme.finance/onyx-user-documentation/getting-started/primitives)

## 7. UI, API, and MCP contract

Main screens: portfolio list; basket builder; basket detail; rebalance preview; redemption/transfer; agent connections and permissions. ENS names are optional friendly labels; contract identity remains inspectable.

Proposed operations, not existing implementations:

| Read operations | Preparation operations | Authorized mutations |
| --- | --- | --- |
| list_supported_assets | prepare_create | submit_authorized_transaction |
| get_basket / resolve_basket_name | quote_deposit | revoke_agent_permission |
| get_holdings / get_nav | quote_rebalance | configure_permission |
| get_activity / get_permissions | quote_redeem | register_basket_name |
| get_execution_status | prepare_transfer | update_allowed_metadata |

Every quote includes chain ID, vault identity, relevant state/version, costs, deadline, and output limits. For B20 routes, include relevant price timestamps and policy/pause checks; revalidate on execution because state can change. Preparation is side-effect-free. Submission returns an operation ID and later transaction status. Use idempotency keys to prevent retries from issuing duplicate economic actions. Re-quote after meaningful state changes or expiration.

Launch agent writes with explicit user approval. Later delegated access can permit only named operations, assets, routers, turnover limits, recipients, and expiration periods. Wallet signing keys never travel in ordinary MCP arguments. External research output is untrusted input and cannot grant new permissions.

## 8. ENS design

Example, subject to parent-name control and availability: `ai.jash.yourapp.eth`.

Use subname registration and Permissioned Resolver records for chain/vault identity, share-token address, description, and app/metadata URLs. Scope an agent's metadata edits separately from address changes. Keep live NAV and balances in the portfolio data system.

Track name ownership independently of shares and trading authority. Pin execution permissions to chain and vault, even if a name subsequently changes. Validate resolved addresses against recognized deployments. Disclose parent revocation/upgrade/expiry powers. Do not present a name as a deposit address without the correct deposit interaction.

ENSv2 is on Ethereum Sepolia beta, separate from Base Sepolia, and interfaces remain subject to change. Use a client with separate network configurations for name resolution and basket operations. A production release can use the then-supported ENS deployment or defer v2-specific features. Naming outages must not disable portfolio operations. [ENSv2 overview](https://docs.ens.domains/ensv2/overview/), [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/)

## 9. CRE design

Use CRE when a user wants monitoring or scheduled execution beyond their own agent's runtime. Example: evaluate user-specified allocation drift, access a paid quote API, and submit a bounded rebalance request.

Use confidential execution only when credentials, thresholds, or intermediate data need protection from node operators. Confidentiality does not hide public holdings/trades, conceal the current beta's source code, or prove that API data and LLM conclusions are correct. An external API sees data sent to it.

A CRE receiver must authenticate the expected workflow and still enforce the user's onchain permissions, price/execution limits, deadlines, and replay protection. Direct user execution and in-kind redemption remain available without CRE.

Confidential Workflows currently require invite-only private-beta access; local simulation is available. Treat the integration as optional until access, cost, latency, supported chains, and operational limits are verified. [Confidential Workflows](https://docs.chain.link/cre/concepts/confidential-workflows), [Access](https://docs.chain.link/cre/account/confidential-workflows-access)

## 10. Borrowing roadmap

The intended later experience is to pledge basket shares to a lender and borrow USDC. Loan proceeds are outside the unleveraged basket unless a separate strategy explicitly changes that design. Pledged shares are locked as collateral and cannot simultaneously be transferred or redeemed by the borrower.

Prerequisites: lender funding; accepted basket configuration; robust valuation; liquidation mechanism; enforceable limits on collateral-changing rebalances; underlying trading/market-closure handling; and review of the actual offering. For B20 constituents, a liquidation must also account for transfer policies and frozen feeds. A basket wrapper does not remove restrictions on its backing assets.

Do not assume one isolated lending market per bespoke basket will attract liquidity. Investigate a common collateral adapter that values approved constituents, but recognize that it requires lender and protocol support. Pilot with a small number of accepted configurations before arbitrary personal baskets. A controller must not substitute unacceptable assets while shares secure a loan. [Morpho market parameters](https://docs.morpho.org/learn/concepts/blue/)

## 11. Delivery phases and acceptance gates

These are sequencing decisions, not a promised launch timeline. Live deployment depends on integrations and review, not merely coding time.

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 0 — Feasibility | Base asset/venue matrix; customer interviews; jurisdiction/distribution review; B20 activation and reuse checks | Selected assets and routes are viable; prototype environment works; live operating requirements are identified |
| 1 — Complete testnet loop | Base Sepolia vault/share contracts, B20 test constituents, test swaps, UI, indexer, and user-approved MCP | Create → fund → rebalance → transfer a fraction → redeem works; share and multiplier accounting invariants hold |
| 2 — Integration pilot | Verified Coinbase token/price adapters; production quote checks; ENSv2 demo across the two testnets; optional CRE simulation | Handle policy failures, corporate actions, frozen feeds, and stale quotes; name/automation failures do not break core flows |
| 3 — Limited live release | Independent contract review, remediation, operational monitoring, verified venue/access arrangements | All material review findings resolved; bounded rollout; redemption and revocation work without the frontend |
| 4 — Repeat use | Recurring flows, bounded agent delegation, optional confidential CRE, developer integrations | Users return, economics are understood, and external developers operate baskets successfully |
| 5 — Collateral pilot | Lending partner and approved basket types | Funded loans can be valued and liquidated under stress; collateral rules survive rebalances |

Meaningful verification focuses on ownership conservation, fair mint/redeem rounding, donations/initialization, partial transfers, controller restrictions, malicious trade routes, stale-price behavior, replay/retries, failed execution, and corporate-action accounting. Include native-precompile compatibility, multiplier double-counting, policy-blocked redemption, and state changes between quote and execution. Frontend testing covers the complete funding-to-redemption journey rather than cosmetic tests.

## 12. Business and distribution plan

Start with interviews and prototypes for eligible stablecoin holders who already buy tokenized equities; recruit a small closed pilot. In parallel, have a few independent agent developers attempt the create/read/rebalance/redeem API without bespoke assistance.

Potential pricing to test: a clearly disclosed execution fee for convenience flows; paid API access for developers with production usage; or a subscription for automation and advanced accounting. Do not assume users will pay all three. Avoid performance-linked pricing for a product that does not select investments.

Illustrative economics only: 10 basis points on $1 million of executed notional produces $1,000 gross fee revenue before gas subsidies, data, infrastructure, support, and compliance costs. Assets deposited are not revenue, and passive portfolios may generate little recurring turnover. Establish actual willingness to pay before relying on volume projections.

Distribution candidates: eligible Base users, tokenized-equity communities, supported wallets, and agent developers. Shareable basket specifications can let others create independent copies, but publishing specifications must remain opt-in. ENS availability and MCP access are distribution features, not substitutes for partnerships or customer acquisition. Participation in Base builder programs does not itself establish a Coinbase partnership or approval of the financial product.

## 13. Success measures and decision points

Primary evidence: users fund baskets and keep using them at transparent costs. Track funded creators, repeat deposits, 30-day funded retention, repeat portfolio operations, net deposits, redemptions, execution success, all-in costs, and paid conversion. Rebalancing is not required for every successful long-term investor.

Developer evidence: integrations that reach successful operation without manual support, API repeat use, and multiple external clients using the same basket interface.

Reconsider the scope if users only want a watchlist, execution costs erase convenience, users see no use for the ownership token, or external integrations prefer existing protocols. Those results should change the product before expanding into lending.

Confirmed direction: Coinbase B20 stock constituents, Base mainnet target, Base Sepolia prototype, conventional ERC-20 basket shares, complete UI and MCP access, optional ENS naming and CRE automation.

Outstanding decisions: initial user jurisdiction; executable Base venues; supported assets and minimum trade sizes; reusable vault implementation; fee model; transfer eligibility; controller handover behavior; parent ENS ownership; and need/access for production CRE.

## 14. Material launch dependencies

Coinbase describes its stock tokens as claims on underlying equities held in regulated custody. Availability is limited to eligible jurisdictions outside the U.S. Primary creation/redemption is restricted to onboarded institutional partners and Authorized Participants. These issuer flows differ from our basket-share issuance/redemption. [Coinbase Tokenize](https://www.coinbase.com/tokenize)

Base describes secondary holding and trading as permissionless, subject to onchain controls. The proposed product therefore targets acquiring existing tokens through supported secondary liquidity, with no planned AP role. This is not confirmation that our app, transferable basket issuance, or distribution needs no agreement or authorization. Establish applicable requirements for the actual model and jurisdiction. Testnet use and absence of recommendations do not establish production eligibility. [Base integration guide](https://docs.base.org/specifications/b20/tokenized-stocks-on-base)

Verify actual stock-token buy/sell liquidity on Base; underlying stock liquidity and reference feeds do not guarantee executable onchain prices. No official Coinbase stock-token faucet or production liquidity partner has been verified. Keep test-token distribution clearly separate from access to real stock-backed tokens.

The next concrete deliverable is a Base-specific asset/venue feasibility matrix and vault-engine choice, followed by the B20 test-asset setup and complete basket flow on Base Sepolia. Production access and operating-model review can proceed alongside the testnet prototype.
