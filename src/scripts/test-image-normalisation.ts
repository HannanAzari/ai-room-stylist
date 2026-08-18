/**
 * Input normalisation for the GPT Image edit endpoint.
 *
 * Run with:  npm run test:image-normalisation
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS SUITE EXISTS FOR
 * ---------------------------------------------------------------------------
 * From a live phone test, on a room photo the Gemini pipeline renders happily:
 *
 *   400 Invalid image file or mode for image 1, please check your image file
 *
 * "or mode" is the important half. The container was not necessarily wrong —
 * the COLOUR REPRESENTATION inside it was. A file can be a perfectly valid
 * `image/jpeg` by every check the browser makes and still be CMYK, greyscale,
 * 16-bit or wide-gamut; and an iPhone can hand over HEIC under a .jpg name.
 *
 * These tests build real encoded bytes for each awkward case and assert the
 * normalised output is something the endpoint documents as acceptable. They use
 * no network and no API key.
 */
import sharp from "sharp";
import {
  detectImageFormat,
  normaliseImageForGptImage,
  GPT_IMAGE_ACCEPTED_MIME_TYPES,
  MAX_NORMALISED_BYTES,
} from "@/features/room-stylist/services/image-providers/image-normalisation";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

/** A recognisable non-square source, so aspect ratio changes are detectable. */
function source(width = 800, height = 500) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 130, g: 118, b: 104 },
    },
  });
}

const toFile = (bytes: Buffer, name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type });

async function run() {
  const baseJpeg = await source().jpeg().toBuffer();

  // =========================================================================
  section("1. Format detection reads bytes, not filenames");
  // =========================================================================
  {
    const png = await source().png().toBuffer();
    const webp = await source().webp().toBuffer();
    const gif = await source().gif().toBuffer();
    const tiff = await source().tiff().toBuffer();
    const avif = await source().avif().toBuffer();

    check("JPEG magic bytes", detectImageFormat(baseJpeg) === "jpeg");
    check("PNG magic bytes", detectImageFormat(png) === "png");
    check("WebP RIFF header", detectImageFormat(webp) === "webp");
    check("GIF header", detectImageFormat(gif) === "gif");
    check("TIFF header", detectImageFormat(tiff) === "tiff");
    check("AVIF ftyp brand", detectImageFormat(avif) === "avif",
      detectImageFormat(avif));

    // The iPhone case: HEIC bytes under a .jpg name with an image/jpeg type.
    const heicHeader = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic", "latin1"),
      Buffer.alloc(16),
    ]);
    check("HEIC ftyp brand is recognised",
      detectImageFormat(heicHeader) === "heic");
    check("an empty buffer is 'unknown', not a crash",
      detectImageFormat(Buffer.alloc(0)) === "unknown");
    check("random bytes are 'unknown'",
      detectImageFormat(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])) === "unknown");

    // The whole point: the claimed type is irrelevant to detection.
    check("detection ignores a lying MIME type and extension",
      detectImageFormat(png) === "png",
      "bytes are PNG regardless of what the file calls itself");
  }

  // =========================================================================
  section("2. Every supported input normalises to an accepted format");
  // =========================================================================
  {
    const cases: Array<[string, Buffer, string, string]> = [
      ["JPEG room photo", baseJpeg, "room.jpg", "image/jpeg"],
      ["PNG input", await source().png().toBuffer(), "room.png", "image/png"],
      ["WebP input", await source().webp().toBuffer(), "room.webp", "image/webp"],
      ["TIFF input", await source().tiff().toBuffer(), "room.tiff", "image/tiff"],
      ["GIF input", await source().gif().toBuffer(), "room.gif", "image/gif"],
      ["AVIF input (HEIF family)", await source().avif().toBuffer(), "room.avif", "image/avif"],
    ];

    for (const [label, bytes, name, type] of cases) {
      const result = await normaliseImageForGptImage(toFile(bytes, name, type), {
        inputNumber: 1,
        role: "room",
      });
      const out = await sharp(
        Buffer.from(await result.file.arrayBuffer())
      ).metadata();

      check(`${label} → accepted MIME`,
        GPT_IMAGE_ACCEPTED_MIME_TYPES.has(result.file.type),
        result.file.type);
      check(`${label} → 8-bit sRGB`,
        out.space === "srgb" && out.depth === "uchar",
        `${out.space}/${out.depth}`);
      check(`${label} → RGB or RGBA`,
        out.channels === 3 || out.channels === 4,
        `${out.channels} channels`);
      check(`${label} → dimensions preserved`,
        out.width === 800 && out.height === 500,
        `${out.width}x${out.height}`);
      check(`${label} → extension matches the MIME type`,
        (result.file.type === "image/jpeg" && result.file.name.endsWith(".jpg")) ||
          (result.file.type === "image/png" && result.file.name.endsWith(".png")),
        result.file.name);
    }
  }

  // =========================================================================
  section("3. The 'mode' half of the 400 — awkward colour representations");
  // =========================================================================
  {
    // Each of these decodes fine and is a valid file; none is 8-bit RGB.
    const cmyk = await sharp(baseJpeg).toColourspace("cmyk").jpeg().toBuffer();
    const grey = await sharp(baseJpeg).toColourspace("b-w").jpeg().toBuffer();
    const png16 = await sharp(baseJpeg).toColourspace("rgb16").png().toBuffer();

    check("the CMYK fixture really is CMYK before normalising",
      (await sharp(cmyk).metadata()).space === "cmyk");
    check("the greyscale fixture really is 1-channel before normalising",
      (await sharp(grey).metadata()).channels === 1);
    check("the 16-bit fixture really is ushort before normalising",
      (await sharp(png16).metadata()).depth === "ushort");

    for (const [label, bytes, name] of [
      ["CMYK JPEG", cmyk, "room.jpg"],
      ["greyscale JPEG", grey, "room.jpg"],
      ["16-bit PNG", png16, "room.png"],
    ] as Array<[string, Buffer, string]>) {
      const result = await normaliseImageForGptImage(
        toFile(bytes, name, "image/jpeg"),
        { inputNumber: 1, role: "room" }
      );
      const out = await sharp(
        Buffer.from(await result.file.arrayBuffer())
      ).metadata();
      check(`${label} → 8-bit sRGB RGB output`,
        out.space === "srgb" &&
          out.depth === "uchar" &&
          (out.channels === 3 || out.channels === 4),
        `${out.space}/${out.depth}/${out.channels}ch`);
      check(`${label} → reported so the log can explain a rejection`,
        result.report.colourSpace !== null && result.report.channels !== null);
      // A CMYK JPEG keeps its container and its claimed MIME type, so a
      // container-only "converted" flag would report the very input that
      // caused the 400 as untouched.
      check(`${label} → flagged as converted in the debug report`,
        result.report.converted,
        `space was ${result.report.colourSpace}, depth ${result.report.depth}`);
    }
  }

  // =========================================================================
  section("4. Mismatched extension / MIME never decides the outcome");
  // =========================================================================
  {
    const png = await source().png().toBuffer();
    // PNG bytes, a .jpg name and an image/jpeg type — the iPhone-ish case.
    const lying = await normaliseImageForGptImage(
      toFile(png, "IMG_4021.jpg", "image/jpeg"),
      { inputNumber: 1, role: "room" }
    );
    check("bytes win over the claimed MIME type",
      lying.report.detectedFormat === "png",
      lying.report.detectedFormat);
    check("the claimed type is still recorded for the log",
      lying.report.originalMimeType === "image/jpeg");
    check("output is valid and accepted regardless",
      GPT_IMAGE_ACCEPTED_MIME_TYPES.has(lying.file.type));

    const noType = await normaliseImageForGptImage(
      toFile(baseJpeg, "photo", ""),
      { inputNumber: 1, role: "room" }
    );
    check("a file with no type or extension still normalises",
      GPT_IMAGE_ACCEPTED_MIME_TYPES.has(noType.file.type));
    check("...and gets a sensible filename",
      /\.(jpg|png)$/.test(noType.file.name), noType.file.name);
  }

  // =========================================================================
  section("5. Alpha decides JPEG vs PNG");
  // =========================================================================
  {
    const transparent = await sharp({
      create: {
        width: 300, height: 300, channels: 4,
        background: { r: 200, g: 180, b: 160, alpha: 0.4 },
      },
    }).png().toBuffer();

    const result = await normaliseImageForGptImage(
      toFile(transparent, "product.png", "image/png"),
      { inputNumber: 2, role: "product:sofa-x" }
    );
    check("a transparent product reference stays PNG",
      result.file.type === "image/png",
      "JPEG would turn transparency into a black box");
    check("...and keeps its alpha channel",
      (await sharp(Buffer.from(await result.file.arrayBuffer())).metadata())
        .channels === 4);

    const opaque = await normaliseImageForGptImage(
      toFile(baseJpeg, "product.jpg", "image/jpeg"),
      { inputNumber: 2, role: "product:sofa-y" }
    );
    check("an opaque photograph becomes JPEG",
      opaque.file.type === "image/jpeg");
  }

  // =========================================================================
  section("6. The room is never cropped");
  // =========================================================================
  {
    // A wide phone-ish frame; the aspect ratio must survive exactly.
    const wide = await source(1600, 900).jpeg().toBuffer();
    const result = await normaliseImageForGptImage(
      toFile(wide, "room.jpg", "image/jpeg"),
      { inputNumber: 1, role: "room" }
    );
    const out = await sharp(
      Buffer.from(await result.file.arrayBuffer())
    ).metadata();
    check("width and height are unchanged",
      out.width === 1600 && out.height === 900, `${out.width}x${out.height}`);
    check("the aspect ratio is exactly preserved",
      (out.width ?? 0) / (out.height ?? 1) === 1600 / 900);
    check("no downscale was recorded for an ordinary photo",
      result.report.downscaledTo === undefined);
    check("the output is comfortably inside the byte budget",
      result.report.normalisedBytes < MAX_NORMALISED_BYTES);

    // A portrait frame must stay portrait.
    const portrait = await normaliseImageForGptImage(
      toFile(await source(900, 1600).jpeg().toBuffer(), "room.jpg", "image/jpeg"),
      { inputNumber: 1, role: "room" }
    );
    const portraitOut = await sharp(
      Buffer.from(await portrait.file.arrayBuffer())
    ).metadata();
    check("a portrait room stays portrait",
      (portraitOut.height ?? 0) > (portraitOut.width ?? 0),
      `${portraitOut.width}x${portraitOut.height}`);
  }

  // =========================================================================
  section("7. EXIF orientation is baked in, not dropped");
  // =========================================================================
  {
    // orientation 6 = rotate 90° CW on display. Stored 800x500, shown 500x800.
    // Dropping metadata without applying it would leave the room sideways.
    const rotated = await source(800, 500)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    check("the fixture really carries orientation 6",
      (await sharp(rotated).metadata()).orientation === 6);

    const result = await normaliseImageForGptImage(
      toFile(rotated, "room.jpg", "image/jpeg"),
      { inputNumber: 1, role: "room" }
    );
    const out = await sharp(
      Buffer.from(await result.file.arrayBuffer())
    ).metadata();
    check("the rotation is applied to the pixels",
      out.width === 500 && out.height === 800,
      `${out.width}x${out.height} — sideways room if this regresses`);
    check("no stale orientation tag survives",
      !out.orientation || out.orientation === 1, String(out.orientation));
  }

  // =========================================================================
  section("8. The debug report is metadata only");
  // =========================================================================
  {
    const result = await normaliseImageForGptImage(
      toFile(baseJpeg, "IMG_0042.jpg", "image/jpeg"),
      { inputNumber: 1, role: "room" }
    );
    const r = result.report;

    for (const [field, ok] of [
      ["inputNumber", r.inputNumber === 1],
      ["role", r.role === "room"],
      ["originalMimeType", r.originalMimeType === "image/jpeg"],
      ["detectedFormat", r.detectedFormat === "jpeg"],
      ["width/height", r.width === 800 && r.height === 500],
      ["originalBytes", r.originalBytes > 0],
      ["normalisedFormat", r.normalisedFormat === "jpeg"],
      ["normalisedBytes", r.normalisedBytes > 0],
    ] as Array<[string, boolean]>) {
      check(`the report records ${field}`, ok);
    }

    // The report is logged; it must not be able to carry pixels.
    const serialised = JSON.stringify(r);
    check("the report contains no base64 or binary payload",
      serialised.length < 700 && !/[A-Za-z0-9+/]{200,}/.test(serialised),
      `${serialised.length} chars`);
  }

  // =========================================================================
  section("9. Undecodable input fails with a diagnosable message");
  // =========================================================================
  {
    let message = "";
    try {
      await normaliseImageForGptImage(
        toFile(Buffer.from("this is not an image at all"), "room.jpg", "image/jpeg"),
        { inputNumber: 1, role: "room" }
      );
    } catch (error) {
      message = (error as Error).message;
    }
    check("it throws rather than sending garbage to the API",
      message.length > 0);
    check("the message names which image failed",
      /image 1/i.test(message), message);
    check("...and the role", /room/i.test(message), message);
    check("...and what the bytes actually looked like",
      /unknown/i.test(message), message);
  }

  // =========================================================================
  section("10. The real multipart request sent to GPT Image 2");
  // =========================================================================
  {
    /**
     * Everything above tests the normaliser in isolation. This asserts what
     * actually goes on the WIRE: the SDK's own multipart body, captured by a
     * throwaway local HTTP server that OPENAI_BASE_URL points at.
     *
     * A local server rather than a fetch stub, deliberately — the SDK captures
     * its fetch reference when the client is constructed, so a stub installed
     * later is ignored and the request escapes to the real API. Pointing the
     * base URL at 127.0.0.1 makes that impossible by construction.
     *
     * The provider module is imported dynamically because it pulls in the
     * shared OpenAI client, which is built eagerly at import time.
     */
    const { createServer } = await import("node:http");

    let capturedBody: Buffer | null = null;
    let capturedContentType = "";

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        capturedBody = Buffer.concat(chunks);
        capturedContentType = request.headers["content-type"] || "";
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
      });
    });

    const port: number = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as { port: number }).port);
      });
    });

    process.env.OPENAI_API_KEY = "sk-test-local-capture-only";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.GPT_IMAGE_MODEL = "gpt-image-2";

    const { generateGptImage } = await import(
      "@/features/room-stylist/services/image-providers/gpt-image"
    );

    // A CMYK room photo — the exact class of input that produced the 400 —
    // plus a transparent product reference.
    const cmykRoom = await sharp(baseJpeg).toColourspace("cmyk").jpeg().toBuffer();
    const transparentProduct = await sharp({
      create: { width: 200, height: 200, channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
    }).png().toBuffer();

    try {
      await generateGptImage({
        prompt: "TASK 1: replace the sofa.",
        roomImage: toFile(cmykRoom, "IMG_9001.jpg", "image/jpeg"),
        productImages: [],
        labelledProductImages: [
          {
            label: "TASK 1 PRODUCT REFERENCE",
            file: toFile(transparentProduct, "sofa.png", "image/png"),
          },
        ],
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      delete process.env.OPENAI_BASE_URL;
    }

    const raw: Buffer = capturedBody ?? Buffer.alloc(0);
    check("a request reached the wire", raw.length > 0, `${raw.length} bytes`);
    check("it is a multipart form upload",
      capturedContentType.startsWith("multipart/form-data"),
      capturedContentType);

    // Parse the multipart body into parts. Only the headers are inspected as
    // text; the image parts are sliced out as raw bytes and re-decoded.
    const boundary = `--${/boundary=(.+)$/.exec(capturedContentType)?.[1] ?? ""}`;
    const parts: Array<{ headers: string; body: Buffer }> = [];
    let cursor = raw.indexOf(boundary);
    while (cursor !== -1) {
      const next = raw.indexOf(boundary, cursor + boundary.length);
      if (next === -1) break;
      const slice = raw.subarray(cursor + boundary.length, next);
      const split = slice.indexOf("\r\n\r\n");
      if (split !== -1) {
        parts.push({
          headers: slice.subarray(0, split).toString("latin1"),
          // Trailing CRLF before the next boundary is not part of the payload.
          body: slice.subarray(split + 4, slice.length - 2),
        });
      }
      cursor = next;
    }

    const nameOf = (headers: string) =>
      /name="([^"]+)"/.exec(headers)?.[1] ?? "";
    const fileNameOf = (headers: string) =>
      /filename="([^"]+)"/.exec(headers)?.[1] ?? "";
    const contentTypeOf = (headers: string) =>
      /Content-Type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "";

    const fieldNames = parts.map((part) => nameOf(part.headers));
    const imageParts = parts.filter((part) =>
      nameOf(part.headers).startsWith("image")
    );

    check("the model field is gpt-image-2",
      parts.find((part) => nameOf(part.headers) === "model")?.body.toString() ===
        "gpt-image-2");
    check("NO input_fidelity field is present in the multipart body",
      !fieldNames.includes("input_fidelity"),
      `fields: ${[...new Set(fieldNames)].join(", ")}`);
    check("the literal string input_fidelity appears nowhere in the request",
      !raw.toString("latin1").includes("input_fidelity"));
    check("both images are attached", imageParts.length === 2,
      `${imageParts.length}`);

    if (imageParts.length === 2) {
      // Image 1 must be the room, normalised. The source was CMYK, so a
      // pass-through would still decode as CMYK here.
      const roomPart = imageParts[0];
      const roomMeta = await sharp(roomPart.body).metadata();
      check("image 1 is declared image/jpeg in its part header",
        contentTypeOf(roomPart.headers) === "image/jpeg",
        contentTypeOf(roomPart.headers));
      check("image 1's bytes really are JPEG",
        detectImageFormat(roomPart.body) === "jpeg",
        detectImageFormat(roomPart.body));
      check("image 1 decodes as 8-bit sRGB",
        roomMeta.space === "srgb" && roomMeta.depth === "uchar",
        `${roomMeta.space}/${roomMeta.depth}`);
      check("image 1 is RGB, not the original CMYK",
        roomMeta.channels === 3, `${roomMeta.channels} channels`);
      check("image 1 keeps the room's dimensions uncropped",
        roomMeta.width === 800 && roomMeta.height === 500,
        `${roomMeta.width}x${roomMeta.height}`);
      check("image 1 has a filename extension matching its type",
        fileNameOf(roomPart.headers).endsWith(".jpg"),
        fileNameOf(roomPart.headers));

      // The transparent reference must still be PNG with its alpha intact.
      const productPart = imageParts[1];
      const productMeta = await sharp(productPart.body).metadata();
      check("the product reference is sent as PNG",
        detectImageFormat(productPart.body) === "png" &&
          contentTypeOf(productPart.headers) === "image/png",
        `${detectImageFormat(productPart.body)}/${contentTypeOf(productPart.headers)}`);
      check("...with its alpha channel intact",
        productMeta.channels === 4, `${productMeta.channels}ch`);
      check("...and a .png filename",
        fileNameOf(productPart.headers).endsWith(".png"),
        fileNameOf(productPart.headers));

      check("every attached image is inside the byte budget",
        imageParts.every((part) => part.body.length <= MAX_NORMALISED_BYTES));
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("All image-normalisation tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
