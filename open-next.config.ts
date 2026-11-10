import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: this app uses no ISR or `revalidate` (spec 0001, Runtime rules).
export default defineCloudflareConfig({});
