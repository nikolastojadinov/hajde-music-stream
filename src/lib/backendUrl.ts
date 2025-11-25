const envBackendUrl = (import.meta as any)?.env?.VITE_BACKEND_URL as string | undefined;

function readWindowBackendUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as any).__PI_BACKEND_URL__ as string | undefined;
}

function normalizeOrigin(origin?: string | null): string | null {
  if (!origin || typeof origin !== 'string') {
    return null;
  }
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

export function getBackendOrigin(): string | null {
  return normalizeOrigin(readWindowBackendUrl() || envBackendUrl);
}

export function withBackendOrigin(path: string): string {
  const origin = getBackendOrigin();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return origin ? `${origin}${normalizedPath}` : normalizedPath;
}
