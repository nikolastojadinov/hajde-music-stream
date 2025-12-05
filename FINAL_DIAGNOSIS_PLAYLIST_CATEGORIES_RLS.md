## 🎯 KONAČNA DIJAGNOZA PROBLEMA - Playlist Edit & Cover Upload

### ❌ POGREŠNA DIJAGNOZA (GitHub Copilot - prva analiza):
Problem je u `categories` tabeli - RLS blokira čitanje kategorija.

**Status:** ❌ **NETAČNO** - GET /api/categories radi perfektno (304 Not Modified).

---

### ✅ TAČNA DIJAGNOZA (ChatGPT 5.1 + revizija):

## 🔍 PRAVI PROBLEM: `playlist_categories` RLS INSERT Policy

### **Šta se dešava:**

1. **Upload cover slike** → ✅ **RADI NORMALNO**
   - Slika se uspešno upload-uje (1024×1024, 976 KB)
   - Nema problema sa Supabase Storage
   - Slika se prikazuje u interfejsu

2. **Klik na "Save changes"** → ❌ **OVDE PUCA**
   - Frontend šalje **KOMPLETAN payload** uključujući kategorije
   - Kategorije se šalju **čak i kad nisu menjane**
   - Backend vidi da se kategorije "promenile" (jer frontend šalje novi array)

3. **Backend logika** (`backend/src/routes/studioPlaylists.ts:456-468`):
   ```typescript
   // Provera da li su kategorije promenjene
   if (categoriesChanged) {
     // DELETE starih kategorija
     await supabase.from('playlist_categories').delete().eq('playlist_id', playlistId);
     
     // INSERT novih kategorija (OVDE PUCA!)
     const rows = categoryIds.map(...);
     await supabase.from('playlist_categories').insert(rows);  // ❌ RLS ERROR
   }
   ```

4. **RLS blokira INSERT**:
   ```
   new row violates row-level security policy
   ```

---

## 🧬 DUBLJA ANALIZA

### **Zašto se problem pojavljuje tek nakon upload-a slike?**

Upload slike trigguje **re-render forme** → forma ponovo šalje sve podatke → backend misli da su kategorije promenjene → pokušava INSERT → RLS blokira.

### **Zašto RLS blokira?**

**PROBLEM:** Tabela `playlist_categories` NEMA definisanu RLS policy za INSERT operaciju!

Provera migracija pokazuje:
- ✅ `playlists` tabela ima RLS policies
- ✅ `tracks` tabela ima RLS policies  
- ✅ `playlist_tracks` tabela ima RLS policies
- ❌ **`playlist_categories` tabela NEMA definisanu RLS policy u migracijama**

Ovo znači da je tabela verovatno **manuelno kreirana** ili je policy **nedostaje**.

---

## 🔧 DVA MOGUĆA FIX-a

### **FIX 1: Backend - Dodati RLS Policy za `playlist_categories`** (PREPORUČENO)

Kreirati migracioni fajl koji dodaje nedostajuće RLS policies:

```sql
-- Enable RLS if not already enabled
ALTER TABLE public.playlist_categories ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can manage playlist_categories"
ON public.playlist_categories
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow users to manage categories for their own playlists
CREATE POLICY "Users can manage their playlist categories"
ON public.playlist_categories
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE playlists.id = playlist_categories.playlist_id
    AND playlists.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE playlists.id = playlist_categories.playlist_id
    AND playlists.owner_id = auth.uid()
  )
);

-- Public read access
CREATE POLICY "Anyone can view playlist_categories"
ON public.playlist_categories
FOR SELECT
USING (true);
```

---

### **FIX 2: Frontend - Ne slati kategorije ako nisu menjane** (DODATNA OPTIMIZACIJA)

U `src/components/playlist/PlaylistForm.tsx`, pratiti da li su kategorije **stvarno** promenjene:

```typescript
// Dodati state za tracking izmena
const [categoriesModified, setCategoriesModified] = useState(false);

// Pri submit-u
const handleSave = async () => {
  const payload = {
    title,
    description,
    // ... ostali podaci
    
    // SAMO ako su kategorije menjane
    ...(categoriesModified && {
      category_groups: {
        all: selectedCategories
      }
    })
  };
  
  // ... submit payload
};
```

---

## 📋 ZAKLJUČAK I AKCIONI PLAN

### **Root Cause:**
Tabela `playlist_categories` **nema RLS policy za INSERT** operaciju.

### **Kada se manifestuje:**
Prilikom bilo koje izmene playlist-e koja trigguje re-save kategorija (npr. upload cover slike).

### **Prioritet fix-eva:**

1. **HITNO:** Dodati RLS policies za `playlist_categories` (FIX 1) - **OVO REŠAVA PROBLEM**
2. **OPTIMIZACIJA:** Frontend ne šalje kategorije ako nisu menjane (FIX 2) - smanjuje nepotrebne operacije

### **Kako testirati:**

```bash
# 1. Kreirati migraciju
# 2. Primeniti na Supabase
# 3. Testirati edit playlist-e sa promenom samo cover slike
# 4. Greška "new row violates row-level security policy" treba da nestane
```

---

## 🙏 ZAHVALNOST

**GitHub Copilot** - Identifikacija logova i analiza backend koda  
**ChatGPT 5.1** - Tačna dijagnoza i identifikacija pravog root cause-a

Kombinacija obe analize dao je kompletan uvid u problem.
