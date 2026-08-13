// Автоматично винесено з server.js (Фаза 4 модуляризації).
// Тиск ТЦК/розшук: повістки, відстрочки, блокпост, інспектори (боси), медкомісія.
module.exports = function registerSecurityRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY,
        NOTICE_BY_ID, DEFERMENT_BY_ID, CHECKPOINT_BY_ID, CHECKPOINT_CHOICES,
        INSPECTOR_BY_ID, INSPECTORS, SYMPTOMS, SYMPTOM_BY_ID, COSMETICS,
        heatSnapshot, noticeSnapshot, noticeBribeCost, applyNoticePenalty, checkAchievements,
        storageSnapshot, storageUsed, mapProtectPct, loseRandomResources,
        syncHeatAndNotices, defermentActive, defermentEligibility, defermentSnapshot, grantDeferment,
        changeHeat, repMaxed, hasSkill, addWarPoints, addResource, RESOURCE_BY_ID,
        addXP, addUkhyr, heatIncomeMult, inspectorTimeout, inspectorSnapshot, serverBatchWindow,
    } = deps;

    // ---- Розшук і повістки ----
    app.get('/api/notices', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json({
            ...heatSnapshot(user, true), ...noticeSnapshot(user),
            balance: user.balance, shieldUntil: user.shieldUntil,
            investigationPending: (user.snitchedBy || []).some((e) => !e.investigated),
        });
    });

    // Знімає повістку зі списку й веде статистику. Спільне для /api/notice/resolve і
    // для медкомісії, яка завершується вже в іншому роуті.
    function finishNotice(user, idx, method, resolved) {
        user.notices.splice(idx, 1);
        user.noticeStats.byMethod[method] = (user.noticeStats.byMethod[method] || 0) + 1;
        if (resolved) {
            user.noticeStats.resolved += 1;
            user.dailyNotices = (user.dailyNotices || 0) + 1;
            user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.NOTICE_SEASON_POINTS;
        } else {
            user.noticeStats.failed += 1;
        }
    }

    // ---- Медкомісія ----
    // Роздача карток — на сервері, інакше гравець просто вибрав би собі "Справжню
    // медичну карту" п'ять разів поспіль.
    function drawSymptoms(count) {
        const pool = SYMPTOMS.slice();
        const hand = [];
        for (let i = 0; i < count && pool.length; i++) {
            const total = pool.reduce((s, c) => s + c.weight, 0);
            let roll = Math.random() * total;
            let idx = 0;
            for (; idx < pool.length; idx++) {
                roll -= pool[idx].weight;
                if (roll <= 0) break;
            }
            hand.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0].id);
        }
        return hand;
    }

    // Скільки переконливості дасть картка саме цьому гравцю: та сама скарга двічі
    // поспіль працює гірше ("ви вже приходили з цим").
    function symptomPower(user, id) {
        const card = SYMPTOM_BY_ID[id];
        if (!card) return 0;
        const repeated = (user.lastMedcomCards || []).includes(id);
        return Math.max(0, card.power - (repeated ? ECONOMY.MEDCOM_REPEAT_PENALTY : 0));
    }

    function medcomHand(user) {
        const s = user.medcomSession;
        if (!s) return null;
        return {
            noticeId: s.noticeId,
            rerolls: s.rerolls,
            rerollsLeft: Math.max(0, ECONOMY.MEDCOM_REROLL_MAX - s.rerolls),
            rerollCost: ECONOMY.MEDCOM_REROLL_COST,
            pick: ECONOMY.MEDCOM_PICK,
            skepticism: Math.round(ECONOMY.MEDCOM_BASE_SKEPTICISM + (user.heat || 0)),
            cards: s.cards.map((id) => {
                const c = SYMPTOM_BY_ID[id];
                return {
                    id, name: c.name, emoji: c.emoji, power: symptomPower(user, id),
                    repeated: (user.lastMedcomCards || []).includes(id),
                };
            }),
            bonuses: {
                stamp: { have: (user.resources.stamp || 0) >= 1, bonus: ECONOMY.MEDCOM_STAMP_BONUS, qty: 1 },
                meds: { have: (user.resources.meds || 0) >= ECONOMY.MEDCOM_MEDS_QTY, bonus: ECONOMY.MEDCOM_MEDS_BONUS, qty: ECONOMY.MEDCOM_MEDS_QTY },
                cat: { have: user.petId === 'cat', bonus: ECONOMY.MEDCOM_CAT_BONUS, qty: 0 },
            },
        };
    }

    function dealMedcom(user, notice) {
        user.medcomSession = { noticeId: notice.uid, cards: drawSymptoms(ECONOMY.MEDCOM_HAND_SIZE), rerolls: 0 };
        return { hand: medcomHand(user) };
    }

    // Повістка — це не штраф, а вибір. П'ять способів відреагувати, кожен зі своєю
    // ціною: гроші, скрафтована довідка, ризикована міні-гра, вся енергія або нічого.
    app.post('/api/notice/resolve', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const { noticeId, method } = req.body;
        const idx = (user.notices || []).findIndex((n) => n.uid === noticeId);
        if (idx === -1) return res.json({ success: false, message: 'Цієї повістки вже немає' });
        const notice = user.notices[idx];
        const type = NOTICE_BY_ID[notice.typeId];
        if (!type) {
            user.notices.splice(idx, 1);
            return res.json({ success: false, message: 'Невідомий тип повістки' });
        }

        if (method === 'ignore') {
            return res.json({ success: true, ignored: true, message: 'Ну й нехай тікає таймер.', ...heatSnapshot(user), ...noticeSnapshot(user) });
        }

        let resolved = false;
        let message = '';
        let penalty = null;

        if (method === 'cover') {
            // «Прикриття» від дільничного Миколи: раз на добу він просто не дає ходу
            // папірцю. Розшук при цьому не падає — питання не вирішене, а відкладене.
            if (!repMaxed(user, 'mykola')) return res.json({ success: false, message: 'Микола тебе ще недостатньо знає' });
            if (user.mykolaCoverUsed) return res.json({ success: false, message: 'Микола вже прикрив тебе сьогодні' });
            user.mykolaCoverUsed = true;
            resolved = true;
            message = 'Микола глянув на папірець і поклав його в найнижчу шухляду.';
        } else if (method === 'bribe') {
            const cost = noticeBribeCost(user, type);
            if (user.balance < cost) return res.json({ success: false, message: 'Не вистачає ТК, щоб "вирішити питання"' });
            user.balance -= cost;
            changeHeat(user, -ECONOMY.HEAT_BRIBE_DISCOUNT, 'Вирішив питання');
            // Валік Настирливий якраз і ловиться на тих, хто вже сьогодні "вирішував".
            user.lastBribeAt = Date.now();
            user.dailyBribes = (user.dailyBribes || 0) + 1;
            resolved = true;
            message = `Питання вирішено за ${cost.toLocaleString('uk-UA')} ТК. Про тебе трохи забули.`;
        } else if (method === 'spravka') {
            // Скрафтована "Липова довідка" живе в грі як тимчасовий щит (shieldUntil) —
            // окремого інвентаря довідок немає. Тому пред'явити довідку = витратити щит,
            // і це справжня ціна: далі облави знову проходять.
            if ((user.shieldUntil || 0) <= Date.now()) {
                return res.json({ success: false, message: 'Немає активної липової довідки — скрафти її в Кладовці' });
            }
            user.shieldUntil = 0;
            changeHeat(user, -ECONOMY.HEAT_SPRAVKA_DISCOUNT, 'Показав липову довідку');
            user.deceivedCount = (user.deceivedCount || 0) + 1;
            resolved = true;
            message = 'Довідку прийняли, навіть не читаючи. Розшук помітно впав.';
        } else if (method === 'medcom') {
            // Медкомісія — не миттєвий кидок, а міні-гра: віддаємо картки, а знімається
            // повістка вже в /api/medcom/submit.
            return res.json({ success: true, medcom: true, ...dealMedcom(user, notice) });
        } else if (method === 'hide') {
            if ((user.energy || 0) <= 0) return res.json({ success: false, message: 'Немає енергії, щоб десь пересидіти' });
            user.energy = 0;
            resolved = Math.random() < ECONOMY.NOTICE_HIDE_SUCCESS;
            message = resolved
                ? 'Пересидів під ковдрою, поки не пішли. Пронесло.'
                : 'Знайшли. Штраф півтора рази — за спробу.';
            if (!resolved) penalty = applyNoticePenalty(user, type, ECONOMY.NOTICE_HIDE_FAIL_MULT);
        } else {
            return res.status(400).json({ error: 'Невідомий спосіб' });
        }

        finishNotice(user, idx, method, resolved);

        const unlocked = checkAchievements(user);
        res.json({
            success: true, resolved, message, penalty, unlockedAchievements: unlocked,
            balance: user.balance, energy: user.energy, shieldUntil: user.shieldUntil,
            seasonPoints: user.seasonPoints, ...storageSnapshot(user),
            ...heatSnapshot(user, true), ...noticeSnapshot(user),
        });
    });

    // ---- Відстрочки ----
    app.get('/api/deferments', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        syncHeatAndNotices(user);
        res.json(defermentSnapshot(user));
    });

    app.post('/api/deferment/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        // Саме defermentId, а не id: у dev-режимі полем id клієнт передає свій Telegram id.
        const def = DEFERMENT_BY_ID[req.body.defermentId];
        if (!def) return res.json({ success: false, message: 'Невідома відстрочка' });
        // За Stars — окремий флоу через інвойс, сюди така покупка не приходить.
        if (def.cost.stars) return res.json({ success: false, message: 'Ця відстрочка купується за ⭐' });

        const e = defermentEligibility(user, def);
        if (!e.ok) return res.json({ success: false, message: e.reason });

        if (def.cost.tk) user.balance -= def.cost.tk;
        for (const [resId, qty] of Object.entries(def.cost.res || {})) {
            user.resources[resId] -= qty;
            if (user.resources[resId] <= 0) delete user.resources[resId];
        }
        grantDeferment(user, def);

        const unlocked = checkAchievements(user);
        res.json({
            success: true, message: `${def.emoji} ${def.name} оформлено. ${def.flavor}.`,
            balance: user.balance, unlockedAchievements: unlocked,
            ...defermentSnapshot(user), ...storageSnapshot(user), ...noticeSnapshot(user),
        });
    });

    // ---- Блокпост ----
    // Спрацьовує при переїзді в новий схрон. Локація купується в будь-якому разі —
    // блокпост впливає лише на "ціну переїзду".
    function checkpointChance(user, choice) {
        let chance = choice.chance;
        if (choice.ninaRepRequired && (user.reputation?.nina || 0) >= choice.ninaRepRequired) {
            chance = choice.bonusWithNinaRep;
        }
        if (user.petId === 'pigeon') chance += ECONOMY.CHECKPOINT_PIGEON_BONUS;
        return Math.max(0, Math.min(1, chance));
    }

    function checkpointSnapshot(user) {
        return {
            checkpointAuto: defermentActive(user),
            checkpointChoices: CHECKPOINT_CHOICES.map((c) => ({
                id: c.id, emoji: c.emoji, name: c.name, failText: c.failText,
                chance: Math.round(checkpointChance(user, c) * 100),
            })),
        };
    }

    app.get('/api/checkpoint', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json({ ...checkpointSnapshot(user), stats: user.checkpointStats });
    });

    app.post('/api/checkpoint/pass', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const choice = CHECKPOINT_BY_ID[req.body.choice];
        if (!choice) return res.json({ success: false, message: 'Невідомий вибір' });

        // Під відстрочкою документи в порядку — питань немає взагалі.
        const auto = defermentActive(user);
        const passed = auto || Math.random() < checkpointChance(user, choice);

        let consequence = null;
        if (!passed) {
            if (choice.fail === 'heat_notice') {
                changeHeat(user, ECONOMY.CHECKPOINT_HEAT_DOCS, 'Спалився на блокпосту');
                // При повній скриньці повістку не видаємо — і чесно про це не звітуємо,
                // інакше гравець шукав би в списку четверту, якої немає.
                const issued = (user.notices || []).length < ECONOMY.NOTICE_MAX_ACTIVE;
                if (issued) {
                    const type = NOTICE_BY_ID['blokpost'];
                    const now = Date.now();
                    user.notices.push({
                        uid: 'n' + now.toString(36) + Math.floor(Math.random() * 1000).toString(36),
                        typeId: type.id, issuedAt: now, expiresAt: now + type.ttlH * 3600 * 1000, pushSent: false,
                    });
                    user.noticeStats.received += 1;
                }
                consequence = { heat: ECONOMY.CHECKPOINT_HEAT_DOCS, notice: issued };
            } else if (choice.fail === 'resources') {
                // Тайник ховає частину запасів від конфіскації на блокпості.
                const lossCount = Math.ceil(storageUsed(user) * ECONOMY.CHECKPOINT_RESOURCE_LOSS * (1 - mapProtectPct(user)));
                const lost = loseRandomResources(user, lossCount);
                consequence = { resourcesLost: lost };
            } else {
                changeHeat(user, ECONOMY.CHECKPOINT_HEAT_BABA, 'Не повірили на блокпосту');
                consequence = { heat: ECONOMY.CHECKPOINT_HEAT_BABA };
            }
            user.checkpointStats.failed += 1;
        } else {
            user.checkpointStats.passed += 1;
        }

        res.json({
            success: true, passed, auto, consequence,
            message: auto ? 'Показав відстрочку — навіть виходити з машини не довелось.'
                : passed ? 'Пропустили. Навіть у багажник не заглянули.'
                    : 'Не пройшло.',
            balance: user.balance, ...storageSnapshot(user), ...heatSnapshot(user), ...noticeSnapshot(user),
        });
    });

    // ---- Інспектори ТЦК (боси) ----
    // Слабкість активна — урон подвоюється. Перевіряється на сервері в момент удару,
    // бо всі три умови можна підробити на клієнті.
    function inspectorWeaknessActive(user, insp, cps) {
        if (!insp.weakness) return false;
        if (insp.weakness === 'bribe') {
            return Date.now() - (user.lastBribeAt || 0) < ECONOMY.INSPECTOR_BRIBE_WINDOW_MIN * 60000;
        }
        if (insp.weakness === 'speed') return cps >= ECONOMY.INSPECTOR_SPEED_CPS;
        if (insp.weakness === 'charm') {
            return Object.values(user.equipped || {}).some((id) => {
                const c = COSMETICS.find((x) => x.id === id);
                return c && (c.price || 0) >= ECONOMY.INSPECTOR_CHARM_MIN_PRICE;
            });
        }
        return false;
    }

    // Список "розшукуваних" для окремого екрана: видно і тих, до кого ще не доріс.
    function inspectorRoster(user) {
        return INSPECTORS.map((insp) => {
            const locked = insp.requiresSkill && !hasSkill(user, insp.requiresSkill);
            const cdLeft = insp.cooldownH
                ? Math.max(0, insp.cooldownH * 3600 * 1000 - (Date.now() - (user.inspectorLastSeen[insp.id] || 0)))
                : 0;
            return {
                id: insp.id, emoji: insp.emoji, name: insp.name, taunt: insp.taunt,
                hp: insp.hp, window: insp.window, unlockHeat: insp.unlockHeat,
                weaknessHint: insp.weaknessHint, reward: insp.reward,
                defeated: user.inspectorStats.defeated[insp.id] || 0,
                locked, lockedHint: locked ? insp.lockedHint : null,
                cooldownLeft: cdLeft,
                heatReady: (user.heat || 0) >= insp.unlockHeat,
            };
        });
    }

    app.get('/api/inspector', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        syncHeatAndNotices(user);
        const gone = inspectorTimeout(user);
        res.json({ ...inspectorSnapshot(user), roster: inspectorRoster(user), stats: user.inspectorStats, gone });
    });

    // Клієнт шле кліки батчами раз на 500мс, а не по одному — інакше сервер ляже.
    app.post('/api/inspector/hit', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (!user.inspector) return res.json({ success: false, message: 'Нікого немає' });
        if (inspectorTimeout(user)) {
            return res.json({ success: false, gone: true, message: 'Не встиг. Інспектор пішов писати рапорт.', ...heatSnapshot(user) });
        }
        const insp = INSPECTOR_BY_ID[user.inspector.id];

        // Анти-чіт рахує вікно за ВЛАСНИМ годинником сервера, а не за dt із тіла
        // запиту: інакше можна слати dt=5000 кожні 500мс і бити вдесятеро частіше.
        const dt = serverBatchWindow(user.inspector);
        const maxClicks = Math.ceil((dt / 1000) * ECONOMY.INSPECTOR_MAX_CPS);
        let clicks = Math.max(0, Math.min(Math.floor(Number(req.body.clicks) || 0), maxClicks));
        if (!clicks) return res.json({ success: true, ...inspectorSnapshot(user), energy: user.energy });

        // Енергія — той самий обмежувач, що й у звичайному кліку, лише дорожчий.
        // «Марафонець» знімає його повністю — і саме тому робить Півника прохідним.
        const freeClicks = hasSkill(user, 'marathon');
        let outOfEnergy = false;
        if (!freeClicks) {
            const affordable = Math.floor((user.energy || 0) / ECONOMY.INSPECTOR_ENERGY_PER_CLICK);
            outOfEnergy = clicks > affordable;
            clicks = Math.min(clicks, affordable);
            if (!clicks) {
                return res.json({ success: true, outOfEnergy: true, energy: user.energy, ...inspectorSnapshot(user) });
            }
            user.energy = Math.max(0, user.energy - clicks * ECONOMY.INSPECTOR_ENERGY_PER_CLICK);
        }

        const cps = clicks / (dt / 1000);
        const weak = inspectorWeaknessActive(user, insp, cps);
        const power = Math.max(1, Number(user.clickVal) || 1);
        const damage = clicks * power * (weak ? ECONOMY.INSPECTOR_WEAKNESS_MULT : 1);
        user.inspector.hp -= damage;

        if (user.inspector.hp > 0) {
            return res.json({ success: true, damage, weak, outOfEnergy, energy: user.energy, ...inspectorSnapshot(user) });
        }

        // Переможений: нагорода, трофей і кулдаун до наступного візиту.
        user.inspector = null;
        user.inspectorStats.defeated[insp.id] = (user.inspectorStats.defeated[insp.id] || 0) + 1;
        user.dailyInspectors = (user.dailyInspectors || 0) + 1;
        addWarPoints(user, ECONOMY.WAR_POINTS_INSPECTOR, 'спекався інспектора');
        user.inspectorLastSeen[insp.id] = Date.now();
        user.inspectorCooldownUntil = Date.now() + ECONOMY.INSPECTOR_COOLDOWN_H * 3600 * 1000;
        if (!user.trophies.includes('insp_' + insp.id)) user.trophies.push('insp_' + insp.id);

        const tk = Math.round(insp.reward.tk * heatIncomeMult(user));
        user.balance += tk;
        user.seasonPoints = (user.seasonPoints || 0) + (insp.reward.sp || 0);
        const gotRes = [];
        for (const [resId, qty] of Object.entries(insp.reward.res || {})) {
            const { added, lost } = addResource(user, resId, qty);
            gotRes.push({ id: resId, name: RESOURCE_BY_ID[resId].name, emoji: RESOURCE_BY_ID[resId].emoji, added, lost });
        }
        const unlocked = checkAchievements(user);
        const levelsGained = addXP(user, 200);
        addUkhyr(user, 15);
        res.json({
            success: true, defeated: true, damage, weak, energy: user.energy,
            reward: { tk, res: gotRes, sp: insp.reward.sp || 0 },
            balance: user.balance, trophies: user.trophies, seasonPoints: user.seasonPoints,
            stats: user.inspectorStats, unlockedAchievements: unlocked, ...storageSnapshot(user),
            xp: user.xp, playerLevel: user.playerLevel, levelsGained, ukhyr: user.ukhyr,
        });
    });

    app.get('/api/medcom', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json({ hand: medcomHand(user) });
    });

    app.post('/api/medcom/reroll', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const s = user.medcomSession;
        if (!s) return res.json({ success: false, message: 'Ти зараз не на комісії' });
        if (s.rerolls >= ECONOMY.MEDCOM_REROLL_MAX) {
            return res.json({ success: false, message: 'Більше перекидати не можна — лікар уже щось запідозрив' });
        }
        if (user.balance < ECONOMY.MEDCOM_REROLL_COST) {
            return res.json({ success: false, message: 'Не вистачає ТК на "консультацію"' });
        }
        user.balance -= ECONOMY.MEDCOM_REROLL_COST;
        s.rerolls += 1;
        s.cards = drawSymptoms(ECONOMY.MEDCOM_HAND_SIZE);
        res.json({ success: true, balance: user.balance, hand: medcomHand(user) });
    });

    app.post('/api/medcom/submit', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const s = user.medcomSession;
        if (!s) return res.json({ success: false, message: 'Ти зараз не на комісії' });

        const picked = Array.isArray(req.body.cardIds) ? [...new Set(req.body.cardIds)] : [];
        if (picked.length !== ECONOMY.MEDCOM_PICK || !picked.every((id) => s.cards.includes(id))) {
            return res.json({ success: false, message: `Треба обрати рівно ${ECONOMY.MEDCOM_PICK} картки зі своїх` });
        }

        const idx = (user.notices || []).findIndex((n) => n.uid === s.noticeId);
        if (idx === -1) {
            user.medcomSession = null;
            return res.json({ success: false, message: 'Повістка вже неактуальна' });
        }
        const type = NOTICE_BY_ID[user.notices[idx].typeId];

        let power = picked.reduce((sum, id) => sum + symptomPower(user, id), 0);
        // Не `used`: у відповіді нижче розгортається storageSnapshot, у якого своє поле
        // used (зайнято місць у кладовці), і воно б це затерло.
        const usedBonuses = [];
        // Бонуси витрачаються НЕЗАЛЕЖНО від результату — це і є ціна спроби.
        if (req.body.useStamp && (user.resources.stamp || 0) >= 1) {
            user.resources.stamp -= 1;
            if (user.resources.stamp <= 0) delete user.resources.stamp;
            power += ECONOMY.MEDCOM_STAMP_BONUS;
            usedBonuses.push('печатка');
        }
        if (req.body.useMeds && (user.resources.meds || 0) >= ECONOMY.MEDCOM_MEDS_QTY) {
            user.resources.meds -= ECONOMY.MEDCOM_MEDS_QTY;
            if (user.resources.meds <= 0) delete user.resources.meds;
            power += ECONOMY.MEDCOM_MEDS_BONUS;
            usedBonuses.push('ліки');
        }
        if (user.petId === 'cat') {
            power += ECONOMY.MEDCOM_CAT_BONUS;
            usedBonuses.push('кіт-антистрес');
        }

        const skepticism = Math.round(ECONOMY.MEDCOM_BASE_SKEPTICISM + (user.heat || 0));
        const resolved = power >= skepticism;
        user.lastMedcomCards = picked;
        user.medcomSession = null;

        let penalty = null;
        let message;
        if (resolved) {
            user.deferUntil = Date.now() + ECONOMY.MEDCOM_DEFER_H * 3600 * 1000;
            user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.MEDCOM_SEASON_POINTS;
            user.medcomStats.passed += 1;
            user.dailyMedcom = (user.dailyMedcom || 0) + 1;
            message = `«Непридатний. Наступний!» Відстрочка на ${ECONOMY.MEDCOM_DEFER_H} годин.`;
        } else {
            penalty = applyNoticePenalty(user, type, 1);
            changeHeat(user, ECONOMY.HEAT_MEDCOM_FAIL, 'Провалив медкомісію');
            user.medcomStats.failed += 1;
            message = '«Придатний. Наступний!» Не повірили.';
        }
        finishNotice(user, idx, 'medcom', resolved);

        const unlocked = checkAchievements(user);
        res.json({
            success: true, resolved, power, skepticism, usedBonuses, message, penalty,
            deferUntil: user.deferUntil || 0, unlockedAchievements: unlocked,
            balance: user.balance, energy: user.energy, seasonPoints: user.seasonPoints,
            ...storageSnapshot(user), ...heatSnapshot(user, true), ...noticeSnapshot(user),
        });
    });
};
