// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
const ECONOMY = require('../../catalog/economy');

function hasSkill(user, skillId) {
    return !!(user.skills && user.skills[skillId]);
}

function applySkillLimits(user) {
    // 'hardened' лишено для сумісності зі старими збереженнями (прибрано з
    // дерева 2026-08-16), 'sturdyback' — новий тир-2 замінник з меншим бонусом.
    const want = (hasSkill(user, 'hardened') ? ECONOMY.SKILL_MAX_ENERGY_BONUS : 0)
        + (hasSkill(user, 'sturdyback') ? ECONOMY.SKILL_STURDYBACK_MAX_ENERGY : 0);
    const had = user.skillEnergyBonus || 0;
    if (want !== had) {
        user.maxEnergy = Math.max(1, (user.maxEnergy || 100) + (want - had));
        user.skillEnergyBonus = want;
        if (user.energy > user.maxEnergy) user.energy = user.maxEnergy;
    }
    return user.maxEnergy;
}

module.exports = { hasSkill, applySkillLimits };
