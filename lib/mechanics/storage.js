// Автоматично винесено з server.js (Фаза 4 модуляризації, 2026-08-08).
const ECONOMY = require('../../catalog/economy');
const { hasSkill } = require('./skills');
const { UPGRADE_BASE, upgCost, upgradeGateInfo } = require('./economy');

// ===== Кладовка: місткість, підрахунок, додавання ресурсів =====
function storageCapacity(user) {
    return ECONOMY.STORAGE_BASE_CAPACITY + (user.storageLevel || 0) * ECONOMY.STORAGE_CAPACITY_PER_LEVEL;
}

function storageUsed(user) {
    return Object.values(user.resources || {}).reduce((s, n) => s + (n || 0), 0);
}

function storageUpgradeCost(user) {
    return Math.round(ECONOMY.STORAGE_UPGRADE_BASE * Math.pow(ECONOMY.STORAGE_UPGRADE_GROWTH, user.storageLevel || 0));
}

// Додає ресурс із урахуванням ліміту складу. Повертає скільки реально влізло —
// надлишок згорає (і клієнт про це чесно повідомляє, щоб апгрейд кладовки мав сенс).
// bonus=false — для покупок на біржі: там ресурс не «здобутий», а оплачений, і
// нарахування зверху перетворило б цикл купив-продав на нескінченні гроші.
function addResource(user, resId, amount, { bonus = true } = {}) {
    // «Свої люди» — +25% здобичі, тому бонус тут, у єдиній точці нарахування,
    // а не в кожному ящику/вилазці окремо.
    if (bonus && hasSkill(user, 'ourpeople')) amount = Math.round(amount * (1 + ECONOMY.SKILL_RESOURCE_BONUS));
    const free = Math.max(0, storageCapacity(user) - storageUsed(user));
    const added = Math.min(free, amount);
    if (added > 0) {
        user.resources[resId] = (user.resources[resId] || 0) + added;
        user.resourcesCollected = (user.resourcesCollected || 0) + added;
        user.dailyResources = (user.dailyResources || 0) + added;
    }
    return { added, lost: amount - added };
}

function storageSnapshot(user) {
    return {
        resources: user.resources,
        storageLevel: user.storageLevel,
        capacity: storageCapacity(user),
        used: storageUsed(user),
        upgradeCost: user.storageLevel >= ECONOMY.STORAGE_MAX_LEVEL ? null : storageUpgradeCost(user),
        maxLevel: ECONOMY.STORAGE_MAX_LEVEL,
    };
}

// Скільки рівнів апгрейда гравець потягне за N спроб і скільки це коштує.
// maxLevels = Infinity означає "все, що по кишені". Ціна росте геометрично,
// тому просто множити ціну одного рівня не можна.
function upgradeBatchPlan(user, key, maxLevels) {
    let cost = 0;
    let levels = 0;
    const owned = user.upgrades[key] || 0;
    const unlocked = (user.upgTiersUnlocked && user.upgTiersUnlocked[key]) || 0;
    while (levels < maxLevels) {
        const current = owned + levels;
        // Межа ешелону, ще не пробита ресурсами — батч зупиняється тут (не купуємо
        // "в борг" і не автосписуємо ресурси мовчки, гравець тисне окрему кнопку гейта).
        if (current > 0 && current % ECONOMY.TIER_SIZE === 0 && unlocked < current / ECONOMY.TIER_SIZE) break;
        const next = upgCost(UPGRADE_BASE[key], current);
        if (cost + next > user.balance) break;
        cost += next;
        levels++;
        if (levels > 10000) break; // страховка від нескінченного циклу на величезному балансі
    }
    return { levels, cost };
}

// Ціна наступного рівня багаторівневого апгрейда магазину (null, якщо спочатку
// треба пробити ешелон — дивись upgradeGateInfo).
function upgradeCost(user, key) {
    if (upgradeGateInfo(user, key)) return null;
    const lvl = (user.upgrades && user.upgrades[key]) || 0;
    return upgCost(UPGRADE_BASE[key], lvl);
}

module.exports = {
    storageCapacity, storageUsed, storageUpgradeCost, addResource,
    storageSnapshot, upgradeBatchPlan, upgradeCost,
};
