const HEADER_START = String.fromCharCode(29);
const HEADER_DIVIDER = String.fromCharCode(9);
const BODY_DIVIDER = String.fromCharCode(12);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const liveApiUrl = process.env.SOLO_LIVE_API || 'https://live.sooplive.co.kr/afreeca/player_live_api.php';
const searchApiUrl = process.env.SOLO_SEARCH_API || 'https://sch.sooplive.co.kr/api.php';
function makePacket(serviceCode, fields = []) {
  const body = Buffer.from(BODY_DIVIDER + fields.map(String).join(BODY_DIVIDER) + BODY_DIVIDER, 'utf8');
  const header = Buffer.from(HEADER_START + HEADER_DIVIDER + String(serviceCode).padStart(4, '0') + String(body.length).padStart(6, '0') + '00' + ZERO_UUID, 'utf8');
  return Buffer.concat([header, body]);
}

function parsePacket(data) {
  const buffer = Buffer.from(data);
  const header = buffer.subarray(0, 50).toString('utf8');
  const serviceCode = Number(header.slice(2, 6));
  const bodyLength = Number(header.slice(6, 12));
  const retCode = Number(header.slice(12, 14));
  const fields = buffer.subarray(50, 50 + bodyLength).toString('utf8').split(BODY_DIVIDER).slice(1, -1);
  return { serviceCode, retCode, fields };
}

async function getLiveInfo(bjId) {
  const body = new URLSearchParams({ bid: bjId, bno: '0', type: 'live', player_type: 'html5', stream_type: 'common', quality: 'HD', mode: 'landing', from_api: '0' });
  const response = await fetch(process.env.SOLO_LIVE_API || liveApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', origin: 'https://play.sooplive.co.kr', referer: `https://play.sooplive.co.kr/${bjId}` },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('SOOP 방송 상태 확인에 연결하지 못했습니다.');
  const payload = await response.json();
  const info = payload.CHANNEL || payload.channel || payload;
  if (Number(info.RESULT) !== 1 || !info.BNO) throw new BroadcastOfflineError();
  if (!info.CHATNO || !info.FTK) throw new Error('생방송 채팅 연결 정보가 아직 준비되지 않았습니다.');
  return info;
}

class BroadcastOfflineError extends Error {}

async function searchStreamers(keyword) {
  const query = new URLSearchParams({ l: 'DF', m: 'bjSearch', v: '3.0', w: 'webk', szKeyword: keyword, nPageNo: '1', nListCnt: '10', tab: 'bj', szOrder: 'score' });
  const response = await fetch(`${searchApiUrl}?${query}`, {
    headers: { accept: 'application/json, text/plain, */*', origin: 'https://www.sooplive.com', referer: 'https://www.sooplive.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('SOOP 검색에 연결하지 못했습니다.');
  const payload = JSON.parse(await response.text());
  const results = Array.isArray(payload.DATA) ? payload.DATA : [];
  return results.map((item) => ({
    bjId: String(item.user_id || ''),
    name: String(item.user_nick || item.station_name || item.user_id || ''),
    stationName: String(item.station_name || ''),
    profile: String(item.station_logo || ''),
    isLive: Number(item.broad_no || 0) > 0,
    broadNo: Number(item.broad_no || 0),
    title: String(item.station_title || ''),
  })).filter((item) => item.bjId);
}


export {makePacket, parsePacket, getLiveInfo, searchStreamers, BroadcastOfflineError};

