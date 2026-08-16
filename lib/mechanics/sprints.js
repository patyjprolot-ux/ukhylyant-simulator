// Спринти (PATCH_2.0_SPRINTS_SPEC.md) — чисті функції без Express, як і решта
// lib/mechanics/*. Роути звідси тільки читають і мутують user, вся математика
// контрактів живе в одному місці, щоб клієнтський UI наступного заходу рахував
// те саме, що й сервер.
const { byId } = require('../utils');
const {
    SPRINT_TIERS, BURNOUT_MAX, BURNOUT_PER_TAP, BURNOUT_DECAY_SEC,
    BURNOUT_PENALTY_THRESHOLD, BURNOUT_PENALTY_MULT,
    QTE_BASE_MS, QTE_MAX_MS, QTE_MISS_PENALTY, ROUTE_PROJECT_COST,
} = require('../../catalog/sprints');

const SPRINT_TIER_BY_ID = byId(SPRINT_TIERS);

// Найвищий контракт, доступний на цьому рівні СХРОНУ (user.level, не playerLevel).
// null — гравець ще на схроні 1, де працює старий клікер і спринтів немає взагалі.
function sprintTierFor(level) {
    let best = null;
    for (const t of SPRINT_TIERS) if ((level || 1) >= t.minLevel) best = t;
    return best;
}

// Focus росте від ремапнутих бустерів (Р4), база 1. Ділимо, а не віднімаємо:
// інакше достатньо високий Focus зробив би вигорання від'ємним.
// resistMult — навичка «Стійкість до вигорання» (2026-08-16): <1 означає
// повільніший приріст вигорання за тап.
function burnoutPerTap(focusStat, resistMult) {
    return (BURNOUT_PER_TAP / Math.max(1, Number(focusStat) || 1)) * (Number(resistMult) || 1);
}

// Пасивне очищення рахуємо ліниво від мітки часу, а не таймером на кожного гравця
// (той самий підхід, що й decayHeat): відпочинок має працювати і поки гра закрита,
// інакше єдиною стратегією було б сидіти в застосунку й дивитись на смужку.
// decayMult — навичка «Гострий фокус» (2026-08-16): >1 означає швидший спад.
function decayBurnout(user, decayMult) {
    const now = Date.now();
    const last = user.lastBurnoutDecay || now;
    const stepMs = (BURNOUT_DECAY_SEC * 1000) / (Number(decayMult) || 1);
    const steps = Math.floor((now - last) / stepMs);
    if (steps <= 0) {
        if (!user.lastBurnoutDecay) user.lastBurnoutDecay = now;
        return 0;
    }
    // Час "з'їдаємо" повністю кроками, залишок лишаємо на наступний виклик —
    // інакше часте опитування стану ніколи не дотягувало б до цілого кроку.
    user.lastBurnoutDecay = last + steps * stepMs;
    const applied = Math.min(steps, user.burnout || 0);
    if (applied <= 0) return 0;
    user.burnout = Math.max(0, (user.burnout || 0) - applied);
    return applied;
}

// Скільки рядків коду дає один тап при поточному вигоранні. Поріг різкий, а не
// плавний, навмисно: гравець має ВІДЧУТИ момент, коли пора зупинитись.
function burnoutTapMult(burnout) {
    return (burnout || 0) >= BURNOUT_PENALTY_THRESHOLD ? BURNOUT_PENALTY_MULT : 1;
}

// Повна ставка за контракт: (тривалість_сек / 3600) × ставка тіру. Тривалість —
// це дедлайн контракту, а не фактично витрачений час: платити за фактичний час
// означало б карати гравця за швидке закриття спринту.
function sprintBasePayout(tier) {
    return Math.round((tier.deadlineMin / 60) * tier.ratePerHour);
}

// Нагорода конкретної спроби: ставка × частка написаних рядків × штраф за баги.
// Частка потрібна для здачі ПО ДЕДЛАЙНУ (див. /api/sprint/claim): без неї можна
// було б узяти Junior, нічого не робити 20 хвилин і забрати повну ставку.
function sprintPayout(sprint, tier) {
    if (!sprint || !tier) return 0;
    const progress = Math.max(0, Math.min(1, (sprint.linesDone || 0) / tier.taps));
    const qteMult = Math.max(0, 1 - QTE_MISS_PENALTY * (sprint.missedQte || 0));
    return Math.round(sprintBasePayout(tier) * progress * qteMult);
}

// Вікно реакції на баг. Бонус від "інструментів" (ремап Р4) приходить окремим
// заходом — тут уже стоїть стеля зі спеки, щоб потім не вигадувати число вдруге.
function qteWindowMs(bonusMs) {
    return Math.min(QTE_MAX_MS, QTE_BASE_MS + Math.max(0, Number(bonusMs) || 0));
}

// Прогрес проєкту маршруту (Р5): відсоток виконання рахуємо по СУМІ внесених
// одиниць проти сумарної вимоги, а не по мінімуму серед трьох ресурсів —
// приніс половину паперу й нічого іншого все одно рухає стрічку вперед,
// просто повільніше, ніж рівномірний внесок.
function routeProgressPct(user) {
    const contrib = user.routeContributions || {};
    let done = 0, total = 0;
    for (const [res, need] of Object.entries(ROUTE_PROJECT_COST)) {
        done += Math.min(need, contrib[res] || 0);
        total += need;
    }
    return total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
}

function routeProjectComplete(user) {
    const contrib = user.routeContributions || {};
    return Object.entries(ROUTE_PROJECT_COST).every(([res, need]) => (contrib[res] || 0) >= need);
}

// Прострочений баг = пропущений баг. Рахуємо це на сервері при будь-якому дотику
// до спринту, а не чекаємо на відповідь клієнта: інакше достатньо просто НЕ слати
// /api/sprint/qte, щоб жоден пропуск ніколи не зарахувався.
function settleExpiredQte(user) {
    const sprint = user.activeSprint;
    if (!sprint || !sprint.qte) return false;
    if (Date.now() - sprint.qte.at <= sprint.qte.ms) return false;
    sprint.qte = null;
    sprint.missedQte = (sprint.missedQte || 0) + 1;
    return true;
}

function sprintExpired(sprint) {
    return !!sprint && Date.now() >= sprint.deadline;
}

// Усе, що клієнту треба знати про спринти одним об'єктом: активний контракт,
// стан гравця і список тірів із позначкою, що вже відкрито рівнем схрону.
function sprintSnapshot(user) {
    const sprint = user.activeSprint;
    const tier = sprint ? SPRINT_TIER_BY_ID[sprint.tier] : null;
    return {
        sprint: sprint && tier ? {
            tier: sprint.tier, name: tier.name, emoji: tier.emoji,
            startedAt: sprint.startedAt, deadline: sprint.deadline,
            linesTotal: sprint.linesTotal, linesDone: Math.round((sprint.linesDone || 0) * 10) / 10,
            missedQte: sprint.missedQte || 0, energySpent: sprint.energySpent || 0,
            msLeft: Math.max(0, sprint.deadline - Date.now()),
            expired: sprintExpired(sprint),
            // Незакритий баг віддаємо клієнту, щоб він міг домалювати вікно після
            // перезаходу — таймер його все одно рахує сервер.
            qte: sprint.qte ? { at: sprint.qte.at, ms: sprint.qte.ms } : null,
            payout: sprintPayout(sprint, tier),
        } : null,
        cooldownUntil: (user.sprintCooldownUntil && user.sprintCooldownUntil > Date.now()) ? user.sprintCooldownUntil : 0,
        burnout: Math.round((user.burnout || 0) * 10) / 10,
        burnoutMax: BURNOUT_MAX,
        burnoutThreshold: BURNOUT_PENALTY_THRESHOLD,
        focusStat: user.focusStat || 1,
        routeProgress: routeProgressPct(user),
        routeContributions: user.routeContributions || { paper: 0, intel_data: 0, script: 0 },
        routeCost: ROUTE_PROJECT_COST,
        tiers: SPRINT_TIERS.map((t) => ({
            id: t.id, name: t.name, emoji: t.emoji, desc: t.desc,
            minLevel: t.minLevel, energyCost: t.energyCost, taps: t.taps,
            deadlineMin: t.deadlineMin, ratePerHour: t.ratePerHour,
            payout: sprintBasePayout(t), dropTable: t.dropTable,
            locked: (user.level || 1) < t.minLevel,
        })),
    };
}

module.exports = {
    SPRINT_TIER_BY_ID, sprintTierFor, burnoutPerTap, decayBurnout, burnoutTapMult,
    sprintBasePayout, sprintPayout, qteWindowMs, settleExpiredQte, sprintExpired, sprintSnapshot,
    routeProgressPct, routeProjectComplete, ROUTE_PROJECT_COST,
};
