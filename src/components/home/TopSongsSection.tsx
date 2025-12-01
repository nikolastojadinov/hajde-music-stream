import { useEffect, useMemo, useState } from "react";

const VIDEO_IDS = ["9gWIIIr2Asw", "eVli-tstM5E", "ekr2nIex040", "MB3VkzPdgLA", "ppbhxukCd-4"];

export default function TopSongsSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);

  const videoSrc = useMemo(() => {
    const videoId = VIDEO_IDS[activeIndex] ?? VIDEO_IDS[0];
    return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=1&modestbranding=1&playsinline=1`;
  }, [activeIndex]);

  useEffect(() => {
    setIsFading(true);
    const timer = setTimeout(() => setIsFading(false), 200);
    return () => clearTimeout(timer);
  }, [activeIndex]);

  return (
    <section className="w-full animate-slide-up mb-8 md:mb-12">
      <div className="rounded-2xl bg-[#1a1a1a] p-4 md:p-6 shadow-lg">
        <h2 className="text-center text-lg md:text-2xl font-bold text-white mb-4">TOP 5 Songs Today</h2>
        <div className="relative w-full overflow-hidden rounded-xl">
          <iframe
            key={videoSrc}
            src={videoSrc}
            title="Top song video"
            className={`h-[220px] w-full rounded-xl border-0 transition-opacity duration-300 md:h-[340px] ${isFading ? "opacity-0" : "opacity-100"}`}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {VIDEO_IDS.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Show top song ${index + 1}`}
              onClick={() => setActiveIndex(index)}
              className={`h-2.5 w-2.5 rounded-full transition-colors ${
                activeIndex === index ? "bg-[#FFD700]" : "bg-[#555555]"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
