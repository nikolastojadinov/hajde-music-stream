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
  image_url: string | null;
  category: string | null;
  created_at: string;
}

const FEATURED_PLAYLIST_IDS = [
  "78c6d20d-f8ee-43d6-954f-a0723761c2ac", // Rock Classics
  "ecb9716f-ab8d-47bf-b652-1c5ca61fed4c", // Hard Rock Anthems
  "6325b238-545d-4aef-ab24-dcd7607ad919", // Alternative Rock
  "63ecce76-dfa9-4c19-bea3-6ac2937bdccb", // Classic Rock Legends
  "60d58675-779a-412c-b961-8a549a9f5a7b", // Rock Ballads
  "2dd12dae-53b1-4d86-a314-c90f4804e48d"  // 90s Rock Hits
];

const FeaturedForYou = () => {
  const { data: playlists, isLoading, error } = useQuery({
    queryKey: ["featured-playlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select("*")
        .in("id", FEATURED_PLAYLIST_IDS);

      if (error) throw error;
      
      // Sort playlists to match the order of FEATURED_PLAYLIST_IDS
      const sortedData = FEATURED_PLAYLIST_IDS.map(id => 
        data.find(playlist => playlist.id === id)
      ).filter((playlist): playlist is Playlist => playlist !== undefined);
      
      return sortedData;
    },
  });

  if (error) {
    console.error("Error fetching featured playlists:", error);
    return null;
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
            ) : (
              // Render playlist cards
              playlists?.map((playlist) => (
                <div key={playlist.id} className="w-48">
                  <PlaylistCard
                    id={playlist.id}
                    title={playlist.title}
                    description={playlist.description || ""}
                    imageUrl={playlist.image_url || "/placeholder-playlist.jpg"}
                  />
                </div>
              ))
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
};

export default FeaturedForYou;