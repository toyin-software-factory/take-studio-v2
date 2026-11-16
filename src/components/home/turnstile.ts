"use client";

/**
 * The Cloudflare Turnstile widget for the drop box (spec 0023, AC-1). It runs on demand, when
 * a file is chosen: the script loads then, not with the page. Managed mode with
 * `interaction-only` shows nothing unless Cloudflare needs the visitor to do something.
 */

type Widget = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      execution: "execute";
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Widget;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Widget> | null = null;

function load(): Promise<Widget> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Widget>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("no widget"));
    script.onerror = () => {
      loading = null;
      reject(new Error("script"));
    };
    document.head.append(script);
  });
  return loading;
}

/** One fresh token, or null when the check could not run. Each token is used once. */
export async function turnstileToken(siteKey: string, mount: HTMLElement): Promise<string | null> {
  let widget: Widget;
  try {
    widget = await load();
  } catch {
    return null;
  }
  return new Promise<string | null>((resolve) => {
    const id = widget.render(mount, {
      sitekey: siteKey,
      execution: "execute",
      appearance: "interaction-only",
      callback: (token) => {
        resolve(token);
        widget.remove(id);
      },
      "error-callback": () => {
        resolve(null);
        widget.remove(id);
      },
      "expired-callback": () => resolve(null),
    });
    widget.execute(id);
  });
}
