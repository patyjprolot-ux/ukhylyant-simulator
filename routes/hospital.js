// Медична гілка (PATCH 2.0 Р18 v3, 2026-08-16) — окрема сюжетна вкладка,
// НЕ реакція на повістку. Вилазка "Лікарня" незалежна від інших локацій
// (не дає прокачувальних ресурсів), направлення+документи, платна здача
// аналізів (свій QTE-рушій, окремий від медкома-довідки), крафт хвороби,
// підтвердження в медичній картці — все описано в
// PATCH_2.0_MEDICAL_QUESTLINE.md.
module.exports = function registerHospitalRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY, RESOURCE_BY_ID,
        DISEASES, DISEASE_BY_ID, DISEASE_TIER_CONFIG, HOSPITAL_FLAVOR,
        addResource, storageSnapshot, shuffled, changeHeat, checkAchievements,
    } = deps;

    function tierCfgFor(disease) {
        return DISEASE_TIER_CONFIG[disease ? disease.tier : 1];
    }

    // Чи вистачає на всю ціну вилазки (гроші + ресурси) — енергію перевіряємо
    // окремо, бо повідомлення про неї людяніше окремим рядком.
    function missingHospitalRes(user, cfg) {
        for (const [resId, need] of Object.entries(cfg.hospitalRes || {})) {
            if ((user.resources[resId] || 0) < need) return RESOURCE_BY_ID[resId].name;
        }
        return null;
    }
    function payHospitalCost(user, cfg) {
        user.balance -= cfg.hospitalCostTk;
        user.energy -= cfg.hospitalEnergy;
        for (const [resId, need] of Object.entries(cfg.hospitalRes || {})) {
            user.resources[resId] -= need;
            if (user.resources[resId] <= 0) delete user.resources[resId];
        }
    }

    // ---- Здача аналізів: окремий QTE-рушій, простіший за медком-довідку ----
    // (менше раундів, фіксоване вікно без прив'язки до heat — це не про розшук).
    function activateAnalysisRound(session) {
        const left = session.cards.map((_, i) => i).filter((i) => !session.usedIdx.includes(i));
        if (!left.length) { session.activeIdx = null; return; }
        session.activeIdx = left[Math.floor(Math.random() * left.length)];
        session.activeAt = Date.now();
    }
    function settleExpiredAnalysisRound(session) {
        if (session.activeIdx === null || Date.now() - session.activeAt <= ECONOMY.DISEASE_QTE_WINDOW_MS) return;
        session.usedIdx.push(session.activeIdx);
        session.misses = (session.misses || 0) + 1;
        activateAnalysisRound(session);
    }
    function analysisSnapshot(user) {
        const s = user.diseaseAnalysisSession;
        if (!s) return null;
        settleExpiredAnalysisRound(s);
        const disease = DISEASE_BY_ID[s.diseaseId];
        const cardById = {};
        for (const c of disease.analysisCards) cardById[c.id] = c;
        return {
            diseaseId: s.diseaseId,
            hits: s.hits || 0, misses: s.misses || 0,
            roundsLeft: s.cards.length - s.usedIdx.length,
            hitsNeeded: ECONOMY.DISEASE_ANALYSIS_HITS_NEEDED,
            activeIdx: s.activeIdx,
            msLeft: s.activeIdx === null ? 0 : Math.max(0, ECONOMY.DISEASE_QTE_WINDOW_MS - (Date.now() - s.activeAt)),
            windowMs: ECONOMY.DISEASE_QTE_WINDOW_MS,
            done: s.activeIdx === null,
            cards: s.cards.map((id) => ({ id, name: cardById[id].name, emoji: cardById[id].emoji })),
            usedIdx: s.usedIdx,
        };
    }

    function diseaseListSnapshot(user) {
        return DISEASES.map((d) => {
            const cfg = tierCfgFor(d);
            return {
                id: d.id, name: d.name, emoji: d.emoji, tier: d.tier, minLevel: d.minLevel, desc: d.desc,
                locked: (user.level || 1) < d.minLevel,
                owned: !!user.diseases[d.id],
                diagnosed: !!user.diseasesDiagnosed[d.id],
                isActive: user.activeDisease === d.id,
                documents: d.documents.map((doc) => ({
                    id: doc.id, name: doc.name, flavor: doc.flavor,
                    have: (user.diseaseDocuments[d.id] || []).includes(doc.id),
                })),
                analysisProgress: user.diseaseAnalysisProgress[d.id] || 0,
                analysisNeeded: cfg.analysesNeeded,
                analysisCostTk: cfg.analysisCostTk, analysisEnergy: cfg.analysisEnergy,
            };
        });
    }

    app.get('/api/disease', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const cfg = tierCfgFor(user.activeDisease && DISEASE_BY_ID[user.activeDisease]);
        res.json({
            success: true,
            diseases: diseaseListSnapshot(user),
            activeDisease: user.activeDisease,
            referral: user.resources.referral || 0,
            session: analysisSnapshot(user),
            hospitalCostTk: cfg.hospitalCostTk, hospitalEnergy: cfg.hospitalEnergy,
            hospitalRes: cfg.hospitalRes, hospitalRiskPct: cfg.riskPct,
        });
    });

    // Вилазка в лікарню: незалежна від інших локацій, не дає прокачувальних
    // ресурсів. Три можливі наслідки залежно від стану активної хвороби —
    // рахуємо, ЩО мало б статись, ДО списання плати (щоб не брати гроші за
    // візит, з якого свідомо нема чого привезти — документи вже всі зібрані,
    // або вже є направлення про запас), а вже ПІСЛЯ цього кидаємо ризик.
    // Ризик (2026-08-16, доробка за прямою вимогою розробника з первинного
    // ТЗ) — гроші/енергія/ресурси списуються в будь-якому разі (ціна спроби),
    // heat росте, а сам намічений наслідок (документ/направлення/
    // підтвердження) НЕ відбувається — той самий принцип, що вже є в
    // "провалених" вилазках/облавах деінде в грі.
    app.post('/api/hospital/visit', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const disease = user.activeDisease ? DISEASE_BY_ID[user.activeDisease] : null;

        let plan; // 'confirm' | 'document' | 'referral' | null (нема чого привезти)
        if (disease && user.diseasesDiagnosed[disease.id]) plan = 'confirm';
        else if (disease) {
            const have = user.diseaseDocuments[disease.id] || [];
            plan = disease.documents.some((doc) => !have.includes(doc.id)) ? 'document' : null;
            if (plan === null) return res.json({ success: false, message: 'Усі документи вже зібрані — час здавати аналізи.' });
        } else {
            if ((user.resources.referral || 0) >= 1) {
                return res.json({ success: false, message: 'У тебе вже є направлення — обери хворобу, перш ніж їхати знову.' });
            }
            plan = 'referral';
        }

        const cfg = tierCfgFor(disease);
        if (user.balance < cfg.hospitalCostTk) return res.json({ success: false, message: 'Не вистачає ТК на візит' });
        if ((user.energy || 0) < cfg.hospitalEnergy) return res.json({ success: false, message: 'Не вистачає енергії' });
        const missingRes = missingHospitalRes(user, cfg);
        if (missingRes) return res.json({ success: false, message: `Не вистачає: ${missingRes}` });

        payHospitalCost(user, cfg);
        user.hospitalVisits = (user.hospitalVisits || 0) + 1;
        const caught = Math.random() < cfg.riskPct;
        if (caught) {
            changeHeat(user, cfg.riskHeat, 'Ризикована вилазка в лікарню');
            return res.json({
                success: true, outcome: 'caught',
                message: 'Мало не спалився в реєстратурі — довелось тікати ні з чим.',
                flavor: shuffled(HOSPITAL_FLAVOR)[0], unlockedAchievements: checkAchievements(user),
                balance: user.balance, energy: user.energy, ...storageSnapshot(user),
            });
        }

        if (plan === 'confirm') {
            user.diseases[disease.id] = true;
            delete user.diseasesDiagnosed[disease.id];
            delete user.diseaseDocuments[disease.id];
            delete user.diseaseAnalysisProgress[disease.id];
            user.activeDisease = null;
            return res.json({
                success: true, outcome: 'confirmed', diseaseId: disease.id, diseaseName: disease.name,
                flavor: shuffled(HOSPITAL_FLAVOR)[0], unlockedAchievements: checkAchievements(user),
                balance: user.balance, energy: user.energy,
            });
        }
        if (plan === 'document') {
            const have = user.diseaseDocuments[disease.id] || [];
            const doc = disease.documents.find((d) => !have.includes(d.id));
            user.diseaseDocuments[disease.id] = [...have, doc.id];
            return res.json({
                success: true, outcome: 'document', diseaseId: disease.id,
                docId: doc.id, docName: doc.name, docFlavor: doc.flavor,
                docsHave: have.length + 1, docsNeeded: disease.documents.length,
                flavor: shuffled(HOSPITAL_FLAVOR)[0], unlockedAchievements: checkAchievements(user),
                balance: user.balance, energy: user.energy,
            });
        }
        // plan === 'referral'
        const { added } = addResource(user, 'referral', 1, { bonus: false });
        return res.json({
            success: true, outcome: 'referral', added,
            flavor: shuffled(HOSPITAL_FLAVOR)[0], unlockedAchievements: checkAchievements(user),
            balance: user.balance, energy: user.energy, ...storageSnapshot(user),
        });
    });

    app.post('/api/disease/start', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.activeDisease) return res.json({ success: false, message: 'У тебе вже є активна хвороба' });
        if ((user.resources.referral || 0) < 1) return res.json({ success: false, message: 'Немає направлення — спершу вилазка в лікарню' });
        const disease = DISEASE_BY_ID[req.body.diseaseId];
        if (!disease) return res.status(400).json({ error: 'Невідома хвороба' });
        if ((user.level || 1) < disease.minLevel) return res.json({ success: false, message: `Потрібен ${disease.minLevel} рівень схрону` });
        if (user.diseases[disease.id]) return res.json({ success: false, message: 'Цю хворобу вже отримано' });
        user.resources.referral -= 1;
        if (user.resources.referral <= 0) delete user.resources.referral;
        user.activeDisease = disease.id;
        user.diseaseDocuments[disease.id] = [];
        user.diseaseAnalysisProgress[disease.id] = 0;
        res.json({ success: true, activeDisease: user.activeDisease, diseases: diseaseListSnapshot(user), balance: user.balance, ...storageSnapshot(user) });
    });

    app.post('/api/disease/analysis/start', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const disease = user.activeDisease && DISEASE_BY_ID[user.activeDisease];
        if (!disease) return res.json({ success: false, message: 'Немає активної хвороби' });
        if (user.diseaseAnalysisSession) return res.json({ success: false, message: 'Здача аналізів уже триває' });
        const have = user.diseaseDocuments[disease.id] || [];
        if (have.length < disease.documents.length) return res.json({ success: false, message: 'Спершу збери всі документи' });
        const cfg = tierCfgFor(disease);
        if ((user.diseaseAnalysisProgress[disease.id] || 0) >= cfg.analysesNeeded) {
            return res.json({ success: false, message: 'Аналізів уже досить — постав діагноз' });
        }
        if (user.balance < cfg.analysisCostTk) return res.json({ success: false, message: 'Не вистачає ТК на аналізи' });
        if ((user.energy || 0) < cfg.analysisEnergy) return res.json({ success: false, message: 'Не вистачає енергії' });
        user.balance -= cfg.analysisCostTk;
        user.energy -= cfg.analysisEnergy;
        const rounds = Math.min(ECONOMY.DISEASE_ANALYSIS_ROUNDS, disease.analysisCards.length);
        const cards = shuffled(disease.analysisCards.map((c) => c.id)).slice(0, rounds);
        user.diseaseAnalysisSession = { diseaseId: disease.id, cards, usedIdx: [], activeIdx: null, activeAt: 0, hits: 0, misses: 0 };
        activateAnalysisRound(user.diseaseAnalysisSession);
        res.json({ success: true, session: analysisSnapshot(user), balance: user.balance, energy: user.energy });
    });

    app.post('/api/disease/analysis/tap', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const s = user.diseaseAnalysisSession;
        if (!s) return res.json({ success: false, message: 'Здача аналізів ще не почата' });
        settleExpiredAnalysisRound(s);

        let hit = null;
        if (s.activeIdx !== null) {
            const onTime = Date.now() - s.activeAt <= ECONOMY.DISEASE_QTE_WINDOW_MS;
            const correct = req.body.cardId === s.cards[s.activeIdx];
            hit = onTime && correct;
            s.usedIdx.push(s.activeIdx);
            if (hit) s.hits = (s.hits || 0) + 1; else s.misses = (s.misses || 0) + 1;
            activateAnalysisRound(s);
        }
        if (s.activeIdx !== null) {
            return res.json({ success: true, hit, done: false, session: analysisSnapshot(user) });
        }

        const resolved = s.hits >= ECONOMY.DISEASE_ANALYSIS_HITS_NEEDED;
        const diseaseId = s.diseaseId;
        user.diseaseAnalysisSession = null;
        if (resolved) {
            user.diseaseAnalysisProgress[diseaseId] = (user.diseaseAnalysisProgress[diseaseId] || 0) + 1;
        }
        res.json({
            success: true, hit, done: true, resolved, hits: s.hits, misses: s.misses,
            diseaseId, diseases: diseaseListSnapshot(user),
            balance: user.balance, energy: user.energy,
        });
    });

    app.post('/api/disease/craft', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const disease = user.activeDisease && DISEASE_BY_ID[user.activeDisease];
        if (!disease) return res.json({ success: false, message: 'Немає активної хвороби' });
        if (user.diseasesDiagnosed[disease.id]) return res.json({ success: false, message: 'Діагноз уже поставлено — іди підтвердити в лікарню' });
        const have = user.diseaseDocuments[disease.id] || [];
        if (have.length < disease.documents.length) return res.json({ success: false, message: 'Бракує документів' });
        const cfg = tierCfgFor(disease);
        if ((user.diseaseAnalysisProgress[disease.id] || 0) < cfg.analysesNeeded) {
            return res.json({ success: false, message: 'Бракує здач аналізів' });
        }
        user.diseasesDiagnosed[disease.id] = true;
        res.json({ success: true, diseaseId: disease.id, diseaseName: disease.name, diseases: diseaseListSnapshot(user) });
    });
};
