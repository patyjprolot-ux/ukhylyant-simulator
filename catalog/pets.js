// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.
// Редизайн (2026-08-21, PATCH_2.0_COMPANIONS_REDESIGN.md): "купив за ТК → +40%"
// замінено на "NPC → довіра → квест → приєднання". npcId прив'язує компаньйона
// до вже існуючого REPUTATION_NPCS (catalog/social.js) — купити можна лише
// після repMaxed(user, npcId) І виконання companionQuest того NPC
// (routes/misc.js: /api/npc/companion-quest/*, guard у /api/pet/buy).
// Бонуси урізані з 15-50% до 1-3%, ціни підняті ×4 — компаньйон тепер дрібна
// колекційна річ, не економічний важіль.
const PETS = [
    { id: 'neighbor', npcId: 'nina', name: 'Сусідка-пліткарка', img: '/images/pet-neighbor.webp', bg: '/images/pet-neighbor-bg.webp', price: 12000, desc: '-2% до шансу облави (попереджає завчасно)' },
    { id: 'goose', npcId: 'mykola', name: 'Бойовий Гусак', img: '/images/pet-goose.webp', bg: '/images/pet-goose-bg.webp', price: 32000, desc: '+2% до сили кліку' },
    { id: 'cat', npcId: 'oksana', name: 'Кіт-антистрес', img: '/images/pet-cat.webp', bg: '/images/pet-cat-bg.webp', price: 24000, desc: '+3% до швидкості відновлення енергії' },
    { id: 'dog', npcId: 'tolik', name: 'Двірняга-нюхач', img: '/images/pet-dog.webp', bg: '/images/pet-dog-bg.webp', price: 60000, desc: '+3% здобичі з вилазок (винюхує краще)' },
    { id: 'rat', npcId: 'tolik', name: 'Щур-розвідник', img: '/images/pet-rat.webp', bg: '/images/pet-rat-bg.webp', price: 100000, desc: '-3% до ризику спалитись на вилазці' },
    { id: 'pigeon', npcId: 'oksana', name: 'Голуб-курʼєр', emoji: '🕊️', bg: '/images/pet-pigeon-bg.webp', price: 160000, desc: 'Вилазки тривають на 2% менше часу, +2% шанс пройти чекпоінт' },
];

module.exports = { PETS };
