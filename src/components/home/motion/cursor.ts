import { gsap } from "gsap";

/**
 * Cursor follower (recipe 7.14): a small dot trails the pointer, and over `[data-cursor="play"]`
 * (the capability tiles) it grows into a lime disc labelled "Play" or "Pause" from the video's
 * state. Only for a fine pointer with motion allowed; the real cursor stays. `aria-hidden`.
 */
export function setupCursor(root: HTMLElement): () => void {
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!fine) return () => undefined;
  const dot = document.createElement("div");
  dot.className = "h-cursor";
  dot.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  dot.append(label);
  document.body.append(dot);
  gsap.set(dot, { xPercent: -50, yPercent: -50, opacity: 0 });
  const x = gsap.quickTo(dot, "x", { duration: 0.35, ease: "power3.out" });
  const y = gsap.quickTo(dot, "y", { duration: 0.35, ease: "power3.out" });

  let over: HTMLElement | null = null;
  const refresh = () => {
    if (over) label.textContent = over.dataset.playing === "true" ? "Pause" : "Play";
  };
  // The tile's own `data-playing` follows the video's events, which do not bubble: listen in
  // the capture phase, then read it on the next frame so React has updated the attribute.
  const onMedia = () => requestAnimationFrame(refresh);

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    x(event.clientX);
    y(event.clientY);
    gsap.to(dot, { opacity: 1, duration: 0.2, overwrite: "auto" });
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-cursor="play"]',
    );
    over = target ?? null;
    dot.classList.toggle("is-play", Boolean(target));
    refresh();
  };
  const onLeave = () => gsap.to(dot, { opacity: 0, duration: 0.2 });
  root.addEventListener("pointermove", onMove);
  document.addEventListener("play", onMedia, true);
  document.addEventListener("pause", onMedia, true);
  document.addEventListener("pointerleave", onLeave);
  return () => {
    root.removeEventListener("pointermove", onMove);
    document.removeEventListener("play", onMedia, true);
    document.removeEventListener("pause", onMedia, true);
    document.removeEventListener("pointerleave", onLeave);
    dot.remove();
  };
}
