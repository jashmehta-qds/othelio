# Othelio Design System & Application UI Architecture

## Overview
This document records the visual identity, interaction paradigms, and design tokens established in the app-wide UI overhaul, inspired by the dark plum, violet illuminated-edge interaction reference.

---

## 1. Direction Contract & Visual Language
- **Ground & Atmosphere:** Deep ink-plum base (`#100b16`) paired with layered aubergine surfaces (`#191222`, `#241a30`) and delicate purple border contours (`#3a2d49`, `#75568f`).
- **Typography:** Atkinson Hyperlegible with tabular numeral support (`font-variant-numeric: tabular-nums`). High-contrast crisp white headlines (`#f5f0ff`) with muted lavender secondary text (`#b2a7c2`).
- **Illumination & Accents:** Violet illumination (`#c4a2ff`, `#d9c3ff`) active highlights tracing cards and interactive limits. Mint green (`#70e0ba`) signals successful confirmation and safe execution.
- **Motion & Physics:** Smooth transitions (`cubic-bezier(0.2, 0.8, 0.2, 1)`) with native reduced-motion overrides (`@media (prefers-reduced-motion: reduce)`).

---

## 2. Core UI Primitives

### `fe/src/components/ui/Dialog.tsx`
- Built on top of native `<dialog>` semantics with `showModal()` and automatic body scroll locking.
- Supports both centered modals (`kind="modal"`) and right-anchored sheets (`kind="sheet"`).
- Keyboard dismissable via Escape, click-outside backdrop dismissal, and trapped focus.

### `fe/src/components/ui/State.tsx`
- Standardized empty, loading, and error states.
- Replaces generic placeholders with actionable guidance and recovery triggers.

---

## 3. Workflows & Surfaces

### A. Agents Workspace (`/app/agents`)
- **Setup & Connectivity:** Multi-client integration guides (Claude Desktop, Cursor, OpenAI Swarm) with dedicated API key management.
- **Access & Exposure Controls:** Stepped limits, asset whitelisting, and dynamic glowing purple border on active configuration panels.
- **Proposal Review:** Pending proposals are surfaced immediately with clear human-readable intent, execution ceilings, and one-click signature staging.

### B. Settings Workspace (`/app/settings`)
- **Categorized Sections:** Clean tabbed organization across **Trading**, **Borrowing**, and **Account**.
- **Explicit Save Model:** Dirty-state tracking ensures changes require user confirmation, preventing accidental drift in slippage tolerance or risk tiers.

### C. Baskets & Transactions (`/app/baskets`, `/app/baskets/create`, `BasketDrawer`)
- **Shared Creation Primitives:** `BasketCreationFields` powers both standalone page and modal flows.
- **Allocation Editor:** Interactive sliders paired with numeric input controls, continuous 100% target validation, and stock search.
- **Distinct Lifecycle States:** Clear visual separation between **Wallet Request Pending** (user must sign) and **Network Confirming** (waiting for receipt).

### D. App Shell & Portfolio (`AppShell.tsx`, `/app/overview`)
- **5-Destination Mobile Navigation:** Mobile navigation includes Settings alongside Overview, Baskets, Activity, and Agents.
- **Truthful Valuation Accounting:** Unloaded or error states never render as `$0.00`; missing accounting metrics explicitly show placeholders with retry actions.

---

## 4. Verification & Testing
- **TypeScript:** Strict typecheck passing cleanly across workspace.
- **Next.js Production Build:** Full static and dynamic page generation confirmed with zero build errors.
- **Automated Tests:** 20 test suites (117 tests) passing in backend and frontend valuation units verified.
