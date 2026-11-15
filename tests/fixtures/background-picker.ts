import { expect as baseExpect, type Page } from "@playwright/test";
import { removeBackgrounds, seedBackgrounds } from "../support/backgrounds";
import { signIn } from "../support/session";

// The upload area's Background select and picker dialog (spec 0008, AC-1, AC-12), against the
// real routes with seeded test backgrounds. The thumbnails are presigned R2 links, so they are
// answered with a tiny PNG here. Test users only.
// The first signed in page after a cold server start can take a while.
export const expect = baseExpect.configure({ timeout: 30_000 });

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export const cleanups: (() => Promise<void>)[] = [];

export async function signedInWithStudios(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  const [calm, warm] = await seedBackgrounds([
    { name: "Calm studio", minutesAgo: 20 },
    { name: "Warm studio", minutesAgo: 10 },
  ]);
  cleanups.push(cleanup, () => removeBackgrounds([calm!, warm!]));
  await page.route("**/backgrounds/test/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
  return { user, calm: calm!, warm: warm! };
}

export const select = (page: Page) => page.getByRole("button", { name: /Background/ });

// Uploading and deleting a background from the picker (spec 0008, AC-8, AC-10). The network is
// stubbed so each step and each message is exact; the real routes have their own tests.
export type Item = {
  id: string;
  name: string;
  alt: string;
  status: string;
  failureCode: string | null;
  thumbUrl: string | null;
};

export async function stubLibrary(
  page: Page,
  state: { mine: Item[]; calls: string[]; defaultId?: string | null; listStatus?: number },
) {
  await page.route("**/api/backgrounds", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      if (state.listStatus) return route.fulfill({ status: state.listStatus, json: {} });
      return route.fulfill({
        json: { builtIn: [], mine: state.mine, defaultId: state.defaultId ?? null },
      });
    }
    state.calls.push(`POST ${JSON.stringify(route.request().postDataJSON())}`);
    return route.fulfill({
      status: 201,
      json: { id: "11111111-1111-4111-8111-111111111111", uploadUrl: "https://r2.test/put-here" },
    });
  });
  await page.route("https://r2.test/put-here", (route) => {
    state.calls.push(`PUT ${route.request().headers()["content-type"]}`);
    return route.fulfill({ status: 200 });
  });
  await page.route("**/api/backgrounds/*/complete", (route) => {
    state.calls.push("COMPLETE");
    return route.fulfill({ json: { status: "processing" } });
  });
}

export const NEW_ID = "11111111-1111-4111-8111-111111111111";

export const readyItem = (name: string): Item => ({
  id: NEW_ID,
  name,
  alt: name,
  status: "ready",
  failureCode: null,
  thumbUrl: null,
});
