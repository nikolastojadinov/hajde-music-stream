import { Skeleton } from "@/components/ui/skeleton";

type LoadingSkeletonProps = {
  type: "search" | "artist";
};

export default function LoadingSkeleton({ type }: LoadingSkeletonProps) {
  if (type === "search") {
    return (
      <div className="space-y-8" aria-label="Loading search results">
        <section className="min-h-[104px]">
          <div className="flex gap-4 overflow-hidden pb-2">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="shrink-0 w-20">
                <Skeleton className="mx-auto h-14 w-14 rounded-full" />
                <Skeleton className="mx-auto mt-2 h-3 w-16" />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="rounded-lg border border-border bg-card/40 px-3 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-6 w-24" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="rounded-lg border border-border bg-card/40 px-3 py-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-label="Loading artist">
      <div className="rounded-xl overflow-hidden border border-border bg-card/40">
        <Skeleton className="h-44 w-full rounded-none" />
        <div className="p-4 flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-3 h-10 w-28 rounded-full" />
          </div>
        </div>
      </div>

      <section>
        <Skeleton className="mb-3 h-6 w-28" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="rounded-xl border border-border bg-card/30 overflow-hidden">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="p-3">
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="p-3">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="mt-2 h-3 w-2/5" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
