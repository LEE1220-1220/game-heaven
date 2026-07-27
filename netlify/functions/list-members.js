// 게임천국 관리자용 — 검증천국 대시보드 전체 회원 명단 가져오기 (읽기 전용)
// 관리자 키(ADMIN_KEY)로 보호됨. 아이디 목록이 공개되면 안 되므로 반드시 키가 필요합니다.
//
// Netlify 환경변수:
//   ADMIN_KEY      = (관리자만 아는 임의의 키)
//   DASH_BASE / DASH_LOGIN_ID / DASH_PW  = (verify-member 와 동일, 대시보드 읽기전용 계정)
//
// 요청(POST, 헤더 x-admin-key): 응답 { ok:true, members:[{id,nick,level,joined}] }
// 민감정보(실명·메신저ID)는 반환하지 않습니다.

let cache = { at: 0, list: null };
const TTL_MS = 30 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST만 허용됩니다.' });

  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'] || '';
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return json(200, { ok: false, needKey: true, error: '관리자 키가 올바르지 않습니다.' });
  }

  const BASE = process.env.DASH_BASE, LOGIN = process.env.DASH_LOGIN_ID, PW = process.env.DASH_PW;
  if (!BASE || !LOGIN || !PW) return json(200, { ok: false, error: '연동 설정이 없습니다.' });

  try {
    const list = await getMembers(BASE, LOGIN, PW);
    return json(200, { ok: true, members: list });
  } catch (e) {
    return json(200, { ok: false, error: '명단을 불러오지 못했습니다.' });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

async function getMembers(BASE, LOGIN, PW) {
  if (cache.list && (Date.now() - cache.at) < TTL_MS) return cache.list;

  const lr = await fetch(BASE + '/api/dash/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: LOGIN, pw: PW }),
  });
  const lj = await lr.json();
  if (!lj || !lj.ok || !lj.token) throw new Error('dashboard login failed');

  const sr = await fetch(BASE + '/api/dash/store', { headers: { authorization: 'Bearer ' + lj.token } });
  const sj = await sr.json();
  if (!sj || !sj.ok || !Array.isArray(sj.rows)) throw new Error('dashboard store failed');

  let members = null;
  for (const row of sj.rows) {
    try { const v = JSON.parse(row.value); if (v && Array.isArray(v.members)) { members = v.members; break; } } catch (e) {}
  }
  if (!members) members = [];

  const list = members
    .map(function (m) {
      return {
        id: String(m.userId || '').trim(),
        nick: String(m.nickname || m.userId || '').trim(),
        level: (m.level != null ? m.level : ''),
        joined: (m.joined_at || '').slice(0, 10),
      };
    })
    .filter(function (m) { return m.id; });

  cache = { at: Date.now(), list };
  return list;
}
