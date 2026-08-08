// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const ROOM_ITEMS = [
    { id: 'lamp', name: 'Лампа затишку', emoji: '💡', price: 500, pos: 'top-left' },
    { id: 'poster', name: 'Постер альпійських краєвидів', emoji: '🖼️', price: 400, pos: 'top-center' },
    { id: 'tv', name: 'Старий телевізор', emoji: '📺', price: 1200, pos: 'top-right' },
    { id: 'plant', name: 'Вазон з фікусом', emoji: '🪴', price: 600, pos: 'mid-left' },
    { id: 'clock', name: 'Годинник із зозулею', emoji: '🕰️', price: 800, pos: 'mid-right' },
    { id: 'radio', name: 'Радіоприймач', emoji: '📻', price: 700, pos: 'bottom-left' },
    { id: 'rug', name: 'Килимок для конспірації', img: '/images/qte-rug.webp', price: 900, pos: 'bottom-center' },
    { id: 'suitcase', name: 'Тривожна валізка', emoji: '🧳', price: 1100, pos: 'bottom-right' },
    // Другий ряд декору — дорожчий, для тих, хто вже обставився
    { id: 'fridge', name: 'Холодильник із запасами', emoji: '🧊', price: 2500, pos: 'mid-center' },
    { id: 'guitar', name: 'Гітара для нудьги', emoji: '🎸', price: 1800, pos: 'top-far-left' },
    { id: 'books', name: 'Стос книжок "про запас"', emoji: '📚', price: 1400, pos: 'mid-far-left' },
    { id: 'cactus', name: 'Кактус-мовчун', emoji: '🌵', price: 1600, pos: 'bottom-far-left' },
    { id: 'trophy', name: 'Кубок "Найкращий син"', emoji: '🏆', price: 3200, pos: 'top-far-right' },
    { id: 'safe', name: 'Сейф із заначкою', emoji: '🔐', price: 5000, pos: 'mid-far-right' },
];

module.exports = { ROOM_ITEMS };
