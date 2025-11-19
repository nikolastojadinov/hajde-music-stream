import { Request, Response, NextFunction } from 'express';

// Pi authentication middleware
// - Extracts Pi-related headers
// - Does NOT validate signature yet (TODO)
// - Populates req.user (typed as any) and never blocks due to CORS/origin

export function piAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const headers = req.headers || {};

    // Verbose logging of incoming headers
    // Note: may include sensitive info in development logs
    console.log('[PiAuth] incoming headers:', headers);

    const userId = (headers['x-pi-user-id'] as string | undefined) || undefined;
    const username = (headers['x-pi-username'] as string | undefined) || undefined;
    const premium = (headers['x-pi-premium'] as string | undefined) || undefined;
    const premiumUntil = (headers['x-pi-premium-until'] as string | undefined) || undefined;
    const signature = (headers['x-pi-auth'] as string | undefined) || undefined;

    // If no user id, consider not authenticated
    if (!userId) {
      return res.status(401).json({ success: false, error: 'not_authenticated' });
    }

    // TODO: Validate signature when server-side secret and scheme are finalized
    // e.g., verify `signature` against known secret or Pi SDK token
    void signature;

    // Populate user on req (typed as any to avoid Express Request conflicts)
    (req as any).user = {
      id: userId,
      username: username || null,
      premium: premium === 'true' || premium === '1' || premium === true,
      premium_until: premiumUntil || null,
    };

    console.log('[PiAuth] user:', (req as any).user);

    // Never block based on origin/null/app:// schemes; let CORS handle response headers
    return next();
  } catch (e: any) {
    // In case of unexpected errors, fail closed with clear message
    return res.status(500).json({ success: false, error: e?.message || 'pi_auth_error' });
  }
}
