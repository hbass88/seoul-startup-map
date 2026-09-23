// 공용 변환 로직: 원티드 / THE VC 원천 데이터를 사이트용 companies.json 레코드로 만든다.

export const INVEST_CATS = [17, 19, 23, 34];
export const WELFARE_CATS = [1, 6, 7, 8, 9];
export const BADGE_CATS = [2, 10, 14, 15, 19, 23, 29, 30, 34];

export const isBig = c =>
  (c.tags || []).some(([, t]) => /대기업|10,001명이상|1,001~10,000명/.test(t)) || !!c.ticker;
export const hasInvest = c => (c.tags || []).some(([k]) => INVEST_CATS.includes(k));

// 스타트업 후보: 서울, 위치 있음, 대기업/상장사 제외, 투자 태그 있거나 2012년 이후 설립
export const isCandidate = c =>
  c && c.geo && !isBig(c) && c.status !== 'CLOSED' && (hasInvest(c) || (c.founded || 0) >= 2012);

// 최종 포함: 원티드 투자 태그가 있거나 THE VC에 투자 라운드가 확인된 스타트업
export const isStartup = (c, vc) =>
  isCandidate(c) &&
  (hasInvest(c) || (vc && vc.stage && (!vc.type || /스타트업/.test(vc.type))));

export function sumChart(chart) {
  const pts = (chart || []).filter(x => x[2] != null || x[3] != null);
  if (!pts.length) return { h12: null, l12: null, net12: null, hm: 0 };
  const last12 = pts.slice(-12);
  const h = last12.reduce((s, x) => s + (x[2] || 0), 0);
  const l = last12.reduce((s, x) => s + (x[3] || 0), 0);
  return { h12: h, l12: l, net12: h - l, hm: last12.length };
}

export function buildCompany(w, vc, emp, jobs, nps) {
  const tags = w.tags || [];
  const inv = tags.filter(([k]) => k === 17).map(([, t]) => t);
  let chart = (emp && emp.chart) || [];
  if (nps && nps.chart && nps.chart.length > chart.length) chart = nps.chart;
  const s = sumChart(chart);
  const origin = (vc && vc.origin) || (tags.some(([, t]) => /외국계/.test(t)) ? '외국계' : null);
  return {
    id: w.id,
    n: w.name,
    ind: w.industry || null,
    nts: w.ntsClass || null,
    fy: w.founded || (vc && vc.fy ? +vc.fy.slice(0, 4) : null),
    fym: vc && vc.fy || null,
    addr: w.addr || null,
    dist: w.dist || null,
    lat: w.geo ? +(+w.geo.lat).toFixed(6) : null,
    lng: w.geo ? +(+w.geo.lng).toFixed(6) : null,
    logo: w.logo || null,
    web: w.link || null,
    desc: w.desc || null,
    emp: w.emp ?? (vc && vc.vcEmp ? vc.vcEmp[1] : null),
    empM: chart.length ? chart[chart.length - 1][0] : (vc && vc.vcEmp ? vc.vcEmp[0] : null),
    sal: w.salary || null,
    sales: w.sales || null,
    salesY: w.salesYear || null,
    ceo: w.ceo || (vc && vc.ceo) || null,
    cto: null,
    stage: vc && vc.stage || null,
    rounds: vc && vc.rounds || null,
    market: vc && vc.market || null,
    vc: vc && vc.vc || null,
    origin,
    inv: inv[0] || null,
    fund: (vc && vc.fund) || (inv.includes('누적투자100억이상') || inv.some(t => /유니콘/.test(t)) ? '100억 이상' : null),
    fundAgo: vc && vc.fund ? vc.fundAgo : null,
    welfare: tags.filter(([k]) => WELFARE_CATS.includes(k)).map(([, t]) => t),
    badges: tags.filter(([k]) => BADGE_CATS.includes(k)).map(([, t]) => t),
    resp: w.resp ? Math.round(+w.resp) : null,
    chart,
    ...s,
    jobs: (jobs || []).map(j => ({
      id: j.id, t: j.pos, af: j.af ?? null, at: j.at ?? null,
      posted: j.d?.posted || null, due: j.d?.due || j.due || null,
      type: j.d?.emp || null, note: j.d?.note || null,
      rounds: normRounds(j.d?.rounds), remote: !!j.d?.remote, newbie: !!j.d?.newbie,
      cat: j.d?.cat || null, visa: j.d?.visa ? true : false,
    })),
  };
}

function normRounds(r) {
  if (!r) return [];
  if (!Array.isArray(r)) {
    const line = String(r).split('\n').find(l => /[＞>→]/.test(l)) || '';
    const steps = line.replace(/^[\s•\-*·|:0-9.)]+/, '').replace(/^(채용\s*)?전형\s*(절차|단계)?\s*[:：|]?\s*/, '').replace(/^[^:：]{1,12}[:：]\s*/, '').split(/\s*[＞>→]\s*/).map(s => s.trim()).filter(s => s && s.length < 30);
    return steps.length >= 2 ? steps : [];
  }
  return r.map(x => typeof x === 'string' ? x : (x.title || x.name || x.text || x.round_name || '')).filter(Boolean);
}

export const parseNextData = html => {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  return m ? JSON.parse(m[1]) : null;
};

export function wantedCompanyFromPage(id, html) {
  const d = parseNextData(html);
  if (!d) return null;
  const q = Object.fromEntries((d.props.pageProps.dehydrateState?.queries || []).map(x => [x.queryKey[0], x.state.data]));
  const i = q.companyInfo || {}, s = q.companySummary || {};
  if (!i.name) return null;
  return {
    id, name: i.name, hash: i.regNoHash, industry: i.industryName, founded: i.foundedYear, status: i.status,
    tags: (i.mainTags || []).concat(i.companyTags || []).map(t => [t.tag_category_id, t.title]),
    desc: (i.description || '').slice(0, 500), link: i.link, logo: i.logo,
    addr: i.address?.full_location, dist: i.address?.district, geo: i.address?.geo_location?.location,
    resp: i.applicationResponseStats?.avg_rate, ceo: s.detail?.ownerName || null, corpType: s.detail?.corpType,
    ntsClass: s.detail?.classNameByNts,
    emp: s.employee?.total ?? s.detail?.npsEmployeeCount ?? s.detail?.eiEmployeeCount,
    salary: s.salary?.salary, sales: s.sales?.total, salesYear: s.sales?.updatedAt, ticker: s.detail?.tickerSymbol,
  };
}

export function wantedJobFromPage(html) {
  const d = parseNextData(html);
  const x = d?.props?.pageProps?.initialData;
  if (!x) return null;
  return {
    posted: x.confirm_time, due: x.due_time, close: x.close_time, emp: x.employment_type, note: x.employment_note,
    rounds: x.hire_rounds, remote: x.is_remote_work, newbie: x.career?.is_newbie,
    cat: x.category_tag?.parent_tag?.text || null, visa: x.visa_information || null,
  };
}

const norm = s => String(s || '').replace(/\(주\)|주식회사|㈜|\s|\.|,|-/g, '').toLowerCase();
const strip = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

export function pickVcMatch(list, name) {
  return (list || []).find(x => norm(x.name) === norm(name)) ||
    (list || []).find(x => x.searchedReason?.category === '기업명' && norm(x.name).includes(norm(name)) && norm(name).length >= 3);
}

export function parseVcPage(m, html) {
  const d = (html.match(/name="description" content="([^"]*)"/) || [])[1] || '';
  const t = strip(html);
  const rd = t.match(/투자 라운드 \((\d+)건\) (.+?) 투자 유치/);
  const fu = t.match(/투자 유치 \(([^)]*)\) ([\d,.]+(?:조|억|만)?[^ ]*) /);
  const st = t.match(/상태 (비상장|상장|폐업|인수합병|[가-힣]+) /);
  const fy = d.match(/(\d{4})년 (\d{1,2})월에 설립/);
  const ceo = d.match(/대표자는 (.+?)입니다/);
  const org = d.match(/(한국계|외국계)/);
  const emp = t.match(/임직원 수 \((\d{4}-\d{2})\) ([\d,]+)명/);
  return {
    vc: m.profilePage, type: m.type, market: m.marketParent || null,
    stage: rd ? rd[2].trim() : null, rounds: rd ? +rd[1] : null,
    fy: fy ? fy[1] + '-' + fy[2].padStart(2, '0') : null, ceo: ceo ? ceo[1] : null,
    origin: org ? org[1] : null, vcEmp: emp ? [emp[1], +emp[2].replace(/,/g, '')] : null,
    fund: fu && !/필요/.test(fu[2]) ? fu[2] : null, fundAgo: fu ? fu[1] : null, status: st ? st[1] : null,
  };
}

// 동시 n개, 요청 사이 delay(ms). fn 이 'STOP' 을 던지면 전체 중단 (WAF 차단 감지 시)
export async function pool(items, n, fn, delay = 0) {
  let i = 0, stop = false;
  await Promise.all(Array.from({ length: n }, async () => {
    while (!stop && i < items.length) {
      const x = items[i++];
      try { await fn(x); } catch (e) { if (e && e.message === 'STOP') stop = true; }
      if (delay) await new Promise(r => setTimeout(r, delay));
    }
  }));
  return !stop;
}

// ---- 사람인 / 잡코리아 공고 병합 ----
const tnorm = (s, co) => {
  let x = String(s || '').toLowerCase();
  for (const n of co) if (n) x = x.split(n.toLowerCase()).join('');
  return x.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ').replace(/[^0-9a-z가-힣]/g, '');
};
const bigrams = s => { const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; };
const sim = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) return 0.9;
  const A = bigrams(a), B = bigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size || 1);
};
const yearFix = (mm, dd, ref = new Date()) => {
  let y = ref.getFullYear();
  const d = new Date(y, mm - 1, dd);
  if (d - ref > 200 * 864e5) y -= 1; else if (ref - d > 200 * 864e5) y += 1;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};
const typeFrom = arr => {
  const s = (arr || []).join(' ');
  if (/정규직/.test(s)) return 'regular';
  if (/계약직/.test(s)) return 'contract';
  if (/인턴/.test(s)) return 'intern';
  if (/파견/.test(s)) return 'dispatch';
  if (/프리랜서/.test(s)) return 'freelancer';
  return null;
};

export function srJob(x) {
  const reg = (x.d || '').match(/(\d\d)\/(\d\d)\/(\d\d)/);
  const due = (x.due || '').match(/(\d\d)\/(\d\d)/);
  return {
    src: '사람인', url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${x.idx}`, t: x.t,
    type: typeFrom(x.cond), career: (x.cond || []).find(c => /신입|경력/.test(c)) || null,
    posted: reg ? `20${reg[1]}-${reg[2]}-${reg[3]}` : null,
    due: due ? yearFix(+due[1], +due[2]) : null, loc: (x.cond || [])[0] || null,
  };
}
export function jkJob(x) {
  const reg = (x.reg || '').match(/(\d\d)\/(\d\d)/);
  const due = (x.due || '').match(/(\d\d)\/(\d\d)/);
  return {
    src: '잡코리아', url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${x.gid}`, t: x.t,
    type: typeFrom([x.type, x.kw]), career: x.career || null,
    posted: reg ? yearFix(+reg[1], +reg[2]) : null, due: due ? yearFix(+due[1], +due[2]) : null, loc: x.loc || null,
  };
}

// 원티드 공고(jobs)에 사람인/잡코리아 공고(extra)를 붙인다. 제목이 비슷하면 하나로 합치고 지원 링크만 추가.
export function mergeJobs(jobs, extra, coNames) {
  const out = jobs.map(j => ({ ...j, links: [{ src: '원티드', url: `https://www.wanted.co.kr/wd/${j.id}` }], _n: tnorm(j.t, coNames) }));
  for (const e of extra) {
    const n = tnorm(e.t, coNames);
    let best = null, bs = 0;
    for (const o of out) { const s = sim(n, o._n); if (s > bs) { bs = s; best = o; } }
    if (best && bs >= 0.72) {
      if (!best.links.some(l => l.src === e.src)) best.links.push({ src: e.src, url: e.url });
      best.type ||= e.type; best.posted ||= e.posted; best.due ||= e.due;
      if (!best.careerTxt && e.career) best.careerTxt = e.career;
    } else {
      out.push({ id: null, t: e.t, type: e.type, posted: e.posted, due: e.due, careerTxt: e.career, rounds: [], links: [{ src: e.src, url: e.url }], _n: n });
    }
  }
  return out.map(({ _n, ...j }) => j);
}
