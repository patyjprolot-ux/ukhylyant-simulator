// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const RESOURCES = [
    { id: 'cans', name: 'Консерви', emoji: '🥫', img: '/images/gacha-tushonka.webp', tier: 1, sell: 45 },
    { id: 'battery', name: 'Батарейки', emoji: '🔋', img: '/images/gacha-powerbank.webp', tier: 1, sell: 55 },
    { id: 'paper', name: 'Макулатура', emoji: '🧻', tier: 1, sell: 35 },
    { id: 'tape', name: 'Скотч', emoji: '🩹', tier: 1, sell: 65 },
    // Будматеріали. Тір 1-2, зараз ідуть на крафт міцніших щитів/бонусів; коли
    // прийде окрема карта території — ті самі ресурси стануть валютою будівництва
    // (вежа спостереження/схованка/тайник), без міграції даних.
    { id: 'wood', name: 'Деревина', emoji: '🪵', tier: 1, sell: 50 },
    { id: 'meds', name: 'Ліки', emoji: '💊', tier: 2, sell: 230 },
    { id: 'sausage', name: 'Домашня ковбаса', emoji: '🌭', img: '/images/gacha-premium-sausage.webp', tier: 2, sell: 260 },
    { id: 'fuel', name: 'Пальне', emoji: '⛽', tier: 2, sell: 290 },
    { id: 'sim', name: 'Ліві сімки', emoji: '📱', tier: 2, sell: 360 },
    { id: 'scrap', name: 'Металобрухт', emoji: '⚙️', tier: 2, sell: 320 },
    { id: 'brick', name: 'Цегла', emoji: '🧱', tier: 2, sell: 270 },
    // Нові тіри 1-2 (2026-08-08) — трохи розширити асортимент тіньової біржі
    // (MARKET_ASSETS бере всі ресурси тір<=3 автоматично, окремо нічого не треба).
    { id: 'coffee', name: 'Кава', emoji: '☕', tier: 1, sell: 80 },
    { id: 'coal', name: 'Вугілля', emoji: '⛏️', tier: 2, sell: 250 },
    { id: 'cash', name: 'Валюта', emoji: '💵', tier: 3, sell: 1250 },
    { id: 'stamp', name: 'Печатка', emoji: '🔏', tier: 3, sell: 2000 },
    { id: 'phone', name: 'Номер потрібної людини', emoji: '☎️', tier: 3, sell: 2500 },
    // Уламок пломби — тепер тільки ресурсний гейт переїзду на схрон 8
    // (catalog/locations.js), крафт-використання під донатні ящики забрали собі
    // 4 нові окремі уламки нижче (2026-08-13, розділення за проханням розробника).
    { id: 'shard', name: 'Уламок пломби', emoji: '🧩', tier: 3, sell: 1600 },
    // Окремі рідкісні уламки під кожен донатний ящик (2026-08-13): раніше один
    // спільний 'shard' відкривав шлях до БУДЬ-ЯКОГО з 4 донатних ящиків, і випадав
    // відносно часто (0.8-4.7% залежно від ящика). Тепер кожен ящик глеїться зі
    // СВОГО уламка, дроп — окремий бонус-ролл ~0.05% (rollCrate у server.js), не
    // частина звичайної таблиці лута. "Ніяких додаткових механік" — лише дроп з
    // безкоштовних ящиків, як просив розробник.
    { id: 'shard_starter', name: 'Уламок стартового набору', emoji: '🧩', tier: 3, sell: 2500 },
    { id: 'shard_elite', name: 'Уламок елітного контейнера', emoji: '🧩', tier: 3, sell: 2500 },
    { id: 'shard_wardrobe', name: 'Уламок модної валізи', emoji: '🧩', tier: 3, sell: 2500 },
    { id: 'shard_legendary', name: 'Уламок легендарного схрону', emoji: '🧩', tier: 3, sell: 2500 },
    // Маршрут через кордон — рідкісний шанс-дроп із вилазки "Прогулянка до
    // кордону" (2026-08-08), потрібен для переїзду на рівень 5 (Палатка під
    // кордоном): без нього фізично нема як безпечно перейти.
    { id: 'route', name: 'Маршрут через кордон', emoji: '🗺️', tier: 3, sell: 2200 },
    { id: 'ticket', name: 'Білий квиток', emoji: '🎫', tier: 4, sell: 9000 },
    // --- Цифрові ресурси Спринтів (PATCH 2.0, за фіче-флагом ECONOMY.SPRINTS_V2) ---
    // Здобуваються ТІЛЬКИ з робочих контрактів (catalog/sprints.js), не з вилазок і
    // не з ящиків: у "віддаленої роботи" має бути власне джерело здобичі, інакше
    // спринти нічого не додають до економіки, а лише дублюють клікер іншою кнопкою.
    // script/intel_data — тір 3, тобто автоматично торгуються на тіньовій біржі
    // (MARKET_ASSETS бере все з tier<=3), і це навмисно: код і злиті дані — саме
    // той товар, який продають, а не тримають.
    { id: 'script', name: 'Фрагмент коду', emoji: '💾', tier: 3, sell: 2500 },
    { id: 'intel_data', name: 'Розвідані дані', emoji: '🛰️', tier: 3, sell: 12000 },
    // Тір 4 — як і Білий квиток: на біржу не потрапляє за визначенням фільтра.
    // Крипто-ключ має здобуватись контрактом, а не докуповуватись за ТК.
    { id: 'crypto_key', name: 'Крипто-ключ', emoji: '🔑', tier: 4, sell: 45000 },
];

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
            { type: 'res', res: 'wood', min: 1, max: 3, weight: 14 },
            { type: 'res', res: 'coffee', min: 1, max: 3, weight: 13 },
            { type: 'coins', min: 300, max: 900, weight: 8 },
            { type: 'res', res: 'meds', min: 1, max: 1, weight: 2 },
            { type: 'res', res: 'shard', min: 1, max: 1, weight: 1 },
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
            { type: 'res', res: 'wood', min: 2, max: 5, weight: 12 },
            { type: 'coins', min: 1500, max: 4000, weight: 8 },
            { type: 'res', res: 'sausage', min: 1, max: 3, weight: 7 },
            { type: 'energy', weight: 5 },
            { type: 'res', res: 'sim', min: 1, max: 1, weight: 2 },
            { type: 'res', res: 'shard', min: 1, max: 1, weight: 2 },
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
            { type: 'res', res: 'sausage', min: 3, max: 8, weight: 14 },
            { type: 'res', res: 'cans', min: 8, max: 15, weight: 12 },
            { type: 'coins', min: 6000, max: 15000, weight: 12 },
            { type: 'res', res: 'cash', min: 1, max: 2, weight: 10 },
            { type: 'res', res: 'scrap', min: 2, max: 5, weight: 9 },
            { type: 'res', res: 'brick', min: 2, max: 5, weight: 9 },
            { type: 'res', res: 'coal', min: 2, max: 6, weight: 9 },
            { type: 'granny', weight: 6 },
            { type: 'cosmetic', weight: 8 },
            { type: 'res', res: 'stamp', min: 1, max: 1, weight: 4 },
            { type: 'res', res: 'shard', min: 1, max: 2, weight: 4 },
        ],
    },
    {
        id: 'contraband', name: 'Контрабандний контейнер', emoji: '🚢', img: '/images/gacha-box-elite.webp',
        price: 60000, currency: 'coins',
        desc: 'Приплив по Тисі. Питань не задаємо, вміст не коментуємо.',
        // Ціна й ваги підкручені журналом v2.0 (розділ 6.5): ресурси тепер справді
        // цінні (їдять ешелони апгрейдів), тому дорожче; ticket 5→1 — Білий Квиток
        // мав ~4.3% з не-донатного ящика, тепер ~0.87%, лишається рідкісною фіналкою.
        loot: [
            { type: 'res', res: 'cash', min: 2, max: 6, weight: 22 },
            { type: 'res', res: 'sim', min: 5, max: 12, weight: 18 },
            { type: 'res', res: 'fuel', min: 6, max: 14, weight: 16 },
            { type: 'coins', min: 25000, max: 60000, weight: 14 },
            { type: 'res', res: 'stamp', min: 1, max: 3, weight: 12 },
            { type: 'res', res: 'scrap', min: 4, max: 10, weight: 10 },
            { type: 'res', res: 'brick', min: 4, max: 10, weight: 10 },
            { type: 'cosmetic', weight: 10 },
            { type: 'res', res: 'ticket', min: 1, max: 1, weight: 1 },
            // Єдине джерело "номера потрібної людини" за ігрову валюту — без нього
            // не взяти найдовшу відстрочку.
            { type: 'res', res: 'phone', min: 1, max: 1, weight: 2 },
            { type: 'res', res: 'shard', min: 1, max: 3, weight: 6 },
            { type: 'granny', weight: 4 },
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
        desc: 'ГАРАНТОВАНО рідкісна річ у гардероб + 30 000 ТК зверху. Для колекціонерів.',
        // Таблиця навмисно з одного рядка: цей ящик не крутиться, він завжди видає
        // косметику (див. guaranteedCosmetic у rollCrate). Показані шанси мають
        // збігатися з тим, що реально відбувається.
        guaranteedCosmetic: true,
        loot: [
            { type: 'cosmetic', weight: 100 },
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
            { type: 'res', res: 'phone', min: 1, max: 2, weight: 12 },
        ],
    },
    // Трофейний ящик за ТК/⭐ не купується взагалі — тільки з перемоги у війні
    // ОСББ або з відбитої облави на район. Тому й дроп без порожніх результатів.
    {
        id: 'trophy', name: 'Трофейний ящик', emoji: '🏆', price: 0, currency: 'trophy',
        desc: 'Здобич із війни ОСББ. Не продається — тільки виграється.',
        loot: [
            { type: 'coins', min: 30000, max: 90000, weight: 26 },
            { type: 'res', res: 'cash', min: 3, max: 8, weight: 20 },
            { type: 'res', res: 'stamp', min: 1, max: 3, weight: 18 },
            { type: 'res', res: 'sim', min: 4, max: 10, weight: 16 },
            { type: 'cosmetic', weight: 12 },
            { type: 'res', res: 'phone', min: 1, max: 1, weight: 5 },
            { type: 'res', res: 'ticket', min: 1, max: 1, weight: 3 },
        ],
    },
];

module.exports = { RESOURCES, CRATES };
