// Автоматично винесено з server.js (Фаза 4 модуляризації, 2026-08-08).
// Кладовка, престиж, вилазки, ящики, крафт, апгрейди магазину, біржа,
// Колесо Зради, міні-ігри — усе, що безпосередньо крутить економіку.
module.exports = function registerEconomyRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, ECONOMY, RESOURCE_BY_ID, RESOURCES,
        storageSnapshot, storageUpgradeCost, storageCapacity, storageUsed, addResource,
        marketState, checkAchievements, prestigePointsAvailable, prestigeMultiplier,
        LOCATIONS, addXP, addUkhyr, heatSnapshot, noticeSnapshot,
        changeHeat, EXPEDITION_BY_ID, PET_EXPEDITION, expeditionSlots, expeditionSnapshot,
        hasActiveShield, addWarPoints, resetDailyIfNeeded, CRATE_BY_ID, cratePriceFor,
        rollCrate, RECIPE_BY_ID, hasSkill, UPGRADE_BASE, UPGRADE_BASE_EFFECT,
        upgEffectPerLevel, upgradeGateInfo, upgradeBatchPlan, upgradeCost,
        REVENGE_LINES, MARKET_ASSETS, repMaxed, pickWeighted, WHEEL_SEGMENTS,
        shuffled, MEMORY_ICONS, MEMORY_ENTRY_COST, memoryRewardFor,
        COINFLIP_WIN_CHANCE, RISK_TIERS,
        ROUTE_PROJECT_COST, routeProgressPct, routeProjectComplete,
    } = deps;

    // ---- Енергетик: разова покупка повного реgenу енергії ----
    // Раніше це було чисто клієнтське списання (жодної серверної перевірки
    // взагалі) — тепер валідовано й обмежено (2026-08-09): не більше
    // ENERGY_DRINK_MAX_PER_WINDOW за ENERGY_DRINK_WINDOW_MS, інакше сама ціна
    // не заважає просто спамити відновлення й обходити ліміт енергії.
    app.post('/api/energy/refill', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const now = Date.now();
        if (!Array.isArray(user.energyDrinkLog)) user.energyDrinkLog = [];
        user.energyDrinkLog = user.energyDrinkLog.filter((t) => now - t < ECONOMY.ENERGY_DRINK_WINDOW_MS);
        if (user.energyDrinkLog.length >= ECONOMY.ENERGY_DRINK_MAX_PER_WINDOW) {
            const waitMs = ECONOMY.ENERGY_DRINK_WINDOW_MS - (now - user.energyDrinkLog[0]);
            return res.json({ success: false, message: `Не більше ${ECONOMY.ENERGY_DRINK_MAX_PER_WINDOW} за 5 хв. Зачекай ${Math.ceil(waitMs / 1000)}с` });
        }
        if (user.balance < ECONOMY.ENERGY_DRINK_PRICE) return res.json({ success: false, message: 'Недостатньо ТК' });

        user.balance -= ECONOMY.ENERGY_DRINK_PRICE;
        user.energy = user.maxEnergy;
        user.energyDrinkLog.push(now);
        res.json({ success: true, balance: user.balance, energy: user.energy, maxEnergy: user.maxEnergy });
    });

    // ---- Кладовка: стан складу, апгрейд місткості, продаж ресурсів ----
    app.get('/api/storage', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json({ success: true, ...storageSnapshot(user), balance: user.balance });
    });

    app.post('/api/storage/upgrade', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.storageLevel >= ECONOMY.STORAGE_MAX_LEVEL) {
            return res.json({ success: false, message: 'Кладовка вже максимального розміру' });
        }
        const cost = storageUpgradeCost(user);
        if (user.balance < cost) return res.json({ success: false, message: 'Недостатньо ТК' });
        user.balance -= cost;
        user.storageLevel += 1;
        res.json({ success: true, balance: user.balance, ...storageSnapshot(user) });
    });

    app.post('/api/storage/sell', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const { resId } = req.body;
        const meta = RESOURCE_BY_ID[resId];
        if (!meta) return res.status(400).json({ error: 'Невідомий ресурс' });
        // TRADE LOCK (Р17, PATCH_2.0_CLAUDE_DECISIONS.md, 2026-08-16): tradeLock:
        // 'quest' — не купується, не продається взагалі, лише прогресивний ключ.
        // Раніше тут була разова латка тільки для ticket (тір 4, з аудиту
        // 2026-08-13: продаж за 9000₴ робив вилазку "Нічний візит у ТЦК" аномально
        // вигідною) — тепер формалізовано полем на самому ресурсі, охоплює й
        // Спринт-ресурси/Маршрут, які раніше через цю перевірку не проходили.
        if (meta.tradeLock === 'quest') {
            return res.json({ success: false, message: `${meta.name} не продається — тільки прогресивний ключ.` });
        }
        const have = user.resources[resId] || 0;
        const qty = req.body.all ? have : Math.min(have, Math.max(1, Number(req.body.qty) || 1));
        if (qty <= 0) return res.json({ success: false, message: 'Немає що продавати' });
        user.resources[resId] = have - qty;
        if (user.resources[resId] <= 0) delete user.resources[resId];
        // Ціна — за поточним курсом біржі (meta.sell лишається базою, навколо якої він гуляє).
        // Тому вигідно поглядати на біржу перед тим, як здавати запаси.
        let price = marketState.prices[resId] || meta.sell;
        // «Своя людина на біржі» (2026-08-16): раз на добу — гарантована преміум-
        // ціна на весь цей один продаж (не на одиницю), незалежно від курсу.
        const today = new Date().toDateString();
        let marketFriendUsed = false;
        if (hasSkill(user, 'marketfriend') && user.marketFriendUsedDate !== today) {
            price = Math.round(price * (1 + ECONOMY.SKILL_MARKETFRIEND_BONUS));
            user.marketFriendUsedDate = today;
            marketFriendUsed = true;
        }
        const earned = qty * price;
        user.balance += earned;
        res.json({ success: true, earned, price, marketFriendUsed, balance: user.balance, ...storageSnapshot(user) });
    });

    // ---- Переїзд у новий схрон (еволюція локації) ----
    // Ціна/ресурси — з catalog/locations.js (поля price/resCost на кожному рівні),
    // валідуються й списуються тут (v2.2 «Дуга ухилянта», 2026-08-08). Раніше це
    // було чисто клієнтське списання балансу — підроблений /api/save з завищеним
    // level давав би безкоштовний перехід. Купити можна лише НАСТУПНИЙ рівень по
    // черзі, не перестрибнути одразу на далекий.
    app.post('/api/location/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const nextLevel = (user.level || 1) + 1;
        if (Number(req.body.level) !== nextLevel) {
            return res.json({ success: false, message: 'Спочатку переїдь на попередній рівень' });
        }
        const loc = LOCATIONS.find((l) => l.level === nextLevel);
        if (!loc) return res.json({ success: false, message: 'Ти вже на максимальному рівні' });
        if (user.balance < (loc.price || 0)) return res.json({ success: false, message: 'Недостатньо ТК' });
        for (const [resId, need] of Object.entries(loc.resCost || {})) {
            if ((user.resources[resId] || 0) < need) {
                return res.json({ success: false, message: `Не вистачає: ${RESOURCE_BY_ID[resId].name}` });
            }
        }

        user.balance -= (loc.price || 0);
        for (const [resId, need] of Object.entries(loc.resCost || {})) {
            user.resources[resId] -= need;
            if (user.resources[resId] <= 0) delete user.resources[resId];
        }
        user.level = loc.level;
        user.maxEnergy = loc.maxEnergy;
        user.energy = user.maxEnergy;
        changeHeat(user, ECONOMY.HEAT_NEW_LOCATION, 'Переїзд у новий схрон');
        const levelsGained = addXP(user, 150);
        addUkhyr(user, 50);
        const unlocked = checkAchievements(user);

        res.json({
            success: true, message: `Переїзд: ${loc.name}`,
            level: user.level, maxEnergy: user.maxEnergy, energy: user.energy,
            balance: user.balance, unlockedAchievements: unlocked,
            xp: user.xp, playerLevel: user.playerLevel, levelsGained, ukhyr: user.ukhyr,
            ...storageSnapshot(user), ...heatSnapshot(user),
        });
    });

    // ---- Престиж: "Легалізація" ----
    // Скидає економічний прогрес заради постійного множника доходу. Косметика, досягнення,
    // кладовка й компаньйони НЕ скидаються — інакше легалізуватись було б надто боляче.
    app.get('/api/prestige', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        res.json({
            success: true,
            points: user.prestigePoints || 0,
            available: prestigePointsAvailable(user),
            multiplier: prestigeMultiplier(user),
            totalEarned: user.totalEarned || 0,
            prestigeCount: user.prestigeCount || 0,
            unlockLevel: ECONOMY.PRESTIGE_UNLOCK_LEVEL,
            unlocked: user.level >= ECONOMY.PRESTIGE_UNLOCK_LEVEL,
            bonusPerPoint: ECONOMY.PRESTIGE_BONUS_PER_POINT,
        });
    });

    app.post('/api/prestige/claim', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.level < ECONOMY.PRESTIGE_UNLOCK_LEVEL) {
            return res.json({ success: false, message: `Легалізація доступна з ${ECONOMY.PRESTIGE_UNLOCK_LEVEL} рівня схрону` });
        }
        const gain = prestigePointsAvailable(user);
        if (gain < 1) {
            return res.json({ success: false, message: 'Ще замало зароблено для легалізації' });
        }

        user.prestigePoints = (user.prestigePoints || 0) + gain;
        user.prestigeCount = (user.prestigeCount || 0) + 1;
        // Легалізація — найдорожча дія в грі, тому й найбільший разовий внесок у сезон.
        user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.SEASON_PRESTIGE_SP;

        // PATCH 2.0 Фаза 3 (2026-08-16): Легалізація БІЛЬШЕ НЕ скидає економіку.
        // Рішення Р6 (PATCH_2.0_CLAUDE_DECISIONS.md), пряма цитата розробника:
        // "стала, яку не можна змінити і крапка" — це ворота на 2-й поверх (v3
        // «Переправа», ще не реалізований), не циклічний реролл прогресу. Раніше
        // тут скидались balance/clickVal/passive/level/upgrades/portfolio/
        // expeditions/heat/notices — прибрано повністю. Гравець лишається на
        // 8 рівні з усім нажитим, отримує довідку й постійний множник доходу;
        // може легалізуватись повторно пізніше, коли totalEarned знову підросте
        // (prestigePointsAvailable вже рахує це без прив'язки до reset-циклу).

        const unlocked = checkAchievements(user);
        // Рівень ухилянта й XP — колекційні (як навички/репутація), престиж їх НЕ скидає.
        const levelsGained = addXP(user, 500);
        addUkhyr(user, 1000);
        res.json({
            success: true, gained: gain,
            points: user.prestigePoints, multiplier: prestigeMultiplier(user),
            prestigeCount: user.prestigeCount, balance: user.balance,
            clickVal: user.clickVal, passive: user.passive, level: user.level,
            energy: user.energy, maxEnergy: user.maxEnergy, upgrades: user.upgrades,
            unlockedAchievements: unlocked, ...heatSnapshot(user, true), ...noticeSnapshot(user),
            xp: user.xp, playerLevel: user.playerLevel, levelsGained, ukhyr: user.ukhyr,
        });
    });

    // ---- Вилазки (офлайн-таймер за ресурсами) ----
    app.post('/api/expedition/start', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const exp = EXPEDITION_BY_ID[req.body.expeditionId];
        if (!exp) return res.status(400).json({ error: 'Невідома вилазка' });
        const slots = expeditionSlots(user);
        if (user.expeditions.length >= slots) {
            return res.json({ success: false, message: slots > 1 ? 'Обидві нори зайняті' : 'Ти вже на вилазці' });
        }
        if (user.expeditions.some((e) => e.id === exp.id)) {
            return res.json({ success: false, message: 'Ця вилазка вже триває' });
        }
        if (user.level < exp.minLevel) return res.json({ success: false, message: `Потрібен ${exp.minLevel} рівень схрону` });

        // Голуб-курʼєр скорочує час вилазки. Фіксуємо активного компаньйона в самій вилазці,
        // щоб гравець не міг зняти його після старту й усе одно отримати бонус до здобичі.
        const pet = PET_EXPEDITION[user.petId] || {};
        const minutes = exp.minutes * (pet.timeMult || 1);
        const now = Date.now();
        user.expeditions.push({
            id: exp.id, startedAt: now, endsAt: now + minutes * 60 * 1000,
            petId: user.petId || null,
        });
        res.json({ success: true, ...expeditionSnapshot(user) });
    });

    app.post('/api/expedition/claim', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        // Забираємо конкретну вилазку (клієнт шле її id), або першу готову.
        const idx = req.body.expeditionId
            ? user.expeditions.findIndex((e) => e.id === req.body.expeditionId)
            : user.expeditions.findIndex((e) => Date.now() >= e.endsAt);
        if (idx === -1) return res.json({ success: false, message: 'Вилазки немає' });
        const active = user.expeditions[idx];
        if (Date.now() < active.endsAt) return res.json({ success: false, message: 'Вилазка ще триває' });

        const exp = EXPEDITION_BY_ID[active.id];
        user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.SEASON_EXPEDITION_SP * exp.minLevel;
        addWarPoints(user, ECONOMY.WAR_POINTS_EXPEDITION, 'завершив вилазку');
        // Компаньйон береться той, що був НА МОМЕНТ СТАРТУ вилазки (записаний у ній),
        // інакше можна було б зняти щура перед стартом і вдягнути пса перед клеймом.
        const pet = PET_EXPEDITION[active.petId] || {};
        user.expeditions.splice(idx, 1);
        user.expeditionsDone = (user.expeditionsDone || 0) + 1;
        user.dailyExpeditions = (user.dailyExpeditions || 0) + 1;

        // Щит від облав (Білий Квиток / липова довідка) прибирає ризик спалитись —
        // це робить крафт щитів осмисленим і для вилазок теж.
        const shielded = hasActiveShield(user);
        // «Легкий крок» (2026-08-16): −10% шансу провалу вилазки — множник на
        // сам ризик, стакається з компаньйоном-щуром (pet.riskMult) множенням.
        const skillRiskMult = hasSkill(user, 'lightstep') ? (1 - ECONOMY.SKILL_EXPEDITION_FAIL_CUT) : 1;
        if (!shielded && Math.random() < exp.risk * (pet.riskMult || 1) * skillRiskMult) {
            return res.json({
                success: true, caught: true,
                message: 'Тебе помітили — довелось тікати без здобичі.',
                ...storageSnapshot(user), ...expeditionSnapshot(user), balance: user.balance,
            });
        }

        // Вдала вилазка — це і здобич, і сліди: тебе бачили. Чим серйозніша вилазка,
        // тим більше уваги вона привертає.
        changeHeat(user, Math.min(ECONOMY.HEAT_EXPEDITION_CAP, ECONOMY.HEAT_EXPEDITION_PER_LEVEL * exp.minLevel), 'Вилазка: ' + exp.name);

        // «Дрібний облік» (2026-08-16): +10% ресурсів, але ТІЛЬКИ з вилазок —
        // вужче за стару «Свої люди» (ourpeople), яка бере всі джерела разом.
        const skillLootMult = hasSkill(user, 'pettycash') ? (1 + ECONOMY.SKILL_EXPEDITION_RESOURCE_BONUS) : 1;
        const gained = [];
        for (const entry of exp.loot) {
            // entry.chance (необов'язкове поле) — рідкісний шанс-дроп замість
            // гарантованої видачі (напр. 'route' з border-вилазки).
            if (entry.chance !== undefined && Math.random() >= entry.chance) continue;
            const meta = RESOURCE_BY_ID[entry.res];
            const base = entry.min + Math.random() * (entry.max - entry.min);
            const qty = Math.max(1, Math.round(base * (pet.lootMult || 1) * skillLootMult));
            const { added, lost } = addResource(user, entry.res, qty);
            if (added > 0 || lost > 0) gained.push({ emoji: meta.emoji, name: meta.name, added, lost });
        }
        const unlocked = checkAchievements(user);
        // XP лінійно між 30 (найкоротша вилазка, 30 хв) і 120 (найдовша, 720 хв) —
        // довші/ризикованіші дії винагороджують більше, як і за ТК/ресурси.
        const xpForExpedition = Math.round(30 + Math.min(1, Math.max(0, (exp.minutes - 30) / (720 - 30))) * 90);
        const levelsGained = addXP(user, xpForExpedition);
        addUkhyr(user, 5);
        res.json({
            success: true, caught: false, gained, shielded,
            unlockedAchievements: unlocked, ...storageSnapshot(user), ...expeditionSnapshot(user),
            balance: user.balance, ...heatSnapshot(user),
            xp: user.xp, playerLevel: user.playerLevel, levelsGained, ukhyr: user.ukhyr,
        });
    });

    // ---- Ящики за ігрову валюту (за Stars — через /api/invoice) ----
    app.post('/api/crate/open', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        const crate = CRATE_BY_ID[req.body.crateId];
        if (!crate) return res.status(400).json({ error: 'Невідомий ящик' });
        if (crate.currency === 'trophy') return res.json({ success: false, message: 'Трофейний ящик не продається — його треба виграти' });
        if (crate.currency !== 'coins') return res.json({ success: false, message: 'Цей ящик купується за Stars' });
        // Ціну рахує сервер (з урахуванням щоденної акції) — клієнту тут не довіряємо.
        const price = cratePriceFor(crate, user);
        if (user.balance < price) return res.json({ success: false, message: 'Недостатньо ТК на ящик' });

        user.balance -= price;
        const reward = rollCrate(user, crate);
        // Контрабанда — єдиний ящик, за яким тягнеться слід: такі контейнери помічають.
        if (crate.id === 'contraband') changeHeat(user, ECONOMY.HEAT_CONTRABAND_CRATE, 'Контрабандний контейнер');
        const unlocked = checkAchievements(user);
        res.json({
            success: true, reward, balance: user.balance,
            ownedCosmetics: user.ownedCosmetics, energy: user.energy, grannyUntil: user.grannyUntil || 0,
            unlockedAchievements: unlocked, ...storageSnapshot(user), ...heatSnapshot(user),
        });
    });

    // ---- Крафт ----
    app.post('/api/craft', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        const recipe = RECIPE_BY_ID[req.body.recipeId];
        if (!recipe) return res.status(400).json({ error: 'Невідомий рецепт' });

        for (const [resId, need] of Object.entries(recipe.cost)) {
            if ((user.resources[resId] || 0) < need) {
                return res.json({ success: false, message: `Не вистачає: ${RESOURCE_BY_ID[resId].name}` });
            }
        }
        if (recipe.effect.type === 'permanent_shield' && user.permanentShield) {
            return res.json({ success: false, message: 'Білий Квиток у тебе вже є' });
        }

        // «Схема»: іноді потрібні речі знаходяться самі, і ресурси лишаються цілі.
        const freeCraft = hasSkill(user, 'scheme') && Math.random() < ECONOMY.SKILL_CRAFT_FREE_CHANCE;
        if (!freeCraft) {
            // «Знижка гуртом» (2026-08-16): −8% вартості крафту. Кількості ресурсів
            // цілі, тому на дешевих рецептах (<12 од.) округлення вгору (ceil)
            // часто дає 0 різниці — це очікувано, ефект помітний саме на дорогих
            // рецептах (Білий Квиток, склейка донат-ящиків).
            const craftMult = hasSkill(user, 'bulkdiscount') ? (1 - ECONOMY.SKILL_CRAFT_DISCOUNT) : 1;
            for (const [resId, need] of Object.entries(recipe.cost)) {
                const actualNeed = craftMult < 1 ? Math.max(1, Math.ceil(need * craftMult)) : need;
                user.resources[resId] -= actualNeed;
                if (user.resources[resId] <= 0) delete user.resources[resId];
            }
        }
        user.craftedCount = (user.craftedCount || 0) + 1;
        user.dailyCrafts = (user.dailyCrafts || 0) + 1;
        // Тір рецепта визначаємо по найдорожчому інгредієнту: серйозний крафт — це
        // саме той, що з'їдає печатки, валюту чи квитки.
        const recipeTier = Math.max(...Object.keys(recipe.cost).map((r) => RESOURCE_BY_ID[r]?.tier || 1));
        if (recipeTier >= 3) user.seasonPoints = (user.seasonPoints || 0) + ECONOMY.SEASON_CRAFT_SP;

        const eff = recipe.effect;
        let message;
        let crateReward = null, crateId = null;
        if (eff.type === 'energy') { user.energy = user.maxEnergy; message = 'Енергію відновлено!'; }
        else if (eff.type === 'click') { user.clickVal += eff.amount; message = `+${eff.amount} до сили кліку`; }
        else if (eff.type === 'passive') { user.passive += eff.amount; message = `+${eff.amount} до пасиву`; }
        else if (eff.type === 'coins') { user.balance += eff.amount; message = `+${eff.amount.toLocaleString('uk-UA')} ТК`; }
        else if (eff.type === 'maxEnergy') { user.maxEnergy += eff.amount; user.energy = user.maxEnergy; message = `+${eff.amount} до макс. енергії`; }
        else if (eff.type === 'combo') { user.clickVal += eff.click; user.passive += eff.passive; message = `+${eff.click} клік, +${eff.passive} пасив`; }
        else if (eff.type === 'shield') {
            const base = Math.max(Date.now(), user.shieldUntil || 0);
            user.shieldUntil = base + eff.hours * 3600 * 1000;
            message = `Щит від облав на ${eff.hours} год`;
        }
        else if (eff.type === 'permanent_shield') { user.permanentShield = true; message = 'ПОСТІЙНИЙ імунітет до облав!'; addUkhyr(user, 200); }
        else if (eff.type === 'crate') {
            // Склеєний із уламків донатний ящик відкривається одразу — тією самою
            // таблицею дропу, що й куплений за Stars. Анімацію програє клієнт.
            const crate = CRATE_BY_ID[eff.crateId];
            if (!crate) return res.json({ success: false, message: 'Невідомий ящик' });
            crateReward = rollCrate(user, crate);
            crateId = crate.id;
            message = `${crate.name}: ${crateReward.title}`;
        }

        const unlocked = checkAchievements(user);
        const levelsGained = addXP(user, 15);
        res.json({
            success: true, message, recipeId: recipe.id,
            crateReward, crateId,
            balance: user.balance, clickVal: user.clickVal, passive: user.passive,
            energy: user.energy, maxEnergy: user.maxEnergy,
            shieldUntil: user.shieldUntil, permanentShield: user.permanentShield,
            craftedCount: user.craftedCount, unlockedAchievements: unlocked,
            xp: user.xp, playerLevel: user.playerLevel, levelsGained, ukhyr: user.ukhyr,
            ...storageSnapshot(user),
        });
    });

    // ---- Крафт маршруту (Р5): проєкт із накопиченням, паралельно зі старим
    // 12%-шансом-дропом із вилазки "border", не замість нього ----
    app.post('/api/route/contribute', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const resId = req.body.resId;
        const need = ROUTE_PROJECT_COST[resId];
        if (!need) return res.status(400).json({ error: 'Цей ресурс не входить у проєкт маршруту' });
        if (!user.routeContributions) user.routeContributions = { paper: 0, intel_data: 0, script: 0 };

        const already = user.routeContributions[resId] || 0;
        const remaining = Math.max(0, need - already);
        if (remaining <= 0) return res.json({ success: false, message: 'Цього ресурсу вже вистачає для проєкту' });

        const have = user.resources[resId] || 0;
        const qty = Math.min(have, remaining, Math.max(1, Number(req.body.qty) || remaining));
        if (qty <= 0) return res.json({ success: false, message: `Немає ${RESOURCE_BY_ID[resId].name}` });

        user.resources[resId] -= qty;
        if (user.resources[resId] <= 0) delete user.resources[resId];
        user.routeContributions[resId] = already + qty;

        let routeCompleted = false;
        if (routeProjectComplete(user)) {
            // Готово — видаємо 'route' і скидаємо проєкт, щоб можна було зібрати
            // ще один (наприклад про запас, чи якщо перший уже витрачено на переїзд).
            addResource(user, 'route', 1);
            user.routeContributions = { paper: 0, intel_data: 0, script: 0 };
            routeCompleted = true;
        }

        res.json({
            success: true, routeCompleted, contributed: qty,
            routeProgress: routeProgressPct(user), routeContributions: user.routeContributions,
            routeCost: ROUTE_PROJECT_COST, ...storageSnapshot(user),
        });
    });

    // ---- Багаторівневі апгрейди магазину (ціна росте з кожним рівнем) ----
    app.post('/api/upgrade/buy', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const key = req.body.key;
        if (!['hat', 'jam', 'thermos', 'generator'].includes(key)) {
            return res.status(400).json({ error: 'Невідомий апгрейд' });
        }
        // Пачками: на 40+ рівні апгрейда тиснути по одному — тортури. Скільки саме
        // рівнів по кишені, рахує сервер, бо ціна росте геометрично і клієнту тут
        // довіряти не можна.
        const want = req.body.amount === 'max' ? Infinity : Math.max(1, Math.floor(Number(req.body.amount) || 1));
        const plan = upgradeBatchPlan(user, key, want);
        if (!plan.levels) {
            const gate = upgradeGateInfo(user, key);
            return res.json({ success: false, message: gate ? 'Спочатку пробий ешелон' : 'Недостатньо ТК', gate });
        }

        user.balance -= plan.cost;
        const owned = user.upgrades[key] || 0;
        // Ефект рівня залежить від ешелону (upgEffectPerLevel), тому сумуємо по кожному
        // рівню в пачці окремо — купівля MAX через межу ешелону (де вже пробитий гейт)
        // мусить рахувати старіші рівні за старим множником, новіші — за новим.
        let effectSum = 0;
        for (let i = 0; i < plan.levels; i++) effectSum += upgEffectPerLevel(UPGRADE_BASE_EFFECT[key], owned + i);
        effectSum = Math.round(effectSum * 10) / 10;
        user.upgrades[key] += plan.levels;
        if (key === 'hat' || key === 'thermos') user.clickVal += effectSum;
        else user.passive += effectSum;
        const unlocked = checkAchievements(user);
        const levelsGained = addXP(user, 8 * plan.levels);
        res.json({
            success: true, balance: user.balance, clickVal: user.clickVal, passive: user.passive,
            upgrades: user.upgrades, nextCost: upgradeCost(user, key), nextGate: upgradeGateInfo(user, key),
            unlockedAchievements: unlocked, levelsBought: plan.levels, spent: plan.cost, effectGained: effectSum,
            xp: user.xp, playerLevel: user.playerLevel, levelsGained,
        });
    });

    // Пробити ешелон: заплатити ресурсами, щоб продовжити купувати рівні понад
    // межу (10/20/30/...). ТК за сам рівень платяться окремо, звичайним /api/upgrade/buy.
    app.post('/api/upgrade/breakTier', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const key = req.body.key;
        if (!UPGRADE_BASE[key]) return res.status(400).json({ error: 'Невідомий апгрейд' });
        const gate = upgradeGateInfo(user, key);
        if (!gate) return res.json({ success: false, message: 'Ешелон зараз не потрібно пробивати' });
        for (const [resId, qty] of Object.entries(gate.cost)) {
            if ((user.resources[resId] || 0) < qty) {
                return res.json({ success: false, message: `Не вистачає: ${RESOURCE_BY_ID[resId].name}` });
            }
        }
        for (const [resId, qty] of Object.entries(gate.cost)) {
            user.resources[resId] -= qty;
            if (user.resources[resId] <= 0) delete user.resources[resId];
        }
        if (!user.upgTiersUnlocked) user.upgTiersUnlocked = { hat: 0, jam: 0, thermos: 0, generator: 0 };
        user.upgTiersUnlocked[key] = gate.tier;
        const levelsGained = addXP(user, 60);
        res.json({
            success: true, tier: gate.tier, upgTiersUnlocked: user.upgTiersUnlocked,
            nextCost: upgradeCost(user, key), nextGate: upgradeGateInfo(user, key),
            xp: user.xp, playerLevel: user.playerLevel, levelsGained,
            ...storageSnapshot(user),
        });
    });

    // ---- Помста інспектору (флейвор, розблок після кількох виживаних облав) ----
    app.post('/api/revenge', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.raidsSurvived < ECONOMY.REVENGE_UNLOCK_RAIDS) {
            return res.json({ success: false, locked: true, message: `Спочатку переживи ${ECONOMY.REVENGE_UNLOCK_RAIDS} облави` });
        }
        const today = new Date().toDateString();
        if (user.revengeLastDate === today) {
            return res.json({ success: false, message: 'Сьогодні вже помстився. Приходь завтра.' });
        }
        const line = REVENGE_LINES[Math.floor(Math.random() * REVENGE_LINES.length)];
        const reward = Math.floor(Math.random() * (ECONOMY.REVENGE_REWARD_MAX - ECONOMY.REVENGE_REWARD_MIN)) + ECONOMY.REVENGE_REWARD_MIN;
        user.balance += reward;
        user.revengeLastDate = today;
        res.json({ success: true, line, reward, balance: user.balance });
    });

    // ---- Тіньова біржа ----
    app.get('/api/market', (req, res) => {
        res.json({ prices: marketState.prices, history: marketState.history });
    });

    app.post('/api/market/trade', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        resetDailyIfNeeded(user);
        const { assetId, action, qty } = req.body;
        const asset = MARKET_ASSETS.find((a) => a.id === assetId);
        const quantity = Number(qty);
        if (!asset || !['buy', 'sell'].includes(action) || !(quantity > 0) || !Number.isInteger(quantity)) {
            return res.status(400).json({ error: 'Невірні дані угоди' });
        }
        // TRADE LOCK (Р17): лишок уламка можна продати, але купити — ні, інакше
        // "безкоштовний шлях до донатних ящиків" перестає бути безкоштовним.
        if (action === 'buy' && asset.tradeLock === 'limited') {
            return res.json({ success: false, message: `${asset.name} не купується — тільки знахідка чи продаж лишку` });
        }
        const price = marketState.prices[assetId];
        // «Знайомий перекуп» піднімає лише ціну ПРОДАЖУ: якби він діяв і на купівлю,
        // це була б просто знижка на все, а не звʼязок із конкретним баригою.
        // Толік на максимальній репутації відкриває преміум-лот — це складається
        // з навичкою «Знайомий перекуп».
        const sellMult = 1 + (hasSkill(user, 'dealer') ? ECONOMY.SKILL_SELL_BONUS : 0)
            + (repMaxed(user, 'tolik') ? ECONOMY.REP_TOLIK_SELL_BONUS : 0);
        const sellPrice = Math.round(price * sellMult);
        const total = (action === 'sell' ? sellPrice : price) * quantity;

        if (action === 'buy') {
            if (user.balance < total) return res.json({ success: false, message: 'Недостатньо ТК' });
            // Куплене йде в кладовку, тому вона має вмістити покупку цілком —
            // інакше частина ресурсу згоріла б одразу після оплати.
            const free = storageCapacity(user) - storageUsed(user);
            if (free < quantity) {
                return res.json({ success: false, message: `У кладовці лише ${free} вільних місць` });
            }
            user.balance -= total;
            addResource(user, assetId, quantity, { bonus: false });
        } else {
            const held = user.resources[assetId] || 0;
            if (held < quantity) return res.json({ success: false, message: 'Стільки немає в кладовці' });
            user.resources[assetId] = held - quantity;
            if (user.resources[assetId] <= 0) delete user.resources[assetId];
            user.balance += total;
            // Велика разова угода не лишається непоміченою — дрібні продажі безпечні.
            if (total > ECONOMY.HEAT_MARKET_SALE_MIN) changeHeat(user, ECONOMY.HEAT_MARKET_SALE, 'Великий продаж на біржі');
        }
        user.tradesCount += 1;
        user.dailyTrades += 1;
        user.dailyTradeVolume = (user.dailyTradeVolume || 0) + total;
        const unlocked = checkAchievements(user);
        res.json({
            success: true, balance: user.balance, price: action === 'sell' ? sellPrice : price,
            unlockedAchievements: unlocked, ...storageSnapshot(user), ...heatSnapshot(user),
        });
    });

    // ---- Колесо Зради та Перемоги ----
    app.post('/api/wheel/spin', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const today = new Date().toDateString();
        if (user.wheelLastSpinDate === today) return res.json({ success: false, message: 'Колесо вже крутили сьогодні. Приходь завтра.' });

        const index = pickWeighted(WHEEL_SEGMENTS);
        const segment = WHEEL_SEGMENTS[index];
        let resultNote = null;
        if (segment.type === 'balance') user.balance += segment.amount;
        if (segment.type === 'energy') user.energy = user.maxEnergy;
        if (segment.type === 'resource') {
            // Випадковий ресурс потрібного тіру — кількість тим менша, чим цінніший тір.
            const pool = RESOURCES.filter((r) => r.tier === segment.tier);
            const meta = pool[Math.floor(Math.random() * pool.length)];
            const qty = segment.tier === 1 ? 3 + Math.floor(Math.random() * 5) : 1 + Math.floor(Math.random() * 3);
            const { added, lost } = addResource(user, meta.id, qty);
            resultNote = lost > 0
                ? `+${added} ${meta.emoji} ${meta.name} (${lost} згоріло — кладовка повна)`
                : `+${added} ${meta.emoji} ${meta.name}`;
        }
        user.wheelLastSpinDate = today;
        user.wheelSpinsCount += 1;
        const unlocked = checkAchievements(user);

        res.json({
            success: true, index, segment, resultNote,
            balance: user.balance, energy: user.energy,
            resources: user.resources, unlockedAchievements: unlocked,
        });
    });

    // ---- Міні-ігри ----

    // Швидкісна монетка: гравець ставить ТК, сервер кидає монетку (шанс і RNG —
    // тільки на сервері, клієнтська анімація суто для відчуття, не впливає на результат).
    app.post('/api/minigame/coinflip', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const stake = Math.floor(Number(req.body.stake));
        if (!Number.isFinite(stake) || stake < ECONOMY.MINIGAME_STAKE_MIN || stake > ECONOMY.MINIGAME_STAKE_MAX) {
            return res.status(400).json({ error: `Ставка від ${ECONOMY.MINIGAME_STAKE_MIN} до ${ECONOMY.MINIGAME_STAKE_MAX} ТК` });
        }
        if (user.balance < stake) return res.json({ success: false, message: 'Недостатньо ТК' });

        const won = Math.random() < COINFLIP_WIN_CHANCE;
        user.balance += won ? stake : -stake;
        const unlocked = checkAchievements(user);
        res.json({ success: true, won, stake, balance: user.balance, unlockedAchievements: unlocked });
    });

    // Колесо ризику 2.0: та сама ідея, але гравець сам обирає рівень азарту
    // (вищий множник = менший шанс), а не фіксовані 50/50.
    app.post('/api/minigame/risk', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const stake = Math.floor(Number(req.body.stake));
        const tier = RISK_TIERS.find((t) => t.id === req.body.tierId);
        if (!tier) return res.status(400).json({ error: 'Невідомий рівень ризику' });
        if (!Number.isFinite(stake) || stake < ECONOMY.MINIGAME_STAKE_MIN || stake > ECONOMY.MINIGAME_STAKE_MAX) {
            return res.status(400).json({ error: `Ставка від ${ECONOMY.MINIGAME_STAKE_MIN} до ${ECONOMY.MINIGAME_STAKE_MAX} ТК` });
        }
        if (user.balance < stake) return res.json({ success: false, message: 'Недостатньо ТК' });

        const won = Math.random() < tier.chance;
        user.balance += won ? Math.round(stake * tier.mult) - stake : -stake;
        const unlocked = checkAchievements(user);
        res.json({ success: true, won, stake, tierId: tier.id, mult: tier.mult, balance: user.balance, unlockedAchievements: unlocked });
    });

    // "Знайди пару": сервер тримає розклад карток у пам'яті гравця (не в
    // клієнті) — інакше клієнт міг би підглянути значення заздалегідь.
    app.post('/api/minigame/memory/start', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        if (user.memoryGame) return res.json({ success: false, message: 'У тебе вже є незавершена гра' });
        if (user.balance < MEMORY_ENTRY_COST) return res.json({ success: false, message: 'Недостатньо ТК на вхід' });

        user.balance -= MEMORY_ENTRY_COST;
        const deck = shuffled([...MEMORY_ICONS, ...MEMORY_ICONS]);
        user.memoryGame = { deck, revealed: deck.map(() => false), matchedPairs: 0, flips: 0, firstPick: null };
        res.json({ success: true, cardsCount: deck.length, balance: user.balance });
    });

    app.post('/api/minigame/memory/flip', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const game = user.memoryGame;
        if (!game) return res.json({ success: false, message: 'Спочатку почни гру' });
        const index = Math.floor(Number(req.body.index));
        if (!Number.isInteger(index) || index < 0 || index >= game.deck.length) {
            return res.status(400).json({ error: 'Невірна картка' });
        }
        if (game.revealed[index] || index === game.firstPick) {
            return res.json({ success: false, message: 'Ця картка вже відкрита' });
        }

        const value = game.deck[index];
        if (game.firstPick === null) {
            game.firstPick = index;
            return res.json({ success: true, index, value, matched: false, waitingForSecond: true });
        }

        game.flips += 1;
        const firstIndex = game.firstPick;
        game.firstPick = null;
        const matched = game.deck[firstIndex] === value;
        if (matched) {
            game.revealed[firstIndex] = true;
            game.revealed[index] = true;
            game.matchedPairs += 1;
        }
        const gameOver = game.matchedPairs === MEMORY_ICONS.length;
        let reward = 0;
        if (gameOver) {
            reward = memoryRewardFor(game.flips);
            user.balance += reward;
            user.memoryGame = null;
        }
        const unlocked = gameOver ? checkAchievements(user) : [];
        res.json({
            success: true, index, value, matched, firstIndex, flips: game.flips,
            matchedPairs: game.matchedPairs, gameOver, reward, balance: user.balance,
            unlockedAchievements: unlocked,
        });
    });
};
