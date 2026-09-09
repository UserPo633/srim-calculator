export function adminPage(){
return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Holocut Admin</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;background:#f5f7fb}*{box-sizing:border-box}
body{margin:0}.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 56px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}
h1{margin:0;font-size:26px}.muted{color:#6b7280;font-size:13px}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.card{background:white;border:1px solid #e5e7eb;border-radius:16px;padding:18px;box-shadow:0 4px 16px rgba(17,24,39,.04)}
.kpi{grid-column:span 3}.half{grid-column:span 6}.full{grid-column:1/-1}.kpi b{display:block;font-size:28px;margin-top:8px}
h2{font-size:17px;margin:0 0 14px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
label{display:block;font-size:12px;color:#6b7280;margin-bottom:6px}input,select{width:100%;padding:10px 11px;border:1px solid #d1d5db;border-radius:10px;background:white;font:inherit}
button{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#111827;color:white}button.secondary{background:#eef2ff;color:#3730a3}button.danger{background:#fee2e2;color:#991b1b}
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.switch{display:flex;align-items:center;gap:8px}.switch input{width:auto}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #eef2f7;vertical-align:top}th{color:#6b7280;font-weight:600}
.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px}.ok{color:#047857}.err{color:#b91c1c}.notice{min-height:20px;margin-top:10px;font-size:13px}
.bar{height:10px;background:#eef2f7;border-radius:999px;overflow:hidden;margin:4px 0 10px}.bar span{display:block;height:100%;background:#111827}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.small{font-size:12px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
@media(max-width:800px){.kpi,.half{grid-column:1/-1}.row,.row3{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
</style></head>
<body><div class="wrap">
<div class="top"><div><h1>Holocut 운영자 콘솔</h1><div class="muted">확률·지급 정책·이벤트·수동 지급을 재배포 없이 관리합니다.</div></div><button class="secondary" onclick="loadAll()">새로고침</button></div>
<div class="grid">
<div class="card kpi"><div class="muted">전체 사용자</div><b id="kUsers">-</b></div>
<div class="card kpi"><div class="muted">오늘 발급 팩</div><b id="kPacks">-</b></div>
<div class="card kpi"><div class="muted">오늘 활성 사용자</div><b id="kActive">-</b></div>
<div class="card kpi"><div class="muted">활성 이벤트</div><b id="kEvents">-</b></div>

<div class="card half"><h2>카드 확률 / 지급 정책</h2>
<div class="row3"><div><label>일반 %</label><input id="commonPct" type="number" step="0.01"></div><div><label>레어 %</label><input id="rarePct" type="number" step="0.01"></div><div><label>에픽 %</label><input id="epicPct" type="number" step="0.01"></div></div>
<div class="row" style="margin-top:12px"><div><label>일일 기본 지급</label><input id="dailyPacks" type="number" min="0"></div><div><label>첫날 보너스</label><input id="welcomeBonus" type="number" min="0"></div></div>
<div class="actions"><label class="switch"><input id="issuanceEnabled" type="checkbox"> 카드팩 발급 활성</label><span id="sumPct" class="muted"></span></div>
<div class="actions"><button onclick="saveSettings()">설정 적용</button><button class="secondary" onclick="simulate()">10만회 시뮬레이션</button></div><div id="settingsMsg" class="notice"></div>
</div>

<div class="card half"><h2>오늘 실제 희귀도</h2>
<div class="small">일반 <b id="rCommon">0</b></div><div class="bar"><span id="bCommon" style="width:0%"></span></div>
<div class="small">레어 <b id="rRare">0</b></div><div class="bar"><span id="bRare" style="width:0%"></span></div>
<div class="small">에픽 <b id="rEpic">0</b></div><div class="bar"><span id="bEpic" style="width:0%"></span></div>
<div id="simResult" class="muted"></div>
</div>

<div class="card half"><h2>지급 이벤트 만들기</h2>
<div><label>이벤트 이름</label><input id="eventName" placeholder="예: 추석 기념 2팩"></div>
<div class="row" style="margin-top:12px"><div><label>시작</label><input id="eventStart" type="datetime-local"></div><div><label>종료</label><input id="eventEnd" type="datetime-local"></div></div>
<div class="row" style="margin-top:12px"><div><label>추가 지급 팩</label><input id="eventBonus" type="number" min="1" value="2"></div><div><label>대상</label><select id="eventTarget"><option value="all">전체 사용자</option><option value="new_users">이벤트 시작 이후 신규 사용자</option></select></div></div>
<div class="actions"><button onclick="createEvent()">이벤트 예약</button></div><div id="eventMsg" class="notice"></div>
</div>

<div class="card half"><h2>특정 사용자 수동 지급</h2>
<div><label>accountId</label><input id="grantSubject" class="mono" placeholder="앱 로그인 응답의 accountId"></div>
<div class="row" style="margin-top:12px"><div><label>지급 팩</label><input id="grantPacks" type="number" min="1" value="1"></div><div><label>만료일시(선택)</label><input id="grantExpires" type="datetime-local"></div></div>
<div style="margin-top:12px"><label>사유</label><input id="grantReason" placeholder="예: CS 보상"></div>
<div class="actions"><button onclick="grantPacks()">지급</button></div><div id="grantMsg" class="notice"></div>
</div>

<div class="card full"><h2>이벤트</h2><div style="overflow:auto"><table><thead><tr><th>이름</th><th>기간</th><th>지급</th><th>대상</th><th>상태</th><th></th></tr></thead><tbody id="eventsBody"></tbody></table></div></div>
<div class="card full"><h2>최근 수동 지급</h2><div style="overflow:auto"><table><thead><tr><th>accountId</th><th>지급</th><th>남음</th><th>사유</th><th>만료</th><th>생성</th></tr></thead><tbody id="grantsBody"></tbody></table></div></div>
<div class="card full"><h2>최근 변경 이력</h2><div style="overflow:auto"><table><thead><tr><th>시각</th><th>작업</th><th>내용</th></tr></thead><tbody id="auditBody"></tbody></table></div></div>
</div></div>
<script>
const $=id=>document.getElementById(id),fmt=t=>t?new Date(Number(t)).toLocaleString('ko-KR'):'-';
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
function msg(id,text,ok=true){const e=$(id);e.textContent=text;e.className='notice '+(ok?'ok':'err')}
function pctSum(){const n=['commonPct','rarePct','epicPct'].reduce((a,id)=>a+(Number($(id).value)||0),0);$('sumPct').textContent='합계 '+n.toFixed(2)+'%';return n}
['commonPct','rarePct','epicPct'].forEach(id=>$(id).addEventListener('input',pctSum));
async function loadAll(){
 try{
  const [d,events,grants,audit]=await Promise.all([api('/admin/api/dashboard'),api('/admin/api/events'),api('/admin/api/grants'),api('/admin/api/audit')]);
  $('kUsers').textContent=d.totalUsers.toLocaleString();$('kPacks').textContent=d.todayPacks.toLocaleString();$('kActive').textContent=d.todayActiveUsers.toLocaleString();$('kEvents').textContent=d.activeEvents.toLocaleString();
  const s=d.settings;$('commonPct').value=s.commonPct;$('rarePct').value=s.rarePct;$('epicPct').value=s.epicPct;$('dailyPacks').value=s.dailyPacks;$('welcomeBonus').value=s.welcomeBonus;$('issuanceEnabled').checked=s.issuanceEnabled;pctSum();
  const rr=d.todayRarity,total=rr.common+rr.rare+rr.epic||1;[['Common','common'],['Rare','rare'],['Epic','epic']].forEach(([A,k])=>{$('r'+A).textContent=rr[k]+' ('+(rr[k]/total*100).toFixed(1)+'%)';$('b'+A).style.width=(rr[k]/total*100)+'%'});
  $('eventsBody').innerHTML=events.map(e=>'<tr><td><b>'+esc(e.name)+'</b></td><td>'+fmt(e.startAt)+'<br>~ '+fmt(e.endAt)+'</td><td>'+e.bonusPacks+'팩</td><td>'+(e.targetType==='all'?'전체':'신규')+'</td><td><span class="badge">'+(e.enabled?'활성':'중지')+'</span></td><td><button class="'+(e.enabled?'danger':'secondary')+'" onclick="toggleEvent(\''+e.id+'\','+(!e.enabled)+')">'+(e.enabled?'중지':'활성')+'</button></td></tr>').join('');
  $('grantsBody').innerHTML=grants.map(g=>'<tr><td class="mono">'+esc(g.subject)+'</td><td>'+g.packs+'</td><td>'+g.remaining+'</td><td>'+esc(g.reason||'-')+'</td><td>'+fmt(g.expiresAt)+'</td><td>'+fmt(g.createdAt)+'</td></tr>').join('');
  $('auditBody').innerHTML=audit.map(a=>'<tr><td>'+fmt(a.createdAt)+'</td><td><code>'+esc(a.action)+'</code></td><td class="mono">'+esc(JSON.stringify(a.detail))+'</td></tr>').join('');
 }catch(e){alert(e.message)}
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function saveSettings(){try{if(Math.abs(pctSum()-100)>.0001)throw new Error('확률 합계가 100%여야 합니다.');await api('/admin/api/settings',{method:'PUT',body:JSON.stringify({commonPct:Number($('commonPct').value),rarePct:Number($('rarePct').value),epicPct:Number($('epicPct').value),dailyPacks:Number($('dailyPacks').value),welcomeBonus:Number($('welcomeBonus').value),issuanceEnabled:$('issuanceEnabled').checked})});msg('settingsMsg','적용했습니다. 다음 카드팩부터 즉시 반영됩니다.');await loadAll()}catch(e){msg('settingsMsg',e.message,false)}}
async function simulate(){try{const r=await api('/admin/api/simulate?n=100000');$('simResult').textContent='시뮬레이션 '+r.n.toLocaleString()+'회 → 일반 '+r.percent.common.toFixed(2)+'% / 레어 '+r.percent.rare.toFixed(2)+'% / 에픽 '+r.percent.epic.toFixed(2)+'%'}catch(e){$('simResult').textContent=e.message}}
async function createEvent(){try{await api('/admin/api/events',{method:'POST',body:JSON.stringify({name:$('eventName').value,startAt:new Date($('eventStart').value).getTime(),endAt:new Date($('eventEnd').value).getTime(),bonusPacks:Number($('eventBonus').value),targetType:$('eventTarget').value})});msg('eventMsg','이벤트를 예약했습니다.');$('eventName').value='';await loadAll()}catch(e){msg('eventMsg',e.message,false)}}
async function toggleEvent(id,enabled){try{await api('/admin/api/events/'+id,{method:'PATCH',body:JSON.stringify({enabled})});await loadAll()}catch(e){alert(e.message)}}
async function grantPacks(){try{await api('/admin/api/grants',{method:'POST',body:JSON.stringify({subject:$('grantSubject').value,packs:Number($('grantPacks').value),reason:$('grantReason').value,expiresAt:$('grantExpires').value?new Date($('grantExpires').value).getTime():null})});msg('grantMsg','지급했습니다.');$('grantReason').value='';await loadAll()}catch(e){msg('grantMsg',e.message,false)}}
loadAll();
</script></body></html>`;
}
