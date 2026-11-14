import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";
import { API_REGISTRY } from "@/lib/api-registry";
import {
  API_AUTH_STEPS,
  API_ERRORS,
  API_ERROR_SHAPE,
  API_LIMITS,
  API_VERSION,
  API_VERSION_NOTE,
  groupRoutes,
} from "@/lib/api-docs";
import { RouteTable } from "./route-table";
import { UploadWalkthrough } from "./upload-walkthrough";

const TOC = [
  { id: "start", title: "Start here" },
  { id: "auth", title: "Sign in with a key" },
  { id: "limits", title: "Limits" },
  { id: "errors", title: "Errors" },
  { id: "example", title: "Upload to download" },
  { id: "routes", title: "Every route" },
] as const;

const code = "rounded-sm bg-panel px-1 font-mono text-[0.9em]";
const link = "underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:min-h-11";

/** `/docs/api`: the public API reference, built from the registry. Public, the same signed in or out. */
export function ApiDocsPage() {
  const groups = groupRoutes(API_REGISTRY);
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
        <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:w-64 lg:shrink-0 lg:self-start">
          <ol className="flex flex-col gap-1">
            {TOC.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="inline-block rounded-sm py-1 underline-offset-4 hover:underline pointer-coarse:min-h-11">
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="flex max-w-[72ch] min-w-0 flex-col gap-10">
          <div id="start" className="flex scroll-mt-8 flex-col gap-3">
            <h1 className="text-h2">Take Studio API</h1>
            <p>
              Do from your own code what you can do in Take Studio: upload a take, run it, read the
              transcript and fetch the finished video. Version {API_VERSION}.
            </p>
            <p>{API_VERSION_NOTE}</p>
            <p>
              Machines can read the same list as{" "}
              <a href="/api/openapi.json" className={link}>
                OpenAPI 3.1 (JSON)
              </a>
              .
            </p>
          </div>
          <section id="auth" aria-labelledby="h-auth" className="flex scroll-mt-8 flex-col gap-3">
            <h2 id="h-auth" className="text-h3">Sign in with a key</h2>
            <ol className="flex list-decimal flex-col gap-1 pl-6">
              {API_AUTH_STEPS.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p>
              Keys go in the header, never in a link. A signed in browser session works on the same
              routes, which is how the app itself calls them.
            </p>
          </section>
          <section id="limits" aria-labelledby="h-limits" className="flex scroll-mt-8 flex-col gap-3">
            <h2 id="h-limits" className="text-h3">Limits</h2>
            <ul className="flex list-disc flex-col gap-1 pl-6">
              {API_LIMITS.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
          <section id="errors" aria-labelledby="h-errors" className="flex scroll-mt-8 flex-col gap-3">
            <h2 id="h-errors" className="text-h3">Errors</h2>
            <p>
              A failed request returns JSON like <code className={code}>{API_ERROR_SHAPE}</code>. Match
              on <code className={code}>error</code>, show <code className={code}>message</code> to a person.
            </p>
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {API_ERRORS.map((e) => (
                <li key={e.code} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                  <span className="sm:w-56 sm:shrink-0"><code className={code}>{e.code}</code> ({e.status})</span>
                  <span>{e.meaning}</span>
                </li>
              ))}
            </ul>
          </section>
          <section id="example" aria-labelledby="h-example" className="flex scroll-mt-8 flex-col gap-4">
            <h2 id="h-example" className="text-h3">Upload to download</h2>
            <p>
              Set <code className={code}>BASE</code> to this site&apos;s address and{" "}
              <code className={code}>TAKE_STUDIO_KEY</code> to your key, then follow the steps.
            </p>
            <UploadWalkthrough />
          </section>
          <section id="routes" aria-labelledby="h-routes" className="flex scroll-mt-8 flex-col gap-6">
            <h2 id="h-routes" className="text-h3">Every route</h2>
            {groups.map((group) => <RouteTable key={group.id} group={group} />)}
          </section>
        </article>
      </main>
    </>
  );
}
