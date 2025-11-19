import { Router } from 'express';
import {
  getLikedPlaylists,
  likePlaylist,
  unlikePlaylist,
} from '../../handlers/likes/playlists';

const router = Router();

router.get('/', getLikedPlaylists);
router.post('/:playlistId', likePlaylist);
router.delete('/:playlistId', unlikePlaylist);

export default router;
