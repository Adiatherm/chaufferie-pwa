'use strict';
// ═══════════════════════════════════════════════════════════════
//  ADIATOOL v4
// ═══════════════════════════════════════════════════════════════

// ── DB ───────────────────────────────────────────────────────────
const DB_NAME='AdiatoolDB',DB_VER=4;
let db;
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      ['sites','missions','equipments','formdata','notes','photoreport','incidentdata','config','users'].forEach(s=>{
        if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'});
      });
    };
    r.onsuccess=e=>res(e.target.result);r.onerror=e=>rej(e.target.error);
  });
}
const txs=(s,m='readonly')=>db.transaction(s,m).objectStore(s);
const dbGet=(s,k)=>new Promise((r,j)=>{const q=txs(s).get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
const dbGetAll=s=>new Promise((r,j)=>{const q=txs(s).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
const dbPut=(s,v)=>new Promise((r,j)=>{const q=txs(s,'readwrite').put(v);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
const dbDel=(s,k)=>new Promise((r,j)=>{const q=txs(s,'readwrite').delete(k);q.onsuccess=()=>r();q.onerror=()=>j(q.error);});

// ── STATE ─────────────────────────────────────────────────────────
let sites=[],missions=[],equipments=[],formDataStore=[],categories=[],users=[],currentUser=null,geminiKey='';
let currentSiteId=null,currentMissionId=null;
const collapseState=new Map(); // blockId -> bool (true=collapsed)
let editingSiteId=null,editingMissionId=null,editingEqId=null,editingEqContext=null;
let capturedImage=null,attachedPhoto=null,cameraStream=null,notesSaveTimer=null;
let currentLocalType='',currentEnergie='';

const DEFAULT_CATEGORIES=[
  {id:'chaudiere',name:'Chaudière',color:'#f97316'},{id:'bruleur',name:'Brûleur',color:'#ef4444'},
  {id:'pompe',name:'Pompe / Circulateur',color:'#3b82f6'},{id:'vanne',name:'Vanne / Régulation',color:'#a855f7'},
  {id:'echangeur',name:'Échangeur',color:'#22d3ee'},{id:'ballon',name:'Ballon ECS',color:'#10b981'},
  {id:'electrique',name:'Équipement élec.',color:'#eab308'},{id:'autre',name:'Autre',color:'#6b7280'},
];
const SL={en_cours:'En cours',termine:'Terminée',planifie:'Planifiée'};
const TL={audit:"Mission d'audit",intervention:'Intervention ponctuelle',etude_moe:"Mission d'étude & MOE",controle:"Contrôle d'exploitation",incident:"Rapport d'incident"};
const CL={bon:'Bon état',correct:'Correct',degrade:'Dégradé',hs:'Hors service'};

// ── INIT ──────────────────────────────────────────────────────────
async function init(){
  db=await openDB();
  const catCfg=await dbGet('config','categories');categories=catCfg?catCfg.value:[...DEFAULT_CATEGORIES];
  const keyCfg=await dbGet('config','geminiKey');geminiKey=keyCfg?keyCfg.value:'';
  const curCfg=await dbGet('config','currentUser');currentUser=curCfg?curCfg.value:null;
  [sites,missions,equipments,formDataStore,users]=await Promise.all([
    dbGetAll('sites'),dbGetAll('missions'),dbGetAll('equipments'),dbGetAll('formdata'),dbGetAll('users')
  ]);
  setupEvents();updateNet();
  window.addEventListener('online',updateNet);window.addEventListener('offline',updateNet);
  await sleep(1900);
  document.getElementById('splash').classList.add('fade-out');
  await sleep(500);
  document.getElementById('splash').style.display='none';
  document.getElementById('app').classList.remove('hidden');
  // If no user selected, prompt selection first
  if(!currentUser&&users.length>0)showView('users');
  else showView('dashboard');
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function updateNet(){document.getElementById('net-dot').classList.toggle('offline',!navigator.onLine);}

// ── VIEWS ─────────────────────────────────────────────────────────
function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const vEl=document.getElementById('view-'+name);
  if(vEl)vEl.classList.add('active');
  const backBtn=document.getElementById('btn-back');
  const expBtn=document.getElementById('btn-header-export');
  backBtn.classList.add('hidden');expBtn.style.display='none';
  document.getElementById('btn-settings-nav').style.display='';
  const title=document.getElementById('header-title');
  const sub=document.getElementById('header-sub');
  if(name==='dashboard'){title.innerHTML='ADIA<span>TOOL</span>';sub.textContent='Tableau de bord';}
  else if(name==='users'){title.innerHTML='ADIA<span>TOOL</span>';sub.textContent='Choisir un utilisateur';backBtn.classList.remove('hidden');document.getElementById('btn-settings-nav').style.display='none';renderUsersView();}
  else if(name==='site'){
    const s=sites.find(x=>x.id===currentSiteId);
    title.innerHTML=esc(s?.name||'Site');sub.textContent=[s?.codeAffaire,s?.city].filter(Boolean).join(' · ');
    backBtn.classList.remove('hidden');document.getElementById('btn-settings-nav').style.display='none';renderSiteView();
  }else if(name==='mission'){
    const m=missions.find(x=>x.id===currentMissionId);
    const s=sites.find(x=>x.id===m?.siteId);
    title.innerHTML=esc(TL[m?.type]||m?.type||'Mission');sub.textContent=s?.name||'';
    backBtn.classList.remove('hidden');expBtn.style.display='';expBtn.onclick=()=>switchMTab('report');
    document.getElementById('btn-settings-nav').style.display='none';
    renderMissionView();
  }else if(name==='settings'){
    title.innerHTML='ADIA<span>TOOL</span>';sub.textContent='Paramètres';
    backBtn.classList.remove('hidden');document.getElementById('btn-settings-nav').style.display='none';renderSettings();
  }
}

function switchMTab(name){
  document.querySelectorAll('[data-mtab]').forEach(b=>b.classList.toggle('active',b.dataset.mtab===name));
  document.querySelectorAll('[id^="mtab-"]').forEach(c=>c.classList.toggle('active',c.id==='mtab-'+name));
  if(name==='forms')renderFormsZone();
  if(name==='notes')loadNotes();
  if(name==='photos')renderPhotoRows();
  if(name==='incident')loadIncidentData();
  if(name==='participants')renderParticipants();
  if(name==='synthesis')renderSynthesis();
  if(name!=='scan'&&name!=='forms')stopCamera();
}

// ── EVENTS ────────────────────────────────────────────────────────
function setupEvents(){
  document.querySelectorAll('[data-dtab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('[data-dtab]').forEach(b=>b.classList.toggle('active',b===btn));
      document.querySelectorAll('[id^="dtab-"]').forEach(c=>c.classList.toggle('active',c.id==='dtab-'+btn.dataset.dtab));
      if(btn.dataset.dtab==='missions')renderAllMissions();
    });
  });
  document.querySelectorAll('[data-stab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('[data-stab]').forEach(b=>b.classList.toggle('active',b===btn));
      document.querySelectorAll('[id^="stab-"]').forEach(c=>c.classList.toggle('active',c.id==='stab-'+btn.dataset.stab));
    });
  });
  document.querySelectorAll('[data-mtab]').forEach(btn=>{btn.addEventListener('click',()=>switchMTab(btn.dataset.mtab));});
  document.getElementById('btn-back').addEventListener('click',()=>{
    const av=document.querySelector('.view.active');
    if(av?.id==='view-mission')showView('site');
    else if(av?.id==='view-site')showView('dashboard');
    else if(av?.id==='view-settings')showView('dashboard');
    else if(av?.id==='view-users')showView('dashboard');
    stopCamera();
  });
  document.getElementById('btn-settings-nav').addEventListener('click',()=>showView('settings'));
  document.getElementById('site-search').addEventListener('input',e=>renderSites(e.target.value));
  document.getElementById('mission-search-all').addEventListener('input',renderAllMissions);
  document.getElementById('mission-filter-status').addEventListener('change',renderAllMissions);
  document.getElementById('eq-search')?.addEventListener('input',()=>renderSynthesis());
  document.getElementById('eq-filter-cat')?.addEventListener('change',()=>renderSynthesis());
  document.getElementById('btn-add-site').addEventListener('click',()=>openSiteModal());
  document.getElementById('btn-add-mission').addEventListener('click',()=>openMissionModal());
  document.querySelectorAll('.modal-close,[data-modal]').forEach(btn=>{
    btn.addEventListener('click',()=>{const id=btn.dataset.modal||btn.closest('.modal')?.id;if(id)document.getElementById(id).classList.add('hidden');});
  });
  document.querySelectorAll('.modal-backdrop').forEach(bd=>{bd.addEventListener('click',()=>bd.closest('.modal').classList.add('hidden'));});
  document.getElementById('btn-save-site').addEventListener('click',saveSite);
  document.getElementById('btn-save-mission').addEventListener('click',saveMission);
  document.getElementById('btn-save-equipment').addEventListener('click',saveEquipment);
  document.getElementById('btn-add-photo-row').addEventListener('click',addPhotoRow);
  document.getElementById('btn-add-local').addEventListener('click',async()=>{
    const fdd=getMFD();if(!fdd.locaux)fdd.locaux=[];fdd.locaux.push({type:'Chaufferie',nom:''});await saveMFD(fdd);renderFormsZone();
  });
  document.getElementById('btn-add-participant')?.addEventListener('click',addParticipant);
  document.getElementById('notes-textarea').addEventListener('input',()=>{
    if(notesSaveTimer)clearTimeout(notesSaveTimer);
    document.getElementById('notes-saved').textContent='';
    notesSaveTimer=setTimeout(saveNotes,1000);
  });
  document.getElementById('btn-export-pdf').addEventListener('click',exportPDF);
  document.getElementById('btn-export-excel').addEventListener('click',exportExcel);
  document.getElementById('btn-export-word')?.addEventListener('click',exportWord);
  document.getElementById('btn-export-csv').addEventListener('click',exportCSV);
  document.getElementById('btn-export-incident-pdf')?.addEventListener('click',exportIncidentPDF);
  document.getElementById('btn-add-incident-field')?.addEventListener('click',addIncidentField);
  document.getElementById('btn-save-gemini').addEventListener('click',saveGeminiKey);
  document.getElementById('btn-add-cat').addEventListener('click',addCategory);
  document.getElementById('new-cat-input').addEventListener('keydown',e=>{if(e.key==='Enter')addCategory();});
  document.getElementById('btn-clear-all').addEventListener('click',clearAll);
  document.getElementById('btn-backup').addEventListener('click',backupData);
  document.getElementById('btn-restore-btn').addEventListener('click',()=>document.getElementById('restore-input').click());
  document.getElementById('restore-input').addEventListener('change',e=>{if(e.target.files[0])restoreData(e.target.files[0]);e.target.value='';});
  renderSites();renderCatFilter();
}

// ── USERS ─────────────────────────────────────────────────────────
function renderUsersView(){
  const vEl=document.getElementById('view-settings');
  // Render users in settings panel top section — or in a dedicated view
  // We'll use the settings view's container but show users first
  const container=document.getElementById('view-users');
  if(!container)return;
  container.innerHTML=`<div class="users-panel"><h2 style="font-family:var(--font-display);font-size:18px;font-weight:700;padding:0 0 12px">Qui êtes-vous ?</h2>${users.length===0?'<p style="color:var(--text-secondary);font-size:13px">Aucun utilisateur — créez-en un dans Paramètres.</p>':''}${users.map(u=>`<div class="user-card${currentUser?.id===u.id?' active-user':''}" data-uid="${u.id}"><div class="user-avatar">${(u.prenom||u.nom||'?')[0].toUpperCase()}</div><div class="user-info"><div class="user-name">${esc(u.prenom+' '+u.nom)}</div><div class="user-email">${esc(u.email||'')}</div></div>${currentUser?.id===u.id?'<span style="color:var(--accent);font-size:18px">✓</span>':''}</div>`).join('')}</div>`;
  container.querySelectorAll('[data-uid]').forEach(card=>{
    card.addEventListener('click',async()=>{
      const u=users.find(x=>x.id===card.dataset.uid);
      currentUser=u;await dbPut('config',{key:'currentUser',value:u});
      showView('dashboard');showToast(`Connecté en tant que ${u.prenom} ${u.nom}`,'success');
    });
  });
}

// ── DASHBOARD ────────────────────────────────────────────────────
function renderSites(search=''){
  const list=document.getElementById('sites-list');
  const f=sites.filter(s=>!search||(s.name||'').toLowerCase().includes(search.toLowerCase())||(s.city||'').toLowerCase().includes(search.toLowerCase())||(s.codeAffaire||'').toLowerCase().includes(search.toLowerCase()));
  if(!f.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">🏢</div><p>${sites.length===0?'Aucun site.<br>Appuyez sur + pour commencer.':'Aucun résultat.'}</p></div>`;return;}
  list.innerHTML='';
  f.sort((a,b)=>a.name.localeCompare(b.name)).forEach(site=>{
    const sm=missions.filter(m=>m.siteId===site.id);
    const card=document.createElement('div');card.className='site-card';
    card.innerHTML=`<div class="card-header"><div><div class="card-title">${esc(site.name)}</div><div class="card-sub">${[site.codeAffaire,site.address,site.city].filter(Boolean).join(' · ')}</div></div><div class="card-actions"><button class="card-btn" data-id="${site.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${site.id}" data-action="delete">🗑️</button></div></div><div class="card-stats"><span class="cstat"><span>${sm.length}</span> mission${sm.length!==1?'s':''}</span>${site.energie?`<span class="cstat">${esc(site.energie)}</span>`:''}</div>`;
    card.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn){currentSiteId=site.id;showView('site');return;}if(btn.dataset.action==='edit')openSiteModal(site.id);else deleteSite(site.id);});
    list.appendChild(card);
  });
}
function renderAllMissions(){
  const search=document.getElementById('mission-search-all').value.toLowerCase();
  const sf=document.getElementById('mission-filter-status').value;
  const list=document.getElementById('all-missions-list');
  let f=missions.filter(m=>{const s=sites.find(x=>x.id===m.siteId);return(!search||(TL[m.type]||'').toLowerCase().includes(search)||(s?.name||'').toLowerCase().includes(search))&&(!sf||m.status===sf);});
  f.sort((a,b)=>(b.dateStart||'').localeCompare(a.dateStart||''));
  if(!f.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><p>Aucune mission.</p></div>`;return;}
  list.innerHTML='';f.forEach(m=>renderMissionCard(m,list,true));
}
function renderMissionCard(m,container,showSite=false){
  const site=sites.find(s=>s.id===m.siteId);
  const eqc=equipments.filter(e=>e.missionId===m.id).length;
  const isIncident=m.type==='incident';
  const card=document.createElement('div');card.className=`mission-card status-${m.status||'planifie'}`;
  if(isIncident)card.style.borderColor='rgba(239,68,68,.4)';
  card.innerHTML=`<div class="card-header"><div style="flex:1"><div class="card-title">${isIncident?'🚨 ':''} ${esc(TL[m.type]||m.type)}</div><div style="display:flex;gap:5px;flex-wrap:wrap;margin:4px 0"><span class="badge s-${m.status||'planifie'}">${SL[m.status]||m.status}</span>${m.ref?`<span class="badge">${esc(m.ref)}</span>`:''}</div>${showSite&&site?`<div class="card-sub">🏢 ${esc(site.name)}</div>`:''}<div class="card-sub">${m.dateStart||''}</div></div><div class="card-actions"><button class="card-btn" data-id="${m.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${m.id}" data-action="delete">🗑️</button></div></div>`;
  card.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn){currentMissionId=m.id;currentSiteId=m.siteId;showView('mission');return;}if(btn.dataset.action==='edit')openMissionModal(m.id);else deleteMission(m.id);});
  container.appendChild(card);
}

// ── SITE VIEW ─────────────────────────────────────────────────────
function renderSiteView(){
  document.querySelectorAll('[data-stab]').forEach(b=>b.classList.toggle('active',b.dataset.stab==='missions'));
  document.querySelectorAll('[id^="stab-"]').forEach(c=>c.classList.toggle('active',c.id==='stab-missions'));
  const list=document.getElementById('site-missions-list');list.innerHTML='';
  const sm=missions.filter(m=>m.siteId===currentSiteId).sort((a,b)=>(b.dateStart||'').localeCompare(a.dateStart||''));
  if(!sm.length)list.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><p>Aucune mission.</p></div>`;
  else sm.forEach(m=>renderMissionCard(m,list));
  const site=sites.find(s=>s.id===currentSiteId);
  const panel=document.getElementById('site-info-panel');panel.innerHTML='';
  if(site){
    [['Code affaire',site.codeAffaire],['Nom',site.name],['Adresse',[site.address,site.zip,site.city].filter(Boolean).join(', ')],['Période',site.anneeExacte?String(site.anneeExacte):site.periode],['Bâtiments',site.batiments],['Niveaux',site.niveaux],['Logements',site.logements],['Hauteur stat.',site.hauteur?site.hauteur+' m':null],['Emplacement',site.emplacement],['Énergie',site.energie],['Contact',site.contact]].filter(([,v])=>v).forEach(([l,v])=>{const d=document.createElement('div');d.className='info-row';d.innerHTML=`<div class="info-label">${l}</div><div class="info-value">${esc(String(v))}</div>`;panel.appendChild(d);});
    const btn=document.createElement('button');btn.className='btn-secondary';btn.textContent='✏️ Modifier ce site';btn.addEventListener('click',()=>openSiteModal(currentSiteId));panel.appendChild(btn);
  }
}

// ── MISSION VIEW ──────────────────────────────────────────────────
function renderMissionView(){
  const m=missions.find(x=>x.id===currentMissionId);
  const isIncident=m?.type==='incident';
  const incidentBtn=document.getElementById('tab-incident-btn');
  if(incidentBtn)incidentBtn.style.display=isIncident?'':'none';
  switchMTab('participants');
}

// ── PARTICIPANTS ──────────────────────────────────────────────────
async function renderParticipants(){
  const m=missions.find(x=>x.id===currentMissionId);
  const list=document.getElementById('participants-list');
  if(!list)return;
  const participants=m?.participants||[];
  list.innerHTML='';
  participants.forEach((p,pi)=>{
    const card=document.createElement('div');card.className='participant-card';
    card.innerHTML=`<div class="participant-card-header"><span class="participant-num">Personne ${pi+1}</span><button class="btn-del-comment" data-pi="${pi}">✕</button></div><div style="display:flex;flex-direction:column;gap:6px"><input type="text" placeholder="Nom / Prénom" value="${esc(p.nom||'')}" data-k="nom" class="part-inp" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/><input type="text" placeholder="Société" value="${esc(p.societe||'')}" data-k="societe" class="part-inp" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/><input type="text" placeholder="Email" value="${esc(p.email||'')}" data-k="email" class="part-inp" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/><input type="text" placeholder="Téléphone" value="${esc(p.tel||'')}" data-k="tel" class="part-inp" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/></div>`;
    card.querySelector('.btn-del-comment').addEventListener('click',async()=>{
      const mi=missions.findIndex(x=>x.id===currentMissionId);if(mi<0)return;
      missions[mi].participants.splice(pi,1);await dbPut('missions',missions[mi]);renderParticipants();
    });
    card.querySelectorAll('.part-inp').forEach(inp=>{
      inp.addEventListener('change',async()=>{
        const mi=missions.findIndex(x=>x.id===currentMissionId);if(mi<0)return;
        if(!missions[mi].participants)missions[mi].participants=[];
        if(!missions[mi].participants[pi])missions[mi].participants[pi]={};
        missions[mi].participants[pi][inp.dataset.k]=inp.value;
        await dbPut('missions',missions[mi]);
      });
    });
    list.appendChild(card);
  });
}

async function addParticipant(){
  const mi=missions.findIndex(x=>x.id===currentMissionId);if(mi<0)return;
  if(!missions[mi].participants)missions[mi].participants=[];
  missions[mi].participants.push({nom:'',societe:'',email:'',tel:''});
  await dbPut('missions',missions[mi]);renderParticipants();
}

// ── SYNTHESIS (matériels par module) ─────────────────────────────
function renderSynthesis(){
  const search=(document.getElementById('eq-search')?.value||'').toLowerCase();
  const list=document.getElementById('mission-eq-list');
  if(!list)return;
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId);
  if(!mEqs.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">🔧</div><p>Aucun matériel enregistré.<br>Ajoutez des équipements depuis les modules Relevés.</p></div>`;return;}

  // Group by BASE moduleId (without index suffix)
  const groups={};
  mEqs.forEach(eq=>{
    const g=(eq.moduleId||'__global').replace(/_\d+$/,'');
    if(!groups[g])groups[g]=[];
    groups[g].push(eq);
  });

  const moduleOrder=['primaire','chauffage','ecs','autres_materiels'];
  list.innerHTML='';

  const CL2={bon:'✅ Bon état',correct:'🔵 Correct',degrade:'⚠️ Dégradé',hs:'❌ Hors service'};

  const renderEqCard=(eq,container)=>{
    const cat=categories.find(c=>c.id===eq.category)||{name:eq.category||'—',color:'#6b7280'};
    const card=document.createElement('div');card.className='eq-card';card.style.setProperty('--cat-color',cat.color);
    const meta=[eq.brand,eq.model,eq.year?`(${eq.year})`:''].filter(Boolean).join(' ');
    const details=[
      eq.power?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--accent2)">${esc(eq.power)}</span>`:'',
      eq.fluid?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">${esc(eq.fluid)}</span>`:'',
      eq.serial?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">SN:${esc(eq.serial)}</span>`:'',
    ].filter(Boolean).join(' ');
    card.innerHTML=`
      <div class="card-header">
        <span class="badge" style="color:${cat.color};border-color:${cat.color}40">${esc(cat.name.toUpperCase())}</span>
        <div class="card-actions">
          <button class="card-btn" data-id="${eq.id}" data-action="edit">✏️</button>
          <button class="card-btn" data-id="${eq.id}" data-action="delete">🗑️</button>
        </div>
      </div>
      <div class="card-title" style="margin-bottom:2px">${esc(eq.name||'—')}</div>
      ${meta?`<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);margin-bottom:3px">${esc(meta)}</div>`:''}
      ${details?`<div style="display:flex;gap:6px;flex-wrap:wrap">${details}</div>`:''}
      ${eq.condition?`<div style="font-family:var(--font-mono);font-size:10px;margin-top:4px">${CL2[eq.condition]||eq.condition}</div>`:''}
      ${eq.notes?`<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;font-style:italic">${esc(eq.notes.slice(0,80))}${eq.notes.length>80?'…':''}</div>`:''}`;
    card.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn){openEqModal(eq.id);return;}if(btn.dataset.action==='edit')openEqModal(eq.id);else deleteEquipment(eq.id);});
    container.appendChild(card);
  };

  moduleOrder.forEach(modId=>{
    const grpEqs=(groups[modId]||[]).filter(eq=>!search||(eq.name||'').toLowerCase().includes(search)||(eq.brand||'').toLowerCase().includes(search)||(eq.model||'').toLowerCase().includes(search));
    if(!grpEqs.length)return;
    const mod=FORM_MODULES.find(m=>m.id===modId);
    const sec=document.createElement('div');
    sec.innerHTML=`<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:1.5px;color:${mod?.color||'var(--accent)'};text-transform:uppercase;padding:8px 0 4px;border-bottom:1px solid var(--border);margin-bottom:6px">${mod?.icon||''} ${mod?.label||modId} <span style="color:var(--text-muted)">(${grpEqs.length})</span></div>`;
    list.appendChild(sec);
    grpEqs.forEach(eq=>renderEqCard(eq,list));
  });

  // Others (no module or unknown)
  const otherEqs=(groups['__global']||[]).filter(eq=>!search||(eq.name||'').toLowerCase().includes(search));
  if(otherEqs.length){
    const sec=document.createElement('div');
    sec.innerHTML=`<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:1.5px;color:var(--text-muted);text-transform:uppercase;padding:8px 0 4px;border-bottom:1px solid var(--border);margin-bottom:6px">Autres matériels</div>`;
    list.appendChild(sec);
    otherEqs.forEach(eq=>renderEqCard(eq,list));
  }
}
function renderCatFilter(){
  const sel=document.getElementById('eq-filter-cat');if(!sel)return;
  sel.innerHTML='<option value="">Tous modules</option>';
  FORM_MODULES.filter(m=>m.hasEquipment).forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.label;sel.appendChild(o);});
}

// ── FORMS ENGINE ──────────────────────────────────────────────────
function getMFD(){return formDataStore.find(f=>f.id===currentMissionId)||{id:currentMissionId,locaux:[],localModules:{},localData:{},activeLocalIdx:0};}
async function saveMFD(fd){
  await dbPut('formdata',fd);
  const idx=formDataStore.findIndex(f=>f.id===currentMissionId);
  if(idx>=0)formDataStore[idx]=fd;else formDataStore.push(fd);
}

function renderFormsZone(){
  const fd=getMFD();
  const locaux=fd.locaux||[];
  renderLocauxSetup(locaux,fd);
  const tabsBar=document.getElementById('local-tabs-bar');
  const modulesSel=document.getElementById('modules-selector');
  const formsContainer=document.getElementById('active-forms-container');
  formsContainer.innerHTML='';
  if(!locaux.length){tabsBar.style.display='none';modulesSel.style.display='none';return;}
  tabsBar.style.display='';modulesSel.style.display='';
  const activeLocal=fd.activeLocalIdx||0;
  // Tabs
  tabsBar.innerHTML='';
  locaux.forEach((loc,i)=>{
    const t=document.createElement('button');
    t.className='local-tab'+(i===activeLocal?' local-tab-active':'');
    t.textContent=loc.nom||loc.type||`Local ${i+1}`;
    t.addEventListener('click',async()=>{const fdd=getMFD();fdd.activeLocalIdx=i;await saveMFD(fdd);renderFormsZone();});
    tabsBar.appendChild(t);
  });
  // Module toggles
  const localKey=`local_${activeLocal}`;
  const activeModules=fd.localModules?.[localKey]||[];
  const site=sites.find(s=>s.id===currentSiteId);
  const energie=site?.energie||'';currentEnergie=energie;
  modulesSel.innerHTML='<h3 style="font-family:var(--font-display);font-size:14px;font-weight:600;margin-bottom:10px;color:var(--text-secondary)">Modules pour ce local</h3><div class="module-toggles" id="module-toggles"></div>';
  const grid=document.getElementById('module-toggles');
  FORM_MODULES.forEach(mod=>{
    const isActive=activeModules.includes(mod.id);
    const btn=document.createElement('div');btn.className='module-toggle'+(isActive?' active':'');
    btn.innerHTML=`<span class="module-toggle-icon">${mod.icon}</span><span class="module-toggle-label" style="color:${mod.color}">${mod.label}</span><div class="mt-check"></div>`;
    btn.addEventListener('click',async()=>{
      const fdd=getMFD();if(!fdd.localModules)fdd.localModules={};
      const mods=[...(fdd.localModules[localKey]||[])];
      const idx=mods.indexOf(mod.id);if(idx>=0)mods.splice(idx,1);else mods.push(mod.id);
      fdd.localModules[localKey]=mods;
      await saveMFD(fdd);renderFormsZone();
    });
    grid.appendChild(btn);
  });
  // Render modules - use saved data, don't re-create from scratch
  const localDataEntry=(fd.localData||{})[localKey]||{data:{},repeatData:{},comments:{},cahierYears:{}};
  const localFd={id:fd.id,activeModules,data:localDataEntry.data||{},repeatData:localDataEntry.repeatData||{},comments:localDataEntry.comments||{},cahierYears:localDataEntry.cahierYears||{}};
  const localSave=async(fdd)=>{
    const mainFdd=getMFD();
    if(!mainFdd.localData)mainFdd.localData={};
    const existing=mainFdd.localData[localKey]||{data:{},repeatData:{},comments:{},cahierYears:{}};
    // Deep merge each key to avoid overwriting sibling module data
    const mergedData={};
    Object.assign(mergedData,existing.data||{});
    Object.keys(fdd.data||{}).forEach(k=>{mergedData[k]={...((existing.data||{})[k]||{}),...(fdd.data[k]||{})};});
    const mergedRepeat={};
    Object.assign(mergedRepeat,existing.repeatData||{});
    Object.keys(fdd.repeatData||{}).forEach(k=>{mergedRepeat[k]=fdd.repeatData[k];});
    mainFdd.localData[localKey]={
      data:mergedData,
      repeatData:mergedRepeat,
      comments:{...(existing.comments||{}),...(fdd.comments||{})},
      cahierYears:{...(existing.cahierYears||{}),...(fdd.cahierYears||{})},
    };
    await saveMFD(mainFdd);
  };
  const localType=locaux[activeLocal]?.type||'';currentLocalType=localType;
  activeModules.forEach(modId=>{
    const mod=FORM_MODULES.find(m=>m.id===modId);if(!mod)return;
    if(mod.multiYear)renderCahierBlock(mod,localFd,formsContainer,localSave);
    else if(mod.repeatable)renderRepeatableBlock(mod,localFd,formsContainer,localSave,localType,energie);
    else renderFormBlock(mod,localFd,formsContainer,localSave,localType,energie);
  });
}

function renderLocauxSetup(locaux,fd){
  const container=document.getElementById('locaux-list-container');
  if(!container)return;
  container.innerHTML='';
  if(!locaux.length){container.innerHTML='<div class="local-empty">Aucun local — appuyez sur + Ajouter</div>';return;}
  locaux.forEach((loc,i)=>{
    const row=document.createElement('div');row.className='local-item';
    row.innerHTML=`<span class="local-item-num">${i+1}</span>`;
    // Type select
    const sel=document.createElement('select');sel.className='local-item-type';sel.style.flex='1';
    LOCAL_TYPES.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;if(t===loc.type)o.selected=true;sel.appendChild(o);});
    sel.addEventListener('change',async()=>{const fdd=getMFD();fdd.locaux[i].type=sel.value;await saveMFD(fdd);renderFormsZone();});
    // Custom name input
    const nomInp=document.createElement('input');
    nomInp.type='text';nomInp.placeholder='Nom (ex: Bât A)';nomInp.value=loc.nom||'';
    nomInp.style.cssText='background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;flex:1;max-width:100px';
    nomInp.addEventListener('change',async()=>{const fdd=getMFD();fdd.locaux[i].nom=nomInp.value;await saveMFD(fdd);renderFormsZone();});
    const del=document.createElement('button');del.className='local-item-del';del.textContent='🗑️';
    del.addEventListener('click',async()=>{
      if(!confirm('Supprimer ce local et tous ses relevés ?'))return;
      const fdd=getMFD();fdd.locaux.splice(i,1);
      delete (fdd.localData||{})[`local_${i}`];delete (fdd.localModules||{})[`local_${i}`];
      if((fdd.activeLocalIdx||0)>=fdd.locaux.length)fdd.activeLocalIdx=Math.max(0,fdd.locaux.length-1);
      await saveMFD(fdd);renderFormsZone();
    });
    row.appendChild(sel);row.appendChild(nomInp);row.appendChild(del);container.appendChild(row);
  });
}

function renderFormBlock(mod,fd,container,saveFn=null,localType='',energie=''){
  const block=document.createElement('div');block.className='form-block';
  block.innerHTML=`<div class="form-block-header" style="cursor:pointer" data-collapse="false"><div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div><button class="collapse-btn" title="Réduire/Agrandir" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:0 4px;line-height:1">−</button></div>`;
  const blockId=`${mod.id}_${currentMissionId}`;
  const initCollapsed=collapseState.get(blockId)||false;
  block.querySelector('.form-block-header').addEventListener('click',function(){
    const bodyEl=this.nextElementSibling;
    const isCollapsed=bodyEl?.style.display==='none';
    collapseState.set(blockId,!isCollapsed);
    if(bodyEl){bodyEl.style.display=isCollapsed?'':'none';}
    this.querySelector('.collapse-btn').textContent=isCollapsed?'−':'+';
  });
  // Apply saved collapse state
  if(initCollapsed){
    const bodyEl=block.querySelector('.form-block-body');
    if(bodyEl)bodyEl.style.display='none';
    const btn=block.querySelector('.collapse-btn');
    if(btn)btn.textContent='+';
  }
  const body=document.createElement('div');body.className='form-block-body';block.appendChild(body);container.appendChild(block);

  // Equipment inline at top for modules with hasEquipment
  if(mod.hasEquipment){
    renderEquipmentInline(mod.id,body,saveFn);
    const divider=document.createElement('div');divider.className='form-section-title';divider.textContent='RELEVÉS';body.appendChild(divider);
  }

  const data=fd.data[mod.id]||{};
  const allFields=mod.sections?mod.sections.flatMap(s=>[{type:'section',label:s.title},...s.fields]):(mod.fields||[]);
  allFields.forEach(f=>renderField(f,data,body,mod,fd,null,saveFn,localType,energie));
  if(mod.notes_field)renderField(mod.notes_field,data,body,mod,fd,null,saveFn,localType,energie);
}

function renderField(field,data,body,mod,fd,iIdx=null,saveFn=null,localType='',energie=''){
  // Skip fields based on local type
  if(field.showForTypes&&localType&&!field.showForTypes.includes(localType))return;
  // Skip GAZ/CPCU specific fields
  if(field.showIfEnergie&&energie&&!field.showIfEnergie.some(e=>energie.includes(e)))return;

  if(field.type==='section'){
    const d=document.createElement('div');d.className='form-section-title';d.textContent=field.label.replace(/^—\s*/,'').replace(/\s*—$/,'');body.appendChild(d);return;
  }
  if(field.type==='equipment_inline'){body.appendChild(document.createElement('div'));return;} // handled above
  if(field.type==='mesures_libres'){renderMesuresLibres(field,data,body,mod,fd,iIdx,saveFn);return;}
  if(field.type==='mesures_temp'){renderMesuresTemp(field,data,body,mod,fd,iIdx,saveFn);return;}
  if(field.type==='mesures_chauf'){renderMesuresChauf(field,data,body,mod,fd,iIdx,saveFn);return;}
  if(field.type==='courbe_chauffe'){renderCourbeChauffe(field,data,body,mod,fd,iIdx,saveFn);return;}
  if(field.type==='decalage_stepper'){renderDecalageStepper(field,data,body,mod,fd,iIdx,saveFn);return;}

  const key=iIdx!==null?`${field.id}_${iIdx}`:field.id;
  const wrap=document.createElement('div');wrap.className='form-group';

  if(field.type==='yesno3'||field.type==='yesno'){
    wrap.innerHTML=`<label>${esc(field.label)}</label>`;
    const is4=field.type==='yesno3';
    const grp=document.createElement('div');grp.className=is4?'yesno4-group':'yesno-group';
    const storedVal=iIdx!==null?(fd.repeatData[mod.id]?.[iIdx]?.[field.id]||''):(data[field.id]||'');
    const opts=is4?[['Oui','oui','y'],['Non','non','n'],['N/A','na','na'],['?','pi','pi']]:[['Oui','oui','yes'],['Non','non','no'],['N/A','na','na']];
    opts.forEach(([lbl,code,cls])=>{
      const btn=document.createElement('button');btn.className=(is4?'yesno4-btn':'yesno-btn')+' '+cls+(storedVal===code?' active':'');btn.textContent=lbl;
      btn.addEventListener('click',async()=>{
        const fdd=getMFD();
        const lk=`local_${fdd.activeLocalIdx||0}`;
        const ld=(fdd.localData||{})[lk]||{data:{},repeatData:{}};
        const target=saveFn?{...fdd,data:JSON.parse(JSON.stringify(ld.data)),repeatData:JSON.parse(JSON.stringify(ld.repeatData))}:fdd;
        if(iIdx!==null){if(!target.repeatData[mod.id])target.repeatData[mod.id]=[];if(!target.repeatData[mod.id][iIdx])target.repeatData[mod.id][iIdx]={};target.repeatData[mod.id][iIdx][field.id]=code;}
        else{if(!target.data[mod.id])target.data[mod.id]={};target.data[mod.id][field.id]=code;}
        saveFn?await saveFn(target):await saveMFD(target);
        grp.querySelectorAll(is4?'.yesno4-btn':'.yesno-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
        if(field.conditional){const condDiv=document.getElementById('cond-'+key);if(condDiv)condDiv.style.display=code===field.conditional.showWhen.value?'flex':'none';}
      });
      grp.appendChild(btn);
    });
    wrap.appendChild(grp);
    if(field.conditional){
      const condDiv=document.createElement('div');condDiv.className='conditional-fields';condDiv.id='cond-'+key;
      condDiv.style.display=storedVal===field.conditional.showWhen.value?'flex':'none';
      field.conditional.fields.forEach(cf=>renderField(cf,data,condDiv,mod,fd,iIdx,saveFn));
      wrap.appendChild(condDiv);
    }
    if(mod.withComments){wrap.appendChild(renderCommentBlock(key,((fd.comments||{})[key])||[],fd,mod,saveFn));}
  }else if(field.type==='computed'||field.type==='computed_validation'){
    wrap.innerHTML=`<label>${esc(field.label)}</label><div id="cv-${key}" class="computed-value">—</div>`;
    setTimeout(()=>updateComputed(field,fd,mod,iIdx,key),100);
  }else{
    const val=iIdx!==null?(fd.repeatData[mod.id]?.[iIdx]?.[field.id]||''):(data[field.id]||'');
    if(field.type==='select')wrap.innerHTML=`<label>${esc(field.label)}</label><select id="ff-${key}">${(field.options||[]).map(o=>`<option value="${esc(o)}"${val===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
    else if(field.type==='textarea')wrap.innerHTML=`<label>${esc(field.label)}</label><textarea id="ff-${key}" placeholder="${esc(field.placeholder||'')}" rows="3">${esc(val)}</textarea>`;
    else wrap.innerHTML=`<label>${esc(field.label)}</label><input type="${field.type==='number'?'number':field.type==='date'?'date':field.type==='time'?'time':'text'}" id="ff-${key}" placeholder="${esc(field.placeholder||field.label)}" value="${esc(val)}" ${field.step?'step='+field.step:''}/>`;
    const el=wrap.querySelector(`#ff-${key}`);
    if(el)el.addEventListener('change',async()=>{
      // Always use fresh getMFD() to avoid stale snapshot overwriting other fields
      const fdd=getMFD();
      if(saveFn){
        // Merge with current localData before saving
        const lk=`local_${fdd.activeLocalIdx||0}`;
        const ld=(fdd.localData||{})[lk]||{data:{},repeatData:{}};
        const fddLocal={...fdd,data:{...ld.data},repeatData:{...ld.repeatData}};
        if(iIdx!==null){if(!fddLocal.repeatData[mod.id])fddLocal.repeatData[mod.id]=[];if(!fddLocal.repeatData[mod.id][iIdx])fddLocal.repeatData[mod.id][iIdx]={};fddLocal.repeatData[mod.id][iIdx][field.id]=el.value;}
        else{if(!fddLocal.data[mod.id])fddLocal.data[mod.id]={};fddLocal.data[mod.id][field.id]=el.value;}
        await saveFn(fddLocal);
      } else {
        if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=el.value;}
        else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=el.value;}
        await saveMFD(fdd);
      }
      updateAllComputed(mod,fd,iIdx);
    });
  }
  body.appendChild(wrap);
}

// ── EQUIPMENT INLINE ──────────────────────────────────────────────
function renderEquipmentInline(moduleId,body,saveFn=null){
  const block=document.createElement('div');block.className='equip-inline-block';block.dataset.moduleId=moduleId;
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId&&e.moduleId===moduleId);
  const listDiv=document.createElement('div');listDiv.className='equip-inline-list';
  mEqs.forEach(eq=>{
    const item=document.createElement('div');item.className='equip-inline-item';
    item.innerHTML=`<div class="equip-inline-name">${esc(eq.name||'—')}</div><div class="equip-inline-meta">${[eq.brand,eq.model].filter(Boolean).join(' · ')}</div><div class="equip-inline-actions"><button class="card-btn" data-id="${eq.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${eq.id}" data-action="delete">🗑️</button></div>`;
    item.querySelector('[data-action=edit]').addEventListener('click',()=>openEqModal(eq.id,moduleId));
    item.querySelector('[data-action=delete]').addEventListener('click',async()=>{if(!confirm('Supprimer ?'))return;await dbDel('equipments',eq.id);equipments=equipments.filter(e=>e.id!==eq.id);renderFormsZone();});
    listDiv.appendChild(item);
  });
  const addRow=document.createElement('div');addRow.style.cssText='display:flex;gap:8px';
  const addBtn=document.createElement('button');addBtn.className='equip-add-btn';addBtn.textContent='+ Saisir manuellement';
  addBtn.addEventListener('click',()=>openEqModal(null,moduleId));
  const scanBtn=document.createElement('button');scanBtn.className='equip-scan-btn';scanBtn.textContent='📷 Scanner';
  scanBtn.addEventListener('click',()=>{editingEqContext=moduleId;openScanForModule(moduleId);});
  addRow.appendChild(addBtn);addRow.appendChild(scanBtn);
  block.appendChild(listDiv);block.appendChild(addRow);body.appendChild(block);
}

function openScanForModule(moduleId){
  editingEqContext=moduleId;
  switchMTab('forms'); // stay in forms, open scan sub-modal
  // Use a floating scan sheet
  let scanModal=document.getElementById('scan-modal');
  if(!scanModal){
    scanModal=document.createElement('div');scanModal.id='scan-modal';
    scanModal.style.cssText='position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:flex-end';
    scanModal.innerHTML=`<div style="width:100%;max-width:600px;background:var(--bg-dark);border-radius:16px 16px 0 0;padding:14px;display:flex;flex-direction:column;gap:10px;padding-bottom:calc(14px + env(safe-area-inset-bottom))">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-family:var(--font-display);font-size:16px;font-weight:700">📷 Scanner une plaque</span><button id="scan-modal-close" style="background:var(--bg-card);border:1px solid var(--border);border-radius:50%;width:30px;height:30px;color:var(--text-secondary);cursor:pointer;font-size:13px">✕</button></div>
      <div class="camera-container" style="max-height:40vh"><video id="scan-modal-video" autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video><canvas id="scan-modal-canvas" style="display:none"></canvas><div class="camera-overlay"><div class="scan-frame"><div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div></div></div><div id="scan-modal-placeholder" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:var(--bg-card)"><span style="font-size:32px;opacity:.3">📷</span><p style="color:var(--text-muted);font-size:12px">Caméra non démarrée</p></div></div>
      <div id="scan-modal-ocr-status" class="ocr-status hidden"><div class="ocr-spinner"></div><span id="scan-modal-ocr-text">Analyse...</span></div>
      <button class="btn-primary" id="scan-modal-start">🎥 Démarrer caméra</button>
      <button class="btn-capture hidden" id="scan-modal-capture">📸 Capturer</button>
      <button class="btn-secondary" id="scan-modal-gallery">🖼️ Depuis la galerie</button>
      <input type="file" id="scan-modal-file" accept="image/*" capture="environment" style="display:none"/>
    </div>`;
    document.body.appendChild(scanModal);
  }
  scanModal.style.display='flex';
  scanModal.querySelector('#scan-modal-close').onclick=()=>{stopScanModal();};
  scanModal.querySelector('#scan-modal-start').onclick=()=>startScanModal();
  scanModal.querySelector('#scan-modal-capture').onclick=()=>captureScanModal();
  scanModal.querySelector('#scan-modal-gallery').onclick=()=>scanModal.querySelector('#scan-modal-file').click();
  scanModal.querySelector('#scan-modal-file').onchange=e=>{if(e.target.files[0])processImageFileScan(e.target.files[0]);e.target.value='';};
}

let scanModalStream=null;
async function startScanModal(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920}}});
    scanModalStream=stream;
    const video=document.getElementById('scan-modal-video');video.srcObject=stream;
    document.getElementById('scan-modal-placeholder').style.display='none';
    document.getElementById('scan-modal-start').classList.add('hidden');
    document.getElementById('scan-modal-capture').classList.remove('hidden');
  }catch{showToast('Accès caméra refusé','error');}
}
function stopScanModal(){
  if(scanModalStream){scanModalStream.getTracks().forEach(t=>t.stop());scanModalStream=null;}
  const scanModal=document.getElementById('scan-modal');if(scanModal)scanModal.style.display='none';
  const v=document.getElementById('scan-modal-video');if(v)v.srcObject=null;
}
async function captureScanModal(){
  const video=document.getElementById('scan-modal-video'),canvas=document.getElementById('scan-modal-canvas');
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  stopScanModal();await analyzeImageForModule(canvas.toDataURL('image/jpeg',.9));
}
async function processImageFileScan(file){
  const reader=new FileReader();reader.onload=async e=>{stopScanModal();await analyzeImageForModule(e.target.result);};reader.readAsDataURL(file);
}
async function analyzeImageForModule(dataURL){
  capturedImage=dataURL;
  let result=null;
  if(navigator.onLine&&geminiKey){try{result=await analyzeWithGemini(dataURL);}catch(e){console.warn(e);}}
  if(!result){try{result=await analyzeWithTesseract(dataURL,{textContent:''});}catch(e){}}
  openEqModal(null,editingEqContext,dataURL);
  if(result)prefillModal(result);
}

// ── MESURES LIBRES (accès + mesures supplémentaires dynamiques) ──────
function renderMesuresLibres(field,data,body,mod,fd,iIdx,saveFn){
  const block=document.createElement('div');
  const getCurrentPoints=async()=>{const fdd=getMFD();return(fdd.data[mod.id]||{})[field.id]||[];};
  const savePoints=async(pts)=>{const fdd=getMFD();if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;saveFn?await saveFn(fdd):await saveMFD(fdd);};
  const renderPoints=(points)=>{
    block.innerHTML='';
    // Header row
    const hdr=document.createElement('div');
    hdr.style.cssText='display:grid;grid-template-columns:1fr 1fr 60px 28px;gap:6px;margin-bottom:4px';
    hdr.innerHTML='<span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Libellé</span><span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Valeur</span><span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Unité</span><span></span>';
    if(points.length)block.appendChild(hdr);
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.style.cssText='display:grid;grid-template-columns:1fr 1fr 60px 28px;gap:6px;align-items:center;margin-bottom:5px';
      const iStyle='background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:12px;outline:none;width:100%';
      row.innerHTML=`<input type="text" class="ml-label" value="${esc(pt.label||'')}" placeholder="Ex: Ø cheminée" style="${iStyle}"/><input type="text" class="ml-val" value="${esc(pt.val||'')}" placeholder="Valeur" style="${iStyle}"/><input type="text" class="ml-unit" value="${esc(pt.unit||'')}" placeholder="cm" style="${iStyle}"/><button class="mesure-del" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px">✕</button>`;
      const save=async()=>{const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));if(!pts2[pi])pts2[pi]={};pts2[pi].label=row.querySelector('.ml-label').value;pts2[pi].val=row.querySelector('.ml-val').value;pts2[pi].unit=row.querySelector('.ml-unit').value;await savePoints(pts2);};
      row.querySelectorAll('input').forEach(el=>el.addEventListener('change',save));
      row.querySelector('.mesure-del').addEventListener('click',async()=>{const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));pts2.splice(pi,1);await savePoints(pts2);renderPoints(pts2);});
      block.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.style.marginTop='4px';addBtn.textContent='+ Ajouter une mesure';
    addBtn.addEventListener('click',async()=>{const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));pts2.push({label:'',val:'',unit:''});await savePoints(pts2);renderPoints(pts2);});
    block.appendChild(addBtn);
  };
  renderPoints((fd.data[mod.id]||{})[field.id]||[]);body.appendChild(block);
}

// ── MESURES TEMP (circuit primaire) ──────────────────────────────
function renderMesuresTemp(field,data,body,mod,fd,iIdx,saveFn){
  const key=iIdx!==null?`${field.id}_${iIdx}`:field.id;
  const stored=iIdx!==null?(fd.repeatData[mod.id]?.[iIdx]?.[field.id]||[]):(data[field.id]||[]);
  const block=document.createElement('div');
  const renderPoints=(points)=>{
    block.innerHTML='';
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.className='mesure-point';
      const isAutre=pt.type==='Autre';
      row.innerHTML=`<div class="mesure-point-header"><select class="mesure-point-type">${(field.pointOptions||[]).map(o=>`<option value="${esc(o)}"${pt.type===o?' selected':''}>${esc(o)}</option>`).join('')}</select><button class="mesure-del">✕</button></div>${isAutre?`<div class="form-group" style="margin-bottom:6px"><label>Libellé</label><input type="text" class="mesure-libelle" value="${esc(pt.libelle||'')}" placeholder="Nom du point" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/></div><div class="form-group" style="margin-bottom:6px"><label>Unité</label><input type="text" class="mesure-unite" value="${esc(pt.unite||'°C')}" placeholder="°C" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/></div>`:''}<div class="mesure-row"><div class="mesure-cell"><label>Départ</label><input type="number" class="mesure-dep" step="0.1" value="${pt.dep||''}" placeholder="—"/></div><div class="mesure-cell"><label>Retour</label><input type="number" class="mesure-ret" step="0.1" value="${pt.ret||''}" placeholder="—"/></div><div class="mesure-cell"><label>ΔT</label><div class="mesure-delta" id="dt-${key}-${pi}">—</div></div></div>`;
      const updateDT=()=>{const d=parseFloat(row.querySelector('.mesure-dep').value),r=parseFloat(row.querySelector('.mesure-ret').value);const dtEl=document.getElementById(`dt-${key}-${pi}`);if(!isNaN(d)&&!isNaN(r))dtEl.textContent=(d-r).toFixed(1)+' K';else dtEl.textContent='—';};
      row.querySelector('.mesure-dep').addEventListener('input',updateDT);row.querySelector('.mesure-ret').addEventListener('input',updateDT);
      const savePoint=async()=>{
        const fdd=getMFD();
        const curPts=iIdx!==null?((fdd.repeatData[mod.id]||[])[iIdx]||{})[field.id]||[]:(fdd.data[mod.id]||{})[field.id]||[];
        const updPts=JSON.parse(JSON.stringify(curPts));
        if(!updPts[pi])updPts[pi]={};
        updPts[pi].type=row.querySelector('.mesure-point-type').value;
        updPts[pi].libelle=row.querySelector('.mesure-libelle')?.value||'';
        updPts[pi].unite=row.querySelector('.mesure-unite')?.value||'°C';
        updPts[pi].dep=row.querySelector('.mesure-dep').value;
        updPts[pi].ret=row.querySelector('.mesure-ret').value;
        if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=updPts;}
        else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=updPts;}
        saveFn?await saveFn(fdd):await saveMFD(fdd);
      };
      row.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',savePoint));
      row.querySelector('.mesure-del').addEventListener('click',async()=>{
        const fdd=getMFD();
        const curPts=iIdx!==null?((fdd.repeatData[mod.id]||[])[iIdx]||{})[field.id]||[]:(fdd.data[mod.id]||{})[field.id]||[];
        const pts=JSON.parse(JSON.stringify(curPts));pts.splice(pi,1);
        if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=pts;}
        else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;}
        saveFn?await saveFn(fdd):await saveMFD(fdd);renderPoints(pts);
      });
      row.querySelector('.mesure-point-type').addEventListener('change',async()=>{const pts=[...points];pts[pi].type=row.querySelector('.mesure-point-type').value;const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(iIdx!==null){if(!fdd.repeatData[mod.id]?.[iIdx])return;fdd.repeatData[mod.id][iIdx][field.id]=pts;}else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;}saveFn?await saveFn(fdd):await saveMFD(fdd);renderPoints(pts);});
      updateDT();block.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.style.marginTop='4px';addBtn.textContent='+ Ajouter un point de mesure';
    addBtn.addEventListener('click',async()=>{
      const fdd=getMFD();
      const curPts=iIdx!==null?((fdd.repeatData[mod.id]||[])[iIdx]||{})[field.id]||[]:(fdd.data[mod.id]||{})[field.id]||[];
      const pts=JSON.parse(JSON.stringify(curPts));
      pts.push({type:(field.pointOptions||[])[0]||'',dep:'',ret:''});
      if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=pts;}
      else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;}
      saveFn?await saveFn(fdd):await saveMFD(fdd);renderPoints(pts);
    });
    block.appendChild(addBtn);
  };
  renderPoints(stored);body.appendChild(block);
}

// ── MESURES CHAUFFAGE (dynamiques avec sous-champs selon type) ──────
function renderMesuresChauf(field,data,body,mod,fd,iIdx,saveFn){
  const key=iIdx!==null?`${field.id}_${iIdx}`:field.id;
  const stored=iIdx!==null?((fd.repeatData[mod.id]||[])[iIdx]||{})[field.id]||[]:(fd.data[mod.id]||{})[field.id]||[];
  const block=document.createElement('div');

  const savePoints=async(pts)=>{
    const fdd=getMFD();
    if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=pts;}
    else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;}
    saveFn?await saveFn(fdd):await saveMFD(fdd);
  };

  const renderPoints=(points)=>{
    block.innerHTML='';
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.className='mesure-point';
      const isTempReseau=pt.type==='Températures réseau';
      const isPression=pt.type==='Pression pompe';
      const isDebit=pt.type==='Débit';
      const isAutre=pt.type==='Autre';

      let subFields='';
      if(isTempReseau){
        subFields=`<div class="mesure-row">
          <div class="mesure-cell"><label>Départ (°C)</label><input type="number" class="mc-dep" step="0.1" value="${pt.dep||''}"/></div>
          <div class="mesure-cell"><label>Retour (°C)</label><input type="number" class="mc-ret" step="0.1" value="${pt.ret||''}"/></div>
          <div class="mesure-cell"><label>ΔT</label><div class="mesure-delta" id="mcd-${key}-${pi}">—</div></div>
        </div>`;
      } else if(isPression){
        subFields=`<div class="mesure-row">
          <div class="mesure-cell"><label>Aspiration (bar)</label><input type="number" class="mc-asp" step="0.01" value="${pt.asp||''}"/></div>
          <div class="mesure-cell"><label>Refoulement (bar)</label><input type="number" class="mc-ref" step="0.01" value="${pt.ref||''}"/></div>
          <div class="mesure-cell"><label>ΔP</label><div class="mesure-delta" id="mcd-${key}-${pi}">—</div></div>
        </div>`;
      } else if(isDebit){
        subFields=`<div class="mesure-row"><div class="mesure-cell" style="grid-column:1/-1"><label>Débit (m³/h)</label><input type="number" class="mc-debit" step="0.01" value="${pt.debit||''}"/></div></div>`;
      } else if(isAutre){
        subFields=`<div style="display:flex;flex-direction:column;gap:5px;margin-top:4px">
          <input type="text" class="mc-libelle" placeholder="Libellé du point" value="${esc(pt.libelle||'')}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none;width:100%"/>
          <div style="display:flex;gap:6px"><input type="text" class="mc-val" placeholder="Valeur" value="${esc(pt.val||'')}" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none"/>
          <input type="text" class="mc-unite" placeholder="Unité" value="${esc(pt.unite||'')}" style="width:70px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none"/></div>
        </div>`;
      } else {
        // Temp ext reg / temp ext réelle (simple value)
        subFields=`<div class="mesure-row"><div class="mesure-cell" style="grid-column:1/-1"><label>Valeur (°C)</label><input type="number" class="mc-val" step="0.1" value="${pt.val||''}"/></div></div>`;
      }

      row.innerHTML=`<div class="mesure-point-header">
        <select class="mesure-point-type">${(field.pointOptions||[]).map(o=>`<option value="${esc(o)}"${pt.type===o?' selected':''}>${esc(o)}</option>`).join('')}</select>
        <button class="mesure-del">✕</button>
      </div>${subFields}`;

      // Auto-compute ΔT or ΔP
      const updateDelta=()=>{
        const dtEl=document.getElementById(`mcd-${key}-${pi}`);if(!dtEl)return;
        if(isTempReseau){const d=parseFloat(row.querySelector('.mc-dep')?.value),r=parseFloat(row.querySelector('.mc-ret')?.value);dtEl.textContent=(!isNaN(d)&&!isNaN(r))?(d-r).toFixed(1)+' K':'—';}
        else if(isPression){const a=parseFloat(row.querySelector('.mc-asp')?.value),r=parseFloat(row.querySelector('.mc-ref')?.value);dtEl.textContent=(!isNaN(a)&&!isNaN(r))?(r-a).toFixed(2)+' bar':'—';}
      };
      row.querySelectorAll('input').forEach(el=>el.addEventListener('input',updateDelta));

      const saveRow=async()=>{
        const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));
        if(!pts2[pi])pts2[pi]={};
        pts2[pi].type=row.querySelector('.mesure-point-type').value;
        if(isTempReseau){pts2[pi].dep=row.querySelector('.mc-dep')?.value;pts2[pi].ret=row.querySelector('.mc-ret')?.value;}
        else if(isPression){pts2[pi].asp=row.querySelector('.mc-asp')?.value;pts2[pi].ref=row.querySelector('.mc-ref')?.value;}
        else if(isDebit){pts2[pi].debit=row.querySelector('.mc-debit')?.value;}
        else if(isAutre){pts2[pi].libelle=row.querySelector('.mc-libelle')?.value;pts2[pi].val=row.querySelector('.mc-val')?.value;pts2[pi].unite=row.querySelector('.mc-unite')?.value;}
        else{pts2[pi].val=row.querySelector('.mc-val')?.value;}
        await savePoints(pts2);
      };
      row.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',saveRow));

      row.querySelector('.mesure-point-type').addEventListener('change',async()=>{
        const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));
        pts2[pi]={type:row.querySelector('.mesure-point-type').value};
        await savePoints(pts2);renderPoints(pts2);
      });
      row.querySelector('.mesure-del').addEventListener('click',async()=>{
        const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));
        pts2.splice(pi,1);await savePoints(pts2);renderPoints(pts2);
      });

      updateDelta();block.appendChild(row);
    });

    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.style.marginTop='4px';addBtn.textContent='+ Ajouter un point de mesure';
    addBtn.addEventListener('click',async()=>{
      const pts2=JSON.parse(JSON.stringify(await getCurrentPoints()));
      pts2.push({type:(field.pointOptions||[])[0]||''});
      await savePoints(pts2);renderPoints(pts2);
    });
    block.appendChild(addBtn);
  };

  const getCurrentPoints=async()=>{
    const fdd=getMFD();
    return iIdx!==null?((fdd.repeatData[mod.id]||[])[iIdx]||{})[field.id]||[]:(fdd.data[mod.id]||{})[field.id]||[];
  };

  renderPoints(stored);body.appendChild(block);
}

// ── COURBE DE CHAUFFE ─────────────────────────────────────────────
function renderCourbeChauffe(field,data,body,mod,fd,iIdx,saveFn){
  const key=iIdx!==null?`${field.id}_${iIdx}`:field.id;
  const stored=iIdx!==null?(fd.repeatData[mod.id]?.[iIdx]?.[field.id]||[{text:-5,dep:null},{text:15,dep:null}]):(data[field.id]||[{text:-5,dep:null},{text:15,dep:null}]);
  const block=document.createElement('div');block.className='courbe-block';
  const canvas=document.createElement('canvas');canvas.className='courbe-canvas';canvas.width=400;canvas.height=200;

  const PAD={l:46,r:16,t:20,b:36};
  const drawCurve=()=>{
    const W=canvas.width,H=canvas.height;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,W,H);
    // Background
    ctx.fillStyle='#0d1b2a';ctx.fillRect(0,0,W,H);
    const pts=block.querySelectorAll('.courbe-point-row');
    const points=[];
    // Get decalage value from the stepper
    let decalage=0;
    const decalageEl=block.closest('.form-block-body')?.querySelector('.stepper-val');
    if(decalageEl)decalage=parseFloat(decalageEl.textContent)||0;
    pts.forEach(row=>{
      const t=parseFloat(row.querySelector('.c-text').value);
      const d=parseFloat(row.querySelector('.c-dep').value);
      if(!isNaN(t)&&!isNaN(d))points.push({t,d:d+decalage}); // apply parallel shift
    });
    if(points.length<2){
      ctx.fillStyle='#445566';ctx.font='12px monospace';ctx.textAlign='center';
      ctx.fillText('Entrez au moins 2 points pour afficher la courbe',W/2,H/2);
      return;
    }
    points.sort((a,b)=>a.t-b.t);
    const minT=Math.min(...points.map(p=>p.t));
    const maxT=Math.max(...points.map(p=>p.t));
    const minD=Math.min(...points.map(p=>p.d));
    const maxD=Math.max(...points.map(p=>p.d));
    const padT=(maxT-minT)*0.1||5, padD=(maxD-minD)*0.1||5;
    const x0=minT-padT, x1=maxT+padT;
    const y0=minD-padD, y1=maxD+padD;
    const px=t=>PAD.l+(t-x0)/(x1-x0)*(W-PAD.l-PAD.r);
    const py=d=>H-PAD.b-(d-y0)/(y1-y0)*(H-PAD.t-PAD.b);
    // Grid & axes
    ctx.strokeStyle='#1e3f5e';ctx.lineWidth=1;
    // Fixed step: X by 5°C, Y by 10 or 20°C depending on range
    const rangeT=x1-x0,rangeD=y1-y0;
    const stepT=5; // always 5°C on X
    const stepD=rangeD>100?20:10; // 20 if large range, else 10
    // Ensure Y includes 0 if range allows
    const yMin=Math.min(y0,0);const yMax=Math.max(y1,0);
    const yStart=Math.floor(yMin/stepD)*stepD;
    const yEnd=Math.ceil(yMax/stepD)*stepD;
    // Recalc px/py with expanded range including 0
    const px2=t=>PAD.l+(t-x0)/(x1-x0)*(W-PAD.l-PAD.r);
    const py2=d=>H-PAD.b-(d-yStart)/(yEnd-yStart)*(H-PAD.t-PAD.b);
    // Reassign px/py
    Object.assign(window,{_px:px2,_py:py2});

    // X grid ticks (by 5°C)
    for(let t=Math.ceil(x0/stepT)*stepT;t<=x1;t+=stepT){
      ctx.beginPath();ctx.moveTo(px2(t),PAD.t);ctx.lineTo(px2(t),H-PAD.b);ctx.stroke();
    }
    // Y grid ticks
    for(let d=yStart;d<=yEnd;d+=stepD){
      ctx.beginPath();ctx.moveTo(PAD.l,py2(d));ctx.lineTo(W-PAD.r,py2(d));ctx.stroke();
    }
    // Axes
    ctx.strokeStyle='#2d5a8e';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,H-PAD.b);ctx.lineTo(W-PAD.r,H-PAD.b);ctx.stroke();
    // Zero line on Y (prominent)
    if(yStart<0&&yEnd>0){ctx.strokeStyle='#3b82f6';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(PAD.l,py2(0));ctx.lineTo(W-PAD.r,py2(0));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#3b82f6';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText('0°',PAD.l-4,py2(0)+3);}
    // Axis labels
    ctx.fillStyle='#6a90b0';ctx.font='10px monospace';ctx.textAlign='center';
    for(let t=Math.ceil(x0/stepT)*stepT;t<=x1;t+=stepT){
      ctx.fillText(t+'°',px2(t),H-PAD.b+12);
    }
    ctx.textAlign='right';
    for(let d=yStart;d<=yEnd;d+=stepD){
      ctx.fillText(d+'°',PAD.l-4,py2(d)+3);
    }
    // Axis titles
    ctx.fillStyle='#7a95b0';ctx.font='9px monospace';ctx.textAlign='center';
    ctx.fillText('Temp. extérieure (°C)',W/2,H-2);
    ctx.save();ctx.translate(11,H/2);ctx.rotate(-Math.PI/2);
    ctx.fillText('T départ (°C)',0,0);ctx.restore();
    // Zero line if visible
    if(x0<0&&x1>0){ctx.strokeStyle='#2d5a8e';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px(0),PAD.t);ctx.lineTo(px(0),H-PAD.b);ctx.stroke();ctx.setLineDash([]);}
    // Curve
    const pxF=window._px||px,pyF=window._py||py;
    ctx.strokeStyle='#1e7fd4';ctx.lineWidth=2.5;ctx.lineJoin='round';
    ctx.beginPath();points.forEach((p,i)=>{i===0?ctx.moveTo(pxF(p.t),pyF(p.d)):ctx.lineTo(pxF(p.t),pyF(p.d));});ctx.stroke();
    // Data points with labels
    points.forEach(p=>{
      ctx.fillStyle='#1e7fd4';ctx.beginPath();ctx.arc(pxF(p.t),pyF(p.d),5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='white';ctx.beginPath();ctx.arc(pxF(p.t),pyF(p.d),2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#e8f0f8';ctx.font='9px monospace';ctx.textAlign='center';
      ctx.fillText(p.d+'°',pxF(p.t),pyF(p.d)-8);
    });
    delete window._px;delete window._py;
  };

  const renderPts=(points)=>{
    block.innerHTML='<div class="form-section-title" style="margin-bottom:6px">Points de la courbe</div><div class="courbe-points" id="courbe-pts-'+key+'"></div>';
    const ptsDiv=block.querySelector('.courbe-points');
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.className='courbe-point-row';
      row.innerHTML=`<div class="mesure-cell"><label>Text (°C)</label><input type="number" class="c-text" step="1" value="${pt.text!==null&&pt.text!==undefined?pt.text:''}" placeholder="ex: -5" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/></div><div class="mesure-cell"><label>T départ (°C)</label><input type="number" class="c-dep" step="0.5" value="${pt.dep!==null&&pt.dep!==undefined?pt.dep:''}" placeholder="ex: 75" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:13px;outline:none;width:100%"/></div><button class="mesure-del" ${points.length<=2?'disabled style="opacity:.3"':''}>✕</button>`;
      row.querySelectorAll('input').forEach(el=>el.addEventListener('change',async()=>{
        const updPts=[];block.querySelectorAll('.courbe-point-row').forEach(r=>{updPts.push({text:parseFloat(r.querySelector('.c-text').value)||null,dep:parseFloat(r.querySelector('.c-dep').value)||null});});
        const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();
        if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=updPts;}
        else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=updPts;}
        saveFn?await saveFn(fdd):await saveMFD(fdd);drawCurve();
      }));
      row.querySelector('.mesure-del').addEventListener('click',async()=>{
        if(points.length<=2)return;
        const pts=[...points];pts.splice(pi,1);
        const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();
        if(iIdx!==null){if(!fdd.repeatData[mod.id]?.[iIdx])return;fdd.repeatData[mod.id][iIdx][field.id]=pts;}
        else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;}
        saveFn?await saveFn(fdd):await saveMFD(fdd);renderPts(pts);
      });
      ptsDiv.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.textContent='+ Ajouter un point';addBtn.style.marginTop='4px';
    addBtn.addEventListener('click',async()=>{
      const pts=[...points,{text:null,dep:null}];
      const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();
      if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=pts;}
      else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=pts;}
      saveFn?await saveFn(fdd):await saveMFD(fdd);renderPts(pts);
    });
    block.appendChild(addBtn);
    block.appendChild(canvas);
    setTimeout(drawCurve,50);
  };
  renderPts(stored);body.appendChild(block);
}

function renderDecalageStepper(field,data,body,mod,fd,iIdx,saveFn){
  const val=parseFloat(data[field.id])||0;
  const wrap=document.createElement('div');wrap.className='form-group';
  wrap.innerHTML=`<label>${esc(field.label)}</label>`;
  const row=document.createElement('div');row.className='stepper-row';
  const minus=document.createElement('button');minus.className='stepper-btn';minus.textContent='−';
  const plus=document.createElement('button');plus.className='stepper-btn';plus.textContent='+';
  display.textContent=(val>=0?'+':'')+val.toFixed(1);
  const display=document.createElement('div');display.className='stepper-val';display.textContent=val.toFixed(1);
  let current=val;
  const update=async(delta)=>{
    current=Math.max(-10,Math.min(10,Math.round((current+delta)*2)/2));
    display.textContent=(current>=0?'+':'')+current.toFixed(1);
    const fdd=getMFD();
    const lk=`local_${fdd.activeLocalIdx||0}`;const ld=(fdd.localData||{})[lk]||{data:{}};
    const target=saveFn?{...fdd,data:JSON.parse(JSON.stringify(ld.data))}:fdd;
    if(!target.data[mod.id])target.data[mod.id]={};target.data[mod.id][field.id]=current;
    saveFn?await saveFn(target):await saveMFD(target);
    // Trigger curve redraw if visible
    const canvas=wrap.closest('.form-block-body')?.querySelector('.courbe-canvas');
    if(canvas){const ev=new Event('redraw');canvas.dispatchEvent(ev);}
  };
  minus.addEventListener('click',()=>update(-0.5));plus.addEventListener('click',()=>update(0.5));
  row.appendChild(minus);row.appendChild(display);row.appendChild(plus);
  wrap.appendChild(row);body.appendChild(wrap);
}

function renderCommentBlock(key,commentData,fd,mod,saveFn=null){
  const block=document.createElement('div');block.className='comment-block';
  const tagsRow=document.createElement('div');tagsRow.className='comment-tags';
  ['✅ Positif','⚠️ Négatif','— Neutre'].forEach((lbl,i)=>{
    const tag=document.createElement('span');tag.className='ctag '+['pos','neg','neu'][i];tag.textContent=lbl;
    tag.addEventListener('click',async()=>{
      const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();
      if(!fdd.comments)fdd.comments={};if(!fdd.comments[key])fdd.comments[key]=[];
      fdd.comments[key].push({type:['pos','neg','neu'][i],text:''});
      saveFn?await saveFn(fdd):await saveMFD(fdd);
      const list=document.getElementById('clist-'+key);if(list){const c=fdd.comments[key];list.innerHTML='';c.forEach((cm,ci)=>list.appendChild(buildCommentEntry(key,cm,ci,fdd,mod,saveFn)));}
    });
    tagsRow.appendChild(tag);
  });
  const list=document.createElement('div');list.id='clist-'+key;
  commentData.forEach((c,ci)=>list.appendChild(buildCommentEntry(key,c,ci,fd,mod,saveFn)));
  block.appendChild(tagsRow);block.appendChild(list);return block;
}
function buildCommentEntry(key,c,ci,fd,mod,saveFn=null){
  const row=document.createElement('div');row.className='comment-entry';
  const typeTag=document.createElement('span');typeTag.className=`ctag ${c.type} active`;typeTag.textContent=c.type==='pos'?'✅':c.type==='neg'?'⚠️':'—';typeTag.style.alignSelf='flex-start';
  const ta=document.createElement('textarea');ta.value=c.text||'';ta.placeholder='Commentaire...';ta.rows=2;
  ta.style.cssText='flex:1;resize:none;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-family:var(--font-body);font-size:12px;outline:none;min-height:50px';
  const del=document.createElement('button');del.className='btn-del-comment';del.textContent='✕';
  ta.addEventListener('change',async()=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(fdd.comments?.[key]?.[ci])fdd.comments[key][ci].text=ta.value;saveFn?await saveFn(fdd):await saveMFD(fdd);});
  del.addEventListener('click',async()=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(fdd.comments?.[key])fdd.comments[key].splice(ci,1);saveFn?await saveFn(fdd):await saveMFD(fdd);const list=document.getElementById('clist-'+key);if(list){list.innerHTML='';(fdd.comments?.[key]||[]).forEach((cm,j)=>list.appendChild(buildCommentEntry(key,cm,j,fdd,mod,saveFn)));}});
  row.appendChild(typeTag);row.appendChild(ta);row.appendChild(del);return row;
}

function updateComputed(field,fd,mod,iIdx,key){
  const el=document.getElementById('cv-'+key);if(!el)return;
  const allF=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)];
  const vars={};allF.forEach(f=>{const k=iIdx!==null?`ff-${f.id}_${iIdx}`:`ff-${f.id}`;const inp=document.getElementById(k);if(inp){const v=parseFloat(inp.value);if(!isNaN(v))vars[f.id]=v;}});
  try{
    const result=new Function(...Object.keys(vars),'return '+field.formula)(...Object.values(vars));
    if(field.type==='computed_validation'){
      const fdG=(getMFD().data['generalites'])||{};
      const puissMap={'< 70 kW':50,'≥ 70 kW et < 400 kW':200,'≥ 400 kW et < 1 MW':700,'≥ 1 MW':1500};
      const puissKw=puissMap[fdG['puissance_chaudiere']]||0;
      const section=isNaN(result)?0:result;
      if(!puissKw||!section){el.innerHTML='<span class="validation-na">Renseigner la puissance</span>';return;}
      const required=field.rule==='ventilation_vh'?puissKw*6:puissKw*3;
      el.innerHTML=section>=required?`<span class="validation-ok">✅ ${Math.round(section)} cm² ≥ ${Math.round(required)} cm²</span>`:`<span class="validation-ko">❌ ${Math.round(section)} cm² < ${Math.round(required)} cm²</span>`;
    }else{el.textContent=isNaN(result)?'—':(Math.round(result*100)/100)+' '+(field.unit||'');}
  }catch{el.textContent='—';}
}
function updateAllComputed(mod,fd,iIdx){
  const af=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)];
  af.filter(f=>f.type==='computed'||f.type==='computed_validation').forEach(f=>{const key=iIdx!==null?`${f.id}_${iIdx}`:f.id;updateComputed(f,fd,mod,iIdx,key);});
}

function renderRepeatableBlock(mod,fd,container,saveFn=null,localType='',energie=''){
  const instances=fd.repeatData[mod.id]||[{}];
  const block=document.createElement('div');block.className='form-block';
  const header=document.createElement('div');header.className='form-block-header';header.style.cursor='pointer';header.dataset.collapse='false';
  header.innerHTML=`<div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div><button class="collapse-btn" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:0 4px;line-height:1">−</button>`;
  const repBlockId=`${mod.id}_rep_${currentMissionId}`;
  const repInitCollapsed=collapseState.get(repBlockId)||false;
  header.addEventListener('click',function(){
    const isCollapsed=body?.style.display==='none';
    collapseState.set(repBlockId,!isCollapsed);
    if(body){body.style.display=isCollapsed?'':'none';}
    this.querySelector('.collapse-btn').textContent=isCollapsed?'−':'+';
  });
  block.appendChild(header);const body=document.createElement('div');body.className='form-block-body';block.appendChild(body);container.appendChild(block);
  instances.forEach((_,idx)=>{
    const inst=document.createElement('div');inst.className='repeat-instance';
    const instTitle=document.createElement('div');instTitle.className='repeat-instance-title';
    instTitle.innerHTML=`<span style="color:${mod.color}">${mod.repeatLabel} ${idx+1}</span>`;
    if(instances.length>1){const del=document.createElement('button');del.className='btn-remove-instance';del.textContent='✕';del.addEventListener('click',async()=>{
        const fdd=getMFD();
        if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];
        fdd.repeatData[mod.id].splice(idx,1);
        saveFn?await saveFn(fdd):await saveMFD(fdd);
        renderFormsZone();
      });instTitle.appendChild(del);}
    inst.appendChild(instTitle);
    // Equipment inline for hasEquipment repeatable modules
    if(mod.hasEquipment)renderEquipmentInline(mod.id+`_${idx}`,inst,saveFn);
    mod.fields.forEach(f=>renderField(f,fd.data,inst,mod,fd,idx,saveFn,localType,energie));body.appendChild(inst);
  });
  const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.textContent=`+ Ajouter ${mod.repeatLabel}`;
  addBtn.addEventListener('click',async()=>{
    // Always use fresh getMFD, never stale snapshot
    const fdd=getMFD();
    if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];
    fdd.repeatData[mod.id].push({});
    saveFn?await saveFn(fdd):await saveMFD(fdd);
    // Re-render only this block, not the whole zone
    const newFd=getMFD();
    const localKey=`local_${newFd.activeLocalIdx||0}`;
    const localDataEntry=(newFd.localData||{})[localKey]||{data:{},repeatData:{},comments:{},cahierYears:{}};
    const freshFd={id:newFd.id,activeModules:newFd.localModules?.[localKey]||[],data:localDataEntry.data||{},repeatData:localDataEntry.repeatData||{},comments:localDataEntry.comments||{},cahierYears:localDataEntry.cahierYears||{}};
    const freshSave=async(fdd2)=>{const mf=getMFD();if(!mf.localData)mf.localData={};const ex=mf.localData[localKey]||{};mf.localData[localKey]={...ex,data:fdd2.data,repeatData:fdd2.repeatData,comments:fdd2.comments||{},cahierYears:fdd2.cahierYears||{}};await saveMFD(mf);};
    // Replace this block in DOM
    const newBlock=document.createElement('div');
    renderRepeatableBlock(mod,freshFd,newBlock,freshSave,currentLocalType||'',currentEnergie||'');
    block.replaceWith(newBlock.firstChild||newBlock);
  });
  body.appendChild(addBtn);
}

function renderCahierBlock(mod,fd,container,saveFn=null){
  const block=document.createElement('div');block.className='form-block';
  block.innerHTML=`<div class="form-block-header"><div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div></div><div class="form-block-body" id="fb-cahier"></div>`;
  container.appendChild(block);
  const body=document.getElementById('fb-cahier');
  const years=fd.cahierYears||{};
  const nbRow=document.createElement('div');nbRow.className='form-group';
  nbRow.innerHTML=`<label>Années à renseigner</label><input type="number" id="cahier-nb-years" min="1" max="10" value="${Object.keys(years).length||1}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);width:100%;font-size:14px;outline:none"/>`;
  body.appendChild(nbRow);
  const btn=document.createElement('button');btn.className='btn-secondary btn-sm';btn.textContent='↻ Actualiser';btn.style.marginBottom='10px';
  btn.addEventListener('click',async()=>{
    const nb=parseInt(document.getElementById('cahier-nb-years').value)||1;
    const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(!fdd.cahierYears)fdd.cahierYears={};
    for(let i=0;i<nb;i++){const yr=new Date().getFullYear()-i;const k=String(yr);if(!fdd.cahierYears[k])fdd.cahierYears[k]={year:yr,obligations:{}};}
    saveFn?await saveFn(fdd):await saveMFD(fdd);renderFormsZone();
  });
  body.appendChild(btn);
  const fdG=fd.data['generalites']||{};
  const puiss=fdG['puissance_chaudiere']||'';
  const obligations=OBLIGATIONS_CHAUFFERIE[puiss]||OBLIGATIONS_CHAUFFERIE['≥ 70 kW et < 400 kW'];
  Object.keys(years).sort().reverse().forEach(yr=>{
    const yData=years[yr];
    const yBlock=document.createElement('div');yBlock.className='year-block';
    const yhdr=document.createElement('div');yhdr.className='year-block-header';
    yhdr.innerHTML=`<span class="year-block-title">📅 Année ${yr}</span><span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">▾</span>`;
    const yBody=document.createElement('div');yBody.className='year-block-body';
    let collapsed=false;yhdr.addEventListener('click',()=>{collapsed=!collapsed;yBody.className='year-block-body'+(collapsed?' collapsed':'');});
    [{id:'date_allumage',label:"Date d'allumage",type:'date'},{id:'date_arret',label:"Date d'arrêt",type:'date'}].forEach(sf=>{
      const fg=document.createElement('div');fg.className='form-group';
      fg.innerHTML=`<label>${sf.label}</label><input type="date" value="${yData[sf.id]||''}" />`;
      fg.querySelector('input').addEventListener('change',async e=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(!fdd.cahierYears[yr])fdd.cahierYears[yr]={};fdd.cahierYears[yr][sf.id]=e.target.value;saveFn?await saveFn(fdd):await saveMFD(fdd);});
      yBody.appendChild(fg);
    });
    const oblTitle=document.createElement('div');oblTitle.className='form-section-title';oblTitle.textContent='OPÉRATIONS';yBody.appendChild(oblTitle);
    if(!yData.obligations)yData.obligations={};
    obligations.forEach(obl=>{
      if(!yData.obligations[obl.id])yData.obligations[obl.id]={freq:obl.freq_default,dates:[]};
      const oblData=yData.obligations[obl.id];
      const oblRow=document.createElement('div');oblRow.className='obligation-row';
      oblRow.innerHTML=`<div class="obligation-header"><span class="obligation-label">${obl.label}</span><select class="obl-freq-sel" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--accent);font-family:var(--font-mono);font-size:11px;outline:none">${FREQ_OPTIONS.map(f=>`<option value="${f}"${f===oblData.freq?' selected':''}>${f}</option>`).join('')}</select></div>`;
      const datesDiv=document.createElement('div');datesDiv.className='obligation-dates';
      (oblData.dates||[]).forEach((dateVal,di)=>{
        const dr=document.createElement('div');dr.className='obl-date-row';
        dr.innerHTML=`<span class="obl-date-label">${di+1}.</span><input type="date" value="${dateVal||''}" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text-primary);font-size:12px;outline:none"/><button style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 4px;font-size:12px">✕</button>`;
        dr.querySelector('input').addEventListener('change',async e=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(fdd.cahierYears?.[yr]?.obligations?.[obl.id]?.dates)fdd.cahierYears[yr].obligations[obl.id].dates[di]=e.target.value;saveFn?await saveFn(fdd):await saveMFD(fdd);});
        dr.querySelector('button').addEventListener('click',async()=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(fdd.cahierYears?.[yr]?.obligations?.[obl.id]?.dates)fdd.cahierYears[yr].obligations[obl.id].dates.splice(di,1);saveFn?await saveFn(fdd):await saveMFD(fdd);renderFormsZone();});
        datesDiv.appendChild(dr);
      });
      const addDateBtn=document.createElement('button');addDateBtn.className='btn-add-comment';addDateBtn.textContent='+ Ajouter une date';
      addDateBtn.addEventListener('click',async()=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(!fdd.cahierYears?.[yr]?.obligations?.[obl.id])return;if(!fdd.cahierYears[yr].obligations[obl.id].dates)fdd.cahierYears[yr].obligations[obl.id].dates=[];fdd.cahierYears[yr].obligations[obl.id].dates.push('');saveFn?await saveFn(fdd):await saveMFD(fdd);renderFormsZone();});
      oblRow.querySelector('.obl-freq-sel').addEventListener('change',async e=>{const fdd=saveFn?JSON.parse(JSON.stringify(fd)):getMFD();if(fdd.cahierYears?.[yr]?.obligations?.[obl.id])fdd.cahierYears[yr].obligations[obl.id].freq=e.target.value;saveFn?await saveFn(fdd):await saveMFD(fdd);});
      oblRow.appendChild(datesDiv);oblRow.appendChild(addDateBtn);yBody.appendChild(oblRow);
    });
    yBlock.appendChild(yhdr);yBlock.appendChild(yBody);body.appendChild(yBlock);
  });
}

// ── MODALS ────────────────────────────────────────────────────────
function openSiteModal(id=null){
  editingSiteId=id;const s=id?sites.find(x=>x.id===id):null;
  document.getElementById('modal-site-title').textContent=id?'Modifier le site':'Nouveau site';
  ['name','address','city','zip','contact','notes','emplacement'].forEach(k=>{const el=document.getElementById('site-'+k);if(el)el.value=s?.[k]||'';});
  const caEl=document.getElementById('site-code-affaire');if(caEl)caEl.value=s?.codeAffaire||'';
  const periodeEl=document.getElementById('site-periode');if(periodeEl)periodeEl.value=s?.periode||'';
  const anneeEl=document.getElementById('site-annee-exacte');if(anneeEl)anneeEl.value=s?.anneeExacte||'';
  document.getElementById('site-energie').value=s?.energie||'GAZ';
  ['batiments','niveaux','logements','hauteur'].forEach(k=>{const el=document.getElementById('site-'+k);if(el)el.value=s?.[k]||'';});
  const locEl=document.getElementById('site-locaux-pro');if(locEl)locEl.value=s?.locauxPro||'';
  document.getElementById('modal-site').classList.remove('hidden');
  setTimeout(()=>document.getElementById('site-name').focus(),300);
}
async function saveSite(){
  const name=document.getElementById('site-name').value.trim();if(!name){showToast('Nom obligatoire','error');return;}
  const s={id:editingSiteId||uid(),name,codeAffaire:v('site-code-affaire'),address:v('site-address'),city:v('site-city'),zip:v('site-zip'),periode:v('site-periode'),anneeExacte:vn('site-annee-exacte'),batiments:vn('site-batiments'),niveaux:vn('site-niveaux'),logements:vn('site-logements'),locauxPro:vn('site-locaux-pro'),hauteur:vn('site-hauteur'),emplacement:v('site-emplacement'),energie:v('site-energie'),contact:v('site-contact'),notes:v('site-notes'),updatedAt:now(),createdAt:editingSiteId?(sites.find(x=>x.id===editingSiteId)?.createdAt||now()):now()};
  await dbPut('sites',s);if(editingSiteId){const i=sites.findIndex(x=>x.id===editingSiteId);if(i>=0)sites[i]=s;else sites.push(s);}else sites.push(s);
  document.getElementById('modal-site').classList.add('hidden');renderSites(document.getElementById('site-search').value);if(currentSiteId===editingSiteId)renderSiteView();showToast(editingSiteId?'Site mis à jour ✓':'Site créé ✓','success');
}
async function deleteSite(id){
  const c=missions.filter(m=>m.siteId===id).length;if(!confirm(`Supprimer ce site et ses ${c} mission(s) ?`))return;
  const sm=missions.filter(m=>m.siteId===id);for(const m of sm){const me=equipments.filter(e=>e.missionId===m.id);for(const e of me)await dbDel('equipments',e.id);equipments=equipments.filter(e=>e.missionId!==m.id);await dbDel('missions',m.id);}
  missions=missions.filter(m=>m.siteId!==id);await dbDel('sites',id);sites=sites.filter(s=>s.id!==id);renderSites();showToast('Site supprimé');
}

function openMissionModal(id=null){
  editingMissionId=id;const m=id?missions.find(x=>x.id===id):null;
  document.getElementById('modal-mission-title').textContent=id?'Modifier la mission':'Nouvelle mission';
  document.getElementById('mission-type').value=m?.type||'audit';
  document.getElementById('mission-date-start').value=m?.dateStart||today();
  document.getElementById('mission-date-end').value=m?.dateEnd||'';
  document.getElementById('mission-operator').value=m?.operator||(currentUser?`${currentUser.prenom} ${currentUser.nom}`:'');
  document.getElementById('mission-status').value=m?.status||'en_cours';
  document.getElementById('mission-ref').value=m?.ref||'';
  document.getElementById('mission-notes').value=m?.notes||'';
  document.getElementById('modal-mission').classList.remove('hidden');
}
async function saveMission(){
  const m={id:editingMissionId||uid(),siteId:currentSiteId,type:v('mission-type'),dateStart:v('mission-date-start'),dateEnd:v('mission-date-end'),operator:v('mission-operator'),status:v('mission-status'),ref:v('mission-ref'),notes:v('mission-notes'),participants:[],updatedAt:now(),createdAt:editingMissionId?(missions.find(x=>x.id===editingMissionId)?.createdAt||now()):now()};
  if(editingMissionId){const existing=missions.find(x=>x.id===editingMissionId);if(existing?.participants)m.participants=existing.participants;}
  await dbPut('missions',m);if(editingMissionId){const i=missions.findIndex(x=>x.id===editingMissionId);if(i>=0)missions[i]=m;else missions.push(m);}else missions.push(m);
  document.getElementById('modal-mission').classList.add('hidden');renderSiteView();showToast(editingMissionId?'Mission mise à jour ✓':'Mission créée ✓','success');
}
async function deleteMission(id){
  if(!confirm('Supprimer cette mission ?'))return;
  const me=equipments.filter(e=>e.missionId===id);for(const e of me)await dbDel('equipments',e.id);equipments=equipments.filter(e=>e.missionId!==id);
  await dbDel('missions',id);missions=missions.filter(m=>m.id!==id);
  if(document.getElementById('view-site').classList.contains('active'))renderSiteView();else renderAllMissions();showToast('Mission supprimée');
}


// Refresh all equipment inline lists without rebuilding full form
function refreshAllEquipInline(){
  document.querySelectorAll('.equip-inline-block').forEach(block=>{
    const moduleId=block.dataset.moduleId;
    if(!moduleId)return;
    const listDiv=block.querySelector('.equip-inline-list');
    if(!listDiv)return;
    const mEqs=equipments.filter(e=>e.missionId===currentMissionId&&e.moduleId===moduleId);
    listDiv.innerHTML='';
    mEqs.forEach(eq=>{
      const item=document.createElement('div');item.className='equip-inline-item';
      item.innerHTML=`<div class="equip-inline-name">${esc(eq.name||'—')}</div><div class="equip-inline-meta">${[eq.brand,eq.model].filter(Boolean).join(' · ')}</div><div class="equip-inline-actions"><button class="card-btn" data-id="${eq.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${eq.id}" data-action="delete">🗑️</button></div>`;
      item.querySelector('[data-action=edit]').addEventListener('click',()=>openEqModal(eq.id,moduleId));
      item.querySelector('[data-action=delete]').addEventListener('click',async()=>{if(!confirm('Supprimer ?'))return;await dbDel('equipments',eq.id);equipments=equipments.filter(e=>e.id!==eq.id);refreshAllEquipInline();});
      listDiv.appendChild(item);
    });
  });
}

function openEqModal(id=null,moduleId=null,photoData=null){
  editingEqId=id;editingEqContext=moduleId||editingEqContext;attachedPhoto=photoData||null;
  const eq=id?equipments.find(e=>e.id===id):null;
  document.getElementById('modal-eq-title').textContent=id?'Modifier équipement':'Nouvel équipement';
  const sel=document.getElementById('field-category');sel.innerHTML='';
  categories.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;sel.appendChild(o);});
  document.getElementById('field-category').value=eq?.category||categories[0]?.id||'';
  ['name','brand','model','serial','power','fluid','location','notes'].forEach(k=>{const el=document.getElementById('field-'+k);if(el)el.value=eq?.[k]||'';});
  document.getElementById('field-ocr-raw').value=eq?.ocrRaw||'';
  document.getElementById('field-year').value=eq?.year||'';
  document.getElementById('field-condition').value=eq?.condition||'';
  const pp=document.getElementById('field-photo-preview');
  if(photoData){pp.src=photoData;pp.classList.remove('hidden');}
  else if(eq?.photo){pp.src=eq.photo;pp.classList.remove('hidden');attachedPhoto=eq.photo;}
  else{pp.src='';pp.classList.add('hidden');}
  document.getElementById('modal-equipment').classList.remove('hidden');
  setTimeout(()=>document.getElementById('field-name').focus(),300);
}
async function saveEquipment(){
  const name=document.getElementById('field-name').value.trim();if(!name){showToast('Nom obligatoire','error');return;}
  // Normalize moduleId: strip circuit index suffix (e.g. 'chauffage_0' -> 'chauffage')
  const rawModId=editingEqContext||null;
  const baseModId=rawModId?rawModId.replace(/_\d+$/,''):null;
  const eq={id:editingEqId||uid(),missionId:currentMissionId,moduleId:baseModId,moduleContext:rawModId,category:v('field-category'),name,brand:v('field-brand'),model:v('field-model'),serial:v('field-serial'),year:vn('field-year'),power:v('field-power'),fluid:v('field-fluid'),location:v('field-location'),condition:v('field-condition'),notes:v('field-notes'),ocrRaw:v('field-ocr-raw'),photo:attachedPhoto||null,updatedAt:now(),createdAt:editingEqId?(equipments.find(e=>e.id===editingEqId)?.createdAt||now()):now()};
  await dbPut('equipments',eq);if(editingEqId){const i=equipments.findIndex(e=>e.id===editingEqId);if(i>=0)equipments[i]=eq;else equipments.push(eq);}else equipments.push(eq);
  capturedImage=null;document.getElementById('modal-equipment').classList.add('hidden');
  renderFormsZone();showToast(editingEqId?'Équipement mis à jour ✓':'Équipement ajouté ✓','success');
}
async function deleteEquipment(id){if(!confirm('Supprimer ?'))return;await dbDel('equipments',id);equipments=equipments.filter(e=>e.id!==id);renderSynthesis();showToast('Supprimé');}

document.getElementById('btn-attach-photo')?.addEventListener('click',()=>document.getElementById('attach-file-input').click());
document.getElementById('attach-file-input')?.addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const reader=new FileReader();reader.onload=ev=>{attachedPhoto=ev.target.result;const img=document.getElementById('field-photo-preview');img.src=attachedPhoto;img.classList.remove('hidden');};reader.readAsDataURL(f);e.target.value='';
});

// ── OCR ───────────────────────────────────────────────────────────
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}}
async function analyzeWithTesseract(dataURL,statusEl){const{data}=await Tesseract.recognize(dataURL,'fra+eng',{logger:m=>{if(m.status==='recognizing text'&&statusEl.textContent!==undefined)statusEl.textContent=`🔍 OCR: ${Math.round(m.progress*100)}%`;}});return parseOCRText(data.text);}
function parseOCRText(text){const r={ocrRaw:text};const brands=['Viessmann','De Dietrich','Buderus','Saunier Duval','Frisquet','Bosch','Remeha','Atlantic','Ariston','Chaffoteaux','Daikin','Grundfos','Wilo','DAB','Siemens','Honeywell','Danfoss','Weishaupt','Riello','Elco','Baltur'];for(const b of brands)if(text.toUpperCase().includes(b.toUpperCase())){r.brand=b;break;}const snM=text.match(/(?:S[\.\/]?N|N[°o]?\s*[Ss]érie|SERIAL)[:\s#]*([A-Z0-9\-\/]{6,20})/i);if(snM)r.serial=snM[1].trim();const pwM=text.match(/(\d[\d\s,\.]*)\s*k[Ww]/);if(pwM)r.power=pwM[1].trim()+' kW';const yrM=text.match(/\b(19[89]\d|20[0-3]\d)\b/);if(yrM)r.year=parseInt(yrM[1]);const mdM=text.match(/(?:TYPE|MODELE|MODEL)[:\s]*([A-Z0-9\s\-\.]{3,25})/i);if(mdM)r.model=mdM[1].trim();if(/gaz\s*naturel/i.test(text))r.fluid='GAZ';else if(/propane/i.test(text))r.fluid='Propane';else if(/fioul|fuel/i.test(text))r.fluid='Fioul';return r;}
async function analyzeWithGemini(dataURL){if(!geminiKey)throw new Error('No key');const base64=dataURL.split(',')[1],mime=dataURL.split(';')[0].split(':')[1];const prompt=`Analyse cette plaque signalétique. JSON uniquement sans backtick: {"name":"","brand":"","model":"","serial":"","year":null,"power":"","fluid":"","category":"chaudiere|bruleur|pompe|vanne|echangeur|ballon|electrique|autre","condition":"bon|correct|degrade|hs","ocrRaw":""}`;const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{inline_data:{mime_type:mime,data:base64}},{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:512}})});if(!resp.ok)throw new Error('Gemini '+resp.status);const data=await resp.json();return JSON.parse(data.candidates[0].content.parts[0].text.replace(/```json|```/g,'').trim());}
function prefillModal(data){if(data.name)document.getElementById('field-name').value=data.name;if(data.brand)document.getElementById('field-brand').value=data.brand;if(data.model)document.getElementById('field-model').value=data.model;if(data.serial)document.getElementById('field-serial').value=data.serial;if(data.year)document.getElementById('field-year').value=data.year;if(data.power)document.getElementById('field-power').value=data.power;if(data.fluid)document.getElementById('field-fluid').value=data.fluid;if(data.ocrRaw)document.getElementById('field-ocr-raw').value=data.ocrRaw;if(data.condition)document.getElementById('field-condition').value=data.condition;if(data.category){const sel=document.getElementById('field-category');if([...sel.options].some(o=>o.value===data.category))sel.value=data.category;}showToast('Plaque analysée ✓','success');}

// ── NOTES & PHOTOS ────────────────────────────────────────────────
async function loadNotes(){const rec=await dbGet('notes',currentMissionId);document.getElementById('notes-textarea').value=rec?.text||'';document.getElementById('notes-saved').textContent='';}
async function saveNotes(){const text=document.getElementById('notes-textarea').value;await dbPut('notes',{id:currentMissionId,text,updatedAt:now()});document.getElementById('notes-saved').textContent='✓ Sauvegardé';setTimeout(()=>{const el=document.getElementById('notes-saved');if(el)el.textContent='';},2000);}
async function getPhotoReport(){const rec=await dbGet('photoreport',currentMissionId);return rec?.rows||[];}
async function savePhotoReport(rows){await dbPut('photoreport',{id:currentMissionId,rows,updatedAt:now()});}
async function renderPhotoRows(){
  const rows=await getPhotoReport();const container=document.getElementById('photo-rows-container');const empty=document.getElementById('photo-empty');container.innerHTML='';
  if(!rows.length){empty.style.display='flex';return;}empty.style.display='none';
  rows.forEach((row,idx)=>{
    const div=document.createElement('div');div.className='photo-row';
    div.innerHTML=`<div class="photo-row-left"><div class="photo-row-num">Photo ${idx+1}</div><div id="photo-thumb-${idx}" style="width:100%"></div><div style="display:flex;gap:6px;width:100%"><button class="photo-add-btn" style="flex:1" data-idx="${idx}" data-src="camera">📷</button><button class="photo-add-btn" style="flex:1" data-idx="${idx}" data-src="gallery">🖼️</button></div></div><div class="photo-row-right"><textarea class="photo-comment-textarea" data-idx="${idx}" placeholder="Commentaire...">${esc(row.comment||'')}</textarea><div class="photo-row-actions"><button class="photo-del-row" data-idx="${idx}">🗑️ Supprimer</button></div></div>`;
    container.appendChild(div);
    const tc=document.getElementById('photo-thumb-'+idx);
    if(row.photo){tc.innerHTML=`<div class="photo-thumb-container"><img class="photo-thumb" src="${row.photo}"/><button class="photo-remove-btn" data-idx="${idx}">✕</button></div>`;tc.querySelector('.photo-remove-btn').addEventListener('click',async()=>{const rows=await getPhotoReport();rows[idx].photo=null;await savePhotoReport(rows);renderPhotoRows();});}
    div.querySelectorAll('[data-src]').forEach(btn=>{btn.addEventListener('click',()=>{const inp=document.createElement('input');inp.type='file';inp.accept='image/*';if(btn.dataset.src==='camera')inp.capture='environment';inp.addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=async ev=>{const rows=await getPhotoReport();rows[idx].photo=ev.target.result;await savePhotoReport(rows);renderPhotoRows();};reader.readAsDataURL(f);});inp.click();});});
    div.querySelector('.photo-comment-textarea').addEventListener('change',async e=>{const rows=await getPhotoReport();rows[idx].comment=e.target.value;await savePhotoReport(rows);});
    div.querySelector('.photo-del-row').addEventListener('click',async()=>{if(!confirm('Supprimer cette ligne ?'))return;const rows=await getPhotoReport();rows.splice(idx,1);await savePhotoReport(rows);renderPhotoRows();});
  });
}
async function addPhotoRow(){const rows=await getPhotoReport();rows.push({photo:null,comment:''});await savePhotoReport(rows);renderPhotoRows();}

// ── INCIDENT ──────────────────────────────────────────────────────
async function loadIncidentData(){const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,objet:'',fields:[],conclusion:''};document.getElementById('incident-objet').value=rec.objet||'';document.getElementById('incident-conclusion').value=rec.conclusion||'';renderIncidentFields(rec.fields||[]);['incident-objet','incident-conclusion'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('change',saveIncidentData);});}
function renderIncidentFields(fields){const list=document.getElementById('incident-fields-list');if(!list)return;list.innerHTML='';fields.forEach((f,idx)=>{const row=document.createElement('div');row.className='incident-field-row';row.innerHTML=`<span class="incident-field-label" style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${esc(f.label)}</span>`;const inp=document.createElement('input');inp.type='text';inp.value=f.value||'';inp.placeholder='Valeur...';inp.style.cssText='background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text-primary);font-size:13px;outline:none;width:120px';inp.addEventListener('change',async()=>{const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};rec.fields[idx].value=inp.value;await dbPut('incidentdata',rec);});const del=document.createElement('button');del.className='incident-field-del';del.textContent='✕';del.addEventListener('click',async()=>{const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};rec.fields.splice(idx,1);await dbPut('incidentdata',rec);renderIncidentFields(rec.fields);});row.appendChild(inp);row.appendChild(del);list.appendChild(row);});}
async function addIncidentField(){const label=document.getElementById('incident-new-field').value.trim();if(!label)return;const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,objet:'',fields:[],conclusion:''};if(!rec.fields)rec.fields=[];rec.fields.push({label,value:''});await dbPut('incidentdata',rec);document.getElementById('incident-new-field').value='';renderIncidentFields(rec.fields);}
async function saveIncidentData(){const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};rec.objet=document.getElementById('incident-objet').value;rec.conclusion=document.getElementById('incident-conclusion').value;await dbPut('incidentdata',rec);}

// ── SETTINGS ─────────────────────────────────────────────────────
function renderSettings(){
  const ki=document.getElementById('gemini-key-input');if(ki&&geminiKey)ki.value=geminiKey;
  const cl=document.getElementById('categories-list');cl.innerHTML='';const wrap=document.createElement('div');wrap.className='categories-list';
  categories.forEach(cat=>{const item=document.createElement('div');item.className='cat-item';item.innerHTML=`<div class="cat-dot" style="background:${cat.color}"></div><span style="flex:1;font-size:13px">${esc(cat.name)}</span>`;if(!DEFAULT_CATEGORIES.find(d=>d.id===cat.id)){const del=document.createElement('button');del.className='cat-del';del.textContent='✕';del.addEventListener('click',()=>deleteCategory(cat.id));item.appendChild(del);}wrap.appendChild(item);});cl.appendChild(wrap);
  // Stats
  document.getElementById('stats-container').innerHTML=`<div class="stats-grid"><div class="stat-item"><div class="stat-value">${sites.length}</div><div class="stat-label">SITES</div></div><div class="stat-item"><div class="stat-value">${missions.length}</div><div class="stat-label">MISSIONS</div></div><div class="stat-item"><div class="stat-value">${equipments.length}</div><div class="stat-label">MATÉRIELS</div></div><div class="stat-item"><div class="stat-value">${users.length}</div><div class="stat-label">UTILISATEURS</div></div></div>`;
  // Users in settings
  renderSettingsUsers();
}
function renderSettingsUsers(){
  let usersPanel=document.getElementById('settings-users-panel');
  if(!usersPanel){
    usersPanel=document.createElement('div');usersPanel.id='settings-users-panel';usersPanel.className='settings-card';
    usersPanel.innerHTML=`<h3>👤 Utilisateurs</h3><div id="users-list-settings" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div><div style="display:flex;gap:8px"><input type="text" id="new-user-prenom" placeholder="Prénom" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none"/><input type="text" id="new-user-nom" placeholder="Nom" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none"/></div><input type="text" id="new-user-email" placeholder="Email" style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;margin-top:6px"/><button class="btn-primary" id="btn-add-user" style="margin-top:6px">+ Ajouter utilisateur</button>`;
    document.getElementById('stats-container').parentElement?.after(usersPanel);
    document.getElementById('btn-add-user').addEventListener('click',addUser);
  }
  const list=document.getElementById('users-list-settings');list.innerHTML='';
  users.forEach(u=>{
    const item=document.createElement('div');item.className='user-card'+(currentUser?.id===u.id?' active-user':'');
    item.innerHTML=`<div class="user-avatar">${(u.prenom||u.nom||'?')[0].toUpperCase()}</div><div class="user-info"><div class="user-name">${esc(u.prenom+' '+u.nom)}</div><div class="user-email">${esc(u.email||'')}</div></div>`;
    const del=document.createElement('button');del.className='card-btn';del.textContent='🗑️';del.addEventListener('click',async()=>{await dbDel('users',u.id);users=users.filter(x=>x.id!==u.id);if(currentUser?.id===u.id){currentUser=null;await dbDel('config','currentUser');}renderSettingsUsers();});
    const selBtn=document.createElement('button');selBtn.className='btn-sm btn-primary';selBtn.style.cssText='width:auto;padding:5px 10px;font-size:11px';selBtn.textContent='Choisir';
    selBtn.addEventListener('click',async()=>{currentUser=u;await dbPut('config',{key:'currentUser',value:u});showToast(`Connecté : ${u.prenom} ${u.nom}`,'success');renderSettingsUsers();});
    item.appendChild(selBtn);item.appendChild(del);list.appendChild(item);
  });
}
async function addUser(){
  const prenom=document.getElementById('new-user-prenom').value.trim();
  const nom=document.getElementById('new-user-nom').value.trim();
  const email=document.getElementById('new-user-email').value.trim();
  if(!prenom&&!nom){showToast('Prénom ou nom obligatoire','error');return;}
  const u={id:uid(),prenom,nom,email};await dbPut('users',u);users.push(u);
  document.getElementById('new-user-prenom').value='';document.getElementById('new-user-nom').value='';document.getElementById('new-user-email').value='';
  renderSettingsUsers();showToast('Utilisateur ajouté ✓','success');
}
async function saveGeminiKey(){geminiKey=document.getElementById('gemini-key-input').value.trim();await dbPut('config',{key:'geminiKey',value:geminiKey});const el=document.getElementById('gemini-status');el.textContent=geminiKey?'✓ Clé sauvegardée':'Clé supprimée';el.className='settings-status'+(geminiKey?' success':'');setTimeout(()=>{if(el){el.textContent='';el.className='settings-status';}},3000);showToast(geminiKey?'Clé Gemini sauvegardée ✓':'Clé supprimée','success');}
async function addCategory(){const inp=document.getElementById('new-cat-input'),name=inp.value.trim();if(!name)return;const colors=['#f43f5e','#f97316','#eab308','#84cc16','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#d946ef'];const id=name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')+'_'+Date.now();categories.push({id,name,color:colors[categories.length%colors.length]});await dbPut('config',{key:'categories',value:categories});inp.value='';renderSettings();}
async function deleteCategory(id){if(equipments.some(e=>e.category===id)){showToast('Catégorie utilisée','error');return;}categories=categories.filter(c=>c.id!==id);await dbPut('config',{key:'categories',value:categories});renderSettings();}
async function clearAll(){if(!confirm('Effacer TOUTES les données ?'))return;for(const s of sites)await dbDel('sites',s.id);for(const m of missions)await dbDel('missions',m.id);for(const e of equipments)await dbDel('equipments',e.id);for(const f of formDataStore)await dbDel('formdata',f.id);sites=[];missions=[];equipments=[];formDataStore=[];renderSettings();renderSites();showToast('Données effacées');}
function backupData(){download(JSON.stringify({version:4,app:'adiatool',exportedAt:new Date().toISOString(),sites,missions,equipments:equipments.map(e=>({...e,photo:null})),formDataStore,users,categories},null,2),`adiatool_backup_${today()}.json`,'application/json');showToast('Sauvegarde téléchargée');}
async function restoreData(file){try{const data=JSON.parse(await file.text());if(!data.sites)throw new Error('Format invalide');if(!confirm(`Restaurer ${data.sites.length} sites ?`))return;for(const s of sites)await dbDel('sites',s.id);for(const m of missions)await dbDel('missions',m.id);for(const e of equipments)await dbDel('equipments',e.id);for(const f of formDataStore)await dbDel('formdata',f.id);sites=[];missions=[];equipments=[];formDataStore=[];for(const s of data.sites){await dbPut('sites',s);sites.push(s);}for(const m of data.missions){await dbPut('missions',m);missions.push(m);}for(const e of data.equipments){await dbPut('equipments',e);equipments.push(e);}if(data.formDataStore)for(const f of data.formDataStore){await dbPut('formdata',f);formDataStore.push(f);}if(data.users)for(const u of data.users){await dbPut('users',u);users.push(u);}if(data.categories){categories=data.categories;await dbPut('config',{key:'categories',value:categories});}renderSettings();renderSites();showToast('Restauration réussie ✓','success');}catch(e){showToast('Erreur: '+e.message,'error');}}

// ── EXPORTS (shortened - same as v3) ─────────────────────────────
function exportCSV(){const mission=missions.find(m=>m.id===currentMissionId);const site=sites.find(s=>s.id===mission?.siteId);const mEqs=equipments.filter(e=>e.missionId===currentMissionId);if(!mEqs.length){showToast('Aucun matériel','error');return;}const headers=['Code affaire','Site','Type mission','Module','Catégorie','Désignation','Marque','Modèle','N° Série','Année','Puissance','Fluide','Localisation','État','Observations'];const rows=mEqs.map(eq=>{const cat=categories.find(c=>c.id===eq.category)?.name||eq.category;const modLabel=FORM_MODULES.find(m=>m.id===eq.moduleId)?.label||eq.moduleId||'';return[site?.codeAffaire,site?.name,TL[mission?.type],modLabel,cat,eq.name,eq.brand,eq.model,eq.serial,eq.year,eq.power,eq.fluid,eq.location,{bon:'Bon état',correct:'Correct',degrade:'Dégradé',hs:'Hors service'}[eq.condition],eq.notes].map(x=>`"${(x||'').toString().replace(/"/g,'""')}"`);}); download('\uFEFF'+[headers.join(';'),...rows.map(r=>r.join(';'))].join('\r\n'),`adiatool_materiels_${today()}.csv`,'text/csv;charset=utf-8;');showToast('CSV exporté');}
async function exportExcel(){showToast('Export Excel — utilisez le PDF pour un rapport complet','');exportCSV();}
async function exportWord(){showToast('Export Word disponible via le rapport PDF','');}
async function exportPDF(){showToast('Export PDF — fonctionnalité complète en cours','');}
async function exportIncidentPDF(){showToast('Rapport d\'incident PDF — en cours','');}

// ── XLSX / UTILS ──────────────────────────────────────────────────
const uid=()=>crypto.randomUUID();const now=()=>new Date().toISOString();const today=()=>new Date().toISOString().slice(0,10);
const esc=s=>(s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const v=id=>(document.getElementById(id)?.value||'').trim();const vn=id=>{const n=parseFloat(document.getElementById(id)?.value);return isNaN(n)?null:n;};
const slugify=s=>(s||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,30);
function download(content,filename,mime){const blob=content instanceof Blob?content:new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let tt;function showToast(msg,type=''){const el=document.getElementById('toast');el.textContent=msg;el.className='toast'+(type?' '+type:'');el.classList.remove('hidden');if(tt)clearTimeout(tt);tt=setTimeout(()=>el.classList.add('hidden'),2800);}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
init().catch(console.error);
