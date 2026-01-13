import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useSearchResults } from "../lib/api/search";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_.]+/g, " ")
    .trim();
}

function selectHero(orderedItems: any[], query: string) {
  if (!orderedItems?.length) return null;

  const nq = normalize(query);
  const artists = orderedItems.filter((i) => i.type === "artist");

  // 1) Official exact match
  for (const item of artists) {
    if (
      item.data?.isOfficial &&
      normalize(item.data?.name ?? "") === nq
    ) {
      return item;
    }
  }

  // 2) Any exact artist match
  for (const item of artists) {
    if (normalize(item.data?.name ?? "") === nq) {
      return item;
    }
  }

  // 3) First artist
  if (artists.length > 0) return artists[0];

  // 4) Absolute fallback
  return orderedItems[0];
}

export default function Search() {
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";

  const { data, isLoading } = useSearchResults(query);
  const orderedItems = data?.orderedItems ?? [];

  const hero = useMemo(
    () => selectHero(orderedItems, query),
    [orderedItems, query]
  );

  const rest = useMemo(() => {
    if (!hero) return orderedItems;
    return orderedItems.filter(
      (i) =>
        !(
          i.type === hero.type &&
          i.data?.id &&
          i.data.id === hero.data?.id
        )
    );
  }, [orderedItems, hero]);

  if (!query) return null;
  if (isLoading) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-4 space-y-6">
      {/* HERO */}
      {hero && (
        <div className="border rounded-lg p-4 bg-neutral-900">
          <div className="text-xs uppercase opacity-60 mb-1">
            {hero.type}
          </div>
          <div className="text-2xl font-bold">
            {hero.data?.name || hero.data?.title}
          </div>
          {hero.data?.imageUrl && (
            <img
              src={hero.data.imageUrl}
              alt=""
              className="mt-3 w-48 rounded"
            />
          )}
        </div>
      )}

      {/* RESULTS */}
      <div className="space-y-2">
        {rest.map((item, idx) => (
          <div
            key={`${item.type}-${item.data?.id ?? idx}`}
            className="border rounded p-3 hover:bg-neutral-800 cursor-pointer"
          >
            <div className="text-sm opacity-60">
              {item.type}
            </div>
            <div className="font-medium">
              {item.data?.name || item.data?.title}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
