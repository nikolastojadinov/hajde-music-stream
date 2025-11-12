import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

export async function testSupabaseConnection() {
  console.log("🔍 Testing Supabase connection (frontend)...");
  const { data, error } = await supabase.from("playlists").select("title").limit(1);
  if (error) console.error("❌ Supabase connection failed:", error.message);
  else console.log("✅ Frontend Supabase connection OK:", data?.[0]?.title || "no playlists yet");
}
