// Книга скарг і пропозицій (2026-08-15).
// Самодостатнє сховище: власна Map у пам'яті + власний JSON-файл у тій самій
// теці даних, що й gamedata.json. Навмисно НЕ чіпає usersDB/saveData із
// lib/user-store.js — скарги живуть окремим життям, і збій/розростання книги
// скарг не має ризикувати основним збереженням прогресу гравців.
//
// Формат зберігання свідомо простий (JSON-масив), бо це гра для друзів:
// сотні записів, а не мільйони. Коли/якщо стане тісно — тут буде очевидне
// місце, куди підставити справжню БД, і решта коду не зміниться.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const COMPLAINTS_FILE = path.join(DATA_DIR, 'complaints.json');

// Ліміти. Причина не в продуктивності, а в людях: один тестер під емоціями
// здатен за хвилину наспамити три десятки однакових повідомлень, і тоді
// книга скарг перестає бути читабельною саме тоді, коли вона найпотрібніша.
const MAX_TEXT_LEN = 2000;      // символів на одну скаргу
const DAILY_LIMIT_PER_USER = 5; // скарг на гравця за 24 години
const DAY_MS = 24 * 60 * 60 * 1000;
const SAVE_INTERVAL_MS = 15000;

const KINDS = ['bug', 'idea'];
const STATUSES = ['new', 'read', 'done'];

/** @type {Map<string, object>} id -> скарга */
const complaintsDB = new Map();
/** @type {Map<string, number[]>} userId -> таймстемпи скарг за останню добу */
const rateLog = new Map();

let seq = 0;   // хвіст id, щоб дві скарги в одну мілісекунду не збіглись
let dirty = false;

// Id читабельний і сортується за часом створення (base36 від Date.now()).
function makeId() {
    seq = (seq + 1) % 46656; // 36^3 — далі просто йде по колу, колізія неможлива в межах мс
    return `c${Date.now().toString(36)}${seq.toString(36).padStart(3, '0')}`;
}

// Викидає з лічильника все, що старше доби. Робимо це ліниво (при перевірці/
// записі), а не по таймеру — гравців мало, а зайвий інтервал це зайвий стан.
function trimRate(userId, now) {
    const list = (rateLog.get(userId) || []).filter((t) => now - t < DAY_MS);
    if (list.length) rateLog.set(userId, list);
    else rateLog.delete(userId);
    return list;
}

function load() {
    try {
        if (!fs.existsSync(COMPLAINTS_FILE)) return;
        const parsed = JSON.parse(fs.readFileSync(COMPLAINTS_FILE, 'utf-8'));
        (parsed.complaints || []).forEach((c) => {
            if (c && c.id) complaintsDB.set(String(c.id), c);
        });
        // Ліміт відновлюємо з самих скарг, а не з окремого збереженого лічильника:
        // так неможливо розсинхронізувати ці дві речі при ручному редагуванні файлу.
        const now = Date.now();
        for (const c of complaintsDB.values()) {
            if (!c.userId || now - (c.createdAt || 0) >= DAY_MS) continue;
            const list = rateLog.get(String(c.userId)) || [];
            list.push(c.createdAt);
            rateLog.set(String(c.userId), list);
        }
        console.log(`📝 Книга скарг: завантажено ${complaintsDB.size} записів.`);
    } catch (e) {
        console.error('⚠️  Не вдалося прочитати книгу скарг, стартую з порожньої:', e.message);
    }
}

function save() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const payload = { complaints: Array.from(complaintsDB.values()), savedAt: Date.now() };
        fs.writeFileSync(COMPLAINTS_FILE, JSON.stringify(payload));
        dirty = false;
        return true;
    } catch (e) {
        console.error('⚠️  Не вдалося зберегти книгу скарг:', e.message);
        return false;
    }
}

// Пише на диск тільки коли реально щось змінилось — книга скарг оновлюється
// рідко, і крутити зайвий writeFileSync кожні 15с сенсу немає.
function flush() {
    if (!dirty) return false;
    return save();
}

/**
 * Додати скаргу/пропозицію.
 * @returns {{ok: true, complaint: object} | {ok: false, message: string, reason: string}}
 */
function addComplaint({ userId, userName, text, kind }) {
    const uid = String(userId || '').trim();
    if (!uid) return { ok: false, reason: 'no_user', message: 'Невідомо, хто пише.' };

    const body = String(text == null ? '' : text).trim();
    if (!body) return { ok: false, reason: 'empty', message: 'Порожнє повідомлення — напиши, що саме сталося.' };
    if (body.length > MAX_TEXT_LEN) {
        return {
            ok: false, reason: 'too_long',
            message: `Забагато тексту: ${body.length} символів, максимум ${MAX_TEXT_LEN}. Стисни думку.`,
        };
    }

    const now = Date.now();
    const recent = trimRate(uid, now);
    if (recent.length >= DAILY_LIMIT_PER_USER) {
        // Показуємо, коли саме звільниться слот, — інакше ліміт виглядає як баг.
        const freeAt = Math.min(...recent) + DAY_MS;
        const hoursLeft = Math.max(1, Math.ceil((freeAt - now) / 3600000));
        return {
            ok: false, reason: 'rate_limited',
            message: `Ліміт ${DAILY_LIMIT_PER_USER} повідомлень на добу вичерпано. Наступне можна буде надіслати за ~${hoursLeft} год.`,
        };
    }

    const complaint = {
        id: makeId(),
        userId: uid,
        userName: String(userName || 'Ухилянт').slice(0, 64),
        kind: KINDS.includes(kind) ? kind : 'bug',
        text: body,
        status: 'new',
        createdAt: now,
        updatedAt: now,
    };
    complaintsDB.set(complaint.id, complaint);
    recent.push(now);
    rateLog.set(uid, recent);
    dirty = true;
    return { ok: true, complaint };
}

/**
 * Список скарг, найновіші першими.
 * @param {{status?: string, kind?: string, limit?: number}} opts
 */
function listComplaints({ status, kind, limit } = {}) {
    let list = Array.from(complaintsDB.values());
    if (status && STATUSES.includes(status)) list = list.filter((c) => c.status === status);
    if (kind && KINDS.includes(kind)) list = list.filter((c) => c.kind === kind);
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const n = Number(limit);
    if (Number.isFinite(n) && n > 0) list = list.slice(0, Math.min(n, 500));
    return list;
}

function getComplaint(id) {
    return complaintsDB.get(String(id)) || null;
}

function setStatus(id, status) {
    if (!STATUSES.includes(status)) return { ok: false, message: 'Невідомий статус' };
    const c = complaintsDB.get(String(id));
    if (!c) return { ok: false, message: 'Такого запису немає' };
    c.status = status;
    c.updatedAt = Date.now();
    dirty = true;
    return { ok: true, complaint: c };
}

function deleteComplaint(id) {
    const key = String(id);
    if (!complaintsDB.has(key)) return { ok: false, message: 'Такого запису немає' };
    complaintsDB.delete(key);
    dirty = true;
    // Слот денного ліміту навмисно НЕ повертаємо: видалення адміном — це реакція
    // на спам, і повертати спамеру квоту було б прямо навпаки корисному.
    return { ok: true };
}

function complaintStats() {
    const byStatus = { new: 0, read: 0, done: 0 };
    const byKind = { bug: 0, idea: 0 };
    const now = Date.now();
    let last24h = 0;
    for (const c of complaintsDB.values()) {
        if (byStatus[c.status] !== undefined) byStatus[c.status]++;
        if (byKind[c.kind] !== undefined) byKind[c.kind]++;
        if (now - (c.createdAt || 0) < DAY_MS) last24h++;
    }
    return { total: complaintsDB.size, byStatus, byKind, last24h, authors: rateLog.size };
}

load();

// Власний інтервал автозбереження (незалежний від setInterval(saveData) у server.js).
// unref() — щоб цей модуль ніколи не тримав процес живим сам по собі: тести,
// скрипти й харнеси мають завершуватись, а не висіти через наш таймер.
const saveTimer = setInterval(flush, SAVE_INTERVAL_MS);
if (typeof saveTimer.unref === 'function') saveTimer.unref();

// Останній шанс зберегти незаписані скарги при штатному завершенні. Тільки
// синхронний запис — асинхронний на 'exit' не встигне виконатись.
process.on('exit', () => { try { flush(); } catch (e) { /* процес уже гасне */ } });

module.exports = {
    addComplaint, listComplaints, getComplaint, setStatus, deleteComplaint, complaintStats,
    flush, save, COMPLAINTS_FILE, MAX_TEXT_LEN, DAILY_LIMIT_PER_USER, KINDS, STATUSES,
    // Тільки для тестів/харнесу: повне очищення пам'яті без запису на диск.
    _resetForTests() { complaintsDB.clear(); rateLog.clear(); dirty = false; },
};
