# Afterhours

A browser music player with music-only YouTube Music search, queue and favorites, and yt-dlp playback.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/music-player run dev` — run the web music player
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- The API build syncs Python dependencies from the root `pyproject.toml` and `uv.lock`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Music lookup and playback: Python `ytmusicapi` and `yt-dlp`
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/music-player/` — React/Vite music player and persistent browser state
- `artifacts/api-server/src/routes/music.ts` — song search and range-aware audio proxy
- `lib/api-spec/openapi.yaml` — source of truth for the music search API contract

## Architecture decisions

- Search is restricted to YouTube Music's `songs` filter; do not replace it with general YouTube video search.
- Audio stream URLs are resolved server-side and proxied with HTTP range support so seeking works without exposing the direct stream URL to the browser.
- Search uses an unofficial YouTube Music interface and yt-dlp; upstream changes can interrupt search or playback.

## Product

Search music tracks, play/pause/seek, skip, manage a queue, toggle shuffle and repeat, adjust volume, and save favorites. Queue, favorites, and player settings are saved in localStorage.

## User preferences

- Keep music search limited to music results.

## Gotchas

- The player uses the API server's range-aware stream endpoint; do not point the browser directly at a temporary yt-dlp URL.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
