# Kilo Energy Premium Spec

> The visual contract for the mobile (and responsive) UI. Every implementation agent in Phase 3 evaluates against this document. Local-only during this polish run; production stays untouched.

## North Star
The reference surface is **My Pay**. Premium = the same visual vocabulary as the `$162,870` hero card on My Pay:
- card-surface tile (subtle dark fill, hairline border)
- DM Serif Display for the big numeral, DM Sans for body
- one quiet emerald-text accent
- no halo, no gradient, no saturated splash

Anything that fights that vocabulary is "tacky."

## The Twelve Rules

### 1. Surfaces
- Background: `var(--surface-card)` (or the `card-surface` Tailwind utility)
- Border: 1px hairline (`color-mix(in srgb, var(--accent-X-solid) 25-35%, transparent)` for accent-tinted, or `var(--border-subtle)` for neutral)
- No saturated tinted backgrounds for state. No 2px+ borders.
- Hero variant only: subtle gradient (surface-card → surface-elevated) + emerald-soft border. No halo glow.

### 2. Active state for filters, tabs, toggles
- Background: soft tint, 12-15% color-mix (e.g. `color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)`)
- Text: accent text (`var(--accent-emerald-text)`)
- Border (on active pill if no sliding indicator): 30-35% color-mix of the accent
- **NOT** solid emerald fill with `#000` text.

### 3. CTAs (buttons)
- **Solid accent** for the ONE primary action per screen. No gradient.
- Secondary: outlined hairline (card-surface bg + accent border + accent text)
- Tertiary: text-link with subtle icon, no background
- **No halo glows**, no `boxShadow` with accent-glow tokens, no 2× scale-up on active
- Press feedback: `active:scale-[0.97]` (mobile) or opacity step, nothing louder

### 4. Typography
- **DM Serif Display** — headlines, names, big numerals, hero amounts (single-weight font, so `font-bold` / `font-black` are no-ops — don't combine them)
- **DM Sans** — body, labels, button copy, eyebrows
- Eyebrow labels: `10px`, `uppercase`, `0.22em` letter-spacing, accent color (`var(--accent-emerald-text)` or `var(--text-dim)` for neutral)
- Bottom-sheet headers: serif (`var(--m-font-display)`)

### 5. Sizing
- Tap targets: **40px minimum** (not 44px+/48px+ chunky). For pagination/dense table actions, 32px is acceptable.
- Icons: 14-16px (lucide `w-3.5 h-3.5` to `w-4 h-4`). Avoid 20px+.
- Card padding: 16-20px (`p-4` to `p-5`). Avoid 28px+ (`p-7`).
- Border-radius: `rounded-xl` (12px) for cards/inputs, `rounded-full` for pills.

### 6. Color palette
- `--accent-emerald-text` for active accent text — NOT `--accent-emerald-solid` as background
- Avoid gradient cyan-emerald splashes. (Existing exceptions to flag: BottomNav underline indicator is grandfathered as PREMIUM — soft + thin)
- Amber: warnings, pending, trainer surfaces only
- Cyan: "upcoming" / info states, small dose, never as splash
- Red: destructive confirm or chargebacks only
- Hardcoded hex (e.g. `#2a3858`, `#00e07a`) is a smell — use design tokens

### 7. Badges
- Slim **hairline outline** (transparent or card-surface bg, 1.5px accent border, accent text)
- NOT soft-fill blob (saturated tint as bg)
- Status: pair a subtle accent-color dot with a label rather than a chunky pill

### 8. Inputs
- card-surface fill, **1px hairline** border (not 0.5px), `rounded-xl`
- Focus: `focus:ring-2 focus:ring-[var(--accent-emerald-solid)]` — subtle, not a glow
- 40px minimum height

### 9. Sliders / steppers
- Hairline track (`color-mix(... 6-10%, transparent)`)
- Soft accent thumb, not a chunky bright fill
- Tick marks subtle

### 10. Modals / sheets / dialogs
- card-surface bg, hairline border
- **Serif header**, sans body
- Single primary CTA per modal (solid accent), secondary outlined, destructive solid red

### 11. Toasts
- card-surface + hairline border (accent-tinted)
- NO saturated fill — the accent comes from the icon and border only
- 2px progress bar at bottom, hairline

### 12. FABs / floating widgets
- card-surface tile + 1px hairline accent border
- NO halo glow
- The "New Deal" FAB is the canonical implementation (BottomNav.tsx ~131-180)

## Quick Translation Cheatsheet

| If you see | Replace with |
|---|---|
| `background: linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))` on a button | `background: var(--accent-emerald-solid)` (solid) or move to outlined secondary |
| `boxShadow: '0 0 20px var(--accent-emerald-glow)'` | Delete the boxShadow entirely |
| `background: var(--accent-emerald-soft)` for active state | `background: color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)` + `border: 1px solid color-mix(... 35%, transparent)` |
| `background: var(--accent-emerald-solid); color: #000` on active pill | Soft tint per row 2, accent text color |
| `border: 0.5px solid ...` | `border: 1px solid ...` |
| Hand-rolled toggle JSX | `<Switch>` from `components/ui` |
| Hand-rolled segmented buttons | `<SegmentedPills>` from `components/ui` |
| `text-[#00e07a]` or other raw hex | `color: var(--accent-emerald-solid)` |
| `bg-amber-500/10 border-amber-500/30` for a top banner | `card-surface` + `border-l-2` with `color-mix(... amber-solid 32%, transparent)` (matches UpcomingBlitzBanner) |
| Soft-fill badge blob | Hairline outline badge (transparent bg + accent border + accent text) |

## Out of Scope (intentionally untouched)
- Desktop-only surfaces unless they render on mobile breakpoint
- The legacy live app at `app.kiloenergies.com` (per HARD RULE)
- Marketing/sign-in/sign-up pages
- Print stylesheets

## Sign-off

Once Josh has redlined this doc (or accepted as-is), it becomes the contract for Phase 3 implementation agents. Each agent gets:
1. This Premium Spec (this file)
2. Its assigned surface's punch list from `polish-ledger.md`
3. The shared primitives: `SegmentedPills`, `Button`, `Switch`, `TextInput`, `FormField`, `SearchInput`, `SelectMenu`, `MobileCard`, `MobileBadge`, `MobileSection`, `MobileBottomSheet`

Agents do NOT invent new patterns. If a punch-list item can't be fixed with the existing primitives + this spec, they flag it for manual review instead of improvising.
