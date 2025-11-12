import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "./contexts/LanguageContext";
import { PlayerProvider } from "./contexts/PlayerContext";
import { YouTubePlayerContainer } from "./components/YouTubePlayerContainer";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Player from "./components/Player";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Library from "./pages/Library";
import Playlist from "./pages/Playlist";
import PiAuthDemo from "./components/PiAuthDemo";
import CreatePlaylist from "./pages/CreatePlaylist";
import Favorites from "./pages/Favorites";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import { PiProvider } from "./contexts/PiContext";
import { useEffect } from "react";
import { testConnection } from "./lib/connectionTest";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    testConnection();
  }, []);
  return (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <PlayerProvider>
        <PiProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <div className="flex h-screen w-full bg-background text-foreground">
              {/* Sidebar - hidden on mobile */}
              <div className="hidden md:block">
                <Sidebar />
              </div>
              
              <div className="flex-1 flex flex-col w-full">
                <Header />
                <div className="flex-1 mt-16 mb-20 overflow-y-auto scrollbar-hide">
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/search" element={<Search />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/playlist/:id" element={<Playlist />} />
                    <Route path="/create-playlist" element={<CreatePlaylist />} />
                    <Route path="/favorites" element={<Favorites />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/pi-demo" element={<PiAuthDemo />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </div>
              </div>
              
              {/* YouTube Player Container - globalni, pomera se između pozicija */}
              <YouTubePlayerContainer />
              
              <Player />
              <Footer />
            </div>
          </BrowserRouter>
        </TooltipProvider>
        </PiProvider>
      </PlayerProvider>
    </LanguageProvider>
  </QueryClientProvider>
  );
};

export default App;
