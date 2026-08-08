// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const MAP_BUILDINGS = [
    {
        id: 'tower', name: 'Вежа спостереження', emoji: '🗼', img: '/images/map-tower.webp',
        desc: 'Знижує шанс облави',
        levels: [
            { cost: { wood: 15, scrap: 5 }, raidCut: 0.10 },
            { cost: { wood: 30, scrap: 12, brick: 5 }, raidCut: 0.20 },
            { cost: { wood: 50, scrap: 25, brick: 15 }, raidCut: 0.30 },
        ],
    },
    {
        id: 'hideout', name: 'Схованка', emoji: '🕳️', img: '/images/map-hideout.webp',
        desc: 'Ріже грошовий штраф за протухлою повісткою',
        levels: [
            { cost: { brick: 15, scrap: 5 }, penaltyCut: 0.10 },
            { cost: { brick: 30, scrap: 12, wood: 5 }, penaltyCut: 0.20 },
            { cost: { brick: 50, scrap: 25, wood: 15 }, penaltyCut: 0.30 },
        ],
    },
    {
        id: 'cache', name: 'Тайник', emoji: '📦', img: '/images/map-cache.webp',
        desc: 'Захищає частину ресурсів від блокпоста й крадіжки',
        levels: [
            { cost: { wood: 10, brick: 10, scrap: 5 }, protectPct: 0.15 },
            { cost: { wood: 20, brick: 20, scrap: 12 }, protectPct: 0.30 },
            { cost: { wood: 35, brick: 35, scrap: 25 }, protectPct: 0.45 },
        ],
    },
];

module.exports = { MAP_BUILDINGS };
