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
  image_url?: string | null;
  cover_url?: string | null;
}

const FEATURED_PLAYLIST_IDS = [
  "7ee9ab59-ed8b-4afc-948b-9ab01b8d25cc",
  "b176d691-9f3a-4965-900c-51df898a01ca",
  "940157cd-e749-4401-84ea-c5e923f75768",
  "919bc5f5-71ec-423d-81a3-f7a22aa05ca7",
  "bec4dca2-2b80-41f6-82c8-0dc056c9cd82",
  "b4506e1a-5141-4a2a-8460-84ef97c96ec7",
  "8add5f32-ef1a-406d-bbf9-4d028337c59b",
  "d46c18a1-c0bd-4be8-8aeb-039d0dfe82df"
];

const FeaturedForYou = () => {
  const { data: playlists, isLoading, error } = useQuery({
    queryKey: ["featured-playlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select("id, title, description, image_url, cover_url")
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
                    imageUrl={playlist.image_url || playlist.cover_url || "/placeholder.svg"}
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