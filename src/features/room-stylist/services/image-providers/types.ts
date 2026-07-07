export type ImageProviderId = string;

export type GeneratedImageResult = {
  provider: ImageProviderId;
  label: string;
  imageBase64: string;
  mimeType: string;
  // Preserve the legacy response field used by the existing room stylist.
  b64_json: string;
};

export type ImageProviderInput = {
  prompt: string;
  roomImage: File;
  productImages: File[];
  apiKey?: string;
};
