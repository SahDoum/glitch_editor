# JPEG Glitch Experiment Catalog

This catalog describes what each implemented experiment changes, where it
acts in the JPEG workflow, and what its output means. A decoded browser
preview is not the original JPEG data. The original source bytes remain
unchanged; coefficient and DQT edits produce a newly encoded JPEG.

| Experiment               | JPEG representation changed                                                                    | Stage / effect                                                                                                                           | Re-encodes?                | Decode/export notes                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coefficient Glitch       | Quantized DCT coefficients in selected component blocks                                        | After coefficient decoding and before JPEG encoding; zero, scale, seeded randomize, DC offset, AC sign inversion, or frequency isolation | Yes                        | Uses the current 8-bit baseline sequential Huffman encoder subset. Invalid or extreme parameters may fail visibly. If encoding succeeds but browser preview decoding fails, the encoded result remains exportable. |
| DC steps                 | Selected quantized DC coefficients                                                             | Rounds DC to signed step multiples; AC is unchanged before JPEG encoding                                                               | Yes                        | An experiment for blockwise tonal steps, not a pixel posterization guarantee.                                                                                                                                    |
| Ringing                  | Selected component's quantized AC coefficients in masked blocks                               | Boosts AC at u+v 3, zeros higher AC; DC and lower AC are unchanged                                                                    | Yes                        | An experiment for edge halos, not a guarantee of visible ringing or automatic edge detection.                                                                                                                    |
| AC low-pass              | Selected component's quantized AC coefficients in masked blocks                               | Retains AC with u+v at or below the cutoff, zeros higher AC; DC is unchanged before JPEG encoding                                      | Yes                        | Available in User brush; distinct from the Ringing boost brush.                                                                                                                                                    |
| Engraving                | Selected component's quantized AC coefficients in masked blocks                               | Scales one DCT frequency axis and zeros other AC; DC is unchanged                                                                      | Yes                        | Directional block experiment, not guaranteed engraving or automatic grayscale.                                                                                                                                   |
| Block Duplicate / Repeat | Whole quantized 8×8 DCT blocks within one component                                            | Copies the selected block to validated block-grid destinations before encoding                                                           | Yes                        | Operates on coefficient blocks, not MCU byte ranges or entropy-coded bytes. Destinations outside the component block grid are rejected.                                                                            |
| Block Shuffle            | Whole quantized DCT blocks, including DC and AC, selected by an image-space mask               | Seeded Fisher–Yates permutation within one component before encoding                                                                     | Yes                        | Selected blocks are permuted as a multiset; blocks outside the mask are unchanged. The mask is mapped using component sampling geometry.                                                                           |
| Block Transfer           | Whole, DC-only or AC-only quantized DCT blocks within one component                             | Copies or swaps equal-sized in-bounds regions from coefficient snapshots                                                                 | Yes                        | Changes component blocks, not MCUs or entropy-coded bytes.                                                                                                                                                         |
| Local block shift        | Whole quantized DCT blocks in one component, with an image-pixel destination mask               | Copies a snapshot of source blocks at a signed block-grid offset into selected destinations                                              | Yes                        | Out-of-bounds sources leave destinations unchanged; 262,144 destinations maximum. Choosing Cb/Cr explores chroma misalignment.                                                                                    |
| DQT Matrix Edit          | DQT values, with either coefficient reinterpretation or approximate coefficient requantization | Quantization-table handling before output encoding                                                                                       | Yes                        | Editing a DQT does not restore discarded detail. Reinterpretation and requantization are distinct. Neither operation is a direct marker-only patch.                                                                |
| Coefficient Recipe       | Ordered sequence of quantized coefficient operations and their seeds                           | Replays as one undoable history action, then the resulting coefficient state is encoded                                                  | Yes                        | Recipe steps are validated parameter data, not code. Each applied recipe captures the selected draft or saved-mask snapshot.                                                                                       |
| Save Named Mask          | Spatial mask in image-pixel coordinates                                                        | Document/history control surface; mapped to component blocks only when a consuming effect runs                                           | No                         | Saving a mask alone does not edit JPEG coefficients, pixels, markers, or source bytes.                                                                                                                             |
| Scan Corrupt             | Bounded bytes in the verified entropy-coded scan of the editor's clean encoded result          | Dedicated terminal worker stage after coefficient/DQT replay and normal JPEG encoding                                                    | No after the normal encode | Seeded bit flips or byte replacements; protects marker/restart/stuffing structure and output length. The result can be undecodable but remains exportable; undo restores the clean encoded result.                 |

## Explicitly not implemented here

- Stream transplant.
- Raw-byte corruption or marker-segment rewriting.
- Progressive, arithmetic-coded, or multi-scan JPEG editing.
- MCU byte copying, video-style inter-frame prediction, or pixel-only
  substitutes presented as JPEG-domain glitches.
- Cross-image block transplant and image mixing. These remain deferred and
  require separate compatibility checks and reversible coefficient-domain
  operation designs.

The supported coefficient path remains limited to 8-bit baseline sequential
Huffman JPEG with grayscale or three-component frames and one interleaved
scan. See [the roadmap](./ROADMAP.md), [architecture](./ARCHITECTURE.md), and
[decision records](./DECISIONS.md) for capability and workflow details. The
Scan Corrupt is not a coefficient edit; a failed decode is an expected
experiment and must not discard the encoded experiment. The current controls
allow 1–256 changes per stage, at most eight stages, scan-relative normalized
ranges, and an unsigned 32-bit seed. The worker is limited to the supported
baseline single-scan encoder output, verifies unchanged marker boundaries and
file length, and does not promise that the corrupted scan decodes.

## Milestone 4 — первый воспроизводимый исследовательский проход

Дата: 2026-11-08. Здесь проверены **механизмы**, а не эстетическая ценность
или узнаваемость артефактов. Изображения не оценивались визуально: результаты
на фотографиях и пригодность будущих инструментов требуют вашей проверки.
JPEG-коэффициенты и DQT меняются до перекодирования; Scan Corrupt меняет
энтропийный поток уже закодированного файла. Исходные байты не изменяются.

### Общие условия и воспроизведение

Вход: [`synthetic-color-444.jpg`](../tests/fixtures/synthetic-color-444.jpg),
CC0, SHA-256 `81927288fce7c7ee581a88cb39265628bdc6b23473291945b15a48f363c548fc`.
Размер 16×16, 8-bit baseline sequential Huffman, один interleaved scan без
restart interval. Компоненты с ID 1/2/3 имеют sampling 1×1; первый использует
DQT 0, два остальных DQT 1. В этой JFIF-фикстуре они интерпретируются как
Y/Cb/Cr; для произвольных JPEG это не следует выводить только из ID.
Все четыре блока каждого компонента покрыты маской; операции выполняются
по отдельности от одного оригинала. Индексы компонентов ниже отсчитываются
с нуля.

Нативный исследовательский стенд использует тот же
[`coefficient-bridge.c`](../src/jpeg/codec/coefficient-bridge.c), что и
WebAssembly-сборка приложения, но с локальной библиотекой libjpeg.
Нужны C-компилятор и заголовки/библиотека libjpeg; это не зависимость
приложения и не изменение кодека. Для повторения из корня проекта на этой
машине (при другом расположении заменить путь к библиотеке):

```sh
mkdir -p /tmp/jpeg-glitch-m4
cc -std=c11 -Wall -Wextra -Werror -I/opt/homebrew/opt/jpeg-turbo/include \
  scripts/research/milestone-4.c src/jpeg/codec/coefficient-bridge.c \
  -L/opt/homebrew/opt/jpeg-turbo/lib -ljpeg -lm -o /tmp/jpeg-glitch-m4/research
/tmp/jpeg-glitch-m4/research tests/fixtures/synthetic-color-444.jpg /tmp/jpeg-glitch-m4
```

Каталог результатов должен существовать; стенд перезаписывает шесть JPEG
с именами из таблицы ниже. Сравнить два запуска и проверить декодирование
на macOS можно так:

```sh
mkdir -p /tmp/jpeg-glitch-m4/repeat
/tmp/jpeg-glitch-m4/research tests/fixtures/synthetic-color-444.jpg /tmp/jpeg-glitch-m4/repeat
for name in scale-ac random-ac dc-offset zero-chroma copy-block dqt-reinterpret; do
  cmp "/tmp/jpeg-glitch-m4/$name.jpg" "/tmp/jpeg-glitch-m4/repeat/$name.jpg" || exit 1
  sips -s format png "/tmp/jpeg-glitch-m4/$name.jpg" --out "/tmp/jpeg-glitch-m4/$name.png" || exit 1
done
```

Стенд проверяет ожидаемые значения всех 768 коэффициентов для детерминированных
математических операций, число изменённых коэффициентов для этой фикстуры,
коэффициенты после повторного открытия результата и DQT 1 после редактирования
таблицы. Для случайной операции проверяются диапазон значений и фиксированный
seed; сравнение двух
независимых запусков дополнительно проверяет побайтовую воспроизводимость.
На машине исследования использовался libjpeg-turbo 3.0.4: два запуска
создали одинаковые JPEG-байты. Другая версия encoder может создавать иные
байты при тех же коэффициентах. Для шести выходов дополнительно выполнено
декодирование в PNG через macOS `sips` 316 / ImageIO, без визуального
просмотра. Это не проверка браузерного предпросмотра, а один независимый
декодер.

| Эксперимент / гипотеза | Изменение и параметры | Проверенный результат и SHA-256 выходного JPEG |
| --- | --- | --- |
| AC Scale: усиление частот компонента может изменить цвет/текстуру | Компонент 1, AC All (`u+v` 1–14), scale 2, seed 1 не используется | 35 коэффициентов изменено, DC и другие компоненты сохранены; `scale-ac.jpg` `80286f39d48ef1cac301d6dcfaa513443d960cab8363b4f0993065cc9a46e19e` |
| Randomize: заполнение AC может создать новую текстуру | Компонент 1, AC All, случайные целые −4…4, seed 42 | 225 изменено; остальные коэффициенты сохранены; `random-ac.jpg` `2b73aee08276f1dae5348f620600342a536886bef2e847dabd4fdaad9f736045` |
| DC offset: смещение DC может дать цветовые блоки | Компонент 1, DC, offset +20 | 4 DC изменено, AC и другие компоненты сохранены; `dc-offset.jpg` `bc4548e2707413c071b2749452becd9cd9a14fc6a6c868f43b826093f4c3bdda` |
| Engraving: удаление цветности предположительно даёт монохром, не обязательно гравюру | Компоненты 1 и 2, последовательно обнулены AC All и DC | 71 коэффициент изменён, первый компонент сохранён; `zero-chroma.jpg` `5b6bcf0e6b20f4354f0e75d03b91c7e6e0246b308dba53e44bc764c5d166c32a` |
| Дублирование: перенос блока может повторить фрагмент | Компонент 1, copy всех 64 коэффициентов из блока (0,0) в (1,1) | 13 коэффициентов назначения изменено, остальные блоки сохранены; `copy-block.jpg` `dbf4897f9b20f39fd282445bb12875900ace420add004cbcc982a260450c1789` |
| DQT reinterpret: изменение таблицы может изменить восстановленные цветовые значения | DQT 1, все 64 значения 20, reinterpret | Коэффициенты сохранены, новая DQT проверена после кодирования; `dqt-reinterpret.jpg` `ee1b507e9ce3a5139bc06031626d7e732ef08f691b07cf09f012d93b8fe4c010` |

**Вывод для всех шести:** механика и декодирование этого конкретного набора
проверены; визуальная гипотеза — **REQUIRING_FURTHER_WORK**. Два запуска
сверены побайтово; контрольный хеш оригинала после опыта совпал с указанным.
Для Engraving удаление цветности доказано только на уровне коэффициентов,
но наличие «гравюры» не доказано. Это комбинация уже имеющихся операций,
а не новый алгоритм. Результаты не доказывают работу приложения на всех
фотографиях и в других декодерах; сильные коэффициентные изменения могут
превысить допустимые для encoder ограничения.

### Проверенный эксперимент с entropy-coded scan

Гипотеза: замена байтов может нарушить декодирование без изменения маркеров.
[`scan-corruption.test.ts`](../tests/unit/scan-corruption.test.ts) использует
[`synthetic-color-420.jpg`](../tests/fixtures/synthetic-color-420.jpg):
16×16, 8-bit baseline, компоненты 2×2/1×1/1×1, один scan, без restart,
SHA-256 `1c11334ae289f1ba5a8cbdbe6c5a4e778c209429ed3a3cdc9ed80d9442412c8b`.
На копии исходного scan используются byte replacement, count 8, range 0–1,
seed 0; результат хранится в памяти теста. `djpeg` libjpeg-turbo 3.0.4
завершился с ненулевым кодом для повреждённого файла, а чистый вход
декодировал с кодом 0. Повторный replay после undo/redo дал те же байты.
Ненулевой код может означать предупреждение декодера, а не обязательно
отсутствие изображения. Это тест механизма на фикстуре, а не доказательство
конкретного визуального эффекта или работы UI, который принимает только scan
собственного encoder. Визуальный вывод: **REQUIRING_FURTHER_WORK**.

```sh
JPEG_INDEPENDENT_DECODER="$(command -v djpeg)" npm test -- tests/unit/scan-corruption.test.ts
```

### Что уже доступно в интерфейсе

Для коэффициентных примеров откройте поддерживаемый JPEG, выберите
**Coefficient Glitch (G)**, компонент, затем **Select (M)** и прямоугольник
(для всего изображения `Ctrl/⌘+A`). Отключите автоприменение, если хотите
сначала настроить параметры, и нажмите **Apply**. Применённая операция
попадает в историю; `Undo` возвращает предыдущий результат. Дождитесь
перекодирования и сравните с оригиналом.

| Идея | Доступность и способ |
| --- | --- |
| AC Scale | **Реализовано:** выберите встроенную кисть **AC scale**, Cb или другой компонент и множитель, например 2. Множитель 1 не меняет коэффициенты, 0 обнуляет AC, −1 меняет знаки. На блоках, где выбранные коэффициенты равны нулю, масштабирование их не создаст. Проверка выше подтверждает работу C-механизма на одной фикстуре, но не причину сообщения «Scale coeff — не работает» на фотографии или работу UI для конкретного случая. |
| Randomize AC | **Реализовано:** выберите **User brush**, **Randomize**, **AC All**, диапазон 4, seed 42, компонент Cb, выделение и **Apply**. Для другой картинки или компонента внешний вид может быть иным. |
| DC offset | **Реализовано:** **User brush → DC offset**, значение +20, компонент Cb, выделение и **Apply**. DC — коэффициент среднего уровня блока, не операция над байтами или распространение DC-разностей по scan. |
| Обнуление chroma | **Реализовано как четыре отдельных действия:** на полной маске **User brush → Zero → AC All** и затем **Zero → DC** для Cb; повторить обе операции для Cr. Маска и компонент выбираются для каждой операции. Только на изображениях, где эти компоненты действительно являются chroma, можно ожидать удаление цветности. |
| Copy block / chroma displacement | **Реализовано:** **Block Transform (T) → Drag transfer**, выбрать компонент, все коэффициенты и **Copy**; выделить прямоугольник из одного блока и перетащить в другой блок. Это копирование 8×8 коэффициентного блока одного компонента, не MCU или перенос байтов. В 4:2:0 его покрытие на изображении больше, чем у Y-блока. |
| DQT reinterpret | **Реализовано:** **Quantization Matrix (Q)**, таблица компонента, **Advanced**, вручную задать 64 значения 20, выбрать **Reinterpret**, затем **Apply DQT pattern**. Таблица может быть общей для нескольких компонентов; проверить назначения через Info. |
| Scan corruption | **Реализовано:** **Scan Corrupt (C)** после готовности чистого перекодированного результата; **byte replacement**, count 8, range 0–1, seed 0, применить. Значения и сам clean scan в UI могут отличаться от тестовой фикстуры, поэтому не обещают тот же результат. Изменённые байты не обязаны декодироваться; доступны диагностика, export и undo. |

### Подготовка следующих инструментов — не реализовано и не проверено визуально

- **Селективное усиление AC или DC в цветовых компонентах:** уже есть как
  пользовательская кисть; сначала оценить видимость и практические значения
  на фотографиях, в том числе замечание о Scale. Новый алгоритм пока не
  обоснован.
- **Постеризация, ringing, engraving:** сравнить Zero/Isolate разных полос
  и комбинации компонентов; проверить портрет, архитектуру и текстуру.
  Пока нет доказательства, что эти названия точно описывают результат.
- **Локальный chroma shift:** реализован через Local shift в Block Transform,
  подробности ниже. Новые многоблочные повторы и согласованные MCU-трансформации
  нескольких компонентов не реализованы.
- **DQT patterns:** сравнить reinterpret и requantize с одинаковой матрицей;
  тестировать назначения общих таблиц. DQT-паттерн уже существует, но не
  является редактированием только marker segment.
- **Entropy duplication / desynchronization:** требуется исследование
  границ Huffman-кодов, DC predictor, restart interval, stuffing и поведения
  декодеров. Scan Corrupt не является stream transplant.
- **Marker и произвольные raw bytes:** редактора и проведённого эксперимента
  здесь нет. Подготовка требует отдельного изолированного обратимого
  механизма и согласования интерфейса/архитектуры; их нельзя представлять
  как MCU или коэффициентные операции.

Для каждого следующего исследования сохранять параметры и лицензированные
входы, проверять изменяемое представление и записывать результат декодеров;
фотографии пользователя не включать в репозиторий без отдельного согласия.

### Локальный chroma shift — реализация 2026-11-08

Гипотеза: смещение DCT-блоков одного chroma-компонента относительно
остальных может создать локальные цветовые контуры. **Реализовано в UI:**
Block Transform → Local shift; выбрать Cb или Cr, создать маску назначения,
установить смещение в блоках компонента и нажать Shift blocks in mask.
Например, `(1, 0)` копирует блок слева. Подробные границы и ограничения
описаны в [INTERFACE.md](./INTERFACE.md#8-локальный-сдвиг-блоков-компонента).

Вход: `synthetic-color-444.jpg`, свойства и SHA-256 выше. Нативная проверка
[`block-shift.c`](../tests/native/block-shift.c) применяет offsets `(1,0)`
и `(-1,0)` к компоненту 1 и всей сетке 2×2; отдельно проверяет частичную
маску. Все 64 коэффициента каждого блока сравниваются с ожидаемыми исходными,
включая края и неизменённый компонент 0. Выход `(1,0)` кодирован через
libjpeg-turbo 3.0.4, SHA-256
`9f6b3a23b373d7a2cd2a289e3963051c82bb4fccc8cbeac6ff61ddd0f9e95aff`,
и декодирован в PNG через macOS ImageIO (`sips` 316).
Browser/WASM-проверка на той же фикстуре сравнила все четыре блока с
ожидаемыми значениями, затем закодировала результат; без скриншотов проверены
применение операции, Undo/Redo и доступность экспорта. Unit-тест проверяет
восстановление записанной операции в новой сессии и сохранность исходных
байтов. Это не визуальная оценка, и не проверка на 4:2:0/4:2:2/odd dimensions.
**Заключение:** механизм подтверждён для этой фикстуры; визуальная гипотеза
**REQUIRING_FURTHER_WORK** до проверки фотографий пользователем.

```sh
cc -std=c11 -Wall -Wextra -Werror -I/opt/homebrew/opt/jpeg-turbo/include \
  tests/native/block-shift.c src/jpeg/codec/coefficient-bridge.c \
  -L/opt/homebrew/opt/jpeg-turbo/lib -ljpeg -lm -o /tmp/block-shift-test
/tmp/block-shift-test tests/fixtures/synthetic-color-444.jpg /tmp/block-shift.jpg
sips -s format png /tmp/block-shift.jpg --out /tmp/block-shift.png
```

### DC steps — эксперимент с постеризацией 2026-11-08

Гипотеза: сокращение числа значений квантованного DC в соседних блоках может
дать ступени в плавных областях. **Реализовано в UI:** Coefficient Glitch →
DC steps → компонент Y (или другой) → Brush/Select → выделить область →
установить шаг (по умолчанию 32) → Apply DC steps. Шаг 1 сохраняет DC
в диапазоне ±2047; значения вне диапазона ограничиваются.
Шаг 64 или 128 может давать более заметные результаты. Сохраняются маска,
параметры, история, Undo/Redo и отдельный JPEG-экспорт.

Данные: DC каждого затронутого DCT-блока округляется к ближайшему кратному
шагу 1–512, половины — от нуля; при превышении ±2047 используется ближайшее
допустимое кратное. AC, другие компоненты, таблицы и оригинальные байты не
меняются операцией. Это не округление пикселей и не изменение DQT. Из-за AC
и влияния DQT единый шаг не соответствует одинаковому числу цветовых уровней
на разных изображениях.

Тест: `synthetic-color-444.jpg`, данные фикстуры описаны выше;
[`dc-steps.c`](../tests/native/dc-steps.c) предварительно выставляет DC
`5, -5, 15, -15`, затем шаг 10 на первых трёх блоках. Получены
`10, -10, 20, -15`; AC и другой компонент проверены без изменений. Отдельно
проверены крайние DC ±2047 с шагом 500, шаг 1, неверные параметры и
перечитывание после кодирования. Выход native libjpeg-turbo 3.0.4 имеет
SHA-256 `4159b950efc0133a15da21e5ed8b11a3f91204fea752bfe63e4f29e40930da2b`,
декодирован macOS ImageIO (`sips` 316); выход содержит предварительную
настройку DC и не является результатом одной только операции DC steps на
оригинальной фикстуре. Браузер/WASM на той же фикстуре проверил точные
коэффициенты при шаге 32 и успешное кодирование; UI — применение, Undo/Redo
и доступность экспорта. Скриншоты и визуальные оценки не выполнялись.
**Заключение:** механизм проверен на уровне коэффициентов;
визуальная постеризация — **REQUIRING_FURTHER_WORK** до проверки пользователем
на собственных фотографиях. Другие JPEG sampling modes, градиенты,
фотографии и разные browser decoders в этом опыте не проверены.

```sh
cc -std=c11 -Wall -Wextra -Werror -I/opt/homebrew/opt/jpeg-turbo/include \
  tests/native/dc-steps.c src/jpeg/codec/coefficient-bridge.c \
  -L/opt/homebrew/opt/jpeg-turbo/lib -ljpeg -lm -o /tmp/dc-steps-test
/tmp/dc-steps-test tests/fixtures/synthetic-color-444.jpg /tmp/dc-steps.jpg
sips -s format png /tmp/dc-steps.jpg --out /tmp/dc-steps.png
```

### Ringing / AC low-pass — эксперимент 2026-11-08

Гипотеза: резкий срез высоких частот в 8×8 DCT-блоках может создать
осциллирующие ореолы у контрастных границ. Первоначальная версия кисти
Ringing использовала AC low-pass с cutoff 4. Пользователь сообщил, что не
видит эффекта. Предыдущий режим остаётся доступен в User brush и проектах;
кисть Ringing теперь использует отдельный режим усиления границы полосы.

**Реализовано в UI:** Coefficient Glitch → Ringing → Y → выделить область
на резкой границе через Brush/Select → выбрать усиление (по умолчанию 4×)
→ Apply Ringing. В каждом затронутом блоке одного компонента сохраняются DC
и AC при u+v < 3; AC при u+v = 3 умножаются на 1–8 с округлением половин
от нуля и ограничением ±1023; AC при u+v > 3 обнуляются. Это прямое
редактирование квантованных DCT-коэффициентов, не пиксельный фильтр и не
автоматическое обнаружение границ. Маска, параметры, Undo/Redo и отдельный
JPEG-экспорт сохраняются. Могут появиться размытие и блочность; эффект
зависит от изображения и DQT.

Проверка: [`low-pass.c`](../tests/native/low-pass.c) предварительно
рандомизирует AC компонента Y фикстуры `synthetic-color-444.jpg` с seed 42,
затем применяет cutoff 4 к двум из четырёх блоков: 97 ненулевых AC обнулены,
28 ненулевых AC ниже порога сохранены; проверены все коэффициенты, DC,
невыбранные блоки, другой компонент, границы 1 и 14 и неверные параметры.
Коэффициенты перечитаны после кодирования; результат libjpeg-turbo 3.0.4,
SHA-256 `a6060faf2df9009ef7e45a6224b7aaae05219e66354afc9954442eae017c3ead`,
декодирован macOS ImageIO (`sips`). Он включает подготовительную
рандомизацию и не является примером результата одной операции. Browser/WASM
на тех же подготовленных коэффициентах также проверил удаление 97 AC,
сохранение остальных и кодирование. В UI проверены применение, Undo/Redo и
доступность экспорта. Скриншоты и визуальные оценки не выполнялись.
Проверка усиления: тот же native-тест проверяет маску, частоты, ограничение,
округление, неверные параметры и перечитывание коэффициентов после кодирования;
выход с усилением также декодирован через `sips`.
На двух локальных фотографиях при полной маске Y, с декодированием libjpeg,
среднее абсолютное изменение RGB-канала выросло с 2,44 до 5,98 и с 1,85 до
7,37 из 255 по сравнению с прежним cutoff 4. Доля пикселей с изменением хотя
бы одного канала на 10 или больше выросла с 6,39% до 19,60% и с 2,65% до
25,98%. Это измерение отличия, не доказательство визуального ringing.
Браузер/WASM на первой фотографии проверил применение, Undo/Redo и
доступность экспорта. Скриншоты и визуальные оценки не выполнялись.
**Заключение:** механизм проверен на уровне коэффициентов и количественных
отличий; визуальная гипотеза ringing — **REQUIRING_FURTHER_WORK** до проверки
фотографий пользователем. Разные browser decoders не проверены.

```sh
cc -std=c11 -Wall -Wextra -Werror -I/opt/homebrew/opt/jpeg-turbo/include \
  tests/native/low-pass.c src/jpeg/codec/coefficient-bridge.c \
  -L/opt/homebrew/opt/jpeg-turbo/lib -ljpeg -lm -o /tmp/low-pass-test
/tmp/low-pass-test tests/fixtures/synthetic-color-444.jpg /tmp/low-pass.jpg /tmp/ringing-boost.jpg
sips -s format png /tmp/ringing-boost.jpg --out /tmp/ringing-boost.png
```

### Engraving — направленный DCT-эксперимент 2026-11-08

Удаление цветности само по себе даёт монохром, не обязательно гравюру.
Поэтому новая кисть вместо этого выбирает ось квантованных AC в одном
компоненте: **Horizontal** сохраняет u=0, **Vertical** — v=0. В каждом
затронутом блоке DC остаётся прежним, выбранные AC умножаются на 1–8 с
округлением половин от нуля и ограничением ±1023, прочие AC обнуляются.
Это вычисления над JPEG-коэффициентами, не рисунок штрихов поверх пикселей;
направленность относится к базису внутри блока, не к непрерывным линиям.
Другие компоненты не меняются операцией.

**Реализовано в UI:** Coefficient Glitch → Engraving → Y → выделить область
кистью или Select → выбрать Horizontal/Vertical и усиление (4× по умолчанию)
→ Apply Engraving. При 1× удаление остальных AC всё равно происходит. Можно
экспериментировать с Cb/Cr, Undo/Redo и отдельным JPEG-экспортом; исходные
байты сохраняются. Режимы доступны в User brush. Сохранённые операции со
старыми режимами не меняются; старые версии не распознают новые.

[`engraving.c`](../tests/native/engraving.c) на фикстуре 4:4:4 сначала
рандомизирует AC с seed 42, затем проверяет обе оси при частичной маске,
точное округление, пределы, неизменность DC, других блоков и другого
компонента, отказ неверных параметров и чтение после перекодирования. На
каждом направлении 14 коэффициентов усилены, 112 удалены. Выход содержит
подготовительную рандомизацию и декодирован через macOS ImageIO (`sips`).
Browser/WASM проверил точные коэффициенты обоих направлений на подготовленной
фикстуре, а интерфейс — применение, Undo/Redo и экспорт на фотографии;
вертикальный режим также применён на grayscale и нечётном 4:2:0 JPEG.

На двух локальных фотографиях для полной маски Y и усиления 4× среднее
абсолютное изменение декодированного RGB-канала составило соответственно
11,75 и 13,19 из 255 для Horizontal и 11,22 и 12,79 для Vertical. Это
количественное отличие от исходного декодирования libjpeg, а не доказательство
гравюры или отдельных линий. Скриншоты и визуальные оценки не выполнялись.
**Заключение:** механизм проверен; визуальный эффект — **REQUIRING_FURTHER_WORK**
до оценки пользователем. Другие browser decoders в этом опыте не проверены.

```sh
cc -std=c11 -Wall -Wextra -Werror -I/opt/homebrew/opt/jpeg-turbo/include \
  tests/native/engraving.c src/jpeg/codec/coefficient-bridge.c \
  -L/opt/homebrew/opt/jpeg-turbo/lib -ljpeg -lm -o /tmp/engraving-test
/tmp/engraving-test tests/fixtures/synthetic-color-444.jpg /tmp/engraving.jpg
sips -s format png /tmp/engraving.jpg --out /tmp/engraving.png
```

Следующий приоритет: многоблочные повторы. Они ещё не объявлены реализованными
или визуально подтверждёнными.
