import { battleView } from './battle-accounting.mjs';
export function applyMission(state, bjId, event, at = new Date().toISOString()) {
  if (!state.broadcasts.some(b => b.bjId === bjId) || !event || event.is_relay === true || (event.bj_id && event.bj_id !== bjId)) return false;
  if (!['CHALLENGE_GIFT', 'CHALLENGE_NOTICE', 'CHALLENGE_SETTLE'].includes(event.type)) return false;
  const id = String(event.key || '');
  if (!/^\d+$/.test(id)) return false;
  state.missions ||= {};
  const key = `${bjId}:${id}`;
  const mission = state.missions[key] ||= { key, bjId, missionId: id, title: '', status: 'pending', contributions: [], seen: [], settled: 0, registeredAt: at };
  if (!event.uuid || mission.seen.includes(String(event.uuid))) return false;
  if (event.type === 'CHALLENGE_GIFT' && (!Number.isSafeInteger(event.gift_count) || event.gift_count <= 0)) return false;
  if (event.type === 'CHALLENGE_SETTLE' && (!Number.isSafeInteger(event.settle_count) || event.settle_count <= 0)) return false;
  mission.seen.push(String(event.uuid));
  mission.title = String(event.title || mission.title).slice(0, 500);
  mission.updatedAt = at;
  if (event.type === 'CHALLENGE_GIFT') {
    mission.contributions.push({ donorId: String(event.user_id || ''), donor: String(event.user_nick || event.user_id || '미확인 후원자'), count: event.gift_count, at });
  } else if (event.type === 'CHALLENGE_NOTICE' && !mission.settledAt) {
    mission.status = ({ SUCCESS: 'success', FAIL: 'failed', FAILED: 'failed', FAILURE: 'failed', CANCEL: 'cancelled', CANCELED: 'cancelled', CANCELLED: 'cancelled' })[event.mission_status] || 'unknown';
    mission.rawStatus = String(event.mission_status || '');
  } else if (event.type === 'CHALLENGE_SETTLE' && !mission.settledAt) {
    mission.settled = event.settle_count;
    mission.settledAt = at;
    mission.status = 'settled';
  }
  return true;
}

// Stored regular totals remain independent; derive combined totals exactly once.
export function accountingView(state) {
  const missions = Object.values(state.missions || {});
  const donors = structuredClone(state.donors || {});
  const broadcasts = state.broadcasts.map(b => {
    const mine = missions.filter(m => m.bjId === b.bjId);
    const settled = mine.filter(m => m.settledAt);
    const missionTotal = settled.reduce((sum, m) => sum + m.settled, 0);
    donors[b.bjId] ||= {};
    for (const d of Object.values(donors[b.bjId])) { d.regularTotal = d.total; d.missionTotal = 0; }
    let unassignedMissionTotal = 0;
    for (const m of settled) {
      if (m.contributions.reduce((sum, c) => sum + c.count, 0) !== m.settled || m.contributions.some(c => !c.donorId)) { unassignedMissionTotal += m.settled; continue; }
      for (const c of m.contributions) {
        const donor = donors[b.bjId][c.donorId] ||= { donorId: c.donorId, donor: c.donor, total: 0, regularTotal: 0, missionTotal: 0, events: 0 };
        donor.total += c.count; donor.missionTotal += c.count; donor.events++;
      }
    }
    return { ...b, regularTotal: b.total, missionTotal, total: b.total + missionTotal, unassignedMissionTotal };
  });
  const missionGifts = missions.filter(m => m.settledAt && broadcasts.some(b => b.bjId === m.bjId)).map(m => ({ key: `mission:${m.key}`, bjId: m.bjId, broadcastName: broadcasts.find(b => b.bjId === m.bjId).name, donor: '도전미션 정산', donorId: '', count: m.settled, at: m.settledAt, kind: 'mission', missionTitle: m.title, message: '' }));
  const gifts = [...state.gifts, ...missionGifts].sort((a,b) => b.at.localeCompare(a.at)).slice(0,1000);
  return battleView({ ...state, broadcasts, donors, gifts });
}

export function nearbyChat(state, bjId, fields, at = new Date().toISOString()) {
  const donorId = String(fields[1] || '').replace(/\(\d+\)$/, '');
  const text = String(fields[0] || '').trim().slice(0, 1000);
  if (!text || !donorId) return false;
  const now = Date.parse(at);
  const matches = state.gifts.filter(g => g.bjId === bjId && g.donorId === donorId && !g.manual && now >= Date.parse(g.at) && now - Date.parse(g.at) <= 30000);
  if (matches.length !== 1) return false;
  const gift = matches[0];
  gift.nearbyComments ||= [];
  if (gift.nearbyComments.length >= 3 || gift.nearbyComments.some(c => c.text === text)) return false;
  const comment = { text, at, count: gift.count, giftKey: gift.key, source: 'nearby-chat' };
  gift.nearbyComments.push(comment);
  const donor = state.donors[bjId]?.[donorId];
  if (donor) donor.comments = [comment, ...(donor.comments || [])].slice(0, 50);
  return true;
}
