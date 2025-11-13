import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type Track = Tables<'tracks'>;
export type Playlist = Tables<'playlists'>;

export type SearchResult = (Track & { type: 'track' }) | (Playlist & { type: 'playlist' });

function escapeIlike(term: string) {
  // Escape % and _ which are wildcards in ILIKE
  return term.replace(/[%_]/g, (m) => `\\${m}`);
}

function computeScore(term: string, fields: Array<string | null | undefined>): number {
  const t = term.toLowerCase();
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const v = f.toLowerCase();
    if (v.startsWith(t)) {
      best = Math.max(best, 3);
    } else if (v.includes(t)) {
      best = Math.max(best, 2);
    }
  }
  return best;
}

export function useSearch(searchTerm: string) {
  const term = (searchTerm ?? '').trim();

  const query = useQuery<{ results: SearchResult[] }>(
    {
      queryKey: ['search', term],
      enabled: term.length > 0,
      staleTime: 5_000,
      gcTime: 60_000,
      refetchOnWindowFocus: false,
      placeholderData: (prev) => prev,
      queryFn: async () => {
        const q = escapeIlike(term);

        // Fetch tracks and playlists in parallel; limit each to 10 for performance
        const [tracksRes, playlistsRes] = await Promise.all([
          supabase
            .from('tracks')
            .select('*')
            .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
            .limit(10),
          supabase
            .from('playlists')
            .select('*')
            .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
            .limit(10),
        ]);

        if (tracksRes.error) throw tracksRes.error;
        if (playlistsRes.error) throw playlistsRes.error;

        const tracks: Array<Track & { type: 'track'; _score: number }> = (tracksRes.data ?? []).map((t) => ({
          ...t,
          type: 'track' as const,
          _score: computeScore(term, [t.title, t.artist]),
        }));

        const playlists: Array<Playlist & { type: 'playlist'; _score: number }> = (playlistsRes.data ?? []).map((p) => ({
          ...p,
          type: 'playlist' as const,
          _score: computeScore(term, [p.title, p.description ?? '']),
        }));

        // Combine, sort by relevance (desc), then cap to max 10 items total
        const mixed = [...tracks, ...playlists]
          .sort((a, b) => b._score - a._score)
          .slice(0, 10)
          .map(({ _score, ...item }) => item as SearchResult);

        return { results: mixed };
      },
    }
  );

  return query.data ?? { results: [] };
}
