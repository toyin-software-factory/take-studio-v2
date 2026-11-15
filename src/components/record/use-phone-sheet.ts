"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

const PHONE = "(max-width: 809px)";

/**
 * The phone settings sheet (draft: a bottom sheet on screens under 810 px). Escape and the
 * scrim close it, focus goes in on open and back to the button on close. No focus trap: the
 * rest of the page is reachable by keyboard (spec 0021 AC-9). Wider screens keep the panel.
 */
export function usePhoneSheet(
  trigger: RefObject<HTMLButtonElement | null>,
  sheet: RefObject<HTMLElement | null>,
) {
  const [phone, setPhone] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const read = () => setPhone(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  // The full screen stage must not scroll the page behind it.
  useEffect(() => {
    if (!phone) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [phone]);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, [trigger]);

  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>("button, select, [role='switch']")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, sheet]);

  // Leaving the phone layout while the sheet is open closes it.
  const shown = phone && open;
  return { phone, open: shown, setOpen, close };
}
