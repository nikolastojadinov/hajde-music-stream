import { Router } from 'express';
import PiAuth from '../../middleware/piAuth';
import { getUserLibrary } from '../../handlers/library/getLibrary';

const router = Router();
router.use(PiAuth);
router.get('/', getUserLibrary);

export default router;
