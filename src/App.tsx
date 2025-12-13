// CLEANUP DIRECTIVE: Restore SPA routing, including playlist create/edit pages.
import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PiProvider, usePi } from "@/contexts/PiContext";
import { PremiumDialogProvider } from "@/contexts/PremiumDialogContext";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Player from "@/components/Player";
import PremiumPromptManager from "@/components/PremiumPromptManager";
import { YouTubePlayerContainer } from "@/components/YouTubePlayerContainer";

import Home from "@/pages/Home";
import Search from "@/pages/Search";
import Library from "@/pages/Library";
import Playlist from "@/pages/Playlist";
import Artist from "@/pages/Artist";
import Favorites from "@/pages/Favorites";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import License from "@/pages/License";
import NotFound from "@/pages/NotFound";
import ImportCSV from "@/pages/ImportCSV";
import CreatePlaylist from "@/pages/CreatePlaylist";
import EditPlaylist from "@/pages/EditPlaylist";

const queryClient = new QueryClient();

type AuthGateProps = {
  children: ReactNode;
};

const AuthGate = ({ children }: AuthGateProps) => {
  const { loading } = usePi();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <span>Loading authentication...</span>
      </div>
    );
  }
  return <>{children}</>;
};

const GlobalAuthOverlay = () => {
  const { authenticating } = usePi();
  const { t } = useLanguage();

  if (!authenticating) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black text-white">
      <p className="text-lg font-semibold animate-pulse">
        {t("pi_authentication")}
      </p>
    </div>
  );
};

const App = () => {
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

                      {/* DESKTOP */}
                      <div className="hidden flex-1 overflow-hidden pt-16 md:flex">
                        <Sidebar />
                        <div className="flex flex-1 flex-col overflow-hidden">
                          <Header />
                          <main className="flex-1 overflow-y-auto">
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
                          </main>
                          <Player />
                        </div>
                      </div>

                      {/* MOBILE */}
                      <div className="flex flex-1 flex-col overflow-hidden md:hidden">
                        <Header />
                        <main className="flex-1 overflow-y-auto pt-16 pb-32">
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
                        </main>
                        <Footer />
                        <Player />
                      </div>

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
};

export default App;
