'use client';

/**
 * Admin Audit Log viewer.
 *
 * Read-only UI over the AuditLog table. Filters by entityType,
 * action, actor email, date range. Keyset-paginated (50 rows per
 * page, "Load more" button).
 *
 * Goal is fast answers to "who changed X" questions. Example: rep
 * emails saying "my commission on Timothy Salunga looks wrong" —
 * admin filters by entityType=Project and text-searches for the
 * project id, sees every edit with old/new diff, confirms whether
 * the reported issue matches a specific admin action.
 *
 * Not a compliance-grade audit tool (no exports, no cryptographic
 * tamper-evidence). Just a UI on the table that already exists.
 */

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../../../../lib/context';
import { ArrowLeft, Filter, Download } from 'lucide-react';

interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

const ENTITY_TYPES = ['', 'Project', 'PayrollEntry', 'User', 'Blitz', 'Installer', 'Financer', 'InstallerPricingVersion', 'ProductPricingVersion'] as const;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Pretty-print JSON diff for display. Invalid JSON falls back to raw string. */
function tryParseJson(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

export default function AdminAuditPage() {
  const { effectiveRole } = useApp();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filters
  const [entityType, setEntityType] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [actorEmail, setActorEmail] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const buildQuery = (cursor: string | null): string => {
    const params = new URLSearchParams();
    if (entityType) params.set('entityType', entityType);
    if (action) params.set('action', action);
    if (actorEmail) params.set('actorEmail', actorEmail);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', '50');
    if (cursor) params.set('cursor', cursor);
    return params.toString();
  };

  const fetchLogs = async (append = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery(append ? nextCursor : null);
      const res = await fetch(`/api/audit?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { logs: AuditLogRow[]; nextCursor: string | null };
      setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  // Initial load + refetch when filters change.
  useEffect(() => {
    fetchLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, action, actorEmail, from, to]);

  const exportCsv = () => {
    const headers = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Old Value', 'New Value'];
    const rows = logs.map((l) => [
      formatTimestamp(l.createdAt),
      l.actorEmail ?? 'system',
      l.action,
      l.entityType,
      l.entityId,
      l.oldValue ?? '',
      l.newValue ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (effectiveRole !== 'admin') {
    return (
      <div className="px-6 py-8">
        <p className="text-[var(--text-muted)]">Admin only.</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-white mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'DM Serif Display', serif" }}>Audit Log</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Every mutation on money-sensitive tables. Filter to investigate specific changes.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={logs.length === 0}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card-surface rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)] mb-3">
          <Filter className="w-4 h-4" />
          Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label htmlFor="audit-entityType" className="block text-xs text-[var(--text-muted)] mb-1">Entity type</label>
            <select
              id="audit-entityType"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white"
            >
              {ENTITY_TYPES.map((t) => <option key={t || 'all'} value={t}>{t || 'All types'}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="audit-action" className="block text-xs text-[var(--text-muted)] mb-1">Action (exact)</label>
            <input
              id="audit-action"
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="phase_change, etc."
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[var(--text-dim)]"
            />
          </div>
          <div>
            <label htmlFor="audit-actorEmail" className="block text-xs text-[var(--text-muted)] mb-1">Actor email</label>
            <input
              id="audit-actorEmail"
              type="email"
              value={actorEmail}
              onChange={(e) => setActorEmail(e.target.value)}
              placeholder="admin@…"
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[var(--text-dim)]"
            />
          </div>
          <div>
            <label htmlFor="audit-from" className="block text-xs text-[var(--text-muted)] mb-1">From</label>
            <input
              id="audit-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label htmlFor="audit-to" className="block text-xs text-[var(--text-muted)] mb-1">To</label>
            <input
              id="audit-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Log table */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-header-frost">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left px-4 py-3 text-[var(--text-secondary)] font-medium text-xs">Timestamp</th>
              <th className="text-left px-4 py-3 text-[var(--text-secondary)] font-medium text-xs">Actor</th>
              <th className="text-left px-4 py-3 text-[var(--text-secondary)] font-medium text-xs">Action</th>
              <th className="text-left px-4 py-3 text-[var(--text-secondary)] font-medium text-xs">Entity</th>
              <th className="text-left px-4 py-3 text-[var(--text-secondary)] font-medium text-xs">Entity ID</th>
              <th className="text-right px-4 py-3 text-[var(--text-secondary)] font-medium text-xs">Diff</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">
                No audit log entries match your filters.
              </td></tr>
            )}
            {logs.map((log) => {
              const isOpen = expanded === log.id;
              return (
                <Fragment key={log.id}>
                  <tr
                    className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-card)]/30 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : log.id)}
                  >
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs whitespace-nowrap">{formatTimestamp(log.createdAt)}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{log.actorEmail ?? '(system)'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-[var(--surface-card)] text-[var(--text-secondary)] font-mono">{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{log.entityType}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs font-mono">{log.entityId.slice(0, 12)}…</td>
                    <td className="px-4 py-3 text-right text-xs text-[var(--text-muted)]">
                      {log.oldValue || log.newValue ? (isOpen ? 'Hide' : 'Show') : '—'}
                    </td>
                  </tr>
                  {isOpen && (log.oldValue || log.newValue) && (
                    <tr className="border-b border-[var(--border-subtle)]/50 bg-[var(--surface)]/40">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-[var(--text-muted)] mb-1">Old</p>
                            <pre className="text-xs text-red-300/70 bg-red-500/5 p-2 rounded overflow-auto max-h-64">
                              {log.oldValue ? JSON.stringify(tryParseJson(log.oldValue), null, 2) : '(none)'}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--text-muted)] mb-1">New</p>
                            <pre className="text-xs text-emerald-300/70 bg-emerald-500/5 p-2 rounded overflow-auto max-h-64">
                              {log.newValue ? JSON.stringify(tryParseJson(log.newValue), null, 2) : '(none)'}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      <div className="flex justify-center mt-6">
        {nextCursor && (
          <button
            onClick={() => fetchLogs(true)}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {!nextCursor && logs.length > 0 && (
          <p className="text-xs text-[var(--text-muted)]">End of results · {logs.length} entries</p>
        )}
      </div>
    </div>
  );
}
