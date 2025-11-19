"use client";

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePi } from '@/contexts/PiContext';
import useLikes from '@/hooks/useLikes';

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<'songs' | 'playlists'>('songs');
  const { user } = usePi();
  const { likedTracks, likedPlaylists } = useLikes();

  if (!user?.uid) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Moja Biblioteka</h1>
        <div className="py-8 text-gray-500">Potrebna je prijava da bi se prikazala biblioteka.</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Moja Biblioteka</h1>

      <div className="flex gap-2 mb-6">
        <button
          className={`px-3 py-1.5 rounded ${activeTab === 'songs' ? 'bg-black text-white' : 'bg-gray-100'}`}
          onClick={() => setActiveTab('songs')}
        >
          Omiljene Pesme
        </button>
        <button
          className={`px-3 py-1.5 rounded ${activeTab === 'playlists' ? 'bg-black text-white' : 'bg-gray-100'}`}
          onClick={() => setActiveTab('playlists')}
        >
          Omiljene Plejliste
        </button>
      </div>

      {activeTab === 'songs' ? (
        <SongsList tracks={likedTracks} />
      ) : (
        <PlaylistsGrid playlists={likedPlaylists} />
      )}
    </div>
  );
}

function SongsList({ tracks }: { tracks: { id: string; title?: string; artist?: string | null; cover_url?: string | null; duration?: number | null }[] }) {
  if (!tracks || tracks.length === 0) {
    return <div className="py-8 text-gray-500">Nema omiljenih pesama.</div>;
  }
  return (
    <div className="space-y-2">
      {tracks.map((t) => (
        <div key={t.id} className="flex items-center gap-3 p-3 rounded-md hover:bg-gray-100">
          <div className="w-14 h-14 bg-gray-200 rounded overflow-hidden">
            {t.cover_url ? (
              <img src={t.cover_url} alt={t.title || ''} className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{t.title || 'Nepoznato'}</div>
            <div className="text-sm text-gray-500 truncate">{t.artist || 'Nepoznato'}</div>
          </div>
          <div className="text-sm text-gray-500">{t.duration ? formatDuration(t.duration) : ''}</div>
        </div>
      ))}
    </div>
  );
}

function PlaylistsGrid({ playlists }: { playlists: { id: string; title?: string; cover_url?: string | null; region?: string | null; category?: string | null }[] }) {
  if (!playlists || playlists.length === 0) {
    return <div className="py-8 text-gray-500">Nema omiljenih plejlista.</div>;
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {playlists.map((p) => (
        <Link key={p.id} to={`/playlist/${p.id}`} className="block">
          <div className="rounded-lg border border-gray-200 hover:shadow-sm overflow-hidden">
            <div className="aspect-square bg-gray-100">
              {p.cover_url ? (
                <img src={p.cover_url} alt={p.title || ''} className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="p-3">
              <div className="font-semibold truncate">{p.title || 'Nepoznato'}</div>
              <div className="text-xs text-gray-500 mt-1 truncate">
                {p.region || p.category || ''}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
