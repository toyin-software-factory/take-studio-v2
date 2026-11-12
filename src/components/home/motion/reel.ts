import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** Scroll distance over which the reel opens from its corner to full bleed (recipe 7.5). */
export const REEL_SCRUB_PX = 806;

/** `clip-path` that shows exactly the corner slot, measured when the trigger refreshes. */
function slotInset(sticky: HTMLElement, slot: HTMLElement): string {
  const s = slot.getBoundingClientRect();
  const b = sticky.getBoundingClientRect();
  return `inset(${s.top - b.top}px ${b.right - s.right}px ${b.bottom - s.bottom}px ${s.left - b.left}px round 10px)`;
}

/**
 * The reel (recipe 7.5). At 810 px and up, with motion allowed, the section pins and the video
 * opens from the corner thumbnail to full bleed over 806 px of scroll (clip-path, the video
 * easing from 1.15 to 1, the title fading), and the video plays while the section is on screen
 * unless the visitor paused it with its button (WCAG 2.2.2). Below 810 px, or under reduced
 * motion, the reel is the plain inline 16:9 video that starts only when the visitor presses
 * play. Done with `gsap.matchMedia`, so a resize switches layouts and cleans up.
 */
export function setupReel(root: HTMLElement): gsap.MatchMedia {
  const reel = root.querySelector<HTMLElement>(".h-reel");
  const sticky = root.querySelector<HTMLElement>(".h-reel-sticky");
  const slot = root.querySelector<HTMLElement>(".h-reel-slot");
  const media = root.querySelector<HTMLElement>(".h-reel-media");
  const video = root.querySelector<HTMLVideoElement>(".h-reel-media video");
  const mm = gsap.matchMedia();
  if (!reel || !sticky || !slot || !media || !video) return mm;

  mm.add("(min-width: 810px) and (prefers-reduced-motion: no-preference)", () => {
    reel.classList.add("is-scrub");
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: reel,
        start: "top top",
        end: `+=${REEL_SCRUB_PX}`,
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
    tl.fromTo(
      media,
      { clipPath: () => slotInset(sticky, slot) },
      { clipPath: "inset(0px 0px 0px 0px round 0px)", ease: "none" },
      0,
    )
      .fromTo(video, { scale: 1.15 }, { scale: 1, ease: "none" }, 0)
      .to(".h-reel-title", { opacity: 0, ease: "none", duration: 0.4 }, 0);

    const player = ScrollTrigger.create({
      trigger: reel,
      start: "top bottom",
      end: "bottom top",
      onToggle: (self) => {
        // A visitor's own pause is kept: only an unpaused reel follows the scroll.
        if (self.isActive && !video.dataset.userPaused) video.play().catch(() => undefined);
        else video.pause();
      },
    });
    return () => {
      player.kill();
      video.pause();
      reel.classList.remove("is-scrub");
      gsap.set([media, video, ".h-reel-title"], { clearProps: "all" });
    };
  });
  return mm;
}
