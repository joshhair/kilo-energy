/**
 * Payroll actions — extracted from context.tsx for file organization.
 */

import type { PayrollEntry } from '../data';
import { persistFetch } from '../persist';

interface PayrollDeps {
  getPayrollEntries: () => PayrollEntry[];
  setPayrollEntries: React.Dispatch<React.SetStateAction<PayrollEntry[]>>;
  payrollIdResolutionMap: React.MutableRefObject<Map<string, Promise<string>>>;
}

export function createPayrollActions(deps: PayrollDeps) {
  const { getPayrollEntries, setPayrollEntries, payrollIdResolutionMap } = deps;

  const persistPayrollEntry = (entry: PayrollEntry) => {
    const clientId = entry.id;
    // Use the optimistic clientId as the idempotency key. If this request is
    // retried (network blip, React StrictMode double-invocation, etc.), the
    // server will return the existing row instead of inserting a duplicate.
    // See app/api/payroll/route.ts POST handler.
    const promise = fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repId: entry.repId,
        projectId: entry.projectId,
        amount: entry.amount,
        type: entry.type,
        paymentStage: entry.paymentStage,
        status: entry.status,
        date: entry.date,
        notes: entry.notes,
        idempotencyKey: clientId,
      }),
    })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((saved): string => {
        if (!saved?.id) throw new Error('Payroll POST response missing id');
        const realId: string = saved.id;
        if (realId !== clientId) {
          setPayrollEntries((prev) =>
            prev.map((e) => (e.id === clientId ? { ...e, id: realId } : e))
          );
        }
        payrollIdResolutionMap.current.delete(clientId);
        return realId;
      })
      .catch((err) => {
        setPayrollEntries((prev) => prev.filter((e) => e.id !== clientId));
        window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save payroll entry' }));
        payrollIdResolutionMap.current.delete(clientId);
        throw err;
      });
    payrollIdResolutionMap.current.set(clientId, promise);
  };

  const deletePayrollEntriesFromDb = (ids: string[]) => {
    for (const id of ids) {
      const inflight = payrollIdResolutionMap.current.get(id);
      if (inflight) {
        inflight
          .then((realId) => {
            persistFetch(`/api/payroll/${realId}`, { method: 'DELETE' }, 'Failed to delete payroll entry').catch(() => {});
          })
          .catch(() => {});
      } else {
        persistFetch(`/api/payroll/${id}`, { method: 'DELETE' }, 'Failed to delete payroll entry').catch(() => {});
      }
    }
  };

  const markForPayroll = (entryIds: string[]) => {
    const idSet = new Set(entryIds);
    const currentEntries = getPayrollEntries();
    const originalStatuses = new Map(
      currentEntries.filter((e) => idSet.has(e.id)).map((e) => [e.id, e.status])
    );
    const rollback = () =>
      setPayrollEntries((prev) =>
        prev.map((e) => {
          const orig = originalStatuses.get(e.id);
          return orig !== undefined ? { ...e, status: orig } : e;
        })
      );
    setPayrollEntries((prev) =>
      prev.map((e) => (idSet.has(e.id) && e.status === 'Draft' ? { ...e, status: 'Pending' } : e))
    );
    const resolveIds = async (): Promise<{ resolved: string[]; failedOrigIds: string[]; idMap: Map<string, string> }> => {
      const results = await Promise.all(
        entryIds.map(async (id) => {
          const pending = payrollIdResolutionMap.current.get(id);
          if (pending) {
            try { return { origId: id, resolvedId: await pending }; } catch { return { origId: id, resolvedId: null }; }
          }
          return { origId: id, resolvedId: id };
        })
      );
      const resolved = results.filter((r): r is { origId: string; resolvedId: string } => r.resolvedId !== null).map((r) => r.resolvedId);
      const failedOrigIds = results.filter((r) => r.resolvedId === null).map((r) => r.origId);
      const idMap = new Map(results.filter((r): r is { origId: string; resolvedId: string } => r.resolvedId !== null).map((r) => [r.origId, r.resolvedId]));
      return { resolved, failedOrigIds, idMap };
    };
    return resolveIds().then(({ resolved: resolvedIds, failedOrigIds, idMap }) => {
      for (const [origId, resolvedId] of idMap) {
        if (origId !== resolvedId) {
          const origStatus = originalStatuses.get(origId);
          if (origStatus !== undefined) originalStatuses.set(resolvedId, origStatus);
        }
      }
      if (failedOrigIds.length > 0) {
        const failedSet = new Set(failedOrigIds);
        setPayrollEntries((prev) =>
          prev.map((e) => {
            if (!failedSet.has(e.id)) return e;
            const orig = originalStatuses.get(e.id);
            return orig !== undefined ? { ...e, status: orig } : e;
          })
        );
      }
      if (resolvedIds.length === 0) {
        throw new Error('All entries failed to persist');
      }
      return persistFetch('/api/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: resolvedIds, status: 'Pending' }),
      }, 'Failed to update payroll status').then((res) => {
        if (!res.ok) { rollback(); throw new Error('Failed to update payroll status'); }
      }).catch((err) => {
        rollback();
        throw err;
      });
    });
  };

  return {
    persistPayrollEntry,
    deletePayrollEntriesFromDb,
    markForPayroll,
  };
}
