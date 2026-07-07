import { KoalaDesignStudio } from "@/components/studio/KoalaDesignStudio";

// The Studio wizard is the canonical Koala AI Design Studio experience.
// The legacy long-scroll RoomStylistApp is retained under
// features/room-stylist but is no longer routed.
export default function HomePage() {
  return <KoalaDesignStudio />;
}
