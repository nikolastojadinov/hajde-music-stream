import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePi } from "@/contexts/PiContext";
import { externalSupabase } from "@/lib/externalSupabase";

const CreatePlaylist = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user, loading } = usePi();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("enter_playlist_name"));
      return;
    }

    if (!user?.uid) {
      toast.error("Morate biti prijavljeni da biste kreirali plejlistu");
      return;
    }

    setIsCreating(true);
    
    try {
      const { data, error } = await externalSupabase
        .from("playlists")
        .insert({
          title: name.trim(),
          description: description.trim() || null,
          cover_url: imageUrl.trim() || null,
          owner_id: user.uid,
          category: "user-created",
        })
        .select()
        .single();

      if (error) {
        console.error("❌ Error creating playlist:", error);
        toast.error("Greška pri kreiranju plejliste");
        return;
      }

      toast.success(t("playlist_created"));
      navigate(`/playlist/${data.id}`);
    } catch (error) {
      console.error("❌ Exception creating playlist:", error);
      toast.error("Greška pri kreiranju plejliste");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8 max-w-2xl mx-auto animate-fade-in">
        {/* Header */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-5 h-5" />
          {t("back")}
        </button>

        <h1 className="text-4xl font-bold mb-8 text-foreground">
          {t("create_new_playlist")}
        </h1>

        <div className="space-y-8">
          {/* Image Upload */}
          <div className="flex gap-6 items-start">
            <div className="w-48 h-48 rounded-lg bg-secondary border-2 border-dashed border-border hover:border-primary transition-colors cursor-pointer flex items-center justify-center group">
              <div className="text-center">
                <Upload className="w-12 h-12 text-muted-foreground group-hover:text-primary transition-colors mx-auto mb-2" />
                <p className="text-sm text-muted-foreground group-hover:text-primary transition-colors">
                  {t("add_image")}
                </p>
              </div>
            </div>

            <div className="flex-1 space-y-6">
              {/* Name Input */}
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-semibold">
                  {t("playlist_name")}
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder={t("my_playlist")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 bg-secondary border-border text-foreground"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-semibold">
                  {t("description_optional")}
                </label>
                <Textarea
                  id="description"
                  placeholder={t("add_description")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-32 bg-secondary border-border text-foreground resize-none"
                />
              </div>

              {/* Image URL */}
              <div className="space-y-2">
                <label htmlFor="imageUrl" className="text-sm font-semibold">
                  URL slike (opciono)
                </label>
                <Input
                  id="imageUrl"
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="h-12 bg-secondary border-border text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-8">
            <Button
              onClick={handleCreate}
              disabled={isCreating || !name.trim()}
              className="bg-primary text-foreground hover:bg-primary/90 font-semibold px-8"
            >
              {isCreating || loading ? t("creating") || "Kreiranje..." : t("create_playlist_btn")}
            </Button>
            <Button
              onClick={() => navigate(-1)}
              variant="outline"
              disabled={isCreating}
              className="border-border hover:bg-secondary"
            >
              {t("cancel")}
            </Button>
          </div>

          {/* Info */}
          <div className="pt-6 border-t border-border">
            <h3 className="font-semibold mb-4">{t("notes")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>{t("note_1")}</li>
              <li>{t("note_2")}</li>
              <li>{t("note_3")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreatePlaylist;
