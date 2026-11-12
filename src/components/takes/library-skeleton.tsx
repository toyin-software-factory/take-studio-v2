import { Skeleton } from "@/components/ui/skeleton";

/** Loading cards shaped like take cards (design.md: skeletons, never a lone spinner). */
export function LibrarySkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 min-[1200px]:grid-cols-3"
    >
      <p className="sr-only" role="status">
        Loading your takes…
      </p>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="aspect-video w-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
