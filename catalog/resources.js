// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const RESOURCES = [
    { id: 'cans', name: 'Консерви', emoji: '🥫', img: '/images/gacha-tushonka.webp', tier: 1, sell: 25 },
    { id: 'battery', name: 'Батарейки', emoji: '🔋', img: '/images/gacha-powerbank.webp', tier: 1, sell: 30 },
    { id: 'paper', name: 'Макулатура', emoji: '🧻', tier: 1, sell: 20 },
    { id: 'tape', name: 'Скотч', emoji: '🩹', tier: 1, sell: 35 },
    // Будматеріали. Тір 1-2, зараз ідуть на крафт міцніших щитів/бонусів; коли
    // прийде окрема карта території — ті самі ресурси стануть валютою будівництва
    // (вежа спостереження/схованка/тайник), без міграції даних.
    { id: 'wood', name: 'Деревина', emoji: '🪵', tier: 1, sell: 28 },
    { id: 'meds', name: 'Ліки', emoji: '💊', tier: 2, sell: 130 },
    { id: 'sausage', name: 'Домашня ковбаса', emoji: '🌭', img: '/images/gacha-premium-sausage.webp', tier: 2, sell: 145 },
    { id: 'fuel', name: 'Пальне', emoji: '⛽', tier: 2, sell: 160 },
    { id: 'sim', name: 'Ліві сімки', emoji: '📱', tier: 2, sell: 200 },
    { id: 'scrap', name: 'Металобрухт', emoji: '⚙️', tier: 2, sell: 175 },
    { id: 'brick', name: 'Цегла', emoji: '🧱', tier: 2, sell: 150 },
    { id: 'cash', name: 'Валюта', emoji: '💵', tier: 3, sell: 700 },
    { id: 'stamp', name: 'Печатка', emoji: '🔏', tier: 3, sell: 1100 },
    { id: 'phone', name: 'Номер потрібної людини', emoji: '☎️', tier: 3, sell: 1400 },
    // Уламок пломби з донатного ящика. Випадає рідко зі звичайних ящиків і дає
    // безкоштовний, але довгий шлях до платних ящиків: зібрав достатньо — склеїв.
    { id: 'shard', name: 'Уламок пломби', emoji: '🧩', tier: 3, sell: 900 },
    { id: 'ticket', name: 'Білий квиток', emoji: '🎫', tier: 4, sell: 5000 },
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
