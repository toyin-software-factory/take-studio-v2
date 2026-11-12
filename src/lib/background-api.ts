import { z } from "zod";

/** The "no background" choice, as the API and the picker spell it (spec 0008). */
export const ORIGINAL_BACKGROUND = "original";

/** GET /api/backgrounds (spec 0008, AC-1). */
export const backgroundItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  alt: z.string(),
  status: z.string(),
  thumbUrl: z.string().nullable(),
});
export type BackgroundItem = z.infer<typeof backgroundItemSchema>;

export const backgroundListSchema = z.object({
  builtIn: z.array(backgroundItemSchema),
  mine: z.array(backgroundItemSchema),
  /** The creator's last pick, null for "Keep original" (also when it was deleted or not ready). */
  defaultId: z.string().nullable(),
});
export type BackgroundListData = z.infer<typeof backgroundListSchema>;

/** The picker's tile for a choice: the item, or null for "Keep original". */
export function findBackground(list: BackgroundListData | null, id: string): BackgroundItem | null {
  if (!list || id === ORIGINAL_BACKGROUND) return null;
  return [...list.builtIn, ...list.mine].find((item) => item.id === id) ?? null;
}
