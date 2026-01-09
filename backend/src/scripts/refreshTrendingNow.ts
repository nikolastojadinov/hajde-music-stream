import { refreshTrendingNowSnapshot } from '../services/trendingNow';

async function main() {
  try {
    const { snapshot } = await refreshTrendingNowSnapshot('manual trigger');
    console.log('[TrendingNow] Snapshot generated', {
      items: snapshot.items.length,
      generated_at: snapshot.generated_at,
    });
  } catch (err: any) {
    console.error('[TrendingNow] Snapshot generation failed', err?.message || err);
    process.exitCode = 1;
  } finally {
    setTimeout(() => process.exit(), 50);
  }
}

void main();
