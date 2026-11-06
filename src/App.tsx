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
  applyBlockTransferOperation,
  applyCoefficientRecipeOperation,
  applyCoefficientGlitchOperation,
  applyQuantizationOperation,
  createJpegDocumentSession,
  type JpegEditableState,
} from "./application/jpeg-document";
import { importJpeg, type ImportedJpeg } from "./application/import-jpeg";
import {
  getJpegComponentBlockGrid,
  getMaskBlockCoveragePath,
  mapJpegBlockDragToDestination,
  mapJpegBlockCoordinate,
  mapJpegBlockRegionToImageSelection,
  mapJpegImageRectangleToBlockRegion,
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
  createBrushMask,
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
  MAX_BLOCK_TRANSFER_BLOCKS,
  GLITCH_FREQUENCY_BANDS,
  QUANTIZATION_PATTERNS,
  QUANTIZATION_SEMANTICS,
  type CoefficientDomain,
  type CoefficientGlitchMode,
  type BlockTransferAction,
  type BlockTransferMode,
  type GlitchFrequencyBand,
  type JpegGlitchOperation,
  type QuantizationPattern,
  type QuantizationSemantics,
} from "./operations/jpeg-glitch";
import { DCT_FREQUENCY_BAND_RANGES } from "./operations/dct";
import {
  BUILT_IN_EXPERIMENT_RECIPES,
  isCoefficientRecipeStep,
  MAX_RECIPE_STEPS,
  readUserRecipes,
  saveUserRecipe,
  type CoefficientRecipeStep,
  type ExperimentRecipe,
} from "./application/experiment-recipes";
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

const MARKER_LIMIT = 250;
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
        "M4 7h3c4 0 6 10 10 10h3",
        "m17 14 3 3-3 3",
        "M4 17h3c2 0 3-2 4-4",
        "M16 7h4",
        "m17 4 3 3-3 3",
        "M5 4h5v5H5z",
        "M14 15h5v5h-5z",
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
  blockTransferSource,
  blockTransferDestination,
}: {
  inspection: JpegInspection;
  showBlocks: boolean;
  showMcus: boolean;
  selection: SpatialSelection | null;
  mask: SpatialMask | null;
  brushDraft: readonly ImagePoint[];
  brushRadius: number;
  componentId: number;
  selectedBlock: JpegBlockCoordinate | null;
  blockTransferSource: SpatialSelection | null;
  blockTransferDestination: SpatialSelection | null;
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
  const draftBrushMask: SpatialMask | null =
    brushDraft.length > 0
      ? {
          schemaVersion: 1,
          id: "brush-draft",
          width: inspection.width,
          height: inspection.height,
          shapes: [
            {
              kind: "brush",
              mode: "add",
              radius: brushRadius,
              points: brushDraft,
            },
          ],
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
          className="block-transfer-source-overlay"
          x={blockTransferSource.x}
          y={blockTransferSource.y}
          width={blockTransferSource.width}
          height={blockTransferSource.height}
        />
      )}
      {blockTransferDestination && (
        <rect
          className="block-transfer-target-overlay"
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

function EffectMaskPicker({ mask }: { mask: SpatialMask | null }) {
  return (
    <>
      {mask ? (
        <p className="coefficient-note">Current mask · {describeMask(mask)}</p>
      ) : (
        <p className="coefficient-note">
          Draw a mask with Brush or Select before applying this effect.
        </p>
      )}
    </>
  );
}

function loadInitialUserRecipes(): {
  recipes: readonly ExperimentRecipe[];
  error: string;
} {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return {
      recipes: [],
      error: "Saved experiment recipes are unavailable in this browser.",
    };
  }
  const result = readUserRecipes(storage);
  return result.ok
    ? { recipes: result.value, error: "" }
    : { recipes: [], error: result.error.message };
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
    panelTool,
    isRightPanelCollapsed,
    selectedBlock,
    selectionMask: globalSelectionMask,
  } = workspaceState;
  const activeToolPanel = useRef<HTMLDetailsElement>(null);
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
    "shuffle" | "repeat" | "transfer"
  >("transfer");
  const [blockTransferMode, setBlockTransferMode] =
    useState<BlockTransferMode>("all");
  const [blockTransferAction, setBlockTransferAction] =
    useState<BlockTransferAction>("copy");
  const [blockTransferSource, setBlockTransferSource] =
    useState<JpegBlockRegion | null>(null);
  const [blockTransferDraft, setBlockTransferDraft] =
    useState<JpegBlockRegion | null>(null);
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
  const [initialRecipeState] = useState(loadInitialUserRecipes);
  const [userRecipes, setUserRecipes] = useState(initialRecipeState.recipes);
  const [recipeStorageError, setRecipeStorageError] = useState(
    initialRecipeState.error,
  );
  const [recipeName, setRecipeName] = useState("");
  const [recipeDraft, setRecipeDraft] = useState<
    readonly CoefficientRecipeStep[]
  >([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(
    BUILT_IN_EXPERIMENT_RECIPES[0]?.id ?? "",
  );
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
  const scanCorruptionHistory = useRef(new ScanCorruptionHistory());
  const cleanEncodedBytes = useRef<Uint8Array | null>(null);
  const scanCorruptionController = useRef<AbortController | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const blockTransformGesture = useRef<BlockTransformGesture | null>(null);
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
  const activeMask = globalSelectionMask;
  const brushes = [
    ...BUILT_IN_COEFFICIENT_BRUSHES,
    ...(userBrushes.some((brush) => brush.id === DEFAULT_USER_BRUSH.id)
      ? userBrushes
      : [DEFAULT_USER_BRUSH, ...userBrushes]),
  ];
  const selectedBrush = brushes.find((brush) => brush.id === selectedBrushId);
  const allRecipes = [...BUILT_IN_EXPERIMENT_RECIPES, ...userRecipes];
  const selectedRecipe =
    allRecipes.find((recipe) => recipe.id === selectedRecipeId) ?? null;

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

  useEffect(
    () => () => {
      if (cleanEncodedPreviewUrl) URL.revokeObjectURL(cleanEncodedPreviewUrl);
    },
    [cleanEncodedPreviewUrl],
  );

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

    scanCorruptionController.current?.abort();
    scanCorruptionController.current = null;
    scanCorruptionHistory.current.clear();
    cleanEncodedBytes.current = null;
    operationHistory.current = history.value;
    setHistoryDocument(history.value.snapshot);
    setEditedPreviewUrl(null);
    setEditedBytes(null);
    setEditedPreviewError("");
    setCleanEncodedPreviewUrl(null);
    setCleanEncodedPreviewError("");
    setScanCorruptionReports([]);
    setScanDecodeDiagnostic(null);
    setIsScanCorrupting(false);
    setShowCleanEncoded(false);
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
    setBlockTransferDestination(null);
    blockTransformGesture.current = null;
    setBrushSize(32);
    setMaskGrid("dct");
    setRecipeDraft([]);
    setRecipeName("");
    dispatchWorkspace({ type: "select-mask", maskId: null });
    setSelectedRecipeId(BUILT_IN_EXPERIMENT_RECIPES[0]?.id ?? "");
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
  ): JpegBlockRegion | null {
    if (!document) return null;
    const component = document.inspection.components[componentIndex];
    if (!component) {
      setErrorMessage("The selected JPEG component is invalid.");
      return null;
    }
    const mapped = mapJpegImageRectangleToBlockRegion(
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
    if (region.width * region.height > MAX_BLOCK_TRANSFER_BLOCKS) {
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
    updateHistory(
      applyBlockTransferOperation(history, {
        kind: "block-transfer",
        componentIndex,
        sourceX: source.x,
        sourceY: source.y,
        width: source.width,
        height: source.height,
        destinationX: destination.x,
        destinationY: destination.y,
        mode: blockTransferMode,
        action: blockTransferAction,
      }),
    );
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
      brushPoints.current = [snappedPoint];
      setBrushDraft([snappedPoint]);
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
      switch (transformGesture.kind) {
        case "transfer-source":
          setBlockTransferDraft(
            getBlockRegionFromDrag(transformGesture.start, imagePoint),
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
      const point = snapBrushPoint(imagePoint);
      if (!point) return;
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
          );
          setBlockTransferDraft(null);
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
      const point = imagePoint ? snapBrushPoint(imagePoint) : null;
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
    setRepeatDraft(null);
    setSelection(null);
    const maskEffect =
      tool === "coefficient-glitch" ||
      (tool === "block-transform" && blockTransformMode === "shuffle");
    const preservePanel =
      (tool === "brush" || tool === "select") &&
      (panelTool === "coefficient-glitch" ||
        (panelTool === "block-transform" && blockTransformMode === "shuffle"));
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
    setComponentIndex(brush.componentIndex);
    setCoefficientDomain(brush.step.domain);
    setCoefficientMode(brush.step.mode);
    setFrequencyBand(brush.step.frequencyBand);
    setCoefficientStrength(brush.step.strength);
    setCoefficientSeed(brush.step.seed);
    setErrorMessage("");
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
      componentIndex,
      step: createCurrentRecipeStep(),
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
    setComponentIndex(brush.componentIndex);
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

  function createCurrentRecipeStep(): CoefficientRecipeStep {
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

  function addRecipeDraftStep() {
    const step = createCurrentRecipeStep();
    if (!isCoefficientRecipeStep(step)) {
      setErrorMessage("The current coefficient settings cannot be saved.");
      return;
    }
    if (recipeDraft.length >= MAX_RECIPE_STEPS) {
      setErrorMessage(`A recipe supports at most ${MAX_RECIPE_STEPS} steps.`);
      return;
    }
    setRecipeDraft((current) => [...current, step]);
    setErrorMessage("");
  }

  function saveRecipeDraft() {
    if (!isCoefficientRecipeStep(createCurrentRecipeStep())) {
      setErrorMessage("The current coefficient settings are invalid.");
      return;
    }
    if (recipeDraft.length === 0) {
      setErrorMessage(
        "Add at least one operation step before saving a recipe.",
      );
      return;
    }
    if (
      allRecipes.some(
        (recipe) =>
          recipe.name.trim().toLowerCase() === recipeName.trim().toLowerCase(),
      )
    ) {
      setErrorMessage("A built-in or saved recipe already uses this name.");
      return;
    }
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      setRecipeStorageError(
        "Saved experiment recipes are unavailable in this browser.",
      );
      return;
    }
    const recipe: ExperimentRecipe = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name: recipeName.trim(),
      steps: recipeDraft,
    };
    const saved = saveUserRecipe(storage, userRecipes, recipe);
    if (!saved.ok) {
      setErrorMessage(saved.error.message);
      return;
    }
    setUserRecipes(saved.value);
    setRecipeName("");
    setRecipeDraft([]);
    setSelectedRecipeId(recipe.id);
    setRecipeStorageError("");
    setErrorMessage("");
  }

  function applySelectedRecipe() {
    if (!ensureCoefficientPhase()) return;
    const history = operationHistory.current;
    if (!history || !activeMask || !selectedRecipe) {
      setErrorMessage(
        "Choose a recipe and draw or select a mask before applying the experiment.",
      );
      return;
    }
    updateHistory(
      applyCoefficientRecipeOperation(history, {
        recipe: selectedRecipe,
        mask: activeMask,
        componentIndex,
      }),
    );
  }

  function ensureCoefficientPhase(): boolean {
    if (scanCorruptionHistory.current.activeStages.length === 0) return true;
    setErrorMessage(
      "Undo Scan Corrupt before changing coefficient or DQT operations.",
    );
    return false;
  }

  async function showCorruptedResult(
    bytes: Uint8Array,
    reports: readonly ScanCorruptionReport[],
    diagnostic: ScanDecodeDiagnostic,
    signal: AbortSignal,
  ) {
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
          (history?.canUndo ?? false) || scanCorruptionHistory.current.canUndo,
        canRedo:
          (history?.canRedo ?? false) || scanCorruptionHistory.current.canRedo,
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
  }

  async function replayScanStages(
    stages: readonly ScanCorruptionParameters[],
    commitHistory: () => boolean,
  ) {
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
      setEditedPreviewError(cleanEncodedPreviewError);
      if (cleanEncodedPreviewError) {
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
          (history?.canUndo ?? false) || scanCorruptionHistory.current.canUndo,
        canRedo:
          (history?.canRedo ?? false) || scanCorruptionHistory.current.canRedo,
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
  }

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
      : toolMode === "block-transform" && blockTransformMode !== "shuffle"
        ? null
        : activeMask
    : null;
  const visibleSelection = overlayVisibility.mask
    ? ((isMaskAuthoring ? selection : null) ??
      getRectangleSelection(activeMaskForOverlay))
    : null;
  const activeComponentId =
    document?.inspection.components[componentIndex]?.id ?? -1;
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
      ? getBlockRegionSelection(document.inspection, activeComponentId, {
          ...blockTransferDestination,
          width: blockTransferSource.width,
          height: blockTransferSource.height,
        })
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
              disabled={!historyAvailability.canUndo || isEncoding}
              aria-label="Undo"
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
                    className={`tool-button ${toolMode === tool.id || panelTool === tool.id ? "is-active" : ""}`}
                    key={tool.id}
                    type="button"
                    aria-label={tool.label}
                    aria-pressed={toolMode === tool.id || panelTool === tool.id}
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
                  Drop a JPEG to inspect it, select a region, and apply
                  reversible JPEG effects.
                </span>
              </div>
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
              <div className="image-stage" ref={imageStage}>
                <div
                  className={`preview-image-wrap ${toolMode === "select" ? "is-selecting" : ""} ${toolMode === "brush" ? "is-brushing" : ""} ${toolMode === "inspector" ? "is-inspecting" : ""} ${toolMode === "hand" ? "is-panning" : ""} ${toolMode === "block-transform" && (blockTransformMode === "transfer" || blockTransformMode === "repeat") ? "is-block-transforming" : ""}`}
                  style={{ transform: `scale(${zoom})` }}
                  onPointerDown={onImagePointerDown}
                  onPointerMove={onImagePointerMove}
                  onPointerUp={onImagePointerUp}
                  onPointerCancel={() => {
                    selectionStart.current = null;
                    blockTransformGesture.current = null;
                    setBlockTransferDraft(null);
                    setRepeatDraft(null);
                    setRepeatDestination(null);
                    brushPoints.current = [];
                    panStart.current = null;
                    setBrushDraft([]);
                  }}
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
                    blockTransferSource={blockTransferSourceSelection}
                    blockTransferDestination={blockTransferDestinationSelection}
                  />
                </div>
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
                  {panelTool === "coefficient-glitch" && (
                    <section className="inspector-section selection-panel">
                      <div className="section-kicker">
                        JPEG-DOMAIN EFFECT · DCT
                      </div>
                      <h2>Coefficient experiments</h2>
                      <div className="coefficient-field">
                        <span>Coefficient brushes</span>
                        <div
                          className="brush-picker"
                          role="group"
                          aria-label="Coefficient brushes"
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
                      {brushStorageError && (
                        <p className="coefficient-error" role="alert">
                          {brushStorageError} Saving brushes is unavailable.
                        </p>
                      )}
                      {brushAutoError && (
                        <p className="coefficient-error" role="alert">
                          {brushAutoError}
                        </p>
                      )}
                      <p className="operation-description">
                        These operations edit quantized DCT coefficients, then
                        re-encode a new JPEG. They do not edit decoded pixels or
                        the original JPEG bytes.
                      </p>
                      <p className="coefficient-note">
                        {selectedBrush?.name} ·{" "}
                        {coefficientDomain.toUpperCase()} · {coefficientMode} ·{" "}
                        {frequencyBand}
                        {brushAutoApply[selectedBrushId]
                          ? " · each completed mask is applied immediately"
                          : " · draw a mask, then apply"}
                      </p>
                      <EffectMaskPicker mask={activeMask} />
                      <p className="coefficient-note">
                        Select Brush or Select in the toolbar to edit the mask
                        without closing these effect settings.
                      </p>
                      <label className="coefficient-field">
                        <span>Component</span>
                        <select
                          value={componentIndex}
                          onChange={(event) =>
                            setComponentIndex(Number(event.currentTarget.value))
                          }
                        >
                          {componentIndex >=
                            document.inspection.components.length && (
                            <option value={componentIndex}>
                              Component {componentIndex} unavailable
                            </option>
                          )}
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
                      {componentIndex >=
                        document.inspection.components.length && (
                        <p className="coefficient-error" role="alert">
                          This image has no component {componentIndex}. Choose
                          another brush or component.
                        </p>
                      )}
                      {coefficientMode === "scale" && (
                        <label className="coefficient-field tool-field">
                          <span>Scale multiplier · {coefficientStrength}</span>
                          <input
                            type="range"
                            min="-8"
                            max="8"
                            step="0.1"
                            value={coefficientStrength}
                            onChange={(event) =>
                              setCoefficientStrength(
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      )}
                      <button
                        className="operation-button"
                        type="button"
                        disabled={
                          !activeMask ||
                          isEncoding ||
                          componentIndex >=
                            document.inspection.components.length
                        }
                        onClick={() => applyCoefficientOperation()}
                      >
                        Apply {selectedBrush?.name ?? "brush"}
                      </button>
                      {!BUILT_IN_COEFFICIENT_BRUSHES.some(
                        (brush) => brush.id === selectedBrushId,
                      ) && (
                        <div className="recipe-compose">
                          <p className="coefficient-note">
                            Y/Cb/Cr labels are common ID conventions, not
                            guaranteed color metadata. Component index and
                            sampling factors are authoritative. Select Cb or Cr
                            to experiment on chroma coefficients independently.
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
                          <p className="coefficient-note">
                            Save changes to this brush in this browser. Clearing
                            browser data removes saved brushes.
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
                      )}
                      <details className="recipe-editor">
                        <summary>Multi-step recipes</summary>
                        <div className="section-kicker">EXPERIMENT PRESETS</div>
                        {recipeStorageError && (
                          <p className="coefficient-error" role="alert">
                            {recipeStorageError}
                          </p>
                        )}
                        <p className="coefficient-note">
                          Your recipes are stored locally in this browser and
                          may be lost if its data is cleared.
                        </p>
                        <label className="coefficient-field">
                          <span>Preset or saved sequence</span>
                          <select
                            value={selectedRecipeId}
                            onChange={(event) =>
                              setSelectedRecipeId(event.currentTarget.value)
                            }
                          >
                            <optgroup label="Built-in presets">
                              {BUILT_IN_EXPERIMENT_RECIPES.map((recipe) => (
                                <option key={recipe.id} value={recipe.id}>
                                  {recipe.name} · {recipe.steps.length} step
                                  {recipe.steps.length === 1 ? "" : "s"}
                                </option>
                              ))}
                            </optgroup>
                            {userRecipes.length > 0 && (
                              <optgroup label="Your recipes">
                                {userRecipes.map((recipe) => (
                                  <option key={recipe.id} value={recipe.id}>
                                    {recipe.name} · {recipe.steps.length} step
                                    {recipe.steps.length === 1 ? "" : "s"}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </label>
                        <p className="coefficient-note">
                          {selectedRecipe
                            ? selectedRecipe.steps
                                .map(
                                  ({ mode, domain, frequencyBand }) =>
                                    `${mode} ${domain} · ${frequencyBand}`,
                                )
                                .join(" → ")
                            : "Select a named preset or saved recipe."}
                          . Applying the sequence creates one undoable history
                          entry.
                        </p>
                        <button
                          className="operation-button secondary"
                          type="button"
                          disabled={
                            !activeMask || !selectedRecipe || isEncoding
                          }
                          onClick={applySelectedRecipe}
                        >
                          Apply {selectedRecipe?.name ?? "recipe"}
                        </button>
                        <details className="recipe-compose-disclosure">
                          <summary>
                            Build your own sequence · {recipeDraft.length} steps
                          </summary>
                          <div className="recipe-compose">
                            <p className="coefficient-note">
                              Add the current coefficient settings in order. The
                              selected mask and component are chosen when you
                              apply the saved recipe.
                            </p>
                            <button
                              className="operation-button secondary"
                              type="button"
                              disabled={recipeDraft.length >= MAX_RECIPE_STEPS}
                              onClick={addRecipeDraftStep}
                            >
                              Add current settings
                            </button>
                            <label className="coefficient-field">
                              <span>Save sequence as</span>
                              <input
                                type="text"
                                maxLength={48}
                                value={recipeName}
                                onChange={(event) =>
                                  setRecipeName(event.currentTarget.value)
                                }
                                placeholder="Name this experiment"
                              />
                            </label>
                            <button
                              className="operation-button secondary"
                              type="button"
                              disabled={
                                recipeDraft.length === 0 ||
                                recipeName.trim().length === 0 ||
                                userRecipes.length >= 50
                              }
                              onClick={saveRecipeDraft}
                            >
                              Save recipe
                            </button>
                          </div>
                        </details>
                      </details>
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
                      <label className="coefficient-field">
                        <span>Snap to JPEG grid</span>
                        <select
                          value={maskGrid}
                          onChange={(event) => {
                            if (
                              event.currentTarget.value === "dct" ||
                              event.currentTarget.value === "mcu"
                            ) {
                              setMaskGrid(event.currentTarget.value);
                            }
                          }}
                        >
                          <option value="dct">
                            8×8 DCT blocks · selected component
                          </option>
                          <option value="mcu">
                            MCU · image sampling geometry
                          </option>
                        </select>
                      </label>
                      {maskGrid === "dct" && (
                        <label className="coefficient-field">
                          <span>Component grid</span>
                          <select
                            value={componentIndex}
                            onChange={(event) =>
                              setComponentIndex(
                                Number(event.currentTarget.value),
                              )
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
                                  {component.verticalSampling}
                                </option>
                              ),
                            )}
                          </select>
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
                      <p className="coefficient-note">
                        Brush sample centers and rectangle edges snap to the
                        selected JPEG grid. Pixel, DCT-block, and MCU
                        coordinates remain distinct; component sampling controls
                        the DCT footprint.
                      </p>
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
                      <div className="section-kicker">JPEG COEFFICIENTS</div>
                      <h2>Block Transform</h2>
                      <p className="operation-description">
                        Reorders quantized DCT blocks in one component, then
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
                              if (mode === "shuffle") {
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
                      <label className="coefficient-field">
                        <span>Component</span>
                        <select
                          value={componentIndex}
                          onChange={(event) => {
                            setComponentIndex(
                              Number(event.currentTarget.value),
                            );
                            setBlockTransferSource(null);
                            setBlockTransferDraft(null);
                            setBlockTransferDestination(null);
                            setRepeatSource(null);
                            setRepeatDraft(null);
                            setRepeatDestination(null);
                          }}
                        >
                          {document.inspection.components.map(
                            (component, index) => (
                              <option key={component.id} value={index}>
                                {getComponentControlLabel(
                                  document.inspection,
                                  index,
                                )}{" "}
                                · {component.horizontalSampling}×
                                {component.verticalSampling}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
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
                          <label className="coefficient-field">
                            <span>Coefficient data</span>
                            <select
                              value={blockTransferMode}
                              onChange={(event) => {
                                if (
                                  event.currentTarget.value === "all" ||
                                  event.currentTarget.value === "dc" ||
                                  event.currentTarget.value === "ac"
                                ) {
                                  setBlockTransferMode(
                                    event.currentTarget.value,
                                  );
                                }
                              }}
                            >
                              <option value="all">Whole block · DC + AC</option>
                              <option value="dc">DC only</option>
                              <option value="ac">AC only</option>
                            </select>
                          </label>
                          <label className="coefficient-field">
                            <span>Transfer action</span>
                            <select
                              value={blockTransferAction}
                              onChange={(event) => {
                                if (
                                  event.currentTarget.value === "copy" ||
                                  event.currentTarget.value === "swap"
                                ) {
                                  setBlockTransferAction(
                                    event.currentTarget.value,
                                  );
                                }
                              }}
                            >
                              <option value="copy">Copy to destination</option>
                              <option value="swap">
                                Swap with destination
                              </option>
                            </select>
                          </label>
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
                          <EffectMaskPicker mask={activeMask} />
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
                            disabled={!activeMask || isEncoding}
                            onClick={applyBlockPermutation}
                          >
                            Shuffle blocks in mask
                          </button>
                        </>
                      )}
                    </section>
                  )}
                  {toolMode === "scan-corrupt" && (
                    <section className="inspector-section scan-corrupt-panel">
                      <div className="section-kicker">
                        ENTROPY-CODED SCAN BYTES
                      </div>
                      <h2>Scan Corrupt</h2>
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
                      <label className="coefficient-field tool-field">
                        <span>Corruption mode</span>
                        <select
                          value={scanCorruptionMode}
                          onChange={(event) => {
                            if (
                              event.currentTarget.value === "bit-flip" ||
                              event.currentTarget.value === "byte-replacement"
                            ) {
                              setScanCorruptionMode(event.currentTarget.value);
                            }
                          }}
                        >
                          <option value="bit-flip">Flip one bit</option>
                          <option value="byte-replacement">
                            Replace entropy byte
                          </option>
                        </select>
                      </label>
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
                      <label className="coefficient-field tool-field">
                        <span>Unsigned 32-bit seed</span>
                        <input
                          type="number"
                          min="0"
                          max="4294967295"
                          step="1"
                          value={scanCorruptionSeed}
                          onChange={(event) =>
                            setScanCorruptionSeed(
                              Number(event.currentTarget.value),
                            )
                          }
                        />
                      </label>
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
                      {editedPreviewError && hasScanCorruption && (
                        <p className="scan-corruption-warning" role="alert">
                          {editedPreviewError}
                        </p>
                      )}
                      {hasScanCorruption &&
                        cleanEncodedPreviewError &&
                        !cleanEncodedPreviewUrl && (
                          <p className="scan-corruption-warning" role="status">
                            The clean encoded JPEG could not be previewed:{" "}
                            {cleanEncodedPreviewError}
                          </p>
                        )}
                    </section>
                  )}
                  {toolMode === "quantization" && (
                    <QuantizationMatrixEditor
                      key={document.originalAsset.sha256}
                      quantizationTables={currentQuantizationTables}
                      disabled={isEncoding || hasScanCorruption}
                      onApply={applyQuantizationEdit}
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
                                    {Reflect.get(parameters, "frequencyBand")} ·
                                    seed {Reflect.get(parameters, "seed")}
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
    </main>
  );
}

export default App;
