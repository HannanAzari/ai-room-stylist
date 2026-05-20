import products from "../data/products.json";

export type Product = {
  id: string;
  name: string;
  category: string;
  styleTags: string[];
  colors: string[];
  materials: string[];
  price: number | null;
  url: string;
  imageUrls: string[];
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
  return product.imageUrls?.[0] || null;
}
