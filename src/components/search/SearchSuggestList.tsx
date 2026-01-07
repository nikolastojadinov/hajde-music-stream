import type { SearchSuggestItem } from "@/lib/api/search";

type SearchSuggestListProps = {
  suggestions: SearchSuggestItem[];
  onSelect: (item: SearchSuggestItem) => void;
};

const typeLabel: Record<SearchSuggestItem["type"], string> = {
  artist: "Artist",
  album: "Album",
  playlist: "Playlist",
  track: "Song",
};

export default function SearchSuggestList({ suggestions, onSelect }: SearchSuggestListProps) {
  return (
    <div className="flex flex-col divide-y divide-neutral-800 text-sm">
      {suggestions.map((item) => {
        const secondary = [typeLabel[item.type], item.subtitle].filter(Boolean).join(" • ");

        return (
          <button
            key={`${item.type}-${item.id}`}
            type="button"
            onClick={() => onSelect(item)}
            className="flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-900"
          >
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-neutral-800">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
              ) : (
                <div className="text-xs font-semibold uppercase text-neutral-400">
                  {item.name.slice(0, 2)}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-neutral-50">{item.name}</span>
              {secondary ? <span className="truncate text-xs text-neutral-500">{secondary}</span> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
