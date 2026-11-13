import type { OriginalState } from "./use-original-source";

/** The one line under the player about which video plays (spec 0011 AC-3). */
export function playerNotice(active: "original" | "render", state: OriginalState): string | null {
  if (state.kind === "unplayable")
    return "Preview isn’t available for this file. Render to hear it.";
  if (state.kind === "failed") return "Couldn’t load the preview. Try again.";
  if (active === "original") return "Previewing your cuts on the original recording.";
  return null;
}
