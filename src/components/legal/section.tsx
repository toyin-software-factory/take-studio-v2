import type { ReactNode } from "react";

/** One titled part of a legal page. The id is the anchor the table of contents links to. */
export function LegalSection({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-3 scroll-mt-24">
      <h2
        id={`${id}-title`}
        className="text-h3 [counter-increment:legal] before:content-[counter(legal)'._']"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A plain bulleted list for the copy. */
export function LegalList({ items }: Readonly<{ items: readonly ReactNode[] }>) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
