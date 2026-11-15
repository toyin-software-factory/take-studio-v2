import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { background, take as takeTable } from "@/db/schema";
import { createCreator } from "@/db/testing/test-db";
import {
  seedRun,
  good,
  reply,
  io,
  editsOf,
  run,
  testDb,
  db,
  registerDb,
} from "./ai-edit-step.support";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

registerDb("take_studio_test_ai_edit_background");

/** Spec 0012 part 6 (AC-5, AC-8): the built in catalog in the request and the suggestion. */
describe("aiEditStep background suggestion", () => {
  const NAME_SECRET = "My private upload name";

  async function seedBackgrounds() {
    const creator = await createCreator(testDb.db);
    const mk = (over: Partial<typeof background.$inferInsert>) => ({
      id: crypto.randomUUID(),
      name: "Loft",
      alt: "A bright loft",
      status: "ready",
      imageKey: "backgrounds/x/image.jpg",
      thumbKey: "backgrounds/x/thumb.webp",
      width: 1920,
      height: 1080,
      ...over,
    });
    const builtIn = mk({ name: "Sunny loft", alt: "A sunny loft with plants" });
    const notReady = mk({ name: "Half done", status: "processing" });
    const upload = mk({ name: NAME_SECRET, creatorId: creator.id });
    await testDb.db.insert(background).values([builtIn, notReady, upload]);
    return { builtIn, notReady, upload };
  }

  const suggestionOf = async (takeId: string) =>
    (
      await db
        .select({
          id: takeTable.suggestedBackgroundId,
          reason: takeTable.suggestionReason,
        })
        .from(takeTable)
        .where(eq(takeTable.id, takeId))
    )[0];

  it("sends only ready built in backgrounds (ID, name, alt), never an upload", async () => {
    const { builtIn, notReady, upload } = await seedBackgrounds();
    const { ctx } = await seedRun();
    const { value, call } = io();
    await run(ctx, value);
    const user = call.mock.calls[0]?.[0]?.user ?? "";
    expect(user).toContain(`${builtIn.id}|Sunny loft|A sunny loft with plants`);
    for (const hidden of [notReady.id, upload.id, NAME_SECRET]) expect(user).not.toContain(hidden);
  });

  it("stores a valid suggestion with its reason in the same write as the cuts", async () => {
    const { builtIn } = await seedBackgrounds();
    const { ctx, take } = await seedRun();
    const answer = { ...good, background: { id: builtIn.id, reason: "Warm and bright, like you" } };
    const { value } = io({ call: async () => reply(answer) });
    expect((await run(ctx, value)).status).toBe("succeeded");
    expect(await suggestionOf(take.id)).toEqual({
      id: builtIn.id,
      reason: "Warm and bright, like you",
    });
  });

  it("a bad ID gives no suggestion and the rest of the answer still applies", async () => {
    await seedBackgrounds();
    const { ctx, take } = await seedRun();
    const answer = { ...good, background: { id: crypto.randomUUID(), reason: "Nice one" } };
    const { value } = io({ call: async () => reply(answer) });
    expect((await run(ctx, value)).status).toBe("succeeded");
    expect(await suggestionOf(take.id)).toEqual({ id: null, reason: null });
    expect((await editsOf(take.id))?.length).toBe(1);
  });

  it("an upload or a not ready background is not a valid suggestion", async () => {
    const { upload, notReady } = await seedBackgrounds();
    for (const id of [upload.id, notReady.id]) {
      const { ctx, take } = await seedRun();
      const { value } = io({
        call: async () => reply({ ...good, background: { id, reason: "Looks good" } }),
      });
      await run(ctx, value);
      expect(await suggestionOf(take.id)).toEqual({ id: null, reason: null });
    }
  });

  it("a fallback clears a suggestion stored earlier", async () => {
    const { builtIn } = await seedBackgrounds();
    const { ctx, take } = await seedRun();
    await db
      .update(takeTable)
      .set({ suggestedBackgroundId: builtIn.id, suggestionReason: "Old reason" })
      .where(eq(takeTable.id, take.id));
    const { value } = io({ call: async () => reply("not json") });
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(await suggestionOf(take.id)).toEqual({ id: null, reason: null });
  });

  it("the reason column refuses more than 280 characters", async () => {
    const { take } = await seedRun();
    await expect(
      db
        .update(takeTable)
        .set({ suggestionReason: "x".repeat(281) })
        .where(eq(takeTable.id, take.id)),
    ).rejects.toThrow();
  });
});
