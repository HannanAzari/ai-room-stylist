"use client";

import { useEffect, useState } from "react";
import allProducts from "@/data/products.json";

const styles = [
  "modern luxury",
  "warm neutral",
  "minimal",
  "hotel style",
  "family living",
];

const roomTypes = ["living room", "dining room", "bedroom"];
const CACHE_KEY = "ai-room-stylist:last-result";

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  url: string;
  imageUrl: string;
};

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

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      setGeneratedImages(parsed.generatedImages || []);
      setProducts(parsed.products || []);
      setStyle(parsed.style || styles[0]);
      setRoomType(parsed.roomType || roomTypes[0]);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }
  function handleImageChange(file: File | null) {
    setImage(file);
    setGeneratedImages([]);
    setProducts([]);
    setError("");

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
    setError("");
    setGeneratedImages([]);
    setProducts([]);

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
    if (!changeRequest.trim()) return;

    setRefining(true);
    setError("");

    try {
      const res = await fetch("/api/refine-room", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: generatedImages[selectedConcept],
          changeRequest,
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
              <p className="mb-3 text-sm text-neutral-300">
                Select products to include
              </p>

              <div className="grid gap-3">
                {(allProducts as Product[]).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    type="button"
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left ${
                      selectedProductIds.includes(p.id)
                        ? "border-white bg-neutral-800"
                        : "border-neutral-700 bg-neutral-950 hover:bg-neutral-800"
                    }`}
                  >
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                    <div>
                      <p className="text-sm font-semibold">{p.name}</p>
                      <p className="text-xs text-neutral-400">{p.category}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !image}
              className="w-full rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate 3 concepts"}
            </button>
            <button
              onClick={() => {
                localStorage.removeItem(CACHE_KEY);
                setGeneratedImages([]);
                setProducts([]);
                setSelectedConcept(null);
                setChangeRequest("");
              }}
              className="mt-3 w-full rounded-xl border border-neutral-700 px-6 py-3 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              Clear saved results
            </button>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </div>
        </div>

        {generatedImages.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-2xl font-semibold">Generated concepts</h2>
            {selectedConcept !== null && (
              <section className="mt-10 rounded-2xl bg-neutral-900 p-6">
                <h2 className="text-2xl font-semibold">Refine selected concept</h2>

                <p className="mt-2 text-sm text-neutral-400">
                  Tell the AI what you want to change.
                </p>

                <textarea
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  placeholder="Example: make the sofa darker, add a larger rug, change the coffee table to marble..."
                  className="mt-4 min-h-28 w-full rounded-xl border border-neutral-700 bg-neutral-800 p-4 text-sm text-white"
                />

                <button
                  onClick={handleRefine}
                  disabled={!changeRequest.trim() || refining}
                  className="mt-4 rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {refining ? "Regenerating..." : "Regenerate with changes"}
                </button>
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
                    className="w-full"
                  />
                  <div className="p-4">
                    <button
                      onClick={() => setSelectedConcept(index)}
                      className={`w-full rounded-lg border px-4 py-2 text-sm ${
                        selectedConcept === index
                          ? "border-white bg-white text-black"
                          : "border-neutral-700 hover:bg-neutral-800"
                      }`}
                    >
                      {selectedConcept === index ? "Selected" : "Choose this concept"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {products.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-2xl font-semibold">
              Suggested furniture bundle
            </h2>

            <div className="grid gap-4 md:grid-cols-3">
              {products.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  className="rounded-xl bg-neutral-900 p-4 hover:bg-neutral-800"
                >
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    className="mb-3 h-48 w-full rounded-lg object-cover"
                  />

                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-neutral-400">{p.category}</p>

                  <p className="mt-2 text-neutral-200">
                    ${p.price.toLocaleString()}
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}