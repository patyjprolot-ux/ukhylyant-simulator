// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const HEAT_TIERS = [
    { max: 10, emoji: '😴', name: 'Ніхто тебе не знає', raidMult: 0.4, incomeMult: 1.00, flavor: 'Ти навіть у списках не значишся' },
    { max: 30, emoji: '📋', name: 'У списках', raidMult: 1.0, incomeMult: 1.08, flavor: 'Хтось десь щось про тебе записав' },
    { max: 55, emoji: '🚪', name: 'Дільничний питає', raidMult: 1.6, incomeMult: 1.20, flavor: 'Сусіди кажуть, тебе шукали' },
    { max: 75, emoji: '📢', name: 'Оголошено в розшук', raidMult: 2.4, incomeMult: 1.40, flavor: 'Твоє фото висить у ТЦК' },
    { max: 90, emoji: '📁', name: 'Персональна справа', raidMult: 3.2, incomeMult: 1.65, flavor: 'Тобі присвятили окрему папку' },
    { max: 100, emoji: '👑', name: 'Легенда району', raidMult: 4.5, incomeMult: 2.00, flavor: 'Про тебе знімають сюжет' },
];

const NOTICE_TYPES = [
    {
        id: 'sms', emoji: '📱', name: 'СМС-повістка', ttlH: 6, heatOnExpire: 10, balancePct: 0.05,
        flavor: 'Есемеска з незнайомого номера. Може, спам? Може, й ні.', wLow: 40, wHigh: 8,
    },
    {
        id: 'rezerv', emoji: '📲', name: 'Push із Резерв+', ttlH: 8, heatOnExpire: 12, balancePct: 0.08, heatExtra: 10,
        flavor: 'Додаток сам оновився і сам себе відкрив. Зручно.', wLow: 25, wHigh: 14,
    },
    {
        id: 'poshta', emoji: '✉️', name: 'Лист рекомендованим', ttlH: 12, heatOnExpire: 15, balancePct: 0.10,
        flavor: 'Листоноша дзвонив тричі. Ти тричі не чув.', wLow: 25, wHigh: 18,
    },
    {
        id: 'ruky', emoji: '🤝', name: 'Вручення в руки', ttlH: 3, heatOnExpire: 25, balancePct: 0.18, energyLockMin: 30,
        flavor: 'Перехопили біля під\'їзду. Довелось потиснути руку.', wLow: 8, wHigh: 32,
    },
    {
        id: 'blokpost', emoji: '🚧', name: 'Повістка на блокпосту', ttlH: 1, heatOnExpire: 35, balancePct: 0.25, resourceLoss: 3,
        flavor: 'Зупинили, переписали, вручили. Дуже ввічливо.', wLow: 2, wHigh: 28,
    },
];

module.exports = { HEAT_TIERS, NOTICE_TYPES };
