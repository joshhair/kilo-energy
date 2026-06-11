'use client';

/**
 * Floating "Send feedback" button.
 *
 * Mounted in the dashboard layout — visible on every authenticated
 * /dashboard/** page, desktop + mobile. Click opens a modal with a
 * textarea; submit POSTs to /api/feedback which emails Josh + persists
 * the row.
 *
 * Privacy: the modal makes the destination explicit ("Sent to Kilo
 * support"). The user is consenting to share their message with admin.
 * We do NOT capture other server-side context (project IDs, customer
 * data) — only what they type plus the current URL/role/userAgent which
 * the API layer attaches.
 *
 * Z-index: button is z-40 (above scroll-to-top z-30, below modals z-50).
 * The widget's own modal is z-[60] so it sits above any background
 * dialog that happens to be open underneath.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageCirclePlus, X, Loader2, Send, CheckCircle2, Camera } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useToast } from '@/lib/toast';

const MAX_LENGTH = 2000;
type HtmlToImageModule = typeof import('html-to-image');

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function getCaptureBackground(target: HTMLElement): string {
  const transparent = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)']);
  const candidates = [
    getComputedStyle(target).backgroundColor,
    getComputedStyle(document.body).backgroundColor,
    getComputedStyle(document.documentElement).backgroundColor,
  ];
  return candidates.find((color) => !transparent.has(color)) ?? '#0f172a';
}

function canvasLooksBlank(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return true;

  let data: Uint8ClampedArray;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // If the canvas is tainted by a cross-origin asset, keep the screenshot
    // rather than incorrectly throwing away useful evidence.
    return false;
  }

  const stride = Math.max(4, Math.floor(Math.sqrt((canvas.width * canvas.height) / 4096)));
  let sampled = 0;
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;

  for (let y = 0; y < canvas.height; y += stride) {
    for (let x = 0; x < canvas.width; x += stride) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] < 12) continue;
      sampled += 1;
      minR = Math.min(minR, data[i]);
      minG = Math.min(minG, data[i + 1]);
      minB = Math.min(minB, data[i + 2]);
      maxR = Math.max(maxR, data[i]);
      maxG = Math.max(maxG, data[i + 1]);
      maxB = Math.max(maxB, data[i + 2]);
    }
  }

  if (sampled < 16) return true;
  return maxR - minR < 6 && maxG - minG < 6 && maxB - minB < 6;
}

async function captureVisibleElement(
  htmlToImage: HtmlToImageModule,
  target: HTMLElement,
): Promise<string | undefined> {
  const rect = target.getBoundingClientRect();
  const viewportWidth = Math.max(1, Math.round(target.clientWidth || rect.width || window.innerWidth));
  const viewportHeight = Math.max(1, Math.round(target.clientHeight || rect.height || window.innerHeight));
  const scrollTop = target === document.body || target === document.documentElement ? window.scrollY : target.scrollTop;
  const scrollLeft = target === document.body || target === document.documentElement ? window.scrollX : target.scrollLeft;
  const contentWidth = Math.max(viewportWidth, Math.round(target.scrollWidth || viewportWidth));
  const contentHeight = Math.max(viewportHeight, Math.round(target.scrollHeight || viewportHeight));
  const backgroundColor = getCaptureBackground(target);

  const canvas = await htmlToImage.toCanvas(target, {
    pixelRatio: 1,
    cacheBust: true,
    width: viewportWidth,
    height: viewportHeight,
    canvasWidth: viewportWidth,
    canvasHeight: viewportHeight,
    backgroundColor,
    style: {
      transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
      transformOrigin: 'top left',
      width: `${contentWidth}px`,
      height: `${contentHeight}px`,
      maxHeight: 'none',
      overflow: 'visible',
    },
    filter: (node) => !(node instanceof HTMLElement && node.closest('[data-feedback-exclude="true"]')),
  });
  if (canvasLooksBlank(canvas)) return undefined;
  return canvas.toDataURL('image/jpeg', 0.7);
}

export function FeedbackButton() {
  const pathname = usePathname();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Screenshot toggle defaults ON — most feedback is layout/UX where a
  // picture is 10× easier to triage than a typed description. User can
  // uncheck before sending if they're on a sensitive screen.
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Only render on /dashboard/** routes. Defensive — layout mount path
  // should already guarantee this, but a stray render elsewhere would be
  // unhelpful (the auth gate is at the API).
  const isDashboard = pathname?.startsWith('/dashboard') ?? false;

  useEffect(() => {
    if (!open) return;
    // Focus the textarea on open for keyboard-first flow.
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    // Escape closes the modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, submitting]);

  if (!isDashboard) return null;

  const charCount = message.length;
  const charsLeft = MAX_LENGTH - charCount;
  const canSubmit = message.trim().length > 0 && charCount <= MAX_LENGTH && !submitting;

  // Capture the current page as a JPEG, base64-encoded (no data: prefix).
  // Returns undefined if capture fails — the submission still proceeds
  // without a screenshot rather than blocking the user's feedback.
  //
  // html-to-image is dynamically imported so it only loads when the user
  // actually submits with the toggle on. Keeps the dashboard route's
  // first-load bundle clean (~15KB saved on cold loads).
  const captureScreenshot = async (): Promise<string | undefined> => {
    try {
      const htmlToImage = await import('html-to-image');
      const mainEl = document.getElementById('main-content') as HTMLElement | null;
      const dataUrl =
        (mainEl ? await captureVisibleElement(htmlToImage, mainEl) : undefined)
        ?? await captureVisibleElement(htmlToImage, document.body);

      if (!dataUrl) {
        console.warn('Feedback screenshot capture produced a blank image.');
        return undefined;
      }
      // Strip "data:image/jpeg;base64," to send only the base64 chunk.
      return stripDataUrlPrefix(dataUrl);
    } catch (err) {
      console.warn('Feedback screenshot capture failed:', err);
      return undefined;
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const screenshotBase64 = includeScreenshot ? await captureScreenshot() : undefined;
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          url: pathname ?? undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          screenshotBase64,
        }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          toast('Too many submissions. Please wait a minute and try again.', 'error');
        } else if (res.status === 401) {
          toast('Your session expired. Please refresh and try again.', 'error');
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.error || `Submission failed (${res.status})`, 'error');
        }
        return;
      }
      toast('Feedback sent — thanks!', 'success');
      setMessage('');
      setOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating button. Bottom-right; on mobile, lifted above the
          bottom nav (~80px from bottom) so it doesn't sit on top of nav
          icons. Desktop has no bottom nav, so a smaller offset works. */}
      <button
        type="button"
        data-feedback-exclude="true"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        // Always tappable on every screen (it captures the active screen),
        // so it must never sit ON TOP of an action. It stacks above the bottom
        // nav AND any sticky CTA bar via the heights they publish (T1.3):
        // bottom = nav height + CTA height + gap. Desktop (no bottom nav) keeps
        // the fixed md offset. Fallback 5rem ≈ nav height before the var sets.
        className="fixed right-4 z-40 flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-sm font-semibold shadow-lg transition-all hover:scale-105 active:scale-95 bottom-[calc(var(--kilo-bottom-nav-h,5rem)+var(--kilo-cta-h,0px)+0.75rem)] md:bottom-6"
        style={{
          background: 'color-mix(in srgb, var(--accent-emerald-solid) 18%, var(--surface-card))',
          color: 'var(--accent-emerald-text)',
          border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        }}
      >
        <MessageCirclePlus className="w-4 h-4" />
        <span className="hidden sm:inline">Send feedback</span>
      </button>

      {/* Modal — anchored to the BOTTOM on mobile and the CENTER on desktop.
          On iOS Safari, items-center collides with the keyboard: when the
          textarea is focused, Safari shrinks the visible viewport and slides
          the modal up so the top gets clipped (Josh hit this 2026-05-22).
          items-end on mobile pins the modal to the bottom edge — the keyboard
          appears underneath, the modal stays fully visible. Desktop keeps
          the original centered behavior. max-h uses dvh which accounts for
          the dynamic visible viewport (no growing past keyboard). */}
      {open && (
        <div
          data-feedback-exclude="true"
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-modal-title"
            className="w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[calc(100dvh-env(safe-area-inset-top))] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:pb-0"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h2
                id="feedback-modal-title"
                className="text-base font-semibold"
                style={{ color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}
              >
                Send feedback
              </h2>
              <button
                type="button"
                onClick={() => !submitting && setOpen(false)}
                disabled={submitting}
                aria-label="Close"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Share bugs, ideas, or feedback.
              </p>

              <div>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
                  placeholder="What's on your mind?"
                  rows={6}
                  disabled={submitting}
                  maxLength={MAX_LENGTH}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 resize-y"
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
                    <CheckCircle2 className="w-3 h-3" /> Sent to admin only
                  </span>
                  <span
                    className="text-[11px] tabular-nums"
                    style={{
                      color: charsLeft < 100
                        ? charsLeft < 0
                          ? 'var(--accent-red-text)'
                          : 'var(--accent-amber-text)'
                        : 'var(--text-dim)',
                    }}
                  >
                    {charCount} / {MAX_LENGTH}
                  </span>
                </div>
              </div>

              {/* Screenshot opt-in. Default on — most reports are layout
                  or UX issues where a picture is dramatically easier to
                  act on than typed words. The user can uncheck before
                  sending if they're on a sensitive screen. */}
              <label
                className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg px-2.5 py-2 -mx-2.5 transition-colors hover:bg-[var(--surface-card)]/60"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={includeScreenshot}
                  onChange={(e) => setIncludeScreenshot(e.target.checked)}
                  disabled={submitting}
                  className="mt-0.5 w-4 h-4 rounded accent-[var(--accent-emerald-solid)] cursor-pointer"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5" /> Include screenshot of this page
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    Helps admin see what you&apos;re seeing. Shared with admin only.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--accent-emerald-solid)',
                  color: 'var(--text-on-accent)',
                  border: '1px solid var(--accent-emerald-solid)',
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
