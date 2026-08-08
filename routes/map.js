// Автоматично винесено з server.js (Фаза 4 модуляризації, 2026-08-08).
// Карта території: будівництво/покращення захисних споруд + вільне розміщення
// їхніх іконок на фоні карти (суто візуальне, ефекти йдуть від рівня в mapBuildings).
module.exports = function registerMapRoutes(app, deps) {
    const {
        requireTelegramAuth, getUser, MAP_BUILDING_BY_ID, RESOURCE_BY_ID,
        storageSnapshot, mapBuildingLevel,
    } = deps;

    app.post('/api/map/build', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const building = MAP_BUILDING_BY_ID[req.body.buildingId];
        if (!building) return res.status(400).json({ error: 'Невідома будівля' });
        if (!user.mapBuildings) user.mapBuildings = { tower: 0, hideout: 0, cache: 0 };

        const level = user.mapBuildings[building.id] || 0;
        if (level >= building.levels.length) {
            return res.json({ success: false, message: 'Максимальний рівень' });
        }
        const next = building.levels[level];
        for (const [resId, need] of Object.entries(next.cost)) {
            if ((user.resources[resId] || 0) < need) {
                return res.json({ success: false, message: `Не вистачає: ${RESOURCE_BY_ID[resId].name}` });
            }
        }
        for (const [resId, need] of Object.entries(next.cost)) {
            user.resources[resId] -= need;
            if (user.resources[resId] <= 0) delete user.resources[resId];
        }
        user.mapBuildings[building.id] = level + 1;

        res.json({
            success: true, message: `${building.name}: рівень ${level + 1}`,
            buildingId: building.id, mapBuildings: user.mapBuildings,
            ...storageSnapshot(user),
        });
    });

    // Вільне розміщення іконки збудованої споруди на фоні карти — суто візуальне
    // (не впливає на ефекти, ті йдуть від рівня в mapBuildings). Одна позиція на
    // тип будівлі, гравець може перетягнути/переставити будь-коли безкоштовно.
    app.post('/api/map/place', requireTelegramAuth, (req, res) => {
        const user = getUser(req.telegramUser.id, req.telegramUser.first_name);
        const building = MAP_BUILDING_BY_ID[req.body.buildingId];
        if (!building) return res.status(400).json({ error: 'Невідома будівля' });
        if (!mapBuildingLevel(user, building.id)) {
            return res.json({ success: false, message: 'Спочатку побудуй споруду' });
        }
        const x = Number(req.body.x), y = Number(req.body.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
            return res.status(400).json({ error: 'Невірні координати' });
        }
        if (!user.mapPlacements) user.mapPlacements = { tower: null, hideout: null, cache: null };
        user.mapPlacements[building.id] = { x, y };
        res.json({ success: true, mapPlacements: user.mapPlacements });
    });
};
