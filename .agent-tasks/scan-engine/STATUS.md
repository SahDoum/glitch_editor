# Статус

ACCEPTED — независимая приёмка координатором выполнена; итоговые проверки и ограничения ниже.

## Реализовано
- `src/jpeg/scan-corruption.ts`: один приватный рабочий буфер вместо N+1 копий; вход разбирается один раз, затем структура проверяется после каждой стадии (N+1 разборов вместо 2N); RNG и порядок обработки сохранены. Частичные изменения не публикуются при ошибке.
- `src/application/scan-corruption.ts`: общий `isWorkerResult` проверяет оболочку до чтения `.ok`; отдельная проверка reports/diagnostic/bytes, соответствия стадиям и границ. Snapshot отправленных стадий защищён от последующего изменения draft. Любое завершение снимает listeners, обнуляет handlers и завершает Worker один раз.
- `ScanCorruptionHistory.commitStages`: атомарная undoable публикация точного исполнившегося списка стадий, копирование/заморозка параметров; record/replaceLast используют этот путь. API согласован с editor_session.
- `src/jpeg/scan-corruption.worker.ts`: общий versioned codec loader от codec_performance; прямой transfer принадлежащего результату ArrayBuffer без выходной копии.
- `tests/fixtures/scan-corruption-golden.json`: точные bytes и reports старого алгоритма из `e497517:src/jpeg/scan-corruption.ts`; 1–8 стадий на цветной 4:2:0 и grayscale фикстурах. Промежуточный генератор удалён.
- Добавлены client/protocol/transfer/structural-inspection-count tests и тесты атомарной истории; existing stage tests дополнены golden parity и отказом посередине.

## Проверки
- `npx vitest run tests/unit/scan-corruption.test.ts tests/unit/scan-corruption-client.test.ts tests/unit/scan-corruption-worker.test.ts tests/unit/scan-corruption-history.test.ts` — PASS, 51 passed, 1 skipped (независимый декодер не настроен).
- `npx eslint src/application/scan-corruption.ts src/jpeg/scan-corruption.ts src/jpeg/scan-corruption.worker.ts tests/unit/scan-corruption-client.test.ts tests/unit/scan-corruption-worker.test.ts tests/unit/scan-corruption.test.ts tests/unit/scan-corruption-history.test.ts` — PASS.
- Prettier целевых модулей/тестов/fixture — PASS.
- `npx tsc --noEmit` — PASS (финальная проверка этого агента после согласованных правок соседей).

## Ограничения
- Independent JPEG decoder: явный skip при отсутствии JPEG_INDEPENDENT_DECODER; production browser decode не проверялся этим агентом.
- Worker protocol unit-test выполняет реальный worker handler с недоступным diagnostic codec; собранный Worker/base-path smoke и ABI loader проверяются задачей codec-performance.
- Контракт поддерживаемых JPEG-процессов не расширен; структурная проверка не гарантирует декодируемость повреждённого entropy stream.

Приёмка координатором: не выполнена.

## Независимая приёмка координатора

ACCEPTED — просмотрены однобуферный алгоритм, границы копирования и transfer,
парсер ответов и завершение Worker, а также атомарный commit списка стадий.
`npx vitest run tests/unit/scan-corruption.test.ts tests/unit/scan-corruption-client.test.ts tests/unit/scan-corruption-worker.test.ts tests/unit/scan-corruption-history.test.ts tests/unit/scan-decode-diagnostic.test.ts`
— 53 PASS, 1 явный SKIP без независимого декодера.
Включены сравнения с frozen выходами прежнего алгоритма и отказ посередине
без мутации оригинала. Общая интеграционная проверка — `../REFACTOR-REVIEW.md`.

## Замечание независимой приёмки
Координатор запустил независимый декодер через Pillow/libjpeg 6.2: повреждённый seeded JPEG восстановился с кодом 0. Старый тест ошибочно требовал отказа любого декодера, хотя PRODUCT допускает различное восстановление. Исправлен контракт проверки: чистый JPEG обязательно декодируется, повреждённый завершает вызов с documented djpeg/adaptor exit 0/1/2; signal, системная ошибка запуска и другие коды не принимаются. Проверяются неизменность точных повреждённых байтов до/после вызова, неизменность оригинала, Undo и детерминированный Redo.

Замечание принято координатором: diff теста проверен. Recovery 0/1/2
допускается только для повреждённого JPEG; чистый JPEG требует exit 0,
ошибки запуска и signal остаются падениями проверки.
