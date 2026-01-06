import { type SearchSection } from "@/lib/api/search";
import SongShelf from "./shelves/SongShelf";
import ArtistShelf from "./shelves/ArtistShelf";
import AlbumShelf from "./shelves/AlbumShelf";

type Props = {
  section?: SearchSection | null;
};

export default function ShelfRenderer({ section }: Props) {
  if (!section) return null;

  const items = Array.isArray(section.items) ? section.items : [];
  const title = section.title ?? undefined;

  switch (section.kind) {
    case "songs":
      return <SongShelf title={title} items={items} />;
    case "artists":
      return <ArtistShelf title={title} items={items} />;
    case "albums":
      return <AlbumShelf title={title} items={items} />;
    default:
      return null;
  }
}
