/**
 * Visual regression baselines for the highest-traffic dashboard surfaces.
 *
 * What this catches: layout drift that is invisible to unit + API + e2e tests.
 * Things like "Rebekah said the columns don't align with data" or "Josh said
 * the commission breakdown looks messy on iPhone" — those are layout bugs
 * that ship green because no logic test asserts pixel positions.
 *
 * Cadence: a GitHub Actions workflow (.github/workflows/visual-regression.yml)
 * runs this suite nightly against the live Vercel production deploy
 * (https://kilo-energy.vercel.app). On any diff exceeding the tolerance, the
 * workflow fails and Josh gets a notification with the diff PNGs attached
 * as artifacts.
 *
 * Intentional UI changes: regenerate baselines via
 *   `npm run test:visual:update`
 * locally, then commit the updated PNGs alongside the UI change. The CI
 * workflow refuses to update baselines on its own — every baseline change
 * needs human review.
 *
 * Fixture stability: tests pin Date.now() via Playwright's clock API and
 * apply a CSS stylesheet (visual-fixtures/hide-volatile.css) that masks
 * volatile content like sparklines, count-ups, and relative-time labels.
 * The remaining differences across runs should be ~0 pixels at the chosen
 * tolerance.
 *
 * Why list pages only (no detail pages): list routes don't depend on a
 * specific entity ID. Detail pages would need a stable fixture project /
 * user, which means a CI-controlled seeded DB — that's a follow-up. List
 * surfaces give us coverage of the dashboard chrome, navigation, table
 * layouts, and stat-card patterns that 80% of layout regressions live in.
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Frozen wall-clock for any code that reads Date.now() to render — keeps
// "3 days ago" strings, age counters, and date headers stable run-to-run.
const FROZEN_TIME = new Date('2026-05-13T12:00:00.000Z');

// CSS injected before each snapshot. Hides elements whose content is
// data-dependent (sparkline curves, $ amounts, names) and disables all
// CSS animations so a snapshot taken mid-transition isn't different
// from one taken at rest.
const HIDE_VOLATILE_CSS = fs.readFileSync(
  path.join(__dirname, 'visual-fixtures', 'hide-volatile.css'),
  'utf-8',
);

test.use({ storageState: 'tests/e2e/.auth/admin.json' });

// Per-spec page setup — applied before every test in this file. Keeps the
// frozen-time + hide-volatile pattern in one place instead of repeating
// it in every test body.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FROZEN_TIME });
  // Suppress the PWA "Add to home screen" prompt — it overlays the bottom
  // nav on mobile and is volatile run-to-run. InstallPrompt checks this
  // localStorage flag on mount. addInitScript applies before every nav.
  await page.addInitScript(() => {
    try { localStorage.setItem('kilo-install-dismissed', '1'); } catch { /* noop */ }
  });
});

async function stableScreenshot(page: Page, name: string) {
  // Inject volatility-hiding CSS *after* navigation so dynamic class names
  // resolved by React on mount are present when the rules apply. waitForLoadState
  // 'networkidle' is a stronger signal than 'domcontentloaded' for screenshots.
  await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
  // Give one extra paint cycle for the CSS to settle.
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    // Generous pixel tolerance — subpixel font rendering on Linux CI
    // vs macOS local can drift 0.3-0.5% without any layout change.
    // 1% = ~20k pixels on a 1920×1080 viewport, which is large enough
    // to absorb noise but small enough to catch any meaningful diff.
    maxDiffPixelRatio: 0.01,
    // Each animation step + clock-tick interaction can change layout
    // for a frame — retry a few times to land on a stable frame.
    animations: 'disabled',
  });
}

test.describe('Visual regression — desktop admin', () => {
  test('admin dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'admin-dashboard.png');
  });

  test('projects list', async ({ page }) => {
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'projects-list.png');
  });

  test('users list', async ({ page }) => {
    await page.goto('/dashboard/users');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'users-list.png');
  });

  test('payroll', async ({ page }) => {
    await page.goto('/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'payroll-list.png');
  });

  // Desktop sidebar View-As dropdown. The selector sits in the sidebar's
  // non-scrolling footer; it now opens UPWARD as a height-capped overlay so
  // the candidate list can't overflow below the viewport (downward in-flow
  // pushed the list + footer off the bottom on shorter desktop heights).
  // Desktop-only: the mobile sidebar stays off-screen (never opened), so the
  // "View As..." button isn't reachable there — mobile uses the You page.
  test('admin sidebar — View As dropdown opens on-screen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'sidebar selector is desktop-only; mobile uses the You page');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const trigger = page.getByRole('button', { name: 'View As...' });
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();
    await page.getByPlaceholder('Search users...').waitFor({ state: 'visible' });
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('admin-sidebar-view-as.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

// Mobile-only safety surfaces (Tier 1). These run under the `visual-mobile`
// project (393×852, iPhone UA, admin storage state). They are skipped on
// desktop because the routes are mobile-only (/dashboard/you redirects to
// /dashboard above 767px).
// T1.2 — deep links must NOT bounce to /dashboard. On a fresh load,
// dashboard/layout.tsx bounces through `/` while the role resolves (currentRole
// is briefly null), stashing the intended path in sessionStorage; app/page.tsx
// must return the user to that stashed path, not a hardcoded /dashboard.
// Runs under both authed projects (visual-desktop + visual-mobile), so it
// guards the viewport-agnostic fix on both. Not a visual test — URL only.
test.describe('Deep-link redirect (T1.2)', () => {
  for (const route of [
    '/dashboard/projects',
    '/dashboard/payroll',
    '/dashboard/users',
    '/dashboard/new-deal',
    '/dashboard/my-pay',
    '/dashboard/you', // mobile-only; redirects to /dashboard on desktop by design
  ]) {
    test(`preserves deep link ${route}`, async ({ page, isMobile }) => {
      test.skip(route === '/dashboard/you' && !isMobile, '/dashboard/you is mobile-only');
      await page.goto(route);
      // Allow the bounce-through-/ + role-resolve + return cycle to settle.
      await page.waitForURL((url) => url.pathname === route, { timeout: 15_000 }).catch(() => {});
      expect(new URL(page.url()).pathname).toBe(route);
    });
  }
});

// T1.8 — Runtime ancestor-walk guard. After the page-enter animation settles,
// EVERY visible position:fixed element must resolve to the viewport — i.e. none
// of its ancestors may create a CSS containing block (computed transform!=none,
// filter!=none, perspective!=none, backdrop-filter!=none, will-change naming
// transform/filter/perspective, or contain: layout/paint/strict/content). This
// catches the symptom regardless of cause: a new wrapper animation, a stray
// will-change, a `contain` added for perf — anything that would silently push a
// fixed CTA/pill/FAB/toolbar/modal footer-style instead of pinning it.
//
// Rides both authed projects (visual-desktop 1440×900 + visual-mobile 393×852)
// so the archetypes are covered on each viewport. Pure structural assertion —
// no screenshot/baseline, so no baseline churn.
type FixedOffender = { fixed: string; ancestor: string; reasons: string[] };

async function findFixedContainingBlockOffenders(page: Page): Promise<FixedOffender[]> {
  // Let the page-enter / section-enter animation finish so we read the SETTLED
  // computed styles (the fix ends those keyframes at transform:none).
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const e = el as HTMLElement;
      const id = e.id ? `#${e.id}` : '';
      const cls = typeof e.className === 'string' && e.className
        ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
      const txt = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${e.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
    };
    // Reasons an ancestor would establish a containing block for fixed descendants.
    const cbReasons = (cs: CSSStyleDeclaration): string[] => {
      const r: string[] = [];
      if (cs.transform && cs.transform !== 'none') r.push(`transform:${cs.transform}`);
      if (cs.filter && cs.filter !== 'none') r.push(`filter:${cs.filter}`);
      if (cs.perspective && cs.perspective !== 'none') r.push(`perspective:${cs.perspective}`);
      const bf = (cs as unknown as { backdropFilter?: string }).backdropFilter;
      if (bf && bf !== 'none') r.push(`backdrop-filter:${bf}`);
      if (/transform|filter|perspective/.test(cs.willChange || '')) r.push(`will-change:${cs.willChange}`);
      if (/\b(layout|paint|strict|content)\b/.test(cs.contain || '')) r.push(`contain:${cs.contain}`);
      return r;
    };
    const isVisible = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const out: FixedOffender[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (getComputedStyle(el).position !== 'fixed' || !isVisible(el)) continue;
      let anc = el.parentElement;
      while (anc && anc !== document.documentElement && anc !== document.body) {
        const reasons = cbReasons(getComputedStyle(anc));
        if (reasons.length) out.push({ fixed: describe(el), ancestor: describe(anc), reasons });
        anc = anc.parentElement;
      }
    }
    return out;
  });
}

test.describe('Fixed-positioning containing-block guard (T1.8)', () => {
  // ID-free routes only (the desktop/mobile list + entry surfaces). Project
  // Detail is reached by clicking the first card so its fixed bottom bar is
  // covered without a seeded fixture ID.
  const ROUTES = [
    '/dashboard',
    '/dashboard/projects',
    '/dashboard/payroll',
    '/dashboard/new-deal',
    '/dashboard/users',
    '/dashboard/settings',
    '/dashboard/my-pay',
    '/dashboard/training',
    '/dashboard/blitz',
    '/dashboard/incentives',
  ];
  for (const route of ROUTES) {
    test(`no fixed element trapped in a containing block on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const offenders = await findFixedContainingBlockOffenders(page);
      expect(
        offenders,
        `position:fixed elements trapped in a containing block:\n${JSON.stringify(offenders, null, 2)}`,
      ).toEqual([]);
    });
  }

  test('no fixed element trapped on mobile Project Detail (bottom bar)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile Project Detail bottom bar is the mobile-only surface');
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    // Open the first project card to render MobileProjectDetail + its fixed bar.
    // Mobile rows are MobileCard <button>s (router.push), NOT <a href> links, so
    // target the card button (it carries the list's `animate-card-enter` class)
    // and ASSERT we actually reached a detail URL — otherwise the guard would
    // silently run on the list page and never exercise the fixed bottom bar.
    const firstCard = page.locator('button.animate-card-enter').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 });
    await firstCard.click();
    await page.waitForURL('**/dashboard/projects/*', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    const offenders = await findFixedContainingBlockOffenders(page);
    expect(
      offenders,
      `position:fixed elements trapped in a containing block:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

test.describe('Visual regression — mobile safety surfaces', () => {
  // T1.8 — New Deal fixed bottom CTA must be VIEWPORT-pinned (portaled out of
  // the transformed step wrapper), not anchored to the wrapper. Asserts it's a
  // direct child of <body> and its bottom edge sits at the intended offset
  // (~72px above the viewport bottom), then snapshots step 0.
  test('mobile New Deal — CTA is viewport-pinned (portaled)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    await page.goto('/dashboard/new-deal');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Next/ }).waitFor({ state: 'visible' });
    const box = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /^Next/.test(b.textContent || ''));
      const bar = btn?.closest('div');
      const r = bar?.getBoundingClientRect();
      return { vh: window.innerHeight, barBottom: r ? Math.round(r.bottom) : null, portaledToBody: bar?.parentElement === document.body };
    });
    expect(box.portaledToBody).toBe(true);
    // bottom edge ≈ viewport bottom − 72px offset (allow safe-area slack).
    expect(box.vh - (box.barBottom ?? 0)).toBeGreaterThan(40);
    expect(box.vh - (box.barBottom ?? 0)).toBeLessThan(120);
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('newdeal-step0.png', { fullPage: false, maxDiffPixelRatio: 0.01, animations: 'disabled' });
  });

  // T1.1 — the mobile View-As drawer must stay fully on-screen when opened.
  // It lives in the "You" page (MobileYou), opens an inline candidate panel,
  // and previously could render below the fold / behind the fixed bottom nav.
  // We use a VIEWPORT screenshot (fullPage: false) on purpose: the entire
  // point is to prove the drawer + candidate list sit within what the user
  // can actually see, not somewhere down a tall scrolled page.
  // T1.3 — the admin Payroll "Approve All" / "Publish Payroll" CTA must sit
  // ABOVE the bottom nav (was fixed bottom-0 z-40, hidden behind the z-50 nav),
  // and the feedback bubble must clear it. Viewport screenshot of the bottom.
  test('mobile Payroll — admin CTA + feedback clear the bottom nav', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Payroll', exact: true }).click();
    await page.waitForURL('**/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    // Pending tab → the "Publish Payroll" CTA renders. Then scroll to the
    // bottom so the last list row + the fixed CTA + nav are all in frame.
    await page.getByRole('tab', { name: 'Pending', exact: true }).click();
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('main-content')?.scrollTo(0, 99999));
    await page.waitForTimeout(300);
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('mobile-payroll-cta.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // T1.4 — Payroll utility actions (Add Payment / CSV / ADP / Print) live in a
  // single header "Actions" sheet, out of the browse path. Open it and snapshot.
  test('mobile Payroll — Actions sheet', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Payroll', exact: true }).click();
    await page.waitForURL('**/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Payroll actions' }).click();
    await page.getByText('Export CSV', { exact: true }).waitFor({ state: 'visible' });
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('mobile-payroll-actions.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // T1.5 — Users row manage actions live behind a per-row "⋯" (sheet on mobile,
  // dropdown on desktop); destructive flows stay ConfirmDialog-gated; and the
  // dialog's own buttons must remain TAPPABLE in the worst case (InstallPrompt
  // visible → BottomNav rides up the bottom stack → used to paint OVER the
  // z-50 inline dialog; now portaled to body at z-[60]).
  test('mobile Users — kebab sheet, confirm dialog tappable over elevated nav', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    // Re-show the install prompt (beforeEach suppresses it) — the elevated-nav
    // worst case is exactly what this test locks in.
    await page.addInitScript(() => {
      try { localStorage.removeItem('kilo-install-dismissed'); } catch { /* noop */ }
    });
    await page.goto('/dashboard/users');
    await page.waitForLoadState('networkidle');
    const kebab = page.locator('button[aria-label^="Actions for"]').first();
    await kebab.waitFor({ state: 'visible', timeout: 10_000 });
    await kebab.click();
    await page.getByRole('button', { name: /^Deactivate (rep|sub-dealer)$/ }).waitFor({ state: 'visible' });
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('mobile-users-actions-sheet.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: /^Deactivate (rep|sub-dealer)$/ }).click();
    // The REAL assertion: Cancel must be clickable (not covered by the nav).
    // A covered control fails this click with "intercepts pointer events".
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await cancel.click({ timeout: 5_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('desktop Users — row actions menu opens on-screen and flips at viewport bottom', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop-only surface');
    await page.goto('/dashboard/users');
    await page.waitForLoadState('networkidle');
    const kebabs = page.locator('button[aria-label^="Actions for"]');
    await kebabs.first().waitFor({ state: 'visible', timeout: 10_000 });
    await kebabs.first().click();
    const menu = page.getByRole('menu');
    await menu.waitFor({ state: 'visible' });
    const box = await menu.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // Bottom-most kebab: the menu must flip upward rather than clip below.
    const count = await kebabs.count();
    const last = kebabs.nth(count - 1);
    await last.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await last.click();
    await menu.waitFor({ state: 'visible' });
    const b2 = await menu.boundingBox();
    expect(b2!.y + b2!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  // T1.6 — Project Detail destructive actions (Cancel/Delete) live behind the
  // header "More" menu, separated from the benign Edit/Flag/Duplicate strip.
  // The existing gates stay intact (Delete → ConfirmDialog). Reaches a project
  // generically via the first list link so it works on any environment.
  test('desktop Project Detail — destructive actions behind More menu, gates intact', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop-only surface (mobile uses its own bottom-bar sheets)');
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    const firstProject = page.locator('a[href^="/dashboard/projects/"]').first();
    await firstProject.waitFor({ state: 'visible', timeout: 10_000 });
    await firstProject.click();
    await page.waitForURL('**/dashboard/projects/*', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    // No inline destructive buttons in the header strip.
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    // They live behind "More", danger-styled, one deliberate click deeper.
    await page.getByRole('button', { name: 'More project actions' }).click();
    await page.getByRole('menu').waitFor({ state: 'visible' });
    await expect(page.getByRole('menuitem', { name: 'Cancel Project' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete Project' })).toBeVisible();
    // Delete still lands on the ConfirmDialog gate; cancel out without mutating.
    await page.getByRole('menuitem', { name: 'Delete Project' }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  // T1.7 — Settings global-config rows (installers/financers): archive +
  // delete live behind a per-row kebab, separated from the inline CONFIG
  // icons. Archive was previously a one-click hover icon adjacent to delete.
  // Delete keeps its usage-aware ConfirmDeleteDialog gate.
  test('desktop Settings — installer archive/delete behind kebab, delete gate intact', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop-only settings sections');
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.getByText('Installers', { exact: true }).first().click();
    const kebab = page.locator('button[aria-label^="Actions for"]').first();
    await kebab.waitFor({ state: 'visible', timeout: 10_000 });
    // No inline archive icons on active rows (data-independent: ARCHIVED rows
    // never had "Archive installer" — they use "Restore installer" — while
    // their delete buttons legitimately keep the "Permanently delete" title,
    // so asserting on the delete title would false-fail whenever archived
    // installers exist; Codex review catch). The kebab menuitem assertions
    // below cover the delete-relocation half of the regression.
    await expect(page.locator('button[title="Archive installer"]')).toHaveCount(0);
    await kebab.click();
    await page.getByRole('menu').waitFor({ state: 'visible' });
    await expect(page.getByRole('menuitem', { name: 'Archive installer' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete installer/ })).toBeVisible();
    // Delete still lands on the ConfirmDeleteDialog gate; cancel out.
    await page.getByRole('menuitem', { name: /Delete installer/ }).click();
    await page.getByText(/Delete .*\?/).first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  // F2 (feedback 2026-06-10) — the desktop Chatter compose textarea collapsed
  // to its intrinsic ~20-col width (~150px) because the container switches to
  // sm:block while the textarea relied on flex-1. Read-only width assertion.
  test('desktop project Chatter — compose textarea spans the full box', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop-only layout (mobile compose is flex)');
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    const firstProject = page.locator('a[href^="/dashboard/projects/"]').first();
    await firstProject.waitFor({ state: 'visible', timeout: 10_000 });
    await firstProject.click();
    await page.waitForURL('**/dashboard/projects/*', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    const ta = page.locator('textarea[placeholder="Write a message…"]');
    await ta.scrollIntoViewIfNeeded();
    await ta.waitFor({ state: 'visible' });
    const widths = await ta.evaluate((el) => ({ ta: el.clientWidth, parent: el.parentElement!.clientWidth }));
    expect(widths.ta).toBeGreaterThan(widths.parent * 0.9);
  });

  // F4b (feedback 2026-06-11) — the feedback modal opened off-page on iPhone
  // Safari. It rendered inline in the layout subtree, where a Safari-only
  // containing-block ancestor (backdrop-filter/transform/filter) could anchor
  // the fixed overlay to a wrapper instead of the viewport. Fix: portal the
  // overlay to <body>. Deterministic structural assertion (no network).
  test('mobile feedback modal is portaled to body and sits in the viewport', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile is the reported surface');
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    const check = await dialog.evaluate((el) => {
      const overlay = el.parentElement!;
      const r = el.getBoundingClientRect();
      return {
        overlayParentIsBody: overlay.parentElement === document.body,
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1,
      };
    });
    expect(check.overlayParentIsBody).toBe(true);
    expect(check.inViewport).toBe(true);
  });

  // F3 (feedback 2026-06-10) — users/[id] on wide screens: page constrained to
  // max-w-6xl (projects-detail precedent), sidebar no longer has an inner
  // scrollbar, and the Payment History body cells align with their headers
  // (a tr::before pseudo was being wrapped in an anonymous CELL by Chromium,
  // which under table-fixed swallowed the first column and pushed Date to 0px).
  test('desktop users/[id] — wide-screen layout constrained, payment table aligned', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wide-desktop layout');
    await page.setViewportSize({ width: 1740, height: 900 });
    await page.goto('/dashboard/users');
    await page.waitForLoadState('networkidle');
    const firstRep = page.locator('a[href^="/dashboard/users/"]').first();
    await firstRep.waitFor({ state: 'visible', timeout: 10_000 });
    await firstRep.click();
    await page.waitForURL('**/dashboard/users/*', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const container = document.querySelector('.max-w-6xl') as HTMLElement | null;
      const table = Array.from(document.querySelectorAll('table')).find((t) => t.textContent?.includes('Customer / Notes'));
      const th1 = table?.querySelector('thead th') as HTMLElement | null;
      // Skip the empty-state placeholder row (colSpan=6) — comparing the
      // header to it would false-pass the alignment check (Codex review).
      const td1 = table?.querySelector('tbody td:not([colspan])') as HTMLElement | null;
      return {
        containerWidth: container?.getBoundingClientRect().width ?? 0,
        // null when there are no real data rows — skip the assertion then.
        colAligned: th1 && td1 ? Math.abs(th1.getBoundingClientRect().x - td1.getBoundingClientRect().x) < 2 : null,
      };
    });
    expect(m.containerWidth).toBeGreaterThan(0);
    expect(m.containerWidth).toBeLessThanOrEqual(1152);
    if (m.colAligned !== null) expect(m.colAligned).toBe(true);
  });

  // T1.8 leftover closed 2026-06-11 — the feedback bubble sat ON the New Deal
  // CTA bar: MobileNewDeal published --kilo-cta-h but the desktop page's dead
  // commission bar (md:hidden AND behind the early mobile return) ran a
  // publisher whose disabled branch zeroed the var after the child set it.
  test('mobile New Deal — feedback bubble clears the CTA bar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile bottom stack');
    await page.goto('/dashboard/new-deal');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const bubble = document.querySelector('button[aria-label="Send feedback"]');
      const next = Array.from(document.querySelectorAll('button')).find((b) => /^Next/.test(b.textContent || ''));
      // Walk up to the position:fixed CTA BAR (not the inner flex row) — the
      // bar's padded/background area is what the bubble must clear (Codex).
      let bar: HTMLElement | null = next ? (next.parentElement as HTMLElement) : null;
      while (bar && getComputedStyle(bar).position !== 'fixed') bar = bar.parentElement;
      if (!bubble || !bar) return null;
      const b = bubble.getBoundingClientRect();
      const c = bar.getBoundingClientRect();
      return !(b.right < c.left || b.left > c.right || b.bottom < c.top || b.top > c.bottom);
    });
    expect(m, 'bubble or CTA bar not found').not.toBeNull();
    expect(m).toBe(false);
  });

  test('mobile You — View As drawer open stays on-screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface (/dashboard/you redirects on desktop)');
    // Reach the You page the way a mobile user does — tap the bottom-nav tab.
    // (Direct deep-linking to /dashboard/you bounces to /dashboard on a
    // hydration-timing race — that's the separate T1.2 bug; client-side nav
    // via the tab is the real user path and doesn't bounce.)
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('a[href="/dashboard/you"]').click();
    await page.waitForURL('**/dashboard/you');

    const trigger = page.getByRole('button', { name: /view as user/i });
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();
    await page.getByPlaceholder('Search users...').waitFor({ state: 'visible' });

    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    // Let the open animation + scrollIntoView settle onto a stable frame.
    await page.waitForTimeout(400);

    await expect(page).toHaveScreenshot('mobile-view-as-drawer.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});
