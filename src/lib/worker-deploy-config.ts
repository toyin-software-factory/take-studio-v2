import { z } from "zod";

/**
 * The deploy config for a Worker bundle that is already built (spec 0005, AC-6).
 * Wrangler ignores wrangler.jsonc when it is given a file path, so the bindings (Hyperdrive,
 * the self reference, assets) would be lost. This keeps everything in wrangler.jsonc and only
 * points `main` at the final bundle and turns bundling off. The result sits in the bundle's own
 * folder, so the entry is `worker.js` and relative paths gain one `../`.
 */
const wranglerConfig = z.looseObject({
  main: z.string().min(1),
  assets: z.looseObject({ directory: z.string().min(1) }),
});

export type BuiltWorkerConfig =
  | { readonly ok: true; readonly data: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

const fromBundleFolder = (path: string): string =>
  path.startsWith("/") ? path : `../${path.replace(/^\.\//, "")}`;

export function builtWorkerConfig(config: unknown): BuiltWorkerConfig {
  const parsed = wranglerConfig.safeParse(config);
  if (!parsed.success) {
    return { ok: false, error: "wrangler.jsonc needs `main` and `assets.directory`." };
  }
  return {
    ok: true,
    data: {
      ...parsed.data,
      main: "worker.js",
      no_bundle: true,
      assets: { ...parsed.data.assets, directory: fromBundleFolder(parsed.data.assets.directory) },
    },
  };
}
