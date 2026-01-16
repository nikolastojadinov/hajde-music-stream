type IngestSource = 'search' | 'suggest' | 'direct';

type IngestPhase = 'BOOTSTRAP' | 'ALBUMS' | 'PLAYLISTS' | 'FINALIZE';

export type FullArtistIngestParams = {
  artistKey: string;
  browseId: string;
  source: IngestSource;
};

export type IngestCounters = {
  albumsFetched: number;
  tracksFetched: number;
  playlistsFetched: number;
};

export type IngestError = {
  phase: IngestPhase;
  message: string;
};

export type IngestContext = {
  artistKey: string;
  browseId: string;
  startedAt: string;
  currentPhase: IngestPhase;
  counters: IngestCounters;
  errors: IngestError[];
  source: IngestSource;
};

async function runBootstrapPhase(ctx: IngestContext): Promise<IngestContext> {
  return { ...ctx, currentPhase: 'BOOTSTRAP' };
}

async function runAlbumsPhase(ctx: IngestContext): Promise<IngestContext> {
  return { ...ctx, currentPhase: 'ALBUMS' };
}

async function runPlaylistsPhase(ctx: IngestContext): Promise<IngestContext> {
  return { ...ctx, currentPhase: 'PLAYLISTS' };
}

async function runFinalizePhase(ctx: IngestContext): Promise<IngestContext> {
  return { ...ctx, currentPhase: 'FINALIZE' };
}

function logPhase(phase: IngestPhase, artistKey: string): void {
  console.info(`[full-artist-ingest] phase=${phase} artist_key=${artistKey}`);
}

export async function runFullArtistIngest(params: FullArtistIngestParams): Promise<IngestContext> {
  const artistKey = (params.artistKey || '').trim();
  const browseId = (params.browseId || '').trim();

  if (!artistKey || !browseId) {
    throw new Error('[full-artist-ingest] missing artistKey or browseId');
  }

  const startedAt = new Date().toISOString();
  const base: IngestContext = {
    artistKey,
    browseId,
    startedAt,
    currentPhase: 'BOOTSTRAP',
    counters: { albumsFetched: 0, tracksFetched: 0, playlistsFetched: 0 },
    errors: [],
    source: params.source,
  };

  console.info(`[full-artist-ingest] start artist_key=${artistKey} browse_id=${browseId} source=${params.source}`);

  let ctx = base;

  const phases: Array<{ name: IngestPhase; handler: (c: IngestContext) => Promise<IngestContext> }> = [
    { name: 'BOOTSTRAP', handler: runBootstrapPhase },
    { name: 'ALBUMS', handler: runAlbumsPhase },
    { name: 'PLAYLISTS', handler: runPlaylistsPhase },
    { name: 'FINALIZE', handler: runFinalizePhase },
  ];

  for (const phase of phases) {
    try {
      logPhase(phase.name, artistKey);
      ctx = await phase.handler(ctx);
      ctx = { ...ctx, currentPhase: phase.name };
    } catch (err: any) {
      const message = err?.message || String(err);
      ctx = {
        ...ctx,
        currentPhase: phase.name,
        errors: [...ctx.errors, { phase: phase.name, message }],
      };
    }
  }

  console.info(`[full-artist-ingest] finish artist_key=${artistKey} errors=${ctx.errors.length}`);

  return ctx;
}
