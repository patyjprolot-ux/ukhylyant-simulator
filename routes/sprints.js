// Спринти — робочі контракти (PATCH_2.0_SPRINTS_SPEC.md, Фаза 1).
// Система живе паралельно зі старим клікером за фіче-флагом ECONOMY.SPRINTS_V2:
// поки він false, усі шість роутів існують (клієнт може їх смикати без 404), але
// одразу відповідають відмовою й НЕ чіпають стан гравця. Вмикається окремим
// рішенням після економічного тесту Фази 2.
module.exports = function registerSprintRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY, RESOURCE_BY_ID,
        addResource, storageSnapshot, serverBatchWindow,
        SPRINT_TIER_BY_ID, sprintSnapshot, sprintPayout,
        decayBurnout, burnoutPerTap, burnoutTapMult,
        settleExpiredQte, sprintExpired, qteWindowMs,
        BURNOUT_MAX, QTE_SPAWN_CHANCE, QTE_MIN_INTERVAL, QTE_MISS_PENALTY,
    } = deps;

    // Єдина точка відмови під вимкненим прапорцем — щоб не було шести різних
    // формулювань і щоб жодна гілка логіки випадково не виконалась.
    function disabled(res) {
        return res.json({ success: false, message: 'Спринти ще не увімкнені' });
    }

    // Спільна підготовка стану перед будь-якою дією: відпочинок за минулий час і
    // зарахування простроченого бага. Обидва — серверні, бо обидва працюють проти
    // гравця, і клієнту тут довіряти не можна.
    function syncSprint(user) {
        decayBurnout(user);
        settleExpiredQte(user);
    }

    app.get('/api/sprint', requireTelegramAuth, (req, res) => {
        if (!ECONOMY.SPRINTS_V2) return disabled(res);
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        syncSprint(user);
        res.json({ success: true, energy: user.energy, ...sprintSnapshot(user) });
    });

    app.post('/api/sprint/start', requireTelegramAuth, (req, res) => {
        if (!ECONOMY.SPRINTS_V2) return disabled(res);
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const tier = SPRINT_TIER_BY_ID[req.body.tier];
        if (!tier) return res.status(400).json({ error: 'Невідомий тір контракту' });
        syncSprint(user);
        if (user.activeSprint) return res.json({ success: false, message: 'Контракт уже в роботі' });
        if ((user.level || 1) < tier.minLevel) {
            return res.json({ success: false, message: `Потрібен ${tier.minLevel} рівень схрону` });
        }
        // Енергія — плата ЗА ВХІД у контракт, а не за кожен тап (тапи ріже вигорання).
        // Саме тому Lead відчувається як подія на вечір, а Junior можна брати підряд.
        if ((user.energy || 0) < tier.energyCost) {
            return res.json({ success: false, message: 'Недостатньо енергії на вхід у контракт' });
        }
        user.energy = Math.max(0, (user.energy || 0) - tier.energyCost);

        const now = Date.now();
        user.activeSprint = {
            tier: tier.id, startedAt: now, deadline: now + tier.deadlineMin * 60 * 1000,
            linesTotal: tier.taps, linesDone: 0, missedQte: 0, energySpent: tier.energyCost,
            // Службові поля: lastHitAt читає serverBatchWindow (анти-чіт), tapsSinceQte
            // тримає мінімальний інтервал між багами, qte — незакрита подія.
            lastHitAt: now, tapsSinceQte: 0, qte: null,
        };
        res.json({ success: true, energy: user.energy, ...sprintSnapshot(user) });
    });

    // Клієнт шле тапи батчами, як і по інспектору, — інакше сервер ляже на 30 cps.
    app.post('/api/sprint/tap', requireTelegramAuth, (req, res) => {
        if (!ECONOMY.SPRINTS_V2) return disabled(res);
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const sprint = user.activeSprint;
        if (!sprint) return res.json({ success: false, message: 'Немає активного контракту' });
        syncSprint(user);
        if (sprintExpired(sprint)) {
            return res.json({ success: false, expired: true, message: 'Дедлайн вийшов — здавай, що встиг', ...sprintSnapshot(user) });
        }
        const tier = SPRINT_TIER_BY_ID[sprint.tier];
        if (!tier) return res.json({ success: false, message: 'Невідомий тір контракту' });

        // Анти-чіт той самий, що й у /api/inspector/hit: вікно рахує ВЛАСНИЙ годинник
        // сервера, а не dt із тіла запиту, інакше можна слати "минуло 5 секунд" кожні
        // 500мс і писати код удесятеро швидше. Стеля cps теж спільна — окреме число
        // тут означало б два незалежні пороги на ту саму фізичну межу пальця.
        const dt = serverBatchWindow(sprint);
        const maxClicks = Math.ceil((dt / 1000) * ECONOMY.INSPECTOR_MAX_CPS);
        const clicks = Math.max(0, Math.min(Math.floor(Number(req.body.clicks) || 0), maxClicks));
        if (!clicks) return res.json({ success: true, lines: 0, qte: null, ...sprintSnapshot(user) });

        // Крутимо тапи по одному, а не множенням: вигорання росте ПІД ЧАС батча, і
        // саме через це останні тапи в довгій черзі мають давати менше за перші.
        const perTap = burnoutPerTap(user.focusStat);
        let lines = 0;
        let qte = null;
        for (let i = 0; i < clicks; i++) {
            if (sprint.linesDone + lines >= sprint.linesTotal) break;
            lines += burnoutTapMult(user.burnout);
            user.burnout = Math.min(BURNOUT_MAX, (user.burnout || 0) + perTap);
            sprint.tapsSinceQte = (sprint.tapsSinceQte || 0) + 1;
            // Не більше одного бага за батч і не частіше, ніж раз на QTE_MIN_INTERVAL
            // тапів — інакше на високому cps подія спавнилась би пачками.
            if (!sprint.qte && sprint.tapsSinceQte >= QTE_MIN_INTERVAL && Math.random() < QTE_SPAWN_CHANCE) {
                qte = { at: Date.now(), ms: qteWindowMs() };
                sprint.qte = qte;
                sprint.tapsSinceQte = 0;
            }
        }
        sprint.linesDone = Math.min(sprint.linesTotal, Math.round((sprint.linesDone + lines) * 100) / 100);

        res.json({
            success: true, lines: Math.round(lines * 100) / 100, qte,
            done: sprint.linesDone >= sprint.linesTotal, ...sprintSnapshot(user),
        });
    });

    app.post('/api/sprint/qte', requireTelegramAuth, (req, res) => {
        if (!ECONOMY.SPRINTS_V2) return disabled(res);
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const sprint = user.activeSprint;
        if (!sprint) return res.json({ success: false, message: 'Немає активного контракту' });
        decayBurnout(user);
        const q = sprint.qte;
        // settleExpiredQte навмисно ПІСЛЯ зчитування q: прострочену подію теж треба
        // зарахувати як пропуск, а не мовчки відповісти "багів немає".
        const late = settleExpiredQte(user);
        if (!q) return res.json({ success: false, message: 'Багів зараз немає', ...sprintSnapshot(user) });
        if (late) {
            return res.json({ success: true, hit: false, late: true, penalty: QTE_MISS_PENALTY, ...sprintSnapshot(user) });
        }
        sprint.qte = null;
        const hit = !!req.body.hit;
        if (!hit) sprint.missedQte = (sprint.missedQte || 0) + 1;
        res.json({ success: true, hit, penalty: QTE_MISS_PENALTY, ...sprintSnapshot(user) });
    });

    app.post('/api/sprint/claim', requireTelegramAuth, (req, res) => {
        if (!ECONOMY.SPRINTS_V2) return disabled(res);
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const sprint = user.activeSprint;
        if (!sprint) return res.json({ success: false, message: 'Немає активного контракту' });
        syncSprint(user);
        const tier = SPRINT_TIER_BY_ID[sprint.tier];
        if (!tier) { user.activeSprint = null; return res.json({ success: false, message: 'Невідомий тір контракту' }); }

        const done = sprint.linesDone >= sprint.linesTotal;
        const expired = sprintExpired(sprint);
        if (!done && !expired) {
            return res.json({ success: false, message: 'Контракт ще не закритий', ...sprintSnapshot(user) });
        }

        // Ставка × частка написаних рядків × штраф за пропущені баги. Здача по
        // дедлайну з недописаним кодом платить рівно за зроблене — але спец-ресурс
        // дають ТІЛЬКИ за закритий контракт: замовника цікавить результат, а не
        // старання, і шанси з таблиці дропу лишаються рівно такими, як домовлено.
        const tk = sprintPayout(sprint, tier);
        const missedQte = sprint.missedQte || 0;
        user.activeSprint = null;
        if (tk > 0) user.balance += tk;

        const gotRes = [];
        if (done) {
            for (const drop of tier.dropTable) {
                if (drop.chance < 1 && Math.random() >= drop.chance) continue;
                const { added, lost } = addResource(user, drop.res, drop.qty);
                const meta = RESOURCE_BY_ID[drop.res];
                gotRes.push({ id: drop.res, name: meta.name, emoji: meta.emoji, added, lost });
            }
        }

        res.json({
            success: true, done, expired, missedQte,
            reward: { tk, res: gotRes },
            balance: user.balance, ...storageSnapshot(user), ...sprintSnapshot(user),
        });
    });

    // Кинути контракт: енергія входу НЕ повертається — інакше можна було б
    // безкоштовно перебирати контракти, доки не випаде зручний QTE-розклад.
    app.post('/api/sprint/abandon', requireTelegramAuth, (req, res) => {
        if (!ECONOMY.SPRINTS_V2) return disabled(res);
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (!user.activeSprint) return res.json({ success: false, message: 'Немає активного контракту' });
        decayBurnout(user);
        user.activeSprint = null;
        res.json({ success: true, ...sprintSnapshot(user) });
    });
};
