/**
 * Runs before the first paint: when scripts run and the visitor allows motion, marks `<html>` so
 * `home.css` hides the bar, headline and lead until the intro takes over (home-v2 load motion).
 * Without scripts the script never runs, and under reduced motion it does nothing, so the text
 * shows at once in both cases. The intro (or a CSS failsafe after 3 s) removes the mark.
 */
const GUARD =
  'if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("h-intro-pending")';

export function IntroGuard() {
  return <script dangerouslySetInnerHTML={{ __html: GUARD }} />;
}
