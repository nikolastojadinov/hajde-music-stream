import { User, Globe, Shield, FileText, Crown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import appLogo from "@/assets/app-logo.png";
import { useLanguage, languages } from "@/contexts/LanguageContext";
import { useState } from "react";
import PremiumDialog from "./PremiumDialog";
import { usePi } from "@/contexts/PiContext";
const Header = () => {
  const {
    t,
    setLanguage,
    currentLanguage
  } = useLanguage();
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  const [premiumDialogOpen, setPremiumDialogOpen] = useState(false);
  const { user, signOut, sdkError } = usePi();
  return <header className="fixed top-0 left-0 right-0 h-16 bg-background/80 backdrop-blur-md border-b border-border/50 z-50">
      <div className="h-full px-4 md:px-6 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 md:gap-3 group">
          <img src={appLogo} alt="PurpleBeats Logo" className="w-[42px] h-[42px] md:w-[52px] md:h-[52px] rounded-lg group-hover:scale-105 transition-transform" />
          <span className="text-lg md:text-xl font-bold bg-gradient-to-b from-amber-400 via-yellow-500 to-amber-600 bg-clip-text text-transparent">
            PurpleMusic
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
            {user ? (
              <>
                <DropdownMenuItem className="cursor-pointer py-3">
                  <User className="w-4 h-4 mr-3" />
                  <span>@{user.username}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => setPremiumDialogOpen(true)}
                  className="cursor-pointer py-3 bg-gradient-to-r from-amber-500/10 to-yellow-600/10 hover:from-amber-500/20 hover:to-yellow-600/20 border border-amber-500/20"
                >
                  <Crown className="w-4 h-4 mr-3 text-amber-500" />
                  <span className="bg-gradient-to-b from-amber-500 via-amber-600 to-yellow-700 bg-clip-text text-transparent font-semibold">Go Premium</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()} className="cursor-pointer py-3">
                  <User className="w-4 h-4 mr-3" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </>
            ) : sdkError ? (
              <DropdownMenuItem disabled className="cursor-not-allowed py-3 text-destructive">
                <User className="w-4 h-4 mr-3" />
                <span>{sdkError}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="cursor-pointer py-3">
                <User className="w-4 h-4 mr-3" />
                <span>{t("profile")}</span>
              </DropdownMenuItem>
            )}
            
            <Dialog open={languageDialogOpen} onOpenChange={setLanguageDialogOpen}>
              <DialogTrigger asChild>
                <DropdownMenuItem onSelect={e => {
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
                    {languages.map(lang => <button key={lang.code} onClick={() => {
                    setLanguage(lang.code);
                    setLanguageDialogOpen(false);
                  }} className={`w-full text-left px-4 py-3 rounded-lg transition-all hover:bg-secondary/80 ${currentLanguage === lang.code ? "bg-secondary font-semibold" : ""}`}>
                        {lang.nativeName}
                      </button>)}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            
            <DropdownMenuSeparator />
            <Link to="/privacy">
              <DropdownMenuItem className="cursor-pointer py-3">
                <Shield className="w-4 h-4 mr-3" />
                <span>{t("privacy_policy")}</span>
              </DropdownMenuItem>
            </Link>
            <Link to="/terms">
              <DropdownMenuItem className="cursor-pointer py-3">
                <FileText className="w-4 h-4 mr-3" />
                <span>{t("terms_of_service")}</span>
              </DropdownMenuItem>
            </Link>
            {user && (
              <DropdownMenuItem onClick={() => signOut()} className="cursor-pointer py-3 text-red-600">
                <span>Sign out</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PremiumDialog open={premiumDialogOpen} onOpenChange={setPremiumDialogOpen} />
    </header>;
};
export default Header;