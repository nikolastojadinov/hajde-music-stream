// Supabase Edge Function: pi-payments
// Handles Pi payments server-side callbacks and Platform API calls
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLATFORM_API_URL = Deno.env.get("PLATFORM_API_URL") || "https://api.minepi.com";
const PI_API_KEY = Deno.env.get("PI_API_KEY")!;

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

    if (req.method === "POST" && pathname.endsWith("/approve")) {
      const { paymentId, user_uid } = await req.json();
      if (!paymentId) return withCORS(new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }));

      // Fetch current payment details
      const currentPaymentRes = await fetch(`${PLATFORM_API_URL}/v2/payments/${paymentId}`, {
        headers: { Authorization: `Key ${PI_API_KEY}` },
      });
      const currentPayment = await currentPaymentRes.json();

      // Create order record
      await supabase.from("orders").upsert({
        pi_payment_id: paymentId,
        product_id: currentPayment?.metadata?.productId ?? null,
        user_uid: user_uid ?? null,
        txid: null,
        paid: false,
        cancelled: false,
        created_at: new Date().toISOString(),
      }, { onConflict: "pi_payment_id" });

      // Approve on Platform API
      await fetch(`${PLATFORM_API_URL}/v2/payments/${paymentId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Key ${PI_API_KEY}` },
      });

      return withCORS(new Response(JSON.stringify({ message: `Approved ${paymentId}` }), { status: 200 }));
    }

    if (req.method === "POST" && pathname.endsWith("/complete")) {
      const { paymentId, txid } = await req.json();
      if (!paymentId || !txid) return withCORS(new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }));

      await supabase.from("orders").update({ txid, paid: true }).eq('pi_payment_id', paymentId);

      await fetch(`${PLATFORM_API_URL}/v2/payments/${paymentId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${PI_API_KEY}` },
        body: JSON.stringify({ txid }),
      });

      return withCORS(new Response(JSON.stringify({ message: `Completed ${paymentId}` }), { status: 200 }));
    }

    if (req.method === "POST" && pathname.endsWith("/cancelled_payment")) {
      const { paymentId } = await req.json();
      if (!paymentId) return withCORS(new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }));

      await supabase.from("orders").update({ cancelled: true }).eq('pi_payment_id', paymentId);
      return withCORS(new Response(JSON.stringify({ message: `Cancelled ${paymentId}` }), { status: 200 }));
    }

    if (req.method === "POST" && pathname.endsWith("/incomplete")) {
      const { payment } = await req.json();
      const paymentId: string = payment?.identifier;
      const txid: string | undefined = payment?.transaction?.txid;
      const txURL: string | undefined = payment?.transaction?._link;
      if (!paymentId) return withCORS(new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }));

      // Basic verification example: compare block memo with our order id
      if (txURL && txid) {
        const horizonRes = await fetch(txURL);
        const horizonData = await horizonRes.json();
        const memo = horizonData?.memo;
        if (memo !== paymentId) {
          return withCORS(new Response(JSON.stringify({ error: 'mismatched_payment' }), { status: 400 }));
        }
        await supabase.from('orders').update({ txid, paid: true }).eq('pi_payment_id', paymentId);
        await fetch(`${PLATFORM_API_URL}/v2/payments/${paymentId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Key ${PI_API_KEY}` },
          body: JSON.stringify({ txid }),
        });
      }
      return withCORS(new Response(JSON.stringify({ message: `Handled incomplete ${paymentId}` }), { status: 200 }));
    }

    if (req.method === 'POST' && pathname.endsWith('/notifications/send')) {
      const { notifications } = await req.json();
      if (!Array.isArray(notifications) || notifications.length === 0) {
        return withCORS(new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 }));
      }
      const resp = await fetch(`${PLATFORM_API_URL}/v2/in_app_notifications/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${PI_API_KEY}` },
        body: JSON.stringify({ notifications }),
      });
      const data = await resp.json();
      return withCORS(new Response(JSON.stringify(data), { status: resp.status }));
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
