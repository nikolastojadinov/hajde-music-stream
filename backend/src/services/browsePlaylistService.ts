import { parsePlaylistFromInnertube, type ParsedPlaylist, type ParsedTrack } from "../lib/innertube/playlistParser";
import { ingestPlaylistOrAlbum } from "./ingestPlaylistOrAlbum";
import { recordInnertubePayload } from "./innertubeRawStore";
import { CONSENT_COOKIES, fetchInnertubeConfig } from "./youtubeInnertubeConfig";
import { getSupabaseAdmin } from "./supabaseClient";

type PlaylistTrack = {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
};

type PlaylistRow = {
  external_id: string | null;
  title: string | null;
  cover_url: string | null;
  image_url: string | null;
  item_count: number | null;
  playlist_tracks:
    | Array<{
        position: number | null;
        track: {
          youtube_id: string | null;
          title: string | null;
          artist: string | null;
          duration: number | null;
          cover_url: string | null;
          image_url: string | null;
        } | null;
      }>
    | null;
};

type ActivityRow = { context: string | null };

type SuggestRow = { query?: string | null; results?: { title?: string; subtitle?: string } | null };

type TitleResolution = { title: string; source: "innertube" | "suggest" | "activity" | "supabase" | "browseId" };

type PlaylistSource = {
  tracks: PlaylistTrack[];
  trackCount: number;
  titleCandidate: string | null;
  thumbnail: string | null;
};

export type PlaylistBrowseResult = {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
  tracks: PlaylistTrack[];
};

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const formatDuration = (seconds: number | null | undefined): string => {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.trunc(seconds as number));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const isMeaningfulTitle = (value: string | null | undefined, browseId: string): boolean => {
  if (!value) return false;
  const title = normalize(value);
  if (!title) return false;
  return title.toLowerCase() !== normalize(browseId).toLowerCase();
};

async function fetchInnertubePlaylist(browseId: string): Promise<ParsedPlaylist | null> {
  try {
    const config = await fetchInnertubeConfig();
    const payload = {
      context: {
        client: {
          clientName: config.clientName || "WEB_REMIX",
          clientVersion: config.clientVersion || "1.20241210.01.00",
          hl: "en",
          gl: "US",
          visitorData: config.visitorData || undefined,
        },
        user: { enableSafetyMode: false },
      },
      browseId,
    };

    const url = `${config.apiBase}/browse?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusic/1.0",
        Origin: "https://music.youtube.com",
        Referer: `https://music.youtube.com/playlist?list=${encodeURIComponent(browseId)}`,
        Cookie: CONSENT_COOKIES,
        "X-Goog-Visitor-Id": config.visitorData || "",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json) return null;

    recordInnertubePayload("playlist", browseId, json);
    return parsePlaylistFromInnertube(json, browseId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/playlist] innertube_failed", { browseId, message });
    return null;
  }
}

async function fetchPlaylistFromDatabase(browseId: string): Promise<PlaylistRow | null> {
  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from("playlists")
      .select(
        [
          "external_id",
          "title",
          "cover_url",
          "image_url",
          "item_count",
          "playlist_tracks(position, track:tracks(youtube_id,title,artist,duration,cover_url,image_url))",
        ].join(","),
      )
      .eq("external_id", browseId)
      .order("position", { foreignTable: "playlist_tracks", ascending: true })
      .maybeSingle();

    if (error) {
      console.warn("[browse/playlist] supabase_playlist_error", { browseId, message: error.message });
      return null;
    }

    return (data as PlaylistRow | null) ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/playlist] supabase_playlist_exception", { browseId, message });
    return null;
  }
}

async function fetchSuggestTitle(browseId: string): Promise<string | null> {
  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from("suggest_entries")
      .select("query,results")
      .eq("external_id", browseId)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    const row = (data as SuggestRow | null) ?? null;
    const fromResults = normalize(row?.results?.title);
    if (fromResults) return fromResults;
    const fromQuery = normalize(row?.query);
    return fromQuery || null;
  } catch {
    return null;
  }
}

async function fetchActivitySnapshotTitle(browseId: string): Promise<string | null> {
  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from("user_activity_history")
      .select("context")
      .eq("entity_id", browseId)
      .in("entity_type", ["playlist", "album"])
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !Array.isArray(data)) return null;

    for (const row of data as ActivityRow[]) {
      const raw = row?.context || "";
      if (!raw) continue;
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const snapshotTitle = normalize((parsed as any)?.snapshot?.title || (parsed as any)?.title);
        if (snapshotTitle) return snapshotTitle;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeParsedTrack(track: ParsedTrack): PlaylistTrack | null {
  const videoId = normalize(track.videoId);
  if (!videoId) return null;
  return {
    videoId,
    title: normalize(track.title) || "Untitled",
    artist: normalize(track.artist),
    duration: normalize(track.duration),
    thumbnail: normalize(track.thumbnail) || null,
  };
}

function normalizeDbTracks(row: PlaylistRow | null): PlaylistTrack[] {
  const tracks = Array.isArray(row?.playlist_tracks) ? row?.playlist_tracks : [];
  return tracks
    .map((item) => {
      const videoId = normalize(item?.track?.youtube_id);
      if (!videoId) return null;
      return {
        videoId,
        title: normalize(item?.track?.title) || "Untitled",
        artist: normalize(item?.track?.artist),
        duration: formatDuration(item?.track?.duration),
        thumbnail: normalize(item?.track?.cover_url) || normalize(item?.track?.image_url) || null,
      } as PlaylistTrack;
    })
    .filter(Boolean) as PlaylistTrack[];
}

function resolveTitle(browseId: string, innertubeTitle: string | null, suggestTitle: string | null, activityTitle: string | null, dbTitle: string | null): TitleResolution {
  const candidates: Array<{ value: string | null; source: TitleResolution["source"] }> = [
    { value: innertubeTitle, source: "innertube" },
    { value: suggestTitle, source: "suggest" },
    { value: activityTitle, source: "activity" },
    { value: dbTitle, source: "supabase" },
  ];

  for (const candidate of candidates) {
    if (isMeaningfulTitle(candidate.value, browseId)) {
      return { title: normalize(candidate.value), source: candidate.source };
    }
  }

  return { title: browseId, source: "browseId" };
}

function pickPlaylistSource(innertube: ParsedPlaylist | null, playlistRow: PlaylistRow | null): PlaylistSource {
  const ytTracks = Array.isArray(innertube?.tracks)
    ? (innertube?.tracks.map(normalizeParsedTrack).filter(Boolean) as PlaylistTrack[])
    : [];
  if (ytTracks.length > 0) {
    return {
      tracks: ytTracks,
      trackCount: ytTracks.length,
      titleCandidate: normalize(innertube?.title),
      thumbnail: normalize(innertube?.thumbnail) || null,
    };
  }

  const dbTracks = normalizeDbTracks(playlistRow);
  if (dbTracks.length > 0) {
    return {
      tracks: dbTracks,
      trackCount: dbTracks.length,
      titleCandidate: normalize(playlistRow?.title),
      thumbnail: normalize(playlistRow?.cover_url) || normalize(playlistRow?.image_url) || null,
    };
  }

  return {
    tracks: [],
    trackCount: playlistRow?.item_count ?? 0,
    titleCandidate: normalize(innertube?.title) || normalize(playlistRow?.title) || null,
    thumbnail: normalize(innertube?.thumbnail) || normalize(playlistRow?.cover_url) || normalize(playlistRow?.image_url) || null,
  };
}

export async function browsePlaylist(browseIdRaw: string): Promise<PlaylistBrowseResult | null> {
  const incomingId = normalize(browseIdRaw);
  if (!incomingId) return null;
  const upper = incomingId.toUpperCase();
  const browseId = upper.startsWith("VL") || upper.startsWith("PL") || upper.startsWith("OLAK") ? incomingId : `VL${incomingId}`;

  const [innertube, playlistRow, suggestTitle, activityTitle] = await Promise.all([
    fetchInnertubePlaylist(browseId),
    fetchPlaylistFromDatabase(browseId),
    fetchSuggestTitle(browseId),
    fetchActivitySnapshotTitle(browseId),
  ]);

  const source = pickPlaylistSource(innertube, playlistRow);
  const titleResolution = resolveTitle(browseId, source.titleCandidate, suggestTitle, activityTitle, playlistRow?.title ?? null);
  console.log("[browse/playlist] resolved_title", { browseId, title: titleResolution.title, source: titleResolution.source });

  if (innertube && source.tracks.length > 0) {
    try {
      await ingestPlaylistOrAlbum(
        {
          browseId,
          kind: "playlist",
          title: titleResolution.title,
          subtitle: `Playlist • ${source.trackCount} songs`,
          thumbnailUrl: source.thumbnail,
          tracks: source.tracks,
          trackCount: source.trackCount,
        },
        { mode: "single-playlist" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[browse/playlist] ingest_failed", { browseId, message });
    }
  }

  const subtitle = `Playlist • ${source.trackCount} songs`;
  const thumbnail = source.thumbnail || normalize(innertube?.thumbnail) || normalize(playlistRow?.cover_url) || normalize(playlistRow?.image_url) || null;

  return {
    id: browseId,
    title: titleResolution.title,
    subtitle,
    thumbnail,
    tracks: source.tracks,
  };
}
