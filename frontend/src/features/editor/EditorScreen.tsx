import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Hand,
  LoaderCircle,
  PanelLeft,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type JSX } from "react";
import { languages, languageSchema } from "../../shared/api/contracts";
import { localizedLanguageName, useTranslation } from "../../shared/i18n/i18n";
import { PDFCanvas } from "../../shared/pdf/PDFCanvas";
import { Select, SelectOption } from "../../shared/ui/Select";
import { EditorToolbar } from "./EditorToolbar";
import { Action, actions, EditorProps } from "./model";
import { useEditor } from "./useEditor";
export function EditorScreen({
  api,
  document,
  artifactId,
  onChoose,
  onTools,
  onUpload,
  onJob,
}: EditorProps): JSX.Element {
  const { t, language: displayLanguage } = useTranslation();
  const {
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
  } = useEditor({ api, document, artifactId, onJob });
  return (
    <section
      className={`editor-workspace ${thumbnailsOpen ? "pages-open" : ""} ${artifactId ? "has-document" : "is-empty"}`}
      data-testid="editor-screen"
    >
      <div className="pdf-editor-top">
        <div className="pdf-editor-document">
          <button
            data-testid="editor-close"
            onClick={onChoose}
            aria-label={t("Back to My Documents")}
          >
            <ArrowLeft size={18} />
          </button>
          <strong title={document?.filename}>
            {document?.filename ?? "Edit PDF"}
          </strong>
          <small>
            {artifactId
              ? `${t("Revision")} ${revision} · ${pages.length} ${t("pages")}`
              : t("Select a document to get started")}
          </small>
        </div>
        <EditorToolbar
          action={action}
          canUndo={operations.length > 0}
          canRedo={redo.length > 0}
          canSave={operations.length > 0}
          busy={busy}
          artifactId={artifactId}
          onUndo={() => {
            const last = operations.at(-1);
            if (last) {
              setRedo((current) => [...current, last]);
              setOperations((current) => current.slice(0, -1));
            }
          }}
          onRedo={() => {
            const last = redo.at(-1);
            if (last) {
              setOperations((current) => [...current, last]);
              setRedo((current) => current.slice(0, -1));
            }
          }}
          onSave={() => void save()}
          onAction={(next) => {
            setAction(next);
            setPropertiesOpen(true);
            setPanMode(false);
          }}
          onTools={onTools}
          onSearch={() => setSearchOpen((current) => !current)}
        />
        <div className="pdf-editor-formatbar">
          <button
            data-testid="editor-pages-toggle"
            disabled={!pdf}
            aria-label={t("Show pages")}
            aria-expanded={thumbnailsOpen}
            onClick={() => setThumbnailsOpen((current) => !current)}
          >
            <PanelLeft size={18} />
            <span>{t("Pages")} </span>
          </button>
          <label className="pdf-editor-zoom-label">
            {t("Zoom")}{" "}
            <Select
              aria-label={t("Zoom")}
              data-testid="editor-zoom"
              disabled={!pdf}
              value={zoom}
              onValueChange={(value) => setZoom(Number(value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                <SelectOption key={value} value={value}>
                  {value * 100}%
                </SelectOption>
              ))}
            </Select>
          </label>
          <label className="pdf-editor-size-label">
            {t("Size")}{" "}
            <input
              data-testid="editor-font-size"
              aria-label={t("Cỡ chữ")}
              type="number"
              min={4}
              max={100}
              disabled={!pdf}
              value={font}
              onChange={(event) => setFont(Number(event.target.value))}
            />
          </label>
          <label className="pdf-editor-action-label">
            <span>{t("Action")} </span>
            <Select
              data-testid="editor-action"
              aria-label={t("Thao tác chỉnh sửa")}
              disabled={!pdf}
              value={action}
              onValueChange={(value) => {
                if (!actions.includes(value as Action))
                  throw new Error("Invalid editor action.");
                setAction(value as Action);
                setPropertiesOpen(true);
                setPanMode(false);
              }}
            >
              {actions.map((value) => (
                <SelectOption key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </SelectOption>
              ))}
            </Select>
          </label>
          <button
            data-testid="editor-properties-toggle"
            disabled={!pdf}
            aria-expanded={propertiesOpen}
            onClick={() => setPropertiesOpen((current) => !current)}
          >
            <PanelLeft size={19} /> {t("Properties")}{" "}
            {operations.length > 0 && (
              <span className="pdf-change-count">{operations.length}</span>
            )}
          </button>
        </div>
      </div>
      {searchOpen && (
        <form
          className="pdf-editor-search"
          onSubmit={(event) => {
            event.preventDefault();
            const match = pages.findIndex((item) =>
              item.blocks.some((block) =>
                block.text
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              ),
            );
            if (!query.trim() || match < 0) {
              setError("No matching text found in this document.");
              return;
            }
            setPage(match);
            setRect(null);
            setError(null);
          }}
        >
          <input
            autoFocus
            data-testid="editor-search"
            aria-label={t("Find text in PDF")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit">{t("Find")} </button>
          <button
            type="button"
            aria-label={t("Close search")}
            onClick={() => setSearchOpen(false)}
          >
            <X size={16} />
          </button>
        </form>
      )}
      {(error || pdfError) && (
        <p className="error-banner" role="alert">
          {error || pdfError}
        </p>
      )}
      <div className="editor-grid">
        <aside className="page-thumbnails">
          {pdf ? (
            pages.map((_, index) => (
              <button
                data-testid={`editor-page-${index + 1}`}
                key={index}
                className={page === index ? "selected" : ""}
                onClick={() => {
                  setPage(index);
                  setRect(null);
                  setThumbnailsOpen(false);
                }}
              >
                <PDFCanvas
                  pdf={pdf}
                  pageNumber={index + 1}
                  zoom={1}
                  onRendered={null}
                />
                <span>{index + 1}</span>
              </button>
            ))
          ) : (
            <p className="pdf-editor-no-pages">
              {t("Pages appear here after you open a PDF.")}{" "}
            </p>
          )}
        </aside>
        <div
          className="editor-canvas"
          style={{ cursor: panMode ? "grab" : undefined }}
          onPointerDown={(event) => {
            if (!panMode) return;
            panOrigin.current = {
              x: event.clientX,
              y: event.clientY,
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = panOrigin.current;
            if (!start) return;
            event.currentTarget.scrollLeft =
              start.left + start.x - event.clientX;
            event.currentTarget.scrollTop = start.top + start.y - event.clientY;
          }}
          onPointerUp={() => {
            panOrigin.current = null;
          }}
          onPointerCancel={() => {
            panOrigin.current = null;
          }}
        >
          {!artifactId && (
            <div className="pdf-editor-empty" data-testid="editor-empty-state">
              <div className="pdf-editor-empty-icon">
                <FileText size={34} />
              </div>
              <span className="pdf-editor-eyebrow">
                {t("YOUR DOCUMENT, YOUR WORKSPACE")}{" "}
              </span>
              <h1>{t("Make your PDF yours.")} </h1>
              <p>
                {t("Edit text, translate a region, or organize pages.")} <br />
                {t("Every save creates a new version of your document.")}{" "}
              </p>
              <label className="button primary pdf-editor-upload">
                <Upload size={18} />
                {busy ? t("Opening PDF…") : t("Open a PDF")}
                <input
                  data-testid="editor-upload"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setError(null);
                    void onUpload(file)
                      .catch((failure: Error) => setError(failure.message))
                      .finally(() => setBusy(false));
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                className="text-button"
                data-testid="editor-choose-document"
                onClick={onChoose}
              >
                {t("Choose from My Documents")}{" "}
              </button>
              <small>{t("PDF · Up to 20 MB · Original file preserved")} </small>
            </div>
          )}
          {artifactId && (!pdf || !geometry) && !error && !pdfError && (
            <div className="pdf-editor-loading" role="status">
              <LoaderCircle className="spin" size={24} />
              {t("Opening your document…")}{" "}
            </div>
          )}
          {pdf && geometry && (
            <div
              className="editor-page-surface"
              style={{ width: `min(${850 * zoom}px, ${100 * zoom}%)` }}
            >
              <PDFCanvas
                pdf={pdf}
                pageNumber={page + 1}
                zoom={1}
                onRendered={null}
              />
              <div
                data-testid="editor-selection-surface"
                className={`editor-selection-surface ${panMode ? "pan-mode" : ""}`}
                onPointerDown={(event) => {
                  if (panMode || event.target !== event.currentTarget) return;
                  setOrigin(point(event));
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={(event) => {
                  if (!origin) return;
                  const end = point(event);
                  setRect([
                    Math.min(origin[0], end[0]),
                    Math.min(origin[1], end[1]),
                    Math.max(origin[0], end[0]),
                    Math.max(origin[1], end[1]),
                  ]);
                  setOrigin(null);
                  setPropertiesOpen(true);
                  setThumbnailsOpen(false);
                }}
              >
                {geometry.blocks.map((block, index) => (
                  <button
                    key={index}
                    data-testid={`editor-block-${index}`}
                    className={`editor-text-block ${query.trim() && block.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? "search-match" : ""}`}
                    aria-label={`Select text block ${index + 1}`}
                    style={{
                      left: `${(block.rect[0] / geometry.width) * 100}%`,
                      top: `${(block.rect[1] / geometry.height) * 100}%`,
                      width: `${((block.rect[2] - block.rect[0]) / geometry.width) * 100}%`,
                      height: `${((block.rect[3] - block.rect[1]) / geometry.height) * 100}%`,
                    }}
                    onClick={() => {
                      setRect(block.rect);
                      setText(block.text);
                      setPropertiesOpen(true);
                      setThumbnailsOpen(false);
                    }}
                  />
                ))}
                {rect && (
                  <div
                    className="editor-selected-region"
                    style={{
                      left: `${(rect[0] / geometry.width) * 100}%`,
                      top: `${(rect[1] / geometry.height) * 100}%`,
                      width: `${((rect[2] - rect[0]) / geometry.width) * 100}%`,
                      height: `${((rect[3] - rect[1]) / geometry.height) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
        <aside className="editor-properties" hidden={!propertiesOpen}>
          <button
            className="pdf-properties-close"
            aria-label={t("Close properties")}
            onClick={() => setPropertiesOpen(false)}
          >
            <X size={18} />
          </button>
          <h3>{t("Text properties")} </h3>
          <label>
            {t("Text")}{" "}
            <textarea
              data-testid="editor-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={10000}
            />
          </label>
          {["move_block", "resize_block"].includes(action) && (
            <label>
              {t("Destination (PDF points)")}{" "}
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
            </label>
          )}
          {action === "reorder_pages" && (
            <label>
              {t("Page order")}{" "}
              <input
                data-testid="editor-page-order"
                placeholder="2,1,3"
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            </label>
          )}
          {action === "retranslate_region" && (
            <label>
              {t("Target language")}{" "}
              <Select
                value={target}
                onValueChange={(value) =>
                  setTarget(languageSchema.parse(value))
                }
              >
                {languages.map(([code]) => (
                  <SelectOption key={code} value={code}>
                    {localizedLanguageName(displayLanguage, code)}
                  </SelectOption>
                ))}
              </Select>
            </label>
          )}
          <p>
            {rect
              ? rect.map((value) => value.toFixed(1)).join(", ")
              : t("Select a block or drag to select a region.")}
          </p>
          <button
            className="button primary"
            data-testid="editor-stage"
            disabled={!pdf || busy}
            onClick={stage}
          >
            {t("Add change")}{" "}
          </button>
          <h3>
            {t("Pending changes (")} {operations.length})
          </h3>
          <ol>
            {operations.map((item, index) => (
              <li key={index}>
                {item.type.replaceAll("_", " ")} {t("· page")} {item.page + 1}
              </li>
            ))}
          </ol>
          <p>
            {t(
              "Changes apply in order when you save. A new revision is created; the input file remains available.",
            )}{" "}
          </p>
        </aside>
      </div>
      {pdf && (
        <nav className="pdf-editor-floating" aria-label={t("Điều hướng trang")}>
          <span>{t("Page")} </span>
          <button
            data-testid="editor-previous-page"
            aria-label={t("Trang trước")}
            disabled={page === 0}
            onClick={() => {
              setPage((current) => current - 1);
              setRect(null);
            }}
          >
            <ChevronUp size={20} />
          </button>
          <span>
            {page + 1} / {pages.length}
          </span>
          <button
            data-testid="editor-next-page"
            aria-label={t("Trang sau")}
            disabled={page + 1 >= pages.length}
            onClick={() => {
              setPage((current) => current + 1);
              setRect(null);
            }}
          >
            <ChevronDown size={20} />
          </button>
          <span className="pdf-format-divider" />
          <button
            data-testid="editor-zoom-in"
            aria-label={t("Phóng to")}
            disabled={zoom >= 2}
            onClick={() => setZoom((current) => Math.min(2, current + 0.25))}
          >
            <ZoomIn size={23} />
          </button>
          <button
            data-testid="editor-zoom-out"
            aria-label={t("Thu nhỏ")}
            disabled={zoom <= 0.5}
            onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}
          >
            <ZoomOut size={23} />
          </button>
          <button
            aria-label={t("Cuộn trang")}
            aria-pressed={panMode}
            onClick={() => {
              setPanMode((current) => !current);
              setPropertiesOpen(false);
            }}
          >
            <Hand size={24} />
          </button>
          <button onClick={onChoose} aria-label={t("Back to My Documents")}>
            <PanelLeft size={21} />
          </button>
        </nav>
      )}
    </section>
  );
}
