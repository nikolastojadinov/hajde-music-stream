"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PlaylistCard from "@/components/PlaylistCard";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface Playlist {
  id: string;
  title: string;
  description: string | null;
}

const FEATURED_PLAYLIST_IDS = [
  "63e8c1f4-c544-4b76-9923-f276a8ca6b07", // Pop Hits 2024
  "d74b476c-b1db-4cc7-bd3d-c79275847abe", // Classic Pop
  "70744ef4-b8c8-4737-80ed-ddf45758ff7a", // Hip-Hop Essentials
  "005c63c7-3a0c-4e8a-a64d-a09b5ff0029f", // Rap Kings
  "c982e19c-2897-45ab-b254-6b20a8e3e601", // Smooth Jazz
  "c9a35563-c1c1-4f22-baa1-b64d5815acb7", // Electronic Dreams
  "70fc67b9-9889-40f1-82ef-d7ac25b8d2a4", // EDM Party
  "eaf8a534-db9c-47ec-b667-ad2f25703e61", // Country Roads
];

const FeaturedForYou = () => {
  const { data: playlists, isLoading, error } = useQuery({
    queryKey: ["featured-playlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select("id, title, description")
        .in("id", FEATURED_PLAYLIST_IDS);

      if (error) throw error;
      
      const sortedData = FEATURED_PLAYLIST_IDS.map(id => {
        const playlist = data?.find(p => p.id === id);
        return playlist;
      }).filter((playlist): playlist is Playlist => playlist !== undefined);
      
      return sortedData;
    },
  });

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white px-4 md:px-8">
          featured for you
        </h2>
        <div className="px-4 md:px-8 text-red-500">
          Error loading playlists: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white px-4 md:px-8">
        featured for you
      </h2>
      
      <div className="px-4 md:px-8">
        <ScrollArea className="w-full whitespace-nowrap rounded-md">
          <div className="flex w-max space-x-4 pb-4">
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="w-48 space-y-3">
                  <Skeleton className="h-48 w-48 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))
            ) : playlists && playlists.length > 0 ? (
              // Render playlist cards
              playlists.map((playlist) => (
                <div key={playlist.id} className="w-48">
                  <PlaylistCard
                    id={playlist.id}
                    title={playlist.title}
                    description={playlist.description || ""}
                    imageUrl="/placeholder.svg"
                  />
                </div>
              ))
            ) : (
              // No playlists found
              <div className="text-white/60 py-8">
                No featured playlists found. Please check if the playlists exist in the database.
              </div>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
};

export default FeaturedForYou;