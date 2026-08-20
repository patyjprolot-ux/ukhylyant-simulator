// Реєстрація на закритий бета-тест (2026-08-19) — окрема публічна вкладка
// сайту (public/landing.html), НЕ пов'язана з Mini App і не потребує
// requireTelegramAuth (у відвідувача сайту немає Telegram initData — це
// звичайний браузер, не WebApp). Саме тому тут своя, окрема гігієна вводу:
// ендпоінт відкритий у публічний інтернет.
const fs = require('fs');
const path = require('path');

module.exports = function registerBetaRoutes(app, deps) {
    const { bot, OWNER_TELEGRAM_ID, DATA_DIR } = deps;
    const SIGNUPS_FILE = path.join(DATA_DIR, 'beta-signups.json');

    function loadSignups() {
        try {
            return JSON.parse(fs.readFileSync(SIGNUPS_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    function saveSignups(list) {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(SIGNUPS_FILE, JSON.stringify(list, null, 2));
        } catch (e) {
            console.error('Не вдалось зберегти заявки бета-тесту:', e.message);
        }
    }

    app.get('/beta', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
    });

    app.post('/api/beta/register', (req, res) => {
        // Honeypot: приховане поле форми. Людина його не бачить і не заповнює,
        // прості боти-заповнювачі часто заповнюють усе підряд — тихо відкидаємо,
        // не даючи зрозуміти боту, що саме його спіймали (fake success).
        if (req.body && req.body.website) {
            return res.json({ success: true });
        }

        const raw = String(req.body?.username || '').trim().replace(/^@/, '');
        if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(raw)) {
            return res.json({ success: false, message: 'Невалідний юзернейм Telegram (5-32 символи, латиниця/цифри/підкреслення, з літери).' });
        }
        const username = raw.toLowerCase();

        const signups = loadSignups();
        if (signups.some((s) => s.username === username)) {
            return res.json({ success: false, message: 'Цей юзернейм уже в списку — ми його бачимо, чекай повідомлення.' });
        }
        // Невеликий кап на розмір файлу — захист від флуду валідними на вигляд
        // юзернеймами (honeypot ловить примітивних ботів, не всіх).
        if (signups.length >= 5000) {
            return res.json({ success: false, message: 'Реєстрація тимчасово переповнена, спробуй пізніше.' });
        }

        signups.push({ username, at: Date.now() });
        saveSignups(signups);

        if (OWNER_TELEGRAM_ID) {
            bot.telegram.sendMessage(
                String(OWNER_TELEGRAM_ID),
                `📝 Нова заявка на бета-тест: @${username}\nВсього заявок: ${signups.length}`
            ).catch((e) => console.error('Не вдалось надіслати сповіщення про заявку:', e.message));
        }

        res.json({ success: true });
    });
};
