'use client';

export default function MobilePageHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)", fontSize: '1.6rem', color: '#fff' }}>{title}</h1>
      {right}
    </div>
  );
}
