import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import {
  SearchMusicQueryParams,
  SearchMusicResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);
const searchCache = new Map<
  string,
  { expiresAt: number; tracks: ReturnType<typeof SearchMusicResponse.parse> }
>();
const searchTimeoutMs = 15_000;
const streamTimeoutMs = 30_000;
const maxCacheEntries = 100;

const searchScript = `
import json, sys
from ytmusicapi import YTMusic

query = sys.argv[1]
results = YTMusic().search(query, filter="songs", limit=20)
tracks = []
for item in results:
    video_id = item.get("videoId")
    if not video_id or item.get("isAvailable") is False:
        continue
    artists = item.get("artists") or []
    artist = ", ".join(a.get("name", "") for a in artists if a.get("name")) or "Unknown artist"
    thumbnails = item.get("thumbnails") or []
    thumbnail = thumbnails[-1].get("url") if thumbnails else None
    tracks.append({
        "id": video_id,
        "title": item.get("title") or "Untitled",
        "artist": artist,
        "durationSeconds": item.get("duration_seconds"),
        "thumbnailUrl": thumbnail,
        "playbackUrl": "/api/music/stream/" + video_id,
        "watchUrl": "https://music.youtube.com/watch?v=" + video_id,
    })
print(json.dumps(tracks))
`;

function pythonExecutable(): string {
  const fromWorkspaceRoot = path.resolve(
    process.cwd(),
    ".pythonlibs",
    "bin",
    "python",
  );
  return existsSync(fromWorkspaceRoot)
    ? fromWorkspaceRoot
    : path.resolve(process.cwd(), "..", "..", ".pythonlibs", "bin", "python");
}

async function runPython(args: string[], timeout: number): Promise<string> {
  const { stdout } = await execFileAsync(pythonExecutable(), args, {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

router.get("/music/search", async (req, res): Promise<void> => {
  const parsed = SearchMusicQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a search term up to 160 characters." });
    return;
  }

  const query = parsed.data.q.trim();
  if (!query) {
    res.status(400).json({ error: "Enter a search term." });
    return;
  }

  const cached = searchCache.get(query.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) {
    res.json(cached.tracks);
    return;
  }

  try {
    const output = await runPython(["-c", searchScript, query], searchTimeoutMs);
    const tracks = SearchMusicResponse.parse(JSON.parse(output));
    if (searchCache.size >= maxCacheEntries) {
      const firstKey = searchCache.keys().next().value;
      if (firstKey) searchCache.delete(firstKey);
    }
    searchCache.set(query.toLowerCase(), {
      expiresAt: Date.now() + 5 * 60 * 1000,
      tracks,
    });
    res.json(tracks);
  } catch (error) {
    req.log.warn({ err: error }, "Music search failed");
    res.status(503).json({
      error: "Music search is temporarily unavailable. Please try again shortly.",
    });
  }
});

router.get("/music/stream/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    res.status(400).json({ error: "Invalid track identifier." });
    return;
  }

  try {
    const output = await runPython(
      [
        "-m",
        "yt_dlp",
        "--no-warnings",
        "--no-playlist",
        "--format",
        "bestaudio[ext=m4a]/bestaudio",
        "--get-url",
        `https://www.youtube.com/watch?v=${id}`,
      ],
      streamTimeoutMs,
    );
    const audioUrl = output.split(/\r?\n/).find(Boolean);
    if (!audioUrl) {
      res.status(502).json({ error: "Could not open this track." });
      return;
    }

    const parsedUrl = new URL(audioUrl);
    if (
      parsedUrl.protocol !== "https:" ||
      !parsedUrl.hostname.endsWith(".googlevideo.com")
    ) {
      req.log.warn({ host: parsedUrl.hostname }, "Rejected unexpected audio host");
      res.status(502).json({ error: "Could not open this track." });
      return;
    }

    const headers: Record<string, string> = {};
    const range = req.get("range");
    if (range) headers.Range = range;
    const upstream = await fetch(parsedUrl, { headers });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).end();
      return;
    }

    res.status(upstream.status);
    for (const header of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    Readable.fromWeb(
      upstream.body as import("node:stream/web").ReadableStream,
    ).pipe(res);
  } catch (error) {
    req.log.warn({ err: error }, "Music stream request failed");
    if (!res.headersSent) {
      res.status(502).json({
        error: "Playback could not start. Please try another track.",
      });
    } else {
      res.end();
    }
  }
});

export default router;
