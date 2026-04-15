
// ══════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function todayIso(){return new Date().toISOString().slice(0,10)}
function autoGrow(el){el.style.height='auto';el.style.height=el.scrollHeight+'px'}
function friendly(iso){if(!iso)return '';const d=new Date(iso+'T00:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
function deepClone(o){return JSON.parse(JSON.stringify(o))}
function stripHtml(h){return(h||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function isoDate(d){return d.toISOString().slice(0,10)}
function eachIsoDay(start,end,fn){
  const cur=new Date(start+'T00:00:00')
  const endDate=new Date(end+'T00:00:00')
  while(cur<=endDate){
    fn(isoDate(cur))
    cur.setDate(cur.getDate()+1)
  }
}
function addCalendarItem(map,key,item){
  if(!map[key])map[key]=[]
  map[key].push(item)
}
function addProjectRange(map,p,m,extra={}){
  if(!p.startDate&&!p.endDate)return
  const start=p.startDate||p.endDate
  const end=p.endDate||p.startDate
  eachIsoDay(start,end,iso=>{
    let segment='mid'
    if(start===end)segment='single'
    else if(iso===start)segment='start'
    else if(iso===end)segment='end'
    addCalendarItem(map,iso,{kind:'project-range',p,m,segment,...extra})
  })
}

// ══════════════════════════════════════════════════════
//  DEFAULT DATA
// ══════════════════════════════════════════════════════
const COLORS=['#6376DA','#E88B6D','#6DB8E8','#9B6DE8','#50C08A','#E8CC5A','#E86D8B','#5AC8E8']
function mkProject(name){return{id:uid(),name,status:'active',summary:'',startDate:'',endDate:'',tasks:[],notes:[],links:[],meetings:[],travel:[]}}
function mkBrand(name,projects=[]){return{id:uid(),name,projects}}
function mkMember(name,color,brands=[],isMe=false){return{id:uid(),name,color,brands,isMe}}

const DEFAULT={
  version:'2.0',showArchived:false,scratchpad:'',
  members:[
    mkMember('Me',COLORS[0],[mkBrand('My Projects',[])],true),
    mkMember('Pierre',COLORS[1],[mkBrand('Cole Haan',[mkProject('Cole Haan Spring 2027')]),mkBrand('Haggar',[]),mkBrand('Dockers',[])]),
    mkMember('Rebecca',COLORS[2],[]),
    mkMember('Puma',COLORS[3],[]),
    mkMember('Sarah',COLORS[4],[]),
    mkMember('Michelle',COLORS[5],[])
  ]
}

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let state = deepClone(DEFAULT)

function migrate(d){
  // Top-level fields
  if(!('scratchpad'in d))d.scratchpad=''
  for(const m of d.members||[])for(const b of m.brands||[])for(const p of b.projects||[]){
    // Project-level fields
    if(!('summary'  in p))p.summary=''
    if(!('startDate'in p))p.startDate=''
    if(!('endDate'  in p))p.endDate=''
    if(!('meetings' in p))p.meetings=[]
    if(!('travel'   in p))p.travel=[]
    // Tasks
    for(const t of p.tasks||[]){
      if('due'in t&&!('dueDate'in t)){t.dueDate=t.due;delete t.due}
      if(!('startDate'in t))t.startDate=''
      // Migrate done → progress
      if(!('progress'in t))t.progress=t.done?'completed':'not-started'
      // Task micro-note
      if(!('note'in t))t.note=''
      if(!('priority'in t))t.priority=''
      if(!('assignee'in t))t.assignee=''
    }
    // Notes
    for(const n of p.notes||[]){if('content'in n&&!('body'in n)){n.body=n.content;delete n.content}}
  }
  return d
}

// ── INDEXEDDB (primary persistent storage) ────────────
const IDB = {
  _db: null,
  async db() {
    if (this._db) return this._db
    return new Promise((res, rej) => {
      const req = indexedDB.open('StudioApp_v2', 1)
      req.onupgradeneeded = e => e.target.result.createObjectStore('kv')
      req.onsuccess = e => { this._db = e.target.result; res(this._db) }
      req.onerror = e => rej(e.target.error)
    })
  },
  async get(key) {
    const d = await this.db()
    return new Promise((res, rej) => {
      const req = d.transaction('kv','readonly').objectStore('kv').get(key)
      req.onsuccess = e => res(e.target.result)
      req.onerror = e => rej(e.target.error)
    })
  },
  async set(key, val) {
    const d = await this.db()
    return new Promise((res, rej) => {
      const req = d.transaction('kv','readwrite').objectStore('kv').put(val, key)
      req.onsuccess = () => res()
      req.onerror = e => rej(e.target.error)
    })
  }
}

// ══════════════════════════════════════════════════════
//  SUPABASE CLOUD SYNC
// ══════════════════════════════════════════════════════
// Credentials loaded from config.js (not committed to git — see config.example.js)
const SUPABASE_URL = window.STUDIO_CONFIG?.SUPABASE_URL || 'https://gzbyncxpmwtpwaegfrnx.supabase.co'
const SUPABASE_KEY = window.STUDIO_CONFIG?.SUPABASE_KEY || ''
const SB_TABLE = 'studio_state'
const SB_ROW = 'main'
let _cloudTimer = null
const IS_FILE_PROTOCOL = location.protocol === 'file:'

function setBootMessage(msg,isError=false){
  const wrap=document.getElementById('bootFallback')
  const el=document.getElementById('bootMsg')
  if(el)el.innerHTML=msg
  if(wrap)wrap.classList.remove('hidden')
  if(isError&&wrap)wrap.style.background='linear-gradient(180deg,#fff8f6 0%,#fdf0eb 100%)'
}

function hideBootMessage(){
  const wrap=document.getElementById('bootFallback')
  if(wrap)wrap.classList.add('hidden')
}

function setSyncDot(status){
  const dot = document.getElementById('syncDot')
  if(dot) dot.className = 'sync-dot' + (status !== 'ok' ? ' ' + status : '')
}

function safeStorageGet(key){
  try{return localStorage.getItem(key)}catch{return null}
}

function safeStorageSet(key,val){
  try{localStorage.setItem(key,val);return true}catch{return false}
}

function setLockHelp(msg=''){
  const help=document.getElementById('lockHelp')
  if(help)help.textContent=msg
}

function showStartupError(msg){
  const content=document.getElementById('mainContent')
  const bc=document.getElementById('bc')
  const acts=document.getElementById('tbActions')
  const vt=document.getElementById('viewToggle')
  const lock=document.getElementById('lockScreen')
  if(lock)lock.style.display='none'
  if(vt)vt.style.display='none'
  if(acts)acts.innerHTML=''
  if(bc)bc.innerHTML='<span>Studio W</span>'
  if(content){
    content.innerHTML=`<div class="empty"><div class="empty-ico">⚠️</div><div class="empty-ttl">Studio could not start</div><div class="empty-sub">${esc(msg)}</div></div>`
  }
  setBootMessage(`Startup stopped before the app could render.<br><strong>${esc(msg)}</strong>`,true)
}

async function cloudLoad(){
  if(IS_FILE_PROTOCOL)return null
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SB_TABLE}?id=eq.${SB_ROW}&select=data`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  })
  if(!res.ok) throw new Error('cloud load failed: ' + res.status)
  const rows = await res.json()
  return rows[0]?.data || null
}

async function cloudSave(data){
  if(IS_FILE_PROTOCOL)return
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SB_TABLE}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ id: SB_ROW, data, updated_at: new Date().toISOString() })
  })
  if(!res.ok) throw new Error('cloud save failed: ' + res.status)
}

function debouncedCloudSave(){
  setSyncDot('syncing')
  clearTimeout(_cloudTimer)
  _cloudTimer = setTimeout(async () => {
    try {
      await cloudSave(state)
      setSyncDot('ok')
    } catch(e) {
      console.warn('Cloud save failed:', e)
      setSyncDot('error')
    }
  }, 1500)
}

function save() {
  // Primary: IndexedDB — survives browser restarts reliably
  IDB.set('state', state).catch(() => {})
  // Belt-and-suspenders: also write to localStorage as a backup
  safeStorageSet('studio_v2_bk', JSON.stringify(state))
  // Cloud sync — debounced so rapid edits don't spam the API
  debouncedCloudSave()
}

let selId=null          // selected project id
let viewMode='worklist' // 'worklist'|'home'|'detail'|'calendar'|'sync'|'allcal'|'globaltasks'|'today'
let _drag=null          // {type,id,parentId} for sidebar drag-reorder
let calMode='month'     // 'month'|'6month'
let calDate=new Date()  // current calendar month reference
let calFilter='all'     // 'all'|'tasks'|'meetings'
let calOwnerFilter='all'
let dashFilter='all'    // 'all'|'mine'|'critical'
let dashBrandFilter='all'
let showDone=false
let sortByDue=false     // sort tasks by due date
let calTravelFilter=false // show only travel items in calendar
let themeMode='light'   // 'light'|'dark'|'system'
let openMembers=new Set(state.members.filter(m=>m.isMe).map(m=>m.id))
let openBrands=new Set()
let modalCb=null
let modalType=null
let modalCtx=null

// ── WORK LIST / OVERHAUL STATE ─────────────────────────────
let viewScope = {type:'today'}      // {type:'all'|'today'|'overdue'|'thisweek'|'nodate'|'assignee'|'member'|'brand'|'project', id?}
let wlGroupBy = 'project'           // 'project'|'due'|'assignee'|'priority'|'none'
let wlFilter = ''                   // text filter
let wlSortBy = 'due'                // 'due'|'priority'|'title'
let wlShowDone = false
let selectedTaskIds = new Set()     // Set of "pid::tid" strings for multi-select
let cmdBarOpen = false
let cmdBarCtx = null                // optional context when opening cmd bar


// ══════════════════════════════════════════════════════
//  FINDERS
// ══════════════════════════════════════════════════════
function findProject(id){
  for(const m of state.members)for(const b of m.brands)for(const p of b.projects)
    if(p.id===id)return{p,b,m}
  return null
}
function findBrand(id){for(const m of state.members)for(const b of m.brands)if(b.id===id)return{b,m};return null}
function sel(){return selId?findProject(selId):null}

// Collect all tasks across all members
function allTasks(){
  const result=[]
  for(const m of state.members)for(const b of m.brands)for(const p of b.projects)
    for(const t of p.tasks)result.push({t,p,b,m})
  return result
}

function allActiveProjects(){
  const result=[]
  for(const m of state.members)for(const b of m.brands)for(const p of b.projects)
    if(p.status!=='archived')result.push({p,b,m})
  return result
}

// ══════════════════════════════════════════════════════
//  ALERTS COMPUTATION
// ══════════════════════════════════════════════════════
function computeAlerts(){
  const td=todayIso()
  const soon=new Date(Date.now()+7*864e5).toISOString().slice(0,10)
  const overdue=[], upcoming=[]
  for(const {t,p,b,m} of allTasks()){
    if(t.done||!t.dueDate||p.status==='archived')continue
    if(t.dueDate<td)overdue.push({t,p,b,m})
    else if(t.dueDate<=soon)upcoming.push({t,p,b,m})
  }
  return{overdue,upcoming}
}

function projectHealth(project){
  const openTasks=project.p.tasks.filter(t=>(t.progress||'not-started')!=='completed')
  const overdue=openTasks.filter(t=>t.dueDate&&t.dueDate<todayIso()).length
  const upcoming=openTasks.filter(t=>t.dueDate&&t.dueDate>=todayIso()).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''))[0]
  let status='ontrack'
  if(overdue>0)status='critical'
  else if(upcoming&&upcoming.dueDate){
    const diff=(new Date(upcoming.dueDate)-new Date(todayIso()))/864e5
    if(diff<=5)status='atrisk'
  }
  const total=Math.max(project.p.tasks.length,1)
  const done=project.p.tasks.filter(t=>(t.progress||'not-started')==='completed').length
  return{status,overdue,upcoming,done,total}
}

// ══════════════════════════════════════════════════════
//  SIDEBAR DRAG-TO-REORDER
// ══════════════════════════════════════════════════════
function sbDragStart(e,type,id,parentId){
  _drag={type,id,parentId}
  e.dataTransfer.effectAllowed='move'
  e.currentTarget.classList.add('sb-dragging')
}
function sbDragEnd(e){
  e.currentTarget.classList.remove('sb-dragging')
  document.querySelectorAll('.sb-drag-over').forEach(el=>el.classList.remove('sb-drag-over'))
  _drag=null
}
function canDropOn(accept){
  if(!_drag)return false
  return String(accept).split(',').map(s=>s.trim()).includes(_drag.type)
}
function sbDragOver(e,accept){
  if(!canDropOn(accept))return
  e.preventDefault()
  e.dataTransfer.dropEffect='move'
  document.querySelectorAll('.sb-drag-over').forEach(el=>el.classList.remove('sb-drag-over'))
  e.currentTarget.classList.add('sb-drag-over')
}
function ensureMemberDropBrand(member){
  if(member.brands.length)return member.brands[0]
  const name=member.isMe?'My Projects':'Transferred Projects'
  const brand=mkBrand(name,[])
  member.brands.push(brand)
  openBrands.add(brand.id)
  return brand
}
function moveBrandToMember(brandId,targetMemberId,beforeBrandId=null){
  const source=findBrand(brandId)
  const targetMember=state.members.find(m=>m.id===targetMemberId)
  if(!source||!targetMember)return false
  if(source.m.id===targetMemberId&&!beforeBrandId)return false
  source.m.brands=source.m.brands.filter(b=>b.id!==brandId)
  const insertAt=beforeBrandId?targetMember.brands.findIndex(b=>b.id===beforeBrandId):-1
  if(insertAt>=0)targetMember.brands.splice(insertAt,0,source.b)
  else targetMember.brands.push(source.b)
  openMembers.add(targetMember.id)
  openBrands.add(source.b.id)
  return true
}
function moveProjectToBrand(projectId,targetBrandId,beforeProjectId=null){
  const source=findProject(projectId)
  const target=findBrand(targetBrandId)
  if(!source||!target)return false
  if(source.b.id===targetBrandId&&beforeProjectId===projectId)return false
  source.b.projects=source.b.projects.filter(p=>p.id!==projectId)
  const insertAt=beforeProjectId?target.b.projects.findIndex(p=>p.id===beforeProjectId):-1
  if(insertAt>=0)target.b.projects.splice(insertAt,0,source.p)
  else target.b.projects.push(source.p)
  openMembers.add(target.m.id)
  openBrands.add(target.b.id)
  return true
}
function moveProjectToMember(projectId,targetMemberId){
  const source=findProject(projectId)
  const targetMember=state.members.find(m=>m.id===targetMemberId)
  if(!source||!targetMember)return false
  const targetBrand=ensureMemberDropBrand(targetMember)
  return moveProjectToBrand(projectId,targetBrand.id,null)
}
function sbDrop(e,type,id,parentId){
  e.preventDefault()
  e.currentTarget.classList.remove('sb-drag-over')
  if(!_drag)return
  let changed=false
  if(type==='member'&&_drag.type==='member'&&_drag.id!==id){
    const arr=state.members
    const fi=arr.findIndex(m=>m.id===_drag.id),ti=arr.findIndex(m=>m.id===id)
    arr.splice(ti,0,arr.splice(fi,1)[0])
    changed=true
  } else if(type==='member'&&_drag.type==='brand'){
    changed=moveBrandToMember(_drag.id,id,null)
  } else if(type==='member'&&_drag.type==='project'){
    changed=moveProjectToMember(_drag.id,id)
  } else if(type==='brand'&&_drag.type==='brand'&&_drag.id!==id){
    const targetMember=state.members.find(m=>m.id===parentId);if(!targetMember)return
    changed=moveBrandToMember(_drag.id,targetMember.id,id)
  } else if(type==='brand'&&_drag.type==='project'){
    changed=moveProjectToBrand(_drag.id,id,null)
  } else if(type==='project'&&_drag.type==='project'&&_drag.id!==id){
    const fb=findBrand(parentId);if(!fb)return
    const arr=fb.b.projects
    const fi=arr.findIndex(p=>p.id===_drag.id),ti=arr.findIndex(p=>p.id===id)
    arr.splice(ti,0,arr.splice(fi,1)[0])
    changed=true
  }
  if(changed){save();render()}
}

// ══════════════════════════════════════════════════════
//  SIDEBAR RENDER
// ══════════════════════════════════════════════════════
function toggleProjectArchive(pid){
  const f=findProject(pid);if(!f)return
  if(f.p.status==='archived'){
    f.p.status='active'
    save();render()
  } else {
    showConfirm(`Archive "${f.p.name}"?\nIt will be hidden from the sidebar — use "Show archived" to access it later.`,()=>{
      f.p.status='archived'
      if(selId===pid){selId=null}
      save();render()
    },'Archive')
  }
}

function renderSidebar(){
  const tree=document.getElementById('sbTree')
  const{overdue,upcoming}=computeAlerts()
  let h=''

  // Alerts section
  if(overdue.length||upcoming.length){
    h+=`<div class="sb-lbl">Alerts</div><div class="alert-section">`
    overdue.slice(0,3).forEach(({t,p,m})=>{
      h+=`<div class="alert-row" onclick="goProject('${p.id}')">
        <div class="alert-dot" style="background:var(--red)"></div>
        <div class="alert-text"><span class="alert-name">${esc(p.name)}</span><br><span class="alert-sub">Overdue: ${esc(t.text.slice(0,30))}</span></div>
      </div>`
    })
    upcoming.slice(0,3).forEach(({t,p})=>{
      h+=`<div class="alert-row" onclick="goProject('${p.id}')">
        <div class="alert-dot" style="background:var(--warn)"></div>
        <div class="alert-text"><span class="alert-name">${esc(p.name)}</span><br><span class="alert-sub">Due ${friendly(t.dueDate)}</span></div>
      </div>`
    })
    h+=`</div>`
  }

  // Scope chips (work list entry points)
  const countToday=countTasksForScope('today'), countOverdue=countTasksForScope('overdue'), countWeek=countTasksForScope('thisweek'), countAll=countTasksForScope('all')
  const scopeOn=t=>viewMode==='worklist' && viewScope.type===t && !viewScope.id
  h+=`<div class="sb-lbl">Work</div>
    <div class="sb-scopes">
      <button class="sb-scope-btn ${scopeOn('today')?'on':''}" onclick="setScope('today')">
        <span class="sb-scope-ico">📆</span><span class="sb-scope-lbl">Today</span>${countToday?`<span class="sb-scope-ct">${countToday}</span>`:''}
      </button>
      <button class="sb-scope-btn ${scopeOn('overdue')?'on':''}" onclick="setScope('overdue')">
        <span class="sb-scope-ico" style="color:var(--red)">●</span><span class="sb-scope-lbl">Overdue</span>${countOverdue?`<span class="sb-scope-ct" style="background:var(--red-l);color:var(--red)">${countOverdue}</span>`:''}
      </button>
      <button class="sb-scope-btn ${scopeOn('thisweek')?'on':''}" onclick="setScope('thisweek')">
        <span class="sb-scope-ico">📅</span><span class="sb-scope-lbl">This Week</span>${countWeek?`<span class="sb-scope-ct">${countWeek}</span>`:''}
      </button>
      <button class="sb-scope-btn ${scopeOn('all')?'on':''}" onclick="setScope('all')">
        <span class="sb-scope-ico">∞</span><span class="sb-scope-lbl">All Open</span>${countAll?`<span class="sb-scope-ct">${countAll}</span>`:''}
      </button>
    </div>`

  // Me
  const me=state.members.find(m=>m.isMe)
  if(me){h+=`<div class="sb-lbl">Me</div>`;h+=renderMember(me)}

  // Team
  const team=state.members.filter(m=>!m.isMe)
  if(team.length){h+=`<div class="sb-lbl" style="margin-top:4px">Team</div>`;team.forEach(m=>{h+=renderMember(m)})}
  // Update archived count badge in footer
  const archCount=state.members.reduce((n,m)=>n+m.brands.reduce((nb,b)=>nb+b.projects.filter(p=>p.status==='archived').length,0),0)
  const archIcoEl=document.getElementById('archIco')
  const archLblEl=document.getElementById('archLbl')
  if(archIcoEl)archIcoEl.textContent=state.showArchived?'👁':'📦'
  if(archLblEl)archLblEl.textContent=state.showArchived?'Hide archived':(archCount?`Show archived (${archCount})`:'Show archived')

  h+=`<button class="sb-add lv0" onclick="openModal('member')">＋ Add team member</button>`
  tree.innerHTML=h
}

function renderMember(m){
  const open=openMembers.has(m.id)
  let h=`<div class="member-row" draggable="true"
    ondragstart="sbDragStart(event,'member','${m.id}',null)"
    ondragend="sbDragEnd(event)"
    ondragover="sbDragOver(event,'member,brand,project')"
    ondrop="sbDrop(event,'member','${m.id}',null)">
    <div class="m-dot" style="background:${m.color}" onclick="toggleMember('${m.id}')"></div>
    <span class="m-lbl" onclick="toggleMember('${m.id}')">${esc(m.name)}</span>
    <div class="sb-actions">
      <button class="sb-act-btn" title="Edit" onclick="openModal('editMember','${m.id}');event.stopPropagation()">✏</button>
      ${!m.isMe?`<button class="sb-act-btn del" title="Delete" onclick="deleteMember('${m.id}');event.stopPropagation()">✕</button>`:''}
    </div>
    <span class="chev ${open?'open':''}" onclick="toggleMember('${m.id}')">▶</span>
  </div>
  <div class="brand-list ${open?'open':''}">`
  if(m.isMe){
    // "Me" workspace: flatten all brands' projects — no brand headers shown
    const allMyProjs=m.brands.flatMap(b=>
      b.projects.filter(p=>state.showArchived||p.status!=='archived').map(p=>({p,b}))
    )
    allMyProjs.forEach(({p,b})=>{
      const active=p.id===selId
      h+=`<div class="proj-row ${active?'active':''} ${p.status==='archived'?'p-arch':''}"
        draggable="true"
        ondragstart="sbDragStart(event,'project','${p.id}','${b.id}')"
        ondragend="sbDragEnd(event)"
        ondragover="sbDragOver(event,'project')"
        ondrop="sbDrop(event,'project','${p.id}','${b.id}')"
        onclick="goProject('${p.id}')">
        <div class="p-pip"></div><span class="p-lbl">${esc(p.name)}</span>
        ${p.status==='archived'?'<span class="p-arch-ico">📦</span>':''}
        <div class="sb-proj-actions">
          <button class="sb-act-btn" title="${p.status==='archived'?'Unarchive project':'Archive project'}"
            onclick="toggleProjectArchive('${p.id}');event.stopPropagation()">
            ${p.status==='archived'?'↩':'📦'}
          </button>
        </div>
      </div>`
    })
    const defaultBrandId=m.brands[0]?.id
    if(defaultBrandId){
      h+=`<button class="sb-add lv1" onclick="openModal('project','${defaultBrandId}')">＋ Add project</button>`
    }else{
      h+=`<button class="sb-add lv1" onclick="addProjectForMe('${m.id}')">＋ Add project</button>`
    }
  }else{
    m.brands.forEach(b=>{h+=renderBrand(b,m.id)})
    h+=`<button class="sb-add lv1" onclick="openModal('brand','${m.id}')">＋ Add brand / client</button>`
  }
  h+=`</div>`
  return h
}

function addProjectForMe(memberId){
  const m=state.members.find(m=>m.id===memberId)
  if(!m)return
  if(!m.brands.length){
    const b=mkBrand('My Projects',[])
    m.brands.push(b)
    openBrands.add(b.id)
    save()
  }
  openModal('project',m.brands[0].id)
}
function renderBrand(b,memberId){
  const open=openBrands.has(b.id)
  const visible=b.projects.filter(p=>state.showArchived||p.status!=='archived')
  let h=`<div class="brand-row" draggable="true"
    ondragstart="sbDragStart(event,'brand','${b.id}','${memberId}')"
    ondragend="sbDragEnd(event)"
    ondragover="sbDragOver(event,'brand,project')"
    ondrop="sbDrop(event,'brand','${b.id}','${memberId}')">
    <span class="chev ${open?'open':''}" onclick="toggleBrand('${b.id}')">▶</span>
    <span class="b-lbl" onclick="toggleBrand('${b.id}')">${esc(b.name)}</span>
    <div class="sb-actions">
      <button class="sb-act-btn" title="Edit" onclick="openModal('editBrand','${b.id}');event.stopPropagation()">✏</button>
      <button class="sb-act-btn del" title="Delete" onclick="deleteBrand('${b.id}');event.stopPropagation()">✕</button>
    </div>
  </div>
  <div class="proj-list ${open?'open':''}">`
  visible.forEach(p=>{
    const active=p.id===selId
    h+=`<div class="proj-row ${active?'active':''} ${p.status==='archived'?'p-arch':''}"
      draggable="true"
      ondragstart="sbDragStart(event,'project','${p.id}','${b.id}')"
      ondragend="sbDragEnd(event)"
      ondragover="sbDragOver(event,'project')"
      ondrop="sbDrop(event,'project','${p.id}','${b.id}')"
      onclick="goProject('${p.id}')">
      <div class="p-pip"></div><span class="p-lbl">${esc(p.name)}</span>
      ${p.status==='archived'?'<span class="p-arch-ico">📦</span>':''}
      <div class="sb-proj-actions">
        <button class="sb-act-btn" title="${p.status==='archived'?'Unarchive project':'Archive project'}"
          onclick="toggleProjectArchive('${p.id}');event.stopPropagation()">
          ${p.status==='archived'?'↩':'📦'}
        </button>
      </div>
    </div>`
  })
  h+=`<button class="sb-add lv2" onclick="openModal('project','${b.id}')">＋ Add project</button></div>`
  return h
}

// ══════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════
function renderMain(){
  const found=sel()
  const content=document.getElementById('mainContent')
  const bc=document.getElementById('bc')
  const acts=document.getElementById('tbActions')
  const vt=document.getElementById('viewToggle')

  if(viewMode==='worklist'){
    vt.style.display='none'
    bc.innerHTML=`<span class="bc-cur">${scopeLabel()}</span>`
    acts.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="openCmdBar()" title="Quick add (Cmd+K)">⌘K Quick add</button>
      <button class="btn btn-ghost btn-sm" onclick="showView('home')" title="Dashboard">🏠 Dashboard</button>`
    content.innerHTML=renderWorkList()
    return
  }

  if(viewMode==='home'){
    vt.style.display='none'
    bc.innerHTML=`<span class="bc-cur">Studio W</span>`
    acts.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="showView('allcal')">All Teams Calendar</button>`
    content.innerHTML=renderDashboard()
    return
  }

  if(viewMode==='sync'){
    vt.style.display='none'
    bc.innerHTML=`<span>Studio</span><span class="bc-sep">›</span><span class="bc-cur">Cloud Sync &amp; Backup</span>`
    acts.innerHTML=''
    content.innerHTML=renderSyncPanel()
    return
  }

  if(viewMode==='allcal'){
    vt.style.display='none'
    bc.innerHTML=`<span>Studio</span><span class="bc-sep">›</span><span class="bc-cur">All Teams Calendar</span>`
    acts.innerHTML=''
    content.innerHTML=renderAllCalendar()
    return
  }

  if(viewMode==='globaltasks'){
    vt.style.display='none'
    bc.innerHTML=`<span>Studio</span><span class="bc-sep">›</span><span class="bc-cur">My Global Tasks</span>`
    acts.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="showView('home')">Back Home</button>`
    content.innerHTML=renderGlobalTasks()
    return
  }

  if(viewMode==='today'){
    vt.style.display='none'
    bc.innerHTML=`<span>Studio</span><span class="bc-sep">›</span><span class="bc-cur">Today's Focus</span>`
    acts.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="showView('home')">Back Home</button>`
    content.innerHTML=renderTodayView()
    return
  }

  if(!found){
    vt.style.display='none'
    bc.innerHTML=`<span>Studio</span>`
    acts.innerHTML=''
    content.innerHTML=`<div class="empty"><div class="empty-ico">📋</div><div class="empty-ttl">No project open</div><div class="empty-sub">Select a project from the sidebar or create one.</div></div>`
    return
  }

  const{p,b,m}=found
  vt.style.display='flex'
  bc.innerHTML=`<span>${esc(m.name)}</span><span class="bc-sep">›</span><span>${esc(b.name)}</span><span class="bc-sep">›</span><span class="bc-cur">${esc(p.name)}</span>`

  if(p.status==='archived'){
    acts.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="unarchive()">↩ Unarchive</button>`
  } else {
    acts.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="archiveProject()">Archive</button>`
  }

  // Update view toggle buttons
  document.getElementById('vtDetail').className='vt-btn'+(viewMode==='detail'?' active':'')
  document.getElementById('vtCal').className='vt-btn'+(viewMode==='calendar'?' active':'')

  if(viewMode==='calendar'){
    content.innerHTML=renderCalendar(p,m)
  } else {
    content.innerHTML=renderDetail(p,m,b)
    // Restore contenteditable content after render
    restoreEditors(p)
    document.querySelectorAll('.task-txt').forEach(autoGrow)
  }
}


// ══════════════════════════════════════════════════════
//  WORK LIST VIEW — unified task workbench
// ══════════════════════════════════════════════════════
function scopeLabel(){
  const s=viewScope||{type:'all'}
  if(s.type==='today')return "Today's Focus"
  if(s.type==='overdue')return 'Overdue'
  if(s.type==='thisweek')return 'This Week'
  if(s.type==='nodate')return 'No Due Date'
  if(s.type==='all')return 'All Open Tasks'
  if(s.type==='assignee'){
    const m=state.members.find(mx=>mx.id===s.id);return m?`Assigned to ${m.name}`:'Assigned'
  }
  if(s.type==='member'){
    const m=state.members.find(mx=>mx.id===s.id);return m?`${m.name}'s Work`:'Member'
  }
  if(s.type==='brand'){
    for(const m of state.members)for(const b of m.brands)if(b.id===s.id)return `Brand · ${b.name}`
    return 'Brand'
  }
  if(s.type==='project'){
    const f=findProject(s.id);return f?`Project · ${f.p.name}`:'Project'
  }
  return 'Work List'
}

function scopedTasks(){
  const today=todayIso()
  const eow=isoDate(new Date(new Date(today+'T00:00:00').setDate(new Date(today+'T00:00:00').getDate()+7)))
  const s=viewScope||{type:'all'}
  const out=[]
  for(const m of state.members){
    for(const b of m.brands){
      for(const p of b.projects){
        if(p.status==='archived')continue
        if(s.type==='member' && m.id!==s.id)continue
        if(s.type==='brand' && b.id!==s.id)continue
        if(s.type==='project' && p.id!==s.id)continue
        for(const t of p.tasks){
          const prog=t.progress||'not-started'
          const done=prog==='completed'
          if(done && !wlShowDone)continue
          if(s.type==='today' && t.dueDate!==today)continue
          if(s.type==='overdue' && !(t.dueDate && t.dueDate<today && !done))continue
          if(s.type==='thisweek' && !(t.dueDate && t.dueDate>=today && t.dueDate<=eow))continue
          if(s.type==='nodate' && t.dueDate)continue
          if(s.type==='assignee' && t.assignee!==s.id)continue
          if(wlFilter){
            const q=wlFilter.toLowerCase()
            const hay=(t.text+' '+p.name+' '+b.name+' '+m.name).toLowerCase()
            if(!hay.includes(q))continue
          }
          out.push({t,p,b,m})
        }
      }
    }
  }
  // Sort
  const prioOrder={urgent:0,high:1,medium:2,low:3,'':4}
  out.sort((a,b)=>{
    if(wlSortBy==='priority'){
      const d=(prioOrder[a.t.priority||'']??4)-(prioOrder[b.t.priority||'']??4)
      if(d!==0)return d
    }
    if(wlSortBy==='title'){
      return (a.t.text||'').localeCompare(b.t.text||'')
    }
    // due
    return (a.t.dueDate||'9999').localeCompare(b.t.dueDate||'9999')
  })
  return out
}

function renderWorkList(){
  const tasks=scopedTasks()
  const totalAll=tasks.length
  const totalOverdue=tasks.filter(x=>x.t.dueDate && x.t.dueDate<todayIso() && (x.t.progress||'')!=='completed').length

  // Group tasks
  const groups={}
  const groupOrder=[]
  function addTo(key,label,item){
    if(!groups[key]){groups[key]={label,items:[]};groupOrder.push(key)}
    groups[key].items.push(item)
  }
  if(wlGroupBy==='project'){
    tasks.forEach(it=>addTo('p_'+it.p.id,`${it.m.name} · ${it.b.name} · ${it.p.name}`,it))
  } else if(wlGroupBy==='due'){
    const today=todayIso()
    tasks.forEach(it=>{
      let k='nodate',lbl='No due date'
      if(it.t.dueDate){
        if(it.t.dueDate<today){k='overdue';lbl='Overdue'}
        else if(it.t.dueDate===today){k='today';lbl='Today'}
        else{
          const diff=Math.round((new Date(it.t.dueDate)-new Date(today+'T00:00:00'))/864e5)
          if(diff<=7){k='week';lbl='This week'}
          else if(diff<=30){k='month';lbl='This month'}
          else{k='later';lbl='Later'}
        }
      }
      addTo(k,lbl,it)
    })
  } else if(wlGroupBy==='assignee'){
    tasks.forEach(it=>{
      const m=state.members.find(mx=>mx.id===it.t.assignee)
      const k=m?'a_'+m.id:'a_none'
      addTo(k,m?m.name:'Unassigned',it)
    })
  } else if(wlGroupBy==='priority'){
    const labels={urgent:'🔴 Urgent',high:'🟠 High',medium:'🔵 Medium',low:'⚪ Low','':'No priority'}
    tasks.forEach(it=>{
      const k='pr_'+(it.t.priority||'none')
      addTo(k,labels[it.t.priority||''],it)
    })
  } else {
    tasks.forEach(it=>addTo('all','All',it))
  }

  // Scope chips row
  const scopes=[
    {type:'today',label:"Today",count:countTasksForScope('today')},
    {type:'overdue',label:'Overdue',count:countTasksForScope('overdue')},
    {type:'thisweek',label:'This Week',count:countTasksForScope('thisweek')},
    {type:'all',label:'All Open',count:countTasksForScope('all')},
    {type:'nodate',label:'No Date',count:countTasksForScope('nodate')}
  ]
  const isActiveScope=sc=>viewScope.type===sc.type && !viewScope.id

  // Quick-add inline
  const projOpts=allActiveProjects().map(({p,b,m})=>
    `<option value="${esc(p.id)}">[${esc(m.name)}] ${esc(p.name)}</option>`
  ).join('')

  return `<div class="wl">
    <div class="wl-header">
      <div class="wl-title-row">
        <h1 class="wl-title">${scopeLabel()}</h1>
        <div class="wl-title-meta">${totalAll} task${totalAll===1?'':'s'}${totalOverdue?` · <strong style="color:var(--red)">${totalOverdue} overdue</strong>`:''}</div>
      </div>
      <div class="wl-scope-chips">
        ${scopes.map(sc=>`<button class="wl-chip ${isActiveScope(sc)?'on':''}" onclick="setScope('${sc.type}')">${esc(sc.label)}${sc.count?`<span class="wl-chip-ct">${sc.count}</span>`:''}</button>`).join('')}
      </div>
      <div class="wl-toolbar">
        <input class="wl-filter" placeholder="Filter…  (press /)" value="${esc(wlFilter)}" oninput="setWlFilter(this.value)" onkeydown="if(event.key==='Escape'){this.value='';setWlFilter('')}">
        <label class="wl-tool-lbl">Group:</label>
        <select class="wl-sel" onchange="setWlGroup(this.value)">
          <option value="project" ${wlGroupBy==='project'?'selected':''}>Project</option>
          <option value="due" ${wlGroupBy==='due'?'selected':''}>Due date</option>
          <option value="assignee" ${wlGroupBy==='assignee'?'selected':''}>Assignee</option>
          <option value="priority" ${wlGroupBy==='priority'?'selected':''}>Priority</option>
          <option value="none" ${wlGroupBy==='none'?'selected':''}>None</option>
        </select>
        <label class="wl-tool-lbl">Sort:</label>
        <select class="wl-sel" onchange="setWlSort(this.value)">
          <option value="due" ${wlSortBy==='due'?'selected':''}>Due date</option>
          <option value="priority" ${wlSortBy==='priority'?'selected':''}>Priority</option>
          <option value="title" ${wlSortBy==='title'?'selected':''}>Title</option>
        </select>
        <label class="wl-check"><input type="checkbox" ${wlShowDone?'checked':''} onchange="setWlShowDone(this.checked)"> Show completed</label>
        <button class="btn btn-primary btn-sm" onclick="openCmdBar()" title="Cmd+K">＋ Quick add</button>
      </div>
    </div>
    ${totalAll===0?`<div class="empty"><div class="empty-ico">✨</div><div class="empty-ttl">No tasks in this scope</div><div class="empty-sub">Press <kbd>⌘K</kbd> to quick add a task.</div></div>`:`
    <div class="wl-body">
      ${groupOrder.map(k=>{
        const g=groups[k]
        return `<div class="wl-group">
          <div class="wl-group-head">
            <span class="wl-group-title">${esc(g.label)}</span>
            <span class="wl-group-count">${g.items.length}</span>
          </div>
          <div class="wl-group-list">
            ${g.items.map(renderWlRow).join('')}
          </div>
        </div>`
      }).join('')}
    </div>`}
  </div>`
}

function renderWlRow({t,p,b,m}){
  const today=todayIso()
  const prog=t.progress||'not-started'
  const prio=t.priority||''
  const key=p.id+'::'+t.id
  const selected=selectedTaskIds.has(key)
  let dc=''
  if(t.dueDate && prog!=='completed'){
    if(t.dueDate<today)dc='date-over'
    else{const diff=(new Date(t.dueDate)-new Date(today+'T00:00:00'))/864e5;if(diff<=3)dc='date-soon'}
  }
  const assignee=state.members.find(mx=>mx.id===t.assignee)
  return `<div class="wl-row ${selected?'selected':''} ${prog}" data-key="${esc(key)}" onclick="onWlRowClick(event,'${esc(p.id)}','${esc(t.id)}')">
    <input type="checkbox" class="wl-sel-chk" ${selected?'checked':''} onclick="event.stopPropagation();toggleTaskSelect('${esc(p.id)}','${esc(t.id)}')">
    <input type="checkbox" class="wl-done-chk" ${prog==='completed'?'checked':''} onclick="event.stopPropagation()" onchange="toggleTaskGlobal('${esc(t.id)}','${esc(p.id)}',this.checked)">
    <div class="wl-main">
      <div class="wl-txt ${prog==='completed'?'done':''}">${esc(t.text)}</div>
      <div class="wl-meta">
        <span class="wl-proj-chip" onclick="event.stopPropagation();goProject('${esc(p.id)}')" title="Open project">
          <span class="wl-dot" style="background:${m.color}"></span>${esc(p.name)}
        </span>
        ${t.dueDate?`<span class="wl-due ${dc}">${t.dueDate<today && prog!=='completed'?'Overdue · ':''}${esc(friendly(t.dueDate))}</span>`:'<span class="wl-due nodate">No date</span>'}
        ${prio?`<span class="wl-prio prio-${prio}">${prio.charAt(0).toUpperCase()+prio.slice(1)}</span>`:''}
        ${assignee?`<span class="wl-assignee">${esc(assignee.name)}</span>`:''}
      </div>
    </div>
    <div class="wl-row-actions">
      <select class="prog-sel prog-${prog}" onclick="event.stopPropagation()" onchange="toggleTaskProgressGlobal('${esc(t.id)}','${esc(p.id)}',this.value)">
        <option value="not-started" ${prog==='not-started'?'selected':''}>Not Started</option>
        <option value="in-progress" ${prog==='in-progress'?'selected':''}>In Progress</option>
        <option value="completed" ${prog==='completed'?'selected':''}>Completed</option>
      </select>
    </div>
  </div>`
}

function onWlRowClick(e,pid,tid){
  if(e.shiftKey||e.metaKey||e.ctrlKey){
    e.preventDefault()
    toggleTaskSelect(pid,tid)
    return
  }
  // Default: open project
  goProject(pid)
}

function countTasksForScope(type){
  const today=todayIso()
  const eow=isoDate(new Date(new Date(today+'T00:00:00').setDate(new Date(today+'T00:00:00').getDate()+7)))
  let n=0
  for(const m of state.members)for(const b of m.brands)for(const p of b.projects){
    if(p.status==='archived')continue
    for(const t of p.tasks){
      const prog=t.progress||'not-started'
      if(prog==='completed')continue
      if(type==='all'){n++;continue}
      if(type==='today' && t.dueDate===today)n++
      else if(type==='overdue' && t.dueDate && t.dueDate<today)n++
      else if(type==='thisweek' && t.dueDate && t.dueDate>=today && t.dueDate<=eow)n++
      else if(type==='nodate' && !t.dueDate)n++
    }
  }
  return n
}

function setScope(type,id){
  viewScope={type,id}
  selectedTaskIds.clear()
  viewMode='worklist'
  render()
}
function setWlFilter(v){wlFilter=v;renderMain();const inp=document.querySelector('.wl-filter');if(inp){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length)}}
function setWlGroup(v){wlGroupBy=v;renderMain()}
function setWlSort(v){wlSortBy=v;renderMain()}
function setWlShowDone(v){wlShowDone=v;renderMain()}

// ── MULTI-SELECT / BULK ACTIONS ──────────────────────────
function toggleTaskSelect(pid,tid){
  const key=pid+'::'+tid
  if(selectedTaskIds.has(key))selectedTaskIds.delete(key)
  else selectedTaskIds.add(key)
  updateBulkBar()
  // Update just that row's class without full re-render
  const row=document.querySelector(`.wl-row[data-key="${CSS.escape(key)}"]`)
  if(row){row.classList.toggle('selected',selectedTaskIds.has(key));const chk=row.querySelector('.wl-sel-chk');if(chk)chk.checked=selectedTaskIds.has(key)}
}
function clearSelection(){selectedTaskIds.clear();updateBulkBar();renderMain()}
function updateBulkBar(){
  const bar=document.getElementById('bulkBar')
  if(!bar)return
  const n=selectedTaskIds.size
  if(n===0){bar.classList.remove('visible');return}
  bar.classList.add('visible')
  const lbl=document.getElementById('bulkCount')
  if(lbl)lbl.textContent=`${n} selected`
  const sel=document.getElementById('bulkAssignSel')
  if(sel && sel.options.length<=1){
    sel.innerHTML='<option value="__">Assign…</option>'+state.members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')+'<option value="_none">Unassign</option>'
  }
}
function forSelectedTasks(fn){
  for(const key of selectedTaskIds){
    const [pid,tid]=key.split('::')
    const f=findProject(pid);if(!f)continue
    const t=f.p.tasks.find(x=>x.id===tid);if(!t)continue
    fn(t,f.p,f.b,f.m)
  }
}
function bulkSetPriority(v){forSelectedTasks(t=>{t.priority=v});save();renderMain();showNotice(`Set priority on ${selectedTaskIds.size} task${selectedTaskIds.size===1?'':'s'}`)}
function bulkSetProgress(v){forSelectedTasks(t=>{t.progress=v;t.done=(v==='completed')});save();renderMain();showNotice(`Updated ${selectedTaskIds.size} task${selectedTaskIds.size===1?'':'s'}`)}
function bulkSetAssignee(v){forSelectedTasks(t=>{t.assignee=v});save();renderMain();showNotice(`Assigned ${selectedTaskIds.size} task${selectedTaskIds.size===1?'':'s'}`)}
function bulkSetDue(v){forSelectedTasks(t=>{t.dueDate=v});save();renderMain();showNotice(`Set due date on ${selectedTaskIds.size} task${selectedTaskIds.size===1?'':'s'}`)}
function bulkDelete(){
  const n=selectedTaskIds.size
  if(!n)return
  showConfirm(`Delete ${n} selected task${n===1?'':'s'}?\nThis cannot be undone easily.`,()=>{
    forSelectedTasks((t,p)=>{p.tasks=p.tasks.filter(x=>x.id!==t.id)})
    selectedTaskIds.clear();save();renderMain();showNotice(`Deleted ${n} task${n===1?'':'s'}`)
  },'Delete')
}

// ── COMMAND BAR (Cmd+K) ──────────────────────────────────
function openCmdBar(){
  cmdBarOpen=true
  const ov=document.getElementById('cmdbarOv')
  if(!ov)return
  ov.style.display='flex'
  const inp=document.getElementById('cmdbarInp')
  if(inp){inp.value='';inp.focus()}
  updateCmdHint('')
}
function closeCmdBar(){
  cmdBarOpen=false
  const ov=document.getElementById('cmdbarOv')
  if(ov)ov.style.display='none'
}
function onCmdBarKey(e){
  if(e.key==='Escape'){e.preventDefault();closeCmdBar();return}
  if(e.key==='Enter'){e.preventDefault();cmdBarExec(e.target.value);return}
}
function onCmdBarInput(e){updateCmdHint(e.target.value)}
function updateCmdHint(v){
  const hint=document.getElementById('cmdbarHint')
  if(!hint)return
  const parsed=parseCmdInput(v)
  if(!v.trim()){hint.innerHTML='<span class="cmdhint-dim">Try: <em>tomorrow urgent review sketches for dockers</em></span>';return}
  if(parsed.type==='filter'){hint.textContent=`Filter: "${parsed.q}" — press Enter to apply`;return}
  if(parsed.type==='task'){
    const proj=parsed.project||'— pick project —'
    const due=parsed.due?friendly(parsed.due):'no due'
    const prio=parsed.priority||'no priority'
    hint.innerHTML=`<span class="cmdhint-tag">📋 ${esc(proj)}</span> <span class="cmdhint-tag">📅 ${esc(due)}</span> ${parsed.priority?`<span class="cmdhint-tag prio-${parsed.priority}">${prio}</span>`:''} ${parsed.assignee?`<span class="cmdhint-tag">👤 ${esc(parsed.assignee)}</span>`:''}`
    return
  }
  hint.textContent='Press Enter'
}
function parseCmdInput(raw){
  const v=(raw||'').trim()
  if(!v)return {type:'empty'}
  if(v.startsWith('/')){
    // slash commands
    return {type:'command',cmd:v.slice(1)}
  }
  if(v.startsWith('@')){
    return {type:'filter',q:v}
  }
  // Task creation grammar: keywords extract priority/due/assignee, project inferred from name/brand match
  const today=todayIso()
  function addDays(n){
    const d=new Date(today+'T00:00:00');d.setDate(d.getDate()+n);return isoDate(d)
  }
  let due=''
  let priority=''
  let assigneeName=''
  let assigneeId=''
  let projectName=''
  let projectId=''

  // remove tokens as we find them
  let txt=' '+v+' '
  // due tokens
  const dueMap={today:0,tomorrow:1,tmrw:1,'next-week':7,'nextweek':7,'this-week':3}
  for(const k of Object.keys(dueMap)){
    const rx=new RegExp('\\b'+k.replace('-','\\W?')+'\\b','i')
    if(rx.test(txt)){due=addDays(dueMap[k]);txt=txt.replace(rx,' ');break}
  }
  // monday..sunday
  if(!due){
    const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    for(let i=0;i<7;i++){
      const rx=new RegExp('\\b'+days[i]+'\\b','i')
      if(rx.test(txt)){
        const td=new Date(today+'T00:00:00');const cur=td.getDay()
        let diff=i-cur;if(diff<=0)diff+=7
        due=addDays(diff);txt=txt.replace(rx,' ');break
      }
    }
  }
  // priority tokens
  const prios=['urgent','high','medium','low']
  for(const pr of prios){
    const rx=new RegExp('\\b'+pr+'\\b','i')
    if(rx.test(txt)){priority=pr;txt=txt.replace(rx,' ');break}
  }
  // assignee: @name
  const atMatch=txt.match(/@(\w+)/)
  if(atMatch){
    const qn=atMatch[1].toLowerCase()
    const m=state.members.find(mx=>mx.name.toLowerCase().startsWith(qn))
    if(m){assigneeName=m.name;assigneeId=m.id}
    txt=txt.replace(atMatch[0],' ')
  }
  // project: match by project name token (longest match wins)
  const projs=allActiveProjects()
  let bestProj=null,bestLen=0
  for(const {p,b,m} of projs){
    const tokens=[p.name,b.name]
    for(const tok of tokens){
      if(!tok)continue
      const low=tok.toLowerCase()
      const rx=new RegExp('\\b'+low.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i')
      if(rx.test(txt) && tok.length>bestLen){bestProj={p,b,m,match:tok};bestLen=tok.length}
    }
  }
  if(bestProj){
    projectName=bestProj.p.name;projectId=bestProj.p.id
    const rx=new RegExp('\\b'+bestProj.match.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i')
    txt=txt.replace(rx,' ')
  } else if(selId){
    const f=findProject(selId);if(f){projectName=f.p.name;projectId=f.p.id}
  } else if(viewScope.type==='project'){
    const f=findProject(viewScope.id);if(f){projectName=f.p.name;projectId=f.p.id}
  }
  const taskText=txt.replace(/\s+/g,' ').trim()
  return {type:'task',text:taskText,due,priority,project:projectName,projectId,assignee:assigneeName,assigneeId}
}
function cmdBarExec(raw){
  const parsed=parseCmdInput(raw)
  if(parsed.type==='empty'){closeCmdBar();return}
  if(parsed.type==='filter'){
    wlFilter=parsed.q;viewMode='worklist';closeCmdBar();render()
    return
  }
  if(parsed.type==='command'){
    const c=parsed.cmd.toLowerCase()
    if(c==='today'){setScope('today');closeCmdBar();return}
    if(c==='overdue'){setScope('overdue');closeCmdBar();return}
    if(c==='week'||c==='thisweek'){setScope('thisweek');closeCmdBar();return}
    if(c==='all'){setScope('all');closeCmdBar();return}
    if(c==='cal'||c==='calendar'){showView('allcal');closeCmdBar();return}
    if(c==='home'||c==='dashboard'){showView('home');closeCmdBar();return}
    showNotice('Unknown command: /'+parsed.cmd)
    return
  }
  if(parsed.type==='task'){
    if(!parsed.text){showNotice('Enter a task description');return}
    if(!parsed.projectId){showNotice('Could not determine project — include project/brand name in your text');return}
    const f=findProject(parsed.projectId);if(!f){closeCmdBar();return}
    f.p.tasks.push({id:uid(),text:parsed.text,startDate:'',dueDate:parsed.due||'',done:false,progress:'not-started',priority:parsed.priority||'',assignee:parsed.assigneeId||'',note:''})
    save();closeCmdBar();render()
    showNotice(`Added to ${f.p.name}`)
    return
  }
  closeCmdBar()
}

// ── GLOBAL KEYBOARD SHORTCUTS ────────────────────────────
function isEditableTarget(el){
  if(!el)return false
  const tag=el.tagName
  return tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||el.isContentEditable
}
function onGlobalKeydown(e){
  // Cmd+K / Ctrl+K — cmd bar (works anywhere)
  if((e.metaKey||e.ctrlKey) && (e.key==='k'||e.key==='K')){
    e.preventDefault();if(cmdBarOpen)closeCmdBar();else openCmdBar();return
  }
  if(cmdBarOpen)return
  if(isEditableTarget(e.target))return
  // Esc — clear selection / close modals
  if(e.key==='Escape'){
    if(selectedTaskIds.size){clearSelection();e.preventDefault();return}
  }
  // / — focus filter in worklist
  if(e.key==='/' && viewMode==='worklist'){
    const inp=document.querySelector('.wl-filter')
    if(inp){e.preventDefault();inp.focus();inp.select()}
    return
  }
  // 1..5 — scope jump
  if(viewMode==='worklist' && !e.metaKey && !e.ctrlKey && !e.altKey){
    const scopeMap={'1':'today','2':'overdue','3':'thisweek','4':'all','5':'nodate'}
    if(scopeMap[e.key]){e.preventDefault();setScope(scopeMap[e.key]);return}
  }
  // g then w — go worklist; g then h — go home
  if(e.key==='w' && !e.metaKey && !e.ctrlKey){
    if(_lastKey==='g'){e.preventDefault();showView('worklist');_lastKey=null;return}
  }
  if(e.key==='h' && !e.metaKey && !e.ctrlKey){
    if(_lastKey==='g'){e.preventDefault();showView('home');_lastKey=null;return}
  }
  _lastKey=e.key
  setTimeout(()=>{if(_lastKey===e.key)_lastKey=null},900)
}
let _lastKey=null
let _globalKeyBound=false


function renderDashboard(){
  const projects=allActiveProjects().map(entry=>({...entry,health:projectHealth(entry)}))
  const meId=state.members.find(m=>m.isMe)?.id||''
  const brands=['all',...[...new Set(projects.map(({b})=>b.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b))]
  const activeCount=projects.length
  const critical=projects.filter(x=>x.health.status==='critical')
  const atRisk=projects.filter(x=>x.health.status==='atrisk')
  const completedTasks=allTasks().filter(({t,p})=>p.status!=='archived'&&(t.progress||'not-started')==='completed').length
  const openTasks=allTasks().filter(({t,p})=>p.status!=='archived'&&(t.progress||'not-started')!=='completed').length
  const totalMeetings=projects.reduce((n,{p})=>n+(p.meetings||[]).filter(mt=>mt.date&&mt.date>=todayIso()).length,0)
  const spotlight=[...projects].sort((a,b)=>{
    const score=x=>x.health.status==='critical'?3:x.health.status==='atrisk'?2:1
    const da=a.health.upcoming?.dueDate||'9999-99-99'
    const db=b.health.upcoming?.dueDate||'9999-99-99'
    return score(b)-score(a) || da.localeCompare(db)
  }).filter(item=>{
    if(dashFilter==='mine'&&item.m.id!==meId)return false
    if(dashFilter==='critical'&&item.health.status!=='critical')return false
    if(dashBrandFilter!=='all'&&item.b.name!==dashBrandFilter)return false
    return true
  }).slice(0,12)
  const alerts=computeAlerts()

  // ── Scratchpad HTML ────────────────────────────────────
  const defaultPersonId = state.members.find(m=>m.isMe)?.id || state.members[0]?.id || ''
  const defaultProjs = defaultPersonId
    ? (state.members.find(m=>m.id===defaultPersonId)?.brands.flatMap(b=>b.projects.filter(p=>p.status!=='archived'))||[])
    : []
  const hasScratch = !!(state.scratchpad||'').trim()
  const scratchHtml = `<div class="scratchpad-wrap">
    <div class="scratchpad-label">✏️ Quick Capture</div>
    <textarea class="scratchpad-ta" id="scratchpadTa"
      placeholder="Quick note / Capture idea…"
      oninput="onScratchInput(this)"
      rows="2">${esc(state.scratchpad||'')}</textarea>
    <div class="scratchpad-actions${hasScratch?' visible':''}" id="scratchpadActions">
      <span class="scratch-lbl">File to:</span>
      <select class="scratch-sel" id="scratchPersonSel" onchange="onScratchPersonChange(this.value)">
        ${state.members.map(m=>`<option value="${esc(m.id)}"${m.id===defaultPersonId?' selected':''}>${esc(m.name)}</option>`).join('')}
      </select>
      <select class="scratch-sel" id="scratchProjSel">
        ${defaultProjs.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')||'<option value="">— no projects —</option>'}
      </select>
      <button class="scratch-plus" onclick="addScratchProject()" title="Create new project">＋</button>
      <button class="btn btn-primary btn-xs" onclick="fileNote()">File Note →</button>
      <span class="scratch-msg" id="scratchMsg"></span>
    </div>
  </div>`

  // ── Travel section ─────────────────────────────────────
  const travelItems = allTravelItems().slice(0,8)
  const travelHtml = travelItems.length ? `<div class="dash-travel-section">
    <div class="dash-travel-header">
      <div>
        <div class="dash-travel-title">✈️ Travel &amp; Logistics</div>
        <div class="dash-travel-sub">Upcoming travel, flights, and logistics across all active projects</div>
      </div>
    </div>
    <div class="dash-travel-list">
      ${travelItems.map(({tr,p,m})=>{
        const ico=tr.type==='Flight'?'✈️':tr.type==='Hotel'?'🏨':'🏭'
        const dateStr=tr.startDate&&tr.endDate&&tr.startDate!==tr.endDate
          ?`${friendly(tr.startDate)} – ${friendly(tr.endDate)}`
          :friendly(tr.startDate||tr.endDate||'')
        return `<div class="dash-travel-item" onclick="goProject('${p.id}')">
          <div class="dash-travel-icon">${ico}</div>
          <div class="dash-travel-content">
            <div class="dash-travel-name">${esc(tr.title)}</div>
            <div class="dash-travel-meta">${esc(p.name)} · ${esc(m.name)}${dateStr?' · '+esc(dateStr):''}</div>
          </div>
          <div class="dash-travel-badge">${esc(tr.type)}</div>
        </div>`
      }).join('')}
    </div>
  </div>` : ''

  return `<div class="dash">
    <div class="dash-hero">
      <div class="dash-panel dash-hero-main">
        <div class="dash-kicker">Studio Snapshot</div>
        <div class="dash-title">Your product development dashboard</div>
        <div class="dash-sub">Use this as your home base for the work in motion right now: active projects, overdue tasks, critical timelines, and the next reviews or sample milestones that need attention.</div>
        <div class="dash-actions">
          <button class="btn btn-primary" onclick="showView('allcal')">Open All Teams Calendar</button>
          <button class="btn btn-ghost" onclick="showSyncFromHome()">Cloud Sync & Backup</button>
        </div>
      </div>
      <div class="dash-panel dash-hero-side">
        <div class="dash-side-title">Needs Attention</div>
        <div class="dash-alert-list">
          ${alerts.overdue.slice(0,4).map(({t,p,m})=>`<div class="dash-alert critical" onclick="goProject('${p.id}')" style="cursor:pointer">
            <div class="dash-alert-dot" style="background:var(--red)"></div>
            <div class="dash-alert-copy"><strong>${esc(p.name)}</strong>${esc(m.name)} · overdue on ${esc(t.text)}</div>
          </div>`).join('') || ''}
          ${alerts.upcoming.slice(0,3).map(({t,p,m})=>`<div class="dash-alert upcoming" onclick="goProject('${p.id}')" style="cursor:pointer">
            <div class="dash-alert-dot" style="background:var(--warn)"></div>
            <div class="dash-alert-copy"><strong>${esc(p.name)}</strong>${esc(m.name)} · ${esc(t.text)} due ${friendly(t.dueDate)}</div>
          </div>`).join('') || ''}
          ${(!alerts.overdue.length&&!alerts.upcoming.length)?`<div class="dash-alert">
            <div class="dash-alert-dot" style="background:var(--ok)"></div>
            <div class="dash-alert-copy"><strong>Nothing critical right now</strong>Your active project timelines are clear for the moment.</div>
          </div>`:''}
        </div>
      </div>
    </div>
    ${scratchHtml}
    <div class="dash-stats">
      <div class="stat-card"><div class="stat-label">Active Projects</div><div class="stat-value">${activeCount}</div><div class="stat-sub">${critical.length} critical and ${atRisk.length} at-risk timelines</div></div>
      <div class="stat-card"><div class="stat-label">Open Tasks</div><div class="stat-value">${openTasks}</div><div class="stat-sub">${completedTasks} completed across active projects</div></div>
      <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-value">${alerts.overdue.length}</div><div class="stat-sub">Tasks that already missed their due date</div></div>
      <div class="stat-card"><div class="stat-label">Upcoming Meetings</div><div class="stat-value">${totalMeetings}</div><div class="stat-sub">Scheduled ahead across active projects</div></div>
    </div>
    <div class="dash-grid">
      <div class="dash-panel dash-section">
        <div class="dash-section-title">Current Projects</div>
        <div class="dash-filter-row">
          <div class="dash-filter-chips">
            <button class="dash-filter-btn ${dashFilter==='all'?'on':''}" onclick="setDashFilter('all')">All</button>
            <button class="dash-filter-btn ${dashFilter==='mine'?'on':''}" onclick="setDashFilter('mine')">Only My Projects</button>
            <button class="dash-filter-btn ${dashFilter==='critical'?'on':''}" onclick="setDashFilter('critical')">Critical</button>
          </div>
          <select class="dash-brand-select" onchange="setDashBrandFilter(this.value)">
            ${brands.map(name=>`<option value="${esc(name)}" ${(name===dashBrandFilter)?'selected':''}>${name==='all'?'All Brands':esc(name)}</option>`).join('')}
          </select>
        </div>
        <div class="dash-project-list">
          ${spotlight.map(({p,b,m,health})=>{
            const pct=Math.round((health.done/health.total)*100)
            const badgeClass=health.status==='critical'?'critical':health.status==='atrisk'?'atrisk':'ontrack'
            const badgeLabel=health.status==='critical'?'Critical':health.status==='atrisk'?'At Risk':'On Track'
            const subtitle=health.overdue
              ? `${health.overdue} overdue task${health.overdue===1?'':'s'}`
              : health.upcoming?.dueDate
                ? `Next due ${friendly(health.upcoming.dueDate)}`
                : `No dated tasks yet`
            return `<div class="dash-project" onclick="goProject('${p.id}')">
              <div class="dash-project-main">
                <div class="dash-project-top">
                  <div class="dash-project-name">${esc(p.name)}</div>
                  <div class="dash-owner"><span class="dash-owner-dot" style="background:${m.color}"></span>${esc(m.name)} · ${esc(b.name)}</div>
                </div>
                <div class="dash-project-meta">${subtitle}</div>
              </div>
              <div class="dash-project-side">
                <div class="dash-badge ${badgeClass}">${badgeLabel}</div>
                <div class="dash-project-track"><div class="dash-project-fill ${badgeClass}" style="width:${pct}%"></div></div>
                <div class="dash-project-meta">${health.done}/${health.total} tasks complete</div>
              </div>
            </div>`
          }).join('') || `<div class="empty"><div class="empty-ico">📁</div><div class="empty-ttl">No active projects yet</div><div class="empty-sub">Create a project from the sidebar to start building your dashboard.</div></div>`}
        </div>
      </div>
      <div class="dash-panel dash-section">
        <div class="dash-section-title">Quick Snapshot</div>
        <div class="dash-mini-list">
          <div class="dash-mini-item"><strong>Critical timelines</strong><span>${critical.length?`${critical.length} project${critical.length===1?' is':'s are'} currently blocked by overdue tasks.`:'No projects are currently flagged as critical.'}</span></div>
          <div class="dash-mini-item"><strong>Upcoming reviews</strong><span>${alerts.upcoming.slice(0,3).map(({t,p})=>`${p.name}: ${t.text}`).join(' · ') || 'No urgent review deadlines in the next week.'}</span></div>
          <div class="dash-mini-item"><strong>Calendar overview</strong><span>Use the All Teams Calendar for a cross-team timeline, then filter by owner when you want to isolate one person’s workload.</span></div>
        </div>
      </div>
    </div>
    ${travelHtml}
  </div>`
}

function setDashFilter(v){dashFilter=v;renderMain()}
function setDashBrandFilter(v){dashBrandFilter=v;renderMain()}

function renderGlobalTasks(){
  const me=state.members.find(m=>m.isMe)
  if(!me)return `<div class="empty"><div class="empty-ico">☑️</div><div class="empty-ttl">No personal workspace found</div></div>`
  const tasks=[]
  for(const b of me.brands){
    for(const p of b.projects){
      if(p.status==='archived')continue
      for(const t of p.tasks){
        const prog=t.progress||'not-started'
        if(prog==='completed')continue
        tasks.push({t,p,b,m:me})
      }
    }
  }
  tasks.sort((a,b)=>{
    const ad=a.t.dueDate||'9999-99-99'
    const bd=b.t.dueDate||'9999-99-99'
    const ao=a.t.dueDate&&a.t.dueDate<todayIso()?0:1
    const bo=b.t.dueDate&&b.t.dueDate<todayIso()?0:1
    return ao-bo || ad.localeCompare(bd) || a.p.name.localeCompare(b.p.name)
  })
  if(!tasks.length){
    return `<div class="empty"><div class="empty-ico">☑️</div><div class="empty-ttl">No open global tasks</div><div class="empty-sub">You’re clear across all of your active projects.</div></div>`
  }
  return `<div class="gtasks">${tasks.map(({t,p,b})=>{
    const cls=!t.dueDate?'nodate':t.dueDate<todayIso()?'overdue':'upcoming'
    const lbl=!t.dueDate?'No date':t.dueDate<todayIso()?`Overdue · ${friendly(t.dueDate)}`:`Due ${friendly(t.dueDate)}`
    return `<div class="gtask-card" onclick="goProject('${p.id}')">
      <div class="gtask-top">
        <div class="gtask-title">${esc(t.text)}</div>
        <div class="gtask-due ${cls}">${esc(lbl)}</div>
      </div>
      <div class="gtask-meta">${esc(b.name)} · ${esc(p.name)}${t.startDate?` · Starts ${friendly(t.startDate)}`:''}</div>
    </div>`
  }).join('')}</div>`
}

// ══════════════════════════════════════════════════════
//  TODAY / UPCOMING VIEW
// ══════════════════════════════════════════════════════
function renderTodayView(){
  const today=todayIso()
  const todayDate=new Date(today+'T00:00:00')
  const endOfWeek=new Date(todayDate);endOfWeek.setDate(endOfWeek.getDate()+7)
  const endOfNext=new Date(todayDate);endOfNext.setDate(endOfNext.getDate()+14)
  const eow=isoDate(endOfWeek),eon=isoDate(endOfNext)
  const priorityOrder={urgent:0,high:1,medium:2,low:3,'':4}
  const sortTasks=arr=>[...arr].sort((a,b)=>{
    const pa=priorityOrder[a.t.priority||'']??4
    const pb=priorityOrder[b.t.priority||'']??4
    if(pa!==pb)return pa-pb
    return(a.t.dueDate||'9999').localeCompare(b.t.dueDate||'9999')
  })

  const tasks=[]
  for(const m of state.members)for(const b of m.brands)for(const p of b.projects){
    if(p.status==='archived')continue
    for(const t of p.tasks){
      if((t.progress||'not-started')==='completed')continue
      tasks.push({t,p,b,m})
    }
  }

  const overdue=tasks.filter(x=>x.t.dueDate&&x.t.dueDate<today)
  const dueToday=tasks.filter(x=>x.t.dueDate===today)
  const thisWeek=tasks.filter(x=>x.t.dueDate>today&&x.t.dueDate<=eow)
  const nextWeek=tasks.filter(x=>x.t.dueDate>eow&&x.t.dueDate<=eon)
  const noDue=tasks.filter(x=>!x.t.dueDate)
  const totalOpen=overdue.length+dueToday.length+thisWeek.length+nextWeek.length+noDue.length

  function taskRow({t,p,m}){
    const prio=t.priority||''
    const prioHtml=prio?`<span class="prio-badge prio-${prio}">${prio.charAt(0).toUpperCase()+prio.slice(1)}</span>`:''
    const prog=t.progress||'not-started'
    const isOverdue=t.dueDate&&t.dueDate<today
    return `<div class="today-task-row">
      <input type="checkbox" class="task-chk" ${prog==='completed'?'checked':''} onchange="toggleTaskGlobal('${esc(t.id)}','${esc(p.id)}',this.checked)">
      <div class="today-task-body">
        <div class="today-task-text ${prog==='completed'?'done':''}">${esc(t.text)}</div>
        <div class="today-task-meta">
          <span class="today-task-proj" onclick="goProject('${esc(p.id)}')" style="color:${m.color}">${esc(p.name)}</span>
          ${t.dueDate?`<span class="today-task-due" style="${isOverdue?'color:var(--red)':''}">${isOverdue?'Overdue · ':''}${esc(friendly(t.dueDate))}</span>`:''}
          ${prioHtml}
          ${t.assignee?`<span class="today-task-assignee">${esc(state.members.find(mx=>mx.id===t.assignee)?.name||'')}</span>`:''}
        </div>
      </div>
      <select class="prog-sel prog-${prog}" onchange="toggleTaskProgressGlobal('${esc(t.id)}','${esc(p.id)}',this.value)">
        <option value="not-started" ${prog==='not-started'?'selected':''}>Not Started</option>
        <option value="in-progress" ${prog==='in-progress'?'selected':''}>In Progress</option>
        <option value="completed" ${prog==='completed'?'selected':''}>Completed</option>
      </select>
    </div>`
  }

  function section(label,items,cls=''){
    if(!items.length)return ''
    return `<div class="today-section">
      <div class="today-section-hdr ${cls}">
        <span class="today-section-title">${label}</span>
        <span class="today-section-count">${items.length}</span>
      </div>
      <div class="today-task-list">${sortTasks(items).map(taskRow).join('')}</div>
    </div>`
  }

  // Build project options for quick-add
  const allActiveProjs=allActiveProjects()
  const projOptions=allActiveProjs.map(({p,b,m})=>
    `<option value="${esc(p.id)}">[${esc(m.name)}] ${esc(p.name)}</option>`
  ).join('')

  return `<div class="today-view">
    <div class="today-hero">
      <div class="today-date-label">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
      <div class="today-headline">Today's Focus</div>
      <div class="today-sub">${totalOpen} open task${totalOpen!==1?'s':''} across all active projects${overdue.length?` &nbsp;·&nbsp; <strong style="color:var(--red)">${overdue.length} overdue</strong>`:''}</div>
    </div>
    <div class="today-quick-add">
      <input class="today-qa-inp" id="todayQAText" placeholder="Add a task…" onkeydown="if(event.key==='Enter')addTaskFromToday()">
      <select class="today-qa-proj" id="todayQAProj">
        ${projOptions||'<option value="">— no active projects —</option>'}
      </select>
      <input type="date" class="add-date-inp" id="todayQADue" title="Due date">
      <button class="btn btn-primary btn-sm" onclick="addTaskFromToday()">Add</button>
    </div>
    ${section('Overdue',overdue,'overdue-hdr')}
    ${section('Due Today',dueToday,'today-hdr')}
    ${section('This Week',thisWeek,'week-hdr')}
    ${section('Next Week',nextWeek)}
    ${section('No Due Date',noDue,'nodate-hdr')}
    ${totalOpen===0?`<div class="empty" style="margin-top:24px"><div class="empty-ico">🎉</div><div class="empty-ttl">All clear!</div><div class="empty-sub">No open tasks right now. Add one above or navigate into a project.</div></div>`:''}
  </div>`
}

function toggleTaskGlobal(tid,pid,checked){
  const found=findProject(pid)
  if(!found)return
  const t=found.p.tasks.find(t=>t.id===tid)
  if(t){t.done=checked;t.progress=checked?'completed':'not-started';save();renderMain()}
}

function toggleTaskProgressGlobal(tid,pid,v){
  const found=findProject(pid)
  if(!found)return
  const t=found.p.tasks.find(t=>t.id===tid)
  if(t){t.progress=v;t.done=(v==='completed');save();renderMain()}
}

function addTaskFromToday(){
  const txt=(document.getElementById('todayQAText')?.value||'').trim()
  const projId=document.getElementById('todayQAProj')?.value
  const due=document.getElementById('todayQADue')?.value||''
  if(!txt||!projId){
    const inp=document.getElementById('todayQAText')
    if(inp){inp.focus();inp.style.borderColor='var(--red)';setTimeout(()=>inp.style.borderColor='',1200)}
    return
  }
  const found=findProject(projId)
  if(!found)return
  found.p.tasks.push({id:uid(),text:txt,startDate:'',dueDate:due,done:false,progress:'not-started',priority:''})
  save()
  // Clear inputs and re-render
  const inp=document.getElementById('todayQAText')
  const dateInp=document.getElementById('todayQADue')
  if(inp){inp.value='';inp.focus()}
  if(dateInp)dateInp.value=''
  renderMain()
}

// ══════════════════════════════════════════════════════
//  DETAIL VIEW
// ══════════════════════════════════════════════════════
function renderDetail(p,m,b){
  const isArch=p.status==='archived'
  const completed=p.tasks.filter(t=>t.progress==='completed')
  const inProg=p.tasks.filter(t=>t.progress==='in-progress')
  const notStarted=p.tasks.filter(t=>t.progress==='not-started')
  const shown=showDone?p.tasks:p.tasks.filter(t=>t.progress!=='completed')
  const meetings=[...(p.meetings||[])].sort((a,b)=>a.date.localeCompare(b.date))
  const travel=[...(p.travel||[])].sort((a,b)=>(a.startDate||a.endDate||'').localeCompare(b.startDate||b.endDate||''))

  return `
    ${isArch?`<div class="arch-banner">📦 Archived — unarchive to edit</div>`:''}
    <input class="proj-title-input" value="${esc(p.name)}" ${isArch?'disabled':''}
      onblur="updateProjName(this.value)" onkeydown="if(event.key==='Enter')this.blur()">
    <div class="proj-meta">
      <span class="badge badge-${p.status}">${p.status}</span>
      <span class="mtag"><span class="mtag-dot" style="background:${m.color}"></span>${esc(m.name)} · ${esc(b.name)}</span>
      ${!isArch?`<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="duplicateProject('${p.id}')" title="Duplicate this project as a template">⧉ Duplicate</button>`:''}
    </div>

    <!-- SUMMARY -->
    <div class="card">
      <div class="card-head open" onclick="toggleCard(this)">
        <div class="card-ttl">📋 Project Summary</div>
        <span class="card-chev open">▶</span>
      </div>
      <div class="card-body open">
        <textarea class="summary-ta" placeholder="Project overview, goals, key contacts, context…"
          ${isArch?'disabled':''}
          onblur="updateSummary(this.value)">${esc(p.summary||'')}</textarea>
        <div class="proj-dates-row">
          <div class="proj-date-field">
            <strong>Project Start</strong>
            <input type="date" class="proj-date-inp" value="${p.startDate||''}" ${isArch?'disabled':''}
              onchange="updateProjStart(this.value)" title="Overall project start date">
          </div>
          <div class="proj-date-field">
            <strong>Project End</strong>
            <input type="date" class="proj-date-inp" value="${p.endDate||''}" ${isArch?'disabled':''}
              onchange="updateProjEnd(this.value)" title="Overall project end date">
          </div>
        </div>
      </div>
    </div>

    <!-- TASKS -->
    <div class="card">
      <div class="card-head open" onclick="toggleCard(this)">
        <div class="card-ttl">✅ Tasks
          <span class="card-cnt">${notStarted.length} not started · ${inProg.length} in progress${completed.length?` · ${completed.length} done`:''}</span>
        </div>
        <button class="sort-toggle-btn${sortByDue?' on':''}" onclick="event.stopPropagation();toggleSortByDue()" title="Sort tasks by due date">📅 ${sortByDue?'Date ↑':'Sort by date'}</button>
        <span class="card-chev open">▶</span>
      </div>
      <div class="card-body open">
        ${!isArch?`<div class="task-template-row">
          <div class="task-template-copy">Use your standard product development workflow as a starting point, then plug in project-specific dates after the tasks are created.</div>
          <button class="btn btn-ghost btn-sm" onclick="generateProductDevelopmentTasks()">Generate Product Development Tasks</button>
        </div>`:''}
        <div id="taskList">${sortedTaskList(shown).map(t=>taskHTML(t)).join('')}</div>
        ${completed.length?`<button class="done-toggle" onclick="toggleDone()">${showDone?'▾ Hide completed':`▸ Show ${completed.length} completed`}</button>`:''}
        ${!isArch?`<div class="add-task-row">
          <input class="add-task-inp" id="newTText" placeholder="Add a task…" onkeydown="if(event.key==='Enter')doAddTask()">
          <select class="prio-sel" id="newTPrio" title="Priority">
            <option value="">– Priority</option>
            <option value="urgent">🔴 Urgent</option>
            <option value="high">🟠 High</option>
            <option value="medium">🔵 Medium</option>
            <option value="low">⚪ Low</option>
          </select>
          <input type="date" class="add-date-inp" id="newTStart" title="Start date (optional)">
          <span style="font-size:11px;color:var(--tm);opacity:.5">→</span>
          <input type="date" class="add-date-inp" id="newTDue" title="Due date">
          <button class="btn btn-primary btn-sm" onclick="doAddTask()">Add</button>
        </div>`:''}
      </div>
    </div>

    <!-- NOTES -->
    <div class="card">
      <div class="card-head open" onclick="toggleCard(this)">
        <div class="card-ttl">📝 Notes<span class="card-cnt">${p.notes.length}</span></div>
        <span class="card-chev open">▶</span>
      </div>
      <div class="card-body open">
        <div id="noteList">${p.notes.map(n=>noteHTML(n)).join('')}</div>
        ${!isArch?`<button class="add-note-btn" onclick="doAddNote()">＋ Add note</button>`:''}
      </div>
    </div>

    <!-- MEETINGS -->
    <div class="card">
      <div class="card-head open" onclick="toggleCard(this)">
        <div class="card-ttl">🤝 Meetings<span class="card-cnt">${meetings.length}</span></div>
        <span class="card-chev open">▶</span>
      </div>
      <div class="card-body open">
        <div id="meetingList">
          ${meetings.map(mt=>meetingHTML(mt)).join('')}
        </div>
        ${!isArch?`<div class="add-meeting-row">
          <input class="add-meeting-inp" id="newMTitle" placeholder="Meeting title…" onkeydown="if(event.key==='Enter')doAddMeeting()">
          <input type="date" class="add-date-inp" id="newMDate" title="Meeting date">
          <button class="btn btn-primary btn-sm" onclick="doAddMeeting()">Add</button>
        </div>`:''}
      </div>
    </div>

    <!-- TRAVEL -->
    <div class="card">
      <div class="card-head open" onclick="toggleCard(this)">
        <div class="card-ttl">✈️ Travel &amp; Logistics<span class="card-cnt">${travel.length}</span></div>
        <span class="card-chev open">▶</span>
      </div>
      <div class="card-body open">
        <div id="travelList">${travel.map(tr=>travelHTML(tr)).join('')}</div>
        ${!isArch?`<div class="add-travel-row">
          <select class="travel-type-sel" id="newTravelType">
            <option>Flight</option>
            <option>Hotel</option>
            <option>Factory Contact</option>
          </select>
          <input class="travel-link-inp" id="newTravelTitle" placeholder="Details / title" style="flex:1;min-width:180px" onkeydown="if(event.key==='Enter')doAddTravel()">
          <input type="date" class="travel-link-inp" id="newTravelStart" style="width:145px">
          <input type="date" class="travel-link-inp" id="newTravelEnd" style="width:145px">
          <input class="travel-link-inp" id="newTravelLink" placeholder="https://…" style="flex:1;min-width:180px" onkeydown="if(event.key==='Enter')doAddTravel()">
          <button class="btn btn-primary btn-sm" onclick="doAddTravel()">Add</button>
        </div>`:''}
      </div>
    </div>

    <!-- LINKS -->
    <div class="card">
      <div class="card-head open" onclick="toggleCard(this)">
        <div class="card-ttl">🔗 Links<span class="card-cnt">${p.links.length}</span></div>
        <span class="card-chev open">▶</span>
      </div>
      <div class="card-body open">
        <div id="linkList">${p.links.map(l=>linkHTML(l)).join('')}</div>
        ${!isArch?`<div class="add-link-row">
          <input class="link-inp" id="newLLbl" placeholder="Label" style="width:130px">
          <input class="link-inp" id="newLUrl" placeholder="https://…" style="flex:1" onkeydown="if(event.key==='Enter')doAddLink()">
          <button class="btn btn-primary btn-sm" onclick="doAddLink()">Add</button>
        </div>`:''}
      </div>
    </div>
  `
}

// ── TASK HTML ─────────────────────────────────────────
function taskHTML(t){
  const td=todayIso()
  const prog=t.progress||'not-started'
  const prio=t.priority||''
  let dc=''
  if(t.dueDate&&prog!=='completed'){
    if(t.dueDate<td)dc='date-over'
    else{const diff=(new Date(t.dueDate)-new Date(td))/864e5;if(diff<=3)dc='date-soon'}
  }
  const txtClass=prog==='completed'?'done':''
  const hasNote=!!(t.note||'').trim()
  return `<div class="task-item" data-tid="${t.id}" draggable="true"
    ondragstart="projDragStart(event,'task','${t.id}')"
    ondragend="projDragEnd(event)"
    ondragover="projDragOver(event,'task')"
    ondrop="projDrop(event,'task','${t.id}')">
    <span class="drag-handle" title="Drag to reorder">⠿</span>
    <input type="checkbox" class="task-chk" ${prog==='completed'?'checked':''} onchange="toggleTask('${t.id}',this.checked)">
    <div class="task-body">
      <textarea class="task-txt ${txtClass}" rows="1"
        onblur="updateTaskTxt('${t.id}',this.value)" oninput="autoGrow(this)">${esc(t.text)}</textarea>
      <div class="task-meta-chips">
        ${t.dueDate?`<span class="tmeta-due${dc?' '+dc:''}">${esc(friendly(t.dueDate))}</span>`:''}
        ${prio?`<span class="tmeta-prio prio-${prio}">${prio.charAt(0).toUpperCase()+prio.slice(1)}</span>`:''}
        ${t.assignee?`<span class="tmeta-assignee">${esc(state.members.find(mx=>mx.id===t.assignee)?.name||'')}</span>`:''}
      </div>
      <div class="task-dates">
        <div class="task-date-field">
          <span class="date-lbl">Start</span>
          <input type="date" class="date-inp" value="${t.startDate||''}" title="Start date" onchange="updateTaskStart('${t.id}',this.value)">
        </div>
        <div class="task-date-field">
          <span class="date-lbl">Due</span>
          <input type="date" class="date-inp ${dc}" value="${t.dueDate||''}" title="Due date" onchange="updateTaskDue('${t.id}',this.value)">
        </div>
        <div class="prog-wrap">
          <select class="prog-sel prog-${prog}" onchange="updateTaskProgress('${t.id}',this.value)">
            <option value="not-started" ${prog==='not-started'?'selected':''}>Not Started</option>
            <option value="in-progress" ${prog==='in-progress'?'selected':''}>In Progress</option>
            <option value="completed" ${prog==='completed'?'selected':''}>Completed</option>
          </select>
          <select class="prio-sel ${prio?'prio-'+prio:''}" onchange="updateTaskPriority('${t.id}',this.value)" title="Priority">
            <option value="" ${!prio?'selected':''}>– Priority</option>
            <option value="urgent" ${prio==='urgent'?'selected':''}>🔴 Urgent</option>
            <option value="high" ${prio==='high'?'selected':''}>🟠 High</option>
            <option value="medium" ${prio==='medium'?'selected':''}>🔵 Medium</option>
            <option value="low" ${prio==='low'?'selected':''}>⚪ Low</option>
          </select>
          <select class="task-assignee-sel" onchange="updateTaskAssignee('${t.id}',this.value)" title="Assignee">
            <option value="" ${!t.assignee?'selected':''}>Assign…</option>
            ${state.members.filter(mx=>!mx.isMe).map(mx=>`<option value="${mx.id}" ${t.assignee===mx.id?'selected':''}>${esc(mx.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="task-micronote" id="tmn_${t.id}" style="display:${hasNote?'block':'none'}">
        <textarea class="task-micronote-ta" rows="1" placeholder="Task note…"
          oninput="autoGrow(this)"
          onblur="updateTaskNote('${t.id}',this.value)">${esc(t.note||'')}</textarea>
      </div>
    </div>
    <button class="task-note-btn${hasNote?' has-note':''}" onclick="toggleTaskNote('${t.id}')" title="${hasNote?'View/edit task note':'Add a note to this task'}">${hasNote?'📝 Note':'+ Note'}</button>
    <button class="task-del" onclick="removeTask('${t.id}')" title="Remove">×</button>
  </div>`
}

// ── MEETING HTML ───────────────────────────────────────
function meetingHTML(mt){
  return `<div class="meeting-item" data-mid="${mt.id}">
    <div class="meeting-ico">🤝</div>
    <div class="meeting-info">
      <input class="meeting-title-inp" value="${esc(mt.title)}" placeholder="Meeting title"
        onblur="updateMeetingTitle('${mt.id}',this.value)">
      <input type="date" class="meeting-date-inp" value="${mt.date||''}"
        onchange="updateMeetingDate('${mt.id}',this.value)" title="Meeting date">
    </div>
    <button class="meeting-del" onclick="removeMeeting('${mt.id}')" title="Remove">×</button>
  </div>`
}

function travelHTML(tr){
  const dateLbl=tr.startDate&&tr.endDate&&tr.startDate!==tr.endDate
    ? `${friendly(tr.startDate)} - ${friendly(tr.endDate)}`
    : friendly(tr.startDate||tr.endDate||'')
  return `<div class="travel-item" data-trid="${tr.id}">
    <div class="travel-type">${esc(tr.type)}</div>
    <div class="travel-main">
      <input class="travel-title" value="${esc(tr.title)}" placeholder="Details / title" onblur="updateTravelField('${tr.id}','title',this.value)">
      <div class="travel-row">
        <select class="travel-type-sel" onchange="updateTravelField('${tr.id}','type',this.value)">
          <option ${tr.type==='Flight'?'selected':''}>Flight</option>
          <option ${tr.type==='Hotel'?'selected':''}>Hotel</option>
          <option ${tr.type==='Factory Contact'?'selected':''}>Factory Contact</option>
        </select>
        <input type="date" class="travel-link-inp" style="width:140px" value="${tr.startDate||''}" onchange="updateTravelField('${tr.id}','startDate',this.value)">
        <input type="date" class="travel-link-inp" style="width:140px" value="${tr.endDate||''}" onchange="updateTravelField('${tr.id}','endDate',this.value)">
        <input class="travel-link-inp" style="flex:1;min-width:180px" value="${esc(tr.link||'')}" placeholder="https://…" onblur="updateTravelField('${tr.id}','link',this.value)">
        ${tr.link?`<a class="travel-link" href="${esc(tr.link)}" target="_blank" rel="noopener noreferrer">${esc(tr.link)}</a>`:''}
        ${dateLbl?`<span class="travel-date">${esc(dateLbl)}</span>`:''}
      </div>
    </div>
    <button class="travel-del" onclick="removeTravel('${tr.id}')" title="Remove">×</button>
  </div>`
}

// ── NOTE HTML ─────────────────────────────────────────
function noteHTML(n){
  return `<div class="note-card" data-nid="${n.id}" draggable="true"
    ondragstart="projDragStart(event,'note','${n.id}')"
    ondragend="projDragEnd(event)"
    ondragover="projDragOver(event,'note')"
    ondrop="projDrop(event,'note','${n.id}')">
    <div class="note-head" onclick="toggleNote('${n.id}',event)">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="note-chev ${n.open?'open':''}">▶</span>
      <input class="note-title-inp" value="${esc(n.title)}" placeholder="Note title"
        onclick="event.stopPropagation()" onblur="updateNoteTitle('${n.id}',this.value)">
      <span class="note-date-lbl">${n.date||''}</span>
      <button class="note-del" onclick="removeNote('${n.id}');event.stopPropagation()" title="Delete">×</button>
    </div>
    <div class="note-body-wrap ${n.open?'open':''}">
      <div class="rte-toolbar" data-nid="${n.id}">
        <button class="rte-btn" data-cmd="h2" title="Heading" onmousedown="rteCmd(event,'h2','${n.id}')">Hd</button>
        <button class="rte-btn" data-cmd="h3" title="Subheading" onmousedown="rteCmd(event,'h3','${n.id}')">Sub</button>
        <div class="rte-sep"></div>
        <button class="rte-btn" data-cmd="bold" title="Bold (Ctrl+B)" onmousedown="rteCmd(event,'bold','${n.id}')"><b>B</b></button>
        <button class="rte-btn" data-cmd="italic" title="Italic (Ctrl+I)" onmousedown="rteCmd(event,'italic','${n.id}')"><i>I</i></button>
        <button class="rte-btn" data-cmd="underline" title="Underline (Ctrl+U)" onmousedown="rteCmd(event,'underline','${n.id}')"><u>U</u></button>
        <div class="rte-sep"></div>
        <button class="rte-btn" data-cmd="highlight" title="Highlight" onmousedown="rteCmd(event,'highlight','${n.id}')" style="font-size:13px">▐</button>
        <div class="rte-sep"></div>
        <button class="rte-btn" data-cmd="bullets" title="Bullet list" onmousedown="rteCmd(event,'bullets','${n.id}')">• List</button>
        <button class="rte-btn" data-cmd="numbers" title="Numbered list" onmousedown="rteCmd(event,'numbers','${n.id}')">1.</button>
        <button class="rte-btn" data-cmd="quote" title="Quote block" onmousedown="rteCmd(event,'quote','${n.id}')">❝</button>
        <button class="rte-btn" data-cmd="link" title="Add link" onmousedown="rteCmd(event,'link','${n.id}')">🔗</button>
        <div class="rte-sep"></div>
        <button class="rte-btn" data-cmd="clear" title="Clear formatting" onmousedown="rteCmd(event,'clear','${n.id}')" style="font-size:11px">Tx</button>
      </div>
      <div class="rte-content" contenteditable="true" data-nid="${n.id}"
        data-placeholder="Write your notes here…"
        onblur="saveNoteBody('${n.id}',this)"
        onfocus="setActiveEditor('${n.id}')"
        onmouseup="rememberSelection('${n.id}');refreshToolbar('${n.id}')"
        onkeyup="rememberSelection('${n.id}');refreshToolbar('${n.id}')"
        oninput="rememberSelection('${n.id}');refreshToolbar('${n.id}')"
        onkeydown="rteKeydown(event,'${n.id}')"
        onpaste="handleNotePaste(event,'${n.id}')"></div>
    </div>
  </div>`
}

// Restore innerHTML of contenteditable elements (can't do via initial HTML due to XSS concerns)
function restoreEditors(p){
  p.notes.forEach(n=>{
    const el=document.querySelector(`.rte-content[data-nid="${n.id}"]`)
    if(el)el.innerHTML=sanitizeNoteHTML(n.body||'')
  })
}

// ── LINK HTML ─────────────────────────────────────────
function linkHTML(l){
  let ico='🔗'
  const u=(l.url||'').toLowerCase()
  if(u.includes('miro.com'))ico='🟡'
  else if(u.includes('figma.com'))ico='🎨'
  else if(u.includes('docs.google'))ico='📄'
  else if(u.includes('sheets.google')||u.includes('spreadsheet'))ico='📊'
  else if(u.includes('drive.google'))ico='📁'
  else if(u.includes('notion.so'))ico='📓'
  else if(u.includes('slack.com'))ico='💬'
  else if(u.includes('dropbox.com'))ico='📦'
  else if(u.includes('airtable.com'))ico='📋'
  return `<div class="link-item" data-lid="${l.id}">
    <div class="link-ico">${ico}</div>
    <div class="link-info">
      <div class="link-lbl">${esc(l.label)}</div>
      <div class="link-url">${esc(l.url)}</div>
    </div>
    <a class="link-open" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>
    <button class="link-del" onclick="removeLink('${l.id}')" title="Remove">×</button>
  </div>`
}

// ══════════════════════════════════════════════════════
//  CALENDAR VIEW
// ══════════════════════════════════════════════════════
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December']
const PRODUCT_DEVELOPMENT_TEMPLATE=[
  'Line Plan Due',
  'Design/CAD Phase',
  'Internal CAD Review',
  'External CAD Review',
  'Tech Pack Phase',
  'Sampling Time Phase',
  'First Samples Due',
  'Midpoint Prep Phase',
  'Internal Midpoint',
  'External Midpoint',
  'Tech Packs Updates',
  'Second Round Sample Phase',
  'Second Round Samples Due',
  'Line Final Prep',
  'Internal Line Final',
  'External Line Final',
  'Final Tech Pack Updates'
]

function setCalFilter(f){calFilter=f;renderMain()}
function setCalOwnerFilter(v){calOwnerFilter=v;renderMain()}
function calendarRangeTitle(baseDate,count){
  const start=new Date(baseDate.getFullYear(),baseDate.getMonth(),1)
  const end=new Date(baseDate.getFullYear(),baseDate.getMonth()+count-1,1)
  return `${MONTHS[start.getMonth()]} ${start.getFullYear()} - ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}
function renderCalendarNav(title){
  return `<div class="cal-nav">
    <div class="cal-nav-title">${title}</div>
    <div class="cal-nav-btns">
      <button class="cal-nav-btn" onclick="calPrev()">← Prev</button>
      <button class="cal-nav-btn" onclick="calToday()">Today</button>
      <button class="cal-nav-btn" onclick="calNext()">Next →</button>
    </div>
  </div>`
}
function renderCalendarControls(opts={}){
  const ownerOptions=opts.showOwnerFilter?`<select class="cal-owner-select" onchange="setCalOwnerFilter(this.value)">
      <option value="all" ${calOwnerFilter==='all'?'selected':''}>All People</option>
      ${state.members.map(m=>`<option value="${m.id}" ${calOwnerFilter===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}
    </select>`:''
  return `<div style="display:flex;gap:10px;margin-bottom:18px;align-items:center;flex-wrap:wrap">
    <div class="view-toggle">
      <button class="vt-btn ${calMode==='month'?'active':''}" onclick="setCalMode('month')">Month</button>
      <button class="vt-btn ${calMode==='6month'?'active':''}" onclick="setCalMode('6month')">6 Months</button>
    </div>
    <div class="cal-filter-row" style="margin-bottom:0">
      <span class="cal-filter-lbl">Show:</span>
      <button class="cal-filt-btn ${calFilter==='all'?'on':''}" onclick="setCalFilter('all')">All</button>
      <button class="cal-filt-btn ${calFilter==='tasks'?'on':''}" onclick="setCalFilter('tasks')">Tasks</button>
      <button class="cal-filt-btn ${calFilter==='meetings'?'on':''}" onclick="setCalFilter('meetings')">Meetings</button>
      <button class="travel-filter-btn${calTravelFilter?' on':''}" onclick="setCalTravelFilter()">✈️ Travel only</button>
      ${ownerOptions}
    </div>
  </div>`
}

function renderCalendar(p,m){
  const calModeToggle=renderCalendarControls()

  if(calMode==='6month'){
    return calModeToggle+render6Month(p,m)
  }
  return calModeToggle+renderMonthView(p,m)
}

function renderMonthView(p,m){
  const year=calDate.getFullYear(), mon=calDate.getMonth()
  const firstDay=new Date(year,mon,1).getDay()
  const daysInMonth=new Date(year,mon+1,0).getDate()
  const today=todayIso()

  // Build task map: date → [{t, color, isSpan, prog}]
  const taskMap={}
  if(calFilter!=='meetings'){
    p.tasks.forEach(t=>{
      if(!t.dueDate)return
      const prog=t.progress||'not-started'
      // Color by progress: gray-tinted for not started, member color for in-progress, green for done
      let chipColor=prog==='completed'?'#3DAD76':m.color
      if(prog==='not-started')chipColor=m.color+'88'
      const key=t.dueDate
      if(!taskMap[key])taskMap[key]=[]
      taskMap[key].push({t,color:chipColor,p,prog})
      // Span days
      if(t.startDate&&t.startDate<t.dueDate){
        let cur=new Date(t.startDate+'T00:00:00')
        const end=new Date(t.dueDate+'T00:00:00')
        cur.setDate(cur.getDate()+1)
        while(cur<end){
          const k=cur.toISOString().slice(0,10)
          if(!taskMap[k])taskMap[k]=[]
          taskMap[k].push({t,color:chipColor+'66',p,isSpan:true,prog})
          cur.setDate(cur.getDate()+1)
        }
      }
    })
  }

  // Build meeting map: date → [meeting]
  const meetingMap={}
  if(calFilter!=='tasks'){
    ;(p.meetings||[]).forEach(mt=>{
      if(!mt.date)return
      addCalendarItem(meetingMap,mt.date,mt)
    })
  }

  // Build project range map
  const projRangeMap={}
  if(calFilter!=='meetings'){
    addProjectRange(projRangeMap,p,m)
  }

  let h=renderCalendarNav(`${MONTHS[mon]} ${year}`)+`<div class="cal-month">`

  DAYS.forEach(d=>{h+=`<div class="cal-dow">${d}</div>`})
  for(let i=0;i<firstDay;i++)h+=`<div class="cal-day other-month"></div>`

  for(let d=1;d<=daysInMonth;d++){
    const iso=`${year}-${String(mon+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const isToday=iso===today
    const tasks=taskMap[iso]||[]
    const meetings=meetingMap[iso]||[]
    const ranges=projRangeMap[iso]||[]
    const allItems=[
      ...ranges,
      ...meetings.map(mt=>({isMeeting:true,mt})),
      ...tasks.map(({t,color,isSpan,prog})=>({isMeeting:false,isProjDate:false,t,color,isSpan,prog}))
    ]
    const shown=allItems.slice(0,3)
    const more=allItems.length-3

    h+=`<div class="cal-day ${isToday?'today':''}" onclick="calDayClick('${iso}')">
      <div class="cal-day-num">${d}</div>
      <div class="cal-chips">${shown.map(item=>{
        if(item.kind==='project-range'){
          return `<div class="cal-chip cal-chip-proj-range ${item.segment}"
            title="${esc(item.p.name)}${item.p.startDate&&item.p.endDate?` (${item.p.startDate} to ${item.p.endDate})`:''}"
            onclick="event.stopPropagation();goProject('${item.p.id}')">
            ${item.segment==='start'||item.segment==='single'?'◆ ':''}${esc(item.p.name.slice(0,20))}
          </div>`
        }
        if(item.isMeeting){
          return `<div class="cal-chip cal-chip-meeting" title="${esc(item.mt.title)}"
            onclick="event.stopPropagation()">🤝 ${esc(item.mt.title.slice(0,18))}</div>`
        }
        return `<div class="cal-chip" style="background:${item.color}" title="${esc(item.t.text)}"
          onclick="event.stopPropagation();goProject('${p.id}')">
          ${item.isSpan?'—':''} ${esc(item.t.text.slice(0,22))}
        </div>`
      }).join('')}</div>
      ${more>0?`<div class="cal-more">+${more} more</div>`:''}
      <span class="cal-add-hint">＋</span>
    </div>`
  }

  const totalCells=firstDay+daysInMonth
  const remainder=totalCells%7===0?0:7-(totalCells%7)
  for(let i=0;i<remainder;i++)h+=`<div class="cal-day other-month"></div>`

  h+=`</div>`
  return h
}

function render6Month(p,m){
  const taskDates=new Set()
  const meetingDates=new Set()

  if(calFilter!=='meetings'){
    p.tasks.forEach(t=>{
      if(t.dueDate)taskDates.add(t.dueDate)
      if(t.startDate&&t.dueDate){
        let cur=new Date(t.startDate+'T00:00:00')
        const end=new Date(t.dueDate+'T00:00:00')
        while(cur<=end){taskDates.add(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1)}
      }
    })
  }

  if(calFilter!=='tasks'){
    ;(p.meetings||[]).forEach(mt=>{if(mt.date)meetingDates.add(mt.date)})
  }

  // Project range dates
  const projDates=new Set()
  if(calFilter!=='meetings'){
    if(p.startDate||p.endDate){
      eachIsoDay(p.startDate||p.endDate,p.endDate||p.startDate,iso=>projDates.add(iso))
    }
  }

  const today=todayIso()
  let h=renderCalendarNav(calendarRangeTitle(calDate,6))+`<div class="six-month-grid">`
  for(let mo=0;mo<6;mo++){
    const d=new Date(calDate.getFullYear(),calDate.getMonth()+mo,1)
    const year=d.getFullYear(),mon=d.getMonth()
    const firstDay=d.getDay()
    const daysInMonth=new Date(year,mon+1,0).getDate()

    h+=`<div class="mini-month">
      <div class="mini-month-title">${MONTHS[mon].slice(0,3)} ${year}</div>
      <div class="mini-cal">`
    DAYS.forEach(day=>{h+=`<div class="mini-dow">${day[0]}</div>`})
    for(let i=0;i<firstDay;i++)h+=`<div class="mini-day other"></div>`
    for(let day=1;day<=daysInMonth;day++){
      const iso=`${year}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const hasTasks=taskDates.has(iso)
      const hasMeeting=meetingDates.has(iso)
      const hasProjDate=projDates.has(iso)
      const isToday=iso===today
      let cls='mini-day'
      if(isToday)cls+=' today-mini'
      if(hasProjDate)cls+=' has-proj-range'
      if(hasMeeting)cls+=' has-meeting'
      if(!hasProjDate&&!hasMeeting&&hasTasks)cls+=' has-tasks'
      h+=`<div class="${cls}" onclick="goMonth('${iso}')" title="${iso}">${day}</div>`
    }
    h+=`</div></div>`
  }
  h+=`</div>`
  return h
}

// ══════════════════════════════════════════════════════
//  GLOBAL CALENDAR (all members/projects)
// ══════════════════════════════════════════════════════
function renderAllCalendar(){
  // Collect tasks, meetings, project ranges, and travel across every active project
  const taskMap={}, meetingMap={}, projMap={}, travelMap={}
  for(const m of state.members){
    if(calOwnerFilter!=='all'&&m.id!==calOwnerFilter)continue
    for(const b of m.brands){
      for(const p of b.projects){
        if(p.status==='archived')continue
        if(calFilter!=='meetings'){
          // Tasks
          for(const t of p.tasks){
            if(!t.dueDate)continue
            const prog=t.progress||'not-started'
            let chip=prog==='completed'?'#3DAD76':m.color
            if(prog==='not-started')chip=m.color+'88'
            addCalendarItem(taskMap,t.dueDate,{t,p,b,m,color:chip})
            if(t.startDate&&t.startDate<t.dueDate){
              let cur=new Date(t.startDate+'T00:00:00')
              const end=new Date(t.dueDate+'T00:00:00')
              cur.setDate(cur.getDate()+1)
              while(cur<end){
                const k=cur.toISOString().slice(0,10)
                addCalendarItem(taskMap,k,{t,p,b,m,color:chip+'66',isSpan:true})
                cur.setDate(cur.getDate()+1)
              }
            }
          }
          addProjectRange(projMap,p,m,{b})
          // Travel items
          for(const tr of p.travel||[]){
            const start=tr.startDate||tr.endDate
            const end=tr.endDate||tr.startDate
            if(!start)continue
            eachIsoDay(start,end,iso=>addCalendarItem(travelMap,iso,{tr,p,b,m}))
          }
        }
        if(calFilter!=='tasks'){
          for(const mt of p.meetings||[]){
            if(!mt.date)continue
            addCalendarItem(meetingMap,mt.date,{mt,p,b,m})
          }
        }
      }
    }
  }

  // Legend
  const activeMembers=state.members.filter(m=>m.brands.some(b=>b.projects.some(p=>p.status!=='archived')))
  const legend=activeMembers.map(m=>`<div class="gcal-legend-item"><div class="gcal-legend-dot" style="background:${m.color}"></div>${esc(m.name)}</div>`).join('')
    +`<div class="gcal-legend-item"><div class="gcal-legend-dot" style="background:#9B6DE8"></div>Meetings</div>`
    +`<div class="gcal-legend-item"><div class="gcal-legend-dot" style="background:var(--ok)"></div>Project Range</div>`

  const year=calDate.getFullYear(),mon=calDate.getMonth()
  const firstDay=new Date(year,mon,1).getDay()
  const daysInMonth=new Date(year,mon+1,0).getDate()
  const today=todayIso()

  const filterRow=renderCalendarControls({showOwnerFilter:true})+`<div class="gcal-legend">${legend}</div>`

  if(calMode==='6month'){
    const taskDates=new Set(Object.keys(taskMap))
    const meetDates=new Set(Object.keys(meetingMap))
    const projDates=new Set(Object.keys(projMap))
    let h=filterRow+renderCalendarNav(calendarRangeTitle(calDate,6))+`<div class="six-month-grid">`
    for(let mo=0;mo<6;mo++){
      const d=new Date(calDate.getFullYear(),calDate.getMonth()+mo,1)
      const yr=d.getFullYear(),mn=d.getMonth()
      const fd=d.getDay(),dim=new Date(yr,mn+1,0).getDate()
      h+=`<div class="mini-month"><div class="mini-month-title">${MONTHS[mn].slice(0,3)} ${yr}</div><div class="mini-cal">`
      DAYS.forEach(day=>{h+=`<div class="mini-dow">${day[0]}</div>`})
      for(let i=0;i<fd;i++)h+=`<div class="mini-day other"></div>`
      for(let day=1;day<=dim;day++){
        const iso=`${yr}-${String(mn+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
        const isToday=iso===today
        let cls='mini-day'
        if(isToday)cls+=' today-mini'
        if(projDates.has(iso))cls+=' has-proj-range'
        if(meetDates.has(iso))cls+=' has-meeting'
        if(!projDates.has(iso)&&!meetDates.has(iso)&&taskDates.has(iso))cls+=' has-tasks'
        h+=`<div class="${cls}" onclick="goMonth('${iso}')" title="${iso}">${day}</div>`
      }
      h+=`</div></div>`
    }
    return h+`</div>`
  }

  // Month view
  let h=filterRow+renderCalendarNav(`${MONTHS[mon]} ${year}`)+`<div class="cal-month">`

  DAYS.forEach(d=>{h+=`<div class="cal-dow">${d}</div>`})
  for(let i=0;i<firstDay;i++)h+=`<div class="cal-day other-month"></div>`
  for(let d=1;d<=daysInMonth;d++){
    const iso=`${year}-${String(mon+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const isToday=iso===today
    const ranges=projMap[iso]||[]
    const meets=meetingMap[iso]||[]
    const tasks=calTravelFilter?[]:(taskMap[iso]||[])
    const travels=travelMap[iso]||[]
    const all=[
      ...ranges,
      ...travels.map(x=>({isTravel:true,...x})),
      ...meets.map(x=>({isMeeting:true,...x})),
      ...(calTravelFilter?[]:tasks.map(x=>({isProjDate:false,isMeeting:false,...x})))
    ]
    const shown=all.slice(0,3),more=all.length-3
    h+=`<div class="cal-day ${isToday?'today':''}" style="cursor:default">
      <div class="cal-day-num">${d}</div>
      <div class="cal-chips">${shown.map(item=>{
        if(item.kind==='project-range'){
          return `<div class="cal-chip cal-chip-proj-range ${item.segment}"
            title="${esc(item.m.name)} · ${esc(item.p.name)}${item.p.startDate&&item.p.endDate?` (${item.p.startDate} to ${item.p.endDate})`:''}"
            onclick="event.stopPropagation();goProject('${item.p.id}')">
            ${item.segment==='start'||item.segment==='single'?'◆ ':''}${esc(item.p.name.slice(0,16))}
          </div>`
        }
        if(item.isTravel){
          const ico=item.tr.type==='Flight'?'✈️':item.tr.type==='Hotel'?'🏨':'🏭'
          return `<div class="cal-chip cal-chip-travel" title="${esc(item.tr.type)}: ${esc(item.tr.title)} — ${esc(item.p.name)}"
            onclick="event.stopPropagation();goProject('${item.p.id}')">${ico} ${esc(item.tr.title.slice(0,16))}</div>`
        }
        if(item.isMeeting){
          return `<div class="cal-chip cal-chip-meeting" title="${esc(item.mt.title)} — ${esc(item.p.name)}"
            onclick="event.stopPropagation();goProject('${item.p.id}')">🤝 ${esc(item.mt.title.slice(0,16))}</div>`
        }
        return `<div class="cal-chip" style="background:${item.color}" title="${esc(item.t.text)} — ${esc(item.p.name)}"
          onclick="event.stopPropagation();goProject('${item.p.id}')">
          ${item.isSpan?'—':''} ${esc(item.t.text.slice(0,20))}
        </div>`
      }).join('')}</div>
      ${more>0?`<div class="cal-more">+${more} more</div>`:''}
    </div>`
  }
  const rem=(firstDay+daysInMonth)%7
  for(let i=0;i<(rem?7-rem:0);i++)h+=`<div class="cal-day other-month"></div>`
  return h+`</div>`
}

// ══════════════════════════════════════════════════════
//  CLOUD SYNC PANEL
// ══════════════════════════════════════════════════════
function renderSyncPanel(){
  return `<div class="sync-panel">
    <h2>☁️ Cloud Sync</h2>
    <p>Your data saves automatically to the cloud every time you make a change — no manual action needed. You can open Studio from any browser, on any device, and your data will always be up to date.</p>
    <p>The <strong>●</strong> dot in the bottom-left of the sidebar shows sync status: <span style="color:#3DAD76">●</span> green = saved, <span style="color:#D9934A">●</span> yellow = saving, <span style="color:#D95B5B">●</span> red = error.</p>

    <h3 style="margin-top:24px;font-size:14px;font-weight:600;margin-bottom:6px">📦 Backup & Restore</h3>
    <p>Download a local copy of all your data as a safety backup, or restore from a previous backup file.</p>
    <div class="sync-actions">
      <button class="btn btn-primary" onclick="exportJSON()">⬇ Download Backup</button>
      <button class="btn btn-ghost" onclick="document.getElementById('fileInput').click()">⬆ Restore from Backup</button>
    </div>

    <div class="drop-zone" id="dropZone"
      ondragover="event.preventDefault();this.classList.add('drag-over')"
      ondragleave="this.classList.remove('drag-over')"
      ondrop="onDrop(event)">
      Or drag &amp; drop a backup <code>.json</code> file here to restore
    </div>
  </div>`
}

// ══════════════════════════════════════════════════════
//  RICH TEXT EDITOR
// ══════════════════════════════════════════════════════
let activeEditorId=null
const noteSelections={}

function rememberSelection(nid){
  const sel=window.getSelection()
  const editor=getEditor(nid)
  if(!sel||!sel.rangeCount||!editor)return
  const range=sel.getRangeAt(0)
  if(editor.contains(range.commonAncestorContainer))noteSelections[nid]=range.cloneRange()
}

function setActiveEditor(nid){
  activeEditorId=nid
  rememberSelection(nid)
  refreshToolbar(nid)
}

function getEditor(nid){
  return document.querySelector(`.rte-content[data-nid="${nid}"]`)
}

function withEditorSelection(nid,fn){
  const editor=getEditor(nid)
  const sel=window.getSelection()
  if(!editor||!sel)return false
  let range=null
  if(sel.rangeCount&&editor.contains(sel.getRangeAt(0).commonAncestorContainer)){
    range=sel.getRangeAt(0)
  }else if(noteSelections[nid]){
    range=noteSelections[nid].cloneRange()
    sel.removeAllRanges()
    sel.addRange(range)
  }
  if(!range)return false
  fn(range,sel,editor)
  noteSelections[nid]=range.cloneRange()
  refreshToolbar(nid)
  return true
}

function escapeHTML(text){
  return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function sanitizeNoteHTML(html){
  const tpl=document.createElement('template')
  tpl.innerHTML=html||''
  const allowed=new Set(['B','STRONG','I','EM','U','MARK','BR','P','DIV','UL','OL','LI','H2','H3','BLOCKQUOTE','A','IMG'])
  ;[...tpl.content.querySelectorAll('*')].forEach(node=>{
    const href=node.tagName==='A'?(node.getAttribute('href')||'').trim():''
    const src=node.tagName==='IMG'?(node.getAttribute('src')||'').trim():''
    if(!allowed.has(node.tagName)){
      node.replaceWith(...node.childNodes)
      return
    }
    ;[...node.attributes].forEach(attr=>node.removeAttribute(attr.name))
    if(node.tagName==='A'){
      if(/^https?:\/\//i.test(href)){
        node.setAttribute('href',href)
        node.setAttribute('target','_blank')
        node.setAttribute('rel','noopener noreferrer')
      }else{
        node.replaceWith(...node.childNodes)
      }
    }
    if(node.tagName==='IMG'){
      if(/^data:image\//i.test(src)||/^https?:\/\//i.test(src)){
        node.setAttribute('src',src)
        node.setAttribute('alt','')
      }else{
        node.remove()
      }
    }
  })
  return tpl.innerHTML
}

function insertHTMLAtSelection(html,nid){
  return withEditorSelection(nid,(range,sel)=>{
    range.deleteContents()
    const tpl=document.createElement('template')
    tpl.innerHTML=html
    const frag=tpl.content.cloneNode(true)
    const last=frag.lastChild
    range.insertNode(frag)
    if(last){
      range.setStartAfter(last)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  })
}

function createRangeFromStoredSelection(nid){
  const sel=window.getSelection()
  if(sel?.rangeCount)return sel.getRangeAt(0)
  return noteSelections[nid]?noteSelections[nid].cloneRange():null
}

function closestEditorNode(node,tags,editor){
  const wanted=new Set(tags.map(t=>t.toUpperCase()))
  let cur=node?.nodeType===3?node.parentNode:node
  while(cur&&cur!==editor){
    if(wanted.has(cur.tagName))return cur
    cur=cur.parentNode
  }
  return null
}

function closestBlockNode(node,editor){
  return closestEditorNode(node,['P','DIV','H2','H3','BLOCKQUOTE','LI'],editor)||editor
}

function placeCursorInside(node,atEnd=true){
  const range=document.createRange()
  const sel=window.getSelection()
  range.selectNodeContents(node)
  range.collapse(!atEnd?true:false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function wrapSelection(tag,nid,attrs={}){
  return withEditorSelection(nid,(range,sel)=>{
    if(range.collapsed){
      const el=document.createElement(tag)
      Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v))
      el.textContent=tag==='mark'?'highlight':'text'
      range.insertNode(el)
      placeCursorInside(el)
      return
    }
    const wrapper=document.createElement(tag)
    Object.entries(attrs).forEach(([k,v])=>wrapper.setAttribute(k,v))
    try{
      range.surroundContents(wrapper)
    }catch{
      const frag=range.extractContents()
      wrapper.appendChild(frag)
      range.insertNode(wrapper)
    }
    range.selectNodeContents(wrapper)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  })
}

function replaceTag(node,tag){
  if(!node||node.tagName===tag.toUpperCase())return node
  const next=document.createElement(tag)
  while(node.firstChild)next.appendChild(node.firstChild)
  node.replaceWith(next)
  return next
}

function stripInlineFormatting(root){
  ;[...root.querySelectorAll('b,strong,i,em,u,mark,a')].forEach(el=>el.replaceWith(...el.childNodes))
}

function toggleBlock(tag,nid){
  const editor=getEditor(nid)
  if(!editor)return
  withEditorSelection(nid,(range,sel)=>{
    const block=closestBlockNode(range.startContainer,editor)
    const updated=replaceTag(block===editor?document.createElement('div'):block,tag)
    if(block===editor){
      updated.appendChild(range.extractContents())
      range.insertNode(updated)
    }
    placeCursorInside(updated)
    noteSelections[nid]=window.getSelection().getRangeAt(0).cloneRange()
  })
}

function toggleList(type,nid){
  const editor=getEditor(nid)
  if(!editor)return
  withEditorSelection(nid,(range,sel)=>{
    const text=(range.toString().trim()||closestBlockNode(range.startContainer,editor).textContent||'List item').trim()
    const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean)
    const list=document.createElement(type)
    ;(lines.length?lines:['List item']).forEach(line=>{
      const li=document.createElement('li')
      li.textContent=line
      list.appendChild(li)
    })
    if(range.collapsed){
      const block=closestBlockNode(range.startContainer,editor)
      if(block!==editor)block.replaceWith(list)
      else range.insertNode(list)
    }else{
      range.deleteContents()
      range.insertNode(list)
    }
    placeCursorInside(list.querySelector('li'),true)
    noteSelections[nid]=window.getSelection().getRangeAt(0).cloneRange()
  })
}

function clearFormatting(nid){
  const editor=getEditor(nid)
  if(!editor)return
  withEditorSelection(nid,(range)=>{
    if(range.collapsed){
      const block=closestBlockNode(range.startContainer,editor)
      if(block!==editor){
        const plain=replaceTag(block,'p')
        stripInlineFormatting(plain)
        placeCursorInside(plain)
      }
      return
    }
    const text=range.toString()
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
  })
}

function promptForLink(nid){
  const href=prompt('Paste a full URL (https://...)')
  if(!href)return
  if(!/^https?:\/\//i.test(href)){showNotice('Please use a full URL starting with https://');return}
  const info=createRangeFromStoredSelection(nid)
  const editor=getEditor(nid)
  if(!info||!editor)return
  withEditorSelection(nid,(range,sel)=>{
    if(range.collapsed){
      const a=document.createElement('a')
      a.href=href
      a.target='_blank'
      a.rel='noopener noreferrer'
      a.textContent=href
      range.insertNode(a)
      placeCursorInside(a,true)
    }else{
      wrapSelection('a',nid,{href,target:'_blank',rel:'noopener noreferrer'})
    }
  })
}

function rteCmd(event,cmd,nid){
  event.preventDefault()
  activeEditorId=nid
  const editor=getEditor(nid)
  if(editor)editor.focus()
  if(cmd==='bold')wrapSelection('strong',nid)
  else if(cmd==='italic')wrapSelection('em',nid)
  else if(cmd==='underline')wrapSelection('u',nid)
  else if(cmd==='highlight')wrapSelection('mark',nid)
  else if(cmd==='bullets')toggleList('ul',nid)
  else if(cmd==='numbers')toggleList('ol',nid)
  else if(cmd==='h2')toggleBlock('h2',nid)
  else if(cmd==='h3')toggleBlock('h3',nid)
  else if(cmd==='quote')toggleBlock('blockquote',nid)
  else if(cmd==='link')promptForLink(nid)
  else if(cmd==='clear')clearFormatting(nid)
  refreshToolbar(nid)
}

function refreshToolbar(nid){
  const toolbar=document.querySelector(`.rte-toolbar[data-nid="${nid}"]`)
  if(!toolbar)return
  const editor=getEditor(nid)
  const range=createRangeFromStoredSelection(nid)
  toolbar.querySelectorAll('.rte-btn').forEach(btn=>btn.classList.remove('active-fmt'))
  if(!range||!editor)return
  const start=range.startContainer
  if(closestEditorNode(start,['B','STRONG'],editor))toolbar.querySelector('[data-cmd="bold"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['I','EM'],editor))toolbar.querySelector('[data-cmd="italic"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['U'],editor))toolbar.querySelector('[data-cmd="underline"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['MARK'],editor))toolbar.querySelector('[data-cmd="highlight"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['UL'],editor))toolbar.querySelector('[data-cmd="bullets"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['OL'],editor))toolbar.querySelector('[data-cmd="numbers"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['H2'],editor))toolbar.querySelector('[data-cmd="h2"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['H3'],editor))toolbar.querySelector('[data-cmd="h3"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['BLOCKQUOTE'],editor))toolbar.querySelector('[data-cmd="quote"]')?.classList.add('active-fmt')
  if(closestEditorNode(start,['A'],editor))toolbar.querySelector('[data-cmd="link"]')?.classList.add('active-fmt')
}

function handleNotePaste(e,nid){
  if(e.clipboardData?.files?.length){
    const images=[...e.clipboardData.files].filter(file=>file.type.startsWith('image/'))
    if(images.length){
      e.preventDefault()
      rememberSelection(nid)
      images.reduce((p,file)=>p.then(()=>new Promise(res=>{
        const reader=new FileReader()
        reader.onload=()=>{insertHTMLAtSelection(`<img src="${reader.result}" alt="">`,nid);res()}
        reader.readAsDataURL(file)
      })),Promise.resolve())
      return
    }
  }
  e.preventDefault()
  const html=e.clipboardData.getData('text/html')
  const text=e.clipboardData.getData('text/plain')
  if(html){
    insertHTMLAtSelection(sanitizeNoteHTML(html),nid)
  }else{
    const safe=escapeHTML(text).replace(/\n/g,'<br>')
    insertHTMLAtSelection(safe,nid)
  }
}

function rteKeydown(e,nid){
  if(e.key==='b'&&(e.ctrlKey||e.metaKey)){e.preventDefault();wrapSelection('strong',nid)}
  else if(e.key==='i'&&(e.ctrlKey||e.metaKey)){e.preventDefault();wrapSelection('em',nid)}
  else if(e.key==='u'&&(e.ctrlKey||e.metaKey)){e.preventDefault();wrapSelection('u',nid)}
  setTimeout(()=>{rememberSelection(nid);refreshToolbar(nid)},0)
}

function saveNoteBody(nid,el){
  const f=sel();if(!f)return
  const n=f.p.notes.find(n=>n.id===nid)
  if(n){
    n.body=sanitizeNoteHTML(el.innerHTML)
    el.innerHTML=n.body
    save()
  }
}

// ══════════════════════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════════════════════
function openSearch(){
  document.getElementById('searchOverlay').style.display='flex'
  const inp=document.getElementById('searchBoxInp')
  const sv=document.getElementById('searchInput').value
  inp.value=sv
  inp.focus()
  if(sv)doSearch(sv)
}

function closeSearch(){
  document.getElementById('searchOverlay').style.display='none'
  document.getElementById('searchInput').value=''
}

function onSearchOverlayClick(e){if(e.target===document.getElementById('searchOverlay'))closeSearch()}

function onSearchKey(e){
  if(e.key==='Escape')closeSearch()
  if(e.key==='Enter'){
    const first=document.querySelector('.search-result')
    if(first)first.click()
  }
}

function doSearch(q){
  const results=document.getElementById('searchResults')
  if(!q||q.length<2){results.innerHTML='<div class="search-empty">Start typing to search across notes, tasks, links, and summaries</div>';return}

  const qLow=q.toLowerCase()
  const hits=[]

  for(const m of state.members)for(const b of m.brands)for(const p of b.projects){
    for(const n of p.notes){
      const titleMatch=n.title.toLowerCase().includes(qLow)
      const body=stripHtml(n.body||'')
      const bodyMatch=body.toLowerCase().includes(qLow)
      if(titleMatch||bodyMatch){
        hits.push({kind:'note',title:n.title||'Untitled Note',p,b,m,id:n.id,snippet:highlightSnippet(bodyMatch?body:n.title,q)})
      }
    }
    for(const t of p.tasks||[]){
      if((t.text||'').toLowerCase().includes(qLow)){
        hits.push({kind:'task',title:t.text,p,b,m,id:t.id,snippet:highlightSnippet(t.text,q)})
      }
    }
    const summary=stripHtml(p.summary||'')
    if(summary.toLowerCase().includes(qLow)){
      hits.push({kind:'summary',title:`${p.name} Summary`,p,b,m,id:p.id,snippet:highlightSnippet(summary,q)})
    }
    for(const l of p.links||[]){
      const hay=`${l.label||''} ${l.url||''}`.trim()
      if(hay.toLowerCase().includes(qLow)){
        hits.push({kind:'link',title:l.label||l.url||'Project Link',p,b,m,id:l.id,snippet:highlightSnippet(hay,q)})
      }
    }
    for(const mt of p.meetings||[]){
      if((mt.title||'').toLowerCase().includes(qLow)){
        hits.push({kind:'meeting',title:mt.title||'Meeting',p,b,m,id:mt.id,snippet:highlightSnippet(mt.title||'',q)})
      }
    }
    for(const tr of p.travel||[]){
      const hay=`${tr.type||''} ${tr.title||''}`.trim()
      if(hay.toLowerCase().includes(qLow)){
        hits.push({kind:'travel',title:tr.title||tr.type||'Travel',p,b,m,id:tr.id,snippet:highlightSnippet(hay,q)})
      }
    }
  }

  if(!hits.length){results.innerHTML=`<div class="search-empty">No results for "<strong>${esc(q)}</strong>"</div>`;return}

  results.innerHTML=hits.slice(0,24).map(({kind,title,p,b,m,id,snippet})=>`
    <div class="search-result" onclick="goSearchResult('${kind}','${p.id}','${id}')">
      <div class="sr-top">
        <span class="sr-kind">${esc(kind)}</span>
        <span class="sr-project" style="color:${m.color}">${esc(m.name)} · ${esc(b.name)} · ${esc(p.name)}</span>
      </div>
      <div class="sr-title">${esc(title)}</div>
      ${snippet?`<div class="sr-snippet">${snippet}</div>`:''}
    </div>`).join('')
}

function highlightSnippet(text,q){
  const idx=text.toLowerCase().indexOf(q.toLowerCase())
  if(idx<0)return''
  const start=Math.max(0,idx-40)
  const end=Math.min(text.length,idx+q.length+60)
  let snippet=esc(text.slice(start,end))
  const escapedQ=esc(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  snippet=snippet.replace(new RegExp(escapedQ,'gi'),m=>`<mark>${m}</mark>`)
  return (start>0?'…':'')+snippet+(end<text.length?'…':'')
}

function goNote(pid,nid){
  closeSearch()
  goProject(pid)
  setTimeout(()=>{
    const f=findProject(pid)
    if(!f)return
    const n=f.p.notes.find(n=>n.id===nid)
    if(n&&!n.open){n.open=true;save();renderMain()}
    setTimeout(()=>{
      const el=document.querySelector(`.note-card[data-nid="${nid}"]`)
      if(el)el.scrollIntoView({behavior:'smooth',block:'center'})
    },100)
  },50)
}

function goTask(pid,tid){
  closeSearch()
  goProject(pid)
  setTimeout(()=>{
    const el=document.querySelector(`.task-item[data-tid="${tid}"]`)
    if(el)el.scrollIntoView({behavior:'smooth',block:'center'})
  },100)
}

function goSummary(pid){
  closeSearch()
  goProject(pid)
  setTimeout(()=>{
    const el=document.querySelector('.summary-ta')
    if(el)el.scrollIntoView({behavior:'smooth',block:'start'})
  },100)
}

function goLink(pid,lid){
  closeSearch()
  goProject(pid)
  setTimeout(()=>{
    const el=document.querySelector(`.link-item[data-lid="${lid}"]`)
    if(el)el.scrollIntoView({behavior:'smooth',block:'center'})
  },100)
}

function goSearchResult(kind,pid,id){
  if(kind==='note')goNote(pid,id)
  else if(kind==='task')goTask(pid,id)
  else if(kind==='link')goLink(pid,id)
  else goSummary(pid)
}

// ══════════════════════════════════════════════════════
//  INTERACTIONS
// ══════════════════════════════════════════════════════
function toggleMember(id){openMembers.has(id)?openMembers.delete(id):openMembers.add(id);renderSidebar()}
function toggleBrand(id){openBrands.has(id)?openBrands.delete(id):openBrands.add(id);renderSidebar()}

// ── MOBILE SIDEBAR ────────────────────────────────────
function toggleMobileSidebar(){
  document.getElementById('sidebar').classList.toggle('mob-open')
  document.getElementById('sbOverlay').classList.toggle('open')
}
function closeMobileSidebar(){
  document.getElementById('sidebar').classList.remove('mob-open')
  document.getElementById('sbOverlay').classList.remove('open')
}

function goProject(id){
  selId=id;showDone=false;viewMode='detail'
  const f=findProject(id)
  if(f){openMembers.add(f.m.id);openBrands.add(f.b.id)}
  closeMobileSidebar()
  render()
}

function showView(v){
  viewMode=v;closeMobileSidebar();render()
}

function showSyncFromHome(){
  showView('sync')
}

function projDragStart(e,type,id){
  const tag=e.target.tagName
  if(['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(tag)||e.target.isContentEditable){
    e.preventDefault()
    return
  }
  _drag={scope:'project',type,id}
  e.dataTransfer.effectAllowed='move'
  e.currentTarget.classList.add('proj-dragging')
}

function projDragEnd(e){
  e.currentTarget.classList.remove('proj-dragging')
  document.querySelectorAll('.proj-drag-over').forEach(el=>el.classList.remove('proj-drag-over'))
  if(_drag?.scope==='project')_drag=null
}

function projDragOver(e,type){
  if(!_drag||_drag.scope!=='project'||_drag.type!==type)return
  e.preventDefault()
  e.dataTransfer.dropEffect='move'
  document.querySelectorAll('.proj-drag-over').forEach(el=>el.classList.remove('proj-drag-over'))
  e.currentTarget.classList.add('proj-drag-over')
}

function moveProjectListItem(list,fromId,toId,key){
  const fromIndex=list.findIndex(item=>item[key]===fromId)
  const toIndex=list.findIndex(item=>item[key]===toId)
  if(fromIndex<0||toIndex<0||fromIndex===toIndex)return false
  list.splice(toIndex,0,list.splice(fromIndex,1)[0])
  return true
}

function projDrop(e,type,id){
  e.preventDefault()
  e.currentTarget.classList.remove('proj-drag-over')
  if(!_drag||_drag.scope!=='project'||_drag.type!==type||_drag.id===id)return
  const f=sel();if(!f)return
  let changed=false
  if(type==='task')changed=moveProjectListItem(f.p.tasks,_drag.id,id,'id')
  else if(type==='note')changed=moveProjectListItem(f.p.notes,_drag.id,id,'id')
  if(changed){save();renderMain()}
}

function setViewMode(v){
  viewMode=v;renderMain()
}

function setCalMode(m){
  calMode=m;renderMain()
}

function calPrev(){calDate=new Date(calDate.getFullYear(),calDate.getMonth()-1,1);renderMain()}
function calNext(){calDate=new Date(calDate.getFullYear(),calDate.getMonth()+1,1);renderMain()}
function calToday(){calDate=new Date();renderMain()}

function goMonth(iso){
  const d=new Date(iso+'T00:00:00')
  calDate=new Date(d.getFullYear(),d.getMonth(),1)
  calMode='month';renderMain()
}

function calDayClick(iso){
  const f=sel();if(!f)return
  openModal('quickTask',iso)
}

function toggleCard(head){
  const body=head.nextElementSibling
  const chev=head.querySelector('.card-chev')
  head.classList.toggle('open');body.classList.toggle('open');chev.classList.toggle('open')
}

function toggleDone(){showDone=!showDone;renderMain()}
function toggleArchived(){state.showArchived=!state.showArchived;document.getElementById('archLbl').textContent=state.showArchived?'Hide archived':'Show archived';save();render()}

// ══════════════════════════════════════════════════════
//  PROJECT ACTIONS
// ══════════════════════════════════════════════════════
function updateProjName(v){const f=sel();if(f&&v.trim()){f.p.name=v.trim();save();renderSidebar()}}
function duplicateProject(pid){
  const f=findProject(pid);if(!f)return
  const copy=deepClone(f.p)
  copy.id=uid()
  copy.name=f.p.name+' (Copy)'
  copy.status='active'
  copy.startDate=''
  copy.endDate=''
  // Reset task dates and progress
  for(const t of copy.tasks||[]){
    t.id=uid()
    t.startDate=''
    t.dueDate=''
    t.progress='not-started'
    t.done=false
  }
  // Reset note ids
  for(const n of copy.notes||[]){n.id=uid()}
  for(const l of copy.links||[]){l.id=uid()}
  copy.meetings=[]
  copy.travel=[]
  f.b.projects.push(copy)
  openBrands.add(f.b.id);openMembers.add(f.m.id)
  selId=copy.id
  save();render()
}

function archiveProject(){
  const f=sel();if(!f)return
  showConfirm(`Archive "${f.p.name}"? You can unarchive it later.`,()=>{
    f.p.status='archived';save();render()
  },'Archive')
}
function unarchive(){const f=sel();if(!f)return;f.p.status='active';save();render()}

// ══════════════════════════════════════════════════════
//  TASK CRUD
// ══════════════════════════════════════════════════════
function doAddTask(){
  const txt=document.getElementById('newTText')?.value.trim();if(!txt)return
  const start=document.getElementById('newTStart')?.value||''
  const due=document.getElementById('newTDue')?.value||''
  const f=sel();if(!f)return
  const prio=document.getElementById('newTPrio')?.value||''
  f.p.tasks.push({id:uid(),text:txt,startDate:start,dueDate:due,done:false,progress:'not-started',priority:prio})
  save();renderMain()
  setTimeout(()=>{const el=document.getElementById('newTText');if(el)el.focus()},30)
}

function generateProductDevelopmentTasks(){
  const f=sel();if(!f)return
  const existing=new Set(f.p.tasks.map(t=>String(t.text||'').trim().toLowerCase()).filter(Boolean))
  const toAdd=PRODUCT_DEVELOPMENT_TEMPLATE.filter(name=>!existing.has(name.toLowerCase()))
  if(!toAdd.length){
    showNotice('All product development tasks are already in this project.')
    return
  }
  toAdd.forEach(text=>{
    f.p.tasks.push({id:uid(),text,startDate:'',dueDate:'',done:false,progress:'not-started'})
  })
  save()
  renderMain()
  showNotice(`Added ${toAdd.length} product development task${toAdd.length===1?'':'s'}.`)
}

function toggleTask(tid,checked){
  const f=sel();if(!f)return
  const t=f.p.tasks.find(t=>t.id===tid)
  if(t){t.done=checked;t.progress=checked?'completed':'not-started';save();renderMain()}
}

function updateTaskTxt(tid,v){const f=sel();if(!f)return;const t=f.p.tasks.find(t=>t.id===tid);if(t&&v.trim()){t.text=v.trim();save()}}
function updateTaskStart(tid,v){const f=sel();if(!f)return;const t=f.p.tasks.find(t=>t.id===tid);if(t){t.startDate=v;save();renderSidebar()}}
function updateTaskDue(tid,v){const f=sel();if(!f)return;const t=f.p.tasks.find(t=>t.id===tid);if(t){t.dueDate=v;save();renderSidebar()}}
function updateTaskAssignee(tid,v){
  const f=sel();if(!f)return
  const t=f.p.tasks.find(t=>t.id===tid)
  if(!t)return
  t.assignee=v
  save()
}

function updateTaskPriority(tid,v){
  const f=sel();if(!f)return
  const t=f.p.tasks.find(t=>t.id===tid)
  if(!t)return
  t.priority=v
  save()
  // Update priority selector in-place without full re-render
  const item=document.querySelector(`.task-item[data-tid="${tid}"]`)
  if(item){
    const sel_el=item.querySelector('.prio-sel')
    if(sel_el){
      sel_el.value=v
      sel_el.className='prio-sel'+(v?' prio-'+v:'')
    }
  }
}

// ── UNDO SYSTEM ───────────────────────────────────────
let _undoStack=[]
let _undoTimer=null

function pushUndo(type,data,label){
  clearTimeout(_undoTimer)
  _undoStack.push({type,data,label})
  const toast=document.getElementById('undoToast')
  const msg=document.getElementById('undoMsg')
  if(toast)toast.classList.add('visible')
  if(msg)msg.textContent=label+' deleted'
  _undoTimer=setTimeout(flushUndo,5000)
}

function doUndo(){
  const item=_undoStack.pop()
  if(!item)return
  clearTimeout(_undoTimer)
  const toast=document.getElementById('undoToast')
  if(toast)toast.classList.remove('visible')
  const f=item.data.pid?findProject(item.data.pid):null
  if(item.type==='task'&&f){
    const idx=Math.min(item.data.idx,f.p.tasks.length)
    f.p.tasks.splice(idx,0,item.data.task)
  }else if(item.type==='note'&&f){
    const idx=Math.min(item.data.idx,f.p.notes.length)
    f.p.notes.splice(idx,0,item.data.note)
  }else if(item.type==='link'&&f){
    const idx=Math.min(item.data.idx,f.p.links.length)
    f.p.links.splice(idx,0,item.data.link)
  }else if(item.type==='meeting'&&f){
    if(!f.p.meetings)f.p.meetings=[]
    const idx=Math.min(item.data.idx,f.p.meetings.length)
    f.p.meetings.splice(idx,0,item.data.meeting)
  }else if(item.type==='travel'&&f){
    if(!f.p.travel)f.p.travel=[]
    const idx=Math.min(item.data.idx,f.p.travel.length)
    f.p.travel.splice(idx,0,item.data.item)
  }
  save();render()
}

function dismissUndo(){
  clearTimeout(_undoTimer)
  flushUndo()
}

function flushUndo(){
  _undoStack=[]
  const toast=document.getElementById('undoToast')
  if(toast)toast.classList.remove('visible')
}

function removeTask(tid){
  const f=sel();if(!f)return
  const idx=f.p.tasks.findIndex(t=>t.id===tid)
  if(idx<0)return
  const task=f.p.tasks[idx]
  f.p.tasks.splice(idx,1)
  pushUndo('task',{pid:f.p.id,task,idx},`"${(task.text||'Task').slice(0,28)}"`)
  save();renderMain()
}

// ══════════════════════════════════════════════════════
//  NOTE CRUD
// ══════════════════════════════════════════════════════
function doAddNote(){
  const f=sel();if(!f)return
  const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  f.p.notes.unshift({id:uid(),title:'New Note',body:'',date,open:true})
  save();renderMain()
  setTimeout(()=>{const el=document.querySelector('.note-title-inp');if(el){el.focus();el.select()}},30)
}

function toggleNote(nid,event){
  if(['INPUT','BUTTON','TEXTAREA'].includes(event.target.tagName))return
  const f=sel();if(!f)return
  const n=f.p.notes.find(n=>n.id===nid)
  if(n){n.open=!n.open;save();renderMain()}
}

function updateNoteTitle(nid,v){const f=sel();if(!f)return;const n=f.p.notes.find(n=>n.id===nid);if(n){n.title=v||'Untitled';save()}}
function removeNote(nid){
  const f=sel();if(!f)return
  const idx=f.p.notes.findIndex(n=>n.id===nid)
  if(idx<0)return
  const note=f.p.notes[idx]
  f.p.notes.splice(idx,1)
  pushUndo('note',{pid:f.p.id,note,idx},`Note "${(note.title||'Note').slice(0,28)}"`)
  save();renderMain()
}

// ══════════════════════════════════════════════════════
//  LINK CRUD
// ══════════════════════════════════════════════════════
function doAddLink(){
  const label=document.getElementById('newLLbl')?.value.trim()
  const url=document.getElementById('newLUrl')?.value.trim()
  if(!label||!url)return
  const f=sel();if(!f)return
  f.p.links.push({id:uid(),label,url});save();renderMain()
}
function removeLink(lid){
  const f=sel();if(!f)return
  const idx=f.p.links.findIndex(l=>l.id===lid)
  if(idx<0)return
  const link=f.p.links[idx]
  f.p.links.splice(idx,1)
  pushUndo('link',{pid:f.p.id,link,idx},`Link "${(link.label||'Link').slice(0,28)}"`)
  save();renderMain()
}

// ══════════════════════════════════════════════════════
//  SUMMARY CRUD
// ══════════════════════════════════════════════════════
function updateSummary(v){const f=sel();if(!f)return;f.p.summary=v;save()}
function updateProjStart(v){const f=sel();if(!f)return;f.p.startDate=v;save();renderMain()}
function updateProjEnd(v){const f=sel();if(!f)return;f.p.endDate=v;save();renderMain()}

// ══════════════════════════════════════════════════════
//  MEETING CRUD
// ══════════════════════════════════════════════════════
function doAddMeeting(){
  const title=document.getElementById('newMTitle')?.value.trim()
  const date=document.getElementById('newMDate')?.value||''
  if(!title)return
  const f=sel();if(!f)return
  if(!f.p.meetings)f.p.meetings=[]
  f.p.meetings.push({id:uid(),title,date})
  save();renderMain()
  setTimeout(()=>{const el=document.getElementById('newMTitle');if(el){el.value='';el.focus()}},30)
}

function removeMeeting(mid){
  const f=sel();if(!f)return
  const idx=(f.p.meetings||[]).findIndex(mt=>mt.id===mid)
  if(idx<0)return
  const meeting=f.p.meetings[idx]
  f.p.meetings.splice(idx,1)
  pushUndo('meeting',{pid:f.p.id,meeting,idx},'Meeting')
  save();renderMain()
}

function updateMeetingTitle(mid,v){
  const f=sel();if(!f)return
  const mt=f.p.meetings?.find(mt=>mt.id===mid)
  if(mt){mt.title=v||'Meeting';save()}
}

function updateMeetingDate(mid,v){
  const f=sel();if(!f)return
  const mt=f.p.meetings?.find(mt=>mt.id===mid)
  if(mt){mt.date=v;save()}
}

// ══════════════════════════════════════════════════════
//  TRAVEL CRUD
// ══════════════════════════════════════════════════════
function doAddTravel(){
  const f=sel();if(!f)return
  const type=document.getElementById('newTravelType')?.value||'Flight'
  const title=(document.getElementById('newTravelTitle')?.value||'').trim()
  if(!title)return
  const startDate=document.getElementById('newTravelStart')?.value||''
  const endDate=document.getElementById('newTravelEnd')?.value||''
  const link=(document.getElementById('newTravelLink')?.value||'').trim()
  if(!f.p.travel)f.p.travel=[]
  f.p.travel.push({id:uid(),type,title,startDate,endDate,link})
  save();renderMain()
}

function updateTravelField(id,key,value){
  const f=sel();if(!f)return
  const item=(f.p.travel||[]).find(tr=>tr.id===id)
  if(!item)return
  item[key]=key==='title'||key==='link'?value.trim():value
  save()
}

function removeTravel(id){
  const f=sel();if(!f)return
  const idx=(f.p.travel||[]).findIndex(tr=>tr.id===id)
  if(idx<0)return
  const item=f.p.travel[idx]
  f.p.travel.splice(idx,1)
  pushUndo('travel',{pid:f.p.id,item,idx},'Travel item')
  save();renderMain()
}

// ══════════════════════════════════════════════════════
//  TASK PROGRESS CRUD
// ══════════════════════════════════════════════════════
function updateTaskProgress(tid,v){
  const f=sel();if(!f)return
  const t=f.p.tasks.find(t=>t.id===tid)
  if(!t)return
  t.progress=v
  t.done=(v==='completed')
  save()
  // Update the task item in-place without full re-render for snappy UX
  const item=document.querySelector(`.task-item[data-tid="${tid}"]`)
  if(item){
    const chk=item.querySelector('.task-chk')
    const txt=item.querySelector('.task-txt')
    const sel_el=item.querySelector('.prog-sel')
    if(chk)chk.checked=(v==='completed')
    if(txt){txt.className='task-txt'+(v==='completed'?' done':'')}
    if(sel_el)sel_el.className='prog-sel prog-'+v
  }
}

// ══════════════════════════════════════════════════════
//  CLAUDE SYNC
// ══════════════════════════════════════════════════════
function exportJSON(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'})
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='studio_data.json';a.click()
}

function copyJSON(){
  navigator.clipboard.writeText(JSON.stringify(state,null,2))
    .then(()=>showNotice('JSON copied to clipboard! ✓'))
    .catch(()=>showNotice('Copy failed — try Export JSON instead.'))
}

function onFileImport(e){
  const file=e.target.files[0];if(!file)return
  const reader=new FileReader()
  reader.onload=ev=>{
    try{
      const imported=JSON.parse(ev.target.result)
      if(!imported.members)throw new Error('Invalid format')
      state=migrate(imported);save()
      selId=null;viewMode='detail'
      openMembers=new Set(state.members.filter(m=>m.isMe).map(m=>m.id))
      render()
      showNotice('Import successful! ✓')
    }catch(err){showNotice('Import failed: '+err.message)}
  }
  reader.readAsText(file)
  e.target.value=''
}

function onDrop(e){
  e.preventDefault()
  document.getElementById('dropZone')?.classList.remove('drag-over')
  const file=e.dataTransfer.files[0]
  if(!file||!file.name.endsWith('.json')){showNotice('Please drop a .json file');return}
  const reader=new FileReader()
  reader.onload=ev=>{
    try{
      const imported=JSON.parse(ev.target.result)
      if(!imported.members)throw new Error('Invalid format')
      state=migrate(imported);save()
      selId=null;viewMode='detail'
      openMembers=new Set(state.members.filter(m=>m.isMe).map(m=>m.id))
      render()
      showNotice('Import successful! ✓')
    }catch(err){showNotice('Import failed: '+err.message)}
  }
  reader.readAsText(file)
}

// ══════════════════════════════════════════════════════
//  CUSTOM DIALOG HELPERS (replace native alert/confirm/prompt)
// ══════════════════════════════════════════════════════
let _confirmCallback = null
let _promptCallback = null

function showConfirm(msg, onYes, dangerLabel='Delete'){
  _confirmCallback = onYes
  modalType = 'confirm'
  modalCtx = null
  document.getElementById('modalTtl').textContent = 'Are you sure?'
  document.getElementById('modalFields').innerHTML = `<div class="confirm-msg">${msg}</div>`
  const okBtn = document.getElementById('modalOk')
  okBtn.textContent = dangerLabel
  okBtn.className = 'btn btn-danger'
  document.getElementById('modalOv').style.display = 'flex'
}

function showPromptModal(title, placeholder, onSubmit){
  _promptCallback = onSubmit
  modalType = 'textPrompt'
  modalCtx = null
  document.getElementById('modalTtl').textContent = title
  document.getElementById('modalFields').innerHTML = `<div class="field"><input id="mf1" placeholder="${placeholder}" onkeydown="if(event.key==='Enter')modalSubmit()"></div>`
  const okBtn = document.getElementById('modalOk')
  okBtn.textContent = 'Create'
  okBtn.className = 'btn btn-primary'
  document.getElementById('modalOv').style.display = 'flex'
  setTimeout(()=>{const el=document.getElementById('mf1');if(el)el.focus()},30)
}

function showNotice(msg){
  const toast=document.getElementById('undoToast')
  const msgEl=document.getElementById('undoMsg')
  if(!toast||!msgEl)return
  clearTimeout(_undoTimer)
  msgEl.textContent=msg
  const undoBtn=toast.querySelector('.undo-btn')
  if(undoBtn)undoBtn.style.display='none'
  toast.classList.add('visible')
  _undoTimer=setTimeout(()=>{
    toast.classList.remove('visible')
    if(undoBtn)undoBtn.style.display=''
  },2500)
}

// ══════════════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════════════
function openModal(type,ctx){
  modalType=type;modalCtx=ctx
  const titles={member:'Add team member',brand:'Add brand / client',project:'Add project',quickTask:'Add task for this date',editMember:'Edit team member',editBrand:'Edit brand / client'}
  document.getElementById('modalTtl').textContent=titles[type]||'Add'
  document.getElementById('modalOk').textContent=(type.startsWith('edit'))?'Save':'Add'

  let fields=''
  if(type==='member'){
    fields=`<div class="field"><label>Name</label><input id="mf1" placeholder="e.g. Alex" onkeydown="if(event.key==='Enter')modalSubmit()"></div>`
  } else if(type==='editMember'){
    const m=state.members.find(m=>m.id===ctx);if(!m)return
    fields=`<div class="field"><label>Name</label><input id="mf1" value="${esc(m.name)}" onkeydown="if(event.key==='Enter')modalSubmit()"></div>
      <div class="field"><label>Color</label><input type="color" id="mf2" value="${m.color}" style="width:100%;height:40px;padding:2px;border:1px solid var(--bdr);border-radius:var(--rs);cursor:pointer"></div>`
  } else if(type==='brand'){
    fields=`<div class="field"><label>Brand / Client Name</label><input id="mf1" placeholder="e.g. Nike" onkeydown="if(event.key==='Enter')modalSubmit()"></div>`
  } else if(type==='editBrand'){
    const fb=findBrand(ctx);if(!fb)return
    fields=`<div class="field"><label>Brand / Client Name</label><input id="mf1" value="${esc(fb.b.name)}" onkeydown="if(event.key==='Enter')modalSubmit()"></div>`
  } else if(type==='project'){
    fields=`<div class="field"><label>Project Name</label><input id="mf1" placeholder="e.g. Spring 2027 Collection" onkeydown="if(event.key==='Enter')modalSubmit()"></div>`
  } else if(type==='quickTask'){
    fields=`<div class="field"><label>Task</label><input id="mf1" placeholder="What needs to be done?" onkeydown="if(event.key==='Enter')modalSubmit()"></div>
      <div class="field"><label>Due Date</label><input type="date" id="mf2" value="${ctx}"></div>`
  }

  document.getElementById('modalFields').innerHTML=fields
  document.getElementById('modalOv').style.display='flex'
  setTimeout(()=>{const el=document.getElementById('mf1');if(el)el.focus()},30)
}

function closeModal(){
  document.getElementById('modalOv').style.display='none'
  modalType=null;modalCtx=null
  _confirmCallback=null;_promptCallback=null
  const okBtn=document.getElementById('modalOk')
  if(okBtn){okBtn.textContent='Add';okBtn.className='btn btn-primary'}
}

function modalSubmit(){
  const name=(document.getElementById('mf1')?.value||'').trim()
  if(!name&&modalType!=='quickTask')return
  if(modalType==='quickTask'&&!name)return

  if(modalType==='member'){
    const color=COLORS[state.members.length%COLORS.length]
    state.members.push(mkMember(name,color,[]))
    save();closeModal();render()

  } else if(modalType==='editMember'){
    const m=state.members.find(m=>m.id===modalCtx);if(!m)return
    if(name)m.name=name
    const color=document.getElementById('mf2')?.value
    if(color)m.color=color
    save();closeModal();render()

  } else if(modalType==='brand'){
    const m=state.members.find(m=>m.id===modalCtx);if(!m)return
    const b=mkBrand(name,[]);m.brands.push(b)
    openMembers.add(m.id);openBrands.add(b.id)
    save();closeModal();render()

  } else if(modalType==='editBrand'){
    const fb=findBrand(modalCtx);if(!fb)return
    if(name)fb.b.name=name
    save();closeModal();render()

  } else if(modalType==='project'){
    const fb=findBrand(modalCtx);if(!fb)return
    const p=mkProject(name);fb.b.projects.push(p)
    openBrands.add(fb.b.id);openMembers.add(fb.m.id)
    selId=p.id
    save();closeModal();render()

  } else if(modalType==='quickTask'){
    const due=document.getElementById('mf2')?.value||modalCtx
    const f=sel();if(!f)return
    f.p.tasks.push({id:uid(),text:name,startDate:'',dueDate:due,done:false,progress:'not-started',priority:'',assignee:''})
    save();closeModal()
    viewMode='detail';renderMain()
  } else if(modalType==='confirm'){
    const cb=_confirmCallback
    closeModal()
    if(cb)cb()
  } else if(modalType==='textPrompt'){
    const val=(document.getElementById('mf1')?.value||'').trim()
    if(!val)return
    const cb=_promptCallback
    closeModal()
    if(cb)cb(val)
  }
}

// ══════════════════════════════════════════════════════
//  DELETE HELPERS
// ══════════════════════════════════════════════════════
function deleteMember(id){
  const m=state.members.find(m=>m.id===id);if(!m)return
  const projectCount=m.brands.reduce((n,b)=>n+b.projects.length,0)
  const warning=projectCount>0?` This will also delete ${m.brands.length} brand(s) and ${projectCount} project(s).`:''
  showConfirm(`Delete "${m.name}"?${warning} This cannot be undone.`,()=>{
    state.members=state.members.filter(m=>m.id!==id)
    if(selId){const f=findProject(selId);if(!f)selId=null}
    save();render()
  })
}

function deleteBrand(id){
  const fb=findBrand(id);if(!fb)return
  const count=fb.b.projects.length
  const warning=count>0?` This will also delete ${count} project(s).`:''
  showConfirm(`Delete "${fb.b.name}"?${warning} This cannot be undone.`,()=>{
    fb.m.brands=fb.m.brands.filter(b=>b.id!==id)
    if(selId){const f=findProject(selId);if(!f)selId=null}
    save();render()
  })
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════
function render(){
  if(!_globalKeyBound){document.addEventListener('keydown',onGlobalKeydown);_globalKeyBound=true}
  renderSidebar()
  renderMain()
  // Sync theme button active states after sidebar re-render
  document.querySelectorAll('.theme-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.theme===themeMode)
  })
}

// saveState is an alias for save() — used by Quick Capture spec
const saveState=()=>save()

// ── INIT: load from IndexedDB, fall back to localStorage ──
async function init() {
  initTheme()  // Apply theme before rendering (prevents flash)
  setBootMessage('Loading your saved data…')
  try {
    // Try cloud first — gives cross-device sync
    let saved = await cloudLoad()
    // Fall back to local IndexedDB (works offline)
    if (!saved) saved = await IDB.get('state')
    // Last resort: localStorage backup
    if (!saved) {
      const ls = safeStorageGet('studio_v2_bk') || safeStorageGet('studio_v2')
      if (ls) saved = JSON.parse(ls)
    }
    if (saved && saved.members) {
      state = migrate(saved)
      openMembers = new Set(state.members.filter(m => m.isMe).map(m => m.id))
    }
  } catch (e) {
    // Cloud unavailable (offline?) — fall back to local storage
    try {
      let saved = await IDB.get('state')
      if (!saved) {
        const ls = safeStorageGet('studio_v2_bk') || safeStorageGet('studio_v2')
        if (ls) saved = JSON.parse(ls)
      }
      if (saved && saved.members) {
        state = migrate(saved)
        openMembers = new Set(state.members.filter(m => m.isMe).map(m => m.id))
      }
    } catch (fallbackErr) {
      console.error('Startup failed:', fallbackErr)
      showStartupError('Your browser blocked the local data APIs this file uses. Try opening it in a standard browser window or serving the folder with a simple local server.')
      return
    }
  }
  render()
  hideBootMessage()
}

// ══════════════════════════════════════════════════════
//  PASSWORD PROTECTION
// ══════════════════════════════════════════════════════
const PWD_HASH = window.STUDIO_CONFIG?.PWD_HASH || '7a092f801daaa8f90ff8449431dd2509b6d0365b18e32fd82b499a6a8d60310e'
const AUTH_KEY = 'studio_auth_v2'

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

async function checkPassword() {
  const input = document.getElementById('lockInput')
  const err = document.getElementById('lockErr')
  setLockHelp('')
  setBootMessage('Verifying your password…')
  try{
    const hash = await sha256(input.value)
    if (hash === PWD_HASH) {
      safeStorageSet(AUTH_KEY, PWD_HASH)
      document.getElementById('lockScreen').style.display = 'none'
      init()
    } else {
      err.classList.remove('hidden')
      input.value = ''
      input.classList.add('lock-shake')
      setTimeout(() => { input.classList.remove('lock-shake'); input.focus() }, 400)
    }
  }catch(e){
    console.error('Password check failed:', e)
    err.classList.remove('hidden')
    err.textContent='This browser could not verify the password.'
    setLockHelp('Tip: open the file in Chrome, Safari, or Edge with normal privacy settings, or serve the folder locally.')
    setBootMessage('Password verification failed before the app could continue.',true)
  }
}

async function checkAuth() {
  initTheme()  // Apply before auth so theme is correct on lock screen too
  try{
    const stored = safeStorageGet(AUTH_KEY)
    if (stored === PWD_HASH) {
      document.getElementById('lockScreen').style.display = 'none'
      init()
    } else {
      document.getElementById('lockScreen').style.display = 'flex'
      setLockHelp(IS_FILE_PROTOCOL?'Opened as a local file. Cloud sync is disabled in this mode, but the app should still work locally.':'')
      hideBootMessage()
      setTimeout(() => document.getElementById('lockInput').focus(), 100)
    }
  }catch(e){
    console.error('Auth check failed:', e)
    document.getElementById('lockScreen').style.display = 'flex'
    setLockHelp('This browser blocked local storage, so your login state could not be read.')
    setBootMessage('This browser blocked local storage, so the app could not read your saved login state.',true)
  }
}

// ══════════════════════════════════════════════════════
//  STUDIO AI CHAT
// ══════════════════════════════════════════════════════
const CHAT_KEY_STORE = 'studio_ai_key'
const CHAT_HISTORY_KEY = 'studio_chat_history'
const CHAT_MODEL = 'claude-haiku-4-5-20251001'
let chatOpen = false
let chatBusy = false
let chatHistory = []   // [{role:'user'|'assistant', content:'...'}]

// ── Key management ─────────────────────────────────────
function getChatKey(){ return safeStorageGet(CHAT_KEY_STORE)||'' }

function saveChatHistory(){
  try{ safeStorageSet(CHAT_HISTORY_KEY, JSON.stringify(chatHistory.slice(-20))) }catch{}
}

function loadChatHistory(){
  try{
    const stored = safeStorageGet(CHAT_HISTORY_KEY)
    if(stored){
      const parsed = JSON.parse(stored)
      if(Array.isArray(parsed)) chatHistory = parsed.slice(-20)
    }
  }catch{ chatHistory=[] }
}

function saveChatKey(){
  const k = (document.getElementById('chatKeyInp')?.value||'').trim()
  const err = document.getElementById('chatKeyErr')
  if(!k.startsWith('sk-ant-')){
    if(err)err.textContent='Key should start with sk-ant-…'
    return
  }
  safeStorageSet(CHAT_KEY_STORE, k)
  if(err)err.textContent=''
  initChatUI()
}

// ── Open / Close ────────────────────────────────────────
function toggleChat(){
  chatOpen = !chatOpen
  const panel = document.getElementById('chatPanel')
  const fab   = document.getElementById('chatFab')
  const ico   = document.getElementById('chatFabIco')
  panel.classList.toggle('open', chatOpen)
  fab.classList.toggle('open', chatOpen)
  ico.textContent = chatOpen ? '✕' : '✦'
  document.getElementById('chatUnread')?.classList.remove('visible')
  if(chatOpen) initChatUI()
}

function showChatSetup(){
  document.getElementById('chatSetup').style.display  = 'flex'
  document.getElementById('chatMessages').style.display = 'none'
  document.getElementById('chatInputArea').style.display = 'none'
  setTimeout(()=>document.getElementById('chatKeyInp')?.focus(), 80)
}

function initChatUI(){
  const key = getChatKey()
  const setup  = document.getElementById('chatSetup')
  const msgs   = document.getElementById('chatMessages')
  const inp    = document.getElementById('chatInputArea')
  if(!key){
    setup.style.display = 'flex'
    msgs.style.display  = 'none'
    inp.style.display   = 'none'
  } else {
    setup.style.display = 'none'
    msgs.style.display  = 'flex'
    inp.style.display   = 'block'
    // Load persisted history on first open
    if(chatHistory.length === 0){
      loadChatHistory()
      if(chatHistory.length === 0){
        renderWelcome()
      } else {
        // Restore prior conversation bubbles
        restoreChatHistory()
      }
    }
    setTimeout(()=>document.getElementById('chatInp')?.focus(), 80)
  }
}

// ── Welcome screen ──────────────────────────────────────
function restoreChatHistory(){
  const msgs = document.getElementById('chatMessages')
  if(!msgs) return
  msgs.innerHTML = ''
  // Show a subtle "continuing previous conversation" label
  appendChatHTML(`<div style="align-self:center;font-size:11px;color:var(--tm);padding:4px 0 8px;opacity:.6">— Previous conversation —</div>`)
  chatHistory.slice(-10).forEach(msg=>{
    if(msg.role==='user'){
      appendChatHTML(`<div class="chat-msg user">
        <div class="chat-bubble">${esc(msg.content).replace(/\n/g,'<br>')}</div>
      </div>`)
    }else{
      appendChatHTML(`<div class="chat-msg ai">
        <div class="chat-bubble">${formatChatMarkdown(msg.content)}</div>
      </div>`)
    }
  })
  scrollChat()
}

function renderWelcome(){
  const activeProjs = allActiveProjects().length
  const overdue     = computeAlerts().overdue.length
  const travelCount = allTravelItems().length
  const suggestions = [
    'What projects are overdue or at risk?',
    'Give me a full status summary',
    "What's Pierre working on?",
    'Any upcoming travel I should know about?',
    'Which tasks are due this week?',
    'Draft a project status update email',
  ]
  appendChatHTML(`
    <div style="align-self:center">
      <div class="chat-ctx-pill">📊 ${activeProjs} projects · ${overdue} overdue · ${travelCount} travel items loaded</div>
    </div>
    <div class="chat-msg ai">
      <div class="chat-bubble">
        <strong>Hi! I'm your Studio AI.</strong><br>
        I have full context on all your active projects, tasks, deadlines, travel logistics, and team assignments. Ask me anything — I'll give you specific answers from your real data.
      </div>
    </div>
    <div class="chat-suggestions">
      ${suggestions.map(s=>`<button class="chat-suggestion" onclick="useSuggestion(this)">${esc(s)}</button>`).join('')}
    </div>`)
  scrollChat()
}

function useSuggestion(btn){
  const text = btn.textContent
  document.querySelectorAll('.chat-suggestions').forEach(el=>el.remove())
  const inp = document.getElementById('chatInp')
  if(inp){ inp.value = text; autoGrow(inp) }
  sendChat()
}

// ── Context builder ─────────────────────────────────────
function buildAIContext(){
  const today = todayIso()
  const lines = [
    `Today's date: ${today}`,
    ``,
    `# Studio W — Complete Project Data`,
    ``
  ]

  for(const m of state.members){
    lines.push(`## ${m.name}${m.isMe?' (app owner)':''}`)
    let hasContent = false
    for(const b of m.brands){
      const active = b.projects.filter(p=>p.status!=='archived')
      if(!active.length) continue
      hasContent = true
      lines.push(`### Brand: ${b.name}`)
      for(const p of active){
        lines.push(`#### Project: "${p.name}"`)
        if(p.summary) lines.push(`  Summary: ${p.summary}`)
        if(p.startDate||p.endDate) lines.push(`  Timeline: ${p.startDate||'?'} → ${p.endDate||'?'}`)

        // Tasks
        const tasks = p.tasks||[]
        if(tasks.length){
          lines.push(`  Tasks (${tasks.length}):`)
          for(const t of tasks){
            const prog = t.progress||'not-started'
            const isOverdue = t.dueDate && t.dueDate<today && prog!=='completed'
            let row = `    - [${prog}${isOverdue?' ⚠OVERDUE':''}] ${t.text}`
            if(t.startDate) row+=` | start:${t.startDate}`
            if(t.dueDate)   row+=` | due:${t.dueDate}`
            if(t.note)      row+=` | note: "${t.note}"`
            lines.push(row)
          }
        }

        // Meetings
        const meetings = (p.meetings||[]).filter(mt=>mt.date)
        if(meetings.length){
          lines.push(`  Meetings:`)
          for(const mt of meetings){
            lines.push(`    - ${mt.title} (${mt.date})`)
          }
        }

        // Travel
        const travel = p.travel||[]
        if(travel.length){
          lines.push(`  Travel & Logistics:`)
          for(const tr of travel){
            let row = `    - [${tr.type}] ${tr.title}`
            if(tr.startDate) row+=` | ${tr.startDate}${tr.endDate&&tr.endDate!==tr.startDate?` to ${tr.endDate}`:''}`
            if(tr.link) row+=` | ${tr.link}`
            lines.push(row)
          }
        }

        // Notes (titles + body snippet)
        const notes = p.notes||[]
        if(notes.length){
          lines.push(`  Notes (${notes.length}):`)
          for(const n of notes.slice(0,8)){
            const body = stripHtml(n.body||'').slice(0,400)
            lines.push(`    - "${n.title}" [${n.date}]${body?' — '+body:''}`)
          }
        }
        lines.push(``)
      }
    }
    if(!hasContent) lines.push(`  (no active projects)\n`)
  }

  return lines.join('\n')
}

// ── Send message ────────────────────────────────────────
async function sendChat(){
  const inp  = document.getElementById('chatInp')
  const text = (inp?.value||'').trim()
  if(!text || chatBusy) return
  const key  = getChatKey()
  if(!key){ showChatSetup(); return }

  inp.value = ''
  inp.style.height = 'auto'
  document.querySelectorAll('.chat-suggestions').forEach(el=>el.remove())

  // Show user bubble
  appendChatHTML(`<div class="chat-msg user">
    <div class="chat-bubble">${esc(text).replace(/\n/g,'<br>')}</div>
    <div class="chat-msg-time">${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
  </div>`)

  // Add to history
  chatHistory.push({role:'user', content:text})
  saveChatHistory()

  // Show typing
  const typingId = 'ct_'+Date.now()
  appendChatHTML(`<div class="chat-msg ai" id="${typingId}">
    <div class="chat-typing"><span></span><span></span><span></span></div>
  </div>`)
  scrollChat()
  setChatBusy(true)

  // Build messages array — inject context as first system message
  const context = buildAIContext()
  const systemPrompt = `You are Studio AI, an intelligent assistant embedded inside Studio W — a project management app for a fashion and product development studio.

You have COMPLETE real-time access to all project data below. Use it to give specific, accurate answers.

When answering:
- Reference actual project names, task names, people, and dates from the data
- For dates, calculate relative context (e.g. "3 days overdue", "due next Thursday") using today's date
- Be concise but complete — use bullet points for lists
- If asked to draft content (email, update, summary), do so using actual project details
- Render simple markdown: **bold**, bullet lists with -

LIVE STUDIO W DATA:
${context}`

  // Keep last 20 turns for context window efficiency
  const msgs = chatHistory.slice(-20)

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: msgs,
        stream: true,
      }),
    })

    if(!resp.ok){
      const errText = await resp.text()
      let msg = `API error ${resp.status}`
      try{ const j=JSON.parse(errText); msg=j.error?.message||msg }catch{}
      if(resp.status===401) msg='Invalid API key — click ⚙ to update it.'
      removeChatEl(typingId)
      appendErrorBubble(msg)
      setChatBusy(false)
      return
    }

    // Stream the response
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let aiText = ''
    let buffer = ''

    // Replace typing indicator with empty AI bubble
    removeChatEl(typingId)
    const aiMsgId = 'ca_'+Date.now()
    appendChatHTML(`<div class="chat-msg ai" id="${aiMsgId}">
      <div class="chat-bubble" id="${aiMsgId}_b"></div>
      <div class="chat-msg-time">${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
    </div>`)
    const bubbleEl = document.getElementById(aiMsgId+'_b')

    while(true){
      const {done, value} = await reader.read()
      if(done) break
      buffer += decoder.decode(value, {stream:true})
      const lines = buffer.split('\n')
      buffer = lines.pop()||''
      for(const line of lines){
        if(!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if(data==='[DONE]') continue
        try{
          const evt = JSON.parse(data)
          if(evt.type==='content_block_delta'&&evt.delta?.type==='text_delta'){
            aiText += evt.delta.text
            if(bubbleEl) bubbleEl.innerHTML = formatChatMarkdown(aiText)
            scrollChat()
          }
        }catch{}
      }
    }

    // Final render & save to history
    if(bubbleEl) bubbleEl.innerHTML = formatChatMarkdown(aiText)
    chatHistory.push({role:'assistant', content:aiText})
    saveChatHistory()
    scrollChat()

  } catch(e){
    removeChatEl(typingId)
    appendErrorBubble('Network error — check your connection and try again.')
    console.error('Chat error:', e)
  }

  setChatBusy(false)
}

// ── Markdown formatter (lightweight) ───────────────────
function formatChatMarkdown(text){
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g,'')
    .replace(/\n\n/g,'<br><br>')
    .replace(/\n/g,'<br>')
}

// ── UI helpers ──────────────────────────────────────────
function appendChatHTML(html){
  const el = document.getElementById('chatMessages')
  if(!el) return
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  while(tmp.firstChild) el.appendChild(tmp.firstChild)
}

function removeChatEl(id){
  document.getElementById(id)?.remove()
}

function appendErrorBubble(msg){
  appendChatHTML(`<div class="chat-msg ai">
    <div class="chat-bubble" style="border-color:var(--red);color:var(--red)">⚠ ${esc(msg)}</div>
  </div>`)
  scrollChat()
}

function scrollChat(){
  const el = document.getElementById('chatMessages')
  if(el) el.scrollTop = el.scrollHeight
}

function setChatBusy(busy){
  chatBusy = busy
  const btn    = document.getElementById('chatSendBtn')
  const status = document.getElementById('chatStatus')
  const inp    = document.getElementById('chatInp')
  if(btn)    btn.disabled = busy
  if(inp)    inp.disabled = busy
  if(status) status.classList.toggle('thinking', busy)
}

function onChatKey(e){
  if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat() }
}

// ══════════════════════════════════════════════════════
//  THEME SYSTEM
// ══════════════════════════════════════════════════════
function applyTheme(mode){
  themeMode=mode
  safeStorageSet('studio_theme',mode)
  const root=document.documentElement
  const sysDark=window.matchMedia('(prefers-color-scheme: dark)').matches
  root.removeAttribute('data-theme')
  root.classList.remove('sys-dark')
  if(mode==='light'){
    root.setAttribute('data-theme','light')
  } else if(mode==='dark'){
    root.setAttribute('data-theme','dark')
  } else {
    root.setAttribute('data-theme','system')
    if(sysDark)root.classList.add('sys-dark')
  }
  // Sync toggle button states
  document.querySelectorAll('.theme-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.theme===mode)
  })
}

function initTheme(){
  const stored=safeStorageGet('studio_theme')||'light'
  themeMode=stored
  // Apply immediately (before render so no flash)
  const root=document.documentElement
  const sysDark=window.matchMedia('(prefers-color-scheme: dark)').matches
  root.removeAttribute('data-theme')
  root.classList.remove('sys-dark')
  if(stored==='dark'){
    root.setAttribute('data-theme','dark')
  } else if(stored==='system'){
    root.setAttribute('data-theme','system')
    if(sysDark)root.classList.add('sys-dark')
  } else {
    root.setAttribute('data-theme','light')
  }
  // Listen for OS-level theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{
    if(themeMode==='system')applyTheme('system')
  })
}

// ══════════════════════════════════════════════════════
//  QUICK CAPTURE — SCRATCHPAD
// ══════════════════════════════════════════════════════
function onScratchInput(el){
  state.scratchpad=el.value
  autoGrow(el)
  const actions=document.getElementById('scratchpadActions')
  if(actions){
    if(el.value.trim())actions.classList.add('visible')
    else actions.classList.remove('visible')
  }
}

function onScratchPersonChange(memberId){
  updateScratchProjects(memberId)
}

function updateScratchProjects(memberId){
  const projSel=document.getElementById('scratchProjSel')
  if(!projSel)return
  const member=state.members.find(m=>m.id===memberId)
  if(!member){projSel.innerHTML='<option value="">— no projects —</option>';return}
  const projs=member.brands.flatMap(b=>b.projects.filter(p=>p.status!=='archived'))
  projSel.innerHTML=projs.length
    ? projs.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
    : '<option value="">— no projects —</option>'
}

function addScratchProject(){
  const personSel=document.getElementById('scratchPersonSel')
  const memberId=personSel?.value
  if(!memberId)return
  const member=state.members.find(m=>m.id===memberId)
  if(!member)return
  showPromptModal('New project name','e.g. Spring 2027 Collection',(name)=>{
    let brand=member.brands[0]
    if(!brand){
      brand=mkBrand(member.isMe?'My Projects':'Projects',[])
      member.brands.push(brand)
      openBrands.add(brand.id)
    }
    const p=mkProject(name)
    brand.projects.push(p)
    openMembers.add(member.id)
    openBrands.add(brand.id)
    save()
    renderSidebar()
    updateScratchProjects(memberId)
    const projSel=document.getElementById('scratchProjSel')
    if(projSel){for(const opt of projSel.options){if(opt.value===p.id){opt.selected=true;break}}}
  })
}

function fileNote(){
  const text=(state.scratchpad||'').trim()
  if(!text){showNotice('Write something first!');return}
  const projSel=document.getElementById('scratchProjSel')
  const projId=projSel?.value
  if(!projId){showNotice('Please select a project to file this note to.');return}
  const found=findProject(projId)
  if(!found)return
  const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  const timestamp=new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
  found.p.notes.unshift({
    id:uid(),
    title:`Quick Note — ${timestamp}`,
    body:`<p>${text.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</p>`,
    date,
    open:false
  })
  state.scratchpad=''
  save()
  // Clear the UI
  const ta=document.getElementById('scratchpadTa')
  if(ta){ta.value='';ta.style.height='auto'}
  const actions=document.getElementById('scratchpadActions')
  if(actions)actions.classList.remove('visible')
  const msg=document.getElementById('scratchMsg')
  if(msg){
    msg.textContent=`✓ Filed to "${found.p.name}"`
    setTimeout(()=>{if(msg)msg.textContent=''},3000)
  }
}

// ══════════════════════════════════════════════════════
//  TASK MICRO-NOTES
// ══════════════════════════════════════════════════════
function toggleTaskNote(tid){
  const wrap=document.getElementById('tmn_'+tid)
  if(!wrap)return
  const isVisible=wrap.style.display!=='none'
  wrap.style.display=isVisible?'none':'block'
  if(!isVisible){
    const ta=wrap.querySelector('.task-micronote-ta')
    if(ta){autoGrow(ta);ta.focus()}
  }
}

function updateTaskNote(tid,v){
  const f=sel();if(!f)return
  const t=f.p.tasks.find(t=>t.id===tid)
  if(!t)return
  t.note=v
  save()
  // Update the button icon without re-render
  const btn=document.querySelector(`.task-item[data-tid="${tid}"] .task-note-btn`)
  if(btn){
    const hasNote=!!(v||'').trim()
    btn.textContent=hasNote?'📝':'💬'
    btn.classList.toggle('has-note',hasNote)
    btn.title=hasNote?'View/edit task note':'Add a note to this task'
  }
}

// ══════════════════════════════════════════════════════
//  SORT BY DUE DATE
// ══════════════════════════════════════════════════════
function sortedTaskList(tasks){
  if(!sortByDue)return tasks
  return [...tasks].sort((a,b)=>{
    const da=a.dueDate||'9999-99-99'
    const db=b.dueDate||'9999-99-99'
    return da.localeCompare(db)
  })
}

function toggleSortByDue(){
  sortByDue=!sortByDue
  renderMain()
}

// ══════════════════════════════════════════════════════
//  TRAVEL HELPERS
// ══════════════════════════════════════════════════════
function setCalTravelFilter(){
  calTravelFilter=!calTravelFilter
  // When filtering to travel only, disable the tasks/meetings filter
  if(calTravelFilter)calFilter='all'
  renderMain()
}

function setDashTravelFilter(){
  // Navigate to the all calendar and toggle travel view
  showView('allcal')
  calTravelFilter=true
  renderMain()
}

// Collect all travel items across all active projects, sorted by date
function allTravelItems(){
  const result=[]
  for(const m of state.members)for(const b of m.brands)for(const p of b.projects){
    if(p.status==='archived')continue
    for(const tr of p.travel||[])result.push({tr,p,b,m})
  }
  return result.sort((a,b)=>{
    const da=a.tr.startDate||a.tr.endDate||'9999'
    const db=b.tr.startDate||b.tr.endDate||'9999'
    return da.localeCompare(db)
  })
}

window.addEventListener('error',e=>{
  console.error('Unhandled error:', e.error || e.message)
  setBootMessage(`A script error stopped startup.<br><strong>${esc((e.error&&e.error.message)||e.message||'Unknown error')}</strong>`,true)
})

window.addEventListener('unhandledrejection',e=>{
  const msg=e.reason&&e.reason.message?e.reason.message:String(e.reason||'Unknown promise rejection')
  console.error('Unhandled rejection:', e.reason)
  setBootMessage(`A startup request failed.<br><strong>${esc(msg)}</strong>`,true)
})

checkAuth()
