import { Home, Search, Plus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

const Footer = () => {
  const location = useLocation();
  const { t } = useLanguage();
  const isActive = (path: string) => location.pathname === path;

  const nav = [
    { name: t("home"), path: "/", icon: Home },
    { name: t("create"), path: "/create", icon: Plus },
    { name: t("search"), path: "/search", icon: Search },
  ];

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 bg-[rgba(14,12,22,0.88)] backdrop-blur-2xl border-t border-white/10 h-[76px]">
      <div className="mx-auto flex h-full max-w-4xl items-center justify-around px-4 md:px-6">
        {nav.map((item) => {
          const active = isActive(item.path);
          const isCreate = item.path === "/create";
          if (isCreate) {
            return (
              <Link
                key={item.path}
                to={item.path}
                className="-mt-4 flex h-[54px] w-[54px] items-center justify-center rounded-full bg-gradient-to-r from-[#FF4FB7] to-[#A855F7] text-[#0B0814] shadow-lg shadow-[#FF4FB7]/30 ring-4 ring-black/20 transition-transform hover:scale-105 active:scale-95"
                aria-label={item.name}
              >
                <item.icon className="h-6 w-6" />
              </Link>
            );
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-1 px-4 py-2 text-xs font-semibold transition-all",
                active
                  ? "text-[#F6C66D] drop-shadow-[0_0_12px_rgba(246,198,109,0.25)]"
                  : "text-[#CFA85B] hover:text-[#F6C66D]"
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border border-white/10",
                  active ? "bg-white/5 shadow-lg shadow-[#F6C66D]/20" : "bg-white/0"
                )}
              >
                <item.icon className="h-5 w-5" />
              </div>
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </footer>
  );
};

export default Footer;
