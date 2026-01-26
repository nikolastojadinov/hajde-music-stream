import { Router } from "express";

import browseAlbumRouter from "./browseAlbum";
import browseArtistRouter from "./browseArtist";
import browsePlaylistRouter from "./browsePlaylist";

const router = Router();

router.use("/artist", browseArtistRouter);
router.use("/playlist", browsePlaylistRouter);
router.use("/album", browseAlbumRouter);

export { browseAlbumRouter, browseArtistRouter, browsePlaylistRouter };
export default router;
