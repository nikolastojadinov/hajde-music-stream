# PurpleBeats (Hajde Music Stream) with Pi Network Integration

## Stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn-ui
- Supabase (DB, Auth optional, Edge Functions)
- Pi Network SDK (auth + payments + notifications)

## Pi Network integration (ported from pi-apps/demo)

Integrated flows:
- Sign in with Pi (`Pi.authenticate`) with scopes: username, payments, roles, in_app_notifications
- Payments lifecycle: approve, complete, cancel, recover incomplete
- In-app notifications sending (optional)

### Frontend additions
- `index.html`: loads Pi SDK and initializes with `VITE_PI_SANDBOX` flag.
- `src/contexts/PiContext.tsx`: React context wrapping auth & payment functions.
- `Header`: Sign in/out controls and username display.
- `PremiumDialog`: triggers payment for selected subscription plan.
- `PiAuthDemo` route (`/pi-demo`): lightweight page to manually test Pi sign-in and a 1π payment independent of the full UI.

### Supabase Edge Functions
- `supabase/functions/pi-auth`: verifies access token with Platform API `/v2/me`, upserts user into `pi_users` table.
- `supabase/functions/pi-payments`: payment callbacks (approve, complete, cancel, incomplete) and in-app notification forwarding.

### Database schema (Supabase)
SQL file: `supabase/sql/pi_schema.sql`

Tables:
- `pi_users(uid, username, roles, access_token, updated_at)`
- `orders(pi_payment_id, product_id, user_uid, txid, paid, cancelled, created_at)`

### Environment Variables
Copy `.env.example` and set:

```
VITE_PI_SANDBOX=true # use Pi Testnet sandbox in development
VITE_SUPABASE_FUNCTIONS_URL=https://<project-ref>.functions.supabase.co
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Supabase Function secrets (set in dashboard):
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PLATFORM_API_URL=https://api.minepi.com
PI_API_KEY=<your-pi-api-key>
```

### Deploy Functions
```
supabase functions deploy pi-auth --no-verify-jwt
supabase functions deploy pi-payments --no-verify-jwt
```

### Run Locally
```sh
npm install
npm run dev
```
Open in Pi Browser (Testnet) for full SDK behavior.

Netlify (Vite) env note:
- This app uses Vite, which reads variables prefixed with `VITE_` at build time.
- The Netlify config includes both `NEXT_PUBLIC_*` (left for compatibility) and matching `VITE_*` vars that the app actually consumes: `VITE_BACKEND_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_FUNCTIONS_URL`, `VITE_PI_SANDBOX`.
Ensure these values are set correctly in your Netlify environment.

Health check (Express backend):
```
GET /health -> { ok: true, supabase: { configured, dbOk, url } }
```
Used by a lightweight client utility `testConnection()` on app mount to log backend status.

### Usage Flow
1. User opens profile menu -> Sign in with Pi
2. Access token verified server-side; user stored in `pi_users`
3. Premium plan purchase triggers `Pi.createPayment`
4. Callbacks hit Edge Functions to approve & complete payment, updating `orders`
5. Incomplete payments recovered on sign-in via context callback

### Notes
- Gracefully no-op if Pi SDK unavailable (non-Pi browsers)
- Minimal server state; no sessions, relies on Supabase tables
- Extend with subscription expiration logic by adding `expires_at` to `orders`

### Next Steps / Ideas
- Add webhook security (e.g. signature verification if available)
- Track premium status per user and gate features
- Add notification UI for in-app notifications
- Implement role-based UI using `roles` from Pi auth

## License
MIT (adjust as needed)
