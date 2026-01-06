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
    takeFirstMatch(html, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || takeFirstMatch(html, /"clientVersion"\s*:\s*"([^"]+)"/),
  );
  const visitorData = assertPresent(
    "visitorData",
    takeFirstMatch(html, /"VISITOR_DATA"\s*:\s*"([^"]+)"/) || takeFirstMatch(html, /"visitorData"\s*:\s*"([^"]+)"/),
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

export { CONSENT_COOKIES };const CONSENT_COOKIES = "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function takeFirstMatch(html: string, pattern: RegExp): string | null {
  const m = pattern.exec(html);
  return m && m[1] ? normalizeString(m[1]) : null;
}

export type InnertubeConfig = {
  apiKey: string;
  apiUrl: string;
  clientName: string;
  clientVersion: string;
  visitorData: string;
};

async function fetchInnertubeConfigFrom(url: string): Promise<InnertubeConfig | null> {
  const consentPresent = Boolean(CONSENT_COOKIES);
  console.log(`[InnertubeConfig] start url=${url} consentPresent=${consentPresent}`);

  try {
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

    const html = await response.text().catch(() => "");
    if (!html) {
      throw new Error("Innertube config fetch returned empty body");
    }
    if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
      throw new Error("Innertube config blocked by consent page");
    }

    const apiKey = takeFirstMatch(html, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    const apiKey = assertPresent("apiKey", takeFirstMatch(html, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/));

    const clientVersion =
      takeFirstMatch(html, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"clientVersion"\s*:\s*"([^"]+)"/);

    const visitorData =
      takeFirstMatch(html, /"VISITOR_DATA"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"visitorData"\s*:\s*"([^"]+)"/);

    const apiUrl = assertPresent("apiUrl", takeFirstMatch(html, /"INNERTUBE_API_URL"\s*:\s*"([^"]+)"/));
    const clientName = assertPresent("clientName", takeFirstMatch(html, /"INNERTUBE_CLIENT_NAME"\s*:\s*"([^"]+)"/));

    console.log(
      `[InnertubeConfig] extracted clientName=${clientName} clientVersion=${clientVersion} visitorData=${visitorData} apiUrl=${apiUrl} apiKey?=${Boolean(apiKey)}`,
    );

    return { apiKey, apiUrl, clientName, clientVersion, visitorData };
  } catch {
    throw new Error(`Innertube config fetch failed: ${errors.join(" | ")}`);
  }
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
