"use client";

import dynamic from "next/dynamic";

/**
 * The stage (step 2) and the review (step 3) only show after a click, so their code is loaded
 * after the first paint instead of with the page (B2-T158). `preloadSteps` starts both loads;
 * the setup step calls it when the browser is idle and when the camera button is touched, so the
 * stage is nearly always there before the camera permission answer comes back.
 */
const loadStage = () => import("./record-stage").then((m) => m.RecordStage);

export const RecordStage = dynamic(loadStage, { ssr: false });

export function preloadSteps(): void {
  void loadStage();
}
