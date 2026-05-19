import products from "../data/products.json";

export type Product = {
  id: string;
  name: string;
  category: string;
  styleTags: string[];
  price: number;
  url: string;
  imageUrl: string;
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