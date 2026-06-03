import type { Product } from "@/lib/products";

export type { Product };

export type RoomStylistMode = "classic" | "studio";

export type ProductCategoryGroup = {
  id: string;
  label: string;
  products: Product[];
};

export type RoomMeasurementInputs = {
  roomWidthM: string;
  roomLengthM: string;
  ceilingHeightM: string;
};
