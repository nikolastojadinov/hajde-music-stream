import { type SearchAlbumItem } from "@/lib/api/search";

type Props = {
  title?: string | null;
  items: SearchAlbumItem[];
  onOpen: (item: SearchAlbumItem) => void;
};

function getImage(item: SearchAlbumItem): string | undefined {
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

function getTitle(item: SearchAlbumItem): string {
  const title = item?.title || (item as any)?.name;
  if (typeof title === "string" && title.trim().length > 0) return title.trim();
  return "Album";
}

function getSubtitle(item: SearchAlbumItem): string {
  const subtitle = item?.channelTitle || item?.artist;
  return typeof subtitle === "string" ? subtitle : "";
}

export default function AlbumShelf({ title, items, onOpen }: Props) {
  if (!items || items.length === 0) return null;

  const heading = title ?? "Albums";

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-white">{heading}</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((item, index) => {
          const cardTitle = getTitle(item);
          const cardSubtitle = getSubtitle(item);
          const image = getImage(item);
          const key = item?.id ?? `${heading}-${index}`;

          return (
            <button
              key={key}
              onClick={() => onOpen(item)}
              className="w-40 shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left transition hover:border-[#F6C66D]/60 hover:shadow-[0_12px_30px_rgba(0,0,0,0.45)]"
            >
              <div className="aspect-square w-full overflow-hidden rounded-md bg-neutral-800">
                {image ? (
                  <img
                    src={image}
                    alt={cardTitle}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                    No image
                  </div>
                )}
              </div>
              <div className="mt-2 space-y-1">
                <p className="text-sm font-semibold text-white truncate">{cardTitle}</p>
                {cardSubtitle && (
                  <p className="text-xs text-neutral-400 truncate">{cardSubtitle}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
