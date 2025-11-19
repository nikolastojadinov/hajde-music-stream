import { Heart, ListMusic } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { usePi } from "@/contexts/PiContext";
import { useEffect, useMemo, useState } from "react";

type Track = {
  id: string;
  title: string;
  artist: string;
  cover_url?: string | null;
  external_id: string;
  duration?: number | null;
};

type Playlist = {
  id: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
};

const Library = () => {
  const { user } = usePi();

  const [songs, setSongs] = useState<Track[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songsError, setSongsError] = useState<string | null>(null);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);

  const BACKEND_URL = useMemo(() => import.meta.env.VITE_BACKEND_URL || "", []);
  const userId = useMemo(() => user?.uid || localStorage.getItem("pi_uid") || null, [user?.uid]);

  useEffect(() => {
    const loadSongs = async () => {
      if (!userId || !BACKEND_URL) {
        setSongs([]);
        return;
      }
      setSongsLoading(true);
      setSongsError(null);
      try {
        // Try /likes/songs first, fallback to /likes/tracks if 404
        let resp = await fetch(`${BACKEND_URL}/likes/songs?user_id=${encodeURIComponent(userId)}`);
        if (resp.status === 404) {
          resp = await fetch(`${BACKEND_URL}/likes/tracks?user_id=${encodeURIComponent(userId)}`);
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const items = Array.isArray(json.items) ? json.items : [];
        setSongs(items);
      } catch (e: any) {
        console.error("[Library] Failed to load liked songs:", e);
        setSongsError(e?.message || "Greška pri učitavanju pesama");
        setSongs([]);
      } finally {
        setSongsLoading(false);
      }
    };

    loadSongs();
  }, [userId, BACKEND_URL]);

  useEffect(() => {
    const loadPlaylists = async () => {
      if (!userId || !BACKEND_URL) {
        setPlaylists([]);
        return;
      }
      setPlaylistsLoading(true);
      setPlaylistsError(null);
      try {
        const resp = await fetch(`${BACKEND_URL}/likes/playlists?user_id=${encodeURIComponent(userId)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const items = Array.isArray(json.items) ? json.items : [];
        setPlaylists(items);
      } catch (e: any) {
        console.error("[Library] Failed to load liked playlists:", e);
        setPlaylistsError(e?.message || "Greška pri učitavanju plejlisti");
        setPlaylists([]);
      } finally {
        setPlaylistsLoading(false);
      }
    };

    loadPlaylists();
  }, [userId, BACKEND_URL]);

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        <h1 className="text-4xl font-bold mb-8 animate-fade-in">Moja Biblioteka</h1>

        <Tabs defaultValue="liked-songs" className="w-full animate-slide-up">
          <TabsList className="bg-secondary mb-8 w-full sm:w-auto">
            <TabsTrigger value="liked-songs" className="gap-1 sm:gap-2 w-40">
              <ListMusic className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">Omiljene Pesme</span>
            </TabsTrigger>
            <TabsTrigger value="liked-playlists" className="gap-1 sm:gap-2 w-40">
              <Heart className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">Omiljene Plejliste</span>
            </TabsTrigger>
          </TabsList>

          {/* Liked Songs Tab */}
          <TabsContent value="liked-songs" className="mt-0">
            {!userId ? (
              <div className="text-center py-12 text-muted-foreground">Prijavite se da vidite omiljene pesme.</div>
            ) : songsLoading ? (
              <div className="text-center py-12 text-muted-foreground">Učitavanje...</div>
            ) : songsError ? (
              <div className="text-center py-12 text-red-400">Greška: {songsError}</div>
            ) : songs.length > 0 ? (
              <div className="space-y-1">
                {songs.map((track) => (
                  <TrackCard
                    key={track.id}
                    id={track.id}
                    title={track.title}
                    artist={track.artist}
                    imageUrl={track.cover_url || undefined}
                    youtubeId={track.external_id}
                    duration={track.duration || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <ListMusic className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Nema omiljenih pesama.</p>
              </div>
            )}
          </TabsContent>

          {/* Liked Playlists Tab */}
          <TabsContent value="liked-playlists" className="mt-0">
            {!userId ? (
              <div className="text-center py-12 text-muted-foreground">Prijavite se da vidite omiljene plejliste.</div>
            ) : playlistsLoading ? (
              <div className="text-center py-12 text-muted-foreground">Učitavanje...</div>
            ) : playlistsError ? (
              <div className="text-center py-12 text-red-400">Greška: {playlistsError}</div>
            ) : playlists.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {playlists.map((p) => (
                  <PlaylistCard
                    key={p.id}
                    id={p.id}
                    title={p.title}
                    description={p.description || ""}
                    imageUrl={p.cover_url || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Heart className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Nema omiljenih plejlisti.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Library;
