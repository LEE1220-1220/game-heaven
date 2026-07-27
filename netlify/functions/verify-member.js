// 게임천국 ↔ 검증천국 대시보드 회원 연동 (읽기 전용 프록시)
// 게임천국 브라우저 → 이 함수 → 대시보드에 "이 아이디 회원 맞아?" 확인 → 닉네임 반환
//
// 비밀값은 Netlify 환경변수로 보관되어 브라우저에 절대 노출되지 않습니다:
//   DASH_BASE      = https://kj-holdem.fly.dev
//   DASH_LOGIN_ID  = (대시보드 '읽기 전용' 계정 아이디)
//   DASH_PW        = (그 계정 비밀번호)
//
// 요청(POST):  { "userId": "입력한아이디" }
// 응답:        { ok:true, isMember:true, nickname:"..." }  또는  { ok:true, isMember:false }

let cache = { at: 0, map: null };      // 웜 인스턴스 캐시 (대시보드 부하 감소)
const TTL_MS = 60 * 1000;              // 60초마다 새로 읽음 → 회원 추가가 최대 1분 내 반영

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')
    return json(405, { ok: false, error: 'POST만 허용됩니다.' });

  let userId = '';
  try { userId = String(JSON.parse(event.body || '{}').userId || '').trim(); } catch (e) {}
  if (!userId) return json(200, { ok: false, error: '아이디를 입력해 주세요.' });

  const BASE = process.env.DASH_BASE;
  const LOGIN = process.env.DASH_LOGIN_ID;
  const PW = process.env.DASH_PW;
  if (!BASE || !LOGIN || !PW)
    return json(200, { ok: false, error: '연동 설정이 아직 없습니다. (Netlify 환경변수 확인)' });

  try {
    const map = await getMembers(BASE, LOGIN, PW);
    const nick = map.get(userId.toLowerCase());
    if (nick === undefined) return json(200, { ok: true, isMember: false });
    return json(200, { ok: true, isMember: true, nickname: nick });
  } catch (e) {
    return json(200, { ok: false, error: '회원 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

// 대시보드 회원 목록을 {아이디(소문자) -> 닉네임} 맵으로 가져온다 (캐시 적용)
async function getMembers(BASE, LOGIN, PW) {
  if (cache.map && (Date.now() - cache.at) < TTL_MS) return cache.map;

  // 1) 읽기 전용 계정으로 로그인 → 토큰
  const lr = await fetch(BASE + '/api/dash/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: LOGIN, pw: PW }),
  });
  const lj = await lr.json();
  if (!lj || !lj.ok || !lj.token) throw new Error('dashboard login failed');

  // 2) 중앙 저장소 조회 → DB.members 를 담은 행을 찾는다
  const sr = await fetch(BASE + '/api/dash/store', {
    headers: { authorization: 'Bearer ' + lj.token },
  });
  const sj = await sr.json();
  if (!sj || !sj.ok || !Array.isArray(sj.rows)) throw new Error('dashboard store failed');

  let members = null;
  for (const row of sj.rows) {
    try {
      const v = JSON.parse(row.value);
      if (v && Array.isArray(v.members)) { members = v.members; break; }
    } catch (e) {}
  }
  if (!members) members = [];

  const map = new Map();
  for (const m of members) {
    const id = String(m.userId || '').trim().toLowerCase();
    if (id) map.set(id, String(m.nickname || m.userId || '').trim());
  }
  cache = { at: Date.now(), map };
  return map;
}
