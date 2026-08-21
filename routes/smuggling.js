// Маршрути втечі (2026-08-21, PATCH_2.0_NEW_MECHANICS_R15.md) — ендгейм-луп
// ПІСЛЯ легалізації. Ізольовано від основної економіки навмисно: не читає й
// не пише balance/resources/heat — лише contraband (косметична валюта) і
// власне smugglingRun. Найменш ризикована з п'яти нових механік саме тому.
module.exports = function registerSmugglingRoutes(app, deps) {
    const { requireTelegramAuth, getUser } = deps;
    const { SMUGGLING_ROUTES, SMUGGLING_BY_ID } = require('../catalog/smuggling');

    function snapshot(user) {
        const run = user.smugglingRun;
        return {
            contraband: user.contraband || 0,
            unlocked: (user.prestigeCount || 0) >= 1,
            routes: SMUGGLING_ROUTES,
            run: run ? { id: run.id, startedAt: run.startedAt, endsAt: run.endsAt } : null,
        };
    }

    app.get('/api/smuggling', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json(snapshot(user));
    });

    app.post('/api/smuggling/start', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if ((user.prestigeCount || 0) < 1) {
            return res.json({ success: false, message: 'Маршрути втечі відкриються після легалізації' });
        }
        const route = SMUGGLING_BY_ID[req.body.routeId];
        if (!route) return res.status(400).json({ error: 'Невідомий маршрут' });
        if (user.smugglingRun) return res.json({ success: false, message: 'Один маршрут уже в дорозі' });

        const now = Date.now();
        user.smugglingRun = { id: route.id, startedAt: now, endsAt: now + route.minutes * 60 * 1000 };
        res.json({ success: true, ...snapshot(user) });
    });

    app.post('/api/smuggling/claim', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const run = user.smugglingRun;
        if (!run) return res.json({ success: false, message: 'Немає активного маршруту' });
        if (Date.now() < run.endsAt) return res.json({ success: false, message: 'Маршрут ще триває' });

        const route = SMUGGLING_BY_ID[run.id];
        user.smugglingRun = null;
        if (!route) return res.json({ success: true, caught: false, gained: 0, ...snapshot(user) });

        const gained = Math.round(route.contrabandMin + Math.random() * (route.contrabandMax - route.contrabandMin));
        const caught = Math.random() < route.risk;
        // Конфіскація: провал забирає ПОЛОВИНУ щойно зароблених contraband
        // цього заходу (не чіпає раніше накопичене) — ризик реальний, але не
        // катастрофічний, під стать "азарту зі старої звички", не покаранню.
        const final = caught ? Math.round(gained / 2) : gained;
        user.contraband = (user.contraband || 0) + final;

        res.json({
            success: true, caught, gained: final,
            message: caught
                ? `Половину вантажу конфіскували на в'їзді. +${final} 🎒 контрабандних балів.`
                : `Чисто пройшло. +${final} 🎒 контрабандних балів.`,
            ...snapshot(user),
        });
    });
};
