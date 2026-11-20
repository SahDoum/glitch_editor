# Статус

ACCEPTED — независимая приёмка координатором выполнена; итоговые проверки и ограничения ниже.

## Реализовано

- `src/operations/jpeg-glitch.ts`: Repeat проверяет исходный и последний блок за O(1); DQT принимается только при привязке к компоненту, одинаково в приложении и Worker.
- `src/jpeg/block-geometry.ts`: общий расчёт видимой геометрии компонента; явные политики `any-intersection` / `at-least-half`; прямоугольник с порогом 50% обходит только пересекаемые блоки и не создаёт промежуточный coverage-буфер.
- `src/jpeg/codec-controllers/{controller,operations}.ts`: явная политика покрытия вместо boolean; DQT использует общий валидатор напрямую.
- `tests/unit/{masks,block-geometry,jpeg-glitch}.test.ts`: общий лимит 10000 точек для нескольких сегментов, различие двух политик кисти, 2000 сравнений прямоугольника с независимым полным обходом (нечётные размеры и chroma subsampling), 6000 сравнений Repeat с полным проходом, одинаковое отклонение непривязанной DQT.

## Уже было реализовано в e497517

- `createBrushMaskFromStrokes` объединяет сегменты в один валидный brush, не интерполируя пробелы; тест обоих покрытий и копирования маски уже был.
- Дробная сила Randomize уже отвергается общим валидатором приложения/Worker; проверяется `operation-controllers.test.ts`.
- Worker использует общие controllers и общую геометрию, отдельного дублированного валидатора уже нет.

## Проверка

- `npm test -- --run tests/unit/masks.test.ts tests/unit/block-geometry.test.ts tests/unit/jpeg-glitch.test.ts tests/unit/operation-controllers.test.ts` — PASS, 4 файла / 59 тестов.
- `npx eslint src/operations/jpeg-glitch.ts src/jpeg/block-geometry.ts src/jpeg/codec-controllers/controller.ts src/jpeg/codec-controllers/operations.ts tests/unit/masks.test.ts tests/unit/block-geometry.test.ts tests/unit/jpeg-glitch.test.ts` — PASS.
- `npx prettier --check src/operations/jpeg-glitch.ts src/jpeg/block-geometry.ts src/jpeg/codec-controllers/controller.ts src/jpeg/codec-controllers/operations.ts tests/unit/masks.test.ts tests/unit/block-geometry.test.ts tests/unit/jpeg-glitch.test.ts` — PASS.
- `npm run typecheck` — на момент запуска FAIL в соседних незавершённых изменениях (`jpeg-document.ts`, тестовые ImportedJpeg literals, `scan-corruption.test.ts`); ошибок в этой зоне нет. Финальный общий запуск выполняет координатор после интеграции.
- Дополнительные `jpeg-document`, `effect-operation-mapping`, `effect-controllers` запускались во время изменения сессии соседним агентом; временные ошибки переданы владельцу.

## Замер

`node .agent-tasks/masks-validation/benchmark.mjs` (скрипт сохранён в папке задачи; Vite SSR, Node, 1000 измерений после 100 прогревов). JPEG geometry 4000×3000 grayscale; rectangle 320×240. Полный независимый обход: median 0.560 мс; ограниченный обход: median 0.0203 мс. Проверено точное совпадение coverage. Эталон использует один буфер; прежний production дополнительно создавал intersection-буфер. Это замер только TypeScript mapping, не полного JPEG encode или browser frame latency.

## Ограничения

Браузерные жесты/сохранение проекта проверяются соседними задачами. Seeded traversal и C-мост не изменены. Приёмка координатором: не выполнена.

## Схема маски

Сохранена текущая immutable schemaVersion 1 c `shapes` из одного элемента. Генератор brush уже выдаёт одну форму, поэтому сама смена оболочки не исправляет дополнительную ошибку и затронет все контроллеры, project serialization и UI. Совместимость текущих масок сохранена; policy coverage теперь явная без изменения представления.

## Независимая приёмка координатора

ACCEPTED — просмотрены изменения геометрии, DQT, Repeat и регрессионные тесты.
Повторно выполнено: `npx vitest run tests/unit/masks.test.ts tests/unit/block-geometry.test.ts tests/unit/jpeg-glitch.test.ts tests/unit/operation-controllers.test.ts` — 59/59 PASS.
`node .agent-tasks/masks-validation/benchmark.mjs` — PASS; независимый прогон:
0,691 мс full-grid против 0,0207 мс optimized, медиана 1000 итераций.
Это измерение mapping, не общей задержки редактора. Общая интеграционная
проверка всех задач будет зафиксирована в `../REFACTOR-REVIEW.md`.
