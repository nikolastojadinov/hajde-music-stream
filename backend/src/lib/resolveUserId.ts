import type { Request } from 'express';

export function resolveUserId(req: Request): string | null {
  const fromHeader = typeof req.headers['x-pi-user-id'] === 'string' ? (req.headers['x-pi-user-id'] as string).trim() : '';
  const fromRequest = typeof req.userId === 'string' ? req.userId.trim() : '';
  const fromCurrentUser = typeof req.currentUser?.uid === 'string' ? req.currentUser.uid.trim() : '';

  const candidate = fromHeader || fromRequest || fromCurrentUser;
  return candidate || null;
}
