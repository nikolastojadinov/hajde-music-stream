import express from 'express';
import { handleSignin } from './signin.js';

const router = express.Router();

// POST /user/signin - Pi authentication
router.post('/signin', handleSignin);

// GET /user/signout - Clear session
router.get('/signout', (req, res) => {
  res.clearCookie('pm_session', { sameSite: 'none', secure: true });
  return res.status(200).json({ success: true, message: 'Signed out' });
});

export default router;
