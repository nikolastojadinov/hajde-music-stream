import fs from 'fs';
import path from 'path';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import logger from 'morgan';

import env from './environments';
import mountPaymentsVerify from './handlers/paymentsVerify';
import mountUserEndpoints from './handlers/users';
import mountNotificationEndpoints from './handlers/notifications';
import mountHealthEndpoints from './handlers/health';
import supabase from './services/supabaseClient';
import usersRouter from './routes/users';
import homeRouter from './routes/home';

import piAuthRouter from './routes/pi/auth';
import piPaymentsRouter from './routes/pi/payments';

import searchRouter from './routes/search';
import artistRouter from './routes/artist';
import browseArtistRouter from './routes/browseArtist';
import clientLogRouter from './routes/clientLog';
import playlistRouter from './routes/playlist';
import browsePlaylistRouter from './routes/browsePlaylist';
import { scheduleMostPopularJob, warmMostPopularSnapshotIfMissing } from './jobs/mostPopularScheduler';
import { scheduleTrendingNowJob, warmTrendingSnapshotIfMissing } from './jobs/trendingNowScheduler';

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

// Disable ETag to avoid 304s on dynamic JSON (e.g., recent searches)
app.disable('etag');

// Handle CORS:
const allowedOrigins = [
  env.frontend_url,
  'https://purplemusictestnet.netlify.app',
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
  if (!sid || !supabase) return next();

  try {
    const { data: sessionRow, error } = await supabase
      .from('sessions')
      .select('sid,user_uid,users:users(wallet,username,premium_until)')
      .eq('sid', sid)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[session middleware] Failed to load session', { error, sid });
      req.currentUser = null;
      return next();
    }

    const relatedUser = (sessionRow?.users ?? null) as any;
    if (relatedUser) {
      req.currentUser = {
        uid: relatedUser.wallet,
        username: relatedUser.username,
        roles: [],
      };
    } else {
      req.currentUser = null;
    }
  } catch (err) {
    console.error('[session middleware] Unexpected error', err);
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
app.use('/notifications', notificationRouter);

// Authenticated user profile helpers
app.use('/api/users', usersRouter);

// Intent-based search endpoints
app.use('/api/search', searchRouter);

// Home sections
app.use('/api/home', homeRouter);

// On-demand artist hydration + local bundle
app.use('/api/artist', artistRouter);
app.use('/api/browse/artist', browseArtistRouter);

// Playlist browse (YouTube Music)
app.use('/api/playlist', playlistRouter);
app.use('/api/browse/playlist', browsePlaylistRouter);

// Pi Network routes under /pi:
app.use('/pi', piAuthRouter);
app.use('/pi/payments', piPaymentsRouter);
app.use('/client-log', clientLogRouter);

// Health endpoint under /health:
const healthRouter = express.Router();
mountHealthEndpoints(healthRouter);
app.use('/', healthRouter);

// Hello World page to check everything works:
app.get('/', async (_req: Request, res: Response) => {
  res.status(200).send({ message: "Hello, World!" });
});


// III. Background jobs (cron-compatible)
scheduleTrendingNowJob();
void warmTrendingSnapshotIfMissing();
scheduleMostPopularJob();
void warmMostPopularSnapshotIfMissing();


// IV. Boot up the app:

app.listen(env.port, async () => {
  console.log(`Connected to Supabase at ${env.supabase_url}`);
  console.log(`App backend listening on port ${env.port}!`);
  console.log(`CORS config: configured to respond to a frontend hosted on ${env.frontend_url}`);
});
