export async function testConnection() {
  try {
    const base = (import.meta as any).env.VITE_BACKEND_URL as string | undefined;
    if (!base) {
      console.warn('VITE_BACKEND_URL not set; skipping backend connection test');
      return;
    }
    const res = await fetch(`${base.replace(/\/$/, '')}/health`);
    const data = await res.json();
    console.log('Backend health:', data);
  } catch (e) {
    console.warn('Backend health check failed', e);
  }
}
