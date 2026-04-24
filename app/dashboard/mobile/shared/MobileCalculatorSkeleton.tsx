import MobilePageHeader from './MobilePageHeader';

export default function MobileCalculatorSkeleton() {
  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Calculator" />
      {/* Quick Fill row */}
      <div className="calc-skeleton rounded-2xl h-[64px]" />
      {/* Installer select */}
      <div className="space-y-1.5">
        <div className="calc-skeleton rounded-md h-[10px] w-16" />
        <div className="calc-skeleton rounded-xl h-[48px]" />
      </div>
      {/* Deal type toggle */}
      <div className="space-y-1.5">
        <div className="calc-skeleton rounded-md h-[10px] w-20" />
        <div className="grid grid-cols-2 gap-2">
          <div className="calc-skeleton rounded-xl h-[44px]" />
          <div className="calc-skeleton rounded-xl h-[44px]" />
        </div>
      </div>
      {/* kW + PPW pair */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="calc-skeleton rounded-md h-[10px] w-24" />
            <div className="calc-skeleton rounded-xl h-[48px]" />
          </div>
          <div className="space-y-1.5">
            <div className="calc-skeleton rounded-md h-[10px] w-20" />
            <div className="calc-skeleton rounded-xl h-[48px]" />
          </div>
        </div>
      </div>
      {/* Empty state card */}
      <div className="calc-skeleton rounded-2xl h-[72px]" />
      {/* Recent calcs header */}
      <div className="calc-skeleton rounded-2xl h-[48px]" />
    </div>
  );
}
