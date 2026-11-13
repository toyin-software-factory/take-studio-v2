"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { callApi } from "./browser-io";

const waveformSchema = z.object({ waveform: z.array(z.number()).nullable() });

/**
 * The loudness values for the timeline (spec 0011, AC-11): read once per page load from
 * `GET /api/takes/{id}/waveform`, and once more after a render succeeded if the first answer was
 * null (an older take gets its waveform from the render). Null means "draw a plain track". The
 * values are never logged.
 */
export function useWaveform(takeId: string, renderedCount: number): readonly number[] | null {
  const [values, setValues] = useState<readonly number[] | null>(null);
  const asked = useRef<number | null>(null);

  useEffect(() => {
    // First load, or the first success after a null answer.
    if (asked.current !== null && (values !== null || asked.current === renderedCount)) return;
    asked.current = renderedCount;
    let live = true;
    void callApi(`/api/takes/${takeId}/waveform`, "GET")
      .then((reply) => {
        const parsed = waveformSchema.safeParse(reply.data);
        if (live && reply.status === 200 && parsed.success) setValues(parsed.data.waveform);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [takeId, renderedCount, values]);

  return values;
}
