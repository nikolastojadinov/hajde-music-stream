import { Home, Search, Library, Plus, Heart } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

const Footer = () => {
  const location = useLocation();
  const { t } = useLanguage();
  const isActive = (path: string) => location.pathname === path;

  // Desktop navigation
  const desktopNav = [
    { name: t("home"), path: "/", icon: Home },
    { name: t("search"), path: "/search", icon: Search },
    { name: t("library"), path: "/library", icon: Library },
  ];

  // Mobile navigation
  const mobileNav = [
    { name: t("home"), path: "/", icon: Home },
    { name: t("create"), path: "/create-playlist", icon: Plus },
    { name: t("favorites"), path: "/favorites", icon: Heart },
    { name: t("library"), path: "/library", icon: Library },
  ];

  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border/50 z-40">
      {/* Desktop version */}
      <div className="hidden md:flex items-center justify-start gap-2 px-8 py-4">
        {desktopNav.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-3 px-4 py-2 rounded-lg transition-all duration-200",
              isActive(item.path)
                ? "bg-secondary text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.name}</span>
          </Link>
        ))}
      </div>

      {/* Mobile version */}
      <div className="flex md:hidden items-center justify-around px-4 py-3">
        {mobileNav.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200",
              isActive(item.path)
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <item.icon className="w-6 h-6" />
            <span className="text-xs font-medium">{item.name}</span>
          </Link>
        ))}
      </div>
    </footer>
  );
};

export default Footer;
