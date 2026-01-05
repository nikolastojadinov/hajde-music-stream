// backend/src/jobs/runBatch1.ts
// FULL REWRITE — OLAK / MPREb PLAYLISTS ONLY (NO CHANNEL LOGIC)

import { DateTime } from 'luxon';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import supabase from '../services/supabaseClient';
import env from '../environments';
import { RefreshJobRow } from '../types/jobs';
import { PlaylistIngestTarget } from '../services/postBatchPlaylistTrackIngest';
import { canonicalArtistName, normalizeArtistKey } from '../utils/artistKey';

const TIMEZONE = 'Europe/Budapest';
const JOB_TABLE = 'refresh_jobs';
const PLAYLIST_TABLE = 'playlists';
const TRACKS_TABLE = 'tracks';
const PLAYLIST_TRACKS_TABLE = 'playlist_tracks';

const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');

const OLAK_PREFIX = 'OLAK5uy_';
const MPRE_PREFIX = 'MPREb';
const MIX_PREFIX = 'RD';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_PAGE_SIZE = 50;
const PLAYLIST_TRACK_LIMIT = 500;

type BatchResult = {
  playlistCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  errors: Array<{ playlistId: string; message: string }>;
  playlistTargets: PlaylistIngestTarget[];
};

type PlaylistRow = {
  id: string;
  external_id: string;
  channel_id: string | null;
  channel_title: string | null;
  region: string | null;
  category: string | null;
  last_etag: string | null;
};

type YouTubePlaylistItem = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  position: number;
  videoOwnerChannelId?: string | null;
};

function isValidAlbumPlaylist(id: string): boolean {
  return id.startsWith(OLAK_PREFIX) || id.startsWith(MPRE_PREFIX);
}

function isMixPlaylist(id: string): boolean {
  return id.startsWith(MIX_PREFIX);
}

export async function executeRunJob(job: RefreshJobRow): Promise<void> {
  const scheduledLocal = DateTime.fromISO(job.scheduled_at, { zone: 'utc' }).setZone(TIMEZONE);
  console.log('[runBatch1] start', {
    jobId: job.id,
    slot: job.slot_index,
    scheduledAt: scheduledLocal.toISO(),
  });

  try {
    const result = await runBatch(job);
    await supabase!
      .from(JOB_TABLE)
      .update({ status: 'done', payload: result })
      .eq('id', job.id);

    console.log('[runBatch1] done', result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[runBatch1] failed', message);
    await supabase!
      .from(JOB_TABLE)
      .update({ status: 'error', payload: { error: message } })
      .eq('id', job.id);
  }
}

async function runBatch(job: RefreshJobRow): Promise<BatchResult> {
  const batchFile = path.join(BATCH_DIR, `batch_${job.day_key}_slot_${job.slot_index}.json`);
  const raw = await fs.readFile(batchFile, 'utf-8');
  const parsed = JSON.parse(raw) as Array<{ playlistId?: string }>;

  const playlistIds = parsed
    .map(e => e.playlistId)
    .filter((id): id is string => Boolean(id) && isValidAlbumPlaylist(id));

  if (playlistIds.length === 0) {
    throw new Error('No valid OLAK / MPREb playlistIds in batch file');
  }

  const { data: playlists } = await supabase!
    .from(PLAYLIST_TABLE)
    .select('id, external_id, channel_id, channel_title, region, category, last_etag')
    .in('external_id', playlistIds);

  const result: BatchResult = {
    playlistCount: playlists?.length ?? 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    errors: [],
    playlistTargets: [],
  };

  for (const playlist of playlists as PlaylistRow[]) {
    if (isMixPlaylist(playlist.external_id)) {
      result.skippedCount++;
      continue;
    }

    try {
      result.playlistTargets.push({
        playlist_id: playlist.id,
        external_playlist_id: playlist.external_id,
      });
      result.successCount++;
    } catch (err) {
      result.failureCount++;
      result.errors.push({
        playlistId: playlist.external_id,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
