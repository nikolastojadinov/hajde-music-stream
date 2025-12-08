import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VIDEO_IDS = ["9gWIIIr2Asw", "eVli-tstM5E", "ekr2nIex040", "MB3VkzPdgLA", "ppbhxukCd-4"];
const SWIPE_THRESHOLD = 50;

export default function TopSongsSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);
  const lastIndex = VIDEO_IDS.length - 1;

  const videoSrc = useMemo(() => {
    const videoId = VIDEO_IDS[activeIndex] ?? VIDEO_IDS[0];
    return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=1&modestbranding=1&playsinline=1`;
  }, [activeIndex]);

  useEffect(() => {
    setIsFading(true);
    const timer = setTimeout(() => setIsFading(false), 200);
    return () => clearTimeout(timer);
  }, [activeIndex]);

  const goToIndex = useCallback((index: number) => {
    setActiveIndex(prev => {
      const clamped = Math.min(Math.max(index, 0), lastIndex);
      return clamped === prev ? prev : clamped;
    });
  }, [lastIndex]);

  const goToNext = useCallback(() => {
    setActiveIndex(prev => Math.min(prev + 1, lastIndex));
  }, [lastIndex]);

  const goToPrev = useCallback(() => {
    setActiveIndex(prev => Math.max(prev - 1, 0));
  }, []);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStartX.current = touch?.clientX ?? null;
    touchCurrentX.current = touch?.clientX ?? null;
    touchStartY.current = touch?.clientY ?? null;
    touchCurrentY.current = touch?.clientY ?? null;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch) {
      touchCurrentX.current = touch.clientX;
      touchCurrentY.current = touch.clientY;
    }
  };

  const handleTouchEnd = () => {
    if (
      touchStartX.current == null ||
      touchCurrentX.current == null ||
      touchStartY.current == null ||
      touchCurrentY.current == null
    ) {
      touchStartX.current = null;
      touchCurrentX.current = null;
      touchStartY.current = null;
      touchCurrentY.current = null;
      return;
    }

    const deltaX = touchStartX.current - touchCurrentX.current;
    const deltaY = touchStartY.current - touchCurrentY.current;
    const horizontalDominant = Math.abs(deltaX) > Math.abs(deltaY);

    if (horizontalDominant && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        goToNext();
      } else {
        goToPrev();
      }
    }

    touchStartX.current = null;
    touchCurrentX.current = null;
    touchStartY.current = null;
    touchCurrentY.current = null;
  };

  return (
    <section className="w-full animate-slide-up mb-8 md:mb-12">
      <div className="rounded-2xl bg-[#1a1a1a] p-4 md:p-6 shadow-lg">
        <h2 className="text-center text-lg md:text-2xl font-bold text-white mb-4">TOP 5 Songs Today</h2>
        <div
          className="relative w-full overflow-hidden rounded-xl"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          role="group"
          aria-roledescription="carousel"
        >
          <iframe
            key={videoSrc}
            src={videoSrc}
            title="Top song video"
            className={`h-[220px] w-full rounded-xl border-0 transition-opacity duration-300 md:h-[340px] ${isFading ? "opacity-0" : "opacity-100"}`}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
          <div
            className="swipe-layer pointer-events-none absolute inset-0 z-[5]"
            aria-hidden="true"
          />
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {VIDEO_IDS.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Show top song ${index + 1}`}
              onClick={() => goToIndex(index)}
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
