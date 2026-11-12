/** One labelled row of component samples in the gallery. */
export function DemoBlock({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-small font-medium text-muted-foreground">{title}</h4>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** A titled group of demos for one component family. */
export function DemoGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-md bg-card p-4 shadow-card sm:p-6">
      <h3 className="text-h3 font-medium">{title}</h3>
      {children}
    </div>
  );
}
