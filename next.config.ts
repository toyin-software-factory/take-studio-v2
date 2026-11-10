import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Root AGENTS.md is owned by /audit, so `next dev` must not write one.
  agentRules: false,
  // No image optimisation service on Workers (spec 0001, Runtime rules).
  images: { unoptimized: true },
};

export default nextConfig;

// Gives `next dev` the Worker bindings (Hyperdrive) from wrangler.jsonc.
void initOpenNextCloudflareForDev();
