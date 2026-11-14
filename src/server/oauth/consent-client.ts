import { getConsentClient, type ConsentClient } from "@/db/data/oauth";
import type { Executor } from "@/db/types";

/** The client's name and redirect URIs for the consent page (a server page imports this). */
export async function consentClientFor(
  db: Executor,
  clientId: string,
): Promise<ConsentClient | null> {
  return clientId ? getConsentClient(db, clientId) : null;
}
