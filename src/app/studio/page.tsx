import { StudioPilotBadge } from "@/components/studio/StudioPilotBadge";
import { RoomStylistApp } from "@/features/room-stylist/components/RoomStylistApp";

export default function StudioPage() {
  return (
    <>
      <StudioPilotBadge />
      <RoomStylistApp mode="studio" />
    </>
  );
}
