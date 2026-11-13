"use client";

import { useEffect, useRef, useState } from "react";
import { DELETED_MESSAGE, DELETED_PARAM } from "@/lib/take-delete";

/**
 * The library's main heading (spec 0013 AC-4): after a delete on the take page the creator
 * lands here with `?deleted=1`. The heading takes focus, a polite status says "Take deleted.",
 * and the flag leaves the address so a reload does not repeat it. The status region is always
 * in the page so its text is announced when it appears.
 */
export function LibraryHeading({ deleted }: { readonly deleted: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!deleted) return;
    heading.current?.focus();
    // Set in a callback, after the empty region has been in the page, so it is announced.
    const frame = requestAnimationFrame(() => setMessage(DELETED_MESSAGE));
    const url = new URL(window.location.href);
    url.searchParams.delete(DELETED_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    return () => cancelAnimationFrame(frame);
  }, [deleted]);

  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="text-h1 font-medium outline-hidden">
        Your takes
      </h1>
      <p role="status" className="sr-only">
        {message}
      </p>
    </>
  );
}
