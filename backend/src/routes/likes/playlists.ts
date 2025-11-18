import { Router } from 'express';
import { getLikedPlaylists, likePlaylist, unlikePlaylist } from '../../handlers/likes/playlists';

const router = Router();
router.get('/', getLikedPlaylists);
router.post('/:id', likePlaylist);
router.delete('/:id', unlikePlaylist);
export default router;
