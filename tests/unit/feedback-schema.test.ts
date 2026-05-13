// Tests for the feedback request schema (Zod validation).

import { describe, it, expect } from 'vitest';
import { createFeedbackSchema } from '@/lib/schemas/feedback';

describe('createFeedbackSchema', () => {
  it('accepts a minimum-valid request', () => {
    const result = createFeedbackSchema.safeParse({ message: 'hi' });
    expect(result.success).toBe(true);
  });

  it('rejects empty/whitespace-only messages', () => {
    expect(createFeedbackSchema.safeParse({ message: '' }).success).toBe(false);
    expect(createFeedbackSchema.safeParse({ message: '   ' }).success).toBe(false);
  });

  it('rejects messages longer than 2000 chars', () => {
    expect(createFeedbackSchema.safeParse({ message: 'a'.repeat(2001) }).success).toBe(false);
  });

  it('accepts exactly 2000 chars', () => {
    expect(createFeedbackSchema.safeParse({ message: 'a'.repeat(2000) }).success).toBe(true);
  });

  it('trims message before length check', () => {
    const result = createFeedbackSchema.safeParse({ message: '   hello   ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toBe('hello');
  });

  it('accepts optional url and userAgent', () => {
    const result = createFeedbackSchema.safeParse({
      message: 'hi',
      url: '/dashboard/projects/123',
      userAgent: 'Chrome/120',
    });
    expect(result.success).toBe(true);
  });

  it('rejects url longer than 500 chars', () => {
    const result = createFeedbackSchema.safeParse({
      message: 'hi',
      url: '/dashboard/' + 'a'.repeat(500),
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra keys (strict mode)', () => {
    const result = createFeedbackSchema.safeParse({
      message: 'hi',
      // hidden attempt to attach more context
      m2Amount: 5000,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed base64 screenshot', () => {
    const result = createFeedbackSchema.safeParse({
      message: 'hi',
      // Tiny but valid base64 chunk
      screenshotBase64: '/9j/4AAQSkZJRgABAQEAAQABAAD/',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-base64 characters in screenshot', () => {
    const result = createFeedbackSchema.safeParse({
      message: 'hi',
      screenshotBase64: 'not!base64!@#',
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot payloads larger than 4MB', () => {
    const result = createFeedbackSchema.safeParse({
      message: 'hi',
      screenshotBase64: 'A'.repeat(4_000_001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts payloads with no screenshot field at all', () => {
    // The whole point of the field being optional — back-compat with
    // any client that doesn't ship the opt-in toggle.
    const result = createFeedbackSchema.safeParse({ message: 'hi' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.screenshotBase64).toBeUndefined();
  });
});
