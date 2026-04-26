#!/usr/bin/env node
/**
 * Contrast audit — measures WCAG contrast ratios for known token pairs
 * across the dark + light + force-dark themes defined in app/globals.css.
 *
 * Reports any pair below the relevant threshold:
 *   - AA normal text (<18pt or <14pt bold):   ≥ 4.5:1
 *   - AA large text  (≥18pt or ≥14pt bold):   ≥ 3.0:1
 *   - AA UI / non-text (icons, dots, borders): ≥ 3.0:1
 *
 * Token values mirror app/globals.css and stay in sync manually — keep
 * them updated when canonical tokens change.
 */

// ─── Token vocabularies ────────────────────────────────────────────────

// Default (dark) values from :root in globals.css.
const DARK = {
  'surface-page':     '#050d18',
  'surface-card':     '#161920',
  'surface-elevated': '#1d2028',
  'surface-pressed':  '#0d1525',
  'text-primary':     '#f0f2f7',
  'text-secondary':   '#c2c8d8',
  'text-muted':       '#8899aa',
  'text-dim':         '#7a86a0',
  'border-default':   '#272b35',
  'border-subtle':    '#1a2840',
  'border-strong':    '#334155',
  'accent-emerald-solid':   '#00e5a0',
  'accent-emerald-text':    '#00e5a0',
  'accent-emerald-display': '#00e5a0',
  'accent-cyan-solid':      '#00b4d8',
  'accent-cyan-text':       '#00b4d8',
  'accent-cyan-display':    '#00b4d8',
  'accent-blue-solid':      '#4d9fff',
  'accent-blue-text':       '#4d9fff',
  'accent-blue-display':    '#4d9fff',
  'accent-red-solid':       '#ef4444',
  'accent-red-text':        '#f87171',
  'accent-red-display':     '#f87171',
  'accent-amber-solid':     '#f5a623',
  'accent-amber-text':      '#f5a623',
  'accent-amber-display':   '#f5a623',
  'accent-purple-solid':    '#b47dff',
  'accent-purple-text':     '#b47dff',
  'accent-purple-display':  '#b47dff',
  'accent-teal-solid':      '#00d4c8',
  'accent-teal-text':       '#00d4c8',
  'accent-teal-display':    '#00d4c8',
  'text-on-accent':       '#000000',
  'brand-mark':           '#00e07a',
};

// Light overrides from [data-theme="light"] in globals.css.
const LIGHT = {
  ...DARK,
  'surface-page':     '#eaeef4',
  'surface-card':     '#ffffff',
  'surface-elevated': '#ffffff',
  'surface-pressed':  '#dde2ec',
  'text-primary':     '#0a0e1a',
  'text-secondary':   '#232b3d',
  'text-muted':       '#45506a',
  'text-dim':         '#606b82',
  'border-default':   '#d2d8e3',
  'border-subtle':    '#e3e7ef',
  'border-strong':    '#7c8696',
  // Accent solids stay identical across themes
  'accent-emerald-text':    '#007355',
  'accent-cyan-text':       '#006a85',
  'accent-blue-text':       '#1758b0',
  'accent-red-text':        '#c0312f',
  'accent-amber-text':      '#8e5400',
  'accent-purple-text':     '#7c4cd6',
  'accent-teal-text':       '#017068',
  'accent-emerald-display': '#009868',
  'accent-cyan-display':    '#008599',
  'accent-blue-display':    '#3a82e0',
  'accent-red-display':     '#e64141',
  'accent-amber-display':   '#b06800',
  'accent-purple-display':  '#9560e0',
  'accent-teal-display':    '#019188',
  'text-on-accent':      '#000000',
};

// ─── WCAG math ─────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relLum([r, g, b]) {
  const linearize = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [linearize(r), linearize(g), linearize(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(fgHex, bgHex) {
  const lf = relLum(hexToRgb(fgHex));
  const lb = relLum(hexToRgb(bgHex));
  const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a color over a base. Both hex; alpha 0..1. */
function compositeOver(fgHex, bgHex, alpha) {
  const [fr, fg, fb] = hexToRgb(fgHex);
  const [br, bg, bb] = hexToRgb(bgHex);
  const r = Math.round(fr * alpha + br * (1 - alpha));
  const g = Math.round(fg * alpha + bg * (1 - alpha));
  const b = Math.round(fb * alpha + bb * (1 - alpha));
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ─── Pair definitions ──────────────────────────────────────────────────

/**
 * Each pair: { name, fg, bg, kind }
 *   fg / bg can be a token name or a function (theme) => hex for composited
 *   colors (tinted backgrounds via color-mix).
 *   kind: 'text' | 'large-text' | 'ui' | 'icon-tap' (for tap-target UI)
 *
 * Threshold by kind:
 *   text:        4.5
 *   large-text:  3.0   (≥18pt / ≥14pt bold)
 *   ui:          3.0   (icons, dots, focus rings, borders that convey state)
 *
 * Pairs listed below cover the high-traffic surfaces — body text, stat
 * numbers, labels, status pills, dim/muted/dim text on cards, accent text
 * on tinted soft backgrounds (e.g. emerald-text on emerald-soft).
 */
const PAIRS = [
  // ── Body & label text on cards ─────────────────────────────────────
  { name: 'text-primary on surface-card',        fg: 'text-primary',   bg: 'surface-card',     kind: 'text' },
  { name: 'text-primary on surface-page',        fg: 'text-primary',   bg: 'surface-page',     kind: 'text' },
  { name: 'text-primary on surface-pressed',     fg: 'text-primary',   bg: 'surface-pressed',  kind: 'text' },
  { name: 'text-secondary on surface-card',      fg: 'text-secondary', bg: 'surface-card',     kind: 'text' },
  { name: 'text-secondary on surface-page',      fg: 'text-secondary', bg: 'surface-page',     kind: 'text' },
  { name: 'text-muted on surface-card',          fg: 'text-muted',     bg: 'surface-card',     kind: 'text' },
  { name: 'text-muted on surface-page',          fg: 'text-muted',     bg: 'surface-page',     kind: 'text' },
  { name: 'text-muted on surface-pressed',       fg: 'text-muted',     bg: 'surface-pressed',  kind: 'text' },
  { name: 'text-dim on surface-card',            fg: 'text-dim',       bg: 'surface-card',     kind: 'text' },
  { name: 'text-dim on surface-page',            fg: 'text-dim',       bg: 'surface-page',     kind: 'text' },

  // ── Accent text variants on cards (large-text — most are stat displays) ──
  { name: 'accent-emerald-text on surface-card', fg: 'accent-emerald-text', bg: 'surface-card', kind: 'large-text' },
  { name: 'accent-cyan-text on surface-card',    fg: 'accent-cyan-text',    bg: 'surface-card', kind: 'large-text' },
  { name: 'accent-blue-text on surface-card',    fg: 'accent-blue-text',    bg: 'surface-card', kind: 'large-text' },
  { name: 'accent-red-text on surface-card',     fg: 'accent-red-text',     bg: 'surface-card', kind: 'text' }, // sign-out label is small
  { name: 'accent-amber-text on surface-card',   fg: 'accent-amber-text',   bg: 'surface-card', kind: 'text' }, // pending pill text
  { name: 'accent-purple-text on surface-card',  fg: 'accent-purple-text',  bg: 'surface-card', kind: 'large-text' },
  { name: 'accent-teal-text on surface-card',    fg: 'accent-teal-text',    bg: 'surface-card', kind: 'large-text' },

  // Same accents on the page bg (they appear in dashboards etc)
  { name: 'accent-emerald-text on surface-page', fg: 'accent-emerald-text', bg: 'surface-page', kind: 'large-text' },
  { name: 'accent-amber-text on surface-page',   fg: 'accent-amber-text',   bg: 'surface-page', kind: 'text' },
  { name: 'accent-blue-text on surface-page',    fg: 'accent-blue-text',    bg: 'surface-page', kind: 'large-text' },

  // ── Display variants on cards (hero stats — large-text 3:1 minimum) ───
  // Tuned punchier than -text so big numbers pop visually while still
  // passing 3:1 on white card backgrounds. Use only for ≥18pt display
  // elements; small text stays on -text variant.
  ...['emerald', 'cyan', 'blue', 'red', 'amber', 'purple', 'teal'].map((accent) => ({
    name: `accent-${accent}-display on surface-card`,
    fg: `accent-${accent}-display`,
    bg: 'surface-card',
    kind: 'large-text',
  })),
  ...['emerald', 'cyan', 'blue', 'red', 'amber', 'purple', 'teal'].map((accent) => ({
    name: `accent-${accent}-display on surface-page`,
    fg: `accent-${accent}-display`,
    bg: 'surface-page',
    kind: 'large-text',
  })),

  // ── Accent text on tinted-soft backgrounds (badges/pills) ─────────────
  // softBg = accent-X-solid composited over surface-card at 15% alpha
  ...['emerald', 'cyan', 'blue', 'red', 'amber', 'purple', 'teal'].map((accent) => ({
    name: `accent-${accent}-text on ${accent}-soft (15% on card)`,
    fg: `accent-${accent}-text`,
    bg: (theme) => compositeOver(theme[`accent-${accent}-solid`], theme['surface-card'], 0.15),
    kind: 'text',
  })),

  // ── On-accent text: black/white over solid emerald/cyan/blue buttons ──
  { name: 'text-on-accent on accent-emerald-solid', fg: 'text-on-accent', bg: 'accent-emerald-solid', kind: 'text' },
  { name: 'text-on-accent on accent-cyan-solid',    fg: 'text-on-accent', bg: 'accent-cyan-solid',    kind: 'text' },
  { name: 'text-on-accent on accent-blue-solid',    fg: 'text-on-accent', bg: 'accent-blue-solid',    kind: 'text' },
  { name: 'text-on-accent on accent-amber-solid',   fg: 'text-on-accent', bg: 'accent-amber-solid',   kind: 'text' },
  { name: 'text-on-accent on accent-red-solid',     fg: 'text-on-accent', bg: 'accent-red-solid',     kind: 'text' },

  // ── UI / non-text (3:1 minimum per WCAG 1.4.11) ───────────────────
  { name: 'border-default vs surface-card',  fg: 'border-default', bg: 'surface-card', kind: 'ui' },
  { name: 'border-default vs surface-page',  fg: 'border-default', bg: 'surface-page', kind: 'ui' },
  { name: 'border-strong vs surface-card',   fg: 'border-strong',  bg: 'surface-card', kind: 'ui' },
  { name: 'border-strong vs surface-page',   fg: 'border-strong',  bg: 'surface-page', kind: 'ui' },
  // border-subtle is intentionally low-contrast (decorative dividers); not audited

  { name: 'accent-emerald-solid vs surface-card', fg: 'accent-emerald-solid', bg: 'surface-card', kind: 'ui' },
  { name: 'accent-cyan-solid vs surface-card',    fg: 'accent-cyan-solid',    bg: 'surface-card', kind: 'ui' },
  { name: 'accent-blue-solid vs surface-card',    fg: 'accent-blue-solid',    bg: 'surface-card', kind: 'ui' },
  { name: 'accent-amber-solid vs surface-card',   fg: 'accent-amber-solid',   bg: 'surface-card', kind: 'ui' },
  { name: 'accent-red-solid vs surface-card',     fg: 'accent-red-solid',     bg: 'surface-card', kind: 'ui' },
  { name: 'accent-purple-solid vs surface-card',  fg: 'accent-purple-solid',  bg: 'surface-card', kind: 'ui' },
  { name: 'accent-teal-solid vs surface-card',    fg: 'accent-teal-solid',    bg: 'surface-card', kind: 'ui' },

  // ── SVG illustration fills used in empty states ────────────────────
  { name: 'surface-pressed (illustration body) vs surface-card', fg: 'surface-pressed', bg: 'surface-card', kind: 'ui' },
  { name: 'border-strong (illustration accent) vs surface-pressed', fg: 'border-strong', bg: 'surface-pressed', kind: 'ui' },
  { name: 'border-default (illustration stroke) vs surface-pressed', fg: 'border-default', bg: 'surface-pressed', kind: 'ui' },
];

const THRESHOLD = { 'text': 4.5, 'large-text': 3.0, 'ui': 3.0 };

// ─── Run audit ─────────────────────────────────────────────────────────

function resolve(value, theme) {
  if (typeof value === 'function') return value(theme);
  return theme[value] ?? value;
}

function audit(themeName, theme) {
  const results = [];
  for (const pair of PAIRS) {
    const fgHex = resolve(pair.fg, theme);
    const bgHex = resolve(pair.bg, theme);
    const ratio = contrast(fgHex, bgHex);
    const min = THRESHOLD[pair.kind];
    const pass = ratio >= min;
    results.push({ ...pair, theme: themeName, fgHex, bgHex, ratio, min, pass });
  }
  return results;
}

const all = [...audit('dark', DARK), ...audit('light', LIGHT)];
const failed = all.filter((r) => !r.pass);
const passed = all.filter((r) => r.pass);

// ─── Output ────────────────────────────────────────────────────────────

const fmt = (r) =>
  `  [${r.theme.padEnd(5)}] ${r.ratio.toFixed(2).padStart(5)}:1 ` +
  `(min ${r.min.toFixed(1)}, ${r.kind.padEnd(10)}) ` +
  `${r.fgHex} on ${r.bgHex} — ${r.name}`;

console.log('━━━ Contrast audit ━━━');
console.log(`${all.length} pairs · ${passed.length} pass · ${failed.length} fail\n`);

if (failed.length > 0) {
  console.log('━━━ FAILURES (below AA) ━━━');
  for (const r of failed) console.log(fmt(r));
  console.log('');
}

console.log('━━━ All results ━━━');
for (const r of all) {
  const tag = r.pass ? '✓' : '✗';
  console.log(`${tag} ${fmt(r).slice(2)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
