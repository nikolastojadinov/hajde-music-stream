import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { usePi } from "@/contexts/PiContext";
import { usePremiumDialog } from "@/contexts/PremiumDialogContext";

const PROMPT_PATHS = ["/create-playlist", "/library"];

const PremiumPromptManager = () => {
  const { user } = usePi();
  const { openDialog } = usePremiumDialog();
  const location = useLocation();
  const initialPromptShown = useRef(false);
  const lastPromptPath = useRef<string | null>(null);

  // Show dialog 3 seconds after welcome for non-premium users
  useEffect(() => {
    if (!user || user.premium || initialPromptShown.current) {
      return;
    }

    initialPromptShown.current = true;
    const timer = setTimeout(() => {
      openDialog();
    }, 3000);

    return () => clearTimeout(timer);
  }, [user, openDialog]);

  // Auto-open dialog on specific routes for non-premium users
  useEffect(() => {
    if (!user || user.premium) {
      lastPromptPath.current = null;
      return;
    }

    const currentPath = location.pathname;
    const shouldPrompt = PROMPT_PATHS.includes(currentPath);

    if (shouldPrompt && lastPromptPath.current !== currentPath) {
      lastPromptPath.current = currentPath;
      openDialog();
    }

    if (!shouldPrompt) {
      lastPromptPath.current = null;
    }
  }, [location.pathname, user, openDialog]);

  return null;
};

export default PremiumPromptManager;
