import products from "../data/products.json";

export type Product = {
  id: string;
  name: string;
  category: string;
  styleTags: string[];
  colors: string[];
  materials: string[];
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  price: number | null;
  url: string;
  imageUrls?: string[];
  imageUrl?: string;
  // Optional commercial fields. Nullable/undefined-safe: absent until a real
  // Koala product feed populates them. Never fabricated.
  stockStatus?: "in-stock" | "made-to-order" | "out-of-stock" | string | null;
  // Curated demo products that carry verified real price + product URL.
  isHeroDemoProduct?: boolean;
};

export function getAllProducts(): Product[] {
  return products as Product[];
}

export function getProductsForStyle(style: string): Product[] {
  return (products as Product[]).filter((p) =>
    p.styleTags.some((tag) =>
      tag.toLowerCase().includes(style.toLowerCase())
    )
  );
}

export function getProductsByIds(ids: string[]): Product[] {
  return (products as Product[]).filter((p) => ids.includes(p.id));
}

export function getPrimaryProductImageUrl(product: Product): string | null {
  const imageFromList = product.imageUrls
    ?.map((imageUrl) => imageUrl.trim())
    .find(Boolean);
  const legacyImage = product.imageUrl?.trim();

  return imageFromList || legacyImage || null;
}
