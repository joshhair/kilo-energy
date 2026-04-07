'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Receipt, ArrowRight } from 'lucide-react';

/**
 * Legacy route — reimbursement submissions have moved to the My Pay hub.
 * This page remains functional so any existing bookmarks or links still land
 * somewhere useful, but it simply points the rep to the new location.
 */
export default function ReimbursementRedirectPage() {
  useEffect(() => { document.title = 'Reimbursement | Kilo Energy'; }, []);
  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <Receipt className="w-5 h-5 text-[#00e07a]" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>Reimbursements</h1>
        </div>
        <p className="text-[#c2c8d8]/80 text-sm font-medium ml-12">This page has moved</p>
      </div>

      <div className="bg-[#161920] border border-[#333849] rounded-2xl p-8 max-w-lg">
        <div className="flex items-start gap-4">
          <div className="shrink-0 mt-0.5 p-2.5 rounded-xl" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <Receipt className="w-5 h-5 text-[#00e07a]" />
          </div>
          <div>
            <h2 className="text-white font-bold text-base mb-2">Reimbursements have moved</h2>
            <p className="text-[#c2c8d8] text-sm leading-relaxed mb-5">
              Expense reimbursements are now part of the unified <strong className="text-white">My Pay</strong> hub,
              giving you one place to view commissions, bonuses, and reimbursements together.
            </p>
            <Link
              href="/dashboard/my-pay?tab=reimbursements"
              className="inline-flex items-center gap-2 text-white font-semibold px-5 py-2.5 rounded-xl transition-all hover:opacity-90 active:scale-[0.98] shadow-lg shadow-blue-500/20 text-sm"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Go to My Pay → Reimbursements
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
