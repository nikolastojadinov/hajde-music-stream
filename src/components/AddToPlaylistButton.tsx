import { type MouseEvent } from "react";
import { Plus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePi } from "@/contexts/PiContext";
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

  const disabled = !trackId;

  const handleTriggerClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!user) {
      try {
        await signIn();
      } catch (err) {
        console.warn("[AddToPlaylist] sign-in cancelled", err);
      }
    }

    toast.info(t("add_to_playlist_error"));
  };

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
    </>
  );
};

export default AddToPlaylistButton;
