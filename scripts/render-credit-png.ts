/**
 * Renders the credit image (spec 0026 AC-1): `assets/credit/edited-with-take-studio.png`.
 * White text (`--color-on-dark`) on a 60% black box (`--color-media-glass`), 1000 px wide, with
 * transparent rounded corners. Run `pnpm credit:png` after changing a value here, and commit the
 * PNG: the pixel test (`src/lib/credit-png.test.ts`) reads it back.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CREDIT_PNG_PATH, CREDIT_PNG_WIDTH } from "../src/lib/credit-filter";
import { CREDIT_BOX } from "../src/lib/credit-rules";

const FONT = path.join("assets", "credit", "InterTight-Variable.ttf");

export function creditGraph(): string {
  const { height, radius, fontSize, text, opacity } = CREDIT_BOX;
  return [
    `color=c=black@${opacity}:s=${CREDIT_PNG_WIDTH}x${height}:d=1,format=rgba`,
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*${opacity}*(1-gt(pow(max(0,max(${radius}-X,X-${CREDIT_PNG_WIDTH - 1 - radius})),2)+pow(max(0,max(${radius}-Y,Y-${height - 1 - radius})),2),${radius * radius}))'`,
    `drawtext=fontfile=${FONT}:text='${text}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`,
  ].join(",");
}

if (process.argv[1]?.endsWith("render-credit-png.ts")) {
  execFileSync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    ["-y", "-v", "error", "-f", "lavfi", "-i", creditGraph(), "-frames:v", "1", CREDIT_PNG_PATH],
    { stdio: "inherit" },
  );
  console.log(`wrote ${CREDIT_PNG_PATH}`);
}
