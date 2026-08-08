// Автоматично винесено з server.js (Фаза 4 модуляризації, 2026-08-08).
// Лідерборд, нікнейми, профіль/PvP "Здати сусіда", розслідування, клани ("Чат ОСББ").
module.exports = function registerSocialRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY, usersDB, clansDB,
        displayName, publicSnitchStats, LEAGUES, ukhyrRank, validateNickname,
        profileCard, snitchEligibility, userByPid, migrateUser, syncHeatAndNotices,
        heatTierOf, mapProtectPct, resetDailyIfNeeded, hasSkill, NOTICE_BY_ID,
        addWarPoints, changeHeat, sendPush, logOffline, checkAchievements,
        buildSuspects, storageSnapshot, clanLevel, makeClanId, getClanInfo, warSnapshot,
    } = deps;

    app.get('/api/leaderboard', (req, res) => {
        const top = Array.from(usersDB.values())
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 10)
            // pid — опаковий публічний ідентифікатор, саме він потрібен, щоб тапнути
            // по гравцю й порівняти профілі. Telegram id тут не світимо.
            .map((u) => ({ pid: u.pid, name: displayName(u), balance: u.balance, isVip: u.isVip, level: u.level,
                snitch: publicSnitchStats(u), seasonTitle: u.seasonTitle || null,
                league: LEAGUES[Math.max(0, Math.min(LEAGUES.length - 1, u.league || 0))].emoji,
                playerLevel: u.playerLevel || 1, ukhyr: u.ukhyr || 0, ukhyrRank: ukhyrRank(u.ukhyr || 0) }));
        res.json(top);
    });

    // Перша установка ніка — безкоштовно. Якщо вже стоїть — треба платити ⭐
    // (окремий флоу через /api/nickname/requestChange + інвойс).
    app.post('/api/nickname/set', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.nickname) {
            return res.json({ success: false, paid: true, message: `Нік уже встановлено. Зміна коштує ${ECONOMY.NICKNAME_CHANGE_PRICE_STARS} ⭐` });
        }
        const raw = String(req.body.nickname || '').trim();
        const err = validateNickname(raw, user.id);
        if (err) return res.json({ success: false, message: err });
        user.nickname = raw;
        res.json({ success: true, nickname: user.nickname });
    });

    // Платна зміна: спершу валідуємо й резервуємо бажаний нік (pendingNickname),
    // оплата підтверджується окремо через /api/invoice (type: nickname_change) +
    // successful_payment. Нік застосовується тільки ПІСЛЯ оплати.
    app.post('/api/nickname/requestChange', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const raw = String(req.body.nickname || '').trim();
        const err = validateNickname(raw, user.id);
        if (err) return res.json({ success: false, message: err });
        user.pendingNickname = raw;
        res.json({ success: true, price: ECONOMY.NICKNAME_CHANGE_PRICE_STARS });
    });

    // Порівняння профілів: дві колонки й чесна причина, чому здати не можна.
    app.get('/api/profile', requireTelegramAuth, (req, res) => {
        const me = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const other = userByPid(req.query.pid);
        if (!other) return res.status(404).json({ error: 'Такого гравця немає' });
        migrateUser(other);
        syncHeatAndNotices(other);
        const elig = snitchEligibility(me, other);
        res.json({
            me: profileCard(me), other: profileCard(other),
            snitch: {
                can: elig.ok, free: !!elig.free, reason: elig.reason || null,
                // Саме обчислена ціна: під час війни стук на ворога вдвічі дешевший,
                // і кнопка має показувати це, а не базовий цінник.
                costTk: typeof elig.costTk === 'number' ? elig.costTk : ECONOMY.SNITCH_COST_TK,
                warTarget: !!elig.warTarget, costRes: ECONOMY.SNITCH_COST_RES,
                left: Math.max(0, ECONOMY.SNITCH_DAILY_LIMIT - (me.snitchesToday || 0)),
            },
        });
    });

    app.post('/api/snitch', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        const target = userByPid(req.body.targetPid);
        if (!target) return res.json({ success: false, message: 'Такого гравця немає' });
        migrateUser(target);
        syncHeatAndNotices(target);

        const elig = snitchEligibility(user, target);
        if (!elig.ok) return res.json({ success: false, message: elig.reason });

        const now = Date.now();
        if (elig.free) {
            user.freeSnitchOn = user.freeSnitchOn.filter((id) => id !== target.id);
        } else {
            user.balance -= elig.costTk;
            const res_ = ECONOMY.SNITCH_COST_RES;
            user.resources[res_] -= 1;
            if (user.resources[res_] <= 0) delete user.resources[res_];
            user.snitchesToday = (user.snitchesToday || 0) + 1;
            user.lastSnitchTargets[target.id] = now;
        }
        user.snitchStats.sent += 1;
        if (elig.warTarget) addWarPoints(user, ECONOMY.WAR_POINTS_SNITCH, 'здав ворога');

        // «Дві сімки»: у жертви свій номер, і дзвінок просто не проходить. Ресурси
        // стукач витратив, але про провал НЕ дізнається — інакше він би просто
        // передзвонив, і навичка нічого б не давала.
        if (hasSkill(target, 'twosims') && Math.random() < ECONOMY.SKILL_SNITCH_FAIL_CHANCE) {
            return res.json({
                success: true, free: !!elig.free, message: 'Дзвінок пішов. Він навіть не знає, хто це був.',
                snitchesLeft: Math.max(0, ECONOMY.SNITCH_DAILY_LIMIT - (user.snitchesToday || 0)),
                balance: user.balance, snitchStats: publicSnitchStats(user), ...storageSnapshot(user),
            });
        }

        // Жертві — та сама повістка "вручення в руки", що й від системи: 3 години на
        // реакцію. Різниця в тому, що за цією стоїть жива людина, яку можна вирахувати.
        const type = NOTICE_BY_ID['ruky'];
        target.notices.push({
            uid: 'n' + now.toString(36) + Math.floor(Math.random() * 1000).toString(36),
            typeId: type.id, issuedAt: now, expiresAt: now + type.ttlH * 3600 * 1000,
            pushSent: false, fromSnitch: true,
        });
        target.noticeStats.received += 1;
        changeHeat(target, ECONOMY.SNITCH_HEAT, 'Тебе здав сусід');
        target.snitchStats.received += 1;

        // Щур-розвідник іноді одразу палить стукача — тоді розслідування не потрібне.
        const revealed = target.petId === 'rat' && Math.random() < ECONOMY.SNITCH_RAT_REVEAL_CHANCE;
        target.snitchedBy.unshift({ byId: user.id, byName: displayName(user), at: now, investigated: false, revealed, suspects: null });
        if (target.snitchedBy.length > ECONOMY.SNITCH_HISTORY_SIZE) target.snitchedBy.length = ECONOMY.SNITCH_HISTORY_SIZE;

        logOffline(target, 'bad', revealed ? `🐍 Тебе здав ${displayName(user)}` : '🐍 Тебе хтось здав');
        sendPush(target.id, revealed
            ? `🐀 Щур-розвідник підслухав розмову: тебе здав ${user.name}. Ти йому цього не забудеш.`
            : '🐍 Хтось про тебе розповів. Ти йому цього не забудеш.');

        res.json({
            success: true, free: !!elig.free,
            message: elig.free
                ? 'Безкоштовний дзвінок використано. Ви квити.'
                : 'Дзвінок пішов. Він навіть не знає, хто це був.',
            snitchesLeft: Math.max(0, ECONOMY.SNITCH_DAILY_LIMIT - (user.snitchesToday || 0)),
            balance: user.balance, snitchStats: publicSnitchStats(user), ...storageSnapshot(user),
        });
    });

    // Розслідування: жертві показують трьох, вона має один здогад.
    app.get('/api/investigation', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const entry = (user.snitchedBy || []).find((e) => !e.investigated);
        if (!entry) return res.json({ pending: false });
        if (entry.revealed) {
            return res.json({ pending: true, revealed: true, at: entry.at, snitchName: entry.byName });
        }
        // Список фіксуємо при першому відкритті, щоб його не можна було "перекрутити",
        // перезайшовши в гру, доки не випаде зручна трійка.
        if (!Array.isArray(entry.suspects) || !entry.suspects.length) {
            entry.suspects = buildSuspects(user, entry.byId);
        }
        const suspects = entry.suspects
            .map((id) => usersDB.get(id))
            .filter(Boolean)
            .map((u) => ({ pid: u.pid, name: displayName(u), level: u.level, snitch: publicSnitchStats(u) }));
        res.json({ pending: true, revealed: false, at: entry.at, suspects });
    });

    app.post('/api/investigation/guess', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const entry = (user.snitchedBy || []).find((e) => !e.investigated);
        if (!entry) return res.json({ success: false, message: 'Немає активного розслідування' });
        if (entry.revealed) {
            entry.investigated = true;
            return res.json({ success: false, message: 'Щур і так усе розповів — розслідувати нічого' });
        }
        const suspect = userByPid(req.body.suspectPid);
        if (!suspect || !Array.isArray(entry.suspects) || !entry.suspects.includes(suspect.id)) {
            return res.json({ success: false, message: 'Цього немає у списку підозрюваних' });
        }
        migrateUser(suspect);
        entry.investigated = true;

        if (suspect.id === entry.byId) {
            // Стеля за рівнем схрону: відчутно, але не катастрофа. Баланс жертви — акцесор,
            // тож balanceRev інкрементується сам і її клієнтське автозбереження вже не
            // "поверне" вкрадене; pendingRobbery показує їй, куди поділись гроші.
            const cap = ECONOMY.SNITCH_STEAL_CAP_PER_LEVEL * ((suspect.level || 1) + 1);
            // Тайник ЖЕРТВИ ховає частину грошей від крадіжки.
            const stealPct = ECONOMY.SNITCH_STEAL_PCT * (1 - mapProtectPct(suspect));
            const steal = Math.max(0, Math.min(Math.floor(Math.max(0, suspect.balance) * stealPct), cap));
            if (steal > 0) {
                suspect.balance -= steal;
                user.balance += steal;
            }
            suspect.pendingRobbery = { byName: displayName(user), amount: steal, at: Date.now() };
            logOffline(suspect, 'bad', `🕵️ ${displayName(user)} тебе вирахував (−${steal.toLocaleString('uk-UA')} ТК)`);
            suspect.snitchStats.robbed += steal;
            user.snitchStats.caught += 1;
            user.snitchStats.stolen += steal;
            user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.SNITCH_CAUGHT_SEASON_POINTS;
            if (!user.trophies.includes('detective')) user.trophies.push('detective');

            sendPush(suspect.id, `🕵️ ${displayName(user)} тебе вирахував. Моральна компенсація: −${steal.toLocaleString('uk-UA')} ТК.`);
            const unlocked = checkAchievements(user);
            return res.json({
                success: true, correct: true, snitchName: displayName(suspect), stolen: steal,
                balance: user.balance, trophies: user.trophies, seasonPoints: user.seasonPoints,
                snitchStats: publicSnitchStats(user), unlockedAchievements: unlocked,
            });
        }

        // Хибне звинувачення навмисно НЕ безкарне: невинний отримує право на один
        // безкоштовний дзвінок саме на тебе. Саме звідси беруться ланцюгові війни.
        if (!suspect.freeSnitchOn.includes(user.id)) suspect.freeSnitchOn.push(user.id);
        suspect.snitchStats.falselyAccused += 1;
        sendPush(suspect.id, `😐 ${displayName(user)} підозрював у стукацтві саме тебе. Ти образився — тепер у тебе є один безкоштовний дзвінок на нього.`);
        res.json({
            success: true, correct: false, accusedName: displayName(suspect),
            message: 'Не вгадав. Справжній стукач лишився невідомим, а невинний образився.',
            snitchStats: publicSnitchStats(user),
        });
    });

    // ---- Клани ("Чат ОСББ") ----
    app.get('/api/clan/list', (req, res) => {
        const list = Array.from(clansDB.values())
            .map((c) => ({ id: c.id, name: c.name, members: c.members.length, level: clanLevel(c) }))
            .sort((a, b) => b.level - a.level || b.members - a.members)
            .slice(0, 20);
        res.json(list);
    });

    app.get('/api/clan/leaderboard', (req, res) => {
        const top = Array.from(clansDB.values())
            .map((c) => ({
                id: c.id, name: c.name, members: c.members.length,
                level: clanLevel(c), treasury: c.treasury || 0,
                totalBalance: Math.floor(c.members.reduce((sum, id) => sum + (usersDB.get(id)?.balance || 0), 0)),
            }))
            // Сортуємо за скарбницею: вона показує реальний внесок клану, а не просто
            // хто випадково має багатих учасників.
            .sort((a, b) => b.treasury - a.treasury || b.totalBalance - a.totalBalance)
            .slice(0, 10);
        res.json(top);
    });

    app.post('/api/clan/create', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.clanId && clansDB.has(user.clanId)) return res.json({ success: false, message: 'Ти вже в чаті ОСББ. Спочатку вийди.' });
        const name = String(req.body.name || '').trim().slice(0, 30);
        if (!name) return res.json({ success: false, message: 'Вкажи назву чату' });
        // Назва клану рендериться клієнтом через innerHTML (renderClanMine/loadClanList/
        // loadClanLeaderboard) — без білого списку символів це був stored XSS: будь-хто
        // міг вставити <script>/onerror у назву й виконати код у WebView усіх, хто відкриє
        // список кланів. Той самий патерн, що вже стоїть на нікнеймах.
        if (!/^[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_ .,!?'-]+$/.test(name)) {
            return res.json({ success: false, message: 'Тільки літери, цифри та звичайна пунктуація' });
        }
        const clan = { id: makeClanId(), name, ownerId: user.id, members: [user.id], treasury: 0, contributions: {} };
        clansDB.set(clan.id, clan);
        user.clanId = clan.id;
        res.json({ success: true, clanId: clan.id, clanName: clan.name });
    });

    // Внесок у скарбницю клану: підвищує рівень клану, а з ним — бонус до пасиву
    // для ВСІХ учасників. Внесок незворотний, тому підтвердження робимо на клієнті.
    app.post('/api/clan/donate', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (!user.clanId || !clansDB.has(user.clanId)) {
            return res.json({ success: false, message: 'Ти не в чаті ОСББ' });
        }
        const amount = Math.floor(Number(req.body.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.json({ success: false, message: 'Вкажи суму' });
        }
        if (user.balance < amount) return res.json({ success: false, message: 'Недостатньо ТК' });

        const clan = clansDB.get(user.clanId);
        if (!clan.contributions) clan.contributions = {};
        const before = clanLevel(clan);
        user.balance -= amount;
        clan.treasury = (clan.treasury || 0) + amount;
        clan.contributions[user.id] = (clan.contributions[user.id] || 0) + amount;
        // Внесок теж кує перемогу у війні, просто повільніше за стуки й босів.
        const warPts = Math.floor(amount / ECONOMY.WAR_POINTS_PER_DONATION);
        if (warPts > 0) addWarPoints(user, warPts, 'вніс у скарбницю');
        const after = clanLevel(clan);
        const unlocked = checkAchievements(user);

        res.json({
            success: true, balance: user.balance,
            leveledUp: after > before, unlockedAchievements: unlocked, ...getClanInfo(user), ...warSnapshot(user),
        });
    });

    app.post('/api/clan/join', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.clanId && clansDB.has(user.clanId)) return res.json({ success: false, message: 'Ти вже в чаті ОСББ.' });
        const clan = clansDB.get(req.body.clanId);
        if (!clan) return res.json({ success: false, message: 'Чат не знайдено' });
        if (!clan.members.includes(user.id)) clan.members.push(user.id);
        user.clanId = clan.id;
        res.json({ success: true, clanId: clan.id, clanName: clan.name });
    });

    app.post('/api/clan/leave', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.clanId && clansDB.has(user.clanId)) {
            const clan = clansDB.get(user.clanId);
            clan.members = clan.members.filter((id) => id !== user.id);
            if (clan.members.length === 0) clansDB.delete(clan.id);
        }
        user.clanId = null;
        res.json({ success: true });
    });
};
