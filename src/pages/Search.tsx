import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useSearchResults } from "../lib/api/search";
import { SearchHero } from "../components/search/SearchHero";
import { SearchResultRow } from "../components/search/SearchResultRow";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_.]+/g, " ")
    .trim();
}

/**
 * HERO SELECTION — 1:1 YT MUSIC LOGIC
 *
 * Priority:
 * 1) Official artist with EXACT name match
 * 2) Any artist with exact name match
 * 3) First ordered artist
 * 4) First ordered item
 */
function selectHero(orderedItems: any[], query: string) {
  if (!orderedItems || orderedItems.length === 0) return null;

  const nq = normalize(query);

  const artists = orderedItems.filter(
    (i) => i.type === "artist"
  );

  // 1. Official artist exact match
  for (const item of artists) {
    if (
      item.data?.isOfficial &&
      normalize(item.data.name) === nq
    ) {
      return item;
    }
  }

  // 2. Any artist exact match
  for (const item of artists) {
    if (normalize(item.data.name) === nq) {
      return item;
    }
  }

  // 3. First artist in ordered list
  if (artists.length > 0) {
    return artists[0];
  }

  // 4. Absolute fallback
  return orderedItems[0];
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";

  const { data, isLoading } = useSearchResults(query);

  const orderedItems = data?.orderedItems ?? [];

  const hero = useMemo(
    () => selectHero(orderedItems, query),
    [orderedItems, query]
  );

  const restItems = useMemo(() => {
    if (!hero) return orderedItems;
    return orderedItems.filter(
      (item) =>
        !(
          item.type === hero.type &&
          item.data?.id === hero.data?.id
        )
    );
  }, [orderedItems, hero]);

  if (!query) {
    return null;
  }

  if (isLoading) {
    return <div className="p-4">Loading…</div>;
  }

  return (
    <div className="search-page">
      {/* HERO */}
      {hero && (
        <SearchHero
          type={hero.type}
          data={hero.data}
          query={query}
        />
      )}

      {/* RESULTS */}
      <div className="search-results">
        {restItems.map((item, idx) => (
          <SearchResultRow
            key={`${item.type}-${item.data?.id ?? idx}`}
            type={item.type}
            data={item.data}
          />
        ))}
      </div>
    </div>
  );
}
