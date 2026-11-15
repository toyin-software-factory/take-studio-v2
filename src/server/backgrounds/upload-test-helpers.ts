// Spec 0008, AC-8 to AC-10: POST /api/backgrounds, its /complete and DELETE.
export const ORIGIN = "https://take-studio.example";
export type Calls = {
  signed: { key: string; contentType: string; bytes: number }[];
  ingested: string[];
  drains: number;
};
export const req = (method: string, body?: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/backgrounds`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export const GOOD = { name: "My wall", contentType: "image/jpeg", bytes: 2_000_000 };
