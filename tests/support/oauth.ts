import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./session";

/**
 * Test only OAuth rows: a synthetic client (and optionally the consent that connects it to a
 * user) in the local or CI Postgres. Cleanup deletes the client, which cascades to its consents.
 */
export async function seedClient(options: {
  readonly name: string | null;
  readonly redirectUris: readonly string[];
  readonly consentFor?: string;
}): Promise<{ readonly clientId: string; readonly cleanup: () => Promise<void> }> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const clientId = `e2e-client-${randomUUID()}`;
  const now = new Date();
  await sql`insert into oauth_client (id, client_id, name, redirect_uris, disabled, created_at, updated_at)
            values (${randomUUID()}, ${clientId}, ${options.name}, ${[...options.redirectUris]},
                    false, ${now}, ${now})`;
  if (options.consentFor) {
    await sql`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
              values (${randomUUID()}, ${clientId}, ${options.consentFor}, ${["takes"]},
                      ${now}, ${now})`;
  }
  return {
    clientId,
    cleanup: async () => {
      await sql`delete from oauth_client where client_id = ${clientId}`;
      await sql.end();
    },
  };
}
