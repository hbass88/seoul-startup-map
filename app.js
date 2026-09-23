(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const enc = encodeURIComponent;
const fmtN = n => n == null ? '-' : n.toLocaleString('ko-KR');
const fmtWon = n => {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + '조';
  if (Math.abs(n) >= 1e8) return Math.round(n / 1e8).toLocaleString('ko-KR') + '억';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  return n.toLocaleString('ko-KR');
};
const fmtDate = s => s ? s.slice(0, 10).replace(/-/g, '.') : '-';
const daysAgo = s => { if (!s) return null; return Math.floor((Date.now() - new Date(s).getTime()) / 864e5); };
const agoTxt = s => { const d = daysAgo(s); if (d == null) return ''; if (d <= 0) return '오늘'; if (d < 31) return d + '일 전'; if (d < 365) return Math.floor(d / 30) + '개월 전'; return Math.floor(d / 365) + '년 전'; };

const STAGES = [
  ['seed', '시드/엔젤', 'var(--s-seed)', /seed|angel|시드|엔젤|pre-a|프리a|pre a/i],
  ['a', '시리즈 A', 'var(--s-a)', /series a|시리즈 ?a/i],
  ['b', '시리즈 B', 'var(--s-b)', /series b|시리즈 ?b/i],
  ['c', '시리즈 C', 'var(--s-c)', /series c|시리즈 ?c/i],
  ['late', '시리즈 D 이상/Pre-IPO', 'var(--s-late)', /series [d-z]|pre-ipo|ipo|m&a|bridge|시리즈 ?[d-z]/i],
];
const stageKey = s => { if (!s) return 'na'; for (const [k, , , re] of STAGES) if (re.test(s)) return k; return 'na'; };
const stageColor = k => (STAGES.find(x => x[0] === k) || [0, 0, 'var(--s-na)'])[2];
const cssVar = v => v.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v;

const periodTxt = c => !c.hm ? '1년' : c.hm >= 12 ? '1년' : c.hm === 1 ? `${(c.empM || '').slice(5).replace(/^0/, '')}월` : `최근 ${c.hm}개월`;
const EMP_TYPE = { regular: '정규직', contract: '계약직', intern: '인턴', freelancer: '프리랜서', part_time: '파트타임', dispatch: '파견직', REGULAR: '정규직', CONTRACT: '계약직', INTERN: '인턴' };
const empTypeTxt = t => t ? (EMP_TYPE[t] || t) : '정보없음';

const ROLES = [['dev', '개발'], ['data', '데이터·AI'], ['qa', 'QA·테스트'], ['design', '디자인'], ['pm', '기획·PM'], ['mkt', '마케팅'], ['sales', '영업·BD'], ['biz', '경영·HR·재무'], ['ops', '운영·CS'], ['etc', '기타']];
const roleName = k => (ROLES.find(r => r[0] === k) || [0, ''])[1];
let bubbleRenderer, DATA = [], META = {}, map, heat, bubbles, heatMode = 'jobs', selId = null, filtered = [], role = '', jobTab = 'role';

const extLinks = c => {
  const n = enc(c.n.replace(/\(.*?\)/g, '').trim() || c.n);
  return [
    ['원티드', `https://www.wanted.co.kr/company/${c.id}`],
    ['THE VC', c.vc ? `https://thevc.kr/${c.vc}` : `https://thevc.kr/integrated-search/overview?keyword=${n}`],
    ['혁신의숲', c.inno && c.inno.cp ? `https://www.innoforest.co.kr/company/${c.inno.cp}` : `https://www.innoforest.co.kr/search?keyword=${n}`],
    ['잡플래닛', c.jp ? `https://www.jobplanet.co.kr/companies/${c.jp.id}` : `https://www.jobplanet.co.kr/search?query=${n}`],
    ['블라인드', `https://www.teamblind.com/kr/company/${c.bl ? enc(c.bl.name) : n}`],
    ['사람인', `https://www.saramin.co.kr/zf_user/search?searchword=${n}`],
    ['잡코리아', `https://www.jobkorea.co.kr/Search/?stext=${n}`],
    ['그룹바이', `https://groupby.kr/search?keyword=${n}`],
    ['로켓펀치', `https://www.rocketpunch.com/companies?keywords=${n}`],
    ['캐치', c.ct ? `https://www.catch.co.kr/Comp/CompSummary/${c.ct.id}` : `https://www.catch.co.kr/Search/SearchList?Keyword=${n}`],
    ['링크드인', `https://www.linkedin.com/search/results/companies/?keywords=${n}`],
    ['뉴스', `https://search.naver.com/search.naver?where=news&query=${n}`],
  ];
};

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([37.5326, 126.99], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.createPane('heatPane'); map.getPane('heatPane').style.zIndex = 350; map.getPane('heatPane').style.pointerEvents = 'none';
  map.createPane('bubblePane'); map.getPane('bubblePane').style.zIndex = 450;
  bubbleRenderer = L.svg({ pane: 'bubblePane', padding: 0.5 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  bubbles = L.layerGroup().addTo(map);
}

function heatWeight(c) {
  if (heatMode === 'jobs') return c.jobsShown;
  if (heatMode === 'emp') return Math.sqrt(c.emp || 0);
  if (heatMode === 'growth') return Math.max(0, c.net12 || 0);
  return 0;
}

function drawMap() {
  bubbles.clearLayers();
  if (heat) { map.removeLayer(heat); heat = null; }
  if (heatMode !== 'none') {
    const pts = filtered.map(c => [c.lat, c.lng, heatWeight(c)]).filter(p => p[2] > 0);
    const max = Math.max(1, ...pts.map(p => p[2])) * 0.5;
    heat = L.heatLayer(pts, { pane: 'heatPane', radius: 30, blur: 24, maxZoom: 15, max, minOpacity: 0.2,
      gradient: { 0.15: '#c7d2fe', 0.4: '#818cf8', 0.65: '#a855f7', 0.85: '#ec4899', 1: '#f43f5e' } }).addTo(map);
  }
  for (const c of [...filtered].sort((a, b) => (b.emp || 0) - (a.emp || 0))) {
    const r = Math.max(5, Math.min(26, 3 + Math.sqrt(c.emp || 1) * 1.1));
    const col = cssVar(stageColor(c.sk));
    const m = L.circleMarker([c.lat, c.lng], { renderer: bubbleRenderer, pane: 'bubblePane', radius: r, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: c.id === selId ? 1 : .82, bubblingMouseEvents: false });
    m.bindTooltip(`<b>${esc(c.n)}</b><br>${esc(c.stage || c.ind || '')} · ${fmtN(c.emp)}명<br>${role ? roleName(role) + ' ' : ''}공고 ${c.jobsShown}건`, { direction: 'top', offset: [0, -r], className: 'tip' });
    m.on('click', e => { L.DomEvent.stopPropagation(e); openDetail(c.id, false); });
    m.on('mouseover', () => m.setStyle({ weight: 3, fillOpacity: 1 }));
    m.on('mouseout', () => m.setStyle({ weight: 1.5, fillOpacity: c.id === selId ? 1 : .82 }));
    bubbles.addLayer(m);
  }
}

function drawRoles() {
  const f = currentFilters();
  const base = DATA.filter(c => (!f.ind || c.ind === f.ind) && (!f.stage || c.sk === f.stage) && (!f.dist || c.dist === f.dist) && (!f.q || c._s.includes(f.q)));
  const cnt = {}; let all = 0;
  for (const c of base) for (const j of c.jobs) { cnt[j.role] = (cnt[j.role] || 0) + 1; all++; }
  $('#roles').innerHTML = `<button class="role ${role ? '' : 'on'}" data-role="">전체 직무 <em>${all.toLocaleString()}</em></button>` +
    ROLES.map(([k, t]) => `<button class="role ${role === k ? 'on' : ''}" data-role="${k}">${t} <em>${(cnt[k] || 0).toLocaleString()}</em></button>`).join('');
  $('#roles').querySelectorAll('.role').forEach(b => b.onclick = () => { role = b.dataset.role; jobTab = 'role'; listLimit = 150; apply(); if (selId) openDetail(selId, false); });
}

function drawLegend() {
  const items = STAGES.map(([k, t, col]) => `<span><i style="background:${col}"></i>${t}</span>`).join('') +
    `<span><i style="background:var(--s-na)"></i>단계 미확인</span><span>크기 = 인원</span>`;
  $('#legend').innerHTML = items;
}

function currentFilters() {
  return {
    q: $('#q').value.trim().toLowerCase(), ind: $('#f-ind').value, stage: $('#f-stage').value,
    size: $('#f-size').value, dist: $('#f-dist').value, hiring: $('#f-hiring').checked,
    ft: $('#f-fulltime').checked, foreign: $('#f-foreign').checked, growing: $('#f-growing').checked,
    sort: $('#sort').value
  };
}

function apply() {
  const f = currentFilters();
  filtered = DATA.filter(c => {
    c.jobsShown = c.jobs.filter(j => (!role || j.role === role) && (!f.ft || !j.type || /regular|정규/i.test(j.type))).length;
    if (role && !c.jobsShown) return false;
    if (f.hiring && !c.jobsShown) return false;
    if (f.ind && c.ind !== f.ind) return false;
    if (f.stage && c.sk !== f.stage) return false;
    if (f.dist && c.dist !== f.dist) return false;
    if (f.foreign && c.origin !== '외국계') return false;
    if (f.growing && !(c.net12 > 0)) return false;
    if (f.size) { const [a, b] = f.size.split('-').map(Number); if (!(c.emp >= a && c.emp <= b)) return false; }
    if (f.q && !c._s.includes(f.q)) return false;
    return true;
  });
  const key = {
    jobs: c => c.jobsShown, emp: c => c.emp || 0, growth: c => c.net12 ?? -1e9, salary: c => c.sal || 0,
    sales: c => c.sales || 0, founded: c => c.fy || 0, recent: c => c.lastPosted || ''
  }[f.sort];
  filtered.sort((a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0));
  $('#count').innerHTML = `<b>${filtered.length.toLocaleString()}</b>개 회사 · ${role ? esc(roleName(role)) + ' ' : ''}공고 <b>${filtered.reduce((s, c) => s + c.jobsShown, 0).toLocaleString()}</b>건`;
  drawRoles();
  drawList();
  drawMap();
}

let listLimit = 150;
function drawList() {
  const ul = $('#list');
  ul.innerHTML = filtered.slice(0, listLimit).map(c => `
    <li data-id="${c.id}" class="${c.id === selId ? 'sel' : ''}">
      <img class="logo" loading="lazy" src="${esc(c.logo || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div class="li-main">
        <div class="li-name"><span style="overflow:hidden;text-overflow:ellipsis">${esc(c.n)}</span>${c.stage ? `<span class="pill" style="background:${stageColor(c.sk)}">${esc(c.stage.replace('Series ', ''))}</span>` : ''}</div>
        <div class="li-sub">${esc(c.ind || '')} · ${esc(c.dist || '')} · ${fmtN(c.emp)}명${c.net12 ? ` <span style="color:${c.net12 > 0 ? 'var(--good)' : 'var(--bad)'}">${c.net12 > 0 ? '+' : ''}${c.net12}</span>` : ''}</div>
      </div>
      <div class="li-right"><b>${c.jobsShown}</b><span>공고</span></div>
    </li>`).join('') + (filtered.length > listLimit ? `<li><button class="more" id="moreBtn">더 보기 (${filtered.length - listLimit})</button></li>` : '');
  ul.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => openDetail(+li.dataset.id, true));
  const mb = $('#moreBtn'); if (mb) mb.onclick = e => { e.stopPropagation(); listLimit += 200; drawList(); };
}

function spark(chart) {
  const pts = (chart || []).filter(x => x[1] != null);
  if (pts.length < 2) return '';
  const w = 400, h = 60, vals = pts.map(p => p[1]), mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const xy = pts.map((p, i) => [i / (pts.length - 1) * w, h - 6 - (p[1] - mn) / rg * (h - 14)]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="월별 인원 추이">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${xy.map(p => p.join(',')).join(' ')}"/>
    </svg><div class="muted">${pts[0][0]} ${fmtN(pts[0][1])}명 → ${pts[pts.length - 1][0]} ${fmtN(pts[pts.length - 1][1])}명</div>`;
}

function personCard(role, name, c) {
  const q = name ? `${c.n} ${name}` : `${c.n} ${role}`;
  return `<div class="person"><b>${role}</b> ${name ? esc(name) : '<span class="muted">공개 정보 없음</span>'}
    ${c.people && c.people[role] ? `<div>${esc(c.people[role])}</div>` : ''}
    <div class="links">
      <a target="_blank" rel="noopener" href="https://www.linkedin.com/search/results/people/?keywords=${enc(q)}">링크드인</a>
      <a target="_blank" rel="noopener" href="https://search.naver.com/search.naver?where=news&query=${enc(q)}">뉴스</a>
      <a target="_blank" rel="noopener" href="https://www.google.com/search?q=${enc(q + ' 이력')}">구글</a>
    </div></div>`;
}

function jobCard(j) {
  const isCt = j.type && !/regular|정규/i.test(j.type);
  const typeCls = !j.type ? '' : isCt ? 'ct' : 'ft';
  const rounds = (j.rounds || []).map(r => typeof r === 'string' ? r : (r.title || r.name || r.text || '')).filter(Boolean);
  const career = j.newbie ? '신입 가능' : (j.af != null ? (j.af === 0 ? `신입~${j.at && j.at < 100 ? j.at + '년' : '무관'}` : `경력 ${j.af}${j.at && j.at < 100 ? '~' + j.at : '+'}년`) : (j.careerTxt || ''));
  const links = j.links && j.links.length ? j.links : [{ src: '원티드', url: `https://www.wanted.co.kr/wd/${j.id}` }];
  return `<div class="job">
    <div class="job-t">${esc(j.t)}</div>
    <div class="job-m">
      <span class="${typeCls}">${esc(j.type ? empTypeTxt(j.type) : '고용형태 확인 전')}</span>
      ${j.role ? `<span class="rl">${esc(roleName(j.role))}</span>` : ''}
      ${career ? `<span>${esc(career)}</span>` : ''}
      ${j.remote ? '<span>원격 가능</span>' : ''}
      ${j.visa ? '<span>비자 지원</span>' : ''}
    </div>
    <div class="job-r">${j.posted ? `게시 ${fmtDate(j.posted)} (${agoTxt(j.posted)}) · ` : ''}마감 ${j.due ? fmtDate(j.due) : '상시'}</div>
    ${rounds.length ? `<div class="job-r">전형: ${rounds.map(esc).join(' → ')}</div>` : ''}
    ${j.note ? `<div class="job-r">${esc(j.note)}</div>` : ''}
    <div class="job-foot"><span class="muted">${links.length > 1 ? links.length + '개 사이트에 게시' : esc(links[0].src)}</span>
      <span class="applies">${links.map((l, i) => `<a class="apply${i ? ' alt' : ''}" target="_blank" rel="noopener" href="${esc(l.url)}">${links.length > 1 ? esc(l.src) + ' ' : ''}지원</a>`).join('')}</span></div>
  </div>`;
}

function repSec(c) {
  const cards = [];
  if (c.jp && c.jp.rate) cards.push(`<a class="rep" target="_blank" rel="noopener" href="https://www.jobplanet.co.kr/companies/${c.jp.id}"><b>★ ${c.jp.rate}</b><span>잡플래닛</span></a>`);
  if (c.bl && c.bl.rate) cards.push(`<a class="rep" target="_blank" rel="noopener" href="https://www.teamblind.com/kr/company/${enc(c.bl.name)}"><b>★ ${c.bl.rate}</b><span>블라인드${c.bl.reviews ? ' 리뷰 ' + fmtN(c.bl.reviews) : ''}${c.bl.rec != null ? ' · 추천 ' + c.bl.rec + '%' : ''}</span></a>`);
  if (c.ct && (c.ct.rate || c.ct.fin)) cards.push(`<a class="rep" target="_blank" rel="noopener" href="https://www.catch.co.kr/Comp/CompSummary/${c.ct.id}"><b>${c.ct.rate ? '★ ' + c.ct.rate : '-'}</b><span>캐치${c.ct.fin ? ' · 재무 ' + c.ct.fin + '점' : ''}</span></a>`);
  const tags = [...new Set([...(c.jp?.tags || [])])];
  if (!cards.length && !c.bl?.sal) return '';
  return `<div class="sec"><h3>평판</h3><div class="reps">${cards.join('')}</div>
    ${c.bl && c.bl.sal ? `<div class="muted" style="margin-top:8px">블라인드 평균연봉 ${fmtN(c.bl.sal)}만원</div>` : ''}
    ${tags.length ? `<div class="tags" style="margin-top:8px">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>`;
}

function openDetail(id, pan) {
  const c = DATA.find(x => x.id === id); if (!c) return;
  selId = id;
  document.querySelectorAll('.list li').forEach(li => li.classList.toggle('sel', +li.dataset.id === id));
  if (pan) map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 15), { duration: .6 });
  const net = c.net12;
  const allJobs = [...c.jobs].sort((a, b) => (b.posted || '') > (a.posted || '') ? 1 : -1);
  const jobs = role && jobTab === 'role' ? allJobs.filter(j => j.role === role) : allJobs;
  const srcCnt = {}; jobs.forEach(j => (j.links || [{ src: '원티드' }]).forEach(l => srcCnt[l.src] = (srcCnt[l.src] || 0) + 1));
  const ft = jobs.filter(j => j.type && /regular|정규/i.test(j.type)).length;
  const unk = jobs.filter(j => !j.type).length;
  $('#detailBody').innerHTML = `
    <div class="d-head">
      <img class="logo" src="${esc(c.logo || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div>
        <h2>${esc(c.n)}</h2>
        <div class="d-sub">${esc(c.ind || '')}${c.nts ? ' · ' + esc(c.nts) : ''}<br>
        ${c.fy ? `${c.fy}년 설립 (업력 ${new Date().getFullYear() - c.fy}년)` : '설립연도 미상'}${c.web ? ` · <a target="_blank" rel="noopener" href="${esc(/^https?:/.test(c.web) ? c.web : 'https://' + c.web)}">홈페이지</a>` : ''}<br>
        ${esc(c.addr || '')}</div>
      </div>
    </div>
    <div class="badges">
      <span class="badge stage" style="background:${stageColor(c.sk)}" title="${esc(c.stageSrc || 'THE VC')}">${esc(c.stage || '투자단계 미확인')}${c.rounds ? ` (${c.rounds}회)` : ''}</span>
      ${c.inv ? `<span class="badge">${esc(c.inv)}</span>` : ''}
      <span class="badge ${c.origin === '외국계' ? 'foreign' : ''}">${esc(c.origin || '국적 미확인')}</span>

      ${(c.badges || []).map(b => `<span class="badge">${esc(b)}</span>`).join('')}
    </div>
    <div class="sec"><h3>핵심 지표</h3>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtN(c.emp)}</div><div class="k">현재 인원${c.empM ? ' (' + c.empM + ')' : ''}</div></div>
        <div class="kpi"><div class="v ${net > 0 ? 'up' : net < 0 ? 'down' : ''}">${net == null ? '-' : (net > 0 ? '+' : '') + net}</div><div class="k">${periodTxt(c)} 순증 (입사-퇴사)</div></div>
        <div class="kpi"><div class="v">${c.h12 == null ? '-' : fmtN(c.h12) + ' / ' + fmtN(c.l12)}</div><div class="k">${periodTxt(c)} 입사 / 퇴사</div></div>
        <div class="kpi"><div class="v">${fmtWon(c.sal)}</div><div class="k">평균연봉</div></div>
        <div class="kpi"><div class="v">${fmtWon(c.sales)}</div><div class="k">매출${c.salesY ? ' (' + c.salesY.slice(0, 4) + ')' : ''}</div></div>
        <div class="kpi"><div class="v" style="font-size:${(c.fund||'').length > 7 ? 14 : 17}px">${c.fund ? esc(c.fund) : '-'}</div><div class="k">투자유치${c.fundAgo ? ' (최근 ' + esc(c.fundAgo) + ')' : ''}</div></div>
      </div>
      ${spark(c.chart)}
      <div class="src">인원, 입퇴사, 연봉: 국민연금 가입 기준 (원티드 제공) · 매출: KODATA · 투자: ${esc(c.stageSrc || 'THE VC')}${c.resp ? ` · 원티드 지원자 응답률 ${Math.round(c.resp)}%` : ''}</div>
    </div>
    ${repSec(c)}
    <div class="sec"><h3>채용공고 ${jobs.length}건 · 정규직 ${ft}${unk ? ` · 확인 전 ${unk}` : ''}</h3>
      ${role ? `<div class="jobtabs"><button data-jt="role" class="${jobTab === 'role' ? 'on' : ''}">${esc(roleName(role))} ${allJobs.filter(j => j.role === role).length}</button><button data-jt="all" class="${jobTab === 'all' ? 'on' : ''}">전체 ${allJobs.length}</button></div>` : ''}
      <div class="muted" style="margin:-4px 0 10px">${Object.entries(srcCnt).map(([k, v]) => `${k} ${v}`).join(' · ')} · 같은 공고는 하나로 합침</div>
      <div class="jobs">${jobs.length ? jobs.map(jobCard).join('') : '<div class="muted">현재 열린 공고가 없습니다.</div>'}</div>
    </div>
    <div class="sec"><h3>경영진</h3><div class="people">
      ${personCard('CEO', c.ceo, c)}
      ${personCard('CTO', c.cto, c)}
    </div></div>
    ${c.desc || c.kw ? `<div class="sec"><h3>회사 소개</h3>${c.kw ? `<div class="muted" style="margin-bottom:6px">${esc(c.kw)}</div>` : ''}<div class="desc">${esc(c.desc || '')}</div></div>` : ''}
    ${(c.welfare || []).length ? `<div class="sec"><h3>보상 및 복지</h3><div class="tags">${c.welfare.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
    <div class="sec"><h3>다른 사이트에서 보기</h3><div class="ext">
      ${extLinks(c).map(([t, u]) => `<a target="_blank" rel="noopener" href="${u}">${t}</a>`).join('')}
    </div></div>`;
  $('#detailBody').querySelectorAll('[data-jt]').forEach(b => b.onclick = () => { jobTab = b.dataset.jt; openDetail(id, false); });
  $('#detail').classList.add('open');
  $('#detail').setAttribute('aria-hidden', 'false');
  $('#detail').scrollTop = 0;
  if (innerWidth <= 820) $('#side').classList.remove('open');
  history.replaceState(null, '', '#c' + id);
}

function fillSelect(sel, values) {
  sel.insertAdjacentHTML('beforeend', values.map(v => `<option value="${esc(v[0])}">${esc(v[1])}</option>`).join(''));
}

async function load() {
  const r = await fetch('data/companies.json', { cache: 'no-cache' });
  const d = await r.json();
  META = d.meta || {};
  DATA = d.companies.filter(c => c.lat && c.lng);
  for (const c of DATA) {
    c.sk = stageKey(c.stage);
    c.jobs = c.jobs || [];
    c.lastPosted = c.jobs.reduce((m, j) => (j.posted || '') > m ? j.posted : m, '');
    c._s = [c.n, c.ind, c.nts, c.ceo, c.dist, c.stage, c.market, ...(c.jobs.map(j => j.t))].join(' ').toLowerCase();
  }
  const cnt = k => Object.entries(DATA.reduce((m, c) => (c[k] && (m[c[k]] = (m[c[k]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  fillSelect($('#f-ind'), cnt('ind').map(([k, n]) => [k, `${k} (${n})`]));
  fillSelect($('#f-dist'), cnt('dist').map(([k, n]) => [k, `${k} (${n})`]));
  fillSelect($('#f-stage'), [...STAGES.map(s => [s[0], s[1]]), ['na', '단계 미확인']]);
  $('#meta').textContent = `${DATA.length.toLocaleString()}개 회사 · 업데이트 ${fmtDate(META.updated)}`;
  apply();
  const m = location.hash.match(/^#c(\d+)/); if (m) openDetail(+m[1], true);
}

function bind() {
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { listLimit = 150; apply(); }, 150); });
  ['#f-ind', '#f-stage', '#f-size', '#f-dist', '#f-hiring', '#f-fulltime', '#f-foreign', '#f-growing', '#sort']
    .forEach(s => $(s).addEventListener('change', () => { listLimit = 150; apply(); }));
  document.querySelectorAll('[data-heat]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-heat]').forEach(x => x.classList.toggle('on', x === b));
    heatMode = b.dataset.heat; drawMap();
  });
  $('#closeDetail').onclick = () => { $('#detail').classList.remove('open'); $('#detail').setAttribute('aria-hidden', 'true'); selId = null; history.replaceState(null, '', location.pathname); };
  $('#listToggle').onclick = () => $('#side').classList.toggle('open');
  addEventListener('keydown', e => { if (e.key === 'Escape') $('#closeDetail').click(); });
}

initMap(); drawLegend(); bind();
load().catch(e => { $('#meta').textContent = '데이터를 불러오지 못했습니다'; console.error(e); });
})();
