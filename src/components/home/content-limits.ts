import { MEDIA_LIMITS, VIDEO_RETENTION_DAYS } from "@/lib/take-rules";

const GB = 1024 ** 3;

/** The four limits of "The limits" section, from `MEDIA_LIMITS` and `VIDEO_RETENTION_DAYS`. */
export function homeLimits(): readonly {
  readonly value: number;
  readonly unit: string;
  readonly label: string;
}[] {
  return [
    {
      value: Math.round(MEDIA_LIMITS.maxDurationMs / 60_000),
      unit: "min",
      label: "Longest take you can upload",
    },
    {
      value: Math.round(MEDIA_LIMITS.maxBytes / GB),
      unit: "GB",
      label: "Biggest file, MP4 or MOV",
    },
    { value: MEDIA_LIMITS.maxShortSide, unit: "p", label: "Highest resolution in and out" },
    {
      value: VIDEO_RETENTION_DAYS,
      unit: "days",
      label: "We keep your videos, then delete them",
    },
  ];
}

export const minutes = Math.round(MEDIA_LIMITS.maxDurationMs / 60_000);
export const gigabytes = Math.round(MEDIA_LIMITS.maxBytes / GB);
export const resolution = `${MEDIA_LIMITS.maxShortSide}p`;
