import { externalSupabase } from "@/lib/externalSupabase";

const ownerIdCache = new Map<string, string | null>();

const OWNER_ID_COLUMNS = "id" as const;

async function queryOwnerId(wallet: string): Promise<string | null> {
  const { data, error } = await externalSupabase
    .from("users")
    .select(OWNER_ID_COLUMNS)
    .eq("wallet", wallet)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to resolve owner id");
  }

  return data?.id ?? null;
}

export async function getOwnerIdForWallet(wallet: string | null | undefined): Promise<string | null> {
  if (!wallet) {
    return null;
  }

  if (ownerIdCache.has(wallet)) {
    return ownerIdCache.get(wallet) ?? null;
  }

  const ownerId = await queryOwnerId(wallet);
  ownerIdCache.set(wallet, ownerId ?? null);
  return ownerId;
}
