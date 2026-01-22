import { fetchArtistBrowseById } from '../lib/browse/browseArtist';
import { persistArtistChannelId, persistArtistDescription } from '../lib/db/artistQueries';
import { ingestArtistBrowse, resolveCanonicalArtistKey } from './entityIngestion';
import { ingestPlaylistOrAlbum, getAlbumCompletion } from './ingestPlaylistOrAlbum';
import { getSupabaseAdmin } from './supabaseClient';
import { browsePlaylistById } from './youtubeMusicClient';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type FullArtistIngestSource = 'search' | 'suggest' | 'direct' | 'background';

export type FullArtistIngestInput = {
  artistKey: string;
  browseId: string;
  source: FullArtistIngestSource;
  force?: boolean;
};

export type FullArtistIngestOptions = {
  reporter?: import('../ingest/nightlyIngestRunner').NightlyIngestReporter;
};

export type FullArtistIngestResult = {
  artistKey: string;
  browseId: string;
  source: FullArtistIngestSource;
  startedAt: string;
  completedAt: string;
  status: 'completed';
};

type IngestContext = {
  artistKey: string;
  browseId: string;
  source: string;
};

function normalize(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDescriptionText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function parseDurationSeconds(raw: string | null | undefined): number | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const parts = value
    .split(':')
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return null;
  return parts.reduce((acc, cur) => acc * 60 + cur, 0);
}

function nowIso(): string {
  return new Date().toISOString();
}

function withAuthoritativeChannel(browse: any, browseId: string): any {
  const artist = browse?.artist || {};
  const channelId = normalize(artist.channelId);
  const authoritativeChannelId = /^UC[A-Za-z0-9_-]+$/.test(channelId) ? channelId : browseId;
  return { ...browse, artist: { ...artist, channelId: authoritativeChannelId } };
}

async function ensureArtistChannelPersisted(ctx: IngestContext, browse: any): Promise<void> {
  const channelId = ctx.browseId;
  const result = await persistArtistChannelId({
    artistKey: ctx.artistKey,
    youtubeChannelId: channelId,
    displayName: browse?.artist?.name,
    artistDescription: normalizeDescriptionText((browse as any)?.description),
  });

  console.info('[full-artist-ingest] artist_channel_write', {
    artist_key: ctx.artistKey,
    youtube_channel_id: channelId,
    channel_write_state: result.updated ? 'written' : 'unchanged',
    previous_channel_id: result.previousChannelId,
  });
}

async function persistArtistDescriptionIfAny(ctx: IngestContext, browse: any): Promise<void> {
  const description = normalizeDescriptionText((browse as any)?.description);
  if (!description) return;

  const result = await persistArtistDescription({ artistKey: ctx.artistKey, description });
  if (result.updated) {
    console.info('[ArtistIngest] artist_description_saved', {
      artist_key: ctx.artistKey,
      description_length: description.length,
    });
  }
}

async function finalizeArtistIngest(ctx: IngestContext, albumIds: Array<{ externalId: string; albumId: string | null }>): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = nowIso();

  const { error: artistError } = await supabase.from('artists').update({ updated_at: now }).eq('artist_key', ctx.artistKey);
  if (artistError) {
    throw new Error(`[full-artist-ingest] finalize failed updating artist: ${artistError.message}`);
  }

  let complete = 0;
  let partial = 0;
  let unknown = 0;

  for (const entry of albumIds) {
    const completion = await getAlbumCompletion(entry.externalId);
    if (!completion.expected) {
      unknown += 1;
    } else if (completion.actual >= completion.expected) {
      complete += 1;
    } else {
      partial += 1;
    }
  }

  const total = albumIds.length;
  const percent = total ? Math.round((complete / total) * 100) : 0;

  console.info('[full-artist-ingest] artist_completion', {
    artist_key: ctx.artistKey,
    total_albums: total,
    completed_albums: complete,
    partial_albums: partial,
    unknown_albums: unknown,
    artist_completion_percent: percent,
  });
}

async function ingestArtistBase(ctx: IngestContext, browse: any): Promise<void> {
  console.info('[full-artist-ingest] step=ingestArtistBase start', { artist_key: ctx.artistKey });
  await ingestArtistBrowse(browse, { allowArtistWrite: true });
  console.info('[full-artist-ingest] step=ingestArtistBase finish', { artist_key: ctx.artistKey });
}

function classifyAlbumCompletion(expected: number | null, actual: number): 'complete' | 'partial' | 'unknown' {
  if (!expected) return 'unknown';
  if (actual >= expected) return 'complete';
  return 'partial';
}

async function expandArtistAlbums(
  ctx: IngestContext,
  browse: any,
  reporter?: import('../ingest/nightlyIngestRunner').NightlyIngestReporter,
): Promise<{ ingested: number; failed: number; albumRefs: Array<{ externalId: string; albumId: string | null }> }> {
  const albums = Array.isArray(browse.albums) ? browse.albums : [];
  let ingested = 0;
  let failed = 0;
  const albumRefs: Array<{ externalId: string; albumId: string | null }> = [];

  console.info('[full-artist-ingest] step=expandArtistAlbums start', { artist_key: ctx.artistKey, albums_found: albums.length });

  for (const album of albums) {
    const targetId = normalize(album.id);
    if (!targetId) continue;

    let albumTracks: Array<{ track_id: string; title: string; duration_sec: number | null }> = [];
    let albumRecorded = false;

    try {
      const completion = await getAlbumCompletion(targetId);
      albumRefs.push({ externalId: targetId, albumId: completion.albumId });
      if (completion.expected !== null && completion.actual >= completion.expected) {
        console.info('[full-artist-ingest] album_skipped_completed', {
          browseId: targetId,
          album_id: completion.albumId,
          expected_tracks: completion.expected,
          actual_tracks: completion.actual,
          completion_percent: completion.percent,
          completion_state: completion.state,
        });
        continue;
      }

      const albumBrowse = await browsePlaylistById(targetId);
      if (!albumBrowse || !Array.isArray(albumBrowse.tracks) || albumBrowse.tracks.length === 0) {
        failed += 1;
        console.error('[full-artist-ingest] album browse missing', { browseId: targetId, redirect_loop_failure: true });
        reporter?.addWarning(`album_browse_missing ${targetId}`);
        reporter?.albumProcessed({ artistKey: ctx.artistKey, albumId: targetId, albumTitle: album.title || targetId, tracks: [] });
        await getSupabaseAdmin()
          .from('albums')
          .update({ unstable: true, updated_at: nowIso() })
          .eq('external_id', targetId);
        continue;
      }

      albumTracks = (albumBrowse.tracks || []).map((t: any) => ({
        track_id: normalize(t.videoId),
        title: normalize(t.title) || 'Untitled',
        duration_sec: parseDurationSeconds(t.duration),
      }));

      const result = await ingestPlaylistOrAlbum(
        {
          kind: 'album',
          browseId: targetId,
          title: albumBrowse.title || album.title,
          subtitle: albumBrowse.subtitle,
          thumbnailUrl: albumBrowse.thumbnailUrl ?? album.imageUrl ?? null,
          tracks: albumBrowse.tracks,
          trackCount: albumBrowse.tracks?.length ?? null,
        },
        { primaryArtistKeys: [ctx.artistKey] },
      );

      reporter?.albumProcessed({
        artistKey: ctx.artistKey,
        albumId: targetId,
        albumTitle: albumBrowse.title || album.title,
        tracks: albumTracks,
        inserted: true,
        updated: true,
      });
      albumRecorded = true;
      reporter?.trackSkipped((albumBrowse.tracks || []).filter((t: any) => !normalize(t.videoId)).length);

      console.info('[full-artist-ingest] album_tracks_ingested', { browseId: targetId, count: result.albumTrackCount });
      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] album ingest failed', {
        browseId: targetId,
        message: err?.message || String(err),
      });
      reporter?.addWarning(`album_ingest_failed ${targetId}: ${err?.message || 'unknown_error'}`);
      if (!albumRecorded) {
        reporter?.albumProcessed({
          artistKey: ctx.artistKey,
          albumId: targetId,
          albumTitle: album.title || targetId,
          tracks: albumTracks,
        });
      }
    } finally {
      await sleep(3000);
    }
  }

  let completedAlbums = 0;
  for (const ref of albumRefs) {
    const completion = await getAlbumCompletion(ref.externalId);
    if (classifyAlbumCompletion(completion.expected, completion.actual) === 'complete') {
      completedAlbums += 1;
    }
  }

  if (albums.length && completedAlbums === albums.length) {
    console.info('[full-artist-ingest] artist_fully_complete', { artist_key: ctx.artistKey, albums: albums.length });
  }

  console.info('[full-artist-ingest] step=expandArtistAlbums finish', {
    artist_key: ctx.artistKey,
    albums_found: albums.length,
    albums_ingested: ingested,
    albums_failed: failed,
  });

  return { ingested, failed, albumRefs };
}

async function expandArtistPlaylists(
  ctx: IngestContext,
  browse: any,
  reporter?: import('../ingest/nightlyIngestRunner').NightlyIngestReporter,
): Promise<{ ingested: number; failed: number }> {
  const playlists = Array.isArray(browse.playlists) ? browse.playlists : [];
  let ingested = 0;
  let failed = 0;

  if (!playlists.length) {
    return { ingested, failed };
  }

  console.info('[full-artist-ingest] step=expandArtistPlaylists start', {
    artist_key: ctx.artistKey,
    playlists_found: playlists.length,
  });

  for (const playlist of playlists) {
    const targetId = normalize(playlist.id);
    if (!targetId) continue;

    try {
      const playlistBrowse = await browsePlaylistById(targetId);
      if (!playlistBrowse || !Array.isArray(playlistBrowse.tracks) || playlistBrowse.tracks.length === 0) {
        failed += 1;
        console.error('[full-artist-ingest] playlist browse missing', { browseId: targetId });
        reporter?.addWarning(`playlist_browse_missing ${targetId}`);
        reporter?.playlistProcessed({ skipped: true });
        continue;
      }

      await ingestPlaylistOrAlbum(
        {
          kind: 'playlist',
          browseId: targetId,
          title: playlistBrowse.title || playlist.title,
          subtitle: playlistBrowse.subtitle,
          thumbnailUrl: playlistBrowse.thumbnailUrl ?? playlist.imageUrl ?? null,
          tracks: playlistBrowse.tracks,
          trackCount: playlistBrowse.tracks?.length ?? null,
          channelId: ctx.browseId,
        },
        { primaryArtistKeys: [ctx.artistKey], mode: 'single-playlist' },
      );

      reporter?.playlistProcessed({ inserted: true, updated: true });
      reporter?.playlistTracksProcessed(playlistBrowse.tracks.length || 0);

      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] playlist ingest failed', {
        browseId: targetId,
        message: err?.message || String(err),
      });
      reporter?.addWarning(`playlist_ingest_failed ${targetId}: ${err?.message || 'unknown_error'}`);
      reporter?.playlistProcessed({ skipped: true });
    } finally {
      await sleep(1500);
    }
  }

  console.info('[full-artist-ingest] step=expandArtistPlaylists finish', {
    artist_key: ctx.artistKey,
    playlists_found: playlists.length,
    playlists_ingested: ingested,
    playlists_failed: failed,
  });

  return { ingested, failed };
}

export async function runFullArtistIngest(input: FullArtistIngestInput, opts?: FullArtistIngestOptions): Promise<FullArtistIngestResult> {
  const browseId = normalize(input.browseId || '');
  const source: FullArtistIngestSource = input.source || 'direct';
  const startedAt = nowIso();
  const reporter = opts?.reporter;

  if (!browseId) throw new Error('[full-artist-ingest] browseId is required');

  const browsePayload = await fetchArtistBrowseById(browseId);
  if (!browsePayload) throw new Error(`[full-artist-ingest] artist browse failed browse_id=${browseId}`);

  const canonicalArtistKey = await resolveCanonicalArtistKey(browsePayload.artist.name, browseId);

  if (input.artistKey && normalize(input.artistKey) !== canonicalArtistKey) {
    console.info('[full-artist-ingest] artist_key_normalized', {
      requested_artist_key: normalize(input.artistKey),
      canonical_artist_key: canonicalArtistKey,
    });
  }

  const ctx: IngestContext = { artistKey: canonicalArtistKey, browseId, source };
  const browse = withAuthoritativeChannel(browsePayload, browseId);

  console.info('[full-artist-ingest] status=running', ctx);

  reporter?.artistProcessed({ artistKey: ctx.artistKey, artistName: browse.artist?.name || ctx.artistKey, updated: true });

  await ensureArtistChannelPersisted(ctx, browse);
  await persistArtistDescriptionIfAny(ctx, browse);
  await ingestArtistBase(ctx, browse);
  const { albumRefs } = await expandArtistAlbums(ctx, browse, reporter);
  await expandArtistPlaylists(ctx, browse, reporter);
  await finalizeArtistIngest(ctx, albumRefs);

  const completedAt = nowIso();
  console.info('[full-artist-ingest] status=completed', { artist_key: ctx.artistKey });

  return { artistKey: ctx.artistKey, browseId, source, startedAt, completedAt, status: 'completed' };
}
