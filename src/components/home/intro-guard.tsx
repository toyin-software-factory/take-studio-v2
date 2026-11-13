/**
 * Runs before the first paint: when scripts run and the visitor allows motion, marks `<html>` so
 * `home.css` hides the bar, headline and lead until the intro takes over (home-v2 load motion).
 * Without scripts the script never runs, and under reduced motion it does nothing, so the text
 * shows at once in both cases. The intro removes the mark; if the bundle never starts, a 3 s timer removes it so the text is never left hidden.
 */
const GUARD =
  'var d=document.documentElement;if(!matchMedia("(prefers-reduced-motion: reduce)").matches){d.classList.add("h-intro-pending");setTimeout(function(){d.classList.remove("h-intro-pending")},3000)}';

export function IntroGuard() {
  return <script dangerouslySetInnerHTML={{ __html: GUARD }} />;
}
