"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  external_id: string | null;
  duration: number | null;
};

type Playlist = {
  id: string;
  title: string;
  cover_url: string | null;
  country: string | null;
  region: number | null;
};

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<"songs" | "playlists">("songs");
  const [userId, setUserId] = useState<string | null>(null);

  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [likedPlaylists, setLikedPlaylists] = useState<Playlist[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // Backend URL for library fetch
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

  // Derive user id (na clientu). Redosled: query param ?uid=..., localStorage 'pi_uid', ili nema usera
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get("uid");
      const fromStorage = window.localStorage.getItem("pi_uid");
      const uid = fromQuery || fromStorage || null;
      setUserId(uid);
    } catch {
      setUserId(null);
    }
  }, []);

  // Load liked songs & playlists via backend /library
  useEffect(() => {
    const load = async () => {
      if (!userId) {
        setLikedTracks([]);
        setLikedPlaylists([]);
        return;
      }
      setLoadingSongs(true);
      setLoadingPlaylists(true);

      try {
        const username = window.localStorage.getItem("pi_username") || "";
        const premium = window.localStorage.getItem("pi_premium") || "false";
        const premiumUntil = window.localStorage.getItem("pi_premium_until") || "";

        const resp = await fetch(`${BACKEND_URL}/library`, {
          headers: {
            "X-Pi-User-Id": userId,
            "X-Pi-Username": username,
            "X-Pi-Premium": premium,
            "X-Pi-Premium-Until": premiumUntil,
          },
          credentials: "include",
        });

        if (!resp.ok) {
          console.error("[Library] backend /library error status:", resp.status);
          setLikedTracks([]);
          setLikedPlaylists([]);
          return;
        }

        const json = await resp.json().catch(() => ({}));
        if (json?.success !== true) {
          console.error("[Library] backend /library error payload:", json);
          setLikedTracks([]);
          setLikedPlaylists([]);
          return;
        }

        // Accept both shapes: { data: { songs, playlists } } or { likedSongs, likedPlaylists }
        const songs: Track[] = json?.data?.songs || json?.likedSongs || [];
        const playlists: Playlist[] = json?.data?.playlists || json?.likedPlaylists || [];

        setLikedTracks(Array.isArray(songs) ? songs : []);
        setLikedPlaylists(Array.isArray(playlists) ? playlists : []);
      } catch (e) {
        console.error("[Library] exception loading library:", e);
        setLikedTracks([]);
        setLikedPlaylists([]);
      } finally {
        setLoadingSongs(false);
        setLoadingPlaylists(false);
      }
    };
    load();
  }, [userId, BACKEND_URL]);

  const renderTracks = () => {
    if (loadingSongs) return <div className="py-8 text-gray-500">Učitavanje...</div>;
    if (likedTracks.length === 0) return <div className="py-8 text-gray-500">Nema omiljenih pesama.</div>;

    return (
      <div className="space-y-2">
        {likedTracks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 p-3 rounded-md hover:bg-gray-100">
            <div className="w-14 h-14 bg-gray-200 rounded overflow-hidden">
              {t.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{t.title}</div>
              <div className="text-sm text-gray-500 truncate">{t.artist || "Nepoznato"}</div>
            </div>
            <div className="text-sm text-gray-500">
              {t.duration ? formatDuration(t.duration) : ""}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderPlaylists = () => {
    if (loadingPlaylists) return <div className="py-8 text-gray-500">Učitavanje...</div>;
    if (likedPlaylists.length === 0) return <div className="py-8 text-gray-500">Nema omiljenih plejlisti.</div>;

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {likedPlaylists.map((p) => (
          <Link key={p.id} href={`/playlist/${p.id}`} className="block">
            <div className="rounded-lg border border-gray-200 hover:shadow-sm overflow-hidden">
              <div className="aspect-square bg-gray-100">
                {p.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cover_url} alt={p.title} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="p-3">
                <div className="font-semibold truncate">{p.title}</div>
                <div className="text-xs text-gray-500 mt-1 truncate">
                  {p.country || (p.region != null ? `regija #${p.region}` : "")}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Moja Biblioteka</h1>

      {!userId ? (
        <div className="py-8 text-gray-500">Potrebna je prijava da bi se prikazala biblioteka.</div>
      ) : (
        <>
          <div className="flex gap-2 mb-6">
            <button
              className={`px-3 py-1.5 rounded ${activeTab === "songs" ? "bg-black text-white" : "bg-gray-100"}`}
              onClick={() => setActiveTab("songs")}
            >
              Omiljene Pesme
            </button>
            <button
              className={`px-3 py-1.5 rounded ${activeTab === "playlists" ? "bg-black text-white" : "bg-gray-100"}`}
              onClick={() => setActiveTab("playlists")}
            >
              Omiljene Plejliste
            </button>
          </div>

          {activeTab === "songs" ? renderTracks() : renderPlaylists()}
        </>
      )}
    </div>
  );
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
