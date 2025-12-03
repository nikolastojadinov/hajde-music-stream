"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";
import { Loader2, Music2, Heart, ListMusic, Lock, Globe, Disc3 } from "lucide-react";
import Link from "next/link";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase env vars — please define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

type PlaylistRecord = {
  id: string;
  title: string;
  cover_url: string | null;
  is_public: boolean | null;
  owner_id?: string | null;
};

type LikedPlaylistRecord = {
  id: string;
  playlist: PlaylistRecord | null;
};

type LikedSongRecord = {
  id: string;
  track: {
    id: string;
    title: string;
    artist: string | null;
    cover_url: string | null;
    duration: number | null;
  } | null;
};

const playlistFields = "id,title,cover_url,is_public,owner_id";
const likedPlaylistSelect = `id,playlist:playlists(${playlistFields})`;
const likedTrackSelect = "id,track:tracks(id,title,artist,cover_url,duration)";

export default function LibraryPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<"songs" | "playlists">("songs");
  const [myPlaylists, setMyPlaylists] = useState<PlaylistRecord[]>([]);
  const [likedPlaylists, setLikedPlaylists] = useState<LikedPlaylistRecord[]>([]);
  const [likedSongs, setLikedSongs] = useState<LikedSongRecord[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error: authError }) => {
      if (cancelled) return;
      if (authError) {
        console.error("Unable to resolve Supabase user", authError);
        setError("We could not verify your session. Please refresh and try again.");
      }
      setUser(data?.user ?? null);
      setAuthChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchLibraryData = useCallback(async (currentUser: User) => {
    setLoadingData(true);
    setError(null);
    try {
      const [playlistsRes, likedPlaylistsRes, likedSongsRes] = await Promise.all([
        supabase
          .from("playlists")
          .select(playlistFields)
          .eq("owner_id", currentUser.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("likes")
          .select(likedPlaylistSelect)
          .eq("user_id", currentUser.id)
          .eq("type", "playlist"),
        supabase
          .from("likes")
          .select(likedTrackSelect)
          .eq("user_id", currentUser.id)
          .eq("type", "track"),
      ]);

      if (playlistsRes.error) throw playlistsRes.error;
      if (likedPlaylistsRes.error) throw likedPlaylistsRes.error;
      if (likedSongsRes.error) throw likedSongsRes.error;

      setMyPlaylists((playlistsRes.data ?? []) as PlaylistRecord[]);
      setLikedPlaylists((likedPlaylistsRes.data ?? []) as LikedPlaylistRecord[]);
      setLikedSongs((likedSongsRes.data ?? []) as LikedSongRecord[]);
    } catch (err) {
      console.error("Failed to load library data", err);
      setError(err instanceof Error ? err.message : "Failed to load your library. Please try again later.");
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setMyPlaylists([]);
      setLikedPlaylists([]);
      setLikedSongs([]);
      return;
    }
    fetchLibraryData(user);
  }, [user, fetchLibraryData]);

  const likedSongsView = useMemo(() => {
    if (!likedSongs.length) {
      return <EmptyState icon={Music2} title="No liked songs yet" body="Like tracks anywhere in PurpleMusic to see them here." />;
    }
    return (
      <div className="space-y-3">
        {likedSongs.map((entry) => {
          const track = entry.track;
          if (!track) return null;
          return (
            <div key={entry.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-white/10">
                {track.cover_url ? (
                  <img src={track.cover_url} alt={track.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/40">
                    <Disc3 className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-white truncate">{track.title}</p>
                <p className="text-sm text-white/60 truncate">{track.artist ?? "Unknown artist"}</p>
              </div>
              <p className="text-sm text-white/50">{formatDuration(track.duration)}</p>
            </div>
          );
        })}
      </div>
    );
  }, [likedSongs]);

  const likedPlaylistsView = useMemo(() => {
    const filtered = likedPlaylists.filter((entry) => entry.playlist);
    if (!filtered.length) {
      return <EmptyState icon={Heart} title="No liked playlists" body="Tap the heart icon on playlists to collect them here." />;
    }
    return (
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map((entry) => (
          <PlaylistCard key={entry.id} playlist={entry.playlist!} />
        ))}
      </div>
    );
  }, [likedPlaylists]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white px-6 text-center">
        <div className="space-y-6 max-w-lg">
          <h1 className="text-4xl font-semibold">Sign in to view your Library</h1>
          <p className="text-white/70">
            Your likes and personal playlists live here. Please sign in with Pi to unlock your Library.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-yellow-400 px-6 py-3 text-black font-semibold shadow-lg shadow-yellow-500/40"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050109] via-[#0d0519] to-[#030106] text-white">
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-16">
        <header className="mb-10 space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">PurpleMusic</p>
          <h1 className="text-4xl font-bold">Your Library</h1>
          <p className="text-white/60">Everything you like or create lives here. Private sets stay yours; public ones hit the search feed.</p>
        </header>

        {error ? (
          <div className="mb-8 rounded-3xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "songs"
                  ? "bg-yellow-400 text-black shadow-lg shadow-yellow-500/40"
                  : "bg-white/10 text-white/70 hover:text-white"
              }`}
              onClick={() => setActiveTab("songs")}
            >
              <Music2 className="h-4 w-4" /> Liked Songs
            </button>
            <button
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "playlists"
                  ? "bg-yellow-400 text-black shadow-lg shadow-yellow-500/40"
                  : "bg-white/10 text-white/70 hover:text-white"
              }`}
              onClick={() => setActiveTab("playlists")}
            >
              <ListMusic className="h-4 w-4" /> Liked Playlists
            </button>
          </div>

          <div className="mt-6 min-h-[200px]">
            {loadingData ? (
              <div className="flex h-48 items-center justify-center text-white/70">
                <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Loading your library...
              </div>
            ) : activeTab === "songs" ? (
              likedSongsView
            ) : (
              likedPlaylistsView
            )}
          </div>
        </section>

        <section className="mt-12 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-white/50">Personal crates</p>
              <h2 className="text-3xl font-semibold">My Playlists</h2>
            </div>
            <Link
              href="/create"
              className="rounded-full border border-yellow-400/60 px-5 py-2 text-sm font-semibold text-yellow-200 hover:bg-yellow-400/10"
            >
              + Create playlist
            </Link>
          </div>

          {loadingData && !myPlaylists.length ? (
            <div className="flex h-40 items-center justify-center text-white/70">
              <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Loading your playlists...
            </div>
          ) : myPlaylists.length ? (
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
              {myPlaylists.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Music2}
              title="You have no playlists yet"
              body="Craft something new. Public sets land in Search, private ones stay in your vault."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PlaylistCard({ playlist }: { playlist: PlaylistRecord }) {
  const visibilityLabel = playlist.is_public ? "Public" : "Private";
  const badgeStyles = playlist.is_public
    ? "bg-emerald-400/15 text-emerald-200 border-emerald-400/30"
    : "bg-purple-500/15 text-purple-100 border-purple-500/30";

  return (
    <Link
      href={`/playlist/${playlist.id}`}
      className="group block rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur transition hover:-translate-y-1 hover:border-yellow-300/60"
    >
      <div className="relative mb-4 overflow-hidden rounded-2xl bg-white/10">
        {playlist.cover_url ? (
          <img src={playlist.cover_url} alt={playlist.title} className="aspect-square w-full object-cover" />
        ) : (
          <div className="flex aspect-square items-center justify-center text-white/30">
            <Music2 className="h-10 w-10" />
          </div>
        )}
        <span className={`absolute left-3 top-3 rounded-full border px-3 py-1 text-xs font-semibold ${badgeStyles}`}>
          {playlist.is_public ? <Globe className="mr-1 inline h-3.5 w-3.5" /> : <Lock className="mr-1 inline h-3.5 w-3.5" />}
          {visibilityLabel}
        </span>
      </div>
      <p className="text-lg font-semibold text-white truncate">{playlist.title}</p>
      <p className="text-sm text-white/50">{playlist.is_public ? "Searchable" : "Only you"}</p>
    </Link>
  );
}

type EmptyStateProps = {
  icon: typeof Music2;
  title: string;
  body: string;
};

function EmptyState({ icon: Icon, title, body }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/5 px-6 py-12 text-center text-white/70">
      <Icon className="mb-4 h-8 w-8 text-white/40" />
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-sm text-sm">{body}</p>
    </div>
  );
}

function formatDuration(duration: number | null | undefined) {
  if (!duration || Number.isNaN(duration)) {
    return "";
  }
  const mins = Math.floor(duration / 60);
  const secs = Math.floor(duration % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
