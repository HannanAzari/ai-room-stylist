import { Product } from "./products";

export type RoomMeasurements = {
  widthM?: number | null;
  lengthM?: number | null;
  ceilingHeightM?: number | null;
};

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "not specified";
}

function formatDimensions(product: Product) {
  const dimensions = [
    product.widthCm ? `width ${product.widthCm}cm` : null,
    product.depthCm ? `depth ${product.depthCm}cm` : null,
    product.heightCm ? `height ${product.heightCm}cm` : null,
  ].filter(Boolean);

  return dimensions.length > 0 ? dimensions.join(", ") : "not specified";
}

function formatRoomMeasurements(roomMeasurements?: RoomMeasurements) {
  if (!roomMeasurements) return "";

  const measurements = [
    roomMeasurements.widthM
      ? `room width ${roomMeasurements.widthM}m`
      : null,
    roomMeasurements.lengthM
      ? `room length ${roomMeasurements.lengthM}m`
      : null,
    roomMeasurements.ceilingHeightM
      ? `ceiling height ${roomMeasurements.ceilingHeightM}m`
      : null,
  ].filter(Boolean);

  if (measurements.length === 0) return "";

  return `
Room measurements:
${measurements.join(", ")}
`;
}

export function buildScaleInstructions(roomType = "room") {
  return [
    "- Preserve realistic product scale and room proportions. Use any listed dimensions as scale references.",
    "- If room measurements are provided, use them as hard scale guidance for furniture size, clearance, circulation paths, rug coverage, wall art placement, lighting height, and ceiling proportion.",
    "- Place selected products proportionally in the room: sofas, tables, chairs, rugs, lighting, beds, storage, and decor should be correctly sized relative to walls, windows, doors, ceiling height, floor area, and each other.",
    "- Avoid oversized or undersized furniture. Do not make coffee tables, rugs, sofas, beds, dining tables, lighting, wall art, or decor look physically impossible for the room.",
    `- Replace or add furniture with realistic scale, practical clearance, natural alignment, and believable placement for a ${roomType}.`,
  ].join("\n");
}

function buildProductFidelityInstructions(products: Product[]) {
  if (products.length === 0) return "";

  return `
Product fidelity priority:
- The selected retailer products are the main design source. Match their visible shape, colour, material, and category as closely as possible.
- Do not replace selected products with generic alternatives or unrelated furniture.
- If exact reproduction is not possible, preserve the closest visible silhouette, colour, material and placement.
`;
}

function buildCategoryPlacementGuidance(products: Product[]) {
  if (products.length === 0) return "";

  return `
Category placement guidance:
- Sofa: place against the main wall or within the primary seating zone.
- Coffee table: center it in front of the sofa with practical clearance.
- Rug: place it under the seating area, scaled to anchor the furniture.
- Floor lamp: place near the sofa or reading corner; chandelier/ceiling light overhead.
- Entertainment unit: place under the TV wall if applicable.
- Mirror/art: place on a wall at believable height and scale.
`;
}

export function formatProductForPrompt(product: Product) {
  return [
    `Product name: ${product.name}`,
    `Category: ${product.category}`,
    `Colors: ${formatList(product.colors)}`,
    `Materials: ${formatList(product.materials)}`,
    `Style tags: ${formatList(product.styleTags)}`,
    `Dimensions: ${formatDimensions(product)}`,
  ].join("\n  ");
}

export function buildRoomPrompt({
  style,
  roomType,
  products,
  roomMeasurements,
}: {
  style: string;
  roomType: string;
  products: Product[];
  roomMeasurements?: RoomMeasurements;
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
${formatRoomMeasurements(roomMeasurements)}

Use these exact retailer products as the furniture intelligence for the redesign:
${productList}
${buildProductFidelityInstructions(products)}
${buildCategoryPlacementGuidance(products)}

Instructions:
- Keep the original room architecture, walls, floor, windows, lighting direction, and perspective.
- Use the selected products visibly and recognizably as the primary furniture references.
- Match the listed product colors and materials closely, including wood tones, stone finishes, fabrics, leather, metal, and accent colors.
${buildScaleInstructions(roomType)}
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
