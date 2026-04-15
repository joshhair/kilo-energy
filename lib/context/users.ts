/**
 * User management actions — extracted from context.tsx for file organization.
 * These factory functions return action handlers that operate on React state
 * setters passed in from the AppProvider.
 */

import type { Rep, SubDealer } from '../data';
import { persistFetch } from '../persist';

interface UserDeps {
  getReps: () => Rep[];
  setReps: React.Dispatch<React.SetStateAction<Rep[]>>;
  setSubDealers: React.Dispatch<React.SetStateAction<SubDealer[]>>;
  getSubDealers: () => SubDealer[];
}

export function createUserActions(deps: UserDeps) {
  const { getReps, setReps, setSubDealers, getSubDealers } = deps;

  // ── Rep management ──

  const addRep = (firstName: string, lastName: string, email: string, phone: string, repType: 'closer' | 'setter' | 'both' = 'both', id?: string, role: 'rep' | 'admin' | 'sub-dealer' = 'rep') => {
    const tempId = id ?? `rep_${Date.now()}`;
    setReps((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), phone: phone.trim(), role: role as Rep['role'], repType, active: true, hasClerkAccount: false }]);
    if (id) {
      return Promise.resolve({ id } as { id: string });
    }
    return persistFetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, repType, role }),
    }, 'Failed to save new rep').then((res) => res.json()).then((rep) => {
      if (rep.id && rep.id !== tempId) {
        setReps((prev) => prev.map((r) => r.id === tempId ? { ...r, id: rep.id } : r));
      }
      return rep as { id: string };
    }).catch(() => {
      setReps((prev) => prev.filter((r) => r.id !== tempId));
      return undefined;
    });
  };

  const deactivateRep = async (id: string): Promise<void> => {
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: false } : r));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }, 'Failed to deactivate rep');
    } catch (err) {
      setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: true } : r));
      throw err;
    }
  };

  const reactivateRep = async (id: string): Promise<void> => {
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: true } : r));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      }, 'Failed to reactivate rep');
    } catch (err) {
      setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: false } : r));
      throw err;
    }
  };

  const deleteRepPermanently = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const reps = getReps();
    const snapshotIndex = reps.findIndex((r) => r.id === id);
    const snapshot = reps[snapshotIndex];
    const nextRepId = reps[snapshotIndex + 1]?.id ?? null;
    setReps((prev) => prev.filter((r) => r.id !== id));
    try {
      await persistFetch(`/api/users/${id}`, { method: 'DELETE' }, 'Failed to delete rep');
      return { success: true };
    } catch (err: unknown) {
      if (snapshot) setReps((prev) => {
        const next = [...prev];
        const insertAt = nextRepId === null ? next.length : next.findIndex((r) => r.id === nextRepId);
        next.splice(insertAt === -1 ? next.length : insertAt, 0, snapshot);
        return next;
      });
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete rep' };
    }
  };

  const removeRep = (id: string) => {
    const reps = getReps();
    const snapshot = reps.find((r) => r.id === id);
    setReps((prev) => prev.filter((r) => r.id !== id));
    persistFetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    }, 'Failed to remove rep').catch(() => {
      if (snapshot) setReps((prev) => [...prev, snapshot]);
    });
  };

  const updateRepType = async (id: string, repType: 'closer' | 'setter' | 'both'): Promise<void> => {
    const reps = getReps();
    const snapshot = reps.find((r) => r.id === id);
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, repType } : r));
    try {
      await persistFetch(`/api/reps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repType }),
      }, 'Failed to update rep type');
    } catch {
      if (snapshot) setReps((prev) => prev.map((r) => r.id === id ? { ...r, repType: snapshot.repType } : r));
    }
  };

  const updateRepContact = (id: string, updates: { firstName?: string; lastName?: string; email?: string; phone?: string }, skipPersist = false) => {
    const reps = getReps();
    const snapshot = reps.find((r) => r.id === id);
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, ...updates, name: `${updates.firstName ?? r.firstName} ${updates.lastName ?? r.lastName}` } : r));
    if (skipPersist) return;
    persistFetch(`/api/reps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }, 'Failed to update rep contact').catch(() => {
      if (snapshot) setReps((prev) => prev.map((r) => r.id === id ? snapshot : r));
    });
  };

  // ── Sub-dealer management ──

  const addSubDealer = (firstName: string, lastName: string, email: string, phone: string, id?: string) => {
    const tempId = id ?? `sd_${Date.now()}`;
    const name = `${firstName.trim()} ${lastName.trim()}`;
    setSubDealers((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name, email: email.trim(), phone: phone.trim(), role: 'sub-dealer' as const, active: true, hasClerkAccount: false }]);
    if (id) {
      return Promise.resolve({ id } as { id: string });
    }
    return persistFetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, role: 'sub-dealer' }),
    }, 'Failed to save new sub-dealer').then((res) => res.json()).then((sd) => {
      if (sd.id && sd.id !== tempId) {
        setSubDealers((prev) => prev.map((s) => s.id === tempId ? { ...s, id: sd.id } : s));
      }
      return sd as { id: string };
    }).catch(() => {
      setSubDealers((prev) => prev.filter((s) => s.id !== tempId));
      return undefined;
    });
  };

  const deactivateSubDealer = async (id: string): Promise<void> => {
    setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: false } : s));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }, 'Failed to deactivate sub-dealer');
    } catch {
      setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: true } : s));
    }
  };

  const reactivateSubDealer = async (id: string): Promise<void> => {
    setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: true } : s));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      }, 'Failed to reactivate sub-dealer');
    } catch {
      setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: false } : s));
    }
  };

  const deleteSubDealerPermanently = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const subDealers = getSubDealers();
    const snapshotIndex = subDealers.findIndex((s) => s.id === id);
    const snapshot = snapshotIndex !== -1 ? subDealers[snapshotIndex] : undefined;
    const nextSubDealerId = subDealers[snapshotIndex + 1]?.id ?? null;
    setSubDealers((prev) => prev.filter((s) => s.id !== id));
    try {
      await persistFetch(`/api/users/${id}`, { method: 'DELETE' }, 'Failed to delete sub-dealer');
      return { success: true };
    } catch (err: unknown) {
      if (snapshot) setSubDealers((prev) => {
        const next = [...prev];
        const insertAt = nextSubDealerId === null ? next.length : next.findIndex((s) => s.id === nextSubDealerId);
        next.splice(insertAt === -1 ? next.length : insertAt, 0, snapshot);
        return next;
      });
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete sub-dealer' };
    }
  };

  const updateSubDealerContact = (id: string, updates: { firstName?: string; lastName?: string; email?: string; phone?: string }, skipFetch?: boolean) => {
    const subDealers = getSubDealers();
    const snapshot = subDealers.find((s) => s.id === id);
    setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, ...updates, name: `${updates.firstName ?? s.firstName} ${updates.lastName ?? s.lastName}` } : s));
    if (!skipFetch) {
      persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }, 'Failed to update sub-dealer contact').catch(() => {
        if (snapshot) setSubDealers((prev) => prev.map((s) => s.id === id ? snapshot : s));
      });
    }
  };

  const removeSubDealer = (id: string) => {
    const subDealers = getSubDealers();
    const snapshot = subDealers.find((sd) => sd.id === id);
    setSubDealers((prev) => prev.filter((sd) => sd.id !== id));
    persistFetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    }, 'Failed to remove sub-dealer').catch(() => {
      if (snapshot) setSubDealers((prev) => [...prev, snapshot]);
    });
  };

  return {
    addRep,
    deactivateRep,
    reactivateRep,
    deleteRepPermanently,
    removeRep,
    updateRepType,
    updateRepContact,
    addSubDealer,
    deactivateSubDealer,
    reactivateSubDealer,
    deleteSubDealerPermanently,
    removeSubDealer,
    updateSubDealerContact,
  };
}
