import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  type Ref,
  type ReactNode,
} from "react";
import {
  encodeJpegCoefficients,
  createJpegCoefficientReader,
  type JpegCoefficientReader,
} from "./application/coefficient-reader";
import {
  applyBlockPermutationOperation,
  applyBlockRepeatOperation,
  applyCoefficientGlitchOperation,
  applyMaskToDocument,
  applyQuantizationOperation,
  createJpegDocumentSession,
  type JpegEditableState,
} from "./application/jpeg-document";
import { importJpeg, type ImportedJpeg } from "./application/import-jpeg";
import {
  getJpegComponentBlockGrid,
  mapJpegBlockCoordinate,
  mapJpegImagePointToBlock,
  snapSelectionToComponentBlocks,
  type JpegBlockGeometry,
  type JpegBlockCoordinate,
} from "./jpeg/block-geometry";
import type { JpegInspection } from "./jpeg/inspect";
import {
  createBrushMask,
  createRectangleSelection,
  createSpatialMask,
  getMaskFromParameters,
  spatialMaskParameters,
  type SpatialMask,
  type SpatialSelection,
} from "./document/masks";
import type { ProjectDocument } from "./document/model";
import { OperationHistory } from "./operations/history";
import {
  createQuantizationPattern,
  GLITCH_FREQUENCY_BANDS,
  QUANTIZATION_PATTERNS,
  QUANTIZATION_SEMANTICS,
  type CoefficientDomain,
  type CoefficientGlitchMode,
  type GlitchFrequencyBand,
  type JpegGlitchOperation,
  type QuantizationPattern,
  type QuantizationSemantics,
} from "./operations/jpeg-glitch";
import { DCT_FREQUENCY_BAND_RANGES } from "./operations/dct";
import {
  initialWorkspaceState,
  TOOL_GROUPS,
  workspaceReducer,
  type CanvasTool,
} from "./ui/workspace-state";
import {
  getBrushOverlayPath,
  getRectangleSelection,
} from "./ui/selection-overlay";

const MARKER_LIMIT = 250;
const EMPTY_JPEG_OPERATIONS: JpegEditableState["jpegOperations"] =
  Object.freeze([]);
type ImagePoint = { x: number; y: number };

function getToolIconPaths(tool: CanvasTool): readonly string[] {
  switch (tool) {
    case "hand":
      return [
        "M5 12V6a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v2-1a1.5 1.5 0 0 1 3 0v2-1a1.5 1.5 0 0 1 3 0v5c0 3-2 5-5 5h-2c-2 0-3-1-4-3l-2-3a1.5 1.5 0 0 1 2-2l2 2",
      ];
    case "inspector":
      return ["M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "m16 16 5 5"];
    case "brush":
      return ["m4 16 9-9 4 4-9 9H4v-4Z", "m12 8 3-3 4 4-3 3", "M4 21h7"];
    case "select":
      return ["M4 4h16v16H4z", "M9 4v3", "M15 4v3", "M4 9h3", "M4 15h3"];
    case "repeat-block":
      return ["M4 4h7v7H4z", "M13 13h7v7h-7z", "M13 4h7v5", "m17 6 3 3 3-3"];
    case "shuffle":
      return [
        "M4 7h3c4 0 6 10 10 10h3",
        "m17 14 3 3-3 3",
        "M4 17h3c2 0 3-2 4-4",
        "M16 7h4",
        "m17 4 3 3-3 3",
      ];
    case "quantization":
      return [
        "M4 4h16v16H4z",
        "M9.3 4v16",
        "M14.7 4v16",
        "M4 9.3h16",
        "M4 14.7h16",
      ];
  }
}

function CollapsibleSection({
  id,
  title,
  kicker,
  count,
  className = "",
  detailsRef,
  children,
}: {
  id: string;
  title: string;
  kicker?: string;
  count?: number;
  className?: string;
  detailsRef?: Ref<HTMLDetailsElement>;
  children: ReactNode;
}) {
  return (
    <details
      className={`collapsible-section ${className}`}
      open
      ref={detailsRef}
    >
      <summary className="collapsible-summary" aria-controls={`${id}-content`}>
        <span className="collapsible-heading">
          {kicker && <span className="section-kicker">{kicker}</span>}
          <span className="collapsible-title">{title}</span>
        </span>
        {count !== undefined && <span className="count-badge">{count}</span>}
        <span className="collapse-indicator" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="collapsible-content" id={`${id}-content`}>
        {children}
      </div>
    </details>
  );
}

function formatOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(6, "0").toUpperCase()}`;
}

function getComponentControlLabel(
  inspection: JpegInspection,
  componentIndex: number,
): string {
  const component = inspection.components[componentIndex];
  if (!component) return `Component ${componentIndex}`;
  if (inspection.components.length === 1) return `Gray · ID ${component.id}`;
  const commonName =
    component.id === 1
      ? "likely Y"
      : component.id === 2
        ? "likely Cb"
        : component.id === 3
          ? "likely Cr"
          : null;
  return `Component ${componentIndex}${commonName ? ` · ${commonName}` : ""} · ID ${component.id}`;
}

function getCurrentQuantizationTables(
  inspection: JpegInspection,
  operations: readonly JpegGlitchOperation[],
) {
  const latest = new Map<number, readonly number[]>();
  for (const operation of operations) {
    if (operation.kind === "quantization") {
      latest.set(operation.tableId, operation.values);
    }
  }
  return inspection.quantizationTables.map((table) => ({
    id: table.id,
    values: [...(latest.get(table.id) ?? table.values)],
  }));
}

function ImageOverlays({
  inspection,
  showBlocks,
  showMcus,
  selection,
  mask,
  brushDraft,
  brushRadius,
  selectedBlock,
}: {
  inspection: JpegInspection;
  showBlocks: boolean;
  showMcus: boolean;
  selection: SpatialSelection | null;
  mask: SpatialMask | null;
  brushDraft: readonly ImagePoint[];
  brushRadius: number;
  selectedBlock: JpegBlockCoordinate | null;
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
        mask.shapes.map((shape, index) =>
          shape.kind === "rectangle" ? null : shape.points.length === 1 ? (
            <circle
              className="active-mask-brush-point"
              key={`${mask.id}-${index}`}
              cx={shape.points[0]?.x}
              cy={shape.points[0]?.y}
              r={shape.radius}
            />
          ) : (
            <path
              className="active-mask-brush"
              key={`${mask.id}-${index}`}
              d={getBrushOverlayPath(shape.points)}
              strokeWidth={shape.radius * 2}
            />
          ),
        )}
      {selection && (
        <rect
          className="selection-overlay"
          x={selection.x}
          y={selection.y}
          width={selection.width}
          height={selection.height}
        />
      )}
      {brushDraft.length === 1 ? (
        <circle
          className="brush-draft-point"
          cx={brushDraft[0]?.x}
          cy={brushDraft[0]?.y}
          r={brushRadius}
        />
      ) : (
        brushDraft.length > 1 && (
          <path
            className="brush-draft-overlay"
            d={getBrushOverlayPath(brushDraft)}
            strokeWidth={brushRadius * 2}
          />
        )
      )}
      {selectedBlock && (
        <rect
          className="selected-block-overlay"
          x={selectedBlock.imageX}
          y={selectedBlock.imageY}
          width={selectedBlock.imageWidth}
          height={selectedBlock.imageHeight}
        />
      )}
    </svg>
  );
}

function describeMask(mask: SpatialMask): string {
  const shape = mask.shapes[0];
  if (!shape) return "Empty image-space mask";
  if (shape.kind === "rectangle") {
    return `Image-pixel rectangle · ${shape.width.toFixed(1)} × ${shape.height.toFixed(1)}`;
  }
  return `Image-pixel brush · radius ${shape.radius.toFixed(1)} px · ${shape.points.length} samples`;
}

function MetadataInspector({
  asset,
  inspection,
  quantizationTables,
  selectedBlock,
}: {
  asset: ImportedJpeg["originalAsset"];
  inspection: JpegInspection;
  quantizationTables: readonly {
    id: number;
    values: readonly number[];
  }[];
  selectedBlock: JpegBlockCoordinate | null;
}) {
  const visibleMarkers = inspection.markers.slice(0, MARKER_LIMIT);
  const jpegInspectorRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (selectedBlock && jpegInspectorRef.current) {
      jpegInspectorRef.current.open = true;
    }
  }, [selectedBlock]);

  return (
    <div className="inspector">
      <CollapsibleSection
        id="jpeg-inspector"
        title="Structure"
        kicker="JPEG INSPECTOR"
        detailsRef={jpegInspectorRef}
      >
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
        <CoefficientInspector
          asset={asset}
          inspection={inspection}
          selectedBlock={selectedBlock}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="frame-components"
        title="Components"
        kicker="FRAME COMPONENTS"
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        id="dqt-tables"
        title="Current 8×8 matrices"
        kicker="DQT QUANTIZATION TABLES"
      >
        {quantizationTables.map((table) => (
          <div className="quantization-table-view" key={table.id}>
            <p className="coefficient-note">Table {table.id} · natural order</p>
            <div className="coefficient-table-wrap">
              <table className="coefficient-table">
                <tbody>
                  {Array.from({ length: 8 }, (_, v) => (
                    <tr key={v}>
                      {Array.from({ length: 8 }, (_, u) => (
                        <td
                          className={u === 0 && v === 0 ? "coefficient-dc" : ""}
                          key={u}
                        >
                          {table.values[v * 8 + u]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        id="block-geometry"
        title="Block geometry"
        kicker="BLOCK GEOMETRY"
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        id="encoded-file"
        title="Marker sequence"
        kicker="ENCODED FILE"
        count={inspection.markers.length}
      >
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
      </CollapsibleSection>
    </div>
  );
}

function QuantizationMatrixEditor({
  quantizationTables,
  disabled,
  onApply,
}: {
  quantizationTables: readonly { id: number; values: readonly number[] }[];
  disabled: boolean;
  onApply(
    tableId: number,
    values: readonly number[],
    semantics: QuantizationSemantics,
    pattern: QuantizationPattern | "manual",
    seed: number,
  ): void;
}) {
  const [tableId, setTableId] = useState(quantizationTables[0]?.id ?? 0);
  const [values, setValues] = useState<number[]>(
    () => quantizationTables[0]?.values.slice() ?? [],
  );
  const [pattern, setPattern] = useState<QuantizationPattern | "manual">(
    "manual",
  );
  const [semantics, setSemantics] =
    useState<QuantizationSemantics>("reinterpret");
  const [seed, setSeed] = useState("1");
  const [errorMessage, setErrorMessage] = useState("");
  const table = quantizationTables.find(
    (candidate) => candidate.id === tableId,
  );

  function chooseTable(value: string) {
    const nextId = Number(value);
    const nextTable = quantizationTables.find(
      (candidate) => candidate.id === nextId,
    );
    if (!nextTable) return;
    setTableId(nextId);
    setValues(nextTable.values.slice());
    setErrorMessage("");
  }

  function applyPattern() {
    const seedValue = Number(seed);
    if (
      !Number.isInteger(seedValue) ||
      seedValue < 0 ||
      seedValue > 0xffff_ffff
    ) {
      setErrorMessage("Pattern seed must be an unsigned 32-bit integer.");
      return;
    }
    if (pattern === "manual") {
      setErrorMessage("Choose a generated pattern before applying it.");
      return;
    }
    const result = createQuantizationPattern(pattern, values, seedValue);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }
    setValues([...result.value]);
    setErrorMessage("");
  }

  const validValues =
    values.length === 64 &&
    Number.isInteger(Number(seed)) &&
    Number(seed) >= 0 &&
    Number(seed) <= 0xffff_ffff &&
    values.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 255,
    );

  return (
    <section className="inspector-section quantization-editor">
      <div className="section-kicker">FIRST GLITCH LAB · DQT</div>
      <h2>Quantization matrix</h2>
      <p className="operation-description">
        Edit the 64 quantization values used by components assigned to this
        table. Changing DQT values does not recover detail discarded earlier.
      </p>
      <label className="coefficient-field">
        <span>Table assigned to component(s)</span>
        <select
          value={tableId}
          disabled={disabled}
          onChange={(event) => chooseTable(event.currentTarget.value)}
        >
          {quantizationTables.map((entry) => (
            <option key={entry.id} value={entry.id}>
              DQT {entry.id}
            </option>
          ))}
        </select>
      </label>
      <div className="coefficient-table-wrap">
        <table className="coefficient-table editable-quantization-table">
          <tbody>
            {Array.from({ length: 8 }, (_, v) => (
              <tr key={v}>
                {Array.from({ length: 8 }, (_, u) => {
                  const index = v * 8 + u;
                  return (
                    <td
                      className={u === 0 && v === 0 ? "coefficient-dc" : ""}
                      key={u}
                    >
                      <input
                        aria-label={`DQT ${tableId}, u ${u}, v ${v}`}
                        type="number"
                        min="1"
                        max="255"
                        step="1"
                        value={values[index] ?? ""}
                        disabled={disabled}
                        onChange={(event) => {
                          const next = values.slice();
                          next[index] = Number(event.currentTarget.value);
                          setValues(next);
                          setPattern("manual");
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="quantization-pattern-controls">
        <label className="coefficient-field">
          <span>Pattern</span>
          <select
            value={pattern}
            disabled={disabled}
            onChange={(event) => {
              const next = QUANTIZATION_PATTERNS.find(
                (candidate) => candidate === event.currentTarget.value,
              );
              if (next) setPattern(next);
            }}
          >
            <option value="manual">manual values</option>
            {QUANTIZATION_PATTERNS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <label className="coefficient-field">
          <span>Seed</span>
          <input
            type="number"
            min="0"
            max="4294967295"
            step="1"
            value={seed}
            disabled={disabled}
            onChange={(event) => setSeed(event.currentTarget.value)}
          />
        </label>
      </div>
      <button
        className="operation-button secondary"
        type="button"
        disabled={disabled || pattern === "manual"}
        onClick={applyPattern}
      >
        Generate pattern
      </button>
      <label className="coefficient-field tool-field">
        <span>Apply semantics</span>
        <select
          value={semantics}
          disabled={disabled}
          onChange={(event) => {
            const next = QUANTIZATION_SEMANTICS.find(
              (candidate) => candidate === event.currentTarget.value,
            );
            if (next) setSemantics(next);
          }}
        >
          <option value="reinterpret">Reinterpret existing coefficients</option>
          <option value="requantize">
            Requantize from retained coefficients
          </option>
        </select>
      </label>
      <p className="coefficient-note">
        {semantics === "reinterpret"
          ? "Keeps quantized coefficients and changes their DQT interpretation."
          : "Approximates unquantized values as old coefficient × old DQT, then divides by the new DQT. Discarded information is not restored."}
      </p>
      {errorMessage && (
        <p className="coefficient-error" role="alert">
          {errorMessage}
        </p>
      )}
      <button
        className="operation-button"
        type="button"
        disabled={disabled || !table || !validValues}
        onClick={() =>
          onApply(tableId, values, semantics, pattern, Number(seed))
        }
      >
        Apply DQT pattern
      </button>
    </section>
  );
}

function CoefficientInspector({
  asset,
  inspection,
  selectedBlock,
}: {
  asset: ImportedJpeg["originalAsset"];
  inspection: JpegInspection;
  selectedBlock: JpegBlockCoordinate | null;
}) {
  const bytes = useMemo(() => asset.readBytes(), [asset]);
  const componentOptions = inspection.components;
  const [values, setValues] = useState<number[] | null>(null);
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

  useEffect(() => {
    const currentRequest = ++requestId.current;
    void (async () => {
      setValues(null);
      setErrorMessage("");
      if (!selectedBlock) {
        setIsLoading(false);
        return;
      }

      const coordinate = mapJpegBlockCoordinate(
        inspection,
        selectedBlock.componentId,
        selectedBlock.blockX,
        selectedBlock.blockY,
      );
      if (!coordinate.ok) {
        setErrorMessage(coordinate.error.message);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
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
          (component) => component.id === selectedBlock.componentId,
        );
        if (componentIndex < 0) {
          setErrorMessage("The selected JPEG component is invalid.");
          return;
        }
        const result = await reader.current.readBlock(
          componentIndex,
          selectedBlock.blockX,
          selectedBlock.blockY,
        );
        if (currentRequest !== requestId.current) return;
        if (!result.ok) {
          setErrorMessage(result.error.message);
          return;
        }
        setValues(result.value);
      } catch {
        if (currentRequest === requestId.current) {
          setErrorMessage(
            "Coefficient inspection stopped unexpectedly. The original JPEG remains unchanged.",
          );
        }
      } finally {
        if (currentRequest === requestId.current) setIsLoading(false);
      }
    })();

    return () => {
      if (requestId.current === currentRequest) requestId.current += 1;
    };
  }, [bytes, componentOptions, inspection, selectedBlock]);

  return (
    <div className="coefficient-inspector-content">
      <div className="section-kicker">QUANTIZED DCT COEFFICIENTS</div>
      <h3>Selected 8×8 DCT block</h3>
      <p className="coefficient-description">
        Read-only JPEG-domain inspection through libjpeg-turbo WebAssembly. This
        reads quantized coefficients, not decoded pixel values.
      </p>
      {selectedBlock && (
        <p className="coefficient-mapping">
          Component ID {selectedBlock.componentId} · block (
          {selectedBlock.blockX}, {selectedBlock.blockY}) · image samples (
          {selectedBlock.imageX}, {selectedBlock.imageY}) · MCU (
          {selectedBlock.mcuX}, {selectedBlock.mcuY}) · block in MCU (
          {selectedBlock.blockInMcuX}, {selectedBlock.blockInMcuY})
        </p>
      )}
      {isLoading && (
        <p className="coefficient-note" role="status">
          Reading quantized coefficients…
        </p>
      )}
      {errorMessage && (
        <p className="coefficient-error" role="alert">
          {errorMessage}
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
        !errorMessage &&
        !isLoading && (
          <p className="coefficient-note">
            {selectedBlock
              ? "The selected block has no coefficient data to display."
              : "Activate Inspector and click an 8×8 DCT block to read its 64 quantized coefficients."}
          </p>
        )
      )}
    </div>
  );
}

function App() {
  const [document, setDocument] = useState<ImportedJpeg | null>(null);
  const [historyDocument, setHistoryDocument] =
    useState<ProjectDocument<JpegEditableState> | null>(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [editedBytes, setEditedBytes] = useState<Uint8Array | null>(null);
  const [editedPreviewError, setEditedPreviewError] = useState("");
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showMcus, setShowMcus] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [workspaceState, dispatchWorkspace] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  );
  const {
    activeTool: toolMode,
    isRightPanelCollapsed,
    selectedBlock,
    selectionMask: globalSelectionMask,
  } = workspaceState;
  const activeToolPanel = useRef<HTMLDetailsElement>(null);
  const [snapToBlocks, setSnapToBlocks] = useState(false);
  const [componentIndex, setComponentIndex] = useState(0);
  const [inspectorComponentId, setInspectorComponentId] = useState(0);
  const [frequencyBand, setFrequencyBand] =
    useState<GlitchFrequencyBand>("all");
  const [coefficientDomain, setCoefficientDomain] =
    useState<CoefficientDomain>("ac");
  const [coefficientMode, setCoefficientMode] =
    useState<CoefficientGlitchMode>("zero");
  const [coefficientStrength, setCoefficientStrength] = useState(1);
  const [coefficientSeed, setCoefficientSeed] = useState(1);
  const [repeatSourceX, setRepeatSourceX] = useState(0);
  const [repeatSourceY, setRepeatSourceY] = useState(0);
  const [repeatOffsetX, setRepeatOffsetX] = useState(1);
  const [repeatOffsetY, setRepeatOffsetY] = useState(0);
  const [repeatCount, setRepeatCount] = useState(1);
  const [permutationSeed, setPermutationSeed] = useState(1);
  const [brushSize, setBrushSize] = useState(32);
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<SpatialSelection | null>(null);
  const [brushDraft, setBrushDraft] = useState<readonly ImagePoint[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const importController = useRef<AbortController | null>(null);
  const operationHistory = useRef<OperationHistory<JpegEditableState> | null>(
    null,
  );
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const brushPoints = useRef<ImagePoint[]>([]);
  const panStart = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const imageStage = useRef<HTMLDivElement>(null);
  const jpegOperations =
    historyDocument?.currentState.jpegOperations ?? EMPTY_JPEG_OPERATIONS;
  const currentQuantizationTables = useMemo(
    () =>
      document
        ? getCurrentQuantizationTables(document.inspection, jpegOperations)
        : [],
    [document, jpegOperations],
  );

  useEffect(
    () => () => {
      if (document) URL.revokeObjectURL(document.previewUrl);
    },
    [document],
  );

  useEffect(
    () => () => {
      if (editedPreviewUrl) URL.revokeObjectURL(editedPreviewUrl);
    },
    [editedPreviewUrl],
  );

  useEffect(() => {
    if (!document || jpegOperations.length === 0) return;

    const controller = new AbortController();
    const geometry: JpegBlockGeometry = {
      width: document.inspection.width,
      height: document.inspection.height,
      components: document.inspection.components.map(
        ({ id, horizontalSampling, verticalSampling, quantizationTable }) => ({
          id,
          horizontalSampling,
          verticalSampling,
          quantizationTable,
        }),
      ),
    };

    void (async () => {
      const encoded = await encodeJpegCoefficients(
        document.originalAsset.readBytes(),
        geometry,
        jpegOperations,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!encoded.ok) {
        setErrorMessage(encoded.error.message);
        setIsEncoding(false);
        return;
      }

      const outputBuffer = new ArrayBuffer(encoded.value.byteLength);
      new Uint8Array(outputBuffer).set(encoded.value);
      const previewUrl = URL.createObjectURL(
        new Blob([outputBuffer], { type: "image/jpeg" }),
      );
      setEditedBytes(encoded.value);
      let previewError = "";
      try {
        const preview = new Image();
        preview.src = previewUrl;
        await preview.decode();
        if (
          preview.naturalWidth !== document.inspection.width ||
          preview.naturalHeight !== document.inspection.height
        ) {
          previewError =
            "The encoded output dimensions differ from the source image.";
        }
      } catch {
        previewError =
          "The browser decoder could not render this encoded experiment. The file is still available to export.";
      }
      if (controller.signal.aborted) {
        URL.revokeObjectURL(previewUrl);
        return;
      }

      if (previewError) {
        URL.revokeObjectURL(previewUrl);
        setEditedPreviewUrl(null);
        setEditedPreviewError(previewError);
      } else {
        setEditedPreviewUrl(previewUrl);
        setEditedPreviewError("");
      }
      setIsEncoding(false);
    })();

    return () => controller.abort();
  }, [document, jpegOperations]);

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
    setEditedPreviewUrl(null);
    setEditedBytes(null);
    setEditedPreviewError("");
    setIsEncoding(false);
    setHistoryAvailability({
      canUndo: history.value.canUndo,
      canRedo: history.value.canRedo,
    });
    setSelection(null);
    dispatchWorkspace({ type: "reset-document" });
    setBrushDraft([]);
    setComponentIndex(0);
    setInspectorComponentId(result.value.inspection.components[0]?.id ?? 0);
    setFrequencyBand("all");
    setCoefficientDomain("ac");
    setCoefficientMode("zero");
    setCoefficientStrength(1);
    setCoefficientSeed(1);
    setRepeatSourceX(0);
    setRepeatSourceY(0);
    setRepeatOffsetX(1);
    setRepeatOffsetY(0);
    setRepeatCount(1);
    setBrushSize(32);
    setSnapToBlocks(false);
    setShowBlocks(false);
    setShowMcus(false);
    setShowOriginal(false);
    setZoom(1);
    setDocument(result.value);
  }

  function updateHistory(
    result: ReturnType<OperationHistory<JpegEditableState>["add"]>,
  ) {
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }
    const previousJpegOperations = historyDocument?.currentState.jpegOperations;
    if (result.value.currentState.jpegOperations !== previousJpegOperations) {
      setEditedPreviewUrl(null);
      setEditedBytes(null);
      setEditedPreviewError("");
      setIsEncoding(result.value.currentState.jpegOperations.length > 0);
      setShowOriginal(false);
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
  ): SpatialSelection | null {
    if (!document) return null;
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
      return null;
    }
    let nextSelection = result.value;
    if (snapToBlocks && nextSelection) {
      const component = document.inspection.components[componentIndex];
      if (!component) {
        setErrorMessage("The selected JPEG component is invalid.");
        return null;
      }
      const snapped = snapSelectionToComponentBlocks(
        nextSelection,
        document.inspection,
        component.id,
      );
      if (!snapped.ok) {
        setErrorMessage(snapped.error.message);
        return null;
      }
      nextSelection = snapped.value;
    }
    dispatchWorkspace({ type: "set-selection", selection: null });
    setSelection(nextSelection);
    return nextSelection;
  }

  function onImagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (toolMode === "hand") {
      const stage = imageStage.current;
      if (!stage) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panStart.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      return;
    }
    const point = getImagePoint(event);
    if (!point) return;
    if (
      toolMode !== "inspector" &&
      toolMode !== "select" &&
      toolMode !== "brush"
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (toolMode === "inspector") {
      if (!document) return;
      const component =
        document.inspection.components.find(
          (candidate) => candidate.id === inspectorComponentId,
        ) ?? document.inspection.components[0];
      if (!component) {
        setErrorMessage("The selected JPEG component is invalid.");
        return;
      }
      const coordinate = mapJpegImagePointToBlock(
        document.inspection,
        component.id,
        point.x,
        point.y,
      );
      if (!coordinate.ok) {
        setErrorMessage(coordinate.error.message);
        return;
      }
      dispatchWorkspace({
        type: "select-block",
        block: coordinate.value,
      });
      setErrorMessage("");
      return;
    }
    if (toolMode === "select") {
      selectionStart.current = point;
      updateSelection(point, point);
      return;
    }
    if (toolMode === "brush") {
      brushPoints.current = [point];
      setBrushDraft([point]);
    }
  }

  function onImagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panStart.current;
    if (pan && imageStage.current) {
      imageStage.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
      imageStage.current.scrollTop = pan.scrollTop - (event.clientY - pan.y);
      return;
    }
    const point = getImagePoint(event);
    if (toolMode === "brush" && brushPoints.current.length > 0 && point) {
      const points = brushPoints.current;
      const previous = points[points.length - 1]!;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const spacing = Math.max(1, brushSize / 8);
      const steps = Math.ceil(distance / spacing);
      if (points.length + steps > 10_000) {
        setErrorMessage(
          "This brush stroke is too long. Finish it in shorter strokes.",
        );
        brushPoints.current = [];
        setBrushDraft([]);
        return;
      }
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        points.push({
          x: previous.x + (point.x - previous.x) * ratio,
          y: previous.y + (point.y - previous.y) * ratio,
        });
      }
      setBrushDraft([...points]);
      return;
    }
    const start = selectionStart.current;
    if (toolMode === "select" && start && point) updateSelection(start, point);
  }

  function onImagePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (panStart.current) {
      panStart.current = null;
      return;
    }
    if (toolMode === "brush" && brushPoints.current.length > 0) {
      const point = getImagePoint(event);
      if (point) {
        const previous = brushPoints.current[brushPoints.current.length - 1]!;
        if (previous.x !== point.x || previous.y !== point.y) {
          brushPoints.current.push(point);
        }
      }
      const points = brushPoints.current;
      brushPoints.current = [];
      setBrushDraft([]);
      if (!document) return;
      const mask = createBrushMask(
        points,
        brushSize / 2,
        document.inspection.width,
        document.inspection.height,
      );
      if (!mask.ok) {
        setErrorMessage(mask.error.message);
        return;
      }
      setSelection(null);
      dispatchWorkspace({ type: "set-selection", selection: mask.value });
      const history = operationHistory.current;
      if (history) {
        const clearedSelection = history.setSelection(null);
        if (!clearedSelection.ok) {
          setErrorMessage(clearedSelection.error.message);
          return;
        }
        updateHistory(applyMaskToDocument(history, mask.value));
      }
      return;
    }
    const start = selectionStart.current;
    const end = getImagePoint(event);
    if (start && end) {
      const nextSelection = updateSelection(start, end);
      const history = operationHistory.current;
      if (nextSelection && document) {
        const mask = createSpatialMask(
          nextSelection,
          document.inspection.width,
          document.inspection.height,
        );
        if (!mask.ok) {
          setErrorMessage(mask.error.message);
        } else {
          setSelection(null);
          dispatchWorkspace({ type: "set-selection", selection: mask.value });
          if (history) {
            const selectionResult = history.setSelection(nextSelection);
            if (!selectionResult.ok) {
              setErrorMessage(selectionResult.error.message);
            } else {
              updateHistory(applyMaskToDocument(history, mask.value));
            }
          }
        }
      } else {
        dispatchWorkspace({ type: "set-selection", selection: null });
        if (history) updateHistory(history.setSelection(null));
      }
    }
    selectionStart.current = null;
  }

  function activateTool(tool: CanvasTool) {
    selectionStart.current = null;
    brushPoints.current = [];
    panStart.current = null;
    setBrushDraft([]);
    setSelection(null);
    dispatchWorkspace({ type: "activate-tool", tool });
    if (activeToolPanel.current) activeToolPanel.current.open = true;
  }

  function applyCoefficientOperation() {
    const history = operationHistory.current;
    const mask = globalSelectionMask;
    if (!history || !mask) {
      setErrorMessage(
        "Paint a mask or create a selection before applying a coefficient glitch.",
      );
      return;
    }
    updateHistory(
      applyCoefficientGlitchOperation(history, {
        kind: "coefficients",
        mask,
        componentIndex,
        domain: coefficientDomain,
        mode: coefficientMode,
        frequencyBand,
        strength:
          coefficientMode === "invert" || coefficientMode === "isolate"
            ? 0
            : coefficientStrength,
        seed: coefficientSeed,
      }),
    );
  }

  function applyBlockRepeat() {
    const history = operationHistory.current;
    if (!history) return;
    updateHistory(
      applyBlockRepeatOperation(history, {
        kind: "block-repeat",
        componentIndex,
        sourceX: repeatSourceX,
        sourceY: repeatSourceY,
        offsetX: repeatOffsetX,
        offsetY: repeatOffsetY,
        repetitions: repeatCount,
      }),
    );
  }

  function applyBlockPermutation() {
    const history = operationHistory.current;
    const mask = globalSelectionMask;
    if (!history || !mask) {
      setErrorMessage(
        "Paint a mask or create a selection before permuting DCT blocks.",
      );
      return;
    }
    updateHistory(
      applyBlockPermutationOperation(history, {
        kind: "block-permutation",
        componentIndex,
        mask,
        seed: permutationSeed,
      }),
    );
  }

  function applyQuantizationEdit(
    tableId: number,
    values: readonly number[],
    semantics: QuantizationSemantics,
    pattern: QuantizationPattern | "manual",
    seed: number,
  ) {
    const history = operationHistory.current;
    if (!history) return;
    updateHistory(
      applyQuantizationOperation(history, {
        kind: "quantization",
        tableId,
        values,
        semantics,
        pattern,
        seed,
      }),
    );
  }

  function clearSelection() {
    setSelection(null);
    dispatchWorkspace({ type: "set-selection", selection: null });
    const history = operationHistory.current;
    if (history) updateHistory(history.setSelection(null));
  }

  function editMaskOperation(operationId: string) {
    if (!globalSelectionMask) return;
    mutateHistory((history) =>
      history.editParameters(
        operationId,
        spatialMaskParameters(globalSelectionMask),
      ),
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

  function downloadEditedJpeg() {
    if (!editedBytes || !document) return;
    const output = new ArrayBuffer(editedBytes.byteLength);
    new Uint8Array(output).set(editedBytes);
    const url = URL.createObjectURL(new Blob([output], { type: "image/jpeg" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.originalAsset.fileName.replace(/\.[^.]+$/, "")}.edited.jpg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  const activeMaskForOverlay = globalSelectionMask;
  const visibleSelection =
    selection ?? getRectangleSelection(globalSelectionMask);
  const activeToolLabel =
    TOOL_GROUPS.flatMap((group) => group.tools).find(
      (tool) => tool.id === toolMode,
    )?.label ?? "Tool settings";

  return (
    <main className={`workspace ${document ? "has-tool-bar" : ""}`}>
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
            {isLoading ? "Inspecting…" : "Open JPEG"}
          </button>
          {document && (
            <button
              className="export-button"
              type="button"
              onClick={downloadEditedJpeg}
              disabled={!editedBytes || isEncoding}
              title="Download the encoded JPEG experiment; the original is unchanged"
            >
              {isEncoding ? "Encoding…" : "Export JPEG"}
            </button>
          )}
          <span className="local-badge">
            <span className="status-dot" aria-hidden="true" />
            Local workspace
          </span>
        </div>
      </header>

      {document && (
        <nav className="tool-bar" aria-label="Editing tools">
          {TOOL_GROUPS.map((group) => (
            <div
              className="tool-group"
              key={group.label}
              role="group"
              aria-label={group.label}
            >
              <span className="tool-group-label">{group.label}</span>
              <div className="tool-group-buttons">
                {group.tools.map((tool) => (
                  <button
                    className={`tool-button ${toolMode === tool.id ? "is-active" : ""}`}
                    key={tool.id}
                    type="button"
                    aria-label={tool.label}
                    aria-pressed={toolMode === tool.id}
                    title={tool.label}
                    onClick={() => activateTool(tool.id)}
                  >
                    <svg
                      className="tool-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {getToolIconPaths(tool.id).map((path) => (
                        <path d={path} key={path} />
                      ))}
                    </svg>
                    <span>{tool.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}

      <section
        className={`editor ${isDragging ? "is-dragging" : ""} ${isRightPanelCollapsed ? "is-panel-collapsed" : ""}`}
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
                  <div className="section-kicker">
                    {editedBytes && !showOriginal
                      ? "ENCODED JPEG EXPERIMENT"
                      : "DECODED PIXEL PREVIEW"}
                  </div>
                  <p>
                    {isEncoding
                      ? "Applying JPEG-domain operations in the local worker…"
                      : editedBytes && editedPreviewError
                        ? editedPreviewError
                        : editedBytes
                          ? "libjpeg-turbo re-encoding · source bytes remain unchanged"
                          : "Original JPEG · no pixel-only editing"}
                  </p>
                </div>
                <div className="overlay-controls">
                  <button
                    className="tool-toggle"
                    type="button"
                    onClick={() =>
                      setZoom((current) => Math.max(0.25, current - 0.25))
                    }
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <span className="zoom-readout">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    className="tool-toggle"
                    type="button"
                    onClick={() =>
                      setZoom((current) => Math.min(4, current + 0.25))
                    }
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <button
                    className="tool-toggle"
                    type="button"
                    onClick={() => setZoom(1)}
                  >
                    Fit
                  </button>
                  {editedPreviewUrl && (
                    <button
                      className="tool-toggle"
                      type="button"
                      aria-pressed={showOriginal}
                      onClick={() => setShowOriginal((current) => !current)}
                    >
                      {showOriginal ? "Show edited" : "Show original"}
                    </button>
                  )}
                  {isEncoding && (
                    <span className="encoding-indicator" role="status">
                      Re-encoding…
                    </span>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={showBlocks}
                      onChange={(event) =>
                        setShowBlocks(event.currentTarget.checked)
                      }
                    />
                    <span>8×8 DCT blocks</span>
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
              <div className="image-stage" ref={imageStage}>
                <div
                  className={`preview-image-wrap ${toolMode === "select" ? "is-selecting" : ""} ${toolMode === "brush" ? "is-brushing" : ""} ${toolMode === "inspector" ? "is-inspecting" : ""} ${toolMode === "hand" ? "is-panning" : ""}`}
                  style={{ transform: `scale(${zoom})` }}
                  onPointerDown={onImagePointerDown}
                  onPointerMove={onImagePointerMove}
                  onPointerUp={onImagePointerUp}
                  onPointerCancel={() => {
                    selectionStart.current = null;
                    brushPoints.current = [];
                    panStart.current = null;
                    setBrushDraft([]);
                  }}
                >
                  <img
                    className="preview-image"
                    src={
                      showOriginal || !editedPreviewUrl
                        ? document.previewUrl
                        : editedPreviewUrl
                    }
                    alt={`${showOriginal || !editedPreviewUrl ? "Original" : "Re-encoded"} JPEG preview of ${document.originalAsset.fileName}`}
                  />
                  <ImageOverlays
                    inspection={document.inspection}
                    showBlocks={showBlocks}
                    showMcus={showMcus}
                    selection={visibleSelection}
                    mask={activeMaskForOverlay}
                    brushDraft={brushDraft}
                    brushRadius={brushSize / 2}
                    selectedBlock={selectedBlock}
                  />
                </div>
              </div>
              <div className="preview-caption">
                <span>
                  {document.inspection.width} × {document.inspection.height}
                </span>
                <span>
                  {editedBytes && !showOriginal
                    ? editedPreviewError ||
                      "JPEG glitch operation · re-encoded preview"
                    : "Original decoded preview · source bytes unchanged"}
                </span>
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
          <button
            className="side-panel-toggle"
            type="button"
            aria-expanded={!isRightPanelCollapsed}
            aria-controls="side-panel-content"
            aria-label={
              isRightPanelCollapsed
                ? "Expand right panel"
                : "Collapse right panel"
            }
            onClick={() =>
              dispatchWorkspace({
                type: "set-panel-collapsed",
                collapsed: !isRightPanelCollapsed,
              })
            }
          >
            <span aria-hidden="true">{isRightPanelCollapsed ? "‹" : "›"}</span>
          </button>
          <div
            className="side-panel-content"
            id="side-panel-content"
            aria-hidden={isRightPanelCollapsed}
          >
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
                <CollapsibleSection
                  id="active-tool"
                  title={`${activeToolLabel} settings`}
                  kicker="ACTIVE TOOL"
                  className="active-tool-panel"
                  detailsRef={activeToolPanel}
                >
                  {toolMode === "hand" && (
                    <section className="inspector-section">
                      <p className="operation-description">
                        Drag the canvas to pan. Use the canvas controls to zoom
                        or fit the image.
                      </p>
                    </section>
                  )}
                  {toolMode === "inspector" && (
                    <section className="inspector-section">
                      <p className="operation-description">
                        Click an 8×8 DCT block to highlight it and read its
                        quantized coefficients in JPEG INSPECTOR. This does not
                        change the global pixel-space selection.
                      </p>
                      <label className="coefficient-field">
                        <span>Component to inspect</span>
                        <select
                          value={inspectorComponentId}
                          onChange={(event) => {
                            setInspectorComponentId(
                              Number(event.currentTarget.value),
                            );
                            dispatchWorkspace({
                              type: "select-block",
                              block: null,
                            });
                          }}
                        >
                          {document.inspection.components.map(
                            (component, index) => (
                              <option key={component.id} value={component.id}>
                                {getComponentControlLabel(
                                  document.inspection,
                                  index,
                                )}{" "}
                                · {component.horizontalSampling}×
                                {component.verticalSampling} sampling
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      {selectedBlock && (
                        <p className="selection-readout">
                          Component ID {selectedBlock.componentId} · block (
                          {selectedBlock.blockX}, {selectedBlock.blockY})
                        </p>
                      )}
                    </section>
                  )}
                  {(toolMode === "brush" || toolMode === "select") && (
                    <section className="inspector-section selection-panel">
                      <div className="section-kicker">
                        FIRST GLITCH LAB · DCT
                      </div>
                      <h2>Coefficient experiments</h2>
                      <p className="operation-description">
                        Paint or select in image-pixel coordinates. The mask is
                        mapped to intersecting 8×8 DCT blocks of one selected
                        component. These operations change quantized
                        coefficients and create a newly encoded JPEG; the
                        original JPEG bytes stay untouched.
                      </p>
                      <label className="coefficient-field">
                        <span>Component</span>
                        <select
                          value={componentIndex}
                          onChange={(event) =>
                            setComponentIndex(Number(event.currentTarget.value))
                          }
                        >
                          {document.inspection.components.map(
                            (component, index) => (
                              <option key={component.id} value={index}>
                                {getComponentControlLabel(
                                  document.inspection,
                                  index,
                                )}{" "}
                                · {component.horizontalSampling}×
                                {component.verticalSampling} sampling
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <p className="coefficient-note">
                        Y/Cb/Cr labels are common ID conventions, not guaranteed
                        color metadata. Component index and sampling factors are
                        authoritative. Select Cb or Cr to experiment on chroma
                        coefficients independently.
                      </p>
                      <label className="coefficient-field tool-field">
                        <span>Coefficient domain</span>
                        <select
                          value={coefficientDomain}
                          disabled={
                            coefficientMode === "offset" ||
                            coefficientMode === "invert" ||
                            coefficientMode === "isolate"
                          }
                          onChange={(event) => {
                            const next = event.currentTarget.value;
                            if (next === "dc" || next === "ac") {
                              setCoefficientDomain(next);
                              if (next === "dc") setFrequencyBand("all");
                            }
                          }}
                        >
                          <option value="ac">AC coefficients</option>
                          <option value="dc">DC coefficients</option>
                        </select>
                      </label>
                      <label className="coefficient-field tool-field">
                        <span>Operation</span>
                        <select
                          value={coefficientMode}
                          onChange={(event) => {
                            const next = event.currentTarget.value;
                            if (
                              next === "zero" ||
                              next === "scale" ||
                              next === "randomize" ||
                              next === "offset" ||
                              next === "invert" ||
                              next === "isolate"
                            ) {
                              setCoefficientMode(next);
                              if (next === "offset") {
                                setCoefficientDomain("dc");
                                setFrequencyBand("all");
                              } else if (
                                next === "invert" ||
                                next === "isolate"
                              ) {
                                setCoefficientDomain("ac");
                                if (
                                  next === "isolate" &&
                                  frequencyBand === "all"
                                ) {
                                  setFrequencyBand("low");
                                }
                              }
                            }
                          }}
                        >
                          <option value="zero">
                            Zero selected coefficients
                          </option>
                          <option value="scale">Scale coefficients</option>
                          <option value="randomize">
                            Randomize coefficients
                          </option>
                          <option value="offset">Add DC offset</option>
                          <option value="invert">Invert AC signs</option>
                          <option value="isolate">
                            Keep selected AC frequency band
                          </option>
                        </select>
                      </label>
                      <label className="coefficient-field tool-field">
                        <span>
                          {coefficientDomain === "ac"
                            ? "AC frequency band"
                            : "DC"}
                        </span>
                        <select
                          value={frequencyBand}
                          disabled={coefficientDomain === "dc"}
                          onChange={(event) => {
                            const next = GLITCH_FREQUENCY_BANDS.find(
                              (band) => band === event.currentTarget.value,
                            );
                            if (next) setFrequencyBand(next);
                          }}
                        >
                          {GLITCH_FREQUENCY_BANDS.map((band) => {
                            const range = DCT_FREQUENCY_BAND_RANGES[band];
                            return (
                              <option
                                key={band}
                                value={band}
                                disabled={
                                  coefficientMode === "isolate" &&
                                  band === "all"
                                }
                              >
                                {band === "all" ? "All AC" : band} · u+v{" "}
                                {range.minimum}–{range.maximum}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      {["scale", "randomize", "offset"].includes(
                        coefficientMode,
                      ) && (
                        <label className="coefficient-field tool-field">
                          <span>
                            {coefficientMode === "scale"
                              ? "Scale multiplier"
                              : coefficientMode === "randomize"
                                ? "Random coefficient range"
                                : "DC offset"}
                          </span>
                          <input
                            type="number"
                            min={
                              coefficientMode === "scale"
                                ? "-8"
                                : coefficientMode === "offset"
                                  ? "-2047"
                                  : "1"
                            }
                            max={
                              coefficientMode === "scale"
                                ? "8"
                                : coefficientMode === "offset"
                                  ? "2047"
                                  : "2047"
                            }
                            step={coefficientMode === "scale" ? "0.1" : "1"}
                            value={coefficientStrength}
                            onChange={(event) =>
                              setCoefficientStrength(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      )}
                      {coefficientMode === "randomize" && (
                        <label className="coefficient-field tool-field">
                          <span>Deterministic seed</span>
                          <input
                            type="number"
                            min="0"
                            max="4294967295"
                            step="1"
                            value={coefficientSeed}
                            onChange={(event) =>
                              setCoefficientSeed(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      )}
                      {toolMode === "brush" && (
                        <label className="coefficient-field tool-field">
                          <span>Brush diameter · {brushSize} image pixels</span>
                          <input
                            type="range"
                            min="4"
                            max="256"
                            step="4"
                            value={brushSize}
                            onChange={(event) =>
                              setBrushSize(Number(event.currentTarget.value))
                            }
                          />
                        </label>
                      )}
                      {toolMode === "select" && (
                        <label className="snap-control">
                          <input
                            type="checkbox"
                            checked={snapToBlocks}
                            onChange={(event) =>
                              setSnapToBlocks(event.currentTarget.checked)
                            }
                          />
                          <span>Snap selection to component DCT blocks</span>
                        </label>
                      )}
                      {visibleSelection ? (
                        <p className="selection-readout">
                          x {visibleSelection.x.toFixed(1)} · y{" "}
                          {visibleSelection.y.toFixed(1)} ·{" "}
                          {visibleSelection.width.toFixed(1)} ×{" "}
                          {visibleSelection.height.toFixed(1)} image pixels
                        </p>
                      ) : (
                        <p className="operation-empty">
                          Use Select to draw a region or Brush to paint a mask.
                        </p>
                      )}
                      {activeMaskForOverlay && (
                        <p className="selection-readout">
                          {describeMask(activeMaskForOverlay)}
                        </p>
                      )}
                      <div className="operation-actions">
                        <button
                          className="operation-button"
                          type="button"
                          disabled={!globalSelectionMask || isEncoding}
                          onClick={applyCoefficientOperation}
                        >
                          Apply {coefficientMode} to selected{" "}
                          {coefficientDomain}
                        </button>
                        <button
                          className="operation-button secondary"
                          type="button"
                          disabled={!selection && !globalSelectionMask}
                          onClick={clearSelection}
                        >
                          Clear selection
                        </button>
                      </div>
                    </section>
                  )}
                  {toolMode === "repeat-block" && (
                    <section className="inspector-section">
                      <div className="section-kicker">
                        BLOCK DUPLICATE / REPEAT
                      </div>
                      <h2>Repeat one DCT block</h2>
                      <p className="operation-description">
                        Copies the selected component's 8×8 quantized
                        coefficient block to repeated block coordinates. It does
                        not copy JPEG bytes or an MCU.
                      </p>
                      <div className="coefficient-coordinate-fields">
                        <label className="coefficient-field">
                          <span>Source block X</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={repeatSourceX}
                            onChange={(event) =>
                              setRepeatSourceX(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                        <label className="coefficient-field">
                          <span>Source block Y</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={repeatSourceY}
                            onChange={(event) =>
                              setRepeatSourceY(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      </div>
                      <div className="coefficient-coordinate-fields">
                        <label className="coefficient-field">
                          <span>Offset X · blocks</span>
                          <input
                            type="number"
                            step="1"
                            value={repeatOffsetX}
                            onChange={(event) =>
                              setRepeatOffsetX(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                        <label className="coefficient-field">
                          <span>Offset Y · blocks</span>
                          <input
                            type="number"
                            step="1"
                            value={repeatOffsetY}
                            onChange={(event) =>
                              setRepeatOffsetY(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      </div>
                      <label className="coefficient-field tool-field">
                        <span>Copies</span>
                        <input
                          type="number"
                          min="1"
                          max="256"
                          step="1"
                          value={repeatCount}
                          onChange={(event) =>
                            setRepeatCount(Number(event.currentTarget.value))
                          }
                        />
                      </label>
                      <button
                        className="operation-button"
                        type="button"
                        disabled={isEncoding}
                        onClick={applyBlockRepeat}
                      >
                        Duplicate / repeat block
                      </button>
                    </section>
                  )}
                  {toolMode === "shuffle" && (
                    <section className="inspector-section">
                      <div className="section-kicker">BLOCK PERMUTATION</div>
                      <h2>Shuffle selected DCT blocks</h2>
                      <p className="operation-description">
                        Randomly permutes whole quantized 8×8 blocks, including
                        DC, within the selected component and mask. Every
                        selected block is used once; blocks outside the mask are
                        unchanged. A block is selected at 50% mask coverage or
                        greater. Rectangles use area; brush masks use an 8×8
                        coverage sample.
                      </p>
                      <label className="coefficient-field tool-field">
                        <span>Deterministic seed</span>
                        <input
                          type="number"
                          min="0"
                          max="4294967295"
                          step="1"
                          value={permutationSeed}
                          onChange={(event) =>
                            setPermutationSeed(
                              Number(event.currentTarget.value),
                            )
                          }
                        />
                      </label>
                      <button
                        className="operation-button"
                        type="button"
                        disabled={!globalSelectionMask || isEncoding}
                        onClick={applyBlockPermutation}
                      >
                        Permute blocks in mask
                      </button>
                    </section>
                  )}
                  {toolMode === "quantization" && (
                    <QuantizationMatrixEditor
                      key={`${document.originalAsset.sha256}-${historyDocument?.revision ?? 0}`}
                      quantizationTables={currentQuantizationTables}
                      disabled={isEncoding}
                      onApply={applyQuantizationEdit}
                    />
                  )}
                </CollapsibleSection>
                <CollapsibleSection
                  id="history"
                  title="History"
                  kicker="NON-DESTRUCTIVE OPERATIONS"
                  count={historyDocument?.operations.length ?? 0}
                  className="history-panel"
                >
                  <section className="inspector-section operation-stack">
                    <p className="operation-description">
                      Enabled operations replay in order from the original
                      document. Reordering recomputes later state.
                    </p>
                    {historyDocument?.operations.length ? (
                      <ol className="operation-list">
                        {historyDocument.operations.map((operation, index) => {
                          const mask = getMaskFromParameters(
                            operation.parameters,
                          );
                          const parameters =
                            typeof operation.parameters === "object" &&
                            operation.parameters !== null &&
                            !Array.isArray(operation.parameters)
                              ? operation.parameters
                              : null;
                          const operationKind = parameters
                            ? Reflect.get(parameters, "kind")
                            : undefined;
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
                                  <span>
                                    {operation.type === "spatial/apply-mask"
                                      ? "Spatial mask"
                                      : operationKind === "coefficients"
                                        ? "Coefficient glitch"
                                        : operationKind === "block-repeat"
                                          ? "Block duplicate / repeat"
                                          : operationKind ===
                                              "block-permutation"
                                            ? "Block permutation"
                                            : operationKind === "quantization"
                                              ? "DQT matrix edit"
                                              : operation.type}
                                  </span>
                                </label>
                                <span className="operation-status">
                                  {operation.status}
                                </span>
                              </div>
                              {mask && (
                                <p className="operation-parameters">
                                  {describeMask(mask)}
                                </p>
                              )}
                              {parameters &&
                                operationKind === "coefficients" && (
                                  <p className="operation-parameters">
                                    Component{" "}
                                    {Reflect.get(parameters, "componentIndex")}{" "}
                                    · {Reflect.get(parameters, "mode")}{" "}
                                    {Reflect.get(parameters, "domain")} ·{" "}
                                    {Reflect.get(parameters, "frequencyBand")} ·
                                    seed {Reflect.get(parameters, "seed")}
                                  </p>
                                )}
                              {parameters &&
                                operationKind === "block-repeat" && (
                                  <p className="operation-parameters">
                                    Component{" "}
                                    {Reflect.get(parameters, "componentIndex")}{" "}
                                    · source (
                                    {Reflect.get(parameters, "sourceX")},{" "}
                                    {Reflect.get(parameters, "sourceY")}) ·
                                    offset ({Reflect.get(parameters, "offsetX")}
                                    , {Reflect.get(parameters, "offsetY")}) ·{" "}
                                    {Reflect.get(parameters, "repetitions")}{" "}
                                    copies
                                  </p>
                                )}
                              {parameters &&
                                operationKind === "block-permutation" && (
                                  <p className="operation-parameters">
                                    Component{" "}
                                    {Reflect.get(parameters, "componentIndex")}{" "}
                                    · seed {Reflect.get(parameters, "seed")} ·
                                    Fisher–Yates
                                  </p>
                                )}
                              {parameters &&
                                operationKind === "quantization" && (
                                  <p className="operation-parameters">
                                    DQT {Reflect.get(parameters, "tableId")} ·{" "}
                                    {Reflect.get(parameters, "semantics")} ·{" "}
                                    {Reflect.get(parameters, "pattern")} · seed{" "}
                                    {Reflect.get(parameters, "seed")}
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
                                    (historyDocument?.operations.length ?? 0) -
                                      1
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
                                  disabled={
                                    !globalSelectionMask ||
                                    operation.type !== "spatial/apply-mask"
                                  }
                                  onClick={() =>
                                    editMaskOperation(operation.id)
                                  }
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
                        Select a region or paint with Brush to add it to
                        history.
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
                </CollapsibleSection>
                <CollapsibleSection
                  id="original-asset"
                  title="Original asset"
                  kicker="ORIGINAL ASSET"
                  className="source-section"
                >
                  <div className="source-card">
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
                </CollapsibleSection>
                <MetadataInspector
                  asset={document.originalAsset}
                  inspection={document.inspection}
                  quantizationTables={currentQuantizationTables}
                  selectedBlock={selectedBlock}
                />
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
                    sequential Huffman JPEG, grayscale or three-component,
                    single interleaved scan.
                  </p>
                )}
              </div>
            )}
          </div>
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
          <span>{document ? "DOCUMENT HISTORY" : "MILESTONE 4"}</span>
        </span>
      </footer>
    </main>
  );
}

export default App;
