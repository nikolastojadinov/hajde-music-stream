import { getSupabaseAdmin } from '../services/supabaseClient';

type TotalsBucket = {
  processed: number;
  inserted: number;
  updated: number;
  skipped?: number;
};

type AlbumTrackSummary = {
  track_id: string;
  title: string;
  duration_sec: number | null;
};

type AlbumSummary = {
  album_id: string;
  album_title: string;
  track_count: number;
  tracks: AlbumTrackSummary[];
};

type ArtistSummary = {
  artist_key: string;
  artist_name: string;
  total_albums: number;
  total_tracks: number;
  albums: AlbumSummary[];
};

export type NightlyIngestReport = {
  type: 'nightly_ingest_report';
  run_date: string;
  ingest_start_time: string;
  ingest_end_time: string;
  total_duration_ms: number;
  totals: {
    playlists: TotalsBucket;
    albums: TotalsBucket;
    tracks: TotalsBucket;
    artists: TotalsBucket;
  };
  artists: ArtistSummary[];
  warnings: string[];
  environment: 'production';
  source: 'nightly_ingest_cron';
};

function nowIso(): string {
  return new Date().toISOString();
}

function runDate(iso: string): string {
  return iso.slice(0, 10);
}

function cloneTotals(bucket: TotalsBucket): TotalsBucket {
  return {
    processed: bucket.processed,
    inserted: bucket.inserted,
    updated: bucket.updated,
    skipped: bucket.skipped ?? 0,
  };
}

export class NightlyIngestReporter {
  private ingestStart: string;
  private ingestEnd: string | null = null;
  private warnings: string[] = [];
  private artists: Map<string, ArtistSummary> = new Map();
  private totals = {
    playlists: { processed: 0, inserted: 0, updated: 0, skipped: 0 },
    albums: { processed: 0, inserted: 0, updated: 0 },
    tracks: { processed: 0, inserted: 0, updated: 0, skipped: 0 },
    artists: { processed: 0, inserted: 0, updated: 0 },
  };

  constructor(startTime?: string) {
    this.ingestStart = startTime || nowIso();
  }

  markEnd(): void {
    if (!this.ingestEnd) this.ingestEnd = nowIso();
  }

  addWarning(message: string): void {
    const trimmed = (message || '').trim();
    if (!trimmed) return;
    if (this.warnings.includes(trimmed)) return;
    this.warnings.push(trimmed);
  }

  artistProcessed(params: { artistKey: string; artistName: string; updated?: boolean; inserted?: boolean }): void {
    const key = params.artistKey.trim();
    const name = params.artistName.trim() || params.artistKey;
    if (!key) return;
    const existing = this.artists.get(key);
    if (!existing) {
      this.artists.set(key, {
        artist_key: key,
        artist_name: name,
        total_albums: 0,
        total_tracks: 0,
        albums: [],
      });
    }
    this.totals.artists.processed += 1;
    if (params.inserted) this.totals.artists.inserted += 1;
    if (params.updated) this.totals.artists.updated += 1;
  }

  playlistProcessed(params: { inserted?: boolean; updated?: boolean; skipped?: boolean }): void {
    this.totals.playlists.processed += 1;
    if (params.inserted) this.totals.playlists.inserted += 1;
    if (params.updated) this.totals.playlists.updated += 1;
    if (params.skipped) this.totals.playlists.skipped = (this.totals.playlists.skipped ?? 0) + 1;
  }

  albumProcessed(params: { artistKey?: string; albumId: string; albumTitle: string; tracks: AlbumTrackSummary[]; inserted?: boolean; updated?: boolean }): void {
    const artistKey = (params.artistKey || '').trim();
    const albumTrackCount = params.tracks.length;
    this.totals.albums.processed += 1;
    if (params.inserted) this.totals.albums.inserted += 1;
    if (params.updated) this.totals.albums.updated += 1;
    this.totals.tracks.processed += albumTrackCount;
    this.totals.tracks.inserted += albumTrackCount;
    this.totals.tracks.updated += albumTrackCount;

    if (!artistKey) return;
    const artist = this.ensureArtist(artistKey, '');
    artist.total_albums += 1;
    artist.total_tracks += albumTrackCount;
    artist.albums.push({
      album_id: params.albumId,
      album_title: params.albumTitle,
      track_count: albumTrackCount,
      tracks: params.tracks,
    });
  }

  trackSkipped(count: number): void {
    if (count <= 0) return;
    this.totals.tracks.skipped = (this.totals.tracks.skipped ?? 0) + count;
  }

  playlistTracksProcessed(count: number): void {
    if (count <= 0) return;
    this.totals.tracks.processed += count;
    this.totals.tracks.inserted += count;
    this.totals.tracks.updated += count;
  }

  private ensureArtist(artistKey: string, artistName: string): ArtistSummary {
    const key = artistKey.trim();
    const name = artistName.trim() || artistKey;
    const existing = this.artists.get(key);
    if (existing) return existing;
    const created: ArtistSummary = {
      artist_key: key,
      artist_name: name,
      total_albums: 0,
      total_tracks: 0,
      albums: [],
    };
    this.artists.set(key, created);
    return created;
  }

  buildReport(): NightlyIngestReport {
    const end = this.ingestEnd || nowIso();
    const duration = new Date(end).getTime() - new Date(this.ingestStart).getTime();

    return {
      type: 'nightly_ingest_report',
      run_date: runDate(this.ingestStart),
      ingest_start_time: this.ingestStart,
      ingest_end_time: end,
      total_duration_ms: duration < 0 ? 0 : duration,
      totals: {
        playlists: cloneTotals(this.totals.playlists),
        albums: cloneTotals(this.totals.albums),
        tracks: cloneTotals(this.totals.tracks),
        artists: cloneTotals(this.totals.artists),
      },
      artists: Array.from(this.artists.values()),
      warnings: [...this.warnings],
      environment: 'production',
      source: 'nightly_ingest_cron',
    };
  }

  async persist(): Promise<void> {
    try {
      const supabase = getSupabaseAdmin();
      const report = this.buildReport();
      const row = {
        payload_type: 'nightly_ingest_report',
        payload_json: report,
        created_at: nowIso(),
      } as Record<string, any>;

      const { error } = await supabase.from('innertube_raw_payloads').insert(row);
      if (error) {
        console.error('[nightly-ingest-report] insert failed', { message: error.message });
      }
    } catch (err: any) {
      console.error('[nightly-ingest-report] persist failed', { message: err?.message || String(err) });
    }
  }
}

export function createNightlyIngestReporter(startTime?: string): NightlyIngestReporter {
  return new NightlyIngestReporter(startTime);
}
