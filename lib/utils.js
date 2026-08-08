// Дрібні утиліти без залежностей від решти гри.

// Довідник "id -> запис" із порожнім прототипом. Це принципово: id приходять
// прямо з тіла запиту, і на звичайному об'єкті CATALOG['constructor'] повернув
// би функцію з Object.prototype — далі код читав би в неї .quests/.cost і падав
// у 500. З null-прототипом невідомий ключ завжди undefined.
function byId(list) {
    const map = Object.create(null);
    for (const item of list) map[item.id] = item;
    return map;
}

module.exports = { byId };
