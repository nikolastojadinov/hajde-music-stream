import {
  musicSearch as rawMusicSearch,
  searchSuggestions as rawSearchSuggestions,
  type MusicSearchAlbum,
  type MusicSearchArtist,
  type MusicSearchPlaylist,
  type MusicSearchSuggestion as RawSuggestion,
  type MusicSearchTrack,
} from "../services/youtubeMusicClient";

export type SuggestionType = "track" | "artist" | "album" | "playlist";

export type SuggestionItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl: string | null;
  subtitle: string;
  endpointType: "watch" | "browse";
  endpointPayload: string;
};

export type SuggestResponse = {
  q: string;
  source: "youtube_live";
  suggestions: SuggestionItem[];
};

export type ResultItem = {
  id: string;
  title: string;
  imageUrl: string | null;
  subtitle: string;
  endpointType: "watch" | "browse";
  endpointPayload: string;
};

export type ResultsSections = {
  top: ResultItem[];
  songs: ResultItem[];
  artists: ResultItem[];
  albums: ResultItem[];
  playlists: ResultItem[];
};

export type SearchResultsPayload = {
  q: string;
  source: "youtube_live";
  sections: ResultsSections;
};

const MIN_QUERY = 2;
const MAX_SUGGESTIONS_TOTAL = 12;
const MAX_SUGGESTIONS_PER_TYPE = 4;
const INTERLEAVE_ORDER: SuggestionType[] = ["track", "artist", "playlist", "album"];

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeVideoId(value: string): boolean {
  const v = normalizeString(value);
  return /^[A-Za-z0-9_-]{11}$/.test(v);
}

function looksLikeBrowseId(value: string): boolean {
  const v = normalizeString(value);
  if (!v || v.includes(" ")) return false;
  return /^(OLAK|PL|VL|RD|MP|UU|LL|UC|OL|RV)[A-Za-z0-9_-]+$/i.test(v);
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function defaultSubtitleForType(type: SuggestionType): string {
  if (type === "artist") return "Artist";
  if (type === "album") return "Album";
  if (type === "playlist") return "Playlist";
  return "Song";
}

function toSuggestionItem(raw: RawSuggestion): SuggestionItem | null {
  const id = normalizeString(raw.id);
  const name = normalizeString(raw.name);
  if (!id || !name) return null;

  if (raw.type === "track" && !looksLikeVideoId(id)) return null;
  if (raw.type !== "track" && !looksLikeBrowseId(id)) return null;

  const subtitle = normalizeString(raw.subtitle) || defaultSubtitleForType(raw.type);
  const imageUrl = normalizeString(raw.imageUrl) || null;

  return {
    type: raw.type,
    id,
    name,
    imageUrl,
    subtitle,
    endpointType: raw.type === "track" ? "watch" : "browse",
    endpointPayload: id,
  };
}

function bucketSuggestions(raw: RawSuggestion[]): Record<SuggestionType, SuggestionItem[]> {
  const buckets: Record<SuggestionType, SuggestionItem[]> = {
    track: [],
    artist: [],
    album: [],
    playlist: [],
  };

  for (const entry of safeArray<RawSuggestion>(raw)) {
    const item = toSuggestionItem(entry);
    if (!item) continue;
    if (buckets[item.type].length >= MAX_SUGGESTIONS_PER_TYPE) continue;
    buckets[item.type].push(item);
  }

  return buckets;
}

function interleaveSuggestions(buckets: Record<SuggestionType, SuggestionItem[]>): SuggestionItem[] {
  const pointers: Record<SuggestionType, number> = { track: 0, artist: 0, album: 0, playlist: 0 };
  const seen = new Set<string>();
  const result: SuggestionItem[] = [];

  while (result.length < MAX_SUGGESTIONS_TOTAL) {
    let progressed = false;

    for (const type of INTERLEAVE_ORDER) {
      if (result.length >= MAX_SUGGESTIONS_TOTAL) break;

      const bucket = buckets[type];
      const index = pointers[type];
      if (!bucket || index >= bucket.length) {
        continue;
      }

      const candidate = bucket[index];
      pointers[type] = index + 1;

      const key = `${candidate.type}:${candidate.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(candidate);
      progressed = true;
    }

    const remaining = INTERLEAVE_ORDER.some((type) => {
      const bucket = buckets[type];
      return bucket && pointers[type] < bucket.length;
    });

    if (!progressed || !remaining) break;
  }

  return result.slice(0, MAX_SUGGESTIONS_TOTAL);
}

export async function searchSuggestions(queryRaw: string): Promise<SuggestResponse> {
  const q = normalizeString(queryRaw);
  if (q.length < MIN_QUERY) {
    return { q, source: "youtube_live", suggestions: [] };
  }

  try {
    const raw = await rawSearchSuggestions(q);
    const buckets = bucketSuggestions(raw);
    const suggestions = interleaveSuggestions(buckets);
    return { q, source: "youtube_live", suggestions };
  } catch (err) {
    return { q, source: "youtube_live", suggestions: [] };
  }
}

function toResultItemFromTrack(track: MusicSearchTrack | undefined): ResultItem | null {
  if (!track) return null;
  if (!looksLikeVideoId(track.youtubeId)) return null;
  const title = normalizeString(track.title);
  if (!title) return null;
  const subtitle = normalizeString(track.artist) || "Song";
  const imageUrl = normalizeString(track.imageUrl) || null;
  return {
    id: track.youtubeId,
    title,
    imageUrl,
    subtitle,
    endpointType: "watch",
    endpointPayload: track.youtubeId,
  };
}

function toResultItemFromArtist(artist: MusicSearchArtist | undefined): ResultItem | null {
  if (!artist) return null;
  const id = normalizeString(artist.id);
  const title = normalizeString(artist.name);
  if (!id || !title) return null;
  const imageUrl = normalizeString(artist.imageUrl) || null;
  return {
    id,
    title,
    imageUrl,
    subtitle: "Artist",
    endpointType: "browse",
    endpointPayload: id,
  };
}

function toResultItemFromAlbum(album: MusicSearchAlbum | undefined): ResultItem | null {
  if (!album) return null;
  const id = normalizeString(album.id);
  const title = normalizeString(album.title);
  if (!id || !title) return null;
  const imageUrl = normalizeString(album.imageUrl) || null;
  const subtitle = normalizeString(album.channelTitle) || "Album";
  return {
    id,
    title,
    imageUrl,
    subtitle,
    endpointType: "browse",
    endpointPayload: id,
  };
}

function toResultItemFromPlaylist(playlist: MusicSearchPlaylist | undefined): ResultItem | null {
  if (!playlist) return null;
  const id = normalizeString(playlist.id);
  const title = normalizeString(playlist.title);
  if (!id || !title) return null;
  const imageUrl = normalizeString(playlist.imageUrl) || null;
  const subtitle = normalizeString(playlist.channelTitle) || "Playlist";
  return {
    id,
    title,
    imageUrl,
    subtitle,
    endpointType: "browse",
    endpointPayload: id,
  };
}

function mapTracks(tracks: MusicSearchTrack[]): ResultItem[] {
  const source = safeArray<MusicSearchTrack>(tracks);
  const items: ResultItem[] = [];
  for (const track of source) {
    const mapped = toResultItemFromTrack(track);
    if (mapped) items.push(mapped);
  }
  return items;
}

function mapArtists(artists: MusicSearchArtist[]): ResultItem[] {
  const source = safeArray<MusicSearchArtist>(artists);
  const items: ResultItem[] = [];
  for (const artist of source) {
    const mapped = toResultItemFromArtist(artist);
    if (mapped) items.push(mapped);
  }
  return items;
}

function mapAlbums(albums: MusicSearchAlbum[]): ResultItem[] {
  const source = safeArray<MusicSearchAlbum>(albums);
  const items: ResultItem[] = [];
  for (const album of source) {
    const mapped = toResultItemFromAlbum(album);
    if (mapped) items.push(mapped);
  }
  return items;
}

function mapPlaylists(playlists: MusicSearchPlaylist[]): ResultItem[] {
  const source = safeArray<MusicSearchPlaylist>(playlists);
  const items: ResultItem[] = [];
  for (const playlist of source) {
    const mapped = toResultItemFromPlaylist(playlist);
    if (mapped) items.push(mapped);
  }
  return items;
}

function pickTopResult(sections: ResultsSections): ResultItem[] {
  const firstTrack = sections.songs.length > 0 ? sections.songs[0] : null;
  if (firstTrack) return [firstTrack];
  const firstArtist = sections.artists.length > 0 ? sections.artists[0] : null;
  if (firstArtist) return [firstArtist];
  const firstAlbum = sections.albums.length > 0 ? sections.albums[0] : null;
  if (firstAlbum) return [firstAlbum];
  const firstPlaylist = sections.playlists.length > 0 ? sections.playlists[0] : null;
  if (firstPlaylist) return [firstPlaylist];
  return [];
}

function emptySections(): ResultsSections {
  return { top: [], songs: [], artists: [], albums: [], playlists: [] };
}

export async function musicSearch(queryRaw: string): Promise<SearchResultsPayload> {
  const q = normalizeString(queryRaw);
  if (q.length < MIN_QUERY) {
    return { q, source: "youtube_live", sections: emptySections() };
  }

  try {
    const raw = await rawMusicSearch(q);
    const sections: ResultsSections = {
      top: [],
      songs: mapTracks(raw.tracks),
      artists: mapArtists(raw.artists),
      albums: mapAlbums(raw.albums),
      playlists: mapPlaylists(raw.playlists),
    };
    sections.top = pickTopResult(sections);
    return { q, source: "youtube_live", sections };
  } catch (err) {
    return { q, source: "youtube_live", sections: emptySections() };
  }
}
