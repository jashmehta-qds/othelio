# Othelio design language

Othelio should feel like a quiet instrument for people who already understand markets. The interface creates intrigue first, then reveals capability through interaction. It is not a fintech explainer, a crypto dashboard, or a sci-fi control room.

## Visual point of view

- Editorial scale: one strong sentence is more valuable than a stack of feature claims.
- Dark field, sharp type, one signal: use a near-black canvas, warm off-white ink, and a single acid accent.
- Product detail is earned. Keep allocation, permissions, pricing mechanics, and account management inside the app surface.
- Motion is the identity. Prefer one authored, GPU-led scene with a clear beginning and a stable resolved state.
- Materials should feel physical and intentional: graphite, silver, acid light, hairline rules. Avoid generic gradients, glows, grids, orbit diagrams, and decorative status chrome.

## Core tokens

```css
--coal: #10110f;
--chalk: #eeeee7;
--acid: #d7ff46;
--muted: #898b84;
--hairline: #292a27;
```

Use `--coal` as the dominant surface, `--chalk` for primary text, and `--acid` only for an intentional action, price, or market signal. Do not introduce a second saturated accent without a product reason.

## Typography

The primary headline is sentence case, concise, and oversized:

> Build the basket you want to own.

Use a regular weight with tight tracking and a calm line-height. Supporting text stays short. Uppercase labels are allowed only for compact metadata or navigation and should never carry the message.

## Layout

Keep the first viewport sparse: wordmark, one action, one statement, one visual system. Let the visual occupy space without forcing it into a card or panel. Prefer asymmetry and negative space over evenly distributed dashboard columns.

The landing page is a brand threshold. `/app` is where the terminal, wallet gate, portfolio, history, security, and agent permissions belong.

## App workspace

The app is a calm plug-and-play workspace, not a terminal cosplay. Use a warm paper surface, readable UI typography, and a compact navigation model. Keep technical data—wallet addresses, symbols, prices, transaction hashes—in tabular or monospace styling only where it improves scanning. Let the selected index own the hierarchy; supporting activity and protocol state should recede into quiet rows. Use plain-language labels such as “Your indexes,” “Current price,” “Agents,” and “Activity.”

## Motion

Motion should have a readable narrative: diffuse field → convergence into an Othelio form → held state. Do not loop between assembled and disassembled states unless the story explicitly requires it. Avoid camera zooms, perpetual spin, and high-frequency shimmer.

The hero scene should pause when offscreen, adapt its GPU budget to the device, and provide a reduced-motion state that preserves the resolved mark.

## Anti-patterns

Avoid:

- “Transparent by design,” “the ownership layer,” and other generic fintech copy.
- Decorative grid backgrounds or repeated hairline fields.
- Neon blue/purple glow treatments.
- Literal orbit diagrams and ticker rails on the landing page.
- Giant centered blobs that do not have a product meaning.
- Multiple competing calls to action.

## Interaction language

Links are quiet until hovered. Actions use a short verb and a directional arrow. The landing CTA should move toward the wallet-gated app; it should not expose the workbench or explain the product before intent.

## Accessibility and performance

Keep headline contrast high, preserve visible focus states, and never make the WebGL scene the only carrier of meaning. Respect `prefers-reduced-motion`, cap device pixel ratio, and make WebGL failure degrade to a quiet dark surface with readable navigation and CTA.
