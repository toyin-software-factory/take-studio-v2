import Link from "next/link";
import { FOOTER } from "./content";

/** The footer: four columns, the retention note and the wordmark (the blur comes later). */
export function HomeFooter() {
  return (
    <footer className="h-footer" data-theme="dark" data-check="footer">
      <div className="h-container">
        <div className="h-footer-cols">
          {FOOTER.columns.map((col) => (
            <div key={col.label}>
              <p className="h-footer-label">{col.label}</p>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label + l.href}>
                    {l.href.startsWith("/") ? (
                      <Link href={l.href}>{l.label}</Link>
                    ) : (
                      <a href={l.href}>{l.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="h-footer-bar">
          <span>© {FOOTER.year} Take Studio</span>
          <span>{FOOTER.note}</span>
        </div>
      </div>
      <div className="h-footer-mark" aria-hidden="true">
        Take Studio
      </div>
    </footer>
  );
}
