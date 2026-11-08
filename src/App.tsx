import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  applyBlockShiftOperation,
  applyBlockTransferOperation,
  applyCoefficientGlitchOperation,
  applyQuantizationOperation,
  createJpegDocumentSession,
  type JpegEditableState,
} from "./application/jpeg-document";
import { importJpeg, type ImportedJpeg } from "./application/import-jpeg";
import {
  createJgeProjectFile,
  readJgeProjectFile,
  type JgeProjectData,
} from "./project/project-file";
import {
  getJpegComponentBlockGrid,
  getMaskBlockCoveragePath,
  clipJpegBlockRegionToGrid,
  mapJpegBlockDragToDestination,
  mapJpegBlockCoordinate,
  mapJpegBlockRegionToImageSelection,
  mapJpegImageRectangleToBlockRegion,
  mapJpegImageRectangleToBlockRegionClipped,
  mapJpegImagePointToBlock,
  snapImagePointToGrid,
  snapSelectionToComponentBlocks,
  snapSelectionToMcus,
  type JpegBlockGeometry,
  type JpegBlockCoordinate,
  type JpegBlockRegion,
  type JpegSelectionGrid,
} from "./jpeg/block-geometry";
import type { JpegInspection } from "./jpeg/inspect";
import {
  createBrushMaskFromStrokes,
  copySpatialMask,
  createRectangleSelection,
  createSpatialMask,
  getMaskFromParameters,
  type SpatialMask,
  type SpatialSelection,
} from "./document/masks";
import type { ProjectDocument } from "./document/model";
import { OperationHistory } from "./operations/history";
import {
  createQuantizationPattern,
  isBlockTransferParameters,
  MAX_BLOCK_TRANSFER_BLOCKS,
  GLITCH_FREQUENCY_BANDS,
  QUANTIZATION_PATTERNS,
  type CoefficientDomain,
  type CoefficientGlitchMode,
  type BlockTransferAction,
  type BlockTransferMode,
  type GlitchFrequencyBand,
  type JpegGlitchOperation,
  type QuantizationPattern,
  type QuantizationSemantics,
} from "./operations/jpeg-glitch";
import {
  BUILT_IN_COEFFICIENT_BRUSHES,
  DEFAULT_USER_BRUSH,
  readCoefficientBrushes,
  readBrushAutoApply,
  updateCoefficientBrush,
  writeBrushAutoApply,
  type CoefficientBrush,
} from "./application/coefficient-brushes";
import {
  initialWorkspaceState,
  getHistoryDisplayEntries,
  getWorkspaceOverlayVisibility,
  getWorkspaceShortcut,
  getCanvasToolShortcut,
  isCanvasToolEnabled,
  TOOL_GROUPS,
  workspaceReducer,
  type CanvasTool,
} from "./ui/workspace-state";
import { getRectangleSelection } from "./ui/selection-overlay";
import {
  corruptEncodedJpeg,
  ScanCorruptionHistory,
} from "./application/scan-corruption";
import {
  MAX_SCAN_CORRUPTION_BYTES,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
  type ScanCorruptionReport,
} from "./jpeg/scan-corruption";
import type { ScanDecodeDiagnostic } from "./jpeg/scan-corruption-worker-protocol";
import {
  getScanDecodeDiagnosticMessage,
  getScanDecodeWarningLabels,
} from "./jpeg/scan-decode-diagnostic";
import {
  ComponentChoiceGroup,
  getQuantizationTableLabel,
  getCoefficientRangeOptions,
  RadioChoiceGroup,
  SeedField,
  type CoefficientRangeChoice,
} from "./ui/tool-controls";

const MARKER_LIMIT = 250;
const APPLICATION_VERSION = "0.1.0";
const JPEG_CODEC_VERSION = "libjpeg-turbo 3.2.0";
const EMPTY_JPEG_OPERATIONS: JpegEditableState["jpegOperations"] =
  Object.freeze([]);
type ImagePoint = { x: number; y: number };
type BlockTransformGesture = {
  readonly kind:
    | "transfer-source"
    | "transfer-destination"
    | "repeat-source"
    | "repeat-destination";
  readonly start: ImagePoint;
};

function getToolIconPaths(tool: CanvasTool): readonly string[] {
  switch (tool) {
    case "hand":
      return [
        "M5 12V6a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v2-1a1.5 1.5 0 0 1 3 0v2-1a1.5 1.5 0 0 1 3 0v5c0 3-2 5-5 5h-2c-2 0-3-1-4-3l-2-3a1.5 1.5 0 0 1 2-2l2 2",
      ];
    case "inspector":
      return ["M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "m16 16 5 5"];
    case "info":
      return [
        "M12 11v6",
        "M12 7h.01",
        "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
      ];
    case "brush":
      return ["m4 16 9-9 4 4-9 9H4v-4Z", "m12 8 3-3 4 4-3 3", "M4 21h7"];
    case "select":
      return ["M4 4h16v16H4z"];
    case "coefficient-glitch":
      return [
        "M12 3v4",
        "M12 17v4",
        "M3 12h4",
        "M17 12h4",
        "m5.6 5.6 2.8 2.8",
        "m15.6 15.6 2.8 2.8",
        "m5.6 18.4 2.8-2.8",
        "m15.6 8.4 2.8-2.8",
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
      ];
    case "block-transform":
      return [
        "M3 3h7v7H3z",
        "M14 14h7v7h-7z",
        "M8.5 8.5 15 15",
        "m10.5 15h4.5v-4.5",
      ];
    case "quantization":
      return [
        "M4 4h16v16H4z",
        "M9.3 4v16",
        "M14.7 4v16",
        "M4 9.3h16",
        "M4 14.7h16",
      ];
    case "scan-corrupt":
      return [
        "M4 6h16",
        "M4 12h5",
        "M15 12h5",
        "M4 18h16",
        "m10 9 4 6",
        "m14 9-4 6",
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
  initiallyOpen = true,
  children,
}: {
  id: string;
  title: string;
  kicker?: string;
  count?: number;
  className?: string;
  detailsRef?: Ref<HTMLDetailsElement>;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`collapsible-section ${className}`}
      open={initiallyOpen}
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

function createJpegPreviewUrl(bytes: Uint8Array): string {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
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

function getBlockRegionSelection(
  inspection: JpegInspection,
  componentId: number,
  region: JpegBlockRegion | null,
): SpatialSelection | null {
  if (!region) return null;
  const mapped = mapJpegBlockRegionToImageSelection(
    inspection,
    componentId,
    region,
  );
  return mapped.ok ? mapped.value : null;
}

function ImageOverlays({
  inspection,
  showBlocks,
  showMcus,
  selection,
  mask,
  brushDraft,
  brushRadius,
  componentId,
  selectedBlock,
  keyboardCursor,
  blockTransferSource,
  blockTransferSourceInvalid,
  blockTransferDestination,
  blockTransferDestinationInvalid,
}: {
  inspection: JpegInspection;
  showBlocks: boolean;
  showMcus: boolean;
  selection: SpatialSelection | null;
  mask: SpatialMask | null;
  brushDraft: readonly (readonly ImagePoint[])[];
  brushRadius: number;
  componentId: number;
  selectedBlock: JpegBlockCoordinate | null;
  keyboardCursor: JpegBlockCoordinate | null;
  blockTransferSource: SpatialSelection | null;
  blockTransferSourceInvalid: boolean;
  blockTransferDestination: SpatialSelection | null;
  blockTransferDestinationInvalid: boolean;
}) {
  const blockPatternWidth = inspection.blockWidth;
  const blockPatternHeight = inspection.blockHeight;
  const hasActiveBrush =
    mask?.width === inspection.width && mask.height === inspection.height
      ? mask.shapes.some((shape) => shape.kind === "brush")
      : false;
  const activeBrushCoverage =
    mask && hasActiveBrush
      ? getMaskBlockCoveragePath(mask, inspection, componentId)
      : null;
  const draftBrushMask: SpatialMask | null = brushDraft.some(
    (stroke) => stroke.length > 0,
  )
    ? {
        schemaVersion: 1,
        id: "brush-draft",
        width: inspection.width,
        height: inspection.height,
        shapes: brushDraft.flatMap((points) =>
          points.length > 0
            ? [
                {
                  kind: "brush",
                  mode: "add",
                  radius: brushRadius,
                  points,
                },
              ]
            : [],
        ),
      }
    : null;
  const draftBrushCoverage = draftBrushMask
    ? getMaskBlockCoveragePath(draftBrushMask, inspection, componentId)
    : null;

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
      {activeBrushCoverage?.ok && (
        <path className="active-mask-cells" d={activeBrushCoverage.value} />
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
      {blockTransferSource && (
        <rect
          className={`block-transfer-source-overlay ${blockTransferSourceInvalid ? "is-invalid" : ""}`}
          x={blockTransferSource.x}
          y={blockTransferSource.y}
          width={blockTransferSource.width}
          height={blockTransferSource.height}
        />
      )}
      {blockTransferDestination && (
        <rect
          className={`block-transfer-target-overlay ${blockTransferDestinationInvalid ? "is-invalid" : ""}`}
          x={blockTransferDestination.x}
          y={blockTransferDestination.y}
          width={blockTransferDestination.width}
          height={blockTransferDestination.height}
        />
      )}
      {draftBrushCoverage?.ok && (
        <path className="brush-draft-cells" d={draftBrushCoverage.value} />
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
      {keyboardCursor && (
        <rect
          className="keyboard-cursor-overlay"
          x={keyboardCursor.imageX}
          y={keyboardCursor.imageY}
          width={keyboardCursor.imageWidth}
          height={keyboardCursor.imageHeight}
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

function loadInitialBrushes(): {
  brushes: readonly CoefficientBrush[];
  error: string;
} {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return {
      brushes: [],
      error: "Saved brushes are unavailable in this browser.",
    };
  }
  const result = readCoefficientBrushes(storage);
  return result.ok
    ? { brushes: result.value, error: "" }
    : { brushes: [], error: result.error.message };
}

function loadInitialBrushAutoApply(): {
  settings: Readonly<Record<string, boolean>>;
  error: string;
} {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return {
      settings: {},
      error: "Brush automatic-apply settings are unavailable.",
    };
  }
  const result = readBrushAutoApply(storage);
  return result.ok
    ? { settings: result.value, error: "" }
    : { settings: {}, error: result.error.message };
}

function MetadataInspector({
  asset,
  inspection,
  quantizationTables,
  selectedBlock,
  onError,
}: {
  asset: ImportedJpeg["originalAsset"];
  inspection: JpegInspection;
  quantizationTables: readonly {
    id: number;
    values: readonly number[];
  }[];
  selectedBlock: JpegBlockCoordinate | null;
  onError(message: string): void;
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
        initiallyOpen={false}
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
          onError={onError}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="frame-components"
        title="Components"
        kicker="FRAME COMPONENTS"
        initiallyOpen={false}
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
        initiallyOpen={false}
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
        initiallyOpen={false}
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
        initiallyOpen={false}
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
  components,
  disabled,
  onApply,
  onError,
}: {
  quantizationTables: readonly { id: number; values: readonly number[] }[];
  components: JpegInspection["components"];
  disabled: boolean;
  onError(message: string): void;
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
    onError("");
  }

  function applyPattern() {
    const seedValue = Number(seed);
    if (
      !Number.isInteger(seedValue) ||
      seedValue < 0 ||
      seedValue > 0xffff_ffff
    ) {
      onError("Pattern seed must be an unsigned 32-bit integer.");
      return;
    }
    if (pattern === "manual") {
      onError("Choose a generated pattern before applying it.");
      return;
    }
    const result = createQuantizationPattern(pattern, values, seedValue);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setValues([...result.value]);
    onError("");
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
      <p className="operation-description">
        Edit the 64 quantization values used by components assigned to this
        table. Changing DQT values does not recover detail discarded earlier.
      </p>
      <RadioChoiceGroup<number>
        name="quantization-table"
        legend="Table assigned to component(s)"
        value={tableId}
        options={quantizationTables.map((entry) => ({
          value: entry.id,
          label: getQuantizationTableLabel(entry.id, components),
        }))}
        disabled={disabled}
        onChange={(id) => chooseTable(String(id))}
        layout="inline"
      />
      <h3 className="parameter-group-title">Core parameters</h3>
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
        <SeedField
          id="quantization-seed"
          label="Pattern seed"
          value={seed}
          disabled={disabled}
          onChange={setSeed}
        />
      </div>
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
      <details className="advanced-controls">
        <summary>Advanced parameters · quantization semantics</summary>
        <div className="advanced-control-content">
          <RadioChoiceGroup<QuantizationSemantics>
            name="quantization-semantics"
            legend="Apply semantics"
            value={semantics}
            options={[
              {
                value: "reinterpret",
                label: "Reinterpret",
                hint: "Keep quantized coefficients",
              },
              {
                value: "requantize",
                label: "Requantize",
                hint: "Estimate from retained coefficients",
              },
            ]}
            disabled={disabled}
            onChange={setSemantics}
            layout="inline"
          />
          <p className="coefficient-note">
            {semantics === "reinterpret"
              ? "Keeps quantized coefficients and changes their DQT interpretation."
              : "Approximates unquantized values as old coefficient × old DQT, then divides by the new DQT. Discarded information is not restored."}
          </p>
        </div>
      </details>
      <button
        className="operation-button secondary"
        type="button"
        disabled={disabled || pattern === "manual"}
        onClick={applyPattern}
      >
        Generate pattern
      </button>
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
  onError,
}: {
  asset: ImportedJpeg["originalAsset"];
  inspection: JpegInspection;
  selectedBlock: JpegBlockCoordinate | null;
  onError(message: string): void;
}) {
  const bytes = useMemo(() => asset.readBytes(), [asset]);
  const componentOptions = inspection.components;
  const [values, setValues] = useState<number[] | null>(null);
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
      onError("");
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
        onError(coordinate.error.message);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      if (!reader.current) {
        const created = createJpegCoefficientReader();
        if (!created.ok) {
          onError(created.error.message);
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
          onError(opened.error.message);
          return;
        }

        const componentIndex = componentOptions.findIndex(
          (component) => component.id === selectedBlock.componentId,
        );
        if (componentIndex < 0) {
          onError("The selected JPEG component is invalid.");
          return;
        }
        const result = await reader.current.readBlock(
          componentIndex,
          selectedBlock.blockX,
          selectedBlock.blockY,
        );
        if (currentRequest !== requestId.current) return;
        if (!result.ok) {
          onError(result.error.message);
          return;
        }
        setValues(result.value);
      } catch {
        if (currentRequest === requestId.current) {
          onError(
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
  }, [bytes, componentOptions, inspection, onError, selectedBlock]);

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
        !selectedBlock &&
        !isLoading && (
          <p className="coefficient-note">
            Activate Inspector and click an 8×8 DCT block to read its 64
            quantized coefficients.
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
  const [cleanEncodedPreviewUrl, setCleanEncodedPreviewUrl] = useState<
    string | null
  >(null);
  const [cleanEncodedPreviewError, setCleanEncodedPreviewError] = useState("");
  const [scanCorruptionReports, setScanCorruptionReports] = useState<
    readonly ScanCorruptionReport[]
  >([]);
  const [scanDecodeDiagnostic, setScanDecodeDiagnostic] =
    useState<ScanDecodeDiagnostic | null>(null);
  const [scanCorruptionMode, setScanCorruptionMode] =
    useState<ScanCorruptionParameters["mode"]>("bit-flip");
  const [scanCorruptionCount, setScanCorruptionCount] = useState(4);
  const [scanCorruptionRangeStart, setScanCorruptionRangeStart] = useState(0);
  const [scanCorruptionRangeEnd, setScanCorruptionRangeEnd] = useState(1);
  const [scanCorruptionSeed, setScanCorruptionSeed] = useState(1);
  const [isScanCorrupting, setIsScanCorrupting] = useState(false);
  const [showCleanEncoded, setShowCleanEncoded] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [dismissedToastMessage, setDismissedToastMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Inspecting JPEG…");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [projectNotice, setProjectNotice] = useState("");
  const [isEncoding, setIsEncoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showMcus, setShowMcus] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [keyboardCursor, setKeyboardCursor] =
    useState<JpegBlockCoordinate | null>(null);
  const [canvasHasKeyboardFocus, setCanvasHasKeyboardFocus] = useState(false);
  const [canvasKeyboardAnnouncement, setCanvasKeyboardAnnouncement] =
    useState("");
  const [workspaceState, dispatchWorkspace] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  );
  const {
    activeTool: toolMode,
    panelTool,
    isRightPanelCollapsed,
    selectedBlock,
    selectionMask: globalSelectionMask,
  } = workspaceState;
  const activeToolPanel = useRef<HTMLDetailsElement>(null);
  const saveDialogRef = useRef<HTMLDialogElement>(null);
  const cleanEncodedPreviewErrorRef = useRef(cleanEncodedPreviewError);
  const [maskGrid, setMaskGrid] = useState<JpegSelectionGrid>("dct");
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
  const [repeatSource, setRepeatSource] = useState<JpegBlockRegion | null>(
    null,
  );
  const [repeatDraft, setRepeatDraft] = useState<JpegBlockRegion | null>(null);
  const [repeatDestination, setRepeatDestination] = useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [permutationSeed, setPermutationSeed] = useState(1);
  const [blockTransformMode, setBlockTransformMode] = useState<
    "shuffle" | "repeat" | "transfer" | "shift"
  >("transfer");
  const [blockShiftX, setBlockShiftX] = useState(1);
  const [blockShiftY, setBlockShiftY] = useState(0);
  const [blockTransferMode, setBlockTransferMode] =
    useState<BlockTransferMode>("all");
  const [blockTransferAction, setBlockTransferAction] =
    useState<BlockTransferAction>("copy");
  const [blockTransferSource, setBlockTransferSource] =
    useState<JpegBlockRegion | null>(null);
  const [blockTransferDraft, setBlockTransferDraft] =
    useState<JpegBlockRegion | null>(null);
  const [blockTransferDraftOutOfBounds, setBlockTransferDraftOutOfBounds] =
    useState(false);
  const [blockTransferDestination, setBlockTransferDestination] = useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [brushSize, setBrushSize] = useState(32);
  const [initialBrushState] = useState(loadInitialBrushes);
  const [userBrushes, setUserBrushes] = useState(initialBrushState.brushes);
  const [brushStorageError, setBrushStorageError] = useState(
    initialBrushState.error,
  );
  const [selectedBrushId, setSelectedBrushId] = useState("pixelate");
  const [brushName, setBrushName] = useState("");
  const [initialAutoApply] = useState(loadInitialBrushAutoApply);
  const [brushAutoApply, setBrushAutoApply] = useState(
    initialAutoApply.settings,
  );
  const [brushAutoError, setBrushAutoError] = useState(initialAutoApply.error);
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<SpatialSelection | null>(null);
  const [brushDraft, setBrushDraft] = useState<
    readonly (readonly ImagePoint[])[]
  >([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const importController = useRef<AbortController | null>(null);
  const operationHistory = useRef<OperationHistory<JpegEditableState> | null>(
    null,
  );
  const scanCorruptionHistory = useRef(new ScanCorruptionHistory());
  const cleanEncodedBytes = useRef<Uint8Array | null>(null);
  const scanCorruptionController = useRef<AbortController | null>(null);
  const pendingProjectStages = useRef<
    readonly ScanCorruptionParameters[] | null
  >(null);
  const projectStagesReplayStarted = useRef(false);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const keyboardSelectionAnchor = useRef<JpegBlockCoordinate | null>(null);
  const blockTransformGesture = useRef<BlockTransformGesture | null>(null);
  const brushPoints = useRef<ImagePoint[][]>([]);
  const panStart = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const imageStage = useRef<HTMLDivElement>(null);
  const previewImageWrap = useRef<HTMLDivElement>(null);
  const jpegOperations =
    historyDocument?.currentState.jpegOperations ?? EMPTY_JPEG_OPERATIONS;
  const activeMask = globalSelectionMask;
  const brushes = [
    ...BUILT_IN_COEFFICIENT_BRUSHES,
    ...(userBrushes.some((brush) => brush.id === DEFAULT_USER_BRUSH.id)
      ? userBrushes
      : [DEFAULT_USER_BRUSH, ...userBrushes]),
  ];
  const selectedBrush = brushes.find((brush) => brush.id === selectedBrushId);
  const componentCount = document?.inspection.components.length ?? 0;
  const documentHash = document?.originalAsset.sha256;
  const currentQuantizationTables = useMemo(
    () =>
      document
        ? getCurrentQuantizationTables(document.inspection, jpegOperations)
        : [],
    [document, jpegOperations],
  );
  const contextualErrorMessage = [
    brushStorageError
      ? `${brushStorageError} Saving brushes is unavailable.`
      : "",
    brushAutoError,
    documentHash && componentIndex >= componentCount
      ? `This image has no component ${componentIndex}. Choose another brush or component.`
      : "",
    scanCorruptionReports.length > 0 ? editedPreviewError : "",
    scanCorruptionReports.length > 0 &&
    cleanEncodedPreviewError &&
    !cleanEncodedPreviewUrl
      ? `The clean encoded JPEG could not be previewed: ${cleanEncodedPreviewError}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const visibleErrorMessage =
    errorMessage ||
    (contextualErrorMessage !== dismissedToastMessage
      ? contextualErrorMessage
      : "");

  useEffect(() => {
    const dialog = saveDialogRef.current;
    if (!dialog) return;
    if (isSaveDialogOpen && !dialog.open) dialog.showModal();
    else if (!isSaveDialogOpen && dialog.open) dialog.close();
  }, [isSaveDialogOpen]);

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

  useEffect(
    () => () => {
      if (cleanEncodedPreviewUrl) URL.revokeObjectURL(cleanEncodedPreviewUrl);
    },
    [cleanEncodedPreviewUrl],
  );

  useEffect(() => {
    cleanEncodedPreviewErrorRef.current = cleanEncodedPreviewError;
  }, [cleanEncodedPreviewError]);

  useEffect(() => {
    scanCorruptionController.current?.abort();
    scanCorruptionController.current = null;
    scanCorruptionHistory.current.clear();
    cleanEncodedBytes.current = null;
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

      cleanEncodedBytes.current = encoded.value.slice();
      const outputBuffer = new ArrayBuffer(encoded.value.byteLength);
      new Uint8Array(outputBuffer).set(encoded.value);
      const previewUrl = URL.createObjectURL(
        new Blob([outputBuffer], { type: "image/jpeg" }),
      );
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
        setCleanEncodedPreviewUrl(null);
        setCleanEncodedPreviewError(previewError);
      } else {
        setEditedPreviewUrl(previewUrl);
        setEditedPreviewError("");
        setCleanEncodedPreviewUrl(
          URL.createObjectURL(
            new Blob([outputBuffer.slice(0)], { type: "image/jpeg" }),
          ),
        );
        setCleanEncodedPreviewError("");
      }
      setEditedBytes(encoded.value);
      setIsEncoding(false);
    })();

    return () => controller.abort();
  }, [document, jpegOperations]);

  useEffect(
    () => () => {
      importController.current?.abort();
      scanCorruptionController.current?.abort();
    },
    [],
  );

  async function loadFile(file: File) {
    cancelScanCorruption();
    const currentRequest = ++requestId.current;
    importController.current?.abort();
    const controller = new AbortController();
    importController.current = controller;
    setErrorMessage("");
    setProjectNotice("");
    setIsLoading(true);
    const isProjectFile = file.name.toLowerCase().endsWith(".jpglitch");
    setLoadingMessage(isProjectFile ? "Opening project…" : "Inspecting JPEG…");

    let projectData: JgeProjectData | null = null;
    let jpegFile = file;
    if (isProjectFile) {
      const savedProject = await readJgeProjectFile(
        file,
        (message) => setLoadingMessage(message),
        controller.signal,
      );
      if (currentRequest !== requestId.current) return;
      if (!savedProject.ok) {
        importController.current = null;
        setIsLoading(false);
        setErrorMessage(savedProject.error.message);
        return;
      }
      projectData = savedProject.value;
      const sourceBuffer = new ArrayBuffer(projectData.source.bytes.byteLength);
      new Uint8Array(sourceBuffer).set(projectData.source.bytes);
      jpegFile = new File([sourceBuffer], projectData.source.fileName, {
        type: "image/jpeg",
      });
      setLoadingMessage("Inspecting embedded JPEG…");
    }

    const result = await importJpeg(jpegFile, controller.signal);
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
    if (projectData) {
      const restored = history.value.restoreOperations(projectData.operations);
      if (!restored.ok) {
        URL.revokeObjectURL(result.value.previewUrl);
        setErrorMessage(
          `The saved operation stack could not be restored: ${restored.error.message}`,
        );
        return;
      }
      if (
        projectData.draftMask &&
        (projectData.draftMask.width !== result.value.inspection.width ||
          projectData.draftMask.height !== result.value.inspection.height)
      ) {
        URL.revokeObjectURL(result.value.previewUrl);
        setErrorMessage(
          "The saved draft mask dimensions do not match the embedded JPEG.",
        );
        return;
      }
    }

    scanCorruptionController.current?.abort();
    scanCorruptionController.current = null;
    scanCorruptionHistory.current.clear();
    cleanEncodedBytes.current = null;
    operationHistory.current = history.value;
    setHistoryDocument(history.value.snapshot);
    pendingProjectStages.current =
      projectData && projectData.scanCorruptionStages.length > 0
        ? projectData.scanCorruptionStages
        : null;
    projectStagesReplayStarted.current = false;
    setEditedPreviewUrl(null);
    setEditedBytes(null);
    setEditedPreviewError("");
    setCleanEncodedPreviewUrl(null);
    setCleanEncodedPreviewError("");
    setScanCorruptionReports([]);
    setScanDecodeDiagnostic(null);
    setIsScanCorrupting(false);
    setShowCleanEncoded(false);
    setIsEncoding(history.value.snapshot.operations.length > 0);
    setHistoryAvailability({
      canUndo: history.value.canUndo,
      canRedo: history.value.canRedo,
    });
    setSelection(null);
    dispatchWorkspace({ type: "reset-document" });
    dispatchWorkspace({
      type: "set-selection",
      selection: projectData?.draftMask ?? null,
    });
    setBrushDraft([]);
    setComponentIndex(0);
    setInspectorComponentId(result.value.inspection.components[0]?.id ?? 0);
    setFrequencyBand("all");
    setCoefficientDomain("ac");
    setCoefficientMode("zero");
    setCoefficientStrength(1);
    setCoefficientSeed(1);
    setSelectedBrushId("pixelate");
    setRepeatSource(null);
    setRepeatDraft(null);
    setRepeatDestination(null);
    setRepeatCount(1);
    setBlockTransformMode("transfer");
    setBlockTransferMode("all");
    setBlockTransferAction("copy");
    setBlockTransferSource(null);
    setBlockTransferDraft(null);
    setBlockTransferDraftOutOfBounds(false);
    setBlockTransferDestination(null);
    blockTransformGesture.current = null;
    setBrushSize(32);
    setMaskGrid("dct");
    dispatchWorkspace({ type: "select-mask", maskId: null });
    setShowBlocks(false);
    setShowMcus(false);
    setShowOriginal(false);
    setZoom(1);
    setDocument(result.value);
    if (
      projectData &&
      (projectData.applicationVersion !== APPLICATION_VERSION ||
        projectData.codecVersion !== JPEG_CODEC_VERSION)
    ) {
      setProjectNotice(
        `Created with app ${projectData.applicationVersion} and ${projectData.codecVersion}; replayed JPEG output may differ from its previous export.`,
      );
    }
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
      if (scanCorruptionHistory.current.activeStages.length > 0) {
        const rolledBack = operationHistory.current?.undo();
        if (rolledBack?.ok) setHistoryDocument(rolledBack.value);
        const history = operationHistory.current;
        setHistoryAvailability({
          canUndo:
            (history?.canUndo ?? false) ||
            scanCorruptionHistory.current.canUndo,
          canRedo:
            (history?.canRedo ?? false) ||
            scanCorruptionHistory.current.canRedo,
        });
        setErrorMessage(
          "Undo Scan Corrupt before changing coefficient or DQT operations.",
        );
        return;
      }
      scanCorruptionController.current?.abort();
      scanCorruptionController.current = null;
      scanCorruptionHistory.current.clear();
      cleanEncodedBytes.current = null;
      setScanCorruptionReports([]);
      setScanDecodeDiagnostic(null);
      setEditedPreviewUrl(null);
      setEditedBytes(null);
      setEditedPreviewError("");
      setCleanEncodedPreviewUrl(null);
      setCleanEncodedPreviewError("");
      setIsEncoding(result.value.currentState.jpegOperations.length > 0);
      setIsScanCorrupting(false);
      setShowOriginal(false);
      setShowCleanEncoded(false);
    }
    setErrorMessage("");
    setHistoryDocument(result.value);
    const history = operationHistory.current;
    setHistoryAvailability({
      canUndo:
        (history?.canUndo ?? false) || scanCorruptionHistory.current.canUndo,
      canRedo:
        (history?.canRedo ?? false) || scanCorruptionHistory.current.canRedo,
    });
  }

  function mutateHistory(
    mutate: (
      history: OperationHistory<JpegEditableState>,
    ) => ReturnType<OperationHistory<JpegEditableState>["add"]>,
  ) {
    if (scanCorruptionHistory.current.activeStages.length > 0) {
      setErrorMessage(
        "Undo Scan Corrupt before changing coefficient or DQT operations.",
      );
      return;
    }
    const history = operationHistory.current;
    if (!history) return;
    updateHistory(mutate(history));
  }

  function getImagePoint(
    event: PointerEvent<HTMLDivElement>,
  ): { x: number; y: number } | null {
    if (!document) return null;
    const bounds = previewImageWrap.current?.getBoundingClientRect();
    if (!bounds) return null;
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

  function isImagePointInside(point: ImagePoint): boolean {
    return (
      document !== null &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= document.inspection.width &&
      point.y <= document.inspection.height
    );
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
    if (nextSelection && maskGrid === "mcu") {
      const snapped = snapSelectionToMcus(nextSelection, document.inspection);
      if (!snapped.ok) {
        setErrorMessage(snapped.error.message);
        return null;
      }
      nextSelection = snapped.value;
    } else if (nextSelection) {
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
    setSelection(nextSelection);
    return nextSelection;
  }

  const selectAllImage = useCallback(() => {
    if (!document) return;
    const result = createRectangleSelection(
      0,
      0,
      document.inspection.width,
      document.inspection.height,
      document.inspection.width,
      document.inspection.height,
    );
    if (!result.ok || !result.value) {
      setErrorMessage(
        result.ok
          ? "The whole-image selection could not be created."
          : result.error.message,
      );
      return;
    }
    const mask = createSpatialMask(
      result.value,
      document.inspection.width,
      document.inspection.height,
    );
    if (!mask.ok) {
      setErrorMessage(mask.error.message);
      return;
    }
    keyboardSelectionAnchor.current = null;
    setSelection(null);
    dispatchWorkspace({ type: "set-selection", selection: mask.value });
    setCanvasKeyboardAnnouncement("Selected the entire image.");
    setErrorMessage("");
  }, [document]);

  function getCanvasComponentId() {
    return toolMode === "inspector"
      ? inspectorComponentId
      : (document?.inspection.components[componentIndex]?.id ?? -1);
  }

  function getInitialKeyboardCursor() {
    if (!document) return null;
    const componentId = getCanvasComponentId();
    const grid = getJpegComponentBlockGrid(document.inspection, componentId);
    if (!grid) return null;
    const preferredBlock =
      selectedBlock?.componentId === componentId ? selectedBlock : null;
    const coordinate = mapJpegBlockCoordinate(
      document.inspection,
      componentId,
      preferredBlock?.blockX ?? Math.floor(grid.columns / 2),
      preferredBlock?.blockY ?? Math.floor(grid.rows / 2),
    );
    return coordinate.ok ? coordinate.value : null;
  }

  function updateKeyboardSelection(
    anchor: JpegBlockCoordinate,
    cursor: JpegBlockCoordinate,
  ): SpatialSelection | null {
    const left = Math.min(anchor.imageX, cursor.imageX);
    const top = Math.min(anchor.imageY, cursor.imageY);
    const right = Math.max(
      anchor.imageX + anchor.imageWidth,
      cursor.imageX + cursor.imageWidth,
    );
    const bottom = Math.max(
      anchor.imageY + anchor.imageHeight,
      cursor.imageY + cursor.imageHeight,
    );
    return updateSelection({ x: left, y: top }, { x: right, y: bottom });
  }

  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!document || (toolMode !== "select" && toolMode !== "inspector"))
      return;
    const componentId = getCanvasComponentId();
    const grid = getJpegComponentBlockGrid(document.inspection, componentId);
    if (!grid) return;
    const cursor =
      keyboardCursor?.componentId === componentId
        ? keyboardCursor
        : getInitialKeyboardCursor();
    if (!cursor) return;

    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      const blockX = Math.max(
        0,
        Math.min(
          grid.columns - 1,
          cursor.blockX +
            (event.key === "ArrowLeft"
              ? -1
              : event.key === "ArrowRight"
                ? 1
                : 0),
        ),
      );
      const blockY = Math.max(
        0,
        Math.min(
          grid.rows - 1,
          cursor.blockY +
            (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0),
        ),
      );
      const moved = mapJpegBlockCoordinate(
        document.inspection,
        componentId,
        blockX,
        blockY,
      );
      if (!moved.ok) {
        setErrorMessage(moved.error.message);
        return;
      }
      setKeyboardCursor(moved.value);
      if (toolMode === "select" && keyboardSelectionAnchor.current) {
        updateKeyboardSelection(keyboardSelectionAnchor.current, moved.value);
      }
      setCanvasKeyboardAnnouncement(
        `DCT block ${moved.value.blockX + 1} of ${grid.columns}, row ${moved.value.blockY + 1} of ${grid.rows}.`,
      );
      return;
    }

    if (event.key === "Escape" && toolMode === "select") {
      event.preventDefault();
      keyboardSelectionAnchor.current = null;
      setSelection(null);
      dispatchWorkspace({ type: "set-selection", selection: null });
      setCanvasKeyboardAnnouncement("Selection cleared.");
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    if (toolMode === "inspector") {
      dispatchWorkspace({
        type: "select-block",
        block: cursor,
      });
      setCanvasKeyboardAnnouncement(
        `Inspected DCT block ${cursor.blockX + 1}, row ${cursor.blockY + 1}, component ${cursor.componentId}.`,
      );
      setErrorMessage("");
      return;
    }

    if (keyboardSelectionAnchor.current) {
      const completedSelection = updateKeyboardSelection(
        keyboardSelectionAnchor.current,
        cursor,
      );
      if (!completedSelection) return;
      const mask = createSpatialMask(
        completedSelection,
        document.inspection.width,
        document.inspection.height,
      );
      if (!mask.ok) {
        setErrorMessage(mask.error.message);
        return;
      }
      keyboardSelectionAnchor.current = null;
      setSelection(null);
      dispatchWorkspace({ type: "set-selection", selection: mask.value });
      if (
        panelTool === "coefficient-glitch" &&
        brushAutoApply[selectedBrushId] &&
        applyCoefficientOperation(mask.value)
      ) {
        dispatchWorkspace({ type: "set-selection", selection: null });
      }
      setCanvasKeyboardAnnouncement("Rectangle selection complete.");
      return;
    }
    keyboardSelectionAnchor.current = cursor;
    updateKeyboardSelection(cursor, cursor);
    setCanvasKeyboardAnnouncement(
      `Selection started at DCT block ${cursor.blockX + 1}, row ${cursor.blockY + 1}. Use arrow keys to extend it, then Enter to finish or Escape to clear.`,
    );
  }

  function snapBrushPoint(
    point: ImagePoint,
    reportError = true,
  ): ImagePoint | null {
    if (!document) return null;
    const component = document.inspection.components[componentIndex];
    if (!component) {
      if (reportError)
        setErrorMessage("The selected JPEG component is invalid.");
      return null;
    }
    const snapped = snapImagePointToGrid(
      point,
      document.inspection,
      component.id,
      maskGrid,
    );
    if (!snapped.ok) {
      if (reportError) setErrorMessage(snapped.error.message);
      return null;
    }
    return snapped.value;
  }

  function getComponentBlockPoint(
    point: ImagePoint,
  ): { readonly x: number; readonly y: number } | null {
    if (!document) return null;
    const component = document.inspection.components[componentIndex];
    if (!component) {
      setErrorMessage("The selected JPEG component is invalid.");
      return null;
    }
    const coordinate = mapJpegImagePointToBlock(
      document.inspection,
      component.id,
      point.x,
      point.y,
    );
    if (!coordinate.ok) {
      setErrorMessage(coordinate.error.message);
      return null;
    }
    return { x: coordinate.value.blockX, y: coordinate.value.blockY };
  }

  function getBlockRegionFromDrag(
    start: ImagePoint,
    end: ImagePoint,
    allowOversized = false,
    clipToImage = false,
  ): JpegBlockRegion | null {
    if (!document) return null;
    const component = document.inspection.components[componentIndex];
    if (!component) {
      setErrorMessage("The selected JPEG component is invalid.");
      return null;
    }
    const mapped = clipToImage
      ? mapJpegImageRectangleToBlockRegionClipped(
          document.inspection,
          component.id,
          start,
          end,
        )
      : mapJpegImageRectangleToBlockRegion(
          document.inspection,
          component.id,
          start,
          end,
        );
    if (!mapped.ok) {
      setErrorMessage(mapped.error.message);
      return null;
    }
    const region = mapped.value;
    if (
      !allowOversized &&
      region.width * region.height > MAX_BLOCK_TRANSFER_BLOCKS
    ) {
      setErrorMessage(
        "The selected block region exceeds the bounded transfer size.",
      );
      return null;
    }
    return region;
  }

  function getRepeatDestinationFromDrag(
    start: ImagePoint,
    end: ImagePoint,
    reportError = false,
  ) {
    if (!document || !repeatSource) return null;
    const component = document.inspection.components[componentIndex];
    if (!component) {
      if (reportError)
        setErrorMessage("The selected JPEG component is invalid.");
      return null;
    }
    const destination = mapJpegBlockDragToDestination(
      document.inspection,
      component.id,
      repeatSource,
      start,
      end,
    );
    if (!destination.ok) {
      if (reportError) setErrorMessage(destination.error.message);
      return null;
    }
    return destination.value;
  }

  function applyBlockTransferAt(destination: {
    readonly x: number;
    readonly y: number;
  }) {
    if (!ensureCoefficientPhase()) return;
    const history = operationHistory.current;
    const source = blockTransferSource;
    if (!history || !source) return;
    const operation = getBlockTransferOperation(source, destination);
    if (
      !operation ||
      !document ||
      !isBlockTransferParameters(operation, document.inspection)
    ) {
      return;
    }
    updateHistory(applyBlockTransferOperation(history, operation));
  }

  function getBlockTransferOperation(
    source: JpegBlockRegion,
    destination: { readonly x: number; readonly y: number },
  ): Extract<JpegGlitchOperation, { kind: "block-transfer" }> | null {
    if (!document) return null;
    const component = document.inspection.components[componentIndex];
    if (!component) return null;
    let { width, height } = source;
    if (blockTransferAction === "copy") {
      const grid = getJpegComponentBlockGrid(document.inspection, component.id);
      if (!grid) return null;
      width = Math.min(width, grid.columns - destination.x);
      height = Math.min(height, grid.rows - destination.y);
    }
    if (width <= 0 || height <= 0) return null;
    return {
      kind: "block-transfer",
      componentIndex,
      sourceX: source.x,
      sourceY: source.y,
      width,
      height,
      destinationX: destination.x,
      destinationY: destination.y,
      mode: blockTransferMode,
      action: blockTransferAction,
    };
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
    if (!isImagePointInside(point) && toolMode !== "select") return;
    if (toolMode === "block-transform" && blockTransformMode === "transfer") {
      const blockPoint = getComponentBlockPoint(point);
      if (!blockPoint) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!blockTransferSource) {
        blockTransformGesture.current = {
          kind: "transfer-source",
          start: point,
        };
        setBlockTransferDraft({
          x: blockPoint.x,
          y: blockPoint.y,
          width: 1,
          height: 1,
        });
        setBlockTransferDestination(null);
        setBlockTransferDraftOutOfBounds(false);
      } else {
        blockTransformGesture.current = {
          kind: "transfer-destination",
          start: point,
        };
        setBlockTransferDestination(blockPoint);
      }
      return;
    }
    if (toolMode === "block-transform" && blockTransformMode === "repeat") {
      const blockPoint = getComponentBlockPoint(point);
      if (!blockPoint) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setErrorMessage("");
      if (!repeatSource) {
        blockTransformGesture.current = {
          kind: "repeat-source",
          start: point,
        };
        setRepeatDraft({
          x: blockPoint.x,
          y: blockPoint.y,
          width: 1,
          height: 1,
        });
        setRepeatDestination(null);
      } else {
        if (
          blockPoint.x !== repeatSource.x ||
          blockPoint.y !== repeatSource.y
        ) {
          setErrorMessage(
            "Start the destination drag inside the selected source block.",
          );
          return;
        }
        blockTransformGesture.current = {
          kind: "repeat-destination",
          start: point,
        };
        setRepeatDestination(null);
      }
      return;
    }
    if (
      toolMode !== "inspector" &&
      toolMode !== "select" &&
      toolMode !== "brush"
    )
      return;
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
      const snappedPoint = snapBrushPoint(point);
      if (!snappedPoint) return;
      brushPoints.current = [[snappedPoint]];
      setBrushDraft([[snappedPoint]]);
    }
  }

  function onImagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panStart.current;
    if (pan && imageStage.current) {
      imageStage.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
      imageStage.current.scrollTop = pan.scrollTop - (event.clientY - pan.y);
      return;
    }
    const imagePoint = getImagePoint(event);
    const transformGesture = blockTransformGesture.current;
    if (toolMode === "block-transform" && transformGesture && imagePoint) {
      const pointIsInside = isImagePointInside(imagePoint);
      if (!pointIsInside && transformGesture.kind !== "transfer-source") return;
      switch (transformGesture.kind) {
        case "transfer-source":
          setBlockTransferDraftOutOfBounds(!pointIsInside);
          setBlockTransferDraft(
            getBlockRegionFromDrag(
              transformGesture.start,
              imagePoint,
              true,
              true,
            ),
          );
          break;
        case "transfer-destination":
          setBlockTransferDestination(getComponentBlockPoint(imagePoint));
          break;
        case "repeat-source":
          setRepeatDraft(
            getBlockRegionFromDrag(transformGesture.start, imagePoint),
          );
          break;
        case "repeat-destination":
          setRepeatDestination(
            getRepeatDestinationFromDrag(transformGesture.start, imagePoint),
          );
          break;
      }
      return;
    }
    if (toolMode === "brush" && brushPoints.current.length > 0 && imagePoint) {
      const strokes = brushPoints.current;
      const currentStroke = strokes[strokes.length - 1]!;
      if (!isImagePointInside(imagePoint)) {
        if (currentStroke.length > 0) {
          strokes.push([]);
          setBrushDraft(strokes.map((stroke) => [...stroke]));
        }
        return;
      }
      const point = snapBrushPoint(imagePoint);
      if (!point) return;
      const points = currentStroke;
      if (points.length === 0) {
        points.push(point);
        setBrushDraft(strokes.map((stroke) => [...stroke]));
        return;
      }
      const previous = points[points.length - 1]!;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const spacing = Math.max(1, brushSize / 8);
      const steps = Math.ceil(distance / spacing);
      const totalPoints = strokes.reduce(
        (total, stroke) => total + stroke.length,
        0,
      );
      if (totalPoints + steps > 10_000) {
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
      setBrushDraft(strokes.map((stroke) => [...stroke]));
      return;
    }
    const start = selectionStart.current;
    if (toolMode === "select" && start && imagePoint) {
      updateSelection(start, imagePoint);
    }
  }

  function onImagePointerUp(event: PointerEvent<HTMLDivElement>) {
    const transformGesture = blockTransformGesture.current;
    if (toolMode === "block-transform" && transformGesture) {
      blockTransformGesture.current = null;
      const imagePoint = getImagePoint(event);
      if (!imagePoint) {
        if (transformGesture.kind === "transfer-source") {
          setBlockTransferDraft(null);
          setBlockTransferDraftOutOfBounds(false);
        } else if (transformGesture.kind === "repeat-source") {
          setRepeatDraft(null);
        } else if (transformGesture.kind === "repeat-destination") {
          setRepeatDestination(null);
        }
        return;
      }
      switch (transformGesture.kind) {
        case "transfer-source": {
          const region = getBlockRegionFromDrag(
            transformGesture.start,
            imagePoint,
            true,
            true,
          );
          setBlockTransferDraft(null);
          setBlockTransferDraftOutOfBounds(false);
          if (region) {
            setBlockTransferSource(region);
            setBlockTransferDestination(null);
            setErrorMessage("");
          }
          break;
        }
        case "transfer-destination": {
          const destination = getComponentBlockPoint(imagePoint);
          if (!destination) return;
          setBlockTransferDestination(destination);
          applyBlockTransferAt(destination);
          break;
        }
        case "repeat-source": {
          const region = getBlockRegionFromDrag(
            transformGesture.start,
            imagePoint,
          );
          setRepeatDraft(null);
          if (!region) return;
          if (region.width !== 1 || region.height !== 1) {
            setErrorMessage(
              "Copy / repeat uses one source block. Drag within a single visible DCT block.",
            );
            return;
          }
          setRepeatSource(region);
          setRepeatDestination(null);
          setErrorMessage("");
          break;
        }
        case "repeat-destination": {
          const destination = getRepeatDestinationFromDrag(
            transformGesture.start,
            imagePoint,
            true,
          );
          setRepeatDestination(destination);
          if (destination) setErrorMessage("");
          break;
        }
      }
      return;
    }
    if (panStart.current) {
      panStart.current = null;
      return;
    }
    if (toolMode === "brush" && brushPoints.current.length > 0) {
      const imagePoint = getImagePoint(event);
      const point =
        imagePoint && isImagePointInside(imagePoint)
          ? snapBrushPoint(imagePoint)
          : null;
      if (point) {
        const strokes = brushPoints.current;
        const currentStroke = strokes[strokes.length - 1]!;
        const previous = currentStroke[currentStroke.length - 1];
        if (!previous || previous.x !== point.x || previous.y !== point.y) {
          currentStroke.push(point);
        }
      }
      const strokes = brushPoints.current;
      brushPoints.current = [];
      setBrushDraft([]);
      if (!document) return;
      const mask = createBrushMaskFromStrokes(
        strokes,
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
      if (
        panelTool === "coefficient-glitch" &&
        brushAutoApply[selectedBrushId]
      ) {
        if (applyCoefficientOperation(mask.value)) {
          dispatchWorkspace({ type: "set-selection", selection: null });
        }
      }
      return;
    }
    const start = selectionStart.current;
    const end = getImagePoint(event);
    if (start && end) {
      const nextSelection = updateSelection(start, end);
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
          if (
            panelTool === "coefficient-glitch" &&
            brushAutoApply[selectedBrushId]
          ) {
            if (applyCoefficientOperation(mask.value)) {
              dispatchWorkspace({ type: "set-selection", selection: null });
            }
          }
        }
      }
    }
    selectionStart.current = null;
  }

  function activateTool(tool: CanvasTool) {
    selectionStart.current = null;
    blockTransformGesture.current = null;
    brushPoints.current = [];
    panStart.current = null;
    setBrushDraft([]);
    setBlockTransferDraft(null);
    setBlockTransferDraftOutOfBounds(false);
    setRepeatDraft(null);
    setSelection(null);
    const maskEffect =
      tool === "coefficient-glitch" ||
      (tool === "block-transform" &&
        (blockTransformMode === "shuffle" || blockTransformMode === "shift"));
    const preservePanel =
      (tool === "brush" || tool === "select") &&
      (panelTool === "coefficient-glitch" ||
        (panelTool === "block-transform" &&
          (blockTransformMode === "shuffle" ||
            blockTransformMode === "shift")));
    if (
      maskEffect &&
      (tool === "coefficient-glitch" || tool === "block-transform")
    ) {
      dispatchWorkspace({ type: "activate-mask-effect", tool });
    } else {
      dispatchWorkspace({ type: "activate-tool", tool, preservePanel });
    }
    if (activeToolPanel.current) activeToolPanel.current.open = true;
  }

  function applyCoefficientOperation(mask = activeMask) {
    if (!ensureCoefficientPhase()) return false;
    const history = operationHistory.current;
    if (!history || !mask) {
      setErrorMessage(
        "Draw or select a mask before applying a coefficient glitch.",
      );
      return false;
    }
    const result = applyCoefficientGlitchOperation(history, {
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
    });
    updateHistory(result);
    return result.ok;
  }

  function selectCoefficientBrush(id: string) {
    const brush = brushes.find((candidate) => candidate.id === id);
    if (!brush) {
      setErrorMessage("The selected brush is unavailable.");
      return;
    }
    setSelectedBrushId(id);
    setBrushName(brush.name);
    setCoefficientDomain(brush.step.domain);
    setCoefficientMode(brush.step.mode);
    setFrequencyBand(brush.step.frequencyBand);
    setCoefficientStrength(brush.step.strength);
    setCoefficientSeed(brush.step.seed);
    setErrorMessage("");
  }

  function createCurrentCoefficientStep(): CoefficientBrush["step"] {
    return {
      domain: coefficientDomain,
      mode: coefficientMode,
      frequencyBand,
      strength:
        coefficientMode === "invert" || coefficientMode === "isolate"
          ? 0
          : coefficientStrength,
      seed: coefficientSeed,
    };
  }

  function saveCurrentBrush() {
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      setBrushStorageError("Saved brushes are unavailable in this browser.");
      return;
    }
    if (brushStorageError) {
      setErrorMessage("Resolve the brush storage error before saving.");
      return;
    }
    const brush: CoefficientBrush = {
      id: selectedBrushId,
      name: brushName.trim(),
      step: createCurrentCoefficientStep(),
    };
    const saved = updateCoefficientBrush(storage, userBrushes, brush);
    if (!saved.ok) {
      setErrorMessage(saved.error.message);
      return;
    }
    setUserBrushes(saved.value);
    setErrorMessage("");
  }

  function addCoefficientBrush() {
    if (brushStorageError) {
      setErrorMessage("Resolve the brush storage error before adding a brush.");
      return;
    }
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      setBrushStorageError("Saved brushes are unavailable in this browser.");
      return;
    }
    let number = 2;
    while (
      brushes.some(
        (brush) => brush.name.toLowerCase() === `user brush ${number}`,
      )
    )
      number += 1;
    const brush = {
      ...DEFAULT_USER_BRUSH,
      id: crypto.randomUUID(),
      name: `User brush ${number}`,
    };
    const saved = updateCoefficientBrush(storage, userBrushes, brush);
    if (!saved.ok) {
      setErrorMessage(saved.error.message);
      return;
    }
    setUserBrushes(saved.value);
    setSelectedBrushId(brush.id);
    setBrushName(brush.name);
    setCoefficientDomain(brush.step.domain);
    setCoefficientMode(brush.step.mode);
    setFrequencyBand(brush.step.frequencyBand);
    setCoefficientStrength(brush.step.strength);
    setCoefficientSeed(brush.step.seed);
    setErrorMessage("");
  }

  function changeBrushAutoApply(checked: boolean) {
    if (brushAutoError) return;
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      setBrushAutoError("Brush automatic-apply settings are unavailable.");
      return;
    }
    const next = { ...brushAutoApply, [selectedBrushId]: checked };
    const result = writeBrushAutoApply(storage, next);
    if (!result.ok) {
      setBrushAutoError(result.error.message);
      return;
    }
    setBrushAutoApply(next);
  }

  function applyBlockRepeat() {
    if (!ensureCoefficientPhase()) return;
    const history = operationHistory.current;
    if (!history || !repeatSource || !repeatDestination) {
      setErrorMessage(
        "Drag to select one source block, then drag from it to a destination block.",
      );
      return;
    }
    updateHistory(
      applyBlockRepeatOperation(history, {
        kind: "block-repeat",
        componentIndex,
        sourceX: repeatSource.x,
        sourceY: repeatSource.y,
        offsetX: repeatDestination.x - repeatSource.x,
        offsetY: repeatDestination.y - repeatSource.y,
        repetitions: repeatCount,
      }),
    );
  }

  function applyBlockPermutation() {
    if (!ensureCoefficientPhase()) return;
    const history = operationHistory.current;
    const mask = activeMask;
    if (!history || !mask) {
      setErrorMessage("Draw or select a mask before permuting DCT blocks.");
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

  function applyBlockShift() {
    if (!ensureCoefficientPhase()) return;
    const history = operationHistory.current;
    if (!history || !activeMask) {
      setErrorMessage("Draw or select a mask before shifting DCT blocks.");
      return;
    }
    updateHistory(
      applyBlockShiftOperation(history, {
        kind: "block-shift",
        componentIndex,
        mask: activeMask,
        offsetX: blockShiftX,
        offsetY: blockShiftY,
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
    if (!ensureCoefficientPhase()) return;
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
  }

  function restoreHistoryMask(mask: SpatialMask) {
    if (
      !document ||
      mask.width !== document.inspection.width ||
      mask.height !== document.inspection.height
    ) {
      setErrorMessage("The mask snapshot does not match the current image.");
      return;
    }
    const restored = copySpatialMask(mask);
    if (!restored.ok) {
      setErrorMessage(restored.error.message);
      return;
    }
    if (!getWorkspaceOverlayVisibility(toolMode).mask) {
      activateTool(
        restored.value.shapes[0]?.kind === "brush" ? "brush" : "select",
      );
    }
    selectionStart.current = null;
    brushPoints.current = [];
    setBrushDraft([]);
    setSelection(null);
    dispatchWorkspace({ type: "set-selection", selection: restored.value });
    setErrorMessage("");
  }

  function ensureCoefficientPhase(): boolean {
    if (scanCorruptionHistory.current.activeStages.length === 0) return true;
    setErrorMessage(
      "Undo Scan Corrupt before changing coefficient or DQT operations.",
    );
    return false;
  }

  const showCorruptedResult = useCallback(
    async (
      bytes: Uint8Array,
      reports: readonly ScanCorruptionReport[],
      diagnostic: ScanDecodeDiagnostic,
      signal: AbortSignal,
    ) => {
      setEditedBytes(bytes);
      setScanCorruptionReports(reports);
      setScanDecodeDiagnostic(diagnostic);
      const latestReport = reports.at(-1);
      if (latestReport) {
        setScanCorruptionMode(latestReport.mode);
        setScanCorruptionCount(latestReport.count);
        setScanCorruptionRangeStart(latestReport.rangeStart);
        setScanCorruptionRangeEnd(latestReport.rangeEnd);
        setScanCorruptionSeed(latestReport.seed);
      }
      setShowOriginal(false);
      setShowCleanEncoded(false);
      let previewUrl: string;
      try {
        previewUrl = createJpegPreviewUrl(bytes);
      } catch {
        setEditedPreviewUrl(null);
        setEditedPreviewError(
          "A preview could not be created for the corrupted scan. The corrupt bytes remain available to export; the clean encoded preview remains separate.",
        );
        setErrorMessage("");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        const history = operationHistory.current;
        setHistoryAvailability({
          canUndo:
            (history?.canUndo ?? false) ||
            scanCorruptionHistory.current.canUndo,
          canRedo:
            (history?.canRedo ?? false) ||
            scanCorruptionHistory.current.canRedo,
        });
        return;
      }
      let previewError = "";
      try {
        const preview = new Image();
        preview.src = previewUrl;
        await preview.decode();
        if (
          document &&
          (preview.naturalWidth !== document.inspection.width ||
            preview.naturalHeight !== document.inspection.height)
        ) {
          previewError =
            "The corrupted JPEG preview dimensions differ from the source image.";
        }
      } catch {
        previewError =
          "The browser decoder could not render the corrupted scan. The corrupt bytes remain available to export; the clean encoded preview is shown for comparison.";
      }

      if (signal.aborted) {
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
      setShowOriginal(false);
      setShowCleanEncoded(false);
      setErrorMessage("");
      setIsEncoding(false);
      setIsScanCorrupting(false);
      scanCorruptionController.current = null;
      const history = operationHistory.current;
      setHistoryAvailability({
        canUndo:
          (history?.canUndo ?? false) || scanCorruptionHistory.current.canUndo,
        canRedo:
          (history?.canRedo ?? false) || scanCorruptionHistory.current.canRedo,
      });
    },
    [document],
  );

  const replayScanStages = useCallback(
    async (
      stages: readonly ScanCorruptionParameters[],
      commitHistory: () => boolean,
    ) => {
      const cleanBytes = cleanEncodedBytes.current;
      if (!cleanBytes) {
        setErrorMessage(
          "Apply a coefficient or DQT operation and wait for its clean JPEG encoding before using Scan Corrupt.",
        );
        return;
      }
      if (stages.length === 0) {
        if (!commitHistory()) {
          setErrorMessage("The Scan Corrupt history could not be updated.");
          return;
        }
        const restoredBytes = cleanBytes.slice();
        setEditedBytes(restoredBytes);
        setScanCorruptionReports([]);
        setScanDecodeDiagnostic(null);
        setEditedPreviewError(cleanEncodedPreviewErrorRef.current);
        if (cleanEncodedPreviewErrorRef.current) {
          setEditedPreviewUrl(null);
        } else {
          try {
            setEditedPreviewUrl(createJpegPreviewUrl(restoredBytes));
          } catch {
            setEditedPreviewUrl(null);
            setEditedPreviewError(
              "The clean encoded JPEG remains available to export, but its preview could not be created.",
            );
          }
        }
        setShowOriginal(false);
        setShowCleanEncoded(false);
        setErrorMessage("");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        const history = operationHistory.current;
        setHistoryAvailability({
          canUndo:
            (history?.canUndo ?? false) ||
            scanCorruptionHistory.current.canUndo,
          canRedo:
            (history?.canRedo ?? false) ||
            scanCorruptionHistory.current.canRedo,
        });
        return;
      }

      const controller = new AbortController();
      scanCorruptionController.current?.abort();
      scanCorruptionController.current = controller;
      setIsEncoding(true);
      setIsScanCorrupting(true);
      setErrorMessage("");
      const corrupted = await corruptEncodedJpeg(
        cleanBytes,
        stages,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!corrupted.ok) {
        setErrorMessage(corrupted.error.message);
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        return;
      }
      if (!commitHistory()) {
        setErrorMessage("The Scan Corrupt history could not be updated.");
        setIsEncoding(false);
        setIsScanCorrupting(false);
        scanCorruptionController.current = null;
        return;
      }
      scanCorruptionController.current = null;
      setIsScanCorrupting(false);
      await showCorruptedResult(
        corrupted.value.bytes,
        corrupted.value.reports,
        corrupted.value.diagnostic,
        controller.signal,
      );
    },
    [showCorruptedResult],
  );

  useEffect(() => {
    const stages = pendingProjectStages.current;
    if (!editedBytes || !stages || projectStagesReplayStarted.current) {
      return;
    }

    projectStagesReplayStarted.current = true;
    void replayScanStages(stages, () => {
      scanCorruptionHistory.current.clear();
      for (const stage of stages) {
        if (!scanCorruptionHistory.current.record(stage).ok) {
          scanCorruptionHistory.current.clear();
          return false;
        }
      }
      pendingProjectStages.current = null;
      return true;
    });
  }, [editedBytes, replayScanStages]);

  function applyScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (history.activeStages.length >= MAX_SCAN_CORRUPTION_STAGES) {
      setErrorMessage(
        `A maximum of ${MAX_SCAN_CORRUPTION_STAGES} entropy-corruption stages can be stacked.`,
      );
      return;
    }
    const parameters: ScanCorruptionParameters = {
      mode: scanCorruptionMode,
      count: scanCorruptionCount,
      rangeStart: scanCorruptionRangeStart,
      rangeEnd: scanCorruptionRangeEnd,
      seed: scanCorruptionSeed,
    };
    const stages = [...history.activeStages, parameters];
    void replayScanStages(stages, () => history.record(parameters).ok);
  }

  function updateLastScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (history.activeStages.length === 0) return;
    const parameters: ScanCorruptionParameters = {
      mode: scanCorruptionMode,
      count: scanCorruptionCount,
      rangeStart: scanCorruptionRangeStart,
      rangeEnd: scanCorruptionRangeEnd,
      seed: scanCorruptionSeed,
    };
    const stages = [...history.activeStages.slice(0, -1), parameters];
    void replayScanStages(stages, () => history.replaceLast(parameters).ok);
  }

  function undoScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (!history.canUndo) return false;
    void replayScanStages(history.undoTarget, () => history.commitUndo());
    return true;
  }

  function redoScanCorruption() {
    const history = scanCorruptionHistory.current;
    if (!history.canRedo) return false;
    void replayScanStages(history.redoTarget, () => history.commitRedo());
    return true;
  }

  function cancelScanCorruption() {
    const controller = scanCorruptionController.current;
    if (!controller) return;
    controller.abort();
    scanCorruptionController.current = null;
    setIsScanCorrupting(false);
    setIsEncoding(false);
    setErrorMessage(
      "Scan corruption was cancelled; the prior JPEG bytes are unchanged.",
    );
  }

  function handleUndo() {
    if (undoScanCorruption()) return;
    const history = operationHistory.current;
    if (history) updateHistory(history.undo());
  }

  function handleRedo() {
    if (redoScanCorruption()) return;
    if (scanCorruptionHistory.current.activeStages.length > 0) return;
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
    link.hidden = true;
    window.document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadProjectFile() {
    if (!document || !historyDocument) return;
    setIsSavingProject(true);
    setErrorMessage("");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      const result = await createJgeProjectFile(
        {
          source: {
            fileName: document.originalAsset.fileName,
            sha256: document.originalAsset.sha256,
            bytes: document.originalAsset.readBytes(),
          },
          operations: historyDocument.operations,
          draftMask: globalSelectionMask,
          scanCorruptionStages:
            scanCorruptionHistory.current.activeStages.length > 0
              ? scanCorruptionHistory.current.activeStages
              : (pendingProjectStages.current ?? []),
        },
        { application: APPLICATION_VERSION, codec: JPEG_CODEC_VERSION },
      );
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      const baseName =
        document.originalAsset.fileName
          .replace(/\.[^.]+$/, "")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 100) || "project";
      const url = URL.createObjectURL(result.value);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${baseName}.jpglitch`;
      link.hidden = true;
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsSavingProject(false);
    }
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

  const overlayVisibility = getWorkspaceOverlayVisibility(toolMode);
  const isMaskAuthoring = toolMode === "brush" || toolMode === "select";
  const activeMaskForOverlay = overlayVisibility.mask
    ? isMaskAuthoring
      ? globalSelectionMask
      : toolMode === "block-transform" &&
          blockTransformMode !== "shuffle" &&
          blockTransformMode !== "shift"
        ? null
        : activeMask
    : null;
  const visibleSelection = overlayVisibility.mask
    ? ((isMaskAuthoring ? selection : null) ??
      getRectangleSelection(activeMaskForOverlay))
    : null;
  const activeComponentId =
    document?.inspection.components[componentIndex]?.id ?? -1;
  const transferPreviewOperation =
    blockTransferSource && blockTransferDestination
      ? getBlockTransferOperation(blockTransferSource, blockTransferDestination)
      : null;
  const transferSourceForPreview = blockTransferDraft ?? blockTransferSource;
  const blockTransferSourceInvalid =
    blockTransferDraftOutOfBounds ||
    (transferSourceForPreview !== null &&
      transferSourceForPreview.width * transferSourceForPreview.height >
        MAX_BLOCK_TRANSFER_BLOCKS);
  const blockTransferDestinationInvalid =
    blockTransferDestination !== null &&
    (blockTransferSourceInvalid ||
      !document ||
      !transferPreviewOperation ||
      !isBlockTransferParameters(
        transferPreviewOperation,
        document.inspection,
      ));
  const blockTransferSourceSelection =
    document && toolMode === "block-transform"
      ? blockTransformMode === "transfer"
        ? getBlockRegionSelection(
            document.inspection,
            activeComponentId,
            blockTransferDraft ?? blockTransferSource,
          )
        : blockTransformMode === "repeat"
          ? getBlockRegionSelection(
              document.inspection,
              activeComponentId,
              repeatDraft ?? repeatSource,
            )
          : null
      : null;
  const blockTransferDestinationSelection =
    document &&
    toolMode === "block-transform" &&
    blockTransformMode === "transfer" &&
    blockTransferSource &&
    blockTransferDestination
      ? getBlockRegionSelection(
          document.inspection,
          activeComponentId,
          clipJpegBlockRegionToGrid(
            document.inspection,
            activeComponentId,
            transferPreviewOperation
              ? {
                  x: transferPreviewOperation.destinationX,
                  y: transferPreviewOperation.destinationY,
                  width: transferPreviewOperation.width,
                  height: transferPreviewOperation.height,
                }
              : {
                  ...blockTransferDestination,
                  width: blockTransferSource.width,
                  height: blockTransferSource.height,
                },
          ),
        )
      : document &&
          toolMode === "block-transform" &&
          blockTransformMode === "repeat" &&
          repeatDestination
        ? getBlockRegionSelection(document.inspection, activeComponentId, {
            ...repeatDestination,
            width: 1,
            height: 1,
          })
        : null;
  const activeToolLabel =
    TOOL_GROUPS.flatMap((group) => group.tools).find(
      (tool) => tool.id === panelTool,
    )?.label ?? "Tool settings";
  const hasScanCorruption = scanCorruptionReports.length > 0;
  const hasCleanEncodedResult =
    editedBytes !== null && jpegOperations.length > 0;
  const previewUrlToDisplay = showOriginal
    ? document?.previewUrl
    : showCleanEncoded
      ? cleanEncodedPreviewUrl
      : (editedPreviewUrl ??
        (hasScanCorruption ? cleanEncodedPreviewUrl : document?.previewUrl));

  useEffect(() => {
    function onWorkspaceKeyDown(event: KeyboardEvent) {
      if (saveDialogRef.current?.open) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"))
      ) {
        return;
      }

      const shortcut = getWorkspaceShortcut(event);
      if (shortcut === "select-all") {
        if (toolMode !== "select" || !document) return;
        event.preventDefault();
        selectAllImage();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && document) {
        const tool = getCanvasToolShortcut(event.key);
        if (
          !tool ||
          !isCanvasToolEnabled(
            tool,
            panelTool,
            panelTool === "block-transform" &&
              (blockTransformMode === "shuffle" ||
                blockTransformMode === "shift"),
          )
        )
          return;
        event.preventDefault();
        keyboardSelectionAnchor.current = null;
        dispatchWorkspace({
          type: "activate-tool",
          tool,
          preservePanel:
            (tool === "brush" || tool === "select") &&
            (panelTool === "coefficient-glitch" ||
              (panelTool === "block-transform" &&
                (blockTransformMode === "shuffle" ||
                  blockTransformMode === "shift"))),
        });
        setKeyboardCursor(null);
        setCanvasKeyboardAnnouncement(`${tool} tool selected.`);
        return;
      }
      if (!shortcut) return;
      const targetSelector = {
        undo: 'button[aria-label="Undo"]',
        redo: 'button[aria-label="Redo"]',
        save: 'button[aria-label="Save"]',
        "open-file": 'button[aria-label="Open file"]',
      }[shortcut];
      const button =
        window.document.querySelector<HTMLButtonElement>(targetSelector);
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    }

    window.addEventListener("keydown", onWorkspaceKeyDown);
    return () => window.removeEventListener("keydown", onWorkspaceKeyDown);
  }, [blockTransformMode, document, panelTool, selectAllImage, toolMode]);

  return (
    <main className={`workspace ${document ? "has-tool-bar" : ""}`}>
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="JPEG Glitch Editor home"
        >
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
              disabled={!historyAvailability.canUndo || isEncoding}
              aria-label="Undo"
              aria-keyshortcuts="Control+Z Meta+Z"
              title="Undo"
            >
              ↶
            </button>
            <button
              className="history-toolbar-button"
              type="button"
              onClick={handleRedo}
              disabled={!historyAvailability.canRedo || isEncoding}
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
              title="Redo"
            >
              ↷
            </button>
          </div>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,.jpg,.jpeg,.jpglitch,application/vnd.jpeg-glitch-editor.project+json"
            aria-label="Choose a JPEG or editor project file"
            tabIndex={-1}
            onChange={onFileChange}
          />
          <button
            className="open-button"
            type="button"
            aria-label="Open file"
            onClick={() => fileInput.current?.click()}
            disabled={isLoading}
            aria-keyshortcuts="Control+O Meta+O"
            title="Open a JPEG or .jpglitch project (Ctrl/⌘+O)"
          >
            {isLoading ? loadingMessage : "Open file"}
          </button>
          {document && (
            <button
              className="open-button"
              type="button"
              aria-label="Save"
              onClick={() => setIsSaveDialogOpen(true)}
              disabled={isSavingProject || isLoading}
              aria-keyshortcuts="Control+S Meta+S"
              title="Save as JPEG or .jpglitch (Ctrl/⌘+S)"
            >
              {isSavingProject ? "Saving…" : "Save"}
            </button>
          )}
          {document && (
            <button
              className="export-button"
              type="button"
              onClick={downloadEditedJpeg}
              disabled={!editedBytes || isEncoding}
              title={
                hasScanCorruption
                  ? "Download the entropy-corrupted JPEG bytes; the original remains unchanged"
                  : "Download the encoded JPEG experiment; the original is unchanged"
              }
            >
              {isEncoding
                ? isScanCorrupting
                  ? "Corrupting…"
                  : "Encoding…"
                : "Export JPEG"}
            </button>
          )}
        </div>
      </header>

      {document && (
        <dialog
          ref={saveDialogRef}
          className="save-dialog"
          aria-labelledby="save-dialog-title"
          aria-describedby="save-dialog-description"
          onCancel={(event) => {
            event.preventDefault();
            setIsSaveDialogOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setIsSaveDialogOpen(false);
          }}
          onClose={() => setIsSaveDialogOpen(false)}
        >
          <h2 id="save-dialog-title">Choose what to save</h2>
          <p id="save-dialog-description">
            Export the current JPEG experiment, or save a .jpglitch project with
            the exact original JPEG and editable operations. The original file
            is never overwritten.
          </p>
          <div className="save-dialog-actions">
            <button
              className="open-button"
              type="button"
              autoFocus
              disabled={!editedBytes || isEncoding}
              title={
                editedBytes
                  ? "Export the current JPEG experiment"
                  : "Apply a JPEG operation before exporting an image"
              }
              onClick={() => {
                setIsSaveDialogOpen(false);
                downloadEditedJpeg();
              }}
            >
              Save image (.jpg)
            </button>
            <button
              className="open-button"
              type="button"
              disabled={isSavingProject || isLoading}
              onClick={() => {
                setIsSaveDialogOpen(false);
                void downloadProjectFile();
              }}
            >
              Save editable project (.jpglitch)
            </button>
            <button
              className="tool-toggle"
              type="button"
              onClick={() => setIsSaveDialogOpen(false)}
            >
              Cancel
            </button>
          </div>
        </dialog>
      )}

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
                {group.tools.map((tool) => {
                  const enabled = isCanvasToolEnabled(
                    tool.id,
                    panelTool,
                    panelTool === "block-transform" &&
                      (blockTransformMode === "shuffle" ||
                        blockTransformMode === "shift"),
                  );
                  return (
                    <button
                      className={`tool-button ${toolMode === tool.id || panelTool === tool.id ? "is-active" : ""}`}
                      key={tool.id}
                      type="button"
                      disabled={!enabled}
                      aria-label={tool.label}
                      aria-pressed={
                        toolMode === tool.id || panelTool === tool.id
                      }
                      aria-keyshortcuts={tool.shortcut}
                      title={
                        enabled
                          ? `${tool.label} (${tool.shortcut})`
                          : `Select Coefficient Glitch to enable ${tool.label}`
                      }
                      onClick={() => activateTool(tool.id)}
                    >
                      <svg
                        className="tool-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={
                          tool.id === "block-transform" ? "2.6" : "1.7"
                        }
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {getToolIconPaths(tool.id).map((path) => (
                          <path
                            d={path}
                            key={path}
                            strokeDasharray={
                              tool.id === "select" ? "3 3" : undefined
                            }
                          />
                        ))}
                      </svg>
                      <span>{tool.label}</span>
                    </button>
                  );
                })}
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
          {visibleErrorMessage && (
            <div className="workspace-error-toast" role="alert">
              <span className="error-icon" aria-hidden="true">
                !
              </span>
              <span className="workspace-error-message">
                {visibleErrorMessage}
              </span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => {
                  setDismissedToastMessage(visibleErrorMessage);
                  setErrorMessage("");
                }}
              >
                ×
              </button>
            </div>
          )}
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
                  Drop a JPEG to inspect it, select a region, and apply
                  reversible JPEG effects.
                </span>
              </div>
              <nav className="contact-links" aria-label="Contact">
                <a href="https://instagram.com/sahdoum">Instagram</a>
                <a href="https://t.me/achekhonte">Telegram</a>
                <a href="https://github.com/sahdoum">GitHub</a>
              </nav>
              {import.meta.env.VITE_GTM_CONTAINER_ID && (
                <p className="analytics-notice">
                  This site uses Google Tag Manager for visit analytics. Google
                  receives visit data; images are processed locally.{" "}
                  <a href="https://policies.google.com/privacy">
                    Google privacy policy
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div className="preview-workspace">
              <div className="preview-toolbar">
                <div>
                  <div className="section-kicker">
                    {hasScanCorruption && showCleanEncoded
                      ? "CLEAN ENCODED COMPARISON"
                      : hasScanCorruption && !showOriginal
                        ? "ENTROPY SCAN EXPERIMENT"
                        : editedBytes && !showOriginal
                          ? "ENCODED JPEG EXPERIMENT"
                          : "DECODED PIXEL PREVIEW"}
                  </div>
                  <p>
                    {isEncoding
                      ? isScanCorrupting
                        ? "Corrupting a verified entropy-coded scan in the local worker…"
                        : "Applying JPEG-domain operations in the local worker…"
                      : editedBytes && editedPreviewError
                        ? editedPreviewError
                        : hasScanCorruption
                          ? "Bounded entropy-coded scan corruption · JPEG structure protected · source bytes remain unchanged"
                          : editedBytes && !showOriginal
                            ? "libjpeg-turbo re-encoding · source bytes remain unchanged"
                            : "Original JPEG · no pixel-only editing"}
                    {" · "}
                    {document.inspection.width} × {document.inspection.height}
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
                  {hasScanCorruption && cleanEncodedPreviewUrl && (
                    <button
                      className="tool-toggle"
                      type="button"
                      aria-pressed={showCleanEncoded}
                      onClick={() => {
                        setShowOriginal(false);
                        setShowCleanEncoded((current) => !current);
                      }}
                    >
                      {showCleanEncoded
                        ? "Show corrupt result"
                        : "Show clean encoded"}
                    </button>
                  )}
                  {editedBytes && (
                    <button
                      className="tool-toggle"
                      type="button"
                      aria-pressed={showOriginal}
                      onClick={() => {
                        setShowCleanEncoded(false);
                        setShowOriginal((current) => !current);
                      }}
                    >
                      {showOriginal ? "Show edited" : "Show original"}
                    </button>
                  )}
                  {isEncoding && (
                    <span className="encoding-indicator" role="status">
                      {isScanCorrupting ? "Corrupting scan…" : "Re-encoding…"}
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
              <div
                className="image-stage"
                ref={imageStage}
                onPointerDown={onImagePointerDown}
                onPointerMove={onImagePointerMove}
                onPointerUp={onImagePointerUp}
                onPointerCancel={() => {
                  selectionStart.current = null;
                  blockTransformGesture.current = null;
                  setBlockTransferDraft(null);
                  setBlockTransferDraftOutOfBounds(false);
                  setRepeatDraft(null);
                  setRepeatDestination(null);
                  brushPoints.current = [];
                  panStart.current = null;
                  setBrushDraft([]);
                }}
              >
                <div
                  className={`preview-image-wrap ${toolMode === "select" ? "is-selecting" : ""} ${toolMode === "brush" ? "is-brushing" : ""} ${toolMode === "inspector" ? "is-inspecting" : ""} ${toolMode === "hand" ? "is-panning" : ""} ${toolMode === "block-transform" && (blockTransformMode === "transfer" || blockTransformMode === "repeat") ? "is-block-transforming" : ""}`}
                  style={{ transform: `scale(${zoom})` }}
                  role="group"
                  tabIndex={0}
                  aria-label="JPEG image canvas"
                  aria-describedby={
                    toolMode === "select" || toolMode === "inspector"
                      ? "canvas-keyboard-help"
                      : undefined
                  }
                  aria-keyshortcuts={
                    toolMode === "select" ? "Control+A Meta+A" : undefined
                  }
                  onFocus={() => {
                    setCanvasHasKeyboardFocus(true);
                    setKeyboardCursor(getInitialKeyboardCursor());
                  }}
                  onBlur={() => setCanvasHasKeyboardFocus(false)}
                  onKeyDown={onCanvasKeyDown}
                  ref={previewImageWrap}
                >
                  {previewUrlToDisplay ? (
                    <img
                      className="preview-image"
                      src={previewUrlToDisplay}
                      alt={`${showOriginal ? "Original" : showCleanEncoded ? "Clean encoded" : hasScanCorruption ? "Entropy-corrupted" : "Re-encoded"} JPEG preview of ${document.originalAsset.fileName}`}
                    />
                  ) : (
                    <div className="scan-preview-unavailable" role="status">
                      {cleanEncodedPreviewError ||
                        editedPreviewError ||
                        "No decoded preview is available. The clean and corrupted JPEG bytes remain separate from the original."}
                    </div>
                  )}
                  <ImageOverlays
                    inspection={document.inspection}
                    showBlocks={showBlocks}
                    showMcus={showMcus}
                    selection={visibleSelection}
                    mask={activeMaskForOverlay}
                    brushDraft={brushDraft}
                    brushRadius={brushSize / 2}
                    componentId={
                      document.inspection.components[componentIndex]?.id ?? -1
                    }
                    selectedBlock={
                      overlayVisibility.inspectedBlock ? selectedBlock : null
                    }
                    keyboardCursor={
                      canvasHasKeyboardFocus ? keyboardCursor : null
                    }
                    blockTransferSource={blockTransferSourceSelection}
                    blockTransferSourceInvalid={blockTransferSourceInvalid}
                    blockTransferDestination={blockTransferDestinationSelection}
                    blockTransferDestinationInvalid={
                      blockTransferDestinationInvalid
                    }
                  />
                </div>
              </div>
              {(toolMode === "select" || toolMode === "inspector") && (
                <p id="canvas-keyboard-help" className="canvas-keyboard-help">
                  {toolMode === "select"
                    ? "Keyboard: Ctrl/⌘+A selects the whole image; arrows move one DCT block; Enter starts or commits a rectangular mask; Escape clears it."
                    : "Keyboard: arrow keys move one DCT block; Enter inspects the focused block."}
                </p>
              )}
              <span
                className="visually-hidden"
                role="status"
                aria-live="polite"
              >
                {canvasKeyboardAnnouncement}
              </span>
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
            {projectNotice && (
              <p className="project-notice" role="status">
                {projectNotice}
              </p>
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
                      <ComponentChoiceGroup
                        name="inspector-component"
                        inspection={document.inspection}
                        value={Math.max(
                          0,
                          document.inspection.components.findIndex(
                            (component) =>
                              component.id === inspectorComponentId,
                          ),
                        )}
                        onChange={(index) => {
                          const component =
                            document.inspection.components[index];
                          if (!component) return;
                          setInspectorComponentId(component.id);
                          dispatchWorkspace({
                            type: "select-block",
                            block: null,
                          });
                        }}
                      />
                      {selectedBlock && (
                        <p className="selection-readout">
                          Component ID {selectedBlock.componentId} · block (
                          {selectedBlock.blockX}, {selectedBlock.blockY})
                        </p>
                      )}
                    </section>
                  )}
                  {toolMode === "info" && (
                    <section className="inspector-section">
                      <CollapsibleSection
                        id="original-asset"
                        title="Original asset"
                        kicker="ORIGINAL ASSET"
                        className="source-section"
                        initiallyOpen={false}
                      >
                        <div className="source-card">
                          <p
                            className="source-name"
                            title={document.originalAsset.fileName}
                          >
                            {document.originalAsset.fileName}
                          </p>
                          <p className="source-size">
                            {document.originalAsset.byteLength.toLocaleString()}{" "}
                            bytes
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
                        onError={setErrorMessage}
                      />
                    </section>
                  )}
                  {panelTool === "coefficient-glitch" && (
                    <section className="inspector-section selection-panel">
                      <div className="coefficient-field">
                        <span>Coefficient effects</span>
                        <div
                          className="brush-picker"
                          role="group"
                          aria-label="Coefficient effects"
                        >
                          {brushes.map((brush) => (
                            <button
                              className={`brush-preset ${selectedBrushId === brush.id ? "is-active" : ""}`}
                              type="button"
                              key={brush.id}
                              aria-label={brush.name}
                              aria-pressed={selectedBrushId === brush.id}
                              title={brush.name}
                              onClick={() => selectCoefficientBrush(brush.id)}
                            >
                              <span aria-hidden="true">
                                {brush.id === "pixelate"
                                  ? "▦"
                                  : brush.id === "chroma-scale"
                                    ? "◈"
                                    : brush.id === "dc-steps"
                                      ? "▤"
                                      : brush.id === "ringing"
                                        ? "◉"
                                        : brush.id === "engraving"
                                          ? "▥"
                                          : "✎"}
                              </span>
                              <small>{brush.name}</small>
                            </button>
                          ))}
                          <button
                            className="brush-preset brush-add"
                            type="button"
                            aria-label="Add user brush"
                            title="Add user brush"
                            disabled={!!brushStorageError}
                            onClick={addCoefficientBrush}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="coefficient-effect-actions">
                        <label className="coefficient-note">
                          <input
                            type="checkbox"
                            checked={!!brushAutoApply[selectedBrushId]}
                            disabled={!!brushAutoError}
                            onChange={(event) =>
                              changeBrushAutoApply(event.currentTarget.checked)
                            }
                          />{" "}
                          Apply automatically after drawing
                        </label>
                        <button
                          className="operation-button"
                          type="button"
                          disabled={
                            !activeMask ||
                            isEncoding ||
                            hasScanCorruption ||
                            !selectedBrush ||
                            componentIndex >=
                              document.inspection.components.length
                          }
                          onClick={() => applyCoefficientOperation()}
                        >
                          Apply {selectedBrush?.name ?? "effect"}
                        </button>
                      </div>
                      <h3 className="parameter-group-title">Core parameters</h3>
                      <ComponentChoiceGroup
                        name="coefficient-component"
                        inspection={document.inspection}
                        value={componentIndex}
                        includeUnavailable
                        onChange={(index) => {
                          setComponentIndex(index);
                          setErrorMessage("");
                        }}
                      />
                      {!BUILT_IN_COEFFICIENT_BRUSHES.some(
                        (brush) => brush.id === selectedBrushId,
                      ) && (
                        <div className="coefficient-brush-settings">
                          <RadioChoiceGroup<CoefficientGlitchMode>
                            name="coefficient-mode"
                            legend="Operation"
                            value={coefficientMode}
                            options={[
                              {
                                value: "zero",
                                label: "Zero",
                                hint: "Set selected coefficients to 0",
                              },
                              {
                                value: "scale",
                                label: "Scale",
                                hint: "Multiply selected values",
                              },
                              {
                                value: "randomize",
                                label: "Randomize",
                                hint: "Replace with seeded values",
                              },
                              {
                                value: "offset",
                                label: "DC offset",
                                hint: "Add to the block-average value",
                              },
                              {
                                value: "dc-steps",
                                label: "Poster",
                                hint: "Round block averages to steps",
                              },
                              {
                                value: "low-pass",
                                label: "AC low-pass",
                                hint: "Remove AC above a frequency cutoff",
                              },
                              {
                                value: "ringing-boost",
                                label: "Ringing boost",
                                hint: "Boost the retained frequency edge",
                              },
                              {
                                value: "engrave-horizontal",
                                label: "Engraving horizontal",
                                hint: "Keep one DCT frequency axis",
                              },
                              {
                                value: "engrave-vertical",
                                label: "Engraving vertical",
                                hint: "Keep the other DCT frequency axis",
                              },
                              {
                                value: "invert",
                                label: "Invert AC",
                                hint: "Negate selected AC coefficients",
                              },
                              {
                                value: "isolate",
                                label: "Isolate band",
                                hint: "Clear AC values outside the band",
                              },
                            ]}
                            onChange={(next) => {
                              setCoefficientMode(next);
                              if (next === "offset" || next === "dc-steps") {
                                setCoefficientDomain("dc");
                                setFrequencyBand("all");
                                if (next === "dc-steps") {
                                  setCoefficientStrength(32);
                                }
                              } else if (
                                next === "low-pass" ||
                                next === "ringing-boost" ||
                                next === "engrave-horizontal" ||
                                next === "engrave-vertical"
                              ) {
                                setCoefficientDomain("ac");
                                setFrequencyBand("all");
                                setCoefficientStrength(4);
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
                            }}
                          />
                          {coefficientMode !== "offset" &&
                            coefficientMode !== "dc-steps" &&
                            coefficientMode !== "low-pass" &&
                            coefficientMode !== "ringing-boost" &&
                            coefficientMode !== "engrave-horizontal" &&
                            coefficientMode !== "engrave-vertical" && (
                              <>
                                <RadioChoiceGroup<CoefficientRangeChoice>
                                  name="coefficient-target-range"
                                  legend="Coefficient range"
                                  value={
                                    coefficientDomain === "dc"
                                      ? "dc"
                                      : `ac:${frequencyBand}`
                                  }
                                  options={getCoefficientRangeOptions(
                                    coefficientMode,
                                  )}
                                  onChange={(next) => {
                                    if (next === "dc") {
                                      setCoefficientDomain("dc");
                                      setFrequencyBand("all");
                                      return;
                                    }
                                    const band = GLITCH_FREQUENCY_BANDS.find(
                                      (candidate) => next === `ac:${candidate}`,
                                    );
                                    if (band) {
                                      setCoefficientDomain("ac");
                                      setFrequencyBand(band);
                                    }
                                  }}
                                  layout="bands"
                                  showCheckmark={false}
                                />
                                <p className="coefficient-note">
                                  DC is the block-average coefficient. AC bands
                                  refer to u+v coordinates in quantized 8×8 DCT
                                  coefficients.
                                </p>
                                {coefficientMode === "isolate" && (
                                  <p className="coefficient-note">
                                    Isolate band targets AC only: DC is not an
                                    AC band, and AC All would leave no
                                    coefficients outside the selected range to
                                    clear.
                                  </p>
                                )}
                              </>
                            )}
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
                            <SeedField
                              id="coefficient-seed"
                              label="Deterministic seed"
                              value={coefficientSeed}
                              onChange={(value) =>
                                setCoefficientSeed(Number(value))
                              }
                            />
                          )}
                        </div>
                      )}
                      {coefficientMode === "scale" && (
                        <div className="coefficient-field tool-field range-field">
                          <span id="coefficient-strength-label">
                            Scale multiplier · {coefficientStrength}
                          </span>
                          <div className="range-input-row">
                            <input
                              type="range"
                              min="-8"
                              max="8"
                              step="0.1"
                              value={coefficientStrength}
                              aria-labelledby="coefficient-strength-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                            <input
                              type="number"
                              min="-8"
                              max="8"
                              step="0.1"
                              value={coefficientStrength}
                              aria-labelledby="coefficient-strength-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </div>
                          <div className="range-endpoints">
                            <span>−8 · reduce or invert</span>
                            <span>+8 · increase</span>
                          </div>
                        </div>
                      )}
                      {coefficientMode === "dc-steps" && (
                        <div className="coefficient-field tool-field range-field">
                          <span id="dc-step-label">
                            DC coefficient step · {coefficientStrength}
                          </span>
                          <div className="range-input-row">
                            <input
                              type="range"
                              min="1"
                              max="512"
                              step="1"
                              value={coefficientStrength}
                              aria-labelledby="dc-step-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                            <input
                              type="number"
                              min="1"
                              max="512"
                              step="1"
                              value={coefficientStrength}
                              aria-labelledby="dc-step-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </div>
                          <div className="range-endpoints">
                            <span>1 · finest</span>
                            <span>512 · coarser</span>
                          </div>
                          <p className="coefficient-note">
                            Rounds the selected component&apos;s quantized DC
                            coefficients; AC remains unchanged. This may produce
                            blocky tonal steps, not guaranteed pixel
                            posterization.
                          </p>
                        </div>
                      )}
                      {coefficientMode === "low-pass" && (
                        <div className="coefficient-field tool-field range-field">
                          <span id="ac-cutoff-label">
                            AC frequency cutoff · {coefficientStrength}
                          </span>
                          <div className="range-input-row">
                            <input
                              type="range"
                              min="1"
                              max="14"
                              step="1"
                              value={coefficientStrength}
                              aria-labelledby="ac-cutoff-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                            <input
                              type="number"
                              min="1"
                              max="14"
                              step="1"
                              value={coefficientStrength}
                              aria-labelledby="ac-cutoff-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </div>
                          <div className="range-endpoints">
                            <span>1 · strongest cutoff</span>
                            <span>14 · unchanged</span>
                          </div>
                          <p className="coefficient-note">
                            Keeps DC and AC with u+v at or below the cutoff;
                            removes higher AC in masked blocks. Edge halos are
                            possible but not guaranteed.
                          </p>
                        </div>
                      )}
                      {coefficientMode === "ringing-boost" && (
                        <div className="coefficient-field tool-field range-field">
                          <span id="ringing-boost-label">
                            Ringing boost · {coefficientStrength}×
                          </span>
                          <div className="range-input-row">
                            <input
                              type="range"
                              min="1"
                              max="8"
                              step="0.1"
                              value={coefficientStrength}
                              aria-labelledby="ringing-boost-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                            <input
                              type="number"
                              min="1"
                              max="8"
                              step="0.1"
                              value={coefficientStrength}
                              aria-labelledby="ringing-boost-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </div>
                          <div className="range-endpoints">
                            <span>1× · low-pass only</span>
                            <span>8× · stronger</span>
                          </div>
                          <p className="coefficient-note">
                            Keeps DC and AC with u+v below 3, boosts AC at 3,
                            and removes higher AC in masked blocks. May create
                            edge halos, blur or block artifacts.
                          </p>
                        </div>
                      )}
                      {(coefficientMode === "engrave-horizontal" ||
                        coefficientMode === "engrave-vertical") && (
                        <div className="coefficient-field tool-field range-field">
                          <RadioChoiceGroup<
                            "engrave-horizontal" | "engrave-vertical"
                          >
                            name="engraving-direction"
                            legend="Line direction"
                            value={coefficientMode}
                            options={[
                              {
                                value: "engrave-horizontal",
                                label: "Horizontal",
                                hint: "Keep vertical-frequency AC (u=0)",
                              },
                              {
                                value: "engrave-vertical",
                                label: "Vertical",
                                hint: "Keep horizontal-frequency AC (v=0)",
                              },
                            ]}
                            onChange={setCoefficientMode}
                          />
                          <span id="engraving-strength-label">
                            Directional AC gain · {coefficientStrength}×
                          </span>
                          <div className="range-input-row">
                            <input
                              type="range"
                              min="1"
                              max="8"
                              step="0.1"
                              value={coefficientStrength}
                              aria-labelledby="engraving-strength-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                            <input
                              type="number"
                              min="1"
                              max="8"
                              step="0.1"
                              value={coefficientStrength}
                              aria-labelledby="engraving-strength-label"
                              onChange={(event) =>
                                setCoefficientStrength(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </div>
                          <div className="range-endpoints">
                            <span>1× · directional cut</span>
                            <span>8× · stronger</span>
                          </div>
                          <p className="coefficient-note">
                            Keeps DC and scales AC on one frequency axis; other
                            AC is removed in masked blocks. The result may be
                            blocky and is not guaranteed to resemble engraving.
                          </p>
                        </div>
                      )}
                      {!BUILT_IN_COEFFICIENT_BRUSHES.some(
                        (brush) => brush.id === selectedBrushId,
                      ) && (
                        <details className="advanced-controls">
                          <summary>Advanced brush settings</summary>
                          <div className="advanced-control-content">
                            <p className="coefficient-note">
                              Save changes to this brush in this browser.
                              Clearing browser data removes saved brushes.
                            </p>
                            <label className="coefficient-field">
                              <span>Brush name</span>
                              <input
                                type="text"
                                maxLength={48}
                                value={brushName}
                                onChange={(event) =>
                                  setBrushName(event.currentTarget.value)
                                }
                              />
                            </label>
                            <div className="operation-actions">
                              <button
                                className="operation-button secondary"
                                type="button"
                                disabled={
                                  !brushName.trim() || !!brushStorageError
                                }
                                onClick={saveCurrentBrush}
                              >
                                Save brush
                              </button>
                            </div>
                          </div>
                        </details>
                      )}
                    </section>
                  )}
                  {(toolMode === "brush" || toolMode === "select") && (
                    <section className="inspector-section selection-panel">
                      <div className="section-kicker">MASK AUTHORING</div>
                      <h2>
                        {toolMode === "brush" ? "Brush mask" : "Grid selection"}
                      </h2>
                      <p className="operation-description">
                        Create a spatial mask in image-pixel coordinates.
                        Effects use the current mask and keep the exact mask
                        snapshot used in their history entry.
                      </p>
                      <RadioChoiceGroup<JpegSelectionGrid>
                        name="mask-snap-grid"
                        legend="Snap to JPEG grid"
                        value={maskGrid}
                        options={[
                          {
                            value: "dct",
                            label: "8×8 DCT blocks",
                            hint: "Selected component",
                          },
                          {
                            value: "mcu",
                            label: "MCU",
                            hint: "Image sampling geometry",
                          },
                        ]}
                        onChange={setMaskGrid}
                        layout="inline"
                      />
                      {maskGrid === "dct" && (
                        <p className="coefficient-note">
                          DCT snapping follows the active JPEG effect target
                          (component ID{" "}
                          {document.inspection.components[componentIndex]?.id ??
                            "unavailable"}
                          ).
                        </p>
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
                          <div className="range-endpoints">
                            <span>Small · 4 px</span>
                            <span>Large · 256 px</span>
                          </div>
                        </label>
                      )}
                      {visibleSelection && (
                        <p className="selection-readout">
                          x {visibleSelection.x.toFixed(1)} · y{" "}
                          {visibleSelection.y.toFixed(1)} ·{" "}
                          {visibleSelection.width.toFixed(1)} ×{" "}
                          {visibleSelection.height.toFixed(1)} image pixels
                        </p>
                      )}
                      {globalSelectionMask && (
                        <p className="selection-readout">
                          Draft · {describeMask(globalSelectionMask)}
                        </p>
                      )}
                      <div className="operation-actions">
                        <button
                          className="operation-button secondary"
                          type="button"
                          disabled={!globalSelectionMask && !selection}
                          onClick={clearSelection}
                        >
                          Clear draft
                        </button>
                      </div>
                    </section>
                  )}
                  {panelTool === "block-transform" && (
                    <section className="inspector-section">
                      <p className="operation-description">
                        Changes quantized DCT blocks in one component, then
                        re-encodes the JPEG. This does not copy pixels, MCUs, or
                        entropy-coded bytes.
                      </p>
                      <div
                        className="block-transform-modes"
                        role="group"
                        aria-label="Block transform mode"
                      >
                        {(
                          [
                            ["transfer", "Drag transfer"],
                            ["repeat", "Copy / repeat"],
                            ["shuffle", "Shuffle"],
                            ["shift", "Local shift"],
                          ] as const
                        ).map(([mode, label]) => (
                          <button
                            className={`operation-button ${blockTransformMode === mode ? "" : "secondary"}`}
                            type="button"
                            aria-pressed={blockTransformMode === mode}
                            key={mode}
                            onClick={() => {
                              blockTransformGesture.current = null;
                              setBlockTransferDraft(null);
                              setRepeatDraft(null);
                              setBlockTransformMode(mode);
                              if (mode === "shuffle" || mode === "shift") {
                                dispatchWorkspace({
                                  type: "activate-mask-effect",
                                  tool: "block-transform",
                                });
                              } else {
                                selectionStart.current = null;
                                brushPoints.current = [];
                                setBrushDraft([]);
                                setSelection(null);
                                dispatchWorkspace({
                                  type: "activate-tool",
                                  tool: "block-transform",
                                });
                              }
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <ComponentChoiceGroup
                        name="block-transform-component"
                        inspection={document.inspection}
                        value={componentIndex}
                        onChange={(index) => {
                          setComponentIndex(index);
                          setBlockTransferSource(null);
                          setBlockTransferDraft(null);
                          setBlockTransferDestination(null);
                          setRepeatSource(null);
                          setRepeatDraft(null);
                          setRepeatDestination(null);
                        }}
                      />
                      {blockTransformMode === "transfer" && (
                        <>
                          <p className="coefficient-note">
                            {blockTransferSource
                              ? "Source selected. Drag on the image to choose a same-size destination; drop applies one undoable transfer."
                              : "Drag on the image to select a rectangular source region snapped to this component's visible 8×8 DCT-block grid."}
                          </p>
                          {blockTransferSource && (
                            <p className="selection-readout">
                              Source blocks ({blockTransferSource.x},{" "}
                              {blockTransferSource.y}) ·{" "}
                              {blockTransferSource.width} ×{" "}
                              {blockTransferSource.height}
                            </p>
                          )}
                          <RadioChoiceGroup<BlockTransferMode>
                            name="block-transfer-data"
                            legend="Coefficient data"
                            value={blockTransferMode}
                            options={[
                              {
                                value: "all",
                                label: "Whole block",
                                hint: "DC + AC",
                              },
                              {
                                value: "dc",
                                label: "DC only",
                              },
                              {
                                value: "ac",
                                label: "AC only",
                              },
                            ]}
                            onChange={setBlockTransferMode}
                            layout="triple"
                          />
                          <RadioChoiceGroup<BlockTransferAction>
                            name="block-transfer-action"
                            legend="Transfer action"
                            value={blockTransferAction}
                            options={[
                              {
                                value: "copy",
                                label: "Copy",
                                hint: "Source to destination",
                              },
                              {
                                value: "swap",
                                label: "Swap",
                                hint: "Exchange both regions",
                              },
                            ]}
                            onChange={setBlockTransferAction}
                            layout="inline"
                          />
                          <button
                            className="operation-button secondary"
                            type="button"
                            disabled={isEncoding}
                            onClick={() => {
                              setBlockTransferSource(null);
                              setBlockTransferDraft(null);
                              setBlockTransferDestination(null);
                            }}
                          >
                            Choose a new source region
                          </button>
                          {blockTransferAction === "swap" && (
                            <p className="coefficient-note">
                              Swaps must use non-overlapping regions. Use copy
                              for overlapping source and destination areas.
                            </p>
                          )}
                        </>
                      )}
                      {blockTransformMode === "repeat" && (
                        <>
                          <p className="coefficient-note">
                            Drag within one visible DCT block to select the
                            source. Then drag from that block to the first
                            destination; copies continue in the same block-grid
                            direction and spacing.
                          </p>
                          {repeatSource && (
                            <p className="selection-readout">
                              Source block ({repeatSource.x}, {repeatSource.y})
                            </p>
                          )}
                          {repeatDestination && repeatSource && (
                            <p className="selection-readout">
                              First destination ({repeatDestination.x},{" "}
                              {repeatDestination.y}) · offset (
                              {repeatDestination.x - repeatSource.x},{" "}
                              {repeatDestination.y - repeatSource.y}) blocks
                            </p>
                          )}
                          <button
                            className="operation-button secondary"
                            type="button"
                            disabled={isEncoding}
                            onClick={() => {
                              setRepeatSource(null);
                              setRepeatDraft(null);
                              setRepeatDestination(null);
                            }}
                          >
                            Choose a new source block
                          </button>
                          <label className="coefficient-field tool-field">
                            <span>Repeated destinations</span>
                            <input
                              type="number"
                              min="1"
                              max="256"
                              step="1"
                              value={repeatCount}
                              onChange={(event) =>
                                setRepeatCount(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </label>
                          <button
                            className="operation-button"
                            type="button"
                            disabled={
                              isEncoding || !repeatSource || !repeatDestination
                            }
                            onClick={applyBlockRepeat}
                          >
                            Apply block repeat
                          </button>
                        </>
                      )}
                      {blockTransformMode === "shuffle" && (
                        <>
                          <p className="operation-description">
                            Seeded Fisher–Yates permutation of whole blocks
                            within the selected mask. Every selected block is
                            used once; blocks outside it are unchanged.
                          </p>
                          <SeedField
                            id="block-shuffle-seed"
                            label="Deterministic seed"
                            value={permutationSeed}
                            onChange={(value) =>
                              setPermutationSeed(Number(value))
                            }
                          />
                          <button
                            className="operation-button"
                            type="button"
                            disabled={!activeMask || isEncoding}
                            onClick={applyBlockPermutation}
                          >
                            Shuffle blocks in mask
                          </button>
                        </>
                      )}
                      {blockTransformMode === "shift" && (
                        <>
                          <p className="operation-description">
                            Copy whole DCT blocks from the selected component
                            into masked destinations, shifted by component
                            blocks. Choose a chroma component for a color shift.
                            Source blocks outside the image leave destinations
                            unchanged. At least 50% mask coverage is required.
                          </p>
                          <label className="coefficient-field tool-field">
                            <span>Horizontal offset in component blocks</span>
                            <input
                              type="number"
                              min="-256"
                              max="256"
                              step="1"
                              value={blockShiftX}
                              onChange={(event) =>
                                setBlockShiftX(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </label>
                          <label className="coefficient-field tool-field">
                            <span>Vertical offset in component blocks</span>
                            <input
                              type="number"
                              min="-256"
                              max="256"
                              step="1"
                              value={blockShiftY}
                              onChange={(event) =>
                                setBlockShiftY(
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </label>
                          <button
                            className="operation-button"
                            type="button"
                            disabled={!activeMask || isEncoding}
                            onClick={applyBlockShift}
                          >
                            Shift blocks in mask
                          </button>
                        </>
                      )}
                    </section>
                  )}
                  {toolMode === "scan-corrupt" && (
                    <section className="inspector-section scan-corrupt-panel">
                      <p className="operation-description">
                        A bounded byte-domain experiment applied after the
                        coefficient/DQT JPEG encoder. This does not target
                        pixels, DCT blocks, MCUs, or source-file offsets. The
                        decoder may show a different region or fail entirely.
                        The original and clean encoded JPEG remain unchanged.
                      </p>
                      {!hasCleanEncodedResult && (
                        <p className="operation-empty" role="status">
                          {isEncoding
                            ? "The clean JPEG is being encoded. You can configure Scan Corrupt now; applying it will be available when encoding finishes."
                            : "You can configure Scan Corrupt now. Apply a coefficient or DQT operation and wait for its clean JPEG encoding before applying corruption."}
                        </p>
                      )}
                      <RadioChoiceGroup<"bit-flip" | "byte-replacement">
                        name="scan-corruption-mode"
                        legend="Corruption mode"
                        value={scanCorruptionMode}
                        options={[
                          {
                            value: "bit-flip",
                            label: "Flip one bit",
                          },
                          {
                            value: "byte-replacement",
                            label: "Replace entropy byte",
                          },
                        ]}
                        onChange={setScanCorruptionMode}
                        layout="inline"
                      />
                      <label className="coefficient-field tool-field">
                        <span>
                          Changed bytes (1–{MAX_SCAN_CORRUPTION_BYTES})
                        </span>
                        <input
                          type="number"
                          min="1"
                          max={MAX_SCAN_CORRUPTION_BYTES}
                          step="1"
                          value={scanCorruptionCount}
                          onChange={(event) =>
                            setScanCorruptionCount(
                              Number(event.currentTarget.value),
                            )
                          }
                        />
                      </label>
                      <div className="scan-range-fields">
                        <label className="coefficient-field">
                          <span>Scan range start (0–1)</span>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={scanCorruptionRangeStart}
                            onChange={(event) =>
                              setScanCorruptionRangeStart(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                        <label className="coefficient-field">
                          <span>Scan range end (0–1)</span>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={scanCorruptionRangeEnd}
                            onChange={(event) =>
                              setScanCorruptionRangeEnd(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      </div>
                      <SeedField
                        id="scan-corruption-seed"
                        label="Unsigned 32-bit seed"
                        value={scanCorruptionSeed}
                        onChange={(value) =>
                          setScanCorruptionSeed(Number(value))
                        }
                      />
                      <div className="scan-corrupt-actions">
                        <button
                          className="operation-button"
                          type="button"
                          disabled={
                            !hasCleanEncodedResult ||
                            isEncoding ||
                            scanCorruptionReports.length >=
                              MAX_SCAN_CORRUPTION_STAGES
                          }
                          onClick={applyScanCorruption}
                        >
                          Apply scan corruption
                        </button>
                        {hasScanCorruption && (
                          <button
                            className="operation-button secondary"
                            type="button"
                            disabled={isEncoding}
                            onClick={updateLastScanCorruption}
                          >
                            Update last stage
                          </button>
                        )}
                        {isScanCorrupting && (
                          <button
                            className="operation-button secondary"
                            type="button"
                            onClick={cancelScanCorruption}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                      <p className="operation-parameters" role="status">
                        {hasScanCorruption
                          ? `Stage ${scanCorruptionReports.length} of ${MAX_SCAN_CORRUPTION_STAGES} · ${isEncoding ? "corrupting and checking decode…" : editedPreviewError ? "preview decode failed" : "corruption complete · preview decoded"}`
                          : "No entropy-stream stage applied."}
                      </p>
                      {scanCorruptionReports.map((report, index) => (
                        <p
                          className="scan-corruption-report"
                          key={`${index}-${report.seed}`}
                        >
                          Stage {index + 1} · {report.mode} · seed {report.seed}{" "}
                          · scan {formatOffset(report.scanStartOffset)}–
                          {formatOffset(report.scanEndOffset)} · range{" "}
                          {report.rangeStart.toFixed(2)}–
                          {report.rangeEnd.toFixed(2)} · {report.changedBytes}{" "}
                          bytes / {report.changedBits} bits changed
                        </p>
                      ))}
                      {hasScanCorruption && scanDecodeDiagnostic && (
                        <div
                          className={`scan-decode-diagnostic ${scanDecodeDiagnostic.status === "complete" ? "is-complete" : "is-warning"}`}
                          role="status"
                          aria-label="JPEG decode completeness diagnostic"
                        >
                          <p>
                            {getScanDecodeDiagnosticMessage(
                              scanDecodeDiagnostic,
                            )}
                          </p>
                          {getScanDecodeWarningLabels(
                            scanDecodeDiagnostic.warningFlags,
                          ).map((warning) => (
                            <p key={warning}>Decoder warning: {warning}.</p>
                          ))}
                          <p>
                            This diagnostic reports libjpeg-turbo only. Other
                            JPEG decoders may recover differently; reading all
                            rows here does not guarantee identical display in
                            other applications.
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                  {toolMode === "quantization" && (
                    <QuantizationMatrixEditor
                      key={document.originalAsset.sha256}
                      quantizationTables={currentQuantizationTables}
                      components={document.inspection.components}
                      disabled={isEncoding || hasScanCorruption}
                      onApply={applyQuantizationEdit}
                      onError={setErrorMessage}
                    />
                  )}
                </CollapsibleSection>
                <CollapsibleSection
                  id="history"
                  title="History"
                  kicker="NON-DESTRUCTIVE OPERATIONS"
                  count={
                    (historyDocument?.operations.length ?? 0) +
                    scanCorruptionReports.length
                  }
                  className="history-panel"
                >
                  <section className="inspector-section operation-stack">
                    <p className="operation-description">
                      New operations appear at the top. Enabled operations
                      replay from the bottom up; reordering recomputes later
                      state.
                    </p>
                    {hasScanCorruption && (
                      <p className="scan-terminal-notice" role="status">
                        Entropy corruption is a terminal byte-domain phase. Undo
                        every Scan Corrupt stage before changing coefficient or
                        DQT operations.
                      </p>
                    )}
                    {scanCorruptionReports.length > 0 && (
                      <ol className="scan-corruption-history">
                        {scanCorruptionReports.map((report, index) => (
                          <li key={`${index}-${report.seed}`}>
                            Scan Corrupt · {report.mode} · seed {report.seed} ·{" "}
                            {report.changedBytes} bytes / {report.changedBits}{" "}
                            bits
                          </li>
                        ))}
                      </ol>
                    )}
                    {historyDocument?.operations.length ? (
                      <ol className="operation-list">
                        {getHistoryDisplayEntries(
                          historyDocument.operations,
                        ).map(({ operation, index }) => {
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
                          const recipeSteps = parameters
                            ? Reflect.get(parameters, "steps")
                            : null;
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
                                    disabled={hasScanCorruption}
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
                                      ? `Saved mask · ${Reflect.get(parameters ?? {}, "name")}`
                                      : operation.type ===
                                          "jpeg/glitch/coefficient-recipe"
                                        ? `Recipe · ${Reflect.get(parameters ?? {}, "name")}`
                                        : operationKind === "coefficients"
                                          ? "Coefficient glitch"
                                          : operationKind === "block-repeat"
                                            ? "Block copy / repeat"
                                            : operationKind ===
                                                "block-permutation"
                                              ? "Block shuffle"
                                              : operationKind === "block-shift"
                                                ? "Local block shift"
                                                : operationKind ===
                                                    "block-transfer"
                                                  ? "Block region transfer"
                                                  : operationKind ===
                                                      "quantization"
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
                                    {Reflect.get(parameters, "frequencyBand")} ·{" "}
                                    strength{" "}
                                    {Reflect.get(parameters, "strength")} · seed{" "}
                                    {Reflect.get(parameters, "seed")}
                                  </p>
                                )}
                              {parameters &&
                                operation.type ===
                                  "jpeg/glitch/coefficient-recipe" &&
                                Array.isArray(recipeSteps) && (
                                  <p className="operation-parameters">
                                    {recipeSteps.length} ordered coefficient
                                    steps · mask snapshot {mask?.id.slice(0, 8)}
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
                                operationKind === "block-shift" && (
                                  <p className="operation-parameters">
                                    Component{" "}
                                    {Reflect.get(parameters, "componentIndex")}{" "}
                                    · offset (
                                    {Reflect.get(parameters, "offsetX")},{" "}
                                    {Reflect.get(parameters, "offsetY")}) blocks
                                  </p>
                                )}
                              {parameters &&
                                operationKind === "block-transfer" && (
                                  <p className="operation-parameters">
                                    Component{" "}
                                    {Reflect.get(parameters, "componentIndex")}{" "}
                                    · {Reflect.get(parameters, "action")}{" "}
                                    {Reflect.get(parameters, "mode")} · source (
                                    {Reflect.get(parameters, "sourceX")},{" "}
                                    {Reflect.get(parameters, "sourceY")}) ·{" "}
                                    {Reflect.get(parameters, "width")} ×{" "}
                                    {Reflect.get(parameters, "height")} blocks ·
                                    destination (
                                    {Reflect.get(parameters, "destinationX")},{" "}
                                    {Reflect.get(parameters, "destinationY")})
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
                                {mask && (
                                  <button
                                    className="operation-button secondary"
                                    type="button"
                                    disabled={hasScanCorruption}
                                    title="Replace the current draft with a copy of this mask"
                                    onClick={() => restoreHistoryMask(mask)}
                                  >
                                    Restore mask
                                  </button>
                                )}
                                <button
                                  className="operation-button secondary"
                                  type="button"
                                  disabled={
                                    hasScanCorruption ||
                                    index ===
                                      historyDocument.operations.length - 1
                                  }
                                  aria-label="Move operation up"
                                  onClick={() =>
                                    mutateHistory((history) =>
                                      history.move(operation.id, index + 1),
                                    )
                                  }
                                >
                                  ↑
                                </button>
                                <button
                                  className="operation-button secondary"
                                  type="button"
                                  disabled={hasScanCorruption || index === 0}
                                  aria-label="Move operation down"
                                  onClick={() =>
                                    mutateHistory((history) =>
                                      history.move(operation.id, index - 1),
                                    )
                                  }
                                >
                                  ↓
                                </button>
                                <button
                                  className="operation-button danger"
                                  type="button"
                                  disabled={hasScanCorruption}
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
                        Apply an effect to start history.
                      </p>
                    )}
                    <button
                      className="operation-reset"
                      type="button"
                      disabled={
                        !historyDocument?.operations.length &&
                        !hasScanCorruption
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Reset all operations and clear the current mask? Undo can restore operations, but not the cleared mask.",
                          )
                        ) {
                          return;
                        }
                        scanCorruptionController.current?.abort();
                        scanCorruptionController.current = null;
                        scanCorruptionHistory.current.clear();
                        cleanEncodedBytes.current = null;
                        setScanCorruptionReports([]);
                        setScanDecodeDiagnostic(null);
                        setEditedBytes(null);
                        setEditedPreviewUrl(null);
                        setEditedPreviewError("");
                        setCleanEncodedPreviewUrl(null);
                        setCleanEncodedPreviewError("");
                        setIsEncoding(false);
                        setIsScanCorrupting(false);
                        setShowCleanEncoded(false);
                        const history = operationHistory.current;
                        if (history) updateHistory(history.resetToOriginal());
                        clearSelection();
                      }}
                    >
                      Reset to original
                    </button>
                  </section>
                </CollapsibleSection>
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
    </main>
  );
}

export default App;
