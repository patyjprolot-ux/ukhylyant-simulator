# Підключення адмін-панелі до server.js (2026-08-15)

Нові файли вже готові й перевірені, але **жодного рядка в `server.js` не змінено** —
паралельно там працює інший агент (система Спринтів). Нижче — рівно ті вставки,
які треба зробити, коли файл звільниться. Нічого видаляти чи переписувати не
потрібно: усі чотири вставки тільки додають код.

## Що вже створено

| Файл | Призначення |
| --- | --- |
| `lib/complaints.js` | Сховище скарг/пропозицій: Map у пам'яті + власний `data/complaints.json`, свій інтервал автозбереження, ліміт 2000 символів і 5 повідомлень на гравця за добу. |
| `routes/admin.js` | Усі адмін-ендпоінти під `x-admin-token` + `POST /api/complaint` для гравця + віддача сторінки `GET /admin`. |
| `public/admin.html` | Сама панель: HTML+CSS+JS в одному файлі, без CDN і зовнішніх залежностей. |

**Чому `GET /admin` віддається з `routes/admin.js`, а не через `express.static`:**
у проєкті статика роздається ТІЛЬКИ для `/images`
(`app.use('/images', express.static(path.join(__dirname, 'public/images')))`),
тож `public/admin.html` інакше був би недосяжний. Віддавати його через
`res.sendFile` — це нуль змін у `server.js`. Якщо колись з'явиться повноцінний
`express.static(path.join(__dirname, 'public'))`, цей маршрут можна прибрати.

---

## Вставка 1 — id власника в конфіг

**Куди:** `server.js`, секція «1. НАЛАШТУВАННЯ БОТА ТА СЕРВЕРА»,
одразу **після** рядка:

```js
const WEBHOOK_PATH = '/telegram-webhook';
```

**Що вставити:**

```js
// Telegram id власника: сюди бот пересилає фото від гравців і пінги про нові
// скарги. Навмисно з env, а не константою в коді — id власника це персональні
// дані, і вони не мають лежати в git-історії публічного репозиторію.
// Не заданий — фічі просто мовчки вимикаються, бот працює як раніше.
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '';
```

**Плюс у `.env` і `.env.example`:**

```
# Telegram id власника бота (дізнатись: @userinfobot). Сюди приходять фото від
# гравців і сповіщення про нові скарги. Порожнє значення = фічі вимкнені.
OWNER_TELEGRAM_ID=
```

---

## Вставка 2 — реєстрація роутів адмінки

**Куди:** `server.js`, після **останнього** блоку `require('./routes/...')(app, {...});`
(зараз це `require('./routes/economy')(app, {...});`, а після роботи агента
Спринтів — `require('./routes/sprints')(app, {...});`) і **обов'язково до** рядка-коментаря

```js
// ==========================================
// 8. ФРОНТЕНД (HTML/CSS/JS в одному файлі)
// ==========================================
```

Порядок важливий лише в одному: реєстрація має бути після того, як визначені
`requireTelegramAuth`, `getUser`, `sendPush`, `displayName` — а вони всі вище за
блок роутів, тож у вказаному місці все на місці.

**Що вставити (повний блок, копіюється як є):**

```js
// routes/admin.js (2026-08-15) — адмін-панель власника + книга скарг і пропозицій.
// Авторизація та сама, що в /api/admin/backup і /api/admin/broadcast вище:
// заголовок x-admin-token звіряється з BOT_TOKEN. Розсилка тут НЕ дублюється —
// у модулі лише її попередній перегляд.
const complaints = require('./lib/complaints');
require('./routes/admin')(app, {
    BOT_TOKEN, usersDB, clansDB, requireTelegramAuth, getUser, displayName,
    complaints, LOCATIONS,
    // Необов'язкові: якщо OWNER_TELEGRAM_ID заданий — власнику падає пуш
    // про кожну нову скаргу, а не тільки запис у книзі.
    sendPush, OWNER_TELEGRAM_ID,
});
```

**Перевірка після вставки** (сервер запущено, `<ТОКЕН>` = значення `BOT_TOKEN`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/stats                        # очікується 403
curl -s -H "x-admin-token: <ТОКЕН>" http://localhost:3000/api/admin/stats                             # очікується JSON зі статистикою
```

Далі відкрити `http://localhost:3000/admin` (або `<WEB_APP_URL>/admin` на Render),
вставити токен у поле входу.

---

## Вставка 3 — фото від гравців приходять власнику

**Куди:** `server.js`, секція «6. ЛОГІКА TELEGRAM-БОТА», одразу **після** рядків:

```js
bot.action('ad_consent_yes', (ctx) => answerAdConsent(ctx, true));
bot.action('ad_consent_no', (ctx) => answerAdConsent(ctx, false));
```

і **до** `bot.on('pre_checkout_query', ...)`.

**Що вставити:**

```js
// Гравець може просто кинути боту скріншот бага — це найшвидший спосіб
// показати проблему, і від тестувальників він працює краще за будь-яку форму.
// Фото НЕ зберігається на сервері: воно одразу пересилається власнику
// (forwardMessage лишає оригінал і автора), а в нас лишається тільки запис
// у книзі скарг із підписом.
bot.on('photo', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = getUser(userId, ctx.from.first_name || 'Ухилянт');
    const caption = String(ctx.message.caption || '').trim();

    if (!OWNER_TELEGRAM_ID) {
        // Не мовчимо в порожнечу: гравець має розуміти, що скрін нікуди не пішов.
        return ctx.reply('📷 Дякую, але пересилання скрінів зараз вимкнено. Напиши текстом через «📝 Книга скарг» у грі.');
    }
    if (userId === String(OWNER_TELEGRAM_ID)) return; // не пересилаємо власнику його ж фото

    try {
        // forwardMessage, а не copyMessage: власнику одразу видно, хто автор,
        // і можна відповісти прямо з пересланого повідомлення.
        await bot.telegram.forwardMessage(String(OWNER_TELEGRAM_ID), ctx.chat.id, ctx.message.message_id);
        await bot.telegram.sendMessage(
            String(OWNER_TELEGRAM_ID),
            `📷 Скрін від ${displayName(user)} (id ${userId})` + (caption ? `\nПідпис: ${caption}` : ''),
        );
        // Підпис під фото стає текстом скарги, щоб контекст не загубився в чаті.
        complaints.addComplaint({
            userId, userName: displayName(user),
            text: caption ? `[фото] ${caption}` : '[фото без підпису — дивись переслане повідомлення в Telegram]',
            kind: 'bug',
        });
        await ctx.reply('📷 Скрін пішов розробнику. Дякую — з картинкою баг ловиться вдесятеро швидше.');
    } catch (e) {
        // Власник міг не стартувати бота / заблокувати його — не валимо апдейт.
        console.error('Не вдалося переслати фото власнику:', e.message);
        await ctx.reply('😕 Не вийшло переслати скрін. Спробуй ще раз пізніше або опиши текстом.');
    }
});
```

> Якщо `complaints` уже оголошено у Вставці 2 — повторний `require` тут не потрібен.
> Вставка 3 залежить від Вставки 2 саме через цю змінну.

---

## Вставка 4 — кнопка «📝 Книга скарг» у грі (`buildHtml()`)

Три маленькі шматки всередині `buildHtml()`.

### 4а. Плитка в блоці `.action-tiles`

**Куди:** у `<div class="action-tiles">`, поруч із існуючими плитками
(«Персонаж», «Кімната», «Карта», «Довідка», «Повістки») — найкраще одразу
після плитки «Довідка».

```html
            <button class="action-tile" onclick="openComplaint()"><span class="action-tile-icon">📝</span>Скарги</button>
```

### 4б. Оверлей форми

**Куди:** поруч із іншими оверлеями — наприклад одразу **після** блоку
`<div id="codex-screen" class="hidden"> … </div>`. Розмітка навмисно повторює
`case-card` + `room-close`, щоб виглядати як решта екранів гри.

```html
    <!-- Книга скарг і пропозицій: пряма лінія до розробника під час тестування. -->
    <div id="complaint-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeComplaint()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">📝 Книга скарг і пропозицій</h2>
            <p style="font-size:11px; color:#8fa3b8; text-align:center; margin: 0 0 12px;">
                Знайшов баг або придумав механіку — пиши сюди. Це читає розробник, а не бот.
                До 5 повідомлень на добу. Скрін можна просто кинути боту в чат.
            </p>
            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <button id="complaint-kind-bug" class="secondary" onclick="setComplaintKind('bug')" style="flex:1;">🐞 Баг</button>
                <button id="complaint-kind-idea" class="secondary" onclick="setComplaintKind('idea')" style="flex:1;">💡 Пропозиція</button>
            </div>
            <textarea id="complaint-text" maxlength="2000" placeholder="Опиши, що сталося або що варто додати…"
                style="width:100%; min-height:120px; background:var(--btn); color:var(--text); border:1px solid #26313d; border-radius:8px; padding:10px; font-family:inherit; font-size:14px;"></textarea>
            <button onclick="sendComplaint()" style="margin-top:10px;">Надіслати</button>
        </div>
    </div>
```

### 4в. Мінімальний JS

**Куди:** у `<script>` всередині `buildHtml()`, поруч із `window.openCodex` /
`window.closeCodex` (там уже живуть усі відкривачки оверлеїв).

```js
        // ===== Книга скарг =====
        let complaintKind = 'bug';
        window.setComplaintKind = (k) => {
            complaintKind = k;
            document.getElementById('complaint-kind-bug').classList.toggle('secondary', k !== 'bug');
            document.getElementById('complaint-kind-idea').classList.toggle('secondary', k !== 'idea');
        };
        window.openComplaint = () => {
            setComplaintKind('bug');
            document.getElementById('complaint-screen').classList.remove('hidden');
        };
        window.closeComplaint = () => document.getElementById('complaint-screen').classList.add('hidden');
        window.sendComplaint = async () => {
            const el = document.getElementById('complaint-text');
            const text = el.value.trim();
            if (!text) return tg.showAlert('Напиши хоч щось 🙂');
            try {
                // apiFetch сам додає підписаний initData — сервер бере id звідти,
                // тому підробити автора скарги неможливо.
                const res = await apiFetch('/api/complaint', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text, kind: complaintKind }),
                });
                const data = await res.json();
                tg.showAlert(data.message || (data.success ? 'Надіслано' : 'Не вийшло'));
                if (data.success) { el.value = ''; closeComplaint(); }
            } catch (e) {
                tg.showAlert('Не вдалося надіслати. Перевір інтернет.');
            }
        };
```

---

## Довідка: усі ендпоінти модуля

| Метод і шлях | Авторизація | Що робить |
| --- | --- | --- |
| `GET /admin` | немає (сторінка без секретів) | Віддає `public/admin.html`. |
| `GET /api/admin/stats` | `x-admin-token` | Гравці, клани, сумарний баланс, активність 24 год / 7 днів, VIP, згода на рекламу, розподіл по рівнях схрону, кількість нових скарг. |
| `GET /api/admin/players` | `x-admin-token` | Список гравців. Параметри: `page`, `limit` (≤200), `sort` (`balance`\|`level`\|`playerLevel`\|`lastSeenAt`\|`ukhyr`\|`name`), `dir` (`asc`\|`desc`), `q` (пошук за іменем/ніком/id). |
| `GET /api/admin/complaints` | `x-admin-token` | Книга скарг. Параметри: `status` (`new`\|`read`\|`done`), `kind` (`bug`\|`idea`), `limit`. |
| `POST /api/admin/complaints/:id/status` | `x-admin-token` | Тіло `{ "status": "read" }`. Невідомий статус → 400. |
| `DELETE /api/admin/complaints/:id` | `x-admin-token` | Видаляє запис. Немає такого → 404. |
| `POST /api/admin/broadcast-preview` | `x-admin-token` | Тіло `{ "message": "…" }`. Нічого не надсилає: повертає кількість отримувачів, активних за 7 днів, перші 3 id та довжину тексту. |
| `POST /api/complaint` | `requireTelegramAuth` | Гравець надсилає скаргу/пропозицію: `{ "text": "…", "kind": "bug"\|"idea" }`. |

Сама розсилка лишається там, де й була: `POST /api/admin/broadcast` у `server.js`.
Сторінка адмінки викликає саме її — після попереднього перегляду й двох підтверджень
(діалог + введення слова «РОЗІСЛАТИ» руками).

## Обмеження, про які варто пам'ятати

- **`data/complaints.json` живе на тому ж ефемерному диску Render**, що й
  `gamedata.json`: переживає засинання/рестарт, але **не переживає редеплой**.
  Перед деплоєм скарги варто вивантажити через `GET /api/admin/complaints`.
- **Токен = `BOT_TOKEN`.** Хто отримав доступ до адмінки — отримав доступ до бота.
  Відкривати панель тільки на своєму пристрої; вкладка закрилась — токен зник.
- **Фото ніде не зберігаються** — тільки пересилаються власнику в Telegram.
  Якщо власник видалить чат, картинки не відновити.
