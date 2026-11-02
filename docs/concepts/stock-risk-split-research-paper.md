# Two fungible risk claims on one tokenized stock

**A collateral-conserving design and market feasibility analysis**
Othelio research draft · 30 October 2026

[Interactive payoff and shared-market companion](stock-risk-split-design.html)

## Abstract

This paper specifies a way to split one transferable tokenized stock unit into two tradable claims, **Protected** and **Upside**, without external leverage or an unfunded guarantee. A depositor escrows one unit of the stock token and receives one unit of each claim. Every pair in a series has the same underlying, expiry, settlement reference, and payoff function. Depositors who arrive at different times therefore mint fungible claims into the same market. The two claims divide the value of the escrowed asset at expiry; neither can promise more than the escrow can deliver. We give a continuous, nonnegative payoff function, prove exact collateral conservation, derive an option-payoff decomposition, specify physical settlement in token units, and establish the limited no-arbitrage relationship between the two claim prices and the stock-token price. We also distinguish a shared *series* from a single exchange pool: one series is mathematically feasible; liquid trading still requires market makers, workable redemption, and a reliable settlement reference.

The proposal is inspired by 0xBeans's [Isolated Exposure Tokens](https://x.com/0xbeans/status/2115423663231303727), which split a stock token by overnight versus regular-session exposure. Here the split is by **downside priority and upside participation**. The payoff below is a proposed design, not a claim that the cited paper specifies it.

## 1. Question and design constraints

Can people who enter at different stock prices deposit the same tokenized stock and receive identical Protected and Upside tokens in one shared market? **Yes**, if the contract terms are attached to a common series rather than to each depositor's entry price. A user may choose how many of each claim to hold and may pay a different market price for them. A holder-specific floor or strike would give otherwise identical tokens different redemption rights and is incompatible with fungibility.

The design targets four properties:

1. **Full collateralization:** one minted pair has one stock-token unit in escrow.
2. **Value conservation:** the dollar values of its two terminal claims sum to the terminal dollar value of that unit in every state.
3. **Fungibility within a series:** redemption depends on the series and token balance, never mint date, owner, or acquisition price.
4. **Continuous choice of exposure:** a user can buy any mix of the two fixed claims, while the contractual payoff of each claim stays fixed.

These properties do **not** imply a guaranteed dollar floor, an intrinsically fair 50/50 issue price, or deep liquidity. Those require additional assets or market participants.

## 2. Definitions and assumptions

Fix a series with underlying token address \(A\), expiry/fixing time \(T\), and a deterministic settlement source. Let \(S\geq0\) be the dollar value at \(T\) of **one raw transferable unit of \(A\)**. “Raw unit” matters for a B20 token: its multiplier can change after a corporate action, and one token need not represent one constant number of company shares. The reference must report the value of that raw unit on a consistent total-return basis. Base's [B20 description](https://www.base.org/blog/b20-tokenized-stocks-on-base) says the associated Chainlink total-return feed already incorporates the multiplier; applying it again would double count the adjustment.

Let \(F\) be the Protected target floor and \(C\) its upside cap, in dollars **per deposited raw token unit**. Assume \(0\leq F\leq C\). These are immutable series terms. Let \(P(S)\) and \(U(S)\) denote the terminal **dollar values** of one Protected and one Upside claim. They are not dollar cash obligations if settlement is in \(A\).

For the analysis below we assume: (i) deposited \(A\) transfers into escrow successfully; (ii) there are no transfer taxes or unexplained changes in raw escrow balance; (iii) the settlement price is defined and positive for physical settlement, with a separate zero-price rule; (iv) claims are transferable only where eligibility rules permit; and (v) fees and rounding are zero until explicitly reintroduced. Section 8 identifies where these assumptions can fail in a real deployment.

## 3. Proposed terminal payoff

We choose a capped, priority-weighted 50/50 split around the middle of the price range:

\[
\boxed{P(S)=\min\{S,\max[F,\min(S/2,C)]\}},\qquad
\boxed{U(S)=S-P(S)}. \tag{1}
\]

The equivalent piecewise payoff for \(F\leq C\) is

\[
P(S)=
\begin{cases}
S, & 0\leq S<F,\\
F, & F\leq S<2F,\\
S/2, & 2F\leq S<2C,\\
C, & S\geq2C,
\end{cases}
\qquad
U(S)=
\begin{cases}
0, & 0\leq S<F,\\
S-F, & F\leq S<2F,\\
S/2, & 2F\leq S<2C,\\
S-C, & S\geq2C.
\end{cases} \tag{2}
\]

At equality boundaries the formulas agree. If \(F=C\), the middle interval has zero width. The choice of a middle 50/50 slope is a **product parameter**, not a mathematical necessity; one could generalize it to a fixed \(\alpha\in[0,1]\), but any change in \(\alpha\) creates a different series.

**Proposition 1 — collateral conservation and limited liability.** For every \(S\geq0\), \(0\leq P(S)\leq S\), \(0\leq U(S)\leq S\), and \(P(S)+U(S)=S\).

*Proof.* Let \(z=\max[F,\min(S/2,C)]\). Since \(F,C,S/2\geq0\), \(z\geq0\). Thus \(P(S)=\min(S,z)\in[0,S]\). Defining \(U(S)=S-P(S)\) gives \(U(S)\in[0,S]\) and the sum identity. ∎

**Proposition 2 — the floor is conditional.** If \(S<F\), then \(P(S)=S<F\) and \(U(S)=0\). Therefore one escrowed stock token cannot support an unconditional \(F\)-dollar Protected payment in all states. A hard floor needs extra collateral, insurance, or an external guarantor whose solvency becomes part of the product.

For \(F=45\) and \(C=55\), the payoff in dollars per pair is:

| Terminal stock-token value \(S\) | Protected \(P(S)\) | Upside \(U(S)\) | Sum |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 |
| 40 | 40 | 0 | 40 |
| 70 | 45 | 25 | 70 |
| 100 | 50 | 50 | 100 |
| 130 | 55 | 75 | 130 |

The names describe **relative risk allocation**, not absolute safety. Protected still loses all value if the underlying becomes worthless. Upside is economically a residual, and its market value may be positive even when its payoff at today's spot would be zero, because future states can differ.

### 3.1 Relation to option payoffs

Writing \(x^+=\max(x,0)\), equation (1) is equivalently

\[
P(S)=S-(S-F)^++\tfrac12(S-2F)^+-\tfrac12(S-2C)^+, \tag{3}
\]
\[
U(S)=(S-F)^+-\tfrac12(S-2F)^++\tfrac12(S-2C)^+. \tag{4}
\]

This follows by comparing slopes at the three kink points \(F,2F,2C\): Protected has slopes \(1,0,1/2,0\); Upside has slopes \(0,1,1/2,1\). The decomposition is a **terminal-payoff identity**. It does not assert that liquid options on the token exist or that the contract can be perfectly hedged. If options with the necessary strikes and maturity were tradable, their prices would give a replication-based valuation under the relevant settlement and carry assumptions. The [Options Industry Council](https://prd-web.optionseducation.org/advancedconcepts/put-call-parity) explains the corresponding no-arbitrage logic for listed options.

## 4. Minting, redemption, and settlement

Let \(Q\) be raw units of \(A\) in the series escrow, and let \(N_P,N_U\) be outstanding claim supplies. In the no-fee idealization, a deposit of \(d\) raw units executes

\[
(Q,N_P,N_U)\longrightarrow(Q+d,N_P+d,N_U+d). \tag{5}
\]

Before expiry, anyone holding \(d\) of **both** claims may burn them and withdraw \(d\) raw units of \(A\):

\[
(Q,N_P,N_U)\longrightarrow(Q-d,N_P-d,N_U-d). \tag{6}
\]

With no operational losses and no unsettled rounding dust, the invariant is \(Q=N_P=N_U\). More generally, a conservative implementation requires \(Q\geq\max(N_P,N_U)\) and a precise accounting rule for any surplus. Claim balances must not be interpreted as company-share counts; the B20 raw-token multiplier is accounted for in the price of \(A\), not by minting extra claim units.

At expiry, freeze further minting and matched-pair redemption, obtain the final \(S\), and set per-claim raw-token entitlements, for \(S>0\), to

\[
e_P=P(S)/S,\qquad e_U=U(S)/S=1-e_P. \tag{7}
\]

Burning one Protected claim delivers \(e_P\) raw units of \(A\); burning one Upside claim delivers \(e_U\) raw units. Thus any pair delivers exactly one raw unit, and if each claim supply is \(Q\), aggregate entitlements total \(Q\). At \(S=0\), both economic payoffs are zero; the contract still needs a deterministic token-allocation rule, for example \(e_P=1,e_U=0\), because division by zero is undefined. That rule assigns a worthless token and creates no dollar guarantee.

The dollar amounts \(P(S)\) and \(U(S)\) are valued at the **specified fixing** \(S\). If the token's executable market price at redemption differs from that fixing, the dollars obtainable by immediately selling the delivered token fractions will differ too. Their token quantities still sum to one raw unit per pair. Fixing quality and timing therefore matter even though escrow conservation survives a price discrepancy.

Integer token decimals create dust. A contract should compute each entitlement with specified rounding direction, reserve at least the maximum possible aggregate payout, and allocate residual dust by a published rule after claims expire. It must also define the remedy for a permanently unavailable fixing, paused token transfers, or a missing oracle value. These are settlement terms, not UI details.

### 4.1 Why later deposits remain fungible

Suppose ten raw units have been deposited. Escrow and supplies are \((Q,N_P,N_U)=(10,10,10)\). When a later user deposits one more unit at any market price, they become \((11,11,11)\). At settlement each Protected unit receives the same \(e_P\), each Upside unit the same \(e_U\). No prior holder is diluted: the later mint adds one unit of backing and one unit of each liability. The second user can sell either claim at the then-current quote, which need not resemble the earlier user's acquisition price.

**Impossibility of personalized terms in one fungible claim.** If holder A's Protected claim pays \(f_A(S)\) and holder B's otherwise identical Protected claim pays \(f_B(S)\), with \(f_A(S)\neq f_B(S)\) for some possible \(S\), transferring a unit from A to B changes either the economic right or the payee-specific accounting. Such units are not mutually substitutable. A personal floor therefore requires separate series, individualized positions, or an external wrapper. It cannot be encoded as one universal ERC-20 claim. A user *can* vary exposure continuously by holding \(x\) Protected and \(y\) Upside: terminal value is \(xP(S)+yU(S)\). The neutral position is \(x=y\), which reproduces \(xS\); no third token is necessary.

## 5. Prices: what arbitrage fixes and what it does not

Let \(a_t\) be the executable price of one raw unit of \(A\) at time \(t<T\), and let \(p_t,u_t\) be executable prices of the two claims. If every eligible trader can atomically deposit and redeem pairs without fees, delays, or trading restrictions, then

\[
\boxed{p_t+u_t=a_t}. \tag{8}
\]

If the sum exceeds \(a_t\), a trader buys \(A\), mints a pair, and sells both claims. If the sum is below \(a_t\), a trader buys both claims, redeems them, and sells \(A\). In reality the relation is a **band** determined by bid-ask spreads, gas, mint/redeem fees, execution risk, transfer eligibility, and the availability of \(A\). If restrictions prevent the round trip, even the band may be wide or unenforceable. This is a creation/redemption parity argument analogous in spirit to, but distinct from, listed-option put-call parity.

Equation (8) supplies **one equation for two unknown prices**. It does not imply \(p_t=u_t=a_t/2\), even if today's spot would split 50/50 at immediate expiry. The price of each claim depends on the distribution of future \(S\), time to maturity, stock carry and corporate actions, rates in the chosen numeraire, liquidity, and risk premia. Under a complete frictionless market with a valid pricing measure \(\mathbb Q\), cash-equivalent model values could be written

\[
v_P(t)=\mathbb E_t^{\mathbb Q}[D(t,T)P(S_T)],\quad
v_U(t)=\mathbb E_t^{\mathbb Q}[D(t,T)U(S_T)], \tag{9}
\]

where \(D\) is the appropriate discount factor. Because \(P+U=S_T\), the model sum equals the model value of the stock-token delivery claim. Equating that value to the **spot** token price additionally requires the correct carry, distribution and redemption assumptions. In an incomplete token market, \(\mathbb Q\) need not be unique; equation (9) is a scenario-dependent indication, not a canonical oracle price. A practical venue should show a model range and actual bids/asks separately. It should never use an arbitrary 50/50 division as an executable valuation.

Additional bounds follow from the payoff: \(0\leq P(S)\leq C\) and \(0\leq U(S)\leq S\). Under a standard nonnegative-rate, arbitrage-free **cash** valuation with no settlement or counterparty basis, \(0\leq v_P(t)\leq \mathrm{PV}_t(C)\leq C\). The physically settled token market may not realize that ideal bound exactly when its fixing, execution price, access rules, or funding differ. For a simple illustrative quote with \(a_t=120,F=45,C=55\), \(p_t=52,u_t=68\) satisfies pair parity and the cash cap bound. It is **not** implied by those constraints; many other splits are possible.

### 5.1 One shared liquidity market

For a fixed series, all Protected units can trade in one market and all Upside units in one market. One possible minimal venue is a **Protected/Upside exchange pool** plus the underlying \(A\) market and the pair creation/redemption path. The pool discovers the *relative* price; the underlying market and pair arbitrage constrain the *sum*. Another implementation could use two claim/stablecoin books with cross-market routing. Neither architecture guarantees tight spreads. Market makers must inventory both legs and hedge or price the nonlinear exposure. A single constant-product pool alone does not encode equation (8), and AMM inventory risk can be severe near expiry or after a stock-price gap.

The number of series is a liquidity decision. Different \(F,C,T\), reference assets, or settlement rules require distinct token addresses. Launching many series fragments order flow. For a pilot, use one underlying and one active short-dated series at a time; whether weekly expiry is worthwhile is an empirical question, not a theorem.

## 6. After-hours and weekend trading

The claims and escrowed token can potentially transfer whenever the chain and issuer policies permit. That does **not** create an official stock-exchange fixing outside the exchange session. Base states that Coinbase tokenized stocks can trade around the clock, while also noting that authorized-participant mint/redemption and price-feed behavior may differ outside U.S. market hours ([Base B20](https://www.base.org/blog/b20-tokenized-stocks-on-base)).

The safe distinction is:

- **Trading anchor:** an executable market price for the actual transferable token \(A\), with visible depth and timestamp. A stale stock feed is not an executable after-hours anchor.
- **Settlement reference:** a precommitted, verifiable observation at a specified regular-session fixing time, with explicit fallback rules. If expiry is on a weekend, settle at the next defined fixing rather than pretending a weekend exchange print exists.
- **Market controls:** quote-size limits, wider risk spreads, and pause criteria for stale references or issuer restrictions. These are venue choices, not mathematical substitutes for collateral.

Pair parity may still connect the claim markets to an executable \(A\) market on Saturday, but it can weaken if the underlying market is thin, issuer transfers are paused, or market makers cannot hedge until the regular session. The design therefore enables 24/7 *claim trading* only to the extent that the underlying token and venue actually permit it; it does not eliminate gap risk.

## 7. Comparison with alternatives

| Structure | Can one series serve different entry times? | Hard dollar floor from one stock token? | Main cost |
| --- | --- | --- | --- |
| Fixed Protected + Upside claims in this paper | Yes | No | Pricing and liquidity for two nonlinear claims |
| Personalized strike/floor per depositor | No, not with fungible claims | No | Separate series or individualized positions |
| Stock token plus purchased put | Yes, if options market exists | Potentially, subject to counterparty/clearing | Put premium and option market access |
| Stock token plus cash reserve | Yes, with additional collateral | Potentially | Extra funding and reserve management |
| Stock token plus short perpetual | Depends on venue | No | Funding, liquidation and basis risk |

The design is a partition of **one long asset**, not a new short position against the issuer. Upside is a residual long claim, not a short stock token or perpetual. A trader who wants net short exposure still needs a borrowing, derivative, or other short mechanism.

## 8. Implementation conditions and failure modes

The mathematics proves a payoff partition **given** custody of the raw token and a valid settlement price. It does not prove that a specific token is contract-compatible or legally distributable. Before implementation, the following must be established for the exact underlying address:

1. **Eligible custody and transfers.** Can the vault receive, hold, and send the token for all intended participants, and can the derived claims be restricted consistently? B20 policies can block transfers, and issuers can pause or seize tokens ([Base B20](https://www.base.org/blog/b20-tokenized-stocks-on-base)).
2. **Corporate-action consistency.** Read the raw-unit total-return value and multiplier conventions. Fix a formula version; never count the multiplier in both \(S\) and the claim supply.
3. **Settlement source.** Specify feed address, decimals, round completeness, acceptable timestamp, market calendar, finality delay, and deterministic fallback. A stale or manipulable fixing moves value between claims even though their sum remains backed.
4. **Escrow solvency.** Reconcile actual raw token balance with outstanding supplies. Define handling for seizure, protocol loss, token migration, and unexpected balance changes; a balance loss can break the one-pair/one-token invariant.
5. **Rounding and lifecycle.** Bound rounding error, halt minting at the fixing, resolve expiry disputes, and define claim redemption deadlines and unclaimed assets.
6. **Market access and disclosure.** Validate jurisdictional eligibility and the legal characterization of the two derivative claims. The issuer's underlying-token permissions do not automatically confer permission to distribute the new claims.

These are *necessary deployment conditions*. They cannot be resolved by changing the payoff equation alone.

## 9. Conclusion

A universal Protected token and a universal Upside token are mathematically possible **within each fixed series**. Equations (1)–(7) define a fully collateralized, fungible claim pair whose terminal values always sum to the escrowed stock-token value. A later depositor adds backing and identical claims, so entry time and entry price do not create a private market. Users choose a variable risk mix by trading quantities of the two claims; variable contractual floors require new series. Pair creation and redemption constrain the **sum** of market prices, but the split between them needs risk pricing and real liquidity. The proposed floor is a target with priority over Upside, not a guaranteed dollar payment below the escrow's value.

The most decisive pilot test is whether a verified B20 underlying supports vault custody, a robust total-return fixing, and two-sided quoting with acceptable spreads through regular and closed market hours. A mathematical proof of collateral conservation is necessary, but those market and operational facts determine whether the product is viable.

### Product sequencing decision

**First version: fixed-expiry series.** Matched pairs may redeem into the stock token before expiry; after the fixing, each claim may redeem independently for its specified fraction. This gives the Protected and Upside payoffs an enforceable terminal meaning and a price-convergence event.

**Later research: no-expiry series.** Matched-pair minting and redemption would still constrain the sum of claim prices without a funding rate. They would not, by themselves, give a single-claim holder an independent right to realize equation (1) at a chosen time. A perpetual version therefore needs a separately specified exercise, crystallization, or funding/rebalancing rule before it can inherit the Protected/Upside payoff language. It is outside this paper's proposed pilot.

## References

1. 0xBeans, “[Isolated Exposure Tokens](https://x.com/0xbeans/status/2115423663231303727),” original proposal, 28 October 2026. The time-window split motivates the compositional approach; this paper's directional payoff is an independent proposal.
2. Base Engineering Team, “[B20: The Standard Behind Tokenized Stocks on Base](https://www.base.org/blog/b20-tokenized-stocks-on-base),” 27 August 2026. Source for multiplier, total-return feed, compliance controls, and market-hours caveats.
3. Pendle, “[Yield Tokenization Basics](https://docs.pendle.finance/pendle-academy/pendle-101/chapter-2-yield-tokenization-basics).” Example of paired claim minting and redemption, used as an architectural analogy rather than a valuation model.
4. Options Industry Council, “[Put/Call Parity](https://prd-web.optionseducation.org/advancedconcepts/put-call-parity).” Background on no-arbitrage relationships and option-payoff replication.

**Status:** Research proposal. The payoff formula is specified and mathematically testable; market, token compatibility, oracle, and legal questions remain empirical or implementation-specific.
