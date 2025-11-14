# 🔧 KAKO AŽURIRATI PRODUKCIJSKU BAZU

## Opcija 1: Automatski (PREPORUČENO) ✅

1. Idi na: https://supabase.com/dashboard/project/tbberppabanjvshwythc/sql/new

2. Kopiraj i zalepi cijeli sadržaj iz `PRODUCTION_MIGRATION.sql`

3. Klikni "Run" dugme

4. Gotovo! Baza će biti ažurirana sa `image_url` kolonama

## Opcija 2: Supabase CLI (ako imaš instaliran)

```bash
supabase db push --project-ref tbberppabanjvshwythc
```

## Šta će se desiti:

- ✅ `playlists` tabela će dobiti `image_url` kolonu
- ✅ `tracks` tabela već ima `image_url` kolonu
- ✅ Sve slike će biti postavljene (YouTube thumbnails za tracks, placeholder za playlists)
- ✅ Aplikacija će početi da prikazuje slike umesto placeholder-a

## Nakon migracije:

Pokreni sledeći command da vratim funkcionalnost slika u kod:

```bash
# Ja ću to uraditi automatski posle što potvrdis da si pokrenuo SQL
```

## Napomena:

NE MORAŠ NIŠTA RUČNO - samo idi na link gore i klikni Run!
