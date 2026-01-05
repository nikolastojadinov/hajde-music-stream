const CONSENT_COOKIES = "CONSENT=YES+1; SOCS=CAESHAgBEhIaZ29vZ2xlLmNvbS9jb25zZW50L2Jhc2ljLzIiDFNvaURtdXhSNVQ1ag==; PREF=f1=50000000&hl=en";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function takeFirstMatch(html: string, pattern: RegExp): string | null {
  const m = pattern.exec(html);
  return m && m[1] ? normalizeString(m[1]) : null;
}

export type InnertubeConfig = {
  apiKey: string;
  clientVersion: string | null;
  visitorData: string | null;
};

async function fetchInnertubeConfigFrom(url: string): Promise<InnertubeConfig | null> {
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

    if (response.type === "opaqueredirect" || response.status >= 300) {
      return null;
    }

    const html = await response.text().catch(() => "");
    if (!html) return null;
    if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
      return null;
    }

    const apiKey = takeFirstMatch(html, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    if (!apiKey) return null;

    const clientVersion =
      takeFirstMatch(html, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"clientVersion"\s*:\s*"([^"]+)"/);

    const visitorData =
      takeFirstMatch(html, /"VISITOR_DATA"\s*:\s*"([^"]+)"/) ||
      takeFirstMatch(html, /"visitorData"\s*:\s*"([^"]+)"/);

    return { apiKey, clientVersion, visitorData };
  } catch {
    return null;
  }
}

export async function fetchInnertubeConfig(): Promise<InnertubeConfig | null> {
  return (await fetchInnertubeConfigFrom("https://music.youtube.com/?hl=en&gl=US"))
    || (await fetchInnertubeConfigFrom("https://www.youtube.com/?hl=en&gl=US"));
}

export { CONSENT_COOKIES };
