// Маршрути втечі (2026-08-21, PATCH_2.0_NEW_MECHANICS_R15.md, розділ 5).
// Ендгейм-луп ПІСЛЯ легалізації (prestigeCount >= 1) — НЕ плутати з ресурсом
// 'route' (catalog/resources.js), який здобувається вилазкою 'border' ДО
// легалізації, щоб узагалі дістатись схрону 5. Це геть інша механіка з
// іншою назвою навмисно, без конфлікту сенсів.
//
// Свідомо НЕ дає ТК/прогресивних ресурсів — основна економіка вже пройдена,
// тягнути її далі немає сенсу. Нагорода — суто косметична валюта 'contraband'
// для titles/декору. Ризик — не heat/спалитись перед ТЦК (це вже позаду), а
// конфіскація вантажу: провал забирає частину ЩОЙНО зароблених contraband
// цього заходу, не чіпає основний баланс чи склад.
const SMUGGLING_ROUTES = [
    {
        id: 'border_hop', name: 'Стрибок через кордон', emoji: '🚶', minutes: 20, risk: 0.12,
        desc: 'Коротко й майже безпечно. Розігрів для старої звички.',
        contrabandMin: 8, contrabandMax: 16,
    },
    {
        id: 'night_truck', name: 'Нічна фура', emoji: '🚚', minutes: 90, risk: 0.22,
        desc: 'Домовився з водієм. Довше, зате вигідніше.',
        contrabandMin: 30, contrabandMax: 55,
    },
    {
        id: 'forest_route', name: 'Лісова стежка', emoji: '🌲', minutes: 240, risk: 0.32,
        desc: 'Чотири години пішки. Найризикованіший маршрут — і найприбутковіший.',
        contrabandMin: 80, contrabandMax: 140,
    },
];

const SMUGGLING_BY_ID = Object.fromEntries(SMUGGLING_ROUTES.map((r) => [r.id, r]));

module.exports = { SMUGGLING_ROUTES, SMUGGLING_BY_ID };
