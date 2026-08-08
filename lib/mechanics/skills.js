// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
const ECONOMY = require('../../catalog/economy');

function hasSkill(user, skillId) {
    return !!(user.skills && user.skills[skillId]);
}

function applySkillLimits(user) {
    const want = hasSkill(user, 'hardened') ? ECONOMY.SKILL_MAX_ENERGY_BONUS : 0;
    const had = user.skillEnergyBonus || 0;
    if (want !== had) {
        user.maxEnergy = Math.max(1, (user.maxEnergy || 100) + (want - had));
        user.skillEnergyBonus = want;
        if (user.energy > user.maxEnergy) user.energy = user.maxEnergy;
    }
    return user.maxEnergy;
}

module.exports = { hasSkill, applySkillLimits };
