import { Home, Search, Library, Plus, Heart } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const Sidebar = () => {
  const location = useLocation();
  
  const isActive = (path: string) => location.pathname === path;
  
  const mainNav = [
    { name: "Početna", path: "/", icon: Home },
    { name: "Pretraži", path: "/search", icon: Search },
    { name: "Biblioteka", path: "/library", icon: Library },
  ];
  
  const playlists = [
    { id: 1, name: "Moja Plejlista #1" },
    { id: 2, name: "Chill Vibes" },
    { id: 3, name: "Workout Mix" },
    { id: 4, name: "Party Hits" },
  ];

  return (
    <div className="w-64 bg-background border-r border-border flex flex-col h-full">
      <div className="p-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          MusicStream
        </h1>
      </div>
      
      <nav className="flex-1 px-3 space-y-1">
        {mainNav.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-4 px-3 py-3 rounded-lg transition-all duration-200",
              isActive(item.path)
                ? "bg-secondary text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <item.icon className="w-6 h-6" />
            <span>{item.name}</span>
          </Link>
        ))}
        
        <div className="pt-6 pb-4">
          <Link
            to="/create-playlist"
            className="flex items-center gap-4 px-3 py-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all w-full"
          >
            <Plus className="w-6 h-6" />
            <span>Napravi plejlistu</span>
          </Link>
          
          <Link
            to="/favorites"
            className="flex items-center gap-4 px-3 py-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all w-full"
          >
            <Heart className="w-6 h-6" />
            <span>Omiljene pesme</span>
          </Link>
        </div>
        
        <div className="border-t border-border pt-4">
          <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Plejliste
          </h3>
          <div className="space-y-1">
            {playlists.map((playlist) => (
              <Link
                key={playlist.id}
                to={`/playlist/${playlist.id}`}
                className="block px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all"
              >
                {playlist.name}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
};

export default Sidebar;
