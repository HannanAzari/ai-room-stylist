/**
 * Local lead store for the pilot. Persists quote submissions to localStorage
 * so they can be reviewed/exported before a real CRM is connected.
 */
import type { Product } from "@/lib/products";
import type { PackagePricing } from "./product-helpers";

export const LEADS_STORAGE_KEY = "koala-ai-studio:leads";

export type LeadContactMethod = "email" | "phone" | "either";

export type LeadProductRef = {
  id: string;
  name: string;
  category: string;
  price: number | null;
  url: string | null;
};

export type LeadPricing = {
  pricedItems: number;
  totalItems: number;
  hasAllPrices: boolean;
  subtotal: number;
  saving: number;
  total: number;
};

export type Lead = {
  timestamp: string;
  name: string;
  email: string;
  phone: string;
  postcode: string;
  preferredContact: LeadContactMethod;
  notes: string;
  roomType: string;
  style: string;
  selectedProducts: LeadProductRef[];
  recommendedAdditions: LeadProductRef[];
  pricing: LeadPricing;
  imageProvider: string | null;
  imageId: string | null;
};

function toProductRef(product: Product): LeadProductRef {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: typeof product.price === "number" ? product.price : null,
    url: product.url?.trim() || null,
  };
}

// Short, stable identifier for a generated image without storing the payload.
export function deriveImageId(imageBase64: string | undefined | null): string | null {
  if (!imageBase64) return null;

  let hash = 0;
  for (let i = 0; i < imageBase64.length; i += 1) {
    hash = (hash * 31 + imageBase64.charCodeAt(i)) | 0;
  }

  return `img_${(hash >>> 0).toString(16)}_${imageBase64.length}`;
}

export function buildLead(input: {
  form: {
    name: string;
    email: string;
    phone: string;
    postcode: string;
    preferredContact: LeadContactMethod;
    notes: string;
  };
  roomType: string;
  style: string;
  selectedProducts: Product[];
  recommendedAdditions: Product[];
  pricing: PackagePricing;
  imageProvider: string | null;
  imageBase64: string | null;
}): Lead {
  return {
    timestamp: new Date().toISOString(),
    name: input.form.name.trim(),
    email: input.form.email.trim(),
    phone: input.form.phone.trim(),
    postcode: input.form.postcode.trim(),
    preferredContact: input.form.preferredContact,
    notes: input.form.notes.trim(),
    roomType: input.roomType,
    style: input.style,
    selectedProducts: input.selectedProducts.map(toProductRef),
    recommendedAdditions: input.recommendedAdditions.map(toProductRef),
    pricing: {
      pricedItems: input.pricing.pricedItems,
      totalItems: input.pricing.totalItems,
      hasAllPrices: input.pricing.hasAllPrices,
      subtotal: input.pricing.subtotal,
      saving: input.pricing.saving,
      total: input.pricing.total,
    },
    imageProvider: input.imageProvider,
    imageId: deriveImageId(input.imageBase64),
  };
}

export function getLeads(): Lead[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LEADS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLead(lead: Lead): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      LEADS_STORAGE_KEY,
      JSON.stringify([...getLeads(), lead])
    );
  } catch {
    // Lead capture must never interrupt the customer experience.
  }
}
