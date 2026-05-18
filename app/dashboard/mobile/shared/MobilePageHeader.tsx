'use client';

/**
 * Sticky mobile page header — appears at the top of every mobile screen.
 * Sticky position + hairline bottom border anchor the page so subsequent
 * content has a clear visual gravity. Title uses DM Serif Display per
 * spec (premium headline vocabulary).
 */
export default function MobilePageHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      className="sticky z-20 -mx-5 px-5 mb-5 flex items-center justify-between"
      style={{
        top: 0,
        background: 'color-mix(in srgb, var(--surface-page) 92%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
        paddingTop: '12px',
        paddingBottom: '12px',
      }}
    >
      <h1
        className="leading-tight"
        style={{
          fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
          fontSize: '1.6rem',
          color: 'var(--text-primary)',
        }}
      >{title}</h1>
      {right}
    </div>
  );
}
