# 🔧 Rešavanje Database Error za Pi Autentifikaciju

## Problem
Backend vraća `database_error` jer tabela `users` ne postoji u produkcijskoj Supabase bazi.

## Rešenje

### Opcija 1: SQL Editor (BRZO - Preporučeno) ⚡

1. **Otvorite Supabase Dashboard**
   - Idite na: https://supabase.com/dashboard/project/ofkfygqrfenctzitigae
   - Ulogujte se sa vašim Supabase nalogom

2. **Otvorite SQL Editor**
   - U levom meniju kliknite na **"SQL Editor"**
   - Kliknite **"New query"**

3. **Izvršite SQL migraciju**
   - Kopirajte kompletan sadržaj fajla: `PRODUCTION_MIGRATION_USERS.sql`
   - Paste-ujte u SQL Editor
   - Kliknite **"Run"** (ili pritisnite Ctrl+Enter)

4. **Verifikujte**
   - Trebalo bi da vidite poruku: "Users table created successfully"
   - U levom meniju **"Table Editor"** trebali bi da vidite tabele:
     - ✅ `users`
     - ✅ `sessions`

### Opcija 2: Supabase CLI (Alternativa)

```bash
# Ako imate Supabase CLI instaliran i povezan sa projektom
cd /workspaces/hajde-music-stream
supabase db push --project-ref ofkfygqrfenctzitigae
```

## Nakon Izvršavanja Migracije

1. **Nije potreban redeploy** - tabele su već kreirane
2. **Testirajte Pi login** u Pi Browser-u na: https://pmtestnet.netlify.app
3. **Očekivani rezultat:**
   - ✅ Pi autentifikacija uspešna
   - ✅ Backend čuva korisnika u bazu
   - ✅ Welcome toast poruka: "Dobrodošli, [vaše ime]! 👋"
   - ✅ Korisničko ime u dropdown meniju

## Šta radi ova migracija?

```sql
-- Kreira 'users' tabelu sa kolonama:
CREATE TABLE users (
  wallet TEXT PRIMARY KEY,        -- Pi UID
  username TEXT,                  -- Pi korisničko ime
  user_consent BOOLEAN,           -- Consent
  premium_until TIMESTAMP,        -- Premium expiry
  created_at, updated_at          -- Timestamps
)

-- Kreira 'sessions' tabelu za sesije:
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  user_uid TEXT REFERENCES users(wallet),
  created_at TIMESTAMP
)
```

## Provera Statusa

Nakon izvršavanja, možete proveriti da li tabele postoje:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'sessions');
```

Trebalo bi da vidite obe tabele.

---

**Note:** Ova migracija je **idempotent** - može se izvršiti više puta bez problema (koristi `IF NOT EXISTS`).
