export default function Library() {
  return (
    <div className="p-6 space-y-3">
      <h1 className="text-2xl font-bold">Biblioteka više nije lokalna</h1>
      <p className="text-muted-foreground text-sm">
        Purple Music B radi isključivo na live podacima sa YouTube Music-a. Nema Supabase biblioteke, batch importova niti cron osvežavanja.
      </p>
    </div>
  );
}
