'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import MobileYou from '../mobile/MobileYou';

export default function YouPage() {
  return (
    <Suspense>
      <YouPageInner />
    </Suspense>
  );
}

function YouPageInner() {
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const router = useRouter();

  useEffect(() => {
    if (isHydrated && !isMobile) router.replace('/dashboard');
  }, [isHydrated, isMobile, router]);

  if (!isHydrated || !isMobile) return null;
  return <MobileYou />;
}
