// CLEANUP DIRECTIVE: Backend-only category loading with conditional payload emission.
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
import { toast } from "sonner";
import { Check, ChevronDown, Circle, CircleDot, Loader2, Upload, X } from "lucide-react";
import { externalSupabase } from "@/lib/externalSupabase";
import { withBackendOrigin } from "@/lib/backendUrl";

const COVER_BUCKET = import.meta.env.VITE_SUPABASE_PLAYLISTS_BUCKET || "playlists-covers";

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

export type CategoryPayload = {
  region: number | null;
  era: number | null;
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
  category_groups?: CategoryPayload;
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

const PlaylistForm = ({ mode, userId, initialData, onSubmit }: PlaylistFormProps) => {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [selectedRegion, setSelectedRegion] = useState<number | null>(initialData?.region_id ?? null);
  const [selectedEra, setSelectedEra] = useState<number | null>(initialData?.era_id ?? null);
  const [selectedGenres, setSelectedGenres] = useState<number[]>(initialData?.genre_ids ?? []);
  const [selectedThemes, setSelectedThemes] = useState<number[]>(initialData?.theme_ids ?? []);
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
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
    const { data, error } = await externalSupabase.storage.from(COVER_BUCKET).upload(objectPath, coverFile, {
      cacheControl: "3600",
      contentType: coverFile.type,
      upsert: true,
    });

    if (error || !data) {
      console.error("[PlaylistForm] Cover upload failed", error);
      throw new Error(error?.message || "Unable to upload cover image. Please try again.");
    }

    const { data: publicData } = externalSupabase.storage.from(COVER_BUCKET).getPublicUrl(data.path);
    return publicData?.publicUrl ?? null;
  }, [coverFile, coverUrl, userId]);

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
      const categoryPayload = buildCategoryPayload();
      const normalizedCategoryGroups = categoryPayload.all.length > 0 ? categoryPayload : undefined;
      const [uploadedCoverUrl] = await Promise.all([uploadCoverIfNeeded()]);

      await onSubmit({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        cover_url: uploadedCoverUrl,
        region_id: selectedRegion,
        era_id: selectedEra,
        genre_ids: categoryPayload.genres,
        theme_ids: categoryPayload.themes,
        category_groups: normalizedCategoryGroups,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCover = coverPreview ?? coverUrl;

  const resetCover = () => {
    setCoverFile(null);
    setCoverPreview(null);
    setCoverUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formDescription =
    mode === "create"
      ? "Curate a new playlist and publish it to Hajde Studio. Make sure you select the best matching categories, so listeners can find it quickly."
      : "Update your playlist details. Changes instantly sync across Hajde Studio experiences.";

  return (
    <form className="space-y-8" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <div>
          <p className="text-sm text-neutral-11">{formDescription}</p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-neutral-12">
              Playlist cover
            </label>
            <CoverUploader
              currentCover={currentCover}
              isSubmitting={isSubmitting}
              isLoading={categoriesLoading}
              onRemove={resetCover}
              onFileChange={handleFileChange}
              fileInputRef={fileInputRef}
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-12">Title *</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-neutral-6 bg-neutral-2 p-2 text-sm text-neutral-12 focus:border-primary focus:outline-none"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Balkan Sunrise"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-12">Description</label>
              <textarea
                className="mt-1 w-full rounded-md border border-neutral-6 bg-neutral-2 p-2 text-sm text-neutral-12 focus:border-primary focus:outline-none"
                rows={4}
                value={description ?? ""}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the mood, story, or inspiration behind this playlist."
              />
              <p className="mt-2 text-xs text-neutral-9">Optional but recommended.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-neutral-12">Categories</p>
            {categoriesLoading ? (
              <span className="inline-flex items-center gap-1 text-xs text-neutral-9">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading categories
              </span>
            ) : categoriesError ? (
              <span className="text-xs text-destructive">{categoriesError}</span>
            ) : null}
          </div>
          <p className="text-xs text-neutral-9">
            Categories help us bucket playlists properly. Required fields are marked with a *.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <CategoryDropdown
            label={CATEGORY_CONFIG.region.label}
            helper={CATEGORY_CONFIG.region.helper}
            placeholder={CATEGORY_CONFIG.region.placeholder}
            options={categories.region}
            multiSelect={false}
            required
            selectedValue={selectedRegion}
            onChange={(value) => setSelectedRegion(value as number | null)}
            disabled={categoriesLoading || !!categoriesError}
          />

          <CategoryDropdown
            label={CATEGORY_CONFIG.era.label}
            helper={CATEGORY_CONFIG.era.helper}
            placeholder={CATEGORY_CONFIG.era.placeholder}
            options={categories.era}
            multiSelect={false}
            required
            selectedValue={selectedEra}
            onChange={(value) => setSelectedEra(value as number | null)}
            disabled={categoriesLoading || !!categoriesError}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <CategoryDropdown
            label={CATEGORY_CONFIG.genre.label}
            helper={CATEGORY_CONFIG.genre.helper}
            placeholder={CATEGORY_CONFIG.genre.placeholder}
            options={categories.genre}
            multiSelect
            selectedValue={selectedGenres}
            onChange={(value) => setSelectedGenres(value as number[])}
            disabled={categoriesLoading || !!categoriesError}
          />

          <CategoryDropdown
            label={CATEGORY_CONFIG.theme.label}
            helper={CATEGORY_CONFIG.theme.helper}
            placeholder={CATEGORY_CONFIG.theme.placeholder}
            options={categories.theme}
            multiSelect
            selectedValue={selectedThemes}
            onChange={(value) => setSelectedThemes(value as number[])}
            disabled={categoriesLoading || !!categoriesError}
          />
        </div>
      </div>

      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isSubmitting || categoriesLoading}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-neutral-1 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {mode === "create" ? "Publish playlist" : "Save changes"}
        </button>

        <div className="text-xs text-neutral-9">
          Required fields are marked with a * symbol.
        </div>
      </div>
    </form>
  );
};

const CoverUploader = ({
  currentCover,
  isSubmitting,
  isLoading,
  onRemove,
  onFileChange,
  fileInputRef,
}: {
  currentCover: string | null;
  isSubmitting: boolean;
  isLoading: boolean;
  onRemove: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) => {
  return (
    <div className="rounded-lg border border-dashed border-neutral-6 p-4">
      <div className="flex items-center gap-4">
        {currentCover ? (
          <div className="relative h-24 w-24 overflow-hidden rounded-md">
            <img src={currentCover} alt="Playlist cover preview" className="h-full w-full object-cover" />
            <button
              type="button"
              className="absolute right-1 top-1 rounded-full bg-neutral-1/80 p-1 text-neutral-12 shadow"
              disabled={isSubmitting}
              onClick={onRemove}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-md bg-neutral-3 text-neutral-9">
            <Upload className="h-6 w-6" />
          </div>
        )}

        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-neutral-12">Playlist artwork</p>
          <p className="text-xs text-neutral-9">Recommended size: 512x512px. JPEG or PNG.</p>

          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-6 px-3 py-1.5 text-xs font-medium text-neutral-12 transition hover:border-neutral-8">
              <Upload className="h-4 w-4" />
              Upload file
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={isSubmitting || isLoading}
                onChange={onFileChange}
              />
            </label>
            {currentCover ? (
              <button
                type="button"
                className="text-xs text-neutral-9 underline"
                disabled={isSubmitting}
                onClick={onRemove}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

const CategoryDropdown = ({
  label,
  helper,
  placeholder,
  options,
  multiSelect,
  required,
  selectedValue,
  onChange,
  disabled,
}: CategoryDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => setIsOpen((prev) => !prev);

  const closeMenu = () => setIsOpen(false);

  const handleOptionClick = (event: ReactMouseEvent<HTMLButtonElement>, optionId: number) => {
    event.preventDefault();
    event.stopPropagation();

    if (multiSelect) {
      const current = Array.isArray(selectedValue) ? selectedValue : [];
      const exists = current.includes(optionId);
      const updated = exists ? current.filter((id) => id !== optionId) : [...current, optionId];
      onChange(updated);
    } else {
      onChange(optionId === selectedValue ? null : optionId);
      closeMenu();
    }
  };

  const displayLabel = useMemo(() => {
    if (multiSelect) {
      const selectedIds = Array.isArray(selectedValue) ? selectedValue : [];
      if (selectedIds.length === 0) return placeholder;
      if (selectedIds.length === 1) {
        const option = options.find((opt) => opt.id === selectedIds[0]);
        return option?.label ?? placeholder;
      }
      return `${selectedIds.length} selected`;
    }

    if (typeof selectedValue === "number") {
      return options.find((opt) => opt.id === selectedValue)?.label ?? placeholder;
    }

    return placeholder;
  }, [multiSelect, options, placeholder, selectedValue]);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-12">
        {label} {required ? "*" : null}
      </label>
      {helper ? <p className="text-xs text-neutral-9">{helper}</p> : null}

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-md border border-neutral-6 bg-neutral-2 px-3 py-2 text-left text-sm text-neutral-12 focus:border-primary focus:outline-none disabled:cursor-not-allowed"
        >
          <span className={displayLabel === placeholder ? "text-neutral-9" : ""}>{displayLabel}</span>
          <ChevronDown className="h-4 w-4" />
        </button>

        {isOpen ? (
          <div className="absolute z-10 mt-2 w-full rounded-md border border-neutral-6 bg-neutral-1 shadow-lg">
            <div className="max-h-56 overflow-y-auto p-2 text-sm">
              {options.length === 0 ? (
                <p className="px-3 py-2 text-xs text-neutral-9">No options available.</p>
              ) : (
                options.map((option) => {
                  const isSelected = multiSelect
                    ? Array.isArray(selectedValue) && selectedValue.includes(option.id)
                    : selectedValue === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={(event) => handleOptionClick(event, option.id)}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-neutral-3"
                    >
                      {multiSelect ? (
                        isSelected ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )
                      ) : isSelected ? (
                        <CircleDot className="h-4 w-4" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                      <span>{option.label ?? option.name}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="border-t border-neutral-6 p-2 text-right">
              <button type="button" className="text-xs text-neutral-9 underline" onClick={closeMenu}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

type CategoryDropdownProps = {
  label: string;
  helper?: string;
  placeholder: string;
  options: CategoryRow[];
  multiSelect: boolean;
  required?: boolean;
  selectedValue: number | number[] | null;
  onChange: (value: number | number[] | null) => void;
  disabled?: boolean;
};

export default PlaylistForm;
