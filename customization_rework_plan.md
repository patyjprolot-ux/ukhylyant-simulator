# Переробка кастомізації — план + готові промпти

Узгоджено з рекомендацією ChatGPT Deep Research: **єдина поза персонажа на
всіх локаціях + шарова система накладення** (base body + окремі PNG-предмети
за фіксованими CSS-координатами), замість окремої картинки-пози під кожну
локацію.

## Чому саме так (коротко)

- Зараз 4 з 6 картинок "Кімнати" вже намальовані анфас у правій третині
  кадру — координати гардеробу вже прив'язані САМЕ до цієї пози
  (`#room-cosmetic-hat { top: 6%; left: 77%; }` в `server.js`). Не треба
  вигадувати нову систему — треба доробити 2 картинки, яких бракує (човен,
  бункер), **у тій самій позі**, і виправити невеликі неточності в уже
  підготовлених промптах (нижче).
- Комбінаторний вибух (17 капелюхів × 16 масок × 14 аксесуарів ≈ 3800
  варіантів) робить "генерувати персонажа одразу в одязі" непрацездатним —
  тому саме шари, не готові комбінації.
- Два предмети гардеробу (лід-компрес, рулон туалетного паперу) намальовані
  з чужою головою в кадрі — окремий, короткий фікс промптом без "person/face".

## Технічні деталі, які МАЮТЬ збігатися з кодом

- Контейнер `.room-scene` — **`aspect-ratio: 16/9`**, тому нові картинки
  мають бути 16:9 (не квадрат 1024×1024, як помилково зазначено в старому
  чернетковому розділі `image_prompts_todo.md` — виправлено нижче).
- Персонаж — **права третина кадру**, обличчя до камери, руки опущені.
  Координати оверлею гардеробу зашиті під цю позицію:
  `top:6%/left:77%` (капелюх), `top:26%/left:77%` (маска),
  `top:39%/left:77%` (шия).
- Стиль: flat vector, товстий чорний контур, cel-shaded, темно-вугільний
  фон, малиново-золоте контражурне світло (як і решта гри).

## Фази

**Фаза 1 — 2 картинки, яких бракує (човен, бункер).** Промпти нижче вже
виправлені під 16:9 + праву третину + однакові пропорції фігури. Решта 4
локації (диван/підвал/балкани/закордон) вже готові в цій самій позі — їх
чіпати не треба.

**Фаза 2 — перевірка координат.** Після генерації відкрити "Кімнату" для
Човна і Бункера в грі, вдягнути капелюх/маску/аксесуар, перевірити візуально,
чи лягає рівно (координати `#room-cosmetic-*` вже написані під праву третину
— якщо фігура на новій картинці трохи інакшого розміру/positioн, підправити
`top`/`left` в CSS, не генерувати картинку заново).

**Фаза 3 — заміна в `server.js`.** `roomImg` для локацій 4 (Човен) і 6
(Бункер) зараз відсутні (`img` показується замість). Додати
`roomImg: '/images/room-4-boat.webp'` і `roomImg: '/images/room-6-bunker.webp'`
в масив `LOCATIONS`, конвертувати картинки у WebP, покласти в
`public/images/`. Мінімальний ризик — старі 4 локації не чіпаються.

**Фаза 4 — фікс двох предметів гардеробу.** Промпти нижче — icecube і
toiletpaper без голови/обличчя в кадрі.

**Фаза 5 (пізніше, не зараз) — нові слоти гардеробу** (взуття, одяг тіла).
Тільки після стабілізації поточної системи, окремий захід.

---

## Промпти — Фаза 1 (2 картинки кімнат, 16:9)

**room-4-boat (Човен на Тисі)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
positioned in the right third of the frame, arms relaxed at his sides, same body
proportions and figure size as a standard character reference, plenty of empty space
above his head for hats, standing on the deck of a small wooden boat, foggy river and
dark forest silhouette in the background, moonlight on the water, the rest of the left
two-thirds of the frame is open empty deck space with no other objects drawn (leave it
uncluttered, decor will be added later), flat vector game-icon illustration, thick clean
black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar
to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**room-6-bunker (Президентський бункер)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
positioned in the right third of the frame, arms relaxed at his sides, same body
proportions and figure size as a standard character reference, plenty of empty space
above his head for hats, confidently standing in a plush underground bunker room with a
giant round security door and retro control panels on the left wall, warm lamp lighting,
the rest of the left two-thirds of the frame is open empty floor space with no other
objects drawn (leave it uncluttered, decor will be added later), flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red
and gold rim lighting, slightly absurd comedic tone, no text, no watermark
```

## Промпти — Фаза 4 (виправлені предмети гардеробу)

**Крижаний компрес на голові** (заміна поточної картинки з чужою головою)
```
Icon of an ice pack wrapped in cloth with a simple elastic strap, isolated object only,
no face, no head, no body, no person, just the ice pack and strap floating on a plain
background, flat vector game-icon illustration, thick clean black outlines, cel-shaded
flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark
charcoal background, crimson red and gold rim lighting, slightly absurd comedic tone,
no text, no watermark, centered composition
```

**Рулон замість шапки**
```
Icon of a roll of white toilet paper with a strap that turns it into a wearable hat,
isolated object only, no face, no head, no body, no person, just the toilet paper roll
and strap floating on a plain background, flat vector game-icon illustration, thick clean
black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar
to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark, centered composition
```

## Що робити далі

Згенеруй ці 4 картинки (2 кімнати + 2 предмети), скинь мені у чат — я
конвертую в WebP, підключу `roomImg` для локацій 4/6 у `server.js`, заміню
старі icecube/toiletpaper і перевірю накладення гардеробу в браузері.

---

# v2 — Перехід на full-canvas шари (2026-08-08, СХВАЛЕНО, ще НЕ виконано)

Замінює `top/left`-координати вище. Користувач приніс детальну архітектуру
від ChatGPT — прийнято повністю: кожен предмет гардеробу стає ОКРЕМИМ
transparent PNG на ТОМУ Ж canvas, що й базовий персонаж (не маленька іконка
512×512, як зараз), накладається `position:absolute; inset:0` без
координат. `character.json` (anchor-точки) + `wardrobe.json` (слоти/z-index/
items) + `CharacterRenderer` (JS клас) — повна схема нижче.

**Головна складність (чому це НЕ швидкий фікс):** усі 47 наявних предметів
гардеробу намальовані як окремі іконки під СТАРУ систему — перехід означає
перегенерувати їх ВСІ в новому форматі (той самий canvas, предмет уже точно
позиційований відносно фігури). Це не одноразова генерація "разом" — кожен
новий предмет треба звірити з базовим персонажем візуально (лягає рівно чи
ні) і за потреби перегенерувати з уточненим промптом. Ітеративний процес,
не один захід.

## План виконання (по кроках, окремими сесіями)

**Крок 0 — ВИКОНАНО.** `room-character.webp` = **414×1058 px**. Це
canvas для АБСОЛЮТНО ВСІХ майбутніх предметів гардеробу (той самий розмір,
інакше шари не суміщаються).

**Крок 1 — пілотний предмет (перевірка підходу).** Обрати ОДИН існуючий
капелюх (напр. `hat_cap`), згенерувати його в новому full-canvas форматі
(промпт-шаблон нижче), перевірити в грі, чи лягає на персонажа без жодних
CSS-координат. Тільки після успіху — переходити до масової перегенерації.

**Крок 2 — міграція коду** (можна робити паралельно з кроком 1, ризику для
живих гравців немає, поки стара система працює): додати `character.json`/
`wardrobe.json`, `CharacterRenderer`, нову розмітку/CSS з шарового прикладу
ChatGPT (вище в цьому файлі) — АЛЕ тримати стару `#room-cosmetic-*` систему
робочою паралельно, перемкнутись тільки коли всі картинки перегенеровано
(features flag/якщо є нові picture — новий рендер, інакше старий).

**Крок 3 — масова перегенерація решти 46 предметів** — по одному
слоту/партіями, з перевіркою кожної партії в браузері перед наступною.

**Крок 4 — прибрати стару систему** (`#room-cosmetic-hat/face/neck`
CSS-координати, старі 512×512 іконки) тільки після повної заміни.

## Промпт-шаблон для нового предмета (full-canvas, приклад — капелюх)

Підставити `<CANVAS_W>×<CANVAS_H>` з Кроку 0 і опис самого предмета.

```
Flat vector cel-shaded illustration of [ITEM DESCRIPTION], isolated on a
fully transparent background, canvas size <CANVAS_W>x<CANVAS_H> pixels
(portrait), the item precisely positioned and scaled as if worn by a
standing cartoon character occupying the full height of this canvas
(head near the top ~12% down, standing centered), do not draw any part
of a person/body/face — only the item itself floating at the correct
scale and position for that character, thick clean black outlines,
dark satirical mobile-clicker art style similar to Hamster Kombat,
crimson red and gold rim lighting on the item's edges only, no text,
no watermark
```

**Статус: план схвалено користувачем, виконання не почато.** Наступна
сесія починає з Кроку 0 (дізнатись точні пікселі room-character.webp).
