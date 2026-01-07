import type { SearchSuggestItem } from "@/lib/api/search";

type SearchSuggestListProps = {
  suggestions: SearchSuggestItem[];
  onSelect: (item: SearchSuggestItem) => void;
};

export default function SearchSuggestList({ suggestions, onSelect }: SearchSuggestListProps) {
  return (
    <div className="flex flex-col divide-y divide-neutral-800 text-sm">
      {suggestions.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item)}
          className="flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-900"
        >
          <div className="h-12 w-12 overflow-hidden rounded-full bg-neutral-800">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-neutral-50">{item.name}</span>
            <span className="truncate text-xs text-neutral-500">Artist</span>
          </div>
        </button>
      ))}
    </div>
  );
}
