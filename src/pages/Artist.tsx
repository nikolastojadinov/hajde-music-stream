import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { usePlayer } from "@/contexts/PlayerContext";

type ApiArtist = {
  id: string;
  name: string;
  youtube_channel_id: string;
  spotify_artist_id?: string | null;
  avatar_url?: string | null;
};

type ApiPlaylist = {
  id: string;
  title: string;
  youtube_playlist_id: string;
  youtube_channel_id: string;
  source: string;
  created_at: string;
};

type ApiTrack = {
  id: string;
  title: string;
  youtube_video_id: string;
  youtube_channel_id: string;
  artist_name?: string | null;
  created_at: string;
};

type ArtistBundle = {
  artist: ApiArtist | null;
  playlists: ApiPlaylist[];
  tracks: ApiTrack[];
};

type ArtistDebug = {
  input_artist_identifier: string;
  stored_channel_id: string | null;
  channel_validation_result: "valid" | "invalid" | "none";
  search_fallback_used: boolean;
  hydration_started: boolean;
  playlists_fetched_count: number;
  tracks_fetched_count: number;
};

type CandidateChannel = {
  channelId: string;
  title: string;
  thumbUrl?: string;
};

type ArtistApiResponse =
  | ArtistBundle
  | { status: "ok"; artist: ApiArtist | null; playlists: ApiPlaylist[]; tracks: ApiTrack[]; debug: ArtistDebug }
  | { status: "invalid_channel"; requiresChannelSelection: true; debug: ArtistDebug }
  | {
      status: "requires_channel_selection";
      candidates: CandidateChannel[];
      debug: ArtistDebug;
      requiresChannelSelection?: true;
    };

type ArtistApiError = { error: string; debug?: ArtistDebug };

function isArtistBundle(x: any): x is ArtistBundle {
  return x && typeof x === "object" && "artist" in x && "playlists" in x && "tracks" in x;
}

function isOkResponse(
  x: any
): x is { status: "ok"; artist: ApiArtist | null; playlists: ApiPlaylist[]; tracks: ApiTrack[]; debug: ArtistDebug } {
  return x && typeof x === "object" && x.status === "ok" && x.debug && typeof x.debug === "object";
}

function isErrorResponse(x: any): x is ArtistApiError {
  return x && typeof x === "object" && typeof x.error === "string";
}

function isInvalidChannelResponse(x: any): x is { status: "invalid_channel"; requiresChannelSelection: true; debug: ArtistDebug } {
  return (
    x &&
    typeof x === "object" &&
    x.status === "invalid_channel" &&
    x.requiresChannelSelection === true &&
    x.debug &&
    typeof x.debug === "object"
  );
}

function isCandidatesResponse(
  x: any
): x is { status: "requires_channel_selection"; candidates: CandidateChannel[]; debug: ArtistDebug } {
  return (
    x &&
    typeof x === "object" &&
    x.status === "requires_channel_selection" &&
    Array.isArray(x.candidates) &&
    x.debug &&
    typeof x.debug === "object"
  );
}

function logArtistApi(x: any) {
  const status = x && typeof x === "object" ? (x.status ?? "error") : "error";
  const debug = x && typeof x === "object" ? x.debug : undefined;
  console.info("[Artist API]", status, debug);
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export default function Artist() {
  const { channelId } = useParams();
  const { playPlaylist } = usePlayer();

  const [bundle, setBundle] = useState<ArtistBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [processText, setProcessText] = useState("Validating artist channel…");
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [debug, setDebug] = useState<ArtistDebug | null>(null);

  const [requiresChannelSelection, setRequiresChannelSelection] = useState(false);
  const [candidates, setCandidates] = useState<CandidateChannel[]>([]);
  const [selecting, setSelecting] = useState(false);

  const safeChannelId = (channelId || "").trim();

  const artist = bundle?.artist ?? null;
  const playlists = bundle?.playlists ?? [];
  const tracks = bundle?.tracks ?? [];

  const playlistTracks = useMemo(() => {
    return tracks
      .filter((t) => t.youtube_video_id)
      .map((t) => ({
        youtubeId: t.youtube_video_id,
        title: t.title,
        artist: t.artist_name || artist?.name || "Unknown artist",
        id: t.id,
      }));
  }, [tracks, artist?.name]);

  const retry = () => {
    if (!safeChannelId) return;
    setBundle(null);
    setError(null);
    setRequiresChannelSelection(false);
    setCandidates([]);
    setLoading(true);
    setDebug(null);
    setProcessText("Validating artist channel…");
    setReloadNonce((x) => x + 1);
  };

  async function fetchArtist(identifier: string): Promise<ArtistApiResponse> {
    const res = await fetch(`/api/artist/${encodeURIComponent(identifier)}`);
    const json = await res.json().catch(() => ({}));
    return json as ArtistApiResponse;
  }

  async function postSelectedChannel(artistName: string, youtube_channel_id: string): Promise<ArtistApiResponse> {
    const res = await fetch(`/api/artist/selected`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ artistName, youtube_channel_id }),
    });
    const json = await res.json().catch(() => ({}));
    return json as ArtistApiResponse;
  }

  useEffect(() => {
    let active = true;

    async function load() {
      if (!safeChannelId) {
        setBundle(null);
        setLoading(false);
        setError("Missing artist id");
        return;
      }

      try {
        setLoading(true);
        setProcessText("Validating artist channel…");
        setError(null);
        setRequiresChannelSelection(false);
        setCandidates([]);
        setDebug(null);

        const data = await fetchArtist(safeChannelId);
        if (!active) return;

        logArtistApi(data);
        if (data && typeof data === "object" && "debug" in data) {
          setDebug(((data as any).debug as ArtistDebug) ?? null);
        }

        if (isOkResponse(data)) {
          setBundle({ artist: data.artist, playlists: data.playlists, tracks: data.tracks });
          return;
        }

        if (isArtistBundle(data)) {
          setBundle(data);
          return;
        }

        if (isInvalidChannelResponse(data)) {
          setBundle(null);
          setRequiresChannelSelection(true);

          setProcessText("Searching YouTube channels…");

          // Call the same endpoint again to trigger search.list fallback (no valid mapping exists anymore).
          const next = await fetchArtist(safeChannelId);
          if (!active) return;

          logArtistApi(next);
          if (next && typeof next === "object" && "debug" in next) {
            setDebug(((next as any).debug as ArtistDebug) ?? null);
          }

          if (isCandidatesResponse(next)) {
            setCandidates(next.candidates);
            return;
          }

          if (isOkResponse(next)) {
            setBundle({ artist: next.artist, playlists: next.playlists, tracks: next.tracks });
            setRequiresChannelSelection(false);
            setCandidates([]);
            return;
          }

          if (isErrorResponse(next)) {
            setError(next.error || "Artist request failed");
            return;
          }

          return;
        }

        if (isCandidatesResponse(data)) {
          setBundle(null);
          setRequiresChannelSelection(true);
          setCandidates(data.candidates);
          return;
        }

        if (isErrorResponse(data)) {
          setBundle(null);
          setError(data.error || "Artist request failed");
          return;
        }

        setBundle(null);
        setError("Artist request failed");
      } catch (e: any) {
        if (!active) return;
        setBundle(null);
        setError(e?.message || "Artist request failed");
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [safeChannelId, reloadNonce]);

  if (loading) {
    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-muted-foreground">{processText}</div>
        </div>
      </div>
    );
  }

  if (error || !artist) {
    if (requiresChannelSelection) {
      return (
        <div className="p-4 max-w-4xl mx-auto pb-32">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Select a YouTube channel</h1>
            <div className="text-sm text-muted-foreground mt-1">
              This artist needs a valid YouTube channel before albums and tracks can be hydrated.
            </div>
            {selecting ? <div className="text-sm text-muted-foreground mt-2">{processText}</div> : null}
          </div>

          {candidates.length === 0 ? (
            <ErrorState
              title="No channels found"
              subtitle="Try searching again from the Search page with the artist name."
              onRetry={safeChannelId ? retry : undefined}
            />
          ) : (
            <div className="space-y-2">
              {candidates.map((c) => (
                <button
                  key={c.channelId}
                  type="button"
                  disabled={selecting}
                  onClick={async () => {
                    if (!safeChannelId) return;
                    setSelecting(true);
                    setError(null);
                    setProcessText("Fetching playlists and tracks…");
                    try {
                      const resp = await postSelectedChannel(safeChannelId, c.channelId);
                      logArtistApi(resp);
                      if (resp && typeof resp === "object" && "debug" in resp) {
                        setDebug(((resp as any).debug as ArtistDebug) ?? null);
                      }

                      if (isOkResponse(resp)) {
                        setBundle({ artist: resp.artist, playlists: resp.playlists, tracks: resp.tracks });
                        setRequiresChannelSelection(false);
                        setCandidates([]);
                        return;
                      }

                      if (isArtistBundle(resp)) {
                        setBundle(resp);
                        setRequiresChannelSelection(false);
                        setCandidates([]);
                        return;
                      }

                      // Backend may still say invalid/needs selection; keep UI in selection mode.
                      if (isCandidatesResponse(resp)) setCandidates(resp.candidates);
                      if (isErrorResponse(resp)) setError(resp.error || "Hydration failed");
                    } catch (e: any) {
                      setError(e?.message || "Failed to hydrate artist");
                    } finally {
                      setSelecting(false);
                    }
                  }}
                  className="w-full text-left rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                      {c.thumbUrl ? <img src={c.thumbUrl} alt={c.title} className="w-full h-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.channelId}</div>
                    </div>
                    <Button type="button" variant="secondary" disabled={selecting} className="shrink-0">
                      {selecting ? "Working…" : "Select"}
                    </Button>
                  </div>
                </button>
              ))}
            </div>
          )}

          {error ? (
            <div className="mt-4">
              <ErrorState title="Hydration failed" subtitle={error} onRetry={safeChannelId ? retry : undefined} />
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="p-4 max-w-4xl mx-auto pb-32">
        <ErrorState
          title="Artist request failed"
          subtitle={error || "This artist could not be loaded"}
          onRetry={safeChannelId ? retry : undefined}
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto pb-32">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-muted overflow-hidden shrink-0">
          {artist.avatar_url ? <img src={artist.avatar_url} alt={artist.name} className="w-full h-full object-cover" /> : null}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{artist.name}</h1>
          <div className="text-sm text-muted-foreground">
            {formatCount(playlists.length)} playlists • {formatCount(tracks.length)} tracks
          </div>
        </div>

        <Button
          onClick={() => {
            if (playlistTracks.length === 0) return;
            playPlaylist(playlistTracks, 0);
          }}
          disabled={playlistTracks.length === 0}
          className="shrink-0"
        >
          <Play className="w-4 h-4 mr-2" /> Play All
        </Button>
      </div>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">Playlists</h2>
        {playlists.length === 0 ? (
          <EmptyState title="No playlists yet" subtitle="This artist doesn’t have any playlists available" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {playlists.map((p) => (
              <a
                key={p.id}
                href={`https://www.youtube.com/playlist?list=${encodeURIComponent(p.youtube_playlist_id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
              >
                <div className="font-medium line-clamp-2">{p.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{p.source}</div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Tracks</h2>
        {tracks.length === 0 ? (
          <EmptyState title="No tracks yet" subtitle="This artist doesn’t have any tracks available" />
        ) : (
          <div className="space-y-2">
            {tracks.map((t) => {
              const idx = playlistTracks.findIndex((x) => x.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (idx < 0) return;
                    playPlaylist(playlistTracks, idx);
                  }}
                  className="w-full text-left rounded-lg border border-border bg-card/30 px-3 py-3 hover:bg-card/50 transition-colors"
                >
                  <div className="font-medium truncate">{t.title}</div>
                  <div className="text-sm text-muted-foreground truncate">{t.artist_name || artist.name}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
