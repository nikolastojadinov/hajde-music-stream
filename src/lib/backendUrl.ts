const env = (import.meta as any)?.env ?? {};
const envBackendUrl = env?.VITE_BACKEND_URL as string | undefined;
const DEV_DEFAULT_ORIGIN = 'http://localhost:8000';
const PROD_DEFAULT_ORIGIN = 'https://hajde-music-stream.onrender.com';

function readWindowBackendUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const fromWindow = (window as any).__PI_BACKEND_URL__ as string | undefined;
  if (fromWindow && typeof fromWindow === 'string' && fromWindow.trim().length > 0) {
    return fromWindow;
  }
  return undefined;
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

function getDefaultOrigin(): string {
  const isDev = Boolean(env?.DEV);
  return isDev ? DEV_DEFAULT_ORIGIN : PROD_DEFAULT_ORIGIN;
}

export function getBackendOrigin(): string {
  return (
    normalizeOrigin(readWindowBackendUrl() || envBackendUrl) ??
    getDefaultOrigin()
  );
}

export function withBackendOrigin(path: string): string {
  const origin = getBackendOrigin();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
