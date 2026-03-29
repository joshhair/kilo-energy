'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../lib/context';
import { Zap, Shield, ChevronRight } from 'lucide-react';

export default function LoginPage() {
  const { setRole, reps } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<'pick' | 'rep' | 'admin'>('pick');
  const [selectedRepId, setSelectedRepId] = useState('');

  const handleRepLogin = () => {
    if (!selectedRepId) return;
    const rep = reps.find((r) => r.id === selectedRepId);
    if (!rep) return;
    setRole('rep', rep.id, rep.name);
    router.push('/dashboard');
  };

  const handleAdminLogin = () => {
    setRole('admin', undefined, 'Admin');
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
         style={{ background: 'linear-gradient(135deg, #060E1E 0%, #0D1B2E 60%, #0F2040 100%)' }}>

      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
           style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      {/* Ambient glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full opacity-[0.08] blur-3xl pointer-events-none"
           style={{ background: 'radial-gradient(circle, #3b82f6, transparent 70%)' }} />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full opacity-[0.06] blur-3xl pointer-events-none"
           style={{ background: 'radial-gradient(circle, #10b981, transparent 70%)' }} />

      <div className="relative w-full max-w-sm animate-slide-in-scale">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-baseline gap-1 mb-3">
            <span className="text-white font-black tracking-tight leading-none"
                  style={{ fontSize: '3rem', letterSpacing: '-0.04em' }}>
              kilo
            </span>
            <span className="text-white font-light tracking-[0.25em] uppercase"
                  style={{ fontSize: '1.1rem' }}>
              ENERGY
            </span>
          </div>
          <p className="text-slate-500 text-sm tracking-widest uppercase">Internal Portal</p>
        </div>

        {/* Card */}
        <div className="card-surface relative rounded-2xl overflow-hidden">
          <div className="p-8">
            {mode === 'pick' && (
              <div className="space-y-4">
                <p className="text-slate-400 text-xs text-center uppercase tracking-widest mb-6">
                  Sign in to continue
                </p>

                {/* Rep Login Card */}
                <button
                  onClick={() => setMode('rep')}
                  className="w-full card-surface rounded-xl p-4 flex items-center gap-4 text-left transition-all hover:translate-y-[-2px] active:scale-[0.98] group"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">Rep Login</p>
                    <p className="text-slate-500 text-xs mt-0.5">Access your deals and commissions</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 transition-colors shrink-0" />
                </button>

                {/* Admin Login Card */}
                <button
                  onClick={() => setMode('admin')}
                  className="w-full card-surface rounded-xl p-4 flex items-center gap-4 text-left transition-all hover:translate-y-[-2px] active:scale-[0.98] group"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">Admin Login</p>
                    <p className="text-slate-500 text-xs mt-0.5">Full access to all data and payroll</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 transition-colors shrink-0" />
                </button>
              </div>
            )}

            {mode === 'rep' && (
              <div className="space-y-5">
                <button onClick={() => { setMode('pick'); setSelectedRepId(''); }}
                  className="text-slate-400 hover:text-white text-xs flex items-center gap-1.5 transition-colors">
                  ← Back
                </button>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <Zap className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <h2 className="text-white text-lg font-bold">Select your account</h2>
                  </div>
                  <p className="text-slate-500 text-xs ml-9">Choose your rep profile to continue</p>
                </div>
                <select
                  value={selectedRepId}
                  onChange={(e) => setSelectedRepId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all input-focus-glow"
                >
                  <option value="">— Choose a rep —</option>
                  {reps.map((rep) => (
                    <option key={rep.id} value={rep.id}>{rep.name}</option>
                  ))}
                </select>
                <div className="relative inline-flex w-full">
                  {selectedRepId && <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-blue-500 to-emerald-500 opacity-25 blur-md animate-pulse" />}
                  <button
                    onClick={handleRepLogin}
                    disabled={!selectedRepId}
                    className="relative w-full btn-primary text-white font-bold py-3.5 rounded-xl text-sm transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Enter Dashboard
                  </button>
                </div>
              </div>
            )}

            {mode === 'admin' && (
              <div className="space-y-5">
                <button onClick={() => setMode('pick')}
                  className="text-slate-400 hover:text-white text-xs flex items-center gap-1.5 transition-colors">
                  ← Back
                </button>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                      <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <h2 className="text-white text-lg font-bold">Admin Access</h2>
                  </div>
                  <p className="text-slate-500 text-xs ml-9">Full access to all reps, deals, and payroll</p>
                </div>
                <div className="relative inline-flex w-full">
                  <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-emerald-500 to-blue-500 opacity-25 blur-md animate-pulse" />
                  <button
                    onClick={handleAdminLogin}
                    className="relative w-full btn-primary text-white font-bold py-3.5 rounded-xl text-sm transition-all active:scale-[0.98]"
                  >
                    Enter as Admin
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6 tracking-wide">
          &copy; {new Date().getFullYear()} Kilo Energy &middot; Internal Use Only
        </p>
      </div>
    </div>
  );
}
