export type IngestEntry = {
  promise: Promise<unknown> | null;
  startedAt: number | null;
  lastCompletedAt: number | null;
  lastFailedAt: number | null;
};

export function getIngestMap(): Map<string, IngestEntry> {
  const g = globalThis as any;
  if (!g.__ingestMap) g.__ingestMap = new Map<string, IngestEntry>();
  return g.__ingestMap as Map<string, IngestEntry>;
}
