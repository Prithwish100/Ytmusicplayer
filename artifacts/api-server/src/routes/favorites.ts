import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { db, lovedTracksTable } from "@workspace/db";
import {
  DeleteMyFavoriteParams,
  UpsertMyFavoriteBody,
  UpsertMyFavoriteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to use your Loved list." });
    return;
  }
  next();
};

function toMusicTrack(track: typeof lovedTracksTable.$inferSelect) {
  return {
    id: track.trackId,
    title: track.title,
    artist: track.artist,
    durationSeconds: track.durationSeconds,
    thumbnailUrl: track.thumbnailUrl,
    playbackUrl: `/api/music/stream/${track.trackId}`,
    watchUrl: `https://music.youtube.com/watch?v=${track.trackId}`,
  };
}

router.get("/me/favorites", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to use your Loved list." });
    return;
  }

  const tracks = await db
    .select()
    .from(lovedTracksTable)
    .where(eq(lovedTracksTable.userId, userId))
    .orderBy(desc(lovedTracksTable.createdAt));
  res.json(tracks.map(toMusicTrack));
});

router.put("/me/favorites/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  const params = UpsertMyFavoriteParams.safeParse(req.params);
  const body = UpsertMyFavoriteBody.safeParse(req.body);
  if (!userId) {
    res.status(401).json({ error: "Sign in to use your Loved list." });
    return;
  }
  if (!params.success || !body.success) {
    res.status(400).json({ error: "That track could not be saved." });
    return;
  }

  const [track] = await db
    .insert(lovedTracksTable)
    .values({
      userId,
      trackId: params.data.id,
      ...body.data,
    })
    .onConflictDoUpdate({
      target: [lovedTracksTable.userId, lovedTracksTable.trackId],
      set: body.data,
    })
    .returning();

  res.json(toMusicTrack(track));
});

router.delete(
  "/me/favorites/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    const params = DeleteMyFavoriteParams.safeParse(req.params);
    if (!userId) {
      res.status(401).json({ error: "Sign in to use your Loved list." });
      return;
    }
    if (!params.success) {
      res.status(400).json({ error: "That track could not be removed." });
      return;
    }

    await db
      .delete(lovedTracksTable)
      .where(
        and(
          eq(lovedTracksTable.userId, userId),
          eq(lovedTracksTable.trackId, params.data.id),
        ),
      );
    res.status(204).end();
  },
);

export default router;
