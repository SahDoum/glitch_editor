import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { importJpeg, type ImportedJpeg } from "./application/import-jpeg";
import type { JpegInspection } from "./jpeg/inspect";

const MARKER_LIMIT = 250;

function formatOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(6, "0").toUpperCase()}`;
}

function ImageOverlays({
  inspection,
  showBlocks,
  showMcus,
}: {
  inspection: JpegInspection;
  showBlocks: boolean;
  showMcus: boolean;
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
          {inspection.components.map((component) => (
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
                {component.blockColumns} × {component.blockRows} blocks
              </span>
            </li>
          ))}
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

function App() {
  const [document, setDocument] = useState<ImportedJpeg | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showMcus, setShowMcus] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const importController = useRef<AbortController | null>(null);

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

    setShowBlocks(false);
    setShowMcus(false);
    setDocument(result.value);
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
            <span className="active-file" title={document.fileName}>
              {document.fileName}
            </span>
          )}
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
                Inspect a JPEG locally. The original file stays untouched while
                its structure and decoded preview remain separate.
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
                <span className="note-index">01</span>
                <span>Drop a JPEG here or choose a file to inspect.</span>
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
                <div className="preview-image-wrap">
                  <img
                    className="preview-image"
                    src={document.previewUrl}
                    alt={`Decoded preview of ${document.fileName}`}
                  />
                  <ImageOverlays
                    inspection={document.inspection}
                    showBlocks={showBlocks}
                    showMcus={showMcus}
                  />
                </div>
              </div>
              <div className="preview-caption">
                <span>
                  {document.inspection.width} × {document.inspection.height}
                </span>
                <span>Preview only · no JPEG re-encoding</span>
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
              <div className="source-card">
                <div className="section-kicker">ORIGINAL ASSET</div>
                <p className="source-name" title={document.fileName}>
                  {document.fileName}
                </p>
                <p className="source-size">
                  {document.sourceBytes.byteLength.toLocaleString()} bytes
                  <span>·</span>
                  Original bytes held unchanged in memory
                </p>
                <div className="digest-label">SHA-256</div>
                <code className="digest-value">{document.sha256}</code>
              </div>
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
                  Supported: 8-bit baseline sequential Huffman JPEG, grayscale
                  or three-component, single interleaved scan.
                </p>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <span>
          {document
            ? "Original JPEG bytes preserved · inspection is read-only"
            : "Original files stay on your device."}
        </span>
        <span className="statusbar-right">
          <span>JPEG DOMAIN</span>
          <span className="status-divider" aria-hidden="true" />
          <span>{document ? "INSPECTOR 1.0" : "MILESTONE 1"}</span>
        </span>
      </footer>
    </main>
  );
}

export default App;
