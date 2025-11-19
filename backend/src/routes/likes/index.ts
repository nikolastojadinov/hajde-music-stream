import { Router } from 'express';
import PiAuth from '../../middleware/piAuth';
import { getLikedSongs, likeSong, unlikeSong } from '../../handlers/likes/songs';
import { getLikedPlaylists, likePlaylist, unlikePlaylist } from '../../handlers/likes/playlists';

const router = Router();

router.use(PiAuth);

// songs
router.get('/songs', getLikedSongs);
router.post('/songs/:trackId', likeSong);
router.delete('/songs/:trackId', unlikeSong);

// playlists
router.get('/playlists', getLikedPlaylists);
router.post('/playlists/:playlistId', likePlaylist);
router.delete('/playlists/:playlistId', unlikePlaylist);

export default router;