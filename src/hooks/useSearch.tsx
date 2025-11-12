import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Track {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  duration: number | null;
  image_url: string | null;
  playlist_id: string | null;
}

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
}

export interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
}

export function useSearch(searchTerm: string) {
  console.log("🔍 useSearch hook called with term:", searchTerm);
  
  return useQuery({
    queryKey: ["search", searchTerm],
    queryFn: async () => {
      console.log("🚀 queryFn executing for:", searchTerm);
      
      if (!searchTerm?.trim()) {
        console.log("❌ Empty search term");
        return { tracks: [], playlists: [] };
      }

      const term = `%${searchTerm.trim()}%`;
      console.log("🔎 Searching with pattern:", term);

      const [t1, t2, p1, p2] = await Promise.all([
        supabase.from("tracks").select("*").ilike("title", term).limit(20),
        supabase.from("tracks").select("*").ilike("artist", term).limit(20),
        supabase.from("playlists").select("*").ilike("title", term).limit(20),
        supabase.from("playlists").select("*").ilike("description", term).limit(20),
      ]);

      const tracksMap = new Map();
      const allTracks = [...(t1.data || []), ...(t2.data || [])];
      allTracks.forEach(track => tracksMap.set(track.id, track));
      const tracks = Array.from(tracksMap.values()).slice(0, 20);

      const playlistsMap = new Map();
      const allPlaylists = [...(p1.data || []), ...(p2.data || [])];
      allPlaylists.forEach(pl => playlistsMap.set(pl.id, pl));
      const playlists = Array.from(playlistsMap.values()).slice(0, 20);

      console.log("✅ Search complete:", { 
        tracks: tracks.length, 
        playlists: playlists.length,
        trackSamples: tracks.slice(0, 2).map(t => t.title),
        playlistSamples: playlists.slice(0, 2).map(p => p.title)
      });

      return { tracks, playlists };
    },
    enabled: Boolean(searchTerm?.trim()),
    retry: false,
  });
}
