import { Product } from "./products";

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "not specified";
}

export function formatProductForPrompt(product: Product) {
  return [
    `Product name: ${product.name}`,
    `Category: ${product.category}`,
    `Colors: ${formatList(product.colors)}`,
    `Materials: ${formatList(product.materials)}`,
    `Style tags: ${formatList(product.styleTags)}`,
  ].join("\n  ");
}

export function buildRoomPrompt({
  style,
  roomType,
  products,
}: {
  style: string;
  roomType: string;
  products: Product[];
}) {
  const productList = products
    .map((product, index) => `${index + 1}. ${formatProductForPrompt(product)}`)
    .join("\n\n");

  return `
You are designing a premium ecommerce furniture room concept.

Room type:
${roomType}

Target style:
${style}

Use these exact retailer products as the furniture intelligence for the redesign:
${productList}

Instructions:
- Keep the original room architecture, walls, floor, windows, lighting direction, and perspective.
- Use the selected products visibly and recognizably as the primary furniture references.
- Match the listed product colors and materials closely, including wood tones, stone finishes, fabrics, leather, metal, and accent colors.
- Replace or add furniture with realistic scale, practical clearance, natural alignment, and believable placement for a ${roomType}.
- Build a cohesive ${style} interior: coordinate colors, materials, silhouettes, lighting warmth, decor, and spacing so the products feel like one curated retail package.
- Preserve photorealistic material behavior: fabric softness, leather sheen, wood grain, stone texture, glass reflection, and metal highlights should look natural.
- Make the room feel premium, warm, elegant, commercially appealing, and ready for a furniture ecommerce product bundle.
- Do not invent mismatched colors or materials that fight the selected product palette.
- Do not add people.
- Do not add text.
- Do not add logos.
- Do not distort the room structure.
- Output photorealistic interior design.
`;
}
