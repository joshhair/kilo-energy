'use client';

import React, { useState } from 'react';
import { SectionHeader } from '../components/SectionHeader';
import { getCustomConfig } from '../../../../lib/utils';
import { PrimaryButton, SecondaryButton, TextInput } from '@/components/ui';

const CUSTOMIZATION_DEFAULT_THRESHOLDS: Record<string, number> = {
  'New': 5, 'Acceptance': 10, 'Site Survey': 20, 'Design': 30,
  'Permitting': 50, 'Pending Install': 65, 'Installed': 75,
};

export function CustomizationSection() {
  const [customThresholds, setCustomThresholds] = useState<Record<string, number>>(() =>
    getCustomConfig('kilo-pipeline-thresholds', CUSTOMIZATION_DEFAULT_THRESHOLDS)
  );
  const [thresholdsSaved, setThresholdsSaved] = useState(false);

  return (
    <div key="customization" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Customization" subtitle="Adjust pipeline alert thresholds" />

      <div className="card-surface rounded-2xl p-5 mb-6">
        <h2 className="text-[var(--text-primary)] font-semibold mb-1">Pipeline Alert Thresholds</h2>
        <p className="text-[var(--text-muted)] text-xs mb-4">Days from sold date before a project is flagged as &ldquo;stuck&rdquo; in each phase.</p>
        <div className="space-y-3">
          {['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed'].map((phase) => (
            <div key={phase} className="flex items-center justify-between gap-4">
              <span className="text-sm text-[var(--text-secondary)] min-w-[120px]">{phase}</span>
              <TextInput
                type="number"
                min={1}
                max={365}
                value={String(customThresholds[phase] ?? CUSTOMIZATION_DEFAULT_THRESHOLDS[phase])}
                onChange={(e) => setCustomThresholds((prev) => ({ ...prev, [phase]: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="!w-20 text-center"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-5">
          <PrimaryButton
            onClick={() => {
              localStorage.setItem('kilo-pipeline-thresholds', JSON.stringify(customThresholds));
              setThresholdsSaved(true);
              setTimeout(() => setThresholdsSaved(false), 2000);
            }}
          >
            {thresholdsSaved ? 'Saved!' : 'Save Thresholds'}
          </PrimaryButton>
          <SecondaryButton
            onClick={() => {
              setCustomThresholds({ ...CUSTOMIZATION_DEFAULT_THRESHOLDS });
              localStorage.removeItem('kilo-pipeline-thresholds');
              setThresholdsSaved(true);
              setTimeout(() => setThresholdsSaved(false), 2000);
            }}
          >
            Reset to Defaults
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}
