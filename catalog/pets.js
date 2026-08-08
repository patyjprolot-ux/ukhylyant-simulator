// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const PETS = [
    { id: 'neighbor', name: 'Сусідка-пліткарка', img: '/images/pet-neighbor.webp', bg: '/images/pet-neighbor-bg.webp', price: 3000, desc: '-10% до шансу облави (попереджає завчасно)' },
    { id: 'goose', name: 'Бойовий Гусак', img: '/images/pet-goose.webp', bg: '/images/pet-goose-bg.webp', price: 8000, desc: '+15% до сили кліку' },
    { id: 'cat', name: 'Кіт-антистрес', img: '/images/pet-cat.webp', bg: '/images/pet-cat-bg.webp', price: 6000, desc: '+30% до швидкості відновлення енергії' },
    { id: 'dog', name: 'Двірняга-нюхач', img: '/images/pet-dog.webp', bg: '/images/pet-dog-bg.webp', price: 15000, desc: '+40% здобичі з вилазок (винюхує краще)' },
    { id: 'rat', name: 'Щур-розвідник', img: '/images/pet-rat.webp', bg: '/images/pet-rat-bg.webp', price: 25000, desc: '-50% до ризику спалитись на вилазці' },
    { id: 'pigeon', name: 'Голуб-курʼєр', emoji: '🕊️', bg: '/images/pet-pigeon-bg.webp', price: 40000, desc: 'Вилазки тривають на 25% менше часу' },
];

module.exports = { PETS };
