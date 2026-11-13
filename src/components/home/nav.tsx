import Link from "next/link";
import { NAV_LINKS } from "./content";
import { HomeMenu } from "./menu";

/** The wordmark: a rounded square with a play mark, and the name. */
export function Logo() {
  return (
    <a className="h-logo" href="#top" aria-label="Take Studio, home">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
        <path d="M9.5 7.5v9l7-4.5z" className="h-logo-play" />
      </svg>
      <span>Take Studio</span>
    </a>
  );
}

/**
 * The top bar (spec 0010, AC-1). Static for now: fixed at the top, links on wide screens, sign
 * in and the main call to action everywhere. The floating pill, dark variant and mobile menu
 * dialog come with the motion work (AC-4).
 */
export function HomeNav() {
  return (
    <header className="h-nav" id="nav" data-check="header">
      <Logo />
      <nav className="h-nav-links" aria-label="Main" data-check="nav">
        {NAV_LINKS.map((l) => (
          <a key={l.href} className="h-link" href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
      <div className="h-nav-actions">
        <Link className="h-link h-nav-signin" href="/sign-in">
          sign in
        </Link>
        <span className="h-nav-divider" aria-hidden="true" />
        <Link className="h-btn h-btn-nav" href="/sign-in">
          <span className="h-cta-long">Upload a take</span>
          <span className="h-cta-short">Start</span>
        </Link>
        <HomeMenu />
      </div>
    </header>
  );
}
