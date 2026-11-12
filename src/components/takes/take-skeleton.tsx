import { Stage } from "@/components/stage";
import { Skeleton } from "@/components/ui/skeleton";

/** The take page while its first read is in flight: the real title, the rest as skeletons. */
export function TakeSkeleton({ title }: { readonly title: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1 font-medium break-words">{title}</h1>
        <Skeleton className="h-5 w-48" />
      </div>
      <Stage label="Player">
        <p className="sr-only" role="status">
          Loading this take…
        </p>
        <Skeleton className="aspect-video w-full" />
      </Stage>
    </div>
  );
}
