import { withBackendOrigin } from "@/lib/backendUrl";

export type PlaylistResponse = {
  id: string;
  title: string;
  author?: string | null;
  thumbnailUrl?: string | null;
  videoIds: string[];
};

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from server");
  }
}

export async function fetchPlaylistById(playlistId: string, opts?: { max?: number | null }): Promise<PlaylistResponse> {
  const id = (playlistId || "").trim();
  if (!id) throw new Error("Missing playlist id");

  const url = new URL(withBackendOrigin("/api/playlist"));
  url.searchParams.set("playlist_id", id);
  if (typeof opts?.max === "number" && Number.isFinite(opts.max)) {
    url.searchParams.set("max", String(Math.max(0, Math.trunc(opts.max))));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  const json = await readJson(response).catch(() => ({}));
  if (!response.ok) {
    const msg = typeof (json as any)?.error === "string" ? (json as any).error : "Playlist request failed";
    throw new Error(msg);
  }

  return json as PlaylistResponse;
}
