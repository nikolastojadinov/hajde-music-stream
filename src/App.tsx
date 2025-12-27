// CLEANUP DIRECTIVE: Restore SPA routing, including playlist create/edit pages.
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Footer from "@/components/Footer";
import FullscreenPlayer from "@/components/FullscreenPlayer";
import Header from "@/components/Header";
import MiniPlayer from "@/components/MiniPlayer";
import PremiumPromptManager from "@/components/PremiumPromptManager";
import Sidebar from "@/components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { YouTubePlayerContainer } from "@/components/YouTubePlayerContainer";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import { PiProvider, usePi } from "@/contexts/PiContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PremiumDialogProvider } from "@/contexts/PremiumDialogContext";
import { useEffect, useState } from "react";

import Artist from "@/pages/Artist";
import CreatePlaylist from "@/pages/CreatePlaylist";
import EditPlaylist from "@/pages/EditPlaylist";
import Favorites from "@/pages/Favorites";
import Home from "@/pages/Home";
import ImportCSV from "@/pages/ImportCSV";
import Library from "@/pages/Library";
import License from "@/pages/License";
import NotFound from "@/pages/NotFound";
import Playlist from "@/pages/Playlist";
import Privacy from "@/pages/Privacy";
import Search from "@/pages/Search";
import Terms from "@/pages/Terms";

const queryClient = new QueryClient();

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

async function sendClientLog(entry: { level?: string; message: string; context?: any }) {
  try {
    await fetch(`${BACKEND_URL}/client-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      credentials: "include",
    });
  } catch (err) {
    console.warn("[ClientLog] send failed", err);
  }
}

type AuthGateProps = {
  children: ReactNode;
};

const AuthGate = ({ children }: AuthGateProps) => {
  const { loading } = usePi();
  if (!loading) return <>{children}</>;

  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      <span>Loading authentication...</span>
    </div>
  );
};

const GlobalAuthOverlay = () => {
  const { authenticating, logout, authLog, loading, authError } = usePi();
  const { t } = useLanguage();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!authenticating) {
      setStuck(false);
      return;
    }

    const timer = setTimeout(() => setStuck(true), 12000);
    return () => clearTimeout(timer);
  }, [authenticating]);

  if (!authenticating && !loading) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-3 px-4 text-center">
        <p className="text-lg font-semibold animate-pulse">
          {authenticating ? t("pi_authentication") : "Finishing auth..."}
        </p>
        <p className="text-xs text-white/70">If this stays long, check Pi Browser console for [Auth]/[PiContext] logs.</p>
        {authLog?.length ? (
          <div className="mt-2 max-h-36 w-[min(320px,80vw)] overflow-y-auto rounded bg-white/10 p-2 text-left text-[11px] leading-snug">
            {authLog.slice(-8).map((line, idx) => (
              <div key={idx} className="text-white/90">
                {line}
              </div>
            ))}
          </div>
        ) : null}
        {authError ? <p className="text-xs text-red-300">{authError}</p> : null}
        {stuck ? (
          <button
            type="button"
            className="rounded bg-white px-4 py-2 text-sm font-medium text-black shadow-md transition hover:opacity-90"
            onClick={logout}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
};

type FatalError = { message: string; detail?: string } | null;

const GlobalErrorOverlay = ({ error }: { error: FatalError }) => {
  if (!error) return null;
  return (
    <div className="fixed inset-0 z-[4000] flex flex-col items-center justify-center gap-3 bg-black text-white px-4 text-center">
      <p className="text-lg font-semibold">Something went wrong</p>
      <p className="text-sm text-white/80 whitespace-pre-line">{error.message}</p>
      {error.detail ? <p className="text-xs text-white/60 whitespace-pre-line">{error.detail}</p> : null}
      <p className="text-xs text-white/50">If this persists, reload the page.</p>
    </div>
  );
};

const PostAuthRedirect = () => {
  const { user } = usePi();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && location.pathname === "/") {
      navigate("/library", { replace: true });
    }
  }, [user, location.pathname, navigate]);

  return null;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/library" element={<Library />} />
      <Route path="/artist/:artistKey" element={<Artist />} />
      <Route path="/playlist/:id" element={<Playlist />} />
      <Route path="/create" element={<CreatePlaylist />} />
      <Route path="/edit/:id" element={<EditPlaylist />} />
      <Route path="/favorites" element={<Favorites />} />
      <Route path="/import-csv" element={<ImportCSV />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/license" element={<License />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default function App() {
  const [fatalError, setFatalError] = useState<FatalError>(null);
  const { user, loading } = usePi();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setFatalError({ message: event.message || "Unexpected error", detail: event?.error?.stack });
      void fetch(`${import.meta.env.VITE_BACKEND_URL || "http://localhost:8000"}/client-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: "error", message: event.message, context: { stack: event?.error?.stack } }),
        credentials: "include",
      }).catch(() => {});
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      const message = reason?.message || String(reason) || "Unhandled rejection";
      setFatalError({ message, detail: reason?.stack });
      void fetch(`${import.meta.env.VITE_BACKEND_URL || "http://localhost:8000"}/client-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: "error", message, context: { stack: reason?.stack } }),
        credentials: "include",
      }).catch(() => {});
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    (window as any).__APP_ALIVE = true;
    void sendClientLog({ level: "info", message: "[App] Shell mounted", context: { uid: user?.uid ?? null } });
  }, [user?.uid]);

  useEffect(() => {
    void sendClientLog({ level: "info", message: "[App] Auth state", context: { loading, uid: user?.uid ?? null } });
  }, [loading, user?.uid]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LanguageProvider>
          <PiProvider>
            <PremiumDialogProvider>
              <AuthGate>
                <PlayerProvider>
                  <Toaster />
                  <Sonner />
                  <GlobalAuthOverlay />
                  <GlobalErrorOverlay error={fatalError} />

                  <BrowserRouter>
                    <PostAuthRedirect />
                    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
                      <div className="hidden flex-1 overflow-hidden pt-16 md:flex">
                        <Sidebar />
                        <div className="flex flex-1 flex-col overflow-hidden">
                          <Header />
                          <main className="flex-1 overflow-y-auto pb-24">
                            <AppRoutes />
                          </main>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col overflow-hidden md:hidden">
                        <Header />
                        <main className="flex-1 overflow-y-auto pt-16 pb-32">
                          <AppRoutes />
                        </main>
                        <Footer />
                      </div>

                      {/* Single canonical playback UI mounts */}
                      <MiniPlayer />
                      <FullscreenPlayer />

                      <PremiumPromptManager />
                      <YouTubePlayerContainer />
                    </div>
                  </BrowserRouter>
                </PlayerProvider>
              </AuthGate>
            </PremiumDialogProvider>
          </PiProvider>
        </LanguageProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
