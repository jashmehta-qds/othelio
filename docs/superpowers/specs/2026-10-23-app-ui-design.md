# Othelio application overhaul

Approved in conversation: all application routes and shared interactions, excluding the marketing landing page. Crypto users should immediately understand their holdings, their next action, and what they authorize.

## Direction
The supplied reference pins deep plum surfaces, white typography, purple illuminated edges, and mint status accents. Use that language for a practical operating interface: compact navigation, open data rows, focused transaction sheets, precise inputs, and progressive disclosure. Avoid repetitive decorative cards and competing calls to action.

## Journeys
- Portfolio → inspect holdings → manage or fund a basket.
- Create basket → choose assets and allocations → review → wallet signature → confirmation.
- Deposit, withdraw, rebalance: preserve existing quote and authorization semantics, explain each state, retain inputs after recoverable failures.
- Agents: connect client, configure explicit permissions and limits, review proposals. No invented autonomous execution.
- Settings: trading, borrowing, and account sections with clear persistence feedback.

## Shared system
Button hierarchy, fields, dialog/sheet focus and dismissal, empty/error/loading states, mobile navigation, reduced motion, and responsive layouts are shared. Numeric values remain readable; unavailable values must not look like zero. Wallet prompts and blockchain confirmation are distinct. No financial side effects during verification.

## Approaches
Chosen: shared system first, then migrate every live application surface. A cosmetic stylesheet alone would leave the workflows inconsistent. Rebuilding transaction logic would add unnecessary risk; existing API and contract semantics remain authoritative.

## Direction contract
THESIS: A focused portfolio workspace with one clear next action per task.
OWN-WORLD: Ink-plum ground, layered aubergine surfaces, white text, violet selection and mint confirmation, rounded rectangular controls.
STORY: Inspect holdings, choose an operation, review its consequence, authorize, track confirmation.
FIRST VIEWPORT: Narrow navigation rail beside a spacious portfolio workspace; a clear header action, readable value/history, then holdings and contextual detail.
FORM: User-pinned reference overrides seed e7998063; code-led implementation tests live interactions rather than a static comp.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
