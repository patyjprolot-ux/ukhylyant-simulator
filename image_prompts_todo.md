# Промпти — тільки те, що ще НЕ намальовано (стиль вшитий у кожен промпт)

Все нижче зараз показується емодзі-заглушками в грі. Стиль більше не винесено
окремо як `[STYLE]` — він повністю вписаний у кінець кожного промпту, тож можна
копіювати рядок як є в генератор.

---

## Ідея на майбутнє: 8 локацій замість 6 (2026-08-08) — ⚠️ ТІЛЬКИ ПРОМПТИ,
## код/баланс/level-гейти ще НЕ чіпали (див. CONTINUE_PROMPT.md)

Запропонована користувачем нова дуга прогресії (замінює поточні 6 рівнів
схрону): 1) Однушка на Троєщині → 2) Бабусин диван → 3) Двір на Закарпатті
→ 4) Хатина в лісі → 5) Палатка під кордоном → 6) СІЗО закордоном →
7) Квартира в Польщі → 8) Легалізація — маєток в Україні.

Промпти нижче — чисті фони (16:9, без персонажа, права третина кадру
порожня під композитинг), той самий підхід, що вже стоїть для 6 поточних
кімнат ("Переробка v2"). Зберігати як `room-1-troyeshchyna.png` ...
`room-8-mansion.png`, потім конвертувати у WebP.

**Статус (2026-08-08): УСІ 8 з 8 картинок згенеровано й збережені в
`public/images/`.** Для рівнів 6, 7, 8 є по 2 варіанти — жоден остаточно
не обрано, вибір лишено на потім:
1. `loc8-1-troyeshchyna.webp`
2. `loc8-2-couch.webp`
3. `loc8-3-zakarpattia.webp`
4. `loc8-4-cabin.webp`
5. `loc8-5-tent.webp`
6. `loc8-6-sizo.webp` (камера зблизька) / `loc8-6-sizo-alt.webp` (коридор із камерами)
7. `loc8-7-poland.webp` (кухня-студія, вечір) / `loc8-7-poland-alt.webp` (світла квартира, переїзд, коробки)
8. `loc8-8-mansion-interior.webp` (вітальня з каміном — композиція з порожньою правою третиною, як у решти 7) /
   `loc8-8-mansion-exterior.webp` (будинок ззовні на заході сонця — гарний, але НЕ підходить під композицію "права третина порожня для персонажа")

Ще НЕ підключено в код — чекає на рішення про фон усього застосунку (див.
CONTINUE_PROMPT.md) і вибір фінальних варіантів для 6/7/8.

**1. Однушка на Троєщині**
```
Wide 16:9 empty interior illustration, a cramped small Soviet-era one-room
apartment with peeling wallpaper, a single small window overlooking grey
high-rise towers in the distance, a bare mattress on the floor, no person,
no character anywhere in the image, completely empty room with nobody in
it, the right third of the frame is left open bare floor space (a
character will be composited in later, do not draw anyone there), flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**2. Бабусин диван** — вже намальовано (`room-1-couch.webp`), новий промпт
не потрібен, просто переставляється на позицію 2 в новій нумерації.

**3. Двір на Закарпатті**
```
Wide 16:9 empty exterior illustration, a rustic Carpathian mountain
homestead courtyard with a wooden fence, a small haystack, and misty green
hills in the background, warm late-afternoon light, no person, no
character anywhere in the image, completely empty yard with nobody in it,
the right third of the frame is left open bare ground space (a character
will be composited in later, do not draw anyone there), flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**4. Хатина в лісі**
```
Wide 16:9 empty interior illustration, a small rough log cabin deep in a
dark forest, visible through a single small window are dense pine trees
at dusk, a simple wood-burning stove in the corner, no person, no
character anywhere in the image, completely empty cabin with nobody in
it, the right third of the frame is left open bare floor space (a
character will be composited in later, do not draw anyone there), flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**5. Палатка під кордоном**
```
Wide 16:9 empty scene illustration, the inside of a small worn camping
tent at night, the open tent flap reveals a dark treeline and a distant
striped border fence under moonlight, a sleeping bag on the ground, no
person, no character anywhere in the image, completely empty tent with
nobody in it, the right third of the frame is left open bare ground space
(a character will be composited in later, do not draw anyone there), flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**6. СІЗО закордоном**
```
Wide 16:9 empty interior illustration, a small bare foreign detention-cell
room with a narrow barred window letting in cold light, a metal bunk bed
frame against the wall, concrete floor, no person, no character anywhere
in the image, completely empty cell with nobody in it, the right third of
the frame is left open bare floor space (a character will be composited
in later, do not draw anyone there), flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic
tone, no text, no watermark
```

**7. Квартира в Польщі**
```
Wide 16:9 empty interior illustration, a modest but tidy modern rented
apartment room with a small IKEA-style bed and a window showing a generic
European city street outside, clean minimal furnishing, no person, no
character anywhere in the image, completely empty room with nobody in it,
the right third of the frame is left open bare floor space (a character
will be composited in later, do not draw anyone there), flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**8. Легалізація — маєток в Україні**
```
Wide 16:9 empty interior illustration, a lavish oversized mansion living
room with a giant chandelier, marble floor, and a huge window overlooking
manicured gardens outside, ironically excessive luxury, no person, no
character anywhere in the image, completely empty room with nobody in it,
the right third of the frame is left open bare floor space (a character
will be composited in later, do not draw anyone there), flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

---

## Карта міста / району (майбутня механіка, поки НЕ реалізована в коді)

**Статус активів (2026-08-07): усі 5 готові й збережені в `public/images/`**
(`map-city-bg.webp`, `map-tower.webp`, `map-hideout.webp`, `map-cache.webp`,
`map-empty-plot.webp`) — прозорий фон на всіх іконках будівель, фон карти
затверджений. Саму grid-механіку (код) ще не реалізовано — це наступний
окремий захід, активи просто готові наперед.

Заздалегідь підготовлені промпти для наступної сесії, коли дійде до самої
grid-механіки. **Концепція узгоджена з користувачем (2026-08-07):** це не
маленька задня ділянка, а справжня КАРТА МІСТА — гібрид:
- Загальний вигляд — вулична сітка кварталів (справжнє відчуття міста).
- На ній — поіменовані точки-орієнтири, ті самі, що вже є як вилазки (ринок,
  склад, руїни, кордон/ліс, ТЦК) — саме через них карта прив'язана до вилазок.
- Між орієнтирами — вільні клітинки кварталів під забудову гравцем (вежа
  спостереження / схованка / тайник).
- **Карта особиста** (кожен гравець бачить і забудовує тільки свою — не
  спільна база клану).

Фон — широкий, під нього ляжуть building-іконки через CSS (так само, як декор
кімнати зараз кладеться на `roomImg`).

**Фон карти міста** — ✅ ЗАТВЕРДЖЕНО (2026-08-07), третя спроба вдала.

⚠️ Перші дві спроби (задня ділянка з органічними клумбами, потім чиста сітка
6×6 без орієнтирів без стилю) не підійшли. Третя спроба вийшла в детальному
ізометричному рендері (об'єм, тіні, глибина блоків) — це ВІДРІЗНЯЄТЬСЯ від
плоского cel-shaded стилю з товстим чорним контуром, яким намальована решта
гри (персонаж/кімнати/іконки). **Рішення користувача: лишити як окремий,
навмисно інший стиль саме екрана карти** — не перегенеровувати під flat-стиль.
Тобто карта міста візуально — власний піджанр у грі, іконки будівель на ній
(нижче) теж намальовані під цей ізометричний деталізований стиль, а не під
загальний flat-стиль решти іконок.

```
Wide top-down illustration of a small stylized city district, laid out as a grid of street
blocks (roughly 6 by 6 blocks) separated by straight intersecting roads, most blocks are
plain empty rectangular plots of bare ground or patchy grass ready for construction (leave
these completely empty, no buildings drawn on them — they will get building icons added
later), but five specific blocks are already occupied by small recognizable landmark
buildings scattered across the grid: a cluttered open-air street market with striped awnings
and crates, a rusty corrugated-metal warehouse with a sliding door, a crumbling bombed-out
ruined building with exposed rebar, a striped border-crossing checkpoint barrier at the edge
of the grid next to a dark treeline, and a grim official government office building with
flagpoles (no real emblems or text on it), each landmark clearly distinct and spaced apart
across the grid, thin roads connecting all blocks, detailed isometric mobile city-builder
game art style with soft volumetric shading and depth (similar to Clash of Clans / Township
style base-building maps), weathered worn-out materials, dark satirical tone, dark charcoal
background, warm ambient lighting, slightly absurd comedic tone, no text, no watermark,
isometric top-down perspective
```

Іконки будівель нижче — під ІЗОМЕТРИЧНИЙ стиль карти (не під flat-стиль решти
гри, див. примітку вище). Ставити квадратно на клітинку кварталу зверху фону.

**🗼 Вежа спостереження** (квадратна, під розмір одного кварталу карти)
```
Isometric icon of a rickety makeshift wooden lookout tower cobbled together from mismatched
planks and scrap corrugated-metal sheets, a small lookout platform on top with a pair of
binoculars hanging off a nail, standing alone on a single empty grid block, detailed isometric
mobile city-builder game art style with soft volumetric shading and depth (similar to Clash
of Clans / Township style base-building buildings), weathered worn-out materials, dark
satirical tone, transparent background, warm ambient lighting, slightly absurd comedic tone,
no text, no watermark, isometric top-down perspective, centered composition
```

**🕳️ Схованка** (квадратна, під розмір одного кварталу карти)
```
Isometric icon of a hidden underground hatch built into a grid plot of ground, a round rusty
metal manhole-style cover slightly ajar with a dark opening beneath, disguised with patches
of grass and loose dirt piled on top, standing alone on a single empty grid block, detailed
isometric mobile city-builder game art style with soft volumetric shading and depth (similar
to Clash of Clans / Township style base-building buildings), weathered worn-out materials,
dark satirical tone, transparent background, warm ambient lighting, slightly absurd comedic
tone, no text, no watermark, isometric top-down perspective, centered composition
```

**📦 Тайник** (квадратна, під розмір одного кварталу карти)
```
Isometric icon of a wooden supply crate half-buried in a shallow dug-out pit within a grid
plot of ground, its lid propped slightly open, a shovel stuck in the dirt beside it, standing
alone on a single empty grid block, detailed isometric mobile city-builder game art style
with soft volumetric shading and depth (similar to Clash of Clans / Township style
base-building buildings), weathered worn-out materials, dark satirical tone, transparent
background, warm ambient lighting, slightly absurd comedic tone, no text, no watermark,
isometric top-down perspective, centered composition
```

**Порожня ділянка** (маркер вільного слота на карті, квадратна)
```
Isometric icon of an empty bare grid plot of dirt marked out with four small wooden stakes
and string at the corners, ready for construction, no structure built yet, matching the same
grid block size and ground texture as the empty plots in the city map background, detailed
isometric mobile city-builder game art style with soft volumetric shading and depth (similar
to Clash of Clans / Township style base-building maps), weathered worn-out materials, dark
satirical tone, transparent background, warm ambient lighting, slightly absurd comedic tone,
no text, no watermark, isometric top-down perspective, centered composition
```

---

## Кімнати (нова механіка, 1600×900, широкий формат) — ПРІОРИТЕТ

Нова система: персонаж стоїть анфас у правій третині кадру в однаковій позі в усіх
6 картинках (щоб капелюх/маска/аксесуар лягали в одні й ті самі координати
незалежно від локації). Ліва частина кадру — сама кімната/локація, залишена
навмисно порожньою (без меблів на картинці) — декор (лампа, постер, телевізор
тощо) додається окремими іконками поверх через CSS, тому меблі малювати НЕ треба,
інакше буде задвоєння. Зберігати як `room-1-couch.png` ... `room-6-bunker.png` в
`public/images/`.

**room-1-couch (Бабусин Диван)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
positioned in the right third of the frame, arms relaxed at his sides, plenty of empty
space above his head, a floral-patterned couch pushed against the left wall of a cluttered
grandma's living room, warm cozy lamp lighting, the rest of the left two-thirds of the
frame is open empty floor and wall space with no other furniture drawn (leave it
uncluttered, decor will be added later), flat vector game-icon illustration, thick clean
black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**room-2-basement (Вологий Підвал)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
positioned in the right third of the frame, arms relaxed at his sides, plenty of empty
space above his head, damp concrete basement with a single bare lightbulb hanging above
and water-stained walls with pipes overhead, the rest of the left two-thirds of the frame
is open empty floor and wall space with no other objects drawn (leave it uncluttered,
decor will be added later), flat vector game-icon illustration, thick clean black outlines,
cel-shaded flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat,
dark charcoal background, crimson red and gold rim lighting, slightly absurd comedic tone,
no text, no watermark
```

**room-3-balkan (Балканська хатинка)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
positioned in the right third of the frame, arms relaxed at his sides, plenty of empty
space above his head, rustic Balkan mountain hut interior with wooden shutters and dried
peppers hanging on the left wall, misty hills visible through a small window, the rest of
the left two-thirds of the frame is open empty floor and wall space with no other objects
drawn (leave it uncluttered, decor will be added later), flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red
and gold rim lighting, slightly absurd comedic tone, no text, no watermark
```

**room-4-boat (Човен на Тисі)**
```
Wide 16:9 illustration, cartoon young man standing full-body on a wooden boat deck, facing
camera directly, positioned in the right third of the frame, arms relaxed at his sides,
plenty of empty space above his head, foggy river and a dark forest silhouette in the
background, moonlight on the water, the rest of the left two-thirds of the frame is open
empty deck space with no other objects drawn (leave it uncluttered, decor will be added
later), flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark
```

**room-5-abroad (Закордон)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
positioned in the right third of the frame, arms relaxed at his sides, plenty of empty
space above his head, a border checkpoint at dawn with a striped barrier gate in the
background, soft golden sunrise lighting, the rest of the left two-thirds of the frame is
open empty ground with no other objects drawn (leave it uncluttered, decor will be added
later), flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark
```

**room-6-bunker (Президентський бункер)**
```
Wide 16:9 illustration, cartoon young man standing full-body, facing camera directly,
confidently positioned in the right third of the frame, arms relaxed at his sides, plenty
of empty space above his head, plush underground bunker room with a giant round security
door and retro control panels on the left wall, warm lamp lighting, the rest of the left
two-thirds of the frame is open empty floor space with no other objects drawn (leave it
uncluttered, decor will be added later), flat vector game-icon illustration, thick clean
black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

---

## Локації (1024×1024)

**Закордон / Гуманітарний коридор** (заміна 🛂, Lvl 5)
```
Cartoon young man walking across a border checkpoint at dawn with a small suitcase, striped
border-crossing barrier gate, flags on poles blurred out (no real national emblems), relieved
but exhausted expression, soft golden sunrise lighting, flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark, centered composition
```

**Президентський бункер** (заміна 🏛️, Lvl 6)
```
Cartoon young man sitting confidently in a plush underground bunker room with a giant round
security door, retro control panels and blinking lights on the walls, ironic luxurious armchair,
warm lamp lighting, playful smug expression, flat vector game-icon illustration, thick clean
black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

---

## Магазин (512×512)

**Термос кави** (заміна ☕)
```
Icon of a metallic thermos flask with steam rising from a small cup lid, warm glow, isolated
game icon, flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark, centered composition
```

**Генератор** (заміна ⚡)
```
Icon of a small portable gasoline generator with a pull-cord and a glowing power indicator,
isolated game icon, flat vector game-icon illustration, thick clean black outlines, cel-shaded
flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark, centered composition
```

---

## Гардероб — головні убори (512×512, 17 шт.)

**Кепка контрабандиста** (заміна 🧢)
```
Icon of a worn flat cap/newsboy cap tilted at a rakish angle, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Вушанка діда** (заміна 🪖)
```
Icon of a fluffy fur ushanka winter hat with untied ear flaps, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Дачний бриль** (заміна 👒)
```
Icon of a floppy straw sun hat with a simple cloth band, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Каска "про всяк випадок"** (заміна ⛑️)
```
Icon of a battered civil-defense style safety helmet with a small dent and a hand-painted
smiley, isolated game icon, flat vector game-icon illustration, thick clean black outlines,
cel-shaded flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark
charcoal background, crimson red and gold rim lighting, slightly absurd comedic tone, no text,
no watermark, centered composition
```

**Циліндр авторитету** (заміна 🎩)
```
Icon of a shiny black top hat with a red ribbon band, slightly oversized comedic proportions,
isolated game icon, flat vector game-icon illustration, thick clean black outlines, cel-shaded
flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark, centered composition
```

**Диплом "поважної причини"** (заміна 🎓)
```
Icon of a graduation mortarboard cap with a dangling gold tassel, isolated game icon, flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Корона Мажора** (заміна 👑)
```
Icon of a gaudy oversized golden crown with cheap-looking plastic gems, comedic exaggerated
proportions, isolated game icon, flat vector game-icon illustration, thick clean black
outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to Hamster
Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd comedic
tone, no text, no watermark, centered composition
```

**Каска з відра** (заміна 🪣)
```
Icon of a metal bucket worn upside-down as a helmet, comedic dents, isolated game icon, flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Кущ-камуфляж** (заміна 🪴)
```
Icon of a small leafy bush/ghillie-style foliage worn as headwear, isolated game icon, flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Гарбузовий шолом** (заміна 🎃)
```
Icon of a carved pumpkin worn upside-down as a helmet, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Капелюх-гриб** (заміна 🍄)
```
Icon of a large red-and-white spotted mushroom cap worn as a hat, isolated game icon, flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Шкарпетка на голові** (заміна 🧦)
```
Icon of a striped sock worn stretched over the head like a cap, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Мішень (для адреналіну)** (заміна 🎯)
```
Icon of a red-and-white target/bullseye worn as a headband, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Рулон замість шапки** (заміна 🧻) — ⚠️ виправлено 2026-08-07: стара версія
малювала голову в кадрі → задвоєння обличчя при накладенні на персонажа.
```
Icon of a roll of white toilet paper with a strap that turns it into a wearable hat,
isolated object only, no face, no head, no body, no person, just the toilet paper roll
and strap floating on a plain background, flat vector game-icon illustration, thick clean
black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar
to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark, centered composition
```

**Капелюх-парасолька** (заміна ☂️)
```
Icon of a tiny open umbrella worn as a hat, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Кокосовий шолом** (заміна 🥥)
```
Icon of half a coconut shell worn as a helmet, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Крижаний компрес на голові** (заміна 🧊) — ⚠️ виправлено 2026-08-07: стара
версія малювала голову в кадрі → задвоєння обличчя при накладенні на персонажа.
```
Icon of an ice pack wrapped in cloth with a simple elastic strap, isolated object only,
no face, no head, no body, no person, just the ice pack and strap floating on a plain
background, flat vector game-icon illustration, thick clean black outlines, cel-shaded
flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark
charcoal background, crimson red and gold rim lighting, slightly absurd comedic tone,
no text, no watermark, centered composition
```

---

## Гардероб — маскування обличчя (512×512, 16 шт.)

**Ботанічні окуляри** (заміна 👓)
```
Icon of round nerdy glasses with thick black frames and a piece of tape on the bridge, isolated
game icon, flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark, centered composition
```

**Клоунський ніс** (заміна 🤡)
```
Icon of a small round red clown nose with an elastic band, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Медична довідка-маска** (заміна 😷)
```
Icon of a plain white disposable medical face mask with ear loops, isolated game icon, flat
vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Чорні окуляри** (заміна 🕶️)
```
Icon of stylish black sunglasses with a subtle reflective glare highlight, isolated game icon,
flat vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Маскування (вуса+окуляри)** (заміна 🥸)
```
Icon of a classic disguise: fake glasses with attached bushy eyebrows and moustache, isolated
game icon, flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark, centered composition
```

**Ніндзя-маскування** (заміна 🥷)
```
Icon of a dark ninja face mask covering nose and mouth, only narrow eye slit visible, isolated
game icon, flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark, centered composition
```

**Маска чорта** (заміна 👹)
```
Icon of a red oni demon mask with horns, isolated game icon, flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark, centered composition
```

**Маска гобліна** (заміна 👺)
```
Icon of a long-nosed tengu/goblin mask, isolated game icon, flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark, centered composition
```

**Маска смерті** (заміна 💀)
```
Icon of a white skull half-mask, isolated game icon, flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

**Театральна маска** (заміна 🎭)
```
Icon of a classic comedy/drama theatre mask, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Захисні окуляри** (заміна 🥽)
```
Icon of protective safety goggles with an elastic strap, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Маска ведмедя** (заміна 🐻)
```
Icon of a cartoon bear-face mask, isolated game icon, flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

**Маска вовка** (заміна 🐺)
```
Icon of a cartoon wolf-face mask, isolated game icon, flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

**Маска лисиці** (заміна 🦊)
```
Icon of a cartoon fox-face mask, isolated game icon, flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

**Маска кабана** (заміна 🐗)
```
Icon of a cartoon wild-boar-face mask with small tusks, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Маска порося** (заміна 🐷)
```
Icon of a cartoon pig-face mask, isolated game icon, flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

---

## Гардероб — аксесуар на шию (512×512, 14 шт.)

**Метелик "для солідності"** (заміна 🎀)
```
Icon of a small formal bow tie, slightly crooked, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Шарф ухилянта** (заміна 🧣)
```
Icon of a long knitted winter scarf wrapped in a loose loop, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Діловий галстук** (заміна 👔)
```
Icon of a plain business necktie with a simple knot, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Медаль "За хоробрість втечі"** (заміна 🎖️)
```
Icon of a comedic military-style medal on a ribbon, exaggerated large size, isolated game icon,
flat vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Золотий ланцюг авторитета** (заміна 🔗)
```
Icon of a thick gold chain necklace, isolated game icon, flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark, centered composition
```

**Чотки на удачу** (заміна 📿)
```
Icon of a prayer-bead bracelet/necklace, isolated game icon, flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark, centered composition
```

**Спортивна медаль** (заміна 🏅)
```
Icon of a sports medal on a striped ribbon, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Золота медаль чемпіона** (заміна 🥇)
```
Icon of a gold first-place medal on a ribbon, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Амулет від зурочення** (заміна 🧿)
```
Icon of a blue nazar evil-eye charm on a cord, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Діамантовий кулон** (заміна 💎)
```
Icon of a sparkling diamond pendant on a chain, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Волонтерська стрічка** (заміна 🎗️)
```
Icon of an awareness ribbon pin, isolated game icon, flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly absurd
comedic tone, no text, no watermark, centered composition
```

**Дзвіночок (як у кота)** (заміна 🔔)
```
Icon of a small bell on a collar strap, isolated game icon, flat vector game-icon illustration,
thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark, centered composition
```

**Навушники на шиї** (заміна 🎧)
```
Icon of over-ear headphones resting around the neck, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Кістка на шнурку** (заміна 🦴)
```
Icon of a cartoon bone pendant on a leather cord, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

---

## Іконка входу в кімнату (512×512)

**Повістка** (заміна 📜, кругла кнопка в шапці)
```
Icon of a folded official-looking paper notice with a red wax-style stamp corner, no real
emblems or text, slightly comedic ominous vibe, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

---

## Декор кімнати (512×512, 7 шт. — килимок вже намальований, не потрібен)

**Лампа затишку** (заміна 💡)
```
Icon of a warm glowing table lamp with a fabric shade, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Постер альпійських краєвидів** (заміна 🖼️)
```
Icon of a small framed wall poster showing a generic mountain landscape, isolated game icon,
flat vector game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark
satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson
red and gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered
composition
```

**Старий телевізор** (заміна 📺)
```
Icon of an old boxy CRT television with antenna, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Вазон з фікусом** (заміна 🪴)
```
Icon of a potted rubber plant in a simple ceramic pot, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Годинник із зозулею** (заміна 🕰️)
```
Icon of a wooden cuckoo clock with a small bird poking out, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Радіоприймач** (заміна 📻)
```
Icon of a retro portable radio with an antenna and dial, isolated game icon, flat vector
game-icon illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, dark charcoal background, crimson red and
gold rim lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

**Тривожна валізка** (заміна 🧳)
```
Icon of a small packed travel suitcase, slightly worn, isolated game icon, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker
art style similar to Hamster Kombat, dark charcoal background, crimson red and gold rim
lighting, slightly absurd comedic tone, no text, no watermark, centered composition
```

---

## Переробка v2 (2026-08-07) — окремий прозорий персонаж + чисті фони, ВСІ 6

⚠️ Замінює підхід нижче ("персонаж вбудований у кожен фон"). Рішення
користувача: замість малювання персонажа в кожній з 6 картинок (ризик
неоднакової пози/розміру між локаціями — саме через це гардероб "не лягав
нормально"), генеруємо ОДИН прозорий PNG персонажа і кладемо його кодом
поверх чистих фонів (без персонажа) на всіх 6 локаціях. Це вимагає
перемалювати і 4 вже готові локації (диван/підвал/балкани/закордон) —
прибрати з них персонажа, лишити тільки інтер'єр.

Після генерації 7 картинок (1 персонаж + 6 фонів): конвертую у WebP,
`server.js` отримає окремий `<img id="room-character">` шар у `.room-scene`,
позиція/розмір гардеробу (`#room-cosmetic-hat/face/neck`) тоді прив'язується
до цього персонажа (однаково для всіх локацій, а не гадається по кожному фону
окремо).

**Персонаж (прозорий фон)**
```
Full-body cartoon young man, standing straight, facing camera directly, arms relaxed at
his sides, neutral slightly worried-but-defiant expression, flat vector game-icon
illustration, thick clean black outlines, cel-shaded flat colors, dark satirical
mobile-clicker art style similar to Hamster Kombat, subtle crimson red and gold rim
lighting along the silhouette edges only, slightly absurd comedic tone, isolated
character on a fully transparent background, no ground shadow, no scenery, no props,
plenty of empty space above his head for hats, full body visible head to feet, no text,
no watermark, centered composition
```

**room-1-couch (Бабусин Диван) — чистий фон**
```
Wide 16:9 empty interior illustration, a floral-patterned couch pushed against the left
wall of a cluttered grandma's living room, warm cozy lamp lighting, no person, no
character anywhere in the image, completely empty room with nobody in it, the right
third of the frame is left open bare floor space (a character will be composited in
later, do not draw anyone there), flat vector game-icon illustration, thick clean black
outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**room-2-basement (Вологий Підвал) — чистий фон**
```
Wide 16:9 empty interior illustration, damp concrete basement with a single bare
lightbulb hanging above and water-stained walls with pipes overhead, no person, no
character anywhere in the image, completely empty room with nobody in it, the right
third of the frame is left open bare floor space (a character will be composited in
later, do not draw anyone there), flat vector game-icon illustration, thick clean black
outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

**room-3-balkan (Балканська хатинка) — чистий фон**
```
Wide 16:9 empty interior illustration, rustic Balkan mountain hut interior with wooden
shutters and dried peppers hanging on the left wall, misty hills visible through a small
window, no person, no character anywhere in the image, completely empty room with nobody
in it, the right third of the frame is left open bare floor space (a character will be
composited in later, do not draw anyone there), flat vector game-icon illustration, thick
clean black outlines, cel-shaded flat colors, dark satirical mobile-clicker art style
similar to Hamster Kombat, dark charcoal background, crimson red and gold rim lighting,
slightly absurd comedic tone, no text, no watermark
```

**room-4-boat (Човен на Тисі) — чистий фон**
```
Wide 16:9 empty scene illustration, the deck of a small wooden boat, foggy river and a
dark forest silhouette in the background, moonlight on the water, no person, no character
anywhere in the image, completely empty deck with nobody on it, the right third of the
frame is left open bare deck space (a character will be composited in later, do not draw
anyone there), flat vector game-icon illustration, thick clean black outlines, cel-shaded
flat colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark
charcoal background, crimson red and gold rim lighting, slightly absurd comedic tone, no
text, no watermark
```

**room-5-abroad (Закордон) — чистий фон**
```
Wide 16:9 empty scene illustration, a border checkpoint at dawn with a striped barrier
gate in the background, soft golden sunrise lighting, no person, no character anywhere in
the image, completely empty ground with nobody there, the right third of the frame is
left open bare ground space (a character will be composited in later, do not draw anyone
there), flat vector game-icon illustration, thick clean black outlines, cel-shaded flat
colors, dark satirical mobile-clicker art style similar to Hamster Kombat, dark charcoal
background, crimson red and gold rim lighting, slightly absurd comedic tone, no text, no
watermark
```

**room-6-bunker (Президентський бункер) — чистий фон**
```
Wide 16:9 empty interior illustration, plush underground bunker room with a giant round
security door and retro control panels on the left wall, warm lamp lighting, no person,
no character anywhere in the image, completely empty room with nobody in it, the right
third of the frame is left open bare floor space (a character will be composited in
later, do not draw anyone there), flat vector game-icon illustration, thick clean black
outlines, cel-shaded flat colors, dark satirical mobile-clicker art style similar to
Hamster Kombat, dark charcoal background, crimson red and gold rim lighting, slightly
absurd comedic tone, no text, no watermark
```

---

## Кімнати анфас, яких бракує — Човен і Бункер (16:9, ПРІОРИТЕТ) — ⚠️ ЗАСТАРІЛО, див. розділ вище

⚠️ **Виправлено (2026-08-07):** старий чернетковий розділ тут мав дві помилки —
"1024×1024" (насправді контейнер `.room-scene` в коді `aspect-ratio:16/9`) і
"centered composition" (насправді координати гардеробу `#room-cosmetic-*`
зашиті під ПРАВУ ТРЕТИНУ кадру, `left:77%`). 4 з 6 локацій (диван/підвал/
балкани/закордон) вже намальовані правильно в цій позі — чіпати їх не треба.
Бракує лише Човна і Бункера. Повний план — `customization_rework_plan.md`
в корені проєкту.

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
