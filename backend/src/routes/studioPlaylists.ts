import { Router, Request, Response } from 'express';
import { piAuth } from '../middleware/piAuth';
import supabase from '../services/supabaseClient';

const router = Router();
router.use(piAuth);

type AuthedRequest = Request & {
  user?: {
    id?: string;
  };
};

type CategoryPayload = {
  region: number | null;
  era: number | null;
  genres: number[];
  themes: number[];
  all: number[];
};

type PlaylistFormSubmitPayload = {
  title: string;
  description: string | null;
  cover_url: string | null;
  region_id: number;
  era_id: number;
  genre_ids: number[];
  theme_ids: number[];
  category_groups?: CategoryPayload;
  is_public?: boolean;
};

type SanitizedPayload = PlaylistFormSubmitPayload;

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const sanitizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
    .filter((entry) => isPositiveNumber(entry));
};

const sanitizeCategoryPayload = (value: unknown): CategoryPayload | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value as CategoryPayload;
  const all = sanitizeNumberArray(payload.all);
  return {
    region: isPositiveNumber(payload.region) ? payload.region : null,
    era: isPositiveNumber(payload.era) ? payload.era : null,
    genres: sanitizeNumberArray(payload.genres),
    themes: sanitizeNumberArray(payload.themes),
    all,
  };
};

const sanitizePayload = (body: unknown): { value?: SanitizedPayload; error?: string } => {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid payload.' };
  }

  const candidate = body as Partial<PlaylistFormSubmitPayload>;

  if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
    return { error: 'Title is required.' };
  }

  const regionId = typeof candidate.region_id === 'number' ? candidate.region_id : Number(candidate.region_id);
  const eraId = typeof candidate.era_id === 'number' ? candidate.era_id : Number(candidate.era_id);

  if (!isPositiveNumber(regionId)) {
    return { error: 'Region selection is invalid.' };
  }

  if (!isPositiveNumber(eraId)) {
    return { error: 'Era selection is invalid.' };
  }

  const genreIds = sanitizeNumberArray(candidate.genre_ids);
  const themeIds = sanitizeNumberArray(candidate.theme_ids);
  const categoryGroups = sanitizeCategoryPayload(candidate.category_groups);
  const visibility =
    typeof candidate.is_public === 'boolean'
      ? candidate.is_public
      : typeof candidate.is_public === 'string'
        ? candidate.is_public !== 'false'
        : true;

  return {
    value: {
      title: candidate.title.trim(),
      description:
        typeof candidate.description === 'string' && candidate.description.trim()
          ? candidate.description.trim()
          : null,
      cover_url: typeof candidate.cover_url === 'string' && candidate.cover_url.trim() ? candidate.cover_url.trim() : null,
      region_id: regionId,
      era_id: eraId,
      genre_ids: genreIds,
      theme_ids: themeIds,
      category_groups: categoryGroups,
      is_public: visibility,
    },
  };
};

router.post('/', async (req: AuthedRequest, res: Response) => {
  try {
    if (!supabase) {
      console.error('[studioPlaylists] Supabase client is not configured');
      return res.status(500).json({ error: 'Unable to create playlist' });
    }

    const walletId = req.user?.id;
    if (!walletId) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const { value, error } = sanitizePayload(req.body);
    if (error || !value) {
      return res.status(400).json({ error });
    }

    const { data: userRow, error: userLookupError } = await supabase
      .from('users')
      .select('id')
      .eq('wallet', walletId)
      .limit(1)
      .maybeSingle();

    if (userLookupError) {
      console.error('[studioPlaylists] user lookup error', userLookupError);
      return res.status(500).json({ error: 'Unable to create playlist' });
    }

    if (!userRow?.id) {
      return res.status(403).json({ error: 'user_not_registered' });
    }

    const ownerId = userRow.id as string;
    const primaryGenre = value.genre_ids[0] ?? null;

    const { data: playlistRow, error: playlistInsertError } = await supabase
      .from('playlists')
      .insert({
        title: value.title,
        description: value.description,
        cover_url: value.cover_url,
        is_public: value.is_public ?? true,
        owner_id: ownerId,
        region: value.region_id,
        era: value.era_id,
        genre: primaryGenre,
      })
      .select('id,title,description,cover_url,region,era,genre')
      .single();

    if (playlistInsertError || !playlistRow) {
      console.error('[studioPlaylists] create error', playlistInsertError);
      return res.status(500).json({ error: 'Unable to create playlist' });
    }

    const playlistId = playlistRow.id as string;
    const categoryIds = value.category_groups?.all ?? [];

    if (playlistId && categoryIds.length) {
      const uniqueCategoryIds = Array.from(new Set(categoryIds.filter((categoryId) => isPositiveNumber(categoryId))));
      if (uniqueCategoryIds.length) {
        const rows = uniqueCategoryIds.map((categoryId) => ({
          playlist_id: playlistId,
          category_id: categoryId,
        }));
        const { error: categoryInsertError } = await supabase.from('playlist_categories').insert(rows);
        if (categoryInsertError) {
          console.error('[studioPlaylists] category insert error', categoryInsertError);
        }
      }
    }

    return res.status(201).json({
      id: playlistId,
      title: playlistRow.title,
      description: playlistRow.description,
      cover_url: playlistRow.cover_url,
      region_id: playlistRow.region,
      era_id: playlistRow.era,
      genre_ids: value.genre_ids,
      theme_ids: value.theme_ids,
      is_public: value.is_public ?? true,
    });
  } catch (err) {
    console.error('[studioPlaylists] unexpected error', err);
    return res.status(500).json({ error: 'Unable to create playlist' });
  }
});

export default router;
