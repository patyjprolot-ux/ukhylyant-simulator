// Медична гілка (PATCH 2.0 Р18 v3, 2026-08-16) — окрема сюжетна вкладка,
// НЕ реакція на повістку. Вилазка "Лікарня" незалежна від інших локацій
// (не дає прокачувальних ресурсів), направлення+документи, платна здача
// аналізів (свій QTE-рушій, окремий від медкома-довідки), крафт хвороби,
// підтвердження в медичній картці — все описано в
// PATCH_2.0_MEDICAL_QUESTLINE.md.
module.exports = function registerHospitalRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY,
        DISEASES, DISEASE_BY_ID, DISEASE_TIER_CONFIG, HOSPITAL_FLAVOR,
        addResource, storageSnapshot, shuffled,
    } = deps;

    function tierCfgFor(disease) {
        return DISEASE_TIER_CONFIG[disease ? disease.tier : 1];
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
        res.json({
            success: true,
            diseases: diseaseListSnapshot(user),
            activeDisease: user.activeDisease,
            referral: user.resources.referral || 0,
            session: analysisSnapshot(user),
            hospitalCostTk: tierCfgFor(user.activeDisease && DISEASE_BY_ID[user.activeDisease]).hospitalCostTk,
            hospitalEnergy: tierCfgFor(user.activeDisease && DISEASE_BY_ID[user.activeDisease]).hospitalEnergy,
        });
    });

    // Вилазка в лікарню: незалежна від інших локацій, не дає прокачувальних
    // ресурсів. Три можливі наслідки залежно від стану активної хвороби —
    // рахуємо результат ДО списання плати, щоб не брати гроші за візит,
    // з якого свідомо нема чого привезти (документи вже всі зібрані,
    // або вже є направлення про запас).
    app.post('/api/hospital/visit', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const disease = user.activeDisease ? DISEASE_BY_ID[user.activeDisease] : null;

        if (disease && user.diseasesDiagnosed[disease.id]) {
            // Підтвердження — окрема, дешевша "візит" дія: діагноз уже готовий,
            // просто вносимо в картку.
            const cfg = tierCfgFor(disease);
            if (user.balance < cfg.hospitalCostTk) return res.json({ success: false, message: 'Не вистачає ТК на візит' });
            if ((user.energy || 0) < cfg.hospitalEnergy) return res.json({ success: false, message: 'Не вистачає енергії' });
            user.balance -= cfg.hospitalCostTk;
            user.energy -= cfg.hospitalEnergy;
            user.diseases[disease.id] = true;
            delete user.diseasesDiagnosed[disease.id];
            delete user.diseaseDocuments[disease.id];
            delete user.diseaseAnalysisProgress[disease.id];
            user.activeDisease = null;
            return res.json({
                success: true, outcome: 'confirmed', diseaseId: disease.id, diseaseName: disease.name,
                flavor: shuffled(HOSPITAL_FLAVOR)[0],
                balance: user.balance, energy: user.energy,
            });
        }

        if (disease) {
            const have = user.diseaseDocuments[disease.id] || [];
            const missing = disease.documents.filter((doc) => !have.includes(doc.id));
            if (!missing.length) {
                return res.json({ success: false, message: 'Усі документи вже зібрані — час здавати аналізи.' });
            }
            const cfg = tierCfgFor(disease);
            if (user.balance < cfg.hospitalCostTk) return res.json({ success: false, message: 'Не вистачає ТК на візит' });
            if ((user.energy || 0) < cfg.hospitalEnergy) return res.json({ success: false, message: 'Не вистачає енергії' });
            user.balance -= cfg.hospitalCostTk;
            user.energy -= cfg.hospitalEnergy;
            const doc = missing[0];
            user.diseaseDocuments[disease.id] = [...have, doc.id];
            return res.json({
                success: true, outcome: 'document', diseaseId: disease.id,
                docId: doc.id, docName: doc.name, docFlavor: doc.flavor,
                docsHave: have.length + 1, docsNeeded: disease.documents.length,
                flavor: shuffled(HOSPITAL_FLAVOR)[0],
                balance: user.balance, energy: user.energy,
            });
        }

        // Немає активної хвороби.
        if ((user.resources.referral || 0) >= 1) {
            return res.json({ success: false, message: 'У тебе вже є направлення — обери хворобу, перш ніж їхати знову.' });
        }
        const cfg = tierCfgFor(null);
        if (user.balance < cfg.hospitalCostTk) return res.json({ success: false, message: 'Не вистачає ТК на візит' });
        if ((user.energy || 0) < cfg.hospitalEnergy) return res.json({ success: false, message: 'Не вистачає енергії' });
        user.balance -= cfg.hospitalCostTk;
        user.energy -= cfg.hospitalEnergy;
        const { added } = addResource(user, 'referral', 1, { bonus: false });
        return res.json({
            success: true, outcome: 'referral', added,
            flavor: shuffled(HOSPITAL_FLAVOR)[0],
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
