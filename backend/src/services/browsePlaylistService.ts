import { getSupabaseAdmin } from "./supabaseClient";

type PlaylistTrack = {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
};

type PlaylistRow = {
  id: string;
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
  playlistId: string;
  externalId: string;
  title: string | null;
  thumbnail: string | null;
  tracks: PlaylistTrack[];
  trackCount: number;
};

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const formatDuration = (seconds: number | null | undefined): string => {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.trunc(seconds as number));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const buildCandidateExternalIds = (raw: string): string[] => {
  const value = normalize(raw);
  if (!value) return [];

  const candidates = new Set<string>();
  candidates.add(value);

  if (value.startsWith("VL")) {
    const stripped = value.slice(2);
    if (stripped) candidates.add(stripped);
    if (stripped.startsWith("PL")) candidates.add(stripped);
  }

  return Array.from(candidates).filter(Boolean);
};

const mapTracks = (rows: PlaylistRow): PlaylistTrack[] => {
  if (!Array.isArray(rows.playlist_tracks)) return [];

  return rows.playlist_tracks
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
};

async function fetchPlaylistSnapshot(externalIds: string[]): Promise<DbSnapshot | null> {
  if (!externalIds.length) return null;

  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from("playlists")
      .select(
        [
          "id",
          "external_id",
          "title",
          "cover_url",
          "image_url",
          "item_count",
          "playlist_tracks(position, track:tracks(youtube_id,title,artist,duration,cover_url,image_url))",
        ].join(","),
      )
      .in("external_id", externalIds)
      .order("position", { foreignTable: "playlist_tracks", ascending: true });

    if (error) {
      console.warn("[browse/playlist] supabase_playlist_error", { externalIds, message: error.message });
      return null;
    }

    const rows = (data as PlaylistRow[] | null) ?? [];
    const pick = externalIds.map((id) => rows.find((row) => normalize(row.external_id) === id)).find(Boolean) || rows[0];
    if (!pick) return null;

    const tracks = mapTracks(pick);
    const trackCount = tracks.length || pick.item_count || 0;

    console.log("[browse/playlist] db_snapshot", {
      requested: externalIds[0],
      playlistId: pick.id,
      externalId: pick.external_id,
      dbTrackCount: tracks.length,
      item_count: pick.item_count,
    });

    return {
      playlistId: pick.id,
      externalId: normalize(pick.external_id) || externalIds[0],
      title: normalize(pick.title) || null,
      thumbnail: normalize(pick.cover_url) || normalize(pick.image_url) || null,
      tracks,
      trackCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/playlist] supabase_playlist_exception", { externalIds, message });
    return null;
  }
}

function buildResponse(snapshot: DbSnapshot): PlaylistBrowseResult {
  return {
    id: snapshot.externalId,
    title: snapshot.title || snapshot.externalId,
    subtitle: `Playlist • ${snapshot.trackCount} songs`,
    thumbnail: snapshot.thumbnail,
    tracks: snapshot.tracks,
  };
}

export async function browsePlaylist(browseIdRaw: string): Promise<PlaylistBrowseResult | null> {
  const browseId = normalize(browseIdRaw);
  console.log("[browse/playlist] request", { browseId });
  if (!browseId) return null;

  const candidates = buildCandidateExternalIds(browseId);
  const snapshot = await fetchPlaylistSnapshot(candidates);

  if (!snapshot) {
    console.warn("[browse/playlist] not_found", { browseId, candidates });
    return null;
  }

  console.log("[browse/playlist] resolved", {
    browseId,
    playlistId: snapshot.playlistId,
    externalId: snapshot.externalId,
    dbTrackCount: snapshot.tracks.length,
  });

  return buildResponse(snapshot);
}
