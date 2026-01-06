import { useNavigate } from "react-router-dom";
import { type SearchSection, type SearchTrackItem } from "@/lib/api/search";
import ShelfRenderer from "./ShelfRenderer";
import { usePlayer } from "@/contexts/PlayerContext";

type Props = {
  sections?: SearchSection[];
};

export default function YTMusicSearch({ sections = [] }: Props) {
  const navigate = useNavigate();
  const { playCollection } = usePlayer();

  const safeSections = Array.isArray(sections) ? sections.filter(Boolean) : [];

  const handleSongPlay = (_item: any, index: number, allItems: any[]) => {
    const normalized = (allItems as SearchTrackItem[])
      .map((track) => {
        const youtubeVideoId = (track.youtubeVideoId || (track as any)?.youtubeId || track.id || "").trim();
        if (!youtubeVideoId) return null;

        const title = (track.title || (track as any)?.name || "Song").trim();
        const artist = (track.artists?.find(Boolean) || track.artist || (track as any)?.channelTitle || "Artist").toString();
        const thumbnail =
          track.imageUrl ||
          (track as any)?.thumbnailUrl ||
          (track as any)?.thumbnail ||
          ((track as any)?.thumbnails || []).find((thumb: any) => typeof thumb?.url === "string")?.url;

        return {
          youtubeVideoId,
          title: title || "Song",
          artist: artist || "Artist",
          thumbnailUrl: typeof thumbnail === "string" ? thumbnail : undefined,
        };
      })
      .filter(Boolean) as any[];

    if (normalized.length === 0) return;
    const safeIndex = Number.isFinite(index) ? Math.max(0, Math.min(index, normalized.length - 1)) : 0;
    playCollection(normalized, safeIndex, "song", null);
  };

  const handleArtistOpen = (artist: any) => {
    const id = (artist?.id || artist?.channelId || artist?.browseId || "").trim();
    if (!id) return;
    navigate(`/artist/${id}`);
  };

  const handleAlbumOpen = (album: any) => {
    const id = (album?.id || album?.playlistId || album?.browseId || "").trim();
    if (!id) return;
    navigate(`/playlist/${id}`);
  };

  return (
    <div className="space-y-8">
      {safeSections.map((section, index) => (
        <ShelfRenderer
          key={`${section?.kind ?? "section"}-${index}`}
          section={section}
          onSongPlay={handleSongPlay}
          onArtistOpen={handleArtistOpen}
          onAlbumOpen={handleAlbumOpen}
        />
      ))}
    </div>
  );
}
