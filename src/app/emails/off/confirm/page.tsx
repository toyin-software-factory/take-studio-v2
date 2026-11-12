import type { Metadata } from "next";
import { SkipLink } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Turn off take emails · Take Studio" };

type Props = {
  readonly searchParams: Promise<{ readonly u?: string; readonly s?: string }>;
};

/**
 * The turn off link lands here (spec 0006, AC-6). Opening it changes nothing; the button posts
 * the signed parameters to /emails/off. Without both parameters there is nothing to confirm.
 */
export default async function ConfirmEmailsOffPage({ searchParams }: Props) {
  const { u, s } = await searchParams;
  const action = u && s ? `/emails/off?${new URLSearchParams({ u, s }).toString()}` : null;
  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 outline-hidden"
      >
        <h1 className="text-h1 font-medium">
          {action ? "Turn off take emails?" : "That link didn't work"}
        </h1>
        {action ? (
          <>
            <p>
              We will stop emailing you when your takes are ready. You can turn them back on from
              any take page.
            </p>
            <form method="post" action={action}>
              <input type="hidden" name="from" value="page" />
              <Button type="submit">Turn off take emails</Button>
            </form>
          </>
        ) : (
          <p>
            The link is not valid. You can change this setting from any take page once you are
            signed in.
          </p>
        )}
      </main>
    </>
  );
}
