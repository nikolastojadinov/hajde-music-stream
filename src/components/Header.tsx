import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

const loginButtonStyles = `
.pm-login-btn {
  background: linear-gradient(120deg, #fff7cc, #f7cf5d, #f29b38);
  color: #1a1200;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  height: 36px;
  width: 120px;
  min-width: 120px;
  max-width: 120px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
  overflow: hidden;
}

.pm-login-btn:hover:not(:disabled) {
  transform: translateY(-1px) scale(1.01);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.3);
  filter: brightness(1.04);
}

.pm-login-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25);
}

.pm-login-btn:disabled {
  opacity: 0.75;
  cursor: not-allowed;
}

.pm-login-btn[data-loading="true"] {
  cursor: progress;
}

.pi-icon-circle {
  background: rgba(0, 0, 0, 0.85);
  color: #f7d972;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(247, 217, 114, 0.35);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.pi-icon {
  width: 14px;
  height: 14px;
}

.pm-login-text {
  flex: 1;
  min-width: 0;
  text-align: center;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;

const LOGIN_LABEL_BASE_SIZE = 15;
const LOGIN_LABEL_MIN_SIZE = 9;
const ICON_CIRCLE_BASE = 24;
const ICON_GLYPH_BASE = 14;

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const { t, setLanguage, currentLanguage } = useLanguage();
  const { user, login, logout, authenticating } = usePi();
  const { openDialog: openPremiumDialog } = usePremiumDialog();
  const loginButtonRef = useRef<HTMLButtonElement | null>(null);
  const loginLabelRef = useRef<HTMLSpanElement | null>(null);
  const [loginLabelFontSize, setLoginLabelFontSize] = useState(LOGIN_LABEL_BASE_SIZE);
  const [iconScale, setIconScale] = useState(1);

  const displayName = user?.username ?? "GOST";
  const isGuest = !user;
  const loginShortRaw = t("login_short");
  const loginLabel =
    loginShortRaw && loginShortRaw !== "login_short" ? loginShortRaw : t("sign_in_with_pi");
  const loginButtonText = authenticating ? t("signing_in") : loginLabel;
  const circleSize = ICON_CIRCLE_BASE * iconScale;
  const iconSize = ICON_GLYPH_BASE * iconScale;

  const adjustLoginLabel = useCallback(() => {
    const labelEl = loginLabelRef.current;
    if (!labelEl) return;

    let size = LOGIN_LABEL_BASE_SIZE;
    labelEl.style.fontSize = `${size}px`;

    let guard = LOGIN_LABEL_BASE_SIZE;
    while (size > LOGIN_LABEL_MIN_SIZE && labelEl.scrollWidth > labelEl.clientWidth && guard > 0) {
      size -= 1;
      guard -= 1;
      labelEl.style.fontSize = `${size}px`;
    }

    setLoginLabelFontSize(size);
    const nextScale = Math.max(0.75, Math.min(1, Number((size / LOGIN_LABEL_BASE_SIZE).toFixed(2))));
    setIconScale(nextScale);
  }, []);

  useEffect(() => {
    const styleTag = document.createElement("style");
    styleTag.setAttribute("data-header-login", "true");
    styleTag.textContent = loginButtonStyles;
    document.head.appendChild(styleTag);
    return () => {
      document.head.removeChild(styleTag);
    };
  }, []);

  useLayoutEffect(() => {
    adjustLoginLabel();
  }, [adjustLoginLabel, loginButtonText, isGuest]);

  useEffect(() => {
    const buttonNode = loginButtonRef.current;
    if (!buttonNode) {
      return;
    }

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => adjustLoginLabel());
      observer.observe(buttonNode);
      return () => observer.disconnect();
    }

    if (typeof window !== "undefined") {
      const handleResize = () => adjustLoginLabel();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    return undefined;
  }, [adjustLoginLabel, isGuest]);

  const handleLogin = () => {
    if (!authenticating) {
      login();
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[rgba(7,6,11,0.9)] backdrop-blur-2xl border-b border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
      <div className="h-full px-4 md:px-6 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#141126] border border-white/10 shadow-[inset_0_0_18px_rgba(255,255,255,0.05)]">
            <img src={appLogo} alt="PurpleMusic" className="h-9 w-9" />
          </div>
          <span className="text-[22px] font-bold text-[#F6C66D] tracking-tight group-hover:drop-shadow-[0_0_12px_rgba(246,198,109,0.38)]">
            PurpleMusic
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {isGuest && (
            <button
              type="button"
              className="pm-login-btn"
              ref={loginButtonRef}
              onClick={handleLogin}
              disabled={authenticating}
              data-loading={authenticating ? "true" : "false"}
              aria-label={loginButtonText}
              title={loginButtonText}
            >
              <div
                className="pi-icon-circle"
                style={{ width: `${circleSize}px`, height: `${circleSize}px` }}
              >
                <Pi className="pi-icon" style={{ width: `${iconSize}px`, height: `${iconSize}px` }} />
              </div>
              <span
                ref={loginLabelRef}
                className="pm-login-text"
                style={{ fontSize: `${loginLabelFontSize}px` }}
              >
                {loginButtonText}
              </span>
            </button>
          )}

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className="w-11 h-11 bg-[#141126] border border-white/10 rounded-full flex items-center justify-center text-[#F6C66D] transition-all hover:scale-105 hover:shadow-[0_0_15px_rgba(246,198,109,0.25)]"
                aria-label="Profile menu"
              >
                <User className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 bg-[rgba(20,17,38,0.92)] backdrop-blur-xl border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.55)] rounded-2xl"
            >
              <DropdownMenuItem className="cursor-default py-3" onSelect={(event) => event.preventDefault()}>
                <User className="w-4 h-4 mr-3" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{t("my_account")}</span>
                  <span className="font-semibold text-foreground">{displayName}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />

              <DropdownMenuSub open={languageOpen} onOpenChange={setLanguageOpen}>
                <DropdownMenuSubTrigger>
                  <Globe className="w-4 h-4 mr-3" />
                  <span>{t("language")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="bg-[rgba(20,17,38,0.92)] backdrop-blur-xl border border-white/10 max-h-64 overflow-y-auto rounded-xl">
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onSelect={(event) => {
                        event.preventDefault();
                        setLanguage(lang.code);
                        setLanguageOpen(false);
                        setMenuOpen(false);
                      }}
                    >
                      <span>{lang.nativeName}</span>
                      {currentLanguage === lang.code && <Check className="ml-auto h-4 w-4 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <Link to="/library">
                <DropdownMenuItem className="cursor-pointer py-3 hover:bg-[#7C3AED]/15">
                  <Pi className="w-4 h-4 mr-3" />
                  <span>{t("library")}</span>
                </DropdownMenuItem>
              </Link>

              <DropdownMenuSeparator className="bg-white/10" />
              {isGuest && (
                <DropdownMenuItem className="py-3 opacity-60 pointer-events-none select-none border border-amber-500/20">
                  <Crown className="w-4 h-4 mr-3" />
                  <span className="text-foreground font-semibold">{t("go_premium")}</span>
                </DropdownMenuItem>
              )}
              {!isGuest && !user?.premium && (
                <DropdownMenuItem
                  onClick={openPremiumDialog}
                  className="cursor-pointer py-3 bg-gradient-to-r from-amber-500/10 to-yellow-600/10 hover:from-amber-500/20 hover:to-yellow-600/20 border border-amber-500/25"
                >
                  <Crown className="w-4 h-4 mr-3" />
                  <span className="text-foreground font-semibold">{t("go_premium")}</span>
                </DropdownMenuItem>
              )}
              {user?.premium && (
                <div className="rounded-xl border border-green-500/25 bg-gradient-to-r from-green-500/10 to-emerald-600/10 px-3 py-3">
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

              <DropdownMenuSeparator className="bg-white/10" />
              <Link to="/privacy">
                <DropdownMenuItem className="cursor-pointer py-3 hover:bg-[#7C3AED]/15">
                  <Shield className="w-4 h-4 mr-3" />
                  <span>{t("privacy_policy")}</span>
                </DropdownMenuItem>
              </Link>
              <Link to="/terms">
                <DropdownMenuItem className="cursor-pointer py-3 hover:bg-[#7C3AED]/15">
                  <FileText className="w-4 h-4 mr-3" />
                  <span>{t("terms_of_service")}</span>
                </DropdownMenuItem>
              </Link>
              <Link to="/license">
                <DropdownMenuItem className="cursor-pointer py-3 hover:bg-[#7C3AED]/15">
                  <FileText className="w-4 h-4 mr-3" />
                  <span>{t("license")}</span>
                </DropdownMenuItem>
              </Link>

              {!isGuest && (
                <>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={logout} className="cursor-pointer py-3 text-red-400 hover:bg-red-500/10">
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
