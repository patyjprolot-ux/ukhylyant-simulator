// Автоматично винесено з server.js (Фаза 3 модуляризації, 2026-08-08).
// Модель гравця: форма "свіжого" запису, міграція старих записів на нові поля,
// публічний pid, облік balanceRev, дисковий бекап у JSON-файл.
// 2026-08-16: після переїзду на VPS з реальним диском (замість ефемерного диску
// Render) цей самий механізм тепер переживає й редеплой теж — досить, щоб
// деплой-скрипт не чіпав /data (git checkout цього й не робить, доки data/
// лишається в .gitignore, як зараз).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ECONOMY = require('../catalog/economy');
const { REPUTATION_NPCS } = require('../catalog/social');
const { LEGACY_ASSET_PRICES } = require('../catalog/misc');
const { playerLevelForXP } = require('./mechanics/levels');

const usersDB = new Map();
const clansDB = new Map();

// Просте збереження на диск у JSON-файл — не БД, але на постійному диску (VPS)
// переживає і рестарт, і редеплой.
const DATA_DIR = path.join(__dirname, '..', 'data');
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

const TMP_DATA_FILE = DATA_FILE + '.tmp';

// Аудит оптимізації (2026-08-21): раніше — синхронний writeFileSync усієї бази
// щоп'ять... щодвадцять секунд, що на мить блокував ВЕСЬ процес (Express і бот
// в одному процесі), а без запису у тимчасовий файл+rename крах/збій живлення
// саме під час запису міг лишити gamedata.json напівзаписаним — тобто битим
// для ВСІХ гравців одразу. Тепер: асинхронний запис (не блокує event loop),
// атомарний (пишемо в .tmp, тоді rename — rename на тій самій ФС атомарний,
// половинчастого файлу під справжньою назвою просто не буває).
//
// Свідомо НЕ додаю dirty-флаг (пропускати запис, якщо нічого не змінилось):
// на відміну від lib/complaints.js (де мутація йде через кілька експортних
// функцій), user.balance/user.resources і т.д. пишуться напряму в десятках
// місць по всьому server.js/routes/*.js — позначити "брудним" КОЖНЕ таке
// місце це великий ризикований рефактор заради економії, що поки не потрібна
// (аудит: ~5мс на запис при поточній кількості гравців). Повертатись до цього
// варто, лише якщо гравців стане тисячі.
function saveData() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const payload = { users: Array.from(usersDB.values()), clans: Array.from(clansDB.values()), savedAt: Date.now() };
        const json = JSON.stringify(payload);
        fs.writeFile(TMP_DATA_FILE, json, (err) => {
            if (err) return console.error('⚠️  Не вдалося зберегти дані на диск:', err.message);
            fs.rename(TMP_DATA_FILE, DATA_FILE, (err2) => {
                if (err2) console.error('⚠️  Не вдалося замінити файл даних:', err2.message);
            });
        });
    } catch (e) {
        console.error('⚠️  Не вдалося зберегти дані на диск:', e.message);
    }
}

// Синхронний варіант — лише для SIGINT/SIGTERM (server.js): процес однаково
// завершується одразу після виклику, тож блокувати на мить під час свідомого
// вимкнення — це фіча, не баг (інакше pm2 restart на кожному деплої міг би
// вбити процес до того, як асинхронний запис устигне долетіти до диска).
function saveDataSync() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const payload = { users: Array.from(usersDB.values()), clans: Array.from(clansDB.values()), savedAt: Date.now() };
        fs.writeFileSync(TMP_DATA_FILE, JSON.stringify(payload));
        fs.renameSync(TMP_DATA_FILE, DATA_FILE);
    } catch (e) {
        console.error('⚠️  Не вдалося зберегти дані на диск (sync):', e.message);
    }
}

function createFreshUser(id, name) {
    return {
        id,
        name: name || 'Ухилянт',
        nickname: null, // публічний унікальний нік — не показуємо справжнє ім'я з Telegram у топі/профілях
        pendingNickname: null, // бажаний нік на платній зміні, чекає successful_payment
        // --- Рівень ухилянта (v2.1): суто onboarding-гейт для UI, не економічний.
        // Ширший за "рівень схрону" (user.level, той лишається як є). ---
        xp: 0,
        playerLevel: 1,
        ukhyr: 0, // "Ухирація" — рейтингова метрика для лідерборду, не валюта
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
        memoryGame: null, // активна гра "Знайди пару": {deck, revealed, matchedPairs, flips, firstPick}
        energyDrinkLog: [], // timestamps останніх покупок енергетика — не більше 2 за 5 хв (2026-08-09)
        // --- Кладовка та крафт ---
        resources: {},              // { cans: 12, battery: 3, ... }
        storageLevel: 0,            // місткість = BASE + level * PER_LEVEL
        upgrades: { hat: 0, jam: 0, thermos: 0, generator: 0 }, // рівні багаторівневих апгрейдів
        upgTiersUnlocked: { hat: 0, jam: 0, thermos: 0, generator: 0 }, // пробиті ешелони (v2.0)
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
        // --- Розшук (heat) і повістки ---
        heat: 0,                    // 0..100, другий ресурс-напруга (див. HEAT_TIERS)
        heatLog: [],                // останні події, що змінили heat — показуються в "Твоїй справі"
        lastHeatDecay: Date.now(),  // від цієї мітки рахується ліниве згасання
        heatDecayDate: null,
        heatDecayToday: 0,
        clickHeatCarry: 0,          // залишок кліків, що ще не дотягнули до сотні
        notices: [],                // активні повістки (максимум NOTICE_MAX_ACTIVE)
        noticeStats: { received: 0, resolved: 0, failed: 0, expired: 0, byMethod: {} },
        nextNoticeAt: 0,
        energyLockUntil: 0,         // "вручення в руки" на пів години забирає можливість клікати
        deceivedCount: 0,           // скільки разів обманув систему липовою довідкою
        seasonPoints: 0,            // сезонні очки (повноцінні ліги — Фаза 5)
        // --- PvP "Здати сусіда" ---
        pid: null,                  // публічний id для PvP; Telegram id назовні не світимо
        snitchesToday: 0,
        snitchStats: { sent: 0, received: 0, caught: 0, falselyAccused: 0, stolen: 0, robbed: 0 },
        snitchedBy: [],             // [{ byId, byName, at, investigated, revealed, suspects }]
        freeSnitchOn: [],           // id гравців, на яких є безкоштовний стук (за хибне звинувачення)
        lastSnitchTargets: {},      // { targetId: timestamp } — кулдаун на ту саму ціль
        pendingRobbery: null,       // { byName, amount, at } — показати жертві при найближчому save
        lastSeenAt: 0,              // для офлайн-звіту при вході
        offlineLog: [],             // [{ t, kind, text }] — що сталось, поки гравця не було
        // --- Сезони, ліги, війни ---
        league: 0,                  // індекс у LEAGUES
        seasonId: null,             // "понеділок тижня" — межа сезону
        seasonTitle: null,          // титул під ніком, який не купиш
        seasonResult: null,         // підсумки минулого сезону, показуємо один раз
        heatDaySP: null,            // щоб доба з високим розшуком рахувалась раз на день
        pendingWarCrate: 0,         // трофейні ящики з війн і облав на район
        grannyUntil: 0,             // автоклікер «Бабуся клікає за тебе»
        adConsent: null,            // null — ще не питали, true/false — відповів
        redeemedPromos: [],         // одноразові промокоди (once:true), щоб не активувати вдруге
        mapBuildings: { tower: 0, hideout: 0, cache: 0 }, // карта території: рівень 0 = не збудовано
        mapPlacements: { tower: null, hideout: null, cache: null }, // {x,y} у % — де гравець поставив іконку на карті (null = ще не розміщено)
        trophies: [],               // 🕵️ за розкритого стукача + по одному за кожного боса
        // --- Медична гілка (Р18 v3) — окрема сюжетна вкладка, НЕ повістка ---
        // (medcomSession/lastMedcomCards/medcomStats/medcomCard старого
        // медкома-на-повістці прибрані 2026-08-16 разом з усім тим рушієм —
        // замінені цією гілкою повністю, не паралельно.)
        hospitalVisits: 0,           // усього вилазок у лікарню (успішних і "спалився" — рахуються обидва)
        activeDisease: null,         // id хвороби, над якою зараз працює гравець (один слот)
        diseaseDocuments: {},        // { diseaseId: [docId, ...] } — зібрані документи активної хвороби
        diseaseAnalysisProgress: {}, // { diseaseId: кількість успішних здач аналізів }
        diseaseAnalysisSession: null, // { diseaseId, cards, usedIdx, activeIdx, ... } — активна QTE-сесія аналізів
        diseasesDiagnosed: {},       // { diseaseId: true } — скрафтовано, чекає підтвердження в лікарні
        diseases: {},                // { diseaseId: true } — підтверджено в медичній картці, назавжди
        deferUntil: 0,              // поки діє — повістки не приходять і розшук не росте
        defermentId: null,          // яка саме відстрочка активна
        defermentsTaken: 0,
        checkpointStats: { passed: 0, failed: 0 },
        reputation: { nina: 0, tolik: 0, mykola: 0, oksana: 0 },
        claimedRepQuests: [],       // які щоденні квести NPC уже здані сьогодні
        dailyTradeVolume: 0,
        dailyBribes: 0,
        dailyDonated: 0,
        dailyNotices: 0,
        dailyMedcom: 0,
        dailyInspectors: 0,
        dailyExpeditions: 0,
        mykolaCoverUsed: false,     // "Прикриття" від дільничного — раз на добу
        lastBribeAt: 0,             // слабкість Валіка: чи "вирішував питання" нещодавно
        inspector: null,            // { id, hp, hpMax, endsAt } — активний бос
        inspectorStats: { defeated: {}, lost: 0 },
        inspectorLastSeen: {},      // { inspectorId: timestamp } — кулдаун Півника
        inspectorCooldownUntil: 0,
        skills: {},                 // { skillId: true } — дерево навичок за довідки престижу
        skillResetsUsed: 0,         // перше скидання безкоштовне
        skillEnergyBonus: 0,        // скільки макс. енергії зараз дає навичка (щоб зняти рівно стільки)
        marketFriendUsedDate: null, // "Своя людина на біржі" — дата останнього використання преміум-ціни
        backdoorUsedWeek: null,     // "Запасний вихід" — тиждень останньої безкоштовної відстрочки
        // --- Спринти (робочі контракти, PATCH_2.0_SPRINTS_SPEC.md) ---
        // activeSprint свідомо НЕ входить у бекап/відновлення (RESTORE_NUMBER_FIELDS
        // у server.js): це короткоживучий стан на хвилини-години, і переносити
        // недописаний контракт через редеплой не варто — простіше почати новий,
        // ніж розбиратись із дедлайном, що минув, поки сервера не було.
        activeSprint: null,         // { tier, startedAt, deadline, linesTotal, linesDone, missedQte, energySpent }
        burnout: 0,                 // 0-100, вигорання: обмежувач темпу всередині контракту
        lastBurnoutDecay: 0,        // мітка лінивого згасання вигорання (як lastHeatDecay для heat)
        focusStat: 1,               // базовий множник проти вигорання, росте від ремапнутих бустерів
        routeProgress: 0,           // 0-100, прогрес-бар крафту маршруту (окремо від ресурсу 'route')
        routeContributions: { paper: 0, intel_data: 0, script: 0 }, // скільки з ROUTE_PROJECT_COST уже внесено
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
// Публічне ім'я гравця — НІКОЛИ справжнє ім'я з Telegram (не конфіденційно,
// видно в топі/профілях/розслідуваннях усім, включно з незнайомими гравцями
// клану, якщо чат об'єднає друзів друзів). Поки нік не встановлено — опаковий
// заповнювач за pid, не справжнє ім'я.
function displayName(user) {
    return user.nickname || ('Гравець-' + String(user.pid || user.id || '').slice(-4));
}
function nicknameTaken(nickname, exceptUserId) {
    const norm = nickname.toLowerCase();
    for (const u of usersDB.values()) {
        if (u.id !== exceptUserId && u.nickname && u.nickname.toLowerCase() === norm) return true;
    }
    return false;
}

// Аудит оптимізації (2026-08-21): getUser() кличе migrateUser() на КОЖЕН
// запит (server.js), а весь бекфіл нижче й так уже прогнано одноразово при
// старті процесу для всіх наявних гравців (usersDB.forEach(migrateUser) —
// нижче в цьому файлі). Для вже мігрованого гравця повторний виклик означав
// зайве створення повного ~150-польового createFreshUser() + діф — на КОЖЕН
// запит, для КОЖНОГО гравця. __schemaVersion пропускає весь важкий блок,
// якщо він уже актуальний. ВАЖЛИВО для майбутнього: додаєш нове поле в
// createFreshUser/бекфіл нижче — став SCHEMA_VERSION += 1, інакше вже
// мігровані гравці НІКОЛИ не отримають нове поле (бекфіл просто не
// запуститься для них знову).
const SCHEMA_VERSION = 1;

function migrateUser(user) {
    if (user.__schemaVersion !== SCHEMA_VERSION) {
    const isPreLevelUser = user.playerLevel === undefined; // до появи v2.1 (рівень ухилянта)
    const fresh = createFreshUser(user.id, user.name);
    for (const key of Object.keys(fresh)) {
        if (user[key] === undefined) user[key] = fresh[key];
    }
    // Живим гравцям з ДО v2.1 рахуємо рівень заднім числом з наявних лічильників —
    // інакше досвідчений гравець раптом побачив би заблокованими вкладки, якими
    // вже давно користується (levelGate ховає їх на клієнті нижче потрібного рівня).
    if (isPreLevelUser) {
        const backfillXP = Math.floor((user.totalClicks || 0) / 100) * 5
            + (user.craftedCount || 0) * 15
            + (user.expeditionsDone || 0) * 60
            + Object.values(user.inspectorStats?.defeated || {}).reduce((a, b) => a + b, 0) * 200
            + (user.raidsSurvived || 0) * 25
            + Math.max(0, (user.level || 1) - 1) * 150
            + (user.prestigeCount || 0) * 500;
        user.xp = backfillXP;
        user.playerLevel = playerLevelForXP(backfillXP);
    }
    if (typeof user.resources !== 'object' || user.resources === null) user.resources = {};
    if (typeof user.cratesOpened !== 'object' || user.cratesOpened === null) user.cratesOpened = {};
    if (typeof user.upgrades !== 'object' || user.upgrades === null) {
        user.upgrades = { hat: 0, jam: 0, thermos: 0, generator: 0 };
    }
    for (const k of ['hat', 'jam', 'thermos', 'generator']) {
        if (typeof user.upgrades[k] !== 'number') user.upgrades[k] = 0;
    }
    // Ешелони v2.0: живі гравці не платять заднім числом за рівні, які вже мають —
    // ешелони до поточного рівня грандфазеряться безкоштовно (журнал, розділ 9.2).
    if (typeof user.upgTiersUnlocked !== 'object' || user.upgTiersUnlocked === null) {
        user.upgTiersUnlocked = { hat: 0, jam: 0, thermos: 0, generator: 0 };
        for (const k of ['hat', 'jam', 'thermos', 'generator']) {
            user.upgTiersUnlocked[k] = Math.floor((user.upgrades[k] || 0) / ECONOMY.TIER_SIZE);
        }
    }
    for (const k of ['hat', 'jam', 'thermos', 'generator']) {
        if (typeof user.upgTiersUnlocked[k] !== 'number') {
            user.upgTiersUnlocked[k] = Math.floor((user.upgrades[k] || 0) / ECONOMY.TIER_SIZE);
        }
    }
    if (typeof user.heat !== 'number' || !isFinite(user.heat)) user.heat = 0;
    if (!Array.isArray(user.heatLog)) user.heatLog = [];
    if (!Array.isArray(user.notices)) user.notices = [];
    if (typeof user.noticeStats !== 'object' || user.noticeStats === null) {
        user.noticeStats = { received: 0, resolved: 0, failed: 0, expired: 0, byMethod: {} };
    }
    if (typeof user.noticeStats.byMethod !== 'object' || user.noticeStats.byMethod === null) {
        user.noticeStats.byMethod = {};
    }
    // Старому збереженню ставимо мітку "зараз", інакше згасання відразу відкрутило б
    // heat на місяці назад (він у них і так 0, але при відновленні з бекапу — ні).
    if (!user.lastHeatDecay) user.lastHeatDecay = Date.now();
    if (!Array.isArray(user.snitchedBy)) user.snitchedBy = [];
    if (!Array.isArray(user.freeSnitchOn)) user.freeSnitchOn = [];
    if (!Array.isArray(user.trophies)) user.trophies = [];
    if (typeof user.lastSnitchTargets !== 'object' || user.lastSnitchTargets === null) user.lastSnitchTargets = {};
    if (typeof user.snitchStats !== 'object' || user.snitchStats === null) {
        user.snitchStats = { sent: 0, received: 0, caught: 0, falselyAccused: 0, stolen: 0, robbed: 0 };
    }
    for (const k of ['sent', 'received', 'caught', 'falselyAccused', 'stolen', 'robbed']) {
        if (typeof user.snitchStats[k] !== 'number') user.snitchStats[k] = 0;
    }
    if (typeof user.hospitalVisits !== 'number') user.hospitalVisits = 0;
    if (typeof user.inspectorStats !== 'object' || user.inspectorStats === null) user.inspectorStats = { defeated: {}, lost: 0 };
    if (typeof user.inspectorStats.defeated !== 'object' || user.inspectorStats.defeated === null) user.inspectorStats.defeated = {};
    if (typeof user.inspectorStats.lost !== 'number') user.inspectorStats.lost = 0;
    if (typeof user.inspectorLastSeen !== 'object' || user.inspectorLastSeen === null) user.inspectorLastSeen = {};
    if (typeof user.skills !== 'object' || user.skills === null) user.skills = {};
    if (typeof user.skillResetsUsed !== 'number') user.skillResetsUsed = 0;
    if (typeof user.skillEnergyBonus !== 'number') user.skillEnergyBonus = 0;
    // Вилазки: раніше один об'єкт, тепер масив (навичка «Друга нора» дає другий
    // слот). Старі збереження підхоплюємо як масив з одного елемента.
    if (!Array.isArray(user.expeditions)) {
        user.expeditions = user.expedition ? [user.expedition] : [];
        delete user.expedition;
    }
    if (typeof user.deferUntil !== 'number') user.deferUntil = 0;
    if (user.defermentId === undefined) user.defermentId = null;
    if (typeof user.defermentsTaken !== 'number') user.defermentsTaken = 0;
    if (typeof user.checkpointStats !== 'object' || user.checkpointStats === null) user.checkpointStats = { passed: 0, failed: 0 };
    if (typeof user.reputation !== 'object' || user.reputation === null) user.reputation = { nina: 0, tolik: 0, mykola: 0, oksana: 0 };
    for (const npc of REPUTATION_NPCS) {
        if (typeof user.reputation[npc.id] !== 'number') user.reputation[npc.id] = 0;
    }
    if (!Array.isArray(user.claimedRepQuests)) user.claimedRepQuests = [];
    if (typeof user.dailyTradeVolume !== 'number') user.dailyTradeVolume = 0;
    if (typeof user.dailyBribes !== 'number') user.dailyBribes = 0;
    if (typeof user.dailyDonated !== 'number') user.dailyDonated = 0;
    for (const k of ['dailyNotices', 'dailyMedcom', 'dailyInspectors', 'dailyExpeditions']) {
        if (typeof user[k] !== 'number') user[k] = 0;
    }
    if (typeof user.lastBribeAt !== 'number') user.lastBribeAt = 0;
    if (typeof user.lastSeenAt !== 'number') user.lastSeenAt = 0;
    if (!Array.isArray(user.offlineLog)) user.offlineLog = [];
    if (typeof user.league !== 'number') user.league = 0;
    if (user.seasonId === undefined) user.seasonId = null;
    if (user.seasonTitle === undefined) user.seasonTitle = null;
    if (user.seasonResult === undefined) user.seasonResult = null;
    if (user.heatDaySP === undefined) user.heatDaySP = null;
    if (typeof user.pendingWarCrate !== 'number') user.pendingWarCrate = 0;
    if (typeof user.grannyUntil !== 'number') user.grannyUntil = 0;
    if (user.adConsent === undefined) user.adConsent = null;
    if (!Array.isArray(user.redeemedPromos)) user.redeemedPromos = [];
    if (typeof user.inspectorCooldownUntil !== 'number') user.inspectorCooldownUntil = 0;
    if (user.inspector === undefined) user.inspector = null;
    // Медична гілка (Р18 v3) — бекфіл для гравців, створених до 2026-08-16.
    if (user.activeDisease === undefined) user.activeDisease = null;
    if (typeof user.diseaseDocuments !== 'object' || user.diseaseDocuments === null) user.diseaseDocuments = {};
    if (typeof user.diseaseAnalysisProgress !== 'object' || user.diseaseAnalysisProgress === null) user.diseaseAnalysisProgress = {};
    if (user.diseaseAnalysisSession === undefined) user.diseaseAnalysisSession = null;
    if (typeof user.diseasesDiagnosed !== 'object' || user.diseasesDiagnosed === null) user.diseasesDiagnosed = {};
    if (typeof user.diseases !== 'object' || user.diseases === null) user.diseases = {};
    user.__schemaVersion = SCHEMA_VERSION;
    } // кінець блоку "тільки для не-мігрованих" — далі йде щоразу, для всіх

    // Ці три — ідемпотентні й дешеві, лишаються ПОЗА __schemaVersion-гардом
    // навмисно: installBalanceTracking ставить getter/setter на user.balance,
    // а Object.defineProperty НЕ переживає JSON.stringify/parse (кожен
    // рестарт процесу віддає balance як звичайне поле без accessor'а) — якщо
    // сховати цей виклик за __schemaVersion, після першого ж редеплою
    // totalEarned/balanceRev тихо перестали б рахуватись для всіх, у кого
    // __schemaVersion уже стояв з минулого разу.
    registerPid(user);
    installBalanceTracking(user);
    migrateLegacyPortfolio(user);
    return user;
}

// ===== Публічний id для PvP =====
// Назовні (лідерборд, підозрювані, порівняння профілів) світимо саме pid, а не
// Telegram id: PvP вимагає адресувати гравців, але видавати чужі Telegram-айді
// у публічному ендпоінті лідерборду не варто.
const pidIndex = new Map();
function makePid() {
    let pid;
    do { pid = crypto.randomBytes(5).toString('hex'); } while (pidIndex.has(pid));
    return pid;
}
function registerPid(user) {
    if (!user.pid) user.pid = makePid();
    pidIndex.set(user.pid, user.id);
}
function userByPid(pid) {
    const id = pidIndex.get(String(pid || ''));
    return id ? usersDB.get(id) : null;
}

// Раніше біржа торгувала окремими абстрактними товарами (гречка/сіль/тушонка), які
// лежали в user.portfolio. Тепер біржа торгує справжніми ресурсами з кладовки, і ті
// товари зникли — тому повертаємо гравцю їхню вартість монетами, щоб вкладене не
// згоріло мовчки. Базові ціни зафіксовані тут, бо в коді їх уже немає.
function migrateLegacyPortfolio(user) {
    if (!user.portfolio) { user.portfolio = {}; return; }
    let refund = 0;
    for (const [assetId, qty] of Object.entries(user.portfolio)) {
        if (LEGACY_ASSET_PRICES[assetId] && qty > 0) {
            refund += LEGACY_ASSET_PRICES[assetId] * qty;
            delete user.portfolio[assetId];
        }
    }
    if (refund > 0) {
        user.balance += refund;
        user.legacyRefund = (user.legacyRefund || 0) + refund;
    }
}

// Завантажуємо диск і одразу мігруємо всіх — так самодостатньо, без потреби
// в server.js вручну впорядковувати виклики (раніше `usersDB.forEach(migrateUser)`
// мав бути ПІСЛЯ визначення `const pidIndex` через тимчасову мертву зону в
// одному файлі; тепер pidIndex — модульний стан, готовий одразу після require()).
loadData();
usersDB.forEach((u) => migrateUser(u));

module.exports = {
    usersDB, clansDB, DATA_DIR, DATA_FILE, loadData, saveData, saveDataSync,
    createFreshUser, migrateUser, installBalanceTracking, migrateLegacyPortfolio,
    displayName, nicknameTaken, pidIndex, makePid, registerPid, userByPid,
};
