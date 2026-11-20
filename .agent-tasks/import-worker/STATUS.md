# Статус

ACCEPTED — независимая приёмка координатором выполнена; итоговые проверки и ограничения ниже.

## Реализовано

- `src/application/import-jpeg.ts`: общий путь File и `importVerifiedProjectJpeg(source, signal)` для источника, уже проверенного project reader; повторный SHA-256 и промежуточный File не нужны. Импорт возвращает вычисленные orientation и colorModel; повторные readBytes/разборы в App убирает владелец editor-session.
- `src/application/coefficient-reader.ts`: источник задаётся в `createJpegCoefficientReader(bytes)`, `open()` без аргументов; одна snapshot-копия передаётся Worker с передачей владения. Ошибка Worker, messageerror, malformed response, ошибка postMessage и close переводят клиент в терминальное состояние, завершают все pending, снимают обработчики и завершают Worker ровно один раз. Чтение блока сначала ожидает open. После ошибки нужен новый клиент.
- `src/application/worker-response.ts`: общая проверка Result перед доступом к его веткам; используется также агентом scan-engine.
- Encoder/inspector проверяют malformed responses и снимают обработчики после завершения.
- Тесты: восемь EXIF ориентаций, некорректный EXIF, проверенный хеш проекта без повторного digest, точные исходные байты, отмена pending decode с revoke URL, неправильные ответы, failed open, pending requests, закрытие и пересоздание reader.

## Проверки

- `npm test -- tests/unit/import-jpeg.test.ts tests/unit/coefficient-reader.test.ts tests/unit/preview-orientation.test.ts` — PASS: 3 файла, 71 тест.
- `npx eslint src/application/import-jpeg.ts src/application/coefficient-reader.ts src/application/worker-response.ts tests/unit/import-jpeg.test.ts tests/unit/coefficient-reader.test.ts` — PASS.
- `npm run typecheck` — PASS (последний запуск после согласования остальных изменений).
- Prettier применён к изменённым исходникам и тестам.

## Ограничения и интеграция

`importVerifiedProjectJpeg` — внутренняя доверенная граница: его аргументом должен быть неизменённый `source`, возвращённый reader после проверки SHA-256. Функция намеренно не перепроверяет этот digest. Произвольный JPEG импортируется только через `importJpeg(File)`, где digest рассчитывается. App адаптирует editor-session; source-bound reader пока не имеет производственных потребителей. Браузерный decode проверен подставными Image; реальный браузер проверяет координатор/codec агент.

Приёмка координатором: не выполнена.

## Повторная проверка после замечания координатора

Добавлены прямые regression tests primitive envelope (`string`, `number`, `boolean`, `null`, `undefined`) для encoder и inspector, а также вложенных `[null]` для components/markers/quantizationTables/scans. Guard и подробный валидатор inspection уже были исправлены до первого READY. Все 69 целевых тестов, целевой ESLint и typecheck проходят. READY_FOR_REVIEW.

## Независимая приёмка координатора

ACCEPTED — просмотрены общий импорт, привязка reader к исходнику, terminal
состояние и проверки Worker envelope/Result, включая вложенные inspection поля.
`npx vitest run tests/unit/import-jpeg.test.ts tests/unit/coefficient-reader.test.ts tests/unit/preview-orientation.test.ts`
— 69/69 PASS. `git diff --check` — PASS.
Проверено подключение metadata и verified source в `App.tsx`.
Verified project import остаётся внутренним доверенным входом после проверки
SHA-256 того же source в project Worker; повторный хеш сознательно не считается.
Общая интеграционная проверка — `../REFACTOR-REVIEW.md`.

## Интеграция проверенной inspection проекта

`importVerifiedProjectJpeg` переиспользует `source.inspection`, полученную project Worker из тех же байтов при проверке истории. Входная структура inspection проверяется без повторного JPEG parsing; при отсутствии inspection остаётся безопасный parser fallback. File-путь всегда запускает inspector. Два regression tests проверяют отсутствие повторного Worker/digest для проверенного источника и ровно один parser Worker для File. 71 целевой тест PASS; ESLint PASS; typecheck PASS. READY_FOR_REVIEW.
