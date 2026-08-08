// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
const ECONOMY = require('../../catalog/economy');

function repOf(user, npcId) { return (user.reputation || {})[npcId] || 0; }
function repMaxed(user, npcId) { return repOf(user, npcId) >= ECONOMY.REP_MAX; }

module.exports = { repOf, repMaxed };
