import { Skeleton } from "@/components/ui/skeleton";

/** Loading cards shaped like take cards (design.md: skeletons, never a lone spinner). */
export function LibrarySkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <p className="sr-only" role="status">
        Loading your takes…
      </p>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col rounded-md bg-surface shadow-card">
          <Skeleton className="aspect-video w-full rounded-b-none" />
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
