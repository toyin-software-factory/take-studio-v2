import { listenForEarlyErrors } from "@/lib/browser-errors";

// Browser errors (spec 0005, AC-2). The Sentry SDK is about 100 KB of the first load, so it is
// loaded after the page is idle (spec 0010 AC-10). Until then uncaught errors and unhandled
// rejections are queued, and the SDK reports them when it starts, so nothing thrown during load
// is lost. The SDK installs its own handlers, so the early ones are removed once it is ready.
const stopEarly = listenForEarlyErrors(window);

const loadSentry = () => {
  import("@/lib/sentry-browser")
    .then(({ startSentryBrowser }) => {
      startSentryBrowser();
      stopEarly();
    })
    .catch(() => undefined);
};

const afterIdle = () => {
  if ("requestIdleCallback" in window) window.requestIdleCallback(loadSentry, { timeout: 4000 });
  else setTimeout(loadSentry, 1);
};

if (document.readyState === "complete") afterIdle();
else window.addEventListener("load", afterIdle, { once: true });
