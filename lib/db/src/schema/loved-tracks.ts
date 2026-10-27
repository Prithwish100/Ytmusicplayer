import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const lovedTracksTable = pgTable(
  "loved_tracks",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    trackId: text("track_id").notNull(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    durationSeconds: integer("duration_seconds"),
    thumbnailUrl: text("thumbnail_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("loved_tracks_user_track_unique").on(table.userId, table.trackId)],
);

export const insertLovedTrackSchema = createInsertSchema(lovedTracksTable).omit({
  id: true,
  createdAt: true,
});

export type InsertLovedTrack = z.infer<typeof insertLovedTrackSchema>;
export type LovedTrack = typeof lovedTracksTable.$inferSelect;
