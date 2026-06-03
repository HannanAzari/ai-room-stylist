import Image from "next/image";
import type { Product } from "../types";
import { getProductImageUrl } from "../services/product-helpers";

export function ProductImage({
  product,
  className,
  placeholderClassName,
}: {
  product: Product;
  className: string;
  placeholderClassName: string;
}) {
  const imageUrl = getProductImageUrl(product);

  if (!imageUrl) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-950 text-xs text-neutral-500 ${placeholderClassName}`}
      >
        No image
      </div>
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={product.name}
      width={320}
      height={240}
      className={className}
    />
  );
}
