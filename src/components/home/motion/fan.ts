import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE } from "./eases";
import { fanStore } from "./fan-state";

const STEP = 13;

/**
 * The hero fan (recipe 7.2). The cards leave their plain row (`is-fan`) and sit on a wheel at 13
 * degree steps. Without reduced motion the wheel turns one step every 4 s, in an endless loop
 * that runs only while the fan is on screen, the tab is visible and the visitor has not paused
 * it with the button (WCAG 2.2.2; `fanStore`). Under reduced motion the fan is a still picture
 * and there is no button. Returns a function that runs the loop's pieces down.
 */
export function setupFan(
  root: HTMLElement,
  reduced: boolean,
): { readonly intro: gsap.core.Tween | null; readonly stop: () => void } {
  const fan = root.querySelector<HTMLElement>(".h-fan");
  const cards = gsap.utils.toArray<HTMLElement>(".h-fan-card", fan ?? root);
  if (!fan || cards.length === 0) return { intro: null, stop: () => undefined };
  fan.classList.add("is-fan");

  const count = cards.length;
  const mid = Math.floor(count / 2);
  const limit = (count / 2) * STEP;
  cards.forEach((card, i) =>
    gsap.set(card, { rotation: (i - mid) * STEP, zIndex: 100 + (i - mid) }),
  );
  if (reduced) return { intro: null, stop: () => fan.classList.remove("is-fan") };

  // Opening: from a stack to the fan angles (900 ms into the page load, snap ease).
  const intro = gsap.from(cards, {
    rotation: 0,
    duration: 0.8,
    delay: 0.9,
    ease: EASE.snap,
    stagger: { each: 0.03, from: "center" },
  });

  const loop = gsap.timeline({
    repeat: -1,
    repeatRefresh: true,
    delay: 1.7,
    paused: true,
    onUpdate: () =>
      cards.forEach((card) => {
        card.style.zIndex = String(100 + Math.round(Number(gsap.getProperty(card, "rotation"))));
      }),
  });
  loop.to(cards, {
    rotation: `+=${STEP}`,
    duration: 4,
    ease: EASE.loop,
    modifiers: { rotation: gsap.utils.unitize(gsap.utils.wrap(-limit, limit)) },
  });

  let inView = false;
  const sync = () => {
    const run = inView && !document.hidden && !fanStore.get().paused;
    if (run) loop.play();
    else loop.pause();
  };
  const trigger = ScrollTrigger.create({
    trigger: fan,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => {
      inView = self.isActive;
      sync();
    },
  });
  const unsubscribe = fanStore.subscribe(sync);
  document.addEventListener("visibilitychange", sync);
  fanStore.setReady(true);
  sync();

  return {
    intro,
    stop: () => {
      fanStore.setReady(false);
      unsubscribe();
      document.removeEventListener("visibilitychange", sync);
      trigger.kill();
      loop.kill();
      fan.classList.remove("is-fan");
    },
  };
}
