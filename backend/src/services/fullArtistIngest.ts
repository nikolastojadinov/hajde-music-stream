import { fetchArtistBrowseById } from '../lib/browse/browseArtist';
import { ingestArtistBrowse } from './entityIngestion';
import { ingestPlaylistOrAlbum } from './ingestPlaylistOrAlbum';
import { getSupabaseAdmin } from './supabaseClient';
import { browsePlaylistById } from './youtubeMusicClient';

export type FullArtistIngestInput = {
  artistKey: string;
  browseId: string;
  source: 'search' | 'suggest' | 'direct';
  force?: boolean;
};

export type FullArtistIngestResult = {
  artistKey: string;
  browseId: string;
  source: 'search' | 'suggest' | 'direct';
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

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureArtistExists(artistKey: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: readError } = await supabase
    .from('artists')
    .select('artist_key')
    .eq('artist_key', artistKey)
    .maybeSingle();

  if (readError) {
    throw new Error(`[full-artist-ingest] failed to check artist existence: ${readError.message}`);
  }

  if (existing?.artist_key) return;

  const { error: insertError } = await supabase.from('artists').insert({
    artist: artistKey,
    artist_key: artistKey,
    display_name: artistKey,
    normalized_name: artistKey.toLowerCase(),
  });

  if (insertError) {
    throw new Error(`[full-artist-ingest] failed to insert artist placeholder: ${insertError.message}`);
  }
}

async function ingestArtistBase(ctx: IngestContext, browseId: string): Promise<void> {
  const browse = await fetchArtistBrowseById(browseId);
  if (!browse) {
    throw new Error(`[full-artist-ingest] artist browse failed browse_id=${browseId}`);
  }

  console.info(`[full-artist-ingest] step=ingestArtistBase start artist_key=${ctx.artistKey}`);
  await ingestArtistBrowse(browse);
  console.info(`[full-artist-ingest] step=ingestArtistBase finish artist_key=${ctx.artistKey}`);
}

async function expandArtistAlbums(ctx: IngestContext, browseId: string): Promise<void> {
  const browse = await fetchArtistBrowseById(browseId);
  if (!browse) return;

  console.info(`[full-artist-ingest] step=expandArtistAlbums start artist_key=${ctx.artistKey}`);

  const albums = Array.isArray(browse.albums) ? browse.albums : [];
  let ingested = 0;
  let failed = 0;

  for (const album of albums) {
    const targetId = normalize(album.id);
    if (!targetId) continue;

    try {
      const albumBrowse = await browsePlaylistById(targetId);
      if (!albumBrowse || !Array.isArray(albumBrowse.tracks) || albumBrowse.tracks.length === 0) {
        failed += 1;
        console.error('[full-artist-ingest] album browse missing', { browseId: targetId });
        continue;
      }

      const result = await ingestPlaylistOrAlbum(
        {
          kind: 'album',
          browseId: targetId,
          title: albumBrowse.title || album.title,
          subtitle: albumBrowse.subtitle,
          thumbnailUrl: albumBrowse.thumbnailUrl ?? album.imageUrl ?? null,
          tracks: albumBrowse.tracks,
        },
        { primaryArtistKeys: [ctx.artistKey] },
      );

      console.info('[full-artist-ingest] album_tracks_ingested', { browseId: targetId, count: result.albumTrackCount });
      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] album ingest failed', {
        browseId: targetId,
        message: err?.message || String(err),
      });
    }
  }

  console.info(
    `[full-artist-ingest] step=expandArtistAlbums finish artist_key=${ctx.artistKey} albums_found=${albums.length} albums_ingested=${ingested} albums_failed=${failed}`,
  );
}

async function finalizeArtistIngest(ctx: IngestContext): Promise<void> {
  console.info(`[full-artist-ingest] step=finalizeArtistIngest start artist_key=${ctx.artistKey}`);

  const supabase = getSupabaseAdmin();
  const now = nowIso();

  const { error: artistError } = await supabase.from('artists').update({ updated_at: now }).eq('artist_key', ctx.artistKey);
  if (artistError) {
    throw new Error(`[full-artist-ingest] finalize failed updating artist: ${artistError.message}`);
  }

  console.info(`[full-artist-ingest] finalized artist_key=${ctx.artistKey}`);
}

export async function runFullArtistIngest(input: FullArtistIngestInput): Promise<FullArtistIngestResult> {
  const artistKey = normalize(input.artistKey || '');
  const browseId = normalize(input.browseId || '');
  const source = input.source || 'direct';

  if (!artistKey || !browseId) {
    throw new Error('[full-artist-ingest] artistKey and browseId are required');
  }

  const startedAt = nowIso();
  console.info('[full-artist-ingest] status=running', { artistKey, browseId, source });

  await ensureArtistExists(artistKey);

  const ctx: IngestContext = { artistKey, browseId, source };

  await ingestArtistBase(ctx, browseId);
  await expandArtistAlbums(ctx, browseId);
  await finalizeArtistIngest(ctx);

  const completedAt = nowIso();
  console.info('[full-artist-ingest] status=completed', { artistKey });

  return { artistKey, browseId, source, startedAt, completedAt, status: 'completed' };
}
import { fetchArtistBrowseById } from '../lib/browse/browseArtist';
import { ingestArtistBrowse } from './entityIngestion';
import { ingestPlaylistOrAlbum } from './ingestPlaylistOrAlbum';
import { getSupabaseAdmin } from './supabaseClient';
import { browsePlaylistById } from './youtubeMusicClient';

export type FullArtistIngestInput = {
  artistKey: string;
  browseId: string;
  source: 'search' | 'suggest' | 'direct';
  force?: boolean;
};

export type FullArtistIngestResult = {
  artistKey: string;
  browseId: string;
  source: 'search' | 'suggest' | 'direct';
  startedAt: string;
  completedAt: string;
  status: 'completed';
};

export type FullArtistIngestSkip = {
  artistKey: string;
  browseId: string;
  source: 'search' | 'suggest' | 'direct';
  status: 'skipped';
  reason: 'already_completed' | 'already_running' | 'lock_conflict';
};

type IngestContext = {
  artistKey: string;
  browseId: string;
  source: string;
};

type ArtistIngestStatus = 'pending' | 'running' | 'completed' | 'failed';

const STATUS_TABLE = 'artist_cache_entries';

function normalize(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureArtistExists(artistKey: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: readError } = await supabase
    .from('artists')
    .select('artist_key')
    .eq('artist_key', artistKey)
    .maybeSingle();

  if (readError) {
    throw new Error(`[full-artist-ingest] failed to check artist existence: ${readError.message}`);
  }

  if (existing?.artist_key) return;

  const { error: insertError } = await supabase.from('artists').insert({
    artist: artistKey,
    artist_key: artistKey,
    display_name: artistKey,
    normalized_name: artistKey.toLowerCase(),
  });

  if (insertError) {
    throw new Error(`[full-artist-ingest] failed to insert artist placeholder: ${insertError.message}`);
  }
}

function parseStatus(payload: any): ArtistIngestStatus | null {
  const status = payload?.status;
  if (status === 'pending' || status === 'running' || status === 'completed' || status === 'failed') return status;
  return null;
}

async function readArtistStatus(artistKey: string): Promise<{ status: ArtistIngestStatus | null; error?: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(STATUS_TABLE).select('payload').eq('artist_key', artistKey).maybeSingle();
  if (error) {
    throw new Error(`[full-artist-ingest] failed to read status: ${error.message}`);
  }
  const payload = data?.payload ?? null;
  return {
    status: parseStatus(payload),
    error: typeof payload?.error === 'string' ? payload.error : null,
  };
}

async function setArtistStatus(artistKey: string, status: ArtistIngestStatus, errorMessage?: string | null, expected?: ArtistIngestStatus): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const payload = { status, ts: nowIso(), error: errorMessage ?? null };
  const query = supabase.from(STATUS_TABLE).update({ payload }).eq('artist_key', artistKey);
  if (expected) query.eq('payload->>status', expected);
  const { data, error } = await query.select('artist_key');
  if (error) throw new Error(`[full-artist-ingest] failed to set status: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

async function insertArtistStatus(artistKey: string, status: ArtistIngestStatus): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const payload = { status, ts: nowIso(), error: null };
  const { error } = await supabase.from(STATUS_TABLE).insert({ artist_key: artistKey, payload });
  if (!error) return true;
  if ((error as any)?.code === '23505') return false;
  throw new Error(`[full-artist-ingest] failed to insert status: ${error.message}`);
}

async function acquireArtistLock(artistKey: string, force: boolean): Promise<{ started: boolean; reason?: FullArtistIngestSkip['reason'] }> {
  const current = await readArtistStatus(artistKey);

  if (!force) {
    if (current.status === 'completed') return { started: false, reason: 'already_completed' };
    if (current.status === 'running' || current.status === 'pending') return { started: false, reason: 'already_running' };
  } else if (current.status === 'running') {
    return { started: false, reason: 'already_running' };
  }

  // No existing row: insert running
  if (!current.status) {
    const inserted = await insertArtistStatus(artistKey, 'running');
    if (!inserted) return { started: false, reason: 'lock_conflict' };
    return { started: true };
  }

  // Existing row in failed/completed or force override
  const updated = await setArtistStatus(artistKey, 'running', null, current.status);
  if (!updated) return { started: false, reason: 'lock_conflict' };
  return { started: true };
}

async function ingestArtistBase(ctx: IngestContext, browseId: string): Promise<void> {
  const browse = await fetchArtistBrowseById(browseId);
  if (!browse) {
    throw new Error(`[full-artist-ingest] artist browse failed browse_id=${browseId}`);
  }

  console.info(`[full-artist-ingest] step=ingestArtistBase start artist_key=${ctx.artistKey}`);
  await ingestArtistBrowse(browse);
  console.info(`[full-artist-ingest] step=ingestArtistBase finish artist_key=${ctx.artistKey}`);
}

async function expandArtistAlbums(ctx: IngestContext, browseId: string): Promise<void> {
  const browse = await fetchArtistBrowseById(browseId);
  if (!browse) return;

  console.info(`[full-artist-ingest] step=expandArtistAlbums start artist_key=${ctx.artistKey}`);

  const albums = Array.isArray(browse.albums) ? browse.albums : [];
  let ingested = 0;
  let failed = 0;

  for (const album of albums) {
    const targetId = normalize(album.id);
    if (!targetId) continue;

    try {
      const albumBrowse = await browsePlaylistById(targetId);
      if (!albumBrowse || !Array.isArray(albumBrowse.tracks) || albumBrowse.tracks.length === 0) {
        failed += 1;
        console.error('[full-artist-ingest] album browse missing', { browseId: targetId });
        continue;
      }

      const result = await ingestPlaylistOrAlbum(
        {
          kind: 'album',
          browseId: targetId,
          title: albumBrowse.title || album.title,
          subtitle: albumBrowse.subtitle,
          thumbnailUrl: albumBrowse.thumbnailUrl ?? album.imageUrl ?? null,
          tracks: albumBrowse.tracks,
        },
        { primaryArtistKeys: [ctx.artistKey] },
      );

      console.info('[full-artist-ingest] album_tracks_ingested', { browseId: targetId, count: result.albumTrackCount });
      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] album ingest failed', {
        browseId: targetId,
        message: err?.message || String(err),
      });
    }
  }

  console.info(
    `[full-artist-ingest] step=expandArtistAlbums finish artist_key=${ctx.artistKey} albums_found=${albums.length} albums_ingested=${ingested} albums_failed=${failed}`,
  );
}

async function finalizeArtistIngest(ctx: IngestContext): Promise<void> {
  console.info(`[full-artist-ingest] step=finalizeArtistIngest start artist_key=${ctx.artistKey}`);

  const supabase = getSupabaseAdmin();
  const now = nowIso();

  const { error: artistError } = await supabase.from('artists').update({ updated_at: now }).eq('artist_key', ctx.artistKey);
  if (artistError) {
    throw new Error(`[full-artist-ingest] finalize failed updating artist: ${artistError.message}`);
  }

  await setArtistStatus(ctx.artistKey, 'completed');

  console.info(`[full-artist-ingest] finalized artist_key=${ctx.artistKey}`);
}

export async function runFullArtistIngest(input: FullArtistIngestInput): Promise<FullArtistIngestResult | FullArtistIngestSkip> {
  const artistKey = normalize(input.artistKey || '');
  const browseId = normalize(input.browseId || '');
  const source = input.source || 'direct';
  const force = Boolean(input.force);

  if (!artistKey || !browseId) {
    throw new Error('[full-artist-ingest] artistKey and browseId are required');
  }

  const startedAt = nowIso();
  const lock = await acquireArtistLock(artistKey, force);

  if (!lock.started) {
    const reason = lock.reason || 'already_running';
    console.info(`[full-artist-ingest] artist ingest skipped: ${reason}`, { artistKey });
    return { artistKey, browseId, source, status: 'skipped', reason };
  }

  let caughtError: any;

  try {
    await ensureArtistExists(artistKey);

    const ctx: IngestContext = { artistKey, browseId, source };

    await ingestArtistBase(ctx, browseId);
    await expandArtistAlbums(ctx, browseId);
    await finalizeArtistIngest(ctx);

    const completedAt = nowIso();
    console.info('[full-artist-ingest] status=completed', { artistKey });

    return { artistKey, browseId, source, startedAt, completedAt, status: 'completed' };
  } catch (err: any) {
    caughtError = err;
    throw err;
  } finally {
    if (caughtError) {
      try {
        await setArtistStatus(artistKey, 'failed', caughtError?.message || String(caughtError));
      } catch (statusErr: any) {
        console.error('[full-artist-ingest] failed to mark failed', {
          artistKey,
          message: statusErr?.message || String(statusErr),
        });
      }
    }
  }
}
