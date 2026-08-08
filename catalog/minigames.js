// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const WHEEL_SEGMENTS = [
    { label: '150 🪙', type: 'balance', amount: 150, weight: 24, color: '#4a3f30' },
    { label: '300 🪙', type: 'balance', amount: 300, weight: 18, color: '#c3073f' },
    { label: 'Нічого', type: 'none', amount: 0, weight: 18, color: '#2a2a2d' },
    { label: 'Ресурс', type: 'resource', tier: 1, weight: 14, color: '#2e7d32' },
    { label: '700 🪙', type: 'balance', amount: 700, weight: 12, color: '#4a3f30' },
    { label: 'Енергія', type: 'energy', amount: 0, weight: 8, color: '#2b5c8f' },
    { label: 'Рідкісний ресурс', type: 'resource', tier: 2, weight: 5, color: '#6a1b9a' },
    { label: 'ДЖЕКПОТ 5000', type: 'balance', amount: 5000, weight: 1, color: '#ffd700' },
];

const RISK_TIERS = [
    { id: 'safe', name: 'Обережно', mult: 1.5, chance: 0.60 },
    { id: 'medium', name: 'Середньо', mult: 3, chance: 0.30 },
    { id: 'extreme', name: 'Відчайдушно', mult: 10, chance: 0.08 },
];

const MEMORY_ICONS = ['🥫', '🔋', '📄', '💊'];

// Вхід 200 ТК (MEMORY_ENTRY_COST, server.js). 2026-08-08: стара таблиця
// (200-3000, найгірший результат = точний беззбиток) фактично не мала
// програшу — навіть посередня гра давала кратний прибуток. Тепер лише
// справді гарна пам'ять у плюсі, посередня — трохи в мінус, погана — відчутно.
const MEMORY_REWARD_TABLE = [
    { maxFlips: 6, reward: 800 },
    { maxFlips: 8, reward: 500 },
    { maxFlips: 12, reward: 250 },
    { maxFlips: 16, reward: 150 },
    { maxFlips: Infinity, reward: 50 },
];

module.exports = { WHEEL_SEGMENTS, RISK_TIERS, MEMORY_ICONS, MEMORY_REWARD_TABLE };
