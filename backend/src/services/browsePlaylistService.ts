import { parsePlaylistFromInnertube, type ParsedPlaylist, type ParsedTrack } from "../lib/innertube/playlistParser";
import { ingestPlaylistOrAlbum } from "./ingestPlaylistOrAlbum";
import { recordInnertubePayload } from "./innertubeRawStore";
import { getSupabaseAdmin } from "./supabaseClient";
import { CONSENT_COOKIES, fetchInnertubeConfig } from "./youtubeInnertubeConfig";
import { youtubeInnertubeBrowsePlaylist } from "./youtubeInnertubeBrowsePlaylist";

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

export type PlaylistBrowseResult = {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
  tracks: PlaylistTrack[];
};

type DbSnapshot = {
  title: string | null;
  thumbnail: string | null;
  tracks: PlaylistTrack[];
  trackCount: number;
};

type InnertubeResult = {
  playlist: ParsedPlaylist | null;
  rendererKinds: string[];
};

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const formatDuration = (seconds: number | null | undefined): string => {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.trunc(seconds as number));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const ensureBrowseId = (raw: string): string | null => {
  const incoming = normalize(raw);
  if (!incoming) return null;
  const upper = incoming.toUpperCase();
  if (upper.startsWith("VL") || upper.startsWith("PL") || upper.startsWith("OLAK")) return incoming;
  return `VL${incoming}`;
};

const collectRendererKinds = (data: any): string[] => {
  const kinds = new Set<string>();
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    if ((node as any).musicResponsiveListItemRenderer) kinds.add("musicResponsiveListItemRenderer");
    if ((node as any).playlistPanelVideoRenderer) kinds.add("playlistPanelVideoRenderer");
    if ((node as any).playlistVideoRenderer) kinds.add("playlistVideoRenderer");
    Object.values(node).forEach(walk);
  };
  walk(data);
  return Array.from(kinds);
};

async function fetchInnertubePlaylist(browseId: string): Promise<InnertubeResult> {
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

    if (!res.ok) return { playlist: null, rendererKinds: [] };
    const json = await res.json().catch(() => null);
    if (!json) return { playlist: null, rendererKinds: [] };

    recordInnertubePayload("playlist", browseId, json);
    const rendererKinds = collectRendererKinds(json);
    const playlist = parsePlaylistFromInnertube(json, browseId);
    return { playlist, rendererKinds };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/playlist] innertube_failed", { browseId, message });
    return { playlist: null, rendererKinds: [] };
  }
}

async function fetchPlaylistSnapshot(browseId: string): Promise<DbSnapshot | null> {
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

    const row = (data as PlaylistRow | null) ?? null;
    if (!row) return null;

    const tracks = Array.isArray(row.playlist_tracks)
      ? (row.playlist_tracks
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
          .filter(Boolean) as PlaylistTrack[])
      : [];

    const trackCount = tracks.length || row.item_count || 0;
    console.log("[browse/playlist] db_snapshot", { browseId, dbTrackCount: tracks.length, item_count: row.item_count });

    return {
      title: normalize(row.title) || null,
      thumbnail: normalize(row.cover_url) || normalize(row.image_url) || null,
      tracks,
      trackCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/playlist] supabase_playlist_exception", { browseId, message });
    return null;
  }
}

const normalizeParsedTrack = (track: ParsedTrack): PlaylistTrack | null => {
  const videoId = normalize(track.videoId);
  if (!videoId) return null;
  return {
    videoId,
    title: normalize(track.title) || "Untitled",
    artist: normalize(track.artist),
    duration: normalize(track.duration),
    thumbnail: normalize(track.thumbnail) || null,
  };
};

async function ingestPlaylist(browseId: string, title: string, thumbnail: string | null, tracks: PlaylistTrack[]): Promise<number> {
  try {
    const result = await ingestPlaylistOrAlbum(
      {
        browseId,
        kind: "playlist",
        title,
        subtitle: `Playlist • ${tracks.length} songs`,
        thumbnailUrl: thumbnail,
        tracks,
        trackCount: tracks.length,
      },
      { mode: "single-playlist" },
    );

    console.log("[browse/playlist] ingest_complete", {
      browseId,
      ingestedCount: result.trackCount,
      playlistTrackLinks: result.playlistTrackCount,
      artistTrackLinks: result.artistTrackCount,
    });

    return result.trackCount;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/playlist] ingest_failed", { browseId, message });
    return 0;
  }
}

function buildResponse(browseId: string, title: string | null, thumbnail: string | null, tracks: PlaylistTrack[], trackCount: number): PlaylistBrowseResult {
  return {
    id: browseId,
    title: normalize(title) || browseId,
    subtitle: `Playlist • ${trackCount} songs`,
    thumbnail: thumbnail || null,
    tracks,
  };
}

export async function browsePlaylist(browseIdRaw: string): Promise<PlaylistBrowseResult | null> {
  const browseId = ensureBrowseId(browseIdRaw);
  if (!browseId) return null;

  const snapshot = await fetchPlaylistSnapshot(browseId);
  if (snapshot?.tracks.length) {
    console.log("[browse/playlist] return_db", { browseId, dbTrackCount: snapshot.tracks.length });
    return buildResponse(browseId, snapshot.title, snapshot.thumbnail, snapshot.tracks, snapshot.trackCount);
  }

  const { playlist: innertube, rendererKinds } = await fetchInnertubePlaylist(browseId);
  const parsedTracks = Array.isArray(innertube?.tracks)
    ? (innertube?.tracks.map(normalizeParsedTrack).filter(Boolean) as PlaylistTrack[])
    : [];

  console.log("[browse/playlist] innertube_parsed", {
    browseId,
    parsedTrackCount: parsedTracks.length,
    rendererKinds,
    trackCountField: innertube?.trackCount ?? null,
  });

  let tracks: PlaylistTrack[] = parsedTracks;
  let thumbnail = normalize(innertube?.thumbnail) || null;
  let title = normalize(innertube?.title) || browseId;

  if (!tracks.length) {
    console.warn("[browse/playlist] parsed_empty_trigger_fallback", { browseId, rendererKinds });
    const fallback = await youtubeInnertubeBrowsePlaylist(browseId, { max: 500 });
    if (fallback?.videoIds?.length) {
      const fallbackThumb = normalize(fallback.thumbnailUrl) || thumbnail;
      tracks = fallback.videoIds
        .map((videoId) => ({
          videoId,
          title: "",
          artist: "",
          duration: "",
          thumbnail: fallbackThumb,
        }))
        .filter((t) => normalize(t.videoId));
      title = normalize(fallback.title) || title;
      thumbnail = fallbackThumb || thumbnail;
      console.log("[browse/playlist] fallback_tracks", { browseId, fallbackCount: tracks.length });
    }
  }

  if (!tracks.length) {
    console.error("[browse/playlist] EMPTY_AFTER_FALLBACK", { browseId, rendererKinds });
    return buildResponse(browseId, title, thumbnail, [], 0);
  }

  const ingestedCount = await ingestPlaylist(browseId, title, thumbnail, tracks);

  const hydrated = await fetchPlaylistSnapshot(browseId);
  if (hydrated?.tracks.length) {
    console.log("[browse/playlist] hydrated_from_db", {
      browseId,
      dbTrackCount: hydrated.tracks.length,
      ingestedCount,
    });
    return buildResponse(browseId, hydrated.title || title, hydrated.thumbnail || thumbnail, hydrated.tracks, hydrated.trackCount);
  }

  console.warn("[browse/playlist] returning_ingested_memory", {
    browseId,
    ingestedCount,
    trackCount: tracks.length,
  });
  return buildResponse(browseId, title, thumbnail, tracks, tracks.length);
}
