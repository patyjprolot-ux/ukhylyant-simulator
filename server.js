require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const express = require('express');

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
const app = express();
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

let BOT_USERNAME = 'YourBot';
let HTML_CONTENT = ''; // формується після старту (щоб зашити username бота в реферальні посилання)

// ==========================================
// 2. ЕКОНОМІКА ТА КОНФІГ ГРИ
// (єдине джерело правди для цін/нагород — і бек, і фронт орієнтуються на ці числа)
// ==========================================
const ECONOMY = {
    // --- Апгрейди магазину: тепер БАГАТОРІВНЕВІ (купуються нескінченно) ---
    // Ціна рівня N = base * UPGRADE_GROWTH^N. Ціни стартово низькі, але ростуть швидко —
    // це головний нескінченний сток валюти, щоб гра не проходилась за вечір.
    UPGRADE_GROWTH: 1.55,
    HAT_PRICE: 40, HAT_CLICK_BONUS: 1,
    JAM_PRICE: 150, JAM_PASSIVE_BONUS: 1,
    THERMOS_PRICE: 900, THERMOS_CLICK_BONUS: 3,
    GENERATOR_PRICE: 2200, GENERATOR_PASSIVE_BONUS: 4,
    ENERGY_DRINK_PRICE: 120,

    // --- Енергія: головний обмежувач темпу ---
    // Раніше регенерація була +2 за тік (20/сек!) — бак наповнювався за 5 секунд і
    // енергія взагалі нічого не обмежувала. Тепер ~1/сек: 100 енергії = 50 кліків,
    // повне відновлення ~100 секунд. Саме це робить прогрес повільним і осмисленим.
    ENERGY_REGEN_PER_TICK: 0.1,
    ENERGY_PER_CLICK: 2,

    // --- Еволюція схрону ---
    BASEMENT_PRICE: 1500,
    BALKAN_PRICE: 6000,
    TISA_PRICE: 25000,
    ABROAD_PRICE: 90000,
    BUNKER_PRICE: 350000,

    // --- Кладовка (склад ресурсів) ---
    STORAGE_BASE_CAPACITY: 60,
    STORAGE_CAPACITY_PER_LEVEL: 40,
    STORAGE_UPGRADE_BASE: 800,
    STORAGE_UPGRADE_GROWTH: 1.6,
    STORAGE_MAX_LEVEL: 20,

    // --- Престиж ("Легалізація") ---
    // Скидає прогрес заради постійного множника доходу. Дає грі нескінченну глибину:
    // без цього після бункера робити нічого. Очки рахуються від сумарно заробленого
    // за все життя (корінь — щоб кожне наступне очко давалось відчутно важче).
    PRESTIGE_UNLOCK_LEVEL: 6,
    PRESTIGE_EARN_PER_POINT: 500000,
    PRESTIGE_BONUS_PER_POINT: 0.10,

    REVENGE_UNLOCK_RAIDS: 3,
    REVENGE_REWARD_MIN: 80,
    REVENGE_REWARD_MAX: 220,
    VIP_PRICE_STARS: 500,
    DONATE_AMOUNTS: [50, 100, 250, 500], // Stars — чиста підтримка розробників, без ігрових бонусів
    DAILY_REWARDS: [400, 550, 700, 900, 1200, 1600, 4000], // індекс = поточний день серії - 1, індекс 6 = День 7 (джекпот)
    REFERRAL_REWARD: 1500,
    RAID_CHANCE: 0.1,
    RAID_INTERVAL_MS: 45000,
    RAID_DURATION_S: 10,
    RAID_CLICKS_NEEDED: 50,
    QTE_KNOCK_CHANCE: 0.15,
    QTE_KNOCK_INTERVAL_MS: 30000,
    QTE_KNOCK_DURATION_S: 3,
    QTE_KNOCK_PENALTY_PCT: 0.15,
    AIRDROP_CHANCE: 0.25,
    AIRDROP_INTERVAL_MS: 20000,
    AIRDROP_MIN: 60,
    AIRDROP_MAX: 180,
    CLAN_PASSIVE_BONUS: 0.05,
    OFFLINE_CAP_SECONDS: 8 * 3600,
    OFFLINE_MIN_SECONDS: 30,
    PET_GOOSE_CLICK_MULT: 1.15,
    PET_CAT_ENERGY_MULT: 1.3,
    PET_NEIGHBOR_RAID_MULT: 0.9,
};

// ==========================================
// 2.1 РЕСУРСИ ТА КЛАДОВКА
// ==========================================
// Ресурси падають із ящиків і йдуть на крафт. Кожен займає 1 місце в кладовці,
// тому місткість складу — окремий сток валюти й привід апгрейдити кладовку.
// `sell` — за скільки ТК можна здати одиницю перекупу (швидкі гроші, але крафт вигідніший).
const RESOURCES = [
    { id: 'cans', name: 'Консерви', emoji: '🥫', tier: 1, sell: 25 },
    { id: 'battery', name: 'Батарейки', emoji: '🔋', tier: 1, sell: 30 },
    { id: 'paper', name: 'Макулатура', emoji: '🧻', tier: 1, sell: 20 },
    { id: 'tape', name: 'Скотч', emoji: '🩹', tier: 1, sell: 35 },
    { id: 'meds', name: 'Ліки', emoji: '💊', tier: 2, sell: 130 },
    { id: 'fuel', name: 'Пальне', emoji: '⛽', tier: 2, sell: 160 },
    { id: 'sim', name: 'Ліві сімки', emoji: '📱', tier: 2, sell: 200 },
    { id: 'cash', name: 'Валюта', emoji: '💵', tier: 3, sell: 700 },
    { id: 'stamp', name: 'Печатка', emoji: '🔏', tier: 3, sell: 1100 },
    { id: 'ticket', name: 'Білий квиток', emoji: '🎫', tier: 4, sell: 5000 },
];
const RESOURCE_BY_ID = Object.fromEntries(RESOURCES.map((r) => [r.id, r]));

// Ящики. `loot` — таблиця дропу з вагами (шанс = вага / сума ваг). Шанси показуються
// гравцю у грі: чесний гача без прихованих ймовірностей.
// type: 'res' (ресурс), 'coins' (валюта), 'energy' (повна енергія), 'cosmetic' (випадкова
// невідкрита косметика), 'nothing' (порожньо — лише в найдешевших ящиках).
const CRATES = [
    {
        id: 'cardboard', name: 'Картонна коробка', emoji: '📦', img: '/images/gacha-box-regular.webp',
        price: 400, currency: 'coins',
        desc: 'Знайдена біля смітника. Всередині — щось. Можливо, нічого.',
        loot: [
            { type: 'nothing', weight: 18 },
            { type: 'res', res: 'paper', min: 1, max: 4, weight: 22 },
            { type: 'res', res: 'cans', min: 1, max: 3, weight: 20 },
            { type: 'res', res: 'battery', min: 1, max: 3, weight: 18 },
            { type: 'res', res: 'tape', min: 1, max: 2, weight: 12 },
            { type: 'coins', min: 300, max: 900, weight: 8 },
            { type: 'res', res: 'meds', min: 1, max: 1, weight: 2 },
        ],
    },
    {
        id: 'humanitarian', name: 'Гуманітарний ящик', emoji: '🧰', img: '/images/gacha-box-regular.webp',
        price: 2500, currency: 'coins',
        desc: 'Офіційна гумдопомога. Хтось уже перебрав, але дещо лишилось.',
        loot: [
            { type: 'nothing', weight: 8 },
            { type: 'res', res: 'cans', min: 3, max: 7, weight: 20 },
            { type: 'res', res: 'battery', min: 3, max: 6, weight: 18 },
            { type: 'res', res: 'tape', min: 2, max: 5, weight: 14 },
            { type: 'res', res: 'meds', min: 1, max: 3, weight: 15 },
            { type: 'res', res: 'fuel', min: 1, max: 2, weight: 10 },
            { type: 'coins', min: 1500, max: 4000, weight: 8 },
            { type: 'energy', weight: 5 },
            { type: 'res', res: 'sim', min: 1, max: 1, weight: 2 },
        ],
    },
    {
        id: 'parcel', name: 'Посилка від родичів', emoji: '🎁', img: '/images/gacha-box-elite.webp',
        price: 9000, currency: 'coins',
        desc: 'Тітка з-за кордону передала. Сало, ліки і трохи валюти.',
        loot: [
            { type: 'res', res: 'meds', min: 3, max: 8, weight: 20 },
            { type: 'res', res: 'fuel', min: 2, max: 6, weight: 18 },
            { type: 'res', res: 'sim', min: 2, max: 5, weight: 16 },
            { type: 'res', res: 'cans', min: 8, max: 15, weight: 12 },
            { type: 'coins', min: 6000, max: 15000, weight: 12 },
            { type: 'res', res: 'cash', min: 1, max: 2, weight: 10 },
            { type: 'cosmetic', weight: 8 },
            { type: 'res', res: 'stamp', min: 1, max: 1, weight: 4 },
        ],
    },
    {
        id: 'contraband', name: 'Контрабандний контейнер', emoji: '🚢', img: '/images/gacha-box-elite.webp',
        price: 35000, currency: 'coins',
        desc: 'Приплив по Тисі. Питань не задаємо, вміст не коментуємо.',
        loot: [
            { type: 'res', res: 'cash', min: 2, max: 6, weight: 22 },
            { type: 'res', res: 'sim', min: 5, max: 12, weight: 18 },
            { type: 'res', res: 'fuel', min: 6, max: 14, weight: 16 },
            { type: 'coins', min: 25000, max: 60000, weight: 14 },
            { type: 'res', res: 'stamp', min: 1, max: 3, weight: 12 },
            { type: 'cosmetic', weight: 10 },
            { type: 'res', res: 'ticket', min: 1, max: 1, weight: 5 },
            { type: 'energy', weight: 3 },
        ],
    },
    // --- Донатні ящики (за Telegram Stars). Жодного 'nothing' — за реальні гроші
    // скам-результат нечесний. Різні цінові рівні під різні цілі гравця. ---
    {
        id: 'starter', name: 'Стартовий пакет', emoji: '🥡', img: '/images/gacha-box-regular.webp',
        price: 25, currency: 'stars',
        desc: 'Дешевий вхід. Трохи всього, щоб розкрутитись на старті.',
        loot: [
            { type: 'res', res: 'cans', min: 10, max: 20, weight: 24 },
            { type: 'res', res: 'battery', min: 8, max: 16, weight: 22 },
            { type: 'res', res: 'meds', min: 3, max: 8, weight: 20 },
            { type: 'coins', min: 8000, max: 20000, weight: 18 },
            { type: 'res', res: 'fuel', min: 3, max: 7, weight: 12 },
            { type: 'res', res: 'cash', min: 1, max: 2, weight: 4 },
        ],
    },
    {
        id: 'elite', name: 'Елітний контейнер', emoji: '💎', img: '/images/gacha-box-elite.webp',
        price: 75, currency: 'stars',
        desc: 'Збалансований донат-ящик: ресурси середнього й високого тіру.',
        loot: [
            { type: 'res', res: 'cash', min: 4, max: 10, weight: 22 },
            { type: 'res', res: 'stamp', min: 2, max: 5, weight: 20 },
            { type: 'coins', min: 50000, max: 120000, weight: 18 },
            { type: 'res', res: 'sim', min: 10, max: 20, weight: 14 },
            { type: 'cosmetic', weight: 13 },
            { type: 'res', res: 'ticket', min: 1, max: 2, weight: 13 },
        ],
    },
    {
        id: 'wardrobe', name: 'Модна валіза', emoji: '👗', img: '/images/gacha-box-elite.webp',
        price: 150, currency: 'stars',
        desc: 'ГАРАНТОВАНО рідкісна річ у гардероб + бонус зверху. Для колекціонерів.',
        guaranteedCosmetic: true,
        loot: [
            { type: 'cosmetic', weight: 60 },
            { type: 'res', res: 'cash', min: 5, max: 12, weight: 15 },
            { type: 'coins', min: 60000, max: 140000, weight: 15 },
            { type: 'res', res: 'stamp', min: 3, max: 7, weight: 10 },
        ],
    },
    {
        id: 'legendary', name: 'Легендарний схрон', emoji: '🏆', img: '/images/gacha-premium-jackpot.webp',
        price: 250, currency: 'stars',
        desc: 'Схрон самого начальника ТЦК. Тільки топові дропи, шанс на Білі Квитки.',
        loot: [
            { type: 'res', res: 'ticket', min: 2, max: 5, weight: 25 },
            { type: 'res', res: 'stamp', min: 5, max: 12, weight: 22 },
            { type: 'res', res: 'cash', min: 10, max: 25, weight: 20 },
            { type: 'coins', min: 200000, max: 500000, weight: 18 },
            { type: 'cosmetic', weight: 15 },
        ],
    },
];
const CRATE_BY_ID = Object.fromEntries(CRATES.map((c) => [c.id, c]));

// Крафт — головний спосіб перетворити ресурси на постійні бонуси. Навмисно дорожчий
// за пряму купівлю апгрейдів, але дає те, що за валюту не купиш (щити, множники).
const RECIPES = [
    {
        id: 'energy_pack', name: 'Саморобний енергопак', emoji: '🔌',
        cost: { battery: 6, tape: 3 },
        desc: 'Повністю відновлює енергію',
        effect: { type: 'energy' },
    },
    {
        id: 'click_mod', name: 'Прокачаний мозоль', emoji: '💪',
        cost: { tape: 10, battery: 8, cans: 5 },
        desc: '+4 до сили кліку (назавжди)',
        effect: { type: 'click', amount: 4 },
    },
    {
        id: 'passive_scheme', name: 'Схема з гумштабом', emoji: '📋',
        cost: { paper: 15, cans: 12, meds: 4 },
        desc: '+5 до пасивного доходу (назавжди)',
        effect: { type: 'passive', amount: 5 },
    },
    {
        id: 'fake_note', name: 'Липова довідка', emoji: '📄',
        cost: { paper: 20, stamp: 1, meds: 5 },
        desc: 'Щит від облав на 2 години',
        effect: { type: 'shield', hours: 2 },
    },
    {
        id: 'smuggle_kit', name: 'Набір контрабандиста', emoji: '🎒',
        cost: { fuel: 12, sim: 8, cash: 3 },
        desc: 'Продається перекупу за 40 000 ТК',
        effect: { type: 'coins', amount: 40000 },
    },
    {
        id: 'energy_tank', name: 'Розширений бак', emoji: '🛢️',
        cost: { fuel: 20, tape: 15, cash: 2 },
        desc: '+25 до максимальної енергії (назавжди)',
        effect: { type: 'maxEnergy', amount: 25 },
    },
    {
        id: 'golden_stamp', name: 'Золота печатка', emoji: '🏅',
        cost: { stamp: 8, cash: 10, ticket: 1 },
        desc: '+15 до сили кліку та +20 до пасиву (назавжди)',
        effect: { type: 'combo', click: 15, passive: 20 },
    },
    {
        id: 'white_ticket', name: 'Справжній Білий Квиток', emoji: '🎫',
        cost: { ticket: 5, stamp: 15, cash: 25 },
        desc: 'ПОСТІЙНИЙ імунітет до облав. Фінальна ціль гри.',
        effect: { type: 'permanent_shield' },
    },
];
const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// Вилазки — офлайн-механіка: відправив персонажа й чекаєш реальний час. Дає ресурси
// без кліків, але з ризиком спалитись (тоді здобич втрачено). Довші вилазки — більше
// здобичі й більший ризик. Одночасно може бути тільки одна.
const EXPEDITIONS = [
    {
        id: 'dumpster', name: 'Рейд по смітниках', emoji: '🗑️', minutes: 30, minLevel: 1, risk: 0.10,
        desc: 'Швидко й майже безпечно. Багато не назбираєш.',
        loot: [{ res: 'paper', min: 4, max: 10 }, { res: 'cans', min: 3, max: 8 }, { res: 'tape', min: 1, max: 4 }],
    },
    {
        id: 'market', name: 'Вилазка на ринок', emoji: '🏪', minutes: 120, minLevel: 2, risk: 0.18,
        desc: 'Треба показатись людям. Ризик, що впізнають.',
        loot: [{ res: 'cans', min: 8, max: 18 }, { res: 'battery', min: 5, max: 12 }, { res: 'meds', min: 2, max: 5 }],
    },
    {
        id: 'warehouse', name: 'Нічний склад', emoji: '🏭', minutes: 480, minLevel: 3, risk: 0.25,
        desc: 'Вісім годин у чужому складі. Здобич серйозна.',
        loot: [{ res: 'meds', min: 6, max: 14 }, { res: 'fuel', min: 5, max: 12 }, { res: 'sim', min: 3, max: 8 }],
    },
    {
        id: 'border', name: 'Прогулянка до кордону', emoji: '🌲', minutes: 720, minLevel: 5, risk: 0.35,
        desc: 'Дванадцять годин лісом. Найризикованіше, але й найцінніше.',
        loot: [{ res: 'cash', min: 2, max: 6 }, { res: 'stamp', min: 1, max: 3 }, { res: 'fuel', min: 8, max: 20 }],
    },
];
const EXPEDITION_BY_ID = Object.fromEntries(EXPEDITIONS.map((e) => [e.id, e]));

// 4 етапи еволюції схованки. `img` — квадратна картинка для головної кнопки-клікера
// (персонаж по центру). `roomImg` — окрема широка картинка для екрана "Кімната"
// (персонаж стоїть анфас у правій третині кадру, ліва частина — кімната з місцем
// під декор). Поки roomImg не заданий для локації — екран "Кімната" підставляє img
// замість неї (буде виглядати не ідеально, це очікувано до генерації нової картинки).
const LOCATIONS = [
    { level: 1, name: 'Бабусин Диван', img: '/images/location-1-couch.webp', roomImg: '/images/room-1-couch.webp', maxEnergy: 100 },
    { level: 2, name: 'Вологий Підвал', img: '/images/location-2-basement.webp', roomImg: '/images/room-2-basement.webp', maxEnergy: 150 },
    { level: 3, name: 'Балканська хатинка', img: '/images/location-3-balkan.webp', roomImg: '/images/room-3-balkan.webp', maxEnergy: 220 },
    { level: 4, name: 'Човен на Тисі', img: '/images/location-3-boat.webp', maxEnergy: 300 },
    { level: 5, name: 'Закордон (Гуманітарний коридор)', emoji: '🛂', img: '/images/location-5-abroad.webp', roomImg: '/images/room-5-abroad.webp', maxEnergy: 400 },
    { level: 6, name: 'Президентський бункер', emoji: '🏛️', img: '/images/location-6-bunker.webp', maxEnergy: 500 },
];

// Компаньйони — пасивні мультиплікатори, екіпірується один одночасно.
const PETS = [
    { id: 'neighbor', name: 'Сусідка-пліткарка', img: '/images/pet-neighbor.webp', price: 3000, desc: '-10% до шансу облави (попереджає завчасно)' },
    { id: 'goose', name: 'Бойовий Гусак', img: '/images/pet-goose.webp', price: 8000, desc: '+15% до сили кліку' },
    { id: 'cat', name: 'Кіт-антистрес', img: '/images/pet-cat.webp', price: 6000, desc: '+30% до швидкості відновлення енергії' },
    { id: 'dog', name: 'Двірняга-нюхач', emoji: '🐕', price: 15000, desc: '+40% здобичі з вилазок (винюхує краще)' },
    { id: 'rat', name: 'Щур-розвідник', emoji: '🐀', price: 25000, desc: '-50% до ризику спалитись на вилазці' },
    { id: 'pigeon', name: 'Голуб-курʼєр', emoji: '🕊️', price: 40000, desc: 'Вилазки тривають на 25% менше часу' },
];
// Множники компаньйонів для вилазок (усе інше — у ECONOMY.PET_*).
const PET_EXPEDITION = {
    dog: { lootMult: 1.4 },
    rat: { riskMult: 0.5 },
    pigeon: { timeMult: 0.75 },
};

// Гардероб — суто косметичні CSS/emoji-оверлеї на персонажі (без нових зображень),
// по одному предмету на слот одночасно. Жодного впливу на економіку.
const COSMETICS = [
    // Головні убори
    { id: 'cap', slot: 'hat', name: 'Кепка контрабандиста', emoji: '🧢', img: '/images/cosmetic-hat-cap.webp', price: 800 },
    { id: 'ushanka', slot: 'hat', name: 'Вушанка діда', emoji: '🪖', img: '/images/cosmetic-hat-ushanka.webp', price: 1200 },
    { id: 'strawhat', slot: 'hat', name: 'Дачний бриль', emoji: '👒', img: '/images/cosmetic-hat-strawhat.webp', price: 900 },
    { id: 'helmet', slot: 'hat', name: 'Каска "про всяк випадок"', emoji: '⛑️', img: '/images/cosmetic-hat-helmet.webp', price: 1800 },
    { id: 'tophat', slot: 'hat', name: 'Циліндр авторитету', emoji: '🎩', img: '/images/cosmetic-hat-tophat.webp', price: 2500 },
    { id: 'gradcap', slot: 'hat', name: 'Диплом "поважної причини"', emoji: '🎓', img: '/images/cosmetic-hat-gradcap.webp', price: 3000 },
    { id: 'crown', slot: 'hat', name: 'Корона Мажора', emoji: '👑', img: '/images/cosmetic-hat-crown.webp', price: 5000 },
    { id: 'bucket', slot: 'hat', name: 'Каска з відра', emoji: '🪣', img: '/images/cosmetic-hat-bucket.webp', price: 600 },
    { id: 'bush', slot: 'hat', name: 'Кущ-камуфляж', emoji: '🪴', img: '/images/cosmetic-hat-bush.webp', price: 1100 },
    { id: 'pumpkin', slot: 'hat', name: 'Гарбузовий шолом', emoji: '🎃', img: '/images/cosmetic-hat-pumpkin.webp', price: 1300 },
    { id: 'mushroom', slot: 'hat', name: 'Капелюх-гриб', emoji: '🍄', img: '/images/cosmetic-hat-mushroom.webp', price: 1000 },
    { id: 'sock_hat', slot: 'hat', name: 'Шкарпетка на голові', emoji: '🧦', price: 700 },
    { id: 'target', slot: 'hat', name: 'Мішень (для адреналіну)', emoji: '🎯', img: '/images/cosmetic-hat-target.webp', price: 2200 },
    { id: 'toiletpaper', slot: 'hat', name: 'Рулон замість шапки', emoji: '🧻', img: '/images/cosmetic-hat-toiletpaper.webp', price: 500 },
    { id: 'umbrella_hat', slot: 'hat', name: 'Капелюх-парасолька', emoji: '☂️', img: '/images/cosmetic-hat-umbrella.webp', price: 1400 },
    { id: 'coconut', slot: 'hat', name: 'Кокосовий шолом', emoji: '🥥', img: '/images/cosmetic-hat-coconut.webp', price: 1600 },
    { id: 'icecube', slot: 'hat', name: 'Крижаний компрес на голові', emoji: '🧊', img: '/images/cosmetic-hat-icecube.webp', price: 900 },
    // Маскування обличчя
    { id: 'glasses', slot: 'face', name: 'Ботанічні окуляри', emoji: '👓', img: '/images/cosmetic-face-glasses.webp', price: 600 },
    { id: 'clown', slot: 'face', name: 'Клоунський ніс', emoji: '🤡', img: '/images/cosmetic-face-clown.webp', price: 500 },
    { id: 'mask', slot: 'face', name: 'Медична довідка-маска', emoji: '😷', img: '/images/cosmetic-face-mask.webp', price: 700 },
    { id: 'sunglasses', slot: 'face', name: 'Чорні окуляри', emoji: '🕶️', img: '/images/cosmetic-face-sunglasses.webp', price: 1000 },
    { id: 'disguise', slot: 'face', name: 'Маскування (вуса+окуляри)', emoji: '🥸', img: '/images/cosmetic-face-disguise.webp', price: 1800 },
    { id: 'ninja', slot: 'face', name: 'Ніндзя-маскування', emoji: '🥷', img: '/images/cosmetic-face-ninja.webp', price: 2200 },
    { id: 'oni', slot: 'face', name: 'Маска чорта', emoji: '👹', img: '/images/cosmetic-face-oni.webp', price: 2000 },
    { id: 'tengu', slot: 'face', name: 'Маска гобліна', emoji: '👺', img: '/images/cosmetic-face-tengu.webp', price: 2000 },
    { id: 'skull', slot: 'face', name: 'Маска смерті', emoji: '💀', img: '/images/cosmetic-face-skull.webp', price: 2600 },
    { id: 'theater', slot: 'face', name: 'Театральна маска', emoji: '🎭', img: '/images/cosmetic-face-theater.webp', price: 1900 },
    { id: 'goggles', slot: 'face', name: 'Захисні окуляри', emoji: '🥽', img: '/images/cosmetic-face-goggles.webp', price: 1100 },
    { id: 'bear', slot: 'face', name: 'Маска ведмедя', emoji: '🐻', img: '/images/cosmetic-face-bear.webp', price: 1700 },
    { id: 'wolf', slot: 'face', name: 'Маска вовка', emoji: '🐺', img: '/images/cosmetic-face-wolf.webp', price: 1700 },
    { id: 'fox', slot: 'face', name: 'Маска лисиці', emoji: '🦊', img: '/images/cosmetic-face-fox.webp', price: 1700 },
    { id: 'boar', slot: 'face', name: 'Маска кабана', emoji: '🐗', img: '/images/cosmetic-face-boar.webp', price: 1700 },
    { id: 'pig', slot: 'face', name: 'Маска порося', emoji: '🐷', img: '/images/cosmetic-face-pig.webp', price: 1700 },
    // Аксесуар на шию
    { id: 'bowtie', slot: 'neck', name: 'Метелик "для солідності"', emoji: '🎀', img: '/images/cosmetic-neck-bowtie.webp', price: 700 },
    { id: 'scarf', slot: 'neck', name: 'Шарф ухилянта', emoji: '🧣', img: '/images/cosmetic-neck-scarf.webp', price: 900 },
    { id: 'tie', slot: 'neck', name: 'Діловий галстук', emoji: '👔', img: '/images/cosmetic-neck-tie.webp', price: 1500 },
    { id: 'medal', slot: 'neck', name: 'Медаль "За хоробрість втечі"', emoji: '🎖️', img: '/images/cosmetic-neck-medal.webp', price: 3500 },
    { id: 'chain', slot: 'neck', name: 'Золотий ланцюг авторитета', emoji: '🔗', price: 2400 },
    { id: 'beads', slot: 'neck', name: 'Чотки на удачу', emoji: '📿', price: 1300 },
    { id: 'sportmedal', slot: 'neck', name: 'Спортивна медаль', emoji: '🏅', price: 2000 },
    { id: 'goldmedal', slot: 'neck', name: 'Золота медаль чемпіона', emoji: '🥇', price: 3000 },
    { id: 'nazar', slot: 'neck', name: 'Амулет від зурочення', emoji: '🧿', price: 1600 },
    { id: 'gem', slot: 'neck', name: 'Діамантовий кулон', emoji: '💎', price: 4500 },
    { id: 'volunteer_ribbon', slot: 'neck', name: 'Волонтерська стрічка', emoji: '🎗️', price: 800 },
    { id: 'bell', slot: 'neck', name: 'Дзвіночок (як у кота)', emoji: '🔔', price: 600 },
    { id: 'headphones', slot: 'neck', name: 'Навушники на шиї', emoji: '🎧', price: 1900 },
    { id: 'bone', slot: 'neck', name: 'Кістка на шнурку', emoji: '🦴', price: 700 },
    // Рамки клікера (суцільне світіння) + дві анімовані
    { id: 'frame_red', slot: 'frame', name: 'Червона рамка небезпеки', color: '#c3073f', price: 1500 },
    { id: 'frame_gold', slot: 'frame', name: 'Золота рамка', color: '#ffd700', price: 2500 },
    { id: 'frame_neon', slot: 'frame', name: 'Неонова рамка', color: '#00e5ff', price: 2000 },
    { id: 'frame_pink', slot: 'frame', name: 'Рожева рамка', color: '#ff2ea6', price: 1800 },
    { id: 'frame_toxic', slot: 'frame', name: 'Токсична рамка', color: '#39ff14', price: 2000 },
    { id: 'frame_royal', slot: 'frame', name: 'Королівська рамка', color: '#9c27b0', price: 2800 },
    { id: 'frame_ice', slot: 'frame', name: 'Крижана рамка', color: '#7df9ff', price: 1700 },
    { id: 'frame_blood', slot: 'frame', name: 'Кривава рамка', color: '#8b0000', price: 1600 },
    { id: 'frame_lime', slot: 'frame', name: 'Лаймова рамка', color: '#ccff00', price: 1800 },
    { id: 'frame_amber', slot: 'frame', name: 'Бурштинова рамка', color: '#ffbf00', price: 1900 },
    { id: 'frame_violet', slot: 'frame', name: 'Фіолетова рамка', color: '#6a00ff', price: 2100 },
    { id: 'frame_white', slot: 'frame', name: 'Біла рамка', color: '#f5f5f5', price: 1500 },
    { id: 'frame_teal', slot: 'frame', name: "М'ятна рамка", color: '#00ffab', price: 1900 },
    { id: 'frame_magenta', slot: 'frame', name: 'Магентова рамка', color: '#d500f9', price: 2200 },
    { id: 'frame_steel', slot: 'frame', name: 'Сталева рамка', color: '#90a4ae', price: 1400 },
    { id: 'frame_rainbow', slot: 'frame', name: 'Веселкова рамка (анімована)', color: 'rainbow', price: 6000 },
    { id: 'frame_siren', slot: 'frame', name: 'Сирена (анімована)', color: 'siren', price: 5500 },
];

// Щоденні квести — прогрес рахується з опівночі (questsDate), окремо від lifetime-лічильників.
const QUESTS = [
    { id: 'q_clicks', name: 'Розігрів', desc: 'Зроби 200 кліків сьогодні', target: 200, reward: 350, metric: 'dailyClicks' },
    { id: 'q_trade', name: 'Спекулянт', desc: 'Заверши 3 угоди на біржі сьогодні', target: 3, reward: 300, metric: 'dailyTrades' },
    { id: 'q_gacha', name: 'Розпакування', desc: 'Відкрий 2 ящики сьогодні', target: 2, reward: 400, metric: 'dailyBoxes' },
    { id: 'q_raid', name: 'Втікач', desc: 'Переживи 1 облаву сьогодні', target: 1, reward: 350, metric: 'dailyRaids' },
    { id: 'q_craft', name: 'Умілі руки', desc: 'Скрафти 1 предмет сьогодні', target: 1, reward: 600, metric: 'dailyCrafts' },
    { id: 'q_res', name: 'Мародер', desc: 'Назбирай 25 ресурсів сьогодні', target: 25, reward: 500, metric: 'dailyResources' },
];

// Речі для декору кімнати — можна володіти й показувати одразу кількома (на відміну від
// гардеробу персонажа, де один предмет на слот). Кожна річ має фіксовану позицію в кімнаті.
const ROOM_ITEMS = [
    { id: 'lamp', name: 'Лампа затишку', emoji: '💡', price: 500, pos: 'top-left' },
    { id: 'poster', name: 'Постер альпійських краєвидів', emoji: '🖼️', price: 400, pos: 'top-center' },
    { id: 'tv', name: 'Старий телевізор', emoji: '📺', price: 1200, pos: 'top-right' },
    { id: 'plant', name: 'Вазон з фікусом', emoji: '🪴', price: 600, pos: 'mid-left' },
    { id: 'clock', name: 'Годинник із зозулею', emoji: '🕰️', price: 800, pos: 'mid-right' },
    { id: 'radio', name: 'Радіоприймач', emoji: '📻', price: 700, pos: 'bottom-left' },
    { id: 'rug', name: 'Килимок для конспірації', img: '/images/qte-rug.webp', price: 900, pos: 'bottom-center' },
    { id: 'suitcase', name: 'Тривожна валізка', emoji: '🧳', price: 1100, pos: 'bottom-right' },
    // Другий ряд декору — дорожчий, для тих, хто вже обставився
    { id: 'fridge', name: 'Холодильник із запасами', emoji: '🧊', price: 2500, pos: 'mid-center' },
    { id: 'guitar', name: 'Гітара для нудьги', emoji: '🎸', price: 1800, pos: 'top-far-left' },
    { id: 'books', name: 'Стос книжок "про запас"', emoji: '📚', price: 1400, pos: 'mid-far-left' },
    { id: 'cactus', name: 'Кактус-мовчун', emoji: '🌵', price: 1600, pos: 'bottom-far-left' },
    { id: 'trophy', name: 'Кубок "Найкращий син"', emoji: '🏆', price: 3200, pos: 'top-far-right' },
    { id: 'safe', name: 'Сейф із заначкою', emoji: '🔐', price: 5000, pos: 'mid-far-right' },
];

// Дрібна ненасильницька помста інспектору — розблоковується після кількох виживаних
// облав (ECONOMY.REVENGE_UNLOCK_RAIDS), 1 раз/день, суто флейвор-текст + маленька нагорода.
const REVENGE_LINES = [
    'Ти підмінив його ручку на ту, що не пише — підписання паперів зірвано на пів дня.',
    'Ти переклеїв табличку на його кабінеті на "ВИХІД" — тепер до нього ніхто не потрапляє.',
    'Ти анонімно надіслав йому коробку гуманітарки — а там самі діряві шкарпетки.',
    'Ти поставив його будильник на 5 ранку — тепер він теж не виспався.',
    'Ти пригостив його чаєм з дуже гострим перцем — засідання довелося перенести.',
    'Ти розповів йому довгу історію про сусідку-пліткарку — він забув, навіщо приходив.',
    'Ти сховав його улюблену печатку — папери почекають до понеділка.',
    'Ти включив йому на телефоні будильник із гуком гусака на повну гучність.',
];

// Тіньова біржа — курси гуляють кожні 3 хв (див. tickMarket нижче).
const MARKET_ASSETS = [
    { id: 'buckwheat', name: 'Гречка', emoji: '🌾', basePrice: 100 },
    { id: 'salt', name: 'Сіль', emoji: '🧂', basePrice: 50 },
    { id: 'tushonka', name: 'Тушонка', emoji: '🥫', basePrice: 300 },
];

// Колесо Зради та Перемоги — 1 безкоштовний прокрут/день, результат обирає сервер.
const WHEEL_SEGMENTS = [
    { label: '150 🪙', type: 'balance', amount: 150, weight: 24, color: '#4e4e50' },
    { label: '300 🪙', type: 'balance', amount: 300, weight: 18, color: '#c3073f' },
    { label: 'Нічого', type: 'none', amount: 0, weight: 18, color: '#2a2a2d' },
    { label: 'Ресурс', type: 'resource', tier: 1, weight: 14, color: '#2e7d32' },
    { label: '700 🪙', type: 'balance', amount: 700, weight: 12, color: '#4e4e50' },
    { label: 'Енергія', type: 'energy', amount: 0, weight: 8, color: '#2b5c8f' },
    { label: 'Рідкісний ресурс', type: 'resource', tier: 2, weight: 5, color: '#6a1b9a' },
    { label: 'ДЖЕКПОТ 5000', type: 'balance', amount: 5000, weight: 1, color: '#ffd700' },
];

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
    { id: 'level_5', name: 'За кордоном', desc: 'Досягни 5 рівня схрону', reward: 6000, check: (u) => u.level >= 5 },
    { id: 'level_6', name: 'Найвищий пост', desc: 'Досягни 6 рівня схрону', reward: 20000, check: (u) => u.level >= 6 },
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
];
const ACHIEVEMENTS_META = ACHIEVEMENTS.map(({ id, name, desc, reward }) => ({ id, name, desc, reward }));

// Коди для друзів/тестувальників — повністю байпасять монетизацію.
const PROMO_CODES = {
    MAMYN_SYNOK: { type: 'vip' },
    TISA_SWIMMER: { type: 'balance', amount: 5000 },
    FREE_STARS: { type: 'balance', amount: 10000 }, // символічний бонус ТК; реальні Telegram Stars неможливо і не можна видати кодом
    NEVYCHERPNO: { type: 'infinite_money' }, // читерський код для тестів/жарту — ставить баланс у практично нескінченне число
    OBNULYUVACH: { type: 'reset' }, // повністю скидає прогрес гравця (в т.ч. знімає "нескінченний" баланс) до чистого старту
};

// ==========================================
// 3. "БАЗА ДАНИХ" (у пам'яті процесу — навмисно просто, це жартівливий проєкт для друзів)
// ==========================================
const usersDB = new Map();
const clansDB = new Map();

// Просте збереження на диск у JSON-файл — не БД, але переживає засинання/рестарт
// безкоштовного інстансу Render (диск ефемерний і скидається лише при новому деплої).
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'gamedata.json');

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        (parsed.users || []).forEach((u) => usersDB.set(u.id, u));
        (parsed.clans || []).forEach((c) => clansDB.set(c.id, c));
        console.log(`💾 Завантажено збережений прогрес: ${usersDB.size} гравців, ${clansDB.size} чатів.`);
    } catch (e) {
        console.error('⚠️  Не вдалося завантажити збережені дані, стартую з чистого стану:', e.message);
    }
}

function saveData() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const payload = { users: Array.from(usersDB.values()), clans: Array.from(clansDB.values()), savedAt: Date.now() };
        fs.writeFileSync(DATA_FILE, JSON.stringify(payload));
    } catch (e) {
        console.error('⚠️  Не вдалося зберегти дані на диск:', e.message);
    }
}

loadData();
setInterval(saveData, 20000);

function createFreshUser(id, name) {
    return {
        id,
        name: name || 'Ухилянт',
        balance: 0,
        clickVal: 1,
        passive: 0,
        level: 1,
        energy: 100,
        maxEnergy: 100,
        isVip: false,
        refCount: 0,
        refBy: null,
        dailyClaimedDate: null,
        dailyStreak: 0,
        lastPremiumReward: null,
        lastSeenAt: Date.now(),
        totalClicks: 0,
        boxesOpened: 0,
        raidsSurvived: 0,
        achievements: [],
        ownedPets: [],
        petId: null,
        clanId: null,
        portfolio: {},
        wheelLastSpinDate: null,
        ownedCosmetics: [],
        equippedCosmetics: { hat: null, face: null, neck: null, frame: null },
        ownedRoomItems: [],
        equippedRoomItems: [],
        revengeLastDate: null,
        tradesCount: 0,
        wheelSpinsCount: 0,
        // --- Кладовка та крафт ---
        resources: {},              // { cans: 12, battery: 3, ... }
        storageLevel: 0,            // місткість = BASE + level * PER_LEVEL
        upgrades: { hat: 0, jam: 0, thermos: 0, generator: 0 }, // рівні багаторівневих апгрейдів
        craftedCount: 0,
        cratesOpened: {},           // { cardboard: 5, elite: 1, ... } — для статистики й досягнень
        shieldUntil: 0,             // timestamp: до якого моменту діє щит від облав
        permanentShield: false,     // Білий Квиток — постійний імунітет
        resourcesCollected: 0,      // lifetime-лічильник для досягнень
        expedition: null,           // { id, startedAt, endsAt } — активна вилазка
        expeditionsDone: 0,
        totalEarned: 0,             // сумарно зароблено за все життя (для престижу)
        prestigePoints: 0,          // накопичені "довідки" — постійний множник доходу
        prestigeCount: 0,
        // Лічильник серверних змін балансу. Баланс лишається клієнт-авторитетним (клікер),
        // АЛЕ ящики/крафт/апгрейди міняють його на сервері. Без цього лічильника автозбереження
        // клієнта (раз на 5с) могло б надіслати застарілий баланс і затерти щойно куплений ящик
        // (гравець отримав би дроп безкоштовно) або, навпаки, стерти нарахований дроп.
        balanceRev: 0,
        questsDate: null,
        dailyClicks: 0,
        dailyTrades: 0,
        dailyBoxes: 0,
        dailyRaids: 0,
        dailyCrafts: 0,
        dailyResources: 0,
        claimedQuests: [],
        createdAt: Date.now(),
    };
}

// Робить balance акцесором, який рахує КОЖНУ зміну балансу (balanceRev). Так /api/save
// може відрізнити "клієнт надіслав актуальне значення" від "клієнт надіслав застаріле,
// бо між його останньою синхронізацією і збереженням сервер уже нарахував дроп з ящика".
// Без цього автозбереження раз на 5с могло затерти серверні нарахування або, навпаки,
// повернути витрачені на ящик гроші.
function installBalanceTracking(user) {
    const existing = Object.getOwnPropertyDescriptor(user, 'balance');
    if (existing && existing.get) return; // вже встановлено
    let value = typeof user.balance === 'number' ? user.balance : 0;
    Object.defineProperty(user, 'balance', {
        get() { return value; },
        set(v) {
            // Попутно рахуємо сумарно зароблене за все життя — з цього рахуються очки
            // престижу. Робимо тут, щоб не забути жодне місце, де баланс росте.
            if (typeof v === 'number' && v > value) {
                this.totalEarned = (this.totalEarned || 0) + (v - value);
            }
            value = v;
            this.balanceRev = (this.balanceRev || 0) + 1;
        },
        enumerable: true,
        configurable: true,
    });
}

// Дописує поля, яких не було в старіших версіях збереження, щоб гравці зі
// збереженням із попередньої версії гри не ловили undefined на нових механіках.
function migrateUser(user) {
    const fresh = createFreshUser(user.id, user.name);
    for (const key of Object.keys(fresh)) {
        if (user[key] === undefined) user[key] = fresh[key];
    }
    if (typeof user.resources !== 'object' || user.resources === null) user.resources = {};
    if (typeof user.cratesOpened !== 'object' || user.cratesOpened === null) user.cratesOpened = {};
    if (typeof user.upgrades !== 'object' || user.upgrades === null) {
        user.upgrades = { hat: 0, jam: 0, thermos: 0, generator: 0 };
    }
    for (const k of ['hat', 'jam', 'thermos', 'generator']) {
        if (typeof user.upgrades[k] !== 'number') user.upgrades[k] = 0;
    }
    installBalanceTracking(user);
    return user;
}

function getUser(id, name) {
    id = String(id);
    if (!usersDB.has(id)) {
        usersDB.set(id, createFreshUser(id, name));
    }
    const user = migrateUser(usersDB.get(id));
    if (name) user.name = name;
    return user;
}

function getClanInfo(user) {
    if (!user.clanId || !clansDB.has(user.clanId)) return { clanId: null, clanName: null, memberCount: 0, bonus: 1 };
    const clan = clansDB.get(user.clanId);
    return { clanId: clan.id, clanName: clan.name, memberCount: clan.members.length, bonus: 1 + ECONOMY.CLAN_PASSIVE_BONUS };
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
    const elapsedSec = Math.min((now - lastSeen) / 1000, ECONOMY.OFFLINE_CAP_SECONDS);
    let offlineEarnings = 0;
    if (elapsedSec >= ECONOMY.OFFLINE_MIN_SECONDS && user.passive > 0) {
        const clan = getClanInfo(user);
        const vipMult = user.isVip ? 3 : 1;
        offlineEarnings = Math.floor(user.passive * clan.bonus * vipMult * elapsedSec);
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

// ===== Кладовка: місткість, підрахунок, додавання ресурсів =====
function storageCapacity(user) {
    return ECONOMY.STORAGE_BASE_CAPACITY + (user.storageLevel || 0) * ECONOMY.STORAGE_CAPACITY_PER_LEVEL;
}

function storageUsed(user) {
    return Object.values(user.resources || {}).reduce((s, n) => s + (n || 0), 0);
}

function storageUpgradeCost(user) {
    return Math.round(ECONOMY.STORAGE_UPGRADE_BASE * Math.pow(ECONOMY.STORAGE_UPGRADE_GROWTH, user.storageLevel || 0));
}

// Додає ресурс із урахуванням ліміту складу. Повертає скільки реально влізло —
// надлишок згорає (і клієнт про це чесно повідомляє, щоб апгрейд кладовки мав сенс).
function addResource(user, resId, amount) {
    const free = Math.max(0, storageCapacity(user) - storageUsed(user));
    const added = Math.min(free, amount);
    if (added > 0) {
        user.resources[resId] = (user.resources[resId] || 0) + added;
        user.resourcesCollected = (user.resourcesCollected || 0) + added;
        user.dailyResources = (user.dailyResources || 0) + added;
    }
    return { added, lost: amount - added };
}

// Ціна наступного рівня багаторівневого апгрейда магазину.
function upgradeCost(user, key) {
    const base = { hat: ECONOMY.HAT_PRICE, jam: ECONOMY.JAM_PRICE, thermos: ECONOMY.THERMOS_PRICE, generator: ECONOMY.GENERATOR_PRICE }[key];
    const lvl = (user.upgrades && user.upgrades[key]) || 0;
    return Math.round(base * Math.pow(ECONOMY.UPGRADE_GROWTH, lvl));
}

function hasActiveShield(user) {
    return !!user.permanentShield || (user.shieldUntil || 0) > Date.now();
}

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

// Розкриває один ящик: обирає дроп за вагами і одразу застосовує ефект до гравця.
// Повертає опис результату для анімації на клієнті.
function rollCrate(user, crate) {
    const entry = crate.loot[pickWeighted(crate.loot)];
    user.cratesOpened[crate.id] = (user.cratesOpened[crate.id] || 0) + 1;
    user.boxesOpened = (user.boxesOpened || 0) + 1;
    user.dailyBoxes = (user.dailyBoxes || 0) + 1;

    if (entry.type === 'nothing') {
        return { kind: 'nothing', title: 'Пусто...', emoji: '🧦', desc: 'Тільки діряві шкарпетки. Буває.' };
    }
    if (entry.type === 'coins') {
        const amount = Math.round(entry.min + Math.random() * (entry.max - entry.min));
        user.balance += amount;
        return { kind: 'coins', title: 'Готівка!', emoji: '🪙', amount, desc: `+${amount.toLocaleString('uk-UA')} ТК` };
    }
    if (entry.type === 'energy') {
        user.energy = user.maxEnergy;
        return { kind: 'energy', title: 'Павербанк', emoji: '🔋', desc: 'Енергію відновлено повністю!' };
    }
    if (entry.type === 'cosmetic') {
        const notOwned = COSMETICS.filter((c) => !user.ownedCosmetics.includes(c.id));
        if (notOwned.length === 0) {
            user.balance += 20000;
            return { kind: 'coins', title: 'Гардероб повний', emoji: '🪙', amount: 20000, desc: 'Все вже є — тобі компенсували 20 000 ТК' };
        }
        const pick = notOwned[Math.floor(Math.random() * notOwned.length)];
        user.ownedCosmetics.push(pick.id);
        return { kind: 'cosmetic', title: 'Рідкісна річ!', emoji: pick.emoji || '👕', img: pick.img, desc: pick.name, cosmeticId: pick.id };
    }
    // entry.type === 'res'
    const meta = RESOURCE_BY_ID[entry.res];
    const amount = Math.round(entry.min + Math.random() * (entry.max - entry.min));
    const { added, lost } = addResource(user, entry.res, amount);
    return {
        kind: 'res', title: meta.name, emoji: meta.emoji, resId: entry.res, amount: added, lost,
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
// 5. ПЕРЕВІРКА ПІДПИСУ TELEGRAM WEBAPP (initData)
// Захищає API від підробки чужого id: без цього будь-хто міг би дзвонити
// /api/save, /api/invoice тощо з чужим Telegram id і красти чужий прогрес/оплати.
// Алгоритм офіційний: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
// ==========================================
function verifyInitData(initData, botToken, maxAgeSeconds = 86400) {
    if (!initData || typeof initData !== 'string') return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const hashBuf = Buffer.from(hash, 'hex');
    const computedBuf = Buffer.from(computedHash, 'hex');
    if (hashBuf.length !== computedBuf.length || !crypto.timingSafeEqual(hashBuf, computedBuf)) {
        return null; // підпис не збігається — дані підроблені або токен невірний
    }

    const authDate = Number(params.get('auth_date'));
    if (!authDate || (Date.now() / 1000 - authDate) > maxAgeSeconds) {
        return null; // застаріле initData — вважаємо недійсним
    }

    try {
        const user = JSON.parse(params.get('user') || 'null');
        return user && user.id ? user : null;
    } catch (e) {
        return null;
    }
}

// Express-мідлвар: перевіряє заголовок X-Telegram-Init-Data і кладе довірений
// ідентифікатор користувача в req.telegramUser. Усі ендпоінти, що читають/пишуть
// баланс, VIP чи створюють інвойси, мають використовувати САМЕ req.telegramUser.id,
// а не id з тіла запиту (його будь-хто може підмінити).
// Будь-яка відповідь, що містить `balance`, автоматично отримує й `balanceRev` —
// щоб клієнт завжди знав актуальну ревізію і його автозбереження не було відхилене.
// Робимо це в одному місці, а не в кожному ендпоінті окремо (щоб не забути новий).
function attachBalanceRev(req, res) {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
        if (payload && typeof payload === 'object' && 'balance' in payload && payload.balanceRev === undefined) {
            const u = usersDB.get(String(req.telegramUser.id));
            if (u) payload.balanceRev = u.balanceRev;
        }
        return originalJson(payload);
    };
}

function requireTelegramAuth(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    const verifiedUser = verifyInitData(initData, BOT_TOKEN);
    if (verifiedUser) {
        req.telegramUser = { id: String(verifiedUser.id), first_name: verifiedUser.first_name || 'Ухилянт' };
        attachBalanceRev(req, res);
        return next();
    }
    if (DEV_MODE_INSECURE) {
        const fallbackId = req.body?.id || req.query?.id;
        if (fallbackId) {
            req.telegramUser = { id: String(fallbackId), first_name: req.body?.name || req.query?.name || 'DevТестер' };
            attachBalanceRev(req, res);
            return next();
        }
    }
    return res.status(401).json({ error: 'Недійсні дані Telegram WebApp. Відкрий гру через кнопку в боті.' });
}

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
});

// Обробка оплат Telegram Stars
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [type, userId] = payload.split('_');
    const user = getUser(userId, ctx.from.first_name);

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
    } else if (type === 'donate') {
        ctx.reply('❤️ Дякуємо за підтримку розробників! Жодних ігрових бонусів це не дає — просто дуже приємно. Ти найкращий.');
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
        } else if (type === 'donate') {
            const requested = Number(req.body.amount);
            if (!ECONOMY.DONATE_AMOUNTS.includes(requested)) {
                return res.status(400).json({ error: 'Невірна сума підтримки' });
            }
            title = 'Підтримка розробників';
            description = 'Щиро дякуємо! Це не дає ігрових бонусів — просто підтримка проєкту.';
            amount = requested;
            payloadPrefix = 'donate';
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
    const offlineEarnings = applyOfflineProgress(user);
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
        wheelClaimedToday: user.wheelLastSpinDate === today,
        balanceRev: user.balanceRev,
        // Кладовка, крафт, багаторівневі апгрейди
        resources: user.resources,
        storageLevel: user.storageLevel,
        storageCapacity: storageCapacity(user),
        storageUsed: storageUsed(user),
        storageUpgradeCost: user.storageLevel >= ECONOMY.STORAGE_MAX_LEVEL ? null : storageUpgradeCost(user),
        upgrades: user.upgrades,
        upgradeCosts: {
            hat: upgradeCost(user, 'hat'), jam: upgradeCost(user, 'jam'),
            thermos: upgradeCost(user, 'thermos'), generator: upgradeCost(user, 'generator'),
        },
        craftedCount: user.craftedCount,
        cratesOpened: user.cratesOpened,
        shieldUntil: user.shieldUntil,
        permanentShield: user.permanentShield,
        resourcesCollected: user.resourcesCollected,
        expedition: user.expedition,
        expeditionsDone: user.expeditionsDone,
        totalEarned: user.totalEarned,
        prestigePoints: user.prestigePoints,
        prestigeCount: user.prestigeCount,
        prestigeMultiplier: prestigeMultiplier(user),
        prestigeAvailable: prestigePointsAvailable(user),
    };
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
    if (typeof totalClicks === 'number') user.dailyClicks += Math.max(0, totalClicks - user.totalClicks);
    if (typeof boxesOpened === 'number') user.dailyBoxes += Math.max(0, boxesOpened - user.boxesOpened);
    if (typeof raidsSurvived === 'number') user.dailyRaids += Math.max(0, raidsSurvived - user.raidsSurvived);

    // Баланс приймаємо лише якщо клієнт бачив актуальну серверну ревізію. Інакше його
    // значення застаріле (сервер щойно нарахував дроп із ящика / списав за крафт) —
    // тоді лишаємо серверне і повідомляємо клієнту, щоб він підхопив авторитетне.
    const clientRev = Number(req.body.balanceRev);
    const balanceAccepted = Number.isFinite(clientRev) && clientRev === user.balanceRev;
    if (balanceAccepted && typeof balance === 'number') user.balance = balance;

    if (typeof clickVal === 'number') user.clickVal = clickVal;
    if (typeof passive === 'number') user.passive = passive;
    if (typeof level === 'number') user.level = level;
    if (typeof energy === 'number') user.energy = energy;
    if (typeof maxEnergy === 'number') user.maxEnergy = maxEnergy;
    if (typeof totalClicks === 'number') user.totalClicks = totalClicks;
    if (typeof boxesOpened === 'number') user.boxesOpened = boxesOpened;
    if (typeof raidsSurvived === 'number') user.raidsSurvived = raidsSurvived;
    user.lastSeenAt = Date.now();

    const unlocked = checkAchievements(user);
    res.json({
        ok: true, balance: user.balance, balanceRev: user.balanceRev,
        balanceRejected: !balanceAccepted, unlockedAchievements: unlocked,
    });
});

// Відновлення прогресу з резервної копії, яку клієнт тримає в Telegram CloudStorage
// (переживає редеплой на Render — на відміну від диску сервера, який скидається при
// новому контейнері). Викликається лише коли сервер бачить "свіжого" гравця (без
// прогресу), а в CloudStorage лежить копія зі старим прогресом. Без анти-чіт перевірок —
// жартівливий проєкт для друзів, довіряємо клієнту так само, як і в /api/save.
const RESTORE_NUMBER_FIELDS = ['balance', 'clickVal', 'passive', 'level', 'energy', 'maxEnergy', 'totalClicks', 'boxesOpened', 'raidsSurvived', 'refCount', 'dailyStreak', 'tradesCount', 'wheelSpinsCount', 'storageLevel', 'craftedCount', 'shieldUntil', 'resourcesCollected', 'expeditionsDone', 'totalEarned', 'prestigePoints', 'prestigeCount'];
const RESTORE_ARRAY_FIELDS = ['achievements', 'ownedPets', 'ownedCosmetics', 'ownedRoomItems', 'equippedRoomItems'];
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
    const promo = PROMO_CODES[String(code).toUpperCase().trim()];
    if (!promo) return res.json({ success: false, message: 'Невірний код' });

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
    res.json({ success: false, message: 'Невірний код' });
});

app.get('/api/leaderboard', (req, res) => {
    const top = Array.from(usersDB.values())
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10)
        .map((u) => ({ name: u.name, balance: u.balance, isVip: u.isVip }));
    res.json(top);
});

// ---- Компаньйони ----
app.post('/api/pet/buy', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const pet = PETS.find((p) => p.id === req.body.petId);
    if (!pet) return res.status(400).json({ error: 'Невідомий компаньйон' });
    if (user.ownedPets.includes(pet.id)) return res.json({ success: false, message: 'Вже куплено' });
    if (user.balance < pet.price) return res.json({ success: false, message: 'Недостатньо ТК' });
    user.balance -= pet.price;
    user.ownedPets.push(pet.id);
    res.json({ success: true, balance: user.balance, ownedPets: user.ownedPets });
});

app.post('/api/pet/equip', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const petId = req.body.petId || null;
    if (petId && !user.ownedPets.includes(petId)) return res.json({ success: false, message: 'Спочатку купи компаньйона' });
    user.petId = petId;
    res.json({ success: true, petId: user.petId });
});

// ---- Гардероб (косметика) ----
app.post('/api/cosmetic/buy', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const item = COSMETICS.find((c) => c.id === req.body.cosmeticId);
    if (!item) return res.status(400).json({ error: 'Невідомий предмет гардеробу' });
    if (user.ownedCosmetics.includes(item.id)) return res.json({ success: false, message: 'Вже куплено' });
    if (user.balance < item.price) return res.json({ success: false, message: 'Недостатньо ТК' });
    user.balance -= item.price;
    user.ownedCosmetics.push(item.id);
    user.equippedCosmetics[item.slot] = item.id; // купив — одразу вдягнув, без окремого кроку
    res.json({ success: true, balance: user.balance, ownedCosmetics: user.ownedCosmetics, equippedCosmetics: user.equippedCosmetics });
});

app.post('/api/cosmetic/equip', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const { slot, cosmeticId } = req.body;
    if (!['hat', 'face', 'neck', 'frame'].includes(slot)) return res.status(400).json({ error: 'Невідомий слот' });
    if (cosmeticId) {
        const item = COSMETICS.find((c) => c.id === cosmeticId && c.slot === slot);
        if (!item) return res.status(400).json({ error: 'Невідомий предмет' });
        if (!user.ownedCosmetics.includes(cosmeticId)) return res.json({ success: false, message: 'Спочатку купи цей предмет' });
    }
    user.equippedCosmetics[slot] = cosmeticId || null;
    res.json({ success: true, equippedCosmetics: user.equippedCosmetics });
});

// ---- Декор кімнати ----
app.post('/api/room/buy', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const item = ROOM_ITEMS.find((r) => r.id === req.body.itemId);
    if (!item) return res.status(400).json({ error: 'Невідома річ' });
    if (user.ownedRoomItems.includes(item.id)) return res.json({ success: false, message: 'Вже куплено' });
    if (user.balance < item.price) return res.json({ success: false, message: 'Недостатньо ТК' });
    user.balance -= item.price;
    user.ownedRoomItems.push(item.id);
    res.json({ success: true, balance: user.balance, ownedRoomItems: user.ownedRoomItems });
});

app.post('/api/room/toggle', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const { itemId } = req.body;
    if (!ROOM_ITEMS.some((r) => r.id === itemId)) return res.status(400).json({ error: 'Невідома річ' });
    if (!user.ownedRoomItems.includes(itemId)) return res.json({ success: false, message: 'Спочатку купи цю річ' });
    const idx = user.equippedRoomItems.indexOf(itemId);
    if (idx === -1) user.equippedRoomItems.push(itemId);
    else user.equippedRoomItems.splice(idx, 1);
    res.json({ success: true, equippedRoomItems: user.equippedRoomItems });
});

// ---- Кладовка: стан складу, апгрейд місткості, продаж ресурсів ----
function storageSnapshot(user) {
    return {
        resources: user.resources,
        storageLevel: user.storageLevel,
        capacity: storageCapacity(user),
        used: storageUsed(user),
        upgradeCost: user.storageLevel >= ECONOMY.STORAGE_MAX_LEVEL ? null : storageUpgradeCost(user),
        maxLevel: ECONOMY.STORAGE_MAX_LEVEL,
    };
}

app.get('/api/storage', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    res.json({ success: true, ...storageSnapshot(user), balance: user.balance });
});

app.post('/api/storage/upgrade', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    if (user.storageLevel >= ECONOMY.STORAGE_MAX_LEVEL) {
        return res.json({ success: false, message: 'Кладовка вже максимального розміру' });
    }
    const cost = storageUpgradeCost(user);
    if (user.balance < cost) return res.json({ success: false, message: 'Недостатньо ТК' });
    user.balance -= cost;
    user.storageLevel += 1;
    res.json({ success: true, balance: user.balance, ...storageSnapshot(user) });
});

app.post('/api/storage/sell', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const { resId } = req.body;
    const meta = RESOURCE_BY_ID[resId];
    if (!meta) return res.status(400).json({ error: 'Невідомий ресурс' });
    const have = user.resources[resId] || 0;
    const qty = req.body.all ? have : Math.min(have, Math.max(1, Number(req.body.qty) || 1));
    if (qty <= 0) return res.json({ success: false, message: 'Немає що продавати' });
    user.resources[resId] = have - qty;
    if (user.resources[resId] <= 0) delete user.resources[resId];
    const earned = qty * meta.sell;
    user.balance += earned;
    res.json({ success: true, earned, balance: user.balance, ...storageSnapshot(user) });
});

// ---- Престиж: "Легалізація" ----
// Скидає економічний прогрес заради постійного множника доходу. Косметика, досягнення,
// кладовка й компаньйони НЕ скидаються — інакше легалізуватись було б надто боляче.
app.get('/api/prestige', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    res.json({
        success: true,
        points: user.prestigePoints || 0,
        available: prestigePointsAvailable(user),
        multiplier: prestigeMultiplier(user),
        totalEarned: user.totalEarned || 0,
        prestigeCount: user.prestigeCount || 0,
        unlockLevel: ECONOMY.PRESTIGE_UNLOCK_LEVEL,
        unlocked: user.level >= ECONOMY.PRESTIGE_UNLOCK_LEVEL,
        bonusPerPoint: ECONOMY.PRESTIGE_BONUS_PER_POINT,
    });
});

app.post('/api/prestige/claim', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    if (user.level < ECONOMY.PRESTIGE_UNLOCK_LEVEL) {
        return res.json({ success: false, message: `Легалізація доступна з ${ECONOMY.PRESTIGE_UNLOCK_LEVEL} рівня схрону` });
    }
    const gain = prestigePointsAvailable(user);
    if (gain < 1) {
        return res.json({ success: false, message: 'Ще замало зароблено для легалізації' });
    }

    user.prestigePoints = (user.prestigePoints || 0) + gain;
    user.prestigeCount = (user.prestigeCount || 0) + 1;

    // Скидаємо саме економіку. Все колекційне лишається.
    user.balance = 0;
    user.clickVal = 1;
    user.passive = 0;
    user.level = 1;
    user.maxEnergy = LOCATIONS[0].maxEnergy;
    user.energy = user.maxEnergy;
    user.upgrades = { hat: 0, jam: 0, thermos: 0, generator: 0 };
    user.portfolio = {};
    user.expedition = null;

    const unlocked = checkAchievements(user);
    res.json({
        success: true, gained: gain,
        points: user.prestigePoints, multiplier: prestigeMultiplier(user),
        prestigeCount: user.prestigeCount, balance: user.balance,
        clickVal: user.clickVal, passive: user.passive, level: user.level,
        energy: user.energy, maxEnergy: user.maxEnergy, upgrades: user.upgrades,
        unlockedAchievements: unlocked,
    });
});

// ---- Вилазки (офлайн-таймер за ресурсами) ----
app.post('/api/expedition/start', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const exp = EXPEDITION_BY_ID[req.body.expeditionId];
    if (!exp) return res.status(400).json({ error: 'Невідома вилазка' });
    if (user.expedition) return res.json({ success: false, message: 'Ти вже на вилазці' });
    if (user.level < exp.minLevel) return res.json({ success: false, message: `Потрібен ${exp.minLevel} рівень схрону` });

    // Голуб-курʼєр скорочує час вилазки. Фіксуємо активного компаньйона в самій вилазці,
    // щоб гравець не міг зняти його після старту й усе одно отримати бонус до здобичі.
    const pet = PET_EXPEDITION[user.petId] || {};
    const minutes = exp.minutes * (pet.timeMult || 1);
    const now = Date.now();
    user.expedition = {
        id: exp.id, startedAt: now, endsAt: now + minutes * 60 * 1000,
        petId: user.petId || null,
    };
    res.json({ success: true, expedition: user.expedition });
});

app.post('/api/expedition/claim', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    if (!user.expedition) return res.json({ success: false, message: 'Вилазки немає' });
    if (Date.now() < user.expedition.endsAt) return res.json({ success: false, message: 'Вилазка ще триває' });

    const exp = EXPEDITION_BY_ID[user.expedition.id];
    // Компаньйон береться той, що був НА МОМЕНТ СТАРТУ вилазки (записаний у ній),
    // інакше можна було б зняти щура перед стартом і вдягнути пса перед клеймом.
    const pet = PET_EXPEDITION[user.expedition.petId] || {};
    user.expedition = null;
    user.expeditionsDone = (user.expeditionsDone || 0) + 1;

    // Щит від облав (Білий Квиток / липова довідка) прибирає ризик спалитись —
    // це робить крафт щитів осмисленим і для вилазок теж.
    const shielded = hasActiveShield(user);
    if (!shielded && Math.random() < exp.risk * (pet.riskMult || 1)) {
        return res.json({
            success: true, caught: true,
            message: 'Тебе помітили — довелось тікати без здобичі.',
            ...storageSnapshot(user), balance: user.balance,
        });
    }

    const gained = [];
    for (const entry of exp.loot) {
        const meta = RESOURCE_BY_ID[entry.res];
        const base = entry.min + Math.random() * (entry.max - entry.min);
        const qty = Math.max(1, Math.round(base * (pet.lootMult || 1)));
        const { added, lost } = addResource(user, entry.res, qty);
        if (added > 0 || lost > 0) gained.push({ emoji: meta.emoji, name: meta.name, added, lost });
    }
    const unlocked = checkAchievements(user);
    res.json({
        success: true, caught: false, gained, shielded,
        unlockedAchievements: unlocked, ...storageSnapshot(user), balance: user.balance,
    });
});

// ---- Ящики за ігрову валюту (за Stars — через /api/invoice) ----
app.post('/api/crate/open', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    const crate = CRATE_BY_ID[req.body.crateId];
    if (!crate) return res.status(400).json({ error: 'Невідомий ящик' });
    if (crate.currency !== 'coins') return res.json({ success: false, message: 'Цей ящик купується за Stars' });
    if (user.balance < crate.price) return res.json({ success: false, message: 'Недостатньо ТК на ящик' });

    user.balance -= crate.price;
    const reward = rollCrate(user, crate);
    const unlocked = checkAchievements(user);
    res.json({
        success: true, reward, balance: user.balance,
        ownedCosmetics: user.ownedCosmetics, energy: user.energy,
        unlockedAchievements: unlocked, ...storageSnapshot(user),
    });
});

// ---- Крафт ----
app.post('/api/craft', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    const recipe = RECIPE_BY_ID[req.body.recipeId];
    if (!recipe) return res.status(400).json({ error: 'Невідомий рецепт' });

    for (const [resId, need] of Object.entries(recipe.cost)) {
        if ((user.resources[resId] || 0) < need) {
            return res.json({ success: false, message: `Не вистачає: ${RESOURCE_BY_ID[resId].name}` });
        }
    }
    if (recipe.effect.type === 'permanent_shield' && user.permanentShield) {
        return res.json({ success: false, message: 'Білий Квиток у тебе вже є' });
    }

    for (const [resId, need] of Object.entries(recipe.cost)) {
        user.resources[resId] -= need;
        if (user.resources[resId] <= 0) delete user.resources[resId];
    }
    user.craftedCount = (user.craftedCount || 0) + 1;
    user.dailyCrafts = (user.dailyCrafts || 0) + 1;

    const eff = recipe.effect;
    let message;
    if (eff.type === 'energy') { user.energy = user.maxEnergy; message = 'Енергію відновлено!'; }
    else if (eff.type === 'click') { user.clickVal += eff.amount; message = `+${eff.amount} до сили кліку`; }
    else if (eff.type === 'passive') { user.passive += eff.amount; message = `+${eff.amount} до пасиву`; }
    else if (eff.type === 'coins') { user.balance += eff.amount; message = `+${eff.amount.toLocaleString('uk-UA')} ТК`; }
    else if (eff.type === 'maxEnergy') { user.maxEnergy += eff.amount; user.energy = user.maxEnergy; message = `+${eff.amount} до макс. енергії`; }
    else if (eff.type === 'combo') { user.clickVal += eff.click; user.passive += eff.passive; message = `+${eff.click} клік, +${eff.passive} пасив`; }
    else if (eff.type === 'shield') {
        const base = Math.max(Date.now(), user.shieldUntil || 0);
        user.shieldUntil = base + eff.hours * 3600 * 1000;
        message = `Щит від облав на ${eff.hours} год`;
    }
    else if (eff.type === 'permanent_shield') { user.permanentShield = true; message = 'ПОСТІЙНИЙ імунітет до облав!'; }

    const unlocked = checkAchievements(user);
    res.json({
        success: true, message, recipeId: recipe.id,
        balance: user.balance, clickVal: user.clickVal, passive: user.passive,
        energy: user.energy, maxEnergy: user.maxEnergy,
        shieldUntil: user.shieldUntil, permanentShield: user.permanentShield,
        craftedCount: user.craftedCount, unlockedAchievements: unlocked,
        ...storageSnapshot(user),
    });
});

// ---- Багаторівневі апгрейди магазину (ціна росте з кожним рівнем) ----
app.post('/api/upgrade/buy', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const key = req.body.key;
    if (!['hat', 'jam', 'thermos', 'generator'].includes(key)) {
        return res.status(400).json({ error: 'Невідомий апгрейд' });
    }
    const cost = upgradeCost(user, key);
    if (user.balance < cost) return res.json({ success: false, message: 'Недостатньо ТК' });
    user.balance -= cost;
    user.upgrades[key] += 1;
    if (key === 'hat') user.clickVal += ECONOMY.HAT_CLICK_BONUS;
    if (key === 'jam') user.passive += ECONOMY.JAM_PASSIVE_BONUS;
    if (key === 'thermos') user.clickVal += ECONOMY.THERMOS_CLICK_BONUS;
    if (key === 'generator') user.passive += ECONOMY.GENERATOR_PASSIVE_BONUS;
    const unlocked = checkAchievements(user);
    res.json({
        success: true, balance: user.balance, clickVal: user.clickVal, passive: user.passive,
        upgrades: user.upgrades, nextCost: upgradeCost(user, key), unlockedAchievements: unlocked,
    });
});

// ---- Помста інспектору (флейвор, розблок після кількох виживаних облав) ----
app.post('/api/revenge', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    if (user.raidsSurvived < ECONOMY.REVENGE_UNLOCK_RAIDS) {
        return res.json({ success: false, locked: true, message: `Спочатку переживи ${ECONOMY.REVENGE_UNLOCK_RAIDS} облави` });
    }
    const today = new Date().toDateString();
    if (user.revengeLastDate === today) {
        return res.json({ success: false, message: 'Сьогодні вже помстився. Приходь завтра.' });
    }
    const line = REVENGE_LINES[Math.floor(Math.random() * REVENGE_LINES.length)];
    const reward = Math.floor(Math.random() * (ECONOMY.REVENGE_REWARD_MAX - ECONOMY.REVENGE_REWARD_MIN)) + ECONOMY.REVENGE_REWARD_MIN;
    user.balance += reward;
    user.revengeLastDate = today;
    res.json({ success: true, line, reward, balance: user.balance });
});

// ---- Щоденні квести ----
app.get('/api/quests', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    res.json({
        dailyClicks: user.dailyClicks, dailyTrades: user.dailyTrades,
        dailyBoxes: user.dailyBoxes, dailyRaids: user.dailyRaids,
        dailyCrafts: user.dailyCrafts, dailyResources: user.dailyResources,
        claimedQuests: user.claimedQuests,
    });
});

app.post('/api/quests/claim', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    const quest = QUESTS.find((q) => q.id === req.body.questId);
    if (!quest) return res.status(400).json({ error: 'Невідомий квест' });
    if (user.claimedQuests.includes(quest.id)) return res.json({ success: false, message: 'Вже отримано сьогодні' });
    if ((user[quest.metric] || 0) < quest.target) return res.json({ success: false, message: 'Квест ще не виконано' });
    user.claimedQuests.push(quest.id);
    user.balance += quest.reward;
    res.json({ success: true, balance: user.balance, claimedQuests: user.claimedQuests });
});

// ---- Тіньова біржа ----
app.get('/api/market', (req, res) => {
    res.json({ prices: marketState.prices, history: marketState.history });
});

app.post('/api/market/trade', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    const { assetId, action, qty } = req.body;
    const asset = MARKET_ASSETS.find((a) => a.id === assetId);
    const quantity = Number(qty);
    if (!asset || !['buy', 'sell'].includes(action) || !(quantity > 0) || !Number.isInteger(quantity)) {
        return res.status(400).json({ error: 'Невірні дані угоди' });
    }
    const price = marketState.prices[assetId];
    const total = price * quantity;

    if (action === 'buy') {
        if (user.balance < total) return res.json({ success: false, message: 'Недостатньо ТК' });
        user.balance -= total;
        user.portfolio[assetId] = (user.portfolio[assetId] || 0) + quantity;
    } else {
        const held = user.portfolio[assetId] || 0;
        if (held < quantity) return res.json({ success: false, message: 'Недостатньо активів у портфелі' });
        user.portfolio[assetId] = held - quantity;
        user.balance += total;
    }
    user.tradesCount += 1;
    user.dailyTrades += 1;
    res.json({ success: true, balance: user.balance, portfolio: user.portfolio });
});

// ---- Клани ("Чат ОСББ") ----
app.get('/api/clan/list', (req, res) => {
    const list = Array.from(clansDB.values())
        .map((c) => ({ id: c.id, name: c.name, members: c.members.length }))
        .sort((a, b) => b.members - a.members)
        .slice(0, 20);
    res.json(list);
});

app.get('/api/clan/leaderboard', (req, res) => {
    const top = Array.from(clansDB.values())
        .map((c) => ({
            id: c.id, name: c.name, members: c.members.length,
            totalBalance: Math.floor(c.members.reduce((sum, id) => sum + (usersDB.get(id)?.balance || 0), 0)),
        }))
        .sort((a, b) => b.totalBalance - a.totalBalance)
        .slice(0, 10);
    res.json(top);
});

app.post('/api/clan/create', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    if (user.clanId && clansDB.has(user.clanId)) return res.json({ success: false, message: 'Ти вже в чаті ОСББ. Спочатку вийди.' });
    const name = String(req.body.name || '').trim().slice(0, 30);
    if (!name) return res.json({ success: false, message: 'Вкажи назву чату' });
    const clan = { id: makeClanId(), name, ownerId: user.id, members: [user.id] };
    clansDB.set(clan.id, clan);
    user.clanId = clan.id;
    res.json({ success: true, clanId: clan.id, clanName: clan.name });
});

app.post('/api/clan/join', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    if (user.clanId && clansDB.has(user.clanId)) return res.json({ success: false, message: 'Ти вже в чаті ОСББ.' });
    const clan = clansDB.get(req.body.clanId);
    if (!clan) return res.json({ success: false, message: 'Чат не знайдено' });
    if (!clan.members.includes(user.id)) clan.members.push(user.id);
    user.clanId = clan.id;
    res.json({ success: true, clanId: clan.id, clanName: clan.name });
});

app.post('/api/clan/leave', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    if (user.clanId && clansDB.has(user.clanId)) {
        const clan = clansDB.get(user.clanId);
        clan.members = clan.members.filter((id) => id !== user.id);
        if (clan.members.length === 0) clansDB.delete(clan.id);
    }
    user.clanId = null;
    res.json({ success: true });
});

// ---- Колесо Зради та Перемоги ----
app.post('/api/wheel/spin', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    const today = new Date().toDateString();
    if (user.wheelLastSpinDate === today) return res.json({ success: false, message: 'Колесо вже крутили сьогодні. Приходь завтра.' });

    const index = pickWeighted(WHEEL_SEGMENTS);
    const segment = WHEEL_SEGMENTS[index];
    let resultNote = null;
    if (segment.type === 'balance') user.balance += segment.amount;
    if (segment.type === 'energy') user.energy = user.maxEnergy;
    if (segment.type === 'resource') {
        // Випадковий ресурс потрібного тіру — кількість тим менша, чим цінніший тір.
        const pool = RESOURCES.filter((r) => r.tier === segment.tier);
        const meta = pool[Math.floor(Math.random() * pool.length)];
        const qty = segment.tier === 1 ? 3 + Math.floor(Math.random() * 5) : 1 + Math.floor(Math.random() * 3);
        const { added, lost } = addResource(user, meta.id, qty);
        resultNote = lost > 0
            ? `+${added} ${meta.emoji} ${meta.name} (${lost} згоріло — кладовка повна)`
            : `+${added} ${meta.emoji} ${meta.name}`;
    }
    user.wheelLastSpinDate = today;
    user.wheelSpinsCount += 1;
    const unlocked = checkAchievements(user);

    res.json({
        success: true, index, segment, resultNote,
        balance: user.balance, energy: user.energy,
        resources: user.resources, unlockedAchievements: unlocked,
    });
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Симулятор Ухилянта</title>
    <link rel="icon" type="image/png" href="/images/app-icon.webp">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;900&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --bg: #0a0a12; --panel-bg: #12121e; --text: #eaf6ff; --accent: #ff2ea6; --accent2: #00e5ff; --btn: #1b1b2b; --gold: #ffe066; }
        body { margin: 0; padding: 10px; font-family: 'Rajdhani', 'Segoe UI', sans-serif; font-size: 16px; background: var(--bg); color: var(--text); overflow-x: hidden; user-select: none; }

        header { background: rgba(10,10,20,0.75); padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 10px; position: relative; border: 1px solid rgba(0,229,255,0.35); box-shadow: 0 0 18px rgba(0,229,255,0.15), inset 0 0 25px rgba(255,46,166,0.05); }
        .daily-btn { position: absolute; top: 10px; right: 10px; width: auto; margin-bottom: 0; background: var(--gold); color: #000; border: none; border-radius: 5px; padding: 5px 10px; font-weight: bold; font-size: 10px; cursor: pointer; box-shadow: 0 0 8px rgba(255,224,102,0.6); }
        .streak-note { position: absolute; top: 32px; right: 10px; font-size: 9px; color: #ffe066cc; }
        h2 { margin: 5px 0; font-family: 'Orbitron', sans-serif; font-weight: 700; color: var(--gold); font-size: 26px; letter-spacing: 1px; text-shadow: 0 0 8px rgba(255,224,102,0.8), 0 0 20px rgba(0,229,255,0.5); }
        .stats { display: flex; justify-content: space-between; font-size: 14px; color: #9fb4c7; margin-top: 5px; }
        .vip-badge { color: #000; background: var(--gold); border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: bold; margin-left: 6px; vertical-align: middle; }
        .clan-line { font-size: 11px; color: var(--accent2); margin-top: 4px; text-shadow: 0 0 6px rgba(0,229,255,0.5); }

        .energy-bar { width: 100%; height: 12px; background: #1c1c2b; border-radius: 6px; margin-top: 10px; overflow: hidden; border: 1px solid #2a2a3d; }
        .energy-fill { width: 100%; height: 100%; background: linear-gradient(90deg, #00e5ff, #39ff14); box-shadow: 0 0 10px rgba(0,229,255,0.8); transition: width 0.2s; }

        main { display: flex; justify-content: center; align-items: center; height: 25vh; position: relative; }
        .clickable { position: relative; transition: transform 0.05s; cursor: pointer; }
        .clickable:active { transform: scale(0.92); }
        .clickable img { height: 22vh; max-width: 80vw; object-fit: contain; filter: drop-shadow(0 0 20px rgba(255,255,255,0.1)); pointer-events: none; user-select: none; border-radius: 12px; }
        .clickable .emoji-fallback { font-size: 90px; filter: drop-shadow(0 0 20px rgba(255,255,255,0.1)); }
        .location-name { position: absolute; top: -10px; font-weight: bold; color: var(--accent2); text-transform: uppercase; letter-spacing: 2px; font-size: 12px; text-shadow: 0 0 6px rgba(0,229,255,0.6); }

        .tabs-container { overflow-x: auto; white-space: nowrap; margin-bottom: 10px; padding-bottom: 5px; }
        .tabs-container::-webkit-scrollbar { height: 4px; }
        .tabs-container::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
        .tab { display: inline-block; padding: 10px 15px; background: var(--btn); border: 1px solid rgba(0,229,255,0.15); text-align: center; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; margin-right: 5px; color: #9fb4c7; }
        .tab.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); border-color: transparent; color: #fff; box-shadow: 0 0 12px rgba(255,46,166,0.6), 0 0 20px rgba(0,229,255,0.4); }

        .panel { display: none; background: rgba(255,255,255,0.04); padding: 15px; border-radius: 12px; min-height: 38vh; max-height: 50vh; overflow-y: auto; border: 1px solid rgba(0,229,255,0.2); }
        .panel.active { display: block; }

        button { width: 100%; padding: 12px; margin-bottom: 10px; border: 1px solid rgba(0,229,255,0.25); border-radius: 8px; background: var(--btn); color: white; font-weight: 600; font-size: 15px; cursor: pointer; transition: 0.2s; }
        button:active { transform: scale(0.98); box-shadow: 0 0 12px rgba(0,229,255,0.5); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .premium-btn { background: linear-gradient(45deg, #5b1fb3, #00c3ff); border: 1px solid #fff; }
        .dev-notice { background: rgba(255,193,7,0.1); border: 1px solid rgba(255,193,7,0.4); color: #ffca6a; border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.5; margin-bottom: 16px; }

        /* ===== Ящики ===== */
        .crate-card { background: rgba(255,255,255,0.04); border: 1px solid #333; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
        .crate-card.stars { border-color: rgba(255,224,102,0.5); background: linear-gradient(135deg, rgba(156,39,176,0.12), rgba(255,224,102,0.08)); }
        .crate-top { display: flex; align-items: center; gap: 10px; }
        .crate-top img { width: 48px; height: 48px; object-fit: contain; flex-shrink: 0; }
        .crate-name { font-weight: 700; font-size: 14px; }
        .crate-desc { font-size: 11px; color: #9fb4c7; line-height: 1.4; margin-top: 2px; }
        .crate-card button { margin: 10px 0 0; }
        .crate-odds-toggle { background: none; border: none; color: var(--accent2); font-size: 11px; padding: 6px 0 0; margin: 0; width: auto; text-decoration: underline; cursor: pointer; }
        .crate-odds { font-size: 11px; color: #9fb4c7; margin-top: 6px; border-top: 1px solid #2a2a3d; padding-top: 6px; }
        .crate-odds div { display: flex; justify-content: space-between; padding: 1px 0; }

        /* ===== Анімація відкривання ящика ===== */
        #crate-overlay { position: fixed; inset: 0; z-index: 1800; background: rgba(4,4,10,0.94); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
        #crate-stage { position: relative; width: 260px; height: 260px; display: flex; align-items: center; justify-content: center; }
        #crate-box { position: relative; width: 150px; height: 150px; }
        #crate-box img { width: 100%; height: 100%; object-fit: contain; }
        #crate-rays { position: absolute; width: 340px; height: 340px; border-radius: 50%; opacity: 0; pointer-events: none;
            background: conic-gradient(from 0deg, transparent 0deg 8deg, rgba(255,224,102,0.55) 8deg 16deg, transparent 16deg 24deg); }
        #crate-sparks { position: absolute; inset: 0; pointer-events: none; }
        .crate-spark { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 10px var(--gold); opacity: 0; }
        #crate-prize { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; opacity: 0; transform: scale(0.4); pointer-events: none; }
        #crate-prize-icon { font-size: 76px; line-height: 1; filter: drop-shadow(0 0 18px rgba(255,224,102,0.8)); }
        #crate-prize-icon img { width: 96px; height: 96px; object-fit: contain; }
        #crate-prize-title { font-family: 'Orbitron', sans-serif; font-size: 19px; font-weight: 700; color: var(--gold); text-shadow: 0 0 12px rgba(255,224,102,0.7); text-align: center; }
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
        .storage-header { background: rgba(255,255,255,0.04); border: 1px solid rgba(0,229,255,0.2); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
        .storage-bar-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
        .storage-bar { width: 100%; height: 10px; background: #1c1c2b; border-radius: 5px; overflow: hidden; border: 1px solid #2a2a3d; }
        .storage-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #39ff14, #ffe066); transition: width 0.3s; }
        .storage-fill.full { background: linear-gradient(90deg, #ff5722, #ff1744); }
        .storage-header button { margin: 10px 0 0; font-size: 13px; padding: 9px; }
        .res-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid #333; border-radius: 8px; padding: 9px 11px; margin-bottom: 7px; }
        .res-card.empty { opacity: 0.4; }
        .res-emoji { font-size: 24px; }
        .res-info { flex: 1; min-width: 0; }
        .res-name { font-size: 13px; font-weight: 600; }
        .res-meta { font-size: 10px; color: #9fb4c7; }
        .res-qty { font-family: 'Orbitron', sans-serif; font-size: 16px; color: var(--gold); min-width: 34px; text-align: right; }
        .res-card button { width: auto; margin: 0; padding: 6px 10px; font-size: 11px; white-space: nowrap; }
        .res-tier-1 { border-left: 3px solid #78909c; }
        .res-tier-2 { border-left: 3px solid #29b6f6; }
        .res-tier-3 { border-left: 3px solid #ab47bc; }
        .res-tier-4 { border-left: 3px solid var(--gold); }
        .recipe-card { background: rgba(255,255,255,0.04); border: 1px solid #333; border-radius: 9px; padding: 11px; margin-bottom: 9px; }
        .recipe-card.ready { border-color: rgba(57,255,20,0.5); }
        .recipe-title { font-size: 14px; font-weight: 700; }
        .recipe-desc { font-size: 11px; color: #9fb4c7; margin: 3px 0 7px; }
        .recipe-cost { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .recipe-ing { font-size: 11px; padding: 3px 7px; border-radius: 5px; background: #1c1c2b; border: 1px solid #333; }
        .recipe-ing.ok { border-color: rgba(57,255,20,0.6); color: #b9ffb0; }
        .recipe-ing.missing { border-color: rgba(255,87,34,0.6); color: #ffb59c; }
        .recipe-card button { margin: 0; padding: 8px; font-size: 12px; }
        .shield-note { background: rgba(57,255,20,0.1); border: 1px solid rgba(57,255,20,0.4); color: #b9ffb0; border-radius: 6px; padding: 7px 10px; font-size: 11px; margin-bottom: 10px; }

        /* ===== Статистика та колекція ===== */
        .stat-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 12px; padding: 6px 2px; border-bottom: 1px solid #22222f; }
        .stat-row b { font-family: 'Orbitron', sans-serif; color: var(--gold); font-size: 12px; white-space: nowrap; }
        .coll-row { margin-bottom: 9px; }
        .coll-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }

        /* ===== Багаторівневі апгрейди магазину ===== */
        .upg-card { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid #333; border-radius: 8px; padding: 9px 11px; margin-bottom: 8px; }
        .upg-card img { width: 34px; height: 34px; object-fit: contain; flex-shrink: 0; }
        .upg-info { flex: 1; min-width: 0; }
        .upg-name { font-size: 13px; font-weight: 600; }
        .upg-meta { font-size: 10px; color: #9fb4c7; }
        .upg-card button { width: auto; margin: 0; padding: 8px 12px; font-size: 12px; white-space: nowrap; }
        .stars-section-title { font-size: 14px; margin: 0 0 8px; text-align: center; color: #eee; }
        .donate-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .donate-btn { background: linear-gradient(45deg, #ff2ea6, #ff9800); margin-bottom: 0; padding: 10px 4px; font-size: 13px; }
        .gacha-btn { background: linear-gradient(45deg, #ff9800, #ff5722); font-size: 16px; padding: 15px; box-shadow: 0 0 14px rgba(255,87,34,0.4); }
        .gacha-btn-premium { background: linear-gradient(45deg, #9c27b0, #673ab7); box-shadow: 0 0 14px rgba(156,39,176,0.5); }
        .btn-icon { width: 24px; height: 24px; vertical-align: middle; margin-right: 8px; border-radius: 5px; object-fit: cover; }
        .btn-emoji { display: inline-block; width: 24px; text-align: center; margin-right: 8px; }

        .click-text { position: absolute; color: var(--accent2); font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 22px; pointer-events: none; animation: floatUp 0.8s ease-out forwards; text-shadow: 0 0 6px var(--accent2), 0 0 14px var(--accent), 1px 1px 2px #000; z-index: 50; }
        @keyframes floatUp { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(-60px) scale(1.5); opacity: 0; } }

        #raid-screen, #knock-screen { position: fixed; top:0; left:0; right:0; bottom:0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; background-size: cover; background-position: center; }
        #raid-screen { background-image: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.75)), url('/images/raid-background.webp'); }
        #knock-screen { background-image: linear-gradient(rgba(120,0,0,0.75), rgba(80,0,0,0.85)), url('/images/qte-knock-door.webp'); }
        #raid-screen h1, #knock-screen h1 { color: #ff0000; font-size: 36px; animation: blink 0.2s infinite; text-align: center; margin: 0; padding: 0 20px; }
        #raid-timer, #knock-timer { font-size: 30px; color: #fff; margin: 20px 0; }
        #raid-progress { width: 80%; height: 30px; background: #333; border: 2px solid #fff; border-radius: 15px; overflow: hidden; margin-bottom: 30px; }
        #raid-fill { width: 0%; height: 100%; background: #ff0000; transition: width 0.1s; }
        .run-btn { font-size: 16px; font-weight: bold; padding: 10px; background: #ff0000; border-radius: 50%; width: 150px; height: 150px; border: 5px solid #fff; box-shadow: 0 0 30px #ff0000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
        .run-btn img { width: 50px; height: 50px; pointer-events: none; }
        .knock-btn { padding: 10px; background: #333; border-radius: 20px; border: 4px solid #fff; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center; }
        .knock-btn img { width: 90px; height: 90px; pointer-events: none; }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

        .airdrop { position: fixed; font-size: 36px; z-index: 900; cursor: pointer; animation: flyAcross 3s linear forwards; }
        @keyframes flyAcross { 0% { transform: translateX(-20px) translateY(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(20px) translateY(-40px); opacity: 0; } }

        #gacha-result { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #14141f; border: 2px solid var(--accent2); padding: 30px; border-radius: 15px; z-index: 500; text-align: center; box-shadow: 0 0 40px rgba(0,229,255,0.5), 0 0 70px rgba(255,46,166,0.3); display: none; max-width: 80vw; }
        #gacha-icon { width: 120px; height: 120px; object-fit: contain; margin: 10px auto; display: block; }
        .hidden { display: none !important; }

        #splash-screen { position: fixed; inset: 0; background: #000 url('/images/splash-banner.webp') center/cover no-repeat; z-index: 2000; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 40px; box-sizing: border-box; transition: opacity 0.4s ease; }
        #splash-screen span { color: #fff; font-weight: bold; letter-spacing: 2px; text-shadow: 0 0 10px #000; animation: pulse 1s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        .asset-row { display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
        .asset-name { font-weight: bold; }
        .asset-price { color: var(--gold); font-weight: bold; }
        .asset-controls { display: flex; gap: 6px; align-items: center; }
        .asset-controls input { width: 50px; text-align: center; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 4px; }
        .asset-controls button { width: auto; padding: 6px 10px; margin: 0; font-size: 12px; }
        .sparkline { height: 24px; width: 70px; }

        .clan-card { background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
        .clan-card button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; }

        .pet-card { background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
        .pet-card.equipped { border-color: var(--gold); }
        .pet-card .pet-title { font-weight: bold; }
        .pet-card .pet-desc { font-size: 11px; color: #aaa; margin: 4px 0 8px; }
        .pet-card button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; }

        .ach-row { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px; margin-bottom: 6px; opacity: 0.5; }
        .ach-row.unlocked { opacity: 1; border: 1px solid var(--gold); }
        .ach-icon { font-size: 22px; }
        .ach-name { font-weight: bold; font-size: 13px; }
        .ach-desc { font-size: 11px; color: #aaa; }

        .wheel-wrap { display: flex; flex-direction: column; align-items: center; margin: 15px 0; }
        #wheel { width: 220px; height: 220px; border-radius: 50%; border: 6px solid var(--accent2); box-shadow: 0 0 25px rgba(0,229,255,0.6); position: relative; transition: transform 4s cubic-bezier(0.15, 0.9, 0.2, 1); }
        .wheel-pointer { width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-bottom: 20px solid var(--accent2); filter: drop-shadow(0 0 6px var(--accent2)); margin-bottom: -4px; z-index: 2; }
        #wheel-labels { position: absolute; inset: 0; pointer-events: none; }

        .cosmetic-hat { position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 52px; height: 52px; font-size: 42px; line-height: 52px; text-align: center; z-index: 5; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
        .cosmetic-face { position: absolute; top: 38%; left: 50%; transform: translateX(-50%); width: 38px; height: 38px; font-size: 30px; line-height: 38px; text-align: center; z-index: 5; pointer-events: none; }
        .cosmetic-neck { position: absolute; top: 62%; left: 50%; transform: translateX(-50%); width: 38px; height: 38px; font-size: 30px; line-height: 38px; text-align: center; z-index: 5; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
        @keyframes rainbowGlow {
            0% { box-shadow: 0 0 0 4px #ff2ea6, 0 0 25px 6px #ff2ea688; }
            17% { box-shadow: 0 0 0 4px #ff9800, 0 0 25px 6px #ff980088; }
            34% { box-shadow: 0 0 0 4px #ffe066, 0 0 25px 6px #ffe06688; }
            50% { box-shadow: 0 0 0 4px #39ff14, 0 0 25px 6px #39ff1488; }
            67% { box-shadow: 0 0 0 4px #00e5ff, 0 0 25px 6px #00e5ff88; }
            84% { box-shadow: 0 0 0 4px #9c27b0, 0 0 25px 6px #9c27b088; }
            100% { box-shadow: 0 0 0 4px #ff2ea6, 0 0 25px 6px #ff2ea688; }
        }
        .frame-rainbow { animation: rainbowGlow 4s linear infinite; }
        @keyframes sirenGlow {
            0%, 49% { box-shadow: 0 0 0 4px #ff1744, 0 0 30px 8px #ff174499; }
            50%, 100% { box-shadow: 0 0 0 4px #2979ff, 0 0 30px 8px #2979ff99; }
        }
        .frame-siren { animation: sirenGlow 0.5s step-end infinite; }
        .cosmetic-card { background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .cosmetic-card.equipped { border-color: var(--gold); }
        .cosmetic-card .cosmetic-label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .cosmetic-card .cosmetic-emoji { font-size: 22px; }
        .cosmetic-card .cosmetic-swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; }
        .cosmetic-card button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; white-space: nowrap; }
        .slot-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 12px 0 6px; }

        .quest-row { background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
        .quest-row.done { border-color: var(--gold); }
        .quest-name { font-weight: bold; font-size: 13px; }
        .quest-desc { font-size: 11px; color: #aaa; margin: 4px 0 8px; }
        .quest-progress-bar { height: 8px; background: #333; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
        .quest-progress-fill { height: 100%; background: linear-gradient(90deg, #4caf50, #8bc34a); }
        .quest-row button { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; }

        .summons-btn { position: absolute; top: 10px; left: 10px; width: auto; margin: 0; padding: 5px 9px; font-size: 16px; border-radius: 50%; background: var(--btn); box-shadow: 0 0 10px rgba(0,229,255,0.4); }
        .help-btn { position: absolute; top: 10px; left: 52px; width: 30px; height: 30px; margin: 0; padding: 0; font-size: 15px; font-weight: 700; border-radius: 50%; background: var(--btn); box-shadow: 0 0 10px rgba(0,229,255,0.4); }

        #help-overlay { position: fixed; inset: 0; z-index: 1900; background: rgba(4,4,10,0.92); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; overflow-y: auto; }
        #help-card { background: var(--panel-bg); border: 1px solid rgba(0,229,255,0.35); border-radius: 14px; padding: 18px; max-width: 460px; width: 100%; box-shadow: 0 0 30px rgba(0,229,255,0.2); }
        .help-step { font-size: 13px; line-height: 1.55; color: #cfe3f2; background: rgba(255,255,255,0.04); border-left: 3px solid var(--accent2); border-radius: 6px; padding: 9px 11px; margin-bottom: 9px; }
        .help-step b { color: var(--text); }

        #room-screen { position: fixed; inset: 0; z-index: 1500; background: var(--bg); overflow-y: auto; padding: 15px; box-sizing: border-box; }
        .room-close { position: absolute; top: 10px; right: 15px; width: auto; padding: 6px 14px; margin: 0; z-index: 10; }
        /* Нова картинка кімнати (roomImg) — широка, персонаж стоїть у правій третині кадру
           анфас, зростом на всю висоту. Поки для локації немає roomImg, підставляється стара
           квадратна img (тоді композиція буде не ідеальною, це очікувано до заміни картинки). */
        .room-scene { position: relative; width: 100%; aspect-ratio: 16 / 9; background: rgba(255,255,255,0.04); border: 1px solid rgba(0,229,255,0.2); border-radius: 12px; margin-bottom: 15px; overflow: hidden; }
        .room-scene img#room-bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 0; filter: none; }
        .room-scene .emoji-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 110px; }
        /* Персонаж у кімнаті стоїть праворуч (~78% по X) — окремі координати від
           .cosmetic-hat/face/neck на головному екрані клікера (там персонаж по центру). */
        #room-cosmetic-hat { top: 6%; left: 77%; }
        #room-cosmetic-face { top: 26%; left: 77%; }
        #room-cosmetic-neck { top: 39%; left: 77%; }
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
    <div id="splash-screen"><span>Завантаження...</span></div>
    <header>
        <button class="summons-btn" onclick="openRoom()" title="Моя кімната">📜</button>
        <button class="help-btn" onclick="openHelp()" title="Як грати">?</button>
        <button class="daily-btn" onclick="claimDaily()"><img src="/images/daily-ration.webp" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:3px;border-radius:2px;">Пайок</button>
        <div class="streak-note" id="streak-note"></div>
        <div style="font-size: 14px; margin-bottom: 5px;">
            <span id="username">Ухилянт</span><span id="vip-badge" class="vip-badge hidden">VIP</span> | Lvl: <span id="level-display">1</span>
        </div>
        <h2><span id="balance">0</span> 🪙 ТК</h2>
        <div class="stats">
            <span>Пасив: <span id="passive">0</span>/с</span>
            <span>⭐ <span id="stars-count">0</span></span>
        </div>
        <div class="energy-bar"><div id="energy-fill" class="energy-fill"></div></div>
        <div class="clan-line hidden" id="clan-line"></div>
    </header>

    <main>
        <div class="location-name" id="location-name">Бабусин Диван</div>
        <div id="clicker" class="clickable">
            <img id="clicker-img" src="/images/location-1-couch.webp" alt="Ухилянт">
            <div id="clicker-emoji" class="emoji-fallback hidden"></div>
            <div id="cosmetic-hat" class="cosmetic-hat hidden"></div>
            <div id="cosmetic-face" class="cosmetic-face hidden"></div>
            <div id="cosmetic-neck" class="cosmetic-neck hidden"></div>
        </div>
    </main>

    <div class="tabs-container">
        <div class="tab active" onclick="switchTab(event, 'shop')">🛒 Магазин</div>
        <div class="tab" onclick="switchTab(event, 'quests')">📋 Квести</div>
        <div class="tab" onclick="switchTab(event, 'market')">📈 Біржа</div>
        <div class="tab" onclick="switchTab(event, 'clan')">🏘 Клани</div>
        <div class="tab" onclick="switchTab(event, 'gacha')">📦 Ящики</div>
        <div class="tab" onclick="switchTab(event, 'storage')">🗄 Кладовка</div>
        <div class="tab" onclick="switchTab(event, 'friends')">🤝 Друзі</div>
        <div class="tab" onclick="switchTab(event, 'revenge')">😈 Помста</div>
        <div class="tab" onclick="switchTab(event, 'stars')">💎 Донат</div>
        <div class="tab" onclick="switchTab(event, 'top')">🏆 ТОП</div>
    </div>

    <div id="shop" class="panel active">
        <p style="margin-top:0; color:#aaa; font-size:12px;">Апгрейди купуються нескінченно — кожен наступний рівень дорожчий.</p>
        <div id="upgrades-list"></div>
        <button onclick="buy('energy_drink', ${ECONOMY.ENERGY_DRINK_PRICE})"><img class="btn-icon" src="/images/shop-energy.webp" alt="">Енергетик (Відновити сили) | ${ECONOMY.ENERGY_DRINK_PRICE} 🪙</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Еволюція:</h3>
        <button onclick="buy('basement', ${ECONOMY.BASEMENT_PRICE})"><img class="btn-icon" src="/images/location-2-basement.webp" alt="">Переїзд у Підвал (Lvl 2) | ${ECONOMY.BASEMENT_PRICE} 🪙</button>
        <button onclick="buy('balkan', ${ECONOMY.BALKAN_PRICE})"><img class="btn-icon" src="/images/location-3-balkan.webp" alt="">Балканська хатинка (Lvl 3) | ${ECONOMY.BALKAN_PRICE} 🪙</button>
        <button onclick="buy('tisa', ${ECONOMY.TISA_PRICE})"><img class="btn-icon" src="/images/location-3-boat.webp" alt="">Човен на Тисі (Lvl 4) | ${ECONOMY.TISA_PRICE} 🪙</button>
        <button onclick="buy('abroad', ${ECONOMY.ABROAD_PRICE})"><img class="btn-icon" src="/images/location-5-abroad.webp" alt="">Закордон (Lvl 5) | ${ECONOMY.ABROAD_PRICE} 🪙</button>
        <button onclick="buy('bunker', ${ECONOMY.BUNKER_PRICE})"><img class="btn-icon" src="/images/location-6-bunker.webp" alt="">Президентський бункер (Lvl 6) | ${ECONOMY.BUNKER_PRICE} 🪙</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Компаньйони:</h3>
        <div id="pets-list"></div>
    </div>

    <div id="quests" class="panel">
        <p style="margin-top:0; color:#aaa; font-size:12px;">Щоденні квести. Прогрес і нагороди обнуляються опівночі.</p>
        <div id="quests-list"></div>
    </div>

    <div id="market" class="panel">
        <p style="margin-top:0; color:#aaa; font-size:12px;">Тіньова біржа. Купуй на низах, продавай на хаях. Курс оновлюється кожні 3 хв.</p>
        <button onclick="loadMarket()">🔄 Оновити курс</button>
        <div id="market-list"></div>
    </div>

    <div id="clan" class="panel">
        <div id="clan-mine"></div>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Створити чат ОСББ</h3>
        <input type="text" id="clan-name-input" placeholder="Назва чату" style="width:100%; padding:10px; box-sizing:border-box; background:#222; border:1px solid #444; color:#fff; border-radius:5px; margin-bottom:10px;">
        <button onclick="createClan()">Створити (+${(ECONOMY.CLAN_PASSIVE_BONUS * 100).toFixed(0)}% пасиву всім)</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Приєднатися</h3>
        <button onclick="loadClanList()">🔄 Оновити список чатів</button>
        <div id="clan-list"></div>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Топ чатів ОСББ (за спільним багатством)</h3>
        <button onclick="loadClanLeaderboard()">🔄 Оновити рейтинг кланів</button>
        <div id="clan-leaderboard"></div>
    </div>

    <div id="gacha" class="panel">
        <p style="margin-top:0; color:#aaa; font-size:12px;">Ящики — головне джерело ресурсів для кладовки й крафту. Шанси показані чесно, тицьни «шанси» під ящиком.</p>
        <div id="crates-list"></div>
        <h3 style="font-size:14px; margin: 20px 0 5px; border-bottom: 1px solid #444;">Колесо Зради та Перемоги (1 раз/день, безкоштовно):</h3>
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
            <div class="tab" onclick="switchStorageTab(event, 'storage-exp')">🌙 Вилазки</div>
        </div>
        <div id="storage-res" class="panel active">
            <p style="margin-top:0; color:#aaa; font-size:12px;">Ресурси падають із ящиків і вилазок. Здавай перекупу за ТК або тримай на крафт — крафт вигідніший.</p>
            <div id="resources-list"></div>
        </div>
        <div id="storage-craft" class="panel">
            <p style="margin-top:0; color:#aaa; font-size:12px;">Крафт дає те, що за валюту не купиш: щити від облав, розширення бака, постійні множники.</p>
            <div id="recipes-list"></div>
        </div>
        <div id="storage-exp" class="panel">
            <p style="margin-top:0; color:#aaa; font-size:12px;">Відправ себе по ресурси й закрий гру — вилазка йде реальний час. Є ризик спалитись і втратити здобич; щит від облав цей ризик прибирає.</p>
            <div id="expeditions-list"></div>
        </div>
    </div>

    <div id="friends" class="panel">
        <img src="/images/social-referral.webp" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
        <h3 style="margin-top:0;">Здай друга</h3>
        <p style="font-size:12px; color:#aaa;">Отримай ${ECONOMY.REFERRAL_REWARD} 🪙 за кожного друга, який перейде за твоїм посиланням і заляже на дно.</p>
        <p style="font-size:12px;">Здано друзів: <b id="ref-count">0</b></p>
        <input type="text" id="ref-link" readonly style="width: 100%; padding: 10px; background: #222; color: #fff; border: 1px solid #444; border-radius: 5px; margin-bottom: 10px; box-sizing: border-box;">
        <button onclick="copyRef()">📋 Скопіювати посилання</button>
    </div>

    <div id="revenge" class="panel">
        <h3 class="stars-section-title">📜 Легалізація (престиж)</h3>
        <div id="prestige-box"></div>
        <hr style="border:0; border-top:1px solid #444; margin: 18px 0;">
        <h3 class="stars-section-title">😈 Помста інспектору</h3>
        <p style="margin-top:0; color:#aaa; font-size:12px;">Дрібна ненасильницька помста за всі облави. Розблоковується після ${ECONOMY.REVENGE_UNLOCK_RAIDS} виживаних облав, 1 раз/день.</p>
        <div id="revenge-locked-note" class="hidden" style="font-size:12px; color:#aaa; text-align:center; padding:15px;"></div>
        <button id="revenge-btn" onclick="takeRevenge()">😈 Помститись</button>
        <div id="revenge-result" class="hidden" style="background:rgba(255,255,255,0.05); border:1px solid rgba(0,229,255,0.2); border-radius:8px; padding:12px; margin-top:10px; font-size:13px;"></div>
    </div>

    <div id="stars" class="panel">
        <div class="dev-notice">
            ⚠️ Проєкт ще в розробці й поки не переїхав на постійні сервери — прогрес
            зберігається на тестовому хостингу і теоретично може губитись при оновленнях
            гри. Вибачте за незручності!
        </div>

        <h3 class="stars-section-title">👑 VIP-Схрон</h3>
        <button class="premium-btn" onclick="buyRealVip()"><img class="btn-icon" src="/images/vip-badge.webp" alt="">VIP-Схрон (${ECONOMY.VIP_PRICE_STARS} ⭐)</button>
        <p style="font-size:12px; color:#aaa; text-align:center; margin-top:6px;">VIP: Х3 дохід, нескінченна енергія, повний імунітет до ОБЛАВ.</p>

        <hr style="border:0; border-top:1px solid #444; margin: 18px 0;">

        <h3 class="stars-section-title">🔑 Промокод</h3>
        <input type="text" id="promo" placeholder="Введи промокод" style="width:100%; padding:10px; box-sizing:border-box; background:#222; border:1px solid #444; color:#fff; border-radius:5px; margin-bottom:10px;">
        <button onclick="usePromo()">Активувати код</button>

        <hr style="border:0; border-top:1px solid #444; margin: 18px 0;">

        <h3 class="stars-section-title">❤️ Підтримати розробника</h3>
        <p style="font-size:12px; color:#aaa; text-align:center; margin-top:0;">Жодних ігрових бонусів — просто щоб сказати "дякую" за гру.</p>
        <div class="donate-grid">
            ${ECONOMY.DONATE_AMOUNTS.map(a => `<button class="donate-btn" onclick="buyDonate(${a})">${a} ⭐</button>`).join('')}
        </div>
    </div>

    <div id="top" class="panel">
        <h3 style="font-size:14px; margin: 0 0 8px; border-bottom: 1px solid #444;">📊 Твоя статистика</h3>
        <div id="stats-box"></div>
        <h3 style="font-size:14px; margin: 18px 0 8px; border-bottom: 1px solid #444;">🎯 Колекція</h3>
        <div id="collection-box"></div>
        <h3 style="font-size:14px; margin: 18px 0 8px; border-bottom: 1px solid #444;">🏆 Рейтинг гравців</h3>
        <img src="/images/leaderboard-trophy.webp" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
        <button onclick="loadTop()">🔄 Оновити рейтинг</button>
        <ol id="leaderboard-list" style="padding-left: 20px; font-family: monospace; font-size: 14px; line-height: 1.8;"></ol>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Досягнення:</h3>
        <div id="achievements-list"></div>
    </div>

    <div id="gacha-result">
        <h2 id="gacha-title" style="margin-top:0; color:var(--gold);">🎉 Джекпот!</h2>
        <img id="gacha-icon" src="" alt="">
        <p id="gacha-desc">Ти отримав Білий Квиток!</p>
        <button onclick="document.getElementById('gacha-result').classList.add('hidden')">Забрати</button>
    </div>

    <!-- Коротка довідка. Показується один раз на першому запуску (прапорець у
         localStorage) і далі відкривається кнопкою "?" у шапці. -->
    <div id="help-overlay" class="hidden">
        <div id="help-card">
            <h2 style="margin-top:0; color:var(--gold); font-size:20px;">Як грати</h2>
            <div class="help-step"><b>1. Клікай по персонажу</b><br>Кожен клік — ТК, але витрачає енергію. Енергія відновлюється ~1 за секунду, тож безкінечно клікати не вийде.</div>
            <div class="help-step"><b>2. Поки чекаєш енергію — є чим зайнятись</b><br>Відкривай <b>ящики</b> (📦) заради ресурсів або відправляйся на <b>вилазку</b> (🗄 Кладовка → Вилазки) — вона йде реальний час, навіть коли гра закрита.</div>
            <div class="help-step"><b>3. Ресурси йдуть у крафт</b><br>У <b>Кладовці</b> можна здати ресурси за ТК або скрафтити те, що за гроші не купиш: щити від облав, +клік і +пасив назавжди.</div>
            <div class="help-step"><b>4. Прокачуйся в Магазині</b><br>Апгрейди купуються нескінченно, кожен рівень дорожчий. Далі — переїзд у кращий схрон.</div>
            <div class="help-step"><b>5. Ціль гри</b><br>Дійти до бункера й <b>легалізуватись</b> (вкладка 😈): скидаєш прогрес, але отримуєш довідки — назавжди +10% доходу за кожну.</div>
            <button onclick="closeHelp()">Зрозуміло</button>
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
            <div id="room-cosmetic-hat" class="cosmetic-hat hidden"></div>
            <div id="room-cosmetic-face" class="cosmetic-face hidden"></div>
            <div id="room-cosmetic-neck" class="cosmetic-neck hidden"></div>
            ${ROOM_ITEMS.map((it) => `<div id="room-item-${it.id}" class="room-item pos-${it.pos} hidden">${it.img ? `<img src="${it.img}" alt="">` : it.emoji}</div>`).join('')}
        </div>
        <div class="tabs-container">
            <div class="tab active" onclick="switchRoomTab(event, 'room-wardrobe')">🎨 Гардероб</div>
            <div class="tab" onclick="switchRoomTab(event, 'room-shop')">🛋 Речі кімнати</div>
        </div>
        <div id="room-wardrobe" class="panel active">
            <p style="margin-top:0; color:#aaa; font-size:12px;">Суто косметика — не впливає на економіку, лише стиль.</p>
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
            <p style="margin-top:0; color:#aaa; font-size:12px;">Прикрась кімнату — можна тримати декілька речей одночасно.</p>
            <div id="room-items-list"></div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.disableVerticalSwipes();

        // Автоматично додає підписані дані Telegram (initData) до кожного захищеного запиту,
        // щоб сервер міг довіряти, що запит справді від цього користувача.
        function apiFetch(url, options = {}) {
            options.headers = Object.assign({}, options.headers, { 'X-Telegram-Init-Data': tg.initData || '' });
            // Кожна відповідь із balanceRev одразу оновлює локальну ревізію — так автозбереження
            // завжди шле актуальну, і сервер не відхиляє наш баланс без потреби.
            return fetch(url, options).then(res => {
                const origJson = res.json.bind(res);
                res.json = async () => {
                    const data = await origJson();
                    if (data && typeof data.balanceRev === 'number') state.balanceRev = data.balanceRev;
                    return data;
                };
                return res;
            });
        }

        const BOT_USERNAME = '${botUsername}';
        const ECONOMY = ${JSON.stringify(ECONOMY)};
        const LOCATIONS = ${JSON.stringify(LOCATIONS)};
        const PETS = ${JSON.stringify(PETS)};
        const MARKET_ASSETS = ${JSON.stringify(MARKET_ASSETS)};
        const WHEEL_SEGMENTS = ${JSON.stringify(WHEEL_SEGMENTS)};
        const ACHIEVEMENTS_META = ${JSON.stringify(ACHIEVEMENTS_META)};
        const COSMETICS = ${JSON.stringify(COSMETICS)};
        const QUESTS = ${JSON.stringify(QUESTS)};
        const ROOM_ITEMS = ${JSON.stringify(ROOM_ITEMS)};
        const RESOURCES = ${JSON.stringify(RESOURCES)};
        const RESOURCE_BY_ID = Object.fromEntries(RESOURCES.map(r => [r.id, r]));
        const CRATES = ${JSON.stringify(CRATES)};
        const RECIPES = ${JSON.stringify(RECIPES)};
        const EXPEDITIONS = ${JSON.stringify(EXPEDITIONS)};

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
            craftedCount: 0, shieldUntil: 0, permanentShield: false,
            balanceRev: 0,
        };

        const ui = {
            bal: document.getElementById('balance'), pas: document.getElementById('passive'),
            enr: document.getElementById('energy-fill'), lvl: document.getElementById('level-display'),
            loc: document.getElementById('location-name'), clk: document.getElementById('clicker'),
            clkImg: document.getElementById('clicker-img'), clkEmoji: document.getElementById('clicker-emoji'),
            str: document.getElementById('stars-count'), vip: document.getElementById('vip-badge'),
            refCount: document.getElementById('ref-count'), clanLine: document.getElementById('clan-line'),
            streakNote: document.getElementById('streak-note'),
        };

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

        function applyLocation() {
            const loc = LOCATIONS.find(l => l.level === state.level) || LOCATIONS[0];
            ui.loc.innerText = loc.name;
            if (loc.img) {
                ui.clkImg.classList.remove('hidden');
                ui.clkEmoji.classList.add('hidden');
                if (ui.clkImg.getAttribute('src') !== loc.img) ui.clkImg.src = loc.img;
            } else {
                ui.clkImg.classList.add('hidden');
                ui.clkEmoji.classList.remove('hidden');
                ui.clkEmoji.innerText = loc.emoji || '❓';
            }
        }

        function updateUI() {
            ui.bal.innerText = Math.floor(state.balance);
            ui.pas.innerText = state.passive;
            ui.str.innerText = 0;
            ui.lvl.innerText = state.level;
            ui.refCount.innerText = state.refCount;
            ui.vip.classList.toggle('hidden', !state.isVip);
            let enPercent = (state.energy / state.maxEnergy) * 100;
            ui.enr.style.width = enPercent + '%';
            ui.enr.style.background = enPercent < 20 ? '#f44336' : (enPercent < 50 ? '#ff9800' : 'linear-gradient(90deg, #4caf50, #8bc34a)');
            applyLocation();
            if (state.clanName) {
                ui.clanLine.classList.remove('hidden');
                ui.clanLine.innerText = '🏘 ' + state.clanName + ' (+' + Math.round((state.clanBonus - 1) * 100) + '% пасиву)';
            } else {
                ui.clanLine.classList.add('hidden');
            }
            ui.streakNote.innerText = state.dailyStreak > 0 ? ('Серія: День ' + state.dailyStreak + '/7') : '';
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
                resources: state.resources, storageLevel: state.storageLevel,
                upgrades: state.upgrades, craftedCount: state.craftedCount,
                shieldUntil: state.shieldUntil, permanentShield: state.permanentShield,
                expeditionsDone: state.expeditionsDone,
                totalEarned: state.totalEarned,
                prestigePoints: state.prestigePoints, prestigeCount: state.prestigeCount,
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
                state.dailyStreak = data.dailyStreak; state.wheelClaimedToday = data.wheelClaimedToday;
                // Кладовка / крафт / багаторівневі апгрейди
                state.resources = data.resources || {};
                state.storageLevel = data.storageLevel || 0;
                state.storageCapacity = data.storageCapacity || 0;
                state.storageUsed = data.storageUsed || 0;
                state.storageUpgradeCost = data.storageUpgradeCost;
                state.upgrades = data.upgrades || { hat: 0, jam: 0, thermos: 0, generator: 0 };
                state.upgradeCosts = data.upgradeCosts || {};
                state.craftedCount = data.craftedCount || 0;
                state.shieldUntil = data.shieldUntil || 0;
                state.permanentShield = !!data.permanentShield;
                state.expedition = data.expedition || null;
                state.expeditionsDone = data.expeditionsDone || 0;
                state.totalEarned = data.totalEarned || 0;
                state.prestigePoints = data.prestigePoints || 0;
                state.prestigeCount = data.prestigeCount || 0;
                state.prestigeMultiplier = data.prestigeMultiplier || 1;
                state.prestigeAvailable = data.prestigeAvailable || 0;

                if (data.lastPremiumReward) {
                    // Ящик за Stars розкривався на сервері — програємо анімацію одразу на вході.
                    playCrateAnimation(data.lastPremiumReward, data.lastPremiumReward.crateId || 'elite');
                } else if (data.offlineEarnings > 0) {
                    showGachaModal('Поки тебе не було...', '/images/gacha-jackpot.webp', 'Ти тихо відсидівся і заробив +' + Math.round(data.offlineEarnings) + ' ТК!');
                }
            } catch (e) {
                console.error('Не вдалося завантажити стан гравця', e);
            }
            updateUI();
            renderOwnedStuff();
            renderAchievements();
            renderWheel();
            const splash = document.getElementById('splash-screen');
            if (splash) {
                setTimeout(() => {
                    splash.style.opacity = '0';
                    setTimeout(() => splash.remove(), 400);
                }, 600);
            }
            maybeShowHelpOnFirstRun();
        }
        init();

        function saveState() {
            saveToCloud();
            apiFetch('/api/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id, name: user.first_name, balance: state.balance,
                    balanceRev: state.balanceRev,
                    clickVal: state.clickVal, passive: state.passive, level: state.level,
                    energy: state.energy, maxEnergy: state.maxEnergy,
                    totalClicks: state.totalClicks, boxesOpened: state.boxesOpened, raidsSurvived: state.raidsSurvived,
                })
            }).then(r => r.json()).then(data => {
                // Сервер відхилив наш баланс — значить він змінював його сам (ящик/крафт/апгрейд),
                // поки ми не встигли синхронізуватись. Беремо його значення як авторитетне.
                if (data.balanceRejected && typeof data.balance === 'number') {
                    state.balance = data.balance;
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
            }).catch(() => {});
        }

        // ===== Основний клік =====
        ui.clk.addEventListener('touchstart', handleMainClick, { passive: false });
        ui.clk.addEventListener('mousedown', handleMainClick);

        function handleMainClick(e) {
            e.preventDefault();
            if (state.energy <= 0 && !state.isVip) {
                tg.HapticFeedback.notificationOccurred('error');
                return;
            }
            let earned = state.clickVal * petMult('click') * (state.isVip ? 3 : 1) * (state.prestigeMultiplier || 1);
            state.balance += earned;
            state.totalClicks += 1;
            if (!state.isVip) state.energy = Math.max(0, state.energy - ECONOMY.ENERGY_PER_CLICK);

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
            if (state.passive > 0) state.balance += (state.passive * state.clanBonus * (state.isVip ? 3 : 1) * (state.prestigeMultiplier || 1)) / 10;
            if (state.energy < state.maxEnergy) {
                state.energy = Math.min(state.maxEnergy, state.energy + ECONOMY.ENERGY_REGEN_PER_TICK * petMult('energy'));
            }
            updateUI();
        }, 100);

        setInterval(saveState, 5000);

        // Зворотний відлік вилазки. Навмисно окремий інтервал раз на секунду і лише коли
        // вкладка вилазок реально видима — у гарячому 100мс-циклі важкі рендери тримати не можна.
        setInterval(() => {
            if (!state.expedition) return;
            const panel = document.getElementById('storage-exp');
            if (panel && panel.classList.contains('active')) renderExpeditions();
        }, 1000);

        // ===== Навігація =====
        window.switchTab = (evt, tabId) => {
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
        };

        // ===== Магазин =====
        // Апгрейди кліку/пасиву тепер багаторівневі й купуються через buyUpgrade() на сервері.
        // Тут лишились разові покупки: енергетик і переїзди між локаціями.
        window.buy = (item, price) => {
            if (state.balance < price) return tg.showAlert('Недостатньо ТК!');
            state.balance -= price;
            if (item === 'energy_drink') state.energy = state.maxEnergy;
            if (item === 'basement' && state.level < 2) { state.level = 2; state.maxEnergy = LOCATIONS[1].maxEnergy; state.energy = state.maxEnergy; }
            if (item === 'balkan' && state.level < 3) { state.level = 3; state.maxEnergy = LOCATIONS[2].maxEnergy; state.energy = state.maxEnergy; }
            if (item === 'tisa' && state.level < 4) { state.level = 4; state.maxEnergy = LOCATIONS[3].maxEnergy; state.energy = state.maxEnergy; }
            if (item === 'abroad' && state.level < 5) { state.level = 5; state.maxEnergy = LOCATIONS[4].maxEnergy; state.energy = state.maxEnergy; }
            if (item === 'bunker' && state.level < 6) { state.level = 6; state.maxEnergy = LOCATIONS[5].maxEnergy; state.energy = state.maxEnergy; }
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            saveState();
        };

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
                const visual = p.img
                    ? '<img class="btn-icon" src="' + p.img + '" alt="">'
                    : '<span class="btn-emoji">' + (p.emoji || '🐾') + '</span>';
                return '<div class="pet-card' + (equipped ? ' equipped' : '') + '">' +
                    '<div class="pet-title">' + visual + p.name + (equipped ? ' (активний)' : '') + '</div>' +
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

        function applyCosmeticOverlay() {
            renderCharacterOverlay(ui.clkImg, ui.clkEmoji, document.getElementById('cosmetic-hat'), document.getElementById('cosmetic-face'), document.getElementById('cosmetic-neck'));
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
            const loc = LOCATIONS.find(l => l.level === state.level) || LOCATIONS[0];
            const bgImg = document.getElementById('room-bg-img');
            const emojiEl = document.getElementById('room-emoji-fallback');
            const roomSrc = loc.roomImg || loc.img;
            if (roomSrc) {
                bgImg.classList.remove('hidden'); emojiEl.classList.add('hidden');
                bgImg.src = roomSrc;
            } else {
                bgImg.classList.add('hidden'); emojiEl.classList.remove('hidden');
                emojiEl.innerText = loc.emoji || '❓';
            }
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

        // ==========================================
        // ЯЩИКИ (список, шанси, анімація відкривання)
        // ==========================================
        function lootLabel(entry) {
            if (entry.type === 'nothing') return '🧦 Пусто';
            if (entry.type === 'coins') return '🪙 ' + entry.min.toLocaleString('uk-UA') + '–' + entry.max.toLocaleString('uk-UA') + ' ТК';
            if (entry.type === 'energy') return '🔋 Повна енергія';
            if (entry.type === 'cosmetic') return '👕 Річ у гардероб';
            const meta = RESOURCE_BY_ID[entry.res];
            return meta.emoji + ' ' + meta.name + ' ' + entry.min + (entry.max > entry.min ? '–' + entry.max : '');
        }

        function renderCrates() {
            const list = document.getElementById('crates-list');
            if (!list) return;
            list.innerHTML = CRATES.map(c => {
                const totalWeight = c.loot.reduce((s, e) => s + e.weight, 0);
                const odds = c.loot.map(e =>
                    '<div><span>' + lootLabel(e) + '</span><span>' + (100 * e.weight / totalWeight).toFixed(1) + '%</span></div>'
                ).join('');
                const priceLabel = c.currency === 'stars'
                    ? c.price + ' ⭐'
                    : c.price.toLocaleString('uk-UA') + ' 🪙';
                const btnClass = c.currency === 'stars' ? 'gacha-btn gacha-btn-premium' : 'gacha-btn';
                return '<div class="crate-card' + (c.currency === 'stars' ? ' stars' : '') + '">' +
                    '<div class="crate-top">' +
                        '<img src="' + c.img + '" alt="">' +
                        '<div><div class="crate-name">' + c.emoji + ' ' + c.name + '</div>' +
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
        function playCrateAnimation(reward, crateId) {
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
                document.getElementById('crate-close').classList.remove('hidden');
                // Повторне відкриття доступне лише для ящиків за ігрову валюту —
                // за Stars повтор має йти через звичайний платіжний флоу, без "ще раз" в один тап.
                if (crate.currency === 'coins') {
                    lastCrateId = crate.id;
                    document.getElementById('crate-again-wrap').classList.remove('hidden');
                    document.getElementById('crate-again').innerText = 'Ще раз — ' + crate.price.toLocaleString('uk-UA') + ' 🪙';
                }
            }, 1500);

            // Страховка: коли анімація мала б завершитись, жорстко фіксуємо фінальний стан.
            // Якщо вкладка була згорнута, CSS-анімації не просувались і зависли б на 0%.
            setTimeout(() => overlay.classList.add('anim-done'), 2100);
        }

        window.closeCrateOverlay = () => {
            document.getElementById('crate-overlay').className = 'hidden';
        };

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

            if (state.balance < crate.price) return tg.showAlert('Не вистачає ТК на цей ящик!');
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
                const sellBtn = qty > 0
                    ? '<button onclick="sellResource(\\'' + r.id + '\\')">Здати все (+' + (qty * r.sell).toLocaleString('uk-UA') + ' 🪙)</button>'
                    : '';
                return '<div class="res-card res-tier-' + r.tier + (qty === 0 ? ' empty' : '') + '">' +
                    '<span class="res-emoji">' + r.emoji + '</span>' +
                    '<div class="res-info"><div class="res-name">' + r.name + '</div>' +
                    '<div class="res-meta">тір ' + r.tier + ' · ' + r.sell + ' 🪙 за шт.</div></div>' +
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
                return '<div class="recipe-card' + (canCraft && !alreadyHas ? ' ready' : '') + '">' +
                    '<div class="recipe-title">' + rc.emoji + ' ' + rc.name + '</div>' +
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
        function maybeShowHelpOnFirstRun() {
            let seen = false;
            try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch (e) {}
            if (!seen) setTimeout(openHelp, 1200); // після сплеш-екрана
        }

        // ===== Статистика та колекція =====
        function fmtNum(n) { return Math.round(n || 0).toLocaleString('uk-UA'); }

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
                action = '<button disabled>🔒 Потрібен ' + ECONOMY.PRESTIGE_UNLOCK_LEVEL + ' рівень схрону (бункер)</button>';
            } else if (avail < 1) {
                const need = Math.pow((pts + 1), 2) * ECONOMY.PRESTIGE_EARN_PER_POINT;
                const left = Math.max(0, need - (state.totalEarned || 0));
                action = '<button disabled>Ще ' + Math.round(left).toLocaleString('uk-UA') + ' ТК заробити до наступної довідки</button>';
            } else {
                action = '<button onclick="doPrestige()">📜 Легалізуватись (+' + avail + ' довідк' + (avail === 1 ? 'а' : 'и') + ')</button>';
            }

            box.innerHTML =
                '<div class="recipe-card' + (avail >= 1 && unlocked ? ' ready' : '') + '">' +
                    '<div class="recipe-desc" style="margin-top:0">Здаєшся "офіційно", починаєш з нуля — але кожна довідка назавжди дає ' +
                    '<b style="color:var(--gold)">+' + bonusPct + '% до всього доходу</b>.<br>' +
                    'Скидається: баланс, апгрейди, рівень схрону, біржа.<br>' +
                    'Лишається: гардероб, кімната, компаньйони, кладовка, досягнення.</div>' +
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
            tg.showConfirm('Легалізуватись? Баланс, апгрейди й рівень схрону скинуться до нуля. Отримаєш ' + avail + ' довідок (+' + Math.round(avail * ECONOMY.PRESTIGE_BONUS_PER_POINT * 100) + '% до доходу назавжди).', async (ok) => {
                if (!ok) return;
                const res = await apiFetch('/api/prestige/claim', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id })
                });
                const data = await res.json();
                if (!data.success) return tg.showAlert(data.message || 'Помилка');
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert('📜 Легалізовано! +' + data.gained + ' довідок. Твій множник тепер x' + data.multiplier.toFixed(2));
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

        function renderExpeditions() {
            const list = document.getElementById('expeditions-list');
            if (!list) return;
            const active = state.expedition;

            if (active) {
                const exp = EXPEDITIONS.find(e => e.id === active.id);
                const left = active.endsAt - Date.now();
                const total = exp.minutes * 60 * 1000;
                const pct = Math.min(100, 100 * (1 - left / total));
                const done = left <= 0;
                list.innerHTML =
                    '<div class="recipe-card ready">' +
                        '<div class="recipe-title">' + exp.emoji + ' ' + exp.name + '</div>' +
                        '<div class="recipe-desc">' + (done ? 'Вилазка завершена — забирай здобич!' : 'Залишилось: ' + fmtLeft(left)) + '</div>' +
                        '<div class="storage-bar" style="margin-bottom:9px;"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
                        '<button onclick="claimExpedition()"' + (done ? '' : ' disabled') + '>' +
                        (done ? '🎒 Забрати здобич' : 'Ще в дорозі...') + '</button>' +
                    '</div>';
                return;
            }

            list.innerHTML = EXPEDITIONS.map(e => {
                const locked = state.level < e.minLevel;
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
                    (locked ? '🔒 Потрібен ' + e.minLevel + ' рівень схрону' : '🌙 Вирушити') + '</button>' +
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
            state.expedition = data.expedition;
            tg.HapticFeedback.notificationOccurred('success');
            renderExpeditions();
        };

        window.claimExpedition = async () => {
            const res = await apiFetch('/api/expedition/claim', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.expedition = null;
            state.resources = data.resources;
            state.storageUsed = data.used;
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
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('🔨 ' + data.message);
            if (data.unlockedAchievements && data.unlockedAchievements.length) {
                data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                renderAchievements();
            }
            updateUI();
            renderStorage();
            renderRecipes();
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

        function renderUpgrades() {
            const list = document.getElementById('upgrades-list');
            if (!list) return;
            list.innerHTML = UPGRADE_META.map(u => {
                const lvl = (state.upgrades || {})[u.key] || 0;
                const cost = (state.upgradeCosts || {})[u.key] || 0;
                const afford = state.balance >= cost;
                return '<div class="upg-card">' +
                    '<img src="' + u.img + '" alt="">' +
                    '<div class="upg-info"><div class="upg-name">' + u.name + ' <span style="color:var(--gold)">Ур. ' + lvl + '</span></div>' +
                    '<div class="upg-meta">' + u.bonus + ' за рівень</div></div>' +
                    '<button onclick="buyUpgrade(\\'' + u.key + '\\')"' + (afford ? '' : ' disabled') + '>' +
                    cost.toLocaleString('uk-UA') + ' 🪙</button>' +
                '</div>';
            }).join('');
        }

        window.buyUpgrade = async (key) => {
            const res = await apiFetch('/api/upgrade/buy', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, key })
            });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.balance = data.balance; state.clickVal = data.clickVal; state.passive = data.passive;
            state.upgrades = data.upgrades;
            state.upgradeCosts[key] = data.nextCost;
            tg.HapticFeedback.notificationOccurred('success');
            if (data.unlockedAchievements && data.unlockedAchievements.length) {
                data.unlockedAchievements.forEach(a => state.achievements.push(a.id));
                renderAchievements();
            }
            updateUI();
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
                container.innerHTML = COSMETICS.filter(c => c.slot === slot).map(c => {
                    const owned = state.ownedCosmetics.includes(c.id);
                    const equipped = state.equippedCosmetics[slot] === c.id;
                    let swatchBg = c.color;
                    if (c.color === 'rainbow') swatchBg = 'conic-gradient(#ff2ea6, #ff9800, #ffe066, #39ff14, #00e5ff, #9c27b0, #ff2ea6)';
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
            state.dailyClicks = data.dailyClicks; state.dailyTrades = data.dailyTrades;
            state.dailyBoxes = data.dailyBoxes; state.dailyRaids = data.dailyRaids;
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
            list.innerHTML = MARKET_ASSETS.map(a => {
                const price = data.prices[a.id];
                const held = state.portfolio[a.id] || 0;
                const pts = sparklinePoints(data.history[a.id], 70, 24);
                return '<div class="asset-row">' +
                    '<div><div class="asset-name">' + a.emoji + ' ' + a.name + '</div><div style="font-size:11px;color:#aaa;">В портфелі: ' + held + '</div></div>' +
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
            state.balance = data.balance; state.portfolio = data.portfolio;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            loadMarket();
        };

        // ===== Клани =====
        function renderClanMine() {
            const el = document.getElementById('clan-mine');
            if (state.clanId) {
                el.innerHTML = '<div class="clan-card"><div><b>🏘 ' + state.clanName + '</b><br><span style="font-size:11px;color:#aaa;">+' + Math.round((state.clanBonus - 1) * 100) + '% пасиву всім учасникам</span></div><button onclick="leaveClan()">Вийти</button></div>';
            } else {
                el.innerHTML = '<p style="font-size:12px;color:#aaa;">Ти поки не в жодному чаті ОСББ.</p>';
            }
        }

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
            list.innerHTML = data.map(c => '<div class="clan-card"><span>🏘 ' + c.name + ' (' + c.members + ')</span><button onclick="joinClan(\\'' + c.id + '\\')">Приєднатись</button></div>').join('') || '<p style="font-size:12px;color:#aaa;">Поки немає жодного чату. Створи перший!</p>';
        };

        window.loadClanLeaderboard = async () => {
            const list = document.getElementById('clan-leaderboard');
            list.innerHTML = 'Завантаження...';
            const res = await fetch('/api/clan/leaderboard');
            const data = await res.json();
            list.innerHTML = data.map((c, i) => '<div class="clan-card"><span>#' + (i + 1) + ' 🏘 ' + c.name + ' (' + c.members + ' уч.)</span><b style="color:var(--gold)">' + c.totalBalance + ' 🪙</b></div>').join('') || '<p style="font-size:12px;color:#aaa;">Поки немає рейтингу.</p>';
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
                tg.showAlert(data.message);
                if (data.success) {
                    document.getElementById('promo').value = '';
                    if (data.reset) {
                        await init(); // повне обнулення — перетягуємо весь стан з сервера заново, а не патчимо шматками
                    } else {
                        state.balance = data.balance; state.isVip = data.isVip;
                        updateUI();
                    }
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
            list.innerHTML = data.map((u) =>
                '<li>' + (u.isVip ? '👑 ' : '') + u.name + ' - <b style="color:var(--gold)">' + Math.floor(u.balance) + '</b></li>'
            ).join('') || '<li>Поки що нікого немає</li>';
        }

        // ==========================================
        // МЕХАНІКА ОБЛАВИ (БОС-ФАЙТ)
        // ==========================================
        setInterval(() => {
            if (state.isVip || hasShield() || Math.random() > ECONOMY.RAID_CHANCE * petMult('raid')) return;

            const raidScreen = document.getElementById('raid-screen');
            const timerEl = document.getElementById('raid-timer');
            const fillEl = document.getElementById('raid-fill');
            const runBtn = document.getElementById('run-btn');

            raidScreen.classList.remove('hidden');
            tg.HapticFeedback.notificationOccurred('warning');

            let timeLeft = ECONOMY.RAID_DURATION_S;
            let clicksNeeded = ECONOMY.RAID_CLICKS_NEEDED;
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
            if (state.isVip || hasShield() || Math.random() > ECONOMY.QTE_KNOCK_CHANCE) return;

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
            if (Math.random() > ECONOMY.AIRDROP_CHANCE) return;
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
app.get('/', (req, res) => res.send(HTML_CONTENT));

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
