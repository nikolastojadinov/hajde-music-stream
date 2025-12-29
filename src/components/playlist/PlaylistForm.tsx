// CLEANUP DIRECTIVE: Fetch playlist categories through backend-aware API calls keyed by VITE_BACKEND_URL.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Circle, CircleDot, Loader2, Upload, X, Plus } from "lucide-react";
import { externalSupabase } from "@/lib/externalSupabase";
import { withBackendOrigin } from "@/lib/backendUrl";
import { fetchWithPiAuth } from "@/lib/fetcher";

const COVER_BUCKET = import.meta.env.VITE_SUPABASE_PLAYLISTS_BUCKET || "playlists-covers";
const MAX_COVER_BYTES = 1024 * 1024; // 1MB
const MAX_COVER_DIMENSION = 1024; // px
                <span className="text-[11px] text-white/50">Max 1MB / 1024x1024px</span>

export type CategoryGroup = "region" | "era" | "genre" | "theme" | "popularity" | "special";

export type CategoryRow = {
  id: number;
  name: string | null;
  label: string | null;
  group_type: CategoryGroup | null;
  key: string | null;
  group_key: string | null;
};

export type CategoryBuckets = Record<CategoryGroup, CategoryRow[]>;

const EMPTY_CATEGORY_BUCKETS: CategoryBuckets = {
  region: [],
  era: [],
  genre: [],
  theme: [],
  popularity: [],
  special: [],
};

const readImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      resolve({ width: image.width, height: image.height });
      URL.revokeObjectURL(objectUrl);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read image dimensions."));
    };

    image.src = objectUrl;
  });

const validateCoverFile = async (file: File) => {
  if (file.size > MAX_COVER_BYTES) {
    throw new Error("Cover image must be 1MB or smaller.");
  }

  const { width, height } = await readImageDimensions(file);
  if (width > MAX_COVER_DIMENSION || height > MAX_COVER_DIMENSION) {
    throw new Error("Cover image must be 1024x1024px or smaller.");
  }
};

export type CategoryPayload = {
  region: number | null;
  era: number | null;
  genres: number[];
  themes: number[];
  all: number[];
};

type SignedCoverUploadResponse = {
  bucket: string;
  path: string;
  token: string;
  publicUrl: string | null;
};

export type PlaylistFormSubmitPayload = {
  title: string;
  description: string | null;
  cover_url: string | null;
  region_id: number;
  era_id: number;
  genre_ids: number[];
  theme_ids: number[];
  category_groups: CategoryPayload;
  is_public: boolean;
  remove_track_ids?: string[];
};

export type PlaylistFormInitialData = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  region_id: number | null;
  era_id: number | null;
  genre_ids: number[];
  theme_ids: number[];
  is_public: boolean | null;
};

export type PlaylistFormProps = {
  mode: "create" | "edit";
  userId: string;
  initialData?: PlaylistFormInitialData;
  onSubmit: (payload: PlaylistFormSubmitPayload) => Promise<void>;
  afterCoverSlot?: ReactNode;
  removeTrackIds?: string[];
};

const CATEGORY_CONFIG: Record<
  "region" | "era" | "genre" | "theme",
  { label: string; placeholder: string; helper?: string; multi: boolean; required: boolean }
> = {
  region: {
    label: "Region",
    placeholder: "Select region",
    helper: "Listeners find playlists faster when they are tied to a home region.",
    multi: false,
    required: true,
  },
  era: {
    label: "Era",
    placeholder: "Select era",
    helper: "Pick the dominant timeframe for this playlist.",
    multi: false,
    required: true,
  },
  genre: {
    label: "Genres",
    placeholder: "Pick genres",
    helper: "You can choose multiple genres to capture the blend.",
    multi: true,
    required: false,
  },
  theme: {
    label: "Themes",
    placeholder: "Pick themes",
    helper: "Themes are optional, but help with storytelling.",
    multi: true,
    required: false,
  },
};

const PlaylistForm = ({ mode, userId, initialData, onSubmit, afterCoverSlot, removeTrackIds = [] }: PlaylistFormProps) => {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [selectedRegion, setSelectedRegion] = useState<number | null>(initialData?.region_id ?? null);
  const [selectedEra, setSelectedEra] = useState<number | null>(initialData?.era_id ?? null);
  const [selectedGenres, setSelectedGenres] = useState<number[]>(initialData?.genre_ids ?? []);
  const [selectedThemes, setSelectedThemes] = useState<number[]>(initialData?.theme_ids ?? []);
  const [isPublic, setIsPublic] = useState<boolean>(initialData?.is_public ?? true);
  const [categories, setCategories] = useState<CategoryBuckets>(EMPTY_CATEGORY_BUCKETS);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(initialData?.cover_url ?? null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(initialData?.title ?? "");
    setDescription(initialData?.description ?? "");
    setSelectedRegion(initialData?.region_id ?? null);
    setSelectedEra(initialData?.era_id ?? null);
    setSelectedGenres(initialData?.genre_ids ?? []);
    setSelectedThemes(initialData?.theme_ids ?? []);
    setCoverUrl(initialData?.cover_url ?? null);
    setCoverFile(null);
    setCoverPreview(null);
    setIsPublic(initialData?.is_public ?? true);
  }, [initialData]);

  useEffect(() => {
    let isMounted = true;

    const loadCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);

      try {
        const categoriesUrl = withBackendOrigin("/api/categories");
        console.log("[PlaylistForm] Fetching categories from", categoriesUrl);
        if (!categoriesUrl) {
          throw new Error("Missing backend URL");
        }
        const response = await fetch(categoriesUrl, { credentials: "include" });
        if (!response.ok) {
          throw new Error(`Failed to fetch categories (${response.status})`);
        }
        const payload = (await response.json()) as Partial<CategoryBuckets>;
        if (!isMounted) return;
        setCategories({
          region: payload.region ?? [],
          era: payload.era ?? [],
          genre: payload.genre ?? [],
          theme: payload.theme ?? [],
          popularity: payload.popularity ?? [],
          special: payload.special ?? [],
        });
      } catch (error) {
        console.error("[PlaylistForm] Unable to load categories", error);
        if (isMounted) {
          setCategories(EMPTY_CATEGORY_BUCKETS);
          setCategoriesError("Unable to load categories right now.");
        }
      } finally {
        if (isMounted) {
          setCategoriesLoading(false);
        }
      }
    };

    loadCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!coverPreview) return undefined;
    return () => URL.revokeObjectURL(coverPreview);
  }, [coverPreview]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await validateCoverFile(file);
      setCoverFile(file);
      setCoverUrl(null);
      setCoverPreview(URL.createObjectURL(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid cover image.";
      toast.error(message);
      setFormError(message);
      event.target.value = "";
    }
  };

  const negotiateCoverUpload = useCallback(async (file: File): Promise<SignedCoverUploadResponse> => {
    const response = await fetchWithPiAuth("/api/studio/playlists/cover-upload-url", {
      method: "POST",
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });

    let payload: SignedCoverUploadResponse & { error?: string } | null = null;
    try {
      payload = (await response.json()) as SignedCoverUploadResponse & { error?: string };
    } catch (_) {
      payload = null;
    }

    if (!response.ok || !payload?.token || !payload?.path) {
      const message = payload?.error || "Unable to negotiate cover upload.";
      throw new Error(message);
    }

    return {
      bucket: payload.bucket,
      path: payload.path,
      token: payload.token,
      publicUrl: payload.publicUrl ?? null,
    };
  }, []);

  const uploadCoverIfNeeded = useCallback(async (): Promise<string | null> => {
    if (!coverFile) {
      return coverUrl;
    }

    const negotiation = await negotiateCoverUpload(coverFile);
    const { error } = await externalSupabase.storage
      .from(COVER_BUCKET)
      .uploadToSignedUrl(negotiation.path, negotiation.token, coverFile);

    if (error) {
      console.error("[PlaylistForm] Cover upload failed", error);
      throw new Error(error.message || "Unable to upload cover image. Please try again.");
    }

    if (negotiation.publicUrl) {
      return negotiation.publicUrl;
    }

    const { data: publicData } = externalSupabase.storage.from(COVER_BUCKET).getPublicUrl(negotiation.path);
    return publicData?.publicUrl ?? null;
  }, [coverFile, coverUrl, negotiateCoverUpload]);

  const buildCategoryPayload = (): CategoryPayload => {
    const normalizedGenres = Array.from(new Set(selectedGenres.filter((id) => typeof id === "number")));
    const normalizedThemes = Array.from(new Set(selectedThemes.filter((id) => typeof id === "number")));
    const uniqueAll = new Set<number>();
    if (typeof selectedRegion === "number") uniqueAll.add(selectedRegion);
    if (typeof selectedEra === "number") uniqueAll.add(selectedEra);
    normalizedGenres.forEach((id) => uniqueAll.add(id));
    normalizedThemes.forEach((id) => uniqueAll.add(id));

    return {
      region: selectedRegion ?? null,
      era: selectedEra ?? null,
      genres: normalizedGenres,
      themes: normalizedThemes,
      all: Array.from(uniqueAll),
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!title.trim()) {
      const message = "Playlist title is required.";
      setFormError(message);
      toast.error(message);
      return;
    }

    if (!selectedRegion) {
      const message = "Region is required.";
      setFormError(message);
      toast.error(message);
      return;
    }

    if (!selectedEra) {
      const message = "Era is required.";
      setFormError(message);
      toast.error(message);
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    try {
      const [uploadedCoverUrl, categoryPayload] = await Promise.all([
        uploadCoverIfNeeded(),
        Promise.resolve(buildCategoryPayload()),
      ]);

      const sanitizedRemoveTrackIds = Array.isArray(removeTrackIds) && removeTrackIds.length
        ? Array.from(new Set(removeTrackIds.map((id) => id.trim()).filter((id) => id.length > 0)))
        : [];

      await onSubmit({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        cover_url: uploadedCoverUrl,
        region_id: selectedRegion,
        era_id: selectedEra,
        genre_ids: categoryPayload.genres,
        theme_ids: categoryPayload.themes,
        category_groups: categoryPayload,
        is_public: isPublic,
        remove_track_ids: sanitizedRemoveTrackIds.length ? sanitizedRemoveTrackIds : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCover = coverPreview || coverUrl;
  const coverHint = coverFile ? `${(coverFile.size / 1024).toFixed(0)} KB • ${coverFile.type}` : null;
  const showCategoryStatus = categoriesLoading ? "Loading categories…" : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <section className="rounded-[18px] border border-white/10 bg-[rgba(20,17,38,0.55)] backdrop-blur-xl p-8 text-[#F3F1FF] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="flex flex-col gap-4">
            <div
              className="group relative h-[320px] w-[320px] cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[conic-gradient(from_140deg,rgba(246,198,109,0.45),rgba(124,58,237,0.45),rgba(246,198,109,0.45))] opacity-90 shadow-[0_0_30px_rgba(124,58,237,0.25)] transition duration-300 group-hover:shadow-[0_0_38px_rgba(124,58,237,0.35)]" />
              <div className="relative z-10 flex h-full w-full flex-col items-center justify-center rounded-[22px] border border-white/15 bg-[rgba(20,17,38,0.55)] backdrop-blur-xl text-center shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition duration-300 group-hover:border-[rgba(246,198,109,0.6)] group-hover:shadow-[0_0_34px_rgba(124,58,237,0.32)]">
                {currentCover ? (
                  <div className="relative h-full w-full overflow-hidden rounded-[22px]">
                    <img src={currentCover} alt="Cover preview" className="h-full w-full object-cover" />
                    {coverPreview ? (
                      <button
                        type="button"
                        className="absolute right-3 top-3 rounded-full bg-black/70 p-2 text-white"
                        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                          event.stopPropagation();
                          setCoverFile(null);
                          setCoverPreview(null);
                          setCoverUrl(initialData?.cover_url ?? null);
                        }}
                        aria-label="Remove selected cover"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 px-8 text-[#F3F1FF]">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 shadow-[0_0_24px_rgba(246,198,109,0.25)]">
                      <Upload className="h-7 w-7 text-[#F6C66D]" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Upload square cover</p>
                      <span className="text-xs text-[#B7B2CC]">PNG • JPG • WEBP</span>
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            </div>
            {afterCoverSlot ? <div className="w-full lg:w-56">{afterCoverSlot}</div> : null}
          </div>

          <div className="flex-1 space-y-5">
            <div className="space-y-2">
              <label htmlFor="playlist-title" className="text-sm uppercase tracking-wide text-white/70">
                Title
              </label>
              <input
                id="playlist-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Purple Midnight Energy"
                className="w-full rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-4 py-3 text-lg text-[#F3F1FF] placeholder:text-[#8B86A3] backdrop-blur-lg shadow-[0_14px_36px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,79,183,0.55)]"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="playlist-description" className="text-sm uppercase tracking-wide text-white/70">
                Description
              </label>
              <textarea
                id="playlist-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Tell your listeners what this playlist feels like..."
                rows={4}
                className="w-full rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-4 py-3 text-base text-[#F3F1FF] placeholder:text-[#8B86A3] backdrop-blur-lg shadow-[0_14px_36px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,79,183,0.55)]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm uppercase tracking-wide text-white/70">Visibility</label>
              <p className="text-xs text-white/60">Odaberi да ли се плејлиста појављује у претрази или остаје само у твом Library-ју.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[{ id: true, label: "Public", helper: "Vidljiva svima i појављује се у Search-у." }, { id: false, label: "Private", helper: "Види је само аутор у My Library секцији." }].map((option) => {
                  const active = isPublic === option.id;
                  return (
                    <button
                      key={String(option.id)}
                      type="button"
                      onClick={() => setIsPublic(option.id)}
                      className={`w-full rounded-[16px] border px-4 py-3 text-left transition backdrop-blur-lg shadow-[0_10px_28px_rgba(0,0,0,0.32)] ${
                        active
                          ? "border-[rgba(246,198,109,0.7)] bg-[rgba(246,198,109,0.08)] text-[#F3F1FF] shadow-[0_0_26px_rgba(246,198,109,0.25)]"
                          : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white/80 hover:border-[rgba(246,198,109,0.4)]"
                      }`}
                    >
                      <p className="font-semibold">{option.label}</p>
                      <p className="text-xs text-white/60">{option.helper}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {coverHint ? <p className="text-sm text-white/60">{coverHint}</p> : null}
          </div>
        </div>

        <div className="mt-10 space-y-3">
          {showCategoryStatus ? <p className="text-sm text-white/60">{showCategoryStatus}</p> : null}
          <div className="grid gap-6 md:grid-cols-2">
            <CategoryDropdown
              group="region"
              options={categories.region}
              loading={categoriesLoading}
              value={selectedRegion}
              onChange={(next) => setSelectedRegion(typeof next === "number" ? next : null)}
            />
            <CategoryDropdown
              group="era"
              options={categories.era}
              loading={categoriesLoading}
              value={selectedEra}
              onChange={(next) => setSelectedEra(typeof next === "number" ? next : null)}
            />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <CategoryDropdown
              group="genre"
              options={categories.genre}
              loading={categoriesLoading}
              value={selectedGenres}
              onChange={(next) => setSelectedGenres(Array.isArray(next) ? next : [])}
            />
            <CategoryDropdown
              group="theme"
              options={categories.theme}
              loading={categoriesLoading}
              value={selectedThemes}
              onChange={(next) => setSelectedThemes(Array.isArray(next) ? next : [])}
            />
          </div>
        </div>

        {categoriesError ? (
          <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {categoriesError}
          </div>
        ) : null}

        {formError ? (
          <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {formError}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-white/60">
            Public playlists appear in Search. Private ones stay yours until you share the link.
          </p>
          <button type="submit" disabled={isSubmitting} className="pm-cta-pill">
            <span className="pm-cta-pill-inner">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#FFD77A]" />
                  {mode === "create" ? "Creating..." : "Saving..."}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 stroke-[2.2] text-[#FFD77A]" />
                  {mode === "create" ? "Create playlist" : "Save changes"}
                </>
              )}
            </span>
          </button>
        </div>
      </section>
    </form>
  );
};

export default PlaylistForm;


type CategoryDropdownProps = {
  group: "region" | "era" | "genre" | "theme";
  options: CategoryRow[];
  loading: boolean;
  value: number | number[] | null;
  onChange: (value: number | number[] | null) => void;
};

const fallbackLabel = (id: number): string => `ID ${id}`;

function CategoryDropdown({ group, options, loading, value, onChange }: CategoryDropdownProps) {
  const config = CATEGORY_CONFIG[group];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const optionMap = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return;
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isMulti = config.multi;
  const isDisabled = loading || options.length === 0;

  const formatValue = useMemo(() => {
    if (isMulti) {
      const ids = Array.isArray(value) ? value : [];
      if (!ids.length) return config.placeholder;
      if (ids.length === 1) {
        return optionMap.get(ids[0])?.label ?? fallbackLabel(ids[0]);
      }
      return `${ids.length} selected`;
    }

    if (typeof value === "number") {
      return optionMap.get(value)?.label ?? fallbackLabel(value);
    }

    return config.placeholder;
  }, [isMulti, value, optionMap, config.placeholder]);

  const toggleMultiSelection = (id: number) => {
    if (!Array.isArray(value)) {
      onChange([id]);
      return;
    }
    if (value.includes(id)) {
      onChange(value.filter((existing) => existing !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const selectSingle = (id: number) => {
    if (!isMulti) {
      onChange(id);
      setOpen(false);
    }
  };

  const clearSelection = () => {
    if (isMulti) {
      onChange([]);
    } else {
      onChange(null);
    }
  };

  const chips = useMemo(() => {
    if (!isMulti || !Array.isArray(value) || !value.length) {
      return [] as CategoryRow[];
    }
    return value
      .map((id) => optionMap.get(id) ?? ({ id, label: fallbackLabel(id), name: fallbackLabel(id), group_type: null, key: null, group_key: null } as CategoryRow))
      .filter(Boolean);
  }, [isMulti, optionMap, value]);

  return (
    <div className="space-y-2 text-white">
      <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-wide text-white/70">{config.label}</p>
        {!config.required ? <span className="text-xs text-white/50">Optional</span> : null}
      </div>
      <div className="relative">
        <button
          type="button"
          ref={triggerRef}
          onClick={() => setOpen((prev) => !prev)}
          disabled={isDisabled}
          className="flex w-full items-center justify-between rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-4 py-3 text-left text-[#F3F1FF] backdrop-blur-lg shadow-[0_12px_28px_rgba(0,0,0,0.32)] outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,79,183,0.55)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{formatValue}</span>
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <div
            ref={panelRef}
            className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(20,17,38,0.95)] backdrop-blur-xl p-2 shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
          >
            {options.length === 0 ? (
              <p className="py-4 text-center text-sm text-white/60">No categories yet</p>
            ) : (
              <div className="space-y-1">
                {options.map((option) => {
                  const isChecked = isMulti
                    ? Array.isArray(value) && value.includes(option.id)
                    : typeof value === "number" && value === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[#F3F1FF] hover:bg-white/5"
                      onClick={() => (isMulti ? toggleMultiSelection(option.id) : selectSingle(option.id))}
                    >
                      {isMulti ? (
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            isChecked ? "border-yellow-300 bg-yellow-300/20" : "border-white/30"
                          }`}
                        >
                          {isChecked ? <Check className="h-3 w-3 text-yellow-300" /> : null}
                        </span>
                      ) : isChecked ? (
                        <CircleDot className="h-4 w-4 text-yellow-300" />
                      ) : (
                        <Circle className="h-4 w-4 text-white/50" />
                      )}
                      <span>{option.label?.trim() || option.name || fallbackLabel(option.id)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {isMulti && Array.isArray(value) && value.length > 0 ? (
              <button
                type="button"
                onClick={clearSelection}
                className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-center text-xs uppercase tracking-wide text-white/70 hover:bg-white/10"
              >
                Clear selection
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {config.helper ? <p className="text-xs text-white/60">{config.helper}</p> : null}
      {chips.length ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggleMultiSelection(chip.id)}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
            >
              {chip.label?.trim() || chip.name || fallbackLabel(chip.id)}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
