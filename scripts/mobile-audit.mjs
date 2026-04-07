/**
 * Mobile Audit Script
 * Screenshots every mobile page at iPhone 14 Pro viewport.
 * Run: node scripts/mobile-audit.mjs
 * Requires dev server running on localhost:3000
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const VIEWPORT = { width: 393, height: 852 };
const OUTPUT_DIR = 'mobile-audit-screenshots';

const PAGES = [
  { path: '/sign-in', name: 'sign-in' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/dashboard/projects', name: 'projects' },
  { path: '/dashboard/new-deal', name: 'new-deal' },
  { path: '/dashboard/my-pay', name: 'my-pay' },
  { path: '/dashboard/payroll', name: 'payroll' },
  { path: '/dashboard/users', name: 'users' },
  { path: '/dashboard/blitz', name: 'blitz' },
  { path: '/dashboard/calculator', name: 'calculator' },
  { path: '/dashboard/incentives', name: 'incentives' },
  { path: '/dashboard/training', name: 'training' },
  { path: '/dashboard/earnings', name: 'earnings' },
  { path: '/dashboard/settings', name: 'settings' },
];

async function audit() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  // All pages will redirect to sign-in without auth, so just screenshot that
  // and note which pages load vs error
  const context = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const page = await context.newPage();
  const results = [];

  for (const p of PAGES) {
    try {
      const response = await page.goto(`http://localhost:3000${p.path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1500); // let content render

      const status = response?.status() ?? 0;
      const url = page.url();
      const title = await page.title();

      // Check for errors in console
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const hasOverflow = scrollWidth > clientWidth + 1;

      // Screenshot
      await page.screenshot({ path: path.join(OUTPUT_DIR, `${p.name}.png`), fullPage: true });

      // Count interactive elements below 44px
      const smallTargets = await page.evaluate(() => {
        const elements = document.querySelectorAll('button, a, [role="button"], input, select, textarea');
        let count = 0;
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0 && rect.height < 40 && rect.width > 0) count++;
        });
        return count;
      });

      results.push({
        page: p.name,
        path: p.path,
        status,
        redirectedTo: url.includes(p.path) ? null : url,
        title,
        hasOverflow,
        smallTargets,
        screenshot: `${p.name}.png`,
      });

      console.log(`✓ ${p.name} — ${status} ${hasOverflow ? '⚠ OVERFLOW' : ''} ${smallTargets > 0 ? `⚠ ${smallTargets} small targets` : ''}`);
    } catch (e) {
      console.log(`✗ ${p.name} — ERROR: ${e.message}`);
      results.push({ page: p.name, path: p.path, status: 0, error: e.message });
    }
  }

  await browser.close();

  // Write report
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`\nReport saved to ${OUTPUT_DIR}/report.json`);
  console.log(`Screenshots saved to ${OUTPUT_DIR}/`);
}

audit();
