export const CONSENT_COOKIES =
  "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

export interface InnertubeConfig {
  apiKey: string;
  apiUrl: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
}

function assertString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid ${field}`);
  }
  return value;
}

function parseYtcfg(html: string): Record<string, unknown> {
  const match = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
  if (!match || !match[1]) {
    throw new Error("ytcfg.set payload not found in HTML");
  }

  try {
    return JSON.parse(match[1]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ytcfg JSON: ${message}`);
  }
}

export async function fetchInnertubeConfig(): Promise<InnertubeConfig> {
  const response = await fetch("https://music.youtube.com/", {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.100 Safari/537.36",
      Cookie: CONSENT_COOKIES,
    },
  });

  const location = response.headers.get("location") || "";
  if (response.status === 302) {
    if (!location) {
      throw new Error("Redirect without Location header");
    }
    if (location.includes("consent.youtube.com")) {
      throw new Error(`Consent redirect encountered: ${location}`);
    }
    throw new Error(`Unexpected redirect to ${location}`);
  }

  if (response.status !== 200) {
    throw new Error(`Bootstrap request failed with status ${response.status}`);
  }

  const html = await response.text();
  if (!html) {
    throw new Error("Bootstrap response body is empty");
  }
  if (html.includes("consent.youtube.com")) {
    throw new Error("Consent interstitial detected in response body");
  }

  const cfg = parseYtcfg(html);

  const apiKey = assertString("INNERTUBE_API_KEY", (cfg as Record<string, unknown>).INNERTUBE_API_KEY);
  const apiUrl = assertString("INNERTUBE_API_URL", (cfg as Record<string, unknown>).INNERTUBE_API_URL);

  const context = (cfg as Record<string, unknown>).INNERTUBE_CONTEXT;
  if (!context || typeof context !== "object") {
    throw new Error("Missing INNERTUBE_CONTEXT");
  }

  const client = (context as Record<string, unknown>).client;
  if (!client || typeof client !== "object") {
    throw new Error("Missing INNERTUBE_CONTEXT.client");
  }

  const clientName = assertString("INNERTUBE_CONTEXT.client.clientName", (client as Record<string, unknown>).clientName);
  const clientVersion = assertString(
    "INNERTUBE_CONTEXT.client.clientVersion",
    (client as Record<string, unknown>).clientVersion,
  );
  const visitorData = assertString(
    "INNERTUBE_CONTEXT.client.visitorData",
    (client as Record<string, unknown>).visitorData,
  );

  return { apiKey, apiUrl, clientName, clientVersion, visitorData };
}
const CONSENT_COOKIES =
  "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

export type InnertubeConfig = {
  apiKey: string;
  apiUrl: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
};

function assertString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid ${field}`);
  }
  return value;
}

function extractYtcfg(html: string): Record<string, unknown> {
  const match = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
  if (!match || !match[1]) {
    throw new Error("ytcfg.set payload not found in bootstrap HTML");
  }

  try {
    return JSON.parse(match[1]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ytcfg.set JSON parse failed: ${message}`);
  }
}

export async function fetchInnertubeConfig(): Promise<InnertubeConfig> {
  const response = await fetch("https://music.youtube.com/", {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.85 Safari/537.36",
      Cookie: CONSENT_COOKIES,
    },
  });

  const location = response.headers.get("location") || "";
  if (response.status === 302) {
    console.log(`[InnertubeConfig] bootstrap redirect location=${location}`);
  }

  if (response.status !== 200) {
    throw new Error(`Bootstrap request failed: status ${response.status}`);
  }

  const html = await response.text();
  if (!html) {
    throw new Error("Bootstrap response body is empty");
  }

  const cfg = extractYtcfg(html);

  const apiKey = assertString("INNERTUBE_API_KEY", cfg.INNERTUBE_API_KEY);
  const apiUrl = assertString("INNERTUBE_API_URL", cfg.INNERTUBE_API_URL);

  const context = cfg.INNERTUBE_CONTEXT;
  if (!context || typeof context !== "object") {
    throw new Error("Missing INNERTUBE_CONTEXT");
  }

  const client = (context as { client?: unknown }).client;
  if (!client || typeof client !== "object") {
    throw new Error("Missing INNERTUBE_CONTEXT.client");
  }

  const clientName = assertString("INNERTUBE_CONTEXT.client.clientName", (client as Record<string, unknown>).clientName);
  const clientVersion = assertString(
    "INNERTUBE_CONTEXT.client.clientVersion",
    (client as Record<string, unknown>).clientVersion,
  );
  const visitorData = assertString("INNERTUBE_CONTEXT.client.visitorData", (client as Record<string, unknown>).visitorData);

  return { apiKey, apiUrl, clientName, clientVersion, visitorData };
}
const CONSENT_COOKIES = "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function takeFirstMatch(html: string, pattern: RegExp): string | null {
  const m = pattern.exec(html);
  return m && m[1] ? normalizeString(m[1]) : null;
}

function assertPresent(label: string, value: string | null | undefined): string {
  if (!value) {
    throw new Error(`Missing required Innertube field: ${label}`);
  }
  return value;
}

export type InnertubeConfig = {
  apiKey: string;
  apiUrl: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
};

async function fetchInnertubeConfigFrom(url: string): Promise<InnertubeConfig> {
  const consentPresent = Boolean(CONSENT_COOKIES);
  console.log(`[InnertubeConfig] start url=${url} consentPresent=${consentPresent}`);

  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HajdeMusic/1.0",
      Cookie: CONSENT_COOKIES,
    },
  });

  console.log(`[InnertubeConfig] response status=${response.status} type=${response.type}`);
  console.log("[InnertubeConfig] response keys", Object.keys(response));

  if (response.type === "opaqueredirect" || response.status >= 300) {
    throw new Error(`Innertube config fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  if (!html) {
    throw new Error("Innertube config fetch returned empty body");
  }
  if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
    throw new Error("Innertube config blocked by consent page");
  }

  const apiKey = assertPresent("apiKey", takeFirstMatch(html, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/));
  const apiUrl = assertPresent("apiUrl", takeFirstMatch(html, /"INNERTUBE_API_URL"\s*:\s*"([^"]+)"/));
  const clientName = assertPresent("clientName", takeFirstMatch(html, /"INNERTUBE_CLIENT_NAME"\s*:\s*"([^"]+)"/));
  const clientVersion = assertPresent(
    "clientVersion",
    takeFirstMatch(html, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"clientVersion"\s*:\s*"([^"]+)"/),
  );
  const visitorData = assertPresent(
    "visitorData",
    takeFirstMatch(html, /"VISITOR_DATA"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"visitorData"\s*:\s*"([^"]+)"/),
  );

  console.log(
    `[InnertubeConfig] extracted clientName=${clientName} clientVersion=${clientVersion} visitorData=${visitorData} apiUrl=${apiUrl} apiKey?=${Boolean(apiKey)} consentPresent=${consentPresent}`,
  );

  return { apiKey, apiUrl, clientName, clientVersion, visitorData };
}

export async function fetchInnertubeConfig(): Promise<InnertubeConfig> {
  const errors: string[] = [];
  for (const url of ["https://music.youtube.com/?hl=en&gl=US", "https://www.youtube.com/?hl=en&gl=US"]) {
    try {
      return await fetchInnertubeConfigFrom(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[InnertubeConfig] failed for ${url}: ${message}`);
      errors.push(`${url}: ${message}`);
    }
  }
  throw new Error(`Innertube config fetch failed: ${errors.join(" | ")}`);
}

export { CONSENT_COOKIES };
