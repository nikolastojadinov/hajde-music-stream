// Catalog of 27,662 playlists from the external database
export interface PlaylistCatalogEntry {
  id: string;
  title: string;
  track_count: number;
}

// This will be populated with the CSV data
export const playlistCatalog: PlaylistCatalogEntry[] = [
  { id: '0ec202fd-c6e2-4a76-bf16-68167fcabb36', title: "'00s Dance", track_count: 50 },
  { id: '5227bd90-0a05-41c8-8328-f43459c185ee', title: "'00s Grime", track_count: 50 },
  { id: '29008dc9-5cb6-479f-9d67-de12fe8b0b4c', title: "'10s Grime", track_count: 50 },
  { id: 'ea48bca9-168c-412b-98da-b4324c7f5d1c', title: "'80s Metal", track_count: 50 },
  { id: '0ac40f3d-7ca6-4a17-9fb5-b9f3d7b7843b', title: "'90s Dance", track_count: 50 },
  { id: 'f8714c7c-2776-410d-805a-c0c502fd00c3', title: "'90s Indie + Alternative", track_count: 50 },
  // Full catalog will be loaded dynamically
];
