import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CONSENT_COOKIES, fetchInnertubeConfig } = require('./backend/src/services/youtubeInnertubeConfig.ts');

type LiteConfig = {
  apiKey: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
  apiBase: string;
};

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchConfigFallback(): Promise<LiteConfig> {
  const url = 'https://music.youtube.com/?hl=en&gl=US';
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': YTM_USER_AGENT,
      Cookie: CONSENT_COOKIES,
    },
  });
  if (!res.ok) throw new Error(`fallback_html_failed:${res.status}`);
  const html = await res.text();
  const ytcfgMatch = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
  const ytcfgJson = ytcfgMatch?.[1] ? safeParseJson<Record<string, any>>(ytcfgMatch[1]) : null;
  const grab = (key: string) => html.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\]+)"`))?.[1];
  const apiKey = ytcfgJson?.INNERTUBE_API_KEY || grab('INNERTUBE_API_KEY');
  const clientName = (ytcfgJson?.INNERTUBE_CONTEXT as any)?.client?.clientName || grab('INNERTUBE_CLIENT_NAME');
  const clientVersion = (ytcfgJson?.INNERTUBE_CONTEXT as any)?.client?.clientVersion || grab('INNERTUBE_CLIENT_VERSION');
  const visitorData = (ytcfgJson?.INNERTUBE_CONTEXT as any)?.client?.visitorData || grab('VISITOR_DATA');
  if (!apiKey || !clientName || !clientVersion || !visitorData) {
    throw new Error('fallback_missing_fields');
  }
  return { apiKey, clientName, clientVersion, visitorData, apiBase: 'https://music.youtube.com/youtubei/v1' };
}

async function fetchConfigForScript(): Promise<LiteConfig> {
  try {
    return await fetchInnertubeConfig();
  } catch (e) {
    console.warn('fetchInnertubeConfig failed, falling back', e);
    return fetchConfigFallback();
  }
}

const YTM_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function buildContext(config: any) {
  return {
    client: {
      clientName: config.clientName,
      clientVersion: config.clientVersion,
      hl: 'en',
      gl: 'US',
      platform: 'DESKTOP',
      visitorData: config.visitorData,
      userAgent: YTM_USER_AGENT,
      utcOffsetMinutes: 0,
    },
    user: { enableSafetyMode: false },
    request: { internalExperimentFlags: [], sessionIndex: 0 },
  };
}

async function callBrowse(browseId: string) {
  const config = await fetchConfigForScript();
  const url = `${config.apiBase.endsWith('/') ? config.apiBase : config.apiBase + '/'}browse?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;
  const payload = { context: buildContext(config), browseId };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': YTM_USER_AGENT,
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com',
      Cookie: CONSENT_COOKIES,
      'X-Goog-Visitor-Id': config.visitorData,
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': config.clientVersion,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`browse failed ${res.status}`);
  return res.json();
}

function looksLikeVideoId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.trim());
}

function walk(node: any, hits: any[]) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, hits);
    return;
  }
  if (looksLikeVideoId((node as any).videoId)) {
    hits.push({
      videoId: (node as any).videoId,
      title: node?.title?.runs?.map((r: any) => r.text).join('') || node?.title?.simpleText || '',
      renderer: Object.keys(node).find((k) => k.endsWith('Renderer')),
    });
  }
  for (const v of Object.values(node)) walk(v, hits);
}

async function main() {
  const ids = process.argv.slice(2);
  for (const id of ids) {
    try {
      const json = await callBrowse(id);
      await import('node:fs').then(({ writeFileSync }) =>
        writeFileSync(`/workspaces/hajde-music-stream/browse_${id}.json`, JSON.stringify(json, null, 2)),
      );
      const hits: any[] = [];
      walk(json, hits);
      const unique = new Map<string, any>();
      for (const h of hits) {
        if (!unique.has(h.videoId)) unique.set(h.videoId, h);
      }
      console.log('browseId', id, 'videos', unique.size);
      console.log(Array.from(unique.values()).slice(0, 10));
      console.log('root keys', Object.keys(json));
    } catch (e: any) {
      console.error('browse failed', id, e?.message || e);
    }
  }
}

main().catch((e) => {
  console.error('error', e?.stack || e);
  process.exit(1);
});
