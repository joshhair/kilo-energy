/**
 * Persistence helper — wraps fetch calls with error handling and optional
 * toast feedback via a custom DOM event.
 *
 * Context-level code (context.tsx) cannot call useToast() directly because it
 * isn't a component. Instead, failed persists dispatch a 'kilo-persist-error'
 * CustomEvent on `window`. The ToastProvider listens for this event and shows
 * an error toast automatically.
 *
 * Component-level code that already has `toast` can use `persistWithFeedback`
 * directly for richer control.
 */

/** Dispatch a persist-error event (picked up by ToastProvider) */
function emitPersistError(msg: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: msg }));
  }
}

/**
 * Fire-and-forget fetch wrapper that replaces bare `.catch(console.error)`.
 * Logs failures clearly and emits a UI error event.
 */
export function persistFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  errorMsg = 'Failed to save — please try again',
): Promise<Response> {
  return fetch(input, init).then((res) => {
    if (!res.ok) {
      console.error(`[persistFetch] HTTP ${res.status} — ${typeof input === 'string' ? input : '(request)'}`, init?.method ?? 'GET');
      emitPersistError(errorMsg);
    }
    return res;
  }).catch((err) => {
    console.error('[persistFetch] Network error:', err);
    emitPersistError(errorMsg);
    throw err; // re-throw so callers chaining .then() don't proceed
  });
}

/**
 * Await-friendly wrapper with boolean return. Use in components that have
 * direct access to a toast function.
 */
export async function persistWithFeedback(
  promise: Promise<Response>,
  toast: (msg: string, type?: string) => void,
  errorMsg = 'Failed to save — please try again',
): Promise<boolean> {
  try {
    const res = await promise;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error(e);
    toast(errorMsg, 'error');
    return false;
  }
}
