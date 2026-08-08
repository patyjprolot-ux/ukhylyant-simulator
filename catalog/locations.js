// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

// v2.2 «Дуга ухилянта» (2026-08-08): 6 рівнів → 8, реалістичніша сатирична
// дуга від однушки на Троєщині до легалізованого маєтку. Той самий файл —
// img/roomImg тепер вказують на одне й те саме зображення (loc8-*): нові
// активи вже намальовані під композицію "персонаж у правій третині кадру"
// (як стара roomImg-схема), тож одне зображення обслуговує і кнопку
// еволюції в магазині, і екран "Кімната", і новий фон усього застосунку
// (клієнт бере це саме поле для фонового шару — див. buildHtml()).
//
// price/resCost — ціна переїзду на цей рівень (перевіряється й списується
// СЕРВЕРНО, /api/location/buy, за тим самим принципом, що й крафт/будівлі
// на карті: клієнту довіряти не можна). Рівень 1 стартовий, без ціни.
const LOCATIONS = [
    { level: 1, name: 'Однушка на Троєщині', img: '/images/loc8-1-troyeshchyna.webp', roomImg: '/images/loc8-1-troyeshchyna.webp', maxEnergy: 80 },
    { level: 2, name: 'Бабусин диван', img: '/images/loc8-2-couch.webp', roomImg: '/images/loc8-2-couch.webp', maxEnergy: 120,
      price: 1500, resCost: { paper: 5, cans: 4 } },
    { level: 3, name: 'Двір на Закарпатті', img: '/images/loc8-3-zakarpattia.webp', roomImg: '/images/loc8-3-zakarpattia.webp', maxEnergy: 170,
      price: 6000, resCost: { wood: 12, tape: 6 } },
    { level: 4, name: 'Хатина в лісі', img: '/images/loc8-4-cabin.webp', roomImg: '/images/loc8-4-cabin.webp', maxEnergy: 230,
      price: 25000, resCost: { wood: 20, scrap: 10 } },
    // 'route' (Маршрут через кордон) — рідкісний шанс-дроп із вилазки "Прогулянка
    // до кордону" (minLevel 4, тобто доступна ще з попереднього рівня, інакше
    // дедлок). Без нього не можна фізично перейти кордон.
    { level: 5, name: 'Палатка під кордоном', img: '/images/loc8-5-tent.webp', roomImg: '/images/loc8-5-tent.webp', maxEnergy: 300,
      price: 90000, resCost: { scrap: 15, fuel: 8, brick: 8, route: 1 } },
    { level: 6, name: 'СІЗО закордоном', emoji: '🔒', img: '/images/loc8-6-sizo.webp', roomImg: '/images/loc8-6-sizo.webp', maxEnergy: 380,
      price: 350000, resCost: { cash: 6, stamp: 3 } },
    { level: 7, name: 'Квартира в Польщі', emoji: '🏢', img: '/images/loc8-7-poland.webp', roomImg: '/images/loc8-7-poland.webp', maxEnergy: 470,
      price: 1200000, resCost: { cash: 18, stamp: 10, phone: 3 } },
    { level: 8, name: 'Легалізація — маєток в Україні', emoji: '🏛️', img: '/images/loc8-8-mansion-interior.webp', roomImg: '/images/loc8-8-mansion-interior.webp', maxEnergy: 570,
      price: 4000000, resCost: { cash: 45, stamp: 22, phone: 6, shard: 12 } },
];

module.exports = { LOCATIONS };
