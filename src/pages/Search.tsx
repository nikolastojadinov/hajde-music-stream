import { FormEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import YTMusicSearch from "@/components/search/YTMusicSearch";
import { searchResolve, type SearchSection } from "@/lib/api/search";

export default function Search() {
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<SearchSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (value?: string) => {
    const nextQuery = (value ?? query).trim();
    if (nextQuery.length < 2) return;

    setLoading(true);
    setError(null);

    try {
      const response = await searchResolve({ q: nextQuery });
      setSections(response?.sections ?? []);
    } catch (err) {
      console.error("Search failed", err);
      setError("Unable to load search results.");
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch();
  };

  return (
    <div className="min-h-screen bg-neutral-950 pb-20 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs, artists, albums..."
              className="border-neutral-700 bg-neutral-950 text-white placeholder:text-neutral-500 focus-visible:ring-neutral-500"
            />

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                className="bg-neutral-100 text-neutral-900 hover:bg-white"
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </Button>
              <span className="text-xs text-neutral-500">Type at least 2 characters to search</span>
            </div>
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {!loading && sections.length === 0 && !error && (
          <div className="text-sm text-neutral-500">Start typing to see results.</div>
        )}

        <YTMusicSearch sections={sections} />
      </div>
    </div>
  );
}
