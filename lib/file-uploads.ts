/**
 * Shared helpers for file-upload endpoints.
 *
 * Extracted from app/api/reimbursements/[id]/receipt/route.ts so future
 * upload paths (BVI utility bills, installer file uploads, etc.) reuse
 * the same validation + key-building + token-preflight logic.
 *
 * Vercel Blob is the storage backend for the whole app — both the
 * existing receipt path (public access mode) and the upcoming
 * ProjectFile path (private access + gated download proxy).
 */

import { NextResponse } from 'next/server';

/** 10 MB. Each use case can override via options. */
export const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Image + PDF — covers receipts, utility bills, permits, plans.
 * Heic/heif included because iPhone photos default to those.
 */
export const RECEIPT_ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
]);

/**
 * Utility-bill / installer-file uploads accept the same types as receipts.
 * Distinct constant so callers can tighten or relax per surface without
 * accidentally mutating the receipt set.
 */
export const INSTALLER_FILE_ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
]);

export interface FileValidationOptions {
  maxBytes?: number;
  allowedTypes?: ReadonlySet<string>;
}

export type FileValidationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Validate a Web `File` (from `formData`) against size + type rules.
 * Returns a discriminated result so the caller can shape its NextResponse
 * however it wants without coupling this lib to a specific response shape.
 */
export function validateUploadedFile(
  file: File,
  options?: FileValidationOptions,
): FileValidationResult {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const allowed = options?.allowedTypes ?? RECEIPT_ALLOWED_CONTENT_TYPES;

  if (file.size === 0) {
    return { ok: false, status: 400, error: 'Empty file' };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `File exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit`,
    };
  }
  if (!allowed.has(file.type)) {
    return {
      ok: false,
      status: 415,
      error: `Unsupported file type: ${file.type}. Allowed: images (jpeg/png/heic/webp) or PDF.`,
    };
  }
  return { ok: true };
}

/**
 * Sanitize a user-supplied filename for blob storage. Strips path
 * separators + non-printable + risky characters; truncates to 80 chars.
 * Preserves the extension when present.
 *
 * NOTE: this is for the storage key, NOT for display. The original
 * filename is preserved separately in the DB (e.g., ProjectFile.originalName)
 * so the user sees what they uploaded.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

/**
 * Build a deterministic Vercel Blob key. Format:
 *   <prefix>/<timestamp>-<sanitized-name>
 *
 * The timestamp ensures re-uploads create distinct URLs (cache-bust
 * matters for admin viewing of a replaced receipt).
 */
export function buildBlobKey(prefix: string, filename: string): string {
  return `${prefix}/${Date.now()}-${sanitizeFilename(filename)}`;
}

/**
 * Preflight: confirm BLOB_READ_WRITE_TOKEN is configured. Lets a route
 * return a clean 503 with a code instead of letting `put()` throw a
 * cryptic provider error. The rest of the route flow (DB writes, etc.)
 * usually still works — file storage is an isolated subsystem.
 */
export function assertBlobConfigured():
  | { ok: true }
  | { ok: false; response: NextResponse } {
  if (process.env.BLOB_READ_WRITE_TOKEN) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'File upload is not configured in this environment. The record was saved, but the file was not uploaded. Ask an admin to finish setting up blob storage.',
        code: 'BLOB_NOT_CONFIGURED',
      },
      { status: 503 },
    ),
  };
}
