import { and, count, eq, gt, isNull, or } from "drizzle-orm";
import {} from "zod";
import {} from "@/db/data/jobs";
import { transitionTake } from "@/db/data/takes";
import { background, take, user } from "@/db/schema";
import { runTx } from "@/db/tx";
import { uploadCreateSchema } from "@/lib/api-schemas/requests";
import {} from "@/lib/cleanup-rules";
import { SCRIPT_MAX_CHARS } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { MEDIA_LIMITS } from "@/lib/take-rules";
import { UPLOAD, containerContentType, partCount } from "@/lib/uploads";
import {} from "../analytics/record";
import { attachUpload, cleanScript, create } from "../takes";
import { type CreatedUpload, type UploadDeps, type UploadError } from "./base";

/** True when a body's script is a string over the limit once trimmed (checked before zod, so no error ever holds it). */
function scriptTooLong(input: unknown): boolean {
  if (typeof input !== "object" || input === null || !("script" in input)) return false;
  const script = (input as { readonly script: unknown }).script;
  return typeof script === "string" && script.trim().length > SCRIPT_MAX_CHARS;
}

/**
 * `POST /api/uploads`: checks the hourly limit, creates the take (`uploading`), starts the R2
 * multipart upload for its original key and attaches the upload ID.
 */
export async function createUpload(
  deps: UploadDeps,
  creatorId: string,
  input: unknown,
): Promise<Result<CreatedUpload, UploadError>> {
  if (scriptTooLong(input)) return err("script_too_long");
  const parsed = uploadCreateSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const { fileName, sizeBytes, container, backgroundId: chosen, source, script } = parsed.data;
  if (sizeBytes > MEDIA_LIMITS.maxBytes) return err("too_large");
  const now = deps.now?.() ?? new Date();

  // Lock the creator's row so parallel requests can't both slip under the limit.
  const created = await runTx(deps.db, async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, creatorId)).for("update");
    // Lock order (src/db/AGENTS.md): creator, then the background (key share, so a delete waits
    // for this take), then the take. Built ins and the creator's own ready backgrounds only.
    let backgroundId: string | null = null;
    if (chosen !== undefined && chosen !== "original") {
      const [bg] = await tx
        .select({ id: background.id, status: background.status })
        .from(background)
        .where(
          and(
            eq(background.id, chosen),
            or(isNull(background.creatorId), eq(background.creatorId, creatorId)),
          ),
        )
        .for("key share");
      if (!bg) return err("background_not_found" as const);
      if (bg.status !== "ready") return err("background_not_ready" as const);
      backgroundId = bg.id;
    }
    const [recent] = await tx
      .select({ n: count() })
      .from(take)
      .where(
        and(eq(take.creatorId, creatorId), gt(take.createdAt, new Date(now.getTime() - 3_600_000))),
      );
    if ((recent?.n ?? 0) >= UPLOAD.perHourLimit) return err("rate_limited" as const);
    const made = await create(tx, {
      creatorId,
      fileName,
      container,
      bytes: sizeBytes,
      source,
      script: cleanScript(script) ?? undefined,
    });
    if (!made.ok) return err("invalid" as const);
    if (chosen !== undefined) {
      // The take's background and the creator's next default, in the same transaction.
      await tx.update(take).set({ backgroundId }).where(eq(take.id, made.data.id));
      await tx
        .update(user)
        .set({ defaultBackgroundId: backgroundId })
        .where(eq(user.id, creatorId));
    }
    return ok(made.data);
  });
  if (!created.ok) return created;
  const t = created.data;

  let uploadId: string;
  try {
    uploadId = await deps.r2.createMultipartUpload(t.originalKey, containerContentType(container));
  } catch {
    await transitionTake(deps.db, t.id, "uploading", "failed", { failureCode: "internal_error" });
    return err("storage_error");
  }
  const attached = await attachUpload(deps.db, creatorId, t.id, uploadId);
  if (!attached.ok) return err("storage_error");

  return ok({ takeId: t.id, partSize: UPLOAD.partSize, partCount: partCount(sizeBytes) });
}
