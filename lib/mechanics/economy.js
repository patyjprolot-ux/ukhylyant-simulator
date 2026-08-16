// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
const ECONOMY = require('../../catalog/economy');

const UPGRADE_BASE = {
    hat: ECONOMY.HAT_PRICE, jam: ECONOMY.JAM_PRICE,
    thermos: ECONOMY.THERMOS_PRICE, generator: ECONOMY.GENERATOR_PRICE,
};
const UPGRADE_BASE_EFFECT = {
    hat: ECONOMY.HAT_CLICK_BONUS, jam: ECONOMY.JAM_PASSIVE_BONUS,
    thermos: ECONOMY.THERMOS_CLICK_BONUS, generator: ECONOMY.GENERATOR_PASSIVE_BONUS,
};

// Гейти ешелонів: щоб купити рівень 11/21/31/…, мало заплатити ТК за сам рівень —
// треба ще "пробити" ешелон ресурсами. Індекс 0 = гейт у ешелон 1 (після рівня 10),
// індекс 1 = гейт у ешелон 2 (після 20) і т.д. Ешелон 6+ — остання таблиця ×1.6^(tier-5).
// coins із журналу = валюта (cash, тір 3), batt = battery, med = meds.
const TIER_GATES = {
    hat: [
        { paper: 10, tape: 8 },
        { paper: 24, tape: 18, scrap: 6 },
        { paper: 40, tape: 30, cash: 4 },
        { cash: 8, stamp: 3 },
        { cash: 16, stamp: 8, phone: 1 },
    ],
    jam: [
        { cans: 12, battery: 8 },
        { cans: 26, battery: 18, wood: 10 },
        { cans: 40, meds: 10, sausage: 8 },
        { cash: 8, stamp: 3 },
        { cash: 16, stamp: 8, phone: 1 },
    ],
    thermos: [
        { meds: 6, sausage: 6 },
        { meds: 14, sausage: 12, fuel: 8 },
        { meds: 24, fuel: 16, sim: 5 },
        { cash: 10, stamp: 4 },
        { cash: 20, stamp: 10, phone: 1 },
    ],
    generator: [
        { wood: 10, scrap: 8 },
        { wood: 24, scrap: 16, brick: 10 },
        { fuel: 20, scrap: 24, brick: 16 },
        { cash: 12, stamp: 5 },
        { cash: 24, stamp: 12, phone: 1 },
    ],
};
function upgTier(level) { return Math.floor(level / ECONOMY.TIER_SIZE); }
function upgInTier(level) { return level % ECONOMY.TIER_SIZE; }
// Ціна купівлі рівня (level+1), коли поточний (уже куплений) рівень = level.
// Аудит балансу (2026-08-13): стара формула рахувала tierCostMultCapped() від
// ЦІЛОГО номера ешелону, а IN_TIER_GROWTH^inTier — окремим множником зверху.
// На останньому рівні ешелону (inTier=9) цей множник ≈15×, а на першому рівні
// НОВОГО ешелону (inTier=0) стрибок між ешелонами за межею 5-го — лише ×1.6.
// Різниця 15 проти 1.6 означала провал ціни ×9.3 щоразу на переході 60/70/80…
// (саме це стояло за скаргою "6к→200М за день"). Виправлення: рахуємо ДРОБОВИЙ
// номер ешелону (level/TIER_SIZE) як єдиний неперервний степінь — IN_TIER_GROWTH
// більше не потрібен окремим множником, зростання гладке по визначенню, без
// стрибків вгору чи вниз. Понад ешелон 5 і далі зростання так само сповільнюється
// до ×1.6/ешелон, як і раніше — просто без розриву в точці переходу.
function tierCostMultCapped(tier) {
    const cap = 5;
    if (tier <= cap) return Math.pow(ECONOMY.TIER_COST_MULT, tier);
    return Math.pow(ECONOMY.TIER_COST_MULT, cap) * Math.pow(1.6, tier - cap);
}
function upgCost(base, level) {
    return Math.round(base * tierCostMultCapped(level / ECONOMY.TIER_SIZE));
}
// Скільки додає ОДИН рівень апгрейда, коли поточний (до купівлі) рівень = level.
function upgEffectPerLevel(baseEffect, level) {
    return baseEffect * Math.pow(ECONOMY.TIER_EFFECT_MULT, upgTier(level));
}
// Вартість ресурсів, щоб пробити ешелон tier (1-based: 1 = гейт після рівня 10).
function tierGateCost(key, tier) {
    const gates = TIER_GATES[key];
    if (tier <= gates.length) return gates[tier - 1];
    const last = gates[gates.length - 1];
    const mult = Math.pow(1.6, tier - gates.length);
    const scaled = {};
    for (const [res, qty] of Object.entries(last)) scaled[res] = Math.ceil(qty * mult);
    return scaled;
}
// Чи гейт потрібен ПРЯМО ЗАРАЗ (гравець стоїть рівно на межі ешелону, наступний
// рівень уже належить новому ешелону) і чи він уже пробитий.
function upgradeGateInfo(user, key) {
    const owned = (user.upgrades && user.upgrades[key]) || 0;
    if (owned === 0 || owned % ECONOMY.TIER_SIZE !== 0) return null;
    const tier = owned / ECONOMY.TIER_SIZE;
    const unlocked = (user.upgTiersUnlocked && user.upgTiersUnlocked[key]) || 0;
    if (unlocked >= tier) return null;
    return { tier, cost: tierGateCost(key, tier) };
}

// Ремап бустерів під Спринти (Р4, 2026-08-16) — hat+thermos дають Focus,
// jam+generator прискорюють відновлення вигорання. Чиста функція від поточних
// рівнів апгрейдів, тому перераховувати можна будь-де без ризику розсинхрону
// (на відміну від зберігання одного разу — тут нема що забути оновити).
function computeFocusStat(user) {
    const levels = ((user.upgrades && user.upgrades.hat) || 0) + ((user.upgrades && user.upgrades.thermos) || 0);
    return Math.min(ECONOMY.UPGRADE_FOCUS_CAP, 1 + levels * ECONOMY.UPGRADE_FOCUS_PER_LEVEL);
}
function upgradeBurnoutDecayBonus(user) {
    const levels = ((user.upgrades && user.upgrades.jam) || 0) + ((user.upgrades && user.upgrades.generator) || 0);
    return Math.min(ECONOMY.UPGRADE_BURNOUT_DECAY_CAP, 1 + levels * ECONOMY.UPGRADE_BURNOUT_DECAY_PER_LEVEL);
}

module.exports = {
    UPGRADE_BASE, UPGRADE_BASE_EFFECT, TIER_GATES,
    upgTier, upgInTier, tierCostMultCapped, upgCost, upgEffectPerLevel, tierGateCost, upgradeGateInfo,
    computeFocusStat, upgradeBurnoutDecayBonus,
};
