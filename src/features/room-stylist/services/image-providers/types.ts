export type ImageProviderId = string;

export type GeneratedImageResult = {
  provider: ImageProviderId;
  label: string;
  imageBase64: string;
  mimeType: string;
  // Preserve the legacy response field used by the existing room stylist.
  b64_json: string;
};

/**
 * A product reference image paired with the text label that introduces it in
 * the request, so the model is told which product and plan task the image
 * belongs to instead of having to infer it.
 */
export type LabelledProductImage = {
  label: string;
  file: File;
};

export type ImageProviderInput = {
  prompt: string;
  roomImage: File;
  /**
   * Unlabelled product images (legacy routes). Providers may cap these.
   * Prefer `labelledProductImages`, which is sent in full and annotated.
   */
  productImages: File[];
  /**
   * Pre-allocated, labelled references from the reference manifest. When
   * present these are sent verbatim — the provider does not re-truncate them,
   * because the manifest has already applied the budget.
   */
  labelledProductImages?: LabelledProductImage[];
  apiKey?: string;
};
