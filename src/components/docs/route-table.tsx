import type { RouteGroup } from "@/lib/api-docs";

/** One group of the public routes: method, path and what it does. Real text, no colour only cues. */
export function RouteTable({ group }: Readonly<{ group: RouteGroup }>) {
  return (
    <section aria-labelledby={`g-${group.id}`} className="flex flex-col gap-3">
      <h3 id={`g-${group.id}`} className="text-h4">
        {group.title}
      </h3>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {group.routes.map((route) => (
          <li
            key={`${route.method} ${route.path}`}
            className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <code className="font-mono text-sm break-all sm:w-[26rem] sm:shrink-0">
              <span className="font-semibold">{route.method}</span> {route.path}
            </code>
            <span>{route.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
