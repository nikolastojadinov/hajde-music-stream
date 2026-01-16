import { getSupabaseAdmin } from './supabaseClient';
import { browseArtistById, browsePlaylistById, type ArtistBrowse } from './youtubeMusicClient';
import { ingestArtistBrowse, ingestPlaylistOrAlbum } from './entityIngestion';
import { setArtistIngestStatus } from './artistIngestGuard';

export type FullArtistIngestInput = {
  artistKey: string;
  browseId: string;
  source: 'search' | 'suggest' | 'direct';
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

async function ingestArtistBase(ctx: IngestContext, browse: ArtistBrowse): Promise<void> {
  console.info(`[full-artist-ingest] step=ingestArtistBase start artist_key=${ctx.artistKey}`);
  await ingestArtistBrowse(browse);
  console.info(`[full-artist-ingest] step=ingestArtistBase finish artist_key=${ctx.artistKey}`);
}

async function expandArtistAlbums(ctx: IngestContext, browse: ArtistBrowse): Promise<void> {
  console.info(`[full-artist-ingest] step=expandArtistAlbums start artist_key=${ctx.artistKey}`);

  const albums = Array.isArray(browse.albums) ? browse.albums : [];
  let ingested = 0;
  let failed = 0;

  for (const album of albums) {
    const browseId = normalize(album.id);
    if (!browseId) continue;

    console.info(`[full-artist-ingest] album start browse_id=${browseId}`);

    try {
      const albumBrowse = await browsePlaylistById(browseId);
      if (!albumBrowse || !Array.isArray(albumBrowse.tracks) || albumBrowse.tracks.length === 0) {
        failed += 1;
        console.error('[full-artist-ingest] album browse missing', { browseId });
        continue;
      }

      await ingestPlaylistOrAlbum(
        {
          kind: 'album',
          browseId,
          title: albumBrowse.title || album.title,
          subtitle: albumBrowse.subtitle,
          thumbnailUrl: albumBrowse.thumbnailUrl ?? album.imageUrl ?? null,
          tracks: albumBrowse.tracks,
        },
        { primaryArtistKeys: [ctx.artistKey] },
      );

      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] album ingest failed', {
        browseId,
        message: err?.message || String(err),
      });
    }
  }

  console.info(
    `[full-artist-ingest] step=expandArtistAlbums finish artist_key=${ctx.artistKey} albums_found=${albums.length} albums_ingested=${ingested} albums_failed=${failed}`,
  );
}

async function expandArtistPlaylists(ctx: IngestContext, browse: ArtistBrowse): Promise<void> {
  console.info(`[full-artist-ingest] step=expandArtistPlaylists start artist_key=${ctx.artistKey}`);

  const playlists = Array.isArray(browse.playlists) ? browse.playlists : [];
  let ingested = 0;
  let failed = 0;

  for (const playlist of playlists) {
    const browseId = normalize(playlist.id);
    if (!browseId) continue;

    console.info(`[full-artist-ingest] playlist start browse_id=${browseId}`);

    try {
      const playlistBrowse = await browsePlaylistById(browseId);
      if (!playlistBrowse || !Array.isArray(playlistBrowse.tracks) || playlistBrowse.tracks.length === 0) {
        failed += 1;
        console.error('[full-artist-ingest] playlist browse missing', { browseId });
        continue;
      }

      await ingestPlaylistOrAlbum(
        {
          kind: 'playlist',
          browseId,
          title: playlistBrowse.title || playlist.title,
          subtitle: playlistBrowse.subtitle,
          thumbnailUrl: playlistBrowse.thumbnailUrl ?? playlist.imageUrl ?? null,
          tracks: playlistBrowse.tracks,
        },
        { primaryArtistKeys: [ctx.artistKey] },
      );

      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] playlist ingest failed', {
        browseId,
        message: err?.message || String(err),
      });
    }
  }

  console.info(
    `[full-artist-ingest] step=expandArtistPlaylists finish artist_key=${ctx.artistKey} playlists_found=${playlists.length} playlists_ingested=${ingested} playlists_failed=${failed}`,
  );
}

async function finalizeArtistIngest(ctx: IngestContext): Promise<void> {
  console.info(`[full-artist-ingest] step=finalizeArtistIngest start artist_key=${ctx.artistKey}`);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error: artistError } = await supabase.from('artists').update({ updated_at: now }).eq('artist_key', ctx.artistKey);

  if (artistError) {
    throw new Error(`[full-artist-ingest] finalize failed updating artist: ${artistError.message}`);
  }

  const { error: cacheError } = await supabase.from('artist_cache_entries').upsert({
    artist_key: ctx.artistKey,
    payload: { status: 'completed', ts: now },
    ts: now,
  });

  if (cacheError) {
    throw new Error(`[full-artist-ingest] finalize failed updating cache: ${cacheError.message}`);
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

  const startedAt = new Date().toISOString();
  let caughtError: any;

  try {
    await ensureArtistExists(artistKey);

    const browse = await browseArtistById(browseId);
    if (!browse) {
      throw new Error(`[full-artist-ingest] artist browse failed browse_id=${browseId}`);
    }

    const ctx: IngestContext = { artistKey, browseId, source };

    await ingestArtistBase(ctx, browse);
    await expandArtistAlbums(ctx, browse);
    await expandArtistPlaylists(ctx, browse);
    await finalizeArtistIngest(ctx);

    const completedAt = new Date().toISOString();
    await setArtistIngestStatus(artistKey, 'completed', undefined, 'pending');
    console.info('[full-artist-ingest] status=completed', { artistKey });

    return { artistKey, browseId, source, startedAt, completedAt, status: 'completed' };
  } catch (err: any) {
    caughtError = err;
    throw err;
  } finally {
    if (caughtError) {
      try {
        await setArtistIngestStatus(artistKey, 'completed', caughtError?.message || String(caughtError), 'pending');
      } catch (statusErr: any) {
        console.error('[full-artist-ingest] failed to release lock', {
          artistKey,
          message: statusErr?.message || String(statusErr),
        });
      }
    }
  }
}
