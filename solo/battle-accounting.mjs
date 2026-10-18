// SOOP code 121 GIFT / mission_gift_* is distinct from CHALLENGE_GIFT.
export function applyBattle(state, bjId, event, at = new Date().toISOString()) {
  if (!state.broadcasts.some(b => b.bjId === bjId) || !event || event.type !== 'GIFT' || event.is_relay !== false || event.bj_id !== bjId || !/^mission_gift_\d+$/.test(event.image || '')) return false;
  if (!event.uuid || !/^\d+$/.test(String(event.key)) || !event.user_id || !Number.isSafeInteger(event.gift_count) || event.gift_count <= 0) return false;
  state.battleGifts ||= {};
  const key = `${bjId}:${event.uuid}`;
  if (state.battleGifts[key]) return false;
  state.battleGifts[key] = { key, bjId, missionId: String(event.key), donorId: String(event.user_id), donor: String(event.user_nick || event.user_id), count: event.gift_count, at };
  return true;
}

export function battleView(state) {
  const donors = structuredClone(state.donors || {});
  const broadcasts = state.broadcasts.map(b => {
    const gifts = Object.values(state.battleGifts || {}).filter(g => g.bjId === b.bjId);
    donors[b.bjId] ||= {};
    for (const d of Object.values(donors[b.bjId])) d.battleTotal = 0;
    for (const g of gifts) {
      const d = donors[b.bjId][g.donorId] ||= { donorId: g.donorId, donor: g.donor, total: 0, regularTotal: 0, missionTotal: 0, battleTotal: 0, events: 0 };
      d.battleTotal += g.count;
      if (g.manual) { d.manualBattle = true; d.events++; }
    }
    return { ...b, battleTotal: gifts.reduce((sum, g) => sum + g.count, 0) };
  });
  // Never mix battle pledges into ordinary/challenge settled totals or effects.
  return { ...state, broadcasts, donors };
}

export function manualBattle(state, bjId, donor, count, remove = false) {
  if (!state.broadcasts.some(b => b.bjId === bjId) || !donor || donor.length > 50) return false;
  state.battleGifts ||= {};
  if (remove) {
    const keys = Object.keys(state.battleGifts).filter(k => { const g = state.battleGifts[k]; return g.bjId === bjId && g.manual && g.donor === donor; });
    for (const key of keys) delete state.battleGifts[key];
    return keys.length > 0;
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000000000) return false;
  const key = `manual-battle:${crypto.randomUUID()}`;
  state.battleGifts[key] = { key, bjId, donor, donorId: `manual-battle:${donor}`, count, at: new Date().toISOString(), manual: true };
  return true;
}
