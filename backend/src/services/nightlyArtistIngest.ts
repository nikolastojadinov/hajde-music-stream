import { fetchArtistBrowseById } from '../lib/browse/browseArtist';
import { updateArtistDescriptionIfEmpty } from '../lib/db/artistQueries';
import { resolveCanonicalArtistKey } from './entityIngestion';

const LOG_CONTEXT = '[NightlyArtistIngest]';

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

export type NightlyArtistDescriptionResult = {
  canonicalArtistKey: string | null;
  descriptionUpdated: boolean;
};

export async function ensureArtistDescriptionForNightly(params: {
  artistKey: string;
  browseId: string;
  logPrefix?: string;
}): Promise<NightlyArtistDescriptionResult> {
  const browseId = normalize(params.browseId);
  const logPrefix = params.logPrefix || LOG_CONTEXT;
  const fallbackKey = normalize(params.artistKey) || null;

  if (!browseId) return { canonicalArtistKey: fallbackKey, descriptionUpdated: false };

  const browse = await fetchArtistBrowseById(browseId);
  if (!browse) return { canonicalArtistKey: fallbackKey, descriptionUpdated: false };

  const canonicalArtistKey = await resolveCanonicalArtistKey(browse.artist.name, browseId);
  const description = normalizeDescription((browse as any)?.description);
  if (!description) return { canonicalArtistKey, descriptionUpdated: false };

  const result = await updateArtistDescriptionIfEmpty(canonicalArtistKey, description);
  if (result.updated) {
    console.info(`${logPrefix} artist_description_written`, {
      artist_key: canonicalArtistKey,
      youtube_channel_id: browseId,
      description_length: description.length,
    });
  }

  return { canonicalArtistKey, descriptionUpdated: result.updated };
}
