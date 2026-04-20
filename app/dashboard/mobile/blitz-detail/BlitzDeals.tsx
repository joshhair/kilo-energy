'use client';

import { useRouter } from 'next/navigation';
import { FolderKanban } from 'lucide-react';
import MobileBadge from '../shared/MobileBadge';
import MobileListItem from '../shared/MobileListItem';
import MobileEmptyState from '../shared/MobileEmptyState';

interface Project {
  id: string;
  customerName: string;
  kWSize: number;
  phase: string;
}

interface Props {
  projects: Project[];
}

export default function BlitzDeals({ projects }: Props) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      {projects.length === 0 ? (
        <MobileEmptyState icon={FolderKanban} title="No deals yet" subtitle="Deals attributed to this blitz will appear here" />
      ) : (
        <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderColor: 'var(--m-border, var(--border-mobile))' }}>
          {projects.map((p) => (
            <MobileListItem
              key={p.id}
              title={p.customerName}
              subtitle={`${p.kWSize.toFixed(1)} kW`}
              right={<MobileBadge value={p.phase} variant="phase" />}
              onTap={() => router.push(`/dashboard/projects/${p.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
