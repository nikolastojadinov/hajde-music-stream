// backend/src/jobs/runBatch1.ts
// FULL REWRITE — OLAK / MPREb PLAYLISTS ONLY (NO CHANNEL LOGIC)

import { DateTime } from 'luxon';
import path from 'path';
import { promises as fs } from 'fs';
import supabase from '../services/supabaseClient';
import env from '../environments';
import { RefreshJobRow } from '../types/jobs';
import { PlaylistIngestTarget } from '../services/postBatchPlaylistTrackIngest';

const TIMEZONE = 'Europe/Budapest';
const JOB_TABLE = 'refresh_jobs';
const PLAYLIST_TABLE = 'playlists';
const BATCH_DIR = path.resolve(__dirname, '../../tmp/refresh_batches');

const OLAK_PREFIX = 'OLAK5uy_';
const MPRE_PREFIX = 'MPREb';
const MIX_PREFIX = 'RD';

type BatchFileEntry = {
  playlistId?: string;
};

type PlaylistRow = {
  id: string;
  external_id: string;
};

type BatchResult = {
  playlistCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  errors: Array<{ playlistId: string; message: string }>;
  playlistTargets: PlaylistIngestTarget[];
};

function isValidAlbumPlaylistId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.startsWith(OLAK_PREFIX) || value.startsWith(MPRE_PREFIX);
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
  const batchFilePath = path.join(
    BATCH_DIR,
    `batch_${job.day_key}_slot_${job.slot_index}.json`,
  );

  const raw = await fs.readFile(batchFilePath, 'utf-8');
  const parsed = JSON.parse(raw) as BatchFileEntry[];

  const playlistIds: string[] = parsed
    .map(e => e.playlistId)
    .filter(isValidAlbumPlaylistId);

  if (playlistIds.length === 0) {
    throw new Error('No valid OLAK / MPREb playlistIds found in batch file');
  }

  const { data: playlists, error } = await supabase!
    .from(PLAYLIST_TABLE)
    .select('id, external_id')
    .in('external_id', playlistIds);

  if (error) {
    throw new Error(`Failed to load playlists: ${error.message}`);
  }

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
      result.skippedCount += 1;
      continue;
    }

    result.playlistTargets.push({
      playlist_id: playlist.id,
      external_playlist_id: playlist.external_id,
    });

    result.successCount += 1;
  }

  return result;
}
