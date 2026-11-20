# Независимая приёмка рефакторинга

Базовая ветка: `refactor-interfaces-architecture`, `e497517`.
`git pull --ff-only`: успешно, локальных изменений до начала не было.

## Исходная проверка

`npm run check`: format, lint и typecheck прошли; тесты — 326 passed,
1 failed, 1 skipped. Падение: `effect-gestures.test.ts`, проверка Repeat overlay.
Сборка в этой команде не выполнялась из-за падения теста.

## Карта требований docs/REFACTOR.md

| Раздел | Ответственный | Приёмка |
| --- | --- | --- |
| Идентичность encode-плана, Preview→Apply, disabled reorder | editor-session | ACCEPTED |
| Копии Worker, early WASM free | import-worker + codec-performance | ACCEPTED |
| Долгоживущий Worker, checkpoint, время и память | codec-performance | прототип и измерения приняты; production checkpoint не реализован |
| Типизированная история, статический реестр, активные лимиты | history-project + masks-validation | ACCEPTED |
| Randomize/DQT/Repeat и общая валидация | masks-validation | ACCEPTED |
| Кисть из сегментов, геометрия, явная coverage policy | masks-validation | ACCEPTED |
| Сессия, отмена до публикации, настройки | editor-session | ACCEPTED |
| Жесты, переходы инструмента, overlay, DCT UI | editor-session | ACCEPTED |
| Старые кисти/рецепты/маски и методы | history-project + editor-session | ACCEPTED |
| Импорт байтов проекта, hash, EXIF, color model | import-worker + editor-session | ACCEPTED |
| Source-bound reader, завершение pending запросов | import-worker | ACCEPTED |
| Общий decode/Blob URL и export single-flight | editor-session | ACCEPTED |
| Общий codec loader, version/base path | codec-performance + scan-engine | ACCEPTED |
| Scan stages, Reset→Save, immutable draft | editor-session | ACCEPTED |
| Scan malformed response, один буфер и N+1 разборов | scan-engine | ACCEPTED |
| Project round-trip, UTF-8, protocol, Base64 | history-project | ACCEPTED |
| Built Worker smoke, independent decoder, CI | codec-performance | ACCEPTED |

Готовность субагента не означает принятие. Координатор проверяет изменения,
целевые проверки и финальный общий check. Непокрытые пункты и ограничения
должны быть указаны явно; результаты измерений не подменяются предположениями.

## Итоговые проверки

- `npm run check` — PASS: format, lint, 45 файлов тестов / 431 PASS / 7 explicit
  SKIP без настроенного независимого декодера, typecheck и production build.
- `git diff --check` — PASS.
- `npm run benchmark:codec` — PASS: 22 fixture/mode byte-parity cases и
  воспроизводимый отказ повторного encode без reopen.
- `node .agent-tasks/masks-validation/benchmark.mjs` — PASS; независимая
  медиана mapping 0,691 → 0,0207 мс (не задержка всего редактора).
- `node .agent-tasks/history-project/benchmark-base64.cjs` — PASS, одинаковые
  native/fallback байты и отклонение некорректного padding. Native encode
  6,1 мс против 582,2 мс на 12 MiB в независимом прогоне. Peak не измерен.
- `node .agent-tasks/editor-session/benchmark-overlay.mjs` — PASS:
  16 000 brush samples; hover updates изолированы от App. Частота кисти прежняя.

## Независимые браузерные сценарии

В установленном Chromium через Playwright, без production-зависимостей:

1. Импорт JPEG → Preview → Apply: тот же план кодируется один раз.
2. Undo/Redo → Save → Open → restore; версия проекта 2, original Base64
   побайтно совпадает с исходным файлом.
3. Две выключенные операции: Move earlier запускает ноль кодирований.
4. JPEG Damage Apply/Undo/Redo/Save/Open; Reset → Save не сохраняет старые
   стадии и возвращает пустую историю.
5. Brush с выходом за край и возвратом, Use this area, keyboard Rectangle.
6. Два быстрых клика progressive download: один Worker encode, один download.

Все сценарии PASS, pageerror отсутствуют. Scratch-сценарии и снимки лежат в
игнорируемом work/, не входят в изменения проекта.

## Что осталось исследовательской работой

- Checkpoint коэффициентов и DQT, incremental prefix replay и production
  document-lifetime Worker: текущий `_coefficient_encode` завершает image pools,
  ABI snapshot/restore отсутствует. См. codec-performance/BENCHMARK.md.
- Подготовка DCT индексов/констант и sparse iteration в C, C endpoint Repeat:
  не изменены без доступного emcc, пересборки и проверки parity. TS-проверка
  Repeat уже O(1), rectangle mapping оптимизирован.
- Browser peak memory не измерена; указанные memory values являются оценками
  коэффициентов и размером WASM heap, не измеренным пиком.
- Mask schemaVersion 1 с одним shapes[0] сохранена: разорванные strokes
  представлены одной brush-формой и проверены без изменения внешнего формата.

Новые зависимости, поддержка новых JPEG-процессов, загрузка изображений на
сервер и пересборка сгенерированного codec не добавлялись. Документация
ARCHITECTURE.md и INTERFACE.md приведена к фактическим контрактам.

## Дополнительная проверка независимого декодера

Pillow/libjpeg 6.2 восстановил повреждённый seeded JPEG, выявив ошибочное
предположение прежнего теста об обязательном отказе любого декодера.
Критерий исправлен и принят: чистый JPEG требует успеха, восстановление
повреждённого допускает штатные exit 0/1/2; ошибки запуска и сигналы не скрываются.
Байты повреждённого результата сохраняются независимо от восстановления.

Финальный `JPEG_INDEPENDENT_DECODER="$PWD/work/independent-jpeg-decoder.py" npm run check`
— PASS: 45 suites, 438 тестов PASS, без пропусков; format, lint, typecheck,
production build PASS. Адаптер Pillow — локальный проверочный инструмент,
не новая зависимость приложения. `git diff --check` — PASS.
