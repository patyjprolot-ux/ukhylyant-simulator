// Адмін-панель власника бота + книга скарг і пропозицій (2026-08-15).
// Авторизація рівно та сама, що вже працює для /api/admin/backup і
// /api/admin/broadcast у server.js: заголовок x-admin-token звіряється з
// BOT_TOKEN. Окремого секрету не заводимо навмисно — токен бота і так знає
// тільки власник, а зайвий секрет це ще одне місце, де можна нашкодити.
//
// Саму розсилку тут НЕ дублюємо: вона вже є в server.js
// (POST /api/admin/broadcast). Тут лише "попередній перегляд" — щоб перед
// незворотною дією на живих людях було видно, скільки їх і хто вони.
const fs = require('fs');
const path = require('path');
const board = require('../lib/admin-board');

module.exports = function registerAdminRoutes(app, deps) {
    const {
        ADMIN_PASSWORD, usersDB, clansDB, requireTelegramAuth, getUser, displayName,
        complaints, LOCATIONS, paymentLog, DATA_DIR, timingSafeStringEqual,
        // Необовʼязкові: якщо передані — власник отримає пуш про нову скаргу.
        sendPush, OWNER_TELEGRAM_ID,
    } = deps;

    // Той самий метод перевірки, що і в server.js. Виніс у мідлвар, щоб
    // випадково не забути його на новому ендпоінті — забути один if легко,
    // забути аргумент у app.get() помітно одразу.
    // Пароль адмінки (2026-08-16) — окремий секрет від BOT_TOKEN, щоб витік
    // одного не давав автоматично доступ до іншого. Звірка timing-safe
    // (аудит безпеки 2026-08-21, server.js: timingSafeStringEqual).
    function requireAdmin(req, res, next) {
        if (!ADMIN_PASSWORD || !timingSafeStringEqual(req.get('x-admin-token') || '', ADMIN_PASSWORD)) {
            return res.status(403).json({ error: 'forbidden' });
        }
        next();
    }

    // ==========================================
    // Сторінка адмінки
    // ==========================================
    // express.static у проєкті роздає ТІЛЬКИ /images, тож public/admin.html сам
    // по собі недосяжний — віддаємо його явно звідси. Сторінка не містить
    // жодних секретів (токен вводить власник руками й тримає в sessionStorage),
    // тому сам HTML не під токеном: інакше його нічим було б відкрити.
    app.get('/admin', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });

    // ==========================================
    // Зведена статистика
    // ==========================================
    app.get('/api/admin/stats', requireAdmin, (req, res) => {
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        let totalBalance = 0;
        let active24h = 0;
        let active7d = 0;
        let vips = 0;
        let adConsent = 0;
        const levels = {}; // рівень схрону -> скільки гравців

        for (const u of usersDB.values()) {
            totalBalance += Number(u.balance) || 0;
            const seen = Number(u.lastSeenAt) || 0;
            if (now - seen < DAY) active24h++;
            if (now - seen < 7 * DAY) active7d++;
            if (u.isVip) vips++;
            if (u.adConsent === true) adConsent++;
            const lvl = Number(u.level) || 1;
            levels[lvl] = (levels[lvl] || 0) + 1;
        }

        // Назви локацій поруч із номером рівня — щоб не тримати в голові,
        // що "рівень 4" це "Хатина в лісі".
        const levelRows = Object.keys(levels)
            .map(Number).sort((a, b) => a - b)
            .map((lvl) => ({
                level: lvl,
                name: (LOCATIONS || []).find((l) => l.level === lvl)?.name || `Рівень ${lvl}`,
                count: levels[lvl],
            }));

        const cs = complaints.complaintStats();
        res.json({
            players: usersDB.size,
            clans: clansDB.size,
            totalBalance,
            active24h,
            active7d,
            vips,
            adConsent,
            levels: levelRows,
            complaints: { new: cs.byStatus.new, total: cs.total, last24h: cs.last24h },
            now,
        });
    });

    // ==========================================
    // Стан сервера (моніторинг працездатності)
    // ==========================================
    // Той самий процес, що обслуговує гру: якщо цей ендпоінт відповідає — сервер
    // живий. uptime/memory дають ранній сигнал про витік пам'яті чи завислий
    // процес ще до того, як гравці почнуть скаржитись, що гра "лагає".
    const serverStartedAt = Date.now();
    app.get('/api/admin/health', requireAdmin, (req, res) => {
        const mem = process.memoryUsage();
        res.json({
            ok: true,
            uptimeSec: Math.round(process.uptime()),
            startedAt: serverStartedAt,
            nodeVersion: process.version,
            memory: {
                rssMb: Math.round(mem.rss / 1024 / 1024),
                heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            },
            players: usersDB.size,
            clans: clansDB.size,
            now: Date.now(),
        });
    });

    // ==========================================
    // Гравці, що погодились на рекламні повідомлення в чаті
    // ==========================================
    // Окремий список, не лише лічильник зі /stats — щоб можна було звірити,
    // кому конкретно можна писати рекламні розсилки (AD_CONSENT_BONUS-гілка).
    app.get('/api/admin/ad-consent', requireAdmin, (req, res) => {
        const list = Array.from(usersDB.values())
            .filter((u) => u.adConsent === true)
            .map((u) => ({
                id: u.id,
                name: displayName ? displayName(u) : (u.name || 'Ухилянт'),
                lastSeenAt: Number(u.lastSeenAt) || 0,
            }))
            .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
        res.json({ count: list.length, players: list });
    });

    // ==========================================
    // Мікротранзакції й донати
    // ==========================================
    // paymentLog веде server.js (bot.on('successful_payment', ...)) — тут лише
    // читаємо. Не персистентний навмисно: це огляд "що щойно купили", а не
    // бухгалтерія — реальний облік Stars лишається на стороні Telegram.
    app.get('/api/admin/payments', requireAdmin, (req, res) => {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
        const log = paymentLog || [];
        const totalStars = log.reduce((sum, p) => sum + (Number(p.stars) || 0), 0);
        const donateStars = log.filter((p) => p.type === 'donate').reduce((sum, p) => sum + (Number(p.stars) || 0), 0);
        res.json({ payments: log.slice(0, limit), totalStars, donateStars, count: log.length });
    });

    // ==========================================
    // Гравці (пагінація + сортування)
    // ==========================================
    // Telegram id тут показуємо: це панель власника, і без id неможливо ні
    // написати гравцю, ні звірити його зі скаргою. Але в консоль його НЕ
    // пишемо — логи живуть довше й читаються ширше, ніж один HTTP-респонс.
    const SORTABLE = {
        balance: (u) => Number(u.balance) || 0,
        level: (u) => Number(u.level) || 1,
        playerLevel: (u) => Number(u.playerLevel) || 1,
        lastSeenAt: (u) => Number(u.lastSeenAt) || 0,
        ukhyr: (u) => Number(u.ukhyr) || 0,
        name: (u) => String(displayName ? displayName(u) : u.name || '').toLowerCase(),
    };

    app.get('/api/admin/players', requireAdmin, (req, res) => {
        const sortKey = SORTABLE[req.query.sort] ? req.query.sort : 'balance';
        const dir = req.query.dir === 'asc' ? 1 : -1;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const q = String(req.query.q || '').trim().toLowerCase();

        let list = Array.from(usersDB.values());
        if (q) {
            list = list.filter((u) => {
                const nm = String(displayName ? displayName(u) : u.name || '').toLowerCase();
                return nm.includes(q) || String(u.id).includes(q) || String(u.nickname || '').toLowerCase().includes(q);
            });
        }

        const pick = SORTABLE[sortKey];
        const cmp = sortKey === 'name'
            ? (a, b) => String(pick(a)).localeCompare(String(pick(b)), 'uk') * dir
            : (a, b) => (pick(a) - pick(b)) * dir;
        list.sort(cmp);

        const total = list.length;
        const pages = Math.max(1, Math.ceil(total / limit));
        const slice = list.slice((page - 1) * limit, (page - 1) * limit + limit);

        res.json({
            total, page, pages, limit, sort: sortKey, dir: dir === 1 ? 'asc' : 'desc',
            players: slice.map((u) => ({
                id: u.id,
                pid: u.pid || null,
                name: displayName ? displayName(u) : (u.name || 'Ухилянт'),
                nickname: u.nickname || null,
                level: Number(u.level) || 1,
                playerLevel: Number(u.playerLevel) || 1,
                balance: Number(u.balance) || 0,
                ukhyr: Number(u.ukhyr) || 0,
                isVip: !!u.isVip,
                lastSeenAt: Number(u.lastSeenAt) || 0,
                clanId: u.clanId || null,
            })),
        });
    });

    // ==========================================
    // Книга скарг і пропозицій
    // ==========================================
    app.get('/api/admin/complaints', requireAdmin, (req, res) => {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
        const list = complaints.listComplaints({
            status: req.query.status || undefined,
            kind: req.query.kind || undefined,
            limit,
        });
        res.json({ complaints: list, stats: complaints.complaintStats() });
    });

    app.post('/api/admin/complaints/:id/status', requireAdmin, (req, res) => {
        const status = String(req.body?.status || '').trim();
        const r = complaints.setStatus(req.params.id, status);
        if (!r.ok) return res.status(400).json({ success: false, message: r.message });
        complaints.flush(); // ручна дія адміна — фіксуємо одразу, не чекаючи інтервалу
        res.json({ success: true, complaint: r.complaint });
    });

    app.delete('/api/admin/complaints/:id', requireAdmin, (req, res) => {
        const r = complaints.deleteComplaint(req.params.id);
        if (!r.ok) return res.status(404).json({ success: false, message: r.message });
        complaints.flush();
        res.json({ success: true });
    });

    // ==========================================
    // Попередній перегляд розсилки
    // ==========================================
    // Розсилка — незворотна дія на живих людях. Цей ендпоінт нічого не
    // надсилає, лише відповідає "скільком піде і як це виглядатиме", щоб
    // власник не тиснув "Надіслати всім" наосліп.
    app.post('/api/admin/broadcast-preview', requireAdmin, (req, res) => {
        const message = String(req.body?.message || '').trim();
        if (!message) return res.status(400).json({ error: 'no message' });

        const all = Array.from(usersDB.values());
        // Активні за 7 днів — окремо: якщо з 200 гравців живих 12, це варто
        // побачити ДО того, як напишеш "усім" довгий текст.
        const DAY = 24 * 60 * 60 * 1000;
        const now = Date.now();
        const active7d = all.filter((u) => now - (Number(u.lastSeenAt) || 0) < 7 * DAY).length;

        res.json({
            recipients: all.length,
            active7d,
            sampleIds: all.slice(0, 3).map((u) => String(u.id)),
            sampleNames: all.slice(0, 3).map((u) => (displayName ? displayName(u) : u.name || 'Ухилянт')),
            length: message.length,
            preview: message.slice(0, 400),
        });
    });

    // ==========================================
    // Заявки на закритий бета-тест (public/landing.html → /api/beta/register)
    // ==========================================
    // Той самий файл, куди пише routes/beta.js. Читаємо тут, а не тримаємо
    // окрему копію в пам'яті — щоб не було двох джерел правди про заявки.
    // Це запасний канал бачити нові заявки: Telegram-пуш власнику (routes/beta.js)
    // працює лише якщо в .env заданий OWNER_TELEGRAM_ID, а адмінка працює завжди.
    const BETA_SIGNUPS_FILE = path.join(DATA_DIR, 'beta-signups.json');
    function loadBetaSignups() {
        try {
            return JSON.parse(fs.readFileSync(BETA_SIGNUPS_FILE, 'utf8'));
        } catch (e) { return []; }
    }
    function saveBetaSignups(list) {
        fs.writeFileSync(BETA_SIGNUPS_FILE, JSON.stringify(list, null, 2));
    }

    app.get('/api/admin/beta-signups', requireAdmin, (req, res) => {
        const list = loadBetaSignups().slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
        res.json({ count: list.length, signups: list });
    });

    // Видалення заявки (напр. тестові записи чи прохання видалити свої дані).
    // Юзернейм — унікальний ключ у цьому файлі (перевіряється при реєстрації).
    app.delete('/api/admin/beta-signups/:username', requireAdmin, (req, res) => {
        const username = String(req.params.username || '').toLowerCase();
        const list = loadBetaSignups();
        const next = list.filter((s) => s.username !== username);
        if (next.length === list.length) {
            return res.status(404).json({ success: false, message: 'Заявку не знайдено.' });
        }
        saveBetaSignups(next);
        res.json({ success: true });
    });

    // ==========================================
    // Дошка власника: задачі й нотатки
    // ==========================================
    app.get('/api/admin/board', requireAdmin, (req, res) => {
        res.json({ tasks: board.listTasks(), notes: board.listNotes() });
    });

    app.post('/api/admin/tasks', requireAdmin, (req, res) => {
        const r = board.addTask(req.body?.text);
        if (!r.ok) return res.status(400).json({ success: false, message: r.message });
        board.flush(); // ручна дія адміна — фіксуємо одразу, не чекаючи інтервалу
        res.json({ success: true, task: r.task });
    });

    app.post('/api/admin/tasks/:id/status', requireAdmin, (req, res) => {
        const r = board.setTaskStatus(req.params.id, String(req.body?.status || ''));
        if (!r.ok) return res.status(400).json({ success: false, message: r.message });
        board.flush();
        res.json({ success: true, task: r.task });
    });

    app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
        const r = board.deleteTask(req.params.id);
        if (!r.ok) return res.status(404).json({ success: false, message: r.message });
        board.flush();
        res.json({ success: true });
    });

    app.post('/api/admin/notes', requireAdmin, (req, res) => {
        const r = board.addNote(req.body?.title, req.body?.body);
        board.flush();
        res.json({ success: true, note: r.note });
    });

    app.post('/api/admin/notes/:id', requireAdmin, (req, res) => {
        const r = board.updateNote(req.params.id, req.body?.title, req.body?.body);
        if (!r.ok) return res.status(404).json({ success: false, message: r.message });
        board.flush();
        res.json({ success: true, note: r.note });
    });

    app.delete('/api/admin/notes/:id', requireAdmin, (req, res) => {
        const r = board.deleteNote(req.params.id);
        if (!r.ok) return res.status(404).json({ success: false, message: r.message });
        board.flush();
        res.json({ success: true });
    });

    // ==========================================
    // Ендпоінт для ГРАВЦЯ (не адмінський)
    // ==========================================
    // Гравець надсилає скаргу або пропозицію прямо з гри. Авторизація —
    // звичайний requireTelegramAuth, тобто id береться з підписаного initData,
    // а не з тіла запиту: інакше можна було б писати скарги від чужого імені.
    app.post('/api/complaint', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const r = complaints.addComplaint({
            userId: user.id,
            userName: displayName ? displayName(user) : (user.name || 'Ухилянт'),
            text: req.body?.text,
            kind: req.body?.kind,
        });
        if (!r.ok) return res.json({ success: false, message: r.message, reason: r.reason });
        complaints.flush();

        // Ping власнику, якщо налаштований: сенс книги скарг у тестуванні —
        // швидко дізнатись про баг, а не побачити його через тиждень в адмінці.
        if (OWNER_TELEGRAM_ID && typeof sendPush === 'function') {
            const label = r.complaint.kind === 'idea' ? '💡 Пропозиція' : '🐞 Баг';
            sendPush(OWNER_TELEGRAM_ID, `${label} від ${r.complaint.userName}:\n\n${r.complaint.text.slice(0, 500)}`);
        }

        res.json({
            success: true,
            id: r.complaint.id,
            message: r.complaint.kind === 'idea'
                ? 'Пропозицію записано. Дякую — саме з цього й будується гра.'
                : 'Скаргу записано. Розробник побачить її в книзі скарг.',
        });
    });
};
