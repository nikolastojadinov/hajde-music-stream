type Runs = Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;

type ThumbnailCandidate = { url: string; width?: number; height?: number };

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const textOrNull = (value: unknown): string | null => {
	const text = normalizeString(value);
	return text === "" ? null : text;
};

const pickLastThumbnail = (thumbnails?: any): string | null => {
	const arr = Array.isArray(thumbnails) ? thumbnails : thumbnails?.thumbnails;
	if (!Array.isArray(arr) || arr.length === 0) return null;
	const last = arr[arr.length - 1] as ThumbnailCandidate;
	const url = normalizeString(last?.url);
	return url || null;
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

const extractTrackArtist = (renderer: any, albumArtist: string | null): string | null => {
	const runs: Runs = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
	if (Array.isArray(runs)) {
		for (const run of runs) {
			const browseId = normalizeString(run?.navigationEndpoint?.browseEndpoint?.browseId);
			if (!startsWithUc(browseId)) continue;
			const name = textOrNull(run?.text);
			if (name) return name;
		}
	}
	return albumArtist;
};

const extractTrackTitle = (renderer: any): string | null => {
	return textOrNull(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text);
};

const extractDuration = (renderer: any): string | null => {
	return textOrNull(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text);
};

const extractTrackThumbnail = (renderer: any, albumThumbnail: string | null): string | null => {
	const thumb = pickLastThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
	if (thumb) return thumb;
	return albumThumbnail;
};

const extractPanelTrack = (renderer: any, albumArtist: string | null, albumThumbnail: string | null): ParsedTrack | null => {
	const videoId = textOrNull(renderer?.videoId);
	if (!videoId) return null;

	const title = textOrNull(renderer?.title?.runs?.[0]?.text) || textOrNull(renderer?.title?.simpleText);

	const artist = (() => {
		const runs: Runs = renderer?.longBylineText?.runs;
		if (Array.isArray(runs)) {
			for (const run of runs) {
				const name = textOrNull(run?.text);
				if (name) return name;
			}
		}
		return albumArtist;
	})();

	const duration = textOrNull(renderer?.lengthText?.runs?.[0]?.text) || textOrNull(renderer?.lengthText?.simpleText);

	const thumb = pickLastThumbnail(renderer?.thumbnail?.thumbnails) || albumThumbnail;

	return { videoId, title, artist, duration, thumbnail: thumb };
};

const collectTrackRenderers = (data: any): any[] => {
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

const collectPanelTracks = (data: any, albumArtist: string | null, albumThumbnail: string | null): ParsedTrack[] => {
	const tracks: ParsedTrack[] = [];

	const walk = (node: any) => {
		if (!node) return;

		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}

		if (typeof node !== "object") return;

		const panel = (node as any)?.playlistPanelVideoRenderer;
		if (panel) {
			const parsed = extractPanelTrack(panel, albumArtist, albumThumbnail);
			if (parsed) tracks.push(parsed);
		}

		const pv = (node as any)?.playlistVideoRenderer;
		if (pv) {
			const parsed = extractPanelTrack(pv, albumArtist, albumThumbnail);
			if (parsed) tracks.push(parsed);
		}

		Object.values(node).forEach(walk);
	};

	walk(data);
	return tracks;
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
	const items = collectTrackRenderers(data);

	const responsiveTracks = Array.isArray(items)
		? items
				.map((item: any) => item?.musicResponsiveListItemRenderer)
				.filter(Boolean)
				.map((renderer: any) => {
					const videoId = textOrNull(renderer?.playNavigationEndpoint?.watchEndpoint?.videoId);
					const title = extractTrackTitle(renderer);
					const artist = extractTrackArtist(renderer, albumArtist);
					const duration = extractDuration(renderer);
					const thumbnail = extractTrackThumbnail(renderer, albumThumbnail);

					return { videoId, title, artist, duration, thumbnail } as ParsedTrack;
				})
				.filter((track: ParsedTrack) => Boolean(track.videoId))
		: [];

	const panelTracks = collectPanelTracks(data, albumArtist, albumThumbnail);

	const combined = [...responsiveTracks, ...panelTracks];
	const deduped: ParsedTrack[] = [];
	const seen = new Set<string>();
	combined.forEach((track) => {
		if (!track.videoId) return;
		const key = track.videoId;
		if (seen.has(key)) return;
		seen.add(key);
		deduped.push(track);
	});

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
