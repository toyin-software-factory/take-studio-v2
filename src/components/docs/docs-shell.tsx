import Link from "next/link";
import type { ReactNode } from "react";
import { Clapperboard } from "lucide-react";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";

export type TocItem = { readonly id: string; readonly title: string };

/** The reading layout shared by the docs pages: skip link, brand header, "On this page" nav, article. */
export function DocsShell({
  toc,
  children,
}: Readonly<{ toc: readonly TocItem[]; children: ReactNode }>) {
  return (
    <>
      <SkipLink />
      <header className="mx-auto flex w-full max-w-content items-center px-[clamp(16px,2.4vw,32px)] py-5">
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
          className="lg:sticky lg:top-8 lg:w-64 lg:shrink-0 lg:self-start"
        >
          <ol className="flex flex-col gap-1">
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
        <article className="flex max-w-[72ch] min-w-0 flex-col gap-10">{children}</article>
      </main>
    </>
  );
}
