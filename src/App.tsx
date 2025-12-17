// CLEANUP DIRECTIVE: Restore SPA routing, including playlist create/edit pages.
import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
  const { authenticating } = usePi();
  const { t } = useLanguage();
  if (!authenticating) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black text-white">
      <p className="text-lg font-semibold animate-pulse">{t("pi_authentication")}</p>
    </div>
  );
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/library" element={<Library />} />
      <Route path="/artist/:artistName" element={<Artist />} />
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

                  <BrowserRouter>
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
