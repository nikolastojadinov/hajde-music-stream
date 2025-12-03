"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Loader2, Upload, X, Check, ChevronDown } from "lucide-react";

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

export type PlaylistFormSubmitPayload = {
  title: string;
  description: string | null;
  cover_url: string | null;
  region_id: number;
  era_id: number;
  genre_ids: number[];
  theme_ids: number[];
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

export default function PlaylistForm({ mode, userId, initialData, onSubmit }: PlaylistFormProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [regionId, setRegionId] = useState<number | null>(initialData?.region_id ?? null);
  const [eraId, setEraId] = useState<number | null>(initialData?.era_id ?? null);
  const [genreIds, setGenreIds] = useState<number[]>(initialData?.genre_ids ?? []);
  const [themeIds, setThemeIds] = useState<number[]>(initialData?.theme_ids ?? []);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(initialData?.cover_url ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [categories, setCategories] = useState<{
    regions: CategoryOption[];
    eras: CategoryOption[];
    genres: CategoryOption[];
    themes: CategoryOption[];
  }>({ regions: [], eras: [], genres: [], themes: [] });
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(initialData?.title ?? "");
    setDescription(initialData?.description ?? "");
    setRegionId(initialData?.region_id ?? null);
    setEraId(initialData?.era_id ?? null);
    setGenreIds(initialData?.genre_ids ?? []);
    setThemeIds(initialData?.theme_ids ?? []);
    setCoverUrl(initialData?.cover_url ?? null);
    setCoverFile(null);
    setCoverPreview(null);
  }, [initialData]);

  useEffect(() => {
    let isMounted = true;
    const loadCategories = async () => {
      setCategoriesLoading(true);
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,label,group_type");

      if (!isMounted) return;

      if (error) {
        console.error("Failed to load categories", error);
        setFormError(error.message || "Unable to load categories.");
        setCategoriesLoading(false);
        return;
      }

      const normalized = (data ?? []).map((item) => {
        const rawId = typeof item.id === "string" ? parseInt(item.id, 10) : item.id;
        return {
          id: Number(rawId),
          name: item.name,
          label: item.label ?? item.name,
          group_type: (item.group_type || "genre") as CategoryGroup,
        };
      });

      const byGroup = {
        regions: normalized.filter((item) => item.group_type === "region"),
        eras: normalized.filter((item) => item.group_type === "era"),
        genres: normalized.filter((item) => item.group_type === "genre"),
        themes: normalized.filter((item) => item.group_type === "theme"),
      };

      setCategories(byGroup);
      setCategoriesLoading(false);
    };

    loadCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverUrl(null);
    setCoverPreview(URL.createObjectURL(file));
  };

  const uploadCoverIfNeeded = async (): Promise<string | null> => {
    if (!coverFile) {
      return coverUrl;
    }

    const extension = coverFile.name.split(".").pop() || "jpg";
    const objectPath = `covers/${userId}-${Date.now()}.${extension}`;
    const { data, error } = await supabase.storage.from(COVER_BUCKET).upload(objectPath, coverFile, {
      cacheControl: "3600",
      contentType: coverFile.type,
    });

    if (error || !data) {
      console.error("Cover upload failed", error);
      throw new Error(error?.message || "Unable to upload cover image. Please try again.");
    }

    const { data: publicData } = supabase.storage.from(COVER_BUCKET).getPublicUrl(data.path);
    return publicData?.publicUrl ?? null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!title.trim()) {
      const message = "Playlist title is required.";
      setFormError(message);
      toast.error(message);
      return;
    }

    if (!regionId) {
      const message = "Please pick a region.";
      setFormError(message);
      toast.error(message);
      return;
    }

    if (!eraId) {
      const message = "Please pick an era.";
      setFormError(message);
      toast.error(message);
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    try {
      const uploadedCoverUrl = await uploadCoverIfNeeded();
      await onSubmit({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        cover_url: uploadedCoverUrl,
        region_id: regionId,
        era_id: eraId,
        genre_ids: genreIds,
        theme_ids: themeIds,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
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
                    onClick={(event) => {
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

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <SingleSelectField
            id="playlist-region"
            label="Region"
            placeholder="Select region"
            value={regionId}
            onChange={setRegionId}
            disabled={categoriesLoading}
            options={categories.regions}
          />

          <SingleSelectField
            id="playlist-era"
            label="Era"
            placeholder="Select era"
            value={eraId}
            onChange={setEraId}
            disabled={categoriesLoading}
            options={categories.eras}
          />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <MultiSelectField
            label="Genres"
            placeholder="Pick genres"
            options={categories.genres}
            selectedIds={genreIds}
            onChange={setGenreIds}
          />
          <MultiSelectField
            label="Themes"
            placeholder="Pick themes"
            options={categories.themes}
            selectedIds={themeIds}
            onChange={setThemeIds}
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
            ) : (
              mode === "create" ? "Create playlist" : "Save changes"
            )}
          </button>
        </div>
      </section>
    </form>
  );
}

type SingleSelectFieldProps = {
  id: string;
  label: string;
  placeholder: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  options: CategoryOption[];
};

function SingleSelectField({ id, label, placeholder, value, onChange, disabled, options }: SingleSelectFieldProps) {
  return (
    <div className="space-y-2 text-white">
      <label htmlFor={id} className="text-sm uppercase tracking-wide text-white/70">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
          disabled={disabled}
          className="w-full appearance-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3 pr-10 text-white outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40 disabled:opacity-50"
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id} className="text-black">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
      </div>
    </div>
  );
}

type MultiSelectFieldProps = {
  label: string;
  placeholder: string;
  options: CategoryOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
};

function MultiSelectField({ label, placeholder, options, selectedIds, onChange }: MultiSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionMap = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  useEffect(() => {
    const handleClickAway = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, []);

  const toggleOption = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((value) => value !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-2 text-white" ref={containerRef}>
      <p className="text-sm uppercase tracking-wide text-white/70">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-white outline-none focus:border-yellow-300 focus:ring-2 focus:ring-yellow-400/40"
      >
        <span>{selectedIds.length ? `${selectedIds.length} selected` : placeholder}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="relative">
          <div className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-white/10 bg-[#120725] p-2 shadow-2xl">
            {options.length === 0 ? (
              <p className="py-4 text-center text-sm text-white/60">No options</p>
            ) : (
              options.map((option) => {
                const checked = selectedIds.includes(option.id);
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => toggleOption(option.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        checked ? "border-yellow-300 bg-yellow-300/20" : "border-white/30"
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3 text-yellow-300" /> : null}
                    </span>
                    <span>{option.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {selectedIds.length ? (
        <div className="flex flex-wrap gap-2">
          {selectedIds.map((id) => (
            <span key={id} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white">
              {optionMap.get(id)?.label ?? id}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
