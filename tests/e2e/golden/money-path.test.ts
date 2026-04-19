// Money-path — cent-exactness across edit and the reimbursement
// lifecycle. Complements deal-lifecycle.test.ts (which covers the
// create → advance → pay flow) by exercising two code paths not yet
// E2E'd:
//
//   1. PATCH /api/projects/[id] with new commission amounts — does the
//      serializer round-trip the new cents correctly?
//   2. Reimbursement submit → approve → paid — three PATCHes in a row
//      against an integer-cents column, with rep-visibility at each step.
//
// Uses only HTTP (no Prisma) so Playwright's loader stays simple and
// the tests exercise the real Zod + RBAC + serialize seams.

import { test, expect, request as pwRequest } from '@playwright/test';
import {
  e2eCustomerName,
  purgeE2eProjects,
  getE2eUsers,
  pickReferenceData,
} from '../helpers/fixtures';

test.describe.configure({ mode: 'serial' });

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

test.afterAll(async () => {
  const admin = await pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { origin: BASE_URL },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  await purgeE2eProjects(admin);
  const data = await (await admin.get('/api/data')).json();
  const mine = (data.reimbursements ?? []).filter((r: { description: string; id: string }) =>
    r.description.startsWith('E2E:'),
  );
  for (const r of mine) {
    await admin.delete(`/api/reimbursements/${r.id}`);
  }
  await admin.dispose();
});

test('admin edits commission amounts — cents round-trip exact', async () => {
  const adminCtx = await pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { origin: BASE_URL },
    storageState: 'tests/e2e/.auth/admin.json',
  });

  let rep: Awaited<ReturnType<typeof getE2eUsers>>['rep'];
  let installerId: string;
  let financerId: string;
  try {
    ({ rep } = await getE2eUsers(adminCtx));
    ({ installerId, financerId } = await pickReferenceData(adminCtx));
  } catch (err) {
    await adminCtx.dispose();
    test.skip(true, `E2E setup incomplete — ${(err as Error).message}`);
    return;
  }

  const customerName = e2eCustomerName('edit-cents');

  // Initial create — amounts chosen to end in odd cents so we can see
  // any truncation bugs ($1234.56 vs $1234.5).
  const create = await adminCtx.post('/api/projects', {
    data: {
      customerName,
      closerId: rep.id,
      setterId: null,
      soldDate: '2026-04-16',
      installerId,
      financerId,
      productType: 'Loan',
      kWSize: 9.2,
      netPPW: 3.75,
      phase: 'New',
      m1Amount: 1234.56,
      m2Amount: 1234.57,
      m3Amount: 617.28,
      setterM1Amount: 0,
      setterM2Amount: 0,
      setterM3Amount: 0,
    },
  });
  expect(create.status()).toBe(201);
  const project = await create.json();
  expect(project.m1Amount).toBe(1234.56);

  // Edit with new cent-odd amounts. This is the bug surface we care
  // about — fromDollars(1999.99).cents === 199999 must round-trip.
  const edit = await adminCtx.patch(`/api/projects/${project.id}`, {
    data: {
      m1Amount: 1999.99,
      m2Amount: 2000.01,
      m3Amount: 888.23,
    },
  });
  expect(edit.status()).toBe(200);
  const edited = await edit.json();
  expect(edited.m1Amount).toBe(1999.99);
  expect(edited.m2Amount).toBe(2000.01);
  expect(edited.m3Amount).toBe(888.23);

  // Confirm persistence by re-fetching.
  const reread = await adminCtx.get(`/api/projects/${project.id}`);
  expect(reread.status()).toBe(200);
  const readBack = await reread.json();
  expect(readBack.m1Amount).toBe(1999.99);
  expect(readBack.m2Amount).toBe(2000.01);
  expect(readBack.m3Amount).toBe(888.23);

  await adminCtx.dispose();
});

test('reimbursement lifecycle — submit, approve, mark paid', async () => {
  const adminCtx = await pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { origin: BASE_URL },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  const repCtx = await pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { origin: BASE_URL },
    storageState: 'tests/e2e/.auth/rep.json',
  });

  let rep: Awaited<ReturnType<typeof getE2eUsers>>['rep'];
  try {
    ({ rep } = await getE2eUsers(adminCtx));
  } catch (err) {
    await adminCtx.dispose();
    await repCtx.dispose();
    test.skip(true, `E2E setup incomplete — ${(err as Error).message}`);
    return;
  }

  // Rep submits their own reimbursement. Odd-cents amount on purpose.
  const description = `E2E: gas for site visit ${Date.now()}`;
  const submit = await repCtx.post('/api/reimbursements', {
    data: {
      repId: rep.id,
      amount: 42.37,
      description,
      date: '2026-04-16',
    },
  });
  expect(submit.status()).toBe(201);
  const created = await submit.json();
  expect(created.amount).toBe(42.37);
  expect(created.status).toBe('Pending');

  // Rep cannot approve their own reimbursement.
  const repApproveAttempt = await repCtx.patch(`/api/reimbursements/${created.id}`, {
    data: { status: 'Approved' },
  });
  expect(repApproveAttempt.status()).toBe(403);

  // Admin approves.
  const approve = await adminCtx.patch(`/api/reimbursements/${created.id}`, {
    data: { status: 'Approved' },
  });
  expect(approve.status()).toBe(200);
  const approved = await approve.json();
  expect(approved.status).toBe('Approved');
  expect(approved.amount).toBe(42.37); // cents preserved through status change

  // Admin marks Paid.
  const pay = await adminCtx.patch(`/api/reimbursements/${created.id}`, {
    data: { status: 'Paid' },
  });
  expect(pay.status()).toBe(200);
  const paid = await pay.json();
  expect(paid.status).toBe('Paid');
  expect(paid.amount).toBe(42.37);

  // Rep sees the paid record in /api/data.
  const repData = await (await repCtx.get('/api/data')).json();
  const mine = (repData.reimbursements ?? []).find(
    (r: { id: string }) => r.id === created.id,
  );
  expect(mine).toBeTruthy();
  expect(mine.status).toBe('Paid');
  expect(mine.amount).toBe(42.37);

  await adminCtx.dispose();
  await repCtx.dispose();
});
