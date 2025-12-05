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

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const normalizeVisibility = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value !== 'false';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return true;
};

const normalizeCategoryIds = (values?: number[] | null): number[] => {
  if (!values || !values.length) {
    return [];
  }
  return Array.from(new Set(values.filter((value) => isPositiveNumber(value)))).sort((a, b) => a - b);
};

type PlaylistRow = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  owner_id: string;
  region: number | string | null;
  era: number | string | null;
  is_public: boolean | string | number | null;
};

type PlaylistCategoryRow = {
  category_id: number | string | null;
  categories?: {
    group_type?: string | null;
  } | null;
};

type PlaylistResponsePayload = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  region_id: number | null;
  era_id: number | null;
  genre_ids: number[];
  theme_ids: number[];
  category_groups: CategoryPayload;
  is_public: boolean;
};

const buildPlaylistResponse = (
  playlist: PlaylistRow,
  categories: PlaylistCategoryRow[] | null,
): PlaylistResponsePayload => {
  const genreIds: number[] = [];
  const themeIds: number[] = [];

  (categories ?? []).forEach((row) => {
    const parsedId = normalizeNumber(row.category_id);
    if (!parsedId) return;
    const group = row.categories?.group_type ?? '';
    if (group === 'genre') {
      genreIds.push(parsedId);
    }
    if (group === 'theme') {
      themeIds.push(parsedId);
    }
  });

  const uniqueGenres = Array.from(new Set(genreIds));
  const uniqueThemes = Array.from(new Set(themeIds));
  const regionId = normalizeNumber(playlist.region);
  const eraId = normalizeNumber(playlist.era);
  const allCategoryIds = Array.from(new Set([...uniqueGenres, ...uniqueThemes]));

  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    cover_url: playlist.cover_url,
    region_id: regionId,
    era_id: eraId,
    genre_ids: uniqueGenres,
    theme_ids: uniqueThemes,
    category_groups: {
      region: regionId,
      era: eraId,
      genres: uniqueGenres,
      themes: uniqueThemes,
      all: allCategoryIds,
    },
    is_public: normalizeVisibility(playlist.is_public),
  };
};

const fetchPlaylistForOwner = async (
  playlistId: string,
  ownerId: string,
): Promise<{ payload?: PlaylistResponsePayload; status?: number; error?: string }> => {
  const { data: playlistRow, error: playlistError } = await supabase
    .from('playlists')
    .select('id,title,description,cover_url,owner_id,region,era,is_public')
    .eq('id', playlistId)
    .maybeSingle();

  if (playlistError) {
    console.error('[studioPlaylists] playlist fetch error', playlistError);
    return { status: 500, error: 'Unable to load playlist' };
  }

  if (!playlistRow) {
    return { status: 404, error: 'Playlist not found' };
  }

  if (playlistRow.owner_id !== ownerId) {
    return { status: 403, error: 'not_authorized' };
  }

  const { data: categoryRows, error: categoryError } = await supabase
    .from('playlist_categories')
    .select('category_id,categories!inner(group_type)')
    .eq('playlist_id', playlistId);

  if (categoryError) {
    console.error('[studioPlaylists] category fetch error', categoryError);
    return { status: 500, error: 'Unable to load playlist' };
  }

  return { payload: buildPlaylistResponse(playlistRow as PlaylistRow, categoryRows as PlaylistCategoryRow[]) };
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

router.get('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    if (!supabase) {
      console.error('[studioPlaylists] Supabase client is not configured');
      return res.status(500).json({ error: 'Unable to load playlist' });
    }

    const walletId = req.user?.id;
    if (!walletId) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const playlistId = req.params.id;
    if (!playlistId) {
      return res.status(400).json({ error: 'Missing playlist id' });
    }

    const { data: userRow, error: userLookupError } = await supabase
      .from('users')
      .select('id')
      .eq('wallet', walletId)
      .limit(1)
      .maybeSingle();

    if (userLookupError) {
      console.error('[studioPlaylists] user lookup error', userLookupError);
      return res.status(500).json({ error: 'Unable to load playlist' });
    }

    if (!userRow?.id) {
      return res.status(403).json({ error: 'user_not_registered' });
    }

    const ownedPlaylist = await fetchPlaylistForOwner(playlistId, userRow.id as string);
    if (!ownedPlaylist.payload) {
      return res.status(ownedPlaylist.status ?? 500).json({ error: ownedPlaylist.error ?? 'Unable to load playlist' });
    }

    return res.json(ownedPlaylist.payload);
  } catch (err) {
    console.error('[studioPlaylists] unexpected load error', err);
    return res.status(500).json({ error: 'Unable to load playlist' });
  }
});

router.put('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    if (!supabase) {
      console.error('[studioPlaylists] Supabase client is not configured');
      return res.status(500).json({ error: 'Unable to update playlist' });
    }

    const walletId = req.user?.id;
    if (!walletId) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const playlistId = req.params.id;
    if (!playlistId) {
      return res.status(400).json({ error: 'Missing playlist id' });
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
      return res.status(500).json({ error: 'Unable to update playlist' });
    }

    if (!userRow?.id) {
      return res.status(403).json({ error: 'user_not_registered' });
    }

    const ownerId = userRow.id as string;

    const existing = await fetchPlaylistForOwner(playlistId, ownerId);
    if (!existing.payload) {
      return res.status(existing.status ?? 500).json({ error: existing.error ?? 'Unable to update playlist' });
    }

    const primaryGenre = value.genre_ids[0] ?? null;

    const { error: updateError } = await supabase
      .from('playlists')
      .update({
        title: value.title,
        description: value.description,
        cover_url: value.cover_url,
        region: value.region_id,
        era: value.era_id,
        genre: primaryGenre,
        is_public: value.is_public ?? true,
      })
      .eq('id', playlistId)
      .eq('owner_id', ownerId);

    if (updateError) {
      console.error('[studioPlaylists] update error', updateError);
      return res.status(500).json({ error: 'Unable to update playlist' });
    }

    const existingCategoryIds = normalizeCategoryIds(existing.payload.category_groups?.all);
    const categoryIds = normalizeCategoryIds(value.category_groups?.all);
    const categoriesChanged =
      existingCategoryIds.length !== categoryIds.length ||
      existingCategoryIds.some((categoryId, index) => categoryId !== categoryIds[index]);

    if (categoriesChanged) {
      const { error: deleteError } = await supabase.from('playlist_categories').delete().eq('playlist_id', playlistId);
      if (deleteError) {
        console.error('[studioPlaylists] category reset error', deleteError);
        return res.status(500).json({ error: 'Unable to update playlist' });
      }

      if (categoryIds.length) {
        const rows = categoryIds.map((categoryId) => ({ playlist_id: playlistId, category_id: categoryId }));
        const { error: categoryInsertError } = await supabase.from('playlist_categories').insert(rows);
        if (categoryInsertError) {
          console.error('[studioPlaylists] category insert error', categoryInsertError);
          return res.status(500).json({ error: 'Unable to update playlist' });
        }
      }
    }

    const refreshed = await fetchPlaylistForOwner(playlistId, ownerId);
    if (!refreshed.payload) {
      return res.status(refreshed.status ?? 500).json({ error: 'Playlist updated but failed to reload' });
    }

    return res.json(refreshed.payload);
  } catch (err) {
    console.error('[studioPlaylists] unexpected update error', err);
    return res.status(500).json({ error: 'Unable to update playlist' });
  }
});

export default router;
