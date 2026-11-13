"use client";

import { useEffect } from "react";

const MESSAGE = "You have changes that haven't been rendered. Leave without rendering them?";

/**
 * Warns before unsent changes are lost (spec 0011, AC-4): the browser's own prompt for a reload
 * or close, and a confirm for an in app link or the Back button. Off when `active` is false.
 */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download"))
        return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Back: park one extra history entry, and when it is popped ask before really leaving.
    history.pushState({ leaveGuard: true }, "", location.href);
    let parked = true;
    let leaving = false;
    const onPop = () => {
      if (leaving) return;
      parked = false;
      if (window.confirm(MESSAGE)) {
        leaving = true;
        history.back();
      } else {
        history.pushState({ leaveGuard: true }, "", location.href);
        parked = true;
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      // The guard went off (edits sent or discarded): take the parked entry away again.
      if (parked && !leaving && (history.state as { leaveGuard?: boolean } | null)?.leaveGuard)
        history.back();
    };
  }, [active]);
}
