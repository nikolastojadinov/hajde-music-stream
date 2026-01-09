import { Search as SearchIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Footer from "@/components/Footer";
import Header from "@/components/Header";

export default function Home() {
  const navigate = useNavigate();

  const goToSearch = () => navigate("/search");

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 pb-24">
        <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6">
          <button
            type="button"
            onClick={goToSearch}
            className="relative flex h-11 w-full items-center rounded-full border border-neutral-800 bg-neutral-900/85 pl-4 pr-11 text-left text-sm text-neutral-400 transition hover:bg-neutral-900"
            aria-label="Otvori pretragu"
          >
            Traži pesme, izvođače, albume...
            <SearchIcon className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
