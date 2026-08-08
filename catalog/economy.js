// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
// Економіка гри — єдине джерело правди для цін/нагород, і бек, і фронт орієнтуються на ці числа.

const ECONOMY = {
    // --- Апгрейди магазину: ЕШЕЛОННА система (v2.0 «Вертикаль», журнал 2026-08-07) ---
    // Стара UPGRADE_GROWTH (чисто експоненційна ціна проти лінійного ефекту) видалена —
    // математично неминуча стіна за будь-якого growth>1, відкат числа лікує симптом,
    // не причину. Замість неї: ешелони по TIER_SIZE рівнів. Усередині ешелону ціна
    // росте м'яко (IN_TIER_GROWTH), перехід у новий ешелон — окрема "гейт"-подія за
    // ТК (через звичайну ціну рівня) + ресурси (TIER_GATES нижче), і множить ефект
    // рівня на TIER_EFFECT_MULT. Дохід і ціна відтоді ростуть одним законом.
    TIER_SIZE: 10,
    TIER_COST_MULT: 22,
    IN_TIER_GROWTH: 1.35,
    TIER_EFFECT_MULT: 2.2,
    // 2026-08-08: THERMOS/GENERATOR раніше коштували СТРОГО гірше за ціною/ефект,
    // ніж просто накупити більше HAT/JAM (900/3=300 ТК за одиницю кліку проти
    // HAT-івських 40, 2200/4=550 за одиницю пасиву проти JAM-івських 150) — тобто
    // жодної причини їх колись купувати. Тепер вони трохи ВИГІДНІШІ за ціною/ефект
    // (35 і 130 за одиницю відповідно), як і личить "великій" пізній покупці.
    HAT_PRICE: 40, HAT_CLICK_BONUS: 1,
    JAM_PRICE: 150, JAM_PASSIVE_BONUS: 1,
    THERMOS_PRICE: 105, THERMOS_CLICK_BONUS: 3,
    GENERATOR_PRICE: 520, GENERATOR_PASSIVE_BONUS: 4,
    ENERGY_DRINK_PRICE: 120,

    // --- Енергія: головний обмежувач темпу ---
    // Раніше регенерація була +2 за тік (20/сек!) — бак наповнювався за 5 секунд і
    // енергія взагалі нічого не обмежувала. Тепер ~1/сек: 100 енергії = 50 кліків,
    // повне відновлення ~100 секунд. Саме це робить прогрес повільним і осмисленим.
    ENERGY_REGEN_PER_TICK: 0.1,
    ENERGY_PER_CLICK: 2,

    // --- Еволюція схрону: ціна/ресурси тепер живуть у catalog/locations.js
    // (поля price/resCost на кожному рівні) — єдине джерело правди замість
    // окремих *_PRICE констант тут, бо переїзд відтепер коштує і ресурси
    // теж, а не тільки ТК (v2.2 «Дуга ухилянта», 2026-08-08). ---

    // --- Кладовка (склад ресурсів) ---
    STORAGE_BASE_CAPACITY: 60,
    STORAGE_CAPACITY_PER_LEVEL: 40,
    STORAGE_UPGRADE_BASE: 800,
    STORAGE_UPGRADE_GROWTH: 1.68,
    STORAGE_MAX_LEVEL: 20,

    // --- Престиж ("Легалізація") ---
    // Скидає прогрес заради постійного множника доходу. Дає грі нескінченну глибину:
    // без цього після бункера робити нічого. Очки рахуються від сумарно заробленого
    // за все життя (корінь — щоб кожне наступне очко давалось відчутно важче).
    PRESTIGE_UNLOCK_LEVEL: 8,
    PRESTIGE_EARN_PER_POINT: 500000,
    PRESTIGE_BONUS_PER_POINT: 0.10,

    REVENGE_UNLOCK_RAIDS: 3,
    REVENGE_REWARD_MIN: 80,
    REVENGE_REWARD_MAX: 220,
    VIP_PRICE_STARS: 500,
    NICKNAME_CHANGE_PRICE_STARS: 1000, // перша зміна ніка безкоштовна, кожна наступна — за ⭐
    DONATE_AMOUNTS: [50, 100, 250, 500], // Stars — чиста підтримка розробників, без ігрових бонусів
    DAILY_REWARDS: [400, 550, 700, 900, 1200, 1600, 4000], // індекс = поточний день серії - 1, індекс 6 = День 7 (джекпот)
    REFERRAL_REWARD: 1500,
    RAID_CHANCE: 0.1,
    RAID_INTERVAL_MS: 45000,
    RAID_DURATION_S: 10,
    RAID_CLICKS_NEEDED: 50,
    QTE_KNOCK_CHANCE: 0.15,
    QTE_KNOCK_INTERVAL_MS: 30000,
    QTE_KNOCK_DURATION_S: 3,
    QTE_KNOCK_PENALTY_PCT: 0.15,
    AIRDROP_CHANCE: 0.25,
    // --- Згода на рекламні повідомлення в чаті ---
    AD_CONSENT_BONUS: 3000,
    // Кожен, хто погодився, трохи піднімає шанс аірдропу ВСІМ — то й сенс питати:
    // чим більше друзів дало згоду, тим частіше падає халява в грі загалом.
    AD_CONSENT_AIRDROP_BONUS_PER_PLAYER: 0.004,
    AD_CONSENT_AIRDROP_BONUS_CAP: 0.5,
    AIRDROP_INTERVAL_MS: 20000,
    AIRDROP_MIN: 60,
    AIRDROP_MAX: 180,
    CLAN_PASSIVE_BONUS: 0.05,
    // Скарбниця клану: учасники скидаються ТК, клан росте в рівні, і бонус до пасиву
    // росте разом із ним. Дає сенс гуртуватись, а не просто числитись у списку.
    CLAN_LEVEL_COST: 60000,
    CLAN_BONUS_PER_LEVEL: 0.02,
    CLAN_MAX_LEVEL: 15,
    OFFLINE_CAP_SECONDS: 8 * 3600,
    OFFLINE_MIN_SECONDS: 30,
    PET_GOOSE_CLICK_MULT: 1.15,
    PET_CAT_ENERGY_MULT: 1.3,
    PET_NEIGHBOR_RAID_MULT: 0.9,

    // --- Розшук (heat): другий ресурс, протилежний за знаком до ТК ---
    // Чим активніший і багатший гравець, тим більше ним цікавляться: разом росте і
    // дохід, і шанс облави. Гравець сам обирає, на якому рівні ризику жити — саме
    // це створює стиль гри, якого не давала одна лише енергія.
    HEAT_MAX: 100,
    HEAT_PER_100_CLICKS: 0.5,
    HEAT_EXPEDITION_PER_LEVEL: 2,
    HEAT_EXPEDITION_CAP: 8,
    HEAT_MARKET_SALE_MIN: 50000,
    HEAT_MARKET_SALE: 3,
    HEAT_CONTRABAND_CRATE: 4,
    HEAT_NEW_LOCATION: 5,
    HEAT_MEDCOM_FAIL: 15,
    HEAT_NEIGHBOR_MULT: 0.85,     // компаньйон "Сусідка-пліткарка" гасить приріст
    HEAT_DECAY_MINUTES: 12,       // -1 heat за кожні 12 хв реального часу
    HEAT_DECAY_DAILY_CAP: 42,     // але не більше -42 за добу, щоб "просто не грати" не було стратегією
    HEAT_BRIBE_DISCOUNT: 20,
    HEAT_SPRAVKA_DISCOUNT: 35,
    HEAT_LOG_SIZE: 20,

    // --- Повістки: випадковий штраф замінено на рішення з таймером ---
    NOTICE_MAX_ACTIVE: 3,
    NOTICE_INTERVAL_MIN_H: 4,
    NOTICE_INTERVAL_MAX_H: 8,
    NOTICE_BRIBE_BASE: 1200,
    NOTICE_HIDE_SUCCESS: 0.55,
    NOTICE_HIDE_FAIL_MULT: 1.5,
    NOTICE_MEDCOM_SUCCESS: 0.55,  // заглушка до Фази 2 (там буде міні-гра зі збиранням діагнозу)
    NOTICE_PUSH_BEFORE_MIN: 30,
    NOTICE_SEASON_POINTS: 2,
    NOTICE_TICK_MS: 5 * 60 * 1000,

    // --- PvP "Здати сусіда" ---
    // Головна соціальна механіка: єдине, що друзі можуть зробити ОДИН ОДНОМУ.
    // Усі обмеження нижче — навмисні запобіжники проти булінгу й спаму, бо це гра
    // для компанії друзів, а не арена.
    SNITCH_COST_TK: 3000,
    SNITCH_COST_RES: 'sim',              // ліва сімка, щоб дзвінок був анонімний
    SNITCH_DAILY_LIMIT: 3,
    SNITCH_MIN_LEVEL_GAP: 2,             // не можна бити тих, хто на 2+ рівні нижче
    SNITCH_SAME_TARGET_COOLDOWN_H: 6,
    SNITCH_HEAT: 15,
    SNITCH_RAT_REVEAL_CHANCE: 0.35,      // Щур-розвідник одразу палить стукача
    SNITCH_SUSPECTS: 3,
    SNITCH_STEAL_PCT: 0.30,
    // Стеля крадіжки за рівнем схрону. Без неї 30% балансу гравця, який збирав на
    // бункер, — це знищення вечора гри, тобто образа, а не драма.
    SNITCH_STEAL_CAP_PER_LEVEL: 8000,
    SNITCH_CAUGHT_SEASON_POINTS: 5,
    SNITCH_HISTORY_SIZE: 10,

    // --- Медкомісія: збираємо "діагноз" із карток симптомів ---
    MEDCOM_HAND_SIZE: 5,
    MEDCOM_PICK: 3,
    MEDCOM_BASE_SKEPTICISM: 100,   // + поточний heat: чим ти помітніший, тим менше віри
    MEDCOM_REROLL_COST: 800,
    MEDCOM_REROLL_MAX: 2,
    MEDCOM_STAMP_BONUS: 25,
    MEDCOM_MEDS_BONUS: 15,
    MEDCOM_MEDS_QTY: 3,
    MEDCOM_CAT_BONUS: 10,          // Кіт-антистрес: виглядаєш переконливо змученим
    MEDCOM_REPEAT_PENALTY: 20,     // "ви вже приходили з цим" — змушує варіювати
    MEDCOM_DEFER_H: 12,
    MEDCOM_SEASON_POINTS: 3,

    // --- Інспектори ТЦК (боси) ---
    INSPECTOR_SPAWN_CHANCE: 0.12,
    INSPECTOR_COOLDOWN_H: 6,
    INSPECTOR_ENERGY_PER_CLICK: 3,
    INSPECTOR_BATCH_MS: 500,
    INSPECTOR_MAX_CPS: 30,         // анти-чіт: більше 30 кліків/сек не буває навіть у автоклікера
    INSPECTOR_WEAKNESS_MULT: 2,
    INSPECTOR_LOSE_HEAT: 10,
    INSPECTOR_BRIBE_WINDOW_MIN: 30, // "за сесію був хабар" = хабар за останні 30 хв
    INSPECTOR_SPEED_CPS: 6,
    INSPECTOR_CHARM_MIN_PRICE: 2000, // косметика тіру 3+ визначається ціною

    // --- Блокпост при переїзді в новий схрон ---
    CHECKPOINT_PIGEON_BONUS: 0.15,   // Голуб-курʼєр знає обʼїзні
    CHECKPOINT_HEAT_DOCS: 20,
    CHECKPOINT_HEAT_BABA: 10,
    CHECKPOINT_RESOURCE_LOSS: 0.30,

    // --- Дерево навичок (за довідки легалізації) ---
    SKILL_RESET_COST_TK: 500000,     // перше скидання безкоштовне
    SKILL_HEAT_GAIN_CUT: 0.15,       // Тихіше води
    SKILL_ESCAPE_BONUS: 0.20,        // Знаю прохідні двори
    SKILL_SNITCH_FAIL_CHANCE: 0.30,  // Дві сімки
    SKILL_BRIBE_CUT: 0.30,           // Свій у ЖЕКу
    SKILL_RAID_WARNING_SEC: 10,      // Чуйка
    SKILL_DECAY_MULT: 2,             // Привид району
    SKILL_SELL_BONUS: 0.12,          // Знайомий перекуп
    SKILL_CRATE_DISCOUNT: 0.15,      // Оптова закупка
    SKILL_CLAN_MULT: 1.5,            // Кум у сільраді
    SKILL_RESOURCE_BONUS: 0.25,      // Свої люди
    SKILL_CRAFT_FREE_CHANCE: 0.20,   // Схема
    SKILL_MAX_ENERGY_BONUS: 25,      // Загартований
    SKILL_REGEN_BONUS: 0.40,         // Друге дихання
    SKILL_CLICK_BONUS: 0.30,         // Мозоль
    SKILL_PENALTY_CUT: 0.50,         // Незламний
    // Аудит балансу (2026-08-07): раніше клік коштував 1 енергії замість 2 (повне
    // подвоєння кліків на баку) — надто сильно для 3-ї з 6 навичок гілки. 1.5
    // лишає відчутний, але не ламаючий баланс ефект (+33% кліків замість +100%).
    SKILL_LIGHTHAND_ENERGY_COST: 1.5, // Легка рука

    // --- Міні-ігри ---
    MINIGAME_STAKE_MIN: 100,
    MINIGAME_STAKE_MAX: 20000,

    // --- Офлайн-звіт ---
    OFFLINE_REPORT_MIN_MS: 15 * 60 * 1000, // показуємо, лише якщо не було 15+ хвилин
    OFFLINE_LOG_SIZE: 12,

    // --- Репутація з районом ---
    REP_MAX: 100,
    REP_TOLIK_SELL_BONUS: 0.40,   // преміум-лот біржі на 100 репи
    REP_OKSANA_HEAT_CUT: 0.20,    // -20% приросту розшуку на 100 репи
    REP_NINA_MAX_ENERGY: 50,      // "Бабусина заготовка" на 100 репи

    // --- Сезони й ліги ---
    LEAGUE_PROMOTE: 8,            // топ-8 групи піднімаються
    LEAGUE_RELEGATE: 8,           // дно-8 падають
    SEASON_MIN_POINTS: 1,         // з нулем очок нікуди не рухаємо: гравець просто не грав
    SEASON_HEAT_DAILY_SP: 5,      // доба з розшуком > 60
    SEASON_HEAT_THRESHOLD: 60,
    SEASON_EXPEDITION_SP: 3,      // × рівень вилазки
    SEASON_RAID_SP: 1,            // вижив в облаві
    SEASON_CRAFT_SP: 8,           // крафт предмета тіру 3+
    SEASON_PRESTIGE_SP: 100,

    // --- Війна ОСББ ---
    WAR_POINTS_RAID: 2,
    WAR_POINTS_EXPEDITION: 3,
    WAR_POINTS_SNITCH: 10,        // стук на ворога — головна тактика війни
    WAR_POINTS_INSPECTOR: 25,
    WAR_POINTS_PER_DONATION: 10000, // 10k у скарбницю = +1 очко
    WAR_SNITCH_DISCOUNT: 0.5,     // під час війни стук на ворога вдвічі дешевший
    WAR_TREASURY_PRIZE: 0.20,
    WAR_BUFF_DAYS: 7,
    WAR_BUFF_PASSIVE: 0.10,

    // --- Облава на район (кооп-бос) ---
    DISTRICT_HEAT_TRIGGER: 400,   // сумарний розшук клану
    DISTRICT_WINDOW_H: 6,
    // hpMax рахуємо від РЕАЛЬНОЇ сили клану, а не від кількості учасників:
    // за 6 годин один гравець накопичує тисячі кліків, і плоскі 40k×учасників
    // помирали б за десять хвилин.
    DISTRICT_HP_PER_CLICK_POWER: 1200,
    DISTRICT_HP_FLOOR: 150000,
    DISTRICT_WIN_TK: 25000,
    DISTRICT_WIN_HEAT: -30,
    DISTRICT_WIN_SP: 15,
    DISTRICT_LOSE_BALANCE_PCT: 0.12,
    DISTRICT_LOSE_HEAT: 10,

    // --- Автоклікер «Бабуся клікає за тебе» ---
    GRANNY_MINUTES: 30,
    GRANNY_CPS: 3,
};

module.exports = ECONOMY;
