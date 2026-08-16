require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const compression = require('compression');

// ==========================================
// 1. НАЛАШТУВАННЯ БОТА ТА СЕРВЕРА
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://tvoy-domen.example.com';
const PORT = process.env.PORT || 3000;
// Дозволяє тестувати WebApp поза Telegram (без валідного initData), довіряючи id з тіла запиту.
// НЕБЕЗПЕЧНО для реального використання — лишай вимкненим (false) скрізь, крім локальної розробки.
const DEV_MODE_INSECURE = process.env.ALLOW_UNVERIFIED_DEV === 'true';
// Webhook замість long-polling: Telegram сам стукає на твій URL, а не твій ПК тримає
// постійне з'єднання до Telegram. Рятує, якщо мережа/антивірус/провайдер рве довгі
// з'єднання (getMe працює, а bot.launch() довго висить). Вимкнути: USE_WEBHOOK=false.
const USE_WEBHOOK = process.env.USE_WEBHOOK !== 'false';
const WEBHOOK_PATH = '/telegram-webhook';

// Telegram id власника: сюди бот пересилає фото від гравців і пінги про нові
// скарги. Навмисно з env, а не константою в коді — id власника це персональні
// дані, і вони не мають лежати в git-історії публічного репозиторію.
// Не заданий — фічі просто мовчки вимикаються, бот працює як раніше.
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '';

// Пароль адмінки — окремий від BOT_TOKEN (2026-08-16). Раніше вхід в адмінку й
// доступ до бота захищав ОДИН і той самий секрет: витік токена бота (а він
// світиться частіше — потрапляє в логи деплою, .env, іноді в чат при відладці)
// автоматично означав і повний доступ до адмінки. Тепер два різні секрети.
// Якщо ADMIN_PASSWORD не заданий — падаємо назад на BOT_TOKEN (як було),
// щоб не зламати вхід тим, хто ще не встиг додати нову змінну.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ Не задано BOT_TOKEN. Створи файл .env на основі .env.example і вкажи токен від @BotFather.');
    process.exit(1);
}
if (!WEB_APP_URL.startsWith('https://')) {
    console.warn('⚠️  WEB_APP_URL має бути https-посиланням, інакше кнопка WebApp у Telegram не запрацює.');
}
if (DEV_MODE_INSECURE) {
    console.warn('⚠️  ALLOW_UNVERIFIED_DEV=true — перевірка підпису Telegram WebApp ВИМКНЕНА. Тільки для локальної розробки!');
}

const bot = new Telegraf(BOT_TOKEN);
// Без цього ЖОДНА необроблена помилка в bot.on/bot.action (напр. протухлий
// callback_query, заблокований бот у друга, збій мережі Telegram) не мала
// куди подітись — Telegraf прокидає її далі, і для живого бота на друзях
// це означало реальний ризик впасти всім чатом через одну дрібницю.
bot.catch((err, ctx) => {
    console.error('Помилка бота:', err, 'updateType:', ctx?.updateType);
});
const app = express();
app.use(compression()); // HTML сторінки ~370КБ без стиснення — gzip ріже це до ~85КБ
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/video', express.static(path.join(__dirname, 'public/video')));
// API завжди повертає живі дані (баланс/лідерборд/нік і т.д.) — без цього Telegram
// WebView міг закешувати GET-відповідь (напр. лідерборд) і показувати застарілий
// нік/цифри навіть після того, як гравець щось змінив.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); next(); });

let BOT_USERNAME = 'YourBot';
let HTML_CONTENT = ''; // формується після старту (щоб зашити username бота в реферальні посилання)

// ==========================================
// 2. ЕКОНОМІКА ТА КОНФІГ ГРИ
// (єдине джерело правди для цін/нагород — і бек, і фронт орієнтуються на ці числа)
// ==========================================
const { byId } = require('./lib/utils');

// ==========================================
// Дані/каталоги, винесені в data/*.js (Фаза 1 модуляризації, 2026-08-08)
// ==========================================
const { SYMPTOMS, INSPECTORS, TROPHIES } = require('./catalog/inspectors');
const { DEFERMENTS, CHECKPOINT_CHOICES, REPUTATION_NPCS, LEAGUES } = require('./catalog/social');
const { SKILL_BRANCHES } = require('./catalog/skills');
const { SEASON_COSMETICS, COSMETICS } = require('./catalog/cosmetics');
const { HEAT_TIERS, NOTICE_TYPES } = require('./catalog/heat');
const { RESOURCES, CRATES } = require('./catalog/resources');
const { RECIPES } = require('./catalog/recipes');
const { MAP_BUILDINGS } = require('./catalog/map');
const { EXPEDITIONS, PET_EXPEDITION } = require('./catalog/expeditions');
const { LOCATIONS, LEGALIZATION_LORE } = require('./catalog/locations');
const { PETS } = require('./catalog/pets');
const { QUESTS } = require('./catalog/quests');
const { ROOM_ITEMS } = require('./catalog/room-items');
const { REVENGE_LINES, PROMO_CODES, LEGACY_ASSET_PRICES } = require('./catalog/misc');
const { WHEEL_SEGMENTS, RISK_TIERS, MEMORY_ICONS, MEMORY_REWARD_TABLE } = require('./catalog/minigames');
const { UKHYR_RANKS } = require('./catalog/ukhyr');
// Спринти (робочі контракти) — числа вигорання/QTE за фіче-флагом ECONOMY.SPRINTS_V2.
// Саму таблицю контрактів server.js не читає: вона потрібна лише всередині
// lib/mechanics/sprints.js і приїздить у роути вже готовим довідником.
const { BURNOUT_MAX, QTE_SPAWN_CHANCE, QTE_MIN_INTERVAL, QTE_MISS_PENALTY } = require('./catalog/sprints');

const ECONOMY = require('./catalog/economy');

// Картки для медкомісії. Переконливість (power) підібрана так, щоб трійка топових
// карток брала базовий скептицизм 100, але на високому heat уже не вистачало —
// саме тоді й потрібні бонуси з кладовки.

const SYMPTOM_BY_ID = byId(SYMPTOMS);

// Інспектори ТЦК — іменовані боси, що приходять на високому розшуку. Кожен смішний
// характером, а не тим, що він "ворог": об'єкт жарту — абсурд бюрократії.

const INSPECTOR_BY_ID = byId(INSPECTORS);

// Відстрочки — паралельна прогресія до Білого Квитка. Одна активна за раз.
// Поки діє: повістки не приходять, розшук не росте, стуки не діють, блокпост
// проходиться автоматично.
//
// ВАЖЛИВО (і це фіча, а не баг): спад розшуку під відстрочкою працює, а приріст —
// ні. За два тижні "Помічника депутата" heat падає до нуля разом із множником
// доходу. Безпека коштує грошей: обережний заробляє в базовому темпі, ризиковий
// тримає heat 90 і має подвійний дохід ціною постійних облав.

const DEFERMENT_BY_ID = byId(DEFERMENTS);

// Блокпост: переїзд у новий схрон більше не просто транзакція. Шанси показані
// гравцю відкрито — той самий чесний підхід, що й у ящиках.

const CHECKPOINT_BY_ID = byId(CHECKPOINT_CHOICES);

// Дерево навичок ухилянта. Кожна довідка з легалізації = 1 очко. Довідки
// ПРОДОВЖУЮТЬ давати свій +10% доходу — навички це бонус зверху, не заміна.
// Всередині гілки навички беруться послідовно: щоб дійти до шостої, треба взяти
// п'ять попередніх. Тобто повна гілка = 6 довідок (~18 млн сумарного заробітку).

// Репутація з районом: чотири NPC, у кожного щоденний квест і постійний перк
// на 100 репутації. Квести рахуються з уже наявних денних лічильників.
//
// Волонтерка Оксана тут не для галочки: наявність персонажа, якому вигідно
// ДОПОМАГАТИ, робить сатиру не однобокою і рятує гру від відчуття, що вона
// тупо прославляє ухиляння. Її гілка має бути реально корисною.

const NPC_BY_ID = byId(REPUTATION_NPCS);

// Ліги. Лідерборд за балансом — це «хто довше грає»; ліги ж щотижня обнуляються,
// тому новачок має реальний шанс, а сезонний титул не купиш за ⭐ ніколи.


// Сезонна косметика: НІКОЛИ не продається за ⭐ і не випадає з ящиків. Тільки
// виграти. Це головна валюта статусу в грі для друзів.


const SKILL_BY_ID = Object.create(null);
for (const br of SKILL_BRANCHES) {
    br.skills.forEach((s, i) => { SKILL_BY_ID[s.id] = { ...s, branchId: br.id, index: i }; });
}

// Рівні розшуку. Головний трейд-оф гри: високий heat = вдвічі більший дохід, але
// вчетверо частіші облави. Порядок важливий — шукаємо перший тір, у чий `max` влазить heat.


// Типи повісток — від найм'якшої до найжорсткішої. Порядок задає і "тір" для ціни
// хабаря, і зважений вибір: чим вищий heat, тим більший шанс на жорсткі типи
// (wLow — вага при heat 0, wHigh — при heat 100, між ними лінійна інтерполяція).

const NOTICE_BY_ID = byId(NOTICE_TYPES);

// ==========================================
// 2.1 РЕСУРСИ ТА КЛАДОВКА
// ==========================================
// Ресурси падають із ящиків і йдуть на крафт. Кожен займає 1 місце в кладовці,
// тому місткість складу — окремий сток валюти й привід апгрейдити кладовку.
// `sell` — за скільки ТК можна здати одиницю перекупу (швидкі гроші, але крафт вигідніший).
// `img` — намальована іконка (використовується в анімації відкривання ящика);
// де картинки ще немає, показується emoji.

const RESOURCE_BY_ID = byId(RESOURCES);

// Ящики. `loot` — таблиця дропу з вагами (шанс = вага / сума ваг). Шанси показуються
// гравцю у грі: чесний гача без прихованих ймовірностей.
// type: 'res' (ресурс), 'coins' (валюта), 'energy' (повна енергія), 'cosmetic' (випадкова
// невідкрита косметика), 'nothing' (порожньо — лише в найдешевших ящиках).

const CRATE_BY_ID = byId(CRATES);

// Щоденна акція: один ящик за ігрову валюту дешевший на DAILY_DEAL_OFF.
// Вибір детермінований від дати, тому в усіх гравців акція однакова і її не можна
// "перекрутити", перезайшовши в гру. Донатні ящики не знижуємо.
const DAILY_DEAL_OFF = 0.35;
function dailyDealCrateId(date = new Date()) {
    const coinCrates = CRATES.filter((c) => c.currency === 'coins');
    const dayNumber = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
    return coinCrates[dayNumber % coinCrates.length].id;
}
// user необов'язковий: у списку ящиків для гостя знижки від навичок ще невідомі.
function cratePriceFor(crate, user = null) {
    if (crate.currency !== 'coins') return crate.price;
    let price = crate.price;
    if (crate.id === dailyDealCrateId()) price *= (1 - DAILY_DEAL_OFF);
    if (user && hasSkill(user, 'bulk')) price *= (1 - ECONOMY.SKILL_CRATE_DISCOUNT);
    return Math.round(price);
}

// Крафт — головний спосіб перетворити ресурси на постійні бонуси. Навмисно дорожчий
// за пряму купівлю апгрейдів, але дає те, що за валюту не купиш (щити, множники).

const RECIPE_BY_ID = byId(RECIPES);

// Карта території: захисні споруди за будматеріали (wood/scrap/brick), 3 рівні
// кожна, будуються незалежно від конкретної клітинки на карті (сама сітка на фоні —
// візуальний контекст + орієнтири-посилання на вилазки, не окрема система координат).

const { MAP_BUILDING_BY_ID, mapBuildingLevel, mapBuildingEffect, mapRaidMult, mapProtectPct } = require('./lib/mechanics/map');
const { expeditionSlots, expeditionSnapshot } = require('./lib/mechanics/expeditions');

// Вилазки — офлайн-механіка: відправив персонажа й чекаєш реальний час. Дає ресурси
// без кліків, але з ризиком спалитись (тоді здобич втрачено). Довші вилазки — більше
// здобичі й більший ризик. Одночасно може бути тільки одна.

const EXPEDITION_BY_ID = byId(EXPEDITIONS);

// 4 етапи еволюції схованки. `img` — квадратна картинка для головної кнопки-клікера
// (персонаж по центру). `roomImg` — окрема широка картинка для екрана "Кімната"
// (персонаж стоїть анфас у правій третині кадру, ліва частина — кімната з місцем
// під декор). Поки roomImg не заданий для локації — екран "Кімната" підставляє img
// замість неї (буде виглядати не ідеально, це очікувано до генерації нової картинки).


// Компаньйони — пасивні мультиплікатори, екіпірується один одночасно.

// Множники компаньйонів для вилазок (усе інше — у ECONOMY.PET_*).


// Гардероб — суто косметичні CSS/emoji-оверлеї на персонажі (без нових зображень),
// по одному предмету на слот одночасно. Жодного впливу на економіку.


// Щоденні квести — прогрес рахується з опівночі (questsDate), окремо від lifetime-лічильників.


// Речі для декору кімнати — можна володіти й показувати одразу кількома (на відміну від
// гардеробу персонажа, де один предмет на слот). Кожна річ має фіксовану позицію в кімнаті.


// Дрібна ненасильницька помста інспектору — розблоковується після кількох виживаних
// облав (ECONOMY.REVENGE_UNLOCK_RAIDS), 1 раз/день, суто флейвор-текст + маленька нагорода.


// Тіньова біржа торгує СПРАВЖНІМИ ресурсами з кладовки (раніше це були окремі
// абстрактні товари, ніяк не повʼязані з рештою гри). Курс гуляє кожні 3 хв, тож
// ресурси вигідно продавати на піку, а на дні — докуповувати під крафт замість
// того, щоб фармити ящики. Білий Квиток (тір 4) не торгується: він має здобуватись.
const MARKET_ASSETS = RESOURCES
    .filter((r) => r.tier <= 3)
    .map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, img: r.img, basePrice: r.sell }));

// Колесо Зради та Перемоги — 1 безкоштовний прокрут/день, результат обирає сервер.


// --- Міні-ігри (маленькі додаткові механіки, не завʼязані на основну
// прогресію — суто розвага з невеликим ризиком/зиском) ---

// Швидкісна монетка: ставка на ТК, шанс трохи гірший за чесний 50/50
// (як і завжди в казино "ТЦК"), виграш = ставка ×2. 0.47 (2026-08-08:
// піднято до 0.49 — гравці скаржились, що з 47% це відчувалось як "завжди
// в нуль або в мінус", майже без шансу реально відчути виграш).
const COINFLIP_WIN_CHANCE = 0.49;

// Колесо ризику 2.0: три рівні азарту, кожен трохи в мінус гравцю в
// середньому (0.9/0.9/0.8 EV), щоб не стало новим золотим рецептом.


// Картонна карточна гра "Знайди пару": 4 пари (8 карток), нагорода залежить
// від кількості спроб — чим краща памʼять, тим більший зиск.

const MEMORY_ENTRY_COST = 200;

function memoryRewardFor(flips) {
    return MEMORY_REWARD_TABLE.find((t) => flips <= t.maxFlips).reward;
}

// Скільки гравець усього вніс у скарбницю свого чату (0, якщо не в чаті).
// Оголошено тут, бо використовується в ACHIEVEMENTS нижче.
function clanContributionOf(user) {
    if (!user.clanId || !clansDB.has(user.clanId)) return 0;
    const clan = clansDB.get(user.clanId);
    return (clan.contributions && clan.contributions[user.id]) || 0;
}

// Досягнення. check() виконується лише на сервері (не серіалізується клієнту);
// клієнт отримує ACHIEVEMENTS_META (без check) + масив розблокованих id користувача.
const ACHIEVEMENTS = [
    { id: 'clicks_1000', name: 'Перші мозолі', desc: 'Зроби 1 000 кліків', reward: 300, check: (u) => u.totalClicks >= 1000 },
    { id: 'clicks_10000', name: 'Мозоль на пальці', desc: 'Зроби 10 000 кліків', reward: 2000, check: (u) => u.totalClicks >= 10000 },
    { id: 'clicks_100000', name: 'Легенда мозолів', desc: 'Зроби 100 000 кліків', reward: 15000, check: (u) => u.totalClicks >= 100000 },
    { id: 'boxes_5', name: 'Колекціонер шкарпеток', desc: 'Відкрий 5 ящиків', reward: 800, check: (u) => u.boxesOpened >= 5 },
    { id: 'boxes_25', name: 'Постійний клієнт гумштабу', desc: 'Відкрий 25 ящиків', reward: 4000, check: (u) => u.boxesOpened >= 25 },
    { id: 'boxes_100', name: 'Розпакувальник року', desc: 'Відкрий 100 ящиків', reward: 25000, check: (u) => u.boxesOpened >= 100 },
    { id: 'raids_3', name: 'Профі втечі', desc: 'Пережий 3 облави', reward: 1500, check: (u) => u.raidsSurvived >= 3 },
    { id: 'raids_10', name: 'Ветеран втеч', desc: 'Пережий 10 облав', reward: 5000, check: (u) => u.raidsSurvived >= 10 },
    { id: 'wealth_100000', name: 'Тіньовий мільйонер', desc: 'Накопич 100 000 ТК', reward: 8000, check: (u) => u.balance >= 100000 },
    { id: 'wealth_1000000', name: 'Тіньовий олігарх', desc: 'Накопич 1 000 000 ТК', reward: 40000, check: (u) => u.balance >= 1000000 },
    { id: 'trades_10', name: 'Біржовий вовк', desc: 'Заверши 10 угод на тіньовій біржі', reward: 1200, check: (u) => u.tradesCount >= 10 },
    { id: 'wheel_7', name: 'Колесо фортуни', desc: 'Крути Колесо Зради 7 разів', reward: 1000, check: (u) => u.wheelSpinsCount >= 7 },
    { id: 'pets_all', name: 'Зоопарк', desc: 'Здобудь усіх компаньйонів', reward: 4000, check: (u) => u.ownedPets.length >= PETS.length },
    { id: 'cosmetics_5', name: 'Модник', desc: 'Придбай 5 предметів гардеробу', reward: 1500, check: (u) => u.ownedCosmetics.length >= 5 },
    { id: 'cosmetics_15', name: 'Гардеробний барон', desc: 'Придбай 15 предметів гардеробу', reward: 6000, check: (u) => u.ownedCosmetics.length >= 15 },
    { id: 'cosmetics_30', name: 'Ходяча вітрина', desc: 'Придбай 30 предметів гардеробу', reward: 15000, check: (u) => u.ownedCosmetics.length >= 30 },
    { id: 'room_all', name: 'Затишний барліг', desc: 'Обстав кімнату всіма речами', reward: 6000, check: (u) => u.ownedRoomItems.length >= ROOM_ITEMS.length },
    { id: 'level_5', name: 'Під кордоном', desc: 'Досягни 5 рівня схрону', reward: 6000, check: (u) => u.level >= 5 },
    { id: 'level_6', name: 'Гість закордонної тюрми', desc: 'Досягни 6 рівня схрону', reward: 20000, check: (u) => u.level >= 6 },
    { id: 'level_8', name: 'Легалізовано', desc: 'Досягни 8 рівня схрону (маєток)', reward: 60000, check: (u) => u.level >= 8 },
    { id: 'clan_member', name: 'Сусід за парканом', desc: 'Вступи в чат ОСББ', reward: 800, check: (u) => !!u.clanId },
    { id: 'referral_5', name: 'Мережа перевізників', desc: 'Здай 5 друзів', reward: 3000, check: (u) => u.refCount >= 5 },
    // --- Кладовка, ресурси, крафт ---
    { id: 'res_100', name: 'Запасливий', desc: 'Назбирай 100 ресурсів усього', reward: 1000, check: (u) => (u.resourcesCollected || 0) >= 100 },
    { id: 'res_1000', name: 'Комірник', desc: 'Назбирай 1 000 ресурсів усього', reward: 8000, check: (u) => (u.resourcesCollected || 0) >= 1000 },
    { id: 'res_10000', name: 'Барон кладовки', desc: 'Назбирай 10 000 ресурсів усього', reward: 50000, check: (u) => (u.resourcesCollected || 0) >= 10000 },
    { id: 'storage_5', name: 'Розширення житлоплощі', desc: 'Прокачай кладовку до 5 рівня', reward: 3000, check: (u) => (u.storageLevel || 0) >= 5 },
    { id: 'storage_10', name: 'Приватний склад', desc: 'Прокачай кладовку до 10 рівня', reward: 12000, check: (u) => (u.storageLevel || 0) >= 10 },
    { id: 'craft_1', name: 'Перший крафт', desc: 'Скрафти будь-що', reward: 500, check: (u) => (u.craftedCount || 0) >= 1 },
    { id: 'craft_10', name: 'Рукастий', desc: 'Скрафти 10 предметів', reward: 5000, check: (u) => (u.craftedCount || 0) >= 10 },
    { id: 'craft_50', name: 'Підпільний завод', desc: 'Скрафти 50 предметів', reward: 30000, check: (u) => (u.craftedCount || 0) >= 50 },
    { id: 'white_ticket', name: 'НЕДОТОРКАНИЙ', desc: 'Скрафти справжній Білий Квиток', reward: 100000, check: (u) => !!u.permanentShield },
    { id: 'ticket_hoarder', name: 'Квитковий ділок', desc: 'Май 3 Білих Квитки в кладовці одночасно', reward: 20000, check: (u) => (u.resources && u.resources.ticket || 0) >= 3 },
    // --- Вилазки ---
    { id: 'exp_1', name: 'Перша вилазка', desc: 'Заверши 1 вилазку', reward: 400, check: (u) => (u.expeditionsDone || 0) >= 1 },
    { id: 'exp_10', name: 'Досвідчений мародер', desc: 'Заверши 10 вилазок', reward: 4000, check: (u) => (u.expeditionsDone || 0) >= 10 },
    { id: 'exp_50', name: 'Нічний промисел', desc: 'Заверши 50 вилазок', reward: 25000, check: (u) => (u.expeditionsDone || 0) >= 50 },
    // --- Престиж ---
    { id: 'prestige_1', name: 'Легалізований', desc: 'Легалізуйся вперше', reward: 10000, check: (u) => (u.prestigeCount || 0) >= 1 },
    { id: 'prestige_5', name: 'Рецидивіст', desc: 'Легалізуйся 5 разів', reward: 60000, check: (u) => (u.prestigeCount || 0) >= 5 },
    { id: 'prestige_pts_25', name: 'Стос довідок', desc: 'Накопич 25 довідок престижу', reward: 150000, check: (u) => (u.prestigePoints || 0) >= 25 },
    // --- Клани ---
    { id: 'clan_donate_1', name: 'Скинувся на ОСББ', desc: 'Внеси щось у скарбницю чату', reward: 1000, check: (u) => clanContributionOf(u) > 0 },
    { id: 'clan_donate_100k', name: 'Голова правління', desc: 'Внеси 100 000 ТК у скарбницю чату', reward: 15000, check: (u) => clanContributionOf(u) >= 100000 },
    { id: 'clan_donate_1m', name: 'Спонсор кварталу', desc: 'Внеси 1 000 000 ТК у скарбницю чату', reward: 80000, check: (u) => clanContributionOf(u) >= 1000000 },
    // --- Розшук ---
    { id: 'heat_50', name: 'Помітна фігура', desc: 'Розігрій розшук до 50', reward: 3000, check: (u) => (u.heat || 0) >= 50 },
    { id: 'heat_90', name: 'Легенда району', desc: 'Розігрій розшук до 90', reward: 20000, check: (u) => (u.heat || 0) >= 90 },
    { id: 'heat_cold', name: 'Сірий кардинал', desc: 'Пережий облаву, маючи розшук нижче 10', reward: 5000,
      check: (u) => (u.raidsSurvived || 0) >= 1 && (u.heat || 0) < 10 && (u.totalClicks || 0) >= 5000 },
    // --- Повістки й медкомісія ---
    { id: 'notice_1', name: 'Перший папірець', desc: 'Зніми свою першу повістку', reward: 800, check: (u) => (u.noticeStats?.resolved || 0) >= 1 },
    { id: 'notice_25', name: 'Досвідчений отримувач', desc: 'Зніми 25 повісток', reward: 12000, check: (u) => (u.noticeStats?.resolved || 0) >= 25 },
    { id: 'notice_clean', name: 'Жодного папірця не проґавив', desc: 'Зніми 10 повісток, не давши протухнути жодній', reward: 15000,
      check: (u) => (u.noticeStats?.resolved || 0) >= 10 && (u.noticeStats?.expired || 0) === 0 },
    { id: 'medcom_1', name: 'Непридатний', desc: 'Пройди медкомісію', reward: 1500, check: (u) => (u.medcomStats?.passed || 0) >= 1 },
    { id: 'medcom_10', name: 'Хронічно хворий', desc: 'Пройди медкомісію 10 разів', reward: 15000, check: (u) => (u.medcomStats?.passed || 0) >= 10 },
    { id: 'deceived_10', name: 'Майстер папірця', desc: 'Обмани систему липовою довідкою 10 разів', reward: 12000, check: (u) => (u.deceivedCount || 0) >= 10 },
    // --- Інспектори ---
    { id: 'insp_first', name: 'Спекався', desc: 'Здихайся першого інспектора', reward: 3000,
      check: (u) => Object.values(u.inspectorStats?.defeated || {}).reduce((a, b) => a + b, 0) >= 1 },
    { id: 'insp_lyuda', name: 'Молодой человек', desc: 'Здихайся Люди з паспортного', reward: 25000, check: (u) => (u.inspectorStats?.defeated?.lyuda || 0) >= 1 },
    { id: 'insp_pivnyk', name: '30 років у системі', desc: 'Здихайся Генерала Півника', reward: 200000, check: (u) => (u.inspectorStats?.defeated?.pivnyk || 0) >= 1 },
    { id: 'insp_all', name: 'Повний комплект', desc: 'Здихайся всіх чотирьох інспекторів', reward: 300000,
      check: (u) => INSPECTORS.every((i) => (u.inspectorStats?.defeated?.[i.id] || 0) >= 1) },
    // --- Відстрочки й блокпост ---
    { id: 'defer_1', name: 'Папірець із печаткою', desc: 'Оформи першу відстрочку', reward: 2000, check: (u) => (u.defermentsTaken || 0) >= 1 },
    { id: 'defer_10', name: 'Вічно зайнятий', desc: 'Оформи 10 відстрочок', reward: 25000, check: (u) => (u.defermentsTaken || 0) >= 10 },
    { id: 'checkpoint_10', name: 'Знаю всі обʼїзні', desc: 'Пройди 10 блокпостів', reward: 8000, check: (u) => (u.checkpointStats?.passed || 0) >= 10 },
    // --- PvP ---
    { id: 'snitch_1', name: 'Анонімний доброзичливець', desc: 'Здай сусіда вперше', reward: 1000, check: (u) => (u.snitchStats?.sent || 0) >= 1 },
    { id: 'snitch_25', name: 'Гарячий телефон', desc: 'Здай сусідів 25 разів', reward: 20000, check: (u) => (u.snitchStats?.sent || 0) >= 25 },
    { id: 'caught_1', name: 'Вирахував', desc: 'Розкрий того, хто на тебе доніс', reward: 5000, check: (u) => (u.snitchStats?.caught || 0) >= 1 },
    { id: 'caught_5', name: 'Приватний детектив', desc: 'Розкрий 5 стукачів', reward: 40000, check: (u) => (u.snitchStats?.caught || 0) >= 5 },
    { id: 'snitch_clean', name: 'Чиста совість', desc: 'Досягни 5 рівня схрону, не здавши нікого', reward: 30000,
      check: (u) => (u.level || 1) >= 5 && (u.snitchStats?.sent || 0) === 0 },
    // --- Навички, репутація, сезони ---
    { id: 'skills_6', name: 'Дещо вмію', desc: 'Вивчи 6 навичок', reward: 20000, check: (u) => Object.values(u.skills || {}).filter(Boolean).length >= 6 },
    { id: 'skills_all', name: 'Академія ухиляння', desc: 'Вивчи всі 18 навичок', reward: 250000,
      check: (u) => Object.values(u.skills || {}).filter(Boolean).length >= Object.keys(SKILL_BY_ID).length },
    { id: 'rep_first', name: 'Свій у дворі', desc: 'Доведи репутацію з кимось до максимуму', reward: 15000,
      check: (u) => REPUTATION_NPCS.some((n) => (u.reputation?.[n.id] || 0) >= ECONOMY.REP_MAX) },
    { id: 'rep_oksana', name: 'Не такий вже й падлюка', desc: 'Доведи репутацію з Оксаною до максимуму', reward: 30000,
      check: (u) => (u.reputation?.oksana || 0) >= ECONOMY.REP_MAX },
    { id: 'rep_all', name: 'Депутат від району', desc: 'Доведи репутацію з усіма до максимуму', reward: 120000,
      check: (u) => REPUTATION_NPCS.every((n) => (u.reputation?.[n.id] || 0) >= ECONOMY.REP_MAX) },
    { id: 'season_title', name: 'Є що показати', desc: 'Заслужи сезонний титул', reward: 25000, check: (u) => !!u.seasonTitle },
    { id: 'league_top', name: 'Ліга Бункера', desc: 'Піднімись у найвищу лігу', reward: 100000, check: (u) => (u.league || 0) >= LEAGUES.length - 1 },
    { id: 'trophies_3', name: 'Полиця трофеїв', desc: 'Здобудь 3 трофеї', reward: 30000, check: (u) => (u.trophies || []).length >= 3 },
];
const ACHIEVEMENTS_META = ACHIEVEMENTS.map(({ id, name, desc, reward }) => ({ id, name, desc, reward }));

// Трофеї — окрема від досягнень колекція: їх не «наклікаєш», кожен треба в когось
// відібрати. Id мають збігатися з тим, що пишеться в user.trophies.


// Коди для друзів/тестувальників — повністю байпасять монетизацію.


// ==========================================
// 3. "БАЗА ДАНИХ" (у пам'яті процесу — навмисно просто, це жартівливий проєкт для друзів)
// ==========================================
const {
    usersDB, clansDB, DATA_DIR, DATA_FILE, loadData, saveData,
    createFreshUser, migrateUser, installBalanceTracking, migrateLegacyPortfolio,
    displayName, nicknameTaken, pidIndex, makePid, registerPid, userByPid,
} = require('./lib/user-store');

// Скільки гравців погодились на рекламні повідомлення в чаті. Рахуємо на льоту
// замість окремого лічильника — гравців мало (гра для друзів), тож обхід дешевий,
// а зайвого стану, який можна розсинхронізувати, немає.
function adConsentCount() {
    let n = 0;
    for (const u of usersDB.values()) if (u.adConsent === true) n++;
    return n;
}

// Множник, на який згода громади піднімає шанс аірдропу — з покриттям.
function adConsentAirdropMult() {
    return 1 + Math.min(
        ECONOMY.AD_CONSENT_AIRDROP_BONUS_CAP,
        adConsentCount() * ECONOMY.AD_CONSENT_AIRDROP_BONUS_PER_PLAYER,
    );
}

// Знімок усієї бази для позаплатформного бекапу: диск Render не переживає
// редеплой, тож перед кожним пушем варто стягнути актуальний стан гравців
// і кланів собі локально. Захищено тим самим BOT_TOKEN, що й сам бот, —
// секрету окремо заводити не треба, і тільки власник бота може його викликати.
app.get('/api/admin/backup', (req, res) => {
    if (!ADMIN_PASSWORD || req.get('x-admin-token') !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'forbidden' });
    }
    res.json({
        users: Array.from(usersDB.values()), clans: Array.from(clansDB.values()),
        exportedAt: Date.now(), playerCount: usersDB.size, clanCount: clansDB.size,
    });
});

// Розсилка повідомлення від розробника всім гравцям — той самий admin-токен,
// що й бекап. sendPush уже ковтає власні помилки (заблокував бота, невірний
// id), тому один поганий id не зупиняє розсилку іншим.
app.post('/api/admin/broadcast', (req, res) => {
    if (!ADMIN_PASSWORD || req.get('x-admin-token') !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'forbidden' });
    }
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'no message' });
    let sent = 0;
    for (const user of usersDB.values()) {
        sendPush(user.id, message);
        sent++;
    }
    res.json({ success: true, sent });
});
setInterval(saveData, 20000);

function getUser(id, name) {
    id = String(id);
    if (!usersDB.has(id)) {
        usersDB.set(id, createFreshUser(id, name));
    }
    const user = migrateUser(usersDB.get(id));
    if (name) user.name = name;
    syncHeatAndNotices(user);
    return user;
}

// Рівень клану росте від скарбниці по кореню — кожен наступний рівень коштує
// відчутно більше, тож великий клан не злітає на максимум за вечір.
function clanLevel(clan) {
    const treasury = (clan && clan.treasury) || 0;
    return Math.min(ECONOMY.CLAN_MAX_LEVEL, Math.floor(Math.sqrt(treasury / ECONOMY.CLAN_LEVEL_COST)));
}

function clanNextLevelCost(clan) {
    const lvl = clanLevel(clan);
    if (lvl >= ECONOMY.CLAN_MAX_LEVEL) return null;
    return Math.pow(lvl + 1, 2) * ECONOMY.CLAN_LEVEL_COST;
}

function getClanInfo(user) {
    // Клан зник разом із диском, а бекап його не повернув — знімаємо мертве
    // посилання, інакше гравець вважається «вже в чаті» і не може вступити в новий.
    if (user.clanId && !clansDB.has(user.clanId)) user.clanId = null;
    if (!user.clanId) return { clanId: null, clanName: null, memberCount: 0, bonus: 1 };
    const clan = clansDB.get(user.clanId);
    const lvl = clanLevel(clan);
    // «Кум у сільраді» множить саму НАДБАВКУ, а не підсумковий множник — інакше
    // ×1.5 на одиницю дало б +50% пасиву на рівному місці.
    const extra = (ECONOMY.CLAN_PASSIVE_BONUS + lvl * ECONOMY.CLAN_BONUS_PER_LEVEL)
        * (hasSkill(user, 'kum') ? ECONOMY.SKILL_CLAN_MULT : 1);
    return {
        clanId: clan.id, clanName: clan.name, memberCount: clan.members.length,
        bonus: 1 + extra,
        clanLevel: lvl,
        treasury: clan.treasury || 0,
        nextLevelCost: clanNextLevelCost(clan),
        myContribution: (clan.contributions && clan.contributions[user.id]) || 0,
    };
}

function makeClanId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Перевіряє й нараховує нові досягнення. Повертає список щойно розблокованих (для тосту на клієнті).
function checkAchievements(user) {
    const unlocked = [];
    for (const ach of ACHIEVEMENTS) {
        if (user.achievements.includes(ach.id)) continue;
        if (ach.check(user)) {
            user.achievements.push(ach.id);
            user.balance += ach.reward;
            unlocked.push({ id: ach.id, name: ach.name, desc: ach.desc, reward: ach.reward });
        }
    }
    return unlocked;
}

// Офлайн-прогрес: скільки пасиву набігло, поки гравець не заходив (з кепом і мін. порогом показу).
function applyOfflineProgress(user) {
    const now = Date.now();
    const lastSeen = user.lastSeenAt || now;
    // Рішення Р10 (2026-08-13): кап знижено з 8 до 6 годин для всіх, АЛЕ VIP
    // тепер знімає кап повністю (замість попереднього підходу — той самий кап
    // для всіх + просто ×3 множник доходу зверху).
    const capSec = user.isVip ? Infinity : ECONOMY.OFFLINE_CAP_SECONDS;
    const elapsedSec = Math.min((now - lastSeen) / 1000, capSec);
    let offlineEarnings = 0;
    if (elapsedSec >= ECONOMY.OFFLINE_MIN_SECONDS && user.passive > 0) {
        const clan = getClanInfo(user);
        const vipMult = user.isVip ? 3 : 1;
        // Єдиний порядок множників доходу в грі: base * heat * vip * prestige * clan.
        offlineEarnings = Math.floor(user.passive * heatIncomeMult(user) * vipMult * prestigeMultiplier(user) * clan.bonus * elapsedSec);
        user.balance += offlineEarnings;
    }
    user.lastSeenAt = now;
    return offlineEarnings;
}

// Обнуляє денні лічильники квестів при першому запиті нового дня.
function resetDailyIfNeeded(user) {
    const today = new Date().toDateString();
    if (user.questsDate !== today) {
        user.questsDate = today;
        user.dailyClicks = 0;
        user.dailyTrades = 0;
        user.dailyBoxes = 0;
        user.dailyRaids = 0;
        user.dailyCrafts = 0;
        user.dailyResources = 0;
        user.claimedQuests = [];
        user.snitchesToday = 0;
        user.dailyTradeVolume = 0;
        user.dailyBribes = 0;
        user.dailyDonated = 0;
        user.dailyNotices = 0;
        user.dailyMedcom = 0;
        user.dailyInspectors = 0;
        user.dailyExpeditions = 0;
        user.claimedRepQuests = [];
        user.mykolaCoverUsed = false;
    }
}

function pickWeighted(segments) {
    const total = segments.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (let i = 0; i < segments.length; i++) {
        r -= segments[i].weight;
        if (r <= 0) return i;
    }
    return segments.length - 1;
}

// ===== Кладовка: місткість, підрахунок, додавання ресурсів; апгрейди магазину =====
// (винесено в lib/mechanics/storage.js, Фаза 4 модуляризації, 2026-08-08)
const {
    storageCapacity, storageUsed, storageUpgradeCost, addResource,
    storageSnapshot, upgradeBatchPlan, upgradeCost,
} = require('./lib/mechanics/storage');

// Базова ціна кожного апгрейда — в одному місці, щоб формула ціни не розповзалась
// між поодинокою купівлею і купівлею пачкою.
const {
    UPGRADE_BASE, UPGRADE_BASE_EFFECT, TIER_GATES,
    upgTier, upgInTier, tierCostMultCapped, upgCost, upgEffectPerLevel, tierGateCost, upgradeGateInfo,
} = require('./lib/mechanics/economy');

function hasActiveShield(user) {
    return !!user.permanentShield || (user.shieldUntil || 0) > Date.now();
}

const { xpForLevel, playerLevelForXP, addXP, addUkhyr, ukhyrRank } = require('./lib/mechanics/levels');

// ===== Спринти: вигорання, QTE, нагорода за контракт =====
// (чиста математика, роути беруть її звідси через deps — див. routes/sprints.js)
const {
    SPRINT_TIER_BY_ID, burnoutPerTap, decayBurnout, burnoutTapMult,
    sprintPayout, qteWindowMs, settleExpiredQte, sprintExpired, sprintSnapshot,
    routeProgressPct, routeProjectComplete, ROUTE_PROJECT_COST,
} = require('./lib/mechanics/sprints');

// ==========================================
// РОЗШУК (HEAT) ТА ПОВІСТКИ
// ==========================================
const { heatTierOf, heatIncomeMult, heatRaidMult, changeHeat, decayHeat } = require('./lib/mechanics/heat');

function noticeBribeCost(user, type) {
    const tierIndex = NOTICE_TYPES.indexOf(type) + 1;
    let cost = ECONOMY.NOTICE_BRIBE_BASE * tierIndex * (1 + (user.heat || 0) / 50);
    // Аудит балансу (2026-08-13): фіксована сума на пізній грі відчувалась як
    // "кинути один сірник, коли в тебе їх цілий КамАЗ" (пряма скарга розробника:
    // при 20М балансу відкуп за 1200₴ — 0.006% від нього, буквально нічого).
    // Відкуп тепер не менше 3% поточного балансу — росте разом із гравцем,
    // а не тільки з тіром повістки/розшуком.
    cost = Math.max(cost, (user.balance || 0) * ECONOMY.NOTICE_BRIBE_BALANCE_PCT);
    if (hasSkill(user, 'zhek')) cost *= (1 - ECONOMY.SKILL_BRIBE_CUT);
    return Math.round(cost);
}

// Білий Квиток — постійний імунітет, повістки такому гравцю просто не приходять.
function noticesBlocked(user) {
    return !!user.permanentShield || (user.deferUntil || 0) > Date.now();
}

// finishNotice — тепер у routes/security.js (використовується лише там)

function scheduleNextNotice(user) {
    const { NOTICE_INTERVAL_MIN_H: min, NOTICE_INTERVAL_MAX_H: max } = ECONOMY;
    let hours = min + Math.random() * (max - min);
    const heat = user.heat || 0;
    if (heat > 85) hours *= 0.4;
    else if (heat > 55) hours *= 0.6;
    user.nextNoticeAt = Date.now() + hours * 3600 * 1000;
}

function issueNotice(user) {
    const ratio = (user.heat || 0) / ECONOMY.HEAT_MAX;
    const weights = NOTICE_TYPES.map((t) => ({ weight: Math.max(0.1, t.wLow + (t.wHigh - t.wLow) * ratio) }));
    const type = NOTICE_TYPES[pickWeighted(weights)];
    const now = Date.now();
    const notice = {
        uid: 'n' + now.toString(36) + Math.floor(Math.random() * 1000).toString(36),
        typeId: type.id, issuedAt: now, expiresAt: now + type.ttlH * 3600 * 1000, pushSent: false,
    };
    user.notices.push(notice);
    user.noticeStats.received += 1;
    return notice;
}

// Забирає з кладовки `count` випадкових одиниць ресурсів (штраф блокпоста).
function loseRandomResources(user, count) {
    let lost = 0;
    for (let i = 0; i < count; i++) {
        const owned = Object.keys(user.resources || {}).filter((k) => user.resources[k] > 0);
        if (!owned.length) break;
        const pick = owned[Math.floor(Math.random() * owned.length)];
        user.resources[pick] -= 1;
        if (user.resources[pick] <= 0) delete user.resources[pick];
        lost += 1;
    }
    return lost;
}

// Усі покарання навмисно комічні й ігрові: ТК, ресурси, півгодини без кліків.
function applyNoticePenalty(user, type, mult = 1) {
    const result = { coins: 0, resources: 0, energyLocked: false };
    // «Незламний» ріже саме грошову частину штрафу вдвічі.
    if (hasSkill(user, 'unbroken')) mult *= (1 - ECONOMY.SKILL_PENALTY_CUT);
    // Схованка з карти території ріже штраф так само, стакається з навичкою множенням.
    const hideoutEff = mapBuildingEffect(user, 'hideout');
    if (hideoutEff) mult *= (1 - hideoutEff.penaltyCut);
    const pct = (type.balancePct || 0) * mult;
    if (pct > 0) {
        const fine = Math.floor(Math.max(0, user.balance) * pct);
        if (fine > 0) { user.balance -= fine; result.coins = fine; }
    }
    if (type.energyLockMin) {
        user.energyLockUntil = Date.now() + type.energyLockMin * 60000;
        user.energy = 0;
        result.energyLocked = true;
    }
    if (type.resourceLoss) result.resources = loseRandomResources(user, Math.round(type.resourceLoss * mult));
    if (type.heatExtra) changeHeat(user, type.heatExtra * mult, 'Штраф: ' + type.name);
    return result;
}

function expireNotices(user) {
    const now = Date.now();
    const expired = [];
    user.notices = (user.notices || []).filter((n) => {
        if (n.expiresAt > now) return true;
        expired.push(n);
        return false;
    });
    for (const n of expired) {
        const type = NOTICE_BY_ID[n.typeId];
        if (!type) continue;
        const penalty = applyNoticePenalty(user, type, 1);
        changeHeat(user, type.heatOnExpire, 'Протухла повістка: ' + type.name);
        user.noticeStats.expired += 1;
        logOffline(user, 'bad', `${type.emoji} Протухла: ${type.name}` +
            (penalty.coins ? ` (−${penalty.coins.toLocaleString('uk-UA')} ТК)` : ''));
    }
    return expired;
}

// Викликається з getUser, тому будь-який запит бачить актуальний heat і вже
// протухлі повістки — без окремого таймера на кожного гравця.
function syncHeatAndNotices(user) {
    decayHeat(user);
    return expireNotices(user);
}

function heatSnapshot(user, withLog = false) {
    const tier = heatTierOf(user.heat);
    const snap = {
        heat: Math.round((user.heat || 0) * 10) / 10,
        heatTier: {
            emoji: tier.emoji, name: tier.name, flavor: tier.flavor,
            raidMult: tier.raidMult, incomeMult: tier.incomeMult,
        },
    };
    if (withLog) snap.heatLog = user.heatLog || [];
    return snap;
}

function noticeSnapshot(user) {
    return {
        notices: (user.notices || []).map((n) => ({
            uid: n.uid, typeId: n.typeId, expiresAt: n.expiresAt,
            bribeCost: noticeBribeCost(user, NOTICE_BY_ID[n.typeId]),
        })),
        noticeStats: user.noticeStats,
        energyLockUntil: user.energyLockUntil || 0,
    };
}

// ==========================================
// PvP: "ЗДАТИ СУСІДА"
// ==========================================
// Одна перевірка на два місця: сам стук і кнопка в порівнянні профілів (щоб UI
// показував ПРИЧИНУ, чому здати не можна, а не мовчазну сіру кнопку).
function snitchEligibility(user, target) {
    const free = (user.freeSnitchOn || []).includes(target.id);
    const deny = (reason) => ({ ok: false, free, reason });

    if (target.id === user.id) return deny('На себе стукати — це вже діагноз');
    if (target.permanentShield) return deny('У нього Білий Квиток — дзвінок нікого не зацікавив');
    if ((target.deferUntil || 0) > Date.now()) return deny('У нього офіційна відстрочка. Дзвінок ні до чого');
    if (hasActiveShield(target)) return deny('У нього довідка. Тобі просто не повірять');
    if ((target.notices || []).length >= ECONOMY.NOTICE_MAX_ACTIVE) {
        return deny('У нього і так повна скринька повісток');
    }
    // Безкоштовний стук (право на помсту за хибне звинувачення) обходить ліміти,
    // але не обходить захист жертви вище — інакше помста била б наосліп.
    if (free) return { ok: true, free: true, costTk: 0 };

    if (target.level <= user.level - ECONOMY.SNITCH_MIN_LEVEL_GAP) {
        return deny('Він і так у гіршому схроні. Малих не чіпаємо');
    }
    if ((user.snitchesToday || 0) >= ECONOMY.SNITCH_DAILY_LIMIT) {
        return deny(`Ліміт совісті — ${ECONOMY.SNITCH_DAILY_LIMIT} дзвінки на добу`);
    }
    const lastAt = (user.lastSnitchTargets || {})[target.id] || 0;
    const cooldownMs = ECONOMY.SNITCH_SAME_TARGET_COOLDOWN_H * 3600 * 1000;
    if (Date.now() - lastAt < cooldownMs) {
        const leftH = Math.ceil((cooldownMs - (Date.now() - lastAt)) / 3600000);
        return deny(`На цього ти вже стукав. Дай продихнути ще ${leftH} год`);
    }
    // Під час війни ОСББ стук на учасника ворожого чату вдвічі дешевший — саме
    // це перетворює дрібну особисту гидоту на командний спорт.
    const atWar = isWarEnemy(user, target);
    const cost = atWar ? Math.round(ECONOMY.SNITCH_COST_TK * ECONOMY.WAR_SNITCH_DISCOUNT) : ECONOMY.SNITCH_COST_TK;
    if (user.balance < cost) return deny('Не вистачає ТК на анонімний дзвінок');
    if ((user.resources[ECONOMY.SNITCH_COST_RES] || 0) < 1) {
        return deny('Потрібна ліва сімка — зі свого номера такі дзвінки не роблять');
    }
    return { ok: true, free: false, costTk: cost, warTarget: atWar };
}

// Чи ця ціль — учасник ворожого чату в активній війні.
function isWarEnemy(user, target) {
    const clan = user.clanId && clansDB.get(user.clanId);
    if (!warActive(clan)) return false;
    return target.clanId === clan.war.opponentId;
}

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Три підозрюваних: справжній стукач + шум. Шум беремо спершу зі співклановців і
// тих, з ким жертва вже перетиналась — щоб здогад був про ЖИВИХ людей із чату,
// а не про випадкові ніки, і помилка боляче била саме по своїх.
function buildSuspects(victim, realId) {
    const pool = new Set();
    const clan = victim.clanId && clansDB.get(victim.clanId);
    if (clan) (clan.members || []).forEach((id) => pool.add(id));
    Object.keys(victim.lastSnitchTargets || {}).forEach((id) => pool.add(id));
    (victim.snitchedBy || []).forEach((e) => pool.add(e.byId));
    for (const u of usersDB.values()) {
        if (pool.size >= 30) break;
        pool.add(u.id);
    }
    pool.delete(victim.id);
    pool.delete(realId);
    const noise = shuffled([...pool].filter((id) => usersDB.has(id))).slice(0, ECONOMY.SNITCH_SUSPECTS - 1);
    return shuffled([realId, ...noise]);
}

// Спільна обгортка для всіх пушів від бота: гравець міг заблокувати бота, і це
// не має валити тік по решті гравців.
function sendPush(userId, text) {
    try {
        bot.telegram.sendMessage(String(userId), text, Markup.inlineKeyboard([
            Markup.button.webApp('Відкрити гру', WEB_APP_URL),
        ])).catch(() => {});
    } catch (e) { /* некоректний id (гість у dev-режимі) — ігноруємо */ }
}

// Раз на 5 хвилин: згасання, протухання, видача нових повісток і пуш про те, що
// повістка ось-ось протухне. Кілька сотень профілів обходяться миттєво; від тисячі
// варто буде розбити на пачки зі зміщенням.
// Інспектор приходить сам, коли розшук достатньо високий. Обираємо НАЙСИЛЬНІШОГО
// доступного: чим ти помітніший, тим серйозніші люди тобою займаються.
function maybeSpawnInspector(user, now = Date.now()) {
    if (user.inspector) {
        inspectorTimeout(user);
        return false;
    }
    // Рівень ухилянта (v2.1): інспектори — єдина механіка, яку не можна сховати
    // просто вкладкою (спавняться самі, тиком сервера), тому гейт тут, а не тільки
    // на клієнті.
    if ((user.playerLevel || 1) < 10) return false;
    if (now < (user.inspectorCooldownUntil || 0)) return false;
    // «Довірена людина» (2026-08-16): −20% шансу, що інспектор взагалі спавниться.
    const spawnChance = hasSkill(user, 'trusted')
        ? ECONOMY.INSPECTOR_SPAWN_CHANCE * (1 - ECONOMY.SKILL_INSPECTOR_SPAWN_CUT)
        : ECONOMY.INSPECTOR_SPAWN_CHANCE;
    if (Math.random() >= spawnChance) return false;

    const candidates = INSPECTORS.filter((i) => inspectorAvailable(user, i));
    if (!candidates.length) return false;
    const insp = candidates[candidates.length - 1];

    user.inspector = { id: insp.id, hp: insp.hp, hpMax: insp.hp, startedAt: now, endsAt: now + insp.window * 1000 };
    user.inspectorLastSeen[insp.id] = now;
    sendPush(user.id, `${insp.emoji} ${insp.name} стоїть під дверима. ${insp.taunt}\nУ тебе ${insp.window} секунд, щоб його спекатись.`);
    return true;
}

function tickNotices() {
    const now = Date.now();
    const pushWindow = ECONOMY.NOTICE_PUSH_BEFORE_MIN * 60000;
    // Тижневі речі — у тому ж тіку, окремих інтервалів по всіх гравцях не заводимо.
    try {
        rolloverSeasonIfNeeded();
        matchmakeWarsIfNeeded();
        settleWarsIfNeeded();
        announceWeeklyBest();
        for (const clan of clansDB.values()) {
            settleDistrictRaid(clan);
            maybeStartDistrictRaid(clan);
        }
    } catch (e) {
        console.error('⚠️  Помилка в тижневому тіку:', e.message);
    }
    for (const user of usersDB.values()) {
        try {
            if (!Array.isArray(user.notices)) continue; // ще не мігрований — оживе при першому getUser
            decayHeat(user);
            expireNotices(user);

            if (!noticesBlocked(user)) {
                if (!user.nextNoticeAt) {
                    scheduleNextNotice(user);
                } else if (now >= user.nextNoticeAt) {
                    // При повному ліміті нову не видаємо (замість того, щоб примусово
                    // протухати найстарішу): офлайн-гравець не має ловити подвійний штраф.
                    if (user.notices.length < ECONOMY.NOTICE_MAX_ACTIVE) issueNotice(user);
                    scheduleNextNotice(user);
                }
            }

            maybeSpawnInspector(user, now);
            awardHeatSeasonPoints(user);

            for (const n of user.notices) {
                if (n.pushSent || n.expiresAt - now > pushWindow) continue;
                n.pushSent = true;
                const type = NOTICE_BY_ID[n.typeId];
                const mins = Math.max(1, Math.round((n.expiresAt - now) / 60000));
                logOffline(user, 'bad', `${type.emoji} Прийшла: ${type.name}`);
                sendPush(user.id, `${type.emoji} ${type.name} протухає через ${mins} хв. Далі — штраф і +${type.heatOnExpire} до розшуку.`);
            }
        } catch (e) {
            console.error('⚠️  Помилка в тіку повісток:', e.message);
        }
    }
}
setInterval(tickNotices, ECONOMY.NOTICE_TICK_MS);

// ===== Престиж ("Легалізація") =====
// Скільки очок гравець отримав би, якби легалізувався просто зараз. Корінь означає,
// що кожне наступне очко коштує дедалі більше заробленого — класична idle-крива.
function prestigePointsAvailable(user) {
    const earned = user.totalEarned || 0;
    const total = Math.floor(Math.sqrt(earned / ECONOMY.PRESTIGE_EARN_PER_POINT));
    return Math.max(0, total - (user.prestigePoints || 0));
}

function prestigeMultiplier(user) {
    return 1 + (user.prestigePoints || 0) * ECONOMY.PRESTIGE_BONUS_PER_POINT;
}

// "Наступний крок" (журнал v2.0, розділ 7) — один рядок під шапкою, що каже
// гравцю, куди йти ПРЯМО ЗАРАЗ. Перша спрацьована умова виграє, детерміновано.
// Рахується на сервері (як heat/notices), а не вгадується клієнтом.
function nextStep(user) {
    const now = Date.now();
    const soonNotice = (user.notices || []).find((n) => (n.expiresAt || n.deadline || 0) - now < 60 * 60 * 1000 && (n.expiresAt || n.deadline || 0) > now);
    if (soonNotice) return { icon: '⏰', text: 'Повістка протухає — зніми', tab: 'notices' };

    if (user.inspector && (user.inspector.endsAt || 0) > now) {
        const insp = INSPECTOR_BY_ID[user.inspector.id];
        return { icon: '👮', text: (insp ? insp.name : 'Інспектор') + ' на порозі', tab: 'heatcase' };
    }

    const doneExp = (user.expeditions || []).find((e) => (e.endsAt || 0) <= now);
    if (doneExp) return { icon: '🎒', text: 'Забери здобич з вилазки', tab: 'storage-exp' };

    const used = storageUsed(user), cap = storageCapacity(user);
    if (cap > 0 && used / cap > 0.85) return { icon: '📦', text: 'Кладовка повна — продай/скрафти', tab: 'storage' };

    if (!(user.expeditions || []).length && user.energy > user.maxEnergy * 0.8) {
        return { icon: '🚶', text: 'Відправ вилазку', tab: 'storage-exp' };
    }

    const UPGRADE_NAMES = { hat: 'Шапочка з фольги', jam: 'Закрутка', thermos: 'Термос кави', generator: 'Генератор' };
    for (const key of ['hat', 'jam', 'thermos', 'generator']) {
        const gate = upgradeGateInfo(user, key);
        if (gate) {
            const missing = Object.entries(gate.cost).filter(([r, q]) => (user.resources[r] || 0) < q);
            if (!missing.length) {
                return { icon: '🔓', text: 'Пробий ешелон "' + UPGRADE_NAMES[key] + '"', tab: 'shop' };
            }
            const [resId] = missing[0];
            return { icon: '🧱', text: 'Не вистачає ' + RESOURCE_BY_ID[resId].name + ' для ешелону', tab: 'market' };
        }
    }

    if (user.craftedCount === 0) return { icon: '🔧', text: 'Скрафти щось у кладовці', tab: 'storage' };

    const readyQuest = QUESTS.find((q) => {
        if ((user.claimedQuests || []).includes(q.id)) return false;
        const p = questProgress(user, q);
        return !p.invert && p.have / p.need >= 0.8 && p.have / p.need < 1;
    });
    if (readyQuest) return { icon: '📋', text: '«' + readyQuest.name + '» — майже', tab: 'quests' };

    if (user.level >= ECONOMY.PRESTIGE_UNLOCK_LEVEL && prestigePointsAvailable(user) > 0) {
        return { icon: '🎓', text: 'Час легалізуватись', tab: 'revenge' };
    }

    return { icon: '💰', text: 'Купуй рівні / клікай', tab: 'shop' };
}

// Уламки для склейки донатних ящиків (2026-08-13): кожен безкоштовний ящик має
// шанс подарувати уламок ТІЛЬКИ свого відповідного донатного ящика — окремий
// незалежний бонус-ролл ~0.05%, поза звичайною таблицею лута (щоб не займатись
// перебалансуванням усіх вагів у CRATES заради однієї рідкісної події).
const SHARD_BONUS_CHANCE = 0.0005;
const CRATE_SHARD_BONUS = {
    cardboard: 'shard_starter', humanitarian: 'shard_elite',
    parcel: 'shard_wardrobe', contraband: 'shard_legendary',
};

// Розкриває один ящик: обирає дроп за вагами і одразу застосовує ефект до гравця.
// Повертає опис результату для анімації на клієнті.
function rollCrate(user, crate) {
    const result = rollCrateEntry(user, crate);
    const shardRes = CRATE_SHARD_BONUS[crate.id];
    if (shardRes && Math.random() < SHARD_BONUS_CHANCE) {
        const meta = RESOURCE_BY_ID[shardRes];
        addResource(user, shardRes, 1);
        result.bonusShard = { resId: shardRes, name: meta.name, emoji: meta.emoji };
        result.desc = (result.desc || '') + ` + 🧩 рідкісна знахідка: ${meta.name}!`;
    }
    return result;
}

function rollCrateEntry(user, crate) {
    user.cratesOpened[crate.id] = (user.cratesOpened[crate.id] || 0) + 1;
    user.boxesOpened = (user.boxesOpened || 0) + 1;
    user.dailyBoxes = (user.dailyBoxes || 0) + 1;

    // Ящики з guaranteedCosmetic обіцяють у описі ГАРАНТОВАНУ річ у гардероб —
    // тому тут не крутимо таблицю, а видаємо косметику напряму плюс бонус монетами.
    // Інакше опис брехав би (у таблиці косметика має лише частину ваги), а це
    // платний ящик за Stars.
    let entry;
    if (crate.guaranteedCosmetic) {
        entry = { type: 'cosmetic', guaranteedBonus: 30000 };
    } else {
        entry = crate.loot[pickWeighted(crate.loot)];
    }

    if (entry.type === 'nothing') {
        return { kind: 'nothing', title: 'Пусто...', emoji: '🧦', img: '/images/gacha-scam-socks.webp', desc: 'Тільки діряві шкарпетки. Буває.' };
    }
    if (entry.type === 'coins') {
        const base = entry.min + Math.random() * (entry.max - entry.min);
        const amount = Math.round(base * heatIncomeMult(user));
        user.balance += amount;
        return { kind: 'coins', title: 'Готівка!', emoji: '🪙', img: '/images/gacha-jackpot.webp', amount, desc: `+${amount.toLocaleString('uk-UA')} ТК` };
    }
    if (entry.type === 'energy') {
        user.energy = user.maxEnergy;
        return { kind: 'energy', title: 'Павербанк', emoji: '🔋', img: '/images/gacha-powerbank.webp', desc: 'Енергію відновлено повністю!' };
    }
    if (entry.type === 'granny') {
        // Класичний clicker-товар: бабуся клікає замість тебе, але енергію
        // витрачає твою — тож це прискорення, а не безкоштовні гроші.
        user.grannyUntil = Math.max(Date.now(), user.grannyUntil || 0) + ECONOMY.GRANNY_MINUTES * 60000;
        return {
            kind: 'granny', title: 'Бабуся клікає за тебе!', emoji: '👵',
            desc: `${ECONOMY.GRANNY_MINUTES} хвилин по ${ECONOMY.GRANNY_CPS} кліки/сек. Енергія витрачається твоя.`,
        };
    }
    if (entry.type === 'cosmetic') {
        const notOwned = COSMETICS.filter((c) => !user.ownedCosmetics.includes(c.id));
        if (notOwned.length === 0) {
            // Збирати вже нічого — компенсуємо монетами, інакше платний ящик дав би пустоту.
            const compensation = entry.guaranteedBonus ? 60000 : 20000;
            user.balance += compensation;
            return {
                kind: 'coins', title: 'Гардероб повний', emoji: '🪙', img: '/images/gacha-jackpot.webp',
                amount: compensation, desc: `Все вже є — тобі компенсували ${compensation.toLocaleString('uk-UA')} ТК`,
            };
        }
        const pick = notOwned[Math.floor(Math.random() * notOwned.length)];
        user.ownedCosmetics.push(pick.id);
        let desc = pick.name;
        if (entry.guaranteedBonus) {
            user.balance += entry.guaranteedBonus;
            desc += ` + ${entry.guaranteedBonus.toLocaleString('uk-UA')} ТК зверху`;
        }
        return { kind: 'cosmetic', title: 'Рідкісна річ!', emoji: pick.emoji || '👕', img: pick.img, desc, cosmeticId: pick.id };
    }
    // entry.type === 'res'
    const meta = RESOURCE_BY_ID[entry.res];
    const amount = Math.round(entry.min + Math.random() * (entry.max - entry.min));
    const { added, lost } = addResource(user, entry.res, amount);
    return {
        kind: 'res', title: meta.name, emoji: meta.emoji, img: meta.img, resId: entry.res, amount: added, lost,
        desc: lost > 0 ? `+${added} ${meta.emoji} (${lost} згоріло — кладовка повна!)` : `+${added} ${meta.emoji}`,
    };
}

// ==========================================
// 4. ТІНЬОВА БІРЖА (симуляція курсу)
// ==========================================
const marketState = { prices: {}, history: {} };
MARKET_ASSETS.forEach((a) => {
    marketState.prices[a.id] = a.basePrice;
    marketState.history[a.id] = [a.basePrice];
});

function tickMarket() {
    for (const asset of MARKET_ASSETS) {
        const cur = marketState.prices[asset.id];
        const changePct = Math.random() * 0.3 - 0.15; // -15%..+15%
        let next = Math.round(cur * (1 + changePct));
        next = Math.max(Math.round(asset.basePrice * 0.2), Math.min(Math.round(asset.basePrice * 5), next));
        marketState.prices[asset.id] = next;
        marketState.history[asset.id].push(next);
        if (marketState.history[asset.id].length > 20) marketState.history[asset.id].shift();
    }
}
setInterval(tickMarket, 3 * 60 * 1000);

// ==========================================
// 5. ПЕРЕВІРКА ПІДПИСУ TELEGRAM WEBAPP (initData) — lib/auth.js
// Захищає API від підробки чужого id: без цього будь-хто міг би дзвонити
// /api/save, /api/invoice тощо з чужим Telegram id і красти чужий прогрес/оплати.
// ==========================================
const { requireTelegramAuth } = require('./lib/auth').createAuth({ BOT_TOKEN, DEV_MODE_INSECURE, usersDB });

// ==========================================
// 6. ЛОГІКА TELEGRAM-БОТА
// ==========================================
bot.start(async (ctx) => {
    const userId = String(ctx.from.id);
    const name = ctx.from.first_name || 'Ухилянт';
    const existedBefore = usersDB.has(userId);
    const user = getUser(userId, name);

    const refId = ctx.payload ? String(ctx.payload).trim() : null;
    let welcomeText = 'Вітаю у "Симуляторі Ухилянта" V3.0! 🏃‍♂️💨\n\nНові локації, компаньйони, тіньова біржа, клани, квести та Колесо Фортуни. Виживай та заробляй!';

    // Реферальний бонус нараховується лише для СПРАВДІ нового користувача,
    // інакше друзі могли б фармити бонус, перезапускаючи бота за різними лінками.
    if (refId && refId !== userId && !existedBefore && usersDB.has(refId)) {
        user.refBy = refId;
        const referrer = usersDB.get(refId);
        referrer.balance += ECONOMY.REFERRAL_REWARD;
        referrer.refCount += 1;
        welcomeText = `Тебе здав друг (ID: ${refId})! Але ти встиг сховатися і навіть приніс йому ${ECONOMY.REFERRAL_REWARD} 🪙 бонусу. Починай грати!`;
        try {
            await bot.telegram.sendMessage(refId, `🤝 Твій друг ${name} заліг на дно за твоїм посиланням! +${ECONOMY.REFERRAL_REWARD} 🪙 на баланс.`);
        } catch (e) {
            // Друг міг заблокувати бота — це не критично, просто ігноруємо.
        }
    }

    ctx.reply(welcomeText, Markup.inlineKeyboard([
        Markup.button.webApp('🛋 Залягти на дно (Грати)', WEB_APP_URL)
    ]));

    // Питаємо про рекламу лише поки гравець ще не відповідав — байдуже, якою
    // була відповідь минулого разу, повторно не турбуємо.
    if (user.adConsent === null) {
        try {
            await ctx.reply(
                'Ще одне: можна іноді надсилати в цей чат рекламні повідомлення?\n' +
                `За згоду — одразу +${ECONOMY.AD_CONSENT_BONUS} 🪙 на баланс. І чим більше друзів погодиться, ` +
                'тим частіше в грі падатимуть аірдропи та інша халява — усім одразу.',
                Markup.inlineKeyboard([
                    Markup.button.callback('✅ Так, дозволяю', 'ad_consent_yes'),
                    Markup.button.callback('❌ Ні, дякую', 'ad_consent_no'),
                ])
            );
        } catch (e) { /* не критично, якщо не надіслалось */ }
    }
});

// Одноразове опитування про згоду на рекламу в чаті. Відповідь фіксується
// назавжди — повторно питання не зʼявляється незалежно від вибору.
async function answerAdConsent(ctx, consent) {
    const userId = String(ctx.from.id);
    const user = getUser(userId, ctx.from.first_name || 'Ухилянт');
    if (user.adConsent !== null) {
        return ctx.answerCbQuery('Ти вже відповідав на це питання.');
    }
    user.adConsent = consent;
    if (consent) user.balance += ECONOMY.AD_CONSENT_BONUS;
    // Callback-запит "старіє" за ~15с (повільне з'єднання, редагування) — без
    // try/catch ця помилка йшла необроблено, і саме тут її й ловили найчастіше.
    try {
        await ctx.answerCbQuery(consent ? `+${ECONOMY.AD_CONSENT_BONUS} 🪙!` : 'Зрозуміло, не будемо.');
    } catch (e) { /* не критично — баланс і відповідь уже записані */ }
    try {
        await ctx.editMessageText(consent
            ? `✅ Дякую! +${ECONOMY.AD_CONSENT_BONUS} 🪙 на баланс. Зараз згодних: ${adConsentCount()} — саме вони й тримають на плаву аірдропи для всіх.`
            : '❌ Без проблем, більше не питатиму.');
    } catch (e) { /* повідомлення могло бути надто старим для редагування — не критично */ }
}
bot.action('ad_consent_yes', (ctx) => answerAdConsent(ctx, true));
bot.action('ad_consent_no', (ctx) => answerAdConsent(ctx, false));

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

// Журнал мікротранзакцій для адмінки (2026-08-15) — не бухгалтерія, а швидкий
// огляд "хто й що щойно купив". Не персистентний навмисно (як offlineLog):
// останні N записів у пам'яті, обмежений розмір, щоб не текти.
const PAYMENT_LOG_SIZE = 300;
const paymentLog = [];
function logPayment(entry) {
    paymentLog.unshift({ ...entry, at: Date.now() });
    if (paymentLog.length > PAYMENT_LOG_SIZE) paymentLog.length = PAYMENT_LOG_SIZE;
}

// Обробка оплат Telegram Stars
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [type, userId] = payload.split('_');
    const user = getUser(userId, ctx.from.first_name);
    const starsAmount = ctx.message.successful_payment.total_amount;
    logPayment({ userId, userName: displayName(user), type, stars: starsAmount });

    if (type === 'vip') {
        user.isVip = true;
        ctx.reply('🎉 Оплата успішна! Ти отримав VIP-Схрон: x3 дохід, безлімітна енергія та імунітет до Облав. Перезапусти гру, щоб побачити зміни.');
    } else if (type.startsWith('crate-')) {
        // Ящик за Stars: розкриваємо одразу на сервері, результат чекає гравця в грі
        // (клієнт забирає його через /api/user?consume=1 і програє анімацію).
        const crate = CRATE_BY_ID[type.slice('crate-'.length)];
        if (crate) {
            const reward = rollCrate(user, crate);
            user.lastPremiumReward = { ...reward, crateId: crate.id };
            ctx.reply(`🎉 Оплата успішна! ${crate.name}: ${reward.title} — ${reward.desc}`);
        } else {
            ctx.reply('🎉 Оплата успішна!');
        }
    } else if (type.startsWith('defer-')) {
        const def = DEFERMENT_BY_ID[type.slice('defer-'.length)];
        if (def) {
            grantDeferment(user, def);
            ctx.reply(`🎉 Оплата успішна! ${def.emoji} ${def.name} на ${Math.round(def.hours / 24)} діб. ${def.flavor}.`);
        } else {
            ctx.reply('🎉 Оплата успішна!');
        }
    } else if (type === 'donate') {
        ctx.reply('❤️ Дякуємо за підтримку розробників! Жодних ігрових бонусів це не дає — просто дуже приємно. Ти найкращий.');
    } else if (type.startsWith('nickchange-')) {
        // Нік декодуємо з САМОГО payload (те, за що реально заплачено), а не з
        // мінливого user.pendingNickname — інакше друге requestChange до оплати
        // першого інвойсу застосувало б не той нік, що показувався при оплаті.
        // Унікальність звіряємо ще раз: хтось міг зайняти цей нік, поки йшла оплата.
        let pending = null;
        try { pending = Buffer.from(type.slice('nickchange-'.length), 'base64').toString('utf8'); } catch (e) { /* зіпсований payload */ }
        if (pending && !nicknameTaken(pending, user.id)) {
            user.nickname = pending;
            if (user.pendingNickname === pending) user.pendingNickname = null;
            ctx.reply(`🎉 Оплата успішна! Новий нік: ${pending}`);
        } else {
            ctx.reply('⚠️ Оплата пройшла, але цей нік щойно зайняли. Напиши розробнику — компенсуємо або підберемо інший нік без повторної оплати.');
        }
    } else {
        ctx.reply('🎉 Оплата успішна!');
    }
});

// ==========================================
// 7. API СЕРВЕРА
// ==========================================

// Створення інвойсу на Telegram Stars (XTR). provider_token порожній —
// для цифрових товарів за Stars окремий платіжний провайдер не потрібен.
app.post('/api/invoice', requireTelegramAuth, async (req, res) => {
    try {
        const id = req.telegramUser.id;
        const { type } = req.body;

        let title, description, amount, payloadPrefix;
        if (type === 'vip') {
            title = 'VIP-Схрон';
            description = 'Х3 клік, безлімітна енергія, захист від Облав!';
            amount = ECONOMY.VIP_PRICE_STARS;
            payloadPrefix = 'vip';
        } else if (type === 'crate') {
            const crate = CRATE_BY_ID[req.body.crateId];
            if (!crate || crate.currency !== 'stars') {
                return res.status(400).json({ error: 'Невідомий ящик' });
            }
            title = crate.name;
            description = crate.desc;
            amount = crate.price;
            payloadPrefix = 'crate-' + crate.id;
        } else if (type === 'deferment') {
            const def = DEFERMENT_BY_ID[req.body.defermentId];
            if (!def || !def.cost.stars) return res.status(400).json({ error: 'Ця відстрочка не купується за ⭐' });
            title = def.name;
            description = def.flavor;
            amount = def.cost.stars;
            payloadPrefix = 'defer-' + def.id;
        } else if (type === 'donate') {
            const requested = Number(req.body.amount);
            if (!ECONOMY.DONATE_AMOUNTS.includes(requested)) {
                return res.status(400).json({ error: 'Невірна сума підтримки' });
            }
            title = 'Підтримка розробників';
            description = 'Щиро дякуємо! Це не дає ігрових бонусів — просто підтримка проєкту.';
            amount = requested;
            payloadPrefix = 'donate';
        } else if (type === 'nickname_change') {
            const requester = getUser(id, req.telegramUser.first_name);
            if (!requester.pendingNickname) {
                return res.status(400).json({ error: 'Спочатку введи новий нік' });
            }
            title = 'Зміна ніка';
            description = `Новий нік: ${requester.pendingNickname}`;
            amount = ECONOMY.NICKNAME_CHANGE_PRICE_STARS;
            // Нік вшитий прямо в payload (base64, без підкреслень — не ламає розбір
            // "type_userId_ts" по "_"), а не читається з мінливого pendingNickname:
            // інакше друге requestChange (нова бажана назва) ДО оплати першого
            // інвойсу підмінило б нік, який застосується після оплати старого.
            payloadPrefix = 'nickchange-' + Buffer.from(requester.pendingNickname, 'utf8').toString('base64');
        } else {
            return res.status(400).json({ error: 'Невідомий тип покупки' });
        }

        const invoiceLink = await bot.telegram.createInvoiceLink({
            title,
            description,
            payload: `${payloadPrefix}_${id}_${Date.now()}`,
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: title, amount }],
        });
        res.json({ link: invoiceLink });
    } catch (e) {
        console.error('Помилка створення інвойсу:', e);
        res.status(500).json({ error: 'Помилка генерації інвойсу' });
    }
});

// Стан гравця при завантаженні (для персистентності між сесіями) + офлайн-прогрес.
app.get('/api/user', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const today = new Date().toDateString();
    resetDailyIfNeeded(user);
    // Тиждень міг змінитись, поки процес стояв без запитів, — підбиваємо підсумки
    // сезону й розводимо війни ДО того, як зібрати відповідь для гравця.
    rolloverSeasonIfNeeded();
    matchmakeWarsIfNeeded();
    settleWarsIfNeeded();
    const offlineEarnings = applyOfflineProgress(user);
    // Звіт «поки тебе не було» збираємо ПІСЛЯ нарахування пасиву й після
    // syncHeatAndNotices у getUser — тобто коли всі офлайн-події вже застосовані.
    const offlineReport = takeOfflineReport(user);
    if (offlineReport) offlineReport.earnings = offlineEarnings;
    // Підсумки сезону віддаємо РІВНО ОДИН раз — далі гравець їх уже бачив.
    const seasonResult = user.seasonResult;
    if (seasonResult) user.seasonResult = null;
    const clan = getClanInfo(user);
    const response = {
        id: user.id,
        name: user.name,
        balance: user.balance,
        clickVal: user.clickVal,
        passive: user.passive,
        level: user.level,
        energy: user.energy,
        maxEnergy: user.maxEnergy,
        isVip: user.isVip,
        refCount: user.refCount,
        dailyClaimed: user.dailyClaimedDate === today,
        dailyStreak: user.dailyStreak,
        lastPremiumReward: user.lastPremiumReward,
        offlineEarnings,
        offlineReport,
        seasonResult,
        totalClicks: user.totalClicks,
        boxesOpened: user.boxesOpened,
        raidsSurvived: user.raidsSurvived,
        achievements: user.achievements,
        ownedPets: user.ownedPets,
        petId: user.petId,
        ownedCosmetics: user.ownedCosmetics,
        equippedCosmetics: user.equippedCosmetics,
        ownedRoomItems: user.ownedRoomItems,
        equippedRoomItems: user.equippedRoomItems,
        revengeUnlocked: user.raidsSurvived >= ECONOMY.REVENGE_UNLOCK_RAIDS,
        revengeClaimedToday: user.revengeLastDate === today,
        portfolio: user.portfolio,
        clanId: clan.clanId,
        clanName: clan.clanName,
        clanBonus: clan.bonus,
        clanLevel: clan.clanLevel || 0,
        clanTreasury: clan.treasury || 0,
        clanNextLevelCost: clan.nextLevelCost,
        clanMyContribution: clan.myContribution || 0,
        wheelClaimedToday: user.wheelLastSpinDate === today,
        balanceRev: user.balanceRev,
        dailyDeal: { crateId: dailyDealCrateId(), off: DAILY_DEAL_OFF },
        // Кладовка, крафт, багаторівневі апгрейди
        resources: user.resources,
        storageLevel: user.storageLevel,
        storageCapacity: storageCapacity(user),
        storageUsed: storageUsed(user),
        storageUpgradeCost: user.storageLevel >= ECONOMY.STORAGE_MAX_LEVEL ? null : storageUpgradeCost(user),
        upgrades: user.upgrades,
        upgTiersUnlocked: user.upgTiersUnlocked,
        upgradeCosts: {
            hat: upgradeCost(user, 'hat'), jam: upgradeCost(user, 'jam'),
            thermos: upgradeCost(user, 'thermos'), generator: upgradeCost(user, 'generator'),
        },
        upgradeGates: {
            hat: upgradeGateInfo(user, 'hat'), jam: upgradeGateInfo(user, 'jam'),
            thermos: upgradeGateInfo(user, 'thermos'), generator: upgradeGateInfo(user, 'generator'),
        },
        craftedCount: user.craftedCount,
        cratesOpened: user.cratesOpened,
        shieldUntil: user.shieldUntil,
        permanentShield: user.permanentShield,
        resourcesCollected: user.resourcesCollected,
        ...expeditionSnapshot(user),
        expeditionsDone: user.expeditionsDone,
        totalEarned: user.totalEarned,
        prestigePoints: user.prestigePoints,
        prestigeCount: user.prestigeCount,
        prestigeMultiplier: prestigeMultiplier(user),
        prestigeAvailable: prestigePointsAvailable(user),
        seasonPoints: user.seasonPoints || 0,
        deceivedCount: user.deceivedCount || 0,
        pid: user.pid,
        snitchStats: user.snitchStats,
        snitchesLeft: Math.max(0, ECONOMY.SNITCH_DAILY_LIMIT - (user.snitchesToday || 0)),
        freeSnitchCount: (user.freeSnitchOn || []).length,
        investigationPending: (user.snitchedBy || []).some((e) => !e.investigated),
        trophies: user.trophies || [],
        mapBuildings: user.mapBuildings,
        mapPlacements: user.mapPlacements || { tower: null, hideout: null, cache: null },
        nickname: user.nickname,
        sprintsEnabled: !!ECONOMY.SPRINTS_V2,
        xp: user.xp || 0, playerLevel: user.playerLevel || 1, ukhyr: user.ukhyr || 0,
        memoryGame: user.memoryGame ? {
            cardsCount: user.memoryGame.deck.length, revealed: user.memoryGame.revealed,
            matchedPairs: user.memoryGame.matchedPairs, flips: user.memoryGame.flips,
            firstPick: user.memoryGame.firstPick,
        } : null,
        nextStep: nextStep(user),
        medcomStats: user.medcomStats,
        inspectorStats: user.inspectorStats,
        checkpointStats: user.checkpointStats,
        mykolaCoverUsed: !!user.mykolaCoverUsed,
        adConsent: user.adConsent, adConsentCount: adConsentCount(), adAirdropMult: adConsentAirdropMult(),
        defermentsTaken: user.defermentsTaken || 0,
        ...defermentSnapshot(user),
        ...skillsSnapshot(user),
        ...reputationSnapshot(user),
        ...seasonSnapshot(user),
        ...warSnapshot(user),
        ...inspectorSnapshot(user),
        ...heatSnapshot(user, true),
        ...noticeSnapshot(user),
    };
    // Крадіжку показуємо один раз — так само, як преміальну нагороду з ящика.
    if (user.pendingRobbery) {
        response.robbery = user.pendingRobbery;
        if (req.query.consume === '1') user.pendingRobbery = null;
    }
    // ?consume=1 — забрати одноразову преміальну нагороду, щоб вона не показувалась повторно
    if (req.query.consume === '1') user.lastPremiumReward = null;
    res.json(response);
});

// Автозбереження ігрового стану. isVip/refCount/dailyClaimedDate/petId/clanId НАВМИСНО ігноруються —
// цими полями керує лише сервер (через промокоди/оплати/щоденку/дедіковані ендпоінти), щоб клієнт
// не міг підмінити їх напряму в тілі запиту. Баланс/апгрейди/лічильники лишаються клієнт-авторитетними —
// це жартівливий проєкт для друзів, а не додаток з захистом від чит-інженерії.
app.post('/api/save', requireTelegramAuth, (req, res) => {
    const { balance, clickVal, passive, level, energy, maxEnergy, totalClicks, boxesOpened, raidsSurvived } = req.body;
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    // Клік/бокси/облави клієнт шле як лічильники "за все життя" — приріст із моменту
    // попереднього збереження додаємо до денного прогресу квестів.
    const clickDelta = typeof totalClicks === 'number' ? Math.max(0, totalClicks - user.totalClicks) : 0;
    if (typeof totalClicks === 'number') user.dailyClicks += clickDelta;
    if (typeof boxesOpened === 'number') user.dailyBoxes += Math.max(0, boxesOpened - user.boxesOpened);
    // Облави відбиваються на клієнті (QTE), тому сезонні й воєнні очки за них
    // нараховуємо тут, за приростом лічильника.
    let levelsGained = 0;
    const raidDelta = typeof raidsSurvived === 'number' ? Math.max(0, raidsSurvived - user.raidsSurvived) : 0;
    if (raidDelta > 0) {
        user.dailyRaids += raidDelta;
        user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.SEASON_RAID_SP * raidDelta;
        addWarPoints(user, ECONOMY.WAR_POINTS_RAID * raidDelta, 'пережив облаву');
        levelsGained += addXP(user, 25 * raidDelta);
        addUkhyr(user, 10 * raidDelta);
    }

    // Розшук росте від самої активності. Рахуємо сотнями кліків, залишок носимо в
    // clickHeatCarry — інакше при збереженні раз на 5 секунд приріст губився б в округленні.
    if (clickDelta > 0) {
        user.clickHeatCarry = (user.clickHeatCarry || 0) + clickDelta;
        const hundreds = Math.floor(user.clickHeatCarry / 100);
        if (hundreds > 0) {
            user.clickHeatCarry -= hundreds * 100;
            changeHeat(user, hundreds * ECONOMY.HEAT_PER_100_CLICKS, `Активність (${hundreds * 100} кліків)`);
            levelsGained += addXP(user, hundreds * 5);
        }
    }
    // Переїзд у новий схрон помічають сусіди. Ловимо тут, бо покупку локації робить
    // клієнт (window.buy) і окремого серверного роуту для неї немає.
    if (typeof level === 'number' && level > user.level) {
        changeHeat(user, ECONOMY.HEAT_NEW_LOCATION * (level - user.level), 'Переїзд у новий схрон');
        levelsGained += addXP(user, 150 * (level - user.level));
        addUkhyr(user, 50 * (level - user.level));
    }

    // Баланс приймаємо лише якщо клієнт бачив актуальну серверну ревізію. Інакше його
    // значення застаріле (сервер щойно нарахував дроп із ящика / списав за крафт) —
    // тоді лишаємо серверне і повідомляємо клієнту, щоб він підхопив авторитетне.
    const clientRev = Number(req.body.balanceRev);
    const balanceAccepted = Number.isFinite(clientRev) && clientRev === user.balanceRev;
    if (balanceAccepted && typeof balance === 'number') user.balance = balance;

    // Сила кліку й пасив ростуть ТІЛЬКИ через серверні роути (апгрейди, крафт,
    // престиж), тому в гравця з історією серверне значення повне й авторитетне:
    // приймаємо клієнтське, лише якщо воно не БІЛЬШЕ. Інакше підроблений clickVal
    // у /api/save давав би миттєву перемогу над Генералом Півником разом із Білим
    // Квитком, а роздутий passive — нескінченний офлайн-дохід.
    //
    // АЛЕ: диск Render не переживає редеплой, і після нього сервер бачить свіжого
    // гравця з clickVal=1. Якби ми обрізали й тут, кожен редеплой обнуляв би силу
    // кліку всім, у кого не спрацювало відновлення з CloudStorage. Тому поки сервер
    // не бачив у гравця жодної покупки, крафту чи легалізації — довіряємо клієнту.
    const serverKnowsPlayer = Object.values(user.upgrades || {}).some((n) => n > 0)
        || (user.craftedCount || 0) > 0 || (user.prestigeCount || 0) > 0;
    if (typeof clickVal === 'number' && isFinite(clickVal)) {
        user.clickVal = serverKnowsPlayer ? Math.max(1, Math.min(clickVal, user.clickVal)) : Math.max(1, clickVal);
    }
    if (typeof passive === 'number' && isFinite(passive)) {
        user.passive = serverKnowsPlayer ? Math.max(0, Math.min(passive, user.passive)) : Math.max(0, passive);
    }
    if (typeof level === 'number') user.level = level;
    if (typeof energy === 'number') user.energy = energy;
    if (typeof maxEnergy === 'number') user.maxEnergy = maxEnergy;
    if (typeof totalClicks === 'number') user.totalClicks = totalClicks;
    if (typeof boxesOpened === 'number') user.boxesOpened = boxesOpened;
    if (typeof raidsSurvived === 'number') user.raidsSurvived = raidsSurvived;
    user.lastSeenAt = Date.now();

    const unlocked = checkAchievements(user);
    // Тебе обікрали, поки ти грав: баланс уже зменшив сервер (і ревізія зросла, тому
    // наш баланс вище відхилено). Віддаємо подію РІВНО ОДИН раз, щоб клієнт показав
    // "−N ТК 🐍", а не тихо відкотив цифру й лишив гравця в подиві.
    const robbery = user.pendingRobbery;
    if (robbery) user.pendingRobbery = null;
    // heat і повістки їдуть у кожній відповіді автозбереження (раз на 5с) — так клієнт
    // дізнається про повістку, що прийшла, поки він грав, без окремого полінгу.
    res.json({
        ok: true, balance: user.balance, balanceRev: user.balanceRev,
        balanceRejected: !balanceAccepted, unlockedAchievements: unlocked,
        // Віддаємо авторитетні clickVal/passive: якщо клієнт надіслав більше,
        // ніж сервер колись видав, він має підхопити правильні значення.
        clickVal: user.clickVal, passive: user.passive,
        robbery, snitchesLeft: Math.max(0, ECONOMY.SNITCH_DAILY_LIMIT - (user.snitchesToday || 0)),
        investigationPending: (user.snitchedBy || []).some((e) => !e.investigated),
        deferUntil: user.deferUntil || 0,
        xp: user.xp || 0, playerLevel: user.playerLevel || 1, levelsGained, ukhyr: user.ukhyr || 0,
        ...inspectorSnapshot(user), ...heatSnapshot(user), ...noticeSnapshot(user), nextStep: nextStep(user),
    });
});

// Відновлення прогресу з резервної копії, яку клієнт тримає в Telegram CloudStorage
// (переживає редеплой на Render — на відміну від диску сервера, який скидається при
// новому контейнері). Викликається лише коли сервер бачить "свіжого" гравця (без
// прогресу), а в CloudStorage лежить копія зі старим прогресом. Без анти-чіт перевірок —
// жартівливий проєкт для друзів, довіряємо клієнту так само, як і в /api/save.
// Усе, що гравець заробив і що має пережити скидання диска Render. Додаєш нове
// поле прогресу — додай його і сюди, інакше відновлення з CloudStorage мовчки
// поверне гравця без нього.
const RESTORE_NUMBER_FIELDS = ['balance', 'clickVal', 'passive', 'level', 'energy', 'maxEnergy', 'totalClicks', 'boxesOpened', 'raidsSurvived', 'refCount', 'dailyStreak', 'tradesCount', 'wheelSpinsCount', 'storageLevel', 'craftedCount', 'shieldUntil', 'resourcesCollected', 'expeditionsDone', 'totalEarned', 'prestigePoints', 'prestigeCount', 'heat', 'seasonPoints', 'deceivedCount', 'deferUntil', 'skillResetsUsed',
    'defermentsTaken', 'league', 'pendingWarCrate', 'xp', 'playerLevel', 'ukhyr',
    // Спринти: burnout/focusStat/routeProgress — довгограючий прогрес, його треба
    // пережити редеплой. activeSprint тут НЕМА свідомо: це об'єкт (сюди беруться
    // лише числа) і водночас короткоживучий стан — недописаний контракт після
    // редеплою просто починається заново.
    'burnout', 'focusStat', 'routeProgress'];
const RESTORE_ARRAY_FIELDS = ['achievements', 'ownedPets', 'ownedCosmetics', 'ownedRoomItems', 'equippedRoomItems', 'trophies', 'redeemedPromos'];
// Об'єкти-словники: беремо лише числові/булеві значення за відомими ключами,
// щоб бекап не міг підсунути довільну структуру.
const RESTORE_MAP_FIELDS = ['reputation', 'skills', 'snitchStats', 'medcomStats', 'checkpointStats', 'noticeStats', 'mapBuildings', 'upgTiersUnlocked'];
app.post('/api/restore', requireTelegramAuth, (req, res) => {
    const backup = req.body.backup;
    if (!backup || typeof backup !== 'object') return res.status(400).json({ error: 'Порожня резервна копія' });
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);

    for (const f of RESTORE_NUMBER_FIELDS) {
        if (typeof backup[f] === 'number' && isFinite(backup[f])) user[f] = backup[f];
    }
    // ВАЖЛИВО саме після циклу: присвоєння user.balance вище пройшло через акцесор,
    // який накрутив totalEarned на суму відновленого балансу. Перезаписуємо правильним
    // значенням з бекапу, інакше очки престижу роздувались би після кожного відновлення.
    if (typeof backup.totalEarned === 'number' && isFinite(backup.totalEarned)) {
        user.totalEarned = backup.totalEarned;
    }
    for (const f of RESTORE_ARRAY_FIELDS) {
        if (Array.isArray(backup[f])) user[f] = backup[f];
    }
    // Словники відновлюємо по ключах, які ВЖЕ є у гравця: так бекап не може
    // ані додати невідому навичку, ані підсунути об'єкт замість числа.
    for (const f of RESTORE_MAP_FIELDS) {
        const src = backup[f];
        if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
        for (const key of Object.keys(user[f] || {})) {
            const v = src[key];
            if (typeof v === 'number' && isFinite(v)) user[f][key] = v;
            else if (typeof v === 'boolean') user[f][key] = v;
        }
    }
    // Навички — окремо: ключів у свіжого гравця немає, тому звіряємось із каталогом.
    if (backup.skills && typeof backup.skills === 'object') {
        for (const id of Object.keys(SKILL_BY_ID)) {
            if (backup.skills[id]) user.skills[id] = true;
        }
    }
    // maxEnergy із бекапу ВЖЕ містить бонус від навичок, тому лише синхронізуємо
    // бухгалтерію, не чіпаючи саме число: інакше applySkillLimits нарахував би
    // цей бонус удруге.
    user.skillEnergyBonus = (hasSkill(user, 'hardened') ? ECONOMY.SKILL_MAX_ENERGY_BONUS : 0)
        + (hasSkill(user, 'sturdyback') ? ECONOMY.SKILL_STURDYBACK_MAX_ENERGY : 0);
    // Перемоги над інспекторами лежать вкладеним словником, тому окремо й лише
    // за відомими id — щоб бекап не вигадав неіснуючого боса.
    if (backup.inspectorStats && typeof backup.inspectorStats === 'object') {
        const src = backup.inspectorStats.defeated;
        if (src && typeof src === 'object') {
            for (const insp of INSPECTORS) {
                if (typeof src[insp.id] === 'number' && isFinite(src[insp.id])) {
                    user.inspectorStats.defeated[insp.id] = Math.max(0, Math.floor(src[insp.id]));
                }
            }
        }
        if (typeof backup.inspectorStats.lost === 'number') user.inspectorStats.lost = backup.inspectorStats.lost;
    }
    if (typeof backup.seasonTitle === 'string') user.seasonTitle = backup.seasonTitle.slice(0, 60);
    // Нік можна купити за реальні Stars — без відновлення редеплой Render (диск не
    // переживає) стирав би оплачений нік назавжди. Перевіряємо унікальність ще раз:
    // після скидання диска хтось інший міг устигнути зайняти той самий нік.
    if (typeof backup.nickname === 'string' && backup.nickname && !user.nickname) {
        const candidate = backup.nickname.trim();
        if (!validateNickname(candidate, user.id)) user.nickname = candidate;
    }
    // Позиції іконок на карті — {x,y} об'єкти, не число/bool, тому окремо від
    // RESTORE_MAP_FIELDS, і лише за відомими ключами будівель.
    if (backup.mapPlacements && typeof backup.mapPlacements === 'object') {
        if (!user.mapPlacements) user.mapPlacements = { tower: null, hideout: null, cache: null };
        for (const key of Object.keys(user.mapPlacements)) {
            const p = backup.mapPlacements[key];
            if (p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number'
                && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100) {
                user.mapPlacements[key] = { x: p.x, y: p.y };
            }
        }
    }

    // Чати ОСББ живуть лише на диску Render, а він не переживає редеплой: гравець
    // повертався з CloudStorage зі своїм clanId, але самого чату вже не існувало —
    // і чат «пропадав» разом із бонусом до пасиву. Відновлюємо його з бекапу
    // учасника: скарбницю не врятувати, але сам чат і склад — так. Ідемпотентно,
    // тому кілька учасників, що заходять один за одним, зберуться в той самий чат.
    const bId = typeof backup.clanId === 'string' ? backup.clanId.slice(0, 40) : null;
    const bName = typeof backup.clanName === 'string' ? backup.clanName.trim().slice(0, 30) : null;
    if (bId && bName) {
        let clan = clansDB.get(bId);
        if (!clan) {
            clan = { id: bId, name: bName, ownerId: user.id, members: [], treasury: 0, contributions: {}, restored: true };
            clansDB.set(bId, clan);
            console.log(`🏘 Відновлено чат ОСББ «${bName}» з резервної копії гравця.`);
        }
        if (!clan.members.includes(user.id)) clan.members.push(user.id);
        user.clanId = bId;
    }
    if (typeof backup.defermentId === 'string' && DEFERMENT_BY_ID[backup.defermentId]) {
        user.defermentId = backup.defermentId;
    }
    if (backup.petId === null || typeof backup.petId === 'string') user.petId = backup.petId;
    if (backup.equippedCosmetics && typeof backup.equippedCosmetics === 'object') {
        user.equippedCosmetics = {
            hat: backup.equippedCosmetics.hat ?? null,
            face: backup.equippedCosmetics.face ?? null,
            neck: backup.equippedCosmetics.neck ?? null,
            frame: backup.equippedCosmetics.frame ?? null,
        };
    }
    if (backup.portfolio && typeof backup.portfolio === 'object') user.portfolio = backup.portfolio;
    if (typeof backup.isVip === 'boolean') user.isVip = backup.isVip;
    if (typeof backup.permanentShield === 'boolean') user.permanentShield = backup.permanentShield;
    if (backup.resources && typeof backup.resources === 'object') user.resources = backup.resources;
    if (backup.upgrades && typeof backup.upgrades === 'object') {
        for (const k of ['hat', 'jam', 'thermos', 'generator']) {
            if (typeof backup.upgrades[k] === 'number') user.upgrades[k] = backup.upgrades[k];
        }
    }
    user.lastSeenAt = Date.now();

    res.json({ ok: true });
});

// Щоденний "Пайок" із серією Day1..Day7 (джекпот) — дата й серія перевіряються на сервері.
app.post('/api/daily', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const today = new Date().toDateString();
    if (user.dailyClaimedDate === today) {
        return res.json({ claimed: false, balance: user.balance, message: 'Ти вже забрав пайок сьогодні! Приходь завтра.' });
    }
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    user.dailyStreak = user.dailyClaimedDate === yesterday ? Math.min(user.dailyStreak + 1, 7) : 1;
    const reward = ECONOMY.DAILY_REWARDS[user.dailyStreak - 1];
    user.balance += reward;
    user.dailyClaimedDate = today;
    res.json({ claimed: true, balance: user.balance, reward, streak: user.dailyStreak });
});

// Активація промокоду — перевіряється й застосовується на сервері
app.post('/api/promo', requireTelegramAuth, (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Відсутній код' });
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const normalized = String(code).toUpperCase().trim();
    const promo = PROMO_CODES[normalized];
    if (!promo) return res.json({ success: false, message: 'Невірний код' });
    if (promo.once && user.redeemedPromos.includes(normalized)) {
        return res.json({ success: false, message: 'Цей код ти вже використав' });
    }

    if (promo.type === 'crate') {
        const crate = CRATE_BY_ID[promo.crateId];
        if (!crate) return res.json({ success: false, message: 'Невірний код' });
        if (promo.once) user.redeemedPromos.push(normalized);
        const reward = rollCrate(user, crate);
        return res.json({
            success: true, message: `${crate.name}: ${reward.title}`,
            crateReward: reward, crateId: crate.id,
            isVip: user.isVip, balance: user.balance, ...storageSnapshot(user),
        });
    }
    if (promo.type === 'crate_bundle') {
        const crates = promo.crateIds.map((id) => CRATE_BY_ID[id]).filter(Boolean);
        if (!crates.length) return res.json({ success: false, message: 'Невірний код' });
        if (promo.once) user.redeemedPromos.push(normalized);
        // Розкриваємо всі одразу на сервері — клієнт програє їх послідовно
        // однією й тією ж анімацією відкривання, що й куплений ящик.
        const rewards = crates.map((c) => ({ crateId: c.id, crateName: c.name, reward: rollCrate(user, c) }));
        return res.json({
            success: true, message: `Отримано по одному з ${crates.length} донатних ящиків!`,
            crateBundle: rewards, isVip: user.isVip, balance: user.balance, ...storageSnapshot(user),
        });
    }
    if (promo.type === 'vip') {
        user.isVip = true;
        return res.json({ success: true, message: 'VIP отримано!', isVip: true, balance: user.balance });
    }
    if (promo.type === 'balance') {
        user.balance += promo.amount;
        return res.json({ success: true, message: `+${promo.amount} ТК!`, isVip: user.isVip, balance: user.balance });
    }
    if (promo.type === 'infinite_money') {
        // Читерський баланс не має рахуватись як "зароблене" — інакше він разово
        // видав би сотні тисяч очок престижу і назавжди зламав би прогрес акаунта.
        const earnedBefore = user.totalEarned || 0;
        user.balance = Number.MAX_SAFE_INTEGER;
        user.totalEarned = earnedBefore;
        return res.json({ success: true, message: '💰 Бездонний гаманець активовано. Баланс тепер практично нескінченний.', isVip: user.isVip, balance: user.balance });
    }
    if (promo.type === 'reset') {
        const fresh = createFreshUser(user.id, user.name);
        usersDB.set(user.id, fresh);
        return res.json({ success: true, reset: true, message: '🔄 Прогрес повністю обнулено. Починай спочатку.', isVip: false, balance: 0 });
    }
    if (promo.type === 'set_level') {
        const loc = LOCATIONS.find((l) => l.level === promo.level);
        if (!loc) return res.json({ success: false, message: 'Невірний код' });
        user.level = loc.level;
        user.maxEnergy = loc.maxEnergy;
        user.energy = user.maxEnergy;
        return res.json({
            success: true, message: `🏚️ Телепорт: ${loc.name} (рівень ${loc.level})`,
            level: user.level, maxEnergy: user.maxEnergy, energy: user.energy, balance: user.balance,
        });
    }
    if (promo.type === 'dev_unlock') {
        // Читерський код для розробника/тестів: відкриває ВСЕ контентно —
        // максимальний схрон (усі локації/вкладки, що гейтяться user.level),
        // максимальний рівень ухилянта (LEVEL_UNLOCKS — усі вкладки клієнта),
        // VIP і купа очок навичок (дерево гейтиться довідками легалізації,
        // не рівнем). Свідомо НЕ чіпає баланс/ресурси/розшук — це для огляду
        // контенту, не для тестів економіки (для того є NEVYCHERPNO/OBNULYUVACH).
        const topLoc = LOCATIONS[LOCATIONS.length - 1];
        user.level = topLoc.level;
        user.maxEnergy = topLoc.maxEnergy;
        user.energy = user.maxEnergy;
        user.isVip = true;
        const maxGateLevel = 25; // з запасом понад найвищий поріг LEVEL_UNLOCKS (20) на клієнті
        user.xp = xpForLevel(maxGateLevel);
        user.playerLevel = maxGateLevel;
        user.prestigePoints = Math.max(user.prestigePoints || 0, 999);
        // fullSync — клієнт просто перезаходить (await init()), а не патчить
        // руками десяток окремих полів, яких звичайний /api/promo не торкається.
        return res.json({ success: true, fullSync: true, message: '🛠️ Розробницький доступ: усе відкрито (схрон 8, макс. рівень ухилянта, VIP, 999 довідок).' });
    }
    res.json({ success: false, message: 'Невірний код' });
});

// Нік — публічне ім'я замість справжнього з Telegram. Унікальний (без урахування
// регістру), 3-16 символів, літери (укр/англ)/цифри/підкреслення/пробіл.
// (leaderboard, nickname/set, nickname/requestChange — тепер у routes/social.js)
function validateNickname(raw, userId) {
    if (raw.length < 3 || raw.length > 16) return 'Нік має бути від 3 до 16 символів';
    if (!/^[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_ ]+$/.test(raw)) return 'Тільки літери, цифри, підкреслення й пробіл';
    if (nicknameTaken(raw, userId)) return 'Цей нік уже зайнято';
    return null;
}

// pet/buy, pet/equip, cosmetic/buy, cosmetic/equip, room/buy, room/toggle — тепер у routes/misc.js

// ---- Кладовка: стан складу, апгрейд місткості, продаж ресурсів ----
// ---- Карта території: будівництво/покращення захисних споруд ----
// routes/map.js (Фаза 4 модуляризації, 2026-08-08) — /api/map/build, /api/map/place
require('./routes/map')(app, {
    requireTelegramAuth, getUser, MAP_BUILDING_BY_ID, RESOURCE_BY_ID,
    storageSnapshot, mapBuildingLevel,
});

// notices, notice/resolve — тепер у routes/security.js

// ==========================================
// СЕЗОНИ Й ЛІГИ
// ==========================================
// Сезон = календарний тиждень за київським часом. Ідентифікатор рахуємо як
// «понеділок цього тижня» — так межа сезону однозначна і її легко перевірити.
function kyivNow(at = Date.now()) {
    // Київ — UTC+2/+3. Точний зсув беремо через локаль, щоб не тримати таблицю переходів.
    const s = new Date(at).toLocaleString('en-US', { timeZone: 'Europe/Kyiv' });
    return new Date(s);
}

function seasonIdFor(at = Date.now()) {
    const d = kyivNow(at);
    // getDay(): 0=неділя. Зсуваємо так, щоб тиждень починався з понеділка.
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seasonEndsAt(at = Date.now()) {
    const d = kyivNow(at);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow + 7);
    d.setHours(0, 0, 0, 0);
    // Переводимо київську «стінну» дату назад у реальний час.
    return d.getTime() + (Date.now() - kyivNow().getTime());
}

function leagueOf(user) {
    return LEAGUES[Math.max(0, Math.min(LEAGUES.length - 1, user.league || 0))];
}

// Скільки місць піднімається й падає. План писався під групи по 30, але грає
// компанія друзів: при 12 гравцях фіксовані 8/8 перетинались би, і підвищувались
// би всі одразу. Тому зони — чверть групи, але не більше плану і не менше одного.
function leagueZones(total) {
    const q = Math.max(1, Math.floor(total / 4));
    return {
        promote: Math.min(ECONOMY.LEAGUE_PROMOTE, q),
        relegate: Math.min(ECONOMY.LEAGUE_RELEGATE, q),
    };
}

// Нагорода за місце в лізі. Сезонна косметика — тільки за перше місце і тільки
// та, якої ще немає.
function seasonPrizeFor(user, rank, total) {
    const zones = leagueZones(total);
    const prize = { rank, total, tk: 0, crates: 0, cosmetic: null, title: null, move: 0 };
    if (rank === 1) {
        prize.crates = 3;
        prize.title = `${leagueOf(user).emoji} Чемпіон: ${leagueOf(user).name}`;
        const avail = SEASON_COSMETICS.filter((c) => !user.ownedCosmetics.includes(c.id));
        if (avail.length) prize.cosmetic = avail[0].id;
        else prize.tk = 100000; // усе вже зібрано — компенсуємо, щоб перше місце не було пустим
    } else if (rank <= 3) {
        prize.crates = 2;
        prize.title = `${leagueOf(user).emoji} Призер: ${leagueOf(user).name}`;
    } else if (rank <= zones.promote) {
        prize.crates = 1;
    } else if (rank > total - zones.relegate) {
        prize.tk = 5000; // втішні
    } else {
        prize.tk = Math.max(2000, 20000 - rank * 1000);
    }
    if (rank <= zones.promote) prize.move = 1;
    else if (rank > total - zones.relegate) prize.move = -1;
    return prize;
}

// Підсумки сезону рахуються ОДИН раз глобально: ранги залежать від усіх гравців,
// тому не можна робити це ліниво для кожного окремо. Результат кладемо в
// user.seasonResult, гравець забирає його при наступному вході.
let lastProcessedSeason = null;
function rolloverSeasonIfNeeded() {
    const current = seasonIdFor();
    if (lastProcessedSeason === current) return false;

    // Перший запуск процесу: просто фіксуємо сезон, нікого не переміщуємо.
    const anyUser = usersDB.values().next().value;
    if (!lastProcessedSeason && (!anyUser || !anyUser.seasonId)) {
        usersDB.forEach((u) => { u.seasonId = current; });
        lastProcessedSeason = current;
        return false;
    }
    // Скільки гравців ще живуть у старому сезоні — тільки їх і перераховуємо.
    const stale = Array.from(usersDB.values()).filter((u) => u.seasonId && u.seasonId !== current);
    if (!stale.length) {
        usersDB.forEach((u) => { if (!u.seasonId) u.seasonId = current; });
        lastProcessedSeason = current;
        return false;
    }

    // Групи рахуємо ДО будь-яких переміщень. Інакше гравець, підвищений у лізі 0,
    // потрапляє в ітерацію ліги 1 і підвищується знову — і так до бункера.
    const groups = LEAGUES.map((league) => stale
        .filter((u) => (u.league || 0) === league.id && (u.seasonPoints || 0) >= ECONOMY.SEASON_MIN_POINTS)
        .sort((a, b) => (b.seasonPoints || 0) - (a.seasonPoints || 0)));

    for (const league of LEAGUES) {
        const group = groups[league.id];
        group.forEach((u, i) => {
            const prize = seasonPrizeFor(u, i + 1, group.length);
            u.balance += prize.tk;
            for (let c = 0; c < prize.crates; c++) {
                // Нагородні ящики — «гуманітарний», найчесніший середній тір.
                rollCrate(u, CRATE_BY_ID['humanitarian']);
            }
            if (prize.cosmetic && !u.ownedCosmetics.includes(prize.cosmetic)) {
                u.ownedCosmetics.push(prize.cosmetic);
            }
            if (prize.title) u.seasonTitle = prize.title;
            u.league = Math.max(0, Math.min(LEAGUES.length - 1, (u.league || 0) + prize.move));
            u.seasonResult = { ...prize, seasonId: u.seasonId, leagueName: league.name, leagueEmoji: league.emoji };
            logOffline(u, 'good', `🏆 Сезон завершено: ${prize.rank} місце в лізі «${league.name}»`);
            sendPush(u.id, `🏆 Сезон завершено! Ти ${prize.rank}-й у лізі «${league.name}». Зайди забрати нагороду.`);
        });
    }

    // Скидаємо очки ВСІМ застарілим — включно з тими, хто не набрав мінімуму.
    for (const u of stale) {
        u.seasonPoints = 0;
        u.seasonId = current;
        u.heatDaySP = null;
    }
    usersDB.forEach((u) => { if (!u.seasonId) u.seasonId = current; });
    lastProcessedSeason = current;
    console.log(`🏆 Сезон ${current}: підбито підсумки для ${stale.length} гравців.`);
    return true;
}

// «Ухилянт тижня» — безкоштовний соціальний тиск: раз на тиждень кожен у чаті
// бачить, хто попереду. Розсилаємо всім учасникам, окремого чат-бота немає.
function announceWeeklyBest() {
    for (const clan of clansDB.values()) {
        if (clan.bestAnnounced === seasonIdFor()) continue;
        clan.bestAnnounced = seasonIdFor();
        const members = clan.members.map((id) => usersDB.get(id)).filter(Boolean);
        if (members.length < 2) continue;
        const best = members.slice().sort((a, b) => (b.seasonPoints || 0) - (a.seasonPoints || 0))[0];
        if (!best || !(best.seasonPoints > 0)) continue;
        for (const u of members) {
            sendPush(u.id, `📰 Ухилянт тижня в «${clan.name}»: ${best.name} — ${best.seasonPoints} сезонних очок.` +
                (u.id === best.id ? '\nЦе ти. Тримай марку.' : '\nНаздоганяй.'));
        }
    }
}

// Доба з високим розшуком — окреме джерело сезонних очок, тому рахуємо її раз на день.
function awardHeatSeasonPoints(user) {
    if ((user.heat || 0) < ECONOMY.SEASON_HEAT_THRESHOLD) return;
    const today = new Date().toDateString();
    if (user.heatDaySP === today) return;
    user.heatDaySP = today;
    user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.SEASON_HEAT_DAILY_SP;
}

function seasonSnapshot(user) {
    const league = leagueOf(user);
    const rivals = Array.from(usersDB.values())
        .filter((u) => (u.league || 0) === league.id)
        .sort((a, b) => (b.seasonPoints || 0) - (a.seasonPoints || 0));
    const myRank = rivals.findIndex((u) => u.id === user.id) + 1;
    const zones = leagueZones(rivals.length);
    return {
        seasonId: user.seasonId || seasonIdFor(),
        seasonEndsAt: seasonEndsAt(),
        seasonPoints: user.seasonPoints || 0,
        seasonTitle: user.seasonTitle || null,
        league: { id: league.id, emoji: league.emoji, name: league.name },
        rank: myRank || rivals.length + 1,
        groupSize: rivals.length,
        promoteAt: zones.promote,
        relegateAt: zones.relegate,
        standings: rivals.slice(0, 30).map((u, i) => ({
            rank: i + 1, name: displayName(u), pid: u.pid, points: u.seasonPoints || 0,
            title: u.seasonTitle || null, me: u.id === user.id,
        })),
    };
}

// GET /api/season — тепер у routes/misc.js

// ==========================================
// ВІЙНА ОСББ (клан проти клану)
// ==========================================
// Стуки на ворогів приносять очки війни — саме це перетворює PvP з особистої
// дрібної гидоти на командний спорт, у якого раптом з'являється тактика.
function warActive(clan) {
    return !!(clan && clan.war && Date.now() < clan.war.endsAt);
}

function addWarPoints(user, points, reason) {
    const clan = user.clanId && clansDB.get(user.clanId);
    if (!warActive(clan)) return;
    clan.war.myPoints = (clan.war.myPoints || 0) + points;
    clan.war.log = clan.war.log || [];
    clan.war.log.unshift({ t: Date.now(), name: displayName(user), points, reason });
    if (clan.war.log.length > 20) clan.war.log.length = 20;
    clan.war.contributions = clan.war.contributions || {};
    clan.war.contributions[user.id] = (clan.war.contributions[user.id] || 0) + points;
}

// Матчмейкінг щопонеділка: клани сортуються за рівнем і паруються сусідні.
// Війна триває Пн–Пт, вихідні лишаємо в спокої.
function matchmakeWarsIfNeeded() {
    const current = seasonIdFor();
    const clans = Array.from(clansDB.values());
    const needs = clans.filter((c) => !c.warSeason || c.warSeason !== current);
    if (!needs.length) return false;

    const pool = needs.sort((a, b) => clanLevel(b) - clanLevel(a));
    for (let i = 0; i < pool.length; i += 2) {
        const a = pool[i];
        const b = pool[i + 1];
        a.warSeason = current;
        if (!b) { a.war = null; continue; } // непарний клан цього тижня відпочиває
        b.warSeason = current;
        // Кінець у пʼятницю 23:59 за київським часом = старт тижня + 5 діб.
        const endsAt = seasonEndsAt() - 2 * 24 * 3600 * 1000;
        const base = { startedAt: Date.now(), endsAt, myPoints: 0, contributions: {}, log: [] };
        a.war = { ...base, opponentId: b.id, opponentName: b.name };
        b.war = { ...base, opponentId: a.id, opponentName: a.name };
        for (const id of [...a.members, ...b.members]) {
            sendPush(id, '⚔️ Стартувала війна ОСББ! Стуки на учасників ворожого чату дають найбільше очок.');
        }
    }
    return true;
}

// Підбиття підсумків війни: переможцю скарбниця +20%, трофейні ящики й бафф.
// Переможеним — НІЧОГО. Без штрафів: це гра для друзів, токсичність не потрібна.
function settleWarsIfNeeded() {
    for (const clan of clansDB.values()) {
        if (!clan.war || clan.warSettled === clan.warSeason) continue;
        if (Date.now() < clan.war.endsAt) continue;
        const foe = clansDB.get(clan.war.opponentId);
        const mine = clan.war.myPoints || 0;
        const theirs = (foe && foe.war && foe.war.myPoints) || 0;
        clan.warSettled = clan.warSeason;
        clan.warResult = { mine, theirs, won: mine > theirs, at: Date.now() };
        if (mine > theirs) {
            clan.treasury = Math.round((clan.treasury || 0) * (1 + ECONOMY.WAR_TREASURY_PRIZE));
            clan.warBuffUntil = Date.now() + ECONOMY.WAR_BUFF_DAYS * 24 * 3600 * 1000;
            for (const id of clan.members) {
                const u = usersDB.get(id);
                if (!u) continue;
                u.pendingWarCrate = (u.pendingWarCrate || 0) + 1;
                logOffline(u, 'good', '🏆 Ваш ОСББ виграв війну — трофейний ящик чекає');
                sendPush(id, '🏆 Ваш чат ОСББ виграв війну! Забери трофейний ящик і тримай бафф на тиждень.');
            }
        } else {
            for (const id of clan.members) {
                sendPush(id, '⚔️ Війна ОСББ завершилась. Цього разу не наша, але й втрачати нічого.');
            }
        }
    }
}

function warSnapshot(user) {
    const clan = user.clanId && clansDB.get(user.clanId);
    // Трофейні ящики й автоклікер до клану стосунку не мають: гравець міг вийти
    // з чату, вже маючи нагороду, і вона не повинна зникати з відповіді.
    const personal = { pendingWarCrate: user.pendingWarCrate || 0, grannyUntil: user.grannyUntil || 0 };
    if (!clan) return { war: null, ...personal };
    const foe = clan.war && clansDB.get(clan.war.opponentId);
    return {
        war: clan.war ? {
            opponentName: clan.war.opponentName,
            myPoints: clan.war.myPoints || 0,
            theirPoints: (foe && foe.war && foe.war.myPoints) || 0,
            endsAt: clan.war.endsAt,
            active: warActive(clan),
            myContribution: (clan.war.contributions || {})[user.id] || 0,
            log: clan.war.log || [],
            enemies: foe ? foe.members.map((id) => {
                const u = usersDB.get(id);
                return u ? { pid: u.pid, name: displayName(u), level: u.level } : null;
            }).filter(Boolean) : [],
        } : null,
        warResult: clan.warResult || null,
        warBuffUntil: clan.warBuffUntil || 0,
        ...personal,
    };
}

// GET /api/war, POST /api/war/crate — тепер у routes/misc.js

// ==========================================
// ОБЛАВА НА РАЙОН (кооп-бос)
// ==========================================
// Єдина механіка, де друзям треба скооперуватись у реальному часі.
function districtHpFor(clan) {
    const power = clan.members.reduce((sum, id) => sum + Math.max(1, Number(usersDB.get(id)?.clickVal) || 1), 0);
    return Math.max(ECONOMY.DISTRICT_HP_FLOOR, Math.round(power * ECONOMY.DISTRICT_HP_PER_CLICK_POWER));
}

function maybeStartDistrictRaid(clan) {
    if (clan.districtRaid) return false;
    const totalHeat = clan.members.reduce((sum, id) => sum + (usersDB.get(id)?.heat || 0), 0);
    if (totalHeat < ECONOMY.DISTRICT_HEAT_TRIGGER) return false;
    const hp = districtHpFor(clan);
    clan.districtRaid = {
        hp, hpMax: hp, startedAt: Date.now(),
        endsAt: Date.now() + ECONOMY.DISTRICT_WINDOW_H * 3600 * 1000,
        contributions: {},
    };
    for (const id of clan.members) {
        sendPush(id, `🚌 Автобус ТЦК заїхав у район! Сумарний розшук чату перевищив ${ECONOMY.DISTRICT_HEAT_TRIGGER}. У вас ${ECONOMY.DISTRICT_WINDOW_H} годин.`);
    }
    return true;
}

function settleDistrictRaid(clan) {
    const r = clan.districtRaid;
    if (!r || Date.now() < r.endsAt || r.hp <= 0) return false;
    // Не встигли: штраф усім, і клан на добу без бонусів.
    clan.districtRaid = null;
    clan.districtPenaltyUntil = Date.now() + 24 * 3600 * 1000;
    for (const id of clan.members) {
        const u = usersDB.get(id);
        if (!u) continue;
        const fine = Math.floor(Math.max(0, u.balance) * ECONOMY.DISTRICT_LOSE_BALANCE_PCT);
        if (fine > 0) u.balance -= fine;
        changeHeat(u, ECONOMY.DISTRICT_LOSE_HEAT, 'Автобус ТЦК постояв і поїхав');
        logOffline(u, 'bad', `🚌 Облаву на район не відбили (−${fine.toLocaleString('uk-UA')} ТК)`);
    }
    return true;
}

function districtSnapshot(clan, user) {
    const r = clan && clan.districtRaid;
    if (!r) return { districtRaid: null, districtPenaltyUntil: (clan && clan.districtPenaltyUntil) || 0 };
    return {
        districtRaid: {
            hp: Math.max(0, Math.round(r.hp)), hpMax: r.hpMax, endsAt: r.endsAt,
            myDamage: (r.contributions || {})[user.id] || 0,
            contributions: Object.entries(r.contributions || {})
                .map(([id, dmg]) => { const u = usersDB.get(id); return { name: u ? displayName(u) : '???', damage: Math.round(dmg) }; })
                .sort((a, b) => b.damage - a.damage),
        },
        districtPenaltyUntil: clan.districtPenaltyUntil || 0,
    };
}

// GET /api/district, POST /api/district/hit — тепер у routes/misc.js

// ---- Репутація з районом ----
const { repOf, repMaxed } = require('./lib/mechanics/reputation');

// Квест дня обирається детерміновано від дати й id NPC — в усіх гравців він
// однаковий і його не можна «перекрутити», перезайшовши в гру.
function dailyQuestFor(npc, date = new Date()) {
    const seed = Number(`${date.getFullYear()}${date.getMonth() + 1}${date.getDate()}`) + npc.id.length;
    return npc.quests[seed % npc.quests.length];
}

// Значення метрики для квестів, яких немає серед звичайних денних лічильників.
function questMetric(user, metric) {
    if (metric === 'heatNow') return Math.round(user.heat || 0);
    if (metric === 'expeditionsToday') return (user.expeditions || []).length;
    return user[metric] || 0;
}

function questProgress(user, quest) {
    if (quest.type === 'donate') {
        return { have: user.resources[quest.res] || 0, need: quest.target, invert: false };
    }
    if (typeof quest.max === 'number') {
        // Квест «не перевищ»: виконаний, поки показник не більший за поріг.
        return { have: questMetric(user, quest.metric), need: quest.max, invert: true };
    }
    return { have: questMetric(user, quest.metric), need: quest.target, invert: false };
}

function questDone(user, quest) {
    const p = questProgress(user, quest);
    return p.invert ? p.have <= p.need : p.have >= p.need;
}

function reputationSnapshot(user) {
    return {
        reputation: user.reputation,
        repMax: ECONOMY.REP_MAX,
        claimedRepQuests: user.claimedRepQuests || [],
        npcs: REPUTATION_NPCS.map((npc) => {
            const quest = dailyQuestFor(npc);
            const p = questProgress(user, quest);
            return {
                id: npc.id, emoji: npc.emoji, name: npc.name, about: npc.about, perk: npc.perk,
                rep: repOf(user, npc.id), maxed: repMaxed(user, npc.id),
                quest: {
                    id: quest.id, text: quest.text, rep: quest.rep, type: quest.type,
                    res: quest.res || null, have: p.have, need: p.need, invert: p.invert,
                    done: questDone(user, quest),
                    claimed: (user.claimedRepQuests || []).includes(quest.id),
                },
            };
        }),
    };
}

// GET /api/reputation, POST /api/reputation/claim — тепер у routes/misc.js

// ---- Офлайн-звіт ----
// Події, які стались, поки гра була закрита. Раніше гравець просто бачив іншу
// цифру балансу і не розумів, що взагалі відбулось.
function logOffline(user, kind, text) {
    if (!Array.isArray(user.offlineLog)) user.offlineLog = [];
    user.offlineLog.push({ t: Date.now(), kind, text });
    if (user.offlineLog.length > ECONOMY.OFFLINE_LOG_SIZE) user.offlineLog.shift();
}

// Збирає звіт і одразу його ЧИСТИТЬ: показуємо один раз при вході.
function takeOfflineReport(user) {
    const away = Date.now() - (user.lastSeenAt || 0);
    const log = user.offlineLog || [];
    user.offlineLog = [];
    const wasAway = user.lastSeenAt && away >= ECONOMY.OFFLINE_REPORT_MIN_MS;
    user.lastSeenAt = Date.now();
    if (!wasAway || !log.length) return null;
    return { awayMs: away, events: log };
}

// ---- Дерево навичок ----
function skillsOwnedCount(user) {
    return Object.values(user.skills || {}).filter(Boolean).length;
}

// Очки навичок — це довідки престижу. Довідки при цьому НЕ витрачаються:
// свій +10% доходу вони дають далі, навичка — бонус зверху.
function skillPointsAvailable(user) {
    return Math.max(0, (user.prestigePoints || 0) - skillsOwnedCount(user));
}

function skillsSnapshot(user) {
    return {
        skills: user.skills || {},
        skillPoints: skillPointsAvailable(user),
        skillsTotal: Object.keys(SKILL_BY_ID).length,
        skillsOwned: skillsOwnedCount(user),
        skillResetsUsed: user.skillResetsUsed || 0,
        skillResetCost: (user.skillResetsUsed || 0) === 0 ? 0 : ECONOMY.SKILL_RESET_COST_TK,
        branches: SKILL_BRANCHES.map((br) => ({
            id: br.id, emoji: br.emoji, name: br.name, desc: br.desc,
            skills: br.skills.map((s, i) => {
                // Наступну в гілці можна брати лише після попередньої, І лише
                // якщо схрон досяг minLevel (розширене дерево, 2026-08-16) —
                // тир 3 із гейтом рівня 6 недоступний навіть за наявності
                // попередніх навичок, поки гравець не дійшов до потрібного схрону.
                const sequenceOk = i === 0 || !!(user.skills || {})[br.skills[i - 1].id];
                const levelOk = (user.level || 1) >= (s.minLevel || 1);
                return {
                    id: s.id, name: s.name, desc: s.desc, minLevel: s.minLevel || 1,
                    owned: !!(user.skills || {})[s.id],
                    available: sequenceOk && levelOk,
                    lockedByLevel: sequenceOk && !levelOk,
                };
            }),
        })),
    };
}

// GET /api/skills, POST /api/skills/buy, POST /api/skills/reset — тепер у routes/misc.js

// Бонус до макс. енергії від навички накладаємо ДЕЛЬТОЮ, а не перерахунком від
// локації: постійні бонуси з крафту («Бенкет на районі», «Розширений бак») теж
// зашиті прямо в user.maxEnergy, і перерахунок мовчки стер би їх назавжди.
// skillEnergyBonus пам'ятає, скільки саме зараз дали навички, щоб зняти рівно стільки.
const { applySkillLimits } = require('./lib/mechanics/skills');

// ---- Відстрочки ----
function defermentActive(user) {
    return (user.deferUntil || 0) > Date.now();
}

// Чи по кишені відстрочка і чому ні — одна перевірка для покупки і для UI,
// щоб заблокована картка показувала конкретну причину, а не просто сіріла.
function defermentEligibility(user, def) {
    if (defermentActive(user)) {
        return { ok: false, reason: 'Спершу дочекайся кінця поточної відстрочки' };
    }
    const c = def.cost;
    if (c.tk && user.balance < c.tk) return { ok: false, reason: 'Не вистачає ТК' };
    if (c.clanLevel) {
        const clan = user.clanId && clansDB.get(user.clanId);
        if (!clan) return { ok: false, reason: 'Потрібен чат ОСББ' };
        if (clanLevel(clan) < c.clanLevel) {
            return { ok: false, reason: `Потрібен чат ОСББ ${c.clanLevel} рівня (зараз ${clanLevel(clan)})` };
        }
    }
    if (c.res) {
        for (const [resId, qty] of Object.entries(c.res)) {
            if ((user.resources[resId] || 0) < qty) {
                return { ok: false, reason: `Не вистачає: ${RESOURCE_BY_ID[resId].name}` };
            }
        }
    }
    return { ok: true };
}

function defermentSnapshot(user) {
    return {
        deferUntil: user.deferUntil || 0,
        defermentId: user.defermentId || null,
        deferments: DEFERMENTS.map((d) => {
            const e = defermentEligibility(user, d);
            return {
                id: d.id, emoji: d.emoji, name: d.name, hours: d.hours, flavor: d.flavor,
                cost: d.cost, can: e.ok, reason: e.reason || null,
            };
        }),
    };
}

function grantDeferment(user, def) {
    user.deferUntil = Date.now() + def.hours * 3600 * 1000;
    user.defermentId = def.id;
    user.defermentsTaken = (user.defermentsTaken || 0) + 1;
}

// deferments, deferment/buy, checkpoint, checkpoint/pass — тепер у routes/security.js

// ---- Інспектори ТЦК (боси) ----
// Навички з дерева престижу — Фаза 6. Поки їх немає, функція чесно повертає false,
// і Генерал Півник лишається видимим, але заблокованим.
const { hasSkill } = require('./lib/mechanics/skills');

function inspectorAvailable(user, insp) {
    if ((user.heat || 0) < insp.unlockHeat) return false;
    if (insp.requiresSkill && !hasSkill(user, insp.requiresSkill)) return false;
    if (insp.cooldownH && Date.now() - (user.inspectorLastSeen[insp.id] || 0) < insp.cooldownH * 3600 * 1000) return false;
    return true;
}

// inspectorWeaknessActive, inspectorRoster — тепер у routes/security.js (разом з роутами, що їх використовують)

function inspectorSnapshot(user) {
    const s = user.inspector;
    if (!s) return { inspector: null };
    const insp = INSPECTOR_BY_ID[s.id];
    return {
        inspector: {
            id: s.id, emoji: insp.emoji, name: insp.name, taunt: insp.taunt,
            hp: Math.max(0, Math.round(s.hp)), hpMax: s.hpMax, endsAt: s.endsAt,
            weakness: insp.weakness, weaknessHint: insp.weaknessHint,
        },
    };
}

// Скільки часу реально минуло з попереднього удару по цій цілі. Верхня межа —
// щоб пауза в грі не перетворилась на один нищівний батч, нижня — щоб перший
// удар після появи боса теж мав нормальне вікно.
function serverBatchWindow(target) {
    const now = Date.now();
    const prev = target.lastHitAt || target.startedAt || now - ECONOMY.INSPECTOR_BATCH_MS;
    target.lastHitAt = now;
    return Math.max(1, Math.min(5000, now - prev || ECONOMY.INSPECTOR_BATCH_MS));
}

// Бос пішов, бо гравець не встиг у вікно.
function inspectorTimeout(user) {
    if (!user.inspector || Date.now() < user.inspector.endsAt) return false;
    user.inspector = null;
    user.inspectorStats.lost += 1;
    user.inspectorCooldownUntil = Date.now() + ECONOMY.INSPECTOR_COOLDOWN_H * 3600 * 1000;
    changeHeat(user, ECONOMY.INSPECTOR_LOSE_HEAT, 'Інспектор пішов ні з чим (і образився)');
    return true;
}

// GET /api/inspector, POST /api/inspector/hit — тепер у routes/security.js

// Тестовий виклик боса. Реєструється ТІЛЬКИ в dev-режимі — у проді цього роуту
// просто не існує, інакше будь-хто міг би фармити інспекторів на вимогу.
if (DEV_MODE_INSECURE) {
    // Тижневі механіки інакше не перевірити, не чекаючи понеділка.
    app.post('/api/dev/end-season', requireTelegramAuth, (req, res) => {
        usersDB.forEach((u) => { u.seasonId = 'FORCED-OLD'; });
        lastProcessedSeason = null;
        const changed = rolloverSeasonIfNeeded();
        res.json({ success: true, changed });
    });
    app.post('/api/dev/start-war', requireTelegramAuth, (req, res) => {
        clansDB.forEach((c) => { c.warSeason = null; c.warSettled = null; });
        res.json({ success: true, matched: matchmakeWarsIfNeeded() });
    });
    app.post('/api/dev/end-war', requireTelegramAuth, (req, res) => {
        clansDB.forEach((c) => { if (c.war) c.war.endsAt = Date.now() - 1000; });
        settleWarsIfNeeded();
        res.json({ success: true });
    });
    app.post('/api/dev/spawn-district', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const clan = user.clanId && clansDB.get(user.clanId);
        if (!clan) return res.json({ success: false, message: 'Немає чату' });
        clan.districtRaid = null;
        const hp = districtHpFor(clan);
        clan.districtRaid = { hp, hpMax: hp, startedAt: Date.now(),
            endsAt: Date.now() + ECONOMY.DISTRICT_WINDOW_H * 3600 * 1000, contributions: {} };
        res.json({ success: true, ...districtSnapshot(clan, user) });
    });
    app.post('/api/dev/spawn-inspector', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const insp = INSPECTOR_BY_ID[req.body.inspectorId];
        if (!insp) return res.json({ success: false, message: 'Невідомий інспектор' });
        user.inspector = { id: insp.id, hp: insp.hp, hpMax: insp.hp, startedAt: Date.now(), endsAt: Date.now() + insp.window * 1000 };
        user.inspectorLastSeen[insp.id] = Date.now();
        res.json({ success: true, ...inspectorSnapshot(user) });
    });
}


// medcom, medcom/reroll, medcom/submit — тепер у routes/security.js

// ---- PvP: "Здати сусіда" ----
function publicSnitchStats(user) {
    const s = user.snitchStats || {};
    return { sent: s.sent || 0, received: s.received || 0, caught: s.caught || 0 };
}

function profileCard(user) {
    return {
        pid: user.pid, name: displayName(user), level: user.level, isVip: !!user.isVip,
        balance: Math.floor(user.balance), heat: Math.round((user.heat || 0) * 10) / 10,
        heatTierName: heatTierOf(user.heat).name,
        prestigePoints: user.prestigePoints || 0,
        totalClicks: user.totalClicks || 0,
        raidsSurvived: user.raidsSurvived || 0,
        expeditionsDone: user.expeditionsDone || 0,
        collected: (user.ownedCosmetics || []).length + (user.ownedRoomItems || []).length + (user.ownedPets || []).length,
        achievements: (user.achievements || []).length,
        trophies: (user.trophies || []).length,
        permanentShield: !!user.permanentShield,
        snitch: publicSnitchStats(user),
    };
}

// profile, snitch, investigation, investigation/guess — тепер у routes/social.js

// quests, quests/claim — тепер у routes/misc.js

// routes/social.js (Фаза 4 модуляризації) — лідерборд, нікнейми, профіль/PvP
// "Здати сусіда", розслідування, клани ("Чат ОСББ").
require('./routes/social')(app, {
    requireTelegramAuth, getUser, ECONOMY, usersDB, clansDB,
    displayName, publicSnitchStats, LEAGUES, ukhyrRank, validateNickname,
    profileCard, snitchEligibility, userByPid, migrateUser, syncHeatAndNotices,
    heatTierOf, mapProtectPct, resetDailyIfNeeded, hasSkill, NOTICE_BY_ID,
    addWarPoints, changeHeat, sendPush, logOffline, checkAchievements,
    buildSuspects, storageSnapshot, clanLevel, makeClanId, getClanInfo, warSnapshot,
});

// routes/security.js (Фаза 4 модуляризації) — тиск ТЦК/розшук: повістки,
// відстрочки, блокпост, інспектори (боси), медкомісія.
require('./routes/security')(app, {
    requireTelegramAuth, getUser, ECONOMY,
    NOTICE_BY_ID, DEFERMENT_BY_ID, CHECKPOINT_BY_ID, CHECKPOINT_CHOICES,
    INSPECTOR_BY_ID, INSPECTORS, SYMPTOMS, SYMPTOM_BY_ID, COSMETICS,
    heatSnapshot, noticeSnapshot, noticeBribeCost, applyNoticePenalty, checkAchievements,
    storageSnapshot, storageUsed, mapProtectPct, loseRandomResources,
    syncHeatAndNotices, defermentActive, defermentEligibility, defermentSnapshot, grantDeferment,
    changeHeat, repMaxed, hasSkill, addWarPoints, addResource, RESOURCE_BY_ID,
    addXP, addUkhyr, heatIncomeMult, inspectorTimeout, inspectorSnapshot, serverBatchWindow,
});

// routes/misc.js (Фаза 4 модуляризації) — компаньйони, гардероб, декор кімнати,
// сезони/ліги, війна ОСББ, облава на район, репутація з районом, дерево навичок,
// щоденні квести.
require('./routes/misc')(app, {
    requireTelegramAuth, getUser, ECONOMY, usersDB, clansDB, displayName,
    PETS, COSMETICS, ROOM_ITEMS, QUESTS, SKILL_BY_ID, SKILL_BRANCHES, NPC_BY_ID,
    storageSnapshot, checkAchievements, resetDailyIfNeeded, hasSkill, changeHeat,
    logOffline, sendPush, addXP, addUkhyr, applySkillLimits, repOf, repMaxed,
    seasonSnapshot, warSnapshot, matchmakeWarsIfNeeded, settleWarsIfNeeded,
    rollCrate, CRATE_BY_ID, settleDistrictRaid, districtSnapshot, serverBatchWindow,
    dailyQuestFor, questDone, reputationSnapshot, skillsSnapshot,
    skillsOwnedCount, skillPointsAvailable,
});

// routes/economy.js (Фаза 4 модуляризації, 2026-08-08) — кладовка, престиж,
// вилазки, ящики, крафт, апгрейди магазину, помста, біржа, колесо, міні-ігри.
require('./routes/economy')(app, {
    requireTelegramAuth, getUser, ECONOMY, RESOURCE_BY_ID, RESOURCES,
    storageSnapshot, storageUpgradeCost, storageCapacity, storageUsed, addResource,
    marketState, checkAchievements, prestigePointsAvailable, prestigeMultiplier,
    LOCATIONS, applySkillLimits, addXP, addUkhyr, heatSnapshot, noticeSnapshot,
    changeHeat, EXPEDITION_BY_ID, PET_EXPEDITION, expeditionSlots, expeditionSnapshot,
    hasActiveShield, addWarPoints, resetDailyIfNeeded, CRATE_BY_ID, cratePriceFor,
    rollCrate, RECIPE_BY_ID, hasSkill, UPGRADE_BASE, UPGRADE_BASE_EFFECT,
    upgEffectPerLevel, upgradeGateInfo, upgradeBatchPlan, upgradeCost,
    REVENGE_LINES, MARKET_ASSETS, repMaxed, pickWeighted, WHEEL_SEGMENTS,
    shuffled, MEMORY_ICONS, MEMORY_ENTRY_COST, memoryRewardFor,
    COINFLIP_WIN_CHANCE, RISK_TIERS,
    ROUTE_PROJECT_COST, routeProgressPct, routeProjectComplete,
});

// routes/sprints.js (PATCH 2.0 «Спринти», 2026-08-15) — робочі контракти замість
// прямого кліку на схронах 2-8. Усе за фіче-флагом ECONOMY.SPRINTS_V2 (default
// false): роути зареєстровані завжди, але поки прапорець вимкнено — одразу
// відповідають відмовою, старий клікер працює як раніше.
require('./routes/sprints')(app, {
    requireTelegramAuth, getUser, ECONOMY, RESOURCE_BY_ID, hasSkill,
    addResource, storageSnapshot, serverBatchWindow,
    SPRINT_TIER_BY_ID, sprintSnapshot, sprintPayout,
    decayBurnout, burnoutPerTap, burnoutTapMult,
    settleExpiredQte, sprintExpired, qteWindowMs,
    BURNOUT_MAX, QTE_SPAWN_CHANCE, QTE_MIN_INTERVAL, QTE_MISS_PENALTY,
});

// routes/admin.js (2026-08-15) — адмін-панель власника + книга скарг і пропозицій.
// Авторизація та сама, що в /api/admin/backup і /api/admin/broadcast вище:
// заголовок x-admin-token звіряється з BOT_TOKEN. Розсилка тут НЕ дублюється —
// у модулі лише її попередній перегляд.
const complaints = require('./lib/complaints');
require('./routes/admin')(app, {
    ADMIN_PASSWORD, usersDB, clansDB, requireTelegramAuth, getUser, displayName,
    complaints, LOCATIONS, paymentLog,
    // Необов'язкові: якщо OWNER_TELEGRAM_ID заданий — власнику падає пуш
    // про кожну нову скаргу, а не тільки запис у книзі.
    sendPush, OWNER_TELEGRAM_ID,
});

// ==========================================
// 8. ФРОНТЕНД (HTML/CSS/JS в одному файлі)
// ==========================================
function buildHtml(botUsername) {
    return `
<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Симулятор Ухилянта</title>
    <link rel="icon" type="image/png" href="/images/app-icon.webp">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --bg: #0c1117; --panel-bg: #161e28; --text: #d7e3ec; --accent: #35516b; --accent2: #6ec6ff; --btn: #1b2530; --gold: #7ec8f0; }
        html { background: var(--bg); min-height: 100%; }
        body { margin: 0; padding: 10px; padding-top: max(10px, env(safe-area-inset-top), var(--tg-safe-area-inset-top, 0px)); font-family: 'Courier Prime', 'Courier New', monospace; font-size: 16px; background: transparent; color: var(--text); overflow-x: hidden; user-select: none; height: 100vh; height: 100dvh; box-sizing: border-box; display: flex; flex-direction: column; position: relative; }
        /* Фон усього застосунку — картинка поточної локації (рівень схрону), під
           шапкою/вкладками. Base-колір під нею лишається на випадок, поки картинка
           вантажиться. Затемнення поверх — інакше деталізовані нові фони (loc8-*)
           заб'ють читабельність тексту/кнопок, які раніше стояли на суцільному кольорі. */
        #app-bg { position: fixed; inset: 0; z-index: -1; background: var(--bg) center/cover no-repeat; }
        #app-bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(rgba(8,12,17,0.25), rgba(8,12,17,0.5)); }
        header, .tabs-container { flex-shrink: 0; }

        header { background: rgba(12,17,23,0.55); backdrop-filter: blur(3px); padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 10px; position: relative; border: 1px solid rgba(110,198,255,0.35); box-shadow: 0 0 18px rgba(110,198,255,0.15), inset 0 0 25px rgba(53,81,107,0.05); }
        header h2 { font-size: 19px; margin: 2px 0 6px; }
        .daily-btn { position: absolute; top: 10px; right: 10px; width: auto; margin-bottom: 0; background: var(--gold); color: #000; border: none; border-radius: 999px; padding: 5px 12px; font-weight: bold; font-size: 10px; cursor: pointer; box-shadow: 0 0 8px rgba(180,225,255,0.6); }
        .streak-note { position: absolute; top: 32px; right: 10px; font-size: 9px; color: #8ed4ffcc; }
        .next-step { margin-top: 8px; padding: 8px 10px; background: rgba(110,198,255,0.12); border: 1px solid rgba(110,198,255,0.35); border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; }
        h2 { margin: 5px 0; font-family: 'Courier Prime', monospace; font-weight: 700; color: var(--gold); font-size: 26px; letter-spacing: 1px; text-shadow: 0 0 8px rgba(180,225,255,0.8), 0 0 20px rgba(110,198,255,0.5); }
        .stats { display: flex; justify-content: space-between; font-size: 14px; color: #8fa3b8; margin-top: 5px; }
        .vip-badge { color: #000; background: var(--gold); border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: bold; margin-left: 6px; vertical-align: middle; }
        .clan-line { font-size: 11px; color: var(--accent2); margin-top: 4px; text-shadow: 0 0 6px rgba(110,198,255,0.5); }

        .energy-wrap { margin-top: 10px; }
        .energy-label { font-size: 12px; color: var(--text); opacity: 0.85; margin-bottom: 3px; text-align: left; }
        .energy-bar { width: 100%; height: 12px; background: #141b22; border-radius: 6px; overflow: hidden; border: 1px solid #1f2933; }
        .energy-fill { width: 100%; height: 100%; background: linear-gradient(90deg, #6ec6ff, #39ff14); box-shadow: 0 0 10px rgba(110,198,255,0.8); transition: width 0.2s; }

        /* ===== Розшук (heat) ===== */
        .heat-wrap { margin-top: 8px; cursor: pointer; }
        .heat-label { display: flex; justify-content: space-between; font-size: 10px; color: #b9c9d8; margin-bottom: 3px; letter-spacing: 0.3px; }
        .heat-bar { width: 100%; height: 7px; background: #141b22; border-radius: 4px; overflow: hidden; border: 1px solid #1f2933; }
        .heat-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #39ff14, #8ed4ff 55%, #ff3b3b); transition: width 0.4s; }
        /* Пульсація лише з 76+ ("Персональна справа") — це вже той рівень, коли гравець
           має відчувати, що на нього дивляться. Нижче анімація тільки б відволікала. */
        .heat-wrap.hot .heat-bar { animation: heatPulse 1.6s ease-in-out infinite; }
        @keyframes heatPulse {
            0%, 100% { box-shadow: 0 0 0 rgba(255,59,59,0); }
            50% { box-shadow: 0 0 12px rgba(255,59,59,0.85); }
        }
        .energy-lock { font-size: 11px; color: #ff8a8a; margin-top: 5px; text-align: center; }

        /* ===== Спринти (робочі контракти, ECONOMY.SPRINTS_V2) ===== */
        #sprint-plaque { background: rgba(12,17,23,0.6); border: 1px solid rgba(110,198,255,0.3); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; text-align: left; }
        #sprint-idle { text-align: center; }
        #sprint-pick-btn { background: linear-gradient(45deg, #1b3a52, #2d6b8f); }
        .sprint-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
        .sprint-name { flex: 1; }
        .sprint-timer { font-family: 'Courier Prime', monospace; color: var(--gold); font-size: 12px; white-space: nowrap; }
        .sprint-lines-bar { width: 100%; height: 10px; background: #141b22; border-radius: 5px; overflow: hidden; border: 1px solid #1f2933; }
        .sprint-lines-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #6ec6ff, #39ff14); transition: width 0.2s; }
        .sprint-lines-text { font-size: 11px; color: #8fa3b8; margin: 3px 0 8px; text-align: right; }
        .sprint-burnout-wrap { margin-bottom: 8px; }
        .sprint-burnout-label { font-size: 10px; color: #b9c9d8; margin-bottom: 3px; }
        .sprint-burnout-bar { width: 100%; height: 7px; background: #141b22; border-radius: 4px; overflow: hidden; border: 1px solid #1f2933; }
        .sprint-burnout-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #39ff14, #ffb84d); transition: width 0.2s, background 0.2s; }
        .sprint-burnout-fill.warn { background: linear-gradient(90deg, #ff9800, #ff3b3b); box-shadow: 0 0 8px rgba(255,59,59,0.6); }
        .sprint-actions { display: flex; gap: 8px; }
        .sprint-actions button { flex: 1; margin: 0; font-size: 12px; padding: 9px; }
        .sprint-actions button:disabled { opacity: 0.4; }

        .sprint-tier-card { background: rgba(255,255,255,0.04); border: 1px solid #26313d; border-radius: 10px; padding: 11px 12px; margin-bottom: 10px; }
        .sprint-tier-card.locked { opacity: 0.55; }
        .sprint-tier-head { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 700; margin-bottom: 3px; }
        .sprint-tier-lock { font-size: 11px; color: #ff8a8a; font-weight: 400; }
        .sprint-tier-desc { font-size: 11px; color: #8fa3b8; font-style: italic; margin-bottom: 6px; }
        .sprint-tier-stats { font-size: 12px; color: #dbe6ee; margin-bottom: 4px; }
        .sprint-tier-drop { font-size: 11px; color: var(--accent2); margin-bottom: 8px; }
        .sprint-tier-card button { margin: 0; font-size: 13px; padding: 9px; }

        #sprint-result-body { text-align: center; }
        .sprint-result-title { font-size: 17px; font-weight: 700; color: var(--gold); margin-bottom: 10px; }
        .sprint-result-tk { font-size: 26px; font-weight: 700; color: #39ff14; text-shadow: 0 0 12px rgba(57,255,20,0.5); margin-bottom: 8px; }
        .sprint-result-res { font-size: 13px; line-height: 1.7; margin-bottom: 8px; }
        .sprint-result-note { font-size: 11px; color: #ff8a8a; }

        /* QTE "Баги в коді": іконка й таймер-кільце всередині зони артворку (.clickable). */
        #sprint-qte-icon { position: absolute; z-index: 50; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; font-size: 24px; cursor: pointer; transform: translate(-50%, -50%); filter: drop-shadow(0 0 8px rgba(255,59,59,0.7)); animation: sprintQtePop 0.25s ease-out; }
        #sprint-qte-icon span { position: relative; z-index: 2; }
        /* Таймер-кільце: зовнішня рамка рівномірно стискається до нуля за qteWindowMs —
           простіше й надійніше за conic-gradient (той не анімується без @property). */
        #sprint-qte-ring { position: absolute; inset: -6px; border-radius: 50%; border: 3px solid #ff3b3b; box-sizing: border-box; transform: scale(1); }
        @keyframes sprintQteRing { from { transform: scale(1); opacity: 1; } to { transform: scale(0.05); opacity: 0.2; } }
        @keyframes sprintQtePop { from { transform: translate(-50%, -50%) scale(0.4); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }

        .notices-badge { position: absolute; top: 4px; right: 4px; min-width: 16px; height: 16px; line-height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; background: #ff3b3b; color: #fff; font-size: 10px; font-weight: 700; text-align: center; pointer-events: none; }
        .notices-badge.urgent { animation: badgeBlink 0.9s steps(1, end) infinite; }
        @keyframes badgeBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.25; } }

        #heat-case-overlay, #notices-screen, #sprint-tier-screen { position: fixed; inset: 0; z-index: 1700; background: rgba(10,8,5,0.94); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        #sprint-result-overlay { position: fixed; inset: 0; z-index: 1850; background: rgba(10,8,5,0.94); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
        .case-card { background: var(--panel-bg); border: 1px solid rgba(110,198,255,0.35); border-radius: 14px; padding: 16px; max-width: 480px; margin: 0 auto; box-shadow: 0 0 30px rgba(110,198,255,0.15); }
        .case-tier { font-family: 'Courier Prime', monospace; font-size: 17px; color: var(--gold); text-align: center; margin-bottom: 3px; }
        .case-flavor { font-size: 12px; color: #8fa3b8; text-align: center; font-style: italic; margin-bottom: 12px; }
        .case-mults { display: flex; gap: 8px; margin-bottom: 12px; }
        .case-mult { flex: 1; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px; text-align: center; }
        .case-mult b { display: block; font-size: 17px; font-family: 'Courier Prime', monospace; }
        .case-mult span { font-size: 10px; color: #8fa3b8; }
        .case-log { font-size: 12px; border-top: 1px solid #1f2933; padding-top: 8px; }
        .case-log-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .case-log-row span:first-child { color: #dbe6ee; }
        .case-log-up { color: #ff6b6b; font-weight: 700; white-space: nowrap; }
        .case-log-down { color: #39ff14; font-weight: 700; white-space: nowrap; }

        /* ===== Повістки ===== */
        .notice-card { background: rgba(255,255,255,0.04); border: 1px solid #26313d; border-left: 3px solid var(--accent); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
        .notice-card.urgent { border-left-color: #ff3b3b; box-shadow: 0 0 14px rgba(255,59,59,0.18); }
        .notice-head { display: flex; align-items: center; gap: 8px; }
        .notice-emoji { font-size: 26px; line-height: 1; }
        .notice-name { font-weight: 700; font-size: 14px; }
        .notice-flavor { font-size: 11px; color: #8fa3b8; font-style: italic; }
        .notice-timer { margin-left: auto; font-family: 'Courier Prime', monospace; font-size: 15px; color: var(--gold); white-space: nowrap; }
        .notice-card.urgent .notice-timer { color: #ff6b6b; }
        .notice-threat { font-size: 11px; color: #ffb4b4; background: rgba(255,59,59,0.08); border-radius: 6px; padding: 6px 8px; margin: 8px 0; line-height: 1.45; }
        .notice-card button { font-size: 13px; padding: 9px; margin-bottom: 6px; text-align: left; }
        .notice-cost { float: right; color: #8fa3b8; font-size: 11px; font-weight: 400; }

        /* ===== PvP: стук і розслідування ===== */
        #profile-overlay, #investigation-screen { position: fixed; inset: 0; z-index: 1750; background: rgba(10,8,5,0.94); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        .vs-grid { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; align-items: center; margin-bottom: 12px; }
        .vs-name { font-weight: 700; font-size: 14px; text-align: center; padding-bottom: 6px; border-bottom: 1px solid #1f2933; }
        .vs-name.them { color: var(--accent); }
        .vs-row { display: contents; }
        .vs-cell { font-size: 13px; padding: 5px 4px; text-align: center; }
        .vs-cell.win { color: #39ff14; font-weight: 700; }
        .vs-label { font-size: 10px; color: #8fa3b8; text-align: center; white-space: nowrap; padding: 0 4px; }
        .snitch-btn { background: linear-gradient(45deg, #7b1020, #c3073f) !important; border-color: #ff6b6b !important; }
        .snitch-note { font-size: 11px; color: #8fa3b8; text-align: center; margin-top: -4px; margin-bottom: 10px; line-height: 1.45; }
        .snitch-line { font-size: 12px; color: #dbe6ee; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; text-align: center; }

        .invest-banner { background: linear-gradient(135deg, rgba(195,7,63,0.22), rgba(255,59,59,0.10)); border: 1px solid rgba(255,59,59,0.55); border-radius: 10px; padding: 11px 12px; margin-bottom: 14px; cursor: pointer; }
        .invest-banner b { color: #ff8a8a; }
        .suspect-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid #26313d; border-radius: 10px; padding: 11px 12px; margin-bottom: 10px; cursor: pointer; }
        .suspect-card:active { border-color: var(--accent); }
        .suspect-face { font-size: 26px; }
        .suspect-name { font-weight: 700; font-size: 14px; }
        .suspect-meta { font-size: 11px; color: #8fa3b8; }
        .leader-row { cursor: pointer; }
        .leader-row:active { color: var(--accent2); }

        /* ===== Медкомісія ===== */
        #medcom-screen { position: fixed; inset: 0; z-index: 1800; background: rgba(10,8,5,0.96); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        .symptom-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 2px solid #26313d; border-radius: 10px; padding: 10px 11px; margin-bottom: 8px; cursor: pointer; transition: border-color .15s, background .15s; }
        .symptom-card.picked { border-color: var(--gold); background: rgba(255,215,0,0.10); }
        .symptom-card.repeated { opacity: 0.75; }
        .symptom-emoji { font-size: 24px; }
        .symptom-name { font-size: 13px; font-weight: 700; line-height: 1.3; }
        .symptom-power { margin-left: auto; font-size: 15px; font-weight: 700; color: var(--gold); white-space: nowrap; }
        .symptom-note { font-size: 10px; color: #ff8a8a; }
        .medcom-scale { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; font-weight: 700; background: rgba(255,255,255,0.05); border-radius: 10px; padding: 10px 12px; margin: 12px 0; }
        .medcom-scale .val { font-size: 19px; }
        .medcom-ok { color: #39ff14; }
        .medcom-bad { color: #ff4d4d; }
        .medcom-bonus { display: flex; align-items: center; gap: 8px; font-size: 12px; background: rgba(255,255,255,0.03); border: 1px solid #1f2933; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
        .medcom-bonus.off { opacity: 0.45; }
        .medcom-bonus input { width: 16px; height: 16px; accent-color: var(--gold); }

        /* ===== Інспектори ТЦК ===== */
        #inspector-screen { position: fixed; inset: 0; z-index: 1900; background: radial-gradient(circle at 50% 30%, #2a0d16 0%, #07070d 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box; text-align: center; }
        #inspector-face { font-size: 82px; line-height: 1; margin-bottom: 6px; }
        #inspector-face.hit { animation: inspShake .12s; }
        @keyframes inspShake { 0%{transform:translateX(0)} 25%{transform:translateX(-7px) rotate(-3deg)} 75%{transform:translateX(7px) rotate(3deg)} 100%{transform:translateX(0)} }
        #inspector-name { font-size: 20px; font-weight: 800; color: var(--gold); }
        #inspector-taunt { font-size: 12px; color: #dbe6ee; font-style: italic; margin: 6px 0 14px; max-width: 320px; }
        .insp-hpbar { width: 100%; max-width: 340px; height: 22px; background: #1a140c; border-radius: 11px; overflow: hidden; border: 1px solid #26313d; }
        .insp-hpfill { height: 100%; background: linear-gradient(90deg, #c3073f, #ff6b6b); transition: width .12s linear; }
        .insp-hptext { font-size: 12px; color: #8fa3b8; margin: 6px 0 2px; }
        #inspector-timer { font-size: 30px; font-weight: 800; margin: 10px 0 4px; }
        #inspector-timer.low { color: #ff4d4d; }
        #inspector-weak { font-size: 12px; padding: 7px 12px; border-radius: 8px; margin: 8px 0 14px; background: rgba(255,255,255,0.05); color: #8fa3b8; max-width: 340px; }
        #inspector-weak.on { background: rgba(57,255,20,0.14); color: #39ff14; font-weight: 700; }
        #inspector-hitzone { width: 190px; height: 190px; border-radius: 50%; border: 3px solid var(--accent); background: radial-gradient(circle, rgba(195,7,63,0.35), rgba(195,7,63,0.08)); display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; cursor: pointer; user-select: none; -webkit-user-select: none; }
        #inspector-hitzone:active { transform: scale(0.96); }
        .insp-roster-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid #26313d; border-radius: 10px; padding: 10px 11px; margin-bottom: 8px; text-align: left; }
        .insp-roster-card.locked { opacity: 0.55; }
        .insp-roster-name { font-size: 13px; font-weight: 700; }
        .insp-roster-meta { font-size: 11px; color: #8fa3b8; line-height: 1.4; }

        /* ===== Відстрочки та блокпост ===== */
        #deferment-screen, #checkpoint-screen, #map-screen, #nickname-screen { position: fixed; inset: 0; z-index: 1780; background: rgba(10,8,5,0.95); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        #nickname-screen { display: flex; align-items: center; }
        #nickname-screen.hidden { display: none; }
        .map-wrap { max-width: 640px; margin: 0 auto; }
        .map-img-wrap { position: relative; width: 100%; border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
        .map-img-wrap img { width: 100%; display: block; }
        .map-hotspot { position: absolute; width: auto; margin-bottom: 0; transform: translate(-50%, -50%); background: rgba(10,8,5,0.7); border: 1px solid var(--gold); border-radius: 8px; padding: 4px 8px; font-size: 11px; color: #fff; cursor: pointer; white-space: nowrap; }
        /* Іконки поставлених гравцем споруд — background-image, не <img>, щоб не
           зачепити правило ".map-img-wrap img { width:100% }" вище (те для фону карти). */
        .map-marker { position: absolute; width: 13%; aspect-ratio: 1; transform: translate(-50%, -50%); background-size: contain; background-repeat: no-repeat; background-position: center; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.7)); z-index: 4; }
        .map-img-wrap.placing { cursor: crosshair; outline: 2px dashed var(--gold); outline-offset: 2px; }
        .defer-card { background: rgba(255,255,255,0.04); border: 1px solid #26313d; border-radius: 10px; padding: 11px 12px; margin-bottom: 9px; }
        .defer-card.locked { opacity: 0.55; }
        .defer-head { display: flex; align-items: center; gap: 9px; }
        .defer-name { font-size: 14px; font-weight: 700; }
        .defer-dur { margin-left: auto; font-size: 12px; color: var(--gold); white-space: nowrap; }
        .defer-flavor { font-size: 11px; color: #8fa3b8; font-style: italic; margin: 5px 0 8px; line-height: 1.4; }
        .defer-cost { font-size: 12px; color: #dbe6ee; margin-bottom: 8px; }
        .defer-reason { font-size: 11px; color: #ff8a8a; margin-top: 6px; }
        .defer-active { background: linear-gradient(135deg, rgba(57,255,20,0.16), rgba(57,255,20,0.05)); border: 1px solid rgba(57,255,20,0.5); border-radius: 10px; padding: 12px; margin-bottom: 14px; text-align: center; }
        .defer-active b { color: #39ff14; }
        #defer-chip { display: none; align-items: center; gap: 4px; font-size: 11px; background: rgba(57,255,20,0.14); color: #39ff14; border-radius: 20px; padding: 3px 9px; font-weight: 700; }
        #defer-chip.on { display: inline-flex; }
        .cp-choice { background: rgba(255,255,255,0.04); border: 2px solid #26313d; border-radius: 10px; padding: 12px; margin-bottom: 10px; cursor: pointer; }
        .cp-choice:active { border-color: var(--accent); }
        .cp-head { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 700; }
        .cp-chance { margin-left: auto; font-size: 16px; color: var(--gold); }
        .cp-fail { font-size: 11px; color: #ff8a8a; margin-top: 6px; }

        /* ===== Дерево навичок ===== */
        #skills-screen { position: fixed; inset: 0; z-index: 1790; background: rgba(10,8,5,0.96); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        .skill-points { text-align: center; font-size: 15px; font-weight: 700; background: rgba(255,215,0,0.12); border: 1px solid rgba(255,215,0,0.4); border-radius: 10px; padding: 10px; margin-bottom: 14px; }
        .skill-points b { color: var(--gold); font-size: 20px; }
        .skill-branch { margin-bottom: 18px; }
        .skill-branch-head { font-size: 15px; font-weight: 800; color: var(--gold); margin-bottom: 2px; }
        .skill-branch-desc { font-size: 11px; color: #8fa3b8; margin-bottom: 9px; }
        .skill-node { display: flex; align-items: flex-start; gap: 10px; background: rgba(255,255,255,0.03); border: 1px solid #1f2933; border-radius: 9px; padding: 9px 10px; margin-bottom: 6px; }
        .skill-node.owned { border-color: rgba(57,255,20,0.5); background: rgba(57,255,20,0.07); }
        .skill-node.locked { opacity: 0.42; }
        .skill-dot { width: 22px; height: 22px; border-radius: 50%; background: #1f2933; color: #8fa3b8; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .skill-node.owned .skill-dot { background: #39ff14; color: #08210a; }
        .skill-name { font-size: 13px; font-weight: 700; }
        .skill-desc { font-size: 11px; color: #8fa3b8; line-height: 1.4; }
        .skill-locked-hint { font-size: 10px; color: #e0574f; font-weight: normal; }
        .skill-node button { width: auto; margin: 0 0 0 auto; padding: 6px 12px; font-size: 12px; flex-shrink: 0; align-self: center; }

        /* Перемикач ×1/×10/MAX для апгрейдів */
        .buy-switch { display: flex; gap: 6px; margin-bottom: 10px; }
        .buy-switch button { flex: 1; margin: 0; padding: 7px; font-size: 12px; background: rgba(255,255,255,0.06); border: 1px solid #26313d; color: #dbe6ee; }
        .buy-switch button.active { background: linear-gradient(45deg, var(--accent), var(--accent2)); border-color: var(--gold); color: #fff; font-weight: 700; }

        /* Офлайн-звіт */
        #offline-report { position: fixed; inset: 0; z-index: 1850; background: rgba(10,8,5,0.95); display: flex; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box; }
        .offline-line { display: flex; align-items: center; gap: 9px; font-size: 13px; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 9px 11px; margin-bottom: 7px; }
        .offline-line b { margin-left: auto; color: var(--gold); white-space: nowrap; }
        .offline-line.bad b { color: #ff8a8a; }

        /* ===== Репутація з районом ===== */
        #reputation-screen { position: fixed; inset: 0; z-index: 1770; background: rgba(10,8,5,0.96); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        .npc-card { background: rgba(255,255,255,0.04); border: 1px solid #26313d; border-radius: 11px; padding: 12px; margin-bottom: 11px; }
        .npc-card.maxed { border-color: rgba(255,215,0,0.55); background: rgba(255,215,0,0.07); }
        .npc-head { display: flex; align-items: center; gap: 9px; margin-bottom: 4px; }
        .npc-name { font-size: 15px; font-weight: 800; }
        .npc-rep { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--gold); }
        .npc-about { font-size: 11px; color: #8fa3b8; font-style: italic; line-height: 1.4; margin-bottom: 8px; }
        .npc-quest { background: rgba(0,0,0,0.25); border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; }
        .npc-quest-text { font-size: 12px; margin-bottom: 6px; }
        .npc-quest-prog { font-size: 11px; color: #8fa3b8; }
        .npc-quest-prog.done { color: #39ff14; font-weight: 700; }
        .npc-perk { font-size: 11px; color: #dbe6ee; background: rgba(255,255,255,0.05); border-radius: 7px; padding: 7px 9px; margin-top: 7px; }
        .npc-perk.on { color: #ffd700; }

        /* ===== Сезони, ліги, війни ===== */
        #season-screen, #war-screen, #season-result { position: fixed; inset: 0; z-index: 1795; background: rgba(10,8,5,0.96); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        .league-badge { text-align: center; font-size: 20px; font-weight: 800; color: var(--gold); margin-bottom: 2px; }
        .league-sub { text-align: center; font-size: 12px; color: #8fa3b8; margin-bottom: 12px; }
        .standing-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 7px 9px; border-radius: 7px; margin-bottom: 4px; background: rgba(255,255,255,0.03); }
        .standing-row.me { background: rgba(255,215,0,0.13); border: 1px solid rgba(255,215,0,0.4); font-weight: 700; }
        .standing-row.promote { border-left: 3px solid #39ff14; }
        .standing-row.relegate { border-left: 3px solid #ff4d4d; }
        .standing-rank { width: 22px; color: #8fa3b8; }
        .standing-pts { margin-left: auto; color: var(--gold); font-weight: 700; }
        .season-title-chip { display: inline-block; font-size: 10px; background: rgba(255,215,0,0.18); color: #ffd700; border-radius: 10px; padding: 1px 7px; margin-left: 5px; }
        .war-scores { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .war-side { flex: 1; text-align: center; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 11px; }
        .war-side.mine { border: 1px solid rgba(57,255,20,0.45); }
        .war-side.theirs { border: 1px solid rgba(255,77,77,0.45); }
        .war-side b { display: block; font-size: 22px; color: var(--gold); }
        .war-side span { font-size: 11px; color: #8fa3b8; }
        .enemy-row { display: flex; align-items: center; gap: 8px; font-size: 13px; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
        .enemy-row button { width: auto; margin: 0 0 0 auto; padding: 5px 11px; font-size: 12px; }
        #district-screen { position: fixed; inset: 0; z-index: 1900; background: radial-gradient(circle at 50% 30%, #2a1a0d 0%, #07070d 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box; text-align: center; }
        #district-bus { font-size: 76px; line-height: 1; }
        #district-bus.hit { animation: inspShake .12s; }
        .district-contrib { font-size: 12px; color: #dbe6ee; display: flex; gap: 8px; padding: 4px 0; }
        .district-contrib b { margin-left: auto; color: var(--gold); }

        /* ===== Довідка механік ===== */
        #codex-screen { position: fixed; inset: 0; z-index: 1960; background: rgba(10,8,5,0.97); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        /* ===== Книга скарг ===== */
        #complaint-screen { position: fixed; inset: 0; z-index: 1960; background: rgba(10,8,5,0.97); overflow-y: auto; padding: 16px; box-sizing: border-box; }
        .codex-nav { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
        .codex-nav button { width: auto; flex: none; margin: 0; padding: 5px 10px; font-size: 11px; background: rgba(255,255,255,0.06); border: 1px solid #26313d; color: #dbe6ee; }
        .codex-nav button.active { background: linear-gradient(45deg, var(--accent), var(--accent2)); border-color: var(--gold); color: #fff; font-weight: 700; }
        .codex-sec h3 { font-size: 16px; color: var(--gold); margin: 0 0 4px; }
        .codex-lead { font-size: 12px; color: #8fa3b8; line-height: 1.55; margin: 0 0 12px; }
        .codex-block { background: rgba(255,255,255,0.04); border: 1px solid #1f2933; border-radius: 9px; padding: 10px 11px; margin-bottom: 9px; }
        .codex-block h4 { font-size: 13px; margin: 0 0 5px; color: #fff; }
        .codex-block p { font-size: 12px; color: #dbe6ee; line-height: 1.5; margin: 0 0 6px; }
        .codex-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .codex-table td { padding: 4px 5px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #dbe6ee; vertical-align: top; }
        .codex-table td:last-child { text-align: right; color: var(--gold); white-space: nowrap; font-weight: 600; }
        .codex-tip { font-size: 11.5px; line-height: 1.5; color: #b9ffb0; background: rgba(57,255,20,0.08); border-left: 3px solid rgba(57,255,20,0.5); border-radius: 0 7px 7px 0; padding: 8px 10px; margin-bottom: 9px; }
        .codex-warn { font-size: 11.5px; line-height: 1.5; color: #ffc9c9; background: rgba(255,77,77,0.09); border-left: 3px solid rgba(255,77,77,0.55); border-radius: 0 7px 7px 0; padding: 8px 10px; margin-bottom: 9px; }

        .clickable { position: relative; display: inline-block; transition: transform 0.05s; cursor: pointer; }
        .clickable:active { transform: scale(0.92); }
        .clickable img { height: 26vh; max-width: 85vw; object-fit: contain; filter: drop-shadow(0 0 20px rgba(255,255,255,0.1)); pointer-events: none; user-select: none; border-radius: 12px; }
        .clickable .emoji-fallback { font-size: 90px; filter: drop-shadow(0 0 20px rgba(255,255,255,0.1)); }
        .location-name { display: block; font-weight: bold; color: var(--accent2); text-transform: uppercase; letter-spacing: 2px; font-size: 12px; text-shadow: 0 0 6px rgba(110,198,255,0.6); margin-bottom: 6px; }

        /* Плитка замість горизонтальної стрічки-скролу — 12 вкладок верхнього рівня
           не влазили без гортання вбік. flex-wrap показує все одразу, дрібнішим
           шрифтом/паддінгом. */
        .tabs-container { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .tab { padding: 7px 12px; background: var(--btn); border: 1px solid rgba(110,198,255,0.15); text-align: center; border-radius: 999px; cursor: pointer; font-weight: 600; font-size: 11px; color: #8fa3b8; white-space: nowrap; font-family: inherit; }
        .tab.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); border-color: transparent; color: #fff; box-shadow: 0 0 12px rgba(53,81,107,0.6), 0 0 20px rgba(110,198,255,0.4); }

        .panel { display: none; background: rgba(12,17,23,0.4); padding: 15px; border-radius: 12px; min-height: 38vh; overflow-y: auto; border: 1px solid rgba(110,198,255,0.2); box-sizing: border-box; backdrop-filter: blur(3px); }
        /* Верхньорівневі панелі розтягуються на весь простір, що лишився під шапкою й
           вкладками (замість фіксованих 50vh, через які знизу лишалось порожнє місце). */
        .panel.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        button { width: 100%; padding: 12px 20px; margin-bottom: 10px; border: 1px solid rgba(110,198,255,0.25); border-radius: 999px; background: var(--btn); color: white; font-weight: 600; font-size: 15px; cursor: pointer; transition: 0.2s; font-family: inherit; }
        button:active { transform: scale(0.98); box-shadow: 0 0 12px rgba(110,198,255,0.5); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .premium-btn { background: linear-gradient(45deg, #5b1fb3, #00c3ff); border: 1px solid #fff; }
        .dev-notice { background: rgba(255,193,7,0.1); border: 1px solid rgba(255,193,7,0.4); color: #ffca6a; border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.5; margin-bottom: 16px; }

        /* ===== Ящики ===== */
        .crate-card { background: rgba(255,255,255,0.04); border: 1px solid #1f2933; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
        .crate-card.stars { border-color: rgba(180,225,255,0.5); background: linear-gradient(135deg, rgba(156,39,176,0.12), rgba(180,225,255,0.08)); }
        .crate-card.on-sale { border-color: rgba(57,255,20,0.55); box-shadow: 0 0 14px rgba(57,255,20,0.15); }
        .sale-badge { display: inline-block; margin-left: 7px; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; background: #39ff14; color: #07230a; vertical-align: middle; }
        .crate-top { display: flex; align-items: center; gap: 10px; }
        .crate-top img { width: 48px; height: 48px; object-fit: contain; flex-shrink: 0; }
        .crate-name { font-weight: 700; font-size: 14px; }
        .crate-desc { font-size: 11px; color: #8fa3b8; line-height: 1.4; margin-top: 2px; }
        .crate-card button { margin: 10px 0 0; }
        .crate-odds-toggle { background: none; border: none; color: var(--accent2); font-size: 11px; padding: 6px 0 0; margin: 0; width: auto; text-decoration: underline; cursor: pointer; }
        .crate-odds { font-size: 11px; color: #8fa3b8; margin-top: 6px; border-top: 1px solid #1f2933; padding-top: 6px; }
        .crate-odds div { display: flex; justify-content: space-between; padding: 1px 0; }

        /* ===== Анімація відкривання ящика ===== */
        #crate-overlay { position: fixed; inset: 0; z-index: 1800; background: rgba(10,8,5,0.94); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
        #crate-stage { position: relative; width: 260px; height: 260px; display: flex; align-items: center; justify-content: center; }
        #crate-box { position: relative; width: 150px; height: 150px; }
        #crate-box img { width: 100%; height: 100%; object-fit: contain; }
        #crate-rays { position: absolute; width: 340px; height: 340px; border-radius: 50%; opacity: 0; pointer-events: none;
            background: conic-gradient(from 0deg, transparent 0deg 8deg, rgba(180,225,255,0.55) 8deg 16deg, transparent 16deg 24deg); }
        #crate-sparks { position: absolute; inset: 0; pointer-events: none; }
        .crate-spark { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 10px var(--gold); opacity: 0; }
        #crate-prize { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; opacity: 0; transform: scale(0.4); pointer-events: none; }
        #crate-prize-icon { font-size: 76px; line-height: 1; filter: drop-shadow(0 0 18px rgba(180,225,255,0.8)); }
        #crate-prize-icon img { width: 96px; height: 96px; object-fit: contain; }
        #crate-prize-title { font-family: 'Courier Prime', monospace; font-size: 19px; font-weight: 700; color: var(--gold); text-shadow: 0 0 12px rgba(180,225,255,0.7); text-align: center; }
        #crate-prize-desc { font-size: 14px; color: var(--text); text-align: center; max-width: 78vw; }
        #crate-close, #crate-again { width: auto; padding: 12px 32px; margin: 0; }
        #crate-again { background: linear-gradient(45deg, #ff9800, #ff5722); }

        /* Крок 1: коробка нервово трясеться */
        #crate-overlay.stage-shake #crate-box { animation: crateShake 0.45s ease-in-out infinite; }
        @keyframes crateShake {
            0%, 100% { transform: translateX(0) rotate(0deg); }
            20% { transform: translateX(-7px) rotate(-5deg); }
            45% { transform: translateX(6px) rotate(4deg); }
            70% { transform: translateX(-4px) rotate(-3deg); }
        }
        /* Крок 2: спалах, промені, коробка розлітається */
        #crate-overlay.stage-burst #crate-rays { animation: crateRays 1.1s ease-out forwards; }
        @keyframes crateRays {
            0% { opacity: 0; transform: scale(0.3) rotate(0deg); }
            35% { opacity: 0.9; }
            100% { opacity: 0; transform: scale(1.5) rotate(150deg); }
        }
        /* Кінцевий стан задано і класом, і анімацією: якщо анімація чомусь не відпрацює
           (фонова вкладка, prefers-reduced-motion), приз усе одно буде видимий. */
        #crate-overlay.stage-burst #crate-box { opacity: 0; animation: crateBurst 0.55s ease-in forwards; }
        @keyframes crateBurst {
            0% { transform: scale(1); opacity: 1; }
            35% { transform: scale(1.35); opacity: 1; }
            100% { transform: scale(0.2); opacity: 0; }
        }
        #crate-overlay.stage-burst .crate-spark { animation: crateSpark 0.9s ease-out forwards; }
        @keyframes crateSpark {
            0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.2); }
        }
        /* Крок 3: приз виїжджає */
        #crate-overlay.stage-reveal #crate-prize { opacity: 1; transform: scale(1); animation: cratePrize 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) forwards; }
        @keyframes cratePrize {
            0% { opacity: 0; transform: scale(0.4); }
            100% { opacity: 1; transform: scale(1); }
        }
        /* Гарантований фінальний стан. Ключове: якщо анімація не встигла відпрацювати
           (згорнута вкладка, енергозбереження, reduced-motion), вона лишається замороженою
           на 0% кейфреймі й перекриває звичайні правила — тому тут ми її взагалі вимикаємо
           (animation: none) і жорстко фіксуємо кінцевий вигляд. Без цього гравець міг би
           побачити зависле віко ящика й невидимий приз. */
        #crate-overlay.anim-done #crate-box { animation: none !important; opacity: 0; }
        #crate-overlay.anim-done #crate-rays { animation: none !important; opacity: 0; }
        #crate-overlay.anim-done .crate-spark { animation: none !important; opacity: 0; }
        #crate-overlay.anim-done #crate-prize { animation: none !important; opacity: 1; transform: scale(1); }

        @media (prefers-reduced-motion: reduce) {
            #crate-box, #crate-rays, .crate-spark, #crate-prize { animation: none !important; }
            #crate-overlay.stage-reveal #crate-prize { opacity: 1; transform: scale(1); }
        }

        /* Порожній дроп — без золотого святкування, приз просто сумно зʼявляється */
        #crate-overlay.result-nothing #crate-prize-icon { filter: grayscale(1) drop-shadow(0 0 8px rgba(0,0,0,0.6)); }
        #crate-overlay.result-nothing #crate-prize-title { color: #7d8b99; text-shadow: none; }

        /* ===== Кладовка ===== */
        .storage-header { background: rgba(255,255,255,0.04); border: 1px solid rgba(110,198,255,0.2); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
        .storage-bar-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
        .storage-bar { width: 100%; height: 10px; background: #141b22; border-radius: 5px; overflow: hidden; border: 1px solid #1f2933; }
        .storage-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #39ff14, #8ed4ff); transition: width 0.3s; }
        .storage-fill.full { background: linear-gradient(90deg, #ff5722, #ff1744); }
        .storage-header button { margin: 10px 0 0; font-size: 13px; padding: 9px; }
        .res-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid #1f2933; border-radius: 8px; padding: 9px 11px; margin-bottom: 7px; }
        .res-card.empty { opacity: 0.4; }
        .res-emoji { font-size: 24px; width: 28px; text-align: center; }
        .res-img { width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
        .res-info { flex: 1; min-width: 0; }
        .res-name { font-size: 13px; font-weight: 600; }
        .res-meta { font-size: 10px; color: #8fa3b8; }
        .res-qty { font-family: 'Courier Prime', monospace; font-size: 16px; color: var(--gold); min-width: 34px; text-align: right; }
        .res-card button { width: auto; margin: 0; padding: 6px 10px; font-size: 11px; white-space: nowrap; }
        .res-tier-1 { border-left: 3px solid #78909c; }
        .res-tier-2 { border-left: 3px solid #29b6f6; }
        .res-tier-3 { border-left: 3px solid #ab47bc; }
        .res-tier-4 { border-left: 3px solid var(--gold); }
        .memory-card { aspect-ratio: 1; background: #1b2530; border: 1px solid #26313d; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 26px; cursor: pointer; user-select: none; }
        .memory-card.flipped { background: rgba(110,198,255,0.15); border-color: var(--gold); }
        .memory-card.matched { background: rgba(57,255,20,0.12); border-color: #39ff14; opacity: 0.7; cursor: default; }
        .risk-tier-btn { display: block; width: 100%; text-align: left; margin-bottom: 6px; }
        .risk-tier-btn.active { border-color: var(--gold); background: rgba(110,198,255,0.15); }
        .recipe-card { background: rgba(255,255,255,0.04); border: 1px solid #1f2933; border-radius: 9px; padding: 11px; margin-bottom: 9px; }
        .recipe-card.ready { border-color: rgba(57,255,20,0.5); }
        .recipe-title { font-size: 14px; font-weight: 700; }
        .recipe-desc { font-size: 11px; color: #8fa3b8; margin: 3px 0 7px; }
        .recipe-cost { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .recipe-ing { font-size: 11px; padding: 3px 7px; border-radius: 5px; background: #141b22; border: 1px solid #1f2933; }
        .recipe-ing.ok { border-color: rgba(57,255,20,0.6); color: #b9ffb0; }
        .recipe-ing.missing { border-color: rgba(255,87,34,0.6); color: #ffb59c; }
        .recipe-card button { margin: 0; padding: 8px; font-size: 12px; }
        .shield-note { background: rgba(57,255,20,0.1); border: 1px solid rgba(57,255,20,0.4); color: #b9ffb0; border-radius: 6px; padding: 7px 10px; font-size: 11px; margin-bottom: 10px; }

        /* ===== Статистика та колекція ===== */
        .stat-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 12px; padding: 6px 2px; border-bottom: 1px solid #22222f; }
        .stat-row b { font-family: 'Courier Prime', monospace; color: var(--gold); font-size: 12px; white-space: nowrap; }
        .coll-row { margin-bottom: 9px; }
        .coll-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }

        /* ===== Багаторівневі апгрейди магазину ===== */
        .upg-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid #1f2933; border-radius: 8px; padding: 9px 11px; margin-bottom: 8px; }
        .upg-card img { width: 34px; height: 34px; object-fit: contain; flex-shrink: 0; }
        .upg-info { flex: 1; min-width: 0; }
        .upg-name { font-size: 13px; font-weight: 600; }
        .upg-meta { font-size: 10px; color: #8fa3b8; }
        .upg-card button { width: auto; margin: 0; padding: 8px 12px; font-size: 12px; white-space: nowrap; }
        .stars-section-title { font-size: 14px; margin: 0 0 8px; text-align: center; color: #eee; }
        .donate-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .donate-btn { background: linear-gradient(45deg, #35516b, #ff9800); margin-bottom: 0; padding: 10px 4px; font-size: 13px; }
        .gacha-btn { background: linear-gradient(45deg, #ff9800, #ff5722); font-size: 16px; padding: 15px; box-shadow: 0 0 14px rgba(255,87,34,0.4); }
        .gacha-btn-premium { background: linear-gradient(45deg, #9c27b0, #673ab7); box-shadow: 0 0 14px rgba(156,39,176,0.5); }
        .btn-icon { width: 24px; height: 24px; vertical-align: middle; margin-right: 8px; border-radius: 5px; object-fit: cover; }
        .btn-emoji { display: inline-block; width: 24px; text-align: center; margin-right: 8px; }

        .click-text { position: absolute; color: var(--accent2); font-family: 'Courier Prime', monospace; font-weight: 700; font-size: 22px; pointer-events: none; animation: floatUp 0.8s ease-out forwards; text-shadow: 0 0 6px var(--accent2), 0 0 14px var(--accent), 1px 1px 2px #000; z-index: 50; }
        @keyframes floatUp { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(-60px) scale(1.5); opacity: 0; } }

        #raid-screen, #knock-screen { position: fixed; top:0; left:0; right:0; bottom:0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; background-size: cover; background-position: center; }
        #raid-screen { background-image: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.75)), url('/images/raid-background.webp'); }
        #knock-screen { background-image: linear-gradient(rgba(120,0,0,0.75), rgba(80,0,0,0.85)), url('/images/qte-knock-door.webp'); }
        #raid-screen h1, #knock-screen h1 { color: #ff0000; font-size: 36px; animation: blink 0.2s infinite; text-align: center; margin: 0; padding: 0 20px; }
        #raid-timer, #knock-timer { font-size: 30px; color: #fff; margin: 20px 0; }
        #raid-progress { width: 80%; height: 30px; background: #1f2933; border: 2px solid #fff; border-radius: 15px; overflow: hidden; margin-bottom: 30px; }
        #raid-fill { width: 0%; height: 100%; background: #ff0000; transition: width 0.1s; }
        .run-btn { font-size: 16px; font-weight: bold; padding: 10px; background: #ff0000; border-radius: 50%; width: 150px; height: 150px; border: 5px solid #fff; box-shadow: 0 0 30px #ff0000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
        .run-btn img { width: 50px; height: 50px; pointer-events: none; }
        .knock-btn { padding: 10px; background: #1f2933; border-radius: 20px; border: 4px solid #fff; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center; }
        .knock-btn img { width: 90px; height: 90px; pointer-events: none; }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

        .airdrop { position: fixed; font-size: 36px; z-index: 900; cursor: pointer; animation: flyAcross 3s linear forwards; }
        @keyframes flyAcross { 0% { transform: translateX(-20px) translateY(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(20px) translateY(-40px); opacity: 0; } }

        #gacha-result { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #14100a; border: 2px solid var(--accent2); padding: 30px; border-radius: 15px; z-index: 500; text-align: center; box-shadow: 0 0 40px rgba(110,198,255,0.5), 0 0 70px rgba(53,81,107,0.3); display: none; max-width: 80vw; }
        #gacha-icon { width: 120px; height: 120px; object-fit: contain; margin: 10px auto; display: block; }
        .hidden { display: none !important; }
        /* Контент, недоступний за поточним рівнем ухилянта, більше не ЗНИКАЄ —
           лишається на місці, затемнений і з замочком, щоб новачок бачив, що
           попереду, замість порожньої вкладки нізвідки. */
        .locked { position: relative; opacity: 0.4; filter: grayscale(0.7); cursor: not-allowed; }
        .locked::after { content: '🔒'; position: absolute; top: -4px; right: -4px; font-size: 11px; filter: none; opacity: 1; text-shadow: 0 1px 2px #000; }

        #splash-screen { position: fixed; inset: 0; background: #000; z-index: 2000; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 40px; box-sizing: border-box; transition: opacity 0.4s ease; overflow: hidden; }
        /* object-fit:cover обрізав відео під весь екран — тепер contain: усе відео
           видно цілком (з чорними полями зверху/знизу чи з боків, якщо пропорції не
           збігаються), нічого не обрізається. */
        #splash-screen video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
        #splash-screen span { position: relative; z-index: 1; color: #fff; font-weight: bold; letter-spacing: 2px; text-shadow: 0 0 10px #000; animation: pulse 1s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        .asset-row { display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); border: 1px solid #1f2933; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
        .asset-name { font-weight: bold; }
        .asset-price { color: var(--gold); font-weight: bold; }
        .asset-controls { display: flex; gap: 6px; align-items: center; }
        .asset-controls input { width: 50px; text-align: center; background: #131a21; color: #fff; border: 1px solid #26313d; border-radius: 4px; padding: 4px; }
        .asset-controls button { width: auto; padding: 6px 10px; margin: 0; font-size: 12px; }
        .sparkline { height: 24px; width: 70px; }

        .clan-card { background: rgba(255,255,255,0.05); border: 1px solid #1f2933; border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
        .clan-card button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; }

        .pet-card { position: relative; background-color: rgba(255,255,255,0.05); background-size: cover; background-position: center; border: 1px solid #1f2933; border-radius: 10px; padding: 10px; margin-bottom: 12px; min-height: 92px; box-sizing: border-box; max-width: 65%; overflow: hidden; text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7); }
        .pet-card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,8,5,0.88) 0%, rgba(10,8,5,0.6) 55%, rgba(10,8,5,0.05) 100%); z-index: 0; }
        .pet-card > * { position: relative; z-index: 1; }
        .pet-card.equipped { border-color: var(--gold); box-shadow: 0 0 10px rgba(255,212,71,0.4); }
        .pet-card .pet-title { font-weight: bold; }
        .pet-card .pet-desc { font-size: 11px; color: #e8dfce; margin: 4px 0 8px; }
        .pet-card button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; text-shadow: none; }

        .ach-row { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px; margin-bottom: 6px; opacity: 0.5; }
        .ach-row.unlocked { opacity: 1; border: 1px solid var(--gold); }
        .ach-icon { font-size: 22px; }
        .ach-name { font-weight: bold; font-size: 13px; }
        .ach-desc { font-size: 11px; color: #9db0c2; }

        .wheel-wrap { display: flex; flex-direction: column; align-items: center; margin: 15px 0; }
        #wheel { width: 220px; height: 220px; border-radius: 50%; border: 6px solid var(--accent2); box-shadow: 0 0 25px rgba(110,198,255,0.6); position: relative; transition: transform 4s cubic-bezier(0.15, 0.9, 0.2, 1); }
        .wheel-pointer { width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-bottom: 20px solid var(--accent2); filter: drop-shadow(0 0 6px var(--accent2)); margin-bottom: -4px; z-index: 2; }
        #wheel-labels { position: absolute; inset: 0; pointer-events: none; }

        .cosmetic-hat { position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 52px; height: 52px; font-size: 42px; line-height: 52px; text-align: center; z-index: 5; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
        .cosmetic-face { position: absolute; top: 38%; left: 50%; transform: translateX(-50%); width: 38px; height: 38px; font-size: 30px; line-height: 38px; text-align: center; z-index: 5; pointer-events: none; }
        .cosmetic-neck { position: absolute; top: 62%; left: 50%; transform: translateX(-50%); width: 38px; height: 38px; font-size: 30px; line-height: 38px; text-align: center; z-index: 5; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
        @keyframes rainbowGlow {
            0% { box-shadow: 0 0 0 4px #35516b, 0 0 25px 6px #35516b88; }
            17% { box-shadow: 0 0 0 4px #ff9800, 0 0 25px 6px #ff980088; }
            34% { box-shadow: 0 0 0 4px #8ed4ff, 0 0 25px 6px #8ed4ff88; }
            50% { box-shadow: 0 0 0 4px #39ff14, 0 0 25px 6px #39ff1488; }
            67% { box-shadow: 0 0 0 4px #6ec6ff, 0 0 25px 6px #6ec6ff88; }
            84% { box-shadow: 0 0 0 4px #9c27b0, 0 0 25px 6px #9c27b088; }
            100% { box-shadow: 0 0 0 4px #35516b, 0 0 25px 6px #35516b88; }
        }
        .frame-rainbow { animation: rainbowGlow 4s linear infinite; }
        @keyframes sirenGlow {
            0%, 49% { box-shadow: 0 0 0 4px #ff1744, 0 0 30px 8px #ff174499; }
            50%, 100% { box-shadow: 0 0 0 4px #2979ff, 0 0 30px 8px #2979ff99; }
        }
        .frame-siren { animation: sirenGlow 0.5s step-end infinite; }
        .cosmetic-card { background: rgba(255,255,255,0.05); border: 1px solid #1f2933; border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .cosmetic-card.equipped { border-color: var(--gold); }
        .cosmetic-card .cosmetic-label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .cosmetic-card .cosmetic-emoji { font-size: 22px; }
        .cosmetic-card .cosmetic-swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; }
        .cosmetic-card button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; white-space: nowrap; }
        .slot-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 12px 0 6px; }

        .quest-row { background: rgba(255,255,255,0.05); border: 1px solid #1f2933; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
        .quest-row.done { border-color: var(--gold); }
        .quest-name { font-weight: bold; font-size: 13px; }
        .quest-desc { font-size: 11px; color: #9db0c2; margin: 4px 0 8px; }
        .quest-progress-bar { height: 8px; background: #1f2933; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
        .quest-progress-fill { height: 100%; background: linear-gradient(90deg, #4caf50, #8bc34a); }
        .quest-row button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; }

        .action-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
        .action-tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; width: auto; margin: 0; padding: 14px 4px; font-size: 11px; font-weight: 600; background: rgba(255,255,255,0.04); border: 1px solid rgba(110,198,255,0.2); border-radius: 12px; }
        .action-tile-icon { font-size: 24px; }

        /* iOS Safari (напр. iPhone 11 Pro Max): flex + align-items:center + overflow-y:auto
           на fixed-оверлеї з контентом ВИЩИМ за екран клеїть верх контенту й не дає
           доскролити до кнопок знизу — гравець не міг закрити довідку. Центрування
           через margin:auto на картці замість flex-центрування батька — той самий
           візуальний результат, але скролиться коректно на всіх версіях WebKit. */
        #help-overlay { position: fixed; inset: 0; z-index: 1900; background: rgba(10,8,5,0.92); padding: 16px; box-sizing: border-box; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        #help-card { background: var(--panel-bg); border: 1px solid rgba(110,198,255,0.35); border-radius: 14px; padding: 18px; max-width: 460px; width: 100%; box-shadow: 0 0 30px rgba(110,198,255,0.2); margin: 30px auto; box-sizing: border-box; }
        .help-step { font-size: 13px; line-height: 1.55; color: #dbe6ee; background: rgba(255,255,255,0.04); border-left: 3px solid var(--accent2); border-radius: 6px; padding: 9px 11px; margin-bottom: 9px; }
        .help-step b { color: var(--text); }

        #room-screen { position: fixed; inset: 0; z-index: 1500; background: var(--bg); overflow-y: auto; padding: 15px; box-sizing: border-box; }

        /* Повноекранні оверлеї (fixed, inset:0) не успадковують safe-area відступ body —
           кнопка ✕, прибита до top:10px САМОГО оверлею, ховалась під вирізом/статус-баром
           телефону і оверлей ставав неможливо закрити. Піднімаємо top-padding для ВСІХ. */
        #heat-case-overlay, #notices-screen, #profile-overlay, #investigation-screen,
        #medcom-screen, #inspector-screen, #deferment-screen, #checkpoint-screen, #map-screen,
        #skills-screen, #offline-report, #reputation-screen, #season-screen, #war-screen,
        #season-result, #district-screen, #codex-screen, #crate-overlay, #help-overlay,
        #room-screen, #disclaimer-overlay, #sprint-tier-screen, #sprint-result-overlay {
            padding-top: max(16px, env(safe-area-inset-top), var(--tg-safe-area-inset-top, 0px));
        }
        #disclaimer-overlay { position: fixed; inset: 0; z-index: 1950; background: rgba(10,8,5,0.95); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
        #disclaimer-overlay.hidden { display: none; }
        #disclaimer-card { background: var(--panel-bg); border: 1px solid rgba(110,198,255,0.35); border-radius: 14px; padding: 18px; max-width: 460px; width: 100%; box-shadow: 0 0 30px rgba(110,198,255,0.2); box-sizing: border-box; }
        .room-close { position: absolute; top: max(10px, env(safe-area-inset-top), var(--tg-safe-area-inset-top, 0px)); right: 15px; width: auto; padding: 6px 14px; margin: 0; z-index: 10; }
        /* Нова картинка кімнати (roomImg) — широка, персонаж стоїть у правій третині кадру
           анфас, зростом на всю висоту. Поки для локації немає roomImg, підставляється стара
           квадратна img (тоді композиція буде не ідеальною, це очікувано до заміни картинки). */
        .room-scene { position: relative; width: 100%; aspect-ratio: 16 / 9; background: rgba(255,255,255,0.04); border: 1px solid rgba(110,198,255,0.2); border-radius: 12px; margin-bottom: 15px; overflow: hidden; container-type: inline-size; }
        .room-scene img#room-bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 0; filter: none; }
        .room-scene .emoji-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 110px; }
        /* Окремий прозорий персонаж (room-character.webp, спільний для всіх 6 локацій)
           замість персонажа, вбудованого в кожен фон — так гардероб позиціонується
           ОДИН раз відносно самого персонажа (у % від його власного блоку), а не
           вгадується окремо під кожен фон. .room-character-wrap тримає точну пропорцію
           обрізаної картинки персонажа (414×1058), тому % координати нижче стабільні
           незалежно від розміру екрана. */
        .room-character-wrap { position: absolute; top: 4%; right: 3%; height: 92%; aspect-ratio: 414 / 1058; container-type: inline-size; }
        .room-character-wrap img#room-character-img { width: 100%; height: 100%; object-fit: contain; display: block; }
        #room-cosmetic-hat, #room-cosmetic-face, #room-cosmetic-neck { line-height: 1; }
        #room-cosmetic-hat { top: -2%; left: 48%; width: 38%; height: 15%; font-size: 22cqw; }
        #room-cosmetic-face { top: 11%; left: 48%; width: 26%; height: 11%; font-size: 16cqw; }
        #room-cosmetic-neck { top: 24%; left: 48%; width: 28%; height: 10%; font-size: 16cqw; }
        .room-item { position: absolute; font-size: 34px; z-index: 6; pointer-events: none; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.7)); }
        .room-item img { width: 44px; height: 44px; object-fit: contain; }
        /* Сітка 3×3 в лівих ~60% кадру (кімната) — права зона зайнята персонажем,
           туди декор не кладемо. Назви позицій лишились старі (top-right тощо),
           але це "правий стовпчик кімнатної зони", а не правий край всього кадру. */
        .pos-top-left { top: 6%; left: 4%; }
        .pos-top-center { top: 6%; left: 26%; }
        .pos-top-right { top: 6%; left: 48%; }
        .pos-mid-left { top: 42%; left: 4%; }
        .pos-mid-right { top: 42%; left: 48%; }
        .pos-bottom-left { bottom: 6%; left: 4%; }
        .pos-bottom-center { bottom: 6%; left: 26%; }
        .pos-bottom-right { bottom: 6%; left: 48%; }
        /* Другий ряд декору — між сіткою 3x3 і зоною персонажа (права третина кадру
           лишається вільною, там стоїть персонаж і лежить його гардероб). */
        .pos-top-far-left { top: 24%; left: 15%; }
        .pos-mid-far-left { top: 60%; left: 15%; }
        .pos-bottom-far-left { bottom: 24%; left: 4%; }
        .pos-mid-center { top: 24%; left: 37%; }
        .pos-top-far-right { top: 60%; left: 37%; }
        .pos-mid-far-right { bottom: 24%; left: 48%; }
    </style>
</head>
<body>
    <div id="app-bg"></div>
    <div id="splash-screen">
        <video id="intro-video" autoplay playsinline preload="auto" poster="/images/splash-banner.webp">
            <source src="/video/intro.mp4" type="video/mp4">
        </video>
        <span>Завантаження...</span>
    </div>
    <script>
        // Звук у вступному відео: пробуємо зі звуком одразу (відкриття міні-аппи з
        // кнопки бота вже є "user gesture" на більшості платформ). Якщо конкретний
        // WebView все одно блокує unmuted autoplay — тихо падаємо назад на без звуку,
        // аби відео хоча б програлось, а не зависло на постері.
        (function () {
            var v = document.getElementById('intro-video');
            if (!v) return;
            function tryPlay(muted) {
                v.muted = muted;
                var p = v.play();
                if (p && p.catch) p.catch(function () { if (!muted) tryPlay(true); });
            }
            tryPlay(false);
        })();
        // Аварійний запобіжник (2026-08-16): init() прибирає сплеш лише ПІСЛЯ
        // успішного завантаження стану гравця — якщо мережа зависла й жоден
        // try/catch це не спіймав (неочікувана помилка десь ще в init()), гравець
        // лишався б на заставці назавжди. Це незалежний від init() таймер: що б
        // не сталось у мережі, за 15с сплеш зникає в будь-якому разі.
        setTimeout(function () {
            var s = document.getElementById('splash-screen');
            if (s) { s.style.opacity = '0'; setTimeout(function () { s.remove(); }, 400); }
        }, 15000);
    </script>
    <header>
        <button class="daily-btn" onclick="claimDaily()"><img src="/images/daily-ration.webp" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:3px;border-radius:2px;">Пайок</button>
        <div class="streak-note" id="streak-note"></div>
        <div class="header-line" onclick="openNicknameEditor()" style="cursor:pointer;">
            <span id="username">Ухилянт</span> ✏️<span id="vip-badge" class="vip-badge hidden">VIP</span> | Схрон: <span id="level-display">1</span>
        </div>
        <div class="header-line" style="font-size:11px; opacity:0.8;" title="Рівень ухилянта — росте від будь-якої активності, відкриває нові вкладки">
            🎖️ Рівень <span id="player-level-display">1</span> <span id="player-xp-display" style="opacity:0.7;"></span>
        </div>
        <h2><span id="balance">0</span> 🪙 ТК</h2>
        <div id="next-step" class="next-step hidden" onclick="goNextStep()"></div>
        <div class="stats">
            <span>Пасив: <span id="passive">0</span>/с</span>
            <span>⭐ <span id="stars-count">0</span></span>
        </div>
        <div class="energy-lock hidden" id="energy-lock"></div>
        <div id="defer-chip" onclick="openDeferments()"></div>
        <div class="clan-line hidden" id="clan-line"></div>
    </header>

    <div class="tabs-container">
        <div class="tab active" onclick="switchTab(event, 'clicker-tab')">👆 Клікер</div>
        <div class="tab" onclick="switchTab(event, 'shop')">🛒 Магазин</div>
        <div class="tab" onclick="switchTab(event, 'quests')">📋 Квести</div>
        <div class="tab" onclick="switchTab(event, 'market')">📈 Біржа</div>
        <div class="tab" onclick="switchTab(event, 'clan')">🏘 Клани</div>
        <div class="tab" onclick="switchTab(event, 'gacha')">📦 Ящики</div>
        <div class="tab" onclick="switchTab(event, 'storage')">🗄 Кладовка</div>
        <div class="tab" onclick="switchTab(event, 'storage-exp')">🌙 Вилазки</div>
        <div class="tab" onclick="openSkills()">🌳 Навички</div>
        <div class="tab" onclick="switchTab(event, 'friends')">🤝 Друзі</div>
        <div class="tab" onclick="switchTab(event, 'revenge')">😈 Помста</div>
        <div class="tab" onclick="switchTab(event, 'minigames')">🎲 Міні-ігри</div>
        <div class="tab" onclick="switchTab(event, 'stars')">💎 Донат</div>
        <div class="tab" onclick="switchTab(event, 'top')">🏆 ТОП</div>
    </div>

    <div id="clicker-tab" class="panel active" style="text-align:center;">
        <div class="location-name" id="location-name">Бабусин Диван</div>
        <!-- Спринти (робочі контракти, ECONOMY.SPRINTS_V2): плашка над артворком, схрони 2-8.
             Прихована за замовчуванням — showSprintPlaque() керує видимістю за флагом і рівнем. -->
        <div id="sprint-plaque" class="hidden">
            <div id="sprint-idle">
                <button id="sprint-pick-btn" onclick="openSprintTierPicker()">+ Обрати контракт</button>
            </div>
            <div id="sprint-active" class="hidden">
                <div class="sprint-head">
                    <span id="sprint-emoji">🐣</span>
                    <span id="sprint-name" class="sprint-name">Junior</span>
                    <span id="sprint-timer" class="sprint-timer">20:00</span>
                </div>
                <div class="sprint-lines-bar"><div id="sprint-lines-fill" class="sprint-lines-fill"></div></div>
                <div class="sprint-lines-text" id="sprint-lines-text">0 / 40</div>
                <div class="sprint-burnout-wrap">
                    <div class="sprint-burnout-label">🔥 Вигорання <span id="sprint-burnout-text">0%</span></div>
                    <div class="sprint-burnout-bar"><div id="sprint-burnout-fill" class="sprint-burnout-fill"></div></div>
                </div>
                <div class="sprint-actions">
                    <button id="sprint-claim-btn" onclick="claimSprint()" disabled>✅ Здати</button>
                    <button class="secondary" onclick="abandonSprint()">🚫 Відмовитись</button>
                </div>
            </div>
        </div>
        <div id="clicker" class="clickable">
            <img id="clicker-img" src="/images/clicker-badge.webp" alt="Ухилянт">
            <div id="clicker-emoji" class="emoji-fallback hidden"></div>
            <div id="cosmetic-hat" class="cosmetic-hat hidden"></div>
            <div id="cosmetic-face" class="cosmetic-face hidden"></div>
            <div id="cosmetic-neck" class="cosmetic-neck hidden"></div>
            <!-- QTE "Баги в коді": іконка з'являється в межах цієї зони, не всього екрана. -->
            <div id="sprint-qte-icon" class="hidden" onclick="hitSprintQte(event)">
                <div id="sprint-qte-ring"></div>
                <span>🐛</span>
            </div>
        </div>
        <div class="energy-wrap">
            <div class="energy-label">⚡ Енергія: <span id="energy-value">100</span>/<span id="energy-max">100</span></div>
            <div class="energy-bar"><div id="energy-fill" class="energy-fill"></div></div>
        </div>
        <div class="heat-wrap" id="heat-wrap" onclick="openHeatCase()">
            <div class="heat-label">
                <span id="heat-tier-label">😴 Ніхто тебе не знає</span>
                <span id="heat-value">Розшук: 0</span>
            </div>
            <div class="heat-bar"><div id="heat-fill" class="heat-fill"></div></div>
        </div>
        <div class="action-tiles">
            <button class="action-tile" onclick="openRoom()"><span class="action-tile-icon">🎨</span>Персонаж</button>
            <!-- Кастомізація кімнати (декор) — окрема кнопка, тимчасово заблокована
                 (не прибрана): клас locked дає той самий вигляд затемнення+замочок,
                 що й LEVEL_UNLOCKS для вкладок. -->
            <button class="action-tile locked" onclick="tg.showAlert('🔒 Кастомізація кімнати ще не готова')"><span class="action-tile-icon">🛋</span>Кімната</button>
            <button class="action-tile" onclick="openMap()"><span class="action-tile-icon">🗺️</span>Карта</button>
            <button class="action-tile" onclick="openCodex()"><span class="action-tile-icon">❓</span>Довідка</button>
            <button class="action-tile" onclick="openComplaint()"><span class="action-tile-icon">📝</span>Скарги</button>
            <button class="action-tile" onclick="openNotices()">
                <span class="action-tile-icon">📬</span>Повістки
                <div class="notices-badge hidden" id="notices-badge">0</div>
            </button>
        </div>
    </div>

    <div id="shop" class="panel">
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Апгрейди купуються нескінченно — кожен наступний рівень дорожчий.</p>
        <div id="upgrades-list"></div>
        <button onclick="buyEnergyDrink()"><img class="btn-icon" src="/images/shop-energy.webp" alt="">Енергетик (Відновити сили, макс ${ECONOMY.ENERGY_DRINK_MAX_PER_WINDOW}/5хв) | ${ECONOMY.ENERGY_DRINK_PRICE} 🪙</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #26313d;">Еволюція:</h3>
        <div id="location-shop-list"></div>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #26313d;">Компаньйони:</h3>
        <div id="pets-list"></div>
    </div>

    <div id="quests" class="panel">
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Щоденні квести. Прогрес і нагороди обнуляються опівночі.</p>
        <div id="quests-list"></div>
    </div>

    <div id="market" class="panel">
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Тут торгують ресурсами з твоєї кладовки. Курс гуляє кожні 3 хв: продавай на піку, а на дні — докуповуй під крафт замість фарму ящиків.</p>
        <button onclick="loadMarket()">🔄 Оновити курс</button>
        <div id="market-list"></div>
    </div>

    <div id="clan" class="panel">
        <img src="/images/clan-icon.webp" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
        <div id="clan-mine"></div>
        <div id="clan-war-buttons" class="hidden">
            <button class="secondary" onclick="openWar()">⚔️ Війна ОСББ</button>
            <button class="secondary" onclick="openDistrict()">🚌 Облава на район</button>
        </div>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #26313d;">Створити чат ОСББ</h3>
        <input type="text" id="clan-name-input" placeholder="Назва чату" style="width:100%; padding:10px; box-sizing:border-box; background:#131a21; border:1px solid #26313d; color:#fff; border-radius:5px; margin-bottom:10px;">
        <button onclick="createClan()">Створити (+${(ECONOMY.CLAN_PASSIVE_BONUS * 100).toFixed(0)}% пасиву всім)</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #26313d;">Приєднатися</h3>
        <button onclick="loadClanList()">🔄 Оновити список чатів</button>
        <div id="clan-list"></div>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #26313d;">Топ чатів ОСББ (за скарбницею)</h3>
        <button onclick="loadClanLeaderboard()">🔄 Оновити рейтинг кланів</button>
        <div id="clan-leaderboard"></div>
    </div>

    <div id="gacha" class="panel">
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Ящики — головне джерело ресурсів для кладовки й крафту. Шанси показані чесно, тицьни «шанси» під ящиком.</p>
        <div id="crates-list"></div>
        <h3 style="font-size:14px; margin: 20px 0 5px; border-bottom: 1px solid #26313d;">Колесо Зради та Перемоги (1 раз/день, безкоштовно):</h3>
        <div class="wheel-wrap">
            <div class="wheel-pointer"></div>
            <div id="wheel"></div>
        </div>
        <button id="wheel-btn" onclick="spinWheel()">🎡 Крутити колесо</button>
    </div>

    <div id="storage" class="panel">
        <div class="storage-header">
            <div class="storage-bar-wrap">
                <div class="storage-bar-label">
                    <span>🗄 Кладовка (рівень <b id="storage-level">0</b>)</span>
                    <span id="storage-count">0 / 60</span>
                </div>
                <div class="storage-bar"><div id="storage-fill" class="storage-fill"></div></div>
            </div>
            <button id="storage-upgrade-btn" onclick="upgradeStorage()">Розширити кладовку</button>
        </div>
        <div class="tabs-container">
            <div class="tab active" onclick="switchStorageTab(event, 'storage-res')">📦 Ресурси</div>
            <div class="tab" onclick="switchStorageTab(event, 'storage-craft')">🔨 Крафт</div>
        </div>
        <div id="storage-res" class="panel active">
            <p style="margin-top:0; color:#9db0c2; font-size:12px;">Ресурси падають із ящиків і вилазок. Здавати можна прямо тут — але за <b>поточним курсом біржі</b>, тож спершу глянь на 📈 Біржу.</p>
            <div id="resources-list"></div>
        </div>
        <div id="storage-craft" class="panel">
            <p style="margin-top:0; color:#9db0c2; font-size:12px;">Крафт дає те, що за валюту не купиш: щити від облав, розширення бака, постійні множники.</p>
            <div id="recipes-list"></div>
        </div>
    </div>

    <div id="storage-exp" class="panel">
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Відправ себе по ресурси й закрий гру — вилазка йде реальний час. Є ризик спалитись і втратити здобич; щит від облав цей ризик прибирає.</p>
        <div id="expeditions-list"></div>
    </div>

    <div id="friends" class="panel">
        <img src="/images/social-referral.webp" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
        <h3 style="margin-top:0;">Здай друга</h3>
        <p style="font-size:12px; color:#9db0c2;">Отримай ${ECONOMY.REFERRAL_REWARD} 🪙 за кожного друга, який перейде за твоїм посиланням і заляже на дно.</p>
        <p style="font-size:12px;">Здано друзів: <b id="ref-count">0</b></p>
        <input type="text" id="ref-link" readonly style="width: 100%; padding: 10px; background: #131a21; color: #fff; border: 1px solid #26313d; border-radius: 5px; margin-bottom: 10px; box-sizing: border-box;">
        <button onclick="copyRef()">📋 Скопіювати посилання</button>
    </div>

    <div id="revenge" class="panel">
        <h3 class="stars-section-title">📜 Легалізація (престиж)</h3>
        <div id="prestige-box"></div>
        <p style="font-size:11px; color:#9db0c2; margin-top:8px;">Дерево навичок — вкладка «🌳 Навички» вгорі.</p>
        <hr style="border:0; border-top:1px solid #26313d; margin: 18px 0;">
        <h3 class="stars-section-title">😈 Помста інспектору</h3>
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Дрібна ненасильницька помста за всі облави. Розблоковується після ${ECONOMY.REVENGE_UNLOCK_RAIDS} виживаних облав, 1 раз/день.</p>
        <div id="revenge-locked-note" class="hidden" style="font-size:12px; color:#9db0c2; text-align:center; padding:15px;"></div>
        <button id="revenge-btn" onclick="takeRevenge()">😈 Помститись</button>
        <div id="revenge-result" class="hidden" style="background:rgba(255,255,255,0.05); border:1px solid rgba(110,198,255,0.2); border-radius:8px; padding:12px; margin-top:10px; font-size:13px;"></div>
    </div>

    <div id="minigames" class="panel">
        <p style="margin-top:0; color:#9db0c2; font-size:12px;">Дрібні азартні розваги — не завʼязані на основну прокачку, суто заради адреналіну.</p>

        <h3 class="stars-section-title">🪙 Швидкісна монетка</h3>
        <p style="font-size:11px; color:#9db0c2; margin:0 0 8px;">Ставка × 2 при виграші, шанс ${Math.round(COINFLIP_WIN_CHANCE * 100)}%.</p>
        <input type="number" id="coinflip-stake" placeholder="Ставка (${ECONOMY.MINIGAME_STAKE_MIN}-${ECONOMY.MINIGAME_STAKE_MAX})" style="width:100%; padding:10px; box-sizing:border-box; background:#131a21; border:1px solid #26313d; color:#fff; border-radius:5px; margin-bottom:8px;">
        <button onclick="playCoinflip()">🎲 Кинути монетку</button>
        <div id="coinflip-result" class="hidden" style="text-align:center; font-size:14px; margin-top:8px;"></div>

        <h3 class="stars-section-title" style="margin-top:20px;">🎯 Колесо ризику 2.0</h3>
        <p style="font-size:11px; color:#9db0c2; margin:0 0 8px;">Обери рівень азарту — вищий множник, менший шанс.</p>
        <div id="risk-tiers"></div>
        <input type="number" id="risk-stake" placeholder="Ставка (${ECONOMY.MINIGAME_STAKE_MIN}-${ECONOMY.MINIGAME_STAKE_MAX})" style="width:100%; padding:10px; box-sizing:border-box; background:#131a21; border:1px solid #26313d; color:#fff; border-radius:5px; margin:8px 0;">
        <button onclick="playRisk()">🎯 Ризикнути</button>
        <div id="risk-result" class="hidden" style="text-align:center; font-size:14px; margin-top:8px;"></div>

        <h3 class="stars-section-title" style="margin-top:20px;">🃏 Знайди пару</h3>
        <p style="font-size:11px; color:#9db0c2; margin:0 0 8px;">Вхід ${MEMORY_ENTRY_COST} ТК, нагорода тим більша, чим менше спроб — до 3000 ТК за ідеальну пам'ять.</p>
        <div id="memory-start-wrap"><button onclick="startMemoryGame()">🃏 Почати гру (${MEMORY_ENTRY_COST} ТК)</button></div>
        <div id="memory-board" class="hidden" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-top:10px;"></div>
        <div id="memory-status" style="text-align:center; font-size:12px; color:#9db0c2; margin-top:6px;"></div>
    </div>

    <div id="stars" class="panel">
        <div class="dev-notice">
            ⚠️ Проєкт ще в розробці й поки не переїхав на постійні сервери — прогрес
            зберігається на тестовому хостингу і теоретично може губитись при оновленнях
            гри. Вибачте за незручності!
        </div>

        <h3 class="stars-section-title">👑 VIP-Схрон</h3>
        <button class="premium-btn" onclick="buyRealVip()"><img class="btn-icon" src="/images/vip-badge.webp" alt="">VIP-Схрон (${ECONOMY.VIP_PRICE_STARS} ⭐)</button>
        <p style="font-size:12px; color:#9db0c2; text-align:center; margin-top:6px;">VIP: Х3 дохід, нескінченна енергія, повний імунітет до ОБЛАВ.</p>

        <hr style="border:0; border-top:1px solid #26313d; margin: 18px 0;">

        <h3 class="stars-section-title">🔑 Промокод</h3>
        <input type="text" id="promo" placeholder="Введи промокод" style="width:100%; padding:10px; box-sizing:border-box; background:#131a21; border:1px solid #26313d; color:#fff; border-radius:5px; margin-bottom:10px;">
        <button onclick="usePromo()">Активувати код</button>

        <hr style="border:0; border-top:1px solid #26313d; margin: 18px 0;">

        <h3 class="stars-section-title">❤️ Підтримати розробника</h3>
        <p style="font-size:12px; color:#9db0c2; text-align:center; margin-top:0;">Жодних ігрових бонусів — просто щоб сказати "дякую" за гру.</p>
        <div class="donate-grid">
            ${ECONOMY.DONATE_AMOUNTS.map(a => `<button class="donate-btn" onclick="buyDonate(${a})">${a} ⭐</button>`).join('')}
        </div>
    </div>

    <div id="top" class="panel">
        <h3 style="font-size:14px; margin: 0 0 8px; border-bottom: 1px solid #26313d;">📊 Твоя статистика</h3>
        <div id="stats-box"></div>
        <h3 style="font-size:14px; margin: 18px 0 8px; border-bottom: 1px solid #26313d;">🎯 Колекція</h3>
        <div id="collection-box"></div>
        <h3 style="font-size:14px; margin: 18px 0 8px; border-bottom: 1px solid #26313d;">🏅 Сезон</h3>
        <p style="font-size:12px; color:#8fa3b8; margin:0 0 8px; line-height:1.5;">
            Рейтинг за балансом — це «хто довше грає». Ліга обнуляється щотижня,
            тому шанс має і новачок.
        </p>
        <button onclick="openSeason()">🏅 Моя ліга і сезонні очки</button>
        <h3 style="font-size:14px; margin: 18px 0 8px; border-bottom: 1px solid #26313d;">🏆 Рейтинг гравців</h3>
        <img src="/images/leaderboard-trophy.webp" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
        <button onclick="loadTop()">🔄 Оновити рейтинг</button>
        <ol id="leaderboard-list" style="padding-left: 20px; font-family: monospace; font-size: 14px; line-height: 1.8;"></ol>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #26313d;">Досягнення:</h3>
        <div id="achievements-list"></div>
    </div>

    <div id="gacha-result">
        <h2 id="gacha-title" style="margin-top:0; color:var(--gold);">🎉 Джекпот!</h2>
        <img id="gacha-icon" src="" alt="">
        <p id="gacha-desc">Ти отримав Білий Квиток!</p>
        <button onclick="document.getElementById('gacha-result').classList.add('hidden')">Забрати</button>
    </div>

    <!-- Дисклеймер: гра — сатира, не заклик. Показується один раз, до довідки. -->
    <div id="disclaimer-overlay" class="hidden">
        <div id="disclaimer-card" style="text-align:center;">
            <div style="font-size:40px; margin-bottom:8px;">🎭</div>
            <h2 style="margin-top:0; color:var(--gold); font-size:19px;">Це все вигадано</h2>
            <p style="font-size:13px; line-height:1.6; color:var(--text); margin:0 0 16px;">
                «Симулятор Ухилянта» — сатирична гра для друзів. Усі механіки, персонажі
                й ситуації вигадані й перебільшені заради жарту. Гра НЕ закликає до
                протиправних дій, ухилення від мобілізації чи будь-яких порушень
                закону — і засуджує їх. Насильство в грі відсутнє. Це розвага у
                комічному вигляді, не інструкція й не заклик до дії.
            </p>
            <button onclick="closeDisclaimer()">Зрозуміло</button>
        </div>
    </div>

    <!-- Коротка довідка. Показується один раз на першому запуску (прапорець у
         localStorage) і далі відкривається кнопкою "?" у шапці. -->
    <div id="help-overlay" class="hidden">
        <div id="help-card">
            <h2 style="margin-top:0; color:var(--gold); font-size:20px;">Як грати</h2>
            <div class="help-step"><b>1. Клікай по персонажу</b><br>Кожен клік — ТК, але витрачає енергію. Енергія відновлюється ~1 за секунду, тож безкінечно клікати не вийде.</div>
            <div class="help-step"><b>2. 🎖️ Рівень ухилянта (шапка) відкриває нове поступово</b><br>Це не рівень схрону — окрема цифра, росте від будь-якої активності. Ящики, вилазки, біржу, навички, карту й клан не шукай одразу — вони самі з'являться вкладками, коли підвищиш цей рівень. Нічого платного за раннє відкриття не втрачаєш.</div>
            <div class="help-step"><b>3. Ресурси йдуть у крафт</b><br>У <b>Кладовці</b> можна здати ресурси за ТК або скрафтити те, що за гроші не купиш: щити від облав, +клік і +пасив назавжди.</div>
            <div class="help-step"><b>4. Прокачуйся в Магазині</b><br>Апгрейди купуються нескінченно, кожен рівень дорожчий. Далі — переїзд у кращий схрон.</div>
            <div class="help-step"><b>5. Стеж за розшуком</b><br>Смуга під енергією — <b>розшук</b>. Що активніший ти — то більше тобою цікавляться: разом росте і дохід (до ×2), і шанс облави (до ×4.5). Сам вирішуй, на якому рівні жити. Тап по смузі — вся твоя справа.</div>
            <div class="help-step"><b>6. Повістки (📬 у шапці)</b><br>Приходять із таймером, навіть коли гра закрита. Можна відкупитись, показати липову довідку, зіграти в медкомісію, сховатись — або проігнорувати й отримати штраф.</div>
            <div class="help-step"><b>7. Друзі — теж механіка</b><br>Тап по гравцю в 🏆 ТОП відкриває порівняння профілів і кнопку <b>«здати»</b>. Здав — йому прилетить повістка. Здали тебе — маєш одне розслідування з трьох підозрюваних. Вгадаєш — забереш частину його балансу, помилишся — невинний образиться і отримає безкоштовний дзвінок на тебе.</div>
            <div class="help-step"><b>8. Ціль гри</b><br>Дійти до маєтку й <b>легалізуватись</b> (вкладка 😈): нічого не скидається, лишень отримуєш довідки — назавжди +10% доходу за кожну.</div>
            <button onclick="closeHelp()">Зрозуміло</button>
            <button class="secondary" onclick="closeHelp(); openCodex();">📖 Повна довідка механік</button>
        </div>
    </div>

    <!-- Анімація відкривання ящика: коробка трясеться, потім "вибухає" променями
         і зʼявляється приз. Кроки керуються класами .stage-* із JS (openCrate). -->
    <div id="crate-overlay" class="hidden">
        <div id="crate-stage">
            <div id="crate-rays"></div>
            <div id="crate-box">
                <img id="crate-box-img" src="" alt="">
                <div id="crate-lid"></div>
            </div>
            <div id="crate-sparks"></div>
            <div id="crate-prize">
                <div id="crate-prize-icon"></div>
                <div id="crate-prize-title"></div>
                <div id="crate-prize-desc"></div>
            </div>
        </div>
        <button id="crate-close" class="hidden" onclick="closeCrateOverlay()">Забрати</button>
        <div id="crate-again-wrap" class="hidden">
            <button id="crate-again" onclick="repeatCrate()">Відкрити ще раз</button>
        </div>
    </div>

    <!-- "Твоя справа": звідки взявся поточний розшук і що він тобі дає. -->
    <div id="heat-case-overlay" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeHeatCase()">✕</button>
            <h2 style="margin: 0 0 10px; font-size: 19px; color: var(--gold); text-align: center;">📁 Твоя справа</h2>
            <div class="case-tier" id="case-tier">😴 Ніхто тебе не знає</div>
            <div class="case-flavor" id="case-flavor"></div>
            <div class="case-mults">
                <div class="case-mult"><b id="case-heat">0</b><span>розшук зі 100</span></div>
                <div class="case-mult"><b id="case-income">×1.00</b><span>до всього доходу</span></div>
                <div class="case-mult"><b id="case-raid">×1.0</b><span>шанс облави</span></div>
            </div>
            <p style="font-size:12px; color:#8fa3b8; line-height:1.5; margin: 0 0 10px;">
                Що ти активніший і багатший — то більше тобою цікавляться. Розшук піднімає дохід,
                але разом із ним і шанс облави. Сам вирішуй, на якому рівні жити.
                Про тебе поступово забувають: −1 за кожні 12 хвилин, навіть коли гра закрита.
            </p>
            <div class="case-log" id="case-log"></div>
            <h3 style="font-size:14px; color:var(--gold); margin: 16px 0 4px;">🎖️ Ким ти вже цікавий</h3>
            <p style="font-size:11px; color:#8fa3b8; margin: 0 0 10px; line-height:1.45;">
                Інспектори приходять самі, коли розшук достатньо високий. Приходить завжди
                найсерйозніший із доступних.
            </p>
            <div id="inspector-roster"></div>
            <button onclick="closeHeatCase()" style="margin-top:12px;">Закрити</button>
        </div>
    </div>

    <!-- Довідка механік: повний опис систем, зібраний із реальних даних гри. -->
    <div id="codex-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeCodex()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">📖 Довідка механік</h2>
            <p style="font-size:11px; color:#8fa3b8; text-align:center; margin: 0 0 12px;">
                Усі цифри тут — справжні, вони читаються прямо з гри.
            </p>
            <div class="codex-nav" id="codex-nav"></div>
            <div id="codex-body"></div>
            <button onclick="closeCodex()" style="margin-top:10px;">Закрити</button>
        </div>
    </div>

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

    <!-- Сезон і ліга: щотижневий ладдер, який обнуляється. -->
    <div id="season-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeSeason()">✕</button>
            <div class="league-badge" id="league-badge"></div>
            <div class="league-sub" id="league-sub"></div>
            <div id="season-standings"></div>
            <p style="font-size:11px; color:#8fa3b8; line-height:1.5; margin-top:12px;">
                Топ-<span id="promote-n"></span> піднімаються лігою вище, останні
                <span id="relegate-n"></span> — нижче. Очки обнуляються щопонеділка,
                тому новачок має реальний шанс. Сезонну косметику й титул не купиш
                за ⭐ ніколи — тільки виграти.
            </p>
            <button onclick="closeSeason()" style="margin-top:10px;">Закрити</button>
        </div>
    </div>

    <!-- Підсумки минулого сезону — показуємо один раз при вході. -->
    <div id="season-result" class="hidden">
        <div class="case-card">
            <h2 style="margin: 0 0 10px; font-size: 20px; color: var(--gold); text-align: center;">🏆 Підсумки сезону</h2>
            <div id="season-result-body"></div>
            <button onclick="closeSeasonResult()" style="margin-top:12px;">Забрати</button>
        </div>
    </div>

    <!-- Війна ОСББ: дві шкали і склад ворожого чату з кнопкою "здати". -->
    <div id="war-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeWar()">✕</button>
            <h2 style="margin: 0 0 12px; font-size: 19px; color: var(--gold); text-align: center;">⚔️ Війна ОСББ</h2>
            <div id="war-body"></div>
            <button onclick="closeWar()" style="margin-top:10px;">Закрити</button>
        </div>
    </div>

    <!-- Облава на район: кооп-бос зі спільною шкалою. -->
    <div id="district-screen" class="hidden">
        <div id="district-bus">🚌</div>
        <div style="font-size:19px; font-weight:800; color:var(--gold); margin-top:4px;">Автобус ТЦК</div>
        <div style="font-size:12px; color:#dbe6ee; font-style:italic; margin:6px 0 12px; max-width:320px;">
            Заїхав у район на весь чат. Бʼємо разом — інакше не встигнемо.
        </div>
        <div class="insp-hptext" id="district-hptext"></div>
        <div class="insp-hpbar"><div class="insp-hpfill" id="district-hpfill" style="width:100%"></div></div>
        <div id="inspector-timer" style="display:none"></div>
        <div id="district-timer" style="font-size:24px; font-weight:800; margin:10px 0 4px;"></div>
        <div id="district-hitzone" style="width:180px;height:180px;border-radius:50%;border:3px solid var(--accent);background:radial-gradient(circle, rgba(255,170,0,0.3), rgba(255,170,0,0.06));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;cursor:pointer;user-select:none;-webkit-user-select:none;">ТИСНИ</div>
        <div id="district-contribs" style="margin-top:14px; width:100%; max-width:340px;"></div>
        <button onclick="closeDistrict()" style="max-width:340px; margin-top:12px;">Вийти (бос лишається)</button>
    </div>

    <!-- Репутація з районом: чотири NPC, щоденні квести, постійні перки на 100. -->
    <div id="reputation-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeReputation()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🤝 Район</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 14px; line-height:1.5;">
                Люди навколо теж чогось хочуть. Допомагаєш — вони памʼятають.
                На 100 репутації кожен дає щось назавжди.
            </p>
            <div id="npc-list"></div>
            <button onclick="closeReputation()" style="margin-top:6px;">Закрити</button>
        </div>
    </div>

    <!-- Офлайн-звіт: що сталось, поки гра була закрита. -->
    <div id="offline-report" class="hidden">
        <div class="case-card">
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🌙 Поки тебе не було</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 14px;" id="offline-away"></p>
            <div id="offline-lines"></div>
            <button onclick="closeOfflineReport()" style="margin-top:10px;">Зрозуміло</button>
        </div>
    </div>

    <!-- Дерево навичок: кожна довідка з легалізації = 1 очко. -->
    <div id="skills-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeSkills()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🌳 Навички ухилянта</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 12px; line-height:1.5;">
                Кожна довідка з легалізації дає 1 очко. Довідки при цьому продовжують давати
                свій +10% доходу — навички це бонус зверху. У гілці навички беруться послідовно.
            </p>
            <div class="skill-points" id="skill-points"></div>
            <div id="skills-tree"></div>
            <button class="secondary" id="skills-reset" onclick="resetSkills()"></button>
        </div>
    </div>

    <!-- Відстрочки: паралельна прогресія до Білого Квитка. Одна активна за раз. -->
    <div id="deferment-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeDeferments()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🎫 Відстрочки</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 14px; line-height:1.5;">
                Поки діє відстрочка — повістки не приходять, стуки не діють, блокпост проходиться
                автоматично. Але й розшук не росте: <b>поки ти невидимий, ти й заробляєш як невидимий</b>.
            </p>
            <div id="deferment-active" class="hidden"></div>
            <div id="deferment-list"></div>
            <button onclick="closeDeferments()" style="margin-top:8px;">Закрити</button>
        </div>
    </div>

    <!-- Нік: публічне ім'я замість справжнього з Telegram. -->
    <div id="nickname-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeNicknameEditor()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">✏️ Твій нік</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 12px; line-height:1.5;">
                У топі й профілях інші гравці бачать саме цей нік, не справжнє ім'я з Telegram.
                3-16 символів, має бути унікальним. <b>Перший раз — безкоштовно, зміна далі — 1000 ⭐.</b>
            </p>
            <input type="text" id="nickname-input" maxlength="16" placeholder="Наприклад: ТінявийКабанчик"
                style="width:100%; padding:10px; background:var(--btn); color:var(--text); border:1px solid rgba(110,198,255,0.3); border-radius:8px; margin-bottom:10px; box-sizing:border-box; font-family:inherit; font-size:14px;">
            <div id="nickname-error" style="font-size:12px; color:#ff8a8a; margin-bottom:10px; min-height:14px;"></div>
            <button onclick="saveNickname()">Зберегти</button>
        </div>
    </div>

    <!-- Карта території: захисні споруди за будматеріали + орієнтири-посилання на вилазки. -->
    <div id="map-screen" class="hidden">
        <div class="map-wrap">
            <button class="room-close" onclick="closeMap()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🗺️ Карта території</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 12px; line-height:1.5;">
                Орієнтири на карті ведуть до вилазок. Будуй споруди за деревину/металобрухт/цеглу —
                вони реально знижують ризики.
            </p>
            <div id="map-place-hint" class="hidden" style="text-align:center; font-size:12px; color:var(--gold); margin-bottom:8px;">📍 Тапни по карті, щоб поставити споруду</div>
            <div class="map-img-wrap" id="map-img-wrap" onclick="onMapImgClick(event)">
                <img src="/images/map-city-bg.webp" alt="">
                <button class="map-hotspot" style="top:28%; left:60%;" onclick="jumpToExpedition('market')">🏪 Ринок</button>
                <button class="map-hotspot" style="top:45%; left:20%;" onclick="jumpToExpedition('warehouse')">🏭 Склад</button>
                <button class="map-hotspot" style="top:72%; left:30%;" onclick="jumpToExpedition('ruins')">🪚 Руїни</button>
                <button class="map-hotspot" style="top:55%; left:85%;" onclick="jumpToExpedition('tcc_office')">🏢 ТЦК</button>
                <button class="map-hotspot" style="top:92%; left:45%;" onclick="jumpToExpedition('border')">🌲 Кордон</button>
                <div id="map-markers"></div>
            </div>
            <div id="map-buildings-list"></div>
        </div>
    </div>

    <!-- Блокпост: переїзд у новий схрон. Шанси показані відкрито. -->
    <div id="checkpoint-screen" class="hidden">
        <div class="case-card">
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🚧 Блокпост</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 14px; line-height:1.5;">
                Переїзд помітили. Треба якось пояснити, куди це ти зібрався.
            </p>
            <div id="checkpoint-body"></div>
        </div>
    </div>

    <!-- Медкомісія: збери діагноз із трьох карток, перебий скептицизм комісії. -->
    <div id="medcom-screen" class="hidden">
        <div class="case-card">
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🏥 Медкомісія</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 12px;">
                Обери <b>3 скарги</b> з п'яти. Сума переконливості має перебити скептицизм комісії.
                Чим вищий твій розшук — тим менше тобі вірять.
            </p>
            <div id="medcom-cards"></div>
            <div id="medcom-bonuses"></div>
            <div class="medcom-scale">
                <span>Переконливість <span class="val" id="medcom-power">0</span></span>
                <span style="color:#8fa3b8;">Скептицизм <span class="val" id="medcom-skept">100</span></span>
            </div>
            <button id="medcom-submit" onclick="submitMedcom()">Подати діагноз</button>
            <button class="secondary" id="medcom-reroll" onclick="rerollMedcom()">Перекинути картки</button>
        </div>
    </div>

    <!-- Інспектор ТЦК: таймований клік-енкаунтер зі шкалою терпіння. -->
    <div id="inspector-screen" class="hidden">
        <div id="inspector-face">🧔</div>
        <div id="inspector-name">Інспектор</div>
        <div id="inspector-taunt"></div>
        <div class="insp-hptext" id="inspector-hptext"></div>
        <div class="insp-hpbar"><div class="insp-hpfill" id="inspector-hpfill" style="width:100%"></div></div>
        <div id="inspector-timer">0.0</div>
        <div id="inspector-weak"></div>
        <div id="inspector-hitzone">ТИСНИ</div>
        <div style="font-size:11px; color:#8fa3b8; margin-top:12px;">Кожен клік коштує 3 енергії</div>
    </div>

    <!-- Порівняння профілів: твоя статистика проти його + кнопка "здати". -->
    <div id="profile-overlay" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeProfile()">✕</button>
            <h2 style="margin: 0 0 12px; font-size: 19px; color: var(--gold); text-align: center;">Хто кого</h2>
            <div class="vs-grid" id="profile-grid"></div>
            <div class="snitch-line" id="profile-snitch-stats"></div>
            <button class="snitch-btn" id="profile-snitch-btn" onclick="confirmSnitch()">🐍 Здати</button>
            <div class="snitch-note" id="profile-snitch-note"></div>
            <button onclick="closeProfile()">Закрити</button>
        </div>
    </div>

    <!-- Розслідування: троє підозрюваних, один здогад. -->
    <div id="investigation-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeInvestigation()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">🕵️ Розслідування</h2>
            <div id="investigation-body"></div>
            <button onclick="closeInvestigation()">Закрити</button>
        </div>
    </div>

    <!-- Повістки: не штраф, а вибір із таймером. -->
    <div id="notices-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeNotices()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">📬 Повістки</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 14px;">
                Таймер тікає, навіть коли гра закрита. Протухла повістка = штраф і різкий стрибок розшуку.
            </p>
            <div class="invest-banner hidden" id="invest-banner" onclick="openInvestigation()">
                🐍 <b>Тебе хтось здав.</b> Ти маєш право на одне розслідування — тапни, щоб подивитись на підозрюваних.
            </div>
            <button class="secondary" onclick="closeNotices(); openDeferments();" style="margin-bottom:8px;">
                🎫 Відстрочки — щоб повістки не приходили взагалі
            </button>
            <button class="secondary" onclick="closeNotices(); openReputation();" style="margin-bottom:12px;">
                🤝 Район — люди, які можуть за тебе заступитись
            </button>
            <div id="notices-list"></div>
            <button onclick="closeNotices()" style="margin-top:6px;">Закрити</button>
        </div>
    </div>

    <!-- Спринти: вибір тіру контракту (Junior/Middle/Senior/Lead). -->
    <div id="sprint-tier-screen" class="hidden">
        <div class="case-card">
            <button class="room-close" onclick="closeSprintTierPicker()">✕</button>
            <h2 style="margin: 0 0 4px; font-size: 19px; color: var(--gold); text-align: center;">💻 Робочі контракти</h2>
            <p style="font-size:12px; color:#8fa3b8; text-align:center; margin: 0 0 14px;">
                Енергія платиться один раз на вході, далі темп ріже вигорання, не бак.
            </p>
            <div id="sprint-tiers-list"></div>
            <button onclick="closeSprintTierPicker()" style="margin-top:6px;">Закрити</button>
        </div>
    </div>

    <!-- Спринти: результат здачі контракту. -->
    <div id="sprint-result-overlay" class="hidden">
        <div class="case-card">
            <div id="sprint-result-body"></div>
            <button onclick="closeSprintResult()">Закрити</button>
        </div>
    </div>

    <div id="raid-screen" class="hidden">
        <h1>🚨 ОБЛАВА НА РИНКУ! 🚨</h1>
        <p style="color:#fff; font-size:18px;">Тікай! Клікай швидко, щоб перелізти паркан!</p>
        <div id="raid-timer">10.0</div>
        <div id="raid-progress"><div id="raid-fill"></div></div>
        <button class="run-btn" id="run-btn"><img src="/images/raid-run.webp" alt="">ВТЕКТИ</button>
    </div>

    <div id="knock-screen" class="hidden">
        <h1>🚪 СТУК У ДВЕРІ! 🚪</h1>
        <p style="color:#fff; font-size:16px;">Швидко прикинься килимом!</p>
        <div id="knock-timer">3.0</div>
        <button class="knock-btn" id="knock-btn">🧎</button>
    </div>

    <div id="room-screen" class="hidden">
        <button class="room-close" onclick="closeRoom()">✕ Закрити</button>
        <h2 style="text-align:center; margin: 5px 0 15px;">🏠 Моя кімната</h2>
        <div class="room-scene">
            <img id="room-bg-img" src="" alt="">
            <div id="room-emoji-fallback" class="emoji-fallback hidden"></div>
            <div class="room-character-wrap">
                <img id="room-character-img" src="/images/room-character.webp" alt="">
                <div id="room-cosmetic-hat" class="cosmetic-hat hidden"></div>
                <div id="room-cosmetic-face" class="cosmetic-face hidden"></div>
                <div id="room-cosmetic-neck" class="cosmetic-neck hidden"></div>
            </div>
            ${ROOM_ITEMS.map((it) => `<div id="room-item-${it.id}" class="room-item pos-${it.pos} hidden">${it.img ? `<img src="${it.img}" alt="">` : it.emoji}</div>`).join('')}
        </div>
        <div class="tabs-container">
            <div class="tab active" onclick="switchRoomTab(event, 'room-wardrobe')">🎨 Гардероб</div>
            <!-- Кастомізація кімнати (декор) тимчасово прихована — розділяємо з
                 кастомізацією персонажа, поки що лишаємо тільки гардероб. Нічого не
                 видалено, просто клас hidden, легко повернути одним рядком. -->
            <div class="tab hidden" onclick="switchRoomTab(event, 'room-shop')">🛋 Речі кімнати</div>
        </div>
        <div id="room-wardrobe" class="panel active">
            <p style="margin-top:0; color:#9db0c2; font-size:12px;">Суто косметика — не впливає на економіку, лише стиль.</p>
            <div class="slot-heading">Головні убори</div>
            <div id="wardrobe-hat"></div>
            <div class="slot-heading">Маскування обличчя</div>
            <div id="wardrobe-face"></div>
            <div class="slot-heading">Аксесуар на шию</div>
            <div id="wardrobe-neck"></div>
            <div class="slot-heading">Рамки клікера</div>
            <div id="wardrobe-frame"></div>
        </div>
        <div id="room-shop" class="panel">
            <p style="margin-top:0; color:#9db0c2; font-size:12px;">Прикрась кімнату — можна тримати декілька речей одночасно.</p>
            <div id="room-items-list"></div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        // ⚠️ НЕ додавати tg.requestFullscreen() — вмикає ВЛАСНУ шапку Telegram
        // (✕ Закрити/аватар/меню) як overlay поверх сторінки, яка перекривала
        // верхні кнопки гри й блокувала по них тапи. Уже раз ловились, лишити
        // тільки tg.expand().
        tg.disableVerticalSwipes();

        // Автоматично додає підписані дані Telegram (initData) до кожного захищеного запиту,
        // щоб сервер міг довіряти, що запит справді від цього користувача.
        // Таймаут на fetch (2026-08-16): без нього один завислий запит на старті
        // (mobile-мережа затупила) блокував init() назавжди — сплеш-екран висів
        // нескінченно, бо його прибирання чекає завершення ВСЬОГО init(), а жоден
        // await тут не мав межі часу. AbortController гарантує, що запит рано чи
        // пізно впаде в catch, а не зависне.
        function apiFetch(url, options = {}) {
            options.headers = Object.assign({}, options.headers, { 'X-Telegram-Init-Data': tg.initData || '' });
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            options.signal = controller.signal;
            // Кожна відповідь із balanceRev одразу оновлює локальну ревізію — так автозбереження
            // завжди шле актуальну, і сервер не відхиляє наш баланс без потреби.
            return fetch(url, options).then(res => {
                clearTimeout(timeoutId);
                const origJson = res.json.bind(res);
                res.json = async () => {
                    const data = await origJson();
                    if (data && typeof data.balanceRev === 'number') state.balanceRev = data.balanceRev;
                    return data;
                };
                return res;
            }).catch(err => { clearTimeout(timeoutId); throw err; });
        }

        const BOT_USERNAME = '${botUsername}';
        const ECONOMY = ${JSON.stringify(ECONOMY)};
        const LOCATIONS = ${JSON.stringify(LOCATIONS)};
        const LEGALIZATION_LORE = ${JSON.stringify(LEGALIZATION_LORE)};
        const PETS = ${JSON.stringify(PETS)};
        const MARKET_ASSETS = ${JSON.stringify(MARKET_ASSETS)};
        const WHEEL_SEGMENTS = ${JSON.stringify(WHEEL_SEGMENTS)};
        const ACHIEVEMENTS_META = ${JSON.stringify(ACHIEVEMENTS_META)};
        const TROPHIES = ${JSON.stringify(TROPHIES)};
        const COSMETICS = ${JSON.stringify(COSMETICS)};
        const QUESTS = ${JSON.stringify(QUESTS)};
        const ROOM_ITEMS = ${JSON.stringify(ROOM_ITEMS)};
        const RESOURCES = ${JSON.stringify(RESOURCES)};
        const RESOURCE_BY_ID = Object.fromEntries(RESOURCES.map(r => [r.id, r]));
        const CRATES = ${JSON.stringify(CRATES)};
        const RECIPES = ${JSON.stringify(RECIPES)};
        const EXPEDITIONS = ${JSON.stringify(EXPEDITIONS)};
        const MAP_BUILDINGS = ${JSON.stringify(MAP_BUILDINGS)};
        const UKHYR_RANKS = ${JSON.stringify(UKHYR_RANKS)};
        const RISK_TIERS = ${JSON.stringify(RISK_TIERS)};
        const COINFLIP_WIN_CHANCE = ${JSON.stringify(COINFLIP_WIN_CHANCE)};
        const MEMORY_ENTRY_COST = ${JSON.stringify(MEMORY_ENTRY_COST)};
        const MEMORY_REWARD_TABLE = ${JSON.stringify(MEMORY_REWARD_TABLE)};
        const HEAT_TIERS = ${JSON.stringify(HEAT_TIERS)};
        const NOTICE_TYPES = ${JSON.stringify(NOTICE_TYPES)};
        // Каталоги для довідки механік — щоб її цифри читались із реальних даних
        // гри, а не дублювались текстом і не розходились із балансом.
        const SYMPTOMS = ${JSON.stringify(SYMPTOMS)};
        const INSPECTORS = ${JSON.stringify(INSPECTORS.map(({ id, emoji, name, hp, unlockHeat, window: w, weaknessHint, taunt }) => ({ id, emoji, name, hp, unlockHeat, window: w, weaknessHint, taunt })))};
        const DEFERMENTS = ${JSON.stringify(DEFERMENTS)};
        const CHECKPOINT_CHOICES = ${JSON.stringify(CHECKPOINT_CHOICES)};
        const SKILL_BRANCHES = ${JSON.stringify(SKILL_BRANCHES)};
        const REPUTATION_NPCS = ${JSON.stringify(REPUTATION_NPCS.map(({ id, emoji, name, about, perk }) => ({ id, emoji, name, about, perk })))};
        const LEAGUES = ${JSON.stringify(LEAGUES)};
        const NOTICE_BY_ID = Object.fromEntries(NOTICE_TYPES.map(n => [n.id, n]));

        let user = tg.initDataUnsafe?.user || { id: 'guest_' + Math.floor(Math.random() * 100000), first_name: 'Гість' };

        let state = {
            balance: 0, clickVal: 1, passive: 0,
            energy: 100, maxEnergy: 100,
            level: 1, isVip: false, refCount: 0,
            totalClicks: 0, boxesOpened: 0, raidsSurvived: 0,
            achievements: [], ownedPets: [], petId: null,
            ownedCosmetics: [], equippedCosmetics: { hat: null, face: null, neck: null, frame: null },
            ownedRoomItems: [], equippedRoomItems: [],
            portfolio: {}, clanId: null, clanName: null, clanBonus: 1,
            dailyStreak: 0, wheelClaimedToday: false,
            dailyClicks: 0, dailyTrades: 0, dailyBoxes: 0, dailyRaids: 0,
            dailyCrafts: 0, dailyResources: 0, claimedQuests: [],
            revengeUnlocked: false, revengeClaimedToday: false,
            resources: {}, storageLevel: 0, storageCapacity: 0, storageUsed: 0, storageUpgradeCost: 0,
            upgrades: { hat: 0, jam: 0, thermos: 0, generator: 0 }, upgradeCosts: {},
            upgTiersUnlocked: { hat: 0, jam: 0, thermos: 0, generator: 0 }, upgradeGates: {},
            craftedCount: 0, shieldUntil: 0, permanentShield: false,
            balanceRev: 0,
            heat: 0, heatTier: HEAT_TIERS[0], heatLog: [],
            notices: [], noticeStats: null, energyLockUntil: 0, seasonPoints: 0,
            pid: null, snitchStats: null, snitchesLeft: ECONOMY.SNITCH_DAILY_LIMIT,
            investigationPending: false, trophies: [],
            medcomStats: null, inspectorStats: null, checkpointStats: null,
            deferUntil: 0, defermentId: null, deferments: [],
            expeditions: [], expeditionSlots: 1, skills: {}, skillPoints: 0,
            reputation: {}, mykolaCoverUsed: false, buyAmount: 1,
            mapBuildings: { tower: 0, hideout: 0, cache: 0 },
            mapPlacements: { tower: null, hideout: null, cache: null },
            league: null, seasonTitle: null, seasonEndsAt: 0, pendingWarCrate: 0,
            adAirdropMult: 1, adConsentCount: 0,
            xp: 0, playerLevel: 1, ukhyr: 0,
            memoryGame: null,
            // Спринти (робочі контракти, ECONOMY.SPRINTS_V2) — вимкнено за замовчуванням,
            // прапорець приходить із /api/user. sprint === null означає IDLE (нема контракту).
            sprintsEnabled: false, sprint: null, burnout: 0, burnoutMax: 100,
            burnoutThreshold: 80, focusStat: 1, sprintTiers: [],
        };

        const ui = {
            bal: document.getElementById('balance'), pas: document.getElementById('passive'),
            enr: document.getElementById('energy-fill'), lvl: document.getElementById('level-display'),
            plvl: document.getElementById('player-level-display'), pxp: document.getElementById('player-xp-display'),
            enrVal: document.getElementById('energy-value'), enrMax: document.getElementById('energy-max'),
            loc: document.getElementById('location-name'), clk: document.getElementById('clicker'),
            clkImg: document.getElementById('clicker-img'), clkEmoji: document.getElementById('clicker-emoji'),
            str: document.getElementById('stars-count'), vip: document.getElementById('vip-badge'),
            refCount: document.getElementById('ref-count'), clanLine: document.getElementById('clan-line'),
            streakNote: document.getElementById('streak-note'),
            heatWrap: document.getElementById('heat-wrap'), heatFill: document.getElementById('heat-fill'),
            heatTierLabel: document.getElementById('heat-tier-label'), heatValue: document.getElementById('heat-value'),
            noticesBadge: document.getElementById('notices-badge'), energyLock: document.getElementById('energy-lock'),
            appBg: document.getElementById('app-bg'),
        };

        // ===== Розшук (heat) =====
        // Множник доходу від розшуку діє на ВСІ джерела ТК. Єдиний порядок множників
        // у грі: base * heat * vip * prestige * clan.
        function heatIncomeMult() { return (state.heatTier && state.heatTier.incomeMult) || 1; }
        function heatRaidMult() { return (state.heatTier && state.heatTier.raidMult) || 1; }

        function energyLocked() { return (state.energyLockUntil || 0) > Date.now(); }

        // Кожна серверна відповідь може принести свіжий heat/повістки — підхоплюємо їх
        // в одному місці, щоб не дублювати присвоєння в кожному обробнику.
        function absorbHeat(data) {
            if (!data) return;
            if (typeof data.heat === 'number') state.heat = data.heat;
            if (data.heatTier) state.heatTier = data.heatTier;
            if (Array.isArray(data.heatLog)) state.heatLog = data.heatLog;
            if (Array.isArray(data.notices)) state.notices = data.notices;
            if (data.noticeStats) state.noticeStats = data.noticeStats;
            if (typeof data.energyLockUntil === 'number') state.energyLockUntil = data.energyLockUntil;
            if (typeof data.investigationPending === 'boolean') state.investigationPending = data.investigationPending;
        }

        function fmtCountdown(ms) {
            const total = Math.max(0, Math.floor(ms / 1000));
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (n) => String(n).padStart(2, '0');
            return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
        }

        // Щит від облав: тимчасовий (крафт "Липова довідка") або постійний (Білий Квиток).
        function hasShield() {
            return !!state.permanentShield || (state.shieldUntil || 0) > Date.now();
        }

        function petMult(kind) {
            if (kind === 'click') return state.petId === 'goose' ? ECONOMY.PET_GOOSE_CLICK_MULT : 1;
            if (kind === 'energy') return state.petId === 'cat' ? ECONOMY.PET_CAT_ENERGY_MULT : 1;
            if (kind === 'raid') return state.petId === 'neighbor' ? ECONOMY.PET_NEIGHBOR_RAID_MULT : 1;
            return 1;
        }

        // Вежа спостереження з карти території знижує шанс облави (той самий підхід, що petMult).
        function mapRaidMult() {
            const level = (state.mapBuildings && state.mapBuildings.tower) || 0;
            if (level <= 0) return 1;
            const raidCut = MAP_BUILDINGS.find(b => b.id === 'tower').levels[level - 1].raidCut;
            return 1 - raidCut;
        }

        // Кнопка-клікер — одна й та сама значка на всіх локаціях (не персонаж): вигляд
        // персонажа за локацією лишається приналежністю екрана "Кімната", коли до неї
        // дійде переробка кастомізації. Тут лише назва локації над кнопкою міняється.
        const CLICKER_BADGE_IMG = '/images/clicker-badge.webp';
        function applyLocation() {
            const loc = LOCATIONS.find(l => l.level === state.level) || LOCATIONS[0];
            ui.loc.innerText = loc.name;
            ui.clkImg.classList.remove('hidden');
            ui.clkEmoji.classList.add('hidden');
            if (ui.clkImg.getAttribute('src') !== CLICKER_BADGE_IMG) ui.clkImg.src = CLICKER_BADGE_IMG;
            // Фон усього застосунку — картинка поточного рівня схрону. Пишемо в DOM
            // лише при зміні (як і clkImg вище) — applyLocation() кличеться з updateUI(),
            // а той крутиться в гарячому 100мс-циклі.
            if (ui.appBg && loc.img && ui.appBg.dataset.loc !== loc.img) {
                ui.appBg.style.backgroundImage = "url('" + loc.img + "')";
                ui.appBg.dataset.loc = loc.img;
            }
        }

        function updateUI() {
            // Бос показує десяті долі секунди, тому таймер живе тут, а не в секундному
            // інтервалі. Це лише оновлення тексту — важких рендерів у циклі як не було,
            // так і немає.
            updateInspectorTimer();
            ui.bal.innerText = fmtNum(state.balance);
            ui.bal.title = fmtFull(state.balance);
            ui.pas.innerText = state.passive;
            ui.str.innerText = 0;
            ui.lvl.innerText = state.level;
            ui.plvl.innerText = state.playerLevel || 1;
            // xpForLevel(1) ніколи не використовується як поріг (рівень 1 — стартовий,
            // 0 XP), тому базу для прогрес-бару рахуємо як 0 саме на 1-му рівні.
            const lvl = state.playerLevel || 1;
            const curLevelXP = lvl <= 1 ? 0 : xpForLevel(lvl);
            const nextLevelXP = xpForLevel(lvl + 1);
            ui.pxp.innerText = '(' + fmtNum((state.xp || 0) - curLevelXP) + '/' + fmtNum(nextLevelXP - curLevelXP) + ' XP)';
            ui.refCount.innerText = state.refCount;
            ui.vip.classList.toggle('hidden', !state.isVip);
            let enPercent = (state.energy / state.maxEnergy) * 100;
            ui.enr.style.width = enPercent + '%';
            ui.enr.style.background = enPercent < 20 ? '#f44336' : (enPercent < 50 ? '#ff9800' : 'linear-gradient(90deg, #4caf50, #8bc34a)');
            ui.enrVal.innerText = Math.floor(state.energy);
            ui.enrMax.innerText = Math.floor(state.maxEnergy);
            applyLocation();
            // Плашка контракту залежить від рівня схрону (2-8) — рахуємо разом з
            // рештою гарячого циклу, а не шукаємо кожне місце, де level міняється.
            renderSprintPlaque();
            if (state.clanName) {
                ui.clanLine.classList.remove('hidden');
                ui.clanLine.innerText = '🏘 ' + state.clanName + ' (+' + Math.round((state.clanBonus - 1) * 100) + '% пасиву)';
            } else {
                ui.clanLine.classList.add('hidden');
            }
            ui.streakNote.innerText = state.dailyStreak > 0 ? ('Серія: День ' + state.dailyStreak + '/7') : '';

            // Смуга розшуку і бейдж повісток — навмисно лише зміна тексту/ширини й
            // перемикання класів. Жодних innerHTML: це гарячий цикл на 10 разів/сек.
            const tier = state.heatTier || HEAT_TIERS[0];
            ui.heatFill.style.width = Math.min(100, state.heat || 0) + '%';
            ui.heatTierLabel.innerText = tier.emoji + ' ' + tier.name;
            ui.heatValue.innerText = 'Розшук: ' + Math.round(state.heat || 0);
            ui.heatWrap.classList.toggle('hot', (state.heat || 0) >= 76);

            // Плашка активної відстрочки з живим таймером. Поки вона світиться —
            // повістки не приходять, але й розшук не росте.
            const deferLeft = (state.deferUntil || 0) - Date.now();
            const grannyLeft = (state.grannyUntil || 0) - Date.now();
            const chip = document.getElementById('defer-chip');
            chip.classList.toggle('on', deferLeft > 0 || grannyLeft > 0);
            if (grannyLeft > 0) {
                chip.innerText = '👵 Бабуся клікає: ' + fmtCountdown(grannyLeft);
                startGranny();
            } else if (deferLeft > 0) chip.innerText = '🎫 Відстрочка: ' + fmtCountdown(deferLeft);
            const deferCountdown = document.getElementById('defer-countdown');
            if (deferCountdown && deferLeft > 0) deferCountdown.innerText = fmtCountdown(deferLeft);

            // Непочате розслідування теж світиться в бейджі — інакше гравець просто
            // не дізнається, що має право вирахувати того, хто його здав.
            const noticeCount = (state.notices || []).length + (state.investigationPending ? 1 : 0);
            ui.noticesBadge.classList.toggle('hidden', noticeCount === 0);
            if (noticeCount > 0) {
                ui.noticesBadge.innerText = noticeCount;
                // Блимаємо, коли в котроїсь повістки лишилось менше 20% часу — щоб
                // гравець помітив її, навіть якщо сидить у зовсім іншій вкладці.
                const now = Date.now();
                const urgent = state.notices.some(n => {
                    const type = NOTICE_BY_ID[n.typeId];
                    if (!type) return false;
                    return (n.expiresAt - now) < type.ttlH * 3600 * 1000 * 0.2;
                });
                ui.noticesBadge.classList.toggle('urgent', urgent);
            }

            const locked = energyLocked();
            ui.energyLock.classList.toggle('hidden', !locked);
            if (locked) ui.energyLock.innerText = '🔒 Тебе тримають у ТЦК: ' + fmtCountdown(state.energyLockUntil - Date.now());
        }

        // Гардероб/компаньйони/декор рендеряться лише коли їх дані реально змінюються
        // (купівля/екіпірування/init), а не в кожному тіку updateUI() — інакше повний
        // перебудова ~60+ карток гардеробу 10 разів/сек садила продуктивність на телефонах.
        function renderOwnedStuff() {
            renderPets();
            renderCosmetics();
            applyCosmeticOverlay();
            renderRoomItemsOverlay();
            renderUpgrades();
            renderCrates();
            renderStorage();
            renderRecipes();
            renderExpeditions();
            renderPrestige();
        }

        // ===== Екран "Твоя справа" =====
        // Рендериться лише при відкритті — у гарячий цикл ці innerHTML не потрапляють.
        window.openHeatCase = async () => {
            let roster = null;
            try {
                const res = await apiFetch('/api/notices?id=' + user.id);
                absorbHeat(await res.json());
                const ins = await apiFetch('/api/inspector?id=' + user.id).then(r => r.json());
                roster = ins.roster;
                state.inspectorStats = ins.stats || state.inspectorStats;
                absorbInspector(ins);
            } catch (e) { /* покажемо те, що вже маємо в стані */ }
            renderHeatCase();
            renderInspectorRoster(roster);
            document.getElementById('heat-case-overlay').classList.remove('hidden');
        };

        function renderInspectorRoster(roster) {
            const box = document.getElementById('inspector-roster');
            if (!box || !roster) return;
            box.innerHTML = roster.map(i => {
                let status;
                if (i.locked) status = '🔒 ' + i.lockedHint;
                else if (i.cooldownLeft > 0) status = '⏳ Наступний візит через ' + fmtCountdown(i.cooldownLeft);
                else if (!i.heatReady) status = '🔥 Прийде на розшуку ' + i.unlockHeat + '+';
                else status = '👀 Може прийти будь-коли';
                return '<div class="insp-roster-card' + (i.locked || !i.heatReady ? ' locked' : '') + '">' +
                    '<span style="font-size:26px;">' + i.emoji + '</span><div>' +
                    '<div class="insp-roster-name">' + esc(i.name) +
                    (i.defeated ? ' <span style="color:var(--gold)">×' + i.defeated + '</span>' : '') + '</div>' +
                    '<div class="insp-roster-meta">' + esc(status) + '<br>' +
                    'Терпіння ' + fmtNum(i.hp) + ' · ' + i.window + 'с · нагорода ' + fmtNum(i.reward.tk) + ' ТК</div>' +
                    '</div></div>';
            }).join('');
        }
        window.closeHeatCase = () => document.getElementById('heat-case-overlay').classList.add('hidden');

        function renderHeatCase() {
            const tier = state.heatTier || HEAT_TIERS[0];
            document.getElementById('case-tier').innerText = tier.emoji + ' ' + tier.name;
            document.getElementById('case-flavor').innerText = '«' + (tier.flavor || '') + '»';
            document.getElementById('case-heat').innerText = Math.round(state.heat || 0);
            document.getElementById('case-income').innerText = '×' + tier.incomeMult.toFixed(2);
            document.getElementById('case-raid').innerText = '×' + tier.raidMult.toFixed(1);

            const log = state.heatLog || [];
            document.getElementById('case-log').innerHTML = log.length
                ? log.map(e => {
                    const cls = e.delta > 0 ? 'case-log-up' : 'case-log-down';
                    const sign = e.delta > 0 ? '+' : '';
                    return '<div class="case-log-row"><span>' + esc(e.reason) + '</span>' +
                        '<span class="' + cls + '">' + sign + e.delta + '</span></div>';
                }).join('')
                : '<div style="color:#8fa3b8; font-size:12px;">Поки що тиша. Ти нікого не цікавиш — і це добре.</div>';
        }

        // Тексти з сервера потрапляють в innerHTML — екрануємо, щоб чиясь назва
        // предмета чи ніка не могла зламати розмітку.
        function esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[c]);
        }

        // ===== Екран повісток =====
        window.openNotices = async () => {
            try {
                const res = await apiFetch('/api/notices?id=' + user.id);
                const data = await res.json();
                absorbHeat(data);
                if (typeof data.shieldUntil === 'number') state.shieldUntil = data.shieldUntil;
            } catch (e) { /* покажемо те, що вже маємо */ }
            renderNotices();
            document.getElementById('invest-banner').classList.toggle('hidden', !state.investigationPending);
            document.getElementById('notices-screen').classList.remove('hidden');
        };
        window.closeNotices = () => document.getElementById('notices-screen').classList.add('hidden');

        function noticeThreatText(type) {
            const parts = ['штраф ' + Math.round(type.balancePct * 100) + '% балансу'];
            if (type.energyLockMin) parts.push(type.energyLockMin + ' хв без кліків');
            if (type.resourceLoss) parts.push('мінус ' + type.resourceLoss + ' ресурси');
            return 'Якщо протухне: ' + parts.join(', ') + ' і +' + type.heatOnExpire + ' до розшуку.';
        }

        function renderNotices() {
            const list = document.getElementById('notices-list');
            if (!list) return;
            const notices = state.notices || [];
            if (!notices.length) {
                list.innerHTML = '<div style="color:#8fa3b8; font-size:13px; text-align:center; padding: 18px 0;">' +
                    'Поки що жодної повістки. Насолоджуйся.</div>';
                return;
            }
            const now = Date.now();
            const hasSpravka = (state.shieldUntil || 0) > now;
            const hasCover = ((state.reputation || {}).mykola || 0) >= ECONOMY.REP_MAX;
            list.innerHTML = notices.map(n => {
                const type = NOTICE_BY_ID[n.typeId];
                if (!type) return '';
                const left = n.expiresAt - now;
                const urgent = left < type.ttlH * 3600 * 1000 * 0.2;
                // Шанси й ціни показані відкрито — той самий принцип, що й у ящиках.
                const btn = (method, label, note, disabled) =>
                    '<button onclick="resolveNotice(\\'' + n.uid + '\\', \\'' + method + '\\')"' + (disabled ? ' disabled' : '') + '>' +
                    label + '<span class="notice-cost">' + note + '</span></button>';
                return '<div class="notice-card' + (urgent ? ' urgent' : '') + '" data-uid="' + n.uid + '">' +
                    '<div class="notice-head">' +
                        '<span class="notice-emoji">' + type.emoji + '</span>' +
                        '<div><div class="notice-name">' + esc(type.name) + '</div>' +
                        '<div class="notice-flavor">' + esc(type.flavor) + '</div></div>' +
                        '<span class="notice-timer" data-expires="' + n.expiresAt + '">' + fmtCountdown(left) + '</span>' +
                    '</div>' +
                    '<div class="notice-threat">' + noticeThreatText(type) + '</div>' +
                    btn('bribe', '💵 Вирішити питання', n.bribeCost.toLocaleString('uk-UA') + ' ТК · −' + ECONOMY.HEAT_BRIBE_DISCOUNT + ' розшуку') +
                    btn('spravka', '📄 Липова довідка', hasSpravka ? ('витратить щит · −' + ECONOMY.HEAT_SPRAVKA_DISCOUNT + ' розшуку') : 'немає активної', !hasSpravka) +
                    btn('medcom', '🏥 Медкомісія', 'міні-гра · безкоштовно') +
                    // Кнопку «Прикриття» показуємо лише тим, хто дійшов до 100 репутації
                    // з дільничним — решті вона нічого не пояснює.
                    (hasCover ? btn('cover', '👮 Прикриття від Миколи',
                        state.mykolaCoverUsed ? 'сьогодні вже прикривав' : 'безкоштовно, раз на добу',
                        state.mykolaCoverUsed) : '') +
                    btn('hide', '🏃 Сховатись', Math.round(ECONOMY.NOTICE_HIDE_SUCCESS * 100) + '% · вся енергія') +
                    btn('ignore', '😐 Ігнорувати', 'таймер тікає далі') +
                '</div>';
            }).join('');
        }

        window.resolveNotice = async (noticeId, method) => {
            const res = await apiFetch('/api/notice/resolve', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, noticeId, method }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Не вийшло');
            // Медкомісія не вирішується одним запитом — сервер роздав картки, далі міні-гра.
            if (data.medcom) {
                closeNotices();
                openMedcom(data.hand);
                return;
            }
            absorbHeat(data);
            if (typeof data.balance === 'number') state.balance = data.balance;
            if (typeof data.energy === 'number') state.energy = data.energy;
            if (typeof data.shieldUntil === 'number') state.shieldUntil = data.shieldUntil;
            if (data.resources) state.resources = data.resources;

            if (!data.ignored) {
                let text = (data.resolved ? '✅ ' : '❌ ') + data.message;
                if (data.penalty && data.penalty.coins > 0) text += '\\nМінус ' + data.penalty.coins.toLocaleString('uk-UA') + ' ТК';
                if (data.penalty && data.penalty.resources > 0) text += '\\nЗабрали ресурсів: ' + data.penalty.resources;
                if (data.penalty && data.penalty.energyLocked) text += '\\nПівгодини тобі не до кліків';
                tg.HapticFeedback.notificationOccurred(data.resolved ? 'success' : 'error');
                tg.showAlert(text);
            }
            renderNotices();
            renderStorage();
            updateUI();
        };

        // Той самий показ розблокованих досягнень, що й у решті місць, але одним
        // викликом — нові механіки (медкомісія, боси) теж їх видають.
        function showAchievements(list) {
            if (!list || !list.length) return;
            list.forEach(a => { if (!state.achievements.includes(a.id)) state.achievements.push(a.id); });
            tg.showAlert('🏅 Досягнення: ' + list.map(a => a.name + ' (+' + a.reward + ' ТК)').join(', '));
            renderAchievements();
        }

        // Українське відмінювання: 1 доба, 2-4 доби, 5+ діб.
        function plural(n, one, few, many) {
            const mod100 = n % 100, mod10 = n % 10;
            if (mod100 >= 11 && mod100 <= 14) return n + ' ' + many;
            if (mod10 === 1) return n + ' ' + one;
            if (mod10 >= 2 && mod10 <= 4) return n + ' ' + few;
            return n + ' ' + many;
        }

        // ===== Автоклікер «Бабуся клікає за тебе» =====
        // Дроп із ящиків. Бабуся клікає за тими самими правилами, що й ти:
        // витрачає твою енергію, тому це прискорення, а не безкоштовні гроші.
        let grannyTimer = null;
        function startGranny() {
            if (grannyTimer) return;
            grannyTimer = setInterval(() => {
                if ((state.grannyUntil || 0) <= Date.now()) {
                    clearInterval(grannyTimer);
                    grannyTimer = null;
                    return;
                }
                if (!state.isVip && state.energy < clickEnergyCost()) return;
                const earned = state.clickVal * heatIncomeMult() * petMult('click') * (state.isVip ? 3 : 1)
                    * (state.prestigeMultiplier || 1) * skillClickMult();
                state.balance += earned;
                state.totalClicks += 1;
                if (!state.isVip) state.energy = Math.max(0, state.energy - clickEnergyCost());
            }, Math.round(1000 / ECONOMY.GRANNY_CPS));
        }

        // ===== Довідка механік =====
        // Тексти пояснюють ЛОГІКУ, а числа підставляються з реальних констант і
        // масивів гри — тому довідка не може розійтись із балансом.
        const CODEX = [
            { id: 'basics', tab: '🎯 Основи', title: 'З чого все складається', build: () => {
                return '<p class="codex-lead">Ти клікаєш, заробляєш ТК і ховаєшся. Усе інше — надбудова над цим.</p>' +
                    block('Клік і енергія',
                        'Кожен клік коштує ' + ECONOMY.ENERGY_PER_CLICK + ' енергії, яка відновлюється ~1 за секунду. ' +
                        'Це головний обмежувач темпу: повний бак — це десятки кліків, а не нескінченний фарм. ' +
                        'Навичка «Легка рука» здешевлює клік до 1, VIP знімає витрату зовсім.') +
                    block('Пасивний дохід',
                        'Апгрейди «Закрутка» і «Генератор» дають ТК щосекунди навіть коли гра закрита. ' +
                        'Це те, що працює на тебе вночі.') +
                    block('Апгрейди нескінченні (ешелони)',
                        'Рівні йдуть по ' + ECONOMY.TIER_SIZE + ' (ешелон). Ціна всередині ешелону росте ×' +
                        ECONOMY.IN_TIER_GROWTH + ' за рівень, а щоб перейти в наступний — треба ще «пробити» його ' +
                        'ресурсами (окрема плата, не ТК). За кожен новий ешелон і ціна, і ефект рівня стрибають ×' +
                        ECONOMY.TIER_EFFECT_MULT + '. Тому гру не можна «пройти» за вечір — завжди є куди вкладати. ' +
                        'Перемикач ×1/×10/MAX купує пачками.') +
                    block('👵 Бабуся клікає за тебе',
                        'Випадає з дорогих ящиків. ' + ECONOMY.GRANNY_MINUTES + ' хвилин по ' + ECONOMY.GRANNY_CPS +
                        ' кліки/сек — але енергію витрачає твою. Тобто це прискорення, а не безкоштовні гроші.') +
                    tip('Порядок множників доходу: базовий × розшук × VIP × довідки престижу × навички × клан × репутація.');
            }},

            { id: 'levels', tab: '🎖️ Рівень', title: 'Рівень ухилянта — не плутати зі схроном', build: () => {
                const rows = LEVEL_UNLOCKS.map(u => row('Рівень ' + u.level, u.name)).join('');
                return '<p class="codex-lead">Окремий від «рівня схрону» (1-6, локації) лічильник. Росте від XP за ' +
                    'будь-яку активність і поступово відкриває нові вкладки — щоб усе одразу не звалилось на новачка.</p>' +
                    block('Звідки XP',
                        '100 кліків +5 · рівень апгрейду +8 · пробитий ешелон +60 · крафт +15 · нова локація +150 · ' +
                        'вилазка +30…+120 (довша = більше) · перемога над інспектором +200 · щоденний квест +40 · ' +
                        'пережита облава +25 · легалізація +500.') +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    tip('Рівень і XP НІКОЛИ не скидаються — ні легалізацією, ні чимось іншим. Це чисто накопичувальний прогрес.') +
                    warn('Це не економічний гейт: усе, що відкривається за рівнем — і так платні механіки, ' +
                        'жодної безкоштовної переваги від дострокового відкриття немає.');
            }},

            { id: 'ukhyr', tab: '🏆 Ухирація', title: 'Рейтинг «на показ», не валюта', build: () => {
                return '<p class="codex-lead">Окрема від усього іншого метрика статусу — нічого не купує і не прискорює, ' +
                    'тільки показує в лідерборді, скільки цікавого сталося.</p>' +
                    block('Звідки очки',
                        'Вилазка +5 · перемога над інспектором +15 · щоденний квест +3 · пережита облава +10 · ' +
                        'нова локація +50 · справжній Білий Квиток +200 · легалізація +1000.') +
                    '<div class="codex-block"><table class="codex-table">' +
                    UKHYR_RANKS.map(r => row(fmtNum(r.threshold), r.title)).join('') +
                    '</table></div>' +
                    tip('Ранг видно поряд із балансом у 🏆 ТОП — це друга шкала змагання, окрім суми ТК.');
            }},

            { id: 'heat', tab: '🔥 Розшук', title: 'Розшук — головний трейд-оф', build: () => {
                // Нижню межу тіру беремо з попереднього: у самих даних є лише max.
                const rows = HEAT_TIERS.map((t, i) =>
                    row(t.emoji + ' ' + t.name + ' (' + (i ? HEAT_TIERS[i - 1].max + 1 : 0) + '–' + t.max + ')',
                        '×' + t.incomeMult.toFixed(2) + ' дохід · ×' + t.raidMult.toFixed(1) + ' облави')).join('');
                return '<p class="codex-lead">Другий ресурс, протилежний до ТК: чим ти багатший і активніший, тим більше тобою цікавляться. ' +
                    'Розшук піднімає дохід — і разом із ним шанс облави. На якому рівні жити, вирішуєш сам.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    block('Що піднімає',
                        'Кліки (+' + ECONOMY.HEAT_PER_100_CLICKS + ' за 100), вилазки, великі продажі на біржі, ' +
                        'контрабандний контейнер, переїзд у новий схрон, протухла повістка, чужий стук.') +
                    block('Що знижує',
                        'Час: −1 за кожні ' + ECONOMY.HEAT_DECAY_MINUTES + ' хвилин, навіть коли гра закрита (не більше −' +
                        ECONOMY.HEAT_DECAY_DAILY_CAP + ' за добу). Хабар −' + ECONOMY.HEAT_BRIBE_DISCOUNT +
                        ', липова довідка −' + ECONOMY.HEAT_SPRAVKA_DISCOUNT + '. Компаньйонка «Сусідка» гасить приріст на 15%.') +
                    warn('Під відстрочкою розшук НЕ РОСТЕ, але спадає. За два тижні він впаде до нуля разом із множником доходу. ' +
                        'Це навмисно: поки ти невидимий, ти й заробляєш як невидимий.');
            }},

            { id: 'notices', tab: '📬 Повістки', title: 'Повістка — це вибір, а не штраф', build: () => {
                const rows = NOTICE_TYPES.map(t =>
                    row(t.emoji + ' ' + t.name, t.ttlH + ' год · +' + t.heatOnExpire + ' розшуку')).join('');
                return '<p class="codex-lead">Приходить сама, раз на ' + ECONOMY.NOTICE_INTERVAL_MIN_H + '–' +
                    ECONOMY.NOTICE_INTERVAL_MAX_H + ' годин (частіше при високому розшуку), максимум ' +
                    ECONOMY.NOTICE_MAX_ACTIVE + ' активних. Таймер тікає, навіть коли гра закрита.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    block('П\\'ять способів відреагувати',
                        '💵 <b>Вирішити питання</b> — гарантовано, коштує ТК і знижує розшук.<br>' +
                        '📄 <b>Липова довідка</b> — витрачає активний щит від облав.<br>' +
                        '🏥 <b>Медкомісія</b> — безкоштовна міні-гра, можна провалити.<br>' +
                        '🏃 <b>Сховатись</b> — ' + Math.round(ECONOMY.NOTICE_HIDE_SUCCESS * 100) + '%, з\\'їдає всю енергію, ' +
                        'провал = штраф ×' + ECONOMY.NOTICE_HIDE_FAIL_MULT + '.<br>' +
                        '😐 <b>Ігнорувати</b> — таймер тікає далі.') +
                    tip('Бот пришле повідомлення за ' + ECONOMY.NOTICE_PUSH_BEFORE_MIN + ' хвилин до протухання. Не проґав.');
            }},

            { id: 'medcom', tab: '🏥 Медкомісія', title: 'Збери діагноз із трьох карток', build: () => {
                const rows = SYMPTOMS.slice().sort((a,b)=>b.power-a.power).map(s =>
                    row(s.emoji + ' ' + s.name, s.power)).join('');
                return '<p class="codex-lead">Сервер роздає ' + ECONOMY.MEDCOM_HAND_SIZE + ' карток, ти обираєш ' +
                    ECONOMY.MEDCOM_PICK + '. Сума їхньої переконливості має перебити скептицизм комісії = ' +
                    ECONOMY.MEDCOM_BASE_SKEPTICISM + ' + твій поточний розшук. Тобто чим ти помітніший, тим менше тобі вірять.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    block('Бонуси (витрачаються в будь-якому разі)',
                        '🔏 Печатка +' + ECONOMY.MEDCOM_STAMP_BONUS + ' · 💊 Ліки ×' + ECONOMY.MEDCOM_MEDS_QTY +
                        ' +' + ECONOMY.MEDCOM_MEDS_BONUS + ' · 🐈 Кіт-антистрес +' + ECONOMY.MEDCOM_CAT_BONUS +
                        ' (не витрачається). Перекинути картки — ' + fmtNum(ECONOMY.MEDCOM_REROLL_COST) + ' ТК, максимум ' +
                        ECONOMY.MEDCOM_REROLL_MAX + ' рази.') +
                    warn('Та сама скарга двічі поспіль коштує −' + ECONOMY.MEDCOM_REPEAT_PENALTY +
                        ' переконливості: «ви вже приходили з цим». Варіюй.') +
                    tip('Успіх знімає повістку і дає відстрочку на ' + ECONOMY.MEDCOM_DEFER_H + ' годин.');
            }},

            { id: 'inspectors', tab: '👮 Інспектори', title: 'Боси приходять на високий розшук', build: () => {
                const rows = INSPECTORS.map(i =>
                    row(i.emoji + ' ' + i.name + '<br><span style="font-size:10px;color:#8fa3b8">' + i.weaknessHint + '</span>',
                        fmtNum(i.hp) + ' · ' + i.window + 'с<br>з розшуку ' + i.unlockHeat)).join('');
                return '<p class="codex-lead">Приходять самі, коли розшук достатньо високий — і завжди найсерйозніший із доступних. ' +
                    'Бій: клікаєш у вікні, кожен клік коштує ' + ECONOMY.INSPECTOR_ENERGY_PER_CLICK + ' енергії. ' +
                    'Спрацювала слабкість — урон ×' + ECONOMY.INSPECTOR_WEAKNESS_MULT + '.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    block('Наслідки',
                        'Не встиг → бос іде, +' + ECONOMY.INSPECTOR_LOSE_HEAT + ' розшуку, кулдаун ' +
                        ECONOMY.INSPECTOR_COOLDOWN_H + ' годин. Переміг → ТК, ресурси, сезонні очки і трофей у Колекцію.') +
                    warn('Генерал Півник із його ' + fmtNum(250000) + ' терпіння за 45 секунд непрохідний, поки кліки їдять енергію. ' +
                        'Він відкривається навичкою «Марафонець» із дерева престижу. Це не баг — це ендгейм.');
            }},

            { id: 'defer', tab: '🎫 Відстрочки', title: 'Паралельна дорога до спокою', build: () => {
                const rows = DEFERMENTS.map(d => {
                    let cost;
                    if (d.cost.stars) cost = d.cost.stars + ' ⭐';
                    else if (d.cost.tk) cost = fmtNum(d.cost.tk) + ' ТК';
                    else if (d.cost.clanLevel) cost = 'ОСББ ' + d.cost.clanLevel + ' рівня';
                    else cost = Object.entries(d.cost.res).map(([r,q]) => (RESOURCE_BY_ID[r]||{}).emoji + '×' + q).join(' ');
                    const dur = d.hours >= 24 ? plural(Math.round(d.hours/24), 'доба','доби','діб') : d.hours + ' год';
                    return row(d.emoji + ' ' + d.name + '<br><span style="font-size:10px;color:#8fa3b8">' + dur + '</span>', cost);
                }).join('');
                return '<p class="codex-lead">Одна активна за раз. Поки діє: повістки не приходять, чужі стуки не діють, ' +
                    'блокпост проходиться автоматично.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    warn('Ціна безпеки: розшук не росте, тому за час відстрочки він спадає до нуля разом із множником доходу. ' +
                        'Обережний заробляє в базовому темпі, ризиковий тримає розшук 90 і має подвійний дохід ціною облав.') +
                    tip('«Бронь від підприємства» — головна причина будувати чат ОСББ до 5 рівня.');
            }},

            { id: 'checkpoint', tab: '🚧 Блокпост', title: 'Переїзд — це подія', build: () => {
                const rows = CHECKPOINT_CHOICES.map(c =>
                    row(c.emoji + ' ' + c.name + '<br><span style="font-size:10px;color:#ff8a8a">Провал: ' + c.failText + '</span>',
                        Math.round(c.chance * 100) + '%')).join('');
                return '<p class="codex-lead">Купівля нової локації — це переїзд, а переїзд помічають. Шанси показані відкрито, ' +
                    'як і в ящиках. Локація купується в будь-якому разі: блокпост впливає лише на ціну переїзду.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    tip('Активна відстрочка → авто-успіх. Голуб-курʼєр → +' +
                        Math.round(ECONOMY.CHECKPOINT_PIGEON_BONUS * 100) + '% до будь-якого варіанта. ' +
                        'Репутація Баби Ніни понад 50 піднімає «Я до баби» до 75%.');
            }},

            { id: 'pvp', tab: '🐍 PvP', title: 'Здати сусіда', build: () => {
                return '<p class="codex-lead">Єдине, що друзі можуть зробити один одному. Вхід — тап по гравцю в 🏆 ТОП.</p>' +
                    block('Стук',
                        'Коштує ' + fmtNum(ECONOMY.SNITCH_COST_TK) + ' ТК + 📱 ліва сімка. Жертві прилітає повістка ' +
                        '«Вручення в руки» на 3 години і +' + ECONOMY.SNITCH_HEAT + ' розшуку.') +
                    block('Запобіжники',
                        'Максимум ' + ECONOMY.SNITCH_DAILY_LIMIT + ' стуки на добу · кулдаун ' +
                        ECONOMY.SNITCH_SAME_TARGET_COOLDOWN_H + ' год на ту саму ціль · не можна на того, ' +
                        'чий схрон на ' + ECONOMY.SNITCH_MIN_LEVEL_GAP + '+ рівні нижчий · не діє на Білий Квиток, ' +
                        'активний щит і відстрочку.') +
                    block('Розслідування',
                        'Жертві показують трьох підозрюваних — справжнього стукача і двох із її оточення. Здогад один. ' +
                        'Вгадала → забирає 30% балансу стукача, але не більше ' + fmtNum(ECONOMY.SNITCH_STEAL_CAP_PER_LEVEL) +
                        ' × (рівень схрону + 1). Помилилась → невинний отримує безкоштовний дзвінок уже на неї.') +
                    tip('Компаньйон «Щур-розвідник» дає ' + Math.round(ECONOMY.SNITCH_RAT_REVEAL_CHANCE * 100) +
                        '% шанс одразу побачити стукача. Навичка «Дві сімки» дає ' +
                        Math.round(ECONOMY.SKILL_SNITCH_FAIL_CHANCE * 100) + '% шанс, що чужий стук просто провалиться.') +
                    warn('Хибне звинувачення навмисно не безкарне — саме з нього ростуть ланцюгові війни між друзями. ' +
                        'Статистика «Здав / Здали тебе / Розкрив» публічна: хто зловживає, стає мішенню для всіх.');
            }},

            { id: 'season', tab: '🏅 Сезони', title: 'Ліги обнуляються щотижня', build: () => {
                const rows = LEAGUES.map(l => row(l.emoji + ' ' + l.name, l.id === 0 ? 'старт' : 'ліга ' + l.id)).join('');
                return '<p class="codex-lead">Рейтинг за балансом — це «хто довше грає». Сезонні очки обнуляються щопонеділка, ' +
                    'тому шанс має і новачок.</p>' +
                    '<div class="codex-block"><table class="codex-table">' + rows + '</table></div>' +
                    block('Звідки очки',
                        'Вижив в облаві +' + ECONOMY.SEASON_RAID_SP + ' · вилазка +' + ECONOMY.SEASON_EXPEDITION_SP +
                        '×рівень · знята повістка +' + ECONOMY.NOTICE_SEASON_POINTS + ' · розкрив стукача +' +
                        ECONOMY.SNITCH_CAUGHT_SEASON_POINTS + ' · переможений інспектор +10…50 · доба з розшуком понад ' +
                        ECONOMY.SEASON_HEAT_THRESHOLD + ' +' + ECONOMY.SEASON_HEAT_DAILY_SP + ' · крафт тіру 3+ +' +
                        ECONOMY.SEASON_CRAFT_SP + ' · легалізація +' + ECONOMY.SEASON_PRESTIGE_SP + '.') +
                    tip('Верхня чверть ліги піднімається, нижня падає. Сезонну косметику й титул не купиш за ⭐ ніколи — ' +
                        'тільки виграти. Це головна валюта статусу.');
            }},

            { id: 'clan', tab: '🏘 ОСББ', title: 'Чат, війна і автобус', build: () => {
                return '<p class="codex-lead">Членство дає +' + Math.round(ECONOMY.CLAN_PASSIVE_BONUS * 100) +
                    '% до пасиву, кожен рівень чату — ще +' + Math.round(ECONOMY.CLAN_BONUS_PER_LEVEL * 100) + '% ВСІМ. ' +
                    'Тому внесок одного вигідний усім.</p>' +
                    block('⚔️ Війна ОСББ',
                        'Щопонеділка чати паруються за рівнем, війна триває до пʼятниці. Очки: виживаний рейд +' +
                        ECONOMY.WAR_POINTS_RAID + ', вилазка +' + ECONOMY.WAR_POINTS_EXPEDITION +
                        ', переможений інспектор +' + ECONOMY.WAR_POINTS_INSPECTOR + ', внесок ' +
                        fmtNum(ECONOMY.WAR_POINTS_PER_DONATION) + ' ТК +1, а <b>стук на учасника ворожого чату +' +
                        ECONOMY.WAR_POINTS_SNITCH + '</b> і коштує вдвічі дешевше.<br>' +
                        'Перемога: скарбниця +' + Math.round(ECONOMY.WAR_TREASURY_PRIZE * 100) +
                        '%, трофейний ящик кожному, +' + Math.round(ECONOMY.WAR_BUFF_PASSIVE * 100) +
                        '% пасиву на тиждень. Поразка: нічого. Без штрафів — це гра для друзів.') +
                    block('🚌 Облава на район',
                        'Автобус ТЦК приїжджає сам, коли сумарний розшук чату перевищує ' + ECONOMY.DISTRICT_HEAT_TRIGGER +
                        '. Вікно ' + ECONOMY.DISTRICT_WINDOW_H + ' годин, шкала спільна, видно внесок кожного. ' +
                        'Забили → кожному ' + fmtNum(ECONOMY.DISTRICT_WIN_TK) + ' ТК, ящик, ' +
                        ECONOMY.DISTRICT_WIN_HEAT + ' розшуку і +' + ECONOMY.DISTRICT_WIN_SP + ' очок (топ за внеском — подвійно). ' +
                        'Не встигли → −' + Math.round(ECONOMY.DISTRICT_LOSE_BALANCE_PCT * 100) + '% балансу кожному.') +
                    tip('Це єдина механіка, де треба зібратись у чаті в реальному часі. «Всі в гру, зараз» — саме про неї.');
            }},

            { id: 'prestige', tab: '🌳 Ендгейм', title: 'Легалізація і навички', build: () => {
                const branches = SKILL_BRANCHES.map(b =>
                    block(b.emoji + ' ' + b.name, b.skills.map((s, i) => (i+1) + '. <b>' + s.name + '</b> — ' + s.desc).join('<br>'))
                ).join('');
                return '<p class="codex-lead">З ' + ECONOMY.PRESTIGE_UNLOCK_LEVEL + ' рівня схрону можна легалізуватись: ' +
                    'НІЧОГО не скидається — це разова віха, не перезапуск, — і ти отримуєш довідки — ' +
                    '+' + Math.round(ECONOMY.PRESTIGE_BONUS_PER_POINT * 100) + '% до доходу назавжди за кожну.</p>' +
                    block('Легалізуватись можна повторно',
                        'Щойно сумарний заробіток знову підростає — зʼявляється наступна довідка. Прогрес, гардероб, ' +
                        'кімната, компаньйони, кладовка, досягнення, навички — усе лишається як є завжди.') +
                    block('Скільки довідок',
                        'floor(√(сумарно зароблено / ' + fmtNum(ECONOMY.PRESTIGE_EARN_PER_POINT) + ')) мінус уже отримані. ' +
                        'Кожна наступна дається відчутно важче.') +
                    '<p class="codex-lead" style="margin-top:12px;">Кожна довідка = 1 очко навички. Довідки при цьому ' +
                    'продовжують давати свій дохід — навички це бонус зверху. У гілці навички беруться послідовно.</p>' +
                    branches;
            }},

            { id: 'map', tab: '🗺️ Карта', title: 'Захисні споруди на території', build: () => {
                const rows = MAP_BUILDINGS.map(b => {
                    const effectKey = Object.keys(b.levels[0]).find(k => k !== 'cost');
                    const levels = b.levels.map((l, i) => (i+1) + ') ' + Math.round(l[effectKey]*100) + '%').join(', ');
                    return block(b.emoji + ' ' + b.name, b.desc + '<br>Рівні: ' + levels);
                }).join('');
                return '<p class="codex-lead">Особиста карта: орієнтири ведуть до вилазок, а 3 типи споруд — реальний ' +
                    'захист, не декорація. Будуються за деревину/металобрухт/цеглу, кожна незалежно до 3 рівня.</p>' +
                    rows +
                    tip('Іконку збудованої споруди можна перетягнути на будь-яке місце на карті кнопкою «📍 Розмістити» — ' +
                        'це суто візуально, на ефект не впливає.');
            }},

            { id: 'minigames', tab: '🎲 Міні-ігри', title: 'Дрібний азарт, не завʼязаний на прогрес', build: () => {
                return '<p class="codex-lead">Три невеликі розваги окремо від основної економіки — ставки й нагороди тут ' +
                    'помірні, це не спосіб швидко розбагатіти.</p>' +
                    block('🪙 Швидкісна монетка',
                        'Ставка ' + fmtNum(ECONOMY.MINIGAME_STAKE_MIN) + '–' + fmtNum(ECONOMY.MINIGAME_STAKE_MAX) +
                        ' ТК, шанс виграти ' + Math.round(COINFLIP_WIN_CHANCE * 100) + '% (трохи гірше за чесні 50/50 — ' +
                        'заклад завжди в невеликому плюсі). Виграш — подвоєна ставка.') +
                    block('🎯 Колесо ризику 2.0',
                        RISK_TIERS.map(t => t.name + ' — ×' + t.mult + ' (' + Math.round(t.chance * 100) + '%)').join('<br>')) +
                    block('🃏 Знайди пару',
                        'Вхід ' + fmtNum(MEMORY_ENTRY_COST) + ' ТК, 4 пари карток. Нагорода залежить від кількості спроб: ' +
                        MEMORY_REWARD_TABLE.map(t => (t.maxFlips === Infinity ? 'більше' : 'до ' + t.maxFlips) + ' спроб → ' + fmtNum(t.reward) + ' ТК').join(', ') + '.') +
                    warn('Усі три — суто розвага. Жодна не дає постійних бонусів чи не впливає на розшук/рівень — ' +
                        'тільки одноразовий ТК туди-сюди.');
            }},

            { id: 'district', tab: '🤝 Район', title: 'Люди навколо', build: () => {
                const rows = REPUTATION_NPCS.map(n =>
                    block(n.emoji + ' ' + n.name, '<i style="color:#8fa3b8">«' + n.about + '»</i><br>' +
                        'На ' + ECONOMY.REP_MAX + ' репутації: <b style="color:var(--gold)">' + n.perk + '</b>')).join('');
                return '<p class="codex-lead">У кожного щоденний квест. Квест дня однаковий для всіх і не міняється, ' +
                    'скільки не перезаходь. Ресурсні квести — це саме віддати: ресурси списуються безповоротно.</p>' +
                    rows +
                    tip('Оксана тут не для галочки. Гра, де вигідно тільки ховатись, була б однобокою — ' +
                        'тому персонаж, якому вигідно допомагати, дає один із найкорисніших постійних бонусів.');
            }},
        ];

        function block(title, html) {
            return '<div class="codex-block"><h4>' + title + '</h4><p>' + html + '</p></div>';
        }
        function row(left, right) {
            return '<tr><td>' + left + '</td><td>' + right + '</td></tr>';
        }
        function tip(text) { return '<div class="codex-tip">💡 ' + text + '</div>'; }
        function warn(text) { return '<div class="codex-warn">⚠️ ' + text + '</div>'; }

        let codexTab = 'basics';
        window.openCodex = (tabId) => {
            codexTab = tabId || codexTab;
            renderCodex();
            document.getElementById('codex-screen').classList.remove('hidden');
        };
        window.closeCodex = () => document.getElementById('codex-screen').classList.add('hidden');
        window.setCodexTab = (id) => { codexTab = id; renderCodex(); document.getElementById('codex-screen').scrollTop = 0; };

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

        function renderCodex() {
            document.getElementById('codex-nav').innerHTML = CODEX.map(s =>
                '<button class="' + (s.id === codexTab ? 'active' : '') + '" onclick="setCodexTab(\\'' + s.id + '\\')">' +
                s.tab + '</button>').join('');
            const sec = CODEX.find(s => s.id === codexTab) || CODEX[0];
            document.getElementById('codex-body').innerHTML =
                '<div class="codex-sec"><h3>' + sec.title + '</h3>' + sec.build() + '</div>';
        }

        // ===== Сезон і ліга =====
        window.openSeason = async () => {
            try {
                const data = await apiFetch('/api/season?id=' + user.id).then(r => r.json());
                renderSeason(data);
                document.getElementById('season-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити сезон'); }
        };
        window.closeSeason = () => document.getElementById('season-screen').classList.add('hidden');

        function renderSeason(d) {
            state.league = d.league;
            state.seasonPoints = d.seasonPoints;
            state.seasonTitle = d.seasonTitle;
            document.getElementById('league-badge').innerText = d.league.emoji + ' ' + d.league.name;
            const left = Math.max(0, d.seasonEndsAt - Date.now());
            document.getElementById('league-sub').innerText =
                'Ти ' + d.rank + '-й з ' + d.groupSize + ' · ' + fmtNum(d.seasonPoints) + ' СО · до кінця ' + fmtCountdown(left);
            document.getElementById('promote-n').innerText = d.promoteAt;
            document.getElementById('relegate-n').innerText = d.relegateAt;

            document.getElementById('season-standings').innerHTML = d.standings.map(s => {
                const zone = s.rank <= d.promoteAt ? ' promote'
                    : (s.rank > d.groupSize - d.relegateAt ? ' relegate' : '');
                return '<div class="standing-row' + (s.me ? ' me' : '') + zone + '">' +
                    '<span class="standing-rank">' + s.rank + '</span>' +
                    '<span>' + esc(s.name) + (s.title ? '<span class="season-title-chip">' + esc(s.title) + '</span>' : '') + '</span>' +
                    '<span class="standing-pts">' + fmtNum(s.points) + '</span></div>';
            }).join('') || '<div style="font-size:12px;color:#8fa3b8;text-align:center;padding:12px;">У цій лізі поки тихо.</div>';
        }

        function showSeasonResult(r) {
            const lines = [];
            lines.push('<div class="offline-line">' + r.leagueEmoji + ' ' + esc(r.leagueName) +
                '<b>' + r.rank + ' місце з ' + r.total + '</b></div>');
            if (r.tk) lines.push('<div class="offline-line">💰 Нагорода<b>+' + fmtNum(r.tk) + ' ТК</b></div>');
            if (r.crates) lines.push('<div class="offline-line">📦 Ящики<b>×' + r.crates + '</b></div>');
            if (r.cosmetic) {
                const c = COSMETICS.find(x => x.id === r.cosmetic);
                lines.push('<div class="offline-line">' + (c ? c.emoji + ' ' + esc(c.name) : 'Сезонна річ') + '<b>тільки за 1 місце</b></div>');
            }
            if (r.title) lines.push('<div class="offline-line">🏅 Титул<b>' + esc(r.title) + '</b></div>');
            if (r.move > 0) lines.push('<div class="offline-line">⬆️ Підвищення<b>лігою вище</b></div>');
            else if (r.move < 0) lines.push('<div class="offline-line bad">⬇️ Пониження<b>лігою нижче</b></div>');
            document.getElementById('season-result-body').innerHTML = lines.join('');
            document.getElementById('season-result').classList.remove('hidden');
        }
        window.closeSeasonResult = () => document.getElementById('season-result').classList.add('hidden');

        // ===== Війна ОСББ =====
        window.openWar = async () => {
            try {
                const data = await apiFetch('/api/war?id=' + user.id).then(r => r.json());
                renderWar(data);
                document.getElementById('war-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити війну'); }
        };
        window.closeWar = () => document.getElementById('war-screen').classList.add('hidden');

        function renderWar(d) {
            const box = document.getElementById('war-body');
            state.pendingWarCrate = d.pendingWarCrate || 0;
            let html = '';
            if (d.pendingWarCrate > 0) {
                html += '<button onclick="openWarCrate()" style="margin-bottom:12px;">🏆 Забрати трофейний ящик (×' +
                    d.pendingWarCrate + ')</button>';
            }
            if (!d.war) {
                html += '<p style="font-size:13px; color:#8fa3b8; text-align:center; padding:14px 0; line-height:1.5;">' +
                    'Цього тижня твій чат ОСББ без пари. Пари складаються щопонеділка за рівнем чату.</p>';
                box.innerHTML = html;
                return;
            }
            const w = d.war;
            const leading = w.myPoints >= w.theirPoints;
            html += '<div class="war-scores">' +
                '<div class="war-side mine"><b>' + fmtNum(w.myPoints) + '</b><span>наш чат</span></div>' +
                '<div style="font-size:18px;">' + (leading ? '🏆' : '😬') + '</div>' +
                '<div class="war-side theirs"><b>' + fmtNum(w.theirPoints) + '</b><span>' + esc(w.opponentName) + '</span></div>' +
                '</div>';
            html += '<div style="font-size:12px; color:#8fa3b8; text-align:center; margin-bottom:12px;">' +
                (w.active ? 'До кінця війни: ' + fmtCountdown(Math.max(0, w.endsAt - Date.now())) : 'Війна завершена') +
                ' · твій внесок: <b style="color:var(--gold)">' + fmtNum(w.myContribution) + '</b></div>';

            if (w.enemies.length) {
                html += '<h3 style="font-size:14px; color:var(--gold); margin:14px 0 6px;">Склад ворожого чату</h3>' +
                    '<p style="font-size:11px; color:#8fa3b8; margin:0 0 8px;">Стук на ворога дає +' +
                    ECONOMY.WAR_POINTS_SNITCH + ' очок війни і коштує вдвічі дешевше.</p>' +
                    w.enemies.map(e =>
                        '<div class="enemy-row"><span>🕴️</span><span>' + esc(e.name) + '</span>' +
                        '<span style="font-size:11px;color:#8fa3b8;">схрон ' + e.level + '</span>' +
                        '<button class="snitch-btn" onclick="openProfile(\\'' + e.pid + '\\')">🐍</button></div>'
                    ).join('');
            }
            if ((w.log || []).length) {
                html += '<h3 style="font-size:14px; color:var(--gold); margin:14px 0 6px;">Хроніка</h3>' +
                    w.log.slice(0, 10).map(l =>
                        '<div class="district-contrib"><span>' + esc(l.name) + ' — ' + esc(l.reason) + '</span><b>+' + l.points + '</b></div>'
                    ).join('');
            }
            box.innerHTML = html;
        }

        window.openWarCrate = async () => {
            const res = await apiFetch('/api/war/crate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            state.balance = data.balance;
            if (data.resources) state.resources = data.resources;
            state.pendingWarCrate = data.pendingWarCrate;
            closeWar();
            playCrateAnimation(data.reward, 'trophy');
            renderStorage();
            updateUI();
        };

        // ===== Облава на район (кооп-бос) =====
        let districtState = null;
        let districtClicks = 0;
        let districtTimer = null;

        window.openDistrict = async () => {
            const d = await apiFetch('/api/district?id=' + user.id).then(r => r.json());
            if (!d.districtRaid) {
                return tg.showAlert('🚌 Автобуса зараз немає.\\nВін приїжджає, коли сумарний розшук чату перевищує ' +
                    (d.heatTrigger || ECONOMY.DISTRICT_HEAT_TRIGGER) + ' (зараз ' + (d.clanHeat || 0) + ').');
            }
            districtState = d.districtRaid;
            districtClicks = 0;
            renderDistrict();
            document.getElementById('district-screen').classList.remove('hidden');
            if (districtTimer) clearInterval(districtTimer);
            districtTimer = setInterval(flushDistrictClicks, ECONOMY.INSPECTOR_BATCH_MS);
        };
        window.closeDistrict = () => {
            flushDistrictClicks();
            document.getElementById('district-screen').classList.add('hidden');
            if (districtTimer) { clearInterval(districtTimer); districtTimer = null; }
            districtState = null;
        };

        function renderDistrict() {
            if (!districtState) return;
            const pct = Math.max(0, districtState.hp / districtState.hpMax * 100);
            document.getElementById('district-hpfill').style.width = pct + '%';
            document.getElementById('district-hptext').innerText =
                'Терпіння автобуса: ' + fmtNum(districtState.hp) + ' / ' + fmtNum(districtState.hpMax);
            document.getElementById('district-timer').innerText =
                fmtCountdown(Math.max(0, districtState.endsAt - Date.now()));
            document.getElementById('district-contribs').innerHTML =
                (districtState.contributions || []).map(c =>
                    '<div class="district-contrib"><span>' + esc(c.name) + '</span><b>' + fmtNum(c.damage) + '</b></div>'
                ).join('');
        }

        document.getElementById('district-hitzone').addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (!districtState) return;
            if (!hasSkill('marathon') && state.energy < ECONOMY.INSPECTOR_ENERGY_PER_CLICK) {
                tg.HapticFeedback.notificationOccurred('warning');
                return;
            }
            districtClicks++;
            if (!hasSkill('marathon')) state.energy = Math.max(0, state.energy - ECONOMY.INSPECTOR_ENERGY_PER_CLICK);
            const bus = document.getElementById('district-bus');
            bus.classList.remove('hit'); void bus.offsetWidth; bus.classList.add('hit');
            tg.HapticFeedback.impactOccurred('medium');
        });

        async function flushDistrictClicks() {
            if (!districtState || !districtClicks) return;
            const clicks = districtClicks;
            districtClicks = 0;
            const res = await apiFetch('/api/district/hit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, clicks, dt: ECONOMY.INSPECTOR_BATCH_MS }),
            });
            const data = await res.json();
            if (typeof data.energy === 'number') state.energy = data.energy;
            if (data.gone) { closeDistrict(); tg.showAlert('🚌 ' + data.message); return; }
            if (data.defeated) {
                closeDistrict();
                state.balance = data.balance;
                state.trophies = data.trophies || state.trophies;
                state.pendingWarCrate = data.pendingWarCrate || 0;
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert('🚌 Автобус поїхав ні з чим!\\n\\n' +
                    (data.rewards || []).map(r => (r.top ? '👑 ' : '') + r.name + ': +' + fmtNum(r.tk) + ' ТК').join('\\n') +
                    '\\n\\nТрофейний ящик чекає у вкладці війни.');
                updateUI();
                return;
            }
            if (data.districtRaid) { districtState = data.districtRaid; renderDistrict(); }
        }

        // ===== Репутація з районом =====
        window.openReputation = async () => {
            try {
                const data = await apiFetch('/api/reputation?id=' + user.id).then(r => r.json());
                renderReputation(data);
                document.getElementById('reputation-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити район'); }
        };
        window.closeReputation = () => document.getElementById('reputation-screen').classList.add('hidden');

        function renderReputation(data) {
            state.reputation = data.reputation || {};
            document.getElementById('npc-list').innerHTML = data.npcs.map(n => {
                const q = n.quest;
                const pct = Math.round(100 * n.rep / data.repMax);
                let prog;
                if (q.claimed) prog = '✅ Сьогодні вже допоміг';
                else if (q.invert) prog = (q.done ? '✅ ' : '❌ ') + 'зараз ' + q.have + ' (треба не більше ' + q.need + ')';
                else prog = q.have + ' / ' + q.need + (q.done ? ' ✅' : '');

                const btn = n.maxed
                    ? ''
                    : '<button onclick="claimRep(\\'' + n.id + '\\')"' +
                      (q.done && !q.claimed ? '' : ' disabled') + '>' +
                      (q.claimed ? 'Приходь завтра' : (q.type === 'donate' ? 'Віддати й отримати +' + q.rep : 'Отримати +' + q.rep)) +
                      '</button>';

                return '<div class="npc-card' + (n.maxed ? ' maxed' : '') + '">' +
                    '<div class="npc-head"><span style="font-size:26px;">' + n.emoji + '</span>' +
                    '<span class="npc-name">' + esc(n.name) + '</span>' +
                    '<span class="npc-rep">' + n.rep + ' / ' + data.repMax + '</span></div>' +
                    '<div class="npc-about">«' + esc(n.about) + '»</div>' +
                    '<div class="storage-bar" style="margin-bottom:9px;"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
                    (n.maxed ? '' :
                        '<div class="npc-quest"><div class="npc-quest-text">' + esc(q.text) + '</div>' +
                        '<div class="npc-quest-prog' + (q.done ? ' done' : '') + '">' + esc(prog) + '</div></div>') +
                    btn +
                    '<div class="npc-perk' + (n.maxed ? ' on' : '') + '">' +
                    (n.maxed ? '🏅 ' : '🔒 ') + esc(n.perk) + '</div>' +
                '</div>';
            }).join('');
        }

        window.claimRep = async (npcId) => {
            const res = await apiFetch('/api/reputation/claim', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, npcId }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            if (data.resources) state.resources = data.resources;
            if (typeof data.maxEnergy === 'number') state.maxEnergy = data.maxEnergy;
            if (typeof data.energy === 'number') state.energy = data.energy;
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert(data.message + (data.perkUnlocked ? '\\n\\n🏅 Відкрито назавжди: ' + data.perkUnlocked : ''));
            if (data.unlockedAchievements) showAchievements(data.unlockedAchievements);
            renderReputation(data);
            renderStorage();
            updateUI();
            saveState();
        };

        // ===== Офлайн-звіт =====
        // Раніше гравець після повернення просто бачив іншу цифру балансу й не
        // розумів, що відбулось: хто його здав, яка повістка протухла.
        function showOfflineReport(rep) {
            if (!rep) return;
            const h = Math.floor(rep.awayMs / 3600000);
            const m = Math.floor((rep.awayMs % 3600000) / 60000);
            document.getElementById('offline-away').innerText =
                'Тебе не було ' + (h ? h + ' год ' : '') + m + ' хв';

            const lines = [];
            if (rep.earnings > 0) {
                lines.push('<div class="offline-line">💰 Пасивний дохід<b>+' + fmtNum(rep.earnings) + ' ТК</b></div>');
            }
            for (const e of rep.events || []) {
                lines.push('<div class="offline-line' + (e.kind === 'bad' ? ' bad' : '') + '">' + esc(e.text) + '</div>');
            }
            document.getElementById('offline-lines').innerHTML = lines.join('') ||
                '<div class="offline-line">Тихо. Ніхто тебе не турбував.</div>';
            document.getElementById('offline-report').classList.remove('hidden');
        }
        window.closeOfflineReport = () => document.getElementById('offline-report').classList.add('hidden');

        // ===== Дерево навичок =====
        // Клієнтські ефекти навичок. Економічні рішення (дроп, ціни, урон) рахує
        // сервер — тут лише те, що впливає на відчуття від кліку в реальному часі.
        function hasSkill(id) { return !!(state.skills || {})[id]; }
        function clickEnergyCost() { return hasSkill('lighthand') ? ECONOMY.SKILL_LIGHTHAND_ENERGY_COST : ECONOMY.ENERGY_PER_CLICK; }
        function skillClickMult() { return hasSkill('callus') ? 1 + ECONOMY.SKILL_CLICK_BONUS : 1; }
        function skillRegenMult() {
            return (hasSkill('secondwind') ? 1 + ECONOMY.SKILL_REGEN_BONUS : 1)
                * (hasSkill('morningcoffee') ? 1 + ECONOMY.SKILL_MORNING_COFFEE_REGEN : 1);
        }

        window.openSkills = async () => {
            try {
                const data = await apiFetch('/api/skills?id=' + user.id).then(r => r.json());
                renderSkills(data);
                document.getElementById('skills-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити дерево навичок'); }
        };
        window.closeSkills = () => document.getElementById('skills-screen').classList.add('hidden');

        function renderSkills(data) {
            state.skills = data.skills || {};
            state.skillPoints = data.skillPoints || 0;

            document.getElementById('skill-points').innerHTML = data.skillPoints > 0
                ? 'Вільних очок: <b>' + data.skillPoints + '</b>'
                : '<span style="font-size:13px; color:#8fa3b8;">Вільних очок немає. Взято ' +
                  data.skillsOwned + ' із ' + data.skillsTotal + ' — нові очки дає легалізація.</span>';

            document.getElementById('skills-tree').innerHTML = data.branches.map(br =>
                '<div class="skill-branch">' +
                '<div class="skill-branch-head">' + br.emoji + ' ' + esc(br.name) + '</div>' +
                '<div class="skill-branch-desc">' + esc(br.desc) + '</div>' +
                br.skills.map((s, i) => {
                    const canBuy = !s.owned && s.available && data.skillPoints > 0;
                    // lockedByLevel (2026-08-16): гейт рівня схрону, окремий від
                    // послідовності — показуємо конкретну причину, а не просто "закрито".
                    const hint = s.lockedByLevel ? ' <span class="skill-locked-hint">(потрібен схрон ' + s.minLevel + ')</span>' : '';
                    return '<div class="skill-node' + (s.owned ? ' owned' : (s.available ? '' : ' locked')) + '">' +
                        '<div class="skill-dot">' + (s.owned ? '✓' : (i + 1)) + '</div>' +
                        '<div><div class="skill-name">' + esc(s.name) + hint + '</div>' +
                        '<div class="skill-desc">' + esc(s.desc) + '</div></div>' +
                        (s.owned ? '' : '<button onclick="buySkill(\\'' + s.id + '\\')"' +
                            (canBuy ? '' : ' disabled') + '>Взяти</button>') +
                    '</div>';
                }).join('') + '</div>'
            ).join('');

            const reset = document.getElementById('skills-reset');
            reset.disabled = !data.skillsOwned;
            reset.innerText = data.skillResetCost
                ? 'Скинути дерево — ' + fmtNum(data.skillResetCost) + ' ТК'
                : 'Скинути дерево (перше скидання безкоштовне)';
        }

        window.buySkill = async (skillId) => {
            const res = await apiFetch('/api/skills/buy', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, skillId }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            // Навичка могла підняти стелю енергії — беремо авторитетне значення,
            // інакше автозбереження поверне старе.
            if (typeof data.maxEnergy === 'number') state.maxEnergy = data.maxEnergy;
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('✅ ' + data.message);
            renderSkills(data);
            renderExpeditions();
            updateUI();
            saveState();
        };

        window.resetSkills = () => {
            tg.showConfirm('Скинути всі навички? Очки повернуться, і їх можна буде розподілити наново.', async (ok) => {
                if (!ok) return;
                const res = await apiFetch('/api/skills/reset', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id }),
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message);
                if (typeof data.balance === 'number') state.balance = data.balance;
                if (typeof data.maxEnergy === 'number') state.maxEnergy = data.maxEnergy;
                tg.showAlert('♻️ ' + data.message);
                renderSkills(data);
                updateUI();
                saveState();
            });
        };

        // ===== Відстрочки =====
        window.openDeferments = async () => {
            try {
                const data = await apiFetch('/api/deferments?id=' + user.id).then(r => r.json());
                renderDeferments(data);
                document.getElementById('deferment-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити відстрочки'); }
        };
        window.closeDeferments = () => document.getElementById('deferment-screen').classList.add('hidden');

        function renderDeferments(data) {
            state.deferUntil = data.deferUntil || 0;
            state.defermentId = data.defermentId || null;
            state.deferments = data.deferments;

            const activeBox = document.getElementById('deferment-active');
            const active = state.deferUntil > Date.now();
            activeBox.classList.toggle('hidden', !active);
            if (active) {
                const def = (data.deferments || []).find(d => d.id === data.defermentId);
                activeBox.className = 'defer-active';
                activeBox.innerHTML = '<b>' + (def ? def.emoji + ' ' + esc(def.name) : 'Відстрочка діє') + '</b><br>' +
                    '<span style="font-size:12px; color:#8fa3b8;">Лишилось: <b id="defer-countdown">' +
                    fmtCountdown(state.deferUntil - Date.now()) + '</b></span>';
            }

            document.getElementById('deferment-list').innerHTML = data.deferments.map(d => {
                let cost;
                if (d.cost.stars) cost = '💰 ' + d.cost.stars + ' ⭐';
                else if (d.cost.tk) cost = '💰 ' + fmtNum(d.cost.tk) + ' ТК';
                else if (d.cost.clanLevel) cost = '🏘️ Чат ОСББ ' + d.cost.clanLevel + ' рівня';
                else cost = '📦 ' + Object.entries(d.cost.res || {})
                    .map(([r, q]) => (RESOURCE_BY_ID[r] ? RESOURCE_BY_ID[r].emoji + ' ' + RESOURCE_BY_ID[r].name : r) + ' ×' + q)
                    .join(', ');
                const dur = d.hours >= 24 ? plural(Math.round(d.hours / 24), 'доба', 'доби', 'діб') : d.hours + ' год';
                const btn = d.cost.stars
                    ? '<button onclick="buyDefermentStars(\\'' + d.id + '\\')">Купити за ' + d.cost.stars + ' ⭐</button>'
                    : '<button onclick="buyDeferment(\\'' + d.id + '\\')"' + (d.can ? '' : ' disabled') + '>Оформити</button>';
                return '<div class="defer-card' + (d.can || d.cost.stars ? '' : ' locked') + '">' +
                    '<div class="defer-head"><span style="font-size:22px;">' + d.emoji + '</span>' +
                    '<span class="defer-name">' + esc(d.name) + '</span>' +
                    '<span class="defer-dur">' + dur + '</span></div>' +
                    '<div class="defer-flavor">«' + esc(d.flavor) + '»</div>' +
                    '<div class="defer-cost">' + cost + '</div>' + btn +
                    (!d.can && d.reason ? '<div class="defer-reason">' + esc(d.reason) + '</div>' : '') +
                    '</div>';
            }).join('');
        }

        window.buyDeferment = async (id) => {
            const res = await apiFetch('/api/deferment/buy', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, defermentId: id }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            if (typeof data.balance === 'number') state.balance = data.balance;
            if (data.resources) state.resources = data.resources;
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('✅ ' + data.message);
            if (data.unlockedAchievements) showAchievements(data.unlockedAchievements);
            renderDeferments(data);
            renderStorage();
            updateUI();
        };

        window.buyDefermentStars = async (id) => {
            const res = await apiFetch('/api/invoice', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, type: 'deferment', defermentId: id }),
            });
            const data = await res.json();
            if (!data.link) return tg.showAlert('Не вдалося створити рахунок');
            tg.openInvoice(data.link, (status) => {
                if (status === 'paid') tg.showAlert('✅ Оплачено! Відстрочка активна — перезайди в гру.');
            });
        };

        // ===== Блокпост =====
        window.openCheckpoint = async () => {
            try {
                const data = await apiFetch('/api/checkpoint?id=' + user.id).then(r => r.json());
                renderCheckpoint(data);
                document.getElementById('checkpoint-screen').classList.remove('hidden');
            } catch (e) { /* блокпост не критичний — не блокуємо переїзд */ }
        };
        window.closeCheckpoint = () => document.getElementById('checkpoint-screen').classList.add('hidden');

        function renderCheckpoint(data) {
            const box = document.getElementById('checkpoint-body');
            if (data.checkpointAuto) {
                // Під відстрочкою вибору немає — і це приємно.
                box.innerHTML = '<div class="defer-active"><b>🎫 У тебе відстрочка</b><br>' +
                    '<span style="font-size:12px; color:#8fa3b8;">Показав папірець — навіть виходити з машини не довелось.</span></div>' +
                    '<button onclick="passCheckpoint(\\'auto\\')">Їхати далі</button>';
                return;
            }
            box.innerHTML = data.checkpointChoices.map(c =>
                '<div class="cp-choice" onclick="passCheckpoint(\\'' + c.id + '\\')">' +
                '<div class="cp-head"><span style="font-size:22px;">' + c.emoji + '</span>' +
                '<span>' + esc(c.name) + '</span><span class="cp-chance">' + c.chance + '%</span></div>' +
                '<div class="cp-fail">Провал: ' + esc(c.failText) + '</div></div>'
            ).join('');
        }

        window.passCheckpoint = async (choice) => {
            const res = await apiFetch('/api/checkpoint/pass', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, choice: choice === 'auto' ? 'docs' : choice }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            closeCheckpoint();
            absorbHeat(data);
            if (data.resources) state.resources = data.resources;
            tg.HapticFeedback.notificationOccurred(data.passed ? 'success' : 'error');
            let msg = (data.passed ? '✅ ' : '❌ ') + data.message;
            const c = data.consequence;
            if (c && c.heat) msg += '\\n+' + c.heat + ' до розшуку';
            if (c && c.notice) msg += '\\nІ повістка просто тут, на місці';
            if (c && c.resourcesLost) msg += '\\nЗагубив ресурсів: ' + c.resourcesLost;
            tg.showAlert(msg);
            renderStorage();
            updateUI();
        };

        // ===== Медкомісія =====
        let medcomHand = null;
        let medcomPicked = [];
        let medcomBonuses = { stamp: false, meds: false };

        function openMedcom(hand) {
            medcomHand = hand;
            medcomPicked = [];
            medcomBonuses = { stamp: false, meds: false };
            renderMedcom();
            document.getElementById('medcom-screen').classList.remove('hidden');
        }
        window.closeMedcom = () => document.getElementById('medcom-screen').classList.add('hidden');

        function renderMedcom() {
            if (!medcomHand) return;
            document.getElementById('medcom-cards').innerHTML = medcomHand.cards.map((c, i) =>
                '<div class="symptom-card' + (medcomPicked.includes(c.id) ? ' picked' : '') +
                (c.repeated ? ' repeated' : '') + '" onclick="toggleSymptom(' + i + ')">' +
                '<span class="symptom-emoji">' + c.emoji + '</span>' +
                '<div><div class="symptom-name">' + esc(c.name) + '</div>' +
                (c.repeated ? '<div class="symptom-note">Ви вже приходили з цим (−' + ECONOMY.MEDCOM_REPEAT_PENALTY + ')</div>' : '') +
                '</div><span class="symptom-power">' + c.power + '</span></div>'
            ).join('');

            const b = medcomHand.bonuses;
            const row = (key, label, on, avail, bonus) =>
                '<label class="medcom-bonus' + (avail ? '' : ' off') + '">' +
                '<input type="checkbox"' + (on ? ' checked' : '') + (avail ? '' : ' disabled') +
                ' onchange="toggleMedcomBonus(\\'' + key + '\\', this.checked)">' +
                '<span>' + label + '</span><b style="margin-left:auto; color:var(--gold)">+' + bonus + '</b></label>';
            document.getElementById('medcom-bonuses').innerHTML =
                row('stamp', '🔏 Печатка (витратиться 1)', medcomBonuses.stamp, b.stamp.have, b.stamp.bonus) +
                row('meds', '💊 Ліки ×' + b.meds.qty + ' (витратяться)', medcomBonuses.meds, b.meds.have, b.meds.bonus) +
                (b.cat.have ? '<div class="medcom-bonus">🐈 Кіт-антистрес: маєш змучений вигляд<b style="margin-left:auto; color:var(--gold)">+' + b.cat.bonus + '</b></div>' : '');

            updateMedcomScale();
            const rr = document.getElementById('medcom-reroll');
            rr.disabled = medcomHand.rerollsLeft <= 0 || state.balance < medcomHand.rerollCost;
            rr.innerText = medcomHand.rerollsLeft > 0
                ? 'Перекинути картки — ' + fmtNum(medcomHand.rerollCost) + ' ТК (лишилось ' + medcomHand.rerollsLeft + ')'
                : 'Перекидати більше не можна';
        }

        function medcomTotalPower() {
            if (!medcomHand) return 0;
            let p = medcomPicked.reduce((s, id) => s + (medcomHand.cards.find(c => c.id === id) || {}).power, 0);
            if (medcomBonuses.stamp) p += medcomHand.bonuses.stamp.bonus;
            if (medcomBonuses.meds) p += medcomHand.bonuses.meds.bonus;
            if (medcomHand.bonuses.cat.have) p += medcomHand.bonuses.cat.bonus;
            return p;
        }

        function updateMedcomScale() {
            const power = medcomTotalPower();
            const el = document.getElementById('medcom-power');
            el.innerText = power;
            el.className = 'val ' + (power >= medcomHand.skepticism ? 'medcom-ok' : 'medcom-bad');
            document.getElementById('medcom-skept').innerText = medcomHand.skepticism;
            const submit = document.getElementById('medcom-submit');
            submit.disabled = medcomPicked.length !== medcomHand.pick;
            submit.innerText = medcomPicked.length === medcomHand.pick
                ? 'Подати діагноз'
                : 'Обери ще ' + (medcomHand.pick - medcomPicked.length);
        }

        window.toggleSymptom = (i) => {
            const id = medcomHand.cards[i].id;
            const at = medcomPicked.indexOf(id);
            if (at >= 0) medcomPicked.splice(at, 1);
            else if (medcomPicked.length < medcomHand.pick) medcomPicked.push(id);
            else return tg.HapticFeedback.notificationOccurred('warning');
            tg.HapticFeedback.impactOccurred('light');
            renderMedcom();
        };

        window.toggleMedcomBonus = (key, on) => { medcomBonuses[key] = on; updateMedcomScale(); };

        window.rerollMedcom = async () => {
            const res = await apiFetch('/api/medcom/reroll', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            state.balance = data.balance;
            medcomHand = data.hand;
            medcomPicked = [];
            renderMedcom();
            updateUI();
        };

        window.submitMedcom = async () => {
            const res = await apiFetch('/api/medcom/submit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, cardIds: medcomPicked,
                    useStamp: medcomBonuses.stamp, useMeds: medcomBonuses.meds }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message);
            closeMedcom();
            absorbHeat(data);
            if (typeof data.balance === 'number') state.balance = data.balance;
            if (typeof data.energy === 'number') state.energy = data.energy;
            if (data.resources) state.resources = data.resources;
            if (typeof data.deferUntil === 'number') state.deferUntil = data.deferUntil;
            tg.HapticFeedback.notificationOccurred(data.resolved ? 'success' : 'error');
            let msg = (data.resolved ? '✅ ' : '❌ ') + data.message +
                '\\n\\nПереконливість ' + data.power + ' проти скептицизму ' + data.skepticism;
            if (data.penalty && data.penalty.coins) msg += '\\nШтраф: −' + fmtNum(data.penalty.coins) + ' ТК';
            tg.showAlert(msg);
            if (data.unlockedAchievements) showAchievements(data.unlockedAchievements);
            renderStorage();
            renderNotices();
            updateUI();
        };

        // ===== Інспектори ТЦК (боси) =====
        let inspectorState = null;
        let inspectorClicks = 0;      // накопичені кліки, летять батчем раз на 500мс
        let inspectorBatchTimer = null;
        let inspectorBatchStart = 0;
        let inspectorWeakOn = false;
        let inspectorOpenedAt = 0;    // захист від гонки застарілих відповідей (див. absorbInspector)

        function openInspector(insp) {
            inspectorState = insp;
            inspectorOpenedAt = Date.now();
            inspectorClicks = 0;
            inspectorBatchStart = Date.now();
            inspectorWeakOn = false;
            document.getElementById('inspector-face').innerText = insp.emoji;
            document.getElementById('inspector-name').innerText = insp.name;
            document.getElementById('inspector-taunt').innerText = insp.taunt;
            document.getElementById('inspector-weak').innerText = insp.weakness
                ? '🎯 Слабкість: ' + insp.weaknessHint
                : 'Слабкостей немає. Тільки ти і твій палець';
            renderInspectorBars();
            document.getElementById('inspector-screen').classList.remove('hidden');
            if (inspectorBatchTimer) clearInterval(inspectorBatchTimer);
            inspectorBatchTimer = setInterval(flushInspectorClicks, ECONOMY.INSPECTOR_BATCH_MS);
        }

        function closeInspector() {
            document.getElementById('inspector-screen').classList.add('hidden');
            if (inspectorBatchTimer) { clearInterval(inspectorBatchTimer); inspectorBatchTimer = null; }
            inspectorState = null;
            inspectorClicks = 0;
        }

        function renderInspectorBars() {
            if (!inspectorState) return;
            const pct = Math.max(0, inspectorState.hp / inspectorState.hpMax * 100);
            document.getElementById('inspector-hpfill').style.width = pct + '%';
            document.getElementById('inspector-hptext').innerText =
                'Терпіння: ' + fmtNum(inspectorState.hp) + ' / ' + fmtNum(inspectorState.hpMax);
        }

        // Таймер боса крутиться в тому ж циклі, що й решта UI — це лише текст,
        // важких рендерів тут немає.
        function updateInspectorTimer() {
            if (!inspectorState) return;
            const left = Math.max(0, inspectorState.endsAt - Date.now()) / 1000;
            const el = document.getElementById('inspector-timer');
            el.innerText = left.toFixed(1);
            el.classList.toggle('low', left <= 10);
            if (left <= 0) {
                flushInspectorClicks();
                if (inspectorState) {
                    closeInspector();
                    tg.HapticFeedback.notificationOccurred('error');
                    tg.showAlert('⏰ Не встиг. Інспектор пішов писати рапорт. +' +
                        ECONOMY.INSPECTOR_LOSE_HEAT + ' до розшуку.');
                }
            }
        }

        document.getElementById('inspector-hitzone').addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (!inspectorState) return;
            if (!hasSkill('marathon') && state.energy < ECONOMY.INSPECTOR_ENERGY_PER_CLICK) {
                tg.HapticFeedback.notificationOccurred('warning');
                return;
            }
            inspectorClicks++;
            // Оптимістично малюємо витрату енергії й трясемо боса, авторитетні
            // цифри прилетять з відповіді на батч. «Марафонець» знімає витрату
            // повністю (той самий чек, що вже був на боєвці з районом) — раніше
            // тут його не було, і клієнт хибно "з'їдав" енергію в UI марафонцям.
            if (!hasSkill('marathon')) state.energy = Math.max(0, state.energy - ECONOMY.INSPECTOR_ENERGY_PER_CLICK);
            const face = document.getElementById('inspector-face');
            face.classList.remove('hit');
            void face.offsetWidth;
            face.classList.add('hit');
            tg.HapticFeedback.impactOccurred('medium');
        });

        async function flushInspectorClicks() {
            if (!inspectorState || !inspectorClicks) return;
            const clicks = inspectorClicks;
            const dt = Date.now() - inspectorBatchStart;
            inspectorClicks = 0;
            inspectorBatchStart = Date.now();
            const res = await apiFetch('/api/inspector/hit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, clicks, dt }),
            });
            const data = await res.json();
            if (typeof data.energy === 'number') state.energy = data.energy;

            if (data.gone) { closeInspector(); tg.showAlert('⏰ ' + data.message); absorbHeat(data); return; }
            if (data.defeated) {
                closeInspector();
                state.balance = data.balance;
                state.trophies = data.trophies;
                if (data.resources) state.resources = data.resources;
                syncLevel(data);
                tg.HapticFeedback.notificationOccurred('success');
                const loot = (data.reward.res || []).map(r => r.emoji + ' ' + r.name + ' ×' + r.added).join(', ');
                tg.showAlert('🏆 Спекався!\\n\\n+' + fmtNum(data.reward.tk) + ' ТК' +
                    (loot ? '\\n' + loot : '') + '\\n+' + data.reward.sp + ' сезонних очок');
                if (data.unlockedAchievements) showAchievements(data.unlockedAchievements);
                renderStorage();
                updateUI();
                return;
            }
            if (data.inspector) {
                inspectorState = data.inspector;
                renderInspectorBars();
            }
            // Слабкість підсвічуємо тільки коли вона реально спрацювала на сервері.
            if (data.weak !== inspectorWeakOn) {
                inspectorWeakOn = !!data.weak;
                const w = document.getElementById('inspector-weak');
                w.classList.toggle('on', inspectorWeakOn);
                if (inspectorWeakOn) w.innerText = '🎯 Слабкість спрацювала — подвійний урон!';
                else w.innerText = inspectorState && inspectorState.weaknessHint
                    ? '🎯 Слабкість: ' + inspectorState.weaknessHint : '';
            }
        }

        // Бос міг прийти, поки гра була закрита або поки ти клікав — ловимо це в
        // будь-якій відповіді сервера, а не окремим полінгом.
        function absorbInspector(data) {
            if (!data || data.inspector === undefined) return;
            if (data.inspector && !inspectorState) openInspector(data.inspector);
            // Захист від гонки: запит, надісланий ДО того, як бос з'явився, може
            // повернутись ПІСЛЯ того, як інший запит його вже відкрив — застаріла
            // відповідь без інспектора миттєво закривала щойно відкритий бій.
            // Короткий грейс-період ігнорує такі запізнілі "немає боса" відповіді.
            else if (!data.inspector && inspectorState && Date.now() - inspectorOpenedAt > 2000) closeInspector();
        }

        // ===== Спринти (робочі контракти, PATCH_2.0_SPRINTS_SPEC.md) =====
        // Вимкнено за ECONOMY.SPRINTS_V2 (false за замовчуванням) — уся плашка й
        // модалки просто лишаються hidden, старий клікер на схронах 2-8 не чіпається.
        // Тапи батчуються тим самим підходом, що й бій з інспектором: локальний
        // лічильник sprintClicks + інтервал ECONOMY.INSPECTOR_BATCH_MS, сервер лишається
        // єдиним джерелом правди щодо рядків/вигорання/QTE.
        let sprintClicks = 0;
        let sprintBatchTimer = null;
        let sprintQteShown = false;
        let sprintQteTimeout = null;

        // Плашка над артворком показується лише коли флаг увімкнений І гравець уже
        // не на схроні 1 (там лишається старий клікер, як вирішено в Р0).
        function renderSprintPlaque() {
            const plaque = document.getElementById('sprint-plaque');
            if (!plaque) return;
            const show = state.sprintsEnabled && (state.level || 1) >= 2;
            plaque.classList.toggle('hidden', !show);
            if (!show) return;
            const idle = document.getElementById('sprint-idle');
            const active = document.getElementById('sprint-active');
            if (state.sprint) {
                idle.classList.add('hidden');
                active.classList.remove('hidden');
                document.getElementById('sprint-emoji').innerText = state.sprint.emoji;
                document.getElementById('sprint-name').innerText = state.sprint.name;
                const pct = Math.max(0, Math.min(100, 100 * state.sprint.linesDone / state.sprint.linesTotal));
                document.getElementById('sprint-lines-fill').style.width = pct + '%';
                document.getElementById('sprint-lines-text').innerText =
                    Math.floor(state.sprint.linesDone) + ' / ' + state.sprint.linesTotal;
                document.getElementById('sprint-timer').innerText = fmtCountdown(state.sprint.msLeft);
                const burnPct = Math.max(0, Math.min(100, state.burnout || 0));
                const bf = document.getElementById('sprint-burnout-fill');
                bf.style.width = burnPct + '%';
                bf.classList.toggle('warn', burnPct >= (state.burnoutThreshold || 80));
                document.getElementById('sprint-burnout-text').innerText = Math.round(burnPct) + '%';
                const canClaim = state.sprint.linesDone >= state.sprint.linesTotal || state.sprint.expired;
                document.getElementById('sprint-claim-btn').disabled = !canClaim;
            } else {
                idle.classList.remove('hidden');
                active.classList.add('hidden');
            }
        }

        // Батч-таймер живе, поки є активний контракт — так само, як inspectorBatchTimer
        // живе, поки відкритий бій. Запускаємо/гасимо тут одним місцем після КОЖНОЇ
        // відповіді сервера, а не розкидаємо start/stop по кожному обробнику.
        function ensureSprintBatchTimer() {
            if (state.sprint && !sprintBatchTimer) {
                sprintBatchTimer = setInterval(flushSprintClicks, ECONOMY.INSPECTOR_BATCH_MS);
            } else if (!state.sprint && sprintBatchTimer) {
                clearInterval(sprintBatchTimer);
                sprintBatchTimer = null;
                sprintClicks = 0;
            }
        }

        // Спільна точка застосування sprintSnapshot() з БУДЬ-ЯКОЇ відповіді сервера
        // (/api/sprint, /start, /tap, /qte, /claim, /abandon мають однаковий контракт).
        function applySprintSnapshot(data) {
            if (!data) return;
            if ('sprint' in data) state.sprint = data.sprint;
            if (typeof data.burnout === 'number') state.burnout = data.burnout;
            if (typeof data.burnoutMax === 'number') state.burnoutMax = data.burnoutMax;
            if (typeof data.burnoutThreshold === 'number') state.burnoutThreshold = data.burnoutThreshold;
            if (typeof data.focusStat === 'number') state.focusStat = data.focusStat;
            if (Array.isArray(data.tiers)) state.sprintTiers = data.tiers;
            renderSprintPlaque();
            ensureSprintBatchTimer();
            if (state.sprint && state.sprint.qte) showSprintQte(state.sprint.qte);
            else hideSprintQte();
        }

        async function flushSprintClicks() {
            if (!state.sprint || !sprintClicks) return;
            const clicks = sprintClicks;
            sprintClicks = 0;
            try {
                const res = await apiFetch('/api/sprint/tap', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, clicks }),
                });
                const data = await res.json();
                if (!data.success) { applySprintSnapshot(data); return; }
                applySprintSnapshot(data);
                if (data.qte) { tg.HapticFeedback.notificationOccurred('warning'); }
                if (data.done) { tg.HapticFeedback.notificationOccurred('success'); }
            } catch (e) { /* наступний батч спробує ще раз */ }
        }

        // QTE "Баги в коді" — іконка з'являється у випадковій точці в межах САМОЇ зони
        // артворку (.clickable), не всього екрана, з таймером-кільцем на qte.ms.
        function showSprintQte(qte) {
            if (sprintQteShown) return;
            sprintQteShown = true;
            const zone = document.getElementById('clicker');
            const icon = document.getElementById('sprint-qte-icon');
            const rect = zone.getBoundingClientRect();
            const pad = 32;
            const w = Math.max(1, rect.width - pad * 2);
            const h = Math.max(1, rect.height - pad * 2);
            icon.style.left = (pad + Math.random() * w) + 'px';
            icon.style.top = (pad + Math.random() * h) + 'px';
            icon.classList.remove('hidden');
            const remaining = Math.max(200, qte.ms - (Date.now() - qte.at));
            const ring = document.getElementById('sprint-qte-ring');
            ring.style.animation = 'none';
            void ring.offsetWidth;
            ring.style.animation = 'sprintQteRing ' + remaining + 'ms linear forwards';
            if (sprintQteTimeout) clearTimeout(sprintQteTimeout);
            // Не встиг — просто ховаємо іконку локально. Прострочення сам зарахує
            // сервер при наступному дотику до спринту (tap/claim/abandon), той самий
            // контракт, що вже описаний у routes/sprints.js — клієнт нічого не вигадує.
            sprintQteTimeout = setTimeout(hideSprintQte, remaining);
        }
        function hideSprintQte() {
            sprintQteShown = false;
            if (sprintQteTimeout) { clearTimeout(sprintQteTimeout); sprintQteTimeout = null; }
            const icon = document.getElementById('sprint-qte-icon');
            if (icon) icon.classList.add('hidden');
        }
        window.hitSprintQte = async (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (!sprintQteShown) return;
            hideSprintQte();
            try {
                const res = await apiFetch('/api/sprint/qte', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, hit: true }),
                });
                const data = await res.json();
                applySprintSnapshot(data);
                tg.HapticFeedback.notificationOccurred(data.hit ? 'success' : 'error');
            } catch (e2) { /* наступний tap все одно синхронізує стан */ }
        };

        window.openSprintTierPicker = async () => {
            try {
                const res = await apiFetch('/api/sprint?id=' + user.id);
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Спринти поки недоступні');
                applySprintSnapshot(data);
                renderSprintTiers(state.sprintTiers);
                document.getElementById('sprint-tier-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося завантажити контракти'); }
        };
        window.closeSprintTierPicker = () => document.getElementById('sprint-tier-screen').classList.add('hidden');

        function renderSprintTiers(tiers) {
            const list = document.getElementById('sprint-tiers-list');
            if (!list) return;
            list.innerHTML = (tiers || []).map((t) => {
                const drop = (t.dropTable || []).map((d) => {
                    const meta = RESOURCE_BY_ID[d.res];
                    if (!meta) return '';
                    return meta.emoji + ' ' + meta.name + ' ×' + d.qty + (d.chance < 1 ? ' (' + Math.round(d.chance * 100) + '%)' : '');
                }).join(', ');
                return '<div class="sprint-tier-card' + (t.locked ? ' locked' : '') + '">' +
                    '<div class="sprint-tier-head"><span>' + t.emoji + ' ' + esc(t.name) + '</span>' +
                    (t.locked ? '<span class="sprint-tier-lock">🔒 Потрібен ' + t.minLevel + ' рівень схрону</span>' : '') +
                    '</div>' +
                    '<div class="sprint-tier-desc">' + esc(t.desc) + '</div>' +
                    '<div class="sprint-tier-stats">⚡ ' + t.energyCost + ' · ⌨️ ' + t.taps + ' тапів · ⏱ ' +
                        t.deadlineMin + ' хв · до ' + fmtNum(t.payout) + ' 🪙</div>' +
                    '<div class="sprint-tier-drop">Дроп: ' + (drop || '—') + '</div>' +
                    '<button' + (t.locked ? ' disabled' : '') + ' onclick="startSprint(\\'' + t.id + '\\')">Взяти контракт</button>' +
                '</div>';
            }).join('');
        }

        window.startSprint = async (tierId) => {
            try {
                const res = await apiFetch('/api/sprint/start', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, tier: tierId }),
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Не вдалося почати контракт');
                if (typeof data.energy === 'number') state.energy = data.energy;
                applySprintSnapshot(data);
                closeSprintTierPicker();
                tg.HapticFeedback.notificationOccurred('success');
                updateUI();
            } catch (e) { tg.showAlert('Не вдалося почати контракт'); }
        };

        window.claimSprint = async () => {
            try {
                const res = await apiFetch('/api/sprint/claim', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id }),
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Контракт ще не закритий');
                if (typeof data.balance === 'number') state.balance = data.balance;
                if (data.resources) state.resources = data.resources;
                applySprintSnapshot(data);
                showSprintResult(data);
                tg.HapticFeedback.notificationOccurred('success');
                renderStorage();
                updateUI();
            } catch (e) { tg.showAlert('Не вдалося здати контракт'); }
        };

        window.abandonSprint = () => {
            // Втрата прогресу й енергії входу — незворотна дія, питаємо підтвердження
            // так само, як і перед "здати сусіда".
            tg.showConfirm('Кинути контракт? Весь прогрес і витрачена на вхід енергія згорять.', async (ok) => {
                if (!ok) return;
                try {
                    const res = await apiFetch('/api/sprint/abandon', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: user.id }),
                    });
                    const data = await res.json();
                    applySprintSnapshot(data);
                } catch (e) { /* нехай наступний GET /api/sprint підхопить реальний стан */ }
            });
        };

        function showSprintResult(data) {
            const title = data.done ? '✅ Контракт здано' : '⏰ Здано по дедлайну (не все дописано)';
            const resLines = (data.reward.res || []).map((r) =>
                r.emoji + ' ' + esc(r.name) + ' ×' + r.added +
                (r.lost ? ' <span style="color:#ff8a8a;">(втрачено ' + r.lost + ' — кладовка повна)</span>' : '')
            ).join('<br>');
            document.getElementById('sprint-result-body').innerHTML =
                '<div class="sprint-result-title">' + title + '</div>' +
                '<div class="sprint-result-tk">+' + fmtNum(data.reward.tk) + ' 🪙</div>' +
                (resLines ? '<div class="sprint-result-res">' + resLines + '</div>' : '') +
                (data.missedQte ? '<div class="sprint-result-note">🐛 Пропущено багів: ' + data.missedQte + ' (штраф до нагороди вже враховано)</div>' : '');
            document.getElementById('sprint-result-overlay').classList.remove('hidden');
        }
        window.closeSprintResult = () => document.getElementById('sprint-result-overlay').classList.add('hidden');

        // Дедлайн-таймер: окремий секундний інтервал, а не гарячий 100мс-цикл —
        // той самий підхід, що й таймери повісток нижче.
        setInterval(() => {
            if (!state.sprint) return;
            state.sprint.msLeft = Math.max(0, state.sprint.deadline - Date.now());
            state.sprint.expired = state.sprint.msLeft <= 0;
            const timerEl = document.getElementById('sprint-timer');
            if (timerEl) timerEl.innerText = fmtCountdown(state.sprint.msLeft);
            const claimBtn = document.getElementById('sprint-claim-btn');
            if (claimBtn) claimBtn.disabled = !(state.sprint.linesDone >= state.sprint.linesTotal || state.sprint.expired);
        }, 1000);

        // ===== PvP: "Здати сусіда" =====
        // Порівняння профілів. Тап по гравцю в лідерборді — єдина точка входу
        // в стук: спершу бачиш, з ким маєш справу, і лише потім тиснеш кнопку.
        let profileTarget = null;
        let investigationSuspects = [];

        window.openProfile = async (pid) => {
            try {
                const res = await apiFetch('/api/profile?id=' + user.id + '&pid=' + encodeURIComponent(pid));
                if (!res.ok) return tg.showAlert('Не вдалося відкрити профіль');
                const data = await res.json();
                profileTarget = { pid, name: data.other.name, snitch: data.snitch };
                renderProfile(data);
                document.getElementById('profile-overlay').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити профіль'); }
        };
        window.closeProfile = () => {
            document.getElementById('profile-overlay').classList.add('hidden');
            profileTarget = null;
        };

        function renderProfile(data) {
            const me = data.me, them = data.other;
            const rows = [
                ['Схрон', me.level, them.level, 'high'],
                ['Баланс', fmtNum(me.balance), fmtNum(them.balance), null],
                ['Розшук', Math.round(me.heat), Math.round(them.heat), null],
                ['Довідок', me.prestigePoints, them.prestigePoints, 'high'],
                ['Кліків', fmtNum(me.totalClicks), fmtNum(them.totalClicks), 'high'],
                ['Облав пережито', me.raidsSurvived, them.raidsSurvived, 'high'],
                ['Вилазок', me.expeditionsDone, them.expeditionsDone, 'high'],
                ['Зібрано речей', me.collected, them.collected, 'high'],
                ['Досягнень', me.achievements, them.achievements, 'high'],
            ];
            const cmp = (a, b, mode) => {
                if (mode !== 'high') return ['', ''];
                const na = Number(String(a).replace(/[^\\d.-]/g, ''));
                const nb = Number(String(b).replace(/[^\\d.-]/g, ''));
                if (!isFinite(na) || !isFinite(nb) || na === nb) return ['', ''];
                return na > nb ? [' win', ''] : ['', ' win'];
            };
            let html = '<div class="vs-name">Ти</div><div class="vs-label"></div>' +
                '<div class="vs-name them">' + esc(them.name) + (them.isVip ? ' 👑' : '') + '</div>';
            for (const [label, a, b, mode] of rows) {
                const [ca, cb] = cmp(a, b, mode);
                html += '<div class="vs-cell' + ca + '">' + a + '</div>' +
                    '<div class="vs-label">' + label + '</div>' +
                    '<div class="vs-cell' + cb + '">' + b + '</div>';
            }
            document.getElementById('profile-grid').innerHTML = html;

            const s = them.snitch || {};
            document.getElementById('profile-snitch-stats').innerHTML =
                '🐍 Здав: <b>' + (s.sent || 0) + '</b> · 🎯 Здали його: <b>' + (s.received || 0) + '</b> · 🕵️ Розкрив: <b>' + (s.caught || 0) + '</b>';

            const btn = document.getElementById('profile-snitch-btn');
            const note = document.getElementById('profile-snitch-note');
            const sn = data.snitch;
            btn.disabled = !sn.can;
            btn.innerText = sn.free ? '🐍 Здати (безкоштовно — ти йому винен)' : '🐍 Здати';
            note.innerText = sn.can
                ? (sn.free
                    ? 'Це твій безкоштовний дзвінок за хибне звинувачення.'
                    : (sn.warTarget ? '⚔️ Ворог по війні ОСББ: удвічі дешевше і +' + ECONOMY.WAR_POINTS_SNITCH + ' очок війни.\\n' : '') +
                  'Коштує ' + fmtNum(sn.costTk) + ' ТК + 📱 ліва сімка. Лишилось дзвінків сьогодні: ' + sn.left + '.')
                : sn.reason;
        }

        window.confirmSnitch = () => {
            if (!profileTarget) return;
            const t = profileTarget;
            // Незворотна дія проти живої людини — питаємо підтвердження явно.
            tg.showConfirm(
                'Здати гравця ' + t.name + '? Йому прилетить повістка на 3 години і +' +
                ECONOMY.SNITCH_HEAT + ' до розшуку. Він матиме право вирахувати тебе.',
                (ok) => { if (ok) doSnitch(t.pid); }
            );
        };

        async function doSnitch(pid) {
            const res = await apiFetch('/api/snitch', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, targetPid: pid }),
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Не вийшло');
            if (typeof data.balance === 'number') state.balance = data.balance;
            if (data.resources) state.resources = data.resources;
            if (data.snitchStats) state.snitchStats = data.snitchStats;
            if (typeof data.snitchesLeft === 'number') state.snitchesLeft = data.snitchesLeft;
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('🐍 ' + data.message);
            closeProfile();
            renderStorage();
            updateUI();
        }

        // ===== Розслідування =====
        function showRobbery(r) {
            tg.HapticFeedback.notificationOccurred('error');
            tg.showAlert('🐍 ' + r.byName + ' вирахував, що це ти на нього стукав.\\n' +
                'Моральна компенсація: −' + fmtNum(r.amount) + ' ТК');
        }

        window.openInvestigation = async () => {
            try {
                const res = await apiFetch('/api/investigation?id=' + user.id);
                renderInvestigation(await res.json());
                document.getElementById('investigation-screen').classList.remove('hidden');
            } catch (e) { tg.showAlert('Не вдалося відкрити розслідування'); }
        };
        window.closeInvestigation = () => document.getElementById('investigation-screen').classList.add('hidden');

        function renderInvestigation(data) {
            const box = document.getElementById('investigation-body');
            investigationSuspects = data.suspects || [];
            if (!data.pending) {
                state.investigationPending = false;
                box.innerHTML = '<p style="font-size:13px; color:#8fa3b8; text-align:center; padding: 18px 0;">' +
                    'Зараз розслідувати нічого. Живи спокійно.</p>';
                return;
            }
            if (data.revealed) {
                // Щур-розвідник уже все підслухав — здогадуватись не треба.
                box.innerHTML = '<p style="font-size:13px; line-height:1.55; color:#dbe6ee;">' +
                    '🐀 Щур-розвідник підслухав розмову і назвав ім\\'я одразу:</p>' +
                    '<div class="suspect-card" style="cursor:default;"><span class="suspect-face">🐍</span>' +
                    '<div><div class="suspect-name">' + esc(data.snitchName) + '</div>' +
                    '<div class="suspect-meta">Тепер ти знаєш. Що з цим робити — вирішуй сам.</div></div></div>';
                return;
            }
            box.innerHTML = '<p style="font-size:12px; color:#8fa3b8; line-height:1.5; margin: 4px 0 12px;">' +
                'Один здогад. Вгадаєш — забереш частину його балансу як моральну компенсацію. ' +
                'Помилишся — невинний образиться і отримає право на безкоштовний дзвінок уже на тебе.</p>' +
                data.suspects.map((s, i) =>
                    // Індекс, а не ім'я в onclick: чужий нік — довільний текст, і
                    // апостроф у ньому зламав би інлайн-обробник.
                    '<div class="suspect-card" onclick="guessSnitch(' + i + ')">' +
                    '<span class="suspect-face">🕴️</span><div>' +
                    '<div class="suspect-name">' + esc(s.name) + '</div>' +
                    '<div class="suspect-meta">Схрон ' + s.level + ' · здавав інших: ' + ((s.snitch || {}).sent || 0) + '</div>' +
                    '</div></div>'
                ).join('');
        }

        window.guessSnitch = (index) => {
            const s = investigationSuspects[index];
            if (!s) return;
            const pid = s.pid;
            const go = async () => {
                const res = await apiFetch('/api/investigation/guess', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, suspectPid: pid }),
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Не вийшло');
                state.investigationPending = false;
                if (data.snitchStats) state.snitchStats = data.snitchStats;
                if (data.trophies) state.trophies = data.trophies;
                if (data.correct) {
                    state.balance = data.balance;
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert('🕵️ Вирахував! Це був ' + data.snitchName +
                        '.\\nМоральна компенсація: +' + fmtNum(data.stolen) + ' ТК');
                } else {
                    tg.HapticFeedback.notificationOccurred('error');
                    tg.showAlert('❌ ' + data.message);
                }
                closeInvestigation();
                updateUI();
                saveState();
            };
            tg.showConfirm('Звинуватити ' + s.name + '? Здогад лише один.', (ok) => { if (ok) go(); });
        };

        // ===== Резервна копія в Telegram CloudStorage =====
        // Диск сервера на Render скидається при кожному редеплої — CloudStorage лежить у
        // самому Telegram і переживає це. Не заміна серверного збереження, а страховка від
        // втрати прогресу друзів, поки проєкт не переїхав на постійне сховище (БД).
        function hasCloudStorage() {
            return !!(tg && tg.CloudStorage && typeof tg.CloudStorage.setItem === 'function');
        }

        function saveToCloud() {
            if (!hasCloudStorage()) return;
            const backup = {
                balance: state.balance, clickVal: state.clickVal, passive: state.passive,
                level: state.level, energy: state.energy, maxEnergy: state.maxEnergy,
                totalClicks: state.totalClicks, boxesOpened: state.boxesOpened, raidsSurvived: state.raidsSurvived,
                refCount: state.refCount, dailyStreak: state.dailyStreak, isVip: state.isVip,
                achievements: state.achievements, ownedPets: state.ownedPets, petId: state.petId,
                ownedCosmetics: state.ownedCosmetics, equippedCosmetics: state.equippedCosmetics,
                ownedRoomItems: state.ownedRoomItems, equippedRoomItems: state.equippedRoomItems,
                portfolio: state.portfolio,
                // Чат ОСББ теж у бекап: інакше після редеплою гравець повертається
                // з clanId, якого вже немає на сервері, і чат просто зникає.
                clanId: state.clanId, clanName: state.clanName,
                resources: state.resources, storageLevel: state.storageLevel,
                upgrades: state.upgrades, craftedCount: state.craftedCount,
                shieldUntil: state.shieldUntil, permanentShield: state.permanentShield,
                expeditionsDone: state.expeditionsDone,
                totalEarned: state.totalEarned,
                prestigePoints: state.prestigePoints, prestigeCount: state.prestigeCount,
                // Прогрес розширення 2.0 теж має пережити скидання диска Render.
                heat: state.heat, seasonPoints: state.seasonPoints, deceivedCount: state.deceivedCount,
                deferUntil: state.deferUntil, defermentId: state.defermentId,
                defermentsTaken: state.defermentsTaken, skills: state.skills,
                reputation: state.reputation, trophies: state.trophies,
                snitchStats: state.snitchStats, medcomStats: state.medcomStats,
                checkpointStats: state.checkpointStats, noticeStats: state.noticeStats,
                inspectorStats: state.inspectorStats, pendingWarCrate: state.pendingWarCrate,
                league: state.league ? state.league.id : 0, seasonTitle: state.seasonTitle,
                mapBuildings: state.mapBuildings,
                mapPlacements: state.mapPlacements,
                upgTiersUnlocked: state.upgTiersUnlocked,
                nickname: state.nickname,
                xp: state.xp, playerLevel: state.playerLevel, ukhyr: state.ukhyr,
                // Без цього поля гравець, чий акаунт відновили з бекапу після
                // втрати серверного стану, міг би повторно погасити одноразовий
                // промокод (redeemedPromos згадувалось як відомий пробіл раніше).
                redeemedPromos: state.redeemedPromos,
            };
            try { tg.CloudStorage.setItem('save_v1', JSON.stringify(backup), () => {}); } catch (e) {}
        }

        function tryRestoreFromCloud() {
            if (!hasCloudStorage()) return Promise.resolve(false);
            return new Promise((resolve) => {
                try {
                    tg.CloudStorage.getItem('save_v1', async (err, value) => {
                        if (err || !value) return resolve(false);
                        try {
                            const backup = JSON.parse(value);
                            if (!backup || !((backup.totalClicks || 0) > 0 || (backup.balance || 0) > 0)) return resolve(false);
                            await apiFetch('/api/restore', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: user.id, backup }),
                            });
                            resolve(true);
                        } catch (e) { resolve(false); }
                    });
                } catch (e) { resolve(false); }
            });
        }

        // ===== Ініціалізація: підтягуємо збережений стан із сервера =====
        async function init() {
            document.getElementById('username').innerText = user.first_name;
            document.getElementById('ref-link').value = 'https://t.me/' + BOT_USERNAME + '?start=' + user.id;
            try {
                let res = await apiFetch('/api/user?id=' + user.id + '&name=' + encodeURIComponent(user.first_name) + '&consume=1');
                let data = await res.json();
                // "Свіжий" гравець на сервері (диск міг скинутись після редеплою) — пробуємо
                // підтягнути резервну копію з CloudStorage, якщо вона там є.
                const looksFresh = data.totalClicks === 0 && data.balance === 0 &&
                    (data.achievements || []).length === 0 && (data.ownedCosmetics || []).length === 0;
                if (looksFresh) {
                    const restored = await tryRestoreFromCloud();
                    if (restored) {
                        res = await apiFetch('/api/user?id=' + user.id + '&name=' + encodeURIComponent(user.first_name) + '&consume=1');
                        data = await res.json();
                        tg.showAlert('Прогрес відновлено з резервної копії Telegram!');
                    }
                }
                state.balance = data.balance; state.clickVal = data.clickVal; state.passive = data.passive;
                state.level = data.level; state.energy = data.energy; state.maxEnergy = data.maxEnergy;
                state.isVip = data.isVip; state.refCount = data.refCount;
                state.totalClicks = data.totalClicks; state.boxesOpened = data.boxesOpened; state.raidsSurvived = data.raidsSurvived;
                state.achievements = data.achievements; state.ownedPets = data.ownedPets; state.petId = data.petId;
                state.ownedCosmetics = data.ownedCosmetics || []; state.equippedCosmetics = data.equippedCosmetics || { hat: null, face: null, neck: null, frame: null };
                state.ownedRoomItems = data.ownedRoomItems || []; state.equippedRoomItems = data.equippedRoomItems || [];
                state.revengeUnlocked = data.revengeUnlocked; state.revengeClaimedToday = data.revengeClaimedToday;
                state.portfolio = data.portfolio || {}; state.clanId = data.clanId; state.clanName = data.clanName; state.clanBonus = data.clanBonus;
                state.clanLevel = data.clanLevel || 0; state.clanTreasury = data.clanTreasury || 0;
                state.clanNextLevelCost = data.clanNextLevelCost; state.clanMyContribution = data.clanMyContribution || 0;
                state.dailyStreak = data.dailyStreak; state.wheelClaimedToday = data.wheelClaimedToday;
                // Кладовка / крафт / багаторівневі апгрейди
                state.resources = data.resources || {};
                state.storageLevel = data.storageLevel || 0;
                state.storageCapacity = data.storageCapacity || 0;
                state.storageUsed = data.storageUsed || 0;
                state.storageUpgradeCost = data.storageUpgradeCost;
                state.upgrades = data.upgrades || { hat: 0, jam: 0, thermos: 0, generator: 0 };
                state.upgradeCosts = data.upgradeCosts || {};
                state.upgTiersUnlocked = data.upgTiersUnlocked || { hat: 0, jam: 0, thermos: 0, generator: 0 };
                state.upgradeGates = data.upgradeGates || {};
                state.craftedCount = data.craftedCount || 0;
                state.shieldUntil = data.shieldUntil || 0;
                state.permanentShield = !!data.permanentShield;
                absorbExpeditions(data);
                state.expeditionsDone = data.expeditionsDone || 0;
                state.dailyDeal = data.dailyDeal || null;
                state.totalEarned = data.totalEarned || 0;
                state.prestigePoints = data.prestigePoints || 0;
                state.prestigeCount = data.prestigeCount || 0;
                state.prestigeMultiplier = data.prestigeMultiplier || 1;
                state.prestigeAvailable = data.prestigeAvailable || 0;
                state.seasonPoints = data.seasonPoints || 0;
                state.pid = data.pid || null;
                state.skills = data.skills || {};
                state.skillPoints = data.skillPoints || 0;
                state.reputation = data.reputation || {};
                state.mykolaCoverUsed = !!data.mykolaCoverUsed;
                state.adAirdropMult = data.adAirdropMult || 1;
                state.adConsentCount = data.adConsentCount || 0;
                state.league = data.league || null;
                state.seasonTitle = data.seasonTitle || null;
                state.seasonEndsAt = data.seasonEndsAt || 0;
                state.pendingWarCrate = data.pendingWarCrate || 0;
                state.grannyUntil = data.grannyUntil || 0;
                state.snitchStats = data.snitchStats || null;
                state.snitchesLeft = typeof data.snitchesLeft === 'number' ? data.snitchesLeft : ECONOMY.SNITCH_DAILY_LIMIT;
                state.investigationPending = !!data.investigationPending;
                state.trophies = data.trophies || [];
                state.mapBuildings = data.mapBuildings || { tower: 0, hideout: 0, cache: 0 };
                state.mapPlacements = data.mapPlacements || { tower: null, hideout: null, cache: null };
                state.xp = data.xp || 0;
                state.playerLevel = data.playerLevel || 1;
                state.ukhyr = data.ukhyr || 0;
                state.memoryGame = data.memoryGame || null;
                state.sprintsEnabled = !!data.sprintsEnabled;
                applyLevelGates();
                state.nickname = data.nickname || null;
                document.getElementById('username').innerText = state.nickname || user.first_name;
                if (data.nextStep) renderNextStep(data.nextStep);
                state.medcomStats = data.medcomStats || null;
                state.inspectorStats = data.inspectorStats || null;
                state.checkpointStats = data.checkpointStats || null;
                state.defermentsTaken = data.defermentsTaken || 0;
                state.deferUntil = data.deferUntil || 0;
                state.defermentId = data.defermentId || null;
                state.deferments = data.deferments || [];
                absorbHeat(data);
                absorbInspector(data);
                // Поки тебе не було, хтось вирахував твій стук і забрав компенсацію.
                if (data.robbery) showRobbery(data.robbery);

                if (data.lastPremiumReward) {
                    // Ящик за Stars розкривався на сервері — програємо анімацію одразу на вході.
                    playCrateAnimation(data.lastPremiumReward, data.lastPremiumReward.crateId || 'elite');
                } else if (data.seasonResult) {
                    // Підсумки сезону важливіші за офлайн-звіт: це разова подія тижня.
                    showSeasonResult(data.seasonResult);
                } else if (data.offlineReport) {
                    // Був довгий перерив і щось справді сталось — показуємо повний звіт
                    // замість самої лише цифри доходу.
                    showOfflineReport(data.offlineReport);
                } else if (data.offlineEarnings > 0) {
                    showGachaModal('Поки тебе не було...', '/images/gacha-jackpot.webp', 'Ти тихо відсидівся і заробив +' + fmtNum(data.offlineEarnings) + ' ТК!');
                }
            } catch (e) {
                console.error('Не вдалося завантажити стан гравця', e);
            }
            // Спринти: підтягуємо активний контракт (якщо є) одразу на вході — інакше
            // після перезаходу плашка показала б IDLE, хоча контракт усе ще йде.
            if (state.sprintsEnabled && (state.level || 1) >= 2) {
                try {
                    const sres = await apiFetch('/api/sprint?id=' + user.id);
                    const sdata = await sres.json();
                    if (sdata.success) applySprintSnapshot(sdata);
                } catch (e) { /* плашка просто лишиться в IDLE */ }
            }
            // Курс біржі потрібен ще й кладовці (ціна здачі ресурсів), тому тягнемо
            // його одразу на старті, а не лише при відкритті вкладки біржі.
            try {
                const mres = await apiFetch('/api/market');
                state.marketPrices = (await mres.json()).prices;
            } catch (e) { /* не критично — покажемо базові ціни */ }
            updateUI();
            renderOwnedStuff();
            renderAchievements();
            renderWheel();
            const splash = document.getElementById('splash-screen');
            if (splash) {
                // Вступне відео ~5с — тримаємо заставку мінімум стільки, щоб воно
                // встигло догратись, а не зникло на середині через швидке
                // завантаження стану гравця.
                setTimeout(() => {
                    splash.style.opacity = '0';
                    setTimeout(() => splash.remove(), 400);
                }, 5100);
            }
            maybeShowDisclaimerOnFirstRun();
        }
        init();

        function saveState() {
            saveToCloud();
            // Запам'ятовуємо, ЩО САМЕ ми відправили: якщо сервер відхилить баланс,
            // усе наклікане після цього моменту треба буде перенести на його цифру,
            // а не викинути.
            const sentBalance = state.balance;
            apiFetch('/api/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id, name: user.first_name, balance: sentBalance,
                    balanceRev: state.balanceRev,
                    clickVal: state.clickVal, passive: state.passive, level: state.level,
                    energy: state.energy, maxEnergy: state.maxEnergy,
                    totalClicks: state.totalClicks, boxesOpened: state.boxesOpened, raidsSurvived: state.raidsSurvived,
                })
            }).then(r => r.json()).then(data => {
                // Повістка могла прийти або протухнути, поки гравець грав — автозбереження
                // раз на 5с і є каналом, яким він про це дізнається.
                const hadNotices = (state.notices || []).length;
                absorbHeat(data);
                if ((state.notices || []).length > hadNotices) {
                    tg.HapticFeedback.notificationOccurred('warning');
                }
                if (typeof data.snitchesLeft === 'number') state.snitchesLeft = data.snitchesLeft;
                if (typeof data.investigationPending === 'boolean') state.investigationPending = data.investigationPending;
                if (typeof data.deferUntil === 'number') state.deferUntil = data.deferUntil;
                // Сервер міг обрізати силу кліку/пасив до того, що реально видав.
                if (typeof data.clickVal === 'number') state.clickVal = data.clickVal;
                if (typeof data.passive === 'number') state.passive = data.passive;
                absorbInspector(data);
                // Крадіжку сервер віддає рівно один раз — інакше гравець побачив би
                // лише тихий відкат балансу і вирішив, що це баг.
                if (data.robbery) {
                    state.balance = data.balance;
                    showRobbery(data.robbery);
                }
                // Сервер відхилив наш баланс — значить він змінював його сам (ящик,
                // крафт, апгрейд, досягнення), поки ми не встигли синхронізуватись.
                // Просто взяти його цифру НЕ МОЖНА: усе, що гравець наклікав за ці
                // 5 секунд, зникло б — саме через це прогрес «іноді не зараховувався».
                // Тому переносимо свій приріст (те, що набігло після відправки) на
                // авторитетний баланс сервера.
                if (data.balanceRejected && typeof data.balance === 'number') {
                    const earnedSinceSend = Math.max(0, state.balance - sentBalance);
                    state.balance = data.balance + earnedSinceSend;
                    updateUI();
                }
                if (typeof data.balanceRev === 'number') state.balanceRev = data.balanceRev;
                if (data.unlockedAchievements && data.unlockedAchievements.length) {
                    state.balance = data.balance;
                    data.unlockedAchievements.forEach(a => { state.achievements.push(a.id); });
                    tg.showAlert('🏅 Досягнення: ' + data.unlockedAchievements.map(a => a.name + ' (+' + a.reward + ' ТК)').join(', '));
                    renderAchievements();
                    updateUI();
                }
                if (data.nextStep) renderNextStep(data.nextStep);
                syncLevel(data);
            }).catch(() => {});
        }

        // "Наступний крок" — один рядок під шапкою, куди йти прямо зараз (журнал v2.0, §7).
        function renderNextStep(step) {
            state.nextStep = step;
            const el = document.getElementById('next-step');
            if (!step) { el.classList.add('hidden'); return; }
            el.classList.remove('hidden');
            el.innerHTML = step.icon + ' ' + esc(step.text) + ' →';
        }
        window.openNicknameEditor = () => {
            document.getElementById('nickname-input').value = state.nickname || '';
            document.getElementById('nickname-error').innerText = '';
            document.getElementById('nickname-screen').classList.remove('hidden');
        };
        window.closeNicknameEditor = () => document.getElementById('nickname-screen').classList.add('hidden');
        window.saveNickname = async () => {
            const nickname = document.getElementById('nickname-input').value.trim();
            const errEl = document.getElementById('nickname-error');
            // Перший нік — безкоштовно. Якщо вже стоїть — сервер відмовить із paid:true,
            // і йдемо платним флоу (той самий інвойс-патерн, що донат/VIP/ящики за ⭐).
            const res = await apiFetch('/api/nickname/set', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, nickname })
            });
            const data = await res.json();
            if (data.success) {
                state.nickname = data.nickname;
                document.getElementById('username').innerText = state.nickname;
                closeNicknameEditor();
                tg.HapticFeedback.notificationOccurred('success');
                return;
            }
            if (!data.paid) { errEl.innerText = data.message || 'Помилка'; return; }
            // Платна зміна: спершу резервуємо бажаний нік, тоді відкриваємо інвойс.
            const reqRes = await apiFetch('/api/nickname/requestChange', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, nickname })
            });
            const reqData = await reqRes.json();
            if (!reqData.success) { errEl.innerText = reqData.message || 'Помилка'; return; }
            errEl.style.color = '#8fa3b8';
            errEl.innerText = 'Відкриваю оплату (' + reqData.price + ' ⭐)...';
            try {
                const invRes = await apiFetch('/api/invoice', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, type: 'nickname_change' })
                });
                const invData = await invRes.json();
                if (!invData.link) { errEl.innerText = 'Не вдалося створити оплату'; return; }
                tg.openInvoice(invData.link, (status) => {
                    if (status === 'paid') {
                        state.nickname = nickname;
                        document.getElementById('username').innerText = nickname;
                        closeNicknameEditor();
                        tg.HapticFeedback.notificationOccurred('success');
                    }
                });
            } catch (e) { errEl.innerText = 'Помилка оплати'; }
        };

        window.goNextStep = () => {
            const step = state.nextStep;
            if (!step) return;
            if (step.tab === 'heatcase') { openHeatCase(); return; }
            const btn = document.querySelector('.tab[onclick*="\\'' + step.tab + '\\'"]') ||
                document.querySelector('.tab[onclick*="' + step.tab + '"]');
            if (btn) switchTab({ currentTarget: btn }, step.tab);
        };

        // ===== Основний клік =====
        ui.clk.addEventListener('touchstart', handleMainClick, { passive: false });
        ui.clk.addEventListener('mousedown', handleMainClick);

        function handleMainClick(e) {
            e.preventDefault();
            // Спринти (схрони 2-8, ECONOMY.SPRINTS_V2): артворк повністю замінює старий
            // клік, тапи йдуть батчами на сервер (той самий підхід, що й бій з інспектором),
            // сам сервер лишається авторитетним щодо рядків/вигорання. Без активного
            // контракту клік по артворку тут нічого не робить — вхід лише через плашку.
            if (state.sprintsEnabled && (state.level || 1) >= 2) {
                if (state.sprint) {
                    sprintClicks++;
                    tg.HapticFeedback.impactOccurred('light');
                    pulseFrame();
                }
                return;
            }
            // "Вручення в руки" забирає пів години — весь цей час клікати нічим.
            if (energyLocked()) {
                tg.HapticFeedback.notificationOccurred('error');
                return;
            }
            // Саме < вартості кліку, а не <= 0: клік коштує 2, а енергія тіче назад
            // по 0.1 за тік, тому рівно нуля вона майже ніколи не має. З перевіркою
            // на нуль можна було тапати з повним доходом на порожньому баку.
            if (!state.isVip && state.energy < clickEnergyCost()) {
                tg.HapticFeedback.notificationOccurred('error');
                return;
            }
            let earned = state.clickVal * heatIncomeMult() * petMult('click') * (state.isVip ? 3 : 1)
                * (state.prestigeMultiplier || 1) * skillClickMult();
            state.balance += earned;
            state.totalClicks += 1;
            if (!state.isVip) state.energy = Math.max(0, state.energy - clickEnergyCost());

            let x = e.touches ? e.touches[0].clientX : e.clientX;
            let y = e.touches ? e.touches[0].clientY : e.clientY;

            showFloat(x, y, '+' + Math.round(earned));
            tg.HapticFeedback.impactOccurred('light');
            pulseFrame();
            updateUI();
        }

        function showFloat(x, y, txt) {
            const el = document.createElement('div');
            el.className = 'click-text'; el.innerText = txt;
            el.style.left = (x - 20) + 'px'; el.style.top = y + 'px';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 800);
        }

        // ===== Ігрові цикли =====
        // Енергія — головний обмежувач темпу гри. Регенерація ~1/сек (ENERGY_REGEN_PER_TICK
        // за тік у 100мс): повний бак на 100 енергії відновлюється ~100 секунд.
        setInterval(() => {
            // Єдиний порядок множників доходу: base * heat * vip * prestige * clan.
            if (state.passive > 0) state.balance += (state.passive * heatIncomeMult() * (state.isVip ? 3 : 1) * (state.prestigeMultiplier || 1) * state.clanBonus) / 10;
            if (state.energy < state.maxEnergy && !energyLocked()) {
                state.energy = Math.min(state.maxEnergy,
                    state.energy + ECONOMY.ENERGY_REGEN_PER_TICK * petMult('energy') * skillRegenMult());
            }
            updateUI();
        }, 100);

        setInterval(saveState, 5000);

        // Зворотний відлік вилазки. Навмисно окремий інтервал раз на секунду і лише коли
        // вкладка вилазок реально видима — у гарячому 100мс-циклі важкі рендери тримати не можна.
        setInterval(() => {
            if (!(state.expeditions || []).length) return;
            const panel = document.getElementById('storage-exp');
            if (panel && panel.classList.contains('active')) renderExpeditions();
        }, 1000);

        // Таймери повісток. Оновлюємо лише текст уже відрендерених елементів — повний
        // renderNotices() тут викликати не можна, він перебудовує розмітку з кнопками.
        setInterval(() => {
            const screen = document.getElementById('notices-screen');
            if (!screen || screen.classList.contains('hidden')) return;
            const now = Date.now();
            let expired = false;
            screen.querySelectorAll('.notice-timer').forEach(el => {
                const left = Number(el.dataset.expires) - now;
                if (left <= 0) { expired = true; return; }
                el.innerText = fmtCountdown(left);
                const card = el.closest('.notice-card');
                if (!card) return;
                const notice = (state.notices || []).find(n => n.uid === card.dataset.uid);
                const type = notice && NOTICE_BY_ID[notice.typeId];
                if (type) card.classList.toggle('urgent', left < type.ttlH * 3600 * 1000 * 0.2);
            });
            // Повістка протухла прямо на очах — штраф уже нарахував сервер, тягнемо
            // свіжий список, щоб картка не висіла з нулем на таймері.
            if (expired) openNotices();
        }, 1000);

        // ===== Рівень ухилянта (v2.1) — onboarding-гейт, лише ховає/показує вже
        // готові вкладки/кнопки. Нічого не блокує економічно (все й так платне) —
        // мета тільки в тому, щоб новачок не бачив одразу ВСІ механіки одразу. =====
        // Дзеркало серверної xpForLevel() — тільки для показу прогрес-бару XP, самі
        // рівні завжди рахує сервер.
        function xpForLevel(l) { return Math.round(40 * Math.pow(l, 1.5)); }
        const LEVEL_UNLOCKS = [
            { level: 2, selector: '.tab[onclick*="\\'quests\\'"]', name: '📋 Щоденні квести' },
            { level: 4, selector: '.tab[onclick*="storage-exp"]', name: '🌙 Вилазки' },
            { level: 6, selector: '.tab[onclick*="\\'market\\'"]', name: '📈 Біржа' },
            { level: 7, selector: '.tab[onclick*="\\'gacha\\'"]', name: '📦 Ящики' },
            { level: 8, selector: '.tab[onclick*="openSkills"]', name: '🌳 Навички' },
            { level: 12, selector: '.action-tile[onclick*="openMap"]', name: '🗺️ Карта території' },
            { level: 3, selector: '.tab[onclick*="\\'clan\\'"]', name: '🏘 Клани' },
        ];
        function applyLevelGates() {
            for (const u of LEVEL_UNLOCKS) {
                document.querySelectorAll(u.selector).forEach((el) => {
                    const locked = (state.playerLevel || 1) < u.level;
                    el.classList.toggle('locked', locked);
                    if (locked) el.dataset.reqLevel = u.level; else delete el.dataset.reqLevel;
                });
            }
        }
        // Спільна точка синхронізації xp/playerLevel/ukhyr із будь-якої відповіді
        // сервера, де вони є, + тост при підвищенні рівня (як unlockedAchievements).
        function syncLevel(data) {
            if (typeof data.xp === 'number') state.xp = data.xp;
            if (typeof data.ukhyr === 'number') state.ukhyr = data.ukhyr;
            if (typeof data.playerLevel !== 'number') return;
            const prevLevel = state.playerLevel;
            state.playerLevel = data.playerLevel;
            if (!data.levelsGained) return;
            applyLevelGates();
            const opened = LEVEL_UNLOCKS.filter((u) => u.level > prevLevel && u.level <= state.playerLevel);
            const openedText = opened.length ? ('\\nВідкрито: ' + opened.map((u) => u.name).join(', ')) : '';
            tg.showAlert('🎉 Рівень ' + state.playerLevel + '!' + openedText);
        }

        // ===== Навігація =====
        window.switchTab = (evt, tabId) => {
            if (evt.currentTarget.classList.contains('locked')) {
                tg.showAlert('🔒 Потрібен ' + evt.currentTarget.dataset.reqLevel + ' рівень ухилянта');
                return;
            }
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            evt.currentTarget.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            if (tabId === 'top') { loadTop(); renderAchievements(); renderStats(); renderCollection(); }
            if (tabId === 'market') loadMarket();
            if (tabId === 'clan') { renderClanMine(); loadClanList(); loadClanLeaderboard(); }
            if (tabId === 'quests') loadQuests();
            if (tabId === 'revenge') { renderRevengeTab(); renderPrestige(); }
            if (tabId === 'shop') renderUpgrades();
            if (tabId === 'gacha') renderCrates();
            if (tabId === 'storage') { renderStorage(); renderRecipes(); }
            if (tabId === 'storage-exp') renderExpeditions();
            if (tabId === 'minigames') renderMinigames();
        };

        // ===== Магазин =====
        // Апгрейди кліку/пасиву тепер багаторівневі й купуються через buyUpgrade() на сервері.
        // Енергетик — теж серверна покупка (2026-08-09, ліміт 2/5хв), не клієнтське списання.
        window.buyEnergyDrink = async () => {
            try {
                let res = await apiFetch('/api/energy/refill', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id })
                });
                let data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Не вийшло');
                state.balance = data.balance;
                state.energy = data.energy;
                tg.HapticFeedback.notificationOccurred('success');
                updateUI();
            } catch (e) { tg.showAlert('Помилка покупки'); }
        };

        // Переїзд у новий схрон — тепер серверна, валідована покупка (ціна в ТК +
        // ресурси, catalog/locations.js), а не клієнтське списання: інакше підроблене
        // /api/save з завищеним level давало б безкоштовний перехід. Можна купити
        // лише НАСТУПНИЙ рівень по черзі (не перестрибнути одразу на далекий).
        window.buyLocation = async (level) => {
            try {
                let res = await apiFetch('/api/location/buy', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, level })
                });
                let data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Не вийшло');
                state.balance = data.balance;
                if (typeof data.level === 'number') state.level = data.level;
                if (typeof data.maxEnergy === 'number') state.maxEnergy = data.maxEnergy;
                if (typeof data.energy === 'number') state.energy = data.energy;
                if (data.resources) { state.resources = data.resources; state.storageUsed = data.used; }
                syncLevel(data);
                if (data.unlockedAchievements) showAchievements(data.unlockedAchievements);
                tg.HapticFeedback.notificationOccurred('success');
                updateUI();
                renderLocationShop();
                // Переїзд — це подія, а не транзакція: на виїзді стоїть блокпост.
                // Локація вже куплена, блокпост впливає лише на "ціну переїзду".
                const loc = LOCATIONS.find((l) => l.level === level);
                if (loc && loc.lore) {
                    tg.showAlert(loc.lore, () => openCheckpoint());
                } else {
                    openCheckpoint();
                }
            } catch (e) { tg.showAlert('Помилка переїзду'); }
        };

        // Картки локацій виглядають так само, як картки компаньйонів (.pet-card) —
        // фон гри тепер сам по собі фонова картинка, тож ці картки додатково несуть
        // ту саму картинку локації як власний фон, а не дрібну btn-icon-мініатюру.
        function renderLocationShop() {
            const list = document.getElementById('location-shop-list');
            if (!list) return;
            list.innerHTML = LOCATIONS.filter(l => l.level > 1).map(loc => {
                const bg = ' style="background-image:url(\\'' + loc.img + '\\')"';
                if (loc.level <= state.level) {
                    return '<div class="pet-card equipped"' + bg + '>' +
                        '<div class="pet-title">✅ ' + loc.name + '</div>' +
                        '<div class="pet-desc">Рівень ' + loc.level + ' — вже тут</div></div>';
                }
                if (loc.level > state.level + 1) {
                    // Ще не наступний по черзі — не зникає, лишається видимим і затемненим
                    // з замочком (той самий підхід, що LEVEL_UNLOCKS/.locked для вкладок).
                    return '<div class="pet-card locked"' + bg + '>' +
                        '<div class="pet-title">' + loc.name + '</div>' +
                        '<div class="pet-desc">Рівень ' + loc.level + ' — спочатку попередній</div></div>';
                }
                const resText = loc.resCost ? Object.entries(loc.resCost).map(([id, n]) => {
                    const have = (state.resources || {})[id] || 0;
                    const meta = RESOURCE_BY_ID[id];
                    return '<span style="color:' + (have >= n ? '#b9ffb0' : '#ff8a8a') + '">' + meta.emoji + n + '</span>';
                }).join(' ') : '';
                return '<div class="pet-card"' + bg + '>' +
                    '<div class="pet-title">' + loc.name + '</div>' +
                    '<div class="pet-desc">Рівень ' + loc.level + ' · ' + fmtNum(loc.price || 0) + ' 🪙 ' + resText + '</div>' +
                    '<button onclick="buyLocation(' + loc.level + ')">Переїхати</button></div>';
            }).join('');
        }

        // ===== Компаньйони =====
        function renderPets() {
            const list = document.getElementById('pets-list');
            if (!list) return;
            list.innerHTML = PETS.map(p => {
                const owned = state.ownedPets.includes(p.id);
                const equipped = state.petId === p.id;
                const btn = !owned
                    ? '<button onclick="buyPet(\\'' + p.id + '\\')">Купити за ' + p.price + ' 🪙</button>'
                    : equipped
                        ? '<button onclick="equipPet(null)">Зняти</button>'
                        : '<button onclick="equipPet(\\'' + p.id + '\\')">Екіпірувати</button>';
                const bgStyle = p.bg ? ' style="background-image:url(\\'' + p.bg + '\\')"' : '';
                return '<div class="pet-card' + (equipped ? ' equipped' : '') + '"' + bgStyle + '>' +
                    '<div class="pet-title">' + p.name + (equipped ? ' (активний)' : '') + '</div>' +
                    '<div class="pet-desc">' + p.desc + '</div>' + btn + '</div>';
            }).join('');
        }

        window.buyPet = async (petId) => {
            const res = await apiFetch('/api/pet/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, petId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance; state.ownedPets = data.ownedPets;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderPets();
        };

        window.equipPet = async (petId) => {
            const res = await apiFetch('/api/pet/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, petId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.petId = data.petId;
            updateUI();
            renderPets();
        };

        // ===== Гардероб (косметика) =====
        // Рамка світиться статично, поки стоїш; анімація (веселка/сирена) вмикається лише
        // на короткий момент кліку через pulseFrame() — щоб не "грала" постійно.
        function renderCharacterOverlay(imgEl, emojiEl, hatEl, faceEl, neckEl) {
            const hatItem = COSMETICS.find(c => c.id === state.equippedCosmetics.hat);
            const faceItem = COSMETICS.find(c => c.id === state.equippedCosmetics.face);
            const neckItem = COSMETICS.find(c => c.id === state.equippedCosmetics.neck);
            const frameItem = COSMETICS.find(c => c.id === state.equippedCosmetics.frame);
            const setOverlay = (el, item) => {
                if (!item) return;
                el.innerHTML = item.img ? '<img src="' + item.img + '" style="width:100%;height:100%;object-fit:contain;">' : item.emoji;
            };
            hatEl.classList.toggle('hidden', !hatItem);
            setOverlay(hatEl, hatItem);
            faceEl.classList.toggle('hidden', !faceItem);
            setOverlay(faceEl, faceItem);
            neckEl.classList.toggle('hidden', !neckItem);
            setOverlay(neckEl, neckItem);

            // Класи анімації (frame-rainbow/frame-siren) сюди навмисно не чіпаємо —
            // ними керує виключно pulseFrame(), бо updateUI() (а отже і ця функція)
            // викликається кожні 100мс і миттєво гасила б щойно запущену анімацію.
            let staticColor = null;
            if (frameItem) staticColor = frameItem.color === 'rainbow' ? '#ffd700' : (frameItem.color === 'siren' ? '#ff1744' : frameItem.color);
            imgEl.style.boxShadow = staticColor ? ('0 0 0 4px ' + staticColor + ', 0 0 25px 6px ' + staticColor + '88') : 'none';
            emojiEl.style.textShadow = staticColor ? ('0 0 20px ' + staticColor) : 'none';
        }

        // Гардероб більше НЕ показується на кнопці-клікері (там тепер значка ТЦК,
        // не персонаж) — тільки в "Кімнаті", де й лишається сенс кастомізації.
        function applyCosmeticOverlay() {
            if (!document.getElementById('room-screen').classList.contains('hidden')) {
                renderCharacterOverlay(document.getElementById('room-bg-img'), document.getElementById('room-emoji-fallback'), document.getElementById('room-cosmetic-hat'), document.getElementById('room-cosmetic-face'), document.getElementById('room-cosmetic-neck'));
            }
        }

        function pulseFrame() {
            const frameItem = COSMETICS.find(c => c.id === state.equippedCosmetics.frame);
            if (!frameItem) return;
            const cls = frameItem.color === 'rainbow' ? 'frame-rainbow' : (frameItem.color === 'siren' ? 'frame-siren' : null);
            if (!cls) return;
            const targets = [ui.clkImg, ui.clkEmoji];
            if (!document.getElementById('room-screen').classList.contains('hidden')) {
                targets.push(document.getElementById('room-bg-img'), document.getElementById('room-emoji-fallback'));
            }
            targets.forEach(el => el.classList.add(cls));
            clearTimeout(window.__framePulseTimer);
            window.__framePulseTimer = setTimeout(() => targets.forEach(el => el.classList.remove(cls)), 550);
        }

        // ===== Кімната (велика превʼю-локація + декор) =====
        window.openRoom = () => {
            // Вкладка "Персонаж" — тільки він, без фону локації (той тепер належить
            // окремій, поки заблокованій кнопці "Кімната"). Фон/emoji-заглушку
            // просто не показуємо, персонаж лишається сам на собі.
            document.getElementById('room-bg-img').classList.add('hidden');
            document.getElementById('room-emoji-fallback').classList.add('hidden');
            document.getElementById('room-screen').classList.remove('hidden');
            renderCosmetics();
            renderRoomItems();
            renderRoomItemsOverlay();
            applyCosmeticOverlay();
        };

        window.closeRoom = () => {
            document.getElementById('room-screen').classList.add('hidden');
        };

        window.switchRoomTab = (evt, tabId) => {
            const container = document.getElementById('room-screen');
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            evt.currentTarget.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            if (tabId === 'room-wardrobe') renderCosmetics();
            if (tabId === 'room-shop') renderRoomItems();
        };

        // ===== Карта території: захисні споруди + орієнтири-посилання на вилазки =====
        window.openMap = () => {
            const tile = document.querySelector('.action-tile[onclick*="openMap"]');
            if (tile && tile.classList.contains('locked')) {
                tg.showAlert('🔒 Потрібен ' + tile.dataset.reqLevel + ' рівень ухилянта');
                return;
            }
            document.getElementById('map-screen').classList.remove('hidden');
            renderMapBuildings();
            renderMapMarkers();
        };
        window.closeMap = () => {
            document.getElementById('map-screen').classList.add('hidden');
            placingBuildingId = null;
            document.getElementById('map-img-wrap').classList.remove('placing');
            document.getElementById('map-place-hint').classList.add('hidden');
        };

        // Вільне розміщення: гравець сам обирає, де на карті стоїть іконка вже
        // збудованої споруди. Одна позиція на тип будівлі, суто візуально — ефекти
        // йдуть від рівня в mapBuildings, не від координат.
        let placingBuildingId = null;
        window.startPlacingBuilding = (buildingId) => {
            placingBuildingId = buildingId;
            document.getElementById('map-img-wrap').classList.add('placing');
            document.getElementById('map-place-hint').classList.remove('hidden');
        };
        window.onMapImgClick = async (evt) => {
            if (!placingBuildingId) return;
            const wrap = document.getElementById('map-img-wrap');
            const rect = wrap.getBoundingClientRect();
            const x = Math.max(0, Math.min(100, ((evt.clientX - rect.left) / rect.width) * 100));
            const y = Math.max(0, Math.min(100, ((evt.clientY - rect.top) / rect.height) * 100));
            const buildingId = placingBuildingId;
            placingBuildingId = null;
            wrap.classList.remove('placing');
            document.getElementById('map-place-hint').classList.add('hidden');
            const res = await apiFetch('/api/map/place', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, buildingId, x, y })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.mapPlacements = data.mapPlacements;
            tg.HapticFeedback.notificationOccurred('success');
            renderMapMarkers();
        };
        function renderMapMarkers() {
            const box = document.getElementById('map-markers');
            if (!box) return;
            box.innerHTML = MAP_BUILDINGS.map(b => {
                const p = state.mapPlacements && state.mapPlacements[b.id];
                const level = (state.mapBuildings && state.mapBuildings[b.id]) || 0;
                if (!p || !level) return '';
                return '<div class="map-marker" style="top:' + p.y + '%; left:' + p.x + '%; background-image:url(\\'' + b.img + '\\');" title="' + esc(b.name) + '"></div>';
            }).join('');
        }

        // Орієнтир на карті веде прямо до відповідної вилазки — це і є прив'язка
        // карти до вилазок, яку просив користувач.
        window.jumpToExpedition = (expeditionId) => {
            closeMap();
            const expTab = document.querySelector('.tab[onclick*="storage-exp"]');
            if (expTab) switchTab({ currentTarget: expTab }, 'storage-exp');
        };

        function renderMapBuildings() {
            const list = document.getElementById('map-buildings-list');
            if (!list) return;
            list.innerHTML = MAP_BUILDINGS.map(b => {
                const level = (state.mapBuildings && state.mapBuildings[b.id]) || 0;
                const maxed = level >= b.levels.length;
                const next = maxed ? null : b.levels[level];
                const effectKey = Object.keys(b.levels[0]).find(k => k !== 'cost');
                const fmtEffect = (eff) => Math.round(eff[effectKey] * 100) + '%';
                const costStr = next ? Object.entries(next.cost)
                    .map(([r, q]) => (RESOURCE_BY_ID[r] ? RESOURCE_BY_ID[r].emoji + ' ' + RESOURCE_BY_ID[r].name : r) + ' ×' + q)
                    .join(', ') : '';
                return '<div class="recipe-card">' +
                    '<div class="recipe-title">' + b.emoji + ' ' + esc(b.name) + ' — рівень ' + level + '/' + b.levels.length + '</div>' +
                    '<div class="recipe-desc">' + esc(b.desc) +
                        (level > 0 ? '<br>Зараз: ' + fmtEffect(b.levels[level - 1]) : '') +
                        (next ? '<br>Наступний рівень: ' + fmtEffect(next) : '') + '</div>' +
                    (maxed
                        ? '<div class="recipe-cost"><span class="recipe-ing ok">Максимальний рівень</span></div>'
                        : '<div class="recipe-cost"><span class="recipe-ing">' + costStr + '</span></div>' +
                          '<button onclick="buildMapBuilding(\\'' + b.id + '\\')">🔨 ' + (level > 0 ? 'Покращити' : 'Побудувати') + '</button>') +
                    (level > 0 ? '<button onclick="startPlacingBuilding(\\'' + b.id + '\\')">📍 Розмістити на карті</button>' : '') +
                    '</div>';
            }).join('');
        }

        window.buildMapBuilding = async (buildingId) => {
            const res = await apiFetch('/api/map/build', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, buildingId })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.mapBuildings = data.mapBuildings;
            state.resources = data.resources;
            state.storageUsed = data.used;
            tg.HapticFeedback.notificationOccurred('success');
            renderMapBuildings();
            renderMapMarkers();
        };

        // ==========================================
        // ЯЩИКИ (список, шанси, анімація відкривання)
        // ==========================================
        // Ціна ящика з урахуванням щоденної акції. Це лише для показу й перевірки
        // «чи вистачає» — авторитетну ціну все одно рахує сервер при відкритті.
        function clientCratePrice(crate) {
            const deal = state.dailyDeal || {};
            if (crate.currency !== 'coins' || crate.id !== deal.crateId) return crate.price;
            return Math.round(crate.price * (1 - deal.off));
        }

        function lootLabel(entry) {
            if (entry.type === 'nothing') return '🧦 Пусто';
            if (entry.type === 'coins') return '🪙 ' + entry.min.toLocaleString('uk-UA') + '–' + entry.max.toLocaleString('uk-UA') + ' ТК';
            if (entry.type === 'energy') return '🔋 Повна енергія';
            if (entry.type === 'granny') return '👵 Бабуся клікає ' + ECONOMY.GRANNY_MINUTES + ' хв';
            if (entry.type === 'cosmetic') return '👕 Річ у гардероб';
            const meta = RESOURCE_BY_ID[entry.res];
            return meta.emoji + ' ' + meta.name + ' ' + entry.min + (entry.max > entry.min ? '–' + entry.max : '');
        }

        function renderCrates() {
            const list = document.getElementById('crates-list');
            if (!list) return;
            // Трофейний ящик у магазині не показуємо: він не продається взагалі,
            // а видається за перемогу у війні ОСББ чи відбиту облаву на район.
            list.innerHTML = CRATES.filter(c => c.currency !== 'trophy').map(c => {
                const totalWeight = c.loot.reduce((s, e) => s + e.weight, 0);
                const odds = c.loot.map(e =>
                    '<div><span>' + lootLabel(e) + '</span><span>' + (100 * e.weight / totalWeight).toFixed(1) + '%</span></div>'
                ).join('');
                const deal = state.dailyDeal || {};
                const onSale = c.currency === 'coins' && c.id === deal.crateId;
                const salePrice = onSale ? Math.round(c.price * (1 - deal.off)) : c.price;
                const priceLabel = c.currency === 'stars'
                    ? c.price + ' ⭐'
                    : (onSale
                        ? '<s style="opacity:0.55">' + c.price.toLocaleString('uk-UA') + '</s> ' + salePrice.toLocaleString('uk-UA') + ' 🪙'
                        : c.price.toLocaleString('uk-UA') + ' 🪙');
                const btnClass = c.currency === 'stars' ? 'gacha-btn gacha-btn-premium' : 'gacha-btn';
                const saleBadge = onSale
                    ? '<span class="sale-badge">−' + Math.round(deal.off * 100) + '% сьогодні</span>'
                    : '';
                return '<div class="crate-card' + (c.currency === 'stars' ? ' stars' : '') + (onSale ? ' on-sale' : '') + '">' +
                    '<div class="crate-top">' +
                        '<img src="' + c.img + '" alt="">' +
                        '<div><div class="crate-name">' + c.emoji + ' ' + c.name + saleBadge + '</div>' +
                        '<div class="crate-desc">' + c.desc + '</div></div>' +
                    '</div>' +
                    '<button class="' + btnClass + '" onclick="openCrate(\\'' + c.id + '\\')">Відкрити — ' + priceLabel + '</button>' +
                    '<button class="crate-odds-toggle" onclick="toggleOdds(\\'' + c.id + '\\')">шанси ▾</button>' +
                    '<div class="crate-odds hidden" id="odds-' + c.id + '">' + odds + '</div>' +
                '</div>';
            }).join('');
        }

        window.toggleOdds = (crateId) => {
            document.getElementById('odds-' + crateId).classList.toggle('hidden');
        };

        let lastCrateId = null;

        // Програє триетапну анімацію: трясіння → вибух із іскрами → поява призу.
        function playCrateAnimation(reward, crateId, hasMore) {
            const crate = CRATES.find(c => c.id === crateId) || CRATES[0];
            const overlay = document.getElementById('crate-overlay');
            const sparks = document.getElementById('crate-sparks');
            const prizeIcon = document.getElementById('crate-prize-icon');

            document.getElementById('crate-box-img').src = crate.img;
            overlay.className = '';
            document.getElementById('crate-close').classList.add('hidden');
            document.getElementById('crate-again-wrap').classList.add('hidden');

            // Іскри розлітаються по колу від центру
            sparks.innerHTML = '';
            for (let i = 0; i < 14; i++) {
                const s = document.createElement('div');
                s.className = 'crate-spark';
                const angle = (i / 14) * Math.PI * 2;
                const dist = 90 + Math.random() * 60;
                s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
                s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
                sparks.appendChild(s);
            }

            prizeIcon.innerHTML = reward.img
                ? '<img src="' + reward.img + '" alt="">'
                : (reward.emoji || '🎁');
            document.getElementById('crate-prize-title').innerText = reward.title || '';
            document.getElementById('crate-prize-desc').innerText = reward.desc || '';

            overlay.classList.add('stage-shake');
            if (reward.kind === 'nothing') overlay.classList.add('result-nothing');
            tg.HapticFeedback.impactOccurred('medium');

            setTimeout(() => {
                overlay.classList.remove('stage-shake');
                overlay.classList.add('stage-burst');
                tg.HapticFeedback.impactOccurred('heavy');
            }, 900);

            setTimeout(() => {
                overlay.classList.add('stage-reveal');
                tg.HapticFeedback.notificationOccurred(reward.kind === 'nothing' ? 'warning' : 'success');
                document.getElementById('crate-close').innerText = hasMore ? 'Далі →' : 'Забрати';
                document.getElementById('crate-close').classList.remove('hidden');
                // У черзі (пачка з промокоду) кнопку "ще раз" не показуємо — вона тут
                // означала б "купити ще один", а не "перейти до наступного в пачці".
                if (crate.currency === 'coins' && !hasMore) {
                    lastCrateId = crate.id;
                    document.getElementById('crate-again-wrap').classList.remove('hidden');
                    document.getElementById('crate-again').innerText = 'Ще раз — ' + clientCratePrice(crate).toLocaleString('uk-UA') + ' 🪙';
                }
            }, 1500);

            // Страховка: коли анімація мала б завершитись, жорстко фіксуємо фінальний стан.
            // Якщо вкладка була згорнута, CSS-анімації не просувались і зависли б на 0%.
            setTimeout(() => overlay.classList.add('anim-done'), 2100);
        }

        // Черга для промокоду-пачки (KATOK): показуємо ящики один за одним тією
        // самою анімацією, а не всі одразу — інакше з чотирьох призів побачиш лише останній.
        let crateQueue = [];
        window.closeCrateOverlay = () => {
            if (crateQueue.length) {
                const next = crateQueue.shift();
                playCrateAnimation(next.reward, next.crateId, crateQueue.length > 0);
                return;
            }
            document.getElementById('crate-overlay').className = 'hidden';
        };
        function playCrateBundle(bundle) {
            if (!bundle || !bundle.length) return;
            crateQueue = bundle.slice(1).map((b) => ({ reward: b.reward, crateId: b.crateId }));
            playCrateAnimation(bundle[0].reward, bundle[0].crateId, crateQueue.length > 0);
        }

        window.repeatCrate = () => {
            if (lastCrateId) openCrate(lastCrateId);
        };

        window.openCrate = async (crateId) => {
            const crate = CRATES.find(c => c.id === crateId);
            if (!crate) return;

            if (crate.currency === 'stars') {
                try {
                    const res = await apiFetch('/api/invoice', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: user.id, type: 'crate', crateId: crate.id })
                    });
                    const data = await res.json();
                    if (!data.link) return tg.showAlert('Помилка створення інвойсу');
                    tg.openInvoice(data.link, async (status) => {
                        // Результат уже розкрито на сервері — init() підхопить і покаже анімацію
                        if (status === 'paid') await init();
                    });
                } catch (e) { tg.showAlert('Помилка генерації інвойсу'); }
                return;
            }

            if (state.balance < clientCratePrice(crate)) return tg.showAlert('Не вистачає ТК на цей ящик!');
            document.getElementById('crate-overlay').classList.remove('hidden');

            try {
                const res = await apiFetch('/api/crate/open', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, crateId: crate.id })
                });
                const data = await res.json();
                if (!data.success) {
                    document.getElementById('crate-overlay').className = 'hidden';
                    return tg.showAlert(data.message || 'Помилка');
                }
                state.balance = data.balance;
                state.boxesOpened += 1;
                state.resources = data.resources;
                state.storageUsed = data.used;
                state.storageCapacity = data.capacity;
                if (data.ownedCosmetics) state.ownedCosmetics = data.ownedCosmetics;
                if (typeof data.energy === 'number') state.energy = data.energy;
                if (typeof data.grannyUntil === 'number') state.grannyUntil = data.grannyUntil;
                playCrateAnimation(data.reward, crate.id);
                if (data.unlockedAchievements && data.unlockedAchievements.length) {
                    data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                }
                updateUI();
                renderStorage();
                renderRecipes();
                renderCosmetics();
            } catch (e) {
                document.getElementById('crate-overlay').className = 'hidden';
                tg.showAlert('Помилка відкриття ящика');
            }
        };

        // ==========================================
        // КЛАДОВКА (склад ресурсів + крафт)
        // ==========================================
        window.switchStorageTab = (evt, tabId) => {
            const root = document.getElementById('storage');
            root.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            root.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            evt.currentTarget.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            if (tabId === 'storage-craft') renderRecipes();
            else if (tabId === 'storage-exp') renderExpeditions();
            else renderStorage();
        };

        function renderStorage() {
            const list = document.getElementById('resources-list');
            if (!list) return;

            const cap = state.storageCapacity || 0;
            const used = Object.values(state.resources || {}).reduce((s, n) => s + (n || 0), 0);
            state.storageUsed = used;
            document.getElementById('storage-level').innerText = state.storageLevel || 0;
            document.getElementById('storage-count').innerText = used + ' / ' + cap;
            const fill = document.getElementById('storage-fill');
            fill.style.width = (cap ? Math.min(100, 100 * used / cap) : 0) + '%';
            fill.classList.toggle('full', cap > 0 && used >= cap);

            const upgBtn = document.getElementById('storage-upgrade-btn');
            if (state.storageUpgradeCost == null) {
                upgBtn.innerText = 'Кладовка максимального розміру';
                upgBtn.disabled = true;
            } else {
                upgBtn.innerText = 'Розширити (+' + ECONOMY.STORAGE_CAPACITY_PER_LEVEL + ' місць) — ' + state.storageUpgradeCost.toLocaleString('uk-UA') + ' 🪙';
                upgBtn.disabled = false;
            }

            list.innerHTML = RESOURCES.map(r => {
                const qty = (state.resources || {})[r.id] || 0;
                // Ціна — поточний курс біржі; поки він не завантажився, показуємо базу.
                const price = (state.marketPrices || {})[r.id] || r.sell;
                const diff = Math.round(100 * (price - r.sell) / r.sell);
                const trend = diff > 0 ? ' <span style="color:#39ff14">▲' + diff + '%</span>'
                    : (diff < 0 ? ' <span style="color:#ff5722">▼' + Math.abs(diff) + '%</span>' : '');
                const sellBtn = qty > 0
                    ? '<button onclick="sellResource(\\'' + r.id + '\\')">Здати все (+' + (qty * price).toLocaleString('uk-UA') + ' 🪙)</button>'
                    : '';
                const visual = r.img
                    ? '<img class="res-img" src="' + r.img + '" alt="">'
                    : '<span class="res-emoji">' + r.emoji + '</span>';
                return '<div class="res-card res-tier-' + r.tier + (qty === 0 ? ' empty' : '') + '">' +
                    visual +
                    '<div class="res-info"><div class="res-name">' + r.name + '</div>' +
                    '<div class="res-meta">тір ' + r.tier + ' · ' + price + ' 🪙 за шт.' + trend + '</div></div>' +
                    '<span class="res-qty">' + qty + '</span>' + sellBtn +
                '</div>';
            }).join('');
        }

        function renderRecipes() {
            const list = document.getElementById('recipes-list');
            if (!list) return;

            let note = '';
            if (state.permanentShield) {
                note = '<div class="shield-note">🎫 У тебе Білий Квиток — облави тобі більше не страшні. Назавжди.</div>';
            } else if ((state.shieldUntil || 0) > Date.now()) {
                const mins = Math.ceil((state.shieldUntil - Date.now()) / 60000);
                note = '<div class="shield-note">📄 Щит від облав активний ще ' + mins + ' хв.</div>';
            }

            list.innerHTML = note + RECIPES.map(rc => {
                const ings = Object.entries(rc.cost).map(([resId, need]) => {
                    const have = (state.resources || {})[resId] || 0;
                    const meta = RESOURCE_BY_ID[resId];
                    const ok = have >= need;
                    return '<span class="recipe-ing ' + (ok ? 'ok' : 'missing') + '">' +
                        meta.emoji + ' ' + have + '/' + need + '</span>';
                }).join('');
                const canCraft = Object.entries(rc.cost).every(([resId, need]) => ((state.resources || {})[resId] || 0) >= need);
                const alreadyHas = rc.effect.type === 'permanent_shield' && state.permanentShield;
                const btn = alreadyHas
                    ? '<button disabled>Вже отримано</button>'
                    : '<button onclick="craft(\\'' + rc.id + '\\')"' + (canCraft ? '' : ' disabled') + '>' +
                      (canCraft ? '🔨 Скрафтити' : 'Не вистачає ресурсів') + '</button>';
                const icon = rc.img
                    ? '<img class="btn-icon" src="' + rc.img + '" alt="">'
                    : rc.emoji + ' ';
                return '<div class="recipe-card' + (canCraft && !alreadyHas ? ' ready' : '') + '">' +
                    '<div class="recipe-title">' + icon + rc.name + '</div>' +
                    '<div class="recipe-desc">' + rc.desc + '</div>' +
                    '<div class="recipe-cost">' + ings + '</div>' + btn +
                '</div>';
            }).join('');
        }

        // ===== Довідка "Як грати" =====
        // Показуємо автоматично лише один раз — прапорець тримаємо в localStorage,
        // щоб не залежати від серверного стану (і не питати CloudStorage на старті).
        const HELP_SEEN_KEY = 'ukh_help_seen_v1';
        window.openHelp = () => document.getElementById('help-overlay').classList.remove('hidden');
        window.closeHelp = () => {
            document.getElementById('help-overlay').classList.add('hidden');
            try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch (e) {}
        };
        // Дисклеймер (гра — сатира, не заклик) — показується ПЕРЕД довідкою, теж
        // лише один раз, окремий прапорець.
        const DISCLAIMER_SEEN_KEY = 'ukh_disclaimer_seen_v1';
        window.closeDisclaimer = () => {
            document.getElementById('disclaimer-overlay').classList.add('hidden');
            try { localStorage.setItem(DISCLAIMER_SEEN_KEY, '1'); } catch (e) {}
            maybeShowHelpOnFirstRun();
        };
        function maybeShowHelpOnFirstRun() {
            let seen = false;
            try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch (e) {}
            if (!seen) setTimeout(openHelp, 1200); // після сплеш-екрана
        }
        // На прохання користувача — дисклеймер про сатиру показується ЩОРАЗУ при
        // вході в гру (не один раз), довідка "Як грати" лишається одноразовою.
        function maybeShowDisclaimerOnFirstRun() {
            setTimeout(() => document.getElementById('disclaimer-overlay').classList.remove('hidden'), 800);
        }

        // ===== Статистика та колекція =====
        // Баланс у 8+ цифр на телефоні просто не читається, тому великі числа
        // скорочуємо. До 100 тисяч показуємо повністю — там кожна тисяча ще важлива.
        function fmtNum(n) {
            const v = Math.round(n || 0);
            const abs = Math.abs(v);
            if (abs < 100000) return v.toLocaleString('uk-UA');
            const units = [
                { at: 1e12, s: 'Т' }, { at: 1e9, s: 'Б' }, { at: 1e6, s: 'М' }, { at: 1e3, s: 'К' },
            ];
            for (const u of units) {
                if (abs >= u.at) {
                    const scaled = v / u.at;
                    // Одна десята для 3-значних, дві для менших — щоб ширина була рівна.
                    const digits = Math.abs(scaled) >= 100 ? 0 : (Math.abs(scaled) >= 10 ? 1 : 2);
                    return scaled.toFixed(digits).replace('.', ',') + u.s;
                }
            }
            return v.toLocaleString('uk-UA');
        }
        // Повне число — там, де скорочення заплутало б (точні ціни, підсумки).
        function fmtFull(n) { return Math.round(n || 0).toLocaleString('uk-UA'); }

        function renderStats() {
            const box = document.getElementById('stats-box');
            if (!box) return;
            const rows = [
                ['🖱 Всього кліків', fmtNum(state.totalClicks)],
                ['💰 Зароблено за все життя', fmtNum(state.totalEarned) + ' ТК'],
                ['📦 Відкрито ящиків', fmtNum(state.boxesOpened)],
                ['🌙 Завершено вилазок', fmtNum(state.expeditionsDone)],
                ['🔨 Скрафтено предметів', fmtNum(state.craftedCount)],
                ['🚨 Пережито облав', fmtNum(state.raidsSurvived)],
                ['📜 Довідок престижу', fmtNum(state.prestigePoints) + ' (x' + (state.prestigeMultiplier || 1).toFixed(2) + ')'],
                ['🗄 Рівень кладовки', fmtNum(state.storageLevel) + ' (' + fmtNum(state.storageCapacity) + ' місць)'],
                ['🔥 Розшук', Math.round(state.heat || 0) + ' — ' + ((state.heatTier || HEAT_TIERS[0]).name)],
                ['📬 Знято повісток', fmtNum((state.noticeStats || {}).resolved || 0) + ' (протухло: ' + fmtNum((state.noticeStats || {}).expired || 0) + ')'],
                ['🐍 Здав сусідів', fmtNum((state.snitchStats || {}).sent || 0)],
                ['🎯 Здали тебе', fmtNum((state.snitchStats || {}).received || 0)],
                ['🕵️ Розкрив стукачів', fmtNum((state.snitchStats || {}).caught || 0)],
                ['🏥 Медкомісій пройдено', fmtNum((state.medcomStats || {}).passed || 0) +
                    ' (провалів: ' + fmtNum((state.medcomStats || {}).failed || 0) + ')'],
                ['🎖️ Інспекторів спекався', fmtNum(Object.values((state.inspectorStats || {}).defeated || {}).reduce((a, b) => a + b, 0)) +
                    ' (втік: ' + fmtNum((state.inspectorStats || {}).lost || 0) + ')'],
                ['🌳 Навичок вивчено', Object.values(state.skills || {}).filter(Boolean).length + ' / 18'],
                ['🚧 Блокпостів пройдено', fmtNum((state.checkpointStats || {}).passed || 0) +
                    ' (спалився: ' + fmtNum((state.checkpointStats || {}).failed || 0) + ')'],
                ['🏅 Сезонні очки', fmtNum(state.seasonPoints || 0) +
                    (state.league ? ' — ' + state.league.emoji + ' ' + state.league.name : '')],
                ['👑 Титул', state.seasonTitle || '—'],
                ['📣 Згодних на рекламу', fmtNum(state.adConsentCount || 0) +
                    ' · аірдропи ×' + (state.adAirdropMult || 1).toFixed(2)],
            ];
            box.innerHTML = rows.map(([k, v]) =>
                '<div class="stat-row"><span>' + k + '</span><b>' + v + '</b></div>'
            ).join('');
        }

        // Прогрес-бари по колекціях. Головна мета — показати гравцю, скільки лишилось
        // зібрати: видима незавершеність мотивує сильніше за будь-який банер.
        function renderCollection() {
            const box = document.getElementById('collection-box');
            if (!box) return;
            const groups = [
                ['🎩 Головні убори', COSMETICS.filter(c => c.slot === 'hat'), state.ownedCosmetics],
                ['😷 Маски', COSMETICS.filter(c => c.slot === 'face'), state.ownedCosmetics],
                ['🧣 Аксесуари', COSMETICS.filter(c => c.slot === 'neck'), state.ownedCosmetics],
                ['✨ Рамки', COSMETICS.filter(c => c.slot === 'frame'), state.ownedCosmetics],
                ['🛋 Декор кімнати', ROOM_ITEMS, state.ownedRoomItems],
                ['🐾 Компаньйони', PETS, state.ownedPets],
                ['🏆 Трофеї', TROPHIES, state.trophies],
                ['🏅 Досягнення', ACHIEVEMENTS_META, state.achievements],
            ];
            box.innerHTML = groups.map(([name, all, owned]) => {
                const have = all.filter(x => (owned || []).includes(x.id)).length;
                const pct = all.length ? Math.round(100 * have / all.length) : 0;
                const done = have === all.length;
                return '<div class="coll-row">' +
                    '<div class="coll-head"><span>' + name + (done ? ' ✅' : '') + '</span><span>' + have + ' / ' + all.length + '</span></div>' +
                    '<div class="storage-bar"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
                '</div>';
            }).join('');
        }

        // ===== Легалізація (престиж) =====
        function renderPrestige() {
            const box = document.getElementById('prestige-box');
            if (!box) return;
            const pts = state.prestigePoints || 0;
            const avail = state.prestigeAvailable || 0;
            const mult = state.prestigeMultiplier || 1;
            const unlocked = state.level >= ECONOMY.PRESTIGE_UNLOCK_LEVEL;
            const bonusPct = Math.round(ECONOMY.PRESTIGE_BONUS_PER_POINT * 100);

            let action;
            if (!unlocked) {
                action = '<button disabled>🔒 Потрібен ' + ECONOMY.PRESTIGE_UNLOCK_LEVEL + ' рівень схрону (маєток)</button>';
            } else if (avail < 1) {
                const need = Math.pow((pts + 1), 2) * ECONOMY.PRESTIGE_EARN_PER_POINT;
                const left = Math.max(0, need - (state.totalEarned || 0));
                action = '<button disabled>Ще ' + Math.round(left).toLocaleString('uk-UA') + ' ТК заробити до наступної довідки</button>';
            } else {
                action = '<button onclick="doPrestige()">📜 Легалізуватись (+' + avail + ' довідк' + (avail === 1 ? 'а' : 'и') + ')</button>';
            }

            box.innerHTML =
                '<div class="recipe-card' + (avail >= 1 && unlocked ? ' ready' : '') + '">' +
                    '<div class="recipe-desc" style="margin-top:0">Оформляєш документи "офіційно" — нічого не скидається, кожна довідка назавжди дає ' +
                    '<b style="color:var(--gold)">+' + bonusPct + '% до всього доходу</b>.<br>' +
                    'Це разова віха, не перезапуск: баланс, схрон, апгрейди, гардероб — усе лишається як є.</div>' +
                    '<div class="recipe-cost">' +
                        '<span class="recipe-ing ok">📜 Довідок: ' + pts + '</span>' +
                        '<span class="recipe-ing ok">📈 Множник: x' + mult.toFixed(2) + '</span>' +
                        '<span class="recipe-ing ' + (avail >= 1 ? 'ok' : 'missing') + '">Доступно: ' + avail + '</span>' +
                        '<span class="recipe-ing">Легалізацій: ' + (state.prestigeCount || 0) + '</span>' +
                    '</div>' + action +
                '</div>';
        }

        window.doPrestige = async () => {
            const avail = state.prestigeAvailable || 0;
            tg.showConfirm('Легалізуватись? Нічого не скидається — отримаєш ' + avail + ' довідок (+' + Math.round(avail * ECONOMY.PRESTIGE_BONUS_PER_POINT * 100) + '% до доходу назавжди) і лишишся при своєму прогресі.', async (ok) => {
                if (!ok) return;
                const res = await apiFetch('/api/prestige/claim', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id })
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Помилка');
                syncLevel(data);
                tg.HapticFeedback.notificationOccurred('success');
                // Повну лор-сцену показуємо тільки на ПЕРШУ легалізацію — на повторних
                // це вже не сюжетна подія, а рутинна дія, довгий текст лише дратував би.
                const msg = data.prestigeCount === 1
                    ? LEGALIZATION_LORE
                    : '📜 Легалізовано! +' + data.gained + ' довідок. Твій множник тепер x' + data.multiplier.toFixed(2);
                tg.showAlert(msg);
                await init();
            });
        };

        // ===== Вилазки =====
        function fmtLeft(ms) {
            const s = Math.max(0, Math.ceil(ms / 1000));
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
            if (h > 0) return h + ' год ' + m + ' хв';
            if (m > 0) return m + ' хв ' + sec + ' с';
            return sec + ' с';
        }

        function absorbExpeditions(data) {
            if (Array.isArray(data.expeditions)) state.expeditions = data.expeditions;
            if (typeof data.expeditionSlots === 'number') state.expeditionSlots = data.expeditionSlots;
        }

        function renderExpeditions() {
            const list = document.getElementById('expeditions-list');
            if (!list) return;
            const active = state.expeditions || [];
            const slots = state.expeditionSlots || 1;

            // Активні вилазки зверху, вільні слоти — списком нижче. З «Другою норою»
            // можна тримати дві одночасно, тому це вже не або-або.
            let html = active.map(a => {
                const exp = EXPEDITIONS.find(e => e.id === a.id);
                if (!exp) return '';
                const left = a.endsAt - Date.now();
                const total = exp.minutes * 60 * 1000;
                const pct = Math.min(100, 100 * (1 - left / total));
                const done = left <= 0;
                return '<div class="recipe-card ready">' +
                    '<div class="recipe-title">' + exp.emoji + ' ' + esc(exp.name) + '</div>' +
                    '<div class="recipe-desc">' + (done ? 'Вилазка завершена — забирай здобич!' : 'Залишилось: ' + fmtLeft(left)) + '</div>' +
                    '<div class="storage-bar" style="margin-bottom:9px;"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
                    '<button onclick="claimExpedition(\\'' + a.id + '\\')"' + (done ? '' : ' disabled') + '>' +
                    (done ? '🎒 Забрати здобич' : 'Ще в дорозі...') + '</button>' +
                '</div>';
            }).join('');

            if (active.length >= slots) {
                list.innerHTML = html;
                return;
            }
            if (slots > 1) {
                html += '<div style="font-size:12px; color:#8fa3b8; text-align:center; margin: 10px 0 8px;">' +
                    'Вільних нір: ' + (slots - active.length) + ' з ' + slots + '</div>';
            }

            list.innerHTML = html + EXPEDITIONS.map(e => {
                const locked = state.level < e.minLevel || active.some(a => a.id === e.id);
                const lootStr = e.loot.map(l => RESOURCE_BY_ID[l.res].emoji + ' ' + l.min + '–' + l.max).join('  ');
                const riskPct = Math.round(e.risk * 100);
                const riskLabel = hasShield()
                    ? '<span style="color:#b9ffb0">ризик 0% (щит)</span>'
                    : 'ризик ' + riskPct + '%';
                return '<div class="recipe-card">' +
                    '<div class="recipe-title">' + e.emoji + ' ' + e.name + '</div>' +
                    '<div class="recipe-desc">' + e.desc + '<br>⏱ ' + (e.minutes >= 60 ? (e.minutes / 60) + ' год' : e.minutes + ' хв') + ' · ' + riskLabel + '</div>' +
                    '<div class="recipe-cost"><span class="recipe-ing ok">' + lootStr + '</span></div>' +
                    '<button onclick="startExpedition(\\'' + e.id + '\\')"' + (locked ? ' disabled' : '') + '>' +
                    (active.some(a => a.id === e.id) ? '⏳ Вже триває'
                        : locked ? '🔒 Потрібен ' + e.minLevel + ' рівень схрону' : '🌙 Вирушити') + '</button>' +
                '</div>';
            }).join('');
        }

        window.startExpedition = async (expeditionId) => {
            const res = await apiFetch('/api/expedition/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, expeditionId })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            absorbExpeditions(data);
            tg.HapticFeedback.notificationOccurred('success');
            renderExpeditions();
        };

        window.claimExpedition = async (expeditionId) => {
            const res = await apiFetch('/api/expedition/claim', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, expeditionId })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            absorbExpeditions(data);
            state.resources = data.resources;
            state.storageUsed = data.used;
            syncLevel(data);
            if (data.caught) {
                tg.HapticFeedback.notificationOccurred('error');
                tg.showAlert('🚨 ' + data.message);
            } else {
                const lines = (data.gained || []).map(g =>
                    g.emoji + ' ' + g.name + ': +' + g.added + (g.lost > 0 ? ' (' + g.lost + ' згоріло — кладовка повна)' : '')
                ).join('\\n');
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert('🎒 Вилазка вдалась!\\n' + lines);
            }
            if (data.unlockedAchievements && data.unlockedAchievements.length) {
                data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                renderAchievements();
            }
            updateUI();
            renderExpeditions();
            renderStorage();
            renderRecipes();
        };

        window.upgradeStorage = async () => {
            const res = await apiFetch('/api/storage/upgrade', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance;
            state.storageLevel = data.storageLevel;
            state.storageCapacity = data.capacity;
            state.storageUpgradeCost = data.upgradeCost;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderStorage();
        };

        window.sellResource = async (resId) => {
            const res = await apiFetch('/api/storage/sell', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, resId, all: true })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance;
            state.resources = data.resources;
            state.storageUsed = data.used;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderStorage();
            renderRecipes();
        };

        window.craft = async (recipeId) => {
            const res = await apiFetch('/api/craft', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, recipeId })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance; state.clickVal = data.clickVal; state.passive = data.passive;
            state.energy = data.energy; state.maxEnergy = data.maxEnergy;
            state.resources = data.resources; state.storageUsed = data.used;
            state.shieldUntil = data.shieldUntil; state.permanentShield = data.permanentShield;
            state.craftedCount = data.craftedCount;
            syncLevel(data);
            tg.HapticFeedback.notificationOccurred('success');
            if (data.unlockedAchievements && data.unlockedAchievements.length) {
                data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                renderAchievements();
            }
            updateUI();
            renderStorage();
            renderRecipes();
            // Склеєний ящик — та сама анімація відкривання, що й у купленого:
            // гравець зібрав уламки саме заради цього моменту.
            if (data.crateReward) playCrateAnimation(data.crateReward, data.crateId || 'starter');
            else tg.showAlert('🔨 ' + data.message);
        };

        // ==========================================
        // БАГАТОРІВНЕВІ АПГРЕЙДИ МАГАЗИНУ
        // ==========================================
        const UPGRADE_META = [
            { key: 'hat', name: 'Шапочка з фольги', img: '/images/shop-hat.webp', bonus: '+' + ECONOMY.HAT_CLICK_BONUS + ' до кліку' },
            { key: 'jam', name: 'Закрутка', img: '/images/shop-jam.webp', bonus: '+' + ECONOMY.JAM_PASSIVE_BONUS + ' до пасиву' },
            { key: 'thermos', name: 'Термос кави', img: '/images/shop-thermos.webp', bonus: '+' + ECONOMY.THERMOS_CLICK_BONUS + ' до кліку' },
            { key: 'generator', name: 'Генератор', img: '/images/shop-generator.webp', bonus: '+' + ECONOMY.GENERATOR_PASSIVE_BONUS + ' до пасиву' },
        ];

        // Перемикач ×1/×10/MAX. Скільки саме рівнів по кишені й скільки це коштує —
        // рахує сервер; тут показуємо лише ціну наступного рівня як орієнтир.
        window.setBuyAmount = (amount) => {
            state.buyAmount = amount;
            renderUpgrades();
        };

        function renderUpgrades() {
            renderLocationShop();
            const list = document.getElementById('upgrades-list');
            if (!list) return;
            const amount = state.buyAmount || 1;
            const switcher = '<div class="buy-switch">' +
                [1, 10, 'max'].map(a =>
                    '<button class="' + (amount === a ? 'active' : '') + '" onclick="setBuyAmount(' +
                    (a === 'max' ? "'max'" : a) + ')">' + (a === 'max' ? 'MAX' : '×' + a) + '</button>'
                ).join('') + '</div>';

            list.innerHTML = switcher + UPGRADE_META.map(u => {
                const lvl = (state.upgrades || {})[u.key] || 0;
                const tier = (state.upgTiersUnlocked || {})[u.key] || 0;
                const gate = (state.upgradeGates || {})[u.key];
                const tierLabel = tier > 0 ? ' <span style="color:var(--accent2); font-size:11px;">(ешелон ' + tier + ')</span>' : '';
                if (gate) {
                    const missing = Object.entries(gate.cost).map(([r, q]) => {
                        const have = (state.resources || {})[r] || 0;
                        const meta = RESOURCE_BY_ID[r];
                        const ok = have >= q;
                        return '<span style="color:' + (ok ? '#b9ffb0' : '#ff8a8a') + '">' + meta.emoji + ' ' + q + '</span>';
                    }).join(' ');
                    return '<div class="upg-card">' +
                        '<img src="' + u.img + '" alt="">' +
                        '<div class="upg-info"><div class="upg-name">' + u.name + ' <span style="color:var(--gold)">Ур. ' + lvl + '</span></div>' +
                        '<div class="upg-meta">🔒 Ешелон ' + gate.tier + ' — потрібно: ' + missing + '</div></div>' +
                        '<button onclick="breakUpgradeTier(\\'' + u.key + '\\')">Пробити</button>' +
                    '</div>';
                }
                const cost = (state.upgradeCosts || {})[u.key] || 0;
                const afford = state.balance >= cost;
                return '<div class="upg-card">' +
                    '<img src="' + u.img + '" alt="">' +
                    '<div class="upg-info"><div class="upg-name">' + u.name + ' <span style="color:var(--gold)">Ур. ' + lvl + '</span></div>' +
                    '<div class="upg-meta">' + u.bonus + ' за рівень' + tierLabel + '</div></div>' +
                    '<button onclick="buyUpgrade(\\'' + u.key + '\\')"' + (afford ? '' : ' disabled') + '>' +
                    fmtNum(cost) + ' 🪙' + (amount === 1 ? '' : '<br><span style="font-size:10px;opacity:.8">' +
                        (amount === 'max' ? 'скільки влізе' : '×' + amount) + '</span>') + '</button>' +
                '</div>';
            }).join('');
        }

        window.buyUpgrade = async (key) => {
            const res = await apiFetch('/api/upgrade/buy', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, key, amount: state.buyAmount || 1 })
            });
            const data = await res.json();
            if (!data.success) {
                if (data.gate) { state.upgradeGates[key] = data.gate; renderUpgrades(); }
                return tg.showAlert(data.message || 'Помилка');
            }
            state.balance = data.balance; state.clickVal = data.clickVal; state.passive = data.passive;
            state.upgrades = data.upgrades;
            state.upgradeCosts[key] = data.nextCost;
            state.upgradeGates[key] = data.nextGate;
            syncLevel(data);
            tg.HapticFeedback.notificationOccurred('success');
            if (data.levelsBought > 1) {
                tg.showAlert('⬆️ +' + data.levelsBought + ' рівнів за ' + fmtNum(data.spent) + ' ТК');
            }
            if (data.unlockedAchievements && data.unlockedAchievements.length) {
                data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                renderAchievements();
            }
            updateUI();
            renderUpgrades();
        };

        window.breakUpgradeTier = async (key) => {
            const res = await apiFetch('/api/upgrade/breakTier', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, key })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.upgTiersUnlocked = data.upgTiersUnlocked;
            state.upgradeCosts[key] = data.nextCost;
            state.upgradeGates[key] = data.nextGate;
            state.resources = data.resources;
            state.storageUsed = data.used;
            syncLevel(data);
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('🔓 Ешелон ' + data.tier + ' пробито!');
            renderUpgrades();
        };

        function renderRoomItemsOverlay() {
            ROOM_ITEMS.forEach(it => {
                const el = document.getElementById('room-item-' + it.id);
                if (el) el.classList.toggle('hidden', !state.equippedRoomItems.includes(it.id));
            });
        }

        function renderRoomItems() {
            const list = document.getElementById('room-items-list');
            if (!list) return;
            list.innerHTML = ROOM_ITEMS.map(it => {
                const owned = state.ownedRoomItems.includes(it.id);
                const active = state.equippedRoomItems.includes(it.id);
                const visual = it.img ? '<img class="btn-icon" src="' + it.img + '" alt="">' : '<span class="cosmetic-emoji">' + it.emoji + '</span>';
                const btn = !owned
                    ? '<button onclick="buyRoomItem(\\'' + it.id + '\\')">Купити за ' + it.price + ' 🪙</button>'
                    : '<button onclick="toggleRoomItem(\\'' + it.id + '\\')">' + (active ? 'Прибрати' : 'Поставити') + '</button>';
                return '<div class="cosmetic-card' + (active ? ' equipped' : '') + '"><div class="cosmetic-label">' + visual + ' ' + it.name + '</div>' + btn + '</div>';
            }).join('');
        }

        window.buyRoomItem = async (itemId) => {
            const res = await apiFetch('/api/room/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, itemId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance; state.ownedRoomItems = data.ownedRoomItems;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderRoomItems();
        };

        window.toggleRoomItem = async (itemId) => {
            const res = await apiFetch('/api/room/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, itemId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.equippedRoomItems = data.equippedRoomItems;
            renderRoomItems();
            renderRoomItemsOverlay();
        };

        function renderCosmetics() {
            ['hat', 'face', 'neck', 'frame'].forEach(slot => {
                const container = document.getElementById('wardrobe-' + slot);
                if (!container) return;
                // Сезонні речі показуємо в гардеробі, лише коли вони вже виграні:
                // у магазині їм не місце, бо купити їх неможливо в принципі.
                container.innerHTML = COSMETICS
                    .filter(c => c.slot === slot && (!c.seasonOnly || state.ownedCosmetics.includes(c.id)))
                    .map(c => {
                    const owned = state.ownedCosmetics.includes(c.id);
                    const equipped = state.equippedCosmetics[slot] === c.id;
                    let swatchBg = c.color;
                    if (c.color === 'rainbow') swatchBg = 'conic-gradient(#35516b, #ff9800, #8ed4ff, #39ff14, #6ec6ff, #9c27b0, #35516b)';
                    if (c.color === 'siren') swatchBg = 'linear-gradient(90deg, #ff1744 50%, #2979ff 50%)';
                    const visual = c.color
                        ? '<span class="cosmetic-swatch" style="background:' + swatchBg + ';"></span>'
                        : (c.img ? '<img class="btn-icon" src="' + c.img + '" alt="">' : '<span class="cosmetic-emoji">' + c.emoji + '</span>');
                    const btn = !owned
                        ? '<button onclick="buyCosmetic(\\'' + c.id + '\\')">Купити за ' + c.price + ' 🪙</button>'
                        : equipped
                            ? '<button onclick="equipCosmetic(\\'' + slot + '\\', null)">Зняти</button>'
                            : '<button onclick="equipCosmetic(\\'' + slot + '\\', \\'' + c.id + '\\')">Одягти</button>';
                    return '<div class="cosmetic-card' + (equipped ? ' equipped' : '') + '"><div class="cosmetic-label">' + visual + ' ' + c.name + '</div>' + btn + '</div>';
                }).join('');
            });
        }

        window.buyCosmetic = async (cosmeticId) => {
            const res = await apiFetch('/api/cosmetic/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, cosmeticId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            // Купівля одразу вдягає річ — без окремого кроку "екіпірувати"
            state.balance = data.balance; state.ownedCosmetics = data.ownedCosmetics; state.equippedCosmetics = data.equippedCosmetics;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderCosmetics();
            applyCosmeticOverlay();
        };

        window.equipCosmetic = async (slot, cosmeticId) => {
            const res = await apiFetch('/api/cosmetic/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, slot, cosmeticId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.equippedCosmetics = data.equippedCosmetics;
            renderCosmetics();
            applyCosmeticOverlay();
        };

        // ===== Щоденні квести =====
        window.loadQuests = async () => {
            const res = await apiFetch('/api/quests?id=' + user.id);
            const data = await res.json();
            // Забираємо метрики за списком самих квестів, а не руками по одній:
            // раніше dailyCrafts і dailyResources просто забули, і ті два квести
            // завжди показували нульовий прогрес, хоч на сервері він був.
            for (const q of QUESTS) {
                if (typeof data[q.metric] === 'number') state[q.metric] = data[q.metric];
            }
            state.claimedQuests = data.claimedQuests;
            renderQuests();
        };

        function renderQuests() {
            const list = document.getElementById('quests-list');
            if (!list) return;
            list.innerHTML = QUESTS.map(q => {
                const progress = Math.min(state[q.metric] || 0, q.target);
                const done = progress >= q.target;
                const claimed = state.claimedQuests.includes(q.id);
                const pct = Math.round((progress / q.target) * 100);
                const btn = claimed
                    ? '<button disabled>Отримано</button>'
                    : done
                        ? '<button onclick="claimQuest(\\'' + q.id + '\\')">Забрати +' + q.reward + ' 🪙</button>'
                        : '<button disabled>' + progress + '/' + q.target + '</button>';
                return '<div class="quest-row' + (claimed ? ' done' : '') + '">' +
                    '<div class="quest-name">' + q.name + '</div><div class="quest-desc">' + q.desc + '</div>' +
                    '<div class="quest-progress-bar"><div class="quest-progress-fill" style="width:' + pct + '%;"></div></div>' + btn + '</div>';
            }).join('');
        }

        window.claimQuest = async (questId) => {
            const res = await apiFetch('/api/quests/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, questId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance; state.claimedQuests = data.claimedQuests;
            syncLevel(data);
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderQuests();
        };

        // ===== Тіньова біржа =====
        function sparklinePoints(history, w, h) {
            if (!history || history.length < 2) return '';
            const min = Math.min(...history), max = Math.max(...history);
            const range = (max - min) || 1;
            return history.map((v, i) => (i / (history.length - 1) * w).toFixed(1) + ',' + (h - ((v - min) / range) * h).toFixed(1)).join(' ');
        }

        window.loadMarket = async () => {
            const list = document.getElementById('market-list');
            list.innerHTML = 'Завантаження...';
            const res = await fetch('/api/market');
            const data = await res.json();
            state.marketPrices = data.prices;
            list.innerHTML = MARKET_ASSETS.map(a => {
                const price = data.prices[a.id];
                const held = (state.resources || {})[a.id] || 0;
                const hist = data.history[a.id] || [];
                const pts = sparklinePoints(hist, 70, 24);
                // Порівнюємо поточний курс із базовим, щоб гравець одразу бачив,
                // зараз вигідно продавати чи навпаки докуповувати.
                const base = a.basePrice;
                const diff = Math.round(100 * (price - base) / base);
                const trend = diff > 0
                    ? '<span style="color:#39ff14">+' + diff + '%</span>'
                    : (diff < 0 ? '<span style="color:#ff5722">' + diff + '%</span>' : '<span style="color:#8fa3b8">0%</span>');
                const visual = a.img
                    ? '<img class="res-img" src="' + a.img + '" alt="">'
                    : a.emoji;
                return '<div class="asset-row">' +
                    '<div><div class="asset-name">' + visual + ' ' + a.name + '</div>' +
                    '<div style="font-size:11px;color:#9db0c2;">У кладовці: ' + held + ' · ' + trend + ' до бази</div></div>' +
                    '<svg class="sparkline" viewBox="0 0 70 24"><polyline points="' + pts + '" fill="none" stroke="#ffd700" stroke-width="2"/></svg>' +
                    '<div class="asset-price">' + price + ' 🪙</div>' +
                    '<div class="asset-controls">' +
                    '<input type="number" min="1" value="1" id="qty-' + a.id + '">' +
                    '<button onclick="trade(\\'' + a.id + '\\',\\'buy\\')">Купити</button>' +
                    '<button onclick="trade(\\'' + a.id + '\\',\\'sell\\')">Продати</button>' +
                    '</div></div>';
            }).join('');
        };

        window.trade = async (assetId, action) => {
            const qtyInput = document.getElementById('qty-' + assetId);
            const qty = parseInt(qtyInput.value, 10) || 0;
            if (qty <= 0) return tg.showAlert('Вкажи кількість');
            const res = await apiFetch('/api/market/trade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, assetId, action, qty }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка угоди');
            state.balance = data.balance;
            state.resources = data.resources;
            state.storageUsed = data.used;
            tg.HapticFeedback.notificationOccurred('success');
            if (data.unlockedAchievements && data.unlockedAchievements.length) {
                data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                renderAchievements();
            }
            renderStorage();
            renderRecipes();
            updateUI();
            loadMarket();
        };

        // ===== Клани =====
        function renderClanMine() {
            const el = document.getElementById('clan-mine');
            // Війна і кооп-бос мають сенс лише всередині чату.
            document.getElementById('clan-war-buttons').classList.toggle('hidden', !state.clanId);
            if (!state.clanId) {
                el.innerHTML = '<p style="font-size:12px;color:#9db0c2;">Ти поки не в жодному чаті ОСББ.</p>';
                return;
            }
            const lvl = state.clanLevel || 0;
            const treasury = state.clanTreasury || 0;
            const next = state.clanNextLevelCost;
            const pct = next ? Math.min(100, Math.round(100 * treasury / next)) : 100;
            const progress = next
                ? '<div class="storage-bar" style="margin:6px 0;"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
                  '<div style="font-size:11px;color:#8fa3b8;">До ' + (lvl + 1) + ' рівня: ' + treasury.toLocaleString('uk-UA') + ' / ' + next.toLocaleString('uk-UA') + ' 🪙</div>'
                : '<div style="font-size:11px;color:var(--gold);margin-top:6px;">Максимальний рівень!</div>';

            el.innerHTML =
                '<div class="clan-card" style="display:block;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
                        '<div><b>🏘 ' + esc(state.clanName) + '</b> <span style="color:var(--gold)">Ур. ' + lvl + '</span><br>' +
                        '<span style="font-size:11px;color:#9db0c2;">+' + Math.round((state.clanBonus - 1) * 100) + '% пасиву всім учасникам</span></div>' +
                        '<button onclick="leaveClan()" style="width:auto;margin:0;padding:6px 12px;font-size:12px;">Вийти</button>' +
                    '</div>' +
                    progress +
                    '<div style="font-size:11px;color:#8fa3b8;margin-top:6px;">Твій внесок: ' + (state.clanMyContribution || 0).toLocaleString('uk-UA') + ' 🪙</div>' +
                    '<div style="display:flex;gap:6px;margin-top:8px;">' +
                        '<input type="number" id="clan-donate-amount" min="1" placeholder="Сума" style="flex:1;min-width:0;padding:8px;background:#131a21;border:1px solid #26313d;color:#fff;border-radius:5px;">' +
                        '<button onclick="donateClan()" style="width:auto;margin:0;padding:8px 14px;font-size:12px;white-space:nowrap;">Внести</button>' +
                    '</div>' +
                '</div>';
        }

        window.donateClan = async () => {
            const input = document.getElementById('clan-donate-amount');
            const amount = parseInt(input.value, 10) || 0;
            if (amount <= 0) return tg.showAlert('Вкажи суму внеску');
            if (state.balance < amount) return tg.showAlert('Недостатньо ТК');
            tg.showConfirm('Внести ' + amount.toLocaleString('uk-UA') + ' ТК у скарбницю? Внесок незворотний — він піднімає рівень чату всім учасникам.', async (ok) => {
                if (!ok) return;
                const res = await apiFetch('/api/clan/donate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, amount })
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Помилка');
                state.balance = data.balance;
                state.clanBonus = data.bonus;
                state.clanLevel = data.clanLevel;
                state.clanTreasury = data.treasury;
                state.clanNextLevelCost = data.nextLevelCost;
                state.clanMyContribution = data.myContribution;
                tg.HapticFeedback.notificationOccurred('success');
                if (data.unlockedAchievements && data.unlockedAchievements.length) {
                    data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                    renderAchievements();
                }
                if (data.leveledUp) tg.showAlert('🏘 Чат ОСББ виріс до ' + data.clanLevel + ' рівня! Бонус до пасиву тепер +' + Math.round((data.bonus - 1) * 100) + '% усім.');
                input.value = '';
                updateUI();
                renderClanMine();
                loadClanLeaderboard();
            });
        };

        window.createClan = async () => {
            const name = document.getElementById('clan-name-input').value.trim();
            if (!name) return tg.showAlert('Вкажи назву чату');
            const res = await apiFetch('/api/clan/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, name }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.clanId = data.clanId; state.clanName = data.clanName; state.clanBonus = 1 + ECONOMY.CLAN_PASSIVE_BONUS;
            renderClanMine(); updateUI();
            tg.showAlert('Чат "' + data.clanName + '" створено!');
        };

        window.joinClan = async (clanId) => {
            const res = await apiFetch('/api/clan/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, clanId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.clanId = data.clanId; state.clanName = data.clanName; state.clanBonus = 1 + ECONOMY.CLAN_PASSIVE_BONUS;
            renderClanMine(); updateUI();
            tg.showAlert('Приєднався до "' + data.clanName + '"!');
        };

        window.leaveClan = async () => {
            await apiFetch('/api/clan/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id }) });
            state.clanId = null; state.clanName = null; state.clanBonus = 1;
            renderClanMine(); updateUI();
        };

        window.loadClanList = async () => {
            const list = document.getElementById('clan-list');
            list.innerHTML = 'Завантаження...';
            const res = await fetch('/api/clan/list');
            const data = await res.json();
            list.innerHTML = data.map(c =>
                '<div class="clan-card"><span>🏘 ' + esc(c.name) +
                ' <span style="color:var(--gold)">Ур.' + (c.level || 0) + '</span>' +
                ' <span style="font-size:11px;color:#8fa3b8;">(' + c.members + ' уч.)</span></span>' +
                '<button onclick="joinClan(\\'' + c.id + '\\')">Приєднатись</button></div>'
            ).join('') || '<p style="font-size:12px;color:#9db0c2;">Поки немає жодного чату. Створи перший!</p>';
        };

        window.loadClanLeaderboard = async () => {
            const list = document.getElementById('clan-leaderboard');
            list.innerHTML = 'Завантаження...';
            const res = await fetch('/api/clan/leaderboard');
            const data = await res.json();
            list.innerHTML = data.map((c, i) =>
                '<div class="clan-card"><span>#' + (i + 1) + ' 🏘 ' + esc(c.name) +
                ' <span style="color:var(--gold)">Ур.' + (c.level || 0) + '</span>' +
                '<br><span style="font-size:11px;color:#8fa3b8;">' + c.members + ' уч.</span></span>' +
                '<b style="color:var(--gold)">' + (c.treasury || 0).toLocaleString('uk-UA') + ' 🪙<br>' +
                '<span style="font-size:10px;color:#8fa3b8;font-weight:normal;">скарбниця</span></b></div>'
            ).join('') || '<p style="font-size:12px;color:#9db0c2;">Поки немає рейтингу.</p>';
        };

        // ===== Досягнення =====
        function renderAchievements() {
            const list = document.getElementById('achievements-list');
            if (!list) return;
            list.innerHTML = ACHIEVEMENTS_META.map(a => {
                const unlocked = state.achievements.includes(a.id);
                return '<div class="ach-row' + (unlocked ? ' unlocked' : '') + '"><div class="ach-icon">' + (unlocked ? '🏅' : '🔒') + '</div>' +
                    '<div><div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc + ' (+' + a.reward + ' 🪙)</div></div></div>';
            }).join('');
        }

        // ===== Gacha (звичайна, за ігрову валюту) =====
        function showGachaModal(title, img, desc) {
            document.getElementById('gacha-title').innerText = title;
            document.getElementById('gacha-icon').src = img;
            document.getElementById('gacha-desc').innerText = desc;
            document.getElementById('gacha-result').classList.remove('hidden');
        }

        // ===== Колесо Зради та Перемоги =====
        function buildWheelGradient() {
            const n = WHEEL_SEGMENTS.length;
            const step = 360 / n;
            const stops = WHEEL_SEGMENTS.map((s, i) => s.color + ' ' + (i * step) + 'deg ' + ((i + 1) * step) + 'deg').join(', ');
            return 'conic-gradient(' + stops + ')';
        }

        function renderWheel() {
            const wheel = document.getElementById('wheel');
            wheel.style.background = buildWheelGradient();
            const btn = document.getElementById('wheel-btn');
            btn.disabled = state.wheelClaimedToday;
            btn.innerText = state.wheelClaimedToday ? 'Сьогодні вже крутили' : '🎡 Крутити колесо';
        }

        window.spinWheel = async () => {
            if (state.wheelClaimedToday) return tg.showAlert('Колесо вже крутили сьогодні.');
            const res = await apiFetch('/api/wheel/spin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id }) });
            const data = await res.json();
            if (!data.success) { state.wheelClaimedToday = true; renderWheel(); return tg.showAlert(data.message || 'Помилка'); }

            const n = WHEEL_SEGMENTS.length;
            const step = 360 / n;
            const targetCenter = data.index * step + step / 2;
            const spins = 5 * 360;
            const finalRotation = spins + (360 - targetCenter);
            const wheel = document.getElementById('wheel');
            wheel.style.transform = 'rotate(' + finalRotation + 'deg)';

            setTimeout(() => {
                state.balance = data.balance; state.energy = data.energy; state.wheelClaimedToday = true;
                if (data.resources) state.resources = data.resources;
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert('🎡 Випало: ' + (data.resultNote || data.segment.label));
                if (data.unlockedAchievements && data.unlockedAchievements.length) {
                    data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                    renderAchievements();
                }
                updateUI(); renderWheel(); renderStorage(); renderRecipes();
            }, 4100);
        };

        // ===== Міні-ігри =====
        let selectedRiskTier = RISK_TIERS[0].id;
        function renderMinigames() {
            const tiersBox = document.getElementById('risk-tiers');
            tiersBox.innerHTML = RISK_TIERS.map(t =>
                '<button class="risk-tier-btn' + (t.id === selectedRiskTier ? ' active' : '') + '" onclick="selectRiskTier(\\'' + t.id + '\\')">' +
                t.name + ' — ×' + t.mult + ' (' + Math.round(t.chance * 100) + '% шанс)</button>'
            ).join('');
            renderMemoryState();
        }
        window.selectRiskTier = (tierId) => { selectedRiskTier = tierId; renderMinigames(); };

        window.playCoinflip = async () => {
            const stake = Math.floor(Number(document.getElementById('coinflip-stake').value));
            if (!stake) return tg.showAlert('Введи ставку');
            const res = await apiFetch('/api/minigame/coinflip', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, stake })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance;
            const box = document.getElementById('coinflip-result');
            box.classList.remove('hidden');
            box.innerHTML = data.won
                ? '<span style="color:#39ff14;">🎉 Виграв +' + fmtNum(data.stake) + ' ТК!</span>'
                : '<span style="color:#ff8a8a;">💸 Програв ' + fmtNum(data.stake) + ' ТК</span>';
            tg.HapticFeedback.notificationOccurred(data.won ? 'success' : 'error');
            if (data.unlockedAchievements && data.unlockedAchievements.length) { data.unlockedAchievements.forEach(a => state.achievements.push(a.id)); renderAchievements(); }
            updateUI();
        };

        window.playRisk = async () => {
            const stake = Math.floor(Number(document.getElementById('risk-stake').value));
            if (!stake) return tg.showAlert('Введи ставку');
            const res = await apiFetch('/api/minigame/risk', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, stake, tierId: selectedRiskTier })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance;
            const box = document.getElementById('risk-result');
            box.classList.remove('hidden');
            box.innerHTML = data.won
                ? '<span style="color:#39ff14;">🎉 Виграв ×' + data.mult + '!</span>'
                : '<span style="color:#ff8a8a;">💸 Програв ' + fmtNum(data.stake) + ' ТК</span>';
            tg.HapticFeedback.notificationOccurred(data.won ? 'success' : 'error');
            if (data.unlockedAchievements && data.unlockedAchievements.length) { data.unlockedAchievements.forEach(a => state.achievements.push(a.id)); renderAchievements(); }
            updateUI();
        };

        window.startMemoryGame = async () => {
            const res = await apiFetch('/api/minigame/memory/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance;
            state.memoryGame = { cardsCount: data.cardsCount, revealed: new Array(data.cardsCount).fill(false), matchedPairs: 0, flips: 0, firstPick: null };
            updateUI();
            renderMemoryState();
        };

        let memoryFlipping = false; // блокує подвійний тап, поки чекаємо відповідь сервера
        window.flipMemoryCard = async (index) => {
            if (memoryFlipping || !state.memoryGame) return;
            const g = state.memoryGame;
            if (g.revealed[index] || index === g.firstPick) return;
            memoryFlipping = true;
            const res = await apiFetch('/api/minigame/memory/flip', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, index })
            });
            const data = await res.json();
            memoryFlipping = false;
            if (!data.success) { tg.showAlert(data.message || 'Помилка'); return; }

            if (data.waitingForSecond) {
                g.firstPick = index;
                g.firstValue = data.value;
                renderMemoryState();
                return;
            }

            g.flips = data.flips;
            g.matchedPairs = data.matchedPairs;
            const firstIndex = data.firstIndex;
            const firstValue = g.firstValue;
            g.firstPick = null;
            if (data.matched) {
                g.revealed[firstIndex] = true;
                g.revealed[index] = true;
                renderMemoryState();
            } else {
                // Коротко показуємо обидві картки (сервер уже порахував матч,
                // це суто клієнтська анімація), потім ховаємо назад.
                renderMemoryState({ [firstIndex]: firstValue, [index]: data.value });
                memoryFlipping = true;
                setTimeout(() => { memoryFlipping = false; renderMemoryState(); }, 900);
            }
            if (data.gameOver) {
                state.balance = data.balance;
                state.memoryGame = null;
                tg.HapticFeedback.notificationOccurred('success');
                setTimeout(() => tg.showAlert('🃏 Готово за ' + data.flips + ' спроб! +' + fmtNum(data.reward) + ' ТК'), 950);
                if (data.unlockedAchievements && data.unlockedAchievements.length) { data.unlockedAchievements.forEach(a => state.achievements.push(a.id)); renderAchievements(); }
                updateUI();
            }
        };

        // tempPeek — {index: value} для короткого показу картки, що не збіглась.
        function renderMemoryState(tempPeek) {
            const startWrap = document.getElementById('memory-start-wrap');
            const board = document.getElementById('memory-board');
            const status = document.getElementById('memory-status');
            const g = state.memoryGame;
            if (!g) {
                startWrap.classList.remove('hidden');
                board.classList.add('hidden');
                status.innerText = '';
                return;
            }
            startWrap.classList.add('hidden');
            board.classList.remove('hidden');
            status.innerText = 'Спроб: ' + g.flips + ' · Пар знайдено: ' + g.matchedPairs + '/4';
            board.innerHTML = '';
            for (let i = 0; i < g.cardsCount; i++) {
                const div = document.createElement('div');
                const matched = g.revealed[i];
                const peeking = tempPeek && (i in tempPeek);
                const isFirstPick = i === g.firstPick;
                div.className = 'memory-card' + (matched ? ' matched' : ((peeking || isFirstPick) ? ' flipped' : ''));
                if (matched) div.textContent = '✓';
                else if (peeking) div.textContent = tempPeek[i];
                else if (isFirstPick) div.textContent = g.firstValue;
                else div.textContent = '';
                if (!matched && !peeking) div.onclick = () => flipMemoryCard(i);
                board.appendChild(div);
            }
        }

        // ===== Щоденна нагорода =====
        window.claimDaily = async () => {
            try {
                let res = await apiFetch('/api/daily', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id })
                });
                let data = await res.json();
                if (!data.claimed) return tg.showAlert(data.message || 'Пайок вже забрано сьогодні.');
                state.balance = data.balance; state.dailyStreak = data.streak;
                tg.showAlert('🎁 День ' + data.streak + '/7! Отримано пайок: +' + data.reward + ' ТК!');
                tg.HapticFeedback.notificationOccurred('success');
                updateUI();
            } catch (e) { tg.showAlert('Помилка отримання пайка'); }
        };

        // ===== Помста інспектору =====
        function renderRevengeTab() {
            const lockedNote = document.getElementById('revenge-locked-note');
            const btn = document.getElementById('revenge-btn');
            if (!state.revengeUnlocked) {
                lockedNote.classList.remove('hidden');
                lockedNote.innerText = '🔒 Розблокується після ' + ECONOMY.REVENGE_UNLOCK_RAIDS + ' виживаних облав. Твій прогрес: ' + state.raidsSurvived + '/' + ECONOMY.REVENGE_UNLOCK_RAIDS + '.';
                btn.disabled = true;
                btn.innerText = '🔒 Ще недоступно';
            } else {
                lockedNote.classList.add('hidden');
                btn.disabled = state.revengeClaimedToday;
                btn.innerText = state.revengeClaimedToday ? 'Сьогодні вже помстився' : '😈 Помститись';
            }
        }

        window.takeRevenge = async () => {
            const res = await apiFetch('/api/revenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id }) });
            const data = await res.json();
            if (!data.success) {
                if (data.locked) { renderRevengeTab(); return; }
                return tg.showAlert(data.message || 'Помилка');
            }
            state.balance = data.balance; state.revengeClaimedToday = true;
            const resultEl = document.getElementById('revenge-result');
            resultEl.classList.remove('hidden');
            resultEl.innerText = '😈 ' + data.line + ' (+' + data.reward + ' 🪙)';
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            renderRevengeTab();
        };

        // ===== Рефералка =====
        window.copyRef = () => {
            let input = document.getElementById('ref-link');
            input.select();
            document.execCommand('copy');
            tg.showAlert('Посилання скопійовано! Надішли його другу.');
        };

        // ===== Промокоди та VIP =====
        window.usePromo = async () => {
            let val = document.getElementById('promo').value.trim();
            if (!val) return;
            try {
                let res = await apiFetch('/api/promo', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, code: val })
                });
                let data = await res.json();
                if (data.success) {
                    document.getElementById('promo').value = '';
                    if (data.reset || data.fullSync) {
                        await init(); // повне обнулення/розробницький анлок — перетягуємо весь стан з сервера заново, а не патчимо шматками
                    } else {
                        state.balance = data.balance; state.isVip = data.isVip;
                        if (data.resources) { state.resources = data.resources; state.storageUsed = data.used; }
                        // Код-телепорт схрону (SXRON1..SXRON8) — рівень/енергія міняються
                        // одразу, applyLocation() усередині updateUI() підхопить і назву
                        // локації, і фон усього застосунку.
                        if (typeof data.level === 'number') state.level = data.level;
                        if (typeof data.maxEnergy === 'number') state.maxEnergy = data.maxEnergy;
                        if (typeof data.energy === 'number') state.energy = data.energy;
                        updateUI();
                        // Код на ящик — та сама анімація відкривання, що й у купленого.
                        if (data.crateBundle) { playCrateBundle(data.crateBundle); return; }
                        if (data.crateReward) { playCrateAnimation(data.crateReward, data.crateId || 'starter'); return; }
                    }
                    tg.showAlert(data.message);
                } else {
                    tg.showAlert(data.message);
                }
            } catch (e) { tg.showAlert('Помилка активації коду'); }
        };

        window.buyRealVip = async () => {
            try {
                let res = await apiFetch('/api/invoice', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, type: 'vip' })
                });
                let data = await res.json();
                if (!data.link) return tg.showAlert('Помилка створення інвойсу');
                tg.openInvoice(data.link, async (status) => {
                    if (status === 'paid') { await init(); tg.showAlert('Ти VIP!'); }
                });
            } catch (e) { tg.showAlert('Помилка генерації інвойсу'); }
        };

        window.buyDonate = async (amount) => {
            try {
                let res = await apiFetch('/api/invoice', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, type: 'donate', amount })
                });
                let data = await res.json();
                if (!data.link) return tg.showAlert('Помилка створення інвойсу');
                tg.openInvoice(data.link, (status) => {
                    if (status === 'paid') tg.showAlert('Дякуємо за підтримку! ❤️');
                });
            } catch (e) { tg.showAlert('Помилка генерації інвойсу'); }
        };

        // ===== Лідерборд =====
        async function loadTop() {
            const list = document.getElementById('leaderboard-list');
            list.innerHTML = 'Завантаження...';
            let res = await fetch('/api/leaderboard');
            let data = await res.json();
            // Тап по рядку відкриває порівняння профілів — змагання потребує видимості
            // суперника, а не просто чужої цифри в списку.
            list.innerHTML = data.map((u) =>
                '<li class="leader-row"' + (u.pid ? ' onclick="openProfile(\\'' + u.pid + '\\')"' : '') + '>' +
                (u.isVip ? '👑 ' : '') + (u.league || '') + ' ' + esc(u.name) +
                (u.seasonTitle ? '<span class="season-title-chip">' + esc(u.seasonTitle) + '</span>' : '') +
                ' - <b style="color:var(--gold)">' + fmtNum(Math.floor(u.balance)) + '</b>' +
                '<span style="font-size:10px; color:#8fa3b8;"> · 🐍' + ((u.snitch || {}).sent || 0) +
                ' 🎯' + ((u.snitch || {}).received || 0) +
                ' · 🎖️' + (u.ukhyr || 0) + ' (' + esc(u.ukhyrRank || '') + ')' +
                '</span></li>'
            ).join('') || '<li>Поки що нікого немає</li>';
        }

        // ==========================================
        // МЕХАНІКА ОБЛАВИ (БОС-ФАЙТ)
        // ==========================================
        setInterval(() => {
            // З рівня 4 (Хатина в лісі) ти вже не в місті — нема паркану/базару, щоб
            // тікати, тож облави міського типу більше не трапляються.
            if ((state.level || 1) >= 4) return;
            // Шанс облави масштабується розшуком: на 91+ heat облави вчетверо частіші,
            // ніж у "тихого" гравця. Це друга половина трейд-офу до множника доходу.
            if (state.isVip || hasShield() || Math.random() > ECONOMY.RAID_CHANCE * petMult('raid') * heatRaidMult() * mapRaidMult()) return;

            const raidScreen = document.getElementById('raid-screen');
            const timerEl = document.getElementById('raid-timer');
            const fillEl = document.getElementById('raid-fill');
            const runBtn = document.getElementById('run-btn');

            raidScreen.classList.remove('hidden');
            tg.HapticFeedback.notificationOccurred('warning');

            let timeLeft = ECONOMY.RAID_DURATION_S;
            // «Знаю прохідні двори»: перелізти паркан треба на 20% менше разів.
            let clicksNeeded = hasSkill('yards')
                ? Math.ceil(ECONOMY.RAID_CLICKS_NEEDED * (1 - ECONOMY.SKILL_ESCAPE_BONUS))
                : ECONOMY.RAID_CLICKS_NEEDED;
            let clicksDone = 0;
            fillEl.style.width = '0%';

            const runClick = (e) => {
                e.preventDefault();
                clicksDone++;
                fillEl.style.width = (clicksDone / clicksNeeded * 100) + '%';
                tg.HapticFeedback.impactOccurred('heavy');
                if (clicksDone >= clicksNeeded) endRaid(true);
            };

            runBtn.addEventListener('touchstart', runClick, { passive: false });
            runBtn.addEventListener('mousedown', runClick);

            let countdown = setInterval(() => {
                timeLeft -= 0.1;
                timerEl.innerText = timeLeft.toFixed(1);
                if (timeLeft <= 0) endRaid(false);
            }, 100);

            function endRaid(success) {
                clearInterval(countdown);
                runBtn.removeEventListener('touchstart', runClick);
                runBtn.removeEventListener('mousedown', runClick);
                raidScreen.classList.add('hidden');

                if (success) {
                    let reward = 1000 * state.level;
                    state.balance += reward;
                    state.raidsSurvived += 1;
                    tg.showAlert('🏃 Ти успішно переліз через паркан і знайшов на дорозі ' + reward + ' ТК!');
                } else {
                    let penalty = Math.floor(state.balance * 0.5);
                    state.balance -= penalty;
                    tg.showAlert('🚔 Тебе зловили на базарі! Штраф: -' + penalty + ' ТК (Половина балансу).');
                }
                updateUI();
                saveState();
            }
        }, ECONOMY.RAID_INTERVAL_MS);

        // ==========================================
        // QTE: СТУК У ДВЕРІ
        // ==========================================
        setInterval(() => {
            // Та сама причина, що й для облав вище: з Хатини в лісі (рівень 4) нема
            // міських дверей, у які могли б постукати.
            if ((state.level || 1) >= 4) return;
            if (state.isVip || hasShield() || Math.random() > ECONOMY.QTE_KNOCK_CHANCE * heatRaidMult()) return;

            const overlay = document.getElementById('knock-screen');
            const timerEl = document.getElementById('knock-timer');
            const btn = document.getElementById('knock-btn');
            overlay.classList.remove('hidden');
            tg.HapticFeedback.notificationOccurred('warning');

            let resolved = false;
            let timeLeft = ECONOMY.QTE_KNOCK_DURATION_S;

            const onClick = (e) => {
                e.preventDefault();
                if (resolved) return;
                resolved = true;
                cleanup();
                overlay.classList.add('hidden');
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert('😤 Пронесло! Ти встиг прикинутися килимом.');
            };

            function cleanup() {
                clearInterval(countdown);
                btn.removeEventListener('touchstart', onClick);
                btn.removeEventListener('mousedown', onClick);
            }

            btn.addEventListener('touchstart', onClick, { passive: false });
            btn.addEventListener('mousedown', onClick);

            let countdown = setInterval(() => {
                timeLeft -= 0.1;
                timerEl.innerText = timeLeft.toFixed(1);
                if (timeLeft <= 0 && !resolved) {
                    resolved = true;
                    cleanup();
                    overlay.classList.add('hidden');
                    let penalty = Math.floor(state.balance * ECONOMY.QTE_KNOCK_PENALTY_PCT);
                    state.balance -= penalty;
                    tg.HapticFeedback.notificationOccurred('error');
                    tg.showAlert('🚪 Не встиг! Штраф: -' + penalty + ' ТК.');
                    updateUI();
                    saveState();
                }
            }, 100);
        }, ECONOMY.QTE_KNOCK_INTERVAL_MS);

        // ==========================================
        // АІРДРОПИ: ГОЛУБ МИРУ / ДРОН З ПОВІСТКОЮ
        // ==========================================
        setInterval(() => {
            // Чим більше друзів дало згоду на рекламу, тим частіше падає халява
            // всім — множник рахує сервер і віддає разом зі станом гравця.
            if (Math.random() > ECONOMY.AIRDROP_CHANCE * (state.adAirdropMult || 1)) return;
            const isDrone = Math.random() < 0.5;
            const el = document.createElement('div');
            el.className = 'airdrop';
            el.innerText = isDrone ? '🛸' : '🕊️';
            el.style.left = (Math.random() * 70 + 10) + 'vw';
            el.style.top = (Math.random() * 40 + 15) + 'vh';
            document.body.appendChild(el);

            let caught = false;
            const catchIt = (e) => {
                e.preventDefault();
                if (caught) return;
                caught = true;
                const bonus = Math.floor(Math.random() * (ECONOMY.AIRDROP_MAX - ECONOMY.AIRDROP_MIN)) + ECONOMY.AIRDROP_MIN;
                state.balance += bonus;
                const x = e.touches ? e.touches[0].clientX : e.clientX;
                const y = e.touches ? e.touches[0].clientY : e.clientY;
                showFloat(x, y, '+' + bonus);
                tg.HapticFeedback.impactOccurred('medium');
                el.remove();
                updateUI();
                saveState();
            };
            el.addEventListener('touchstart', catchIt, { passive: false });
            el.addEventListener('mousedown', catchIt);
            setTimeout(() => { if (!caught) el.remove(); }, 3000);
        }, ECONOMY.AIRDROP_INTERVAL_MS);
    </script>
</body>
</html>
`;
}

// Роздаємо HTML
// Гра часто змінюється, а Telegram WebView інакше може кешувати цю сторінку
// й показувати стару (зокрема — стару баговану версію) без запиту на сервер
// при повторному відкритті бота. no-store змушує завжди брати свіжу версію.
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(HTML_CONTENT);
});

// ==========================================
// 9. ЗАПУСК
// ==========================================
async function main() {
    console.log('⏳ Крок 1/4: перевіряю токен (getMe)...');
    const me = await bot.telegram.getMe();
    console.log(`✅ Крок 1/4 готово: бот @${me.username}`);
    BOT_USERNAME = me.username;
    HTML_CONTENT = buildHtml(BOT_USERNAME);

    if (USE_WEBHOOK) {
        app.use(bot.webhookCallback(WEBHOOK_PATH));
    }

    console.log('⏳ Крок 2/4: піднімаю HTTP-сервер...');
    app.listen(PORT, () => {
        console.log(`✅ Крок 2/4 готово: сервер на порту ${PORT}`);
    });

    if (USE_WEBHOOK) {
        const webhookUrl = WEB_APP_URL.replace(/\/$/, '') + WEBHOOK_PATH;
        console.log('⏳ Крок 3/4: реєструю webhook: ' + webhookUrl);
        await bot.telegram.setWebhook(webhookUrl);
        console.log('✅ Крок 3/4 готово: webhook зареєстровано');
        console.log('⏳ Крок 4/4: (у webhook-режимі окремого запуску не треба)');
        console.log(`✅ Крок 4/4 готово: 🤖 Бот @${BOT_USERNAME} працює (webhook-режим)!`);
    } else {
        console.log('⏳ Крок 3/4: знімаю webhook (якщо був)...');
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        console.log('✅ Крок 3/4 готово: webhook знято');

        console.log('⏳ Крок 4/4: запускаю long-polling до Telegram...');
        const launchTimeout = setTimeout(() => {
            console.error('⚠️  bot.launch() досі не завершився через 20 сек. Схоже, з’єднання з Telegram блокується (антивірус/файрвол/VPN/провайдер). Спробуй вимкнути антивірус/VPN і перезапустити, або лиши USE_WEBHOOK на увімкнено.');
        }, 20000);
        await bot.launch();
        clearTimeout(launchTimeout);
        console.log(`✅ Крок 4/4 готово: 🤖 Бот @${BOT_USERNAME} працює!`);
    }
}

main().catch((err) => {
    console.error('❌ Помилка запуску:', err);
    process.exit(1);
});

process.once('SIGINT', () => { saveData(); bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { saveData(); bot.stop('SIGTERM'); process.exit(0); });
