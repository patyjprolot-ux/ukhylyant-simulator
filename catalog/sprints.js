// Спринти — робочі контракти (PATCH_2.0_SPRINTS_SPEC.md, фіче-флаг ECONOMY.SPRINTS_V2).
// Чисті дані, без логіки — той самий принцип, що й catalog/expeditions.js.
//
// Модель гібридна: схрон 1 лишається старим клікером, а на схронах 2-8 спринт
// замінює прямий клік по артворку. Тіри — це UI-ярлики (Junior/Middle/Senior/Lead),
// а не чотири окремі економічні моделі: нагорода в ТК скрізь рахується однією
// rate-формулою (тривалість контракту в годинах × ratePerHour), тому додати
// п'ятий тір колись = дописати рядок, а не переписувати баланс.

const SPRINT_TIERS = [
    {
        // Енергія входу навмисно різна: Junior можна брати часто й майже без
        // підготовки, Lead — рідкісна дорога подія на вечір. Саме "вартість входу
        // в часі", а не кількість тапів, і робить тіри різними за відчуттям.
        id: 'junior', name: 'Junior: правки по дрібному', emoji: '🐣',
        minLevel: 2, energyCost: 5, taps: 40, deadlineMin: 20, ratePerHour: 540,
        desc: 'Поміняти колір кнопки й не питати навіщо. Платять мало, зате беруть усіх.',
        dropTable: [{ res: 'script', qty: 1, chance: 1 }],
    },
    {
        id: 'middle', name: 'Middle: фіча під ключ', emoji: '⌨️',
        minLevel: 4, energyCost: 25, taps: 180, deadlineMin: 50, ratePerHour: 10800,
        desc: 'Вимоги змінились двічі, поки ти читав тікет. Але ставка вже доросла.',
        dropTable: [
            { res: 'script', qty: 1, chance: 1 },
            { res: 'intel_data', qty: 1, chance: 0.70 },
        ],
    },
    {
        id: 'senior', name: 'Senior: рефакторинг легасі', emoji: '🧠',
        minLevel: 6, energyCost: 45, taps: 450, deadlineMin: 210, ratePerHour: 15700,
        desc: 'Код писали до тебе, документації нема, дедлайн уже горить. Класика.',
        dropTable: [
            { res: 'intel_data', qty: 2, chance: 1 },
            { res: 'crypto_key', qty: 1, chance: 0.40 },
        ],
    },
    {
        id: 'lead', name: 'Lead: архітектура з нуля', emoji: '👑',
        minLevel: 8, energyCost: 70, taps: 1100, deadlineMin: 600, ratePerHour: 28000,
        desc: 'Десять годин, тисяча рядків і жодного мітингу. Мрія, за яку платять як за мрію.',
        dropTable: [{ res: 'crypto_key', qty: 2, chance: 0.20 }],
    },
];

// --- Вигорання (Burnout) ---
// Головний обмежувач темпу всередині контракту, замість енергії за клік: енергія
// платиться один раз на вході, а далі темп ріже саме втома. Без неї спринт був би
// звичайним клікером із таймером.
const BURNOUT_MAX = 100;                // 0-100, як heat
const BURNOUT_PER_TAP = 2.2;            // ділиться на FocusStat гравця (база 1)
const BURNOUT_DECAY_SEC = 25;           // -1% за кожні 25 сек реального часу
const BURNOUT_PENALTY_THRESHOLD = 80;   // від цього рівня тап майже нічого не дає
const BURNOUT_PENALTY_MULT = 0.15;      // -85% ефективності: лишається 15% рядків
// Стеля сумарного зниження вигорання від бустерів (ремап Р4). Живе тут уже зараз,
// щоб коли бустери переїдуть на нову семантику, число не довелось вигадувати заново.
const BURNOUT_BOOSTER_CAP = 0.25;

// --- QTE "Баги в коді" ---
// Рідкісна подія посеред тапання: не додаткова нагорода, а ризик втратити частину
// вже зароблених ТК. Тому штраф рахується від нагороди САМЕ ЦІЄЇ спроби і скидається
// разом із контрактом — накопичуватись між спринтами він не має.
const QTE_SPAWN_CHANCE = 0.035;   // шанс на кожен тап
const QTE_MIN_INTERVAL = 10;      // але не частіше, ніж раз на 10 тапів
const QTE_BASE_MS = 1600;         // базове вікно реакції
const QTE_MAX_MS = 2000;          // стеля з бонусом від інструментів (+до 0.4с)
const QTE_MISS_PENALTY = 0.12;    // -12% нагороди за кожен пропуск, адитивно, підлога 0

module.exports = {
    SPRINT_TIERS,
    BURNOUT_MAX, BURNOUT_PER_TAP, BURNOUT_DECAY_SEC,
    BURNOUT_PENALTY_THRESHOLD, BURNOUT_PENALTY_MULT, BURNOUT_BOOSTER_CAP,
    QTE_SPAWN_CHANCE, QTE_MIN_INTERVAL, QTE_BASE_MS, QTE_MAX_MS, QTE_MISS_PENALTY,
};
