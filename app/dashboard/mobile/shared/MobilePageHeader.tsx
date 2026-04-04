'use client';

export default function MobilePageHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      {right}
    </div>
  );
}
