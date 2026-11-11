import { describe, expect, it } from "vitest";
import { builtWorkerConfig } from "./worker-deploy-config";

const config = {
  name: "take-studio",
  main: "src/worker.ts",
  assets: { directory: ".open-next/assets", binding: "ASSETS" },
  services: [{ binding: "WORKER_SELF_REFERENCE", service: "take-studio" }],
  hyperdrive: [{ binding: "HYPERDRIVE", id: "abc" }],
};

describe("builtWorkerConfig", () => {
  it("points main at the built bundle and turns bundling off", () => {
    const result = builtWorkerConfig(config);
    expect(result).toMatchObject({ ok: true, data: { main: "worker.js", no_bundle: true } });
  });

  it("keeps every binding and setting from wrangler.jsonc", () => {
    const result = builtWorkerConfig(config);
    expect(result).toMatchObject({
      ok: true,
      data: { name: "take-studio", services: config.services, hyperdrive: config.hyperdrive },
    });
  });

  it("moves the assets folder to be relative to the bundle's folder", () => {
    expect(builtWorkerConfig(config)).toMatchObject({
      ok: true,
      data: { assets: { directory: "../.open-next/assets", binding: "ASSETS" } },
    });
    expect(builtWorkerConfig({ ...config, assets: { directory: "./public" } })).toMatchObject({
      ok: true,
      data: { assets: { directory: "../public" } },
    });
  });

  it("leaves an absolute assets folder alone", () => {
    expect(builtWorkerConfig({ ...config, assets: { directory: "/srv/assets" } })).toMatchObject({
      ok: true,
      data: { assets: { directory: "/srv/assets" } },
    });
  });

  it("does not change its input", () => {
    const before = structuredClone(config);
    builtWorkerConfig(config);
    expect(config).toEqual(before);
  });

  it.each([{}, { main: "src/worker.ts" }, { main: "", assets: { directory: "a" } }, null])(
    "refuses a config without main and assets.directory: %j",
    (bad) => {
      expect(builtWorkerConfig(bad)).toMatchObject({ ok: false });
    },
  );
});
