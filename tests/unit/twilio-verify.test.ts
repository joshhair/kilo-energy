// Twilio Verify wrapper unit tests.
//
// The Phase D unblock plan is: code ships fully wired, env stays unset
// until A2P 10DLC clears, then flip SMS_ENABLED + the Verify service
// SID and SMS goes live. These tests pin the NOT_CONFIGURED contract
// (returns ok:false with a parseable reason — routes translate that
// into a 503) plus the happy + reject paths against a mocked Twilio
// client.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startPhoneVerification,
  confirmPhoneVerification,
  isVerifyReady,
  __setVerifyClientForTests,
} from '@/lib/notifications/twilio-verify';

const ORIGINAL_ENV = { ...process.env };
function restoreEnv() { process.env = { ...ORIGINAL_ENV }; }

function makeMockClient(opts: {
  verifyStatus?: string;
  checkStatus?: string;
  throwOnVerify?: Error;
  throwOnCheck?: Error;
}) {
  return {
    verify: {
      v2: {
        services: (_sid: string) => ({
          verifications: {
            create: async () => {
              if (opts.throwOnVerify) throw opts.throwOnVerify;
              return { sid: 'VEabc', status: opts.verifyStatus ?? 'pending' };
            },
          },
          verificationChecks: {
            create: async () => {
              if (opts.throwOnCheck) throw opts.throwOnCheck;
              return { status: opts.checkStatus ?? 'approved' };
            },
          },
        }),
      },
    },
  };
}

describe('twilio-verify', () => {
  beforeEach(() => { restoreEnv(); __setVerifyClientForTests(null); });
  afterEach(() => { restoreEnv(); __setVerifyClientForTests(null); });

  describe('isVerifyReady', () => {
    it('false when SMS_ENABLED is unset', () => {
      delete process.env.SMS_ENABLED;
      expect(isVerifyReady().ready).toBe(false);
    });

    it('false when Verify service SID missing', () => {
      process.env.SMS_ENABLED = 'true';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      delete process.env.TWILIO_VERIFY_SERVICE_SID;
      const r = isVerifyReady();
      expect(r.ready).toBe(false);
      if (!r.ready) expect(r.reason).toMatch(/VERIFY_SERVICE_SID/);
    });

    it('true when fully configured', () => {
      process.env.SMS_ENABLED = 'true';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';
      expect(isVerifyReady().ready).toBe(true);
    });
  });

  describe('startPhoneVerification', () => {
    it('returns NOT_CONFIGURED reason when env not ready', async () => {
      delete process.env.SMS_ENABLED;
      const r = await startPhoneVerification('+14155551234');
      expect(r.ok).toBe(false);
      expect(r.errorReason).toMatch(/NOT_CONFIGURED/);
    });

    it('returns ok:true on Twilio success', async () => {
      process.env.SMS_ENABLED = 'true';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';
      __setVerifyClientForTests(makeMockClient({ verifyStatus: 'pending' }));
      const r = await startPhoneVerification('+14155551234');
      expect(r.ok).toBe(true);
      expect(r.status).toBe('pending');
    });

    it('returns errorReason when Twilio throws', async () => {
      process.env.SMS_ENABLED = 'true';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';
      __setVerifyClientForTests(
        makeMockClient({ throwOnVerify: Object.assign(new Error('rate limited'), { code: 60203 }) }),
      );
      const r = await startPhoneVerification('+14155551234');
      expect(r.ok).toBe(false);
      expect(r.errorReason).toMatch(/TWILIO_60203/);
    });
  });

  describe('confirmPhoneVerification', () => {
    it('returns approved:true when Twilio status === approved', async () => {
      process.env.SMS_ENABLED = 'true';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';
      __setVerifyClientForTests(makeMockClient({ checkStatus: 'approved' }));
      const r = await confirmPhoneVerification('+14155551234', '123456');
      expect(r.ok).toBe(true);
      expect(r.approved).toBe(true);
    });

    it('returns approved:false when Twilio status === pending (wrong code)', async () => {
      process.env.SMS_ENABLED = 'true';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';
      __setVerifyClientForTests(makeMockClient({ checkStatus: 'pending' }));
      const r = await confirmPhoneVerification('+14155551234', '000000');
      expect(r.ok).toBe(true);
      expect(r.approved).toBe(false);
      expect(r.status).toBe('pending');
    });
  });
});
