// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const RECIPES = [
    {
        id: 'energy_pack', name: 'Саморобний енергопак', emoji: '🔌', img: '/images/gacha-premium-charge.webp',
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
        // Аудит балансу (2026-08-07): ресурсний кошт (fuel12+sim8+cash3) ≈ 5 620 ТК
        // за поточними цінами продажу, тому первісні 40 000 ТК давали чистий
        // арбітраж ×7 без ризику — краще за будь-яку іншу дію в грі. Знижено до
        // 9 000 (маржа ×1.6, як у звичайного вигідного крафту, не безкінечний друк грошей).
        id: 'smuggle_kit', name: 'Набір контрабандиста', emoji: '🎒',
        cost: { fuel: 12, sim: 8, cash: 3 },
        desc: 'Продається перекупу за 9 000 ТК',
        effect: { type: 'coins', amount: 9000 },
    },
    {
        id: 'feast', name: 'Бенкет на районі', emoji: '🍽️',
        cost: { sausage: 10, cans: 20, meds: 3 },
        desc: 'Наївся від душі: +30 до максимальної енергії',
        effect: { type: 'maxEnergy', amount: 30 },
    },
    {
        id: 'bribe_basket', name: 'Кошик "для вирішення питання"', emoji: '🧺',
        cost: { sausage: 15, cash: 4, stamp: 2 },
        desc: 'Щит від облав на 8 годин',
        effect: { type: 'shield', hours: 8 },
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
    // --- Будматеріали (wood/scrap/brick): середній тір крафту, споживає ресурси
    // з нової вилазки "Розбір руїн" і оновлених ящиків. Ті самі три ресурси пізніше
    // стануть валютою будівництва на карті території. ---
    {
        id: 'reinforced_hideout', name: 'Зміцнена криївка', emoji: '🪜',
        cost: { wood: 28, brick: 14, scrap: 8 },
        desc: '+28 до максимальної енергії (назавжди)',
        effect: { type: 'maxEnergy', amount: 28 },
    },
    {
        id: 'scrap_generator', name: 'Генератор з металобрухту', emoji: '⚙️',
        cost: { scrap: 15, wood: 10 },
        desc: '+8 до пасивного доходу (назавжди)',
        effect: { type: 'passive', amount: 8 },
    },
    {
        id: 'brick_wall', name: 'Цегляна стіна', emoji: '🧱',
        cost: { brick: 20, scrap: 8 },
        desc: 'Щит від облав на 5 годин',
        effect: { type: 'shield', hours: 5 },
    },
    {
        id: 'white_ticket', name: 'Справжній Білий Квиток', emoji: '🎫',
        cost: { ticket: 5, stamp: 15, cash: 25 },
        desc: 'ПОСТІЙНИЙ імунітет до облав. Фінальна ціль гри.',
        effect: { type: 'permanent_shield' },
    },
    // --- Склеювання донатних ящиків з уламків пломб ---
    // Довгий безкоштовний шлях до платних ящиків. Ціни підібрані так, щоб це був
    // саме шлях, а не заміна: уламки випадають рідко, і на легендарний схрон їх
    // треба стільки, що швидше пограти, ніж накопичити.
    {
        id: 'glue_starter', name: 'Склеїти Стартовий пакет', emoji: '🥡',
        cost: { shard: 10, tape: 5 },
        desc: 'Стартовий пакет із уламків. Той самий вміст, що й за 25 ⭐.',
        effect: { type: 'crate', crateId: 'starter' },
    },
    {
        id: 'glue_elite', name: 'Склеїти Елітний контейнер', emoji: '💎',
        cost: { shard: 25, tape: 10, cash: 3 },
        desc: 'Елітний контейнер із уламків. Той самий вміст, що й за 75 ⭐.',
        effect: { type: 'crate', crateId: 'elite' },
    },
    {
        id: 'glue_fashion', name: 'Склеїти Модну валізу', emoji: '👗',
        cost: { shard: 45, stamp: 3, cash: 6 },
        desc: 'Модна валіза з уламків. Гарантована річ у гардероб.',
        effect: { type: 'crate', crateId: 'wardrobe' },
    },
    {
        id: 'glue_legendary', name: 'Склеїти Легендарний схрон', emoji: '🏆',
        cost: { shard: 75, stamp: 8, cash: 15, phone: 1 },
        desc: 'Легендарний схрон із уламків. Тільки топовий дроп.',
        effect: { type: 'crate', crateId: 'legendary' },
    },
];

module.exports = { RECIPES };
