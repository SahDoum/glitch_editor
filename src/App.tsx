import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
} from "react";
import {
  createJpegCoefficientReader,
  type JpegCoefficientReader,
} from "./application/coefficient-reader";
import {
  applyMaskToDocument,
  createJpegDocumentSession,
  type JpegEditableState,
} from "./application/jpeg-document";
import { importJpeg, type ImportedJpeg } from "./application/import-jpeg";
import {
  getJpegComponentBlockGrid,
  mapJpegBlockCoordinate,
  type JpegBlockCoordinate,
} from "./jpeg/block-geometry";
import type { JpegInspection } from "./jpeg/inspect";
import {
  createRectangleSelection,
  createSpatialMask,
  getMaskFromParameters,
  spatialMaskParameters,
  type SpatialMask,
  type SpatialSelection,
} from "./document/masks";
import type { ProjectDocument } from "./document/model";
import { OperationHistory } from "./operations/history";

const MARKER_LIMIT = 250;

function formatOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(6, "0").toUpperCase()}`;
}

function ImageOverlays({
  inspection,
  showBlocks,
  showMcus,
  selection,
  mask,
}: {
  inspection: JpegInspection;
  showBlocks: boolean;
  showMcus: boolean;
  selection: SpatialSelection | null;
  mask: SpatialMask | null;
}) {
  const blockPatternWidth = inspection.blockWidth;
  const blockPatternHeight = inspection.blockHeight;

  return (
    <svg
      className="image-overlays"
      viewBox={`0 0 ${inspection.width} ${inspection.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="block-grid"
          width={blockPatternWidth}
          height={blockPatternHeight}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${blockPatternWidth} 0 V ${blockPatternHeight} M 0 ${blockPatternHeight} H ${blockPatternWidth}`}
            fill="none"
            stroke="#c8f169"
            strokeOpacity="0.62"
            strokeWidth="0.45"
          />
        </pattern>
        <pattern
          id="mcu-grid"
          width={inspection.mcuWidth}
          height={inspection.mcuHeight}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${inspection.mcuWidth} 0 V ${inspection.mcuHeight} M 0 ${inspection.mcuHeight} H ${inspection.mcuWidth}`}
            fill="none"
            stroke="#ff9b72"
            strokeOpacity="0.9"
            strokeWidth="0.9"
          />
        </pattern>
      </defs>
      {showBlocks && (
        <rect
          width={inspection.width}
          height={inspection.height}
          fill="url(#block-grid)"
        />
      )}
      {showMcus && (
        <rect
          width={inspection.width}
          height={inspection.height}
          fill="url(#mcu-grid)"
        />
      )}
      {mask?.width === inspection.width &&
        mask.height === inspection.height &&
        mask.shapes.map((shape, index) => (
          <rect
            className="active-mask-overlay"
            key={`${mask.id}-${index}`}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
          />
        ))}
      {selection && (
        <rect
          className="selection-overlay"
          x={selection.x}
          y={selection.y}
          width={selection.width}
          height={selection.height}
        />
      )}
    </svg>
  );
}

function MetadataInspector({ inspection }: { inspection: JpegInspection }) {
  const visibleMarkers = inspection.markers.slice(0, MARKER_LIMIT);

  return (
    <aside className="inspector" aria-label="JPEG inspector">
      <section className="inspector-section">
        <div className="section-kicker">JPEG INSPECTOR</div>
        <h2>Structure</h2>
        <dl className="metadata-list">
          <div>
            <dt>Dimensions</dt>
            <dd>
              {inspection.width} × {inspection.height} px
            </dd>
          </div>
          <div>
            <dt>Process</dt>
            <dd>{inspection.process}</dd>
          </div>
          <div>
            <dt>Precision</dt>
            <dd>{inspection.precision}-bit samples</dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section">
        <div className="section-kicker">FRAME COMPONENTS</div>
        <ul className="component-list">
          {inspection.components.map((component) => {
            const blockGrid = getJpegComponentBlockGrid(
              inspection,
              component.id,
            );
            return (
              <li key={component.id}>
                <span className="component-id">ID {component.id}</span>
                <span>
                  Sampling {component.horizontalSampling}×
                  {component.verticalSampling}
                </span>
                <span>
                  DQT {component.quantizationTable} · DHT DC
                  {component.dcHuffmanTable}/AC{component.acHuffmanTable}
                </span>
                <span className="component-geometry">
                  {blockGrid?.columns} × {blockGrid?.rows} image blocks · MCU
                  capacity {component.blockColumns} × {component.blockRows}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="inspector-section">
        <div className="section-kicker">BLOCK GEOMETRY</div>
        <dl className="metadata-list">
          <div>
            <dt>MCU size</dt>
            <dd>
              {inspection.mcuWidth} × {inspection.mcuHeight} samples
            </dd>
          </div>
          <div>
            <dt>MCU grid</dt>
            <dd>
              {inspection.mcuColumns} × {inspection.mcuRows}
            </dd>
          </div>
          <div>
            <dt>Restart interval</dt>
            <dd>
              {inspection.restartInterval === 0
                ? "None"
                : `${inspection.restartInterval} MCUs`}
            </dd>
          </div>
          <div>
            <dt>Block overlay</dt>
            <dd>
              8×8 DCT blocks · component ID {inspection.blockGridComponentId}
            </dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section">
        <div className="section-heading">
          <div>
            <div className="section-kicker">ENCODED FILE</div>
            <h2>Marker sequence</h2>
          </div>
          <span className="count-badge">{inspection.markers.length}</span>
        </div>
        <div className="marker-table-wrap">
          <table className="marker-table">
            <thead>
              <tr>
                <th scope="col">Marker</th>
                <th scope="col">Byte range [start, end)</th>
                <th scope="col">Length</th>
              </tr>
            </thead>
            <tbody>
              {visibleMarkers.map((marker, index) => (
                <tr key={`${marker.startOffset}-${index}`}>
                  <th scope="row">{marker.name}</th>
                  <td>
                    [{formatOffset(marker.startOffset)},{" "}
                    {formatOffset(marker.endOffset)})
                  </td>
                  <td>{marker.segmentLength ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inspection.markers.length > MARKER_LIMIT && (
            <p className="marker-limit">
              Showing the first {MARKER_LIMIT} markers to keep the inspector
              responsive.
            </p>
          )}
        </div>
        {inspection.scans.map((scan, index) => (
          <p className="scan-range" key={`${scan.dataStartOffset}-${index}`}>
            Scan {index + 1} entropy-coded data: [
            {formatOffset(scan.dataStartOffset)},{" "}
            {formatOffset(scan.dataEndOffset)})
          </p>
        ))}
      </section>
    </aside>
  );
}

function CoefficientInspector({
  asset,
  inspection,
}: {
  asset: ImportedJpeg["originalAsset"];
  inspection: JpegInspection;
}) {
  const bytes = useMemo(() => asset.readBytes(), [asset]);
  const componentOptions = inspection.components;
  const [componentId, setComponentId] = useState(componentOptions[0]?.id ?? 0);
  const [blockX, setBlockX] = useState("0");
  const [blockY, setBlockY] = useState("0");
  const [values, setValues] = useState<number[] | null>(null);
  const [mapping, setMapping] = useState<JpegBlockCoordinate | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const reader = useRef<JpegCoefficientReader | null>(null);
  const requestId = useRef(0);

  useEffect(
    () => () => {
      requestId.current += 1;
      reader.current?.close();
      reader.current = null;
    },
    [bytes],
  );

  const selectedComponent =
    componentOptions.find((component) => component.id === componentId) ??
    componentOptions[0];
  const selectedBlockGrid = selectedComponent
    ? getJpegComponentBlockGrid(inspection, selectedComponent.id)
    : null;

  function clearSelection() {
    requestId.current += 1;
    setValues(null);
    setMapping(null);
    setErrorMessage("");
    setIsLoading(false);
  }

  async function inspectSelectedBlock() {
    if (!selectedComponent || !blockX.trim() || !blockY.trim()) {
      setErrorMessage("Enter a component and valid DCT block coordinates.");
      return;
    }

    const x = Number(blockX);
    const y = Number(blockY);
    const coordinate = mapJpegBlockCoordinate(
      inspection,
      selectedComponent.id,
      x,
      y,
    );
    if (!coordinate.ok) {
      setErrorMessage(coordinate.error.message);
      return;
    }

    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setErrorMessage("");
    setValues(null);
    setMapping(null);

    if (!reader.current) {
      const created = createJpegCoefficientReader();
      if (!created.ok) {
        setErrorMessage(created.error.message);
        setIsLoading(false);
        return;
      }
      reader.current = created.value;
    }

    try {
      const opened = await reader.current.open(bytes);
      if (currentRequest !== requestId.current) return;
      if (!opened.ok) {
        reader.current.close();
        reader.current = null;
        setErrorMessage(opened.error.message);
        return;
      }

      const componentIndex = componentOptions.findIndex(
        (component) => component.id === selectedComponent.id,
      );
      const result = await reader.current.readBlock(componentIndex, x, y);
      if (currentRequest !== requestId.current) return;
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }
      setValues(result.value);
      setMapping(coordinate.value);
    } catch {
      if (currentRequest === requestId.current) {
        setErrorMessage(
          "Coefficient inspection stopped unexpectedly. The original JPEG remains unchanged.",
        );
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }

  return (
    <section className="inspector-section coefficient-inspector">
      <div className="section-kicker">QUANTIZED DCT COEFFICIENTS</div>
      <h2>Inspect one block</h2>
      <p className="coefficient-description">
        Read-only JPEG-domain inspection through libjpeg-turbo WebAssembly. This
        reads quantized coefficients, not decoded pixel values.
      </p>
      <label className="coefficient-field">
        <span>Component</span>
        <select
          value={selectedComponent?.id ?? ""}
          onChange={(event) => {
            setComponentId(Number(event.currentTarget.value));
            clearSelection();
          }}
        >
          {componentOptions.map((component, index) => (
            <option key={component.id} value={component.id}>
              ID {component.id} · {component.horizontalSampling}×
              {component.verticalSampling} sampling · component {index}
            </option>
          ))}
        </select>
      </label>
      <div className="coefficient-coordinate-fields">
        <label className="coefficient-field">
          <span>Block X</span>
          <input
            type="number"
            min="0"
            max={Math.max(0, (selectedBlockGrid?.columns ?? 1) - 1)}
            step="1"
            value={blockX}
            onChange={(event) => {
              setBlockX(event.currentTarget.value);
              clearSelection();
            }}
          />
        </label>
        <label className="coefficient-field">
          <span>Block Y</span>
          <input
            type="number"
            min="0"
            max={Math.max(0, (selectedBlockGrid?.rows ?? 1) - 1)}
            step="1"
            value={blockY}
            onChange={(event) => {
              setBlockY(event.currentTarget.value);
              clearSelection();
            }}
          />
        </label>
      </div>
      <button
        className="coefficient-read-button"
        type="button"
        disabled={isLoading}
        onClick={() => void inspectSelectedBlock()}
      >
        {isLoading ? "Reading coefficients…" : "Read selected block"}
      </button>
      {errorMessage && (
        <p className="coefficient-error" role="alert">
          {errorMessage}
        </p>
      )}
      {mapping && (
        <p className="coefficient-mapping">
          Block ({mapping.blockX}, {mapping.blockY}) · image samples (
          {mapping.imageX}, {mapping.imageY}) · MCU ({mapping.mcuX},{" "}
          {mapping.mcuY}) · block in MCU ({mapping.blockInMcuX},{" "}
          {mapping.blockInMcuY})
        </p>
      )}
      {values ? (
        <>
          <div className="coefficient-table-wrap">
            <table className="coefficient-table">
              <thead>
                <tr>
                  <th scope="col">v / u</th>
                  {Array.from({ length: 8 }, (_, u) => (
                    <th scope="col" key={u}>
                      {u}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }, (_, v) => (
                  <tr key={v}>
                    <th scope="row">{v}</th>
                    {Array.from({ length: 8 }, (_, u) => (
                      <td
                        className={u === 0 && v === 0 ? "coefficient-dc" : ""}
                        key={u}
                      >
                        {values[v * 8 + u]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="coefficient-note">
            Natural coefficient order · DC at (u=0, v=0) · remaining values are
            AC spatial-frequency coefficients.
          </p>
        </>
      ) : (
        !errorMessage && (
          <p className="coefficient-note">
            Select a component and block coordinate to inspect its 64 quantized
            coefficients.
          </p>
        )
      )}
    </section>
  );
}

function App() {
  const [document, setDocument] = useState<ImportedJpeg | null>(null);
  const [historyDocument, setHistoryDocument] =
    useState<ProjectDocument<JpegEditableState> | null>(null);
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showMcus, setShowMcus] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<SpatialSelection | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const importController = useRef<AbortController | null>(null);
  const operationHistory = useRef<OperationHistory<JpegEditableState> | null>(
    null,
  );
  const selectionStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(
    () => () => {
      if (document) URL.revokeObjectURL(document.previewUrl);
    },
    [document],
  );

  useEffect(
    () => () => {
      importController.current?.abort();
    },
    [],
  );

  async function loadFile(file: File) {
    const currentRequest = ++requestId.current;
    importController.current?.abort();
    const controller = new AbortController();
    importController.current = controller;
    setErrorMessage("");
    setIsLoading(true);

    const result = await importJpeg(file, controller.signal);
    if (currentRequest !== requestId.current) {
      if (result.ok) URL.revokeObjectURL(result.value.previewUrl);
      return;
    }

    importController.current = null;
    setIsLoading(false);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }

    const history = createJpegDocumentSession(result.value);
    if (!history.ok) {
      URL.revokeObjectURL(result.value.previewUrl);
      setErrorMessage(history.error.message);
      return;
    }

    operationHistory.current = history.value;
    setHistoryDocument(history.value.snapshot);
    setHistoryAvailability({
      canUndo: history.value.canUndo,
      canRedo: history.value.canRedo,
    });
    setSelection(null);
    setIsSelecting(false);
    setShowBlocks(false);
    setShowMcus(false);
    setDocument(result.value);
  }

  function updateHistory(
    result: ReturnType<OperationHistory<JpegEditableState>["add"]>,
  ) {
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }
    setErrorMessage("");
    setHistoryDocument(result.value);
    const history = operationHistory.current;
    setHistoryAvailability({
      canUndo: history?.canUndo ?? false,
      canRedo: history?.canRedo ?? false,
    });
  }

  function mutateHistory(
    mutate: (
      history: OperationHistory<JpegEditableState>,
    ) => ReturnType<OperationHistory<JpegEditableState>["add"]>,
  ) {
    const history = operationHistory.current;
    if (!history) return;
    updateHistory(mutate(history));
  }

  function getImagePoint(
    event: PointerEvent<HTMLDivElement>,
  ): { x: number; y: number } | null {
    if (!document) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x:
        ((event.clientX - bounds.left) / bounds.width) *
        document.inspection.width,
      y:
        ((event.clientY - bounds.top) / bounds.height) *
        document.inspection.height,
    };
  }

  function updateSelection(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    if (!document) return;
    const result = createRectangleSelection(
      start.x,
      start.y,
      end.x,
      end.y,
      document.inspection.width,
      document.inspection.height,
    );
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }
    setSelection(result.value);
    const history = operationHistory.current;
    if (history) updateHistory(history.setSelection(result.value));
  }

  function onImagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!isSelecting || event.button !== 0) return;
    const point = getImagePoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectionStart.current = point;
    updateSelection(point, point);
  }

  function onImagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = selectionStart.current;
    const end = getImagePoint(event);
    if (start && end) updateSelection(start, end);
  }

  function onImagePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = selectionStart.current;
    const end = getImagePoint(event);
    if (start && end) updateSelection(start, end);
    selectionStart.current = null;
  }

  function addSelectionMask() {
    if (!document || !selection) return;
    const mask = createSpatialMask(
      selection,
      document.inspection.width,
      document.inspection.height,
    );
    if (!mask.ok) {
      setErrorMessage(mask.error.message);
      return;
    }
    const history = operationHistory.current;
    if (!history) return;
    updateHistory(applyMaskToDocument(history, mask.value));
  }

  function clearSelection() {
    setSelection(null);
    const history = operationHistory.current;
    if (history) updateHistory(history.setSelection(null));
  }

  function editMaskOperation(operationId: string) {
    if (!document || !selection) return;
    const mask = createSpatialMask(
      selection,
      document.inspection.width,
      document.inspection.height,
    );
    if (!mask.ok) {
      setErrorMessage(mask.error.message);
      return;
    }
    mutateHistory((history) =>
      history.editParameters(operationId, spatialMaskParameters(mask.value)),
    );
  }

  function handleUndo() {
    const history = operationHistory.current;
    if (history) updateHistory(history.undo());
  }

  function handleRedo() {
    const history = operationHistory.current;
    if (history) updateHistory(history.redo());
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void loadFile(file);
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1) {
      setErrorMessage("Open one JPEG at a time.");
      return;
    }
    if (files[0]) void loadFile(files[0]);
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="/" aria-label="JPEG Glitch Editor home">
          <span className="brand-mark" aria-hidden="true">
            J
          </span>
          <span>JPEG Glitch Editor</span>
        </a>
        <div className="topbar-actions">
          {document && (
            <span
              className="active-file"
              title={document.originalAsset.fileName}
            >
              {document.originalAsset.fileName}
            </span>
          )}
          <div className="history-toolbar" aria-label="Operation history">
            <button
              className="history-toolbar-button"
              type="button"
              onClick={handleUndo}
              disabled={!historyAvailability.canUndo}
              aria-label="Undo"
              title="Undo"
            >
              ↶
            </button>
            <button
              className="history-toolbar-button"
              type="button"
              onClick={handleRedo}
              disabled={!historyAvailability.canRedo}
              aria-label="Redo"
              title="Redo"
            >
              ↷
            </button>
          </div>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,.jpg,.jpeg"
            aria-label="Choose a JPEG file"
            onChange={onFileChange}
          />
          <button
            className="open-button"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={isLoading}
          >
            {isLoading ? "Inspecting…" : document ? "Open JPEG" : "Open JPEG"}
          </button>
          <span className="local-badge">
            <span className="status-dot" aria-hidden="true" />
            Local workspace
          </span>
        </div>
      </header>

      <section
        className={`editor ${isDragging ? "is-dragging" : ""}`}
        aria-label="JPEG workspace"
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="canvas">
          {!document ? (
            <div className="welcome">
              <div className="eyebrow">JPEG STRUCTURE · CREATIVE CONTROL</div>
              <h1>Make room for happy accidents.</h1>
              <p>
                Inspect JPEG structure and quantized DCT coefficients locally.
                The original file stays untouched and its pixel preview remains
                separate.
              </p>
              <button
                className="welcome-button"
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={isLoading}
              >
                Choose a JPEG
                <span aria-hidden="true">↗</span>
              </button>
              <div className="milestone-note">
                <span className="note-index">03</span>
                <span>
                  Drop a JPEG to inspect it, select a region, and build a
                  reversible mask history.
                </span>
              </div>
            </div>
          ) : (
            <div className="preview-workspace">
              <div className="preview-toolbar">
                <div>
                  <div className="section-kicker">DECODED PIXEL PREVIEW</div>
                  <p>
                    Browser decode · source JPEG bytes are preserved separately
                  </p>
                </div>
                <div className="overlay-controls">
                  <button
                    className={`tool-toggle ${isSelecting ? "is-active" : ""}`}
                    type="button"
                    aria-pressed={isSelecting}
                    onClick={() => {
                      setIsSelecting((active) => !active);
                      selectionStart.current = null;
                    }}
                  >
                    {isSelecting ? "Selecting region…" : "Select region"}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={showBlocks}
                      onChange={(event) =>
                        setShowBlocks(event.currentTarget.checked)
                      }
                    />
                    <span>8×8 blocks</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showMcus}
                      onChange={(event) =>
                        setShowMcus(event.currentTarget.checked)
                      }
                    />
                    <span>MCUs</span>
                  </label>
                </div>
              </div>
              <div className="image-stage">
                <div
                  className={`preview-image-wrap ${isSelecting ? "is-selecting" : ""}`}
                  onPointerDown={onImagePointerDown}
                  onPointerMove={onImagePointerMove}
                  onPointerUp={onImagePointerUp}
                  onPointerCancel={() => {
                    selectionStart.current = null;
                  }}
                >
                  <img
                    className="preview-image"
                    src={document.previewUrl}
                    alt={`Decoded preview of ${document.originalAsset.fileName}`}
                  />
                  <ImageOverlays
                    inspection={document.inspection}
                    showBlocks={showBlocks}
                    showMcus={showMcus}
                    selection={selection}
                    mask={historyDocument?.currentState.activeMask ?? null}
                  />
                </div>
              </div>
              <div className="preview-caption">
                <span>
                  {document.inspection.width} × {document.inspection.height}
                </span>
                <span>Pixel preview · no JPEG re-encoding</span>
              </div>
            </div>
          )}
          {isDragging && (
            <div className="drop-overlay" aria-hidden="true">
              <span>Drop one JPEG to inspect</span>
            </div>
          )}
        </div>

        <aside className="side-panel">
          {errorMessage && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden="true">
                !
              </span>
              <span>{errorMessage}</span>
            </div>
          )}
          {document ? (
            <>
              <section className="inspector-section selection-panel">
                <div className="section-kicker">SPATIAL SELECTION</div>
                <h2>Selection &amp; mask</h2>
                <p className="operation-description">
                  Draw a rectangle in image-pixel coordinates. Applying it
                  stores an editable mask operation; it does not change JPEG
                  coefficients or pixels.
                </p>
                {selection ? (
                  <p className="selection-readout">
                    x {selection.x.toFixed(1)} · y {selection.y.toFixed(1)} ·{" "}
                    {selection.width.toFixed(1)} × {selection.height.toFixed(1)}{" "}
                    image pixels
                  </p>
                ) : (
                  <p className="operation-empty">
                    Enable Select region and drag over the decoded preview.
                  </p>
                )}
                <div className="operation-actions">
                  <button
                    className="operation-button"
                    type="button"
                    disabled={!selection}
                    onClick={addSelectionMask}
                  >
                    Apply mask operation
                  </button>
                  <button
                    className="operation-button secondary"
                    type="button"
                    disabled={!selection}
                    onClick={clearSelection}
                  >
                    Clear selection
                  </button>
                </div>
              </section>
              <section className="inspector-section operation-stack">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">
                      NON-DESTRUCTIVE HISTORY
                    </div>
                    <h2>Operation stack</h2>
                  </div>
                  <span className="count-badge">
                    {historyDocument?.operations.length ?? 0}
                  </span>
                </div>
                <p className="operation-description">
                  Enabled operations replay in order from the original document.
                  Reordering recomputes later state.
                </p>
                {historyDocument?.operations.length ? (
                  <ol className="operation-list">
                    {historyDocument.operations.map((operation, index) => {
                      const mask = getMaskFromParameters(operation.parameters);
                      return (
                        <li
                          className="operation-entry"
                          key={operation.id}
                          data-enabled={operation.enabled}
                        >
                          <div className="operation-entry-heading">
                            <label className="operation-enabled">
                              <input
                                type="checkbox"
                                checked={operation.enabled}
                                onChange={(event) =>
                                  mutateHistory((history) =>
                                    history.setEnabled(
                                      operation.id,
                                      event.currentTarget.checked,
                                    ),
                                  )
                                }
                              />
                              <span>Spatial mask</span>
                            </label>
                            <span className="operation-status">
                              {operation.status}
                            </span>
                          </div>
                          {mask && (
                            <p className="operation-parameters">
                              Image-pixel rectangle · {mask.shapes[0]!.width} ×{" "}
                              {mask.shapes[0]!.height}
                            </p>
                          )}
                          <div className="operation-actions">
                            <button
                              className="operation-button secondary"
                              type="button"
                              disabled={index === 0}
                              aria-label="Move operation up"
                              onClick={() =>
                                mutateHistory((history) =>
                                  history.move(operation.id, index - 1),
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              className="operation-button secondary"
                              type="button"
                              disabled={
                                index ===
                                (historyDocument?.operations.length ?? 0) - 1
                              }
                              aria-label="Move operation down"
                              onClick={() =>
                                mutateHistory((history) =>
                                  history.move(operation.id, index + 1),
                                )
                              }
                            >
                              ↓
                            </button>
                            <button
                              className="operation-button secondary"
                              type="button"
                              disabled={!selection}
                              onClick={() => editMaskOperation(operation.id)}
                            >
                              Update from selection
                            </button>
                            <button
                              className="operation-button danger"
                              type="button"
                              aria-label="Delete operation"
                              onClick={() =>
                                mutateHistory((history) =>
                                  history.delete(operation.id),
                                )
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="operation-empty">
                    No operations yet. Add a mask from a spatial selection.
                  </p>
                )}
                <button
                  className="operation-reset"
                  type="button"
                  disabled={!historyDocument?.operations.length}
                  onClick={() => {
                    const history = operationHistory.current;
                    if (history) updateHistory(history.resetToOriginal());
                    clearSelection();
                  }}
                >
                  Reset to original
                </button>
              </section>
              <div className="source-card">
                <div className="section-kicker">ORIGINAL ASSET</div>
                <p
                  className="source-name"
                  title={document.originalAsset.fileName}
                >
                  {document.originalAsset.fileName}
                </p>
                <p className="source-size">
                  {document.originalAsset.byteLength.toLocaleString()} bytes
                  <span>·</span>
                  Original bytes held unchanged in memory
                </p>
                <div className="digest-label">SHA-256</div>
                <code className="digest-value">
                  {document.originalAsset.sha256}
                </code>
              </div>
              <CoefficientInspector
                key={document.originalAsset.sha256}
                asset={document.originalAsset}
                inspection={document.inspection}
              />
              <MetadataInspector inspection={document.inspection} />
            </>
          ) : (
            <div className="inspector-empty">
              <span className="empty-index">01 / INSPECT</span>
              <h2>JPEG structure</h2>
              <p>
                Dimensions, coding process, component sampling, table
                assignments, marker boundaries, and block geometry will appear
                here.
              </p>
              {errorMessage && (
                <p className="support-note">
                  Supported for coefficient inspection: 8-bit baseline
                  sequential Huffman JPEG, grayscale or three-component, single
                  interleaved scan.
                </p>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <span>
          {document
            ? `Original JPEG bytes preserved · revision ${historyDocument?.revision ?? 0}`
            : "Original files stay on your device."}
        </span>
        <span className="statusbar-right">
          <span>JPEG DOMAIN</span>
          <span className="status-divider" aria-hidden="true" />
          <span>{document ? "DOCUMENT HISTORY" : "MILESTONE 3"}</span>
        </span>
      </footer>
    </main>
  );
}

export default App;
