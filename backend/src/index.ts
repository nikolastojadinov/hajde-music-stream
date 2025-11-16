import fs from 'fs';
import path from 'path';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import env from './environments';
import mountPaymentsVerify from './handlers/paymentsVerify';
import userRouter from './routes/user';
import mountNotificationEndpoints from './handlers/notifications';
import mountHealthEndpoints from './handlers/health';
import supabase from './services/supabaseClient';
import createPaymentHandler from './routes/payments/createPayment';

declare global {
  namespace Express {
    interface Request {
      currentUser?: { uid: string; username: string; roles: string[] } | null;
      sid?: string | null;
    }
  }
}

const app: express.Application = express();

// Trust proxy - required for secure cookies on Render
app.set('trust proxy', 1);

// Logging
app.use(logger('dev'));
app.use(logger('common', {
  stream: fs.createWriteStream(path.join(__dirname, '..', 'log', 'access.log'), { flags: 'a' }),
}));

// Parse JSON bodies
app.use(express.json());

// CORS configuration - allow Netlify frontend with credentials
app.use(cors({
  origin: [
    'https://purplemusictestnet.netlify.app',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Cookie parser - must be before session middleware
app.use(cookieParser());

// Session middleware - read sid cookie and load user from Supabase
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

// Mount endpoints
const paymentsVerifyRouter = express.Router();
mountPaymentsVerify(paymentsVerifyRouter);
app.use('/api/payments', paymentsVerifyRouter);

// Payment creation endpoint
app.post('/payments/create', createPaymentHandler);

// Use new clean routes/user router instead of handlers
app.use('/user', userRouter);

const notificationRouter = express.Router();
mountNotificationEndpoints(notificationRouter);
app.use('/notifications', notificationRouter);

const healthRouter = express.Router();
mountHealthEndpoints(healthRouter);
app.use('/', healthRouter);

app.get('/', async (_req: Request, res: Response) => {
  res.status(200).send({ message: "Hello, World!" });
});

// Start server
app.listen(env.port, async () => {
  console.log(`Backend listening on port ${env.port}`);
  console.log(`CORS enabled for: https://purplemusictestnet.netlify.app`);
});
