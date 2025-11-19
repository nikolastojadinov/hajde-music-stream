import { Request, Response, NextFunction } from 'express';

interface PiUser {
  id: string;
  username: string;
  premium: boolean;
  premium_until: string | null;
}

function normalizeBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

function extractHeader(req: Request, name: string): string | undefined {
  return req.headers[name.toLowerCase()] as string | undefined;
}

function buildUser(req: Request): PiUser | null {
  const required = [
    'x-pi-user-id',
    'x-pi-username',
    'x-pi-premium',
    'x-pi-premium-until'
  ];
  const missing: string[] = [];
  const values: Record<string, string | undefined> = {};
  for (const key of required) {
    const v = extractHeader(req, key);
    values[key] = v;
    if (!v) missing.push(key);
  }
  if (missing.length) {
    for (const m of missing) console.warn('[PiAuth] missing header:', m);
    return null;
  }
  return {
    id: values['x-pi-user-id']!,
    username: values['x-pi-username']!,
    premium: normalizeBoolean(values['x-pi-premium']),
    premium_until: values['x-pi-premium-until'] || null,
  };
}

export default function PiAuth(req: Request, res: Response, next: NextFunction) {
  const user = buildUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Missing Pi auth headers' });
  }
  (req as any).user = user;
  console.log('[PiAuth] user', user);
  return next();
}

// Backward compatible named export (existing imports may use { piAuth })
export const piAuth = PiAuth;
