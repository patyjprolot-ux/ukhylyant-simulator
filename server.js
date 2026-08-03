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
    HAT_PRICE: 100, HAT_CLICK_BONUS: 1,
    JAM_PRICE: 500, JAM_PASSIVE_BONUS: 5,
    ENERGY_DRINK_PRICE: 300,
    THERMOS_PRICE: 1500, THERMOS_CLICK_BONUS: 3,
    GENERATOR_PRICE: 4000, GENERATOR_PASSIVE_BONUS: 10,
    BASEMENT_PRICE: 2000,
    BALKAN_PRICE: 6000,
    TISA_PRICE: 20000,
    ABROAD_PRICE: 50000,
    BUNKER_PRICE: 150000,
    GACHA_PRICE: 1000,
    VIP_PRICE_STARS: 500,
    GACHA_PREMIUM_STARS: 100,
    DONATE_AMOUNTS: [50, 100, 250, 500], // Stars — чиста підтримка розробників, без ігрових бонусів
    DAILY_REWARDS: [2000, 2500, 3000, 3500, 4000, 5000, 15000], // індекс = поточний день серії - 1, індекс 6 = День 7 (джекпот)
    REFERRAL_REWARD: 5000,
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
    AIRDROP_MIN: 300,
    AIRDROP_MAX: 800,
    CLAN_PASSIVE_BONUS: 0.05,
    OFFLINE_CAP_SECONDS: 8 * 3600,
    OFFLINE_MIN_SECONDS: 30,
    PET_GOOSE_CLICK_MULT: 1.15,
    PET_CAT_ENERGY_MULT: 1.3,
    PET_NEIGHBOR_RAID_MULT: 0.9,
};

// 4 етапи еволюції схованки.
const LOCATIONS = [
    { level: 1, name: 'Бабусин Диван', img: '/images/location-1-couch.png', maxEnergy: 100 },
    { level: 2, name: 'Вологий Підвал', img: '/images/location-2-basement.png', maxEnergy: 150 },
    { level: 3, name: 'Балканська хатинка', img: '/images/location-3-balkan.png', maxEnergy: 220 },
    { level: 4, name: 'Човен на Тисі', img: '/images/location-3-boat.png', maxEnergy: 300 },
    { level: 5, name: 'Закордон (Гуманітарний коридор)', emoji: '🛂', maxEnergy: 400 },
    { level: 6, name: 'Президентський бункер', emoji: '🏛️', maxEnergy: 500 },
];

// Компаньйони — пасивні мультиплікатори, екіпірується один одночасно.
const PETS = [
    { id: 'neighbor', name: 'Сусідка-пліткарка', img: '/images/pet-neighbor.png', price: 3000, desc: '-10% до шансу облави (попереджає завчасно)' },
    { id: 'goose', name: 'Бойовий Гусак', img: '/images/pet-goose.png', price: 8000, desc: '+15% до сили кліку' },
    { id: 'cat', name: 'Кіт-антистрес', img: '/images/pet-cat.png', price: 6000, desc: '+30% до швидкості відновлення енергії' },
];

// Гардероб — суто косметичні CSS/emoji-оверлеї на персонажі (без нових зображень),
// по одному предмету на слот одночасно. Жодного впливу на економіку.
const COSMETICS = [
    // Головні убори
    { id: 'cap', slot: 'hat', name: 'Кепка контрабандиста', emoji: '🧢', price: 800 },
    { id: 'ushanka', slot: 'hat', name: 'Вушанка діда', emoji: '🪖', price: 1200 },
    { id: 'strawhat', slot: 'hat', name: 'Дачний бриль', emoji: '👒', price: 900 },
    { id: 'helmet', slot: 'hat', name: 'Каска "про всяк випадок"', emoji: '⛑️', price: 1800 },
    { id: 'tophat', slot: 'hat', name: 'Циліндр авторитету', emoji: '🎩', price: 2500 },
    { id: 'gradcap', slot: 'hat', name: 'Диплом "поважної причини"', emoji: '🎓', price: 3000 },
    { id: 'crown', slot: 'hat', name: 'Корона Мажора', emoji: '👑', price: 5000 },
    // Маскування обличчя
    { id: 'glasses', slot: 'face', name: 'Ботанічні окуляри', emoji: '👓', price: 600 },
    { id: 'clown', slot: 'face', name: 'Клоунський ніс', emoji: '🤡', price: 500 },
    { id: 'mask', slot: 'face', name: 'Медична довідка-маска', emoji: '😷', price: 700 },
    { id: 'sunglasses', slot: 'face', name: 'Чорні окуляри', emoji: '🕶️', price: 1000 },
    { id: 'disguise', slot: 'face', name: 'Маскування (вуса+окуляри)', emoji: '🥸', price: 1800 },
    { id: 'ninja', slot: 'face', name: 'Ніндзя-маскування', emoji: '🥷', price: 2200 },
    // Аксесуар на шию
    { id: 'bowtie', slot: 'neck', name: 'Метелик "для солідності"', emoji: '🎀', price: 700 },
    { id: 'scarf', slot: 'neck', name: 'Шарф ухилянта', emoji: '🧣', price: 900 },
    { id: 'tie', slot: 'neck', name: 'Діловий галстук', emoji: '👔', price: 1500 },
    { id: 'medal', slot: 'neck', name: 'Медаль "За хоробрість втечі"', emoji: '🎖️', price: 3500 },
    // Рамки клікера (суцільне світіння) + одна анімована
    { id: 'frame_red', slot: 'frame', name: 'Червона рамка небезпеки', color: '#c3073f', price: 1500 },
    { id: 'frame_gold', slot: 'frame', name: 'Золота рамка', color: '#ffd700', price: 2500 },
    { id: 'frame_neon', slot: 'frame', name: 'Неонова рамка', color: '#00e5ff', price: 2000 },
    { id: 'frame_pink', slot: 'frame', name: 'Рожева рамка', color: '#ff2ea6', price: 1800 },
    { id: 'frame_toxic', slot: 'frame', name: 'Токсична рамка', color: '#39ff14', price: 2000 },
    { id: 'frame_royal', slot: 'frame', name: 'Королівська рамка', color: '#9c27b0', price: 2800 },
    { id: 'frame_rainbow', slot: 'frame', name: 'Веселкова рамка (анімована)', color: 'rainbow', price: 6000 },
];

// Щоденні квести — прогрес рахується з опівночі (questsDate), окремо від lifetime-лічильників.
const QUESTS = [
    { id: 'q_clicks', name: 'Розігрів', desc: 'Зроби 200 кліків сьогодні', target: 200, reward: 800, metric: 'dailyClicks' },
    { id: 'q_trade', name: 'Спекулянт', desc: 'Заверши 3 угоди на біржі сьогодні', target: 3, reward: 600, metric: 'dailyTrades' },
    { id: 'q_gacha', name: 'Розпакування', desc: 'Відкрий 1 коробку гуманітарки сьогодні', target: 1, reward: 500, metric: 'dailyBoxes' },
    { id: 'q_raid', name: 'Втікач', desc: 'Переживи 1 облаву сьогодні', target: 1, reward: 700, metric: 'dailyRaids' },
];

// Тіньова біржа — курси гуляють кожні 3 хв (див. tickMarket нижче).
const MARKET_ASSETS = [
    { id: 'buckwheat', name: 'Гречка', emoji: '🌾', basePrice: 100 },
    { id: 'salt', name: 'Сіль', emoji: '🧂', basePrice: 50 },
    { id: 'tushonka', name: 'Тушонка', emoji: '🥫', basePrice: 300 },
];

// Колесо Зради та Перемоги — 1 безкоштовний прокрут/день, результат обирає сервер.
const WHEEL_SEGMENTS = [
    { label: '500 🪙', type: 'balance', amount: 500, weight: 25, color: '#4e4e50' },
    { label: '1000 🪙', type: 'balance', amount: 1000, weight: 20, color: '#c3073f' },
    { label: 'Нічого', type: 'none', amount: 0, weight: 20, color: '#2a2a2d' },
    { label: '2000 🪙', type: 'balance', amount: 2000, weight: 15, color: '#4e4e50' },
    { label: 'Енергія', type: 'energy', amount: 0, weight: 10, color: '#2b5c8f' },
    { label: '5000 🪙', type: 'balance', amount: 5000, weight: 6, color: '#c3073f' },
    { label: 'Нічого', type: 'none', amount: 0, weight: 3, color: '#2a2a2d' },
    { label: 'ДЖЕКПОТ 20000', type: 'balance', amount: 20000, weight: 1, color: '#ffd700' },
];

// Досягнення. check() виконується лише на сервері (не серіалізується клієнту);
// клієнт отримує ACHIEVEMENTS_META (без check) + масив розблокованих id користувача.
const ACHIEVEMENTS = [
    { id: 'clicks_1000', name: 'Перші мозолі', desc: 'Зроби 1 000 кліків', reward: 500, check: (u) => u.totalClicks >= 1000 },
    { id: 'clicks_10000', name: 'Мозоль на пальці', desc: 'Зроби 10 000 кліків', reward: 5000, check: (u) => u.totalClicks >= 10000 },
    { id: 'clicks_100000', name: 'Легенда мозолів', desc: 'Зроби 100 000 кліків', reward: 20000, check: (u) => u.totalClicks >= 100000 },
    { id: 'boxes_5', name: 'Колекціонер шкарпеток', desc: 'Відкрий 5 коробок гуманітарки', reward: 3000, check: (u) => u.boxesOpened >= 5 },
    { id: 'boxes_25', name: 'Постійний клієнт гумштабу', desc: 'Відкрий 25 коробок гуманітарки', reward: 8000, check: (u) => u.boxesOpened >= 25 },
    { id: 'raids_3', name: 'Профі втечі', desc: 'Пережий 3 облави', reward: 4000, check: (u) => u.raidsSurvived >= 3 },
    { id: 'raids_10', name: 'Ветеран втеч', desc: 'Пережий 10 облав', reward: 8000, check: (u) => u.raidsSurvived >= 10 },
    { id: 'wealth_100000', name: 'Тіньовий мільйонер', desc: 'Накопич 100 000 ТК', reward: 10000, check: (u) => u.balance >= 100000 },
    { id: 'wealth_1000000', name: 'Тіньовий олігарх', desc: 'Накопич 1 000 000 ТК', reward: 50000, check: (u) => u.balance >= 1000000 },
    { id: 'trades_10', name: 'Біржовий вовк', desc: 'Заверши 10 угод на тіньовій біржі', reward: 3000, check: (u) => u.tradesCount >= 10 },
    { id: 'wheel_7', name: 'Колесо фортуни', desc: 'Крути Колесо Зради 7 разів', reward: 2500, check: (u) => u.wheelSpinsCount >= 7 },
    { id: 'pets_all', name: 'Зоопарк', desc: 'Здобудь усіх компаньйонів', reward: 6000, check: (u) => u.ownedPets.length >= PETS.length },
    { id: 'cosmetics_5', name: 'Модник', desc: 'Придбай 5 предметів гардеробу', reward: 4000, check: (u) => u.ownedCosmetics.length >= 5 },
    { id: 'cosmetics_15', name: 'Гардеробний барон', desc: 'Придбай 15 предметів гардеробу', reward: 12000, check: (u) => u.ownedCosmetics.length >= 15 },
    { id: 'level_5', name: 'За кордоном', desc: 'Досягни 5 рівня схрону', reward: 8000, check: (u) => u.level >= 5 },
    { id: 'level_6', name: 'Найвищий пост', desc: 'Досягни 6 рівня схрону', reward: 15000, check: (u) => u.level >= 6 },
    { id: 'clan_member', name: 'Сусід за парканом', desc: 'Вступи в чат ОСББ', reward: 1500, check: (u) => !!u.clanId },
    { id: 'referral_5', name: 'Мережа перевізників', desc: 'Здай 5 друзів', reward: 5000, check: (u) => u.refCount >= 5 },
];
const ACHIEVEMENTS_META = ACHIEVEMENTS.map(({ id, name, desc, reward }) => ({ id, name, desc, reward }));

// Коди для друзів/тестувальників — повністю байпасять монетизацію.
const PROMO_CODES = {
    MAMYN_SYNOK: { type: 'vip' },
    TISA_SWIMMER: { type: 'balance', amount: 5000 },
    FREE_STARS: { type: 'balance', amount: 10000 }, // символічний бонус ТК; реальні Telegram Stars неможливо і не можна видати кодом
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

function getUser(id, name) {
    id = String(id);
    if (!usersDB.has(id)) {
        usersDB.set(id, {
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
            tradesCount: 0,
            wheelSpinsCount: 0,
            questsDate: null,
            dailyClicks: 0,
            dailyTrades: 0,
            dailyBoxes: 0,
            dailyRaids: 0,
            claimedQuests: [],
            createdAt: Date.now(),
        });
    }
    const user = usersDB.get(id);
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

// Преміальна гуманітарка (за Stars) — завжди дає щось цінне, без "порожніх шкарпеток",
// бо це вже реальна оплата і скам-результат тут буде нечесним по відношенню до гравця.
function rollPremiumGacha(user) {
    const rand = Math.random();
    if (rand < 0.25) {
        user.balance += 25000;
        return { title: 'ДЖЕКПОТ!', img: '/images/gacha-premium-jackpot.png', desc: 'Валізу з гумдопомоги завезли прямо тобі! +25 000 ТК' };
    } else if (rand < 0.6) {
        user.passive += 15;
        return { title: 'Елітний набір', img: '/images/gacha-premium-sausage.png', desc: 'Справжня фермерська ковбаса! +15 до пасивного доходу' };
    } else if (rand < 0.85) {
        user.energy = user.maxEnergy;
        user.clickVal += 2;
        return { title: 'Бойовий заряд', img: '/images/gacha-premium-charge.png', desc: 'Енергію відновлено та +2 до сили кліку!' };
    }
    user.balance += 10000;
    return { title: 'Непогано', img: '/images/gacha-box-regular.png', desc: 'Стандартний пакунок гумдопомоги. +10 000 ТК' };
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
function requireTelegramAuth(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    const verifiedUser = verifyInitData(initData, BOT_TOKEN);
    if (verifiedUser) {
        req.telegramUser = { id: String(verifiedUser.id), first_name: verifiedUser.first_name || 'Ухилянт' };
        return next();
    }
    if (DEV_MODE_INSECURE) {
        const fallbackId = req.body?.id || req.query?.id;
        if (fallbackId) {
            req.telegramUser = { id: String(fallbackId), first_name: req.body?.name || req.query?.name || 'DevТестер' };
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
    } else if (type === 'gacha') {
        const reward = rollPremiumGacha(user);
        user.lastPremiumReward = reward;
        ctx.reply(`🎉 Оплата успішна! Елітна гуманітарка: ${reward.title} — ${reward.desc}`);
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
        } else if (type === 'gacha_premium') {
            title = 'Елітна гуманітарка';
            description = 'Преміальна коробка без шансу на порожні шкарпетки!';
            amount = ECONOMY.GACHA_PREMIUM_STARS;
            payloadPrefix = 'gacha';
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
        portfolio: user.portfolio,
        clanId: clan.clanId,
        clanName: clan.clanName,
        clanBonus: clan.bonus,
        wheelClaimedToday: user.wheelLastSpinDate === today,
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

    if (typeof balance === 'number') user.balance = balance;
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
    res.json({ ok: true, balance: user.balance, unlockedAchievements: unlocked });
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
    res.json({ success: true, balance: user.balance, ownedCosmetics: user.ownedCosmetics });
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

// ---- Щоденні квести ----
app.get('/api/quests', requireTelegramAuth, (req, res) => {
    const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
    resetDailyIfNeeded(user);
    res.json({
        dailyClicks: user.dailyClicks, dailyTrades: user.dailyTrades,
        dailyBoxes: user.dailyBoxes, dailyRaids: user.dailyRaids,
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
    if (segment.type === 'balance') user.balance += segment.amount;
    if (segment.type === 'energy') user.energy = user.maxEnergy;
    user.wheelLastSpinDate = today;
    user.wheelSpinsCount += 1;

    res.json({ success: true, index, segment, balance: user.balance, energy: user.energy });
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
    <link rel="icon" type="image/png" href="/images/app-icon.png">
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
        .gacha-btn { background: linear-gradient(45deg, #ff9800, #ff5722); font-size: 16px; padding: 15px; box-shadow: 0 0 14px rgba(255,87,34,0.4); }
        .gacha-btn-premium { background: linear-gradient(45deg, #9c27b0, #673ab7); box-shadow: 0 0 14px rgba(156,39,176,0.5); }
        .btn-icon { width: 24px; height: 24px; vertical-align: middle; margin-right: 8px; border-radius: 5px; object-fit: cover; }
        .btn-emoji { display: inline-block; width: 24px; text-align: center; margin-right: 8px; }

        .click-text { position: absolute; color: var(--accent2); font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 22px; pointer-events: none; animation: floatUp 0.8s ease-out forwards; text-shadow: 0 0 6px var(--accent2), 0 0 14px var(--accent), 1px 1px 2px #000; z-index: 50; }
        @keyframes floatUp { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(-60px) scale(1.5); opacity: 0; } }

        #raid-screen, #knock-screen { position: fixed; top:0; left:0; right:0; bottom:0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; background-size: cover; background-position: center; }
        #raid-screen { background-image: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.75)), url('/images/raid-background.png'); }
        #knock-screen { background-image: linear-gradient(rgba(120,0,0,0.75), rgba(80,0,0,0.85)), url('/images/qte-knock-door.png'); }
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

        #splash-screen { position: fixed; inset: 0; background: #000 url('/images/splash-banner.png') center/cover no-repeat; z-index: 2000; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 40px; box-sizing: border-box; transition: opacity 0.4s ease; }
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

        .cosmetic-hat { position: absolute; top: -6px; left: 50%; transform: translateX(-50%); font-size: 42px; z-index: 5; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
        .cosmetic-face { position: absolute; top: 38%; left: 50%; transform: translateX(-50%); font-size: 30px; z-index: 5; pointer-events: none; }
        .cosmetic-neck { position: absolute; top: 62%; left: 50%; transform: translateX(-50%); font-size: 30px; z-index: 5; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
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
    </style>
</head>
<body>
    <div id="splash-screen"><span>Завантаження...</span></div>
    <header>
        <button class="daily-btn" onclick="claimDaily()"><img src="/images/daily-ration.png" alt="" style="width:14px;height:14px;vertical-align:middle;margin-right:3px;border-radius:2px;">Пайок</button>
        <div class="streak-note" id="streak-note"></div>
        <div style="font-size: 14px; margin-bottom: 5px;">
            <span id="username">Ухилянт</span><span id="vip-badge" class="vip-badge hidden">VIP</span> | Lvl: <span id="level-display">1</span>
        </div>
        <h2><span id="balance">0</span> 🪙 ТК</h2>
        <div class="stats">
            <span>Пасив: <span id="passive">0</span>/с</span>
            <span>⭐ <span id="stars">0</span></span>
        </div>
        <div class="energy-bar"><div id="energy-fill" class="energy-fill"></div></div>
        <div class="clan-line hidden" id="clan-line"></div>
    </header>

    <main>
        <div class="location-name" id="location-name">Бабусин Диван</div>
        <div id="clicker" class="clickable">
            <img id="clicker-img" src="/images/location-1-couch.png" alt="Ухилянт">
            <div id="clicker-emoji" class="emoji-fallback hidden"></div>
            <div id="cosmetic-hat" class="cosmetic-hat hidden"></div>
            <div id="cosmetic-face" class="cosmetic-face hidden"></div>
            <div id="cosmetic-neck" class="cosmetic-neck hidden"></div>
        </div>
    </main>

    <div class="tabs-container">
        <div class="tab active" onclick="switchTab(event, 'shop')">🛒 Магазин</div>
        <div class="tab" onclick="switchTab(event, 'wardrobe')">🎨 Гардероб</div>
        <div class="tab" onclick="switchTab(event, 'quests')">📋 Квести</div>
        <div class="tab" onclick="switchTab(event, 'market')">📈 Біржа</div>
        <div class="tab" onclick="switchTab(event, 'clan')">🏘 Клани</div>
        <div class="tab" onclick="switchTab(event, 'gacha')">📦 Гуманітарка</div>
        <div class="tab" onclick="switchTab(event, 'friends')">🤝 Друзі</div>
        <div class="tab" onclick="switchTab(event, 'stars')">💎 Донат</div>
        <div class="tab" onclick="switchTab(event, 'top')">🏆 ТОП</div>
    </div>

    <div id="shop" class="panel active">
        <p style="margin-top:0; color:#aaa; font-size:12px;">Прокачай свій сховок:</p>
        <button onclick="buy('hat', ${ECONOMY.HAT_PRICE})"><img class="btn-icon" src="/images/shop-hat.png" alt="">Шапочка з фольги (+1/клік) | ${ECONOMY.HAT_PRICE} 🪙</button>
        <button onclick="buy('jam', ${ECONOMY.JAM_PRICE})"><img class="btn-icon" src="/images/shop-jam.png" alt="">Закрутка (+5/сек) | ${ECONOMY.JAM_PRICE} 🪙</button>
        <button onclick="buy('energy_drink', ${ECONOMY.ENERGY_DRINK_PRICE})"><img class="btn-icon" src="/images/shop-energy.png" alt="">Енергетик (Відновити сили) | ${ECONOMY.ENERGY_DRINK_PRICE} 🪙</button>
        <button onclick="buy('thermos', ${ECONOMY.THERMOS_PRICE})"><span class="btn-emoji">☕</span>Термос кави (+${ECONOMY.THERMOS_CLICK_BONUS}/клік) | ${ECONOMY.THERMOS_PRICE} 🪙</button>
        <button onclick="buy('generator', ${ECONOMY.GENERATOR_PRICE})"><span class="btn-emoji">⚡</span>Генератор (+${ECONOMY.GENERATOR_PASSIVE_BONUS}/сек) | ${ECONOMY.GENERATOR_PRICE} 🪙</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Еволюція:</h3>
        <button onclick="buy('basement', ${ECONOMY.BASEMENT_PRICE})"><img class="btn-icon" src="/images/location-2-basement.png" alt="">Переїзд у Підвал (Lvl 2) | ${ECONOMY.BASEMENT_PRICE} 🪙</button>
        <button onclick="buy('balkan', ${ECONOMY.BALKAN_PRICE})"><img class="btn-icon" src="/images/location-3-balkan.png" alt="">Балканська хатинка (Lvl 3) | ${ECONOMY.BALKAN_PRICE} 🪙</button>
        <button onclick="buy('tisa', ${ECONOMY.TISA_PRICE})"><img class="btn-icon" src="/images/location-3-boat.png" alt="">Човен на Тисі (Lvl 4) | ${ECONOMY.TISA_PRICE} 🪙</button>
        <button onclick="buy('abroad', ${ECONOMY.ABROAD_PRICE})"><span class="btn-emoji">🛂</span>Закордон (Lvl 5) | ${ECONOMY.ABROAD_PRICE} 🪙</button>
        <button onclick="buy('bunker', ${ECONOMY.BUNKER_PRICE})"><span class="btn-emoji">🏛️</span>Президентський бункер (Lvl 6) | ${ECONOMY.BUNKER_PRICE} 🪙</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Компаньйони:</h3>
        <div id="pets-list"></div>
    </div>

    <div id="wardrobe" class="panel">
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
        <div style="text-align: center; margin-bottom: 15px;">
            <img src="/images/gacha-box-regular.png" alt="" style="width:80px; height:80px; object-fit:contain; margin-bottom: 10px;">
            <p style="font-size: 13px; color: #aaa;">Відкрий гуманітарну коробку. Всередині може бути джекпот або старі шкарпетки.</p>
        </div>
        <button class="gacha-btn" onclick="openGacha(${ECONOMY.GACHA_PRICE})"><img class="btn-icon" src="/images/gacha-box-regular.png" alt="">Відкрити коробку (${ECONOMY.GACHA_PRICE} 🪙)</button>
        <button class="gacha-btn gacha-btn-premium" onclick="openGachaPremium()"><img class="btn-icon" src="/images/gacha-box-elite.png" alt="">Елітна коробка (${ECONOMY.GACHA_PREMIUM_STARS} ⭐)</button>
        <h3 style="font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #444;">Колесо Зради та Перемоги (1 раз/день, безкоштовно):</h3>
        <div class="wheel-wrap">
            <div class="wheel-pointer"></div>
            <div id="wheel"></div>
        </div>
        <button id="wheel-btn" onclick="spinWheel()">🎡 Крутити колесо</button>
    </div>

    <div id="friends" class="panel">
        <img src="/images/social-referral.png" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
        <h3 style="margin-top:0;">Здай друга</h3>
        <p style="font-size:12px; color:#aaa;">Отримай ${ECONOMY.REFERRAL_REWARD} 🪙 за кожного друга, який перейде за твоїм посиланням і заляже на дно.</p>
        <p style="font-size:12px;">Здано друзів: <b id="ref-count">0</b></p>
        <input type="text" id="ref-link" readonly style="width: 100%; padding: 10px; background: #222; color: #fff; border: 1px solid #444; border-radius: 5px; margin-bottom: 10px; box-sizing: border-box;">
        <button onclick="copyRef()">📋 Скопіювати посилання</button>
    </div>

    <div id="stars" class="panel">
        <button class="premium-btn" onclick="buyRealVip()"><img class="btn-icon" src="/images/vip-badge.png" alt="">VIP-Схрон (${ECONOMY.VIP_PRICE_STARS} ⭐)</button>
        <p style="font-size:12px; color:#aaa; text-align:center;">VIP: Х3 дохід, нескінченна енергія, повний імунітет до ОБЛАВ.</p>
        <hr style="border:0; border-top:1px solid #444; margin: 15px 0;">
        <input type="text" id="promo" placeholder="Промокод" style="width:100%; padding:10px; box-sizing:border-box; background:#222; border:1px solid #444; color:#fff; border-radius:5px; margin-bottom:10px;">
        <button onclick="usePromo()">Активувати код</button>
    </div>

    <div id="top" class="panel">
        <img src="/images/leaderboard-trophy.png" alt="" style="width:56px; height:56px; object-fit:contain; display:block; margin: 0 auto 10px;">
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

    <div id="raid-screen" class="hidden">
        <h1>🚨 ОБЛАВА НА РИНКУ! 🚨</h1>
        <p style="color:#fff; font-size:18px;">Тікай! Клікай швидко, щоб перелізти паркан!</p>
        <div id="raid-timer">10.0</div>
        <div id="raid-progress"><div id="raid-fill"></div></div>
        <button class="run-btn" id="run-btn"><img src="/images/raid-run.png" alt="">ВТЕКТИ</button>
    </div>

    <div id="knock-screen" class="hidden">
        <h1>🚪 СТУК У ДВЕРІ! 🚪</h1>
        <p style="color:#fff; font-size:16px;">Швидко прикинься килимом!</p>
        <div id="knock-timer">3.0</div>
        <button class="knock-btn" id="knock-btn">🧎</button>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.disableVerticalSwipes();

        // Автоматично додає підписані дані Telegram (initData) до кожного захищеного запиту,
        // щоб сервер міг довіряти, що запит справді від цього користувача.
        function apiFetch(url, options = {}) {
            options.headers = Object.assign({}, options.headers, { 'X-Telegram-Init-Data': tg.initData || '' });
            return fetch(url, options);
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

        let user = tg.initDataUnsafe?.user || { id: 'guest_' + Math.floor(Math.random() * 100000), first_name: 'Гість' };

        let state = {
            balance: 0, clickVal: 1, passive: 0,
            energy: 100, maxEnergy: 100,
            level: 1, isVip: false, refCount: 0,
            totalClicks: 0, boxesOpened: 0, raidsSurvived: 0,
            achievements: [], ownedPets: [], petId: null,
            ownedCosmetics: [], equippedCosmetics: { hat: null, face: null, neck: null, frame: null },
            portfolio: {}, clanId: null, clanName: null, clanBonus: 1,
            dailyStreak: 0, wheelClaimedToday: false,
            dailyClicks: 0, dailyTrades: 0, dailyBoxes: 0, dailyRaids: 0, claimedQuests: [],
        };

        const ui = {
            bal: document.getElementById('balance'), pas: document.getElementById('passive'),
            enr: document.getElementById('energy-fill'), lvl: document.getElementById('level-display'),
            loc: document.getElementById('location-name'), clk: document.getElementById('clicker'),
            clkImg: document.getElementById('clicker-img'), clkEmoji: document.getElementById('clicker-emoji'),
            str: document.getElementById('stars'), vip: document.getElementById('vip-badge'),
            refCount: document.getElementById('ref-count'), clanLine: document.getElementById('clan-line'),
            streakNote: document.getElementById('streak-note'),
        };

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
            renderPets();
            renderCosmetics();
            applyCosmeticOverlay();
        }

        // ===== Ініціалізація: підтягуємо збережений стан із сервера =====
        async function init() {
            document.getElementById('username').innerText = user.first_name;
            document.getElementById('ref-link').value = 'https://t.me/' + BOT_USERNAME + '?start=' + user.id;
            try {
                const res = await apiFetch('/api/user?id=' + user.id + '&name=' + encodeURIComponent(user.first_name) + '&consume=1');
                const data = await res.json();
                state.balance = data.balance; state.clickVal = data.clickVal; state.passive = data.passive;
                state.level = data.level; state.energy = data.energy; state.maxEnergy = data.maxEnergy;
                state.isVip = data.isVip; state.refCount = data.refCount;
                state.totalClicks = data.totalClicks; state.boxesOpened = data.boxesOpened; state.raidsSurvived = data.raidsSurvived;
                state.achievements = data.achievements; state.ownedPets = data.ownedPets; state.petId = data.petId;
                state.ownedCosmetics = data.ownedCosmetics || []; state.equippedCosmetics = data.equippedCosmetics || { hat: null, face: null, neck: null, frame: null };
                state.portfolio = data.portfolio || {}; state.clanId = data.clanId; state.clanName = data.clanName; state.clanBonus = data.clanBonus;
                state.dailyStreak = data.dailyStreak; state.wheelClaimedToday = data.wheelClaimedToday;
                if (data.lastPremiumReward) {
                    showGachaModal(data.lastPremiumReward.title, data.lastPremiumReward.img, data.lastPremiumReward.desc);
                } else if (data.offlineEarnings > 0) {
                    showGachaModal('Поки тебе не було...', '/images/gacha-jackpot.png', 'Ти тихо відсидівся і заробив +' + data.offlineEarnings + ' ТК!');
                }
            } catch (e) {
                console.error('Не вдалося завантажити стан гравця', e);
            }
            updateUI();
            renderAchievements();
            renderWheel();
            const splash = document.getElementById('splash-screen');
            if (splash) {
                setTimeout(() => {
                    splash.style.opacity = '0';
                    setTimeout(() => splash.remove(), 400);
                }, 600);
            }
        }
        init();

        function saveState() {
            apiFetch('/api/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id, name: user.first_name, balance: state.balance,
                    clickVal: state.clickVal, passive: state.passive, level: state.level,
                    energy: state.energy, maxEnergy: state.maxEnergy,
                    totalClicks: state.totalClicks, boxesOpened: state.boxesOpened, raidsSurvived: state.raidsSurvived,
                })
            }).then(r => r.json()).then(data => {
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
            let earned = state.clickVal * petMult('click') * (state.isVip ? 3 : 1);
            state.balance += earned;
            state.totalClicks += 1;
            if (!state.isVip) state.energy = Math.max(0, state.energy - 2);

            let x = e.touches ? e.touches[0].clientX : e.clientX;
            let y = e.touches ? e.touches[0].clientY : e.clientY;

            showFloat(x, y, '+' + Math.round(earned));
            tg.HapticFeedback.impactOccurred('light');
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
        setInterval(() => {
            if (state.passive > 0) state.balance += (state.passive * state.clanBonus * (state.isVip ? 3 : 1)) / 10;
            if (state.energy < state.maxEnergy) state.energy = Math.min(state.maxEnergy, state.energy + 2 * petMult('energy'));
            updateUI();
        }, 100);

        setInterval(saveState, 5000);

        // ===== Навігація =====
        window.switchTab = (evt, tabId) => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            evt.currentTarget.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            if (tabId === 'top') { loadTop(); renderAchievements(); }
            if (tabId === 'market') loadMarket();
            if (tabId === 'clan') { renderClanMine(); loadClanList(); loadClanLeaderboard(); }
            if (tabId === 'wardrobe') renderCosmetics();
            if (tabId === 'quests') loadQuests();
        };

        // ===== Магазин =====
        window.buy = (item, price) => {
            if (state.balance < price) return tg.showAlert('Недостатньо ТК!');
            state.balance -= price;
            if (item === 'hat') state.clickVal += ECONOMY.HAT_CLICK_BONUS;
            if (item === 'jam') state.passive += ECONOMY.JAM_PASSIVE_BONUS;
            if (item === 'energy_drink') state.energy = state.maxEnergy;
            if (item === 'thermos') state.clickVal += ECONOMY.THERMOS_CLICK_BONUS;
            if (item === 'generator') state.passive += ECONOMY.GENERATOR_PASSIVE_BONUS;
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
                return '<div class="pet-card' + (equipped ? ' equipped' : '') + '">' +
                    '<div class="pet-title"><img class="btn-icon" src="' + p.img + '" alt="">' + p.name + (equipped ? ' (активний)' : '') + '</div>' +
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
        };

        window.equipPet = async (petId) => {
            const res = await apiFetch('/api/pet/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, petId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.petId = data.petId;
            updateUI();
        };

        // ===== Гардероб (косметика) =====
        function applyCosmeticOverlay() {
            const hatEl = document.getElementById('cosmetic-hat');
            const faceEl = document.getElementById('cosmetic-face');
            const neckEl = document.getElementById('cosmetic-neck');
            const hatItem = COSMETICS.find(c => c.id === state.equippedCosmetics.hat);
            const faceItem = COSMETICS.find(c => c.id === state.equippedCosmetics.face);
            const neckItem = COSMETICS.find(c => c.id === state.equippedCosmetics.neck);
            const frameItem = COSMETICS.find(c => c.id === state.equippedCosmetics.frame);
            hatEl.classList.toggle('hidden', !hatItem);
            if (hatItem) hatEl.innerText = hatItem.emoji;
            faceEl.classList.toggle('hidden', !faceItem);
            if (faceItem) faceEl.innerText = faceItem.emoji;
            neckEl.classList.toggle('hidden', !neckItem);
            if (neckItem) neckEl.innerText = neckItem.emoji;

            const isRainbow = frameItem && frameItem.color === 'rainbow';
            ui.clkImg.classList.toggle('frame-rainbow', isRainbow);
            ui.clkEmoji.classList.toggle('frame-rainbow', isRainbow);
            const glowColor = (frameItem && !isRainbow) ? frameItem.color : null;
            ui.clkImg.style.boxShadow = glowColor ? ('0 0 0 4px ' + glowColor + ', 0 0 25px 6px ' + glowColor + '88') : (isRainbow ? '' : 'none');
            ui.clkEmoji.style.textShadow = glowColor ? ('0 0 20px ' + glowColor) : 'none';
        }

        function renderCosmetics() {
            ['hat', 'face', 'neck', 'frame'].forEach(slot => {
                const container = document.getElementById('wardrobe-' + slot);
                if (!container) return;
                container.innerHTML = COSMETICS.filter(c => c.slot === slot).map(c => {
                    const owned = state.ownedCosmetics.includes(c.id);
                    const equipped = state.equippedCosmetics[slot] === c.id;
                    const visual = c.color
                        ? '<span class="cosmetic-swatch" style="background:' + (c.color === 'rainbow' ? 'conic-gradient(#ff2ea6, #ff9800, #ffe066, #39ff14, #00e5ff, #9c27b0, #ff2ea6)' : c.color) + ';"></span>'
                        : '<span class="cosmetic-emoji">' + c.emoji + '</span>';
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
            state.balance = data.balance; state.ownedCosmetics = data.ownedCosmetics;
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
        };

        window.equipCosmetic = async (slot, cosmeticId) => {
            const res = await apiFetch('/api/cosmetic/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, slot, cosmeticId }) });
            const data = await res.json();
            if (!data.success) return tg.showAlert(data.message || 'Помилка');
            state.equippedCosmetics = data.equippedCosmetics;
            updateUI();
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

        window.openGacha = (price) => {
            if (state.balance < price) return tg.showAlert('Не вистачає ТК на коробку!');
            state.balance -= price;
            state.boxesOpened += 1;
            tg.HapticFeedback.impactOccurred('heavy');

            let rand = Math.random();
            if (rand < 0.1) {
                state.balance += 10000;
                showGachaModal('ДЖЕКПОТ!', '/images/gacha-jackpot.png', 'Ти знайшов заначку діда! +10 000 ТК');
            } else if (rand < 0.4) {
                state.passive += 5;
                showGachaModal('Непогано!', '/images/gacha-tushonka.png', 'Імпортна тушонка! +5 до пасивного доходу.');
            } else if (rand < 0.7) {
                state.energy = state.maxEnergy;
                showGachaModal('Нормально.', '/images/gacha-powerbank.png', 'Павербанк. Енергія відновлена повністю!');
            } else {
                showGachaModal('Ой...', '/images/gacha-scam-socks.png', 'Коробка виявилась порожньою (тільки діряві шкарпетки).');
            }
            tg.HapticFeedback.notificationOccurred('success');
            updateUI();
            saveState();
        };

        // ===== Gacha (елітна, за реальні Stars) =====
        window.openGachaPremium = async () => {
            try {
                let res = await apiFetch('/api/invoice', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: user.id, type: 'gacha_premium' })
                });
                let data = await res.json();
                if (!data.link) return tg.showAlert('Помилка створення інвойсу');
                tg.openInvoice(data.link, async (status) => {
                    if (status === 'paid') await init();
                });
            } catch (e) { tg.showAlert('Помилка генерації інвойсу'); }
        };

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
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert('🎡 Випало: ' + data.segment.label);
                updateUI(); renderWheel();
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
                    state.balance = data.balance; state.isVip = data.isVip;
                    document.getElementById('promo').value = '';
                    updateUI();
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
            if (state.isVip || Math.random() > ECONOMY.RAID_CHANCE * petMult('raid')) return;

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
            if (state.isVip || Math.random() > ECONOMY.QTE_KNOCK_CHANCE) return;

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
