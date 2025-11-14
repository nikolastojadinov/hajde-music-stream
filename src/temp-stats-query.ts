import { externalSupabase } from './lib/externalSupabase';

(async () => {
  // 1. Total playlists
  const { count: totalPlaylists } = await externalSupabase
    .from('playlists')
    .select('*', { count: 'exact', head: true });

  // 2. Playlists with tracks
  const { data: playlistTracks } = await externalSupabase
    .from('playlist_tracks')
    .select('playlist_id');
  
  const uniquePlaylistIds = [...new Set(playlistTracks?.map(pt => pt.playlist_id) || [])];
  const playlistsWithTracks = uniquePlaylistIds.length;

  // 3. Total tracks
  const { count: totalTracks } = await externalSupabase
    .from('tracks')
    .select('*', { count: 'exact', head: true });

  console.log('===========================================');
  console.log('SQL REZULTATI IZ EKSTERNE BAZE:');
  console.log('===========================================');
  console.log('1. Ukupno playlisti:', totalPlaylists);
  console.log('2. Playlisti sa pesmama:', playlistsWithTracks);
  console.log('3. Prazne playliste:', (totalPlaylists || 0) - playlistsWithTracks);
  console.log('4. Ukupno pesama:', totalTracks);
  console.log('===========================================');
})();
