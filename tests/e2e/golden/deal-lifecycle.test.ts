// Deal lifecycle — the canonical happy path through the app.
//
// Rep creates a Loan deal → API returns it with commission amounts from
// the cents-schema math → admin advances phase → payroll entry created →
// admin marks it Paid → rep sees the paid amount.
//
// Exercises: /api/projects POST, /api/projects/[id] PATCH (phase change),
// /api/payroll POST + bulk PATCH, and the cents → dollars boundary in
// lib/serialize on every response. Uses only HTTP — no Prisma import —
// which keeps the suite loader-friendly and closer to real-user behavior.

import { test, expect, request as pwRequest } from '@playwright/test';
import {
  e2eCustomerName,
  purgeE2eProjects,
  getE2eUsers,
  pickReferenceData,
} from '../helpers/fixtures';

test.describe.configure({ mode: 'serial' });

let createdProjectId: string | null = null;

test.afterAll(async () => {
  const admin = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  await purgeE2eProjects(admin);
  await admin.dispose();
});

test('rep creates a loan deal — commission persists cent-exact', async ({
  request,
}) => {
  // Admin request context for ID lookups (reps can only see limited data).
  const adminCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  const { rep } = await getE2eUsers(adminCtx);
  const { installerId, financerId } = await pickReferenceData(adminCtx);
  await adminCtx.dispose();

  const customerName = e2eCustomerName('loan');

  // Dollar amounts chosen so the round-trip exercises odd cents.
  const response = await request.post('/api/projects', {
    data: {
      customerName,
      closerId: rep.id,
      setterId: null,
      soldDate: '2026-04-16',
      installerId,
      financerId,
      productType: 'Loan',
      kWSize: 8.4,
      netPPW: 3.55,
      phase: 'New',
      m1Amount: 1890.01,
      m2Amount: 1890.02,
      m3Amount: 472.51,
      setterM1Amount: 0,
      setterM2Amount: 0,
      setterM3Amount: 0,
    },
  });

  expect(response.status()).toBe(201);
  const project = await response.json();
  expect(project.customerName).toBe(customerName);
  // Cent-exact round-trip: 1890.01 dollars → 189001 cents → 1890.01 dollars.
  expect(project.m1Amount).toBe(1890.01);
  expect(project.m2Amount).toBe(1890.02);
  expect(project.m3Amount).toBe(472.51);

  createdProjectId = project.id;
});

test('admin advances the deal, creates payroll, marks it Paid', async () => {
  expect(createdProjectId).not.toBeNull();

  const adminCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/admin.json',
  });

  // Phase transition via PATCH. Server authoritatively applies it.
  const patchRes = await adminCtx.patch(`/api/projects/${createdProjectId}`, {
    data: { phase: 'Installed', m1Paid: true, m2Paid: true },
  });
  expect(patchRes.status()).toBe(200);
  const patched = await patchRes.json();
  expect(patched.phase).toBe('Installed');

  // Create a payroll entry as if drafted at phase transition.
  const { rep } = await getE2eUsers(adminCtx);
  const payrollRes = await adminCtx.post('/api/payroll', {
    data: {
      repId: rep.id,
      projectId: createdProjectId,
      amount: 1890.01,
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-16',
      notes: 'E2E lifecycle',
    },
  });
  expect(payrollRes.status()).toBe(201);
  const entry = await payrollRes.json();
  expect(entry.amount).toBe(1890.01);

  // Bulk transition Draft → Pending → Paid.
  const toPending = await adminCtx.patch('/api/payroll', {
    data: { ids: [entry.id], status: 'Pending' },
  });
  expect(toPending.status()).toBe(200);

  const toPaid = await adminCtx.patch('/api/payroll', {
    data: { ids: [entry.id], status: 'Paid' },
  });
  expect(toPaid.status()).toBe(200);

  await adminCtx.dispose();

  // The rep (current test's storage state) should now see the paid entry.
  const repCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/rep.json',
  });
  const repDataRes = await repCtx.get('/api/data');
  expect(repDataRes.status()).toBe(200);
  const repPayload = await repDataRes.json();
  const paid = repPayload.payrollEntries.find(
    (p: { id: string; status: string }) => p.id === entry.id && p.status === 'Paid',
  );
  expect(paid).toBeTruthy();
  expect(paid.amount).toBe(1890.01);
  await repCtx.dispose();
});
