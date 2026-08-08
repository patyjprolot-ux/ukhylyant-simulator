// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
// РІВЕНЬ УХИЛЯНТА (v2.1) — onboarding-гейт, НЕ економічна система.
// Ширший за user.level ("рівень схрону", лишається як є). Керує лише тим,
// які вкладки/кнопки клієнт показує — нічого з відкритого раніше не дає
// безкоштовної переваги (усе й так платні механіки), тому сервер тут не
// захищає економіку, тільки рахує цифру.
const { UKHYR_RANKS } = require('../../catalog/ukhyr');

// Скільки XP треба НАКОПИЧИТИ (кумулятивно з нуля), щоб дійти рівня l.
function xpForLevel(l) { return Math.round(40 * Math.pow(l, 1.5)); }
// Який рівень відповідає сумарному XP (лінійний пошук — рівнів мало, до ~50).
function playerLevelForXP(xp) {
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level++;
    return level;
}
// Єдина точка нарахування XP — піднімає user.playerLevel, повертає скільки
// рівнів здобуто за раз (0, якщо просто додалось XP без переходу).
function addXP(user, amount) {
    if (!amount) return 0;
    user.xp = (user.xp || 0) + amount;
    const newLevel = playerLevelForXP(user.xp);
    const gained = Math.max(0, newLevel - (user.playerLevel || 1));
    if (gained > 0) user.playerLevel = newLevel;
    return gained;
}
// Ухирація — суто рейтингова метрика для лідерборду (не валюта, нічого не купує).
function addUkhyr(user, amount) {
    if (!amount) return;
    user.ukhyr = (user.ukhyr || 0) + amount;
}

function ukhyrRank(points) {
    let rank = UKHYR_RANKS[0];
    for (const r of UKHYR_RANKS) { if ((points || 0) >= r.threshold) rank = r; }
    return rank.title;
}

module.exports = { xpForLevel, playerLevelForXP, addXP, addUkhyr, ukhyrRank };
