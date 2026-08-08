// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const QUESTS = [
    { id: 'q_clicks', name: 'Розігрів', desc: 'Зроби 200 кліків сьогодні', target: 200, reward: 350, metric: 'dailyClicks' },
    { id: 'q_trade', name: 'Спекулянт', desc: 'Заверши 3 угоди на біржі сьогодні', target: 3, reward: 300, metric: 'dailyTrades' },
    { id: 'q_gacha', name: 'Розпакування', desc: 'Відкрий 2 ящики сьогодні', target: 2, reward: 400, metric: 'dailyBoxes' },
    { id: 'q_raid', name: 'Втікач', desc: 'Переживи 1 облаву сьогодні', target: 1, reward: 350, metric: 'dailyRaids' },
    { id: 'q_craft', name: 'Умілі руки', desc: 'Скрафти 1 предмет сьогодні', target: 1, reward: 600, metric: 'dailyCrafts' },
    { id: 'q_res', name: 'Мародер', desc: 'Назбирай 25 ресурсів сьогодні', target: 25, reward: 500, metric: 'dailyResources' },
    // Квести під механіки розширення: без них нові системи не мали щоденної причини
    // в них заходити, і гравець повертався б до тих самих кліків.
    { id: 'q_notice', name: 'Паперова робота', desc: 'Зніми 2 повістки сьогодні', target: 2, reward: 900, metric: 'dailyNotices' },
    { id: 'q_medcom', name: 'На прийом', desc: 'Пройди медкомісію сьогодні', target: 1, reward: 1200, metric: 'dailyMedcom' },
    { id: 'q_inspector', name: 'Небажаний гість', desc: 'Здихайся інспектора сьогодні', target: 1, reward: 2500, metric: 'dailyInspectors' },
    { id: 'q_expedition', name: 'Нічна зміна', desc: 'Заверши вилазку сьогодні', target: 1, reward: 800, metric: 'dailyExpeditions' },
];

module.exports = { QUESTS };
