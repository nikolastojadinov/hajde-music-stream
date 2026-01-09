# Trending Now Home Section

Production-ready snapshot pipeline for the "TrendingNow" home page section. No live scraping or on-request computation; everything is driven by Supabase data and stored snapshots.

## Snapshot contract
- Endpoint: `GET /api/home/sections/trending-now`
- Shape (stable):
  ```json
  {
    "section": "trending_now",
    "generated_at": "ISO-8601",
    "refresh_policy": {
      "type": "interval",
      "interval": "weekly",
      "preferred_window": "02:00-04:00 UTC"
    },
    "items": [
      {
        "type": "playlist",
        "id": "<playlists.id>",
        "external_id": "<playlists.external_id>",
        "title": "<title>",
        "subtitle": "431K views this week",
        "imageUrl": "<cover_url>",
        "metrics": {
          "views_7d": 431000,
          "trend_score": 128.4
        }
      }
    ]
  }
  ```

## Supabase schema (new)
- `home_sections` – registry of sections (seeded with `trending_now`).
- `home_section_snapshots` – stored payloads, one active snapshot at a time.
- `home_section_runs` – optional run logs.
- Helper RPC: `trending_now_candidates(limit_count)` aggregates playlist activity from `view_dedupe`, `playlist_views`, and playlist quality fields.
- Policies: anon/auth can read `home_section_snapshots`; service_role has full control. Indexed on section/time for fast lookups.

## Refresh pipeline
- Cron: Monday 02:00 UTC (`node-cron` inside backend). Guarded by `ENABLE_RUN_JOBS` (defaults true).
- Warm-start: on boot, if no active snapshot and jobs are enabled, a one-off refresh runs.
- Manual run: `cd backend && npm run refresh:trending-now`.
- Refresh steps: fetch candidates → score → build snapshot → expire previous → insert new → log run.
- Validity: snapshot marked valid for 8 days; previous active snapshots are closed when a new one is written.

## Ranking model (deterministic)
- Inputs: deduped playlist views (7d), playlist_views rows (7d), lifetime view_count, quality_score, validated flag, recency of refresh/view.
- Score: weighted sum of weekly views, velocity (sqrt), evergreen (log1p lifetime), quality boost, freshness, recent-view boost, validation boost.
- Top 18 items kept; duplicates removed by playlist id.

## Frontend rendering
- Home page fetches the snapshot once on mount (no client-side ranking), caches in component state, and renders horizontally scrollable cards.
- Subtitle shows weekly views (or lifetime views fallback).
- Errors show a retry CTA; loading uses skeleton cards.

## Operational notes
- No YouTube API usage; all metrics come from Supabase tables.
- If snapshots go missing, first check that `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are present and `ENABLE_RUN_JOBS` is not set to `false`.
- Policies already allow public/anon reads; CDN caching is enabled via `Cache-Control` headers on the backend endpoint.
