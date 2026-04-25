'use client';

import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import { PaginationBar } from '../../components/PaginationBar';

export function BlitzPermissionsSection({ reps }: { reps: Array<{ id: string; name: string; repType: string; canRequestBlitz?: boolean; canCreateBlitz?: boolean }> }) {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<Record<string, { canRequestBlitz: boolean; canCreateBlitz: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'All' | 'Closer' | 'Setter' | 'Both'>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; action: 'grant' | 'revoke' }>({ open: false, action: 'grant' });

  // Debounce search input (200ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, roleFilter]);

  // Initialize permissions from context data (no N+1 fetches)
  useEffect(() => {
    const perms: Record<string, { canRequestBlitz: boolean; canCreateBlitz: boolean }> = {};
    reps.forEach((r) => {
      perms[r.id] = { canRequestBlitz: r.canRequestBlitz ?? false, canCreateBlitz: r.canCreateBlitz ?? false };
    });
    setPermissions(perms);
    setLoading(false);
  }, [reps]);

  const togglePermission = async (repId: string, field: 'canRequestBlitz' | 'canCreateBlitz', value: boolean) => {
    const prevValue = permissions[repId]?.[field];
    setPermissions((p) => ({ ...p, [repId]: { ...p[repId], [field]: value } }));
    try {
      const res = await fetch(`/api/users/${repId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      toast('Permission updated');
    } catch {
      setPermissions((p) => ({ ...p, [repId]: { ...p[repId], [field]: prevValue } }));
      toast('Failed to update permission', 'error');
    }
  };

  // Role counts
  const roleCounts = { All: reps.length, Closer: 0, Setter: 0, Both: 0 };
  reps.forEach((r) => {
    const rt = r.repType?.toLowerCase() ?? '';
    if (rt === 'closer') roleCounts.Closer++;
    else if (rt === 'setter') roleCounts.Setter++;
    else if (rt === 'both') roleCounts.Both++;
  });

  // Filter reps
  const filteredReps = reps.filter((r) => {
    const matchesSearch = !debouncedSearch || r.name.toLowerCase().includes(debouncedSearch.toLowerCase());
    const rt = r.repType?.toLowerCase() ?? '';
    const matchesRole = roleFilter === 'All' || rt === roleFilter.toLowerCase();
    return matchesSearch && matchesRole;
  });

  // Summary stats
  const canRequestCount = filteredReps.filter((r) => permissions[r.id]?.canRequestBlitz).length;
  const canCreateCount = filteredReps.filter((r) => permissions[r.id]?.canCreateBlitz).length;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredReps.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, filteredReps.length);
  const pageReps = filteredReps.slice(startIdx, endIdx);

  // Bulk actions
  const executeBulk = async (action: 'grant' | 'revoke') => {
    const value = action === 'grant';
    const prevPerms = { ...permissions };
    const newPerms = { ...permissions };
    filteredReps.forEach((r) => {
      newPerms[r.id] = { canRequestBlitz: value, canCreateBlitz: value };
    });
    setPermissions(newPerms);
    const updates = filteredReps.map((r) =>
      fetch(`/api/users/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canRequestBlitz: value, canCreateBlitz: value }),
      }).then((res) => { if (!res.ok) throw new Error(); })
    );
    const results = await Promise.allSettled(updates);
    const failedReps = filteredReps.filter((_, i) => results[i].status === 'rejected');
    if (failedReps.length > 0) {
      setPermissions((curr) => {
        const rolled = { ...curr };
        failedReps.forEach((r) => { rolled[r.id] = prevPerms[r.id]; });
        return rolled;
      });
      toast(`Failed to update ${failedReps.length} rep(s): ${failedReps.map((r) => r.name).join(', ')}`, 'error');
    } else {
      toast(`${action === 'grant' ? 'Granted' : 'Revoked'} permissions for ${filteredReps.length} reps`);
    }
  };

  // Initials + avatar color
  const getInitials = (name: string) => name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const avatarColor = (repType: string) => {
    const rt = repType?.toLowerCase() ?? '';
    if (rt === 'closer') return 'bg-purple-600';
    if (rt === 'setter') return 'bg-[var(--accent-emerald-solid)]';
    if (rt === 'both') return 'bg-teal-600';
    return 'bg-[var(--text-dim)]';
  };
  const roleBadge = (repType: string) => {
    const rt = repType?.toLowerCase() ?? '';
    if (rt === 'closer') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-[var(--accent-purple-text)]">Closer</span>;
    if (rt === 'setter') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--accent-emerald-solid)]/20 text-[var(--accent-cyan-text)]">Setter</span>;
    if (rt === 'both') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-500/20 text-[var(--accent-teal-text)]">Both</span>;
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--text-muted)]/20 text-[var(--text-secondary)]">{repType || 'N/A'}</span>;
  };

  if (loading) return <div className="text-[var(--text-muted)] text-sm py-8 text-center">Loading permissions...</div>;

  return (
    <div key="blitz-permissions" className="animate-tab-enter max-w-3xl">
      <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">Blitz Permissions</h2>
      <p className="text-sm text-[var(--text-muted)] mb-5">Control which reps can request or create blitzes.</p>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="Search reps..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none input-focus-glow transition-colors"
        />
      </div>
      {searchTerm && (
        <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full mb-3 inline-block">{filteredReps.length} result{filteredReps.length !== 1 ? 's' : ''}</span>
      )}

      {/* Role filter tabs */}
      <div className="flex items-center gap-1 mb-4">
        {(['All', 'Closer', 'Setter', 'Both'] as const).map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(role)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={roleFilter === role
              ? {
                  background: 'linear-gradient(135deg, rgba(0, 224, 122, 0.18), rgba(0, 196, 240, 0.18))',
                  border: '1px solid rgba(0, 224, 122, 0.45)',
                  boxShadow: '0 0 12px rgba(0, 224, 122, 0.12)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                }
              : { background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
            }
          >
            {role} <span className="ml-1 text-[var(--text-muted)]">{roleCounts[role]}</span>
          </button>
        ))}
      </div>

      {/* Summary stats + bulk actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span><strong className="text-[var(--accent-emerald-text)]">{canRequestCount}</strong> can request</span>
          <span><strong className="text-[var(--accent-emerald-text)]">{canCreateCount}</strong> can create</span>
          <span><strong className="text-[var(--text-secondary)]">{filteredReps.length}</strong> total reps</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmDialog({ open: true, action: 'grant' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent-emerald-solid)]/20 text-[var(--accent-emerald-text)] hover:bg-[var(--accent-emerald-solid)]/30 transition-colors"
          >
            Grant All
          </button>
          <button
            onClick={() => setConfirmDialog({ open: true, action: 'revoke' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 text-[var(--accent-red-text)] hover:bg-red-600/30 transition-colors"
          >
            Revoke All
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-header-frost">
            <tr className="text-xs uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <th className="text-left px-4 py-3">Rep</th>
              <th className="text-center px-4 py-3">Can Request</th>
              <th className="text-center px-4 py-3">Can Create</th>
            </tr>
          </thead>
          <tbody>
            {pageReps.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-8 text-[var(--text-muted)] text-sm">No reps match your filters.</td></tr>
            ) : pageReps.map((rep) => {
              const perms = permissions[rep.id] ?? { canRequestBlitz: false, canCreateBlitz: false };
              return (
                <tr key={rep.id} className="last:border-0 transition-colors" style={{ borderBottom: '1px solid rgba(39,43,53,0.5)' }} onMouseEnter={(e) => e.currentTarget.style.background='rgba(29,32,40,0.4)'} onMouseLeave={(e) => e.currentTarget.style.background='transparent'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-primary)] text-xs font-bold ${avatarColor(rep.repType)}`}>
                        {getInitials(rep.name)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[var(--text-primary)] font-medium text-sm">{rep.name}</span>
                        <span className="mt-0.5">{roleBadge(rep.repType)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => togglePermission(rep.id, 'canRequestBlitz', !perms.canRequestBlitz)}
                        className={`w-9 h-5 rounded-full transition-colors relative inline-block ${perms.canRequestBlitz ? 'bg-[var(--accent-emerald-solid)]' : 'bg-[var(--surface-card)]'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms.canRequestBlitz ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <span className={`text-[10px] font-medium ${perms.canRequestBlitz ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-muted)]'}`}>
                        {perms.canRequestBlitz ? 'On' : 'Off'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => togglePermission(rep.id, 'canCreateBlitz', !perms.canCreateBlitz)}
                        className={`w-9 h-5 rounded-full transition-colors relative inline-block ${perms.canCreateBlitz ? 'bg-[var(--accent-emerald-solid)]' : 'bg-[var(--surface-card)]'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms.canCreateBlitz ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <span className={`text-[10px] font-medium ${perms.canCreateBlitz ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-muted)]'}`}>
                        {perms.canCreateBlitz ? 'On' : 'Off'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredReps.length > rowsPerPage && (
          <PaginationBar
            totalResults={filteredReps.length}
            startIdx={startIdx}
            endIdx={endIdx}
            currentPage={safePage}
            totalPages={totalPages}
            rowsPerPage={rowsPerPage}
            onPageChange={setCurrentPage}
            onRowsPerPageChange={setRowsPerPage}
          />
        )}
      </div>

      <div className="mt-4 text-xs text-[var(--text-dim)] space-y-1">
        <p><strong className="text-[var(--text-secondary)]">Can Request:</strong> Rep can submit blitz requests for admin approval</p>
        <p><strong className="text-[var(--text-secondary)]">Can Create:</strong> Rep can create and manage blitzes directly</p>
      </div>

      {/* Bulk action confirm dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}
        onConfirm={() => { executeBulk(confirmDialog.action); setConfirmDialog({ ...confirmDialog, open: false }); }}
        title={confirmDialog.action === 'grant' ? 'Grant All Permissions' : 'Revoke All Permissions'}
        message={`This will ${confirmDialog.action === 'grant' ? 'grant' : 'revoke'} both Request and Create permissions for ${filteredReps.length} matching rep${filteredReps.length !== 1 ? 's' : ''}. Continue?`}
        confirmLabel={confirmDialog.action === 'grant' ? 'Grant All' : 'Revoke All'}
        danger={confirmDialog.action === 'revoke'}
      />
    </div>
  );
}
