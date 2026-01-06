type Props = {
  title?: string | null;
  items: any[];
};

function getImage(item: any): string | undefined {
  if (typeof item?.imageUrl === "string") return item.imageUrl;
  if (typeof item?.thumbnail === "string") return item.thumbnail;
  if (typeof item?.thumbnailUrl === "string") return item.thumbnailUrl;

  if (Array.isArray(item?.thumbnails)) {
    const candidate = item.thumbnails.find((thumb: any) => typeof thumb?.url === "string");
    if (candidate?.url) return candidate.url as string;
  }

  return undefined;
}

function getName(item: any): string {
  const name = item?.name || item?.title;
  if (typeof name === "string" && name.trim().length > 0) return name.trim();
  return "Artist";
}

export default function ArtistShelf({ title, items }: Props) {
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
            <div key={key} className="flex w-28 shrink-0 flex-col items-center gap-2">
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
