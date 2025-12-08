import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { usePi } from "@/contexts/PiContext";
import { usePremiumDialog } from "@/contexts/PremiumDialogContext";
import { useAuth } from "@/hooks/useAuth";

const PROMPT_PATHS = ["/create", "/library"];

const PremiumPromptManager = () => {
  const { user } = usePi();
  const { openDialog } = usePremiumDialog();
  const { goPremiumVisible, dismissGoPremium } = useAuth();
  const location = useLocation();
  const lastPromptPath = useRef<string | null>(null);

  // Trigger premium modal when welcome flow marks it visible
  useEffect(() => {
    if (!goPremiumVisible) {
      return;
    }

    openDialog();
    dismissGoPremium();
  }, [goPremiumVisible, openDialog, dismissGoPremium]);

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
