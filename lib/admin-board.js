// Дошка власника (2026-08-21) — задачі й нотатки просто в адмінці, щоб не
// тримати список "що ще зробити" в голові чи в чужому додатку. Той самий
// самодостатній патерн, що lib/complaints.js: власна пам'ять + власний
// JSON-файл, незалежний від usersDB/gamedata.json — збій тут не ризикує
// прогресом жодного гравця.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BOARD_FILE = path.join(DATA_DIR, 'admin-board.json');
const SAVE_INTERVAL_MS = 15000;

const TASK_STATUSES = ['todo', 'doing', 'done'];

/** @type {Map<string, object>} */
const tasksDB = new Map();
/** @type {Map<string, object>} */
const notesDB = new Map();

let seq = 0;
let dirty = false;

function makeId() {
    seq = (seq + 1) % 46656; // 36^3 — далі по колу, колізія неможлива в межах мс
    return 'b' + Date.now().toString(36) + seq.toString(36).padStart(3, '0');
}

function load() {
    try {
        if (!fs.existsSync(BOARD_FILE)) return;
        const parsed = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf-8'));
        (parsed.tasks || []).forEach((t) => { if (t && t.id) tasksDB.set(String(t.id), t); });
        (parsed.notes || []).forEach((n) => { if (n && n.id) notesDB.set(String(n.id), n); });
        console.log(`📋 Дошка: завантажено ${tasksDB.size} задач, ${notesDB.size} нотаток.`);
    } catch (e) {
        console.error('⚠️  Не вдалося прочитати дошку, стартую з порожньої:', e.message);
    }
}

function save() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const payload = {
            tasks: Array.from(tasksDB.values()),
            notes: Array.from(notesDB.values()),
            savedAt: Date.now(),
        };
        fs.writeFileSync(BOARD_FILE, JSON.stringify(payload, null, 2));
        dirty = false;
        return true;
    } catch (e) {
        console.error('⚠️  Не вдалося зберегти дошку:', e.message);
        return false;
    }
}

function flush() {
    if (!dirty) return false;
    return save();
}

// ===== Задачі =====
const MAX_TASK_LEN = 500;

function addTask(text) {
    const body = String(text == null ? '' : text).trim();
    if (!body) return { ok: false, message: 'Порожня задача — напиши, що треба зробити.' };
    if (body.length > MAX_TASK_LEN) {
        return { ok: false, message: `Задовго: ${body.length} символів, максимум ${MAX_TASK_LEN}.` };
    }
    const now = Date.now();
    const task = { id: makeId(), text: body, status: 'todo', createdAt: now, updatedAt: now };
    tasksDB.set(task.id, task);
    dirty = true;
    return { ok: true, task };
}

function setTaskStatus(id, status) {
    if (!TASK_STATUSES.includes(status)) return { ok: false, message: 'Невідомий статус' };
    const t = tasksDB.get(String(id));
    if (!t) return { ok: false, message: 'Такої задачі немає' };
    t.status = status;
    t.updatedAt = Date.now();
    dirty = true;
    return { ok: true, task: t };
}

function deleteTask(id) {
    const key = String(id);
    if (!tasksDB.has(key)) return { ok: false, message: 'Такої задачі немає' };
    tasksDB.delete(key);
    dirty = true;
    return { ok: true };
}

function listTasks() {
    // todo/doing перші (за часом створення), done — останні (щоб не муляли очі).
    const order = { todo: 0, doing: 1, done: 2 };
    return Array.from(tasksDB.values()).sort((a, b) => {
        const byStatus = order[a.status] - order[b.status];
        if (byStatus !== 0) return byStatus;
        return (a.createdAt || 0) - (b.createdAt || 0);
    });
}

// ===== Нотатки =====
const MAX_NOTE_TITLE_LEN = 120;
const MAX_NOTE_BODY_LEN = 8000;

function addNote(title, body) {
    const t = String(title == null ? '' : title).trim().slice(0, MAX_NOTE_TITLE_LEN) || 'Без назви';
    const b = String(body == null ? '' : body).trim().slice(0, MAX_NOTE_BODY_LEN);
    const now = Date.now();
    const note = { id: makeId(), title: t, body: b, createdAt: now, updatedAt: now };
    notesDB.set(note.id, note);
    dirty = true;
    return { ok: true, note };
}

function updateNote(id, title, body) {
    const n = notesDB.get(String(id));
    if (!n) return { ok: false, message: 'Такої нотатки немає' };
    if (title !== undefined) n.title = String(title).trim().slice(0, MAX_NOTE_TITLE_LEN) || 'Без назви';
    if (body !== undefined) n.body = String(body).trim().slice(0, MAX_NOTE_BODY_LEN);
    n.updatedAt = Date.now();
    dirty = true;
    return { ok: true, note: n };
}

function deleteNote(id) {
    const key = String(id);
    if (!notesDB.has(key)) return { ok: false, message: 'Такої нотатки немає' };
    notesDB.delete(key);
    dirty = true;
    return { ok: true };
}

function listNotes() {
    return Array.from(notesDB.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

load();

const saveTimer = setInterval(flush, SAVE_INTERVAL_MS);
if (typeof saveTimer.unref === 'function') saveTimer.unref();
process.on('exit', () => { try { flush(); } catch (e) { /* процес уже гасне */ } });

module.exports = {
    addTask, setTaskStatus, deleteTask, listTasks, TASK_STATUSES,
    addNote, updateNote, deleteNote, listNotes,
    flush, save, BOARD_FILE,
};
