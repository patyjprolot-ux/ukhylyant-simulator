// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const EXPEDITIONS = [
    {
        id: 'dumpster', name: 'Рейд по смітниках', emoji: '🗑️', minutes: 30, minLevel: 1, risk: 0.10,
        desc: 'Швидко й майже безпечно. Багато не назбираєш.',
        loot: [{ res: 'paper', min: 4, max: 10 }, { res: 'cans', min: 3, max: 8 }, { res: 'tape', min: 1, max: 4 }],
    },
    {
        id: 'market', name: 'Вилазка на ринок', emoji: '🏪', minutes: 120, minLevel: 2, risk: 0.18,
        desc: 'Треба показатись людям. Ризик, що впізнають.',
        loot: [{ res: 'cans', min: 8, max: 18 }, { res: 'battery', min: 5, max: 12 }, { res: 'meds', min: 2, max: 5 }],
    },
    {
        id: 'ruins', name: 'Розбір руїн', emoji: '🪚', minutes: 180, minLevel: 2, risk: 0.20,
        desc: 'Розібраний будинок на околиці. Довше ринку, зате несеш будматеріали, а не барахло.',
        loot: [{ res: 'wood', min: 6, max: 14 }, { res: 'brick', min: 3, max: 8 }, { res: 'scrap', min: 2, max: 5 }],
    },
    {
        // Аудит балансу (2026-08-07): за старими цифрами ця вилазка давала ~7.8 ТК/хв,
        // а "Поїздка до баби в село" (коротша, безпечніша, той самий minLevel) — ~8.9
        // ТК/хв: довша й ризикованіша місія програвала коротшій, тому сенсу її обирати
        // не було. Здобич піднято, щоб вищий ризик реально компенсувався вищим доходом.
        id: 'warehouse', name: 'Нічний склад', emoji: '🏭', minutes: 480, minLevel: 3, risk: 0.25,
        desc: 'Вісім годин у чужому складі. Здобич серйозна.',
        loot: [{ res: 'meds', min: 9, max: 20 }, { res: 'fuel', min: 7, max: 17 }, { res: 'sim', min: 4, max: 11 }],
    },
    {
        id: 'village', name: 'Поїздка до баби в село', emoji: '🚜', minutes: 240, minLevel: 3, risk: 0.15,
        desc: 'Чотири години, майже безпечно. Баба нагодує і дасть із собою.',
        loot: [{ res: 'sausage', min: 5, max: 12 }, { res: 'cans', min: 10, max: 22 }, { res: 'meds', min: 2, max: 6 }],
    },
    {
        // minLevel 4, не 5 (2026-08-08): це джерело ресурсу 'route', потрібного
        // саме для переїзду НА рівень 5 — інакше ніхто ніколи не зміг би туди
        // потрапити (вилазка була б недоступна раніше за саму мету, для якої вона
        // потрібна).
        id: 'border', name: 'Прогулянка до кордону', emoji: '🌲', minutes: 720, minLevel: 4, risk: 0.35,
        desc: 'Дванадцять годин лісом. Найризикованіше, але й найцінніше — іноді щастить знайти цілий маршрут через кордон.',
        loot: [
            { res: 'cash', min: 2, max: 6 }, { res: 'stamp', min: 1, max: 3 }, { res: 'fuel', min: 8, max: 20 },
            // Малий шанс за спробу — реальна рідкість, не гарантований дроп.
            { res: 'route', min: 1, max: 1, chance: 0.12 },
        ],
    },
    {
        id: 'tcc_office', name: 'Нічний візит у ТЦК', emoji: '🏢', minutes: 600, minLevel: 6, risk: 0.45,
        desc: 'Десять годин. Найбезумніша ідея в грі — і єдиний спосіб дістати печатки пачками.',
        loot: [{ res: 'stamp', min: 4, max: 10 }, { res: 'ticket', min: 1, max: 2 }, { res: 'cash', min: 5, max: 12 }],
    },
];

// Редизайн компаньйонів (2026-08-21, PATCH_2.0_COMPANIONS_REDESIGN.md):
// 15-50% → 1-3%, той самий дух, що PET_GOOSE_CLICK_MULT/PET_CAT_ENERGY_MULT
// у catalog/economy.js.
const PET_EXPEDITION = {
    dog: { lootMult: 1.03 },
    rat: { riskMult: 0.97 },
    pigeon: { timeMult: 0.98 },
};

module.exports = { EXPEDITIONS, PET_EXPEDITION };
