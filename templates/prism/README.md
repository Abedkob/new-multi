# Prism

An image-led storefront template registered through `templates/meta.ts` and `templates/index.ts`.
Select **Prism** in the platform store theme editor; the owner content editor and both live
previews use the same template. No migration or new content fields are needed.

## Content and shopping

- Hero: existing desktop/mobile images, headline, subtext and CTA. Images can stand alone when hero text is hidden.
- Collections: actual top-level category images and links, stacked on desktop and horizontally scrollable on mobile.
- Campaign and story: existing promo banner and brand story content, respecting the renderer's visibility switches.
- Products: real prices, discounts, availability, gallery photos and variant selection. Catalog filtering, cart and checkout retain the shared behavior.
- Search: native modal with category shortcuts and debounced real-product suggestions. Escape restores focus; failed or timed-out requests retain a full-search link.
- Category headers use category photography where available; other catalog pages use a compact heading.

## Visual and motion contract

Use the store's theme tokens, with a cool porcelain/ink/cobalt default palette. Component metrics
live in `prism.module.css`. Oversized display type inherits the store's heading-font selection.
Keep product names, prices and purchase controls stable while images move.

GSAP handles the opening panels, word entrance, hero frame contraction, collection depth and
campaign expansion. Fine pointers get perspective interaction; touch uses direct navigation.
Reduced-motion users get a static, readable layout. All content is visible before hydration.
Animations are scoped, reverted on unmount and rebuilt when live-preview content changes.
There are no new animation dependencies, WebGL contexts, synthetic 3D product models or scroll hijacking.

## Verification

`pnpm e2e:prism` creates and removes a temporary store and checks the hero, real search, focus,
product-to-cart flow, catalog routes, mobile overflow and reduced motion. Set
`PRISM_SCREENSHOT_DIR` to capture desktop and mobile screenshots. Requires a running development
server and working local database/rate-limit configuration. `pnpm verify:templates` covers
section visibility, canonical content, custom colors and empty stores across all templates.
