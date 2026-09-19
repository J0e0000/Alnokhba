export function SkeletonBar({ w = 'w-full', h = 'h-4' }) {
  return <div className={`${w} ${h} rounded-md bg-slate-200 animate-pulse`} />
}

export function SkeletonCard() {
  return (
    <div className="glass-card rounded-xl p-3 space-y-2">
      <SkeletonBar w="w-1/2" h="h-3" />
      <SkeletonBar w="w-1/3" h="h-6" />
    </div>
  )
}

export function SkeletonTableRows({ rows = 5, cols = 6 }) {
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((__, c) => (
            <SkeletonBar key={c} w={c === 0 ? 'w-8' : 'w-full'} h="h-4" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonList({ rows = 3 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-card rounded-lg p-3 space-y-2">
          <SkeletonBar w="w-1/3" h="h-3" />
          <SkeletonBar w="w-2/3" h="h-3" />
        </div>
      ))}
    </div>
  )
}
