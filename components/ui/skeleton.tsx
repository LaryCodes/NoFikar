import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-lg bg-muted", className)}
      {...props}
    />
  );
}

/** Row placeholder matching the member/alert list item layout. */
function SkeletonListItem() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
      <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonListItem, SkeletonList };
