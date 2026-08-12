"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createManualSelection,
  displayCategoryName,
  isObjectSelected,
  projectBox,
  removeSelection,
  toggleObjectSelection,
  type RoomSelection,
  type SelectableObject,
  type SourceImageSize,
} from "@/lib/intelligence/room-selection";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";

/**
 * Room object selection workspace.
 *
 * The room photo is the interface, so it is given most of the viewport and the
 * surrounding chrome is kept deliberately thin.
 *
 * Smart Select shows the room CLEANLY. Detected objects are hit-test regions,
 * not drawings: an unselected object gets at most a small dot, and only a
 * SELECTED object is outlined. Showing every detected rectangle at once is
 * computer-vision debugging output, not a consumer experience.
 *
 * Draw manually is a brush, not a drag-rectangle: the customer paints over the
 * thing they want changed. That paint is a genuine mask (the customer drew it),
 * which is why it is stored in the selection's `mask` field — unlike the
 * provider's segmentation, which does not return usable masks at all.
 */

/** Categories a customer can assign to a painted region. */
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

/** Brush radius in CSS pixels — a comfortable fingertip. */
const BRUSH_RADIUS = 26;

/**
 * Share of the usable viewport the photo may occupy.
 *
 * `svh` (small viewport height) is used deliberately: on iOS Safari the URL bar
 * collapses and expands, and `vh` would make the image jump and overflow behind
 * the browser chrome. `svh` is the stable smallest height.
 */
const MAX_IMAGE_VIEWPORT_SHARE = "68svh";

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
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(
    null
  );
  const [isPainting, setIsPainting] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const paintedBoundsRef = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });

  // Selections are stored normalised, so the overlay only needs the current
  // pixel size of the image surface. Re-measured on resize/rotate.
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

  // Keep the paint canvas backing store in step with its displayed size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || display.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(display.width * dpr);
    canvas.height = Math.round(display.height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, [display.width, display.height]);

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    paintedBoundsRef.current = null;
    lastPointRef.current = null;
  }

  function switchMode(next: Mode) {
    setMode(next);
    setIsPainting(false);
    clearCanvas();
    if (next === "smart" && pendingSelectionId) {
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

  function paintAt(x: number, y: number) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "rgba(201,165,122,0.55)";
    ctx.strokeStyle = "rgba(201,165,122,0.55)";
    ctx.lineWidth = BRUSH_RADIUS * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Join consecutive points into one continuous stroke. Stamping isolated
    // circles leaves a scalloped edge that reads as a series of dots rather
    // than a brush.
    const previous = lastPointRef.current;
    if (previous) {
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPointRef.current = { x, y };

    const bounds = paintedBoundsRef.current;
    const next = {
      minX: Math.min(bounds?.minX ?? x, x - BRUSH_RADIUS),
      minY: Math.min(bounds?.minY ?? y, y - BRUSH_RADIUS),
      maxX: Math.max(bounds?.maxX ?? x, x + BRUSH_RADIUS),
      maxY: Math.max(bounds?.maxY ?? y, y + BRUSH_RADIUS),
    };
    paintedBoundsRef.current = next;
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (mode !== "manual" || pendingSelectionId) return;
    const { x, y } = pointFromEvent(event);
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setIsPainting(true);
    // A new stroke must not connect back to where the last one ended.
    lastPointRef.current = null;
    paintAt(x, y);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!isPainting) return;
    const { x, y } = pointFromEvent(event);
    paintAt(x, y);
  }

  function handlePointerUp() {
    if (!isPainting) return;
    setIsPainting(false);

    const bounds = paintedBoundsRef.current;
    const canvas = canvasRef.current;
    if (!bounds || !canvas || display.width === 0) {
      clearCanvas();
      return;
    }

    // Ignore an accidental dab.
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width < BRUSH_RADIUS || height < BRUSH_RADIUS) {
      clearCanvas();
      return;
    }

    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const x = clamp01(bounds.minX / display.width);
    const y = clamp01(bounds.minY / display.height);
    const selection = createManualSelection({
      boundingBox: {
        x,
        y,
        width: clamp01(bounds.maxX / display.width) - x,
        height: clamp01(bounds.maxY / display.height) - y,
      },
      sourceImage,
    });

    // The painted pixels ARE a real mask — the customer drew it — so it is
    // carried on the selection rather than reduced to its bounding box.
    const painted: RoomSelection = {
      ...selection,
      mask: canvas.toDataURL("image/png"),
    };

    onSelectionsChange([...selections, painted]);
    setPendingSelectionId(painted.selectionId);
    clearCanvas();
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

  const smartUnavailable = detectionState === "unavailable";
  const noneDetected = detectionState === "ready" && objects.length === 0;
  const manualSelections = selections.filter(
    (selection) => selection.selectionMethod === "manual"
  );
  const hasSelection = selections.length > 0;

  /**
   * The surface must be EXACTLY the rendered image box, or every overlay lands
   * in the wrong place. Width is capped by both the container and the width
   * implied by the height budget, and `aspect-ratio` then derives the height —
   * so the photo is as large as it can be without ever being cropped.
   */
  const aspect =
    sourceImage.width > 0 && sourceImage.height > 0
      ? sourceImage.width / sourceImage.height
      : 4 / 3;
  const surfaceStyle: React.CSSProperties = {
    aspectRatio: `${aspect}`,
    width: `min(100%, calc(${MAX_IMAGE_VIEWPORT_SHARE} * ${aspect}))`,
  };

  return (
    <div className="space-y-2.5">
      {/* Compact segmented control. */}
      <div className="mx-auto grid w-full max-w-xs grid-cols-2 rounded-full border border-white/12 bg-white/[0.03] p-1">
        {(["smart", "manual"] as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            aria-pressed={mode === value}
            disabled={value === "smart" && smartUnavailable}
            className={`min-h-9 rounded-full px-3 text-xs font-semibold transition disabled:opacity-40 ${
              mode === value
                ? "bg-[#C9A57A] text-[#0b0b0d]"
                : "text-[#9a978f]"
            }`}
          >
            {value === "smart" ? "Smart Select" : "Draw manually"}
          </button>
        ))}
      </div>

      {/* Full-bleed so the photo gets the whole screen width on mobile. */}
      <div className="-mx-6 flex justify-center">
        <div
          ref={surfaceRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={surfaceStyle}
          className={`relative select-none overflow-hidden bg-[#0B0B0B] ${
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

          {/* Selecting something focuses attention on it by easing the rest back. */}
          {hasSelection && (
            <div className="pointer-events-none absolute inset-0 bg-black/30" />
          )}

          {/* Painted masks from manual selections. */}
          {manualSelections.map((selection) =>
            selection.mask ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={selection.selectionId}
                src={selection.mask}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            ) : null
          )}

          {/* Live brush strokes. */}
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            style={{ width: display.width, height: display.height }}
            className={`pointer-events-none absolute inset-0 ${
              mode === "manual" ? "" : "hidden"
            }`}
          />

          {/* Detected objects: hit-test regions, drawn only when selected. */}
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
                  className={`absolute rounded-[18px] transition ${
                    selected
                      ? "bg-[#C9A57A]/20 shadow-[0_0_0_2px_#C9A57A,0_0_0_5px_rgba(11,11,13,0.55)]"
                      : "bg-transparent"
                  }`}
                >
                  {selected ? (
                    <span className="absolute -top-2.5 left-2 whitespace-nowrap rounded-full bg-[#C9A57A] px-2 py-0.5 text-[10px] font-semibold text-[#0b0b0d] shadow">
                      {object.displayName}
                    </span>
                  ) : (
                    // A restrained affordance so tappable things are findable,
                    // without covering the photo in boxes.
                    <span className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]" />
                  )}
                </button>
              );
            })}

          {detectionState === "loading" && (
            <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
              <p className="text-xs font-semibold text-[#F5F3EE]">
                Finding objects in your room…
              </p>
            </div>
          )}
        </div>
      </div>

      {/* One short line of guidance, not a panel. */}
      <div className="flex min-h-5 items-center justify-center gap-3 px-1">
        <p className="text-center text-[11px] leading-4 text-[#9a978f]">
          {mode === "manual"
            ? "Paint over anything you'd like to change."
            : smartUnavailable
              ? "Automatic detection isn't available — try drawing instead."
              : noneDetected
                ? "Nothing detected automatically — try drawing instead."
                : hasSelection
                  ? "Tap a highlighted item to remove it."
                  : "Tap an object to select it."}
        </p>
        {hasSelection && (
          <button
            type="button"
            onClick={() => {
              onSelectionsChange([]);
              setPendingSelectionId(null);
              clearCanvas();
            }}
            className="shrink-0 text-[11px] font-semibold text-[#9a978f] underline underline-offset-4"
          >
            Clear
          </button>
        )}
      </div>

      {/* Painted region awaiting its type. */}
      {pendingSelectionId && (
        <div className="v2-surface rounded-2xl p-3">
          <p className="text-xs font-semibold text-[#F5F3EE]">
            What did you paint over?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MANUAL_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => assignPendingCategory(category)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-[#9a978f] transition hover:border-[#C9A57A]/50 hover:text-[#C9A57A]"
              >
                {displayCategoryName(category)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={cancelPending}
            className="mt-2 text-[11px] font-semibold text-[#9a978f] underline underline-offset-4"
          >
            Remove this selection
          </button>
        </div>
      )}
    </div>
  );
}
