import { FiHeart, FiEye } from 'react-icons/fi';
import useSWR from 'swr';

interface PlaylistHeaderStatsProps {
  playlistId: string;
}

interface PublicStatsResponse {
  global_likes: number;
  global_clicks: number;
}

const fetcher = async (url: string): Promise<PublicStatsResponse> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to load playlist stats');
  }

  return response.json();
};

export function PlaylistHeaderStats({ playlistId }: PlaylistHeaderStatsProps) {
  const { data } = useSWR<PublicStatsResponse>(
    playlistId ? `/api/playlists/${playlistId}/public-stats` : null,
    fetcher
  );

  const likes = data?.global_likes ?? 0;
  const views = data?.global_clicks ?? 0;

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
