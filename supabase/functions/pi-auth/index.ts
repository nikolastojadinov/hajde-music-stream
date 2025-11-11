// Supabase Edge Function: pi-auth
// Verifies Pi auth and stores/updates user in Supabase
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLATFORM_API_URL = Deno.env.get("PLATFORM_API_URL") || "https://api.minepi.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/$/, "");

    if (req.method === "OPTIONS") {
      return withCORS(new Response("ok"));
    }

    if (req.method === "POST" && pathname.endsWith("/signin")) {
      const { authResult } = await req.json();
      if (!authResult?.accessToken || !authResult?.user?.uid) {
        return withCORS(new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }));
      }

      // Verify access token with Platform API /v2/me
      const meRes = await fetch(`${PLATFORM_API_URL}/v2/me`, {
        headers: { Authorization: `Bearer ${authResult.accessToken}` },
      });
      if (!meRes.ok) {
        return withCORS(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
      }

      // Upsert user into Supabase DB
      const user = {
        uid: authResult.user.uid as string,
        username: authResult.user.username as string,
        roles: authResult.user.roles ?? [],
        access_token: authResult.accessToken as string,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("pi_users")
        .upsert(user, { onConflict: "uid" });
      if (error) {
        console.error("Supabase upsert error", error);
        return withCORS(new Response(JSON.stringify({ error: "db_error" }), { status: 500 }));
      }

      return withCORS(new Response(JSON.stringify({ user: { uid: user.uid, username: user.username, roles: user.roles } }), { status: 200 }));
    }

    return withCORS(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
  } catch (e) {
    console.error(e);
    return withCORS(new Response(JSON.stringify({ error: "server_error" }), { status: 500 }));
  }
});

function withCORS(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "content-type,authorization");
  return new Response(res.body, { status: res.status, headers });
}
