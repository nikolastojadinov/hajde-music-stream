import { useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ListMusic, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePi } from "@/contexts/PiContext";
import { useMyPlaylists } from "@/hooks/useMyPlaylists";
import { addTrackToPlaylist } from "@/lib/playlistTracks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AddToPlaylistButtonVariant = "solid" | "ghost";

interface AddToPlaylistButtonProps {
  trackId?: string | null;
  trackTitle?: string;
  triggerClassName?: string;
  iconSize?: number;
  variant?: AddToPlaylistButtonVariant;
}

const AddToPlaylistButton = ({ trackId, trackTitle, triggerClassName, iconSize = 18, variant = "solid" }: AddToPlaylistButtonProps) => {
  const { user, signIn } = usePi();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingPlaylistId, setPendingPlaylistId] = useState<string | null>(null);

  const { data: playlists = [], isLoading, error } = useMyPlaylists({ enabled: open });

  const disabled = !trackId;

  const handleTriggerClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled) {
      toast.error(t("add_to_playlist_error"));
      return;
    }

    if (!user) {
      toast.error(t("add_to_playlist_sign_in"));
      try {
        await signIn();
      } catch (err) {
        console.warn("[AddToPlaylist] sign-in cancelled", err);
      }
      return;
    }

    setOpen(true);
  };

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPendingPlaylistId(null);
    }
    setOpen(nextOpen);
  };

  const handleAdd = async (playlistId: string, playlistTitle: string) => {
    if (!trackId) return;
    setPendingPlaylistId(playlistId);
    try {
      const response = await addTrackToPlaylist(playlistId, trackId);
      const messageTemplate = response.already_exists
        ? t("add_to_playlist_exists")
        : t("add_to_playlist_success");
      toast.success(messageTemplate.replace("{playlist}", playlistTitle));
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("add_to_playlist_error");
      toast.error(message);
    } finally {
      setPendingPlaylistId(null);
    }
  };

  const handleCreatePlaylist = () => {
    setOpen(false);
    navigate("/create");
  };

  const playlistsError = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null;

  const baseButtonClass =
    variant === "ghost"
      ? "inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-2 text-muted-foreground transition hover:text-primary focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
      : "inline-flex items-center justify-center rounded-full border border-border/60 bg-background/80 p-2 text-muted-foreground shadow-sm transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        onClick={handleTriggerClick}
        disabled={disabled}
        aria-label={t("add_to_playlist")}
        className={cn(baseButtonClass, triggerClassName, disabled && "cursor-not-allowed opacity-50")}
      >
        <Plus className="transition-transform" style={{ width: iconSize, height: iconSize }} />
      </button>

      <Dialog open={open} onOpenChange={handleDialogChange}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border border-border">
          <div className="space-y-4 p-4 sm:p-6">
            <div>
              <h3 className="text-lg font-semibold">{t("add_to_playlist")}</h3>
              <p className="text-sm text-muted-foreground">
                {trackTitle
                  ? t("add_to_playlist_subtitle_named").replace("{track}", trackTitle)
                  : t("add_to_playlist_subtitle")}
              </p>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-14 w-full animate-pulse rounded-xl bg-secondary/40" />
                ))}
              </div>
            ) : playlistsError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <p>{playlistsError}</p>
                <p className="mt-1">{t("try_again")}</p>
              </div>
            ) : playlists.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 p-4 text-center">
                <p className="text-sm text-muted-foreground mb-3">{t("add_to_playlist_empty")}</p>
                <Button variant="secondary" className="w-full" onClick={handleCreatePlaylist}>
                  {t("add_to_playlist_create")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <ScrollArea className="max-h-64 pr-3">
                  <div className="space-y-2">
                    {playlists.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => handleAdd(playlist.id, playlist.title || "Playlist")}
                        disabled={Boolean(pendingPlaylistId)}
                        className="w-full rounded-xl border border-border/60 bg-card/60 p-3 text-left shadow-sm transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-wait"
                      >
                        <div className="flex items-center gap-3">
                          {playlist.cover_url ? (
                            <img
                              src={playlist.cover_url}
                              alt={playlist.title}
                              className="h-12 w-12 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-secondary/50 flex items-center justify-center">
                              <ListMusic className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{playlist.title || t("my_playlist")}</p>
                            {playlist.description && (
                              <p className="text-xs text-muted-foreground truncate">{playlist.description}</p>
                            )}
                          </div>
                          {pendingPlaylistId === playlist.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          ) : (
                            <Plus className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                <p className="text-xs text-muted-foreground">{t("add_to_playlist_scroll")}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AddToPlaylistButton;
