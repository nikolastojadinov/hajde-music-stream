# Playlist Refresh System - Implementation Documentation

> **Status:** Archived. Live-only Purple Music B no longer runs the playlist refresh system or uses the YouTube Data API. This document is kept for historical reference only.

## Overview

This document describes the complete rewrite of the Purple Music playlist refresh system, implementing efficient, YouTube Terms-compliant playlist synchronization with ETag-based short-circuiting and delta sync.

## Architecture

### Core Components

1. **`backend/src/jobs/runBatch.ts`** - Main refresh job implementation
2. **`backend/src/lib/jobProcessor.ts`** - Job scheduler (triggers runBatch periodically)
3. **`backend/src/lib/prepareBatch.ts`** - Batch preparation (unchanged)
4. **`supabase/migrations/20251126000000_add_refresh_metadata.sql`** - Database schema for refresh metadata

### Database Schema

#### Playlists Table (New Columns)
- `external_id` (TEXT) - YouTube playlist ID
- `fetched_on` (TIMESTAMP) - Initial fetch timestamp
- `last_refreshed_on` (TIMESTAMP) - Last refresh timestamp (for 30-day cycle)
- `last_etag` (TEXT) - ETag from YouTube API (for HTTP 304 conditional requests)
- `item_count` (INTEGER) - Number of tracks in playlist
- `view_count` (INTEGER) - View count (reserved for future use)
- `region` (TEXT) - Geographic region
- `is_public` (BOOLEAN) - Playlist visibility

#### Tracks Table (New Columns)
- `sync_status` (TEXT) - Track lifecycle: 'active' | 'deleted' | 'pending'
- `last_synced_at` (TIMESTAMP) - Last sync timestamp
- `quality_score` (INTEGER) - Quality score (reserved for future use)
- `region` (TEXT) - Geographic region (inherited from playlist)
- `category` (TEXT) - Category (inherited from playlist)
- `cover_url` (TEXT) - Thumbnail URL
- `external_id` (TEXT) - YouTube video ID (duplicate of youtube_id for consistency)

## Key Features

### 1. ETag-Based Short-Circuiting

The system uses YouTube Data API v3's ETag support to minimize quota usage:

```typescript
// First request includes If-None-Match header with last known ETag
headers['If-None-Match'] = lastEtag;

// If YouTube responds with HTTP 304 Not Modified:
if (response.status === 304) {
  // Skip all track-level work
  // Only update playlist.last_refreshed_on
  return { unchanged: true };
}
```

**Quota Savings:**
- HTTP 304 response costs ~0 quota units (only connection overhead)
- Skips videos.list calls entirely
- Skips all database writes except one playlist update

### 2. Delta Sync Algorithm

When a playlist has changed (HTTP 200), the system performs efficient delta sync:

```typescript
// 1. Load existing tracks for playlist
const existing = await loadExistingTracks(playlistId);
const existingByYoutubeId = new Map(existing, track => [track.youtube_id, track]);

// 2. Classify each YouTube item
for (const item of youtubeItems) {
  if (!existingByYoutubeId.has(item.videoId)) {
    toInsert.push(item); // NEW track
  } else {
    const existingTrack = existingByYoutubeId.get(item.videoId);
    if (metadataChanged(existingTrack, item)) {
      toUpdate.push({ id: existingTrack.id, updates: item }); // UPDATED track
    }
  }
}

// 3. Find tracks removed from YouTube playlist
for (const track of existing) {
  if (!receivedIds.has(track.youtube_id) && track.sync_status !== 'deleted') {
    toDelete.push(track.id); // DELETED track
  }
}

// 4. Execute batch operations
await batchInsert(toInsert);
await batchUpdate(toUpdate);
await batchMarkDeleted(toDelete);
```

**Benefits:**
- No full table deletions/re-inserts
- Preserves track IDs and relationships
- Minimal database writes
- Tracks lifecycle (active → deleted)

### 3. YouTube API Quota Compliance

**Daily Quota Limit:** 10,000 units per project

**Cost per Refresh (Unchanged Playlist):**
- 1 × playlistItems.list with If-None-Match: **~0 units** (HTTP 304)
- Playlist metadata update: **0 units** (database only)
- **Total: ~0 units** ✅

**Cost per Refresh (Changed Playlist, 100 items):**
- 1 × playlistItems.list (first page): **1 unit**
- 1 × playlistItems.list (second page): **1 unit**
- No videos.list calls (metadata from playlistItems): **0 units**
- **Total: ~2 units** ✅

**Maximum Playlists per Day (Worst Case):**
- If ALL playlists changed: 10,000 units / 2 units = **5,000 playlists/day**
- With ETag optimization (assuming 70% unchanged): **~15,000 playlists/day**

### 4. 30-Day Refresh Cycle

Playlists are refreshed on a rolling 30-day cycle:

```typescript
// Selection query spreads work over time
const playlists = await supabase
  .from('playlists')
  .select('...')
  .not('external_id', 'is', null)
  .order('last_refreshed_on', { ascending: true, nullsFirst: true })
  .order('fetched_on', { ascending: true, nullsFirst: true })
  .limit(PLAYLIST_REFRESH_BATCH_SIZE);
```

**Configuration:**
- `PLAYLIST_REFRESH_BATCH_SIZE` env var (default: 50)
- Job runs every minute (controlled by jobProcessor)
- Automatically prioritizes:
  1. Never refreshed (last_refreshed_on IS NULL)
  2. Oldest refreshed (oldest last_refreshed_on first)
  3. Oldest fetched (fallback to fetched_on)

**Example Schedule:**
- 1,500 playlists total
- Batch size: 50 playlists
- Job runs: every 1 minute
- Refresh cycle: 1,500 / 50 = **30 runs = 30 minutes** for full cycle
- With ETag optimization, most runs are ~0 quota

### 5. Error Handling & Resilience

**Retry Logic:**
```typescript
// Exponential backoff for YouTube API calls
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    return await fetchYouTube();
  } catch (error) {
    if (response.status === 429) { // Rate limited
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
      continue;
    }
    throw error;
  }
}
```

**Per-Playlist Error Isolation:**
```typescript
// One bad playlist doesn't crash the whole batch
for (const playlist of playlists) {
  try {
    await refreshSinglePlaylist(playlist);
  } catch (error) {
    console.error('[runBatch] Playlist refresh failed', { playlistId, error });
    result.errors.push({ playlistId, message: error.message });
    // Continue with next playlist
  }
}
```

**Graceful Degradation:**
- Missing API key → log error, skip playlist
- YouTube API down → retry with backoff, then skip
- Supabase error → log, continue with remaining playlists

## YouTube API Terms Compliance

✅ **Only Uses Allowed List Methods:**
- `playlistItems.list` - Fetch playlist items with pagination
- (Future: `playlists.list`, `videos.list`, `search.list` as needed)

✅ **No Media Proxying:**
- Stores only metadata (title, artist, thumbnails)
- Actual playback handled by visible YouTube IFrame player in frontend

✅ **Respects Rate Limits:**
- Exponential backoff on HTTP 429
- ETag-based conditional requests
- Configurable batch sizes

✅ **Proper Attribution:**
- Stores YouTube video IDs for linking back to YouTube
- Preserves channelTitle as artist attribution

## Configuration

### Environment Variables

```bash
# Required
YOUTUBE_API_KEY=your_youtube_api_key_here
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional
PLAYLIST_REFRESH_BATCH_SIZE=50  # Number of playlists per batch (default: 50)
NODE_ENV=production              # Environment mode
```

### Adjusting Refresh Frequency

To change how often playlists are refreshed:

1. **Increase batch size** → Faster cycle, higher quota usage
2. **Decrease batch size** → Slower cycle, lower quota usage
3. **Modify cron schedule** in `jobProcessor.ts` (currently every minute)

## Monitoring & Observability

### Key Metrics to Track

```typescript
// Logged on every batch completion
{
  successCount: number,    // Playlists refreshed successfully
  failureCount: number,    // Playlists that failed to refresh
  skippedCount: number,    // Playlists skipped due to ETag match (HTTP 304)
  errors: Array<{
    playlistId: string,
    message: string
  }>
}
```

### Example Logs

```
[runBatch] Starting job { jobId: "...", type: "run", slot: 0 }
[runBatch] Loaded playlists for refresh { count: 50, batchSize: 50 }
[runBatch] Playlist not modified (ETag match). Skipping tracks sync. { playlistId: "...", title: "..." }
[runBatch] Retrieved latest tracks from YouTube { playlistId: "...", trackCount: 120, etag: "..." }
[runBatch] Delta sync completed { playlistId: "...", inserted: 5, updated: 3, deleted: 2 }
[runBatch] refreshed playlist fully. { playlistId: "...", title: "...", trackCount: 120 }
[runBatch] Job completed { jobId: "...", success: 45, failed: 0, skipped: 5 }
```

## Migration Guide

### Applying the Database Migration

```bash
# Connect to Supabase and run migration
psql $DATABASE_URL -f supabase/migrations/20251126000000_add_refresh_metadata.sql
```

Or using Supabase CLI:
```bash
supabase db push
```

### Backfilling Existing Playlists

After migration, populate `external_id` for existing playlists:

```sql
-- Manually set external_id for playlists (if you have YouTube playlist IDs elsewhere)
UPDATE playlists 
SET external_id = 'PLxxxxxxxxxxxxx' 
WHERE title = 'Some Playlist';

-- Or extract from existing source_url column (if it exists)
UPDATE playlists
SET external_id = (
  SELECT regexp_match(source_url, 'list=([^&]+)'))[1]
)
WHERE source_url IS NOT NULL AND external_id IS NULL;
```

### Deploying to Production

1. **Deploy database migration:**
   ```bash
   supabase db push
   ```

2. **Deploy backend code:**
   ```bash
   git push origin main
   # Render auto-deploys from main branch
   ```

3. **Verify environment variables** on Render:
   - `YOUTUBE_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PLAYLIST_REFRESH_BATCH_SIZE` (optional)

4. **Monitor logs** for first few runs:
   ```bash
   # On Render dashboard, check Logs tab
   # Look for "[runBatch]" entries
   ```

## Troubleshooting

### Issue: "Missing YOUTUBE_API_KEY env var"

**Solution:** Set `YOUTUBE_API_KEY` in Render environment variables.

### Issue: High quota usage despite ETag implementation

**Diagnosis:**
1. Check logs for "Playlist not modified (ETag match)" messages
2. If few/no ETag matches, check if `last_etag` is being saved correctly
3. Verify YouTube API responses include ETag header

**Solution:**
- Ensure migration added `last_etag` column
- Check Supabase RLS policies allow service role to update playlists

### Issue: Playlists not being refreshed

**Diagnosis:**
1. Check if jobProcessor is running: `grep "jobProcessor" logs`
2. Check if playlists have `external_id` set: `SELECT COUNT(*) FROM playlists WHERE external_id IS NOT NULL`
3. Check for errors in logs

**Solution:**
- Populate `external_id` for playlists
- Verify cron job is scheduled in jobProcessor
- Check Supabase client initialization

### Issue: "Failed to load existing tracks" errors

**Diagnosis:**
- RLS policies blocking service role access
- Supabase connection issues

**Solution:**
```sql
-- Grant service role full access (should already exist from migration)
GRANT ALL ON playlists TO service_role;
GRANT ALL ON tracks TO service_role;
```

## Performance Characteristics

### Database Queries per Refresh (Changed Playlist)

1. **Load playlists for refresh:** 1 query (50 rows)
2. **Per playlist:**
   - Load existing tracks: 1 query (~100 rows)
   - Insert new tracks: 1 query per 100 tracks (batched)
   - Update existing tracks: N queries (one per updated track)
   - Mark deleted tracks: 1 query per 100 deleted tracks (batched)
   - Update playlist metadata: 1 query

**Total for 50 playlists (avg 100 tracks, 10% change rate):**
- ~1 + 50 × (1 + 1 + 10 + 1 + 1) = **~701 queries**
- Easily handled by Supabase Postgres

### Memory Usage

- Loads one batch of playlists (50) into memory: ~10 KB
- Per playlist: loads all tracks (~100 × 500 bytes = 50 KB)
- YouTube response per page: ~50 items × 500 bytes = 25 KB
- **Peak memory per batch:** ~5 MB (well within limits)

### Execution Time

- ETag-matched playlist: **~100ms** (1 HTTP request + 1 DB update)
- Changed playlist (100 tracks): **~2 seconds** (HTTP requests + DB operations)
- Full batch (50 playlists, 70% ETag match): **~30 seconds**

## Future Enhancements

### Planned Improvements

1. **Parallel Playlist Processing**
   - Process multiple playlists concurrently (with rate limiting)
   - Reduce batch execution time

2. **videos.list Integration**
   - Fetch accurate duration for tracks
   - Currently duration is not fetched (could be added)

3. **Quality Scoring**
   - Use `quality_score` field to rank tracks
   - Filter low-quality or spam content

4. **Regional Content Filtering**
   - Use `region` field for geo-targeting
   - Respect regional availability

5. **Incremental ETag Updates**
   - Store ETags per-page for very large playlists
   - Further reduce quota on partial changes

## References

- [YouTube Data API v3 Documentation](https://developers.google.com/youtube/v3/docs)
- [YouTube API Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [HTTP ETags (RFC 7232)](https://datatracker.ietf.org/doc/html/rfc7232)
- [Supabase Documentation](https://supabase.com/docs)

---

**Last Updated:** 2025-11-26  
**Version:** 1.0.0  
**Author:** GitHub Copilot (Claude Sonnet 4.5)
