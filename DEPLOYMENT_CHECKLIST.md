# ✅ MY LIBRARY - DEPLOYMENT CHECKLIST

## 📋 Pre-Deployment Provera

### Database (Supabase)

- [ ] Otvori Supabase Dashboard
- [ ] Idi na SQL Editor
- [ ] Kopiraj sadržaj iz `QUICK_MIGRATION.sql`
- [ ] Pokreni SQL migraciju
- [ ] Proveri da nema grešaka

**Verifikacija:**
```sql
-- Ovo bi trebalo da vrati: owner_id
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'playlists' AND column_name = 'owner_id';

-- Ovo bi trebalo da vrati 4 reda: user_id, track_id, playlist_id, liked_at
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'likes' 
AND column_name IN ('user_id', 'track_id', 'playlist_id', 'liked_at');
```

### Frontend

- [ ] Proveri da nema TypeScript grešaka: `npm run typecheck` ili `yarn typecheck`
- [ ] Build projekat: `npm run build` ili `yarn build`
- [ ] Proveri da build prolazi bez grešaka

## 🧪 Testing Checklist

### Test 1: Kreiranje Plejliste
- [ ] Prijavi se kao korisnik
- [ ] Idi na Create Playlist stranicu
- [ ] Popuni naziv plejliste
- [ ] (Opciono) Popuni opis
- [ ] (Opciono) Dodaj URL slike
- [ ] Klikni "Kreiraj Plejlistu"
- [ ] ✅ Trebalo bi da te redirektuje na novu plejlistu
- [ ] ✅ Plejlista bi trebalo da se vidi u "Moje Plejliste" tabu

### Test 2: Lajkovanje Plejliste
- [ ] Idi na bilo koju plejlistu
- [ ] Klikni na srce ikonu
- [ ] ✅ Srce bi trebalo da se napuni bojom
- [ ] Idi na "Your Library" stranicu
- [ ] Otvori "Lajkovane Plejliste" tab
- [ ] ✅ Plejlista bi trebalo da se vidi ovde

### Test 3: Unlajkovanje Plejliste
- [ ] Klikni ponovo na srce ikonu na istoj plejlisti
- [ ] ✅ Srce bi trebalo da se isprazni
- [ ] Idi na "Your Library" → "Lajkovane Plejliste"
- [ ] ✅ Plejlista bi trebalo da nestane sa liste

### Test 4: Lajkovanje Pesme
- [ ] Otvori bilo koju plejlistu sa pesmama
- [ ] Klikni na srce ikonu pored pesme
- [ ] ✅ Srce bi trebalo da se napuni bojom
- [ ] Idi na "Your Library" stranicu
- [ ] Otvori "Lajkovane Pesme" tab
- [ ] ✅ Pesma bi trebalo da se vidi ovde

### Test 5: Unlajkovanje Pesme
- [ ] Klikni ponovo na srce ikonu pored iste pesme
- [ ] ✅ Srce bi trebalo da se isprazni
- [ ] Idi na "Your Library" → "Lajkovane Pesme"
- [ ] ✅ Pesma bi trebalo da nestane sa liste

### Test 6: My Library Tabovi
- [ ] Idi na "Your Library" stranicu
- [ ] Klikni na "Moje Plejliste" tab
- [ ] ✅ Trebalo bi da vidiš svoje kreirane plejliste
- [ ] Klikni na "Lajkovane Plejliste" tab
- [ ] ✅ Trebalo bi da vidiš lajkovane plejliste
- [ ] ✅ Strana se NE bi trebalo da reload-uje
- [ ] Klikni na "Lajkovane Pesme" tab
- [ ] ✅ Trebalo bi da vidiš lajkovane pesme
- [ ] ✅ Strana se NE bi trebalo da reload-uje

### Test 7: Persistencija Podataka
- [ ] Lajkuj nekoliko stvari
- [ ] Izloguj se
- [ ] Ponovo se uloguj
- [ ] Idi na "Your Library"
- [ ] ✅ Svi lajkovi bi trebalo da i dalje budu tu

### Test 8: Prazna Stanja
- [ ] Kreiraj novog test korisnika (ili koristi korisnika bez podataka)
- [ ] Idi na "Your Library"
- [ ] Tab "Moje Plejliste"
  - [ ] ✅ Trebalo bi da vidiš poruku "Niste kreirali nijednu plejlistu"
- [ ] Tab "Lajkovane Plejliste"
  - [ ] ✅ Trebalo bi da vidiš poruku "Nemate lajkovanih plejlisti"
- [ ] Tab "Lajkovane Pesme"
  - [ ] ✅ Trebalo bi da vidiš poruku "Nemate lajkovanih pesama"

## 🔧 Troubleshooting

### Problem: SQL Migracija vraća grešku
**Uzroci:**
- Tabela `users` ili `tracks` ne postoji
- RLS politike već postoje sa drugim imenima

**Rešenje:**
1. Pokreni migration fajl iz `supabase/migrations/` direktorijuma
2. Ili koristi Supabase CLI: `supabase db push`

### Problem: "owner_id violates foreign key constraint"
**Uzrok:** Tabela `users` ne postoji ili korisnik nije u bazi

**Rešenje:**
```sql
-- Proveri da li postoji users tabela
SELECT * FROM information_schema.tables WHERE table_name = 'users';

-- Proveri da li postoji trenutni korisnik
SELECT id FROM users WHERE id = auth.uid();
```

### Problem: Lajkovi se ne čuvaju
**Uzrok:** RLS politike blokiraju INSERT operaciju

**Rešenje:**
```sql
-- Proveri politike
SELECT * FROM pg_policies WHERE tablename = 'likes';

-- Proveri da li RLS dozvoljava insert
SELECT auth.uid(); -- Trebalo bi da vrati tvoj user ID
```

### Problem: Cannot read properties of undefined
**Uzrok:** Hook se poziva pre nego što se učitaju podaci

**Rešenje:** Već implementirano - hook vraća prazne nizove dok se učitava

## 📊 Performance Checklist

- [ ] Indeksi su kreirani na `playlists.owner_id`
- [ ] Indeksi su kreirani na `likes.user_id`
- [ ] Indeksi su kreirani na `likes.track_id`
- [ ] Indeksi su kreirani na `likes.playlist_id`
- [ ] RLS politike su optimizovane (koriste indekse)

## 🎉 Deployment

Kada sve gore prođe:

- [ ] Commit sve izmene
- [ ] Push na git
- [ ] Deploy frontend (Netlify/Vercel/drugi hosting)
- [ ] Proveri da sve radi na produkciji

## ✅ GOTOVO!

Kada sve ovo zelenije checkmark-ove, sistem je spreman! 🚀

---

**Važne Datoteke:**
- `QUICK_MIGRATION.sql` - Brza SQL migracija
- `MY_LIBRARY_IMPLEMENTATION.md` - Detaljna dokumentacija (English)
- `CITAJ_ME_PRVO.md` - Brzi pregled (Srpski)
- Ovaj fajl - Deployment checklist
