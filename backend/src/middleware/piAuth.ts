import { Request, Response, NextFunction } from 'express';

// Pi authentication middleware (full rewrite to fix TS2367)
// - Extracts Pi headers
// - Converts premium header via strict string comparison
// - Does NOT validate signature yet (TODO)
// - Populates req.user (typed as any)
// - Never blocks Pi Browser based on origin

export function piAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // 1) Extract headers
    const headers = req.headers || {};
    const userIdHeader = headers['x-pi-user-id'] as string | undefined;
    const usernameHeader = headers['x-pi-username'] as string | undefined;
    const premiumHeader = headers['x-pi-premium'] as string | undefined;
    const premiumUntilHeader = headers['x-pi-premium-until'] as string | undefined;
    const signatureHeader = headers['x-pi-auth'] as string | undefined;

    // 2) Validate presence of user id
    if (!userIdHeader) {
      return res.status(401).json({ success: false, error: 'not_authenticated' });
    }

    // 3) Convert premium fields per spec
    const premium = premiumHeader === 'true';
    const premium_until = premiumUntilHeader ?? null;

    // 4) Populate req.user
    (req as any).user = {
      id: userIdHeader,
      username: usernameHeader,
      premium,
      premium_until,
    };

    // 5) Verbose logs
    console.log('[PiAuth] incoming headers:', req.headers);
    console.log('[PiAuth] user:', (req as any).user);

    // 6) TODO: Validate signature (not enforced yet)
    void signatureHeader;

    // 7) Continue
    return next();
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'pi_auth_error' });
  }
}
