import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { z } from "zod";
import {
  structureSchema,
  type EditOperation,
  type Language,
  type Rect,
} from "../../shared/api/contracts";
import { usePDFDocument } from "../../shared/pdf/PDFCanvas";
import { Action, EditorProps } from "./model";
export function useEditor({
  api,
  document,
  artifactId,
  onJob,
}: Pick<EditorProps, "api" | "document" | "artifactId" | "onJob">) {
  const { pdf, error: pdfError } = usePDFDocument(artifactId);
  const [pages, setPages] = useState<z.infer<typeof structureSchema>>([]);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<Action>(
    new URLSearchParams(window.location.search).get("action") ===
      "retranslate_region"
      ? "retranslate_region"
      : "replace_text",
  );
  const [rect, setRect] = useState<Rect | null>(null);
  const [text, setText] = useState("");
  const [font, setFont] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(
    window.matchMedia("(min-width: 581px)").matches,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panMode, setPanMode] = useState(false);
  const panOrigin = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [target, setTarget] = useState<Language>("vi");
  const [operations, setOperations] = useState<EditOperation[]>([]);
  const [redo, setRedo] = useState<EditOperation[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [order, setOrder] = useState("");
  const [destination, setDestination] = useState("50,50,350,120");
  useEffect(() => {
    if (!artifactId || !document) return;
    const controller = new AbortController();
    void Promise.all([
      api.structure(artifactId, controller.signal),
      api.revisions(document.id, controller.signal),
    ])
      .then(([geometry, revisions]) => {
        setPages(geometry);
        setRevision(revisions[0]?.revision ?? 0);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [api, artifactId, document]);
  useEffect(() => {
    const layout = window.matchMedia("(min-width: 581px)");
    function adaptPages(event: MediaQueryListEvent): void {
      setThumbnailsOpen(event.matches);
    }
    layout.addEventListener("change", adaptPages);
    return () => layout.removeEventListener("change", adaptPages);
  }, []);
  useEffect(() => {
    function closePanels(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setPropertiesOpen(false);
      setThumbnailsOpen(false);
      setSearchOpen(false);
    }
    window.addEventListener("keydown", closePanels);
    return () => window.removeEventListener("keydown", closePanels);
  }, []);
  const geometry = pages[page];
  function point(event: PointerEvent<HTMLDivElement>): [number, number] {
    if (!geometry) throw new Error("Page geometry is unavailable.");
    const box = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - box.left) / box.width) * geometry.width,
      ((event.clientY - box.top) / box.height) * geometry.height,
    ];
  }
  function stage(): void {
    const requiresRect = ![
      "rotate_page",
      "delete_page",
      "reorder_pages",
    ].includes(action);
    if (requiresRect && !rect) {
      setError("Select a text block or drag a rectangle on the page.");
      return;
    }
    let dest: Rect | null = null;
    if (["move_block", "resize_block"].includes(action)) {
      const values = destination.split(",").map(Number);
      if (
        values.length !== 4 ||
        values.some((value) => !Number.isFinite(value))
      ) {
        setError("Destination requires four coordinates x0,y0,x1,y1.");
        return;
      }
      dest = [values[0]!, values[1]!, values[2]!, values[3]!];
    }
    const sequence =
      action === "reorder_pages"
        ? order.split(",").map((value) => Number(value.trim()) - 1)
        : null;
    const next: EditOperation = {
      type: action,
      page,
      rect,
      destination: dest,
      text: [
        "replace_text",
        "add_text",
        "add_annotation",
        "move_block",
        "resize_block",
      ].includes(action)
        ? text
        : null,
      font_size: font,
      angle: action === "rotate_page" ? 90 : null,
      order: sequence,
      source_language: action === "retranslate_region" ? "auto" : null,
      target_language: action === "retranslate_region" ? target : null,
    };
    setOperations((current) => [...current, next]);
    setRedo([]);
    setError(null);
  }
  async function save(): Promise<void> {
    if (!document || !artifactId)
      throw new Error("Choose a PDF before saving.");
    setBusy(true);
    setError(null);
    try {
      onJob(
        await api.operation(
          document.id,
          artifactId,
          { type: "edit", base_revision: revision, operations },
          crypto.randomUUID(),
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return {
    pdf,
    pdfError,
    pages,
    page,
    setPage,
    action,
    setAction,
    rect,
    setRect,
    text,
    setText,
    font,
    setFont,
    zoom,
    setZoom,
    propertiesOpen,
    setPropertiesOpen,
    thumbnailsOpen,
    setThumbnailsOpen,
    searchOpen,
    setSearchOpen,
    query,
    setQuery,
    panMode,
    setPanMode,
    panOrigin,
    target,
    setTarget,
    operations,
    setOperations,
    redo,
    setRedo,
    revision,
    busy,
    setBusy,
    error,
    setError,
    origin,
    setOrigin,
    order,
    setOrder,
    destination,
    setDestination,
    geometry,
    point,
    stage,
    save,
  };
}
