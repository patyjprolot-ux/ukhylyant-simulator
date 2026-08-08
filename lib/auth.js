const crypto = require('crypto');

// ==========================================
// Перевірка підпису Telegram WebApp (initData)
// Захищає API від підробки чужого id: без цього будь-хто міг би дзвонити
// /api/save, /api/invoice тощо з чужим Telegram id і красти чужий прогрес/оплати.
// Алгоритм офіційний: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
// ==========================================
function verifyInitData(initData, botToken, maxAgeSeconds = 86400) {
    if (!initData || typeof initData !== 'string') return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const hashBuf = Buffer.from(hash, 'hex');
    const computedBuf = Buffer.from(computedHash, 'hex');
    if (hashBuf.length !== computedBuf.length || !crypto.timingSafeEqual(hashBuf, computedBuf)) {
        return null; // підпис не збігається — дані підроблені або токен невірний
    }

    const authDate = Number(params.get('auth_date'));
    if (!authDate || (Date.now() / 1000 - authDate) > maxAgeSeconds) {
        return null; // застаріле initData — вважаємо недійсним
    }

    try {
        const user = JSON.parse(params.get('user') || 'null');
        return user && user.id ? user : null;
    } catch (e) {
        return null;
    }
}

// Фабрика, бо requireTelegramAuth потребує BOT_TOKEN/DEV_MODE_INSECURE (конфіг
// процесу) і usersDB (щоб дописати balanceRev) — жодне з цього не є чистими
// даними, тому це не звичайний require(), а виклик один раз при старті сервера.
function createAuth({ BOT_TOKEN, DEV_MODE_INSECURE, usersDB }) {
    // Будь-яка відповідь, що містить `balance`, автоматично отримує й `balanceRev` —
    // щоб клієнт завжди знав актуальну ревізію і його автозбереження не було відхилене.
    // Робимо це в одному місці, а не в кожному ендпоінті окремо (щоб не забути новий).
    function attachBalanceRev(req, res) {
        const originalJson = res.json.bind(res);
        res.json = (payload) => {
            if (payload && typeof payload === 'object' && 'balance' in payload && payload.balanceRev === undefined) {
                const u = usersDB.get(String(req.telegramUser.id));
                if (u) payload.balanceRev = u.balanceRev;
            }
            return originalJson(payload);
        };
    }

    // Express-мідлвар: перевіряє заголовок X-Telegram-Init-Data і кладе довірений
    // ідентифікатор користувача в req.telegramUser. Усі ендпоінти, що читають/пишуть
    // баланс, VIP чи створюють інвойси, мають використовувати САМЕ req.telegramUser.id,
    // а не id з тіла запиту (його будь-хто може підмінити).
    function requireTelegramAuth(req, res, next) {
        const initData = req.headers['x-telegram-init-data'];
        const verifiedUser = verifyInitData(initData, BOT_TOKEN);
        if (verifiedUser) {
            req.telegramUser = { id: String(verifiedUser.id), first_name: verifiedUser.first_name || 'Ухилянт' };
            attachBalanceRev(req, res);
            return next();
        }
        if (DEV_MODE_INSECURE) {
            const fallbackId = req.body?.id || req.query?.id;
            if (fallbackId) {
                req.telegramUser = { id: String(fallbackId), first_name: req.body?.name || req.query?.name || 'DevТестер' };
                attachBalanceRev(req, res);
                return next();
            }
        }
        return res.status(401).json({ error: 'Недійсні дані Telegram WebApp. Відкрий гру через кнопку в боті.' });
    }

    return { requireTelegramAuth, attachBalanceRev };
}

module.exports = { verifyInitData, createAuth };
