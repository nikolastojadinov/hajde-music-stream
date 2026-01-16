import { getSupabaseAdmin } from './supabaseClient';
import { browseArtistById, browsePlaylistById } from './youtubeMusicClient';
import { ingestPlaylistOrAlbum } from './entityIngestion';

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
  status: 'skipped_existing' | 'completed';
};

async function ingestArtistBase(ctx: { artistKey: string; browseId: string; source: string }): Promise<void> {
  console.info(`[full-artist-ingest] step=ingestArtistBase start artist_key=${ctx.artistKey}`);
  // TODO: call base artist ingest implementation
  console.info(`[full-artist-ingest] step=ingestArtistBase finish artist_key=${ctx.artistKey}`);
}

async function expandArtistAlbums(ctx: { artistKey: string; browseId: string; source: string }): Promise<void> {
  console.info(`[full-artist-ingest] step=expandArtistAlbums start artist_key=${ctx.artistKey}`);
  const artist = await browseArtistById(ctx.browseId);
  if (!artist) {
    throw new Error(`[full-artist-ingest] artist browse failed browse_id=${ctx.browseId}`);
  }

  const albums = Array.isArray(artist.albums) ? artist.albums.filter((a) => /^MPRE/i.test(a.id || '')) : [];

  let ingested = 0;
  let failed = 0;

  for (const album of albums) {
    const browseId = album.id;
    if (!browseId) continue;

    console.info(`[full-artist-ingest] album start browse_id=${browseId}`);

    try {
      const albumBrowse = await browsePlaylistById(browseId);
      if (!albumBrowse) {
        failed += 1;
        console.error('[full-artist-ingest] album browse missing', { browseId });
        continue;
      }

      await ingestPlaylistOrAlbum({
        kind: 'album',
        browseId,
        title: albumBrowse.title || album.title,
        subtitle: albumBrowse.subtitle,
        thumbnailUrl: albumBrowse.thumbnailUrl ?? album.imageUrl ?? null,
        tracks: albumBrowse.tracks,
      });

      ingested += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[full-artist-ingest] album ingest failed', {
        browseId,
        message: err?.message || String(err),
      });
    }
  }

  console.info(`[full-artist-ingest] step=expandArtistAlbums finish artist_key=${ctx.artistKey} albums_found=${albums.length} albums_ingested=${ingested} albums_failed=${failed}`);
}

async function expandArtistPlaylists(ctx: { artistKey: string; browseId: string; source: string }): Promise<void> {
  console.info(`[full-artist-ingest] step=expandArtistPlaylists start artist_key=${ctx.artistKey}`);
  // TODO: implement playlist expansion
  console.info(`[full-artist-ingest] step=expandArtistPlaylists finish artist_key=${ctx.artistKey}`);
}

async function finalizeArtistIngest(ctx: { artistKey: string; browseId: string; source: string }): Promise<void> {
  console.info(`[full-artist-ingest] step=finalizeArtistIngest start artist_key=${ctx.artistKey}`);
  // TODO: implement finalize step
  console.info(`[full-artist-ingest] step=finalizeArtistIngest finish artist_key=${ctx.artistKey}`);
}

export async function runFullArtistIngest(input: FullArtistIngestInput): Promise<FullArtistIngestResult> {
  const artistKey = (input.artistKey || '').trim();
  const browseId = (input.browseId || '').trim();
  const source = input.source || 'direct';

  if (!artistKey || !browseId) {
    throw new Error('[full-artist-ingest] artistKey and browseId are required');
  }

  const startedAt = new Date().toISOString();
  const supabase = getSupabaseAdmin();

  const { data: existing, error: readError } = await supabase
    .from('artists')
    .select('artist_key')
    .eq('artist_key', artistKey)
    .maybeSingle();

  if (readError) {
    throw new Error(`[full-artist-ingest] failed to check artist existence: ${readError.message}`);
  }

  if (existing?.artist_key) {
    console.info(`[full-artist-ingest] skip existing artist_key=${artistKey}`);
    const completedAt = new Date().toISOString();
    return { artistKey, browseId, source, startedAt, completedAt, status: 'skipped_existing' };
  }

  const { error: insertError } = await supabase.from('artists').insert({
    artist: artistKey,
    artist_key: artistKey,
    display_name: artistKey,
    normalized_name: artistKey,
  });
  if (insertError) {
    throw new Error(`[full-artist-ingest] failed to insert artist placeholder: ${insertError.message}`);
  }

  const ctx = { artistKey, browseId, source };

  await ingestArtistBase(ctx);
  await expandArtistAlbums(ctx);
  await expandArtistPlaylists(ctx);
  await finalizeArtistIngest(ctx);

  const completedAt = new Date().toISOString();
  console.info(`[full-artist-ingest] complete artist_key=${artistKey} status=completed`);

  return { artistKey, browseId, source, startedAt, completedAt, status: 'completed' };
}
