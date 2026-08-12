"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createManualSelection,
  displayCategoryName,
  isObjectSelected,
  normaliseRect,
  projectBox,
  removeSelection,
  toggleObjectSelection,
  type RoomSelection,
  type SelectableObject,
  type SourceImageSize,
} from "@/lib/intelligence/room-selection";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";

/**
 * Room object selection surface.
 *
 * Two ways in:
 *   Smart Select — tap a detected object. Regions are BOUNDING BOXES from scene
 *                  analysis, not pixel masks (the provider does not expose
 *                  usable masks), so the outlines are drawn as soft rounded
 *                  regions rather than pretending to be cut-outs.
 *   Draw manually — drag a rectangle, then say what it is.
 *
 * Nothing is selected implicitly. Each tap authorises exactly one object.
 */

/** Categories a customer can assign to a hand-drawn region. */
const MANUAL_CATEGORIES: CanonicalCategory[] = [
  "sofa",
  "armchair",
  "chair",
  "coffee-table",
  "dining-table",
  "rug",
  "tv-unit",
  "bed",
  "bedside",
  "dresser",
  "floor-lamp",
  "table-lamp",
  "artwork",
  "mirror",
];

type Mode = "smart" | "manual";

type DragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null;

export function RoomObjectSelector({
  imageUrl,
  objects,
  selections,
  onSelectionsChange,
  sourceImage,
  detectionState,
}: {
  imageUrl: string;
  objects: SelectableObject[];
  selections: RoomSelection[];
  onSelectionsChange: (next: RoomSelection[]) => void;
  sourceImage: SourceImageSize;
  detectionState: "idle" | "loading" | "ready" | "unavailable";
}) {
  const [mode, setMode] = useState<Mode>("smart");
  const [drag, setDrag] = useState<DragState>(null);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(
    null
  );
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });

  // Selections are stored normalised, so the rendered overlay only needs the
  // current pixel size of the image surface. Re-measured on resize/rotate so a
  // selection made in portrait still lands correctly in landscape.
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setDisplay({ width: rect.width, height: rect.height });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Switch modes, abandoning any unfinished drag. Done here rather than in an
   * effect so the state change is a direct consequence of the tap.
   */
  function switchMode(next: Mode) {
    setMode(next);
    setDrag(null);
    if (next === "smart" && pendingSelectionId) {
      // An unnamed region is discarded rather than left in limbo.
      onSelectionsChange(removeSelection(selections, pendingSelectionId));
      setPendingSelectionId(null);
    }
  }

  const pointFromEvent = useCallback((event: React.PointerEvent) => {
    const element = surfaceRef.current;
    if (!element) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }, []);

  function handlePointerDown(event: React.PointerEvent) {
    if (mode !== "manual" || pendingSelectionId) return;
    const { x, y } = pointFromEvent(event);
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDrag({ startX: x, startY: y, currentX: x, currentY: y });
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!drag) return;
    const { x, y } = pointFromEvent(event);
    setDrag({ ...drag, currentX: x, currentY: y });
  }

  function handlePointerUp() {
    if (!drag || display.width === 0) {
      setDrag(null);
      return;
    }

    const left = Math.min(drag.startX, drag.currentX);
    const top = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    setDrag(null);

    // Ignore taps and hairline drags — they are almost always accidental.
    if (width < 24 || height < 24) return;

    const selection = createManualSelection({
      boundingBox: normaliseRect({ left, top, width, height }, display),
      sourceImage,
    });
    onSelectionsChange([...selections, selection]);
    // The region exists but has no type yet; ask for one immediately.
    setPendingSelectionId(selection.selectionId);
  }

  function assignPendingCategory(category: CanonicalCategory) {
    if (!pendingSelectionId) return;
    onSelectionsChange(
      selections.map((selection) =>
        selection.selectionId === pendingSelectionId
          ? {
              ...selection,
              canonicalCategory: category,
              displayName: displayCategoryName(category),
              instanceLabel: displayCategoryName(category),
            }
          : selection
      )
    );
    setPendingSelectionId(null);
  }

  function cancelPending() {
    if (!pendingSelectionId) return;
    onSelectionsChange(removeSelection(selections, pendingSelectionId));
    setPendingSelectionId(null);
  }

  const dragRect =
    drag && {
      left: Math.min(drag.startX, drag.currentX),
      top: Math.min(drag.startY, drag.currentY),
      width: Math.abs(drag.currentX - drag.startX),
      height: Math.abs(drag.currentY - drag.startY),
    };

  const smartUnavailable = detectionState === "unavailable";
  const noneDetected = detectionState === "ready" && objects.length === 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => switchMode("smart")}
          aria-pressed={mode === "smart"}
          disabled={smartUnavailable}
          className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition disabled:opacity-40 ${
            mode === "smart"
              ? "border-[#C9A57A]/60 bg-[#C9A57A]/15 text-[#C9A57A]"
              : "border-white/12 bg-white/[0.03] text-[#9a978f]"
          }`}
        >
          Smart Select
        </button>
        <button
          type="button"
          onClick={() => switchMode("manual")}
          aria-pressed={mode === "manual"}
          className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition ${
            mode === "manual"
              ? "border-[#C9A57A]/60 bg-[#C9A57A]/15 text-[#C9A57A]"
              : "border-white/12 bg-white/[0.03] text-[#9a978f]"
          }`}
        >
          Draw manually
        </button>
      </div>

      {/*
        The surface matches the PHOTO'S aspect ratio so the whole image is
        visible and un-cropped. This is load-bearing: selections are stored
        normalised against the full image, so cropping (object-cover) would put
        every overlay box in the wrong place — and would hide objects the
        customer needs to be able to tap.
      */}
      <div
        ref={surfaceRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
        style={
          sourceImage.width > 0 && sourceImage.height > 0
            ? { aspectRatio: `${sourceImage.width} / ${sourceImage.height}` }
            : { aspectRatio: "4 / 3" }
        }
        className={`v2-hero-shadow relative w-full select-none overflow-hidden rounded-[26px] border border-white/10 bg-[#0B0B0B] ${
          mode === "manual" ? "cursor-crosshair touch-none" : ""
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Your room"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {detectionState === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
            <p className="text-xs font-semibold text-[#F5F3EE]">
              Finding objects in your room…
            </p>
          </div>
        )}

        {/* Detected objects — tappable regions. */}
        {mode === "smart" &&
          display.width > 0 &&
          objects.map((object) => {
            const rect = projectBox(object.boundingBox, display);
            const selected = isObjectSelected(selections, object.sceneItemId);

            return (
              <button
                key={object.sceneItemId}
                type="button"
                aria-pressed={selected}
                aria-label={`${object.displayName}${selected ? ", selected" : ""}`}
                onClick={() =>
                  onSelectionsChange(
                    toggleObjectSelection(selections, object, sourceImage)
                  )
                }
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
                className={`absolute rounded-2xl border-2 transition ${
                  selected
                    ? "border-[#C9A57A] bg-[#C9A57A]/20 shadow-[0_0_0_1px_rgba(11,11,13,0.6),0_8px_24px_rgba(0,0,0,0.45)]"
                    : "border-white/45 bg-white/[0.06] hover:border-white/80"
                }`}
              >
                {selected && (
                  <span className="absolute -top-2 left-2 rounded-full bg-[#C9A57A] px-2 py-0.5 text-[10px] font-semibold text-[#0b0b0d]">
                    {object.displayName}
                  </span>
                )}
              </button>
            );
          })}

        {/* Hand-drawn regions. */}
        {display.width > 0 &&
          selections
            .filter((selection) => selection.selectionMethod === "manual")
            .map((selection) => {
              const rect = projectBox(selection.boundingBox, display);
              return (
                <div
                  key={selection.selectionId}
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                  className="absolute rounded-2xl border-2 border-[#C9A57A] bg-[#C9A57A]/20"
                >
                  <span className="absolute -top-2 left-2 rounded-full bg-[#C9A57A] px-2 py-0.5 text-[10px] font-semibold text-[#0b0b0d]">
                    {selection.displayName}
                  </span>
                </div>
              );
            })}

        {/* Live drag preview. */}
        {dragRect && dragRect.width > 4 && (
          <div
            style={dragRect}
            className="pointer-events-none absolute rounded-2xl border-2 border-dashed border-[#C9A57A] bg-[#C9A57A]/10"
          />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
          <p className="text-center text-[11px] leading-4 text-[#d9d6cf]">
            {mode === "manual"
              ? "Drag around an object to select it."
              : smartUnavailable
                ? "Automatic detection isn't available right now — draw around what you'd like to change."
                : noneDetected
                  ? "Nothing detected automatically — try drawing around an object."
                  : "Tap an object to select it. Tap again to remove."}
          </p>
        </div>
      </div>

      {/* Region drawn, awaiting its type. */}
      {pendingSelectionId && (
        <div className="v2-surface rounded-2xl p-4">
          <p className="text-sm font-semibold text-[#F5F3EE]">
            What did you select?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {MANUAL_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => assignPendingCategory(category)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs font-semibold text-[#9a978f] transition hover:border-[#C9A57A]/50 hover:text-[#C9A57A]"
              >
                {displayCategoryName(category)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={cancelPending}
            className="mt-3 text-xs font-semibold text-[#9a978f] underline underline-offset-4"
          >
            Remove this selection
          </button>
        </div>
      )}

      {/* Honest note about what the outlines actually are. */}
      {mode === "smart" && detectionState === "ready" && objects.length > 0 && (
        <p className="px-1 text-[11px] leading-4 text-[#7d7a73]">
          Outlines show the area around each object, not an exact cut-out.
        </p>
      )}
    </div>
  );
}
