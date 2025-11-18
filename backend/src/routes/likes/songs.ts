import { Router } from 'express';
import { getLikedSongs, likeSong, unlikeSong } from '../../handlers/likes/songs';

const router = Router();
router.get('/', getLikedSongs);
router.post('/:id', likeSong);
router.delete('/:id', unlikeSong);
export default router;
