// Автоматично винесено з server.js (Фаза 2 модуляризації, 2026-08-08).
const { byId } = require('../utils');
const { MAP_BUILDINGS } = require('../../catalog/map');

const MAP_BUILDING_BY_ID = byId(MAP_BUILDINGS);
function mapBuildingLevel(user, buildingId) { return (user.mapBuildings && user.mapBuildings[buildingId]) || 0; }
function mapBuildingEffect(user, buildingId) {
    const level = mapBuildingLevel(user, buildingId);
    if (level <= 0) return null;
    return MAP_BUILDING_BY_ID[buildingId].levels[level - 1];
}
// Той самий підхід, що heatRaidMult/petMult: множник шансу облави.
function mapRaidMult(user) {
    const eff = mapBuildingEffect(user, 'tower');
    return eff ? (1 - eff.raidCut) : 1;
}
function mapProtectPct(user) {
    const eff = mapBuildingEffect(user, 'cache');
    return eff ? eff.protectPct : 0;
}

module.exports = { MAP_BUILDING_BY_ID, mapBuildingLevel, mapBuildingEffect, mapRaidMult, mapProtectPct };
