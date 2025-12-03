"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Check, ChevronDown, Circle, CircleDot, Loader2, Upload, X } from "lucide-react";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be defined");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const COVER_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_PLAYLISTS_BUCKET || "playlists-covers";

type CategoryGroup = "region" | "genre" | "era" | "theme";

type CategoryOption = {
  id: number;
  name: string;
  label: string;
  group_type: CategoryGroup;
};

type CategoryCollections = Record<CategoryGroup, CategoryOption[]>;

type SupabaseCategoryRow = {
  id: number | string;
  name: string;
  label: string | null;
  group_type: CategoryGroup | null;
};

type CategoryPayload = {
  region: number;
  era: number;
  genres: number[];
  themes: number[];
  all: number[];
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
};

export type PlaylistFormProps = {
  mode: "create" | "edit";
  userId: string;
  initialData?: PlaylistFormInitialData;
  onSubmit: (payload: PlaylistFormSubmitPayload) => Promise<void>;
};

const CATEGORY_CONFIG: Record<CategoryGroup, { label: string; placeholder: string; multi: boolean; helper?: string; required: boolean }> = {
  region: {
    label: "Region",
    placeholder: "Select region",
    multi: false,
    helper: "Listeners find playlists faster when they are tied to a home region.",
    required: true,
  },
  era: {
    label: "Era",
    placeholder: "Select era",
    multi: false,
    helper: "Pick the dominant timeframe for this playlist.",
    required: true,
  },
  genre: {
    label: "Genres",
    placeholder: "Pick genres",
    multi: true,
    helper: "You can choose multiple genres to capture the blend.",
    required: false,
  },
  theme: {
    label: "Themes",
    placeholder: "Pick themes",
    multi: true,
    helper: "Themes are optional, but help with storytelling.",
    required: false,
  },
};

export default function PlaylistForm({ mode, userId, initialData, onSubmit }: PlaylistFormProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [selectedRegion, setSelectedRegion] = useState<number | null>(initialData?.region_id ?? null);
  const [selectedEra, setSelectedEra] = useState<number | null>(initialData?.era_id ?? null);
  const [selectedGenres, setSelectedGenres] = useState<number[]>(initialData?.genre_ids ?? []);
  const [selectedThemes, setSelectedThemes] = useState<number[]>(initialData?.theme_ids ?? []);
  const [categories, setCategories] = useState<CategoryCollections>({ region: [], era: [], genre: [], theme: [] });
  const [categoriesLoading, setCategoriesLoading] = useState(true);
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
  }, [initialData]);

  useEffect(() => {
    let isMounted = true;
    const loadCategories = async () => {
      setCategoriesLoading(true);
      const { data, error } = await supabase.from("categories").select("id,name,label,group_type");

      if (!isMounted) {
        return;
      }

      if (error) {
        console.error("Failed to load categories", error);
        setFormError(error.message || "Unable to load categories.");
        setCategoriesLoading(false);
        return;
      }

      const collections: CategoryCollections = { region: [], era: [], genre: [], theme: [] };
      const rows = (data ?? []) as SupabaseCategoryRow[];
      rows.forEach((entry) => {
        const parsedId = typeof entry.id === "string" ? Number(entry.id) : entry.id;
        if (!parsedId || Number.isNaN(parsedId)) {
          return;
        }
        const normalizedGroup: CategoryGroup = entry.group_type ?? "genre";
        const option: CategoryOption = {
          id: parsedId,
          name: entry.name,
          label: entry.label || entry.name,
          group_type: normalizedGroup,
        };
        collections[normalizedGroup] = [...collections[normalizedGroup], option];
      });

      const sortOptions = (list: CategoryOption[]) => [...list].sort((a, b) => a.label.localeCompare(b.label));
      setCategories({
        region: sortOptions(collections.region),
        era: sortOptions(collections.era),
        genre: sortOptions(collections.genre),
        theme: sortOptions(collections.theme),
      });
      setCategoriesLoading(false);
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setCoverFile(file);
    setCoverUrl(null);
    setCoverPreview(URL.createObjectURL(file));
  };

  const uploadCoverIfNeeded = useCallback(async (): Promise<string | null> => {
    if (!coverFile) {
      return coverUrl;
    }

    const extension = coverFile.name.split(".").pop() || "jpg";
    const objectPath = `covers/${userId}-${Date.now()}.${extension}`;
    const { data, error } = await supabase.storage.from(COVER_BUCKET).upload(objectPath, coverFile, {
      cacheControl: "3600",
      contentType: coverFile.type,
      upsert: true,
    });

    if (error || !data) {
      console.error("Cover upload failed", error);
      throw new Error(error?.message || "Unable to upload cover image. Please try again.");
    }

    const { data: publicData } = supabase.storage.from(COVER_BUCKET).getPublicUrl(data.path);
    return publicData?.publicUrl ?? null;
  }, [coverFile, coverUrl, userId]);

  const buildCategoryPayload = (): CategoryPayload => {
    if (!selectedRegion || !selectedEra) {
      throw new Error("Region and Era selection is required.");
    }
    const combined = Array.from(
      new Set<number>([
        selectedRegion,
        selectedEra,
        ...selectedGenres,
        ...selectedThemes,
      ].filter((value): value is number => typeof value === "number" && !Number.isNaN(value))),
    );
    return {
      region: selectedRegion,
      era: selectedEra,
      genres: selectedGenres,
      themes: selectedThemes,
      all: combined,
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
      await onSubmit({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        cover_url: uploadedCoverUrl,
        region_id: categoryPayload.region,
        era_id: categoryPayload.era,
        genre_ids: categoryPayload.genres,
        theme_ids: categoryPayload.themes,
        category_groups: categoryPayload,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 text-white shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <div className="flex flex-col gap-8 lg:flex-row">
          <div
            className="flex h-56 w-56 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/30 bg-black/30 text-center transition hover:border-yellow-300/70"
            onClick={() => fileInputRef.current?.click()}
          >
            {currentCover ? (
              <div className="relative h-full w-full">
                <img src={currentCover} alt="Cover preview" className="h-full w-full rounded-3xl object-cover" />
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
              <>
                <Upload className="mb-3 h-10 w-10 text-yellow-300" />
                <p className="text-sm">Upload square cover</p>
                <span className="text-xs text-white/60">PNG • JPG • WEBP</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
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
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-lg text-white outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40"
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
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-base text-white outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40"
              />
            </div>

            {coverHint ? <p className="text-sm text-white/60">{coverHint}</p> : null}
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
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

        <div className="mt-8 grid gap-6 md:grid-cols-2">
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

        {formError ? (
          <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {formError}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-white/60">
            Public playlists appear in Search. Private ones stay yours until you share the link.
          </p>
          <button
            type="submit"
            disabled={isSubmitting || categoriesLoading}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-yellow-300 via-yellow-400 to-orange-400 px-6 py-3 font-semibold text-black shadow-lg shadow-yellow-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {mode === "create" ? "Creating..." : "Saving..."}
              </>
            ) : mode === "create" ? (
              "Create playlist"
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </section>
    </form>
  );
}

type CategoryDropdownProps = {
  group: CategoryGroup;
  options: CategoryOption[];
  loading: boolean;
  value: number | number[] | null;
  onChange: (value: number | number[] | null) => void;
};

function CategoryDropdown({ group, options, loading, value, onChange }: CategoryDropdownProps) {
  const config = CATEGORY_CONFIG[group];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const optionMap = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) {
        return;
      }
      if (panelRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isMulti = config.multi;
  const isDisabled = loading || options.length === 0;

  const displayValue = useMemo(() => {
    if (isMulti) {
      const ids = Array.isArray(value) ? value : [];
      if (!ids.length) {
        return config.placeholder;
      }
      if (ids.length === 1) {
        return optionMap.get(ids[0])?.label ?? config.placeholder;
      }
      return `${ids.length} selected`;
    }

    if (typeof value === "number" && optionMap.has(value)) {
      return optionMap.get(value)?.label ?? config.placeholder;
    }

    return config.placeholder;
  }, [config.placeholder, isMulti, optionMap, value]);

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
    if (!isMulti) {
      return [] as CategoryOption[];
    }
    if (!Array.isArray(value) || value.length === 0) {
      return [] as CategoryOption[];
    }
    return value.map((id) => optionMap.get(id)).filter(Boolean) as CategoryOption[];
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
          className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-white outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{displayValue}</span>
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <div
            ref={panelRef}
            className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-white/10 bg-[#120725] p-2 shadow-2xl"
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
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5"
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
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {Array.isArray(value) && value.length > 0 ? (
              <button
                type="button"
                onClick={clearSelection}
                className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-center text-xs uppercase tracking-wide text-white/70 hover:bg-white/5"
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
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
