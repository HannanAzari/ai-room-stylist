import { Product } from "./products";

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
    .map((p) => `- ${p.name}: ${p.category}`)
    .join("\n");

  return `
You are designing a premium ecommerce furniture room concept.

Room type:
${roomType}

Target style:
${style}

Use furniture visually inspired by these exact retailer products:
${productList}

Instructions:
- Keep the original room architecture, walls, floor, windows, lighting direction, and perspective.
- Replace existing furniture with a coordinated luxury furniture set.
- Make the main furniture look clearly inspired by the listed product names.
- Use realistic scale and natural placement.
- Make the room feel premium, warm, elegant, and commercially appealing.
- Do not add people.
- Do not add text.
- Do not add logos.
- Do not distort the room structure.
- Output photorealistic interior design.
`;
}