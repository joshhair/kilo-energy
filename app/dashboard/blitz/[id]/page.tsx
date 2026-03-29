'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApp } from '../../../../lib/context';
import { useIsHydrated } from '../../../../lib/hooks';
import { formatDate, formatCurrency } from '../../../../lib/utils';
import { ArrowLeft, MapPin, Calendar, Home, Users, Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Zap, CheckCircle, XCircle, Clock, UserPlus, X, Pencil, Save, Loader2, FolderKanban } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import Link from 'next/link';

const COST_CATEGORIES = ['housing', 'travel', 'gas', 'meals', 'incentives', 'swag', 'other'] as const;

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  upcoming:  { bg: 'bg-blue-900/30',    text: 'text-blue-300',    dot: 'bg-blue-400',    border: 'border-blue-700/30' },
  active:    { bg: 'bg-emerald-900/30',  text: 'text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-700/30' },
  completed: { bg: 'bg-zinc-800/50',     text: 'text-zinc-400',    dot: 'bg-zinc-500',    border: 'border-zinc-600/30' },
  cancelled: { bg: 'bg-red-900/30',      text: 'text-red-300',     dot: 'bg-red-400',     border: 'border-red-700/30' },
};

type TabKey = 'overview' | 'participants' | 'deals' | 'costs' | 'profitability';

export default function BlitzDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentRole, reps } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = currentRole === 'admin';
  const { toast } = useToast();
  const blitzId = params.id as string;

  const [blitz, setBlitz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', location: '', housing: '', startDate: '', endDate: '', notes: '', status: '' });

  // Confirmation dialog
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // Loading states for async ops
  const [saving, setSaving] = useState(false);
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [addingCost, setAddingCost] = useState(false);

  // Cost form
  const [showAddCost, setShowAddCost] = useState(false);
  const [costCategory, setCostCategory] = useState<string>('housing');
  const [costAmount, setCostAmount] = useState('');
  const [costDesc, setCostDesc] = useState('');
  const [costDate, setCostDate] = useState(new Date().toISOString().split('T')[0]);

  // Participant form
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [selectedRepId, setSelectedRepId] = useState('');

  const loadBlitz = () => {
    fetch(`/api/blitzes/${blitzId}`).then((r) => r.json()).then((data) => {
      if (data.error) { router.push('/dashboard/blitz'); return; }
      setBlitz(data);
      setEditForm({ name: data.name, location: data.location, housing: data.housing, startDate: data.startDate, endDate: data.endDate, notes: data.notes, status: data.status });
      setLoading(false);
    }).catch(() => { setLoading(false); });
  };

  useEffect(() => { loadBlitz(); }, [blitzId]);

  // Computed metrics
  const approvedParticipants = blitz?.participants?.filter((p: any) => p.joinStatus === 'approved') ?? [];
  const totalDeals = blitz?.projects?.length ?? 0;
  const totalKW = blitz?.projects?.reduce((s: number, p: any) => s + p.kWSize, 0) ?? 0;
  const totalCosts = blitz?.costs?.reduce((s: number, c: any) => s + c.amount, 0) ?? 0;

  // Profitability (admin only)
  const projectedMargin = useMemo(() => {
    if (!blitz?.projects) return 0;
    return blitz.projects.reduce((s: number, p: any) => s + (p.m1Amount + p.m2Amount), 0);
  }, [blitz?.projects]);

  const netProfit = projectedMargin - totalCosts;
  const roi = totalCosts > 0 ? ((netProfit / totalCosts) * 100) : 0;

  // Cost breakdown by category
  const costsByCategory = useMemo(() => {
    if (!blitz?.costs) return {};
    const result: Record<string, number> = {};
    for (const c of blitz.costs) {
      result[c.category] = (result[c.category] ?? 0) + c.amount;
    }
    return result;
  }, [blitz?.costs]);

  // Available reps (not already participants)
  const availableReps = useMemo(() => {
    if (!blitz?.participants) return reps;
    const participantIds = new Set(blitz.participants.map((p: any) => p.user.id));
    return reps.filter((r) => !participantIds.has(r.id));
  }, [reps, blitz?.participants]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/blitzes/${blitzId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      toast('Blitz updated');
      setEditing(false);
      loadBlitz();
    } finally { setSaving(false); }
  };

  const handleAddParticipant = async () => {
    if (!selectedRepId) return;
    setAddingParticipant(true);
    try {
      await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedRepId, joinStatus: 'approved' }),
      });
      toast('Participant added');
      setShowAddParticipant(false);
      setSelectedRepId('');
      loadBlitz();
    } finally { setAddingParticipant(false); }
  };

  const handleRemoveParticipant = async (userId: string) => {
    await fetch(`/api/blitzes/${blitzId}/participants?userId=${userId}`, { method: 'DELETE' });
    toast('Participant removed');
    loadBlitz();
  };

  const handleUpdateAttendance = async (userId: string, attendanceStatus: string | null) => {
    await fetch(`/api/blitzes/${blitzId}/participants`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, attendanceStatus }),
    });
    loadBlitz();
  };

  const handleAddCost = async () => {
    if (!costAmount || parseFloat(costAmount) <= 0) return;
    setAddingCost(true);
    try {
      await fetch(`/api/blitzes/${blitzId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: costCategory, amount: parseFloat(costAmount), description: costDesc.trim(), date: costDate }),
      });
      toast('Cost added');
      setCostAmount('');
      setCostDesc('');
      setShowAddCost(false);
      loadBlitz();
    } finally { setAddingCost(false); }
  };

  const handleDeleteCost = async (costId: string) => {
    await fetch(`/api/blitzes/${blitzId}/costs?costId=${costId}`, { method: 'DELETE' });
    toast('Cost removed');
    loadBlitz();
  };

  if (!hydrated || loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-zinc-700/40" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/60 animate-spin" />
      </div>
      <p className="text-sm text-zinc-500 font-medium">Loading blitz details...</p>
    </div>
  );
  if (!blitz) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <XCircle className="w-14 h-14 text-zinc-600" />
      <p className="text-lg font-semibold text-white">Blitz not found</p>
      <p className="text-sm text-zinc-500">It may have been deleted or the link is invalid</p>
      <Link href="/dashboard/blitz" className="mt-2 px-4 py-2 text-sm font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors">
        Back to Blitzes
      </Link>
    </div>
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'participants', label: `Participants (${approvedParticipants.length})` },
    { key: 'deals', label: `Deals (${totalDeals})` },
    ...(isAdmin ? [
      { key: 'costs' as TabKey, label: `Costs (${blitz.costs?.length ?? 0})` },
      { key: 'profitability' as TabKey, label: 'Profitability' },
    ] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <Link href="/dashboard/blitz" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to Blitzes
        </Link>

        <div className="flex items-start justify-between">
          <div>
            {editing ? (
              <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="text-2xl font-bold bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1 text-white focus:ring-2 focus:ring-blue-500 outline-none" />
            ) : (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">{blitz.name}</h1>
                {(() => { const s = STATUS_STYLES[blitz.status] ?? STATUS_STYLES.upcoming; return (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${s.bg} ${s.text} ${s.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${blitz.status === 'active' ? 'animate-pulse' : ''}`} />
                    {blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1)}
                  </span>
                ); })()}
              </div>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-sm text-zinc-400">
              {blitz.location && <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{editing ? <input value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-sm text-white w-40" /> : blitz.location}</span>}
              <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{formatDate(blitz.startDate)} — {formatDate(blitz.endDate)}</span>
              {blitz.housing && <span className="flex items-center gap-1.5"><Home className="w-3.5 h-3.5" />{blitz.housing}</span>}
            </div>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="upcoming">Upcoming</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {saving ? 'Saving...' : 'Save'}</button>
                  <button onClick={() => setEditing(false)} className="px-3 py-2 text-sm text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-400 border border-zinc-700 rounded-lg hover:text-white hover:border-zinc-600 transition-colors"><Pencil className="w-3.5 h-3.5" /> Edit</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-zinc-800/50 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {t.label}
            {tab === t.key && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-blue-500 rounded-full" />}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (() => {
        const startMs = new Date(blitz.startDate + 'T00:00:00').getTime();
        const endMs = new Date(blitz.endDate + 'T00:00:00').getTime();
        const nowMs = new Date().setHours(0, 0, 0, 0);
        const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
        const elapsed = Math.max(0, Math.min(totalDays, Math.round((nowMs - startMs) / 86400000) + 1));
        const progressPct = blitz.status === 'completed' ? 100 : blitz.status === 'active' ? Math.round((elapsed / totalDays) * 100) : 0;

        return (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Participants</p>
              <p className="text-2xl font-bold text-white">{approvedParticipants.length}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Deals</p>
              <p className="text-2xl font-bold text-white">{totalDeals}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Total kW</p>
              <p className="text-2xl font-bold text-white">{totalKW.toFixed(1)}</p>
            </div>
            {isAdmin && (
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Net Profit</p>
                <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(netProfit)}</p>
              </div>
            )}
          </div>

          {/* Timeline progress bar */}
          {(blitz.status === 'active' || blitz.status === 'completed') && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-zinc-500 font-medium">Progress</p>
                <p className="text-xs text-zinc-400">
                  {blitz.status === 'completed' ? 'Completed' : `Day ${elapsed} of ${totalDays}`}
                </p>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${blitz.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-zinc-600">
                <span>{formatDate(blitz.startDate)}</span>
                <span>{formatDate(blitz.endDate)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Blitz details */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Details</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Leader</span>
                  <span className="text-white font-medium">{blitz.owner.firstName} {blitz.owner.lastName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Duration</span>
                  <span className="text-white">{totalDays} days</span>
                </div>
                {blitz.location && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Location</span>
                    <span className="text-white">{blitz.location}</span>
                  </div>
                )}
                {blitz.housing && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Housing</span>
                    <span className="text-white">{blitz.housing}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Participant avatars / quick list */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Team</p>
                <button onClick={() => setTab('participants')} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">View all</button>
              </div>
              {approvedParticipants.length === 0 ? (
                <p className="text-sm text-zinc-600">No participants yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {approvedParticipants.slice(0, 8).map((p: any) => (
                    <div key={p.user.id} className="flex items-center gap-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-full px-2.5 py-1">
                      <div className="w-5 h-5 rounded-full bg-blue-600/30 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold text-blue-300">
                        {p.user.firstName[0]}{p.user.lastName[0]}
                      </div>
                      <span className="text-xs text-zinc-300">{p.user.firstName}</span>
                    </div>
                  ))}
                  {approvedParticipants.length > 8 && (
                    <div className="flex items-center px-2.5 py-1 text-xs text-zinc-500">+{approvedParticipants.length - 8} more</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {blitz.notes && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1 font-medium uppercase tracking-wider">Notes</p>
              <p className="text-sm text-zinc-300">{blitz.notes}</p>
            </div>
          )}
        </div>
        );
      })()}

      {/* Participants */}
      {tab === 'participants' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <button onClick={() => setShowAddParticipant(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"><UserPlus className="w-4 h-4" /> Add Rep</button>
            </div>
          )}
          {blitz.participants?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800">
              <Users className="w-12 h-12 text-zinc-600" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">No participants yet</p>
                <p className="text-sm text-zinc-500 mt-1">Add reps to this blitz to start tracking participation</p>
              </div>
              {isAdmin && (
                <button onClick={() => setShowAddParticipant(true)} className="mt-1 px-4 py-2 text-sm font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors">
                  <span className="flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Add Rep</span>
                </button>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Rep</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Attendance</th>
                  {isAdmin && <th className="text-right px-4 py-3">Actions</th>}
                </tr></thead>
                <tbody>
                  {blitz.participants.map((p: any, idx: number) => (
                    <tr key={p.id} className={`border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/40 transition-colors ${idx % 2 === 0 ? 'bg-zinc-900/20' : ''}`}>
                      <td className="px-4 py-3 text-white font-medium">{p.user.firstName} {p.user.lastName}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.joinStatus === 'approved' ? 'bg-emerald-900/30 text-emerald-300' : p.joinStatus === 'pending' ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300'}`}>
                          {p.joinStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <select value={p.attendanceStatus ?? ''} onChange={(e) => handleUpdateAttendance(p.user.id, e.target.value || null)} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white">
                            <option value="">—</option>
                            <option value="attended">Attended</option>
                            <option value="partial">Partial</option>
                            <option value="no_show">No-show</option>
                          </select>
                        ) : (
                          <span className="text-xs text-zinc-400">{p.attendanceStatus ?? '—'}</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setConfirmAction({ title: `Remove ${p.user.firstName} ${p.user.lastName}?`, message: 'This will remove them from the blitz. They can be re-added later.', onConfirm: () => { handleRemoveParticipant(p.user.id); setConfirmAction(null); } })} className="text-zinc-600 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add participant modal */}
          {showAddParticipant && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddParticipant(false)}>
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-4">Add Participant</h3>
                <select value={selectedRepId} onChange={(e) => setSelectedRepId(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white mb-4">
                  <option value="">Select a rep...</option>
                  {availableReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAddParticipant(false)} className="px-3 py-2 text-sm text-zinc-400">Cancel</button>
                  <button onClick={handleAddParticipant} disabled={!selectedRepId || addingParticipant} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors">{addingParticipant ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{addingParticipant ? 'Adding...' : 'Add'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deals */}
      {tab === 'deals' && (
        <div className="space-y-3">
          {blitz.projects?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800">
              <FolderKanban className="w-12 h-12 text-zinc-600" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">No deals yet</p>
                <p className="text-sm text-zinc-500 mt-1">Deals attributed to this blitz will appear here</p>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Rep</th>
                  <th className="text-left px-4 py-3">Phase</th>
                  <th className="text-right px-4 py-3">kW</th>
                  <th className="text-right px-4 py-3">Net PPW</th>
                  {isAdmin && <th className="text-right px-4 py-3">Payout</th>}
                </tr></thead>
                <tbody>
                  {blitz.projects.map((p: any, idx: number) => (
                    <tr key={p.id} className={`border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/40 transition-colors ${idx % 2 === 0 ? 'bg-zinc-900/20' : ''}`}>
                      <td className="px-4 py-3 text-white font-medium">{p.customerName}</td>
                      <td className="px-4 py-3 text-zinc-400">{p.closer?.firstName} {p.closer?.lastName}</td>
                      <td className="px-4 py-3"><span className="text-xs font-medium text-zinc-300">{p.phase}</span></td>
                      <td className="px-4 py-3 text-right text-zinc-300">{p.kWSize.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">${p.netPPW.toFixed(2)}</td>
                      {isAdmin && <td className="px-4 py-3 text-right text-zinc-300">{formatCurrency(p.m1Amount + p.m2Amount)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Costs (admin only) */}
      {tab === 'costs' && isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAddCost(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"><Plus className="w-4 h-4" /> Add Cost</button>
          </div>

          {showAddCost && (
            <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <select value={costCategory} onChange={(e) => setCostCategory(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white">
                  {COST_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
                <input type="number" value={costAmount} onChange={(e) => setCostAmount(e.target.value)} placeholder="Amount" className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
                <input value={costDesc} onChange={(e) => setCostDesc(e.target.value)} placeholder="Description" className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
                <input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddCost(false)} className="px-3 py-1.5 text-sm text-zinc-400">Cancel</button>
                <button onClick={handleAddCost} disabled={addingCost} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors">{addingCost ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{addingCost ? 'Adding...' : 'Add Cost'}</button>
              </div>
            </div>
          )}

          {blitz.costs?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800">
              <DollarSign className="w-12 h-12 text-zinc-600" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">No costs recorded</p>
                <p className="text-sm text-zinc-500 mt-1">Track housing, travel, meals, and other blitz expenses</p>
              </div>
              <button onClick={() => setShowAddCost(true)} className="mt-1 px-4 py-2 text-sm font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors">
                <span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add Cost</span>
              </button>
            </div>
          ) : (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr></thead>
                <tbody>
                  {blitz.costs.map((c: any, idx: number) => (
                    <tr key={c.id} className={`border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/40 transition-colors ${idx % 2 === 0 ? 'bg-zinc-900/20' : ''}`}>
                      <td className="px-4 py-3"><span className="text-xs font-medium bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full">{c.category}</span></td>
                      <td className="px-4 py-3 text-zinc-400">{c.description || '—'}</td>
                      <td className="px-4 py-3 text-zinc-400">{formatDate(c.date)}</td>
                      <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setConfirmAction({ title: 'Delete this cost?', message: `Remove the ${c.category} cost of ${formatCurrency(c.amount)}? This cannot be undone.`, onConfirm: () => { handleDeleteCost(c.id); setConfirmAction(null); } })} className="text-zinc-600 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-zinc-700 bg-zinc-800/30">
                    <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-zinc-400">Total</td>
                    <td className="px-4 py-3 text-right text-lg font-bold text-white">{formatCurrency(totalCosts)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Profitability (admin only) */}
      {tab === 'profitability' && isAdmin && (
        <div className="space-y-6">
          {/* Top-level P&L */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Projected Payouts</p>
              <p className="text-2xl font-bold text-blue-400">{formatCurrency(projectedMargin)}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Total Costs</p>
              <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalCosts)}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Net Profit</p>
              <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(netProfit)}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">ROI</p>
              <p className={`text-2xl font-bold flex items-center gap-1.5 ${roi > 100 ? 'text-emerald-400' : roi >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                {roi.toFixed(0)}%
                {roi >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              </p>
            </div>
          </div>

          {/* Cost breakdown */}
          {Object.keys(costsByCategory).length > 0 && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-zinc-400 mb-4">Cost Breakdown</h3>
              <div className="space-y-2">
                {Object.entries(costsByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                  const pct = totalCosts > 0 ? (amt / totalCosts) * 100 : 0;
                  const barColors: Record<string, string> = { housing: 'bg-blue-500', travel: 'bg-purple-500', gas: 'bg-amber-500', meals: 'bg-emerald-500', incentives: 'bg-pink-500', swag: 'bg-orange-500', other: 'bg-zinc-500' };
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-xs text-zinc-400 w-20 capitalize">{cat}</span>
                      <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                        <div className={`${barColors[cat] ?? 'bg-blue-500'} h-full rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-medium text-white w-20 text-right">{formatCurrency(amt)}</span>
                      <span className="text-xs text-zinc-500 w-12 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-rep performance */}
          {approvedParticipants.length > 0 && blitz.projects?.length > 0 && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-zinc-400 mb-4">Rep Performance</h3>
              <div className="space-y-2">
                {approvedParticipants.map((p: any) => {
                  const repDeals = blitz.projects.filter((proj: any) => proj.closer?.id === p.user.id);
                  const repKW = repDeals.reduce((s: number, proj: any) => s + proj.kWSize, 0);
                  return (
                    <div key={p.user.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                      <span className="text-sm text-white font-medium">{p.user.firstName} {p.user.lastName}</span>
                      <div className="flex items-center gap-6 text-sm">
                        <span className="text-zinc-400">{repDeals.length} deals</span>
                        <span className="text-zinc-400">{repKW.toFixed(1)} kW</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation dialog for destructive actions */}
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}
