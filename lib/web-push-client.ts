'use client';

/**
 * Web Push client helper — registers the service worker, asks for
 * notification permission, creates a PushSubscription, and tells the
 * server about it. Phase 4.
 *
 * Public key comes from NEXT_PUBLIC_VAPID_PUBLIC_KEY at build time (it's
 * safe to ship — VAPID public keys are derivable from the wire-format
 * notification anyway).
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function getOrRegisterSW(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

export async function enableWebPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isWebPushSupported()) return { ok: false, reason: 'Push not supported in this browser.' };
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return { ok: false, reason: 'VAPID public key not configured.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Notification permission denied.' };

  const reg = await getOrRegisterSW();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'Subscription missing required fields.' };
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 500),
    }),
  });
  if (!res.ok) return { ok: false, reason: `Subscribe API failed (${res.status})` };
  return { ok: true };
}

export async function disableWebPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isWebPushSupported()) return { ok: false, reason: 'Push not supported.' };
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) return { ok: true };
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* ignore — server-side delete is what matters */ }
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  return { ok: true };
}

export async function isPushEnabled(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return sub != null;
}
