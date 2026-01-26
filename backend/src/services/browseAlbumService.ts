import { parseAlbumFromInnertube, type ParsedAlbum } from "../lib/innertube/albumParser";
import type { ParsedTrack } from "../lib/innertube/playlistParser";
import { ingestPlaylistOrAlbum } from "./ingestPlaylistOrAlbum";
import { recordInnertubePayload } from "./innertubeRawStore";
import { CONSENT_COOKIES, fetchInnertubeConfig } from "./youtubeInnertubeConfig";
import { getSupabaseAdmin } from "./supabaseClient";

type AlbumTrack = {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
};

type AlbumRow = {
  external_id: string | null;
  title: string | null;
  thumbnail_url: string | null;
  release_date: string | null;
  album_tracks:
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

type TitleResolution = { title: string; source: "innertube" | "activity" | "supabase" | "browseId" };

type AlbumSource = {
  tracks: AlbumTrack[];
  trackCount: number;
  titleCandidate: string | null;
  artistCandidate: string | null;
  yearCandidate: string | null;
  thumbnail: string | null;
};

export type AlbumBrowseResult = {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
  tracks: AlbumTrack[];
};

const normalize = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const formatDuration = (seconds: number | null | undefined): string => {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.trunc(seconds as number));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const extractYear = (value: string | null | undefined): string | null => {
  const text = normalize(value);
  if (!text) return null;
  const match = text.match(/\b(20\d{2}|19\d{2})\b/);
  return match && match[1] ? match[1] : null;
};

const isMeaningfulTitle = (value: string | null | undefined, browseId: string): boolean => {
  if (!value) return false;
  const title = normalize(value);
  if (!title) return false;
  return title.toLowerCase() !== normalize(browseId).toLowerCase();
};

async function fetchInnertubeAlbum(browseId: string): Promise<ParsedAlbum | null> {
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

    recordInnertubePayload("album", browseId, json);
    return parseAlbumFromInnertube(json, browseId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/album] innertube_failed", { browseId, message });
    return null;
  }
}

async function fetchAlbumFromDatabase(browseId: string): Promise<AlbumRow | null> {
  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from("albums")
      .select(
        [
          "external_id",
          "title",
          "thumbnail_url",
          "release_date",
          "album_tracks(position, track:tracks(youtube_id,title,artist,duration,cover_url,image_url))",
        ].join(","),
      )
      .eq("external_id", browseId)
      .order("position", { foreignTable: "album_tracks", ascending: true })
      .maybeSingle();

    if (error) {
      console.warn("[browse/album] supabase_album_error", { browseId, message: error.message });
      return null;
    }

    return (data as AlbumRow | null) ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[browse/album] supabase_album_exception", { browseId, message });
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
      .eq("entity_type", "album")
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

function normalizeParsedTrack(track: ParsedTrack): AlbumTrack | null {
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

function normalizeDbTracks(row: AlbumRow | null): AlbumTrack[] {
  const tracks = Array.isArray(row?.album_tracks) ? row?.album_tracks : [];
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
      } as AlbumTrack;
    })
    .filter(Boolean) as AlbumTrack[];
}

function resolveTitle(browseId: string, innertubeTitle: string | null, activityTitle: string | null, dbTitle: string | null): TitleResolution {
  const candidates: Array<{ value: string | null; source: TitleResolution["source"] }> = [
    { value: innertubeTitle, source: "innertube" },
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

function pickAlbumSource(innertube: ParsedAlbum | null, albumRow: AlbumRow | null): AlbumSource {
  const ytTracks = Array.isArray(innertube?.tracks)
    ? (innertube?.tracks.map(normalizeParsedTrack).filter(Boolean) as AlbumTrack[])
    : [];
  if (ytTracks.length > 0) {
    return {
      tracks: ytTracks,
      trackCount: ytTracks.length,
      titleCandidate: normalize(innertube?.title),
      artistCandidate: normalize(innertube?.artist),
      yearCandidate: normalize(innertube?.year),
      thumbnail: normalize(innertube?.thumbnail) || null,
    };
  }

  const dbTracks = normalizeDbTracks(albumRow);
  if (dbTracks.length > 0) {
    return {
      tracks: dbTracks,
      trackCount: dbTracks.length,
      titleCandidate: normalize(albumRow?.title),
      artistCandidate: normalize(dbTracks[0]?.artist),
      yearCandidate: extractYear(albumRow?.release_date),
      thumbnail: normalize(albumRow?.thumbnail_url) || null,
    };
  }

  return {
    tracks: [],
    trackCount: 0,
    titleCandidate: normalize(innertube?.title) || normalize(albumRow?.title) || null,
    artistCandidate: normalize(innertube?.artist) || null,
    yearCandidate: extractYear(albumRow?.release_date) || normalize(innertube?.year) || null,
    thumbnail: normalize(innertube?.thumbnail) || normalize(albumRow?.thumbnail_url) || null,
  };
}

export async function browseAlbum(browseIdRaw: string): Promise<AlbumBrowseResult | null> {
  const incomingId = normalize(browseIdRaw);
  if (!incomingId) return null;
  const browseId = incomingId;

  const [innertube, albumRow, activityTitle] = await Promise.all([
    fetchInnertubeAlbum(browseId),
    fetchAlbumFromDatabase(browseId),
    fetchActivitySnapshotTitle(browseId),
  ]);

  const source = pickAlbumSource(innertube, albumRow);
  const titleResolution = resolveTitle(browseId, source.titleCandidate, activityTitle, albumRow?.title ?? null);
  console.log("[browse/album] resolved_title", { browseId, title: titleResolution.title, source: titleResolution.source });

  const artist = source.artistCandidate || normalize(albumRow?.album_tracks?.[0]?.track?.artist) || "";
  const year = source.yearCandidate || extractYear(albumRow?.release_date) || "";
  const subtitleParts = ["Album"];
  if (artist) subtitleParts.push(artist);
  if (year) subtitleParts.push(year);
  const subtitle = subtitleParts.join(" • ");

  if (innertube && source.tracks.length > 0) {
    try {
      await ingestPlaylistOrAlbum(
        {
          browseId,
          kind: "album",
          title: titleResolution.title,
          subtitle,
          thumbnailUrl: source.thumbnail,
          tracks: source.tracks,
          trackCount: source.trackCount,
        },
        { mode: "single-playlist" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[browse/album] ingest_failed", { browseId, message });
    }
  }

  const thumbnail = source.thumbnail || normalize(albumRow?.thumbnail_url) || null;

  return {
    id: browseId,
    title: titleResolution.title,
    subtitle,
    thumbnail,
    tracks: source.tracks,
  };
}
