import { Router } from "express";
import {
  musicSearch,
  searchSuggestions,
  type MusicSearchAlbum,
  type MusicSearchArtist,
  type MusicSearchPlaylist,
  type MusicSearchTrack,
  type MusicSearchSuggestion,
} from "../services/youtubeMusicClient";

const router = Router();

const MIN_QUERY_CHARS = 2;
const MAX_SUGGESTIONS = 20;

type SuggestionType = "artist" | "track" | "album" | "playlist";

export type SearchSuggestItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl?: string;
  subtitle: string;
};

export type SearchSuggestResponse = {
  q: string;
  source: "youtube_live";
  suggestions: SearchSuggestItem[];
};

export type SearchResultItem = {
  id: string;
  title: string;
  imageUrl?: string;
  subtitle?: string;
  endpointType: "watch" | "browse";
  endpointPayload: string;
};

export type SearchSection = {
  kind: "songs" | "artists" | "albums" | "playlists";
  items: SearchResultItem[];
};

export type SearchResultsResponse = {
  q: string;
  source: "youtube_live";
  sections: SearchSection[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isVideoId(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.trim());
}

function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeBrowseId(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(v);
}

function defaultSubtitle(type: SuggestionType): string {
  if (type === "artist") return "Artist";
  if (type === "album") return "Album";
  if (type === "playlist") return "Playlist";
  return "Song";
}

function toSuggestItem(raw: MusicSearchSuggestion): SearchSuggestItem | null {
  const id = normalizeString(raw.id);
  const name = normalizeString(raw.name);
  if (!id || !name) return null;

  const subtitle = isNonEmpty(raw.subtitle) ? raw.subtitle!.trim() : defaultSubtitle(raw.type);
  const imageUrl = isNonEmpty(raw.imageUrl || "") ? raw.imageUrl!.trim() : undefined;

  return { type: raw.type, id, name, imageUrl, subtitle };
}

function interleaveSuggestions(raw: MusicSearchSuggestion[]): SearchSuggestItem[] {
  const buckets: Record<SuggestionType, SearchSuggestItem[]> = {
    track: [],
    artist: [],
    playlist: [],
    album: [],
  };

  raw.forEach((suggestion) => {
    const item = toSuggestItem(suggestion);
    if (item) buckets[item.type].push(item);
  });

  const order: SuggestionType[] = ["track", "artist", "playlist", "album"];
  const pointers: Record<SuggestionType, number> = { track: 0, artist: 0, playlist: 0, album: 0 };
  const seen = new Set<string>();
  const out: SearchSuggestItem[] = [];

  while (out.length < MAX_SUGGESTIONS) {
    let progressed = false;

    for (const type of order) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const bucket = buckets[type];
      let ptr = pointers[type];

      while (ptr < bucket.length && out.length < MAX_SUGGESTIONS) {
        const candidate = bucket[ptr];
        ptr += 1;
        const key = `${candidate.type}:${candidate.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(candidate);
          progressed = true;
          break;
        }
      }

      pointers[type] = ptr;
    }

    const remaining = order.some((type) => pointers[type] < buckets[type].length);
    if (!progressed || !remaining) break;
  }

  return out.slice(0, MAX_SUGGESTIONS);
}

function mapTracks(tracks: MusicSearchTrack[]): SearchResultItem[] {
  return tracks
    .filter((t) => isVideoId(t.youtubeId) && isNonEmpty(t.title))
    .map((t) => ({
      id: t.youtubeId,
      title: t.title.trim(),
      imageUrl: isNonEmpty(t.imageUrl) ? t.imageUrl!.trim() : undefined,
      subtitle: isNonEmpty(t.artist) ? t.artist : undefined,
      endpointType: "watch" as const,
      endpointPayload: t.youtubeId,
    }));
}

function mapArtists(artists: MusicSearchArtist[]): SearchResultItem[] {
  return artists
    .filter((a) => isNonEmpty(a.id) && isNonEmpty(a.name))
    .map((a) => ({
      id: a.id.trim(),
      title: a.name.trim(),
      imageUrl: isNonEmpty(a.imageUrl) ? a.imageUrl!.trim() : undefined,
      subtitle: undefined,
      endpointType: "browse" as const,
      endpointPayload: a.id.trim(),
    }));
}

function mapAlbums(albums: MusicSearchAlbum[]): SearchResultItem[] {
  return albums
    .filter((a) => isNonEmpty(a.id) && isNonEmpty(a.title))
    .map((a) => ({
      id: a.id.trim(),
      title: a.title.trim(),
      imageUrl: isNonEmpty(a.imageUrl) ? a.imageUrl!.trim() : undefined,
      subtitle: isNonEmpty(a.channelTitle) ? a.channelTitle! : undefined,
      endpointType: "browse" as const,
      endpointPayload: a.id.trim(),
    }));
}

function mapPlaylists(playlists: MusicSearchPlaylist[]): SearchResultItem[] {
  return playlists
    .filter((p) => isNonEmpty(p.id) && isNonEmpty(p.title))
    .map((p) => ({
      id: p.id.trim(),
      title: p.title.trim(),
      imageUrl: isNonEmpty(p.imageUrl) ? p.imageUrl!.trim() : undefined,
      subtitle: isNonEmpty(p.channelTitle) ? p.channelTitle! : undefined,
      endpointType: "browse" as const,
      endpointPayload: p.id.trim(),
    }));
}

function buildSections(live: {
  tracks: MusicSearchTrack[];
  artists: MusicSearchArtist[];
  albums: MusicSearchAlbum[];
  playlists: MusicSearchPlaylist[];
}): SearchSection[] {
  const sections: SearchSection[] = [
    { kind: "songs", items: mapTracks(live.tracks || []) },
    { kind: "artists", items: mapArtists(live.artists || []) },
    { kind: "albums", items: mapAlbums(live.albums || []) },
    { kind: "playlists", items: mapPlaylists(live.playlists || []) },
  ];
  return sections;
}

function buildEmptySections(): SearchSection[] {
  return [
    { kind: "songs", items: [] },
    { kind: "artists", items: [] },
    { kind: "albums", items: [] },
    { kind: "playlists", items: [] },
  ];
}

function safeSuggestResponse(q: string, suggestions: SearchSuggestItem[] = []): SearchSuggestResponse {
  return { q, source: "youtube_live", suggestions } satisfies SearchSuggestResponse;
}

function safeResultsResponse(q: string, sections?: SearchSection[]): SearchResultsResponse {
  return {
    q,
    source: "youtube_live",
    sections: sections ?? buildEmptySections(),
  } satisfies SearchResultsResponse;
}

router.get("/suggest", async (req, res) => {
  const q = normalizeString(req.query.q);

  if (q.length < MIN_QUERY_CHARS || looksLikeBrowseId(q)) {
    res.set("Cache-Control", "no-store");
    return res.json(safeSuggestResponse(q, []));
  }

  try {
    const raw = await searchSuggestions(q);
    const suggestions = interleaveSuggestions(raw);
    res.set("Cache-Control", "no-store");
    return res.json(safeSuggestResponse(q, suggestions));
  } catch (err) {
    console.error("[search/suggest] failed", { q, error: err instanceof Error ? err.message : String(err) });
    res.set("Cache-Control", "no-store");
    return res.json(safeSuggestResponse(q, []));
  }
});

router.get("/results", async (req, res) => {
  const q = normalizeString(req.query.q);

  if (q.length < MIN_QUERY_CHARS || looksLikeBrowseId(q)) {
    res.set("Cache-Control", "no-store");
    return res.json(safeResultsResponse(q));
  }

  try {
    const live = await musicSearch(q);
    const sections = buildSections(live);
    res.set("Cache-Control", "no-store");
    return res.json(safeResultsResponse(q, sections));
  } catch (err) {
    console.error("[search/results] failed", { q, error: err instanceof Error ? err.message : String(err) });
    res.set("Cache-Control", "no-store");
    return res.json(safeResultsResponse(q));
  }
});

export default router;
