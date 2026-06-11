import { Buffer } from 'node:buffer';

type DecodeResult =
  | { ok: true; buffer: Buffer; width: number; height: number }
  | { ok: false; reason: string };

const MIN_SCREENSHOT_BYTES = 1024;
const MIN_SCREENSHOT_DIMENSION = 100;

function isStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf)
  );
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;

    if (isStartOfFrameMarker(marker)) {
      const segmentStart = offset + 2;
      if (segmentStart + 5 > buffer.length) return null;
      const height = buffer.readUInt16BE(segmentStart + 1);
      const width = buffer.readUInt16BE(segmentStart + 3);
      return { width, height };
    }

    offset += segmentLength;
  }

  return null;
}

export function decodeFeedbackScreenshot(base64: string): DecodeResult {
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length < MIN_SCREENSHOT_BYTES) {
    return { ok: false, reason: 'too_small' };
  }

  const dimensions = readJpegDimensions(buffer);
  if (!dimensions) {
    return { ok: false, reason: 'not_jpeg' };
  }

  if (
    dimensions.width < MIN_SCREENSHOT_DIMENSION
    || dimensions.height < MIN_SCREENSHOT_DIMENSION
  ) {
    return { ok: false, reason: 'dimensions_too_small' };
  }

  return { ok: true, buffer, ...dimensions };
}
