# Nightly Artist Ingest Audit (hajde-music-stream)

## Architecture snapshot
- Entrypoint registers all jobs once in [backend/src/index.ts](backend/src/index.ts) via [backend/src/lib/scheduler.ts](backend/src/lib/scheduler.ts); guarded by `enable_run_jobs`.
- Nightly artist job lives in [backend/src/lib/backgroundArtistScheduler.ts](backend/src/lib/backgroundArtistScheduler.ts) and calls `runFullArtistIngest` with `source='background'` from [backend/src/services/fullArtistIngest.ts](backend/src/services/fullArtistIngest.ts).
- Artist selection + locking and completion snapshots are in [backend/src/lib/db/artistQueries.ts](backend/src/lib/db/artistQueries.ts), executed through the `run_raw` RPC.

## Scheduling / window
- Cron: `*/5 * * * *` (every 5 minutes) using `node-cron` default timezone (server local time).
- Active window gate: hours 0–4 inclusive (00:00–04:59); returns early at hour 5+.
- Logs when outside window and skips.

## Concurrency & locking
- In-process guard: `running` flag prevents overlap inside a single worker.
- Cross-process guard: `pg_try_advisory_lock(723994)` acquired at start; if not acquired the run is skipped. Always released in `finally` via `pg_advisory_unlock`.
- Per-artist lock: candidate query ends with `FOR UPDATE ... SKIP LOCKED` on `artists` to avoid two workers ingesting the same artist simultaneously.

## Candidate selection (deterministic, 1 per run)
- Ordered by `artists.updated_at ASC NULLS FIRST`, then `artists.created_at ASC`, limited to 200, then re-ordered with the same keys and limited to 1.
- Excludes artists without `youtube_channel_id`.
- Excludes fully complete artists via completion aggregates: if `total_albums > 0` and `complete_albums == total_albums` and `unknown_albums == 0` then filtered out.
- Completion aggregation per artist:
  - `total_albums` = count of linked albums; `unknown` = `track_count <= 0`; `complete` when `actual_tracks >= track_count`; `expected_tracks`/`actual_tracks` summed over known counts.
- Rotation: `fullArtistIngest` updates `artists.updated_at`, so processed artists move to the back.

## Ingest behavior integration
- Scheduler calls `runFullArtistIngest({ source: 'background', force: false })` (no force ingest).
- Albums skipped when `expected !== null && actual >= expected`; otherwise ingested. Unknown expected counts are treated as unknown (ingested, not assumed complete).
- Throttling: 3s `sleep` in `finally` of each album ingest.
- Browse failures mark album `unstable=true` to avoid repeated loops.
- Completion snapshots logged before and after ingest (artist-level summary).

## Logging / observability
- Logs include: window skip, advisory-lock skip, selected artist summary, completion before/after, failure context (artist_key, browse_id, duration), and run completion duration.
- Suffix `[BackgroundArtistIngest]` enables log filtering.

## Safety / integrity notes
- Candidate query uses SKIP LOCKED and advisory lock; overlap avoided across workers.
- Artist creation follows existing ingest paths; no new mass-creation paths introduced.
- Playlist/album ingest already marks unstable albums on browse failure.
- Unknowns: no explicit exclusion of "broken/unstable" artist markers (none observed in schema); document if added later.

## Findings
- ✅ Single canonical scheduler entrypoint (`registerSchedulers`) with one background artist job.
- ✅ Global single-flight added via Postgres advisory lock.
- ✅ 5-minute cadence inside 00:00–05:00 window; skips otherwise.
- ✅ Deterministic rotation by `updated_at`/`created_at`; fully complete artists excluded.
- ✅ Logging covers selection, completion before/after, errors, duration.
- ⚠️ Timezone not pinned (uses server local time); if deployment expects strict UTC, set `timezone` in `cron.schedule` or document server TZ.
- ⚠️ Build check failed because `tsc` is not installed locally (`npm run build` → `tsc: not found`). Install deps (`npm install` in `backend`) before CI/typecheck.

## Build / test run
- Command: `cd backend && npm run build`
- Result: **Failed** – `tsc: not found` (TypeScript not installed in environment). No code errors reported before the tool missing; rerun after installing dependencies.

## Current status
- **Status: OK with noted caveats.** Scheduler is canonical, windowed, and single-flight; selection and ingest paths honor completion awareness and throttling. Address timezone explicitness if UTC is required, and ensure TypeScript toolchain is installed for CI/typechecks.
