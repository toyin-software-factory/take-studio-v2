import Link from "next/link";
import { Clapperboard } from "lucide-react";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";
import { DraftBanner } from "./draft-banner";

type TocItem = { readonly id: string; readonly title: string };

/**
 * The reading layout for a legal page: the standalone header, a Draft banner above the heading,
 * the "Last updated" line, the table of contents (a side rail from 1024 px, stacked above the text
 * below it) and the copy in one centred column. Only `children` sits in the hashed region.
 */
export function LegalPage({
  title,
  updated,
  toc,
  draftReasons,
  other,
  children,
}: Readonly<{
  title: string;
  updated: string;
  toc: readonly TocItem[];
  draftReasons: readonly string[];
  other: { readonly href: string; readonly label: string };
  children: ReactNode;
}>) {
  return (
    <>
      <SkipLink />
      <header className="mx-auto flex w-full max-w-content items-center px-[clamp(16px,2.4vw,32px)] py-5 print:hidden">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-1 py-1 text-h4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11"
        >
          <Icon icon={Clapperboard} />
          Take Studio
        </Link>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-content flex-col gap-8 px-[clamp(16px,2.4vw,32px)] pb-20 outline-hidden lg:flex-row lg:gap-16"
      >
        <nav
          aria-label="On this page"
          className="lg:sticky lg:top-8 lg:w-64 lg:shrink-0 lg:self-start print:hidden"
        >
          <ol className="flex list-decimal flex-col gap-1 pl-6">
            {toc.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="inline-block rounded-sm py-1 underline-offset-4 hover:underline pointer-coarse:min-h-11"
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="flex max-w-[72ch] min-w-0 flex-col gap-6">
          <DraftBanner reasons={draftReasons} />
          <div className="flex flex-col gap-1">
            <h1 className="text-h2">{title}</h1>
            <p className="text-muted-foreground">Last updated {updated}</p>
          </div>
          <div data-legal-copy="" className="flex flex-col gap-8 [counter-reset:legal]">
            {children}
          </div>
          <p>
            <Link
              href={other.href}
              className="underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:min-h-11"
            >
              {other.label}
            </Link>
          </p>
        </article>
      </main>
    </>
  );
}
