import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PiProvider } from "@/contexts/PiContext";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WelcomeModal from "@/components/WelcomeModal";
import Player from "@/components/Player";
import { YouTubePlayerContainer } from "@/components/YouTubePlayerContainer";
import Home from "@/pages/Home";
import Search from "@/pages/Search";
import Library from "@/pages/Library";
import Playlist from "@/pages/Playlist";
import CreatePlaylist from "@/pages/CreatePlaylist";
import Favorites from "@/pages/Favorites";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import NotFound from "@/pages/NotFound";
import ImportCSV from "@/pages/ImportCSV";

const queryClient = new QueryClient();

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LanguageProvider>
          <PlayerProvider>
            <PiProvider>
              <Toaster />
              <Sonner />
              <WelcomeModal />
              <BrowserRouter>
                <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
                  {/* Desktop Layout */}
                  <div className="hidden md:flex flex-1 pt-16 overflow-hidden">
                    <Sidebar />
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <Header />
                      <main className="flex-1 overflow-y-auto">
                        <Routes>
                          <Route path="/" element={<Home />} />
                          <Route path="/search" element={<Search />} />
                          <Route path="/library" element={<Library />} />
                          <Route path="/playlist/:id" element={<Playlist />} />
                          <Route path="/create-playlist" element={<CreatePlaylist />} />
                          <Route path="/favorites" element={<Favorites />} />
                          <Route path="/import-csv" element={<ImportCSV />} />
                          <Route path="/privacy" element={<Privacy />} />
                          <Route path="/terms" element={<Terms />} />
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                      </main>
                      <Player />
                    </div>
                  </div>

                  {/* Mobile Layout */}
                  <div className="md:hidden flex flex-col flex-1 overflow-hidden">
                    <Header />
                    <main className="flex-1 overflow-y-auto pt-16 pb-32">
                      <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/search" element={<Search />} />
                        <Route path="/library" element={<Library />} />
                        <Route path="/playlist/:id" element={<Playlist />} />
                        <Route path="/create-playlist" element={<CreatePlaylist />} />
                        <Route path="/favorites" element={<Favorites />} />
                        <Route path="/import-csv" element={<ImportCSV />} />
                        <Route path="/privacy" element={<Privacy />} />
                        <Route path="/terms" element={<Terms />} />
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </main>
                    <Footer />
                    <Player />
                  </div>
                  
                  <YouTubePlayerContainer />
                </div>
              </BrowserRouter>
            </PiProvider>
          </PlayerProvider>
        </LanguageProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
