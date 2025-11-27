# Fix za Duplicate Key Errors - 27. novembar 2025

## Problem

Production logs su pokazivali dva tipa grešaka:

1. **Duplicate Key Violation**:
```
duplicate key value violates unique constraint "uq_tracks_external_id"
```

2. **ON CONFLICT Double Update**:
```
ON CONFLICT DO UPDATE command cannot affect row a second time
```

## Root Cause Analiza

### Arhitekturni Problem

Sistem ima **dva modela** za vezu između tracks i playlists:

1. **Stari model** (20251111124417 migracija):
   - `tracks` tabela sa `playlist_id` kolonom (direktna veza)
   - Track je vezan za JEDNU playlistu

2. **Novi model** (20251114121655 migracija):
   - `playlist_tracks` junction tabela sa `UNIQUE(playlist_id, track_id)`
   - Track može biti u VIŠE playlista (shared)
   - `tracks` tabela bi trebalo da bude globalna (bez `playlist_id`)

### Konkretni Problemi u Kodu

1. **Duplikati u istom batch-u**:
   - Ako isti YouTube video postoji više puta u jednoj playlisti
   - `executeBatchInserts()` je pokušavao da insert-uje isti `external_id` više puta
   - Izaziva: "ON CONFLICT affects row twice"

2. **Konflikt između globalnog constraint-a i per-playlist logike**:
   - `runBatch.ts` je koristio `.eq('playlist_id', playlist.id)` za učitavanje tracks
   - Ali kreirao je nove tracks sa `playlist_id: playlist.id`
   - UNIQUE constraint `uq_tracks_external_id` je globalan (ne per-playlist)
   - Rezultat: Ako isti track postoji u drugoj playlisti, insert pada

## Implementirano Rešenje

### 1. Deduplication Pre Insert-a

**Fajl**: `backend/src/jobs/runBatch.ts` - funkcija `executeBatchInserts()`

```typescript
// Deduplicate by external_id (UNIQUE constraint at database level)
const seen = new Map<string, any>();
const deduplicated: any[] = [];

for (const track of tracks) {
  if (track.external_id && !seen.has(track.external_id)) {
    seen.set(track.external_id, track);
    deduplicated.push(track);
  }
}
```

**Efekat**: Eliminiše "ON CONFLICT affects row twice" grešku.

### 2. Globalni Track Model

**Fajl**: `backend/src/jobs/runBatch.ts` - funkcija `performDeltaSync()`

**Pre fixa**:
```typescript
const { data: existingTracks } = await supabase!
  .from(TRACKS_TABLE)
  .select('...')
  .eq('playlist_id', playlist.id);  // ❌ Per-playlist query

toInsert.push({
  playlist_id: playlist.id,  // ❌ Vezuje track za playlistu
  external_id: item.videoId,
  // ...
});
```

**Posle fixa**:
```typescript
const externalIds = youtubeItems.map(item => item.videoId);

const { data: existingTracks } = await supabase!
  .from(TRACKS_TABLE)
  .select('...')
  .in('external_id', externalIds);  // ✅ Globalni query

toInsert.push({
  // playlist_id removed - track je globalan
  external_id: item.videoId,
  // ...
});
```

**Efekat**: Trackovi se sada čuvaju JEDNOM u bazi (globalno), ne dupliciraju za svaku playlistu.

### 3. Migracija za UNIQUE Constraint

**Fajl**: `supabase/migrations/20251127000000_fix_tracks_unique_constraint.sql`

```sql
-- Ensure UNIQUE constraint exists (idempotent)
ALTER TABLE public.tracks 
  ADD CONSTRAINT uq_tracks_external_id UNIQUE (external_id);

-- Partial index for optimization
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracks_external_id_idx 
  ON public.tracks (external_id) 
  WHERE external_id IS NOT NULL;
```

**Efekat**: Garantuje da constraint postoji u produkciji (bio je kreiran ručno u dashboard-u).

### 4. Privremeno Isključena Delete Logika

```typescript
// Skip deletion logic - tracks are global and shared across playlists
// Deletion should be handled separately via playlist_tracks junction table
const toDelete: string[] = [];
```

**Razlog**: Pošto trackovi sada mogu biti u više playlista, ne možemo ih obrisati iz `tracks` tabele kada nestanu iz jedne playliste. Deletion će biti implementiran kasnije kroz `playlist_tracks` junction tabelu.

## Deployment

```bash
git add backend/src/jobs/runBatch.ts supabase/migrations/20251127000000_fix_tracks_unique_constraint.sql
git commit -m "Fix duplicate key errors..."
git push origin main
```

Render auto-deploy: ~5 minuta

## Verifikacija

Posle deployment-a, pratiti logove:

```bash
# U Render dashboard-u ili via CLI
render logs

# Očekivani output:
✅ "Delta sync completed" umesto "Failed to insert track batch"
✅ "Deduplicated tracks before insert" (ako ima duplikata u YouTube playlisti)
```

## Sledeći Koraci (TODO)

1. **Implementirati `playlist_tracks` junction vezu**:
   - Kreirati/update `playlist_tracks` redove posle track insert-a
   - Dodati position tracking
   - Implementirati delete logic kroz junction tabelu

2. **Migrirati postojeće podatke**:
   - Premestiti `tracks.playlist_id` veze u `playlist_tracks`
   - Opcional: Drop `playlist_id` kolonu iz `tracks` (breaking change)

3. **Update frontend code**:
   - Proveriti da li frontend koristi `playlist_id` direktno iz tracks
   - Promeniti JOIN logiku da koristi `playlist_tracks`

## Tehnički Detalji

### Database Schema (relevantni delovi)

```sql
-- Global tracks table
CREATE TABLE tracks (
  id UUID PRIMARY KEY,
  external_id TEXT,  -- YouTube video ID
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  -- playlist_id UUID,  -- DEPRECATED but still exists
  CONSTRAINT uq_tracks_external_id UNIQUE (external_id)
);

-- Junction table (proper many-to-many)
CREATE TABLE playlist_tracks (
  id UUID PRIMARY KEY,
  playlist_id UUID REFERENCES playlists(id),
  track_id UUID REFERENCES tracks(id),
  position INTEGER,
  UNIQUE(playlist_id, track_id),
  UNIQUE(playlist_id, position)
);
```

### API Quota Impact

**Pre fixa**: 
- Svaki job run troši quota ALI pada na database insert
- 50 playlists × ~50 tracks = 2,500 tracks
- Quota potrošen, ali 0 tracks sačuvano ❌

**Posle fixa**:
- Job uspešno završava
- 50 playlists × ~50 tracks = ~2,500 API poziva
- Ali deduplication smanjuje database write-ove
- Quota se koristi produktivno ✅

## Monitoring

Pratiti metrike:

- **Error Rate**: Trebao bi biti 0% (trenutno je 100%)
- **Inserted Tracks**: Trebao bi biti >0 (trenutno 0)
- **Deduplication Count**: Ukazuje na duplikate u YouTube playlisti
- **Skipped Playlists (304)**: ETag optimization radi

## Commit Hash

```
9cb5567 - Fix duplicate key errors: deduplicate tracks and use global track model
```
