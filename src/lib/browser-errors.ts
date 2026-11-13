/**
 * Browser error reporting that does not ship the Sentry SDK in the first load (spec 0010 AC-10).
 * Errors that happen before the SDK is loaded are kept in a small queue and handed to it once it
 * is ready, so nothing thrown during load is lost. This file imports no Sentry code.
 */
export type ErrorReporter = (error: unknown) => void;

type State = {
  reporter: ErrorReporter | null;
  queue: unknown[];
};

/** Most errors kept while waiting; a page in an error loop must not grow memory without end. */
export const MAX_QUEUED_ERRORS = 20;

const state: State = { reporter: null, queue: [] };

/** Reports an error now if the SDK is loaded, otherwise queues it for when it is. */
export function reportBrowserError(error: unknown): void {
  if (state.reporter) {
    state.reporter(error);
    return;
  }
  if (state.queue.length < MAX_QUEUED_ERRORS) state.queue.push(error);
}

/** Connects the loaded SDK and replays what was queued, oldest first. */
export function setBrowserReporter(reporter: ErrorReporter): void {
  state.reporter = reporter;
  const pending = state.queue;
  state.queue = [];
  pending.forEach((error) => reporter(error));
}

/** Test helper: forget the reporter and the queue. */
export function resetBrowserErrors(): void {
  state.reporter = null;
  state.queue = [];
}

/** The thrown value of a window `error` event, or one made from its message. */
export function errorFromEvent(event: ErrorEvent): unknown {
  return event.error ?? new Error(event.message || "Unknown error");
}

/**
 * Listens for uncaught errors and unhandled rejections until `stop` is called. Returns `stop`.
 * The loaded SDK installs its own handlers, so these are removed once it is ready.
 */
export function listenForEarlyErrors(target: Window): () => void {
  const onError = (event: ErrorEvent) => reportBrowserError(errorFromEvent(event));
  const onRejection = (event: PromiseRejectionEvent) => reportBrowserError(event.reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
