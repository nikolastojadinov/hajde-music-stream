import PlaylistCard from "@/components/PlaylistCard";

const Home = () => {
  const featuredPlaylists = [
    { id: 1, title: "Top Hits 2024", description: "Najpopularnije pesme trenutno" },
    { id: 2, title: "Chill Vibes", description: "Opuštajuća muzika za svaki trenutak" },
    { id: 3, title: "Workout Energy", description: "Motivacija za trening" },
    { id: 4, title: "Deep Focus", description: "Muzika za koncentraciju" },
    { id: 5, title: "Party Mix", description: "Zabavna muzika za žurke" },
    { id: 6, title: "Rock Classics", description: "Besmrtne rok pesme" },
  ];

  const recentlyPlayed = [
    { id: 7, title: "Moja Plejlista #1", description: "50 pesama" },
    { id: 8, title: "Road Trip", description: "Muzika za putovanje" },
    { id: 9, title: "Summer Hits", description: "Ljetni hitovi" },
    { id: 10, title: "Evening Jazz", description: "Opuštajući jazz" },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="p-8">
        {/* Hero Section */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent animate-fade-in">
            Dobrodošli nazad
          </h1>
          <p className="text-muted-foreground animate-fade-in">
            Otkrijte svoju omiljenu muziku
          </p>
        </div>

        {/* Featured Playlists */}
        <section className="mb-12 animate-slide-up">
          <h2 className="text-2xl font-bold mb-6">Izdvojeno za vas</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {featuredPlaylists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                id={playlist.id}
                title={playlist.title}
                description={playlist.description}
              />
            ))}
          </div>
        </section>

        {/* Recently Played */}
        <section className="animate-slide-up">
          <h2 className="text-2xl font-bold mb-6">Nedavno slušano</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
            {recentlyPlayed.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                id={playlist.id}
                title={playlist.title}
                description={playlist.description}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Home;
