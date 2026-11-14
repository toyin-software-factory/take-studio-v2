/** The part of an AudioContext this needs, so a test can pass a small fake. */
export type ResumableContext = {
  readonly state: string;
  resume: () => Promise<void>;
  addEventListener: (type: "statechange", listener: () => void) => void;
  removeEventListener: (type: "statechange", listener: () => void) => void;
};

/**
 * A browser can start an AudioContext "suspended" (autoplay rules, a Bluetooth or call
 * interruption), and a suspended context reads silence. Resume it now, again whenever it is
 * suspended later, and on the next tap or key if the browser refused. Returns the cleanup.
 */
export function keepRunning(
  context: ResumableContext,
  target: Pick<Document, "addEventListener" | "removeEventListener"> | null = typeof document ===
  "undefined"
    ? null
    : document,
): () => void {
  const resume = () => {
    if (context.state === "suspended" || context.state === "interrupted") {
      void context.resume().catch(() => undefined);
    }
  };
  const events = ["pointerdown", "keydown"] as const;
  context.addEventListener("statechange", resume);
  events.forEach((name) => target?.addEventListener(name, resume));
  resume();
  return () => {
    context.removeEventListener("statechange", resume);
    events.forEach((name) => target?.removeEventListener(name, resume));
  };
}
