export const CONSENT_COOKIES =
  "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

export const INNERTUBE_API_BASE = "https://music.youtube.com/youtubei/v1";

export interface InnertubeConfig {
  apiKey: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
  apiBase: string;
}

type FetchOptions = { hl?: string; gl?: string };

type ExtractedFields = {
  apiKey?: string;
  clientName?: string;
  clientVersion?: string;
  visitorData?: string;
};

const DEFAULT_HL = "en";
const DEFAULT_GL = "US";
const MAX_REDIRECTS = 5;

function assertString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing_${field}`);
  }
  return value;
}

function parseJson<T>(text: string, context: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${context}_json_parse_failed:${message}`);
  }
}

function extractViaYtcfg(html: string): ExtractedFields {
  const m = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
  if (!m || !m[1]) return {};
  const cfg = parseJson<Record<string, unknown>>(m[1], "ytcfg_set");
  const ctx = cfg.INNERTUBE_CONTEXT as Record<string, unknown> | undefined;
  const client = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>).client : undefined;
  return {
    apiKey: cfg.INNERTUBE_API_KEY as string | undefined,
    clientName:
      client && typeof client === "object"
        ? ((client as Record<string, unknown>).clientName as string | undefined)
        : undefined,
    clientVersion:
      client && typeof client === "object"
        ? ((client as Record<string, unknown>).clientVersion as string | undefined)
        : undefined,
    visitorData:
      client && typeof client === "object"
        ? ((client as Record<string, unknown>).visitorData as string | undefined)
        : undefined,
  };
}

function extractViaRegex(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const grab = (key: string) => {
    const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return m ? m[1] : undefined;
  };
  fields.apiKey = grab("INNERTUBE_API_KEY");
  fields.clientName = grab("INNERTUBE_CLIENT_NAME");
  fields.clientVersion = grab("INNERTUBE_CLIENT_VERSION");
  fields.visitorData = grab("VISITOR_DATA");
  return fields;
}

function extractViaFallback(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const blocks = html.match(/\{\s*"INNERTUBE_API_KEY"[\s\S]*?\}/g) || [];
  for (const block of blocks) {
    try {
      const obj = parseJson<Record<string, unknown>>(block, "fallback_block");
      if (!fields.apiKey && typeof obj.INNERTUBE_API_KEY === "string") fields.apiKey = obj.INNERTUBE_API_KEY;
      const ctx = obj.INNERTUBE_CONTEXT as Record<string, unknown> | undefined;
      const client = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>).client : undefined;
      if (client && typeof client === "object") {
        if (!fields.clientName && typeof (client as Record<string, unknown>).clientName === "string") {
          fields.clientName = (client as Record<string, unknown>).clientName as string;
        }
        if (!fields.clientVersion && typeof (client as Record<string, unknown>).clientVersion === "string") {
          fields.clientVersion = (client as Record<string, unknown>).clientVersion as string;
        }
        if (!fields.visitorData && typeof (client as Record<string, unknown>).visitorData === "string") {
          fields.visitorData = (client as Record<string, unknown>).visitorData as string;
        }
      }
      if (fields.apiKey && fields.clientName && fields.clientVersion && fields.visitorData) break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log("[InnertubeConfig][fallback_block_parse_error]", message);
    }
  }
  return fields;
}

function mergeFields(...sets: ExtractedFields[]): ExtractedFields {
  return sets.reduce<ExtractedFields>(
    (acc, cur) => ({
      apiKey: acc.apiKey || cur.apiKey,
      clientName: acc.clientName || cur.clientName,
      clientVersion: acc.clientVersion || cur.clientVersion,
      visitorData: acc.visitorData || cur.visitorData,
    }),
    {},
  );
}

async function fetchWithRedirects(url: string, headers: Record<string, string>): Promise<Response> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const res = await fetch(current, { method: "GET", redirect: "manual", headers });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error("redirect_without_location");
      }
      if (i === MAX_REDIRECTS) {
        throw new Error("redirect_loop");
      }
      current = location.startsWith("http") ? location : new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("redirect_loop");
}

function buildHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.100 Safari/537.36",
    Cookie: CONSENT_COOKIES,
  };
}

export async function fetchInnertubeConfig(opts?: FetchOptions): Promise<InnertubeConfig> {
  const hl = opts?.hl || DEFAULT_HL;
  const gl = opts?.gl || DEFAULT_GL;
  const urls = [
    `https://music.youtube.com/?hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}`,
    `https://www.youtube.com/?hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}`,
  ];

  const headers = buildHeaders();
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const res = await fetchWithRedirects(url, headers);
      if (res.status !== 200) {
        throw new Error(`non_200:${res.status}`);
      }

      const html = await res.text();
      if (!html) {
        throw new Error("empty_html");
      }
      if (html.includes("consent.youtube.com")) {
        throw new Error("consent_block");
      }

      const fields = mergeFields(extractViaYtcfg(html), extractViaRegex(html), extractViaFallback(html));
      const apiKey = assertString("INNERTUBE_API_KEY", fields.apiKey);
      const clientName = assertString("INNERTUBE_CLIENT_NAME", fields.clientName);
      const clientVersion = assertString("INNERTUBE_CLIENT_VERSION", fields.clientVersion);
      const visitorData = assertString("VISITOR_DATA", fields.visitorData);

      return { apiKey, clientName, clientVersion, visitorData, apiBase: INNERTUBE_API_BASE };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${url}:${message}`);
    }
  }

  throw new Error(`all_attempts_failed:${errors.join("|")}`);
}
