# Статус

ACCEPTED — независимая приёмка координатором выполнена; итоговые проверки и ограничения ниже.

## Реализовано

- Общий `codec-input.ts`: `_malloc`-копия освобождается сразу после `_coefficient_open`, включая ошибку/исключение. Encode и чтение используют один путь.
- Общий `codec-loader.ts` для coefficient и Scan diagnostic Worker: одинаковые versioned URL под BASE_URL, проверка ABI/кучи один раз на загрузке каждой capability, reset сбрасывает обе проверенные promise.
- Реальный smoke собранного coefficient Worker через Chromium CDP pipe без npm-зависимостей: Block Transfer, сравнение 64 коэффициентов после reopen, два идентичных baseline результата и progressive, versioned JS/WASM по publication path. Добавлен в CI после сборки.
- Codec harness использует production `.d.ts`, дублирование ABI удалено.
- Независимый декодер задаётся одинаковым JPEG_INDEPENDENT_DECODER в progressive/Scan тестах. Отсутствие — явный skip; ошибка настроенного декодера — ошибка теста. Дополнительно сравнения реально прошли через независимый Pillow/libjpeg.
- Убраны повторный typecheck из check/CI, лишний maxWorkers, неиспользуемые Logger и его тест. Dependencies не менялись.
- Воспроизводимый `benchmark-codec-reuse.mjs`, результаты и ограничения — `BENCHMARK.md`.

## Проверки

- `npm test -- tests/unit/codec-input.test.ts tests/unit/progressive-jpeg.test.ts tests/unit/scan-corruption.test.ts` — PASS: 60 passed, 7 явных skip без независимого декодера.
- `JPEG_INDEPENDENT_DECODER=/workspace/glitch_editor/work/independent-pillow-decoder.py npm test -- tests/unit/progressive-jpeg.test.ts` — PASS: 38/38. Адаптер — временный scratch, не файл поставки.
- `node scripts/benchmark-codec-reuse.mjs work/codec-benchmark-4000x3000.jpg` — PASS: 22 побайтных parity case; временная копия 5,356,648 байт освобождается до операций; медианы 7 прогонов в BENCHMARK.md.
- `npm run test:worker` — PASS под `/worker-smoke/`.
- `npm run typecheck` — PASS после завершения смежных адаптаций (ранний прогон ловил временный history.remove в чужом тесте, затем исправлено владельцем).
- `npm run build -- --base=/refactor-smoke/` — PASS.
- `npm run test:worker -- --built --base /refactor-smoke/` — PASS.
- `npx eslint scripts/smoke-built-worker.mjs scripts/benchmark-codec-reuse.mjs src/jpeg/codec-loader.ts src/jpeg/codec-input.ts src/jpeg/coefficient.worker.ts tests/unit/codec-input.test.ts tests/helpers/independent-decoder.ts tests/helpers/codec-harness.ts tests/unit/progressive-jpeg.test.ts` — PASS.
- `npx prettier --check scripts/smoke-built-worker.mjs scripts/benchmark-codec-reuse.mjs src/jpeg/codec-loader.ts src/jpeg/codec-input.ts src/jpeg/coefficient.worker.ts tests/unit/codec-input.test.ts tests/helpers/independent-decoder.ts tests/helpers/codec-harness.ts tests/unit/progressive-jpeg.test.ts package.json vite.config.ts .github/workflows/ci.yml` — PASS; loader затем отформатирован повторно после memoization.

## Ограничения и вывод прототипа

- Прямой checkpoint коэффициентов не включён: первый encode=0, повторный encode без reopen=-1, текущий C-мост завершает decompressor, snapshot/restore ABI отсутствует. Факт и следующий эксперимент подробно описаны в BENCHMARK.md. Проверено повторное использование загруженного WASM и одного Worker с reopen, без ложного обещания reuse коэффициентов.
- C prepared indices, touched-block traversal и endpoint Repeat не менялись: Emscripten отсутствует, перепроверить собранный WASM здесь нельзя. Сгенерированные JS/WASM не изменены.
- Размер WASM heap наблюдался, пиковая занятая память будущего checkpoint не измерена. CPU/GC для замеров не изолированы; цифры не служат гарантией ускорения UI.
- В системе нет djpeg; самостоятельные pixel проверки выполнены через Pillow/libjpeg 6.2, тестовая конфигурация djpeg остаётся явной.

## Независимая приёмка координатора

ACCEPTED для реализованных изменений и исследовательского результата.
Просмотрены early-free ownership, общий versioned loader/ABI memoization,
проверки сборки и независимого decoder, код smoke и отчёт BENCHMARK.md.
`npm run benchmark:codec` — PASS: 22 parity case и воспроизводимый отказ
повторного encode без reopen (`0`, затем `-1`).
`npm run test:worker -- --built --base /refactor-smoke/` — PASS: реальный
собранный Worker, два baseline-выхода и progressive, проверка всех 64
коэффициентов перенесённого блока, versioned JS/WASM под base path.
Checkpoint и C-оптимизации остаются отдельной задачей с явным ограничением:
текущий ABI не предоставляет snapshot/restore, emcc в среде отсутствует.
Это принятие прототипа/измерений, не заявление о реализации checkpoint.
Общая интеграционная проверка — `../REFACTOR-REVIEW.md`.
