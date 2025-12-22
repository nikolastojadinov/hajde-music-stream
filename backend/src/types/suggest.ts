export type SuggestionType = "artist" | "track" | "playlist" | "album";

export type SuggestionItem = {
  type: SuggestionType;
  id: string;
  name: string;
  imageUrl?: string;
  subtitle?: string;
  artists?: string[];
};

export type SuggestEnvelope = {
  q: string;
  source: "spotify_suggest" | "local_fallback";
  suggestions: SuggestionItem[];
};

export const SUGGESTION_TTL_SECONDS = 3_600;
export const MAX_SUGGESTIONS = 25;
