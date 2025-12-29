import { FiHeart, FiEye } from 'react-icons/fi';
import useSWR from 'swr';
import { withBackendOrigin } from '@/lib/backendUrl';
import { dedupeRequest } from '@/lib/requestDeduper';

interface PlaylistHeaderStatsProps {
  playlistId: string;
}

interface PublicStatsResponse {
  likes: number;
  views: number;
}

const STATS_CACHE_TTL_MS = 4000;

const fetcher = async (url: string): Promise<PublicStatsResponse> =>
  dedupeRequest<PublicStatsResponse>(
    `GET:${url}`,
    async () => {
      const response = await fetch(url, { credentials: 'include' });

      if (response.status === 401) {
        return { likes: 0, views: 0 };
      }

      if (!response.ok) {
        throw new Error('Failed to load playlist stats');
      }

      return response.json();
    },
    { ttlMs: STATS_CACHE_TTL_MS, cache: true }
  );

const buildStatsUrl = (playlistId: string) => withBackendOrigin(`/api/playlists/${playlistId}/public-stats`);

export function PlaylistHeaderStats({ playlistId }: PlaylistHeaderStatsProps) {
  const { data } = useSWR<PublicStatsResponse>(
    playlistId ? buildStatsUrl(playlistId) : null,
    fetcher,
    {
      dedupingInterval: 5000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    }
  );

  const likes = data?.likes ?? 0;
  const views = data?.views ?? 0;

  return (
    <div className="flex items-center gap-6 text-sm text-muted-foreground" aria-live="polite">
      <div className="flex items-center gap-2">
        <FiHeart className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-foreground">{likes.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2">
        <FiEye className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-foreground">{views.toLocaleString()}</span>
      </div>
    </div>
  );
}
