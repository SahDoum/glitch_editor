# Техническая спецификация рефакторинга: Переход на MVC-модель эффектов (`App.tsx`)

> **Статус реализации.** Рефакторинг выполнен в иной форме, чем эскизы ниже: один реестр `effectId → { controller, view }` (`src/features/effects/registry.ts`) и отдельный реестр меню; View отвечает за иконку, текст, верхнюю панель, горячие клавиши, настройки и историю; Controller хранит ссылку на свой View. Scan Corrupt реализует `execute_corrupt` без `execute`. Hand, Inspector и Info удалены. Актуальное описание — в `docs/ARCHITECTURE.md`; примеры ниже — исторический набросок.

## 1. Цель рефакторинга

Разгрузить монолитный компонент `App.tsx` и устранить разветвленную `if/else` / `switch` логику управления эффектами, перейдя на независимую MVC-архитектуру модулей эффектов (Controller + View + Model). 

Особенностью архитектуры является **декларативность (Вариант Б)**: каждый модуль View декларирует свои метаданные, требования к маске и контекстные контролы верхней панели (`CanvasToolbar`), полностью избавляя верхний уровень от ветвлений.

---

## 2. Архитектурная модель (MVC)

### 2.1. Распределение ответственности

* **Model (Модель):** Существующая реализация бизнес-логики и вычислений (`application/jpeg-document.ts`, `jpeg/*`, `operations/*`). Модель **не переписывается**, а вызывается контроллерами.

* **View (Представление):** Компонент интерфейса и экспортируемые метаданные эффекта (`*.view.tsx`). Отвечает за:
  * Отображение элементов управления правой панели (инпуты, ползунки, радио-кнопки).
  * Метаданные (название, описание, иконки).
  * Декларацию требований к верхней панели холста (`toolbarConfig` и `maskRequirement`).
  * Формирование текстового описания для панели истории (`getHistoryDescription`).

* **Controller (Контроллер):** Класс/объект (`*.controller.ts`), реализующий единый контракт `EffectController`. Отвечает **строго за 3 вещи**:
  1. Указывает на соответствующий `PanelView` компонент.
  2. Предоставляет открытый интерфейс вызова `execute()`.
  3. Перекладывает сырые параметры из View во внутренние вызовы Модели (`jpeg-document.ts`).

---

## 3. Базовые интерфейсы (`src/<папка с интерфейсами>/types.ts`)

```ts
import type { ComponentType } from "react";
import type { JpegInspection } from "../jpeg/inspect";
import type { OperationHistory } from "../operations/history";
import type { JpegEditableState } from "../application/jpeg-document";
import type { ProjectDocument } from "../document/model";
import type { Result } from "../shared/result";
import type { CanvasTool, JpegSelectionGrid } from "../jpeg/block-geometry";

/** Требования эффекта к маске */
export type MaskRequirement = 
  | "none"           // Маска не используется (Scan Corrupt, DQT)
  | "required"       // Маска обязательна (кисть, селект, All)
  | "optional"       // Маска опциональна
  | "selection-only"; // Разрешен только прямоугольный выбор (Select)

/** Декларативная конфигурация контекстной панели холста (Верхний тулбар) */
export interface MaskToolbarConfig {
  readonly allowAll?: boolean;
  readonly allowBrush?: boolean;
  readonly allowSelect?: boolean;
  readonly showSnapGrid?: boolean;
  readonly defaultTool?: CanvasTool;
}

/** Метаданные интерфейса, экспортируемые во View */
export interface EffectViewMetadata {
  readonly label: string;
  readonly category: string;
  readonly description: string;
  readonly iconPaths: readonly string[];
  readonly maskRequirement: MaskRequirement;
  readonly toolbarConfig: MaskToolbarConfig;

  /** Генерация текста для записи в панели истории */
  getHistoryDescription(operation: any): { title: string; subtitle?: string };
}

/** Пропсы, передаваемые во View из редактора */
export interface EffectViewProps {
  readonly isEncoding: boolean;
  readonly activeMask: boolean;
  readonly inspection: JpegInspection;
  readonly componentIndex: number;
  readonly setComponentIndex: (index: number) => void;
  readonly onApply: (parameters: unknown) => void;
  readonly onError: (message: string) => void;
}

/** Общий контракт контроллера эффекта */
export interface EffectController {
  /** Ссылка на React-компонент представления */
  readonly PanelView: ComponentType<EffectViewProps>;

  /**
   * Выполнение математических расчетов и запись операции в историю через Модель.
   * Внутренняя механика работы с jpeg-document скрыта внутри этого метода.
   */
  execute(
    history: OperationHistory<JpegEditableState>,
    rawParameters: unknown,
    inspection: JpegInspection
  ): Result<ProjectDocument<JpegEditableState>>;
}
```

---

## 4. Структура директорий

```text
src/
├── папка с интерфейсами/
│   ├── types.ts                # Базовые интерфейсы (EffectController, EffectViewMetadata и др.)
├── папка подходящая под это/
│   └── effect-registry.ts     # Единый реестр контроллеров и View-метаданных
├── ui/
│   └── canvas-toolbar.tsx     # Универсальный тулбар над холстом (адаптируется по toolbarConfig)
└── features/
    ├── coefficient-glitch/
    │   ├── coefficient-glitch.view.tsx
    │   └── coefficient-glitch.controller.ts
    ├── block-transform/
    │   ├── block-transform.view.tsx
    │   └── block-transform.controller.ts
    ├── quantization/
    │   ├── quantization.view.tsx
    │   └── quantization.controller.ts
    └── scan-corrupt/
        ├── scan-corrupt.view.tsx
        └── scan-corrupt.controller.ts
```

---

## 5. Декларативный Canvas Toolbar (`src/ui/canvas-toolbar.tsx`)

Верхний тулбар полностью лишен связей с конкретными эффектами. Он лишь принимает `toolbarConfig` активного View и рендерит разрешенные контролы:

```tsx
import React from "react";
import type { MaskToolbarConfig } from "../architecture/types";
import type { CanvasTool, JpegSelectionGrid } from "../jpeg/block-geometry";
import { RadioChoiceGroup } from "./tool-controls";

interface CanvasToolbarProps {
  readonly activeTool: CanvasTool;
  readonly config?: MaskToolbarConfig;
  readonly brushSize: number;
  readonly onChangeBrushSize: (size: number) => void;
  readonly maskGrid: JpegSelectionGrid;
  readonly onChangeMaskGrid: (grid: JpegSelectionGrid) => void;
  readonly onSelectTool: (tool: CanvasTool) => void;
}

export function CanvasToolbar({
  activeTool,
  config = { allowAll: true, allowBrush: true, allowSelect: true, showSnapGrid: true },
  brushSize,
  onChangeBrushSize,
  maskGrid,
  onChangeMaskGrid,
  onSelectTool,
}: CanvasToolbarProps) {
  return (
    <div className="preview-toolbar">
      <nav className="preview-toolbar-tools" aria-label="Canvas tools">
        {config.allowAll && (
          <button
            className={`tool-button ${activeTool === "all" ? "is-active" : ""}`}
            type="button"
            onClick={() => onSelectTool("all")}
          >
            All
          </button>
        )}

        {config.allowBrush && (
          <button
            className={`tool-button ${activeTool === "brush" ? "is-active" : ""}`}
            type="button"
            onClick={() => onSelectTool("brush")}
          >
            Brush
          </button>
        )}

        {config.allowSelect && (
          <button
            className={`tool-button ${activeTool === "select" ? "is-active" : ""}`}
            type="button"
            onClick={() => onSelectTool("select")}
          >
            Select
          </button>
        )}

        {(activeTool === "brush" || activeTool === "select") && (
          <div className="canvas-tool-context">
            {activeTool === "brush" && config.allowBrush && (
              <label className="canvas-context-field">
                <span>Brush · {brushSize} px</span>
                <input
                  type="range"
                  min="4"
                  max="256"
                  step="4"
                  value={brushSize}
                  onChange={(e) => onChangeBrushSize(Number(e.target.value))}
                />
              </label>
            )}

            {config.showSnapGrid && (
              <RadioChoiceGroup<JpegSelectionGrid>
                name="canvas-mask-snap-grid"
                legend="Snap"
                value={maskGrid}
                options={[
                  { value: "dct", label: "DCT" },
                  { value: "mcu", label: "MCU" },
                ]}
                onChange={onChangeMaskGrid}
                layout="inline"
                showCheckmark={false}
              />
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
```

---

## 6. Примеры модулей (View + Controller)

### 6.1. Эффект `Scan Corrupt` (`scan-corrupt.view.tsx`)
Не использует инструменты маски (`maskRequirement: "none"`).

```tsx
import React, { useState } from "react";
import type { EffectViewProps, EffectViewMetadata } from "../../architecture/types";
import { RadioChoiceGroup, SeedField } from "../../ui/tool-controls";
import { MAX_SCAN_CORRUPTION_BYTES } from "../../jpeg/scan-corruption";

export const scanCorruptMetadata: EffectViewMetadata = {
  label: "Scan Corrupt",
  category: "Byte Stream",
  description: "Bounded byte-domain experiment applied after the coefficient/DQT encoder.",
  iconPaths: ["M6 4h12v8h3v8H9v-8H6z"],
  maskRequirement: "none",
  toolbarConfig: {
    allowAll: false,
    allowBrush: false,
    allowSelect: false,
    showSnapGrid: false,
    defaultTool: "hand",
  },
  getHistoryDescription(op: any) {
    return {
      title: "Scan Corruption",
      subtitle: op.mode ? `${op.mode} (${op.count} bytes)` : undefined,
    };
  },
};

export function ScanCorruptView({ isEncoding, onApply }: EffectViewProps) {
  const [mode, setMode] = useState<"bit-flip" | "byte-replacement">("bit-flip");
  const [count, setCount] = useState(4);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [seed, setSeed] = useState(1);

  return (
    <section className="inspector-section scan-corrupt-panel">
      <p className="operation-description">{scanCorruptMetadata.description}</p>
      
      <RadioChoiceGroup
        name="scan-corruption-mode"
        legend="Corruption mode"
        value={mode}
        options={[
          { value: "bit-flip", label: "Flip one bit" },
          { value: "byte-replacement", label: "Replace entropy byte" },
        ]}
        onChange={setMode}
        layout="inline"
      />

      <label className="coefficient-field tool-field">
        <span>Changed bytes (1–{MAX_SCAN_CORRUPTION_BYTES})</span>
        <input
          type="number"
          min="1"
          max={MAX_SCAN_CORRUPTION_BYTES}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>

      <SeedField label="Unsigned 32-bit seed" value={seed} onChange={(v) => setSeed(Number(v))} />

      <div className="scan-corrupt-actions">
        <button
          className="operation-button"
          type="button"
          disabled={isEncoding}
          onClick={() => onApply({ mode, count, rangeStart, rangeEnd, seed })}
        >
          Apply scan corruption
        </button>
      </div>
    </section>
  );
}
```

```ts
// src/features/scan-corrupt/scan-corrupt.controller.ts
import type { EffectController } from "../../architecture/types";
import { ScanCorruptView } from "./scan-corrupt.view";

export class ScanCorruptController implements EffectController {
  readonly PanelView = ScanCorruptView;

  execute(history: any, rawParameters: any, _inspection: any) {
    // Внутренняя передача параметров в модель
    return executeScanCorruptionModel(history, rawParameters);
  }
}
```

---

### 6.2. Эффект `Coefficient Glitch` (`coefficient-glitch.view.tsx`)
Требует обязательной маски и включает полный тулбар.

```tsx
import React from "react";
import type { EffectViewProps, EffectViewMetadata } from "../../architecture/types";

export const coefficientGlitchMetadata: EffectViewMetadata = {
  label: "Coefficient Glitch",
  category: "JPEG Domain",
  description: "Apply mathematical operations to quantized DCT coefficients.",
  iconPaths: ["M12 3v4...", "M12 17v4..."],
  maskRequirement: "required",
  toolbarConfig: {
    allowAll: true,
    allowBrush: true,
    allowSelect: true,
    showSnapGrid: true,
    defaultTool: "brush",
  },
  getHistoryDescription(op: any) {
    return {
      title: "Coefficient Glitch",
      subtitle: op.mode ? `${op.mode} (${op.domain})` : undefined,
    };
  },
};

export function CoefficientGlitchView({ isEncoding, activeMask, onApply }: EffectViewProps) {
  // Компонент настроек кисти и параметров коэффициентов
  return (
    <section className="inspector-section">
      {!activeMask && <p className="selection-required">Select an area to apply this effect.</p>}
      {/* Ползунки, режимы, частотные матрицы */}
    </section>
  );
}
```

---

## 7. Единый реестр эффектов (`src/architecture/effect-registry.ts`)

```ts
import type { EffectController, EffectViewMetadata } from "./types";
import { scanCorruptMetadata, ScanCorruptView } from "../features/scan-corrupt/scan-corrupt.view";
import { ScanCorruptController } from "../features/scan-corrupt/scan-corrupt.controller";
import { coefficientGlitchMetadata } from "../features/coefficient-glitch/coefficient-glitch.view";
import { CoefficientGlitchController } from "../features/coefficient-glitch/coefficient-glitch.controller";

export interface RegistryEntry {
  readonly controller: EffectController;
  readonly metadata: EffectViewMetadata;
}

export const EFFECT_REGISTRY: Record<string, RegistryEntry> = {
  "scan-corrupt": {
    controller: new ScanCorruptController(),
    metadata: scanCorruptMetadata,
  },
  "coefficient-glitch": {
    controller: new CoefficientGlitchController(),
    metadata: coefficientGlitchMetadata,
  },
  // ... остальные эффекты
};
```

---

## 8. Итоговый вид `App.tsx` после рефакторинга

Компонент `App.tsx` перестает содержать списки иконок, условия для опций кистей и условный рендеринг панелей:

```tsx
// Получаем активную запись реестра
const activeEntry = EFFECT_REGISTRY[panelTool];
const activeController = activeEntry?.controller;
const activeMetadata = activeEntry?.metadata;

// Автоматический вызов при выборе эффекта в меню
function handleActivateEffect(effectId: string) {
  setPanelTool(effectId);
  const metadata = EFFECT_REGISTRY[effectId]?.metadata;
  if (metadata?.toolbarConfig.defaultTool) {
    dispatchWorkspace({ type: "activate-tool", tool: metadata.toolbarConfig.defaultTool });
  }
}

return (
  <main className="workspace">
    {/* Верхний универсальный тулбар над холстом */}
    <CanvasToolbar
      activeTool={toolMode}
      config={activeMetadata?.toolbarConfig}
      brushSize={brushSize}
      setBrushSize={setBrushSize}
      maskGrid={maskGrid}
      setMaskGrid={setMaskGrid}
      onSelectTool={activateTool}
    />

    {/* Левый каталог эффектов (строит меню прямо из метаданных) */}
    <aside className="effects-catalog">
      {Object.entries(EFFECT_REGISTRY).map(([id, { metadata }]) => (
        <button key={id} onClick={() => handleActivateEffect(id)}>
          {metadata.label}
        </button>
      ))}
    </aside>

    {/* Правая панель настроек через MVC-контроллер */}
    <aside className="side-panel">
      {activeController && (
        <activeController.PanelView
          isEncoding={isEncoding}
          activeMask={!!activeMask}
          inspection={document.inspection}
          componentIndex={componentIndex}
          setComponentIndex={setComponentIndex}
          onError={setErrorMessage}
          onApply={(rawParams) => {
            const result = activeController.execute(
              operationHistory.current!,
              rawParams,
              document.inspection
            );
            if (result.ok) {
              updateHistory(result.value);
            } else {
              setErrorMessage(result.error.message);
            }
          }}
        />
      )}
    </aside>
  </main>
);
```

---

## 9. План выполнения (Roadmap)

1. **Этап 1:** Создать файлы контрактов (`src/папка с интерфейсами/types.ts`) с поддержкой `MaskToolbarConfig`.
2. **Этап 2:** Создать компонент `src/ui/canvas-toolbar.tsx` и заменить им статичный разбор тулбара в `App.tsx`.
3. **Этап 3:** Вынести первый модуль `Scan Corrupt` (`scan-corrupt.view.tsx` + `scan-corrupt.controller.ts`).
4. **Этап 4:** Вынести модуль `Quantization / DQT`.
5. **Этап 5:** Вынести модули `Block Transform` и `Coefficient Glitch`.
6. **Этап 6:** Подключить единый `EFFECT_REGISTRY` к каталогу и удалить оставшийся лишний код из `App.tsx`.
