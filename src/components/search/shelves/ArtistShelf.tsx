import { type SearchArtistItem } from "@/lib/api/search";

type Props = {
  title?: string | null;
  items: SearchArtistItem[];
  onOpen: (item: SearchArtistItem) => void;
};

function getImage(item: SearchArtistItem): string | undefined {
  if (typeof item?.imageUrl === "string") return item.imageUrl;
  if (typeof (item as any)?.thumbnail === "string") return (item as any).thumbnail;
  if (typeof (item as any)?.thumbnailUrl === "string") return (item as any).thumbnailUrl;

  const thumbs = (item as any)?.thumbnails;
  if (Array.isArray(thumbs)) {
    const candidate = thumbs.find((thumb: any) => typeof thumb?.url === "string");
    if (candidate?.url) return candidate.url as string;
  }

  return undefined;
}

function getName(item: SearchArtistItem): string {
  const name = item?.name || (item as any)?.title;
  if (typeof name === "string" && name.trim().length > 0) return name.trim();
  return "Artist";
}

export default function ArtistShelf({ title, items, onOpen }: Props) {
  if (!items || items.length === 0) return null;

  const heading = title ?? "Artists";

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-white">{heading}</h3>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((item, index) => {
          const name = getName(item);
          const image = getImage(item);
          const key = item?.id ?? `${heading}-${index}`;

          return (
            <button
              key={key}
              onClick={() => onOpen(item)}
              className="flex w-28 shrink-0 flex-col items-center gap-2 rounded-lg border border-transparent px-1 py-2 transition hover:border-[#F6C66D]/60 hover:bg-white/5"
            >
              <div className="h-24 w-24 overflow-hidden rounded-full border border-neutral-800 bg-neutral-900">
                {image ? (
                  <img
                    src={image}
                    alt={name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                    No image
                  </div>
                )}
              </div>
              <p className="w-full truncate text-center text-sm font-semibold text-white">{name}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
