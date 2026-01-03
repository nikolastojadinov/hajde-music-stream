import { Heart, ListMusic, Pencil, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PlaylistCard from "@/components/PlaylistCard";
import TrackCard from "@/components/TrackCard";
import { usePi } from "@/contexts/PiContext";
import useLikes from "@/hooks/useLikes";
import { useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate, Link } from "react-router-dom";
import type { KeyboardEvent, MouseEvent } from "react";
import { useMyPlaylists, type UserPlaylist } from "@/hooks/useMyPlaylists";
import { deriveArtistKey } from "@/lib/artistKey";
import { useExistingArtistKeys } from "@/hooks/useExistingArtistKeys";

const Library = () => {
  const { user } = usePi();
  const { likedTracks, likedPlaylists, likedTrackIds, toggleTrackLike } = useLikes();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const userId = user?.uid || null;
  const {
    data: myPlaylists = [],
    isLoading: myPlaylistsLoading,
    error: myPlaylistsError,
  } = useMyPlaylists({ enabled: Boolean(userId) });

  const playlistsErrorMessage = myPlaylistsError
    ? myPlaylistsError instanceof Error
      ? myPlaylistsError.message
      : String(myPlaylistsError)
    : null;

  const artistNames = useMemo(
    () => likedTracks.map((track) => (track.artist ? String(track.artist) : "")).filter(Boolean),
    [likedTracks]
  );
  const { existingKeys: existingArtistKeys } = useExistingArtistKeys(artistNames);

  const myPlaylistsContent = useMemo(() => {
    if (!userId) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          {t("library_sign_in_playlists")}
        </div>
      );
    }

    if (myPlaylistsLoading) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <span className="animate-pulse">{t("loading")}</span>
        </div>
      );
    }

    if (playlistsErrorMessage) {
      return (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {playlistsErrorMessage}
        </div>
      );
    }

    if (myPlaylists.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          <Heart className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>{t("no_playlists_created")}</p>
          <button
            onClick={() => navigate("/create")}
            className="mt-4 pm-cta-pill pm-cta-pill--subtle"
          >
            <span className="pm-cta-pill-inner">
              <Plus className="h-4 w-4 stroke-[2.2] text-[#FFD77A]" />
              {t("create_playlist_btn")}
            </span>
          </button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {myPlaylists.map((playlist) => (
          <MyPlaylistCard key={playlist.id} playlist={playlist} />
        ))}
      </div>
    );
  }, [myPlaylists, myPlaylistsLoading, playlistsErrorMessage, navigate, t, userId]);

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        <h1 className="text-4xl font-bold mb-8 animate-fade-in">{t("your_library")}</h1>

        <Tabs defaultValue="liked-songs" className="w-full animate-slide-up">
          <TabsList className="bg-secondary mb-8 w-full sm:w-auto">
            <TabsTrigger value="liked-songs" className="gap-1 sm:gap-2 w-40">
              <ListMusic className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("liked_songs")}</span>
            </TabsTrigger>
            <TabsTrigger value="liked-playlists" className="gap-1 sm:gap-2 w-40">
              <Heart className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs sm:text-sm leading-tight text-center">{t("liked_playlists")}</span>
            </TabsTrigger>
          </TabsList>

          {/* Liked Songs Tab */}
          <TabsContent value="liked-songs" className="mt-0">
            {!userId ? (
              <div className="text-center py-12 text-muted-foreground">{t("library_sign_in_songs")}</div>
            ) : likedTracks.length > 0 ? (
              <div className="space-y-1">
                {likedTracks.map((track) => {
                  const artistName = track.artist || '';
                  const artistKey = deriveArtistKey(artistName);
                  const artistHref = artistKey && existingArtistKeys.has(artistKey)
                    ? `/artist/${encodeURIComponent(artistKey)}`
                    : undefined;

                  return (
                    <TrackCard
                      key={track.id}
                      id={track.id}
                      title={track.title || ''}
                      artist={artistName}
                      artistHref={artistHref}
                      imageUrl={track.cover_url || undefined}
                      youtubeId={track.external_id || ''}
                      duration={track.duration || undefined}
                      liked={likedTrackIds.has(track.id)}
                      onToggleLike={toggleTrackLike}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <ListMusic className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>{t("no_liked_songs")}</p>
                <p className="text-sm mt-2">{t("like_songs_to_see_here")}</p>
              </div>
            )}
          </TabsContent>

          {/* Liked Playlists Tab */}
          <TabsContent value="liked-playlists" className="mt-0">
            {!userId ? (
              <div className="text-center py-12 text-muted-foreground">{t("library_sign_in_playlists")}</div>
            ) : likedPlaylists.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {likedPlaylists.map((p) => (
                  <PlaylistCard
                    key={p.id}
                    id={p.id}
                    title={p.title || ''}
                    description={p.description || ''}
                    imageUrl={p.cover_url || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Heart className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>{t("no_liked_playlists")}</p>
                <p className="text-sm mt-2">{t("like_playlists_to_see_here")}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <section className="mt-12 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-2xl font-semibold">{t("my_playlists")}</h2>
            <Link
              to="/create"
              className="pm-cta-pill pm-cta-pill--subtle"
            >
              <span className="pm-cta-pill-inner">
                <Plus className="h-4 w-4 stroke-[2.2] text-[#FFD77A]" />
                {t("create_playlist_btn")}
              </span>
            </Link>
          </div>
          {myPlaylistsContent}
        </section>
      </div>
    </div>
  );
};

export default Library;

const MyPlaylistCard = ({ playlist }: { playlist: UserPlaylist }) => {
  const navigate = useNavigate();
  const visibilityLabel = playlist.is_public ? "Public" : "Private";

  const openPlaylist = () => navigate(`/playlist/${playlist.id}`);
  const openEditor = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    navigate(`/edit/${playlist.id}`);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPlaylist}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") openPlaylist();
      }}
      className="group rounded-2xl border border-border bg-secondary/40 p-4 transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
    >
      <div className="relative mb-3 overflow-hidden rounded-xl bg-muted">
        {playlist.cover_url ? (
          <img src={playlist.cover_url} alt={playlist.title} className="w-full aspect-square object-cover" />
        ) : (
          <div className="flex aspect-square items-center justify-center text-muted-foreground">
            <ListMusic className="w-6 h-6" />
          </div>
        )}
        <span className={`absolute top-3 left-3 rounded-full px-3 py-0.5 text-xs font-semibold ${playlist.is_public ? "bg-emerald-500/20 text-emerald-300" : "bg-purple-500/20 text-purple-100"}`}>
          {visibilityLabel}
        </span>
        <button
          type="button"
          onClick={openEditor}
          className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white hover:bg-black/80"
        >
          <Pencil className="mr-1 inline h-3 w-3" /> Edit
        </button>
      </div>
      <p className="font-semibold line-clamp-1">{playlist.title || "Untitled playlist"}</p>
      <p className="text-xs text-muted-foreground line-clamp-2">{playlist.description || ""}</p>
    </div>
  );
};
