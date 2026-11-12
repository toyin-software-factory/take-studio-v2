"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { NAV_LINKS } from "./content";

/**
 * The menu for narrow screens (spec 0010, AC-4): a burger button that opens a full screen
 * dialog with the links and the call to action. It is a native modal `<dialog>`: the page behind
 * is inert, Escape closes it and focus returns to the burger. A native dialog lets Tab leave to
 * the browser's own controls after the last link, so Tab wraps here to keep focus inside. Choosing a link closes it. The burger shows below 810 px only (CSS).
 */
export function HomeMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const wrapTab = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = event.currentTarget.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <>
      <button
        type="button"
        className="h-burger"
        aria-label="Open menu"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <span aria-hidden="true" />
      </button>
      <dialog ref={dialog} className="h-menu" aria-label="Menu" onKeyDown={wrapTab}>
        <div className="h-menu-top">
          <span className="h-menu-name">Take Studio</span>
          <button type="button" className="h-menu-close" aria-label="Close menu" onClick={close}>
            <X size={28} aria-hidden="true" />
          </button>
        </div>
        <nav className="h-menu-links" aria-label="Mobile">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={close}>
              {l.label}
            </a>
          ))}
          <Link href="/sign-in" onClick={close}>
            sign in
          </Link>
        </nav>
        <Link className="h-btn h-menu-cta" href="/sign-in" onClick={close}>
          Upload a take
        </Link>
      </dialog>
    </>
  );
}
