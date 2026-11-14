import { API_KEYS, API_RATE } from "./api-rules";
import { API_VERSION } from "./api-openapi";
import { MEDIA_LIMITS } from "./take-rules";
import { UPLOAD } from "./uploads";
import { FREE_MONTHLY_SECONDS_DEFAULT } from "./usage-rules";
import type { ApiRoute } from "./api-registry";

/**
 * The words on `/docs/api` that are not a route list (spec 0018 AC-11): how to sign in, the limits,
 * the error codes and the worked example. Pure data, so a test can check each against the rules it
 * quotes. The route tables come from the registry, never from here.
 */

export { API_VERSION };

export const API_VERSION_NOTE =
  "This is v1. Changes are additive: we add routes and fields, and never remove or rename one. A breaking change gets a new version path.";

export const API_AUTH_STEPS: readonly string[] = [
  "Make a key on the API keys screen (open your account menu, then API keys).",
  "Copy it when it appears. You won't see it again, so keep it secret like a password.",
  "Send it on every request as `Authorization: Bearer tsk_…`.",
];

export const API_LIMITS: readonly string[] = [
  `Each creator can hold ${API_KEYS.maxPerCreator} keys at once.`,
  `Each key can make ${API_RATE.perMinute} requests a minute. The next one gets 429 \`rate_limited\` with a \`Retry-After\` header in seconds.`,
  `A key can do what you can do: the same ${FREE_MONTHLY_SECONDS_DEFAULT / 60} free minutes a month, ${UPLOAD.perHourLimit} uploads an hour, and the same permissions. Another creator's takes are always 404.`,
  "Keys can't make keys, list keys or delete your account. Do those in the app.",
];

export type ApiErrorDoc = {
  readonly code: string;
  readonly status: number;
  readonly meaning: string;
};

export const API_ERRORS: readonly ApiErrorDoc[] = [
  { code: "invalid_api_key", status: 401, meaning: "No key, or the key is wrong or revoked." },
  {
    code: "rate_limited",
    status: 429,
    meaning: "Too many requests for this key in a minute, or too many uploads started in an hour.",
  },
  { code: "limit_exceeded", status: 403, meaning: "This would pass your monthly free allowance." },
  {
    code: "not_found",
    status: 404,
    meaning: "There is no such take, upload, background or job for you.",
  },
  {
    code: "invalid",
    status: 422,
    meaning: "The body or the query is not valid. The message says what to fix.",
  },
  {
    code: "too_large",
    status: 422,
    meaning: `The video is over ${MEDIA_LIMITS.maxBytes / 1024 ** 3} GB.`,
  },
  {
    code: "not_uploading",
    status: 409,
    meaning: "The upload has already finished or been cancelled.",
  },
  { code: "storage_error", status: 503, meaning: "Storage is having a problem. Try again." },
];

export const API_ERROR_SHAPE =
  '{ "error": "not_found", "message": "We couldn\'t find that take." }';

export type UploadStep = {
  readonly title: string;
  readonly text: string;
  readonly command: string;
};

/** Upload to download with `curl`: each command reads the one before it. `BASE` is the site address. */
export const UPLOAD_STEPS: readonly UploadStep[] = [
  {
    title: "Start the upload",
    text: "Say which file you are sending. You get a take ID, the part size in bytes and how many parts to send.",
    command: `curl -s -X POST "$BASE/api/uploads" \\
  -H "Authorization: Bearer $TAKE_STUDIO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"fileName":"take.mp4","sizeBytes":52428800,"container":"mp4"}'
# {"takeId":"…","partSize":…,"partCount":…}`,
  },
  {
    title: "Get links for the parts",
    text: "Ask for the part numbers you want to send (up to the part count). The links last 15 minutes.",
    command: `curl -s -X POST "$BASE/api/uploads/$TAKE_ID/parts" \\
  -H "Authorization: Bearer $TAKE_STUDIO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"partNumbers":[1]}'
# {"parts":[{"partNumber":1,"url":"…"}],"expiresInSeconds":900}`,
  },
  {
    title: "Send each part",
    text: "PUT the bytes of each part to its link. This goes to storage, not to us, so send no key. Keep the ETag header the reply gives back.",
    command: `curl -s -D - -X PUT --data-binary @part-1.bin "$PART_URL"
# ETag: "…"`,
  },
  {
    title: "Finish the upload",
    text: "List every part with its ETag, in order. Processing starts.",
    command: `curl -s -X POST "$BASE/api/uploads/$TAKE_ID/complete" \\
  -H "Authorization: Bearer $TAKE_STUDIO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"parts":[{"partNumber":1,"etag":"\\"…\\""}]}'
# {"takeId":"…","status":"processing"}`,
  },
  {
    title: "Wait until it is ready",
    text: "Read the take now and then (every few seconds is plenty) until its status is ready. A failed status carries a failure code.",
    command: `curl -s "$BASE/api/takes/$TAKE_ID" \\
  -H "Authorization: Bearer $TAKE_STUDIO_KEY"
# status: "uploaded" → "processing" → "ready"`,
  },
  {
    title: "Get the video",
    text: "Ask for a download link. It is short lived, so use it right away.",
    command: `curl -s "$BASE/api/takes/$TAKE_ID/media?kind=download" \\
  -H "Authorization: Bearer $TAKE_STUDIO_KEY"
# {"url":"…","expiresInSeconds":…}
curl -L -o take-edited.mp4 "$DOWNLOAD_URL"`,
  },
];

export type RouteGroup = {
  readonly id: string;
  readonly title: string;
  readonly routes: readonly ApiRoute[];
};

const GROUPS: readonly { readonly id: string; readonly title: string; readonly prefix: RegExp }[] =
  [
    { id: "uploads", title: "Uploads", prefix: /^\/api\/uploads/ },
    { id: "transcripts", title: "Transcripts", prefix: /^\/api\/takes\/\{id\}\/transcript/ },
    {
      id: "changes",
      title: "Changes and backgrounds on a take",
      prefix: /^\/api\/takes\/\{id\}\/(changes|background|jobs|waveform|missed)/,
    },
    { id: "takes", title: "Takes", prefix: /^\/api\/takes/ },
    { id: "backgrounds", title: "Backgrounds", prefix: /^\/api\/backgrounds/ },
    { id: "account", title: "Account", prefix: /^\/api\/(account|usage)/ },
  ];

/** The registry as docs sections, in the order above. A route that fits no group goes to "More". */
export function groupRoutes(registry: readonly ApiRoute[]): readonly RouteGroup[] {
  const placed = new Set<ApiRoute>();
  const groups: RouteGroup[] = GROUPS.map((group) => {
    const routes = registry.filter((r) => !placed.has(r) && group.prefix.test(r.path));
    routes.forEach((r) => placed.add(r));
    return { id: group.id, title: group.title, routes };
  });
  const rest = registry.filter((r) => !placed.has(r));
  return [...groups, { id: "more", title: "More", routes: rest }].filter(
    (g) => g.routes.length > 0,
  );
}
