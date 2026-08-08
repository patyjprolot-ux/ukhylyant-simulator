// Автоматично винесено з server.js (Фаза 4 модуляризації, 2026-08-08).
const { hasSkill } = require('./skills');

// «Друга нора» відкриває другий слот — тому вилазки живуть масивом.
function expeditionSlots(user) {
    return hasSkill(user, 'burrow') ? 2 : 1;
}

function expeditionSnapshot(user) {
    return {
        expeditions: user.expeditions || [],
        expeditionSlots: expeditionSlots(user),
        // Сумісність зі старим клієнтом і кодом, який читав одну вилазку.
        expedition: (user.expeditions || [])[0] || null,
    };
}

module.exports = { expeditionSlots, expeditionSnapshot };
