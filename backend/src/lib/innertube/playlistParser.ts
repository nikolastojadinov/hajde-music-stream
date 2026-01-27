type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

type ThumbnailCandidate = { url?: string | null; width?: number; height?: number };

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const textOrNull = (value: unknown): string | null => {
	const text = normalizeString(value);
	return text ? text : null;
};

const pickLastThumbnail = (thumbnails?: any): string | null => {
	const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
	if (!Array.isArray(arr) || arr.length === 0) return null;
	const last = arr[arr.length - 1] as ThumbnailCandidate;
	return normalizeString(last?.url) || null;
};

const startsWithUc = (browseId: string | null | undefined): boolean => typeof browseId === "string" && browseId.startsWith("UC");

const extractHeaderTitle = (data: any): string | null => {
	const microTitle = textOrNull(data?.microformat?.microformatDataRenderer?.title);
	if (microTitle) return microTitle;
	return textOrNull(data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text);
};

const extractHeaderThumbnail = (data: any): string | null => {
	const thumb = pickLastThumbnail(
		data?.header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails,
	);
	if (thumb) return thumb;
	return pickLastThumbnail(data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails);
};

const extractHeaderArtist = (data: any): string | null => {
	const runs: Runs = data?.header?.musicDetailHeaderRenderer?.subtitle?.runs;
	if (!Array.isArray(runs)) return null;
	for (const run of runs) {
		const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
		if (!startsWithUc(browseId)) continue;
		const name = textOrNull(run?.text);
		if (name) return name;
	}
	for (const run of runs) {
		const name = textOrNull(run?.text);
		if (name) return name;
	}
	return null;
};

const extractDurationText = (maybeDuration: any): string | null => {
	return textOrNull(maybeDuration?.runs?.[0]?.text) || textOrNull(maybeDuration?.simpleText);
};

const extractDurationFromOverlays = (renderer: any): string | null => {
	const overlays = Array.isArray(renderer?.thumbnailOverlays) ? renderer.thumbnailOverlays : [];
	for (const overlay of overlays) {
		const time = overlay?.thumbnailOverlayTimeStatusRenderer?.text;
		const duration = extractDurationText(time);
		if (duration) return duration;
	}
	return null;
};

const extractResponsiveTrack = (renderer: any, fallbackArtist: string | null, fallbackThumb: string | null) => {
	const videoId = textOrNull(renderer?.playNavigationEndpoint?.watchEndpoint?.videoId);
	if (!videoId) return null;

	const title = textOrNull(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text);

	const runs: Runs = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
	let artist: string | null = fallbackArtist;
	if (Array.isArray(runs)) {
		for (const run of runs) {
			const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
			if (!startsWithUc(browseId)) continue;
			const name = textOrNull(run?.text);
			if (name) {
				artist = name;
				break;
			}
		}
		if (!artist) {
			for (const run of runs) {
				const name = textOrNull(run?.text);
				if (name) {
					artist = name;
					break;
				}
			}
		}
	}

	const duration = extractDurationText(
		renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text,
	) || extractDurationFromOverlays(renderer);

	const thumbnail =
		pickLastThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ||
		pickLastThumbnail(renderer?.thumbnail?.thumbnails) ||
		fallbackThumb;

	return { videoId, title, artist, duration, thumbnail } as ParsedTrack;
};

const extractPanelTrack = (renderer: any, fallbackArtist: string | null, fallbackThumb: string | null) => {
	const videoId = textOrNull(renderer?.videoId);
	if (!videoId) return null;

	const title = textOrNull(renderer?.title?.runs?.[0]?.text) || textOrNull(renderer?.title?.simpleText);

	let artist: string | null = fallbackArtist;
	const runs: Runs = renderer?.longBylineText?.runs;
	if (Array.isArray(runs)) {
		for (const run of runs) {
			const name = textOrNull(run?.text);
			if (name) {
				artist = name;
				break;
			}
		}
	}

	const duration = extractDurationText(renderer?.lengthText) || extractDurationFromOverlays(renderer);

	const thumbnail = pickLastThumbnail(renderer?.thumbnail?.thumbnails) || fallbackThumb;

	return { videoId, title, artist, duration, thumbnail } as ParsedTrack;
};

const collectRendererKinds = (data: any): string[] => {
	const kinds = new Set<string>();
	const walk = (node: any) => {
		if (!node) return;
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		if (typeof node !== "object") return;
		if ((node as any).musicResponsiveListItemRenderer) kinds.add("musicResponsiveListItemRenderer");
		if ((node as any).playlistPanelVideoRenderer) kinds.add("playlistPanelVideoRenderer");
		if ((node as any).playlistVideoRenderer) kinds.add("playlistVideoRenderer");
		Object.values(node).forEach(walk);
	};
	walk(data);
	return Array.from(kinds);
};

const collectResponsiveRenderers = (data: any): any[] => {
	const secondary =
		data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]
			?.musicShelfRenderer?.contents;
	if (Array.isArray(secondary)) return secondary;

	const shelves = data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents;
	if (Array.isArray(shelves)) {
		for (const shelf of shelves) {
			const contents = shelf?.musicShelfRenderer?.contents;
			if (Array.isArray(contents)) return contents;
		}
	}

	const singleShelf = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
		?.contents?.[0]?.musicShelfRenderer?.contents;
	if (Array.isArray(singleShelf)) return singleShelf;

	return [];
};

const collectPanelRenderers = (data: any): any[] => {
	const renderers: any[] = [];
	const walk = (node: any) => {
		if (!node) return;
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		if (typeof node !== "object") return;
		const panel = (node as any)?.playlistPanelVideoRenderer;
		if (panel) renderers.push(panel);
		const pv = (node as any)?.playlistVideoRenderer;
		if (pv) renderers.push(pv);
		Object.values(node).forEach(walk);
	};
	walk(data);
	return renderers;
};

export type ParsedTrack = {
	videoId: string | null;
	title: string | null;
	artist: string | null;
	duration: string | null;
	thumbnail: string | null;
};

export type ParsedPlaylist = {
	id: string;
	title: string | null;
	thumbnail: string | null;
	tracks: ParsedTrack[];
	trackCount: number;
};

export function parseTracksFromInnertube(data: any, albumArtist: string | null, albumThumbnail: string | null): ParsedTrack[] {
	const responsive = collectResponsiveRenderers(data)
		.map((item: any) => item?.musicResponsiveListItemRenderer)
		.filter(Boolean)
		.map((renderer) => extractResponsiveTrack(renderer, albumArtist, albumThumbnail))
		.filter(Boolean) as ParsedTrack[];

	const panels = collectPanelRenderers(data)
		.map((renderer) => extractPanelTrack(renderer, albumArtist, albumThumbnail))
		.filter(Boolean) as ParsedTrack[];

	const combined = [...responsive, ...panels];
	const deduped: ParsedTrack[] = [];
	const seen = new Set<string>();
	combined.forEach((track) => {
		if (!track.videoId) return;
		if (seen.has(track.videoId)) return;
		seen.add(track.videoId);
		deduped.push(track);
	});

	if (deduped.length === 0) {
		const kinds = collectRendererKinds(data);
		console.info("[playlistParser] empty_tracks", { rendererKinds: kinds });
	}

	return deduped;
}

export function parsePlaylistFromInnertube(browseJson: any, browseId: string): ParsedPlaylist {
	const title = extractHeaderTitle(browseJson);
	const albumArtist = extractHeaderArtist(browseJson);
	const thumbnail = extractHeaderThumbnail(browseJson);
	const tracks = parseTracksFromInnertube(browseJson, albumArtist, thumbnail);

	return {
		id: browseId,
		title,
		thumbnail,
		tracks,
		trackCount: tracks.length,
	};
}
