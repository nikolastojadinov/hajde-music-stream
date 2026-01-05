import { useEffect, useState } from "react";
import { searchResolve, searchSuggest } from "@/lib/api/search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type AnySection = {
  kind?: string;
  title?: string | null;
  items?: any[];
};

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  // LIVE SUGGEST (MINIMAL)
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    searchSuggest(query)
      .then((r) => setSuggestions(r?.suggestions ?? []))
      .catch(() => setSuggestions([]));
  }, [query]);

  // SEARCH
  const runSearch = async () => {
    if (query.length < 2) return;
    setLoading(true);
    try {
      const r = await searchResolve({ q: query });
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  const sections: AnySection[] =
    results?.sections ??
    results?.data?.sections ??
    [];

  const hasAnything =
    sections.length > 0 &&
    sections.some((s) => Array.isArray(s.items) && s.items.length > 0);

  return (
    <div className="p-4 space-y-6 pb-24">
      {/* SEARCH INPUT */}
      <div className="space-y-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube Music…"
        />
        <Button onClick={runSearch}>Search</Button>

        {/* SUGGESTIONS */}
        {suggestions.length > 0 && (
          <div className="border rounded bg-card">
            {suggestions.map((s: any, i: number) => (
              <div
                key={i}
                className="px-3 py-2 text-sm border-b last:border-b-0"
                onClick={() => {
                  setQuery(s.name ?? "");
                  runSearch();
                }}
              >
                {s.name ?? JSON.stringify(s)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RESULTS */}
      {loading && <div>Loading…</div>}

      {!loading && results && !hasAnything && (
        <div>Nothing found</div>
      )}

      {!loading &&
        sections.map((section, si) => {
          if (!section.items || section.items.length === 0) return null;

          return (
            <div key={si} className="space-y-2">
              <h2 className="font-bold text-lg">
                {section.title ?? section.kind ?? "Section"}
              </h2>

              <div className="space-y-2">
                {section.items.map((item: any, ii: number) => {
                  const text =
                    item.title ||
                    item.name ||
                    item.text ||
                    item.subtitle ||
                    JSON.stringify(item);

                  return (
                    <div
                      key={ii}
                      className="border rounded p-2 text-sm"
                    >
                      {text}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
