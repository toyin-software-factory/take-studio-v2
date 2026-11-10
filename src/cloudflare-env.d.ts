// Worker bindings from wrangler.jsonc. Secrets and vars reach the app through process.env
// and are validated by src/lib/env.ts.
declare global {
  interface CloudflareEnv {
    HYPERDRIVE: { connectionString: string };
  }
}

export {};
