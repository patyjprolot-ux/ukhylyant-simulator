// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const DEFERMENTS = [
    {
        id: 'student', emoji: '🎓', name: 'Студентський заочки', hours: 24,
        cost: { tk: 18000 },
        flavor: 'Вступив на «Богословʼя». Пара раз на місяць, і та онлайн',
    },
    {
        id: 'opikun', emoji: '🧓', name: 'Догляд за бабусею', hours: 12,
        cost: { res: { cans: 10, meds: 2 } },
        flavor: 'Бабуся здорова як бик, але ти дуже переживаєш',
    },
    {
        id: 'health', emoji: '🩺', name: 'Довідка по здоровʼю', hours: 48,
        cost: { res: { meds: 5, stamp: 1 } },
        flavor: 'Печатка справжня. Все інше — ні',
    },
    {
        id: 'bron', emoji: '🏭', name: 'Бронь від підприємства', hours: 72,
        cost: { clanLevel: 5 },
        flavor: 'ОСББ офіційно визнано критичною інфраструктурою',
    },
    {
        id: 'batko', emoji: '👶', name: 'Багатодітний батько', hours: 7 * 24,
        cost: { stars: 100 },
        flavor: 'Троє. Ну, майже. Ну, планується',
    },
    {
        id: 'deputat', emoji: '🎩', name: 'Помічник депутата', hours: 14 * 24,
        cost: { res: { phone: 1, cash: 20 } },
        flavor: 'Помічник помічника помічника. На громадських засадах',
    },
];

const CHECKPOINT_CHOICES = [
    {
        id: 'docs', emoji: '📄', name: 'Показати документи', chance: 0.60,
        fail: 'heat_notice', failText: '+20 розшуку і повістка просто тут, на місці',
    },
    {
        id: 'field', emoji: '🌾', name: 'Обʼїхати полем', chance: 0.45,
        fail: 'resources', failText: 'Загубиш 30% випадкових ресурсів із кладовки',
    },
    {
        id: 'baba', emoji: '🧓', name: '«Я до баби, вона хворіє»', chance: 0.40,
        fail: 'heat', failText: '+10 розшуку',
        // Репутація з Бабою Ніною — Фаза 6. Поки її немає, працює базовий шанс.
        bonusWithNinaRep: 0.75, ninaRepRequired: 50,
    },
];

const REPUTATION_NPCS = [
    {
        id: 'nina', emoji: '🧓', name: 'Баба Ніна',
        about: 'Знає всіх у дворі й усе про всіх. Підгодовує і прикриває.',
        quests: [
            { id: 'nina_cans', text: 'Занеси бабі 5 консервів', type: 'donate', res: 'cans', target: 5, rep: 15 },
            { id: 'nina_meds', text: 'Занеси бабі 2 упаковки ліків', type: 'donate', res: 'meds', target: 2, rep: 15 },
            { id: 'nina_quiet', text: 'Посидь удома: жодної вилазки за добу', type: 'metric', metric: 'expeditionsToday', max: 0, rep: 12 },
        ],
        perk: 'Рецепт «Бабусина заготовка»: +50 до макс. енергії назавжди',
        // Компаньйони (редизайн 2026-08-21, PATCH_2.0_COMPANIONS_REDESIGN.md):
        // відкриваються лише після repMaxed(user, npc.id) — довіра, тоді квест,
        // тоді сама покупка (routes/misc.js: /api/npc/companion-quest/*).
        companionQuests: [
            { petId: 'neighbor', text: 'Ніна познайомить тебе із сусідкою, якщо принесеш у подяку 3 упаковки ліків', type: 'donate', res: 'meds', target: 3 },
        ],
    },
    {
        id: 'tolik', emoji: '💰', name: 'Перекуп Толік',
        about: 'Купує все. Продає все. Питань не задає, але й ціну не завищує.',
        quests: [
            { id: 'tolik_volume', text: 'Наторгуй на біржі на 50 000 ТК', type: 'metric', metric: 'dailyTradeVolume', target: 50000, rep: 15 },
            { id: 'tolik_paper', text: 'Назбирай 20 ресурсів за добу', type: 'metric', metric: 'dailyResources', target: 20, rep: 12 },
            { id: 'tolik_trades', text: 'Зроби 5 угод на біржі', type: 'metric', metric: 'dailyTrades', target: 5, rep: 12 },
        ],
        perk: 'Преміум-лот: ще +40% до ціни продажу на біржі',
        companionQuests: [
            { petId: 'dog', text: 'Толік зведе тебе з псом, якщо принесеш 5 консервів йому на харч', type: 'donate', res: 'cans', target: 5 },
            { petId: 'rat', text: 'Толік поступиться щуром за 3 ліві сімки на обмін', type: 'donate', res: 'sim', target: 3 },
        ],
    },
    {
        id: 'mykola', emoji: '👮', name: 'Дільничний Микола',
        about: 'Формально при виконанні. Фактично — теж людина, і теж стомився.',
        quests: [
            { id: 'mykola_raids', text: 'Переживи 2 облави за добу', type: 'metric', metric: 'dailyRaids', target: 2, rep: 15 },
            { id: 'mykola_bribe', text: 'Виріши питання по-хорошому (1 хабар)', type: 'metric', metric: 'dailyBribes', target: 1, rep: 15 },
            { id: 'mykola_quiet', text: 'Протримай розшук нижче 30', type: 'metric', metric: 'heatNow', max: 30, rep: 12 },
        ],
        perk: '«Прикриття»: одне безкоштовне зняття повістки на добу',
        companionQuests: [
            { petId: 'goose', text: 'Микола віддасть гусака, якщо приволочеш 2 печатки "на оформлення"', type: 'donate', res: 'stamp', target: 2 },
        ],
    },
    {
        id: 'oksana', emoji: '🎗️', name: 'Волонтерка Оксана',
        about: 'Возить туди, куди ти дуже не хочеш. Просить небагато і завжди дякує.',
        quests: [
            { id: 'oksana_meds', text: 'Здай на волонтерку 3 упаковки ліків', type: 'donate', res: 'meds', target: 3, rep: 18 },
            { id: 'oksana_cans', text: 'Здай на волонтерку 10 консервів', type: 'donate', res: 'cans', target: 10, rep: 15 },
            { id: 'oksana_fuel', text: 'Здай на волонтерку 5 каністр пального', type: 'donate', res: 'fuel', target: 5, rep: 20 },
        ],
        perk: 'Титул «Не такий вже й падлюка» і постійні −20% до приросту розшуку',
        companionQuests: [
            { petId: 'cat', text: 'Оксана відправить кота з тобою за 2 упаковки ліків для нього', type: 'donate', res: 'meds', target: 2 },
            { petId: 'pigeon', text: 'Оксана довірить голуба за 3 каністри пального на дорогу', type: 'donate', res: 'fuel', target: 3 },
        ],
    },
];

const LEAGUES = [
    { id: 0, emoji: '🛋️', name: 'Ліга Дивана' },
    { id: 1, emoji: '🕳️', name: 'Ліга Підвалу' },
    { id: 2, emoji: '🏔️', name: 'Ліга Балкан' },
    { id: 3, emoji: '🚣', name: 'Ліга Тиси' },
    { id: 4, emoji: '🛂', name: 'Ліга Кордону' },
    { id: 5, emoji: '🏛️', name: 'Ліга Бункера' },
];

module.exports = { DEFERMENTS, CHECKPOINT_CHOICES, REPUTATION_NPCS, LEAGUES };
