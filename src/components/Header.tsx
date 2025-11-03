import { User, Globe, Shield, FileText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "react-router-dom";
import appLogo from "@/assets/app-logo.png";

const Header = () => {
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
            <DropdownMenuItem className="cursor-pointer py-3">
              <User className="w-4 h-4 mr-3" />
              <span>View profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer py-3">
              <Globe className="w-4 h-4 mr-3" />
              <span>Choose language</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer py-3">
              <Shield className="w-4 h-4 mr-3" />
              <span>Privacy policy</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer py-3">
              <FileText className="w-4 h-4 mr-3" />
              <span>Terms of service</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Header;
