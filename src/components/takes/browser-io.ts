"use client";

import { PartError, type ApiReply, type UploadIo } from "@/lib/upload-client";

/**
 * The browser side I/O: JSON calls to our API, part PUTs to R2 with `XMLHttpRequest` (fetch
 * has no upload progress), the clock and an abortable sleep.
 */

/** A JSON request to our own API. The body, if any, is sent as JSON; `data` is null if none. */
export async function callApi(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<ApiReply> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  return { status: response.status, data };
}

function putPart(
  url: string,
  body: Blob,
  onSent: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => onSent(event.loaded);
    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort);
      // R2 CORS exposes ETag (spec 0004, Security model); quotes are stripped here.
      const etag = xhr.getResponseHeader("ETag")?.replaceAll('"', "").trim();
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new PartError(xhr.status));
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new PartError(0));
    };
    xhr.onabort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    xhr.send(body);
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const browserUploadIo: UploadIo = {
  api: (path, method, body) => callApi(path, method, body),
  putPart,
  now: () => Date.now(),
  sleep,
};
