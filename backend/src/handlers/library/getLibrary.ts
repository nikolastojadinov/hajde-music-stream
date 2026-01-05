import { Request, Response } from 'express';

type AuthedRequest = Request & {
  user?: {
    id?: string;
  };
};

export async function getUserLibrary(req: AuthedRequest, res: Response) {
  try {
    const user = req.user;
    const wallet = user?.id; // Pi wallet / external UID

    if (!wallet) {
      return res.status(401).json({ success: false, error: 'not_authenticated' });
    }

    // Library data is no longer stored server-side in live mode.
    return res.json({
      success: true,
      likedSongs: [],
      likedPlaylists: [],
    });
  } catch (err) {
    console.error('[LIBRARY ERROR - CATCH]', err);
    const message = err instanceof Error ? err.message : 'unknown_error';
    return res.status(500).json({ success: false, error: message });
  }
}
