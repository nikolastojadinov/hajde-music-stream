import { fetchWithPiAuth } from "@/lib/fetcher";

export type OwnerProfile = {
  owner_id: string;
  wallet: string;
  username: string | null;
  premium: boolean;
  premium_until: string | null;
};

export async function fetchOwnerProfile(): Promise<OwnerProfile | null> {
  const response = await fetchWithPiAuth("/api/users/me");

  if (response.status === 401) {
    return null;
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok || !payload || typeof payload !== "object") {
    const message = (payload as { error?: string } | null)?.error ?? "Unable to resolve your profile.";
    throw new Error(message);
  }

  const profile = payload as OwnerProfile;
  if (!profile.owner_id) {
    throw new Error("Missing owner profile data.");
  }

  return profile;
}
