import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiKeysManager } from "@/components/account/api-keys-manager";
import { AppShell } from "@/components/shell/app-shell";
import { listApiKeys } from "@/db/data/api-keys";
import { getDb, getSession } from "@/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API keys · Take Studio",
  robots: { index: false, follow: false },
};

/**
 * The "API keys" screen (spec 0018 AC-12): server rendered with the session, signed out goes to
 * sign in. Reads the creator's own keys (never a hash) and hands the list to the client screen.
 */
export default async function ApiKeysPage() {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  const rows = await listApiKeys(await getDb(), session.user.id);
  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <div className="flex max-w-2xl flex-col gap-8">
        <header className="grid gap-2">
          <h1 className="text-h2">API keys</h1>
          <p className="text-body text-ink">
            Use a key to call Take Studio from your own code. Each key can do what you can do, so
            keep it secret.
          </p>
        </header>
        <ApiKeysManager
          initial={rows.map((row) => ({
            id: row.id,
            name: row.name,
            prefix: row.prefix,
            createdAt: row.createdAt.toISOString(),
            lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </AppShell>
  );
}
