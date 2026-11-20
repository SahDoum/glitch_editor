# Статус

ACCEPTED — независимая приёмка координатором выполнена; итоговые проверки и ограничения ниже.

## Реализовано

- `src/application/encoding-plan.ts`: полная идентичность активного плана (параметры, порядок, содержимое масок, seed; ID маски исключён как метаданные), source-session isolation, два byte-result слота с удержанием committed плана, in-flight handoff Preview→Apply и отмена abandoned computation. URL/decode-статус в кэш байтов не входят.
- `src/App.tsx` + `jpeg-result.ts`: Preview, Apply, Auto Apply и history recompute используют один encoding cache. Semantic active-plan identity предотвращает кодирование при перестановке выключенных записей. После Apply сохраняется прежнее состояние Effect applied; следующий пользовательский draft содержит новый committed plan.
- `EditorDocumentSession` владеет coefficient и Scan историями; проверяет terminal phase до мутации, даёт mutate/reset/snapshot и Undo/Redo transitions. Scan prepare создаёт неизменяемый список для Worker и одноразовый commit, защищённый от смены сессии, истории и исходных стадий. Commit вызывается App после успешного Worker/decode, первоначальные стадии проекта восстанавливаются пошагово.
- Общий URL lifecycle для clean/edited/draft: один Blob URL clean frame, освобождение только когда его больше нет среди всех отображаемых ссылок. Больше нет allocation вне error-path в publishCoefficientFrame; JPEG bytes остаются доступны при URL/decode/dimension failure. Удалена staging copy при создании Blob и копия clean bytes при Scan Undo.
- Progressive export имеет синхронный controller guard от повторных кликов и отмену при начале открытия файла. Save берёт единый снимок до await и передаёт проверенную source.inspection.
- Интегрирован `importVerifiedProjectJpeg`; App использует импортированные orientation/colorModel, без повторного EXIF/color-model разбора и без File/byte-copy преобразования проекта.
- Writer coefficient settings применяет тот же валидатор шага, что reader; невалидный Low-pass не перезаписывает последние валидные настройки двух эффектов.
- `CanvasVisualState` + подписанный `CanvasOverlays`: draft/hover/keyboard cursor обновляют только холст через useSyncExternalStore, а не весь App. Проекции committed и draft кисти мемоизированы по маске/геометрии. Current-operation и preview signature не пересчитываются при hover.
- DCT matrix принимает выбранную и доступные типизированные зоны; удалены недостижимый read-only режим, optional onSelect, test-only target branch и строковый разбор `ac:` при подготовке matrix. Подписи/доступность проверены реальным static rendering.
- Удалены test-only named-mask WorkspaceState/getEffectMask/select-mask; текущее выделение остаётся единственной draft маской.
- Исправлен исходно падавший Repeat regression: fixture имеет две колонки, count=2 из source 0 с offset 1 выходит за границу; валидный случай теперь count=1. До изменения тест противоречиво ожидал успех при том же count=2. Продуктовый validator не ослаблен.

## Уже было реализовано в обновлённой ветке

- Один CanvasPointer хранит gesture owner и pointer ID; All/Brush/Select/effect контроллеры, отмена и keyboard/button пути используют общий lifecycle.
- Effect settings уже один снимок на эффект; Scan draft уже object settings и controller.toParameters.
- Открытие проекта уже replay→decode до публикации без pendingProjectStages; Reset не мог воскресить ожидающие стадии из старого REFACTOR анализа.
- Scan controller уже оставался владельцем cancellation до конца decode; общий decodeJpegFrame уже различал байты и browser display failure.

## Проверки

- `npm run typecheck` — PASS после окончательных изменений.
- Scoped `npx prettier --check ...` и `npx eslint ...` по изменённым файлам — PASS (полная команда/вывод у координатора).
- `npx vitest run tests/unit/editor-document-session.test.ts tests/unit/jpeg-result.test.ts tests/unit/encoding-plan.test.ts tests/unit/coefficient-effect-settings.test.ts tests/unit/effect-gestures.test.ts tests/unit/dct-basis-matrix.test.ts tests/unit/coefficient-range-options.test.ts tests/unit/workspace-state.test.ts tests/unit/canvas-tools.test.ts tests/unit/canvas-visual-state.test.ts` — 10 файлов, 66 тестов PASS.
- Независимые browser smoke координатора до последнего visual-store извлечения: import→cached Apply→Undo→Redo→Save→Open→Reset, точные оригинальные байты, disabled reorder без encode — PASS. Повтор после visual-store изменения выполняет координатор.
- `node .agent-tasks/editor-session/benchmark-overlay.mjs`: 16 000 точек, 640×480 4:2:0; пять проекций 8.14/8.17/13.10/6.38/37.99 мс (медиана 8.17 мс). 10 000 hover updates внешнего visual store — 2.63 мс. Это локальный Node microbenchmark, не browser FPS.

## Ограничения и оставшееся

- Частота семплирования/отрисовки кисти не изменена: измерения обосновывают memoization и изоляцию подписчика, но не позволяют выбрать новый debounce/rAF бюджет без browser profiling.
- Независимый browser regression и общий production build/check принимаются координатором после интеграции всех шести задач.
- Долгоживущий WASM Worker/checkpoint находится в отдельной задаче codec-performance; этот cache переиспользует encoded bytes, а не коэффициенты.
- Публичная поддержка JPEG, зависимости и визуальный интерфейс не расширялись.

## Независимая приёмка координатора

ACCEPTED — просмотрены cache/identity, границы сессии и отложенные Scan
commits, URL ownership, export guard, настройки и external canvas store.
`npx vitest run tests/unit/encoding-plan.test.ts tests/unit/jpeg-result.test.ts tests/unit/editor-document-session.test.ts tests/unit/canvas-visual-state.test.ts tests/unit/coefficient-effect-settings.test.ts tests/unit/canvas-tools.test.ts tests/unit/effect-gestures.test.ts tests/unit/workspace-state.test.ts`
— 58/58 PASS.
Независимый Chromium после окончательного visual-store изменения:
- Preview→Apply повторно не кодирует тот же план; Undo/Redo, Save/Open,
  точные оригинальные байты и Reset — PASS.
- Перестановка двух disabled записей — ноль новых encode — PASS.
- JPEG Damage Apply/Undo/Redo/Save/Open и Reset→Save без старых стадий — PASS.
- Разорванный brush, Restore area, клавиатурный Rectangle — PASS.
- Два быстрых клика progressive-download дают один encode и один download — PASS.
Ошибок pageerror в этих сценариях нет. Частота кисти и процесс JPEG не менялись.
Общая интеграционная проверка — `../REFACTOR-REVIEW.md`.
