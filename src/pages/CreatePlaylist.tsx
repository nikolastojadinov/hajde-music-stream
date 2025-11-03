import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const CreatePlaylist = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("Unesite naziv plejliste");
      return;
    }
    
    toast.success("Plejlista kreirana!");
    navigate("/library");
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
          Nazad
        </button>

        <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
          Napravi novu plejlistu
        </h1>

        <div className="space-y-8">
          {/* Image Upload */}
          <div className="flex gap-6 items-start">
            <div className="w-48 h-48 rounded-lg bg-secondary border-2 border-dashed border-border hover:border-primary transition-colors cursor-pointer flex items-center justify-center group">
              <div className="text-center">
                <Upload className="w-12 h-12 text-muted-foreground group-hover:text-primary transition-colors mx-auto mb-2" />
                <p className="text-sm text-muted-foreground group-hover:text-primary transition-colors">
                  Dodaj sliku
                </p>
              </div>
            </div>

            <div className="flex-1 space-y-6">
              {/* Name Input */}
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-semibold">
                  Naziv plejliste
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Moja Plejlista"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 bg-secondary border-border text-foreground"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-semibold">
                  Opis (opciono)
                </label>
                <Textarea
                  id="description"
                  placeholder="Dodaj opis plejliste..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-32 bg-secondary border-border text-foreground resize-none"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-8">
            <Button
              onClick={handleCreate}
              className="bg-primary text-background hover:bg-primary/90 font-semibold px-8"
            >
              Kreiraj plejlistu
            </Button>
            <Button
              onClick={() => navigate(-1)}
              variant="outline"
              className="border-border hover:bg-secondary"
            >
              Otkaži
            </Button>
          </div>

          {/* Info */}
          <div className="pt-6 border-t border-border">
            <h3 className="font-semibold mb-4">Napomene:</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• Nakon kreiranja možete dodavati pesme u plejlistu</li>
              <li>• Plejlista će biti privatna dok je ne podelite</li>
              <li>• Možete je uvek urediti ili obrisati kasnije</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreatePlaylist;
