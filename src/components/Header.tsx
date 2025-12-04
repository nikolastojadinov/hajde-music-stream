import { Link } from "react-router-dom";
import { Check, Crown, FileText, Globe, LogOut, Pi, Shield, User } from "lucide-react";

import appLogo from "@/assets/app-logo.png";
import { useLanguage, languages } from "@/contexts/LanguageContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePi } from "@/contexts/PiContext";
import { usePremiumDialog } from "@/contexts/PremiumDialogContext";

const Header = () => {
  const { t, setLanguage, currentLanguage } = useLanguage();
  const { user, login, logout, authenticating } = usePi();
  const { openDialog: openPremiumDialog } = usePremiumDialog();

  const displayName = user?.username ?? "GOST";
  const isGuest = !user;

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-background/80 backdrop-blur-md border-b border-border/50 z-50">
      <div className="h-full px-4 md:px-6 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 md:gap-3 group">
          <img
            src={appLogo}
            alt="PurpleBeats Logo"
            className="w-[42px] h-[42px] md:w-[52px] md:h-[52px] rounded-lg group-hover:scale-105 transition-transform"
          />
          <span className="text-lg md:text-xl font-bold text-foreground">PurpleMusic</span>
        </Link>

        <div className="flex items-center gap-3">
          {isGuest && (
            <button
              onClick={login}
              disabled={authenticating}
              className="inline-flex items-center gap-2 rounded-full border border-[#F7C948] bg-transparent px-6 py-2 text-sm font-semibold text-[#F7C948] transition hover:bg-[#F7C948]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C948]/70 disabled:opacity-60"
            >
              <Pi className="w-4 h-4" />
              {authenticating ? t("signing_in") : "Login"}
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-10 h-10 bg-secondary hover:bg-secondary/80 rounded-full flex items-center justify-center transition-all hover:scale-105"
                aria-label="Profile menu"
              >
                <User className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 bg-card border-border">
              <DropdownMenuItem className="cursor-default py-3" onSelect={event => event.preventDefault()}>
                <User className="w-4 h-4 mr-3" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{t("my_account")}</span>
                  <span className="font-semibold text-foreground">{displayName}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Globe className="w-4 h-4 mr-3" />
                  <span>{t("language")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="bg-card border-border max-h-64 overflow-y-auto">
                  {languages.map(lang => (
                    <DropdownMenuItem
                      key={lang.code}
                      onSelect={event => {
                        event.preventDefault();
                        setLanguage(lang.code);
                      }}
                    >
                      <span>{lang.nativeName}</span>
                      {currentLanguage === lang.code && <Check className="ml-auto h-4 w-4 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              {isGuest && (
                <DropdownMenuItem className="py-3 opacity-40 pointer-events-none select-none border border-amber-500/20">
                  <Crown className="w-4 h-4 mr-3" />
                  <span className="text-foreground font-semibold">{t("go_premium")}</span>
                </DropdownMenuItem>
              )}
              {!isGuest && !user?.premium && (
                <DropdownMenuItem
                  onClick={openPremiumDialog}
                  className="cursor-pointer py-3 bg-gradient-to-r from-amber-500/10 to-yellow-600/10 hover:from-amber-500/20 hover:to-yellow-600/20 border border-amber-500/20"
                >
                  <Crown className="w-4 h-4 mr-3" />
                  <span className="text-foreground font-semibold">{t("go_premium")}</span>
                </DropdownMenuItem>
              )}
              {user?.premium && (
                <div className="rounded-lg border border-green-500/20 bg-gradient-to-r from-green-500/10 to-emerald-600/10 px-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                      <Crown className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground">{t("premium_member")}</span>
                      {user.premium_until && (
                        <span className="text-xs text-muted-foreground">
                          {t("until")} {new Date(user.premium_until).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

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

              {!isGuest && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="cursor-pointer py-3 text-red-400">
                    <LogOut className="w-4 h-4 mr-3" />
                    <span>{t("sign_out")}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default Header;
