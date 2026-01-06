import { type SearchSection } from "@/lib/api/search";
import SongShelf from "./shelves/SongShelf";
import ArtistShelf from "./shelves/ArtistShelf";
import AlbumShelf from "./shelves/AlbumShelf";

type Props = {
  section?: SearchSection | null;
  onSongPlay: (item: any, index: number, all: any[]) => void;
  onArtistOpen: (item: any) => void;
  onAlbumOpen: (item: any) => void;
};

export default function ShelfRenderer({ section, onSongPlay, onArtistOpen, onAlbumOpen }: Props) {
  if (!section) return null;

  const items = Array.isArray(section.items) ? section.items : [];
  const title = section.title ?? undefined;

  switch (section.kind) {
    case "songs":
      return <SongShelf title={title} items={items as any} onPlay={(item, index) => onSongPlay(item, index, items)} />;
    case "artists":
      return <ArtistShelf title={title} items={items as any} onOpen={onArtistOpen} />;
    case "albums":
      return <AlbumShelf title={title} items={items as any} onOpen={onAlbumOpen} />;
    default:
      return null;
  }
}
