# Статус

ACCEPTED — независимая приёмка координатором выполнена; итоговые проверки и ограничения ниже.

## Реализовано

- JPEG-сессия использует статическую таблицу kind → controller и за один проход строит замороженный типизированный список команд. Динамическая регистрация, generic apply и JS RNG удалены с JPEG-пути; накопительные spread-массивы при replay больше не создаются.
- Общие механизмы истории сохраняют неизменяемые записи, порядок и Undo/Redo. Для JPEG inputRevision/status существующих записей не переписываются. Лимиты count/work проверяются на итоговом enabled-плане до публикации состояния (включая restore и повторное включение).
- Один parser OperationRecord используется восстановлением истории, сериализацией стека и проектом. Восстановленные записи/параметры заморожены.
- Удалены неиспользуемые сценарии: пользовательские кисти и их миграции; именованные маски и рецепты в JPEG-сессии; хранилище рецептов; setSelection/editParameters; getDctFrequencyBand. Live CoefficientRecipeStep/validator сохранены. Дробный Randomize отвергается и в настройках.
- Проект v2 проверяет параметры отключённых операций и геометрию/лимиты реального исходника. Некорректные данные текущей версии дают INVALID_INPUT, другая оболочка/версия — UNSUPPORTED_FORMAT. V1 не мигрируется.
- Сборка JSON использует явные prefix/base64/suffix, лимит единый в байтах UTF-8. Подсчёт не создаёт проектного размера Uint8Array.
- Единый discriminated Worker-протокол progress/result без бессмысленного ID. Некорректные ответы завершаются обычной ошибкой; отмена, поздние ответы и очистка всех обработчиков проверены.
- Feature detection Uint8Array.toBase64/fromBase64 с fallback; общая проверка алфавита, padding и канонических pad bits.
- Read возвращает source.inspection от того же проверенного буфера; import_worker использует её без повторного Worker/хеша. Save принимает optional source.inspection от исходного импорта, избегая нового разбора на UI.

## Проверки

- `npm run typecheck` — PASS.
- `npx vitest run tests/unit/project-file.test.ts tests/unit/project-worker.test.ts tests/unit/jpeg-document.test.ts tests/unit/operation-history.test.ts tests/unit/experiment-recipes.test.ts tests/unit/dct.test.ts tests/unit/effect-controllers.test.ts tests/unit/effect-operation-mapping.test.ts` — PASS, 8 файлов / 66 тестов.
- `npx prettier --check src/operations/history.ts src/operations/schema.ts src/operations/dct.ts src/application/jpeg-document.ts src/application/experiment-recipes.ts src/project/*.ts tests/unit/project-file.test.ts tests/unit/project-worker.test.ts tests/unit/jpeg-document.test.ts tests/unit/operation-history.test.ts tests/unit/experiment-recipes.test.ts tests/unit/dct.test.ts` — PASS.
- `npx eslint src/operations/history.ts src/operations/schema.ts src/operations/dct.ts src/application/jpeg-document.ts src/application/experiment-recipes.ts src/project tests/unit/project-file.test.ts tests/unit/project-worker.test.ts tests/unit/jpeg-document.test.ts tests/unit/operation-history.test.ts tests/unit/experiment-recipes.test.ts tests/unit/dct.test.ts` — PASS.
- Реальный Apply → Save → Open → restore: enabled+disabled записи, многосегментная кисть, Scan stages, точные исходные байты; чистый JPEG до/после восстановления кодируется реальными controllers/WASM и совпадает побайтно.
- Дополнительные регрессии: 257 active при restore/re-enable не мутируют историю; immutable metadata/reference при add/Undo/Redo; UTF-8 граница с кириллицей; malformed disabled operation; native/fallback Base64; malformed success/error Worker, progress/result ambiguity, late handler и cancel.

## Замер Base64

`node .agent-tasks/history-project/benchmark-base64.cjs` — PASS в headless Chromium.
12 582 914 байт, медианы пяти прогонов: fallback encode 526.1 мс / decode 38.9 мс; native encode 5.6 мс / decode 8.1 мс. Строки и байты совпали; четыре malformed случая отвергнуты. Координатор независимо повторил benchmark успешно.

Память: конечный sample usedJSHeapSize ~188 MB, totalJSHeapSize ~269 MB. Это не изолированный пик; победа по peak memory не заявляется. Production encode остаётся chunked/yielding для отзывчивости, benchmark измеряет собственно преобразование.

## Ограничения

Generic OperationHistory/OperationRegistry оставлены для общих механизмов и изолированных тестов; JPEG не использует generic apply/RNG/registration. Запись OperationRecord сохраняет существующий metadata envelope для совместимости актуального v2; typed JPEG-команды проверены статическим реестром. Нет миграции v1 и расширения поддерживаемых JPEG процессов. Полный npm run check и приёмочные браузерные сценарии выполняет координатор.

## Независимая приёмка координатора

ACCEPTED — просмотрены статический JPEG planner, единый parser оболочки,
проверки переходов до мутации, актуальная схема проекта, UTF-8 лимит и строгий
Worker-протокол. Повторно:
`npx vitest run tests/unit/operation-history.test.ts tests/unit/jpeg-document.test.ts tests/unit/project-file.test.ts tests/unit/project-file-worker.test.ts tests/unit/experiment-recipes.test.ts tests/unit/dct.test.ts`
— 40 PASS (5 существующих suites, отсутствующий отдельный worker suite
покрыт в project-file tests). `git diff --check` — PASS.
`node .agent-tasks/history-project/benchmark-base64.cjs` — PASS, native/fallback
совпадают на 12 MiB, некорректный ввод отклоняется. Независимый замер:
encode 6,1 против 582,2 мс; decode 37 против 90 мс. Peak memory не заявляется.
Chromium: реальный Apply→Save→Open→restore, Undo/Redo и Reset PASS, исходные
байты совпали точно. Общая интеграционная проверка — `../REFACTOR-REVIEW.md`.
