import Fuse, { FuseResult } from "fuse.js";
import { SearchDatasetItem } from "@/lib/searchDataset";

export interface FuseEngine {
  search: (query: string) => FuseResult<SearchDatasetItem>[];
}

const FUSE_OPTIONS: Fuse.IFuseOptions<SearchDatasetItem> = {
  keys: ["title", "artist"],
  includeScore: true,
  threshold: 0.38,
  ignoreLocation: true,
  useExtendedSearch: true,
  shouldSort: true,
};

const adjustScores = (
  results: FuseResult<SearchDatasetItem>[],
  query: string
): FuseResult<SearchDatasetItem>[] => {
  if (!query.trim()) return results;

  const normalized = query.trim().toLowerCase();

  return results
    .map((result) => {
      const artistName = result.item.type === "artist" ? result.item.artist : result.item.artist;
      if (!artistName) {
        return result;
      }

      let adjustedScore = result.score ?? 0;
      const normalizedArtist = artistName.toLowerCase();

      if (normalizedArtist === normalized) {
        adjustedScore = 0;
      } else if (normalizedArtist.includes(normalized)) {
        adjustedScore *= 0.6; // reduce by 40%
      }

      return { ...result, score: adjustedScore };
    })
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
};

export const buildFuseEngine = (dataset: SearchDatasetItem[]): FuseEngine => {
  const fuse = new Fuse(dataset, FUSE_OPTIONS);

  return {
    search(query: string) {
      if (!query.trim()) {
        return [];
      }
      const rawResults = fuse.search(query);
      return adjustScores(rawResults, query);
    },
  };
};
