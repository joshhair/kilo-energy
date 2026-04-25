# Design tokens

The single source of truth for color in the Kilo app. Every styled surface
must reference these tokens via CSS variables. Raw hex / rgba literals in
inline `style` props are not allowed (Phase 6 ESLint rule enforces this).

This system unifies the previously-overlapping prefixes (`--*`, `--d-*`,
`--m-*`) into one canonical vocabulary. Light mode is supported by
re-defining the same token names under `[data-theme="light"]`.

## Why tokens

1. **Theming is one attribute toggle.** `<html data-theme="light">` and the
   browser cascades the new values automatically.
2. **Consistency.** Today the same gray is written 3 different ways (e.g.
   `#445577`, `#525c72`, and `var(--m-text-dim, #445577)`). Tokens collapse
   that to one.
3. **Refactor safety.** Change one variable, every surface using it shifts.

## Token taxonomy (27 tokens)

Names are flat — no nested categories. The prefix is the category; the
suffix is the variant.

### Surface (5)
Backgrounds, lightest → darkest by elevation, not visual brightness.

| Token | Dark value | Light value | Use |
|---|---|---|---|
| `--surface-page` | `#050d18` | `#f7f8fb` | Full-page background (everything sits on this) |
| `--surface-card` | `#161920` | `#ffffff` | Cards, list rows, table cells |
| `--surface-elevated` | `#1d2028` | `#ffffff` | Modals, dropdowns, sheets — above cards |
| `--surface-overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.4)` | Modal backdrops, scrim |
| `--surface-pressed` | `#0d1525` | `#eef0f5` | Pressed/active state, recessed wells |

### Text (4)
Text and icon colors on surface backgrounds.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--text-primary` | `#f0f2f7` | `#0a0e1a` | Body text, headings |
| `--text-secondary` | `#c2c8d8` | `#3a4358` | Secondary copy, card subtitles |
| `--text-muted` | `#8899aa` | `#5a6478` | Labels, helper text |
| `--text-dim` | `#445577` | `#8a93a5` | Disabled, captions, watermarks |

### Border (3)
Lines and dividers.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--border-default` | `#272b35` | `#dfe3eb` | Cards, inputs, table grid |
| `--border-subtle` | `#1a2840` | `#eef0f5` | Quiet dividers, sub-list separators |
| `--border-strong` | `#334155` | `#a8b1c2` | Hover/focus rings, emphasized borders |

### Accent (6 colors × 3 variants = 18)
Solid is the saturated form; soft is a low-alpha tint for backgrounds;
glow is a softer, larger-radius form for box-shadows.

| Color | Solid | Soft (≈10% alpha) | Glow (≈30% alpha) | Use |
|---|---|---|---|---|
| Emerald (primary brand) | `#00e5a0` | `rgba(0,229,160,0.10)` | `rgba(0,229,160,0.30)` | Active state, primary CTA, "live" indicators |
| Cyan | `#00b4d8` | `rgba(0,180,216,0.10)` | `rgba(0,180,216,0.30)` | Secondary brand, gradient pair with emerald |
| Blue | `#4d9fff` | `rgba(77,159,255,0.10)` | `rgba(77,159,255,0.30)` | Info, "Draft" payroll state |
| Red | `#ef4444` | `rgba(239,68,68,0.10)` | `rgba(239,68,68,0.30)` | Errors, flagged projects, destructive actions |
| Amber | `#f5a623` | `rgba(245,166,35,0.10)` | `rgba(245,166,35,0.30)` | Warnings, "Pending" payroll, view-as banner |
| Purple | `#b47dff` | `rgba(180,125,255,0.10)` | `rgba(180,125,255,0.30)` | Trainer override payouts, Total Users stat |
| Teal | `#00d4c8` | `rgba(0,212,200,0.10)` | `rgba(0,212,200,0.30)` | Total Sold stat (kW), secondary energy metric |

Token names: `--accent-{emerald|cyan|blue|red|amber|purple|teal}-{solid|soft|glow}`.

## Special-purpose (out of taxonomy, kept hard-coded)

These don't theme — they have semantic meaning that's identical in both modes,
or they're literal drawing fills inside SVGs that should not respond to theme:

- `#000` — used as `--text-on-accent` for max-contrast text on a solid accent
  button (the New Deal gradient FAB, etc.). Always pure black.
- `#fff` — used as `--accent-on-dark` for icons inside accent-tinted soft
  surfaces in dark mode only. In light mode, this becomes the primary text.
- `#00e07a` — the registered "kilo green" brand mark color. Stays literal in
  the wordmark dot (`app/dashboard/layout.tsx`) and the PWA icon SVGs.
  Distinct from `--accent-emerald-solid (#00e5a0)`, which is the in-app
  accent — see "Unifications" below for why these are different on purpose.
- `#1e293b` / `#334155` — slate fills inside empty-state SVG illustrations
  (`MobileEmptyState`, projects empty folder, earnings empty receipt). These
  draw the illustration and do not respond to theme; light-mode versions of
  the SVGs would need their own redesign, not a token swap.

## Unifications applied during the sweep

These are intentional outlier consolidations. Documented here so the PR
review knows where the dark-mode visual diff is *expected* to differ from
the pre-sweep baseline:

1. `#525c72` (used 10×) and `#445577` (used 110×) — both were "the dim
   text color." Unified to `--text-dim = #445577` since that's the more
   prevalent value and the more legible on mobile cards.
2. `#8891a8` (10×) and `#8899aa` (mobile dim) — unified to
   `--text-muted = #8899aa` for the same reason.
3. `#0b0d11` / `#0f1117` / `#0d2040` — three navy backgrounds. Unified
   to `--surface-page = #050d18` (the deepest, most-used) and
   `--surface-pressed = #0d1525` for the recessed states.
4. `#fff` (87×) and `#f0f2f7` — both were "primary text white". `#f0f2f7`
   becomes the canonical `--text-primary` since it's softer on dark bg.
   `#fff` stays only where literal pure-white is meant (icons inside
   solid accent buttons).
5. `#00e07a` (16×) and `#00e5a0` (3× in CSS, more in inline styles) —
   both were "the green." `#00e07a` is warmer (the brand-mark logo color);
   `#00e5a0` is cooler (the in-app accent). They're kept distinct on
   purpose: brand mark stays `#00e07a` literally, all in-app emerald
   accents become `--accent-emerald-solid = #00e5a0`. About 16 surfaces
   that were using the warmer `#00e07a` for non-mark uses (button
   backgrounds, "active" indicators) shift to the cooler emerald —
   visually a ~3-degree hue shift, slightly cooler/more modern.

Total expected dark-mode visual delta: < 1% across surfaces using these
unified values, with the green shift (#5) being the most visible. Item 5
is the largest intentional change — call it out in the PR review for
your final approval before merge.

## Light mode philosophy

Light mode inverts the surface stack (page < card < elevated) and the
text scale, but keeps accent colors identical (emerald is emerald in both
themes — that's brand). Soft variants drop alpha slightly to compensate
for higher contrast on light surfaces.

## Activating the theme

```html
<html data-theme="dark">  <!-- or "light" -->
```

Set in `app/layout.tsx` early in the page lifecycle to avoid flash. The
toggle (Settings → Appearance) writes to `localStorage.theme` and the
`useTheme` hook applies the attribute. First-time users get the value
of `prefers-color-scheme`.

## Don't do

- ❌ `style={{ color: '#445577' }}` — use `var(--text-dim)`
- ❌ `style={{ background: 'rgba(0,229,160,0.1)' }}` — use `var(--accent-emerald-soft)`
- ❌ Defining new top-level color variables outside this doc — extend it
  first, get a name, then define.
- ❌ Mixing token systems (`var(--m-text-dim, #445577)`) — Phase 3 deletes
  the legacy aliases.

## Phase rollout

See task list (Phases 0-6) for the sweep order. Tokens defined first
(Phase 1, no visual change), surfaces migrated in commits per area
(Phase 2), legacy prefixes consolidated (Phase 3), light mode activated
(Phase 5).
