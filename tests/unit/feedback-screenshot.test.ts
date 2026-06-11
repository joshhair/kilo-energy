import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeFeedbackScreenshot } from '@/lib/feedback-screenshot';

function structurallyValidJpegBase64(width: number, height: number): string {
  const app0 = Buffer.from([
    0xff, 0xe0,
    0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  ]);
  const sof0 = Buffer.from([
    0xff, 0xc0,
    0x00, 0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof0,
    Buffer.alloc(1200, 0),
    Buffer.from([0xff, 0xd9]),
  ]).toString('base64');
}

describe('decodeFeedbackScreenshot', () => {
  it('accepts a JPEG-shaped viewport screenshot payload', () => {
    const result = decodeFeedbackScreenshot(structurallyValidJpegBase64(390, 844));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.width).toBe(390);
      expect(result.height).toBe(844);
      expect(result.buffer.length).toBeGreaterThan(1024);
    }
  });

  it('rejects tiny placeholder payloads', () => {
    const result = decodeFeedbackScreenshot('/9j/4AAQSkZJRgABAQEAAQABAAD/');

    expect(result).toEqual({ ok: false, reason: 'too_small' });
  });

  it('rejects non-JPEG bytes even when the payload is large enough', () => {
    const result = decodeFeedbackScreenshot(Buffer.alloc(1500, 0).toString('base64'));

    expect(result).toEqual({ ok: false, reason: 'not_jpeg' });
  });

  it('rejects screenshots with unusably small dimensions', () => {
    const result = decodeFeedbackScreenshot(structurallyValidJpegBase64(1, 1));

    expect(result).toEqual({ ok: false, reason: 'dimensions_too_small' });
  });
});
