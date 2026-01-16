import { fetchArtistBrowseById } from '../lib/browse/browseArtist';
import { ingestArtistBrowse } from './entityIngestion';
import { ingestPlaylistOrAlbum } from './ingestPlaylistOrAlbum';
import { getSupabaseAdmin } from './supabaseClient';
import { browsePlaylistById } from './youtubeMusicClient';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    } finally {
      await sleep(3000);
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
