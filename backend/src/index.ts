import fs from 'fs';
import path from 'path';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import env from './environments';
// Legacy payments endpoints removed in favor of /api/payments/verify
// import mountPaymentsEndpoints from './handlers/payments';
import mountPaymentsVerify from './handlers/paymentsVerify';
import mountUserEndpoints from './handlers/users';
import mountNotificationEndpoints from './handlers/notifications';
import mountHealthEndpoints from './handlers/health';
import supabase from './services/supabaseClient';
import { randomBytes } from 'crypto';

// Pi Network routes
import piAuthRouter from './routes/pi/auth';
import piPaymentsRouter from './routes/pi/payments';

// New modular routers
import { getLikedSongs, likeSong, unlikeSong } from './handlers/likes/songs';
import { getLikedPlaylists, likePlaylist, unlikePlaylist } from './handlers/likes/playlists';
import { getUserLibrary } from './handlers/library/getLibrary';
import { piAuth } from './middleware/piAuth';

declare global {
  namespace Express {
    interface Request {
      currentUser?: { uid: string; username: string; roles: string[] } | null;
      sid?: string | null;
    }
  }
}


//
// I. Initialize and set up the express app and various middlewares and packages:
//

const app: express.Application = express();

// Log requests to the console in a compact format:
app.use(logger('dev'));

// Full log of all requests to /log/access.log:
app.use(logger('common', {
  stream: fs.createWriteStream(path.join(__dirname, '..', 'log', 'access.log'), { flags: 'a' }),
}));

// Enable response bodies to be sent as JSON:
app.use(express.json())

// Handle CORS:
const allowedOrigins = [
  env.frontend_url,
  'https://sandbox.minepi.com',
  'https://minepi.com',
  'https://web.minepi.com',
  'https://www.minepi.com',
  'app://-',
  'app://pi',
  'app://local',
  'capacitor://localhost',
  'ionic://localhost',
  'file://',
  'null'
];

app.use(cors({
  origin: (origin: string | undefined, cb: (err: Error | null, allowed?: boolean) => void) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin), false);
  },
  credentials: true
}));

// Handle cookies 🍪
app.use(cookieParser());

// Minimal cookie-based sessions stored in Supabase
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  const sid = req.cookies['sid'] as string | undefined;
  req.sid = sid || null;
  if (!sid) return next();

  const { data: sessionRows } = await supabase
    .from('sessions')
    .select('sid,user_uid,users:users(uid,username,roles)')
    .eq('sid', sid)
    .limit(1);

  const row = sessionRows && sessionRows[0] as any;
  if (row && row.users) {
    req.currentUser = {
      uid: row.users.uid,
      username: row.users.username,
      roles: row.users.roles || [],
    };
  } else {
    req.currentUser = null;
  }
  next();
});


//
// II. Mount app endpoints:
//

// Payments verification under /api/payments:
const paymentsVerifyRouter = express.Router();
mountPaymentsVerify(paymentsVerifyRouter);
app.use('/api/payments', paymentsVerifyRouter);

// User endpoints (e.g signin, signout) under /user:
const userRouter = express.Router();
mountUserEndpoints(userRouter);
app.use('/user', userRouter);


// Notification endpoints under /notifications:
const notificationRouter = express.Router();
mountNotificationEndpoints(notificationRouter);
app.use("/notifications", notificationRouter);

// Pi Auth middleware for protected resource groups
app.use('/likes', piAuth);
app.use('/playlists', piAuth);
app.use('/tracks', piAuth);

// Likes endpoints (direct handlers)
// --- Likes: tracks ---
app.get('/likes/songs', getLikedSongs);
app.post('/likes/songs/:trackId', likeSong);
app.delete('/likes/songs/:trackId', unlikeSong);
// --- Likes: playlists ---
app.get('/likes/playlists', getLikedPlaylists);
app.post('/likes/playlists/:playlistId', likePlaylist);
app.delete('/likes/playlists/:playlistId', unlikePlaylist);

// (Legacy modular routers retained for compatibility; should be removed if unused)
// New likes endpoints are direct (no legacy routers)

// User library overview
app.use('/library', piAuth);
app.get('/library', getUserLibrary);

// Pi Network routes under /pi:
app.use('/pi', piAuthRouter);
app.use('/pi/payments', piPaymentsRouter);

// Health endpoint under /health:
const healthRouter = express.Router();
mountHealthEndpoints(healthRouter);
app.use('/', healthRouter);

// Hello World page to check everything works:
app.get('/', async (_req: Request, res: Response) => {
  res.status(200).send({ message: "Hello, World!" });
});


// III. Boot up the app:

app.listen(env.port, async () => {
  console.log(`Connected to Supabase at ${env.supabase_url}`);
  console.log(`App backend listening on port ${env.port}!`);
  console.log(`CORS config: configured to respond to a frontend hosted on ${env.frontend_url}`);
});
