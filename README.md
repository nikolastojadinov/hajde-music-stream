## Hajde Music Stream (Vite + React)

A modern music streaming frontend built with Vite, React, TypeScript, TailwindCSS, and shadcn/radix UI. Auth and data are powered by Supabase. Pi Network SDK is loaded in `index.html` for auth/payments integrations.

### Requirements

- Node.js 18+ (recommended 20+)
- npm (preferred). Yarn is not required.

### Install

```bash
npm install
```

### Develop

```bash
npm run dev
```

- Dev server runs on http://localhost:8080 (proxied from Netlify dev if using `netlify dev`).

### Build

```bash
npm run build
npm run preview # optional - serve the production build locally
```

The production output is emitted to the `build/` folder.

### Environment variables

This app uses Vite env vars (prefixed with `VITE_`). Set these locally in a `.env` file or in your hosting provider:

- `VITE_BACKEND_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_FUNCTIONS_URL`
- `VITE_PI_SANDBOX`

Netlify configuration (`netlify.toml`) also includes placeholders you can override in the Netlify UI.

### Deploy (Netlify)

`netlify.toml` is configured for a root-based Vite app:

- base: `.`
- command: `npm run build`
- publish: `build`

For local dev with Netlify CLI:

```bash
netlify dev
```

### Notes

- Code splitting is enabled in `vite.config.ts` to keep the entry bundle lean (React, Radix, Supabase, React Query, etc. are split into vendor chunks).
- Path alias `@` points to `src/`.
- The Pi SDK is loaded from `index.html`.

### Repository structure (top-level)

- `src/` – application source
- `public/` – static assets
- `build/` – production output
- `backend/` – backend service (deployed separately)
- `netlify.toml` – Netlify deploy config
- `render.yaml` – Render config for backend

---
Happy streaming! 🎵
