import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE } from "./eases";
import { fanStore } from "./fan-state";

const STEP = 13;

/**
 * Keeps the cards that are off the panel out of the tab order (their links stay reachable from
 * the page's own navigation), so keyboard focus never lands on a card nobody can see. Watches
 * with an IntersectionObserver, which follows the cards as the wheel turns. Returns a teardown.
 */
function keepVisibleCardsFocusable(fan: HTMLElement, cards: HTMLElement[]): () => void {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.6;
        if (visible) entry.target.removeAttribute("tabindex");
        else entry.target.setAttribute("tabindex", "-1");
      }),
    { root: fan, threshold: [0, 0.6, 1] },
  );
  cards.forEach((card) => io.observe(card));
  return () => {
    io.disconnect();
    cards.forEach((card) => card.removeAttribute("tabindex"));
  };
}

/**
 * The hero fan (recipe 7.2). The cards leave their plain row (`is-fan`) and sit on a wheel at 13
 * degree steps. Without reduced motion the wheel turns one step every 4 s, in an endless loop
 * that runs only while the fan is on screen, the tab is visible, no card has keyboard focus (a
 * focused card stays put and visible) and the visitor has not paused it with the button (WCAG
 * 2.2.2; `fanStore`). A pause also settles the opening animation. Under reduced motion the fan
 * is a still picture and there is no button. Returns a function that runs the pieces down.
 */
export function setupFan(root: HTMLElement, reduced: boolean): { readonly stop: () => void } {
  const fan = root.querySelector<HTMLElement>(".h-fan");
  const cards = gsap.utils.toArray<HTMLElement>(".h-fan-card", fan ?? root);
  if (!fan || cards.length === 0) return { stop: () => undefined };
  fan.classList.add("is-fan");

  const count = cards.length;
  const mid = Math.floor(count / 2);
  const limit = (count / 2) * STEP;
  cards.forEach((card, i) =>
    gsap.set(card, { rotation: (i - mid) * STEP, zIndex: 100 + (i - mid) }),
  );
  const stopFocusable = keepVisibleCardsFocusable(fan, cards);
  if (reduced) {
    return {
      stop: () => {
        stopFocusable();
        fan.classList.remove("is-fan");
      },
    };
  }

  // The visitor's earlier choice (this visit) is read before anything moves.
  fanStore.setReady(true);

  // Opening: from a stack to the fan angles (900 ms into the page load, snap ease). A fan that
  // is paused does not open by itself: the cards stay on the wheel.
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

  // Only the cards count (the pause button is in the fan panel too and must not hold the loop).
  const list = fan.querySelector<HTMLElement>(".h-fan-list") ?? fan;
  let inView = false;
  let focusInside = false;
  const sync = () => {
    const paused = fanStore.get().paused;
    // Pausing settles the opening tween at its end, so nothing keeps moving behind the button.
    if (paused && intro.progress() < 1) intro.progress(1);
    const run = inView && !document.hidden && !paused && !focusInside;
    if (run) loop.play();
    else loop.pause();
  };
  const onFocusIn = () => {
    focusInside = true;
    sync();
  };
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && list.contains(event.relatedTarget)) return;
    focusInside = false;
    sync();
  };
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("focusout", onFocusOut);
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
  sync();

  return {
    stop: () => {
      fanStore.setReady(false);
      unsubscribe();
      document.removeEventListener("visibilitychange", sync);
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
      trigger.kill();
      loop.kill();
      intro.kill();
      stopFocusable();
      fan.classList.remove("is-fan");
    },
  };
}
