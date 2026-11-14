import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * One row per voice following token minted (spec 0021 step 2). The hourly and daily caps count
 * these rows; it holds no token and no audio, only who and when. Rows older than two days are
 * deleted by the cleanup sweep, and a creator's rows go with the account.
 */
export const realtimeTokenMint = pgTable(
  "realtime_token_mint",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mintedAt: timestamp("minted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("realtime_token_mint_creator_minted_idx").on(t.creatorId, t.mintedAt)],
);
