/**
 * Full screen for a video, across browsers: the standard `requestFullscreen` (desktop, Android),
 * the old WebKit prefix, and `webkitEnterFullscreen` (iPhone Safari has no `requestFullscreen`
 * on a video, only this one, which opens its native player). Pure: the element is passed in.
 */

/** The three methods a video may have; each browser has some of them. */
export type FullscreenTarget = {
  readonly requestFullscreen?: () => Promise<void> | void;
  readonly webkitRequestFullscreen?: () => Promise<void> | void;
  readonly webkitEnterFullscreen?: () => Promise<void> | void;
};

const METHODS = ["requestFullscreen", "webkitRequestFullscreen", "webkitEnterFullscreen"] as const;

/** The first method the element has, bound to it, or null when it has none. */
export function pickFullscreen(target: FullscreenTarget): (() => Promise<void> | void) | null {
  for (const name of METHODS) {
    const method = target[name];
    if (typeof method === "function") return () => method.call(target);
  }
  return null;
}

/** Enters full screen with the first available method. False when there is none or it fails. */
export async function enterFullscreen(
  target: FullscreenTarget | null | undefined,
): Promise<boolean> {
  const enter = target ? pickFullscreen(target) : null;
  if (!enter) return false;
  try {
    await enter();
    return true;
  } catch {
    return false;
  }
}
