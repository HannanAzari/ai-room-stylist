"use client";

import { useEffect, useRef, useState } from "react";
import { GenerationProgress } from "@/components/GenerationProgress";
import allProducts from "@/data/products.json";
import { trackEvent } from "@/lib/analytics";
import type { Product } from "@/lib/products";

const styles = [
  "modern luxury",
  "warm neutral",
  "minimal",
  "hotel style",
  "family living",
];

const roomTypes = ["living room", "dining room", "bedroom"];
const CACHE_KEY = "ai-room-stylist:last-result";
const SHARE_MESSAGE =
  "I created a luxury room concept with AI Room Stylist. Full-room package preview coming soon.";
const generateProgressMessages = [
  "Analysing your room...",
  "Matching selected furniture...",
  "Creating luxury concept...",
];
const refineProgressMessages = [
  "Opening the selected concept",
  "Applying your requested change",
  "Preserving the room perspective",
  "Finishing the refined render",
];
const refineQuickPrompts = [
  "Make it warmer",
  "Add more luxury",
  "Use darker furniture",
  "Add a larger rug",
  "Make it more minimal",
  "Improve lighting",
];
const productCategories = [
  { id: "sofa", label: "Sofas" },
  { id: "coffee_table", label: "Coffee tables" },
  { id: "chair", label: "Chairs" },
  { id: "lighting", label: "Lighting" },
  { id: "decor", label: "Decor" },
  { id: "dining_table", label: "Dining tables" },
] as const;

type ProductCategory = (typeof productCategories)[number]["id"];

const productCategoryLabels: Record<ProductCategory, string> =
  productCategories.reduce(
    (labels, category) => ({
      ...labels,
      [category.id]: category.label,
    }),
    {} as Record<ProductCategory, string>
  );
const productList = allProducts as Product[];
const productsByCategory = productCategories
  .map((category) => ({
    ...category,
    products: productList.filter((product) => product.category === category.id),
  }))
  .filter((category) => category.products.length > 0);

function getCategoryLabel(category: string) {
  return (
    productCategoryLabels[category as ProductCategory] ||
    category.replaceAll("_", " ")
  );
}

function getProductImageUrl(product: Product) {
  return product.imageUrls?.[0] || "";
}

function formatPrice(price: Product["price"]) {
  return typeof price === "number" ? `$${price.toLocaleString()}` : "Price on request";
}

export default function HomePage() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [style, setStyle] = useState(styles[0]);
  const [roomType, setRoomType] = useState(roomTypes[0]);
  const [loading, setLoading] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [selectedConcept, setSelectedConcept] = useState<number | null>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [refining, setRefining] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedRefinementProductIds, setSelectedRefinementProductIds] =
    useState<string[]>([]);
  const [favouriteProductIds, setFavouriteProductIds] = useState<string[]>([]);
  const [demoMessage, setDemoMessage] = useState("");
  const [generateProgressIndex, setGenerateProgressIndex] = useState(0);
  const [refineProgressIndex, setRefineProgressIndex] = useState(0);
  const [openProductCategoryIds, setOpenProductCategoryIds] = useState<string[]>(
    productsByCategory.map((category) => category.id)
  );
  const demoMessageTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      const timeout = window.setTimeout(() => {
        setGeneratedImages(parsed.generatedImages || []);
        setProducts(parsed.products || []);
        setStyle(parsed.style || styles[0]);
        setRoomType(parsed.roomType || roomTypes[0]);
      }, 0);

      return () => window.clearTimeout(timeout);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!loading) return;

    const interval = window.setInterval(() => {
      setGenerateProgressIndex((current) =>
        Math.min(current + 1, generateProgressMessages.length - 1)
      );
    }, 3500);

    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (!refining) return;

    const interval = window.setInterval(() => {
      setRefineProgressIndex((current) =>
        Math.min(current + 1, refineProgressMessages.length - 1)
      );
    }, 3000);

    return () => window.clearInterval(interval);
  }, [refining]);

  useEffect(() => {
    return () => {
      if (demoMessageTimeoutRef.current) {
        window.clearTimeout(demoMessageTimeoutRef.current);
      }
    };
  }, []);

  function showDemoMessage(message: string) {
    if (demoMessageTimeoutRef.current) {
      window.clearTimeout(demoMessageTimeoutRef.current);
    }

    setDemoMessage(message);
    demoMessageTimeoutRef.current = window.setTimeout(() => {
      setDemoMessage("");
    }, 2600);
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function toggleFavouriteProduct(productId: string, productName: string) {
    const isFavourite = favouriteProductIds.includes(productId);

    setFavouriteProductIds((current) =>
      isFavourite
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
    showDemoMessage(
      isFavourite
        ? `${productName} removed from favourites.`
        : `${productName} added to favourites.`
    );
    trackEvent("favourite_clicked", {
      productId,
      productName,
      action: isFavourite ? "removed" : "added",
    });
  }

  function toggleRefinementProduct(productId: string) {
    setSelectedRefinementProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function appendRefinePrompt(instruction: string) {
    setChangeRequest((current) =>
      current.trim() ? `${current.trim()}\n${instruction}` : instruction
    );
  }

  function toggleProductCategory(categoryId: string) {
    setOpenProductCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId]
    );
  }

  function downloadGeneratedImage(imageBase64: string, index: number) {
    trackEvent("download_clicked", {
      conceptIndex: index,
    });

    const binary = window.atob(imageBase64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-room-stylist-concept-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showDemoMessage(`Concept ${index + 1} downloaded.`);
  }

  async function shareGeneratedConcept(index: number) {
    const conceptShareMessage = `${SHARE_MESSAGE} Concept ${index + 1}.`;
    const canUseNativeShare = "share" in navigator;
    const shareMethod = canUseNativeShare ? "native" : "clipboard";

    trackEvent("share_clicked", {
      conceptIndex: index,
      shareMethod,
    });

    if (canUseNativeShare) {
      try {
        await navigator.share({
          title: "AI Room Stylist concept",
          text: conceptShareMessage,
          url: window.location.href,
        });
        showDemoMessage("Share sheet opened.");
      } catch {
        showDemoMessage("Share cancelled.");
      }

      return;
    }

    try {
      await navigator.clipboard.writeText(conceptShareMessage);
      showDemoMessage("Share message copied to clipboard.");
    } catch {
      window.alert(conceptShareMessage);
    }
  }

  function addProductToCart(product: Product) {
    trackEvent("add_to_cart_clicked", {
      productId: product.id,
      productName: product.name,
      category: product.category,
    });
    showDemoMessage(`${product.name} added to demo cart.`);
  }

  function addFullBundleToCart() {
    trackEvent("bundle_add_to_cart_clicked", {
      productCount: products.length,
      productIds: products.map((product) => product.id),
    });
    showDemoMessage(`${products.length} item bundle added to demo cart.`);
  }

  function handleImageChange(file: File | null) {
    setImage(file);
    setGeneratedImages([]);
    setProducts([]);
    setError("");
    setSelectedRefinementProductIds([]);

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl("");
    }
  }

  async function handleGenerate() {
    if (!image) {
      setError("Please upload a room photo first.");
      return;
    }

    setLoading(true);
    setGenerateProgressIndex(0);
    setError("");
    setGeneratedImages([]);
    setProducts([]);
    trackEvent("generate_started", {
      roomType,
      style,
      selectedProductIds,
      selectedProductCount: selectedProductIds.length,
    });

    try {
      const formData = new FormData();
      formData.append("image", image);
      formData.append("style", style);
      formData.append("roomType", roomType);
      formData.append("selectedProductIds", JSON.stringify(selectedProductIds));

      const res = await fetch("/api/generate-room", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      setGeneratedImages(
        data.images.map((img: { b64_json: string }) => img.b64_json)
      );
      setProducts(data.products);
      trackEvent("generate_completed", {
        roomType,
        style,
        imageCount: data.images.length,
        productCount: data.products.length,
        productIds: data.products.map((product: Product) => product.id),
      });
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          generatedImages: data.images.map((img: { b64_json: string }) => img.b64_json),
          products: data.products,
          style,
          roomType,
          createdAt: new Date().toISOString(),
        })
      );
    } catch {
      setError("Failed to connect to the generation service.");
    } finally {
      setLoading(false);
    }
  }
  async function handleRefine() {
    if (selectedConcept === null) return;
    if (!changeRequest.trim() && selectedRefinementProductIds.length === 0) {
      return;
    }

    setRefining(true);
    setRefineProgressIndex(0);
    setError("");
    trackEvent("refine_started", {
      conceptIndex: selectedConcept,
      hasTextInstruction: Boolean(changeRequest.trim()),
      refinementProductIds: selectedRefinementProductIds,
      refinementProductCount: selectedRefinementProductIds.length,
    });

    try {
      const res = await fetch("/api/refine-room", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: generatedImages[selectedConcept],
          changeRequest,
          refinementProductIds: selectedRefinementProductIds,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Refinement failed.");
        return;
      }

      const refinedImage = data.image.b64_json;

      const updatedImages = [...generatedImages];
      updatedImages[selectedConcept] = refinedImage;

      setGeneratedImages(updatedImages);
      setChangeRequest("");
      setSelectedRefinementProductIds([]);
      trackEvent("refine_completed", {
        conceptIndex: selectedConcept,
        hasTextInstruction: Boolean(changeRequest.trim()),
        refinementProductIds: selectedRefinementProductIds,
        refinementProductCount: selectedRefinementProductIds.length,
      });

      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          generatedImages: updatedImages,
          products,
          style,
          roomType,
          createdAt: new Date().toISOString(),
        })
      );
    } catch {
      setError("Failed to connect to refinement service.");
    } finally {
      setRefining(false);
    }
  }
  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white">
      {demoMessage && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-center text-sm text-white shadow-2xl"
        >
          {demoMessage}
        </div>
      )}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-widest text-neutral-400">
            AI Room Stylist
          </p>
          <h1 className="mt-3 text-4xl font-bold">
            Redesign your room with luxury furniture
          </h1>
          <p className="mt-4 max-w-2xl text-neutral-300">
            Upload a room photo, choose a style, and generate premium interior
            concepts with matching furniture suggestions.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl bg-neutral-900 p-6">
            <label className="mb-2 block text-sm text-neutral-300">
              Upload room photo
            </label>

            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleImageChange(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-sm"
            />

            {previewUrl && (
              <div className="mt-5 overflow-hidden rounded-xl border border-neutral-800">
                <img
                  src={previewUrl}
                  alt="Uploaded room preview"
                  className="max-h-[500px] w-full object-contain"
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-neutral-900 p-6">
            <label className="mb-2 block text-sm text-neutral-300">
              Room type
            </label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="mb-5 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3"
            >
              {roomTypes.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <label className="mb-2 block text-sm text-neutral-300">
              Style
            </label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="mb-6 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3"
            >
              {styles.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <div className="mb-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-neutral-300">
                  Select products to include
                </p>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                    {selectedProductIds.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedProductIds([])}
                    disabled={selectedProductIds.length === 0}
                    className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear selected products
                  </button>
                </div>
              </div>

              <div className="grid gap-3">
                {productsByCategory.map((category) => (
                  <section
                    key={category.id}
                    className="rounded-xl border border-neutral-800 bg-neutral-950/60"
                  >
                    <button
                      type="button"
                      onClick={() => toggleProductCategory(category.id)}
                      aria-expanded={openProductCategoryIds.includes(category.id)}
                      aria-controls={`product-category-${category.id}`}
                      className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    >
                      <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
                        {category.label}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-neutral-500">
                        <span>
                          {
                            category.products.filter((product) =>
                              selectedProductIds.includes(product.id)
                            ).length
                          }
                          /{category.products.length}
                        </span>
                        <span className="text-neutral-600">
                          {openProductCategoryIds.includes(category.id) ? "-" : "+"}
                        </span>
                      </span>
                    </button>

                    {openProductCategoryIds.includes(category.id) && (
                      <div
                        id={`product-category-${category.id}`}
                        className="grid gap-2 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-1"
                      >
                        {category.products.map((p) => {
                          const isSelected = selectedProductIds.includes(p.id);

                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleProduct(p.id)}
                              type="button"
                              aria-pressed={isSelected}
                              className={`flex min-h-20 items-center gap-3 rounded-xl border p-3 text-left transition ${
                                isSelected
                                  ? "border-white bg-neutral-800 ring-1 ring-white"
                                  : "border-neutral-700 bg-neutral-950 hover:bg-neutral-800"
                              }`}
                            >
                              {getProductImageUrl(p) && (
                                <img
                                  src={getProductImageUrl(p) || undefined}
                                  alt={p.name}
                                  className="h-48 w-full rounded-lg object-cover"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-semibold">
                                    {p.name}
                                  </p>
                                  {isSelected && (
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-black">
                                      Selected
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-neutral-400">
                                  {getCategoryLabel(p.category)}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !image}
              className="w-full rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Generating concept..." : "Generate concept"}
            </button>

            {loading && (
              <div className="mt-4">
                <GenerationProgress
                  title="Generating room concept"
                  message={generateProgressMessages[generateProgressIndex]}
                  steps={generateProgressMessages}
                  activeStep={generateProgressIndex}
                />
              </div>
            )}

            <button
              onClick={() => {
                localStorage.removeItem(CACHE_KEY);
                setGeneratedImages([]);
                setProducts([]);
                setSelectedConcept(null);
                setChangeRequest("");
                setSelectedRefinementProductIds([]);
              }}
              className="mt-3 w-full rounded-xl border border-neutral-700 px-6 py-3 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              Clear saved results
            </button>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </div>
        </div>

        {loading && (
          <section className="mt-10">
            <h2 className="mb-4 text-2xl font-semibold">Generated concept</h2>
            <div className="overflow-hidden rounded-2xl bg-neutral-900">
              <div className="flex aspect-square items-center justify-center bg-neutral-950">
                <div className="h-16 w-16 rounded-full border-2 border-neutral-700 border-t-white animate-spin" />
              </div>
              <div className="p-4">
                <div className="h-10 rounded-lg bg-neutral-800" />
              </div>
            </div>
          </section>
        )}

        {generatedImages.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-2xl font-semibold">Generated concepts</h2>
            {selectedConcept !== null && (
              <section className="mt-10 rounded-2xl bg-neutral-900 p-6">
                <h2 className="text-2xl font-semibold">Refine selected concept</h2>

                <p className="mt-2 text-sm text-neutral-400">
                  Tell the AI what you want to change.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {refineQuickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => appendRefinePrompt(prompt)}
                      className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <textarea
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  placeholder="Example: make the sofa darker, add a larger rug, change the coffee table to marble..."
                  className="mt-4 min-h-28 w-full rounded-xl border border-neutral-700 bg-neutral-800 p-4 text-sm text-white"
                />

                <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Swap/add products
                      </h3>
                      <p className="mt-1 text-xs text-neutral-500">
                        Add product references for this refinement only.
                      </p>
                    </div>
                    <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                      {selectedRefinementProductIds.length} selected
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {productsByCategory.map((category) => (
                      <section key={category.id}>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                          {category.label}
                        </h4>

                        <div className="grid gap-2">
                          {category.products.map((p) => {
                            const isSelected =
                              selectedRefinementProductIds.includes(p.id);

                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => toggleRefinementProduct(p.id)}
                                aria-pressed={isSelected}
                                className={`flex items-center gap-3 rounded-xl border p-2 text-left transition ${
                                  isSelected
                                    ? "border-white bg-neutral-800 ring-1 ring-white"
                                    : "border-neutral-700 bg-neutral-950 hover:bg-neutral-800"
                                }`}
                              >
                                <img
                                  src={getProductImageUrl(p)}
                                  alt={p.name}
                                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold">
                                    {p.name}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-neutral-500">
                                    {getCategoryLabel(p.category)}
                                  </p>
                                </div>
                                {isSelected && (
                                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-black">
                                    Selected
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleRefine}
                  disabled={
                    (!changeRequest.trim() &&
                      selectedRefinementProductIds.length === 0) ||
                    refining
                  }
                  className="mt-4 rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {refining ? "Refining concept..." : "Regenerate with changes"}
                </button>

                {refining && (
                  <div className="mt-4">
                    <GenerationProgress
                      title="Refining selected concept"
                      message={refineProgressMessages[refineProgressIndex]}
                      steps={refineProgressMessages}
                      activeStep={refineProgressIndex}
                    />
                  </div>
                )}
              </section>
            )}

            <div className="grid gap-6 md:grid-cols-3">
              {generatedImages.map((img, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-2xl bg-neutral-900"
                >
                  <img
                    src={`data:image/png;base64,${img}`}
                    alt={`Generated room concept ${index + 1}`}
                    className={`w-full ${
                      refining && selectedConcept === index ? "opacity-60" : ""
                    }`}
                  />
                  <div className="p-4">
                    <div className="grid gap-2">
                      <button
                        onClick={() => {
                          const isSelected = selectedConcept === index;

                          setSelectedConcept(isSelected ? null : index);
                          trackEvent(
                            isSelected
                              ? "concept_deselected"
                              : "concept_selected",
                            { conceptIndex: index }
                          );
                        }}
                        className={`w-full rounded-lg border px-4 py-2 text-sm ${
                          selectedConcept === index
                            ? "border-white bg-white text-black"
                            : "border-neutral-700 hover:bg-neutral-800"
                        }`}
                      >
                        {selectedConcept === index ? "Selected" : "Choose this concept"}
                      </button>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          onClick={() => downloadGeneratedImage(img, index)}
                          className="w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                        >
                          Download
                        </button>

                        <button
                          onClick={() => shareGeneratedConcept(index)}
                          className="w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                        >
                          Share
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {products.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">
                  Suggested furniture bundle
                </h2>
                <p className="mt-2 inline-flex rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                  Bundle offer: 10% off full room package
                </p>
              </div>

              <button
                type="button"
                onClick={addFullBundleToCart}
                className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-neutral-200"
              >
                Add full bundle to cart
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {products.map((p) => (
                <article
                  key={p.id}
                  className="rounded-xl bg-neutral-900 p-4"
                >
                  <div className="relative mb-3">
                    <img
                      src={getProductImageUrl(p)}
                      alt={p.name}
                      className="h-48 w-full rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => toggleFavouriteProduct(p.id, p.name)}
                      aria-pressed={favouriteProductIds.includes(p.id)}
                      className={`absolute right-3 top-3 rounded-full border px-3 py-1 text-sm font-semibold ${
                        favouriteProductIds.includes(p.id)
                          ? "border-white bg-white text-black"
                          : "border-neutral-700 bg-neutral-950/80 text-white hover:bg-neutral-800"
                      }`}
                    >
                      {favouriteProductIds.includes(p.id) ? "♥" : "♡"}
                    </button>
                  </div>

                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-neutral-400">
                    {getCategoryLabel(p.category)}
                  </p>

                  <p className="mt-2 text-neutral-200">
                    {formatPrice(p.price)}
                  </p>

                  <div className="mt-4 grid gap-2">
                    <button
                      type="button"
                      onClick={() => addProductToCart(p)}
                      className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200"
                    >
                      Add to cart
                    </button>
                    <a
                      href={p.url}
                      target="_blank"
                      className="rounded-lg border border-neutral-700 px-4 py-2 text-center text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                      View product
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
