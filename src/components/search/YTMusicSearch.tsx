import { type SearchSection } from "@/lib/api/search";
import ShelfRenderer from "./ShelfRenderer";

type Props = {
  sections?: SearchSection[];
};

export default function YTMusicSearch({ sections = [] }: Props) {
  const safeSections = Array.isArray(sections) ? sections.filter(Boolean) : [];

  return (
    <div className="space-y-8">
      {safeSections.map((section, index) => (
        <ShelfRenderer
          key={`${section?.kind ?? "section"}-${index}`}
          section={section}
        />
      ))}
    </div>
  );
}
