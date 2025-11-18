# Likes System Implementation - Hajde Music Stream

## 📋 Overview
Implementiran kompletan sistem za označavanje omiljenih plejlista i pesama sa integracijom Pi login sistema.

## 🗄️ Database Schema

### Likes Table
```sql
CREATE TABLE IF NOT EXISTS likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
  track_id uuid REFERENCES tracks(id) ON DELETE CASCADE,
  type text CHECK (type IN ('playlist', 'track')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, playlist_id, track_id)
);
```

### Playlists Table Update
```sql
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS owner_id text;
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner_id);
```

## 🎯 Features

### 1. My Playlists
- Prikazuje SAMO plejliste kreirane od strane ulogovanog korisnika
- Query: `playlists.eq("owner_id", user.uid)`
- Sortiranje: najnovije prvo

### 2. Liked Playlists
- Prikazuje SAMO plejliste koje je korisnik označio kao omiljene
- Query kroz likes tabelu sa JOIN-om
- Real-time refresh nakon like/unlike akcije

### 3. Liked Songs
- Prikazuje SAMO pesme koje je korisnik označio kao omiljene
- Query kroz likes tabelu sa JOIN-om
- TrackCard komponenta sa like dugmetom

### 4. Like/Unlike Functionality
- **Playlists**: Heart icon na svakoj PlaylistCard + u Playlist stranici
- **Tracks**: Heart icon na svakoj TrackCard
- Animacije: Outline → Filled (when liked)
- Colors: muted-foreground → primary (when liked)

## 🧩 Components

### useLikes Hook
**Location**: `src/hooks/useLikes.tsx`

**Exports**:
- `likedPlaylists: LikedPlaylist[]` - Lista omiljenih plejlista
- `likedTracks: LikedTrack[]` - Lista omiljenih pesama
- `loading: boolean` - Loading state
- `togglePlaylistLike(id)` - Toggle like za plejlistu
- `toggleTrackLike(id)` - Toggle like za pesmu
- `isPlaylistLiked(id)` - Check da li je plejlista liked
- `isTrackLiked(id)` - Check da li je pesma liked
- `loadLikedPlaylists()` - Manual refresh
- `loadLikedTracks()` - Manual refresh

**Key Features**:
- Koristi `user.uid` iz Pi login sistema
- Optimistic UI updates
- Automatic refresh after like/unlike
- Local state caching sa Set<string> za brze provere

### Library Page
**Location**: `src/pages/Library.tsx`

**Tabs**:
1. **My Playlists** - `eq("owner_id", user.uid)`
2. **Liked Playlists** - From `useLikes().likedPlaylists`
3. **Liked Songs** - From `useLikes().likedTracks`

**Empty States**:
- Ikonica + poruka kada nema sadržaja
- Call-to-action tekstovi

### PlaylistCard
**Location**: `src/components/PlaylistCard.tsx`

**Features**:
- Like dugme u gornjem desnom uglu
- Pojavljuje se na hover
- Ne trigger-uje navigaciju kada se klikne
- Koristi `useLikes().togglePlaylistLike()`

### TrackCard
**Location**: `src/components/TrackCard.tsx`

**Features**:
- Like dugme desno od trajanja pesme
- Uvek vidljivo (ne samo na hover)
- Koristi `useLikes().toggleTrackLike()`

### Playlist Page
**Location**: `src/pages/Playlist.tsx`

**Features**:
- Like dugme pored "Play All" dugmeta
- Veće dugme (w-12 h-12) za bolju vidljivost
- Sinhrono sa Library → Liked Playlists

## 🌍 Translations

Dodati keys u `LanguageContext.tsx`:
- `my_playlists`
- `liked_playlists`
- `liked_songs`
- `no_playlists_created`
- `create_first_playlist`
- `no_liked_playlists`
- `like_playlists_to_see_here`
- `no_liked_songs`
- `like_songs_to_see_here`
- `loading`

Implementirano za 26 jezika.

## 🔐 Authentication Integration

- Koristi Pi login sistem
- User identifier: `user.uid` (NE `user.id`)
- Automatsko čišćenje state-a kada korisnik nije ulogovan
- Prevents like actions ako user nije ulogovan

## 🚀 Usage Example

```tsx
import { useLikes } from '@/hooks/useLikes';

function MyComponent() {
  const { 
    likedPlaylists, 
    togglePlaylistLike, 
    isPlaylistLiked 
  } = useLikes();

  const handleLike = (playlistId: string) => {
    togglePlaylistLike(playlistId);
  };

  return (
    <div>
      {likedPlaylists.map(playlist => (
        <div key={playlist.id}>
          <h3>{playlist.title}</h3>
          <button onClick={() => handleLike(playlist.id)}>
            {isPlaylistLiked(playlist.id) ? '❤️' : '🤍'}
          </button>
        </div>
      ))}
    </div>
  );
}
```

## 📝 Notes

- Likes tabela koristi `user_id` tipa `text` (za Pi UIDs)
- Playlists i Tracks koriste UUID
- Indexes kreiran za bolje performanse
- ON DELETE CASCADE za automatsko brisanje likes kada se playlist/track obriše
- UNIQUE constraint sprečava duplikate

## ✅ Testing Checklist

1. ✅ Login sa Pi računom
2. ✅ Kreiranje nove plejliste (pojavljuje se u "My Playlists")
3. ✅ Like plejliste (pojavljuje se u "Liked Playlists")
4. ✅ Unlike plejliste (nestaje iz "Liked Playlists")
5. ✅ Like pesme (pojavljuje se u "Liked Songs")
6. ✅ Unlike pesme (nestaje iz "Liked Songs")
7. ✅ Like dugme na PlaylistCard
8. ✅ Like dugme na Playlist stranici
9. ✅ Like dugme na TrackCard
10. ✅ Empty states za sve tabove

## 🎨 UI/UX Details

**Like Button Styling**:
- Outline heart kada nije liked: `text-muted-foreground`
- Filled heart kada je liked: `fill-primary text-primary`
- Hover effects: `hover:scale-110 transition-all`
- PlaylistCard: opacity-0 → opacity-100 na hover
- TrackCard: uvek vidljivo

**Animations**:
- Smooth transitions na like/unlike
- Loading states tokom API calls
- Optimistic UI updates (instant feedback)

---

**Commit**: 22682ea  
**Date**: 2025-11-18  
**Author**: GitHub Copilot (Claude Sonnet 4.5)
