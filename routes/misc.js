// Автоматично винесено з server.js (Фаза 4 модуляризації).
// Компаньйони, гардероб, декор кімнати, сезони/ліги, війна ОСББ, облава на район,
// репутація з районом, дерево навичок, щоденні квести.
module.exports = function registerMiscRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY, usersDB, clansDB, displayName,
        PETS, COSMETICS, ROOM_ITEMS, QUESTS, SKILL_BY_ID, SKILL_BRANCHES, NPC_BY_ID,
        storageSnapshot, checkAchievements, resetDailyIfNeeded, hasSkill, changeHeat,
        logOffline, sendPush, addXP, addUkhyr, applySkillLimits, repOf, repMaxed,
        seasonSnapshot, warSnapshot, matchmakeWarsIfNeeded, settleWarsIfNeeded,
        rollCrate, CRATE_BY_ID, settleDistrictRaid, districtSnapshot, serverBatchWindow,
        dailyQuestFor, questDone, reputationSnapshot, skillsSnapshot,
        skillsOwnedCount, skillPointsAvailable,
    } = deps;

    // ---- Компаньйони ----
    // Редизайн (2026-08-21, PATCH_2.0_COMPANIONS_REDESIGN.md): "купив за ТК"
    // замінено на "NPC → довіра → квест → приєднання". companionUnlocked[petId]
    // виставляється лише через /api/npc/companion-quest/claim нижче.
    app.post('/api/pet/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const pet = PETS.find((p) => p.id === req.body.petId);
        if (!pet) return res.status(400).json({ error: 'Невідомий компаньйон' });
        if (user.ownedPets.includes(pet.id)) return res.json({ success: false, message: 'Вже куплено' });
        if (!(user.companionUnlocked || {})[pet.id]) {
            return res.json({ success: false, message: 'Спочатку заслужи довіру NPC і виконай його прохання' });
        }
        if (user.balance < pet.price) return res.json({ success: false, message: 'Недостатньо ТК' });
        user.balance -= pet.price;
        user.ownedPets.push(pet.id);
        res.json({ success: true, balance: user.balance, ownedPets: user.ownedPets });
    });

    // Квест на приєднання компаньйона — окремий від щоденних квестів NPC:
    // одноразовий, не скидається щодня, доступний лише коли repMaxed.
    app.post('/api/npc/companion-quest/claim', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const npc = NPC_BY_ID[req.body.npcId];
        if (!npc) return res.json({ success: false, message: 'Такого в районі не знають' });
        if (!repMaxed(user, npc.id)) return res.json({ success: false, message: 'NPC ще недостатньо тобі довіряє' });
        const cq = (npc.companionQuests || []).find((q) => q.petId === req.body.petId);
        if (!cq) return res.json({ success: false, message: 'У цього NPC немає такого прохання' });
        if ((user.companionUnlocked || {})[cq.petId]) {
            return res.json({ success: false, message: 'Уже виконано' });
        }
        if ((user.resources[cq.res] || 0) < cq.target) {
            return res.json({ success: false, message: 'Не вистачає ресурсів' });
        }
        user.resources[cq.res] -= cq.target;
        if (user.resources[cq.res] <= 0) delete user.resources[cq.res];
        user.companionUnlocked = user.companionUnlocked || {};
        user.companionUnlocked[cq.petId] = true;
        res.json({ success: true, petId: cq.petId, ...reputationSnapshot(user), ...storageSnapshot(user) });
    });

    app.post('/api/pet/equip', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const petId = req.body.petId || null;
        if (petId && !user.ownedPets.includes(petId)) return res.json({ success: false, message: 'Спочатку купи компаньйона' });
        user.petId = petId;
        res.json({ success: true, petId: user.petId });
    });

    // ---- Гардероб (косметика) ----
    app.post('/api/cosmetic/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const item = COSMETICS.find((c) => c.id === req.body.cosmeticId);
        if (!item) return res.status(400).json({ error: 'Невідомий предмет гардеробу' });
        // Сезонну річ не можна купити ні за ТК, ні за ⭐ — тільки виграти в лізі.
        if (item.seasonOnly) return res.json({ success: false, message: 'Це нагорода сезону. Її не продають.' });
        if (user.ownedCosmetics.includes(item.id)) return res.json({ success: false, message: 'Вже куплено' });
        if (user.balance < item.price) return res.json({ success: false, message: 'Недостатньо ТК' });
        user.balance -= item.price;
        user.ownedCosmetics.push(item.id);
        user.equippedCosmetics[item.slot] = item.id; // купив — одразу вдягнув, без окремого кроку
        res.json({ success: true, balance: user.balance, ownedCosmetics: user.ownedCosmetics, equippedCosmetics: user.equippedCosmetics });
    });

    app.post('/api/cosmetic/equip', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const { slot, cosmeticId } = req.body;
        if (!['hat', 'face', 'neck', 'frame'].includes(slot)) return res.status(400).json({ error: 'Невідомий слот' });
        if (cosmeticId) {
            const item = COSMETICS.find((c) => c.id === cosmeticId && c.slot === slot);
            if (!item) return res.status(400).json({ error: 'Невідомий предмет' });
            if (!user.ownedCosmetics.includes(cosmeticId)) return res.json({ success: false, message: 'Спочатку купи цей предмет' });
        }
        user.equippedCosmetics[slot] = cosmeticId || null;
        res.json({ success: true, equippedCosmetics: user.equippedCosmetics });
    });

    // ---- Декор кімнати ----
    app.post('/api/room/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const item = ROOM_ITEMS.find((r) => r.id === req.body.itemId);
        if (!item) return res.status(400).json({ error: 'Невідома річ' });
        if (user.ownedRoomItems.includes(item.id)) return res.json({ success: false, message: 'Вже куплено' });
        if (user.balance < item.price) return res.json({ success: false, message: 'Недостатньо ТК' });
        user.balance -= item.price;
        user.ownedRoomItems.push(item.id);
        res.json({ success: true, balance: user.balance, ownedRoomItems: user.ownedRoomItems });
    });

    app.post('/api/room/toggle', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const { itemId } = req.body;
        if (!ROOM_ITEMS.some((r) => r.id === itemId)) return res.status(400).json({ error: 'Невідома річ' });
        if (!user.ownedRoomItems.includes(itemId)) return res.json({ success: false, message: 'Спочатку купи цю річ' });
        const idx = user.equippedRoomItems.indexOf(itemId);
        if (idx === -1) user.equippedRoomItems.push(itemId);
        else user.equippedRoomItems.splice(idx, 1);
        res.json({ success: true, equippedRoomItems: user.equippedRoomItems });
    });

    // ---- Сезони й ліги ----
    app.get('/api/season', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json(seasonSnapshot(user));
    });

    // ---- Війна ОСББ (клан проти клану) ----
    app.get('/api/war', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        matchmakeWarsIfNeeded();
        settleWarsIfNeeded();
        res.json(warSnapshot(user));
    });

    app.post('/api/war/crate', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (!(user.pendingWarCrate > 0)) return res.json({ success: false, message: 'Трофейних ящиків немає' });
        user.pendingWarCrate -= 1;
        // Трофейний ящик — унікальний, дістається ТІЛЬКИ з війн і за ТК не купується.
        const reward = rollCrate(user, CRATE_BY_ID['trophy']);
        res.json({ success: true, reward, balance: user.balance, ...storageSnapshot(user), pendingWarCrate: user.pendingWarCrate });
    });

    // ---- Облава на район (кооп-бос) ----
    app.get('/api/district', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const clan = user.clanId && clansDB.get(user.clanId);
        if (!clan) return res.json({ districtRaid: null, noClan: true });
        settleDistrictRaid(clan);
        res.json({ ...districtSnapshot(clan, user), heatTrigger: ECONOMY.DISTRICT_HEAT_TRIGGER,
            clanHeat: Math.round(clan.members.reduce((s, id) => s + (usersDB.get(id)?.heat || 0), 0)) });
    });

    app.post('/api/district/hit', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const clan = user.clanId && clansDB.get(user.clanId);
        if (!clan || !clan.districtRaid) return res.json({ success: false, message: 'Автобуса немає' });
        if (settleDistrictRaid(clan)) {
            return res.json({ success: false, gone: true, message: 'Не встигли. Автобус поїхав, але не порожнім.' });
        }
        const r = clan.districtRaid;

        // Той самий анти-чіт і та сама ціна енергії, що й у бою з інспектором.
        // Вікно рахує сервер; у кооп-босі воно ще й окреме для кожного учасника,
        // інакше швидкий гравець з'їдав би ліміт повільних.
        r.lastHitAt = r.lastHitAt || {};
        const holder = { startedAt: r.startedAt, lastHitAt: r.lastHitAt[user.id] };
        const dt = serverBatchWindow(holder);
        r.lastHitAt[user.id] = holder.lastHitAt;
        let clicks = Math.max(0, Math.min(Math.floor(Number(req.body.clicks) || 0), Math.ceil((dt / 1000) * ECONOMY.INSPECTOR_MAX_CPS)));
        if (!clicks) return res.json({ success: true, ...districtSnapshot(clan, user), energy: user.energy });

        if (!hasSkill(user, 'marathon')) {
            const affordable = Math.floor((user.energy || 0) / ECONOMY.INSPECTOR_ENERGY_PER_CLICK);
            clicks = Math.min(clicks, affordable);
            if (!clicks) return res.json({ success: true, outOfEnergy: true, energy: user.energy, ...districtSnapshot(clan, user) });
            user.energy = Math.max(0, user.energy - clicks * ECONOMY.INSPECTOR_ENERGY_PER_CLICK);
        }

        const damage = clicks * Math.max(1, Number(user.clickVal) || 1);
        r.hp -= damage;
        r.contributions[user.id] = (r.contributions[user.id] || 0) + damage;

        if (r.hp > 0) {
            return res.json({ success: true, damage, energy: user.energy, ...districtSnapshot(clan, user) });
        }

        // Забили. Топ-1 за внеском отримує подвійну нагороду й трофей.
        const ranked = Object.entries(r.contributions).sort((a, b) => b[1] - a[1]);
        const topId = ranked.length ? ranked[0][0] : null;
        clan.districtRaid = null;
        const rewards = [];
        for (const id of clan.members) {
            const u = usersDB.get(id);
            if (!u) continue;
            const isTop = id === topId;
            const tk = ECONOMY.DISTRICT_WIN_TK * (isTop ? 2 : 1);
            u.balance += tk;
            changeHeat(u, ECONOMY.DISTRICT_WIN_HEAT, 'Відбили облаву на район');
            u.seasonPoints = (u.seasonPoints || 0) + ECONOMY.DISTRICT_WIN_SP;
            u.pendingWarCrate = (u.pendingWarCrate || 0) + 1;
            if (isTop && !u.trophies.includes('district_top')) u.trophies.push('district_top');
            logOffline(u, 'good', `🚌 Автобус ТЦК відбито (+${tk.toLocaleString('uk-UA')} ТК)`);
            if (id !== user.id) sendPush(id, '🚌 Автобус ТЦК відбито! Забери нагороду в грі.');
            rewards.push({ name: displayName(u), tk, top: isTop });
        }
        res.json({
            success: true, defeated: true, damage, rewards, topName: (() => { const t = usersDB.get(topId); return t ? displayName(t) : null; })(),
            balance: user.balance, energy: user.energy, trophies: user.trophies,
            seasonPoints: user.seasonPoints, pendingWarCrate: user.pendingWarCrate,
        });
    });

    // ---- Репутація з районом ----
    app.get('/api/reputation', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        res.json(reputationSnapshot(user));
    });

    app.post('/api/reputation/claim', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        const npc = NPC_BY_ID[req.body.npcId];
        if (!npc) return res.json({ success: false, message: 'Такого в районі не знають' });
        const quest = dailyQuestFor(npc);
        if ((user.claimedRepQuests || []).includes(quest.id)) {
            return res.json({ success: false, message: 'Сьогодні вже допоміг. Приходь завтра.' });
        }
        if (!questDone(user, quest)) return res.json({ success: false, message: 'Ще не виконано' });

        // Ресурсні квести — це саме ВІДДАТИ: ресурси списуються безповоротно.
        if (quest.type === 'donate') {
            user.resources[quest.res] -= quest.target;
            if (user.resources[quest.res] <= 0) delete user.resources[quest.res];
            user.dailyDonated = (user.dailyDonated || 0) + quest.target;
        }

        const before = repOf(user, npc.id);
        user.reputation[npc.id] = Math.min(ECONOMY.REP_MAX, before + quest.rep);
        user.claimedRepQuests.push(quest.id);

        // Перк «Бабусина заготовка» — постійний бонус до енергії, тому видаємо його
        // рівно один раз, у момент, коли репутація вперше досягла максимуму.
        let perkUnlocked = null;
        if (before < ECONOMY.REP_MAX && repMaxed(user, npc.id)) {
            perkUnlocked = npc.perk;
            if (npc.id === 'nina') {
                user.maxEnergy += ECONOMY.REP_NINA_MAX_ENERGY;
                user.energy = user.maxEnergy;
            }
        }

        const unlocked = checkAchievements(user);
        res.json({
            success: true, message: `${npc.emoji} ${npc.name}: дякую! +${quest.rep} репутації`,
            perkUnlocked, maxEnergy: user.maxEnergy, energy: user.energy,
            unlockedAchievements: unlocked, ...reputationSnapshot(user), ...storageSnapshot(user),
        });
    });

    // ---- Дерево навичок ----
    app.get('/api/skills', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json(skillsSnapshot(user));
    });

    app.post('/api/skills/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const meta = SKILL_BY_ID[req.body.skillId];
        if (!meta) return res.json({ success: false, message: 'Невідома навичка' });
        if (user.skills[meta.id]) return res.json({ success: false, message: 'Ця навичка вже є' });
        if (skillPointsAvailable(user) < 1) {
            return res.json({ success: false, message: 'Немає вільних очок — потрібна ще одна довідка з легалізації' });
        }
        const branch = SKILL_BRANCHES.find((b) => b.id === meta.branchId);
        if (meta.index > 0 && !user.skills[branch.skills[meta.index - 1].id]) {
            return res.json({ success: false, message: `Спершу візьми «${branch.skills[meta.index - 1].name}»` });
        }
        // Гейт за рівнем схрону (розширене дерево, 2026-08-16) — окремий від
        // послідовності: тир 3 (рівень 6+) недоступний навіть з усіма попередніми
        // навичками гілки, поки гравець фізично не дійшов до потрібного схрону.
        if ((user.level || 1) < (meta.minLevel || 1)) {
            return res.json({ success: false, message: `Потрібен схрон рівня ${meta.minLevel}` });
        }

        user.skills[meta.id] = true;
        // Навички, що змінюють ліміти, треба застосувати одразу, а не лише при вході.
        applySkillLimits(user);
        res.json({
            success: true, message: `${meta.name}: ${meta.desc}`,
            maxEnergy: user.maxEnergy, ...skillsSnapshot(user),
        });
    });

    app.post('/api/skills/reset', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (!skillsOwnedCount(user)) return res.json({ success: false, message: 'Скидати нічого' });
        const cost = (user.skillResetsUsed || 0) === 0 ? 0 : ECONOMY.SKILL_RESET_COST_TK;
        if (cost && user.balance < cost) {
            return res.json({ success: false, message: `Скидання коштує ${cost.toLocaleString('uk-UA')} ТК` });
        }
        if (cost) user.balance -= cost;
        user.skills = {};
        user.skillResetsUsed = (user.skillResetsUsed || 0) + 1;
        applySkillLimits(user);
        res.json({
            success: true, message: 'Дерево скинуто. Очки повернулись — розподіляй наново.',
            balance: user.balance, maxEnergy: user.maxEnergy, ...skillsSnapshot(user),
        });
    });

    // ---- Щоденні квести ----
    app.get('/api/quests', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        res.json({
            dailyClicks: user.dailyClicks, dailyTrades: user.dailyTrades,
            dailyBoxes: user.dailyBoxes, dailyRaids: user.dailyRaids,
            dailyCrafts: user.dailyCrafts, dailyResources: user.dailyResources,
            dailyNotices: user.dailyNotices || 0, dailyMedcom: user.dailyMedcom || 0,
            dailyInspectors: user.dailyInspectors || 0, dailyExpeditions: user.dailyExpeditions || 0,
            claimedQuests: user.claimedQuests,
        });
    });

    app.post('/api/quests/claim', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        const quest = QUESTS.find((q) => q.id === req.body.questId);
        if (!quest) return res.status(400).json({ error: 'Невідомий квест' });
        if (user.claimedQuests.includes(quest.id)) return res.json({ success: false, message: 'Вже отримано сьогодні' });
        if ((user[quest.metric] || 0) < quest.target) return res.json({ success: false, message: 'Квест ще не виконано' });
        user.claimedQuests.push(quest.id);
        user.balance += quest.reward;
        const levelsGained = addXP(user, 40);
        addUkhyr(user, 3);
        res.json({
            success: true, balance: user.balance, claimedQuests: user.claimedQuests,
            xp: user.xp, playerLevel: user.playerLevel, levelsGained, ukhyr: user.ukhyr,
        });
    });
};
