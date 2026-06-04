// Inline Skeleton — skeleton.jsx was removed; component defined here directly
function Skeleton({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/8 ${className}`}
    />
  );
}

export function TeamSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="rounded-3xl border border-white/5 bg-white/5 p-6 space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="flex justify-between items-center pt-4 border-t border-slate-300/50">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CostSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-[58px] rounded-xl" />
        <Skeleton className="h-[58px] rounded-xl" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-3xl border border-white/5 bg-white/5 p-6 space-y-4">
            <div className="grid grid-cols-5 gap-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
