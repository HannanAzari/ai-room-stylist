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

export type ImageProviderId = string;

export type GeneratedConcept = {
  provider: ImageProviderId;
  label: string;
  imageBase64: string;
  mimeType: string;
};
