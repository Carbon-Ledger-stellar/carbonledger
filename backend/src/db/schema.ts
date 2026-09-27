import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Pause state versioning (issue #1239)
 *
 * Append-only history of every pause/unpause action. Rows are never updated
 * or deleted, so the full history of who changed the pause state and when is
 * preserved. The current pause state is the latest row by `createdAt` (with
 * `id` as a deterministic tie-breaker), and the state at any point in time can
 * be reconstructed by selecting the latest row at or before that timestamp.
 */
export const pauseStateVersions = pgTable(
  "pause_state_versions",
  {
    id: serial("id").primaryKey(),
    // Whether the system is paused after this action was applied.
    paused: boolean("paused").notNull(),
    // The action that produced this version: "pause" | "unpause".
    action: varchar("action", { length: 16 }).notNull(),
    // Admin user who performed the action.
    adminUserId: integer("admin_user_id").notNull(),
    adminUsername: varchar("admin_username", { length: 255 }),
    // Optional free-form reason for the change.
    reason: text("reason"),
    // When the action occurred; used to reconstruct state at any point in time.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Fast lookup of the latest version / point-in-time reconstruction.
    createdAtIdx: index("pause_state_versions_created_at_idx").on(
      table.createdAt,
      table.id,
    ),
    adminUserIdx: index("pause_state_versions_admin_user_id_idx").on(
      table.adminUserId,
    ),
  }),
);

/**
 * Enforce immutability at the database level: history rows are append-only.
 * Any UPDATE or DELETE against `pause_state_versions` is rejected.
 */
export const pauseStateVersionsImmutable = sql`
  CREATE OR REPLACE FUNCTION pause_state_versions_immutable()
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'pause_state_versions is append-only; % is not allowed', TG_OP;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS pause_state_versions_no_update ON pause_state_versions;
  CREATE TRIGGER pause_state_versions_no_update
    BEFORE UPDATE OR DELETE ON pause_state_versions
    FOR EACH ROW EXECUTE FUNCTION pause_state_versions_immutable();
`;

export type PauseStateVersion = typeof pauseStateVersions.$inferSelect;
export type NewPauseStateVersion = typeof pauseStateVersions.$inferInsert;
