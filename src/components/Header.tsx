import { User, Globe, Shield, FileText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import appLogo from "@/assets/app-logo.png";
import { useLanguage, languages } from "@/contexts/LanguageContext";
import { useState } from "react";

const Header = () => {
  const { t, setLanguage, currentLanguage } = useLanguage();
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  
  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-background/80 backdrop-blur-md border-b border-border/50 z-50">
      <div className="h-full px-4 md:px-6 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 md:gap-3 group">
          <img 
            src={appLogo} 
            alt="Purple Music Logo" 
            className="w-8 h-8 md:w-10 md:h-10 rounded-lg group-hover:scale-105 transition-transform"
          />
          <span className="text-lg md:text-xl font-bold bg-gradient-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
            Purple Music
          </span>
        </Link>

        {/* Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-9 h-9 md:w-10 md:h-10 bg-secondary hover:bg-secondary/80 rounded-full flex items-center justify-center transition-all hover:scale-105">
              <User className="w-4 h-4 md:w-5 md:h-5 text-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-card border-border">
            <DropdownMenuLabel>Moj nalog</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer py-3">
              <User className="w-4 h-4 mr-3" />
              <span>{t("profile")}</span>
            </DropdownMenuItem>
            
            <Dialog open={languageDialogOpen} onOpenChange={setLanguageDialogOpen}>
              <DialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => {
                  e.preventDefault();
                  setLanguageDialogOpen(true);
                }} className="cursor-pointer py-3">
                  <Globe className="w-4 h-4 mr-3" />
                  <span>{t("choose_language")}</span>
                </DropdownMenuItem>
              </DialogTrigger>
              <DialogContent className="max-w-md bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <Globe className="h-5 w-5" />
                    {t("language")}
                  </DialogTitle>
                </DialogHeader>
                <div className="max-h-[400px] overflow-y-auto scrollbar-hide pr-2">
                  <div className="grid gap-2">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code);
                          setLanguageDialogOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-lg transition-all hover:bg-secondary/80 ${
                          currentLanguage === lang.code ? "bg-secondary font-semibold" : ""
                        }`}
                      >
                        {lang.nativeName}
                      </button>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer py-3">
              <Shield className="w-4 h-4 mr-3" />
              <span>{t("privacy_policy")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer py-3">
              <FileText className="w-4 h-4 mr-3" />
              <span>{t("terms_of_service")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Header;
