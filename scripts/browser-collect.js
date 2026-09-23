// 원티드 탭(로그인 상태) 개발자도구 콘솔에서 실행. 서울 공고/회사/인원차트/공고상세를 IndexedDB(ssm)에 저장. window.__S 로 진행상황 확인.
// 원티드가 403을 주면 잠시 쉬었다가 다시 실행하면 이어서 진행됨. 공고 상세는 동시 1개로 바꿔 천천히 돌리는 걸 권장.
(async()=>{
const S=window.__S=window.__S||{stage:'start',log:[]};
const idb=await new Promise((res,rej)=>{const r=indexedDB.open('ssm',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=rej;});
const put=(k,v)=>new Promise(r=>{const t=idb.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=r;});
const get=k=>new Promise(r=>{const q=idb.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>r(q.result);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pool=async(items,n,fn)=>{let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const x=items[i++];try{await fn(x)}catch(e){S.err=(S.err||0)+1}}}));};
const nd=h=>JSON.parse(h.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)[1]);
// 1 jobs
let jobs=await get('jobs');
if(!jobs){S.stage='jobs';jobs=[];let off=0;while(true){const j=await fetch(`/api/v4/jobs?country=kr&locations=seoul.all&limit=100&offset=${off}&job_sort=job.latest_order`).then(r=>r.json());if(!j.data||!j.data.length)break;for(const x of j.data)jobs.push({id:x.id,cid:x.company.id,pos:x.position,dist:x.address?.district,af:x.annual_from,at:x.annual_to,due:x.due_time});off+=100;S.jobs=jobs.length;}await put('jobs',jobs);}
S.jobs=jobs.length;
// 2 companies
const co=(await get('co'))||{};
const ids=[...new Set(jobs.map(j=>j.cid))].filter(id=>!co[id]);
S.stage='companies';S.coTotal=ids.length+Object.keys(co).length;let cnt=0;
await pool(ids,3,async id=>{const d=nd(await fetch('/company/'+id).then(r=>r.text()));const q=Object.fromEntries(d.props.pageProps.dehydrateState.queries.map(x=>[x.queryKey[0],x.state.data]));const i=q.companyInfo||{},s=q.companySummary||{};co[id]={id,name:i.name,hash:i.regNoHash,industry:i.industryName,founded:i.foundedYear,status:i.status,tags:(i.mainTags||[]).concat(i.companyTags||[]).map(t=>[t.tag_category_id,t.title]),desc:(i.description||'').slice(0,500),link:i.link,logo:i.logo,addr:i.address?.full_location,dist:i.address?.district,geo:i.address?.geo_location?.location,resp:i.applicationResponseStats?.avg_rate,ceo:s.detail?.ownerName||null,corpType:s.detail?.corpType,ntsClass:s.detail?.classNameByNts,emp:s.employee?.total??s.detail?.npsEmployeeCount??s.detail?.eiEmployeeCount,empSrc:s.employee?.source,salary:s.salary?.salary,sales:s.sales?.total,salesYear:s.sales?.updatedAt,ticker:s.detail?.tickerSymbol};S.coDone=Object.keys(co).length;if(++cnt%200==0)await put('co',co);});
await put('co',co);
// 3 candidates
const inv=c=>c.tags.some(([k])=>[17,19,23,34].includes(k));
const big=c=>c.tags.some(([k,t])=>/대기업|10,001명이상|1,001~10,000명/.test(t))||c.ticker;
const cand=Object.values(co).filter(c=>c.geo&&!big(c)&&c.status!=='CLOSED'&&(inv(c)||c.founded>=2012));
S.cand=cand.length;
// 4 employees chart
const emp=(await get('emp'))||{};S.stage='emp';
await pool(cand.filter(c=>c.hash&&!emp[c.id]),6,async c=>{const j=await fetch(`/api/krs/v1/wanted/${c.hash}/employees`).then(r=>r.json());const ch=(j.employees?.NPS?.chart||[]).filter(x=>x.total!=null);emp[c.id]={chart:ch.map(x=>[x.date.slice(0,7),x.total,x.hired,x.left]),ei:j.employees?.EI?.employee??null};S.empDone=Object.keys(emp).length;});
await put('emp',emp);
// 5 job details for candidates
const cset=new Set(cand.map(c=>c.id));
const jd=(await get('jd'))||{};S.stage='jd';
const todo=jobs.filter(j=>cset.has(j.cid)&&!jd[j.id]);S.jdTotal=todo.length;cnt=0;
await pool(todo,1,async j=>{const d=nd(await fetch('/wd/'+j.id).then(r=>r.text()));const x=d.props.pageProps.initialData;jd[j.id]={posted:x.confirm_time,due:x.due_time,close:x.close_time,emp:x.employment_type,note:x.employment_note,rounds:x.hire_rounds,remote:x.is_remote_work,newbie:x.career?.is_newbie,cat:x.category_tag?.parent_tag?.text||null,out:x.out_link||null,lang:x.preferred_languages||null,visa:x.visa_information||null,addr:x.address?.full_location};S.jdDone=Object.keys(jd).length;if(++cnt%300==0)await put('jd',jd);});
await put('jd',jd);
S.stage='done';
})().catch(e=>{window.__S.error=String(e)});
'started'
