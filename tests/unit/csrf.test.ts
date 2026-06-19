import { describe, it, expect } from 'vitest';
import { assertSameOrigin, hasBearerToken, MUTATION_METHODS } from '@/lib/csrf';

const APP = 'https://app.kiloenergies.com';
const req = (method: string, path = '/api/x', headers: Record<string, string> = {}) =>
  new Request(`${APP}${path}`, { method, headers });

describe('hasBearerToken', () => {
  it('detects a non-empty bearer token (case-insensitive scheme)', () => {
    expect(hasBearerToken(req('POST', '/api/x', { authorization: 'Bearer abc.def.ghi' }))).toBe(true);
    expect(hasBearerToken(req('POST', '/api/x', { authorization: 'bearer xyz' }))).toBe(true);
  });
  it('is false without a usable token', () => {
    expect(hasBearerToken(req('POST'))).toBe(false);
    expect(hasBearerToken(req('POST', '/api/x', { authorization: '' }))).toBe(false);
    expect(hasBearerToken(req('POST', '/api/x', { authorization: 'Bearer ' }))).toBe(false);
    expect(hasBearerToken(req('POST', '/api/x', { authorization: 'Basic dXNlcjpwYXNz' }))).toBe(false);
  });
});

describe('assertSameOrigin — cookie/browser path (unchanged)', () => {
  it('allows non-mutating methods regardless of origin', () => {
    expect(assertSameOrigin(req('GET'))).toBeNull();
    expect(assertSameOrigin(req('HEAD'))).toBeNull();
  });
  it('allows a same-origin mutation via Origin', () => {
    expect(assertSameOrigin(req('POST', '/api/x', { origin: APP }))).toBeNull();
  });
  it('allows a same-origin mutation via Referer when Origin is absent', () => {
    expect(assertSameOrigin(req('POST', '/api/x', { referer: `${APP}/dashboard` }))).toBeNull();
  });
  it('blocks a cross-origin mutation', () => {
    expect(assertSameOrigin(req('POST', '/api/x', { origin: 'https://evil.example' }))?.status).toBe(403);
    expect(assertSameOrigin(req('POST', '/api/x', { referer: 'https://evil.example/p' }))?.status).toBe(403);
  });
  it('blocks a cookie mutation with neither Origin nor Referer', () => {
    expect(assertSameOrigin(req('POST'))?.status).toBe(403);
  });
  it('exempts signed webhook routes', () => {
    expect(assertSameOrigin(req('POST', '/api/webhooks/clerk'))).toBeNull();
  });
});

describe('assertSameOrigin — bearer-token path (the native-app fix)', () => {
  it('exempts a bearer mutation with NO Origin/Referer (native iOS app, cron jobs)', () => {
    expect(assertSameOrigin(req('POST', '/api/projects', { authorization: 'Bearer clerk.session.jwt' }))).toBeNull();
    expect(assertSameOrigin(req('PATCH', '/api/payroll', { authorization: 'Bearer clerk.session.jwt' }))).toBeNull();
    expect(assertSameOrigin(req('DELETE', '/api/x', { authorization: 'Bearer clerk.session.jwt' }))).toBeNull();
  });
  it('exemption holds even with a (non-forgeable) cross-origin header present', () => {
    // Safe by construction: a browser cannot attach an Authorization header to a
    // cross-site request without a CORS preflight we never grant, so this combo
    // can never originate from a CSRF attack.
    expect(assertSameOrigin(req('POST', '/api/x', { origin: 'https://evil.example', authorization: 'Bearer t' }))).toBeNull();
  });
  it('an empty/garbage Authorization header does NOT grant the bearer exemption', () => {
    // Falls back to the normal same-origin check → still blocked with no origin.
    expect(assertSameOrigin(req('POST', '/api/x', { authorization: 'Bearer ' }))?.status).toBe(403);
    expect(assertSameOrigin(req('POST', '/api/x', { authorization: 'Basic abc' }))?.status).toBe(403);
  });
});

describe('MUTATION_METHODS', () => {
  it('covers exactly the state-changing verbs', () => {
    expect([...MUTATION_METHODS].sort()).toEqual(['DELETE', 'PATCH', 'POST', 'PUT']);
  });
});
