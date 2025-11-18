import { Router } from 'express';
import { getUserLibrary } from '../../handlers/library/getLibrary';

const router = Router();
router.get('/', getUserLibrary);
export default router;
