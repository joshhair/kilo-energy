// SMS channel adapter unit tests.
//
// Verifies env-flag gating, missing-creds gating, the happy path through
// a mocked Twilio client, and the two failure shapes (Twilio returned
// errorCode vs SDK threw). The dispatcher relies on `ok` + `status` +
// `errorReason` being shaped consistently in all four cases — these
// tests pin that contract.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sendSmsChannel, __setTwilioClientForTests } from '@/lib/notifications/channels/sms';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe('sendSmsChannel', () => {
  beforeEach(() => {
    restoreEnv();
    __setTwilioClientForTests(null);
  });
  afterEach(() => {
    restoreEnv();
    __setTwilioClientForTests(null);
  });

  it('returns NOT_CONFIGURED when SMS_ENABLED !== "true"', async () => {
    delete process.env.SMS_ENABLED;
    const r = await sendSmsChannel({ to: '+15555550100', body: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.errorReason).toMatch(/NOT_CONFIGURED.*SMS_ENABLED/);
  });

  it('returns NOT_CONFIGURED when SMS_ENABLED=true but creds missing', async () => {
    process.env.SMS_ENABLED = 'true';
    delete process.env.TWILIO_ACCOUNT_SID;
    const r = await sendSmsChannel({ to: '+15555550100', body: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.errorReason).toMatch(/missing TWILIO_/);
  });

  it('happy path: returns ok with providerMessageId on Twilio success', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM = '+15555550000';
    __setTwilioClientForTests({
      messages: {
        create: async ({ to, body }) => {
          expect(to).toBe('+15555550100');
          expect(body).toBe('hi');
          return { sid: 'SMabc123', status: 'queued' };
        },
      },
    });
    const r = await sendSmsChannel({ to: '+15555550100', body: 'hi' });
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toBe('SMabc123');
    expect(r.status).toBe('sent');
  });

  it('maps Twilio errorCode response to failed with code in reason', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM = '+15555550000';
    __setTwilioClientForTests({
      messages: {
        create: async () => ({
          sid: 'SMfail',
          status: 'failed',
          errorCode: 30003,
          errorMessage: 'Unreachable destination handset',
        }),
      },
    });
    const r = await sendSmsChannel({ to: '+15555550100', body: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.providerMessageId).toBe('SMfail');
    expect(r.errorReason).toMatch(/TWILIO_30003/);
  });

  it('maps thrown SDK error to failed with code in reason', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM = '+15555550000';
    __setTwilioClientForTests({
      messages: {
        create: async () => {
          const e = Object.assign(new Error('auth failed'), { code: 20003 });
          throw e;
        },
      },
    });
    const r = await sendSmsChannel({ to: '+15555550100', body: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.errorReason).toMatch(/TWILIO_20003.*auth failed/);
  });
});
