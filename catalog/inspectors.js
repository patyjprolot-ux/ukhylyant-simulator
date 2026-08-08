// Автоматично винесено з server.js (Фаза 1 модуляризації, 2026-08-08). Чисті дані, без логіки.

const SYMPTOMS = [
    { id: 'ploskostopist', name: 'Плоскостопість 3 ступеня', emoji: '🦶', power: 45, weight: 12 },
    { id: 'skolioz', name: 'Сколіоз як у знака питання', emoji: '🦴', power: 50, weight: 11 },
    { id: 'alergiya', name: 'Алергія на камуфляж', emoji: '🤧', power: 35, weight: 12 },
    { id: 'tysk', name: 'Тиск 200 на 140 (виміряв сам)', emoji: '🩸', power: 40, weight: 12 },
    { id: 'zir', name: 'Мінус вісім (окуляри забув)', emoji: '👓', power: 42, weight: 12 },
    { id: 'panika', name: 'Панічні атаки в чергах', emoji: '😰', power: 55, weight: 9 },
    { id: 'sluh', name: 'Не чую, коли кличуть на імʼя', emoji: '👂', power: 38, weight: 12 },
    { id: 'sertse', name: 'Серце розбите (довідка від колишньої)', emoji: '💔', power: 25, weight: 12 },
    { id: 'gryzha', name: 'Грижа, яку видно тільки мені', emoji: '🩹', power: 48, weight: 10 },
    { id: 'hronichna', name: 'Хронічна втома від новин', emoji: '😵', power: 30, weight: 12 },
    { id: 'ruka', name: 'Рука не піднімається (принципово)', emoji: '🤲', power: 44, weight: 11 },
    { id: 'spravzhnye', name: 'Справжня медична карта', emoji: '📋', power: 90, weight: 1 },
];

const INSPECTORS = [
    {
        id: 'valik', emoji: '🧔', name: 'Валік Настирливий', hp: 3000,
        unlockHeat: 30, window: 90, weakness: 'bribe',
        weaknessHint: 'Бере на слабо тих, хто вже сьогодні "вирішував питання"',
        reward: { tk: 12000, res: { sim: 2 }, sp: 10 },
        taunt: '«Та я на хвилинку, документи глянути»',
    },
    {
        id: 'sanych', emoji: '🕶️', name: 'Санич Мовчазний', hp: 12000,
        unlockHeat: 50, window: 75, weakness: 'speed',
        weaknessHint: 'Ламається від напору: тримай 6+ кліків за секунду',
        reward: { tk: 45000, res: { stamp: 1 }, sp: 20 },
        taunt: '«...» (він просто дивиться)',
    },
    {
        id: 'lyuda', emoji: '💅', name: 'Люда з паспортного', hp: 40000,
        unlockHeat: 65, window: 60, weakness: 'charm',
        weaknessHint: 'Поважає солідних: вдягни щось дороге з гардеробу',
        reward: { tk: 150000, res: { cash: 10 }, sp: 35 },
        taunt: '«Молодой человек, вы в очереди последний?»',
    },
    {
        id: 'pivnyk', emoji: '🎖️', name: 'Генерал Півник', hp: 250000,
        unlockHeat: 85, window: 45, weakness: null, cooldownH: 7 * 24,
        // 250k HP за 45 секунд непрохідні, поки кліки в боях витрачають енергію:
        // повного бака вистачає на ~66 кліків. Це навмисний ендгейм-гейт за навичкою
        // "Марафонець" (Фаза 6), а не баг — тому бос показується заблокованим, а не
        // ховається зовсім.
        requiresSkill: 'marathon',
        lockedHint: 'Ти ще не в тій ваговій категорії. Потрібна навичка «Марафонець»',
        weaknessHint: 'Слабкостей немає. Тільки ти і твій палець',
        reward: { tk: 600000, res: { ticket: 1 }, sp: 50 },
        taunt: '«Я 30 років у системі. Ти — 30 хвилин у бункері»',
    },
];

const TROPHIES = [
    { id: 'detective', emoji: '🕵️', name: 'Вирахував стукача', desc: 'Розкрив того, хто на тебе доніс' },
    ...INSPECTORS.map((i) => ({ id: 'insp_' + i.id, emoji: i.emoji, name: 'Спекався: ' + i.name, desc: i.taunt })),
];

module.exports = { SYMPTOMS, INSPECTORS, TROPHIES };
