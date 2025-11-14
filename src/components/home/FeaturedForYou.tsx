"use client";

import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/lib/externalSupabase";
import PlaylistCard from "@/components/PlaylistCard";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
}

const FeaturedForYou = () => {
  const { data: playlists, isLoading, error } = useQuery({
    queryKey: ["featured-playlists"],
    queryFn: async () => {
      // Fetch featured playlists from external database - top playlists by item count
      const { data, error } = await externalSupabase
        .from("playlists")
        .select("id, title, description, cover_url")
        .order("item_count", { ascending: false })
        .limit(12);

      if (error) throw error;
      return data as Playlist[];
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
                    imageUrl={playlist.cover_url || "/placeholder.svg"}
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