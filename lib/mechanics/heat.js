// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
const ECONOMY = require('../../catalog/economy');
const { HEAT_TIERS } = require('../../catalog/heat');
const { hasSkill } = require('./skills');
const { repMaxed } = require('./reputation');

function heatTierOf(heat) {
    const h = Math.max(0, Math.min(ECONOMY.HEAT_MAX, heat || 0));
    return HEAT_TIERS.find((t) => h <= t.max) || HEAT_TIERS[HEAT_TIERS.length - 1];
}

function heatIncomeMult(user) { return heatTierOf(user.heat).incomeMult; }
function heatRaidMult(user) { return heatTierOf(user.heat).raidMult; }

// Єдина точка зміни heat — щоб кожна подія потрапила в лог "Твоєї справи" і щоб
// компаньйон-пліткарка гасив приріст в одному місці, а не в кожному виклику.
function changeHeat(user, delta, reason) {
    if (!delta) return 0;
    // Поки діє відстрочка, розшук НЕ РОСТЕ (спад працює). Це і є ціна безпеки:
    // за два тижні "Помічника депутата" heat падає до нуля разом із множником
    // доходу. Не "виправляй" це — на трейд-офі тримається вся Система 1.
    if (delta > 0 && (user.deferUntil || 0) > Date.now()) return 0;
    if (delta > 0 && user.petId === 'neighbor') delta *= ECONOMY.HEAT_NEIGHBOR_MULT;
    if (delta > 0 && hasSkill(user, 'quiet')) delta *= (1 - ECONOMY.SKILL_HEAT_GAIN_CUT);
    // Оксана замовила за тебе слівце — про тебе згадують рідше.
    if (delta > 0 && repMaxed(user, 'oksana')) delta *= (1 - ECONOMY.REP_OKSANA_HEAT_CUT);
    const before = user.heat || 0;
    const after = Math.max(0, Math.min(ECONOMY.HEAT_MAX, before + delta));
    user.heat = after;
    const applied = Math.round((after - before) * 10) / 10;
    if (applied !== 0 && reason) {
        user.heatLog.unshift({ t: Date.now(), delta: applied, reason });
        if (user.heatLog.length > ECONOMY.HEAT_LOG_SIZE) user.heatLog.length = ECONOMY.HEAT_LOG_SIZE;
    }
    return applied;
}

// Згасання рахується ліниво від lastHeatDecay, а не таймером на кожного гравця:
// про тебе забувають і поки гра закрита. Денний кап не дає "залягти на тиждень"
// і повернутись із чистою репутацією — забування має бути повільнішим за життя.
function decayHeat(user) {
    const now = Date.now();
    const last = user.lastHeatDecay || now;
    // «Привид району» не прискорює час, а подвоює те, що встигло списатись за
    // кожен крок — інакше довелось би окремо пересувати lastHeatDecay.
    const perStep = hasSkill(user, 'ghost') ? ECONOMY.SKILL_DECAY_MULT : 1;
    const steps = Math.floor((now - last) / (ECONOMY.HEAT_DECAY_MINUTES * 60000)) * perStep;
    if (steps <= 0) return 0;

    // Час "з'їдаємо" повністю, навіть якщо впираємось у денний кап — інакше залишок
    // накопичився б і назавтра миттєво обнулив увесь heat.
    user.lastHeatDecay = last + (steps / perStep) * ECONOMY.HEAT_DECAY_MINUTES * 60000;

    const today = new Date().toDateString();
    if (user.heatDecayDate !== today) { user.heatDecayDate = today; user.heatDecayToday = 0; }
    const allowed = Math.max(0, ECONOMY.HEAT_DECAY_DAILY_CAP - (user.heatDecayToday || 0));
    const applied = Math.min(steps, allowed, user.heat || 0);
    if (applied <= 0) return 0;
    user.heat = Math.max(0, (user.heat || 0) - applied);
    user.heatDecayToday = (user.heatDecayToday || 0) + applied;
    return applied;
}

module.exports = { heatTierOf, heatIncomeMult, heatRaidMult, changeHeat, decayHeat };
