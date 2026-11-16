import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { render, take } from "@/db/schema";
import type { Db } from "@/db/types";
import { chooseMedia } from "@/lib/take-media";
import { MEDIA_LINKS } from "@/lib/uploads";
import { guestCookieValue, liveGuest } from "./session";

/**
 * `GET /api/guest/take` (spec 0023 AC-10, G30): the view only result for a guest's own take.
 * It answers `{ status, playUrl, expiresInSeconds }` and nothing else: no title, no transcript,
 * no download link, no file names. `playUrl` is a short lived presigned R2 link, inline (never an
 * attachment), and only when the take is ready and has a file. The optional `takeId` picks one of
 * the guest's own takes, else the most recent. "No download" means no download button, not a
 * technical guarantee. The link is returned, never logged. Every refusal is the same 404.
 */

export type GuestTakeDeps = {
  readonly getDb: () => Promise<Db>;
  readonly headObject: (key: string) => Promise<{ readonly size: number } | null>;
  readonly presignGet: (
    key: string,
    options: {
      readonly expiresSeconds: number;
      readonly disposition: { readonly type: "inline"; readonly fileName: string };
    },
  ) => Promise<string>;
  readonly now?: () => Date;
};

const HEADERS = { "cache-control": "private, no-store" } as const;

function notFound(): Response {
  return Response.json(
    { error: "not_found", message: "We couldn't find that upload." },
    { status: 404, headers: HEADERS },
  );
}

export async function handleGuestTake(request: Request, deps: GuestTakeDeps): Promise<Response> {
  const db = await deps.getDb();
  const now = deps.now?.() ?? new Date();
  const takeId = new URL(request.url).searchParams.get("takeId") ?? undefined;
  if (takeId !== undefined && !z.uuid().safeParse(takeId).success) return notFound();
  const guest = await liveGuest(db, guestCookieValue(request.headers.get("cookie")), now, takeId);
  if (!guest) return notFound();

  const [found] = await db
    .select()
    .from(take)
    .where(and(eq(take.creatorId, guest.creatorId), takeId ? eq(take.id, takeId) : undefined))
    .orderBy(desc(take.createdAt))
    .limit(1);
  if (!found) return notFound();

  const [latest] = await db
    .select({ status: render.status, videoKey: render.videoKey })
    .from(render)
    .where(and(eq(render.takeId, found.id), eq(render.isLatest, true)));

  const choice =
    found.status === "ready"
      ? chooseMedia("play", found, latest ?? null, now)
      : ({ ok: false, error: "not_found" } as const);
  let playUrl: string | null = null;
  if (choice.ok) {
    try {
      if (await deps.headObject(choice.key)) {
        playUrl = await deps.presignGet(choice.key, {
          expiresSeconds: MEDIA_LINKS.playSeconds,
          disposition: { type: "inline", fileName: "take.mp4" },
        });
      }
    } catch {
      return Response.json(
        { error: "storage_error", message: "Storage is having a problem right now." },
        { status: 503, headers: HEADERS },
      );
    }
  }
  return Response.json(
    {
      status: found.status,
      playUrl,
      expiresInSeconds: playUrl ? MEDIA_LINKS.playSeconds : null,
    },
    { headers: HEADERS },
  );
}
