// 매일 GitHub Actions에서 실행: 원티드 서울 공고 갱신 + 신규 스타트업 탐지 + THE VC 보강 + (선택) 국민연금 입퇴사
// 사용: node scripts/update.mjs            (전체 갱신)
//       node scripts/update.mjs --build-only (state.json 으로 companies.json 만 재생성)
import fs from 'node:fs/promises';
import {
  isCandidate, isStartup, buildCompany, wantedCompanyFromPage, wantedJobFromPage,
  pickVcMatch, parseVcPage, pool,
} from './lib.mjs';
import { npsHistory } from './nps.mjs';

const STATE = 'data/state.json';
const OUT = 'data/companies.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };
const DAY = 864e5;
const now = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 403/405/429 또는 사람 확인 페이지는 차단으로 보고 STOP (재시도하지 않음)
const get = async (url, type = 'text', tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: H });
      if (r.status === 404) return null;
      if ([202, 403, 405, 429].includes(r.status)) throw new Error('STOP');
      if (!r.ok) throw new Error(r.status);
      if (type === 'text') { const t = await r.text(); if (/Human Verification|awswaf/.test(t.slice(0, 3000))) throw new Error('STOP'); return t; }
      return type === 'json' ? await r.json() : await r.text();
    } catch (e) { if (e.message === 'STOP' || i === tries - 1) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
};

const state = JSON.parse(await fs.readFile(STATE, 'utf8').catch(() => '{}'));
for (const k of ['co', 'vc', 'emp', 'jd', 'rejected', 'vcTried', 'nps']) state[k] ||= {};
state.jobs ||= [];

if (!process.argv.includes('--build-only')) {
  // 1. 서울 전체 공고
  const W = 'https://www.wanted.co.kr';
  let jobs = [];
  try {
    for (let off = 0; off < 30000; off += 100) {
      const j = await get(`${W}/api/v4/jobs?country=kr&locations=seoul.all&limit=100&offset=${off}&job_sort=job.latest_order`, 'json');
      if (!j?.data?.length) break;
      for (const x of j.data) jobs.push({ id: x.id, cid: x.company.id, pos: x.position, dist: x.address?.district, af: x.annual_from, at: x.annual_to, due: x.due_time });
    }
  } catch (e) { log('원티드 공고 수집 실패:', e.message); }
  log('공고', jobs.length);
  if (jobs.length < 1000) { log('공고 수가 비정상적으로 적어 이번 갱신을 건너뜀'); process.exit(0); }
  state.jobs = jobs;

  // 2. 회사: 신규는 탐지, 기존은 7일마다 새로고침
  const ids = [...new Set(jobs.map(j => j.cid))];
  const todo = ids.filter(id => {
    if (state.co[id]) return now - (state.co[id]._t || 0) > 7 * DAY;
    return !state.rejected[id] || now - state.rejected[id] > 30 * DAY;
  });
  log('회사 페이지 조회', todo.length);
  await pool(todo.slice(0, 800), 3, async id => {
    const html = await get(`${W}/company/${id}`);
    const w = html && wantedCompanyFromPage(id, html);
    if (w && isCandidate(w)) { state.co[id] = { ...w, _t: now }; delete state.rejected[id]; }
    else { delete state.co[id]; state.rejected[id] = now; }
  }, 200) || log('원티드 회사 조회 차단 감지, 중단');

  // 3. THE VC 보강: 사이트 부담을 줄이려고 한 번에 한 곳씩, 5초 간격, 실행당 최대 120곳. 차단되면 바로 멈춤
  const vcTodo = Object.values(state.co)
    .filter(c => !state.vcTried[c.id] || now - state.vcTried[c.id] > 45 * DAY)
    .sort((a, b) => (b.tags.length - a.tags.length));
  log('THE VC 대상', vcTodo.length);
  const vcOk = await pool(vcTodo.slice(0, 120), 1, async c => {
    const q = c.name.replace(/\(.*?\)/g, '').trim() || c.name;
    const list = await get(`https://thevc.kr/api/search/organizations/for-autocomplete?keyword=${encodeURIComponent(q)}&limit=5`, 'json');
    const m = pickVcMatch(list, c.name) || pickVcMatch(list, q);
    if (m) { const html = await get(`https://thevc.kr/${m.profilePage}`); if (html) state.vc[c.id] = parseVcPage(m, html); }
    state.vcTried[c.id] = now;
  }, 5000);
  if (!vcOk) log('THE VC 차단 감지, 다음 실행에서 이어서');

  // 4. 공고 상세 (게시일, 고용형태, 전형)
  const incl = new Set(Object.values(state.co).filter(c => isStartup(c, state.vc[c.id])).map(c => c.id));
  const jdTodo = jobs.filter(j => incl.has(j.cid) && !state.jd[j.id]);
  log('공고 상세', jdTodo.length);
  const jdOk = await pool(jdTodo.slice(0, 2000), 2, async j => {
    const html = await get(`${W}/wd/${j.id}`);
    const d = html && wantedJobFromPage(html);
    if (d) state.jd[j.id] = d;
  }, 400);
  if (!jdOk) log('원티드 공고 상세 차단 감지, 다음 실행에서 이어서');
  const open = new Set(jobs.map(j => String(j.id)));
  for (const k of Object.keys(state.jd)) if (!open.has(k)) delete state.jd[k];

  // 5. 국민연금 월별 입사/퇴사 (DATA_GO_KR_KEY 있을 때만)
  if (process.env.DATA_GO_KR_KEY) {
    try { await npsHistory(state, [...incl], process.env.DATA_GO_KR_KEY, log); }
    catch (e) { log('국민연금 API 실패:', e.message); }
  }
  state.updated = new Date().toISOString();
}

// 6. companies.json 생성
const byCid = {};
for (const j of state.jobs) (byCid[j.cid] ||= []).push({ ...j, d: state.jd[j.id] });
const companies = Object.values(state.co)
  .filter(c => isStartup(c, state.vc[c.id]))
  .map(c => buildCompany(c, state.vc[c.id], state.emp[c.id], byCid[c.id], state.nps[c.id]))
  .filter(c => c.lat && c.lng);
const meta = {
  updated: state.updated || new Date().toISOString(),
  companies: companies.length,
  jobs: companies.reduce((s, c) => s + c.jobs.length, 0),
  sources: ['원티드 (공고, 기업정보, 국민연금 인원/연봉, KODATA 매출)', 'THE VC (투자단계, 대표자, 한국계/외국계)', '국민연금공단 공공데이터 (선택)'],
};
await fs.writeFile(OUT, JSON.stringify({ meta, companies }));
await fs.writeFile(STATE, JSON.stringify(state));
log('완료', meta);
