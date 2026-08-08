// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const LOCATIONS = [
    { level: 1, name: 'Бабусин Диван', img: '/images/location-1-couch.webp', roomImg: '/images/room-1-couch.webp', maxEnergy: 100 },
    { level: 2, name: 'Вологий Підвал', img: '/images/location-2-basement.webp', roomImg: '/images/room-2-basement.webp', maxEnergy: 150 },
    { level: 3, name: 'Балканська хатинка', img: '/images/location-3-balkan.webp', roomImg: '/images/room-3-balkan.webp', maxEnergy: 220 },
    { level: 4, name: 'Човен на Тисі', img: '/images/location-3-boat.webp', maxEnergy: 300 },
    { level: 5, name: 'Закордон (Гуманітарний коридор)', emoji: '🛂', img: '/images/location-5-abroad.webp', roomImg: '/images/room-5-abroad.webp', maxEnergy: 400 },
    { level: 6, name: 'Президентський бункер', emoji: '🏛️', img: '/images/location-6-bunker.webp', roomImg: '/images/room-6-bunker.webp', maxEnergy: 500 },
];

module.exports = { LOCATIONS };
