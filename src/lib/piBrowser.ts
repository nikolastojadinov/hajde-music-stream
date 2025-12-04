export function isPiBrowser(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const ua = navigator.userAgent || "";
    if (ua.includes("PiBrowser")) return true;

    if ((window as any).Pi && typeof (window as any).Pi.authenticate === "function") {
      return true;
    }

    if ((window as any).__PI_AUTH__ !== undefined) {
      return true;
    }
  } catch (_) {}

  return false;
}

export function requirePiBrowser(): { ok: boolean; reason?: string } {
  return isPiBrowser()
    ? { ok: true }
    : { ok: false, reason: "not_pi_browser" };
}
