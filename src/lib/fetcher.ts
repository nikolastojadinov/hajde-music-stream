import { getBackendHeaders } from "@/contexts/PiContext";
import { withBackendOrigin } from "@/lib/backendUrl";

export async function fetchWithPiAuth(path: string, options: RequestInit = {}) {
  const headers = {
    ...(options.headers || {}),
    ...getBackendHeaders(),
    "Content-Type": "application/json",
  };

  const fullUrl = withBackendOrigin(path);

  return fetch(fullUrl, {
    ...options,
    headers,
    credentials: "include",
  });
}
