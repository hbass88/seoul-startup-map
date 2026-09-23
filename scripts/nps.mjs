// 국민연금공단_국민연금 가입 사업장 내역 (data.go.kr 3046071) 으로 최근 12개월 입사/퇴사 집계
// DATA_GO_KR_KEY (일반 인증키, Decoding 값) 필요. 사업장 매칭은 회사명 + 서울 + 구 이름으로 한다.
// 공단 API는 월 단위 스냅샷이라 한 번에 12개월을 못 받는 경우, 매일 실행하며 월별로 쌓는다.
const BASES = [
  'https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2',
  'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService',
];
const OPS = { v2: ['getBassInfoSearchV2', 'getPdAcctoSttusInfoSearchV2', 'getDetailInfoSearchV2'], v1: ['getBassInfoSearch', 'getPdAcctoSttusInfoSearch', 'getDetailInfoSearch'] };

const items = j => {
  const it = j?.response?.body?.items?.item ?? j?.response?.body?.items ?? [];
  return Array.isArray(it) ? it : it ? [it] : [];
};
const norm = s => String(s || '').replace(/\(주\)|주식회사|㈜|\s|\.|,|-/g, '').toLowerCase();

async function call(base, op, params, key) {
  const u = new URL(`${base}/${op}`);
  u.searchParams.set('serviceKey', key);
  u.searchParams.set('dataType', 'json');
  u.searchParams.set('numOfRows', '50');
  u.searchParams.set('pageNo', '1');
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${op} ${r.status}`);
  const t = await r.text();
  if (t.trim().startsWith('<')) throw new Error(`${op} XML 응답: ${t.slice(0, 120)}`);
  return JSON.parse(t);
}

export async function npsHistory(state, ids, key, log) {
  // 동작하는 엔드포인트/파라미터 스타일 탐색
  let base, ops;
  for (const b of BASES) {
    const o = b.endsWith('V2') ? OPS.v2 : OPS.v1;
    try { await call(b, o[0], { wkpl_nm: '원티드랩', ldong_addr_mgpl_dg_cd: '11' }, key); base = b; ops = o; break; }
    catch (e) { log('NPS 탐색 실패', b, e.message); }
  }
  if (!base) return;
  const months = [];
  const d = new Date();
  for (let i = 1; i <= 13; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}`); }

  let n = 0;
  for (const id of ids) {
    const c = state.co[id];
    const rec = state.nps[id] ||= { chart: [] };
    try {
      if (!rec.seq) {
        const list = items(await call(base, ops[0], { wkpl_nm: c.name.replace(/\(주\)|주식회사|㈜/g, '').trim(), ldong_addr_mgpl_dg_cd: '11' }, key));
        const m = list.find(x => norm(x.wkplNm).includes(norm(c.name)) && (!c.dist || String(x.wkplRoadNmDtlAddr || '').includes(c.dist))) ||
                  list.find(x => norm(x.wkplNm).includes(norm(c.name)));
        if (!m) { rec.miss = Date.now(); continue; }
        rec.seq = m.seq; rec.name = m.wkplNm;
      }
      const have = new Set(rec.chart.map(x => x[0].replace('-', '')));
      for (const ym of months) {
        if (have.has(ym)) continue;
        const it = items(await call(base, ops[1], { seq: rec.seq, data_crt_ym: ym }, key))[0];
        if (!it) continue;
        const det = items(await call(base, ops[2], { seq: rec.seq, data_crt_ym: ym }, key))[0];
        rec.chart.push([`${ym.slice(0, 4)}-${ym.slice(4)}`, det ? +det.jnngpCnt : null, +it.nwAcqzrCnt || 0, +it.lssJnngpCnt || 0]);
      }
      rec.chart.sort((a, b) => a[0] < b[0] ? -1 : 1);
      rec.chart = rec.chart.slice(-12);
      if (++n % 50 === 0) log('NPS', n);
    } catch (e) { log('NPS', c.name, e.message); }
  }
}
