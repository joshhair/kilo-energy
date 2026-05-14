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
  // Refs so the screenshot capture can exclude the widget itself (the
  // floating button + the open modal) from what it rasterizes. Without
  // this the screenshot would show the modal sitting over the page.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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
      // html-to-image clones the target element and renders it from the
      // clone's (0,0) anchor, ignoring window.scrollY. With a default
      // toJpeg(document.body) call the screenshot is always "the top of
      // the page", regardless of where the user is scrolled — confirmed
      // by real-user reports (Josh, 2026-05-14: "the screenshot was not
      // of what I was looking at, it was of the top of the page").
      //
      // Fix: constrain the output canvas to the current viewport
      // dimensions, then apply a CSS transform that slides the cloned
      // body up by the current scroll offset so the visible region
      // lands inside the canvas. This is the canonical html-to-image
      // viewport-capture pattern.
      const dataUrl = await htmlToImage.toJpeg(document.body, {
        quality: 0.7,
        pixelRatio: 1,
        cacheBust: true,
        width: window.innerWidth,
        height: window.innerHeight,
        style: {
          transform: `translate(-${window.scrollX}px, -${window.scrollY}px)`,
          transformOrigin: 'top left',
          // Preserve the body's natural width/height inside the transform
          // so the document layout doesn't reflow when the clone is
          // rendered offscreen — otherwise responsive breakpoints can
          // shift and the captured frame won't match what the user saw.
          width: `${document.documentElement.scrollWidth}px`,
          height: `${document.documentElement.scrollHeight}px`,
        },
        filter: (node) => {
          // Exclude the widget itself (button + modal) from the capture.
          // contains() returns false for the ref node itself only when the
          // ref is null; both checks are intentionally inclusive.
          if (buttonRef.current && buttonRef.current.contains(node)) return false;
          if (modalRef.current && modalRef.current.contains(node)) return false;
          return true;
        },
      });
      // Strip "data:image/jpeg;base64," to send only the base64 chunk.
      const comma = dataUrl.indexOf(',');
      return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
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
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed right-4 z-40 flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-sm font-semibold shadow-lg transition-all hover:scale-105 active:scale-95 bottom-20 md:bottom-6"
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

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) setOpen(false);
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-modal-title"
            className="w-full max-w-md rounded-2xl shadow-2xl"
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
