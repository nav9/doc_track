const DEMO_KEY = "leavepilot-demo-v1";

const initialState = {
  doctor: { name: "Dr. Arun", hospital: "City General Hospital" },
  month: "2026-09-01",
  balances: {
    CL: { name:"Casual Leave", total:15, used:6.5, unit:"days", note:"Maximum 3 days in a calendar month" },
    RH: { name:"Restricted Holiday", total:2, used:1, unit:"days", note:"1 in each 6-month period" },
    SCL:{ name:"Special Casual Leave", total:10, used:2, unit:"days", note:"Conference / special duty" },
    EL: { name:"Earned Leave", total:30, used:6, unit:"days", note:"Maximum 8 in one stretch; 3-month gap" },
    CCL:{ name:"Compensatory Leave", total:null, used:0, unit:"active", note:"Individual credits expire after 3 months" }
  },
  leaveEvents: [
    {id:"l1", date:"2026-08-04", type:"CL", label:"CL", duration:1},
    {id:"l2", date:"2026-08-17", type:"CL", label:"CL", duration:0.5},
    {id:"l3", date:"2026-08-18", type:"CL", label:"CL", duration:1},
    {id:"l4", date:"2026-08-19", type:"CL", label:"CL", duration:1},
    {id:"l5", date:"2026-08-28", type:"CL", label:"CL", duration:1},
    {id:"l6", date:"2026-09-04", type:"CL", label:"CL", duration:1},
    {id:"l7", date:"2026-09-18", type:"CL", label:"CL", duration:0.5},
    {id:"l8", date:"2026-09-25", type:"EL", label:"EL", duration:1},
    {id:"l9", date:"2026-09-26", type:"EL", label:"EL", duration:1},
    {id:"l10", date:"2026-09-27", type:"EL", label:"EL", duration:1},
    {id:"l11", date:"2026-09-28", type:"EL", label:"EL", duration:1},
    {id:"l12", date:"2026-10-16", type:"RH", label:"RH", duration:1},
    {id:"l13", date:"2026-10-30", type:"SCL", label:"Conference", duration:1}
  ],
  cclCredits: [
    {id:"c1", earned:"2026-07-20", reason:"Sunday duty", expiry:"2026-10-19", used:null},
    {id:"c2", earned:"2026-08-15", reason:"Independence Day duty", expiry:"2026-11-14", used:null},
    {id:"c3", earned:"2026-09-06", reason:"Sunday duty", expiry:"2026-12-05", used:null}
  ],
  holidays: [
    {date:"2026-09-17", name:"General Holiday"},
    {date:"2026-10-02", name:"Gandhi Jayanti"},
    {date:"2026-10-20", name:"General Holiday"},
    {date:"2026-11-01", name:"Kannada Rajyotsava"}
  ],
  duties: [
    "2026-09-01","2026-09-02","2026-09-03","2026-09-04",
    "2026-09-05","2026-09-07","2026-09-08","2026-09-09",
    "2026-09-10","2026-09-11","2026-09-12","2026-09-14",
    "2026-09-15","2026-09-16","2026-09-18","2026-09-19",
    "2026-09-21","2026-09-22","2026-09-23","2026-09-24",
    "2026-09-25","2026-09-28","2026-09-29","2026-09-30",
    "2026-10-01","2026-10-03","2026-10-05","2026-10-06",
    "2026-10-07","2026-10-08","2026-10-09","2026-10-10",
    "2026-10-12","2026-10-13","2026-10-14","2026-10-15",
    "2026-10-17","2026-10-19","2026-10-21","2026-10-22",
    "2026-10-23","2026-10-24","2026-10-26","2026-10-27",
    "2026-10-28","2026-10-29","2026-10-31"
  ],
  nmcExceptions: {
    "2026-09-13": {punched:true, note:"Sunday duty — manually marked NMC punched"},
    "2026-09-20": {punched:false, note:"Doctor did not punch NMC"},
  }
};

let state = loadState();
let currentView = "dashboard";
let draggedEvent = null;
let plannerResults = [];

function loadState(){
  try {
    const saved = localStorage.getItem(DEMO_KEY);
    return saved ? JSON.parse(saved) : structuredClone(initialState);
  } catch { return structuredClone(initialState); }
}
function saveState(){ localStorage.setItem(DEMO_KEY, JSON.stringify(state)); }

const leaveMeta = {
  CL:{name:"Casual Leave", cls:"cl"},
  EL:{name:"Earned Leave", cls:"el"},
  CCL:{name:"Compensatory Leave", cls:"ccl"},
  RH:{name:"Restricted Holiday", cls:"rh"},
  SCL:{name:"Special Casual Leave", cls:"scl"}
};

function iso(d){ return d.toISOString().slice(0,10); }
function parseDate(s){ const [y,m,day]=s.split("-").map(Number); return new Date(y,m-1,day); }
function fmtDate(s, opts={day:"numeric",month:"short",year:"numeric"}){ return parseDate(s).toLocaleDateString("en-IN",opts); }
function monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function monthName(s){ return parseDate(s).toLocaleDateString("en-IN",{month:"long",year:"numeric"}); }
function daysInMonth(s){ const d=parseDate(s); return new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); }
function isWeekend(s){ const d=parseDate(s).getDay(); return d===0 || d===6; }
function holidayFor(s){ return state.holidays.find(h=>h.date===s); }
function dutyFor(s){ return state.duties.includes(s); }
function leaveFor(s){ return state.leaveEvents.filter(e=>e.date===s); }
function nmcFor(s){
  if(state.nmcExceptions[s]) return state.nmcExceptions[s].punched;
  return dutyFor(s) || !!holidayFor(s) ? false : dutyFor(s);
}
function isNmcDefault(s){
  // Demo assumption: every scheduled working/duty day is treated as punched unless explicitly removed.
  return dutyFor(s) && !(state.nmcExceptions[s] && state.nmcExceptions[s].punched===false);
}
function workingDays(s){
  const d=parseDate(s);
  return !isWeekend(s) && !holidayFor(s);
}
function nmcCountForMonth(monthStr){
  const start=parseDate(monthStr), total=daysInMonth(monthStr);
  let count=0;
  for(let i=1;i<=total;i++){
    const s=iso(new Date(start.getFullYear(),start.getMonth(),i));
    if(isNmcDefault(s)) count++;
  }
  // explicit Sunday punches count too
  for(const [s,v] of Object.entries(state.nmcExceptions)){
    if(s.startsWith(monthKey(start)) && v.punched && !isNmcDefault(s)) count++;
  }
  return count;
}
function usedThisMonth(type, monthStr){
  return state.leaveEvents.filter(e=>e.type===type && e.date.startsWith(monthKey(parseDate(monthStr))))
    .reduce((a,e)=>a+(e.duration||1),0);
}
function activeCCL(){
  const today="2026-09-20";
  return state.cclCredits.filter(c=>!c.used && c.expiry>=today);
}
function expiringCCL(){
  return activeCCL().sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
}
function remaining(type){
  const b=state.balances[type];
  if(type==="CCL") return activeCCL().length;
  return b.total-b.used;
}
function allDatesForMonth(monthStr){
  const first=parseDate(monthStr), y=first.getFullYear(), m=first.getMonth();
  const firstDay=new Date(y,m,1).getDay();
  const total=new Date(y,m+1,0).getDate();
  const cells=[];
  for(let i=0;i<firstDay;i++){
    cells.push({date:iso(new Date(y,m,i-firstDay+1)),inMonth:false});
  }
  for(let i=1;i<=total;i++) cells.push({date:iso(new Date(y,m,i)),inMonth:true});
  while(cells.length<42){
    const next=cells.length-firstDay+1;
    cells.push({date:iso(new Date(y,m,next)),inMonth:false});
  }
  return cells;
}
function setView(view){
  currentView=view;
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+view));
  const titles={dashboard:"Good evening, Dr. Arun",calendar:"Your calendar",planner:"Plan your leave",history:"Leave history",rules:"Your leave rules"};
  document.getElementById("pageTitle").textContent=titles[view];
  renderAll();
}
function renderAll(){
  renderAlerts();
  renderDashboard();
  renderCalendar();
  renderPlanner();
  renderHistory();
  renderRules();
}
function renderAlerts(){
  const box=document.getElementById("alerts");
  const alerts=[];
  const c=expiringCCL();
  if(c){
    const diff=Math.ceil((parseDate(c.expiry)-parseDate("2026-09-20"))/86400000);
    alerts.push(`<div class="alert ${diff<=30?"danger":"warn"}"><span class="alert-icon">⚠</span><div class="alert-text"><strong>CCL expires ${fmtDate(c.expiry)}</strong> <small>· ${diff} days left · ${c.reason}</small></div><button onclick="setView('planner')">Plan around it →</button></div>`);
  }
  const clRemain=remaining("CL");
  if(clRemain>0){
    alerts.push(`<div class="alert"><span class="alert-icon">●</span><div class="alert-text"><strong>${clRemain} CL day${clRemain===1?"":"s"} remain</strong> <small>Unused CL cannot be encashed in this demo.</small></div><button onclick="setView('planner')">Find dates →</button></div>`);
  }
  const punches=nmcCountForMonth(state.month);
  if(punches<21) alerts.push(`<div class="alert danger"><span class="alert-icon">!</span><div class="alert-text"><strong>${monthName(state.month)} is at ${punches}/21 NMC punches</strong> <small>Check exceptions before planning more leave.</small></div><button onclick="setView('calendar')">Review →</button></div>`);
  box.innerHTML=alerts.slice(0,3).join("");
}
function renderDashboard(){
  const el=document.getElementById("view-dashboard");
  const c=expiringCCL();
  const punch=nmcCountForMonth(state.month);
  const pct=Math.min(100,punch/21*100);
  const upcoming=state.leaveEvents.filter(e=>e.date>="2026-09-20").sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  el.innerHTML=`
    <div class="hero-plan">
      <div>
        <div class="eyebrow">QUICK PLANNING</div>
        <h2>Need to know when you can take leave?</h2>
        <p>See valid combinations around weekends, holidays, your duty roster and the leave rules. This demo uses deterministic rules — no AI.</p>
        <div class="kpi-row">
          <div class="kpi"><strong>${remaining("CL")}</strong> CL remaining</div>
          <div class="kpi"><strong>${remaining("EL")}</strong> EL remaining</div>
          <div class="kpi"><strong>${activeCCL().length}</strong> active CCL</div>
        </div>
      </div>
      <button class="button" onclick="setView('planner')">Plan my leave →</button>
    </div>

    <div class="grid grid-4 section-space">
      ${["CL","EL","SCL","RH"].map(type=>{
        const b=state.balances[type], r=remaining(type), percent=b.total?Math.min(100,(b.used/b.total)*100):0;
        return `<div class="card stat-card">
          <div class="stat-top"><span>${b.name}</span><span class="pill ${leaveMeta[type].cls}">${type}</span></div>
          <div class="stat-number">${r}<span class="muted" style="font-size:13px;font-weight:600"> / ${b.total}</span></div>
          <div class="stat-meta">${b.note}</div>
          <div class="progress"><span style="width:${percent}%"></span></div>
        </div>`;
      }).join("")}
    </div>

    <div class="grid grid-2 section-space">
      <div class="card card-pad">
        <div class="card-title"><h3>NMC attendance · ${monthName(state.month)}</h3><span class="pill ${punch>=21?"scl":"proposed"}">${punch} / 21</span></div>
        <div class="progress"><span style="width:${pct}%;background:${punch>=21?"#17834b":"#b7791f"}"></span></div>
        <p class="small muted">Working/duty days are assumed punched automatically. You only record exceptions.</p>
        <button class="button secondary small-btn" onclick="setView('calendar')">Review punch exceptions</button>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>Next important item</h3></div>
        ${c ? `<div class="list-row"><div class="list-main"><span class="dot ccl"></span><div><strong>CCL expires ${fmtDate(c.expiry)}</strong><div class="small muted">${c.reason}</div></div></div><button class="button secondary small-btn" onclick="setView('planner')">Use it</button></div>` : `<div class="empty">No active CCL credits.</div>`}
        <div class="list-row"><div class="list-main"><span class="dot cl"></span><div><strong>${remaining("CL")} CL remaining</strong><div class="small muted">Consider year-end planning.</div></div></div><button class="button secondary small-btn" onclick="setView('planner')">Explore</button></div>
      </div>
    </div>

    <div class="grid grid-2 section-space">
      <div class="card card-pad">
        <div class="card-title"><h3>Upcoming leave</h3><button class="button secondary small-btn" onclick="setView('history')">All history</button></div>
        <div class="list">
          ${upcoming.length?upcoming.map(e=>`<div class="list-row"><div class="list-main"><span class="dot ${leaveMeta[e.type]?.cls||''}"></span><div><strong>${fmtDate(e.date)}</strong><div class="small muted">${leaveMeta[e.type]?.name||e.label} · ${e.duration===.5?"Half day":"Full day"}</div></div></div><span class="pill ${leaveMeta[e.type]?.cls||''}">${e.type}</span></div>`).join(""):`<div class="empty">No upcoming leave.</div>`}
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>At a glance</h3></div>
        <div class="list">
          <div class="list-row"><div><strong>Next leave</strong><div class="small muted">${upcoming[0]?fmtDate(upcoming[0].date):"None planned"}</div></div></div>
          <div class="list-row"><div><strong>Current month</strong><div class="small muted">${monthName(state.month)}</div></div><span class="pill duty">${state.duties.filter(d=>d.startsWith(monthKey(parseDate(state.month)))).length} duty days</span></div>
          <div class="list-row"><div><strong>Active CCL</strong><div class="small muted">Credits with an expiry date</div></div><span class="pill ccl">${activeCCL().length}</span></div>
        </div>
      </div>
    </div>
  `;
}
function renderCalendar(){
  const el=document.getElementById("view-calendar");
  const cells=allDatesForMonth(state.month);
  const [y,m]=state.month.split("-").map(Number);
  el.innerHTML=`
    <div class="card card-pad">
      <div class="calendar-head">
        <div><div class="eyebrow">MONTH VIEW</div><div class="month-title">${monthName(state.month)}</div></div>
        <div class="month-controls">
          <button class="icon-button" onclick="shiftMonth(-1)">←</button>
          <button class="icon-button" onclick="shiftMonth(0)">Today</button>
          <button class="icon-button" onclick="shiftMonth(1)">→</button>
        </div>
      </div>
      <div class="calendar-wrap">
        <div class="calendar-grid">
          ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(x=>`<div class="weekday">${x}</div>`).join("")}
          ${cells.map(c=>dayCell(c)).join("")}
        </div>
      </div>
      <div class="legend">
        ${[
          ["cl","CL"],["el","EL"],["ccl","CCL"],["rh","RH"],["scl","SCL"],
          ["holiday","General holiday"],["duty","Duty"],["nmc","NMC punched"],["proposed","Possible leave"]
        ].map(x=>`<span class="legend-item"><span class="legend-swatch" style="background:var(--${x[0]==="cl"?"primary-soft":x[0]==="el"?"purple-soft":x[0]==="ccl"?"orange-soft":x[0]==="rh"?"teal-soft":x[0]==="scl"?"success-soft":"#edf2f7"});"></span>${x[1]}</span>`).join("")}
      </div>
      <div class="callout section-space"><strong>How to use this demo:</strong> click a day for details. You can drag an existing leave chip to another day to test the planning interaction. Click a “Possible leave” suggestion to add it.</div>
    </div>`;
}
function dayCell(c){
  const d=parseDate(c.date), today="2026-09-20";
  const events=[];
  const holiday=holidayFor(c.date);
  if(holiday) events.push(`<div class="event holiday" onclick="event.stopPropagation();openDay('${c.date}')">★ ${holiday.name}</div>`);
  if(dutyFor(c.date)) events.push(`<div class="event duty" onclick="event.stopPropagation();openDay('${c.date}')">Duty</div>`);
  for(const e of leaveFor(c.date)){
    const meta=leaveMeta[e.type]||{cls:""};
    events.push(`<div class="event ${meta.cls}" draggable="true" data-event-id="${e.id}" onclick="event.stopPropagation();openDay('${c.date}')">${e.label}${e.duration===.5?" · ½":""}</div>`);
  }
  if(nmcFor(c.date) || isNmcDefault(c.date)) events.push(`<div class="event nmc" onclick="event.stopPropagation();toggleNmc('${c.date}')">NMC ✓</div>`);
  else if(dutyFor(c.date)) events.push(`<div class="event proposed" onclick="event.stopPropagation();toggleNmc('${c.date}')">NMC not punched</div>`);
  if(c.inMonth && !leaveFor(c.date).length && !holiday && !isWeekend(c.date) && dutyFor(c.date)){
    const suggestion=possibleLeaveFor(c.date);
    if(suggestion) events.push(`<div class="possible" onclick="event.stopPropagation();addSuggestedLeave('${c.date}')">＋ Possible CL</div>`);
  }
  return `<div class="day ${c.inMonth?"":"muted-day"} ${isWeekend(c.date)?"weekend":""} ${c.date===today?"today":""}" data-date="${c.date}" onclick="openDay('${c.date}')" ondragover="allowDrop(event)" ondrop="dropEvent(event,'${c.date}')" ondragenter="this.classList.add('drop-target')" ondragleave="this.classList.remove('drop-target')">
    <div class="day-number">${d.getDate()}</div><div class="day-events">${events.join("")}</div>
  </div>`;
}
function possibleLeaveFor(date){
  if(!dutyFor(date) || leaveFor(date).length) return false;
  const m=monthKey(parseDate(date));
  return usedThisMonth("CL",m)<3 && remaining("CL")>0;
}
function shiftMonth(delta){
  if(delta===0){state.month="2026-09-01"} else {
    const d=parseDate(state.month); d.setMonth(d.getMonth()+delta); state.month=iso(new Date(d.getFullYear(),d.getMonth(),1));
  }
  saveState(); renderAll();
}
function openDay(date){
  const leaves=leaveFor(date), holiday=holidayFor(date), duty=dutyFor(date), punched=isNmcDefault(date);
  document.getElementById("modalEyebrow").textContent = isWeekend(date) ? "WEEKEND / DUTY CALENDAR" : "DAY DETAILS";
  document.getElementById("modalTitle").textContent=fmtDate(date,{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  document.getElementById("modalBody").innerHTML=`
    <div class="modal-section">
      <div class="list">
        ${duty?`<div class="list-row"><div><strong>Duty roster</strong><div class="small muted">Scheduled duty</div></div><span class="pill duty">Duty</span></div>`:""}
        ${holiday?`<div class="list-row"><div><strong>General holiday</strong><div class="small muted">${holiday.name}</div></div><span class="pill holiday">Holiday</span></div>`:""}
        ${leaves.map(e=>`<div class="list-row"><div><strong>${leaveMeta[e.type]?.name||e.label}</strong><div class="small muted">${e.duration===.5?"Half day":"Full day"}</div></div><span class="pill ${leaveMeta[e.type]?.cls||''}">${e.type}</span></div>`).join("")}
        ${!duty&&!holiday&&!leaves.length?`<div class="empty">No scheduled leave or duty.</div>`:""}
      </div>
    </div>
    <div class="modal-section">
      <div class="card-title"><h3>NMC punch</h3><span class="pill ${punched?"scl":"proposed"}">${punched?"Punched":"Not punched"}</span></div>
      <p class="small muted">The demo assumes NMC is punched automatically on scheduled working/duty days. Use the button only to record an exception or a Sunday/holiday punch.</p>
      <button class="button ${punched?"danger":"secondary"}" onclick="toggleNmc('${date}');closeModal()">${punched?"Mark as not punched":"Mark NMC punched"}</button>
    </div>
    <div class="modal-section">
      <h3>Planning</h3>
      <div class="modal-actions">
        ${possibleLeaveFor(date)?`<button class="button" onclick="addSuggestedLeave('${date}');closeModal()">Add CL here</button>`:""}
        <button class="button secondary" onclick="setPlannerDate('${date}');closeModal()">Use in leave planner</button>
      </div>
    </div>`;
  document.getElementById("modal").classList.remove("hidden");
}
function closeModal(){document.getElementById("modal").classList.add("hidden")}
function toggleNmc(date){
  if(isNmcDefault(date)){
    state.nmcExceptions[date]={punched:false,note:"Doctor marked NMC not punched"};
  } else {
    state.nmcExceptions[date]={punched:true,note:"Doctor marked NMC punched"};
  }
  saveState(); renderAll();
}
function addSuggestedLeave(date){
  const m=monthKey(parseDate(date));
  if(usedThisMonth("CL",m)>=3 || remaining("CL")<=0){alert("That would exceed the demo CL rule.");return}
  state.leaveEvents.push({id:"l"+Date.now(),date,type:"CL",label:"CL",duration:1});
  state.balances.CL.used += 1;
  saveState(); renderAll();
}
function allowDrop(e){e.preventDefault();draggedEvent=e.currentTarget; e.dataTransfer.dropEffect="move"}
document.addEventListener("dragstart",e=>{
  if(e.target.matches(".event[draggable='true']")){draggedEvent=e.target.dataset.eventId;e.dataTransfer.setData("text/plain",draggedEvent)}
});
function dropEvent(e,date){
  e.preventDefault();e.currentTarget.classList.remove("drop-target");
  const id=e.dataTransfer.getData("text/plain")||draggedEvent;
  const ev=state.leaveEvents.find(x=>x.id===id); if(!ev)return;
  const old=ev.date;
  const oldMonth=monthKey(parseDate(old)), newMonth=monthKey(parseDate(date));
  if(ev.type==="CL" && oldMonth!==newMonth && usedThisMonth("CL",newMonth)>=3){alert("Cannot move this CL: the destination month already has 3 CL days.");return}
  if(leaveFor(date).length || dutyFor(date)===false){ 
    if(!confirm("This destination may conflict with the roster. Move the leave here anyway for demo purposes?")) return;
  }
  ev.date=date;
  saveState(); renderAll();
}
function setPlannerDate(date){ setView("planner"); document.getElementById("plannerStart").value=date; }
function renderPlanner(){
  const el=document.getElementById("view-planner");
  const start=plannerResults.length?plannerResults[0].start:"2026-10-02";
  el.innerHTML=`
    <div class="card card-pad">
      <div class="card-title"><div><div class="eyebrow">CONSTRAINT-BASED DEMO</div><h2>What kind of leave can I take?</h2></div><span class="pill proposed">No AI</span></div>
      <p class="small muted">Choose what you want. The demo checks simple rules and shows scenarios. A production version can replace this search with a constraint solver.</p>
      <div class="planner-controls">
        <div class="field"><label>Break length</label><select id="plannerLength"><option value="3">3 days</option><option value="4" selected>4 days</option><option value="5">5 days</option><option value="6">6 days</option><option value="7">7 days</option></select></div>
        <div class="field"><label>From</label><input id="plannerStart" type="date" value="${start}"></div>
        <div class="field"><label>To</label><input id="plannerEnd" type="date" value="2026-10-31"></div>
        <div class="field"><label>Prefer</label><select id="plannerPriority"><option value="long">Longest break / fewest leave days</option><option value="ccl">Use expiring CCL</option><option value="cl">Use CL</option></select></div>
        <button class="button" onclick="findLeaveOptions()">Find options</button>
      </div>
      <div class="checkbox-row">
        <label class="check"><input id="preferWeekend" type="checkbox" checked> Connect weekends</label>
        <label class="check"><input id="preferHoliday" type="checkbox" checked> Connect holidays</label>
        <label class="check"><input id="useCCL" type="checkbox" checked> Consider CCL</label>
      </div>
    </div>
    <div class="grid grid-2 section-space">
      <div class="card card-pad">
        <div class="card-title"><h3>How the demo thinks</h3></div>
        <div class="callout">It looks at the duty roster, existing leave, weekends, holidays and simple leave limits. It does not make an official approval decision.</div>
        <div class="list section-space">
          <div class="list-row"><span>CL remaining</span><strong>${remaining("CL")}</strong></div>
          <div class="list-row"><span>CL used this month</span><strong>${usedThisMonth("CL",state.month)} / 3</strong></div>
          <div class="list-row"><span>Active CCL</span><strong>${activeCCL().length}</strong></div>
          <div class="list-row"><span>NMC punches this month</span><strong>${nmcCountForMonth(state.month)} / 21</strong></div>
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>Try moving a leave</h3></div>
        <p class="small muted">Go to Calendar and drag an existing leave chip to another day. The dashboard and history update immediately.</p>
        <button class="button secondary" onclick="setView('calendar')">Open calendar</button>
      </div>
    </div>
    <div class="section-space">
      ${plannerResults.length?`<div class="grid grid-2">${plannerResults.map((r,i)=>scenarioHtml(r,i===0)).join("")}</div>`:`<div class="card empty">Choose your requirements and click <strong>Find options</strong>.</div>`}
    </div>`;
}
function findLeaveOptions(){
  const len=Number(document.getElementById("plannerLength").value);
  const from=parseDate(document.getElementById("plannerStart").value);
  const to=parseDate(document.getElementById("plannerEnd").value);
  const priority=document.getElementById("plannerPriority").value;
  const useCCL=document.getElementById("useCCL").checked;
  const out=[];
  for(let d=new Date(from); d<=to; d.setDate(d.getDate()+1)){
    const dates=[];
    for(let i=0;i<len;i++){const x=new Date(d);x.setDate(x.getDate()+i);dates.push(iso(x))}
    if(dates[dates.length-1]>iso(to)) continue;
    const existing=dates.flatMap(x=>leaveFor(x));
    if(existing.length) continue;
    const dutyDates=dates.filter(x=>dutyFor(x));
    const holidays=dates.filter(x=>holidayFor(x));
    const weekends=dates.filter(x=>isWeekend(x));
    const outsideDuty=dates.filter(x=>!dutyFor(x)&&!holidayFor(x)&&!isWeekend(x));
    let clNeeded=dutyDates.length;
    let cclNeeded=0;
    const ccl=expiringCCL();
    if(useCCL && ccl && ccl.expiry>=dates[0] && ccl.expiry<=dates[dates.length-1]) cclNeeded=1, clNeeded=Math.max(0,clNeeded-1);
    const month=monthKey(d);
    if(usedThisMonth("CL",month)+clNeeded>3 || remaining("CL")<clNeeded) continue;
    if(clNeeded===0 && cclNeeded===0) continue;
    const score=(weekends.length*8)+(holidays.length*10)+(cclNeeded*priority==="ccl"?30:0)-(clNeeded*4)-(outsideDuty.length*2);
    out.push({start:dates[0],end:dates.at(-1),days:len,cl:clNeeded,ccl:cclNeeded,weekends:weekends.length,holidays:holidays.length,duty:dutyDates.length,score});
  }
  out.sort((a,b)=>b.score-a.score);
  plannerResults=out.slice(0,8);
  renderPlanner();
}
function scenarioHtml(r,best){
  return `<div class="scenario ${best?"best":""}">
    <div class="scenario-head"><div><div class="scenario-title">${fmtDate(r.start)} – ${fmtDate(r.end)}</div><div class="scenario-days">${r.days} consecutive calendar days</div></div>${best?`<span class="pill proposed">Suggested</span>`:""}</div>
    <div class="scenario-stats">
      <span class="scenario-stat">CL: <strong>${r.cl}</strong></span>
      <span class="scenario-stat">CCL: <strong>${r.ccl}</strong></span>
      <span class="scenario-stat">Weekend: <strong>${r.weekends}</strong></span>
      <span class="scenario-stat">Holiday: <strong>${r.holidays}</strong></span>
      <span class="scenario-stat">Roster duty: <strong>${r.duty}</strong></span>
    </div>
    <div class="scenario-actions"><button class="button small-btn" onclick="applyScenario('${r.start}','${r.end}',${r.cl},${r.ccl})">Use this plan</button><button class="button secondary small-btn" onclick="showScenario('${r.start}','${r.end}')">Show on calendar</button></div>
  </div>`;
}
function applyScenario(start,end,cl,ccl){
  const dates=[];for(let d=parseDate(start);d<=parseDate(end);d.setDate(d.getDate()+1))dates.push(iso(new Date(d)));
  const cclCredit=expiringCCL();
  let cclLeft=ccl;
  dates.forEach(date=>{
    if(!dutyFor(date)) return;
    if(cclLeft && cclCredit){state.leaveEvents.push({id:"l"+Date.now()+Math.random(),date,type:"CCL",label:"CCL",duration:1});cclCredit.used=date;cclLeft=0}
    else {state.leaveEvents.push({id:"l"+Date.now()+Math.random(),date,type:"CL",label:"CL",duration:1});state.balances.CL.used+=1}
  });
  saveState(); renderAll(); setView("calendar");
}
function showScenario(start,end){
  state.month=start.slice(0,7)+"-01"; saveState(); setView("calendar");
  setTimeout(()=>alert(`Scenario highlighted conceptually: ${fmtDate(start)} – ${fmtDate(end)}. In the next prototype this could be shown directly on the calendar before applying it.`),50);
}
function renderHistory(){
  const el=document.getElementById("view-history");
  const events=[...state.leaveEvents].sort((a,b)=>b.date.localeCompare(a.date));
  const totalByType={};events.forEach(e=>totalByType[e.type]=(totalByType[e.type]||0)+(e.duration||1));
  el.innerHTML=`
    <div class="grid grid-3">
      ${["CL","EL","SCL"].map(t=>`<div class="card stat-card"><div class="stat-top"><span>${leaveMeta[t].name}</span><span class="pill ${leaveMeta[t].cls}">${t}</span></div><div class="stat-number">${totalByType[t]||0}<span class="muted" style="font-size:12px"> days used</span></div><div class="stat-meta">${state.balances[t].total-(totalByType[t]||0)} remaining in this demo</div></div>`).join("")}
    </div>
    <div class="card card-pad section-space">
      <div class="card-title"><div><div class="eyebrow">HISTORICAL LEAVE SUMMARY</div><h2>What has been taken?</h2></div><button class="button secondary small-btn" onclick="exportCSV()">Export CSV</button></div>
      <table class="table"><thead><tr><th>Date</th><th>Leave</th><th>Duration</th><th>Notes</th></tr></thead><tbody>
      ${events.map(e=>`<tr><td>${fmtDate(e.date)}</td><td><span class="pill ${leaveMeta[e.type]?.cls||''}">${e.type}</span> ${leaveMeta[e.type]?.name||e.label}</td><td>${e.duration===.5?"Half day":"Full day"}</td><td>${e.type==="EL"?"Earned leave":e.type==="CL"?"Casual leave":"Recorded leave"}</td></tr>`).join("")}
      </tbody></table>
    </div>
    <div class="card card-pad section-space">
      <div class="card-title"><h3>Compensatory leave credits</h3><span class="pill ccl">${activeCCL().length} active</span></div>
      <table class="table"><thead><tr><th>Earned</th><th>Reason</th><th>Expires</th><th>Status</th></tr></thead><tbody>
      ${state.cclCredits.map(c=>`<tr><td>${fmtDate(c.earned)}</td><td>${c.reason}</td><td>${fmtDate(c.expiry)}</td><td>${c.used?`Used ${fmtDate(c.used)}`:`<span class="pill ccl">Available</span>`}</td></tr>`).join("")}
      </tbody></table>
    </div>`;
}
function renderRules(){
  const el=document.getElementById("view-rules");
  el.innerHTML=`
    <div class="card card-pad">
      <div class="card-title"><div><div class="eyebrow">CONFIGURATION PREVIEW</div><h2>Leave rules for this demo</h2></div><span class="pill proposed">Editable policy later</span></div>
      <div class="rule-grid">
        <div class="rule"><strong>Casual Leave · 15/year</strong><span class="small muted">Maximum 3 CL days in one calendar month. Half days are supported. Unused CL is not encashed in this demo.</span></div>
        <div class="rule"><strong>Restricted Holiday · 1 per 6 months</strong><span class="small muted">The demo shows 2 RH credits across the year.</span></div>
        <div class="rule"><strong>Special Casual Leave · 10/year</strong><span class="small muted">Intended for conferences and other approved special purposes.</span></div>
        <div class="rule"><strong>Earned Leave · 30/year</strong><span class="small muted">Maximum 8 days in one stretch. A 3-month gap is required between EL periods.</span></div>
        <div class="rule"><strong>Compensatory Leave</strong><span class="small muted">Each credit has its own expiry date. The demo uses a 3-month validity period.</span></div>
        <div class="rule"><strong>NMC punches · 21/month</strong><span class="small muted">The demo assumes scheduled working/duty days are punched automatically. Exceptions are manually recorded.</span></div>
      </div>
      <div class="callout section-space"><strong>Important for the real product:</strong> these rules should eventually be configurable per hospital and stored with a policy version. The app should explain which rule caused a warning rather than hiding the calculation behind AI.</div>
    </div>
    <div class="card card-pad section-space">
      <div class="card-title"><h3>Design questions for the doctor</h3></div>
      <div class="list">
        <div class="list-row"><span>Is the dashboard showing the right information first?</span><span class="pill proposed">Feedback</span></div>
        <div class="list-row"><span>Are the calendar colours easy to distinguish?</span><span class="pill proposed">Feedback</span></div>
        <div class="list-row"><span>Would “Plan my leave” be useful?</span><span class="pill proposed">Feedback</span></div>
        <div class="list-row"><span>What should be visible without opening another screen?</span><span class="pill proposed">Feedback</span></div>
      </div>
    </div>`;
}
function exportCSV(){
  const rows=[["Date","Leave type","Label","Duration"]];
  state.leaveEvents.sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>rows.push([e.date,e.type,e.label,e.duration]));
  const csv=rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="doctor-leave-history.csv";a.click();URL.revokeObjectURL(a.href);
}
document.getElementById("closeModal").onclick=closeModal;
document.querySelector(".modal-backdrop").onclick=closeModal;
document.getElementById("todayBtn").onclick=()=>{state.month="2026-09-01";saveState();setView("calendar")};
document.getElementById("resetDemo").onclick=()=>{if(confirm("Reset all demo changes?")){state=structuredClone(initialState);saveState();renderAll();}};
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
renderAll();
