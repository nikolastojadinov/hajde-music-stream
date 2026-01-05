import { Link } from "react-router-dom";
import Footer from "@/components/Footer";
import Header from "@/components/Header";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 space-y-10 pb-24">
        <section className="bg-gradient-to-b from-background via-background to-muted/30 py-6">
          <div className="container space-y-4">
            <div className="inline-flex rounded-full bg-primary/10 px-4 py-1 text-sm font-semibold text-primary">
              Purple Music B • live streaming
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-tight md:text-4xl">Slušaj uživo sa YouTube Music</h1>
                <p className="max-w-2xl text-muted-foreground">
                  Bez lokalne baze, bez batch poslova, bez Supabase skladištenja pesama. Sve dolazi direktno sa weba u realnom vremenu.
                </p>
              </div>
              <Link
                to="/search"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-white shadow-lg transition hover:opacity-90"
              >
                Otvori pretragu
              </Link>
            </div>
          </div>
        </section>

        <section className="container space-y-4">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-2">Šta je novo?</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• Nema čuvanja muzike u Supabase-u; sve je live.</li>
              <li>• Nema batch/cron poslova niti YouTube Data API ključeva.</li>
              <li>• Backend je čisti proxy/transformer ka YouTube Music web endpointima.</li>
              <li>• Pi autentifikacija i plaćanja ostaju netaknuti.</li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
