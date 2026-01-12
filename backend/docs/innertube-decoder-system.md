# Innertube Decoder System

This document is the single source of truth for how Innertube (YouTube Music) payloads are persisted and decoded into the Supabase schema. No runtime code is changed by this document. No search-suggest logic is covered here.

## Cleanup note

- The repository contains no other Innertube/decoder draft docs; none needed removal. This file supersedes any prior informal notes.

## 1) Database state report (as-is)

The schema is summarized from migrations and current backend usage. Where a table DDL is absent from the repo but required by the pipeline, it is called out explicitly to avoid ambiguity.

### artists (required; DDL not present in repo)
- Purpose: canonical artist records derived from search/browse payloads.
- Identity: `artist_key` (normalized artist name) is the primary key.
- Other columns (expected): `display_name` (original casing), `normalized_name`, `youtube_channel_id` (unique, nullable), `thumbnails` (jsonb), `subscriber_count`, `view_count`, `country`, `created_at`, `updated_at`.
- Relationships: referenced by tracks and albums via `artist_key`.
- Canonical vs derived: `artist_key`, `normalized_name`, `display_name`, `youtube_channel_id` are canonical; counts and thumbnails are derived from payloads; all columns are decoder-populated.
- Legacy: the `artist_import` table is legacy and MUST NOT receive decoder writes.

### albums (required; DDL not present in repo)
- Purpose: artist-owned collections for YT Music albums/EPs.
- Identity: `external_id` (YT Music album/browse ID) unique; surrogate `id` UUID if present.
- Columns (expected): `id` (UUID PK), `external_id` (text, unique, not null), `title`, `artist_key` (FK to artists.artist_key), `thumbnail_url`, `release_date`, `track_count`, `total_duration_seconds`, `created_at`, `updated_at`.
- Relationships: `artist_key` FK to artists; tracks reference albums.
- Canonical vs derived: `external_id`, `artist_key`, `title` canonical; counts/durations derived; decoder populates all album rows.

### tracks (present)
- Purpose: de-duplicated songs/videos shared across playlists, albums, and search results.
- Identity: canonical = `youtube_id` (11-char video ID). `external_id` exists but is legacy/mirror and must not drive identity decisions.
- Keys and constraints: `id` UUID PK; unique constraint on `external_id` (see migration 20251127000000_fix_tracks_unique_constraint) but decoder must still treat `youtube_id` as the dedupe key.
- Core columns (canonical): `youtube_id`, `title`, `artist_key` (expected FK to artists), `album_id` (expected FK to albums), `duration` (seconds), `published_at` (when available), `category`, `region`.
- Additional columns (derived/operational): `external_id` (legacy), `artist` (legacy text), `artist_channel_id` (indexed), `cover_url`, `image_url`, `sync_status` (active|deleted|pending, default active), `last_synced_at`, `quality_score`, `created_at`, `last_updated_at` (if present).
- Relationships: `artist_key` → artists; `album_id` → albums; linked to playlists via playlist_tracks. The old `playlist_id` column exists but is legacy; playlist membership must be expressed only via playlist_tracks.
- Decoder-only columns: `sync_status`, `last_synced_at`, `quality_score`, `region`, `cover_url`/`image_url`, `published_at` are populated from payloads; no partial inserts allowed.

### playlists (present)
- Purpose: user/topic/channel playlists sourced from YouTube; basis for home sections and playback.
- Identity: surrogate `id` UUID PK; canonical external key = `external_id` (YouTube playlist ID), unique when present.
- Core columns (canonical): `external_id`, `title`, `description`, `category`, `channel_id` (YT channel/owner), `country`/`region`, `is_public` (bool).
- Derived/operational columns: `cover_url`, `image_url`, `item_count` (track_count), `view_count`, `quality_score`, `validated` (bool), `validated_on`, `fetched_on`, `last_refreshed_on`, `last_etag`, `broken` (bool), `unstable` (bool), `is_empty` (bool), `owner_id` (legacy user linkage), `created_at`, `updated_at`.
- Relationships: `id` referenced by playlist_tracks.playlist_id and playlist_views; no direct artist/album linkage.
- Decoder-only columns: `external_id`, `title`, `description`, `cover_url`/`image_url`, `item_count`, `view_count`, `quality_score`, `validated`, `last_refreshed_on`, `last_etag`, `broken`/`unstable`/`is_empty`, `channel_id`, `country`/`region`.

### playlist_tracks (present)
- Purpose: junction table for playlist ↔ track membership and ordering.
- Keys: `id` UUID PK; unique (playlist_id, track_id); unique (playlist_id, position).
- Columns: `playlist_id` FK → playlists.id; `track_id` FK → tracks.id; `position` (int, 1-based ordering); `created_at`.
- Canonical vs derived: playlist_id, track_id, position canonical; created_at derived. Decoder is responsible for inserting rows and maintaining order without duplicates.

### innertube_raw_payloads (required; DDL not present in repo)
- Purpose: append-only audit store of every Innertube response prior to decoding.
- Identity: `id` UUID PK.
- Columns (required for decoder): `request_type` (search|browse|playlist|album|artist), `request_key` (e.g., search query or browseId), `payload` (jsonb, full raw response, unmodified), `status` (pending|processed|error, default pending), `error_message` (text), `processed_at` (timestamptz), `created_at` (timestamptz default now()).
- Rules: payload is never mutated; decoder is the only writer of status/error/processed_at.

### Explicit legacy warning: artist_import
- The table `artist_import` is legacy and is not part of the Innertube system. Decoder must never write to or read from it. Artist creation/enrichment is exclusively via search + Innertube decoding into artists/related tables.

## 2) Canonical identity rules

- Artists: canonical key = artists.artist_key (normalized name). youtube_channel_id is optional but must be unique when present. Stats (subscribers, views) update from payloads when available.
- Tracks: canonical identity = youtube_id (11-char video ID). external_id is legacy/mirror only and must not influence dedupe or merges. All inserts/updates must target the row identified by youtube_id.
- Albums: albums.external_id (YT Music album/browse ID) is unique and mandatory. Albums are not playlists and must link to artists via artist_key.
- Playlists: playlists.external_id (YT playlist ID) is the canonical external key; playlist_tracks is the only source of playlist membership. Playlists are not artist-owned by default and may belong to topic channels or users.

## 3) Innertube raw payload storage

- Table: public.innertube_raw_payloads (see structure above).
- Flow: every Innertube API response is written first to this table, unmodified.
- Status lifecycle: pending → processed or error. processed_at is set only on successful decode. error_message is set when status=error.
- Access: no business logic reads payload JSON except the decoder; application code uses decoded tables only.

## 4) Decoder responsibilities (offline process)

- Input: select rows from innertube_raw_payloads where status=pending (ordered by created_at).
- Parse deterministically; do not infer or guess missing fields.
- Extract entities:
  - Artist candidates (names, channel IDs, stats, thumbnails)
  - Tracks (youtube_id, title, duration, artist_key, album link, thumbnails, published_at)
  - Albums (external_id, title, artist_key, thumbnail, release date, track_count)
  - Playlists (external_id, title, subtitle/description, cover/image, stats, channel_id, track_count)
- Idempotent upserts using canonical keys: artists by artist_key, tracks by youtube_id, albums by external_id, playlists by external_id. Never create duplicates.
- Linking rules: tracks → artists via artist_key; tracks → albums via album_id when available; playlists ↔ tracks only via playlist_tracks with ordered positions.
- Transactionality: no partial inserts. If any entity extraction fails, mark payload as error and leave decoded tables untouched.
- Completion: mark payload status=processed and set processed_at only after all upserts and links succeed.
- Re-runs: decoder must be safe to re-run; upserts must not mutate canonical fields incorrectly and must preserve idempotency.

## 5) Search flow context (suggest is out of scope)

- User search → Innertube search API → raw JSON saved to innertube_raw_payloads → decoder processes pending rows → structured tables (artists, tracks, albums, playlists, playlist_tracks) populated.
- Search Suggest generation is explicitly out of scope and will be documented separately.

## 6) Design guarantees

- Database consistency: canonical keys prevent duplicates; playlist_tracks is sole playlist membership source.
- Safe Innertube experimentation: raw payload log enables replay and decoder improvements without data loss.
- Future API swap: clear separation of raw storage and decoder allows replacing Innertube with official APIs while reusing the decoder contract.
- Auditability: every decoded entity traces back to an immutable raw payload with status and timestamps.
- Idempotency: decoder can re-run safely; upserts keyed by canonical identities prevent drift.
