'use strict';
// ═══════════════════════════════════════════════════════════════
//  ADIATOOL v4
// ═══════════════════════════════════════════════════════════════

// ── DB ───────────────────────────────────────────────────────────
const DB_NAME='AdiatoolDB',DB_VER=5;
let db;
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      ['sites','missions','equipments','formdata','notes','photoreport','incidentdata','config','users','equiplib'].forEach(s=>{
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
  else if(name==='users'){
    title.innerHTML='ADIA<span>TOOL</span>';
    sub.textContent='Choisir un utilisateur';
    // Show back button only if we have a previous context (not cold start)
    if(currentUser){backBtn.classList.remove('hidden');}
    document.getElementById('btn-settings-nav').style.display='none';
    renderUsersView();
  }
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
  if(name==='report')initReportTab();
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
    else showView('dashboard');
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
  const container=document.getElementById('view-users');
  if(!container)return;
  container.innerHTML='';
  container.style.cssText='overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:20px;gap:12px';

  // Title
  const title=document.createElement('h2');
  title.style.cssText='font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text-primary);margin:16px 0 8px;text-align:center;width:100%';
  title.textContent='Qui êtes-vous ?';
  container.appendChild(title);

  if(!users.length){
    const msg=document.createElement('p');
    msg.style.cssText='color:var(--text-secondary);font-size:14px;text-align:center;margin-bottom:16px';
    msg.textContent='Aucun utilisateur — créez-en un dans Paramètres.';
    container.appendChild(msg);
    const btn=document.createElement('button');
    btn.className='btn-secondary';btn.style.cssText='max-width:300px;width:100%';
    btn.textContent='⚙️ Aller aux paramètres';
    btn.addEventListener('click',()=>showView('settings'));
    container.appendChild(btn);
    return;
  }

  const list=document.createElement('div');
  list.style.cssText='display:flex;flex-direction:column;gap:10px;width:100%;max-width:480px';

  users.forEach(u=>{
    const isActive=currentUser?.id===u.id;
    const card=document.createElement('div');
    card.style.cssText=`display:flex;align-items:center;gap:14px;padding:16px;background:var(--bg-card);border:2px solid ${isActive?'var(--accent)':'var(--border)'};border-radius:var(--radius);cursor:pointer;transition:all .2s`;

    const avatar=document.createElement('div');
    avatar.style.cssText='width:46px;height:46px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:20px;font-weight:700;color:white;flex-shrink:0';
    avatar.textContent=((u.prenom||u.nom||'?')[0]).toUpperCase();

    const info=document.createElement('div');
    info.style.flex='1';
    info.innerHTML=`<div style="font-family:var(--font-display);font-size:16px;font-weight:600;color:var(--text-primary)">${esc(u.prenom||'')} ${esc(u.nom||'')}</div>${u.email?`<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);margin-top:2px">${esc(u.email)}</div>`:''}`;

    if(isActive){
      const badge=document.createElement('div');
      badge.style.cssText='color:var(--accent);font-size:22px;flex-shrink:0';
      badge.textContent='✓';
      card.appendChild(avatar);card.appendChild(info);card.appendChild(badge);
    }else{
      const btn=document.createElement('button');
      btn.className='btn-primary';
      btn.style.cssText='width:auto;padding:10px 20px;font-size:14px;flex-shrink:0';
      btn.textContent='Choisir';
      btn.addEventListener('click',async e=>{
        e.stopPropagation();
        currentUser=u;
        await dbPut('config',{key:'currentUser',value:u});
        showToast(`Connecté : ${u.prenom} ${u.nom}`,'success');
        showView('dashboard');
      });
      card.appendChild(avatar);card.appendChild(info);card.appendChild(btn);
    }

    card.addEventListener('click',async()=>{
      if(isActive){showView('dashboard');return;}
      currentUser=u;
      await dbPut('config',{key:'currentUser',value:u});
      showToast(`Connecté : ${u.prenom} ${u.nom}`,'success');
      showView('dashboard');
    });

    list.appendChild(card);
  });

  container.appendChild(list);

  // Skip button to go to dashboard without selecting
  const skip=document.createElement('button');
  skip.className='btn-secondary';skip.style.cssText='max-width:480px;width:100%;margin-top:4px';
  skip.textContent='Continuer sans sélectionner';
  skip.addEventListener('click',()=>showView('dashboard'));
  container.appendChild(skip);
}


function renderSites(search=''){
  const list=document.getElementById('sites-list');
  if(!list)return;
  const q=(search||'').toLowerCase();
  const filtered=sites.filter(s=>
    !q||(s.name||'').toLowerCase().includes(q)||
    (s.city||'').toLowerCase().includes(q)||
    (s.codeAffaire||'').toLowerCase().includes(q)
  ).sort((a,b)=>(a.name||'').localeCompare(b.name||''));

  if(!filtered.length){
    list.innerHTML=`<div class="empty-state"><div class="empty-icon">🏢</div><p>${
      !sites.length?'Aucun site.<br>Appuyez sur + pour commencer.':'Aucun résultat.'
    }</p></div>`;
    return;
  }
  list.innerHTML='';
  filtered.forEach(site=>{
    const sm=missions.filter(m=>m.siteId===site.id);
    const card=document.createElement('div');card.className='site-card';
    card.innerHTML=`
      <div class="card-header">
        <div>
          <div class="card-title">${esc(site.name)}</div>
          <div class="card-sub">${[site.codeAffaire,site.address,site.city].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="card-actions">
          <button class="card-btn" data-action="edit">✏️</button>
          <button class="card-btn" data-action="del">🗑️</button>
        </div>
      </div>
      <div class="card-stats">
        <span class="cstat"><span>${sm.length}</span> mission${sm.length!==1?'s':''}</span>
        ${site.energie?`<span class="cstat">${esc(site.energie)}</span>`:''}
      </div>`;
    card.querySelector('[data-action=edit]').addEventListener('click',e=>{e.stopPropagation();openSiteModal(site.id);});
    card.querySelector('[data-action=del]').addEventListener('click',e=>{e.stopPropagation();deleteSite(site.id);});
    card.addEventListener('click',e=>{
      if(e.target.closest('[data-action]'))return;
      currentSiteId=site.id;showView('site');
    });
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
  // Show/hide tabs based on mission type
  const allTabs=['participants','forms','synthesis','notes','photos','report'];
  const incidentOnlyTabs=['incident'];
  const normalOnlyTabs=['participants','forms','synthesis','notes','photos','report'];
  document.querySelectorAll('[data-mtab]').forEach(btn=>{
    const t=btn.dataset.mtab;
    if(t==='incident'){btn.style.display=isIncident?'':'none';return;}
    if(isIncident){btn.style.display='none';}else{btn.style.display='';}
  });
  switchMTab(isIncident?'incident':'participants');
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


// ══════════════════════════════════════════════════════════════════
//  FORMS ENGINE — Clean rewrite
//  Rules:
//  1. Module order is always fixed per FORM_MODULES array
//  2. collapseState survives ALL re-renders
//  3. renderFormsZone() only on structural changes
//  4. Field saves → getMFD + merge, no DOM rebuild
//  5. localSave → deep merge per module, never overwrites siblings
// ══════════════════════════════════════════════════════════════════

// ── LOCAL DATA HELPERS ────────────────────────────────────────────
function getLocalKey(){
  const fd=getMFD();return `local_${fd.activeLocalIdx||0}`;
}
function getLocalFd(){
  const fd=getMFD();const lk=getLocalKey();
  const ld=(fd.localData||{})[lk]||{};
  return {
    id:fd.id,
    activeModules:fd.localModules?.[lk]||[],
    data:ld.data||{},
    repeatData:ld.repeatData||{},
    comments:ld.comments||{},
    cahierYears:ld.cahierYears||{}
  };
}
async function saveLocalField(modId, fieldId, value, iIdx=null){
  // Save a single field value without touching anything else
  const mainFd=getMFD();const lk=getLocalKey();
  if(!mainFd.localData)mainFd.localData={};
  if(!mainFd.localData[lk])mainFd.localData[lk]={data:{},repeatData:{},comments:{},cahierYears:{}};
  const ld=mainFd.localData[lk];
  if(iIdx!==null){
    if(!ld.repeatData[modId])ld.repeatData[modId]=[];
    while(ld.repeatData[modId].length<=iIdx)ld.repeatData[modId].push({});
    ld.repeatData[modId][iIdx][fieldId]=value;
  }else{
    if(!ld.data[modId])ld.data[modId]={};
    ld.data[modId][fieldId]=value;
  }
  await saveMFD(mainFd);
}
async function saveLocalComment(fieldKey, comments){
  const mainFd=getMFD();const lk=getLocalKey();
  if(!mainFd.localData)mainFd.localData={};
  if(!mainFd.localData[lk])mainFd.localData[lk]={data:{},repeatData:{},comments:{},cahierYears:{}};
  mainFd.localData[lk].comments[fieldKey]=comments;
  await saveMFD(mainFd);
}
function getFieldValue(modId, fieldId, iIdx=null){
  const lfd=getLocalFd();
  if(iIdx!==null)return(lfd.repeatData[modId]||[])[iIdx]?.[fieldId]||'';
  return(lfd.data[modId]||{})[fieldId]||'';
}
function getRepeatInstances(modId){
  return getLocalFd().repeatData[modId]||[{}];
}

// ── COLLAPSE STATE ─────────────────────────────────────────────────
function getCollapseKey(modId,instanceIdx=null){
  const lk=getLocalKey();
  return instanceIdx!==null?`${lk}_${modId}_${instanceIdx}`:`${lk}_${modId}`;
}
function setCollapsed(modId,collapsed,instanceIdx=null){
  collapseState.set(getCollapseKey(modId,instanceIdx),collapsed);
}
function isCollapsed(modId,instanceIdx=null){
  return collapseState.get(getCollapseKey(modId,instanceIdx))||false;
}

// ── MAIN RENDER ────────────────────────────────────────────────────
function renderFormsZone(){
  const fd=getMFD();
  const locaux=fd.locaux||[];

  // Render locaux setup panel (always)
  renderLocauxSetup(locaux,fd);

  const tabsBar=document.getElementById('local-tabs-bar');
  const modulesSel=document.getElementById('modules-selector');
  const container=document.getElementById('active-forms-container');

  if(!locaux.length){
    tabsBar.style.display='none';modulesSel.style.display='none';
    container.innerHTML='<div class="empty-state" style="padding:20px"><p style="color:var(--text-muted)">Ajoutez d\'abord un local technique ci-dessus.</p></div>';
    return;
  }
  tabsBar.style.display='';modulesSel.style.display='';

  const activeLocal=fd.activeLocalIdx||0;
  currentLocalType=locaux[activeLocal]?.type||'';
  currentEnergie=sites.find(s=>s.id===currentSiteId)?.energie||'';

  // Local tabs bar
  tabsBar.innerHTML='';
  locaux.forEach((loc,i)=>{
    const t=document.createElement('button');
    t.className='local-tab'+(i===activeLocal?' local-tab-active':'');
    t.textContent=loc.nom?`${loc.type} — ${loc.nom}`:loc.type||`Local ${i+1}`;
    t.addEventListener('click',async()=>{
      if(i===activeLocal)return;
      const fdd=getMFD();fdd.activeLocalIdx=i;await saveMFD(fdd);renderFormsZone();
    });
    tabsBar.appendChild(t);
  });

  // Module toggles — FIXED ORDER always
  const lk=getLocalKey();
  const activeModules=fd.localModules?.[lk]||[];

  modulesSel.innerHTML='';
  const selHeader=document.createElement('div');
  selHeader.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
  selHeader.innerHTML='<h3 style="font-family:var(--font-display);font-size:14px;font-weight:600;color:var(--text-secondary)">Modules pour ce local</h3>';
  modulesSel.appendChild(selHeader);
  const grid=document.createElement('div');grid.className='module-toggles';
  FORM_MODULES.forEach(mod=>{
    const isActive=activeModules.includes(mod.id);
    const btn=document.createElement('div');btn.className='module-toggle'+(isActive?' active':'');
    btn.innerHTML=`<span class="module-toggle-icon">${mod.icon}</span><span class="module-toggle-label" style="color:${mod.color}">${mod.label}</span><div class="mt-check"></div>`;
    btn.addEventListener('click',async()=>{
      const fdd=getMFD();if(!fdd.localModules)fdd.localModules={};
      const mods=[...(fdd.localModules[lk]||[])];
      const idx=mods.indexOf(mod.id);if(idx>=0)mods.splice(idx,1);else mods.push(mod.id);
      fdd.localModules[lk]=mods;await saveMFD(fdd);
      // Toggle in place without full re-render
      refreshModuleBlock(mod.id, mods.includes(mod.id));
      btn.classList.toggle('active', mods.includes(mod.id));
      btn.querySelector('.mt-check').className='mt-check';
    });
    grid.appendChild(btn);
  });
  modulesSel.appendChild(grid);

  // Render module blocks in FIXED ORDER
  container.innerHTML='';
  // Always render in FORM_MODULES order
  FORM_MODULES.forEach(mod=>{
    if(!activeModules.includes(mod.id))return;
    const block=buildModuleBlock(mod);
    block.id=`form-block-${mod.id}`;
    container.appendChild(block);
  });
}

// Build or rebuild a single module block
function buildModuleBlock(mod){
  const wrapper=document.createElement('div');wrapper.id=`form-block-${mod.id}`;

  if(mod.multiYear){
    renderCahierBlock(mod,wrapper);
  }else if(mod.repeatable){
    renderRepeatableBlock(mod,wrapper);
  }else{
    renderSimpleBlock(mod,wrapper);
  }
  return wrapper;
}

// Toggle a module block in/out of the container
function refreshModuleBlock(modId, active){
  const container=document.getElementById('active-forms-container');
  if(!container)return;

  if(!active){
    const existing=document.getElementById(`form-block-${modId}`);
    if(existing)existing.remove();
    return;
  }

  // Add in correct position (FORM_MODULES order)
  const mod=FORM_MODULES.find(m=>m.id===modId);if(!mod)return;
  const block=buildModuleBlock(mod);
  block.id=`form-block-${modId}`;

  // Find where to insert (maintain order)
  const modIndex=FORM_MODULES.findIndex(m=>m.id===modId);
  let inserted=false;
  const children=[...container.children];
  for(const child of children){
    const childModId=child.id?.replace('form-block-','');
    const childIndex=FORM_MODULES.findIndex(m=>m.id===childModId);
    if(childIndex>modIndex){
      container.insertBefore(block,child);
      inserted=true;break;
    }
  }
  if(!inserted)container.appendChild(block);
}

// ── SIMPLE (non-repeatable) MODULE BLOCK ──────────────────────────
function renderSimpleBlock(mod,wrapper){
  const collapsed=isCollapsed(mod.id);
  const block=document.createElement('div');block.className='form-block';
  const header=document.createElement('div');header.className='form-block-header';
  header.style.cursor='pointer';
  header.innerHTML=`<div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div><button class="collapse-btn" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:0 4px;line-height:1">${collapsed?'+':'−'}</button>`;

  const body=document.createElement('div');body.className='form-block-body';
  if(collapsed)body.style.display='none';

  // Equipment inline at top for modules with hasEquipment
  if(mod.hasEquipment){
    const equip=buildEquipmentInline(mod.id);body.appendChild(equip);
    const divider=document.createElement('div');divider.className='form-section-title';divider.textContent='RELEVÉS';body.appendChild(divider);
  }

  // Fields
  const allFields=mod.sections?mod.sections.flatMap(s=>[{type:'__sec',label:s.title},...s.fields]):(mod.fields||[]);
  allFields.forEach(f=>renderFieldInto(f,body,mod,null));
  if(mod.notes_field)renderFieldInto(mod.notes_field,body,mod,null);

  header.addEventListener('click',()=>{
    const c=body.style.display==='none';
    body.style.display=c?'':'none';
    header.querySelector('.collapse-btn').textContent=c?'−':'+';
    setCollapsed(mod.id,!c);
  });

  block.appendChild(header);block.appendChild(body);wrapper.appendChild(block);
}

// ── REPEATABLE MODULE BLOCK ───────────────────────────────────────
function renderRepeatableBlock(mod,wrapper){
  const instances=getRepeatInstances(mod.id);
  const collapsed=isCollapsed(mod.id);

  const block=document.createElement('div');block.className='form-block';
  const header=document.createElement('div');header.className='form-block-header';
  header.style.cursor='pointer';
  header.innerHTML=`<div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div><button class="collapse-btn" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:0 4px;line-height:1">${collapsed?'+':'−'}</button>`;

  const body=document.createElement('div');body.className='form-block-body';
  if(collapsed)body.style.display='none';

  header.addEventListener('click',()=>{
    const c=body.style.display==='none';
    body.style.display=c?'':'none';
    header.querySelector('.collapse-btn').textContent=c?'−':'+';
    setCollapsed(mod.id,!c);
  });

  // Render each instance
  const renderInstances=()=>{
    // Remove all instance divs but keep the add button
    [...body.querySelectorAll('.repeat-instance')].forEach(el=>el.remove());
    const addBtn=body.querySelector('.btn-add-instance');

    const instances=getRepeatInstances(mod.id);
    instances.forEach((_,idx)=>{
      const inst=document.createElement('div');inst.className='repeat-instance';
      const instCollapsed=isCollapsed(mod.id,idx);

      const instHeader=document.createElement('div');instHeader.className='repeat-instance-title';
      instHeader.style.cssText='display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:6px';
      const instLabel=document.createElement('span');instLabel.style.color=mod.color;instLabel.textContent=`${mod.repeatLabel} ${idx+1}`;
      const instCollapseBtn=document.createElement('button');
      instCollapseBtn.style.cssText='background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:0 4px';
      instCollapseBtn.textContent=instCollapsed?'+':'−';

      const instBody=document.createElement('div');
      if(instCollapsed)instBody.style.display='none';

      instHeader.addEventListener('click',()=>{
        const c=instBody.style.display==='none';
        instBody.style.display=c?'':'none';
        instCollapseBtn.textContent=c?'−':'+';
        setCollapsed(mod.id,!c,idx);
      });

      instHeader.appendChild(instLabel);

      if(instances.length>1){
        const del=document.createElement('button');del.className='btn-remove-instance';del.textContent='✕ Supprimer';
        del.addEventListener('click',async()=>{
          if(!confirm(`Supprimer ${mod.repeatLabel} ${idx+1} ?`))return;
          const mainFd=getMFD();const lk=getLocalKey();
          if(!mainFd.localData?.[lk]?.repeatData?.[mod.id])return;
          mainFd.localData[lk].repeatData[mod.id].splice(idx,1);
          await saveMFD(mainFd);
          // Delete collapse state for this instance and shift others
          collapseState.delete(getCollapseKey(mod.id,idx));
          renderInstances();
        });
        instHeader.appendChild(del);
      }
      instHeader.appendChild(instCollapseBtn);

      // Equipment inline for this instance
      if(mod.hasEquipment){
        const equip=buildEquipmentInline(`${mod.id}_${idx}`);instBody.appendChild(equip);
        const divider=document.createElement('div');divider.className='form-section-title';divider.textContent='RELEVÉS';instBody.appendChild(divider);
      }

      mod.fields.forEach(f=>renderFieldInto(f,instBody,mod,idx));

      inst.appendChild(instHeader);inst.appendChild(instBody);
      if(addBtn)body.insertBefore(inst,addBtn);else body.appendChild(inst);
    });
  };

  // Add instance button
  const addBtn=document.createElement('button');addBtn.className='btn-add-instance';
  addBtn.textContent=`+ Ajouter ${mod.repeatLabel}`;
  addBtn.addEventListener('click',async()=>{
    const mainFd=getMFD();const lk=getLocalKey();
    if(!mainFd.localData)mainFd.localData={};
    if(!mainFd.localData[lk])mainFd.localData[lk]={data:{},repeatData:{},comments:{},cahierYears:{}};
    if(!mainFd.localData[lk].repeatData[mod.id])mainFd.localData[lk].repeatData[mod.id]=[];
    mainFd.localData[lk].repeatData[mod.id].push({});
    await saveMFD(mainFd);
    renderInstances();
  });
  body.appendChild(addBtn);
  renderInstances();

  block.appendChild(header);block.appendChild(body);wrapper.appendChild(block);
}

// ── FIELD RENDERER ────────────────────────────────────────────────
function renderFieldInto(field,parent,mod,iIdx){
  const modId=mod.id;

  if(field.type==='__sec'||field.type==='section'){
    const d=document.createElement('div');d.className='form-section-title';
    d.textContent=(field.label||'').replace(/^—\s*/,'').replace(/\s*—$/,'');
    parent.appendChild(d);return;
  }

  // Skip fields based on local type or energy
  if(field.showForTypes&&currentLocalType&&!field.showForTypes.includes(currentLocalType))return;
  if(field.showIfEnergie&&currentEnergie&&!field.showIfEnergie.some(e=>currentEnergie.includes(e)))return;
  if(field.type==='equipment_inline')return; // handled separately

  // Special composite types
  if(field.type==='mesures_libres'){renderMesuresLibres(field,parent,modId,iIdx);return;}
  if(field.type==='mesures_temp'){renderMesuresTemp(field,parent,modId,iIdx);return;}
  if(field.type==='mesures_chauf'){renderMesuresChauf(field,parent,modId,iIdx);return;}
  if(field.type==='courbe_chauffe'){renderCourbeChauffe(field,parent,modId,iIdx);return;}
  if(field.type==='decalage_stepper'){renderDecalageStepper(field,parent,modId,iIdx);return;}

  const wrap=document.createElement('div');wrap.className='form-group';
  const currentVal=getFieldValue(modId,field.id,iIdx);

  if(field.type==='yesno3'||field.type==='yesno'){
    wrap.innerHTML=`<label>${esc(field.label)}</label>`;
    const is4=field.type==='yesno3';
    const grp=document.createElement('div');grp.className=is4?'yesno4-group':'yesno-group';
    const opts=is4?[['Oui','oui','y'],['Non','non','n'],['N/A','na','na'],['?','pi','pi']]:[['Oui','oui','yes'],['Non','non','no'],['N/A','na','na']];
    opts.forEach(([lbl,code,cls])=>{
      const btn=document.createElement('button');
      btn.className=(is4?'yesno4-btn':'yesno-btn')+' '+cls+(currentVal===code?' active':'');
      btn.textContent=lbl;
      btn.addEventListener('click',async()=>{
        await saveLocalField(modId,field.id,code,iIdx);
        grp.querySelectorAll(is4?'.yesno4-btn':'.yesno-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        // Handle conditional
        if(field.conditional){
          const condKey=`cond_${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}`;
          const condDiv=document.getElementById(condKey);
          if(condDiv)condDiv.style.display=code===field.conditional.showWhen.value?'flex':'none';
        }
      });
      grp.appendChild(btn);
    });
    wrap.appendChild(grp);

    // Conditional sub-fields
    if(field.conditional){
      const condKey=`cond_${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}`;
      const condDiv=document.createElement('div');condDiv.className='conditional-fields';
      condDiv.id=condKey;condDiv.style.display=currentVal===field.conditional.showWhen.value?'flex':'none';
      field.conditional.fields.forEach(cf=>renderFieldInto(cf,condDiv,mod,iIdx));
      wrap.appendChild(condDiv);
    }

    // Comments for conformite
    if(mod.withComments){
      const commentKey=`${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}`;
      const comments=(getLocalFd().comments||{})[commentKey]||[];
      wrap.appendChild(buildCommentBlock(commentKey,comments,modId));
    }

  }else if(field.type==='computed'||field.type==='computed_validation'){
    wrap.innerHTML=`<label>${esc(field.label)}</label><div class="computed-value" id="cv_${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}">—</div>`;
    setTimeout(()=>updateComputedField(field,modId,iIdx),100);

  }else{
    // Standard input/select/textarea
    if(field.type==='select'){
      wrap.innerHTML=`<label>${esc(field.label)}</label><select id="ff_${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}">${(field.options||[]).map(o=>`<option value="${esc(o)}"${currentVal===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
    }else if(field.type==='textarea'){
      wrap.innerHTML=`<label>${esc(field.label)}</label><textarea id="ff_${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}" placeholder="${esc(field.placeholder||'')}" rows="3">${esc(currentVal)}</textarea>`;
    }else{
      const t=field.type==='number'?'number':field.type==='date'?'date':field.type==='time'?'time':'text';
      wrap.innerHTML=`<label>${esc(field.label)}</label><input type="${t}" id="ff_${modId}_${field.id}${iIdx!==null?'_'+iIdx:''}" placeholder="${esc(field.placeholder||field.label)}" value="${esc(currentVal)}" ${field.step?'step='+field.step:''} />`;
    }
    const el=wrap.querySelector(`[id^="ff_${modId}_${field.id}"]`);
    if(el){
      el.addEventListener('change',async()=>{
        await saveLocalField(modId,field.id,el.value,iIdx);
        // Update computed fields in same form
        const allF=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)];
        allF.filter(f=>f.type==='computed'||f.type==='computed_validation').forEach(f=>updateComputedField(f,modId,iIdx));
      });
      // ECS: hide ballon temp if prod = instantané
      if(field.id==='ecs_type_prod'&&iIdx!==null){
        el.addEventListener('change',()=>{
          const ballonWrap=document.getElementById(`ff_${modId}_ecs_temp_stockage_${iIdx}`)?.closest('.form-group');
          if(ballonWrap)ballonWrap.style.display=el.value==='Échangeur instantané'?'none':'';
        });
        // Apply initial state
        const ballonWrap=document.getElementById(`ff_${modId}_ecs_temp_stockage${iIdx!==null?'_'+iIdx:''}`)?.closest('.form-group');
        if(ballonWrap&&currentVal==='Échangeur instantané')ballonWrap.style.display='none';
      }
    }
  }
  parent.appendChild(wrap);
}

// ── COMPUTED FIELDS ───────────────────────────────────────────────
function updateComputedField(field,modId,iIdx){
  const suffix=iIdx!==null?'_'+iIdx:'';
  const el=document.getElementById(`cv_${modId}_${field.id}${suffix}`);if(!el)return;
  const mod=FORM_MODULES.find(m=>m.id===modId);if(!mod)return;
  const allF=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)];
  const vars={};
  allF.forEach(f=>{
    const inp=document.getElementById(`ff_${modId}_${f.id}${suffix}`);
    if(inp){const v=parseFloat(inp.value);if(!isNaN(v))vars[f.id]=v;}
  });
  try{
    const result=new Function(...Object.keys(vars),'return '+field.formula)(...Object.values(vars));
    if(field.type==='computed_validation'){
      const lfd=getLocalFd();const puissMap={'< 70 kW':50,'≥ 70 kW et < 400 kW':200,'≥ 400 kW et < 1 MW':700,'≥ 1 MW':1500};
      const puissKw=puissMap[(lfd.data['generalites']||{})['puissance_chaudiere']]||0;
      const section=isNaN(result)?0:result;
      if(!puissKw||!section){el.innerHTML='<span class="validation-na">Renseigner puissance</span>';return;}
      const req=field.rule==='ventilation_vh'?puissKw*6:puissKw*3;
      el.innerHTML=section>=req?`<span class="validation-ok">✅ ${Math.round(section)} ≥ ${Math.round(req)} cm²</span>`:`<span class="validation-ko">❌ ${Math.round(section)} < ${Math.round(req)} cm²</span>`;
    }else{
      el.textContent=isNaN(result)?'—':(Math.round(result*100)/100)+' '+(field.unit||'');
    }
  }catch{el.textContent='—';}
}

// ── EQUIPMENT INLINE ──────────────────────────────────────────────
function buildEquipmentInline(moduleId){
  const block=document.createElement('div');block.className='equip-inline-block';block.dataset.moduleId=moduleId;
  const refreshList=()=>{
    const listDiv=block.querySelector('.equip-inline-list');if(!listDiv)return;
    const baseId=moduleId.replace(/_\d+$/,'');
    const mEqs=equipments.filter(e=>e.missionId===currentMissionId&&(e.moduleContext===moduleId||e.moduleId===baseId&&!moduleId.match(/_\d+$/)));
    listDiv.innerHTML='';
    mEqs.forEach(eq=>{
      const item=document.createElement('div');item.className='equip-inline-item';
      item.innerHTML=`<div class="equip-inline-name">${esc(eq.name||'—')}</div><div class="equip-inline-meta">${[eq.brand,eq.model].filter(Boolean).join(' · ')}</div><div class="equip-inline-actions"><button class="card-btn" data-action="edit">✏️</button><button class="card-btn" data-action="del">🗑️</button></div>`;
      item.querySelector('[data-action=edit]').addEventListener('click',()=>openEqModal(eq.id,moduleId));
      item.querySelector('[data-action=del]').addEventListener('click',async()=>{
        if(!confirm('Supprimer ?'))return;
        await dbDel('equipments',eq.id);equipments=equipments.filter(e=>e.id!==eq.id);refreshList();
      });
      listDiv.appendChild(item);
    });
  };

  const listDiv=document.createElement('div');listDiv.className='equip-inline-list';
  const btnRow=document.createElement('div');btnRow.style.cssText='display:flex;gap:8px;margin-top:4px';
  const addBtn=document.createElement('button');addBtn.className='equip-add-btn';addBtn.textContent='+ Saisir manuellement';
  addBtn.addEventListener('click',()=>openEqModal(null,moduleId));
  const scanBtn=document.createElement('button');scanBtn.className='equip-scan-btn';scanBtn.textContent='📷 Scanner';
  scanBtn.addEventListener('click',()=>{editingEqContext=moduleId;openScanForModule(moduleId);});
  btnRow.appendChild(addBtn);btnRow.appendChild(scanBtn);
  block.appendChild(listDiv);block.appendChild(btnRow);
  // Expose refresh
  block._refresh=refreshList;
  refreshList();
  return block;
}

// ── MESURES LIBRES ────────────────────────────────────────────────
function renderMesuresLibres(field,parent,modId,iIdx){
  const block=document.createElement('div');
  const getPoints=()=>{const lfd=getLocalFd();return JSON.parse(JSON.stringify((lfd.data[modId]||{})[field.id]||[]));};
  const renderPts=(points)=>{
    block.innerHTML='';
    if(points.length){
      const hdr=document.createElement('div');hdr.style.cssText='display:grid;grid-template-columns:1fr 1fr 60px 28px;gap:6px;margin-bottom:4px';
      hdr.innerHTML='<span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase">Libellé</span><span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase">Valeur</span><span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase">Unité</span><span></span>';
      block.appendChild(hdr);
    }
    const IS='background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:12px;outline:none;width:100%';
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.style.cssText='display:grid;grid-template-columns:1fr 1fr 60px 28px;gap:6px;align-items:center;margin-bottom:5px';
      row.innerHTML=`<input type="text" class="ml-l" value="${esc(pt.label||'')}" placeholder="Ex: Ø cheminée" style="${IS}"/><input type="text" class="ml-v" value="${esc(pt.val||'')}" placeholder="Valeur" style="${IS}"/><input type="text" class="ml-u" value="${esc(pt.unit||'')}" placeholder="cm" style="${IS}"/><button style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px">✕</button>`;
      const save=async()=>{const pts=getPoints();if(!pts[pi])pts[pi]={};pts[pi].label=row.querySelector('.ml-l').value;pts[pi].val=row.querySelector('.ml-v').value;pts[pi].unit=row.querySelector('.ml-u').value;await saveLocalField(modId,field.id,pts,iIdx);};
      row.querySelectorAll('input').forEach(el=>el.addEventListener('change',save));
      row.querySelector('button').addEventListener('click',async()=>{const pts=getPoints();pts.splice(pi,1);await saveLocalField(modId,field.id,pts,iIdx);renderPts(pts);});
      block.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.style.marginTop='4px';addBtn.textContent='+ Ajouter une mesure';
    addBtn.addEventListener('click',async()=>{const pts=getPoints();pts.push({label:'',val:'',unit:''});await saveLocalField(modId,field.id,pts,iIdx);renderPts(pts);});
    block.appendChild(addBtn);
  };
  renderPts(getPoints());parent.appendChild(block);
}

// ── MESURES TEMP (primaire) ───────────────────────────────────────
function renderMesuresTemp(field,parent,modId,iIdx){
  const block=document.createElement('div');
  const getPoints=()=>{
    const lfd=getLocalFd();
    if(iIdx!==null)return JSON.parse(JSON.stringify(((lfd.repeatData[modId]||[])[iIdx]||{})[field.id]||[]));
    return JSON.parse(JSON.stringify((lfd.data[modId]||{})[field.id]||[]));
  };
  const savePoints=async(pts)=>saveLocalField(modId,field.id,pts,iIdx);

  const renderPts=(points)=>{
    block.innerHTML='';
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.className='mesure-point';
      const isAutre=pt.type==='Autre';
      row.innerHTML=`<div class="mesure-point-header"><select class="mpt">${(field.pointOptions||[]).map(o=>`<option value="${esc(o)}"${pt.type===o?' selected':''}>${esc(o)}</option>`).join('')}</select><button class="mesure-del">✕</button></div>${isAutre?`<div style="display:flex;flex-direction:column;gap:4px;margin-top:4px"><input type="text" class="mp-lib" value="${esc(pt.libelle||'')}" placeholder="Libellé" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none;width:100%"/><input type="text" class="mp-uni" value="${esc(pt.unite||'°C')}" placeholder="Unité" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none;width:100%"/></div>`:''}<div class="mesure-row"><div class="mesure-cell"><label>Départ</label><input type="number" class="mp-dep" step="0.1" value="${pt.dep||''}" placeholder="—"/></div><div class="mesure-cell"><label>Retour</label><input type="number" class="mp-ret" step="0.1" value="${pt.ret||''}" placeholder="—"/></div><div class="mesure-cell"><label>ΔT</label><div class="mesure-delta" id="dt${modId}${pi}">—</div></div></div>`;
      const updt=()=>{const d=parseFloat(row.querySelector('.mp-dep').value),r=parseFloat(row.querySelector('.mp-ret').value);const el=document.getElementById(`dt${modId}${pi}`);if(el)el.textContent=(!isNaN(d)&&!isNaN(r))?(d-r).toFixed(1)+' K':'—';};
      row.querySelectorAll('input').forEach(el=>el.addEventListener('input',updt));
      const save=async()=>{const pts=getPoints();if(!pts[pi])pts[pi]={};pts[pi].type=row.querySelector('.mpt').value;pts[pi].dep=row.querySelector('.mp-dep').value;pts[pi].ret=row.querySelector('.mp-ret').value;if(isAutre){pts[pi].libelle=row.querySelector('.mp-lib')?.value||'';pts[pi].unite=row.querySelector('.mp-uni')?.value||'°C';}await savePoints(pts);};
      row.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',save));
      row.querySelector('.mpt').addEventListener('change',async()=>{const pts=getPoints();pts[pi]={type:row.querySelector('.mpt').value};await savePoints(pts);renderPts(pts);});
      row.querySelector('.mesure-del').addEventListener('click',async()=>{const pts=getPoints();pts.splice(pi,1);await savePoints(pts);renderPts(pts);});
      updt();block.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.style.marginTop='4px';addBtn.textContent='+ Ajouter un point de mesure';
    addBtn.addEventListener('click',async()=>{const pts=getPoints();pts.push({type:(field.pointOptions||[])[0]||'',dep:'',ret:''});await savePoints(pts);renderPts(pts);});
    block.appendChild(addBtn);
  };
  renderPts(getPoints());parent.appendChild(block);
}

// ── MESURES CHAUFFAGE (avec sous-types) ───────────────────────────
function renderMesuresChauf(field,parent,modId,iIdx){
  const block=document.createElement('div');
  const getPoints=()=>{
    const lfd=getLocalFd();
    if(iIdx!==null)return JSON.parse(JSON.stringify(((lfd.repeatData[modId]||[])[iIdx]||{})[field.id]||[]));
    return JSON.parse(JSON.stringify((lfd.data[modId]||{})[field.id]||[]));
  };
  const savePoints=async(pts)=>saveLocalField(modId,field.id,pts,iIdx);

  const TYPES=field.pointOptions||[];
  const renderPts=(points)=>{
    block.innerHTML='';
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.className='mesure-point';
      const t=pt.type||TYPES[0]||'';
      const isTR=t==='Températures réseau';
      const isPP=t==='Pression pompe';
      const isDeb=t==='Débit';
      const isAut=t==='Autre';

      let sub='';
      if(isTR){
        sub=`<div class="mesure-row"><div class="mesure-cell"><label>Départ (°C)</label><input type="number" class="mc-d" step="0.1" value="${pt.dep||''}"/></div><div class="mesure-cell"><label>Retour (°C)</label><input type="number" class="mc-r" step="0.1" value="${pt.ret||''}"/></div><div class="mesure-cell"><label>ΔT</label><div class="mesure-delta" id="dmc${modId}${pi}${iIdx||''}">—</div></div></div>`;
      }else if(isPP){
        sub=`<div class="mesure-row"><div class="mesure-cell"><label>Aspiration (bar)</label><input type="number" class="mc-a" step="0.01" value="${pt.asp||''}"/></div><div class="mesure-cell"><label>Refoulement (bar)</label><input type="number" class="mc-f" step="0.01" value="${pt.ref||''}"/></div><div class="mesure-cell"><label>ΔP</label><div class="mesure-delta" id="dmc${modId}${pi}${iIdx||''}">—</div></div></div>`;
      }else if(isDeb){
        sub=`<div class="mesure-row"><div class="mesure-cell" style="grid-column:1/-1"><label>Débit (m³/h)</label><input type="number" class="mc-db" step="0.01" value="${pt.debit||''}"/></div></div>`;
      }else if(isAut){
        sub=`<div style="display:flex;flex-direction:column;gap:4px;margin-top:4px"><input type="text" class="mc-lib" value="${esc(pt.libelle||'')}" placeholder="Libellé" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none;width:100%"/><div style="display:flex;gap:6px"><input type="text" class="mc-val" value="${esc(pt.val||'')}" placeholder="Valeur" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none"/><input type="text" class="mc-uni" value="${esc(pt.unite||'')}" placeholder="Unité" style="width:70px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none"/></div></div>`;
      }else{
        sub=`<div class="mesure-row"><div class="mesure-cell" style="grid-column:1/-1"><label>Valeur (°C)</label><input type="number" class="mc-v" step="0.1" value="${pt.val||''}"/></div></div>`;
      }

      row.innerHTML=`<div class="mesure-point-header"><select class="mct">${TYPES.map(o=>`<option value="${esc(o)}"${t===o?' selected':''}>${esc(o)}</option>`).join('')}</select><button class="mesure-del">✕</button></div>${sub}`;

      const dtEl=()=>document.getElementById(`dmc${modId}${pi}${iIdx||''}`);
      const updt=()=>{
        const el=dtEl();if(!el)return;
        if(isTR){const d=parseFloat(row.querySelector('.mc-d')?.value),r=parseFloat(row.querySelector('.mc-r')?.value);el.textContent=(!isNaN(d)&&!isNaN(r))?(d-r).toFixed(1)+' K':'—';}
        else if(isPP){const a=parseFloat(row.querySelector('.mc-a')?.value),f=parseFloat(row.querySelector('.mc-f')?.value);el.textContent=(!isNaN(a)&&!isNaN(f))?(f-a).toFixed(2)+' bar':'—';}
      };
      row.querySelectorAll('input').forEach(el=>el.addEventListener('input',updt));
      const save=async()=>{
        const pts=getPoints();if(!pts[pi])pts[pi]={};pts[pi].type=row.querySelector('.mct').value;
        if(isTR){pts[pi].dep=row.querySelector('.mc-d')?.value;pts[pi].ret=row.querySelector('.mc-r')?.value;}
        else if(isPP){pts[pi].asp=row.querySelector('.mc-a')?.value;pts[pi].ref=row.querySelector('.mc-f')?.value;}
        else if(isDeb){pts[pi].debit=row.querySelector('.mc-db')?.value;}
        else if(isAut){pts[pi].libelle=row.querySelector('.mc-lib')?.value;pts[pi].val=row.querySelector('.mc-val')?.value;pts[pi].unite=row.querySelector('.mc-uni')?.value;}
        else{pts[pi].val=row.querySelector('.mc-v')?.value;}
        await savePoints(pts);
      };
      row.querySelectorAll('input').forEach(el=>el.addEventListener('change',save));
      row.querySelector('.mct').addEventListener('change',async()=>{const pts=getPoints();pts[pi]={type:row.querySelector('.mct').value};await savePoints(pts);renderPts(pts);});
      row.querySelector('.mesure-del').addEventListener('click',async()=>{const pts=getPoints();pts.splice(pi,1);await savePoints(pts);renderPts(pts);});
      updt();block.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.style.marginTop='4px';addBtn.textContent='+ Ajouter un point de mesure';
    addBtn.addEventListener('click',async()=>{const pts=getPoints();pts.push({type:TYPES[0]||''});await savePoints(pts);renderPts(pts);});
    block.appendChild(addBtn);
  };
  renderPts(getPoints());parent.appendChild(block);
}

// ── COURBE DE CHAUFFE ─────────────────────────────────────────────
function renderCourbeChauffe(field,parent,modId,iIdx){
  const block=document.createElement('div');block.className='courbe-block';
  const getPoints=()=>{
    const lfd=getLocalFd();
    if(iIdx!==null)return JSON.parse(JSON.stringify(((lfd.repeatData[modId]||[])[iIdx]||{})[field.id]||[{text:-5,dep:null},{text:15,dep:null}]));
    return JSON.parse(JSON.stringify((lfd.data[modId]||{})[field.id]||[{text:-5,dep:null},{text:15,dep:null}]));
  };
  const savePoints=async(pts)=>saveLocalField(modId,field.id,pts,iIdx);
  const getDecalage=()=>{
    const lfd=getLocalFd();
    if(iIdx!==null)return parseFloat(((lfd.repeatData[modId]||[])[iIdx]||{})['reg_decalage']||0)||0;
    return parseFloat((lfd.data[modId]||{})['reg_decalage']||0)||0;
  };

  const canvas=document.createElement('canvas');canvas.className='courbe-canvas';canvas.width=380;canvas.height=200;

  const drawCurve=()=>{
    const ctx=canvas.getContext('2d');const W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#0d1b2a';ctx.fillRect(0,0,W,H);
    const pts=block.querySelectorAll('.courbe-point-row');
    const decal=getDecalage();
    const points=[];
    pts.forEach(row=>{
      const t=parseFloat(row.querySelector('.c-text').value);
      const d=parseFloat(row.querySelector('.c-dep').value);
      if(!isNaN(t)&&!isNaN(d))points.push({t,d:d+decal});
    });
    if(points.length<2){ctx.fillStyle='#445566';ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText('Entrez au moins 2 points',W/2,H/2);return;}
    points.sort((a,b)=>a.t-b.t);
    const PAD={l:40,r:12,t:16,b:32};
    // X: by 5°C, Y: 0 always visible, by 10 or 20
    const minT=Math.floor(Math.min(...points.map(p=>p.t))/5)*5-5;
    const maxT=Math.ceil(Math.max(...points.map(p=>p.t))/5)*5+5;
    const minD=Math.min(0,Math.min(...points.map(p=>p.d)));
    const maxD=Math.max(...points.map(p=>p.d));
    const rangeD=maxD-minD;
    const stepD=rangeD>80?20:10;
    const yStart=Math.floor(minD/stepD)*stepD;
    const yEnd=Math.ceil(maxD/stepD)*stepD+stepD;
    const px=t=>PAD.l+(t-minT)/(maxT-minT)*(W-PAD.l-PAD.r);
    const py=d=>H-PAD.b-(d-yStart)/(yEnd-yStart)*(H-PAD.t-PAD.b);
    // Grid
    ctx.strokeStyle='#1e3f5e';ctx.lineWidth=0.8;
    for(let t=minT;t<=maxT;t+=5){ctx.beginPath();ctx.moveTo(px(t),PAD.t);ctx.lineTo(px(t),H-PAD.b);ctx.stroke();}
    for(let d=yStart;d<=yEnd;d+=stepD){ctx.beginPath();ctx.moveTo(PAD.l,py(d));ctx.lineTo(W-PAD.r,py(d));ctx.stroke();}
    // Zero line
    if(yStart<0&&yEnd>0){ctx.strokeStyle='#2d5a8e';ctx.lineWidth=1.2;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(PAD.l,py(0));ctx.lineTo(W-PAD.r,py(0));ctx.stroke();ctx.setLineDash([]);}
    // Axes
    ctx.strokeStyle='#2d5a8e';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,H-PAD.b);ctx.lineTo(W-PAD.r,H-PAD.b);ctx.stroke();
    // Labels X
    ctx.fillStyle='#6a90b0';ctx.font='9px monospace';ctx.textAlign='center';
    for(let t=minT;t<=maxT;t+=5)ctx.fillText(t+'°',px(t),H-PAD.b+11);
    // Labels Y
    ctx.textAlign='right';
    for(let d=yStart;d<=yEnd;d+=stepD)ctx.fillText(d+'°',PAD.l-3,py(d)+3);
    // Axis titles
    ctx.fillStyle='#7a95b0';ctx.font='8px monospace';ctx.textAlign='center';
    ctx.fillText('Text (°C)',W/2,H-1);
    ctx.save();ctx.translate(8,H/2);ctx.rotate(-Math.PI/2);ctx.fillText('T départ (°C)',0,0);ctx.restore();
    // Curve
    ctx.strokeStyle='#1e7fd4';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();
    points.forEach((p,i)=>i===0?ctx.moveTo(px(p.t),py(p.d)):ctx.lineTo(px(p.t),py(p.d)));ctx.stroke();
    // Points
    points.forEach(p=>{
      ctx.fillStyle='#1e7fd4';ctx.beginPath();ctx.arc(px(p.t),py(p.d),5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='white';ctx.beginPath();ctx.arc(px(p.t),py(p.d),2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#e8f0f8';ctx.font='9px monospace';ctx.textAlign='center';
      ctx.fillText(p.d+'°',px(p.t),py(p.d)-8);
    });
    // Decalage label
    if(decal!==0){ctx.fillStyle='#f97316';ctx.font='9px monospace';ctx.textAlign='left';ctx.fillText(`Décalage: ${decal>0?'+':''}${decal}°`,PAD.l+4,PAD.t+10);}
  };

  const renderPts=(points)=>{
    block.innerHTML='<div style="font-family:var(--font-display);font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Points de la courbe</div><div class="courbe-points" id="cp-'+modId+(iIdx!==null?'-'+iIdx:'')+'"></div>';
    const ptsDiv=block.querySelector('.courbe-points');
    points.forEach((pt,pi)=>{
      const row=document.createElement('div');row.className='courbe-point-row';
      const IS='background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:7px 8px;color:var(--text-primary);font-size:13px;outline:none;width:100%';
      row.innerHTML=`<div class="mesure-cell"><label>Text (°C)</label><input type="number" class="c-text" step="1" value="${pt.text!==null&&pt.text!==undefined?pt.text:''}" placeholder="-5" style="${IS}"/></div><div class="mesure-cell"><label>T départ (°C)</label><input type="number" class="c-dep" step="0.5" value="${pt.dep!==null&&pt.dep!==undefined?pt.dep:''}" placeholder="75" style="${IS}"/></div><button class="mesure-del" ${points.length<=2?'style="opacity:.3"':''} ${points.length<=2?'disabled':''}>✕</button>`;
      row.querySelectorAll('input').forEach(el=>el.addEventListener('change',async()=>{
        const pts=getPoints();pts[pi]={text:parseFloat(row.querySelector('.c-text').value)||null,dep:parseFloat(row.querySelector('.c-dep').value)||null};
        await savePoints(pts);drawCurve();
      }));
      row.querySelector('.mesure-del').addEventListener('click',async()=>{
        if(points.length<=2)return;const pts=getPoints();pts.splice(pi,1);await savePoints(pts);renderPts(pts);
      });
      ptsDiv.appendChild(row);
    });
    const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.textContent='+ Ajouter un point';addBtn.style.marginTop='4px';
    addBtn.addEventListener('click',async()=>{const pts=getPoints();pts.push({text:null,dep:null});await savePoints(pts);renderPts(pts);});
    block.appendChild(addBtn);
    block.appendChild(canvas);
    setTimeout(drawCurve,50);
  };
  renderPts(getPoints());parent.appendChild(block);
}

// ── DÉCALAGE STEPPER ──────────────────────────────────────────────
function renderDecalageStepper(field,parent,modId,iIdx){
  const currentVal=parseFloat(getFieldValue(modId,field.id,iIdx))||0;
  const wrap=document.createElement('div');wrap.className='form-group';
  wrap.innerHTML=`<label>${esc(field.label)}</label>`;
  const row=document.createElement('div');row.className='stepper-row';
  const minus=document.createElement('button');minus.className='stepper-btn';minus.textContent='−';
  const plus=document.createElement('button');plus.className='stepper-btn';plus.textContent='+';
  const display=document.createElement('div');display.className='stepper-val';
  let current=currentVal;
  display.textContent=(current>=0?'+':'')+current.toFixed(1);
  const update=async(delta)=>{
    current=Math.max(-10,Math.min(10,Math.round((current+delta)*2)/2));
    display.textContent=(current>=0?'+':'')+current.toFixed(1);
    await saveLocalField(modId,field.id,current,iIdx);
    // Redraw courbe if present
    const canvas=parent.closest('.form-block-body')?.querySelector('.courbe-canvas');
    if(canvas){const c=canvas.getContext('2d');c&&setTimeout(()=>{const ev=new Event('change');canvas.dispatchEvent(ev);},50);}
  };
  minus.addEventListener('click',()=>update(-0.5));plus.addEventListener('click',()=>update(0.5));
  row.appendChild(minus);row.appendChild(display);row.appendChild(plus);
  wrap.appendChild(row);parent.appendChild(wrap);
}

// ── COMMENTS ─────────────────────────────────────────────────────
function buildCommentBlock(commentKey,commentData,modId){
  const block=document.createElement('div');block.className='comment-block';
  const tagsRow=document.createElement('div');tagsRow.className='comment-tags';
  ['✅ Positif','⚠️ Négatif','— Neutre'].forEach((lbl,i)=>{
    const tag=document.createElement('span');tag.className='ctag '+['pos','neg','neu'][i];tag.textContent=lbl;
    tag.addEventListener('click',async()=>{
      const lfd=getLocalFd();const comments=JSON.parse(JSON.stringify((lfd.comments||{})[commentKey]||[]));
      comments.push({type:['pos','neg','neu'][i],text:''});
      await saveLocalComment(commentKey,comments);
      const list=document.getElementById('cl-'+commentKey);if(list){list.innerHTML='';comments.forEach((c,ci)=>list.appendChild(buildCommentEntry(commentKey,c,ci)));}
    });
    tagsRow.appendChild(tag);
  });
  const list=document.createElement('div');list.id='cl-'+commentKey;
  commentData.forEach((c,ci)=>list.appendChild(buildCommentEntry(commentKey,c,ci)));
  block.appendChild(tagsRow);block.appendChild(list);return block;
}
function buildCommentEntry(commentKey,c,ci){
  const row=document.createElement('div');row.className='comment-entry';
  const tag=document.createElement('span');tag.className=`ctag ${c.type} active`;tag.textContent=c.type==='pos'?'✅':c.type==='neg'?'⚠️':'—';tag.style.alignSelf='flex-start';
  const ta=document.createElement('textarea');ta.value=c.text||'';ta.placeholder='Commentaire...';ta.rows=2;ta.style.cssText='flex:1;resize:none;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-family:var(--font-body);font-size:12px;outline:none;min-height:48px';
  const del=document.createElement('button');del.className='btn-del-comment';del.textContent='✕';
  ta.addEventListener('change',async()=>{const lfd=getLocalFd();const comments=JSON.parse(JSON.stringify((lfd.comments||{})[commentKey]||[]));if(comments[ci])comments[ci].text=ta.value;await saveLocalComment(commentKey,comments);});
  del.addEventListener('click',async()=>{const lfd=getLocalFd();const comments=JSON.parse(JSON.stringify((lfd.comments||{})[commentKey]||[]));comments.splice(ci,1);await saveLocalComment(commentKey,comments);const list=document.getElementById('cl-'+commentKey);if(list){list.innerHTML='';comments.forEach((cm,j)=>list.appendChild(buildCommentEntry(commentKey,cm,j)));}});
  row.appendChild(tag);row.appendChild(ta);row.appendChild(del);return row;
}

// ── CAHIER BLOCK ──────────────────────────────────────────────────
function renderCahierBlock(mod,wrapper){
  const block=document.createElement('div');block.className='form-block';
  const collapsed=isCollapsed(mod.id);
  const header=document.createElement('div');header.className='form-block-header';header.style.cursor='pointer';
  header.innerHTML=`<div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div><button class="collapse-btn" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:0 4px;line-height:1">${collapsed?'+':'−'}</button>`;
  const body=document.createElement('div');body.className='form-block-body';if(collapsed)body.style.display='none';
  header.addEventListener('click',()=>{const c=body.style.display==='none';body.style.display=c?'':'none';header.querySelector('.collapse-btn').textContent=c?'−':'+';setCollapsed(mod.id,!c);});

  const fd=getMFD();const lk=getLocalKey();const lfd=getLocalFd();
  const years=lfd.cahierYears||{};

  const nbRow=document.createElement('div');nbRow.className='form-group';
  nbRow.innerHTML=`<label>Années à renseigner</label><input type="number" id="cahier-nb-${lk}" min="1" max="10" value="${Object.keys(years).length||1}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);width:100%;font-size:14px;outline:none"/>`;
  const btn=document.createElement('button');btn.className='btn-secondary btn-sm';btn.textContent='↻ Actualiser';btn.style.marginBottom='10px';
  btn.addEventListener('click',async()=>{
    const nb=parseInt(document.getElementById(`cahier-nb-${lk}`)?.value)||1;
    const mainFd=getMFD();if(!mainFd.localData)mainFd.localData={};if(!mainFd.localData[lk])mainFd.localData[lk]={data:{},repeatData:{},comments:{},cahierYears:{}};
    for(let i=0;i<nb;i++){const yr=String(new Date().getFullYear()-i);if(!mainFd.localData[lk].cahierYears[yr])mainFd.localData[lk].cahierYears[yr]={obligations:{}};}
    await saveMFD(mainFd);
    // Re-render years without full rebuild
    const yearsDiv=block.querySelector('.cahier-years');if(yearsDiv){yearsDiv.innerHTML='';renderYears(yearsDiv);}
  });
  body.appendChild(nbRow);body.appendChild(btn);

  const puiss=(lfd.data['generalites']||{})['puissance_chaudiere']||'';
  const oblDefs=OBLIGATIONS_CHAUFFERIE[puiss]||OBLIGATIONS_CHAUFFERIE['≥ 70 kW et < 400 kW'];

  const yearsDiv=document.createElement('div');yearsDiv.className='cahier-years';
  const renderYears=(container)=>{
    const lfd2=getLocalFd();const yrs=lfd2.cahierYears||{};
    Object.keys(yrs).sort().reverse().forEach(yr=>{
      const yData=yrs[yr];
      const yBlock=document.createElement('div');yBlock.className='year-block';
      const yhdr=document.createElement('div');yhdr.className='year-block-header';
      yhdr.innerHTML=`<span class="year-block-title">📅 Année ${yr}</span><span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">▾</span>`;
      const yBody=document.createElement('div');yBody.className='year-block-body';
      let yCollapsed=false;yhdr.addEventListener('click',()=>{yCollapsed=!yCollapsed;yBody.className='year-block-body'+(yCollapsed?' collapsed':'');});
      // Saison
      [{id:'date_allumage',label:"Date allumage"},{id:'date_arret',label:"Date arrêt"}].forEach(sf=>{
        const fg=document.createElement('div');fg.className='form-group';
        fg.innerHTML=`<label>${sf.label}</label><input type="date" value="${yData[sf.id]||''}"/>`;
        fg.querySelector('input').addEventListener('change',async e=>{
          const mainFd=getMFD();if(!mainFd.localData?.[lk]?.cahierYears?.[yr])return;
          mainFd.localData[lk].cahierYears[yr][sf.id]=e.target.value;await saveMFD(mainFd);
        });
        yBody.appendChild(fg);
      });
      const oblTitle=document.createElement('div');oblTitle.className='form-section-title';oblTitle.textContent='OPÉRATIONS';yBody.appendChild(oblTitle);
      if(!yData.obligations)yData.obligations={};
      oblDefs.forEach(obl=>{
        if(!yData.obligations[obl.id])yData.obligations[obl.id]={freq:obl.freq_default,dates:[]};
        const oblData=yData.obligations[obl.id];
        const oblRow=document.createElement('div');oblRow.className='obligation-row';
        oblRow.innerHTML=`<div class="obligation-header"><span class="obligation-label">${obl.label}</span><select class="obl-freq" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--accent);font-family:var(--font-mono);font-size:11px;outline:none">${FREQ_OPTIONS.map(f=>`<option value="${f}"${f===oblData.freq?' selected':''}>${f}</option>`).join('')}</select></div>`;
        const datesDiv=document.createElement('div');datesDiv.className='obligation-dates';
        (oblData.dates||[]).forEach((dv,di)=>{
          const dr=document.createElement('div');dr.className='obl-date-row';
          dr.innerHTML=`<span class="obl-date-label">${di+1}.</span><input type="date" value="${dv||''}" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text-primary);font-size:12px;outline:none"/><button style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 4px;font-size:12px">✕</button>`;
          dr.querySelector('input').addEventListener('change',async e=>{const mainFd=getMFD();if(mainFd.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id]?.dates)mainFd.localData[lk].cahierYears[yr].obligations[obl.id].dates[di]=e.target.value;await saveMFD(mainFd);});
          dr.querySelector('button').addEventListener('click',async()=>{const mainFd=getMFD();if(mainFd.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id]?.dates)mainFd.localData[lk].cahierYears[yr].obligations[obl.id].dates.splice(di,1);await saveMFD(mainFd);renderYears(container);});
          datesDiv.appendChild(dr);
        });
        const addDateBtn=document.createElement('button');addDateBtn.className='btn-add-comment';addDateBtn.textContent='+ Ajouter une date';
        addDateBtn.addEventListener('click',async()=>{const mainFd=getMFD();if(!mainFd.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id])return;if(!mainFd.localData[lk].cahierYears[yr].obligations[obl.id].dates)mainFd.localData[lk].cahierYears[yr].obligations[obl.id].dates=[];mainFd.localData[lk].cahierYears[yr].obligations[obl.id].dates.push('');await saveMFD(mainFd);renderYears(container);});
        oblRow.querySelector('.obl-freq').addEventListener('change',async e=>{const mainFd=getMFD();if(mainFd.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id])mainFd.localData[lk].cahierYears[yr].obligations[obl.id].freq=e.target.value;await saveMFD(mainFd);});
        oblRow.appendChild(datesDiv);oblRow.appendChild(addDateBtn);yBody.appendChild(oblRow);
      });
      yBlock.appendChild(yhdr);yBlock.appendChild(yBody);container.appendChild(yBlock);
    });
  };
  renderYears(yearsDiv);body.appendChild(yearsDiv);
  block.appendChild(header);block.appendChild(body);wrapper.appendChild(block);
}

// ── LOCAUX SETUP ──────────────────────────────────────────────────
function renderLocauxSetup(locaux,fd){
  const container=document.getElementById('locaux-list-container');if(!container)return;
  container.innerHTML='';
  if(!locaux.length){container.innerHTML='<div class="local-empty">Aucun local — appuyez sur + Ajouter</div>';return;}
  locaux.forEach((loc,i)=>{
    const row=document.createElement('div');row.className='local-item';
    row.innerHTML=`<span class="local-item-num">${i+1}</span>`;
    const sel=document.createElement('select');sel.className='local-item-type';sel.style.flex='1';
    LOCAL_TYPES.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;if(t===loc.type)o.selected=true;sel.appendChild(o);});
    sel.addEventListener('change',async()=>{const fdd=getMFD();fdd.locaux[i].type=sel.value;await saveMFD(fdd);renderFormsZone();});
    const nomInp=document.createElement('input');nomInp.type='text';nomInp.placeholder='Nom (ex: Bât A)';nomInp.value=loc.nom||'';
    nomInp.style.cssText='background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;flex:1;max-width:110px';
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

// Make refreshAllEquipInline use the block's _refresh method
function refreshAllEquipInline(){
  document.querySelectorAll('.equip-inline-block').forEach(block=>{if(block._refresh)block._refresh();});
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
  // Pre-fill operator with current user
  const opEl=document.getElementById('mission-operator');
  if(opEl)opEl.value=m?.operator||(currentUser?`${currentUser.prenom} ${currentUser.nom}`:'');
  // Populate user select if present
  const opSel=document.getElementById('mission-operator-select');
  if(opSel){
    opSel.innerHTML='<option value="">— Sélectionner un intervenant —</option>';
    users.forEach(u=>{
      const o=document.createElement('option');o.value=`${u.prenom} ${u.nom}`.trim();
      o.textContent=`${u.prenom} ${u.nom}`;
      if(opEl?.value===`${u.prenom} ${u.nom}`.trim())o.selected=true;
      opSel.appendChild(o);
    });
    opSel.addEventListener('change',()=>{if(opEl&&opSel.value)opEl.value=opSel.value;});
  }
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
  // Save to equipment library for future reuse
  if(eq.name&&eq.brand){
    const libEntry={id:`lib_${eq.brand}_${eq.model||eq.name}`.replace(/\s+/g,'_').toLowerCase(),name:eq.name,brand:eq.brand,model:eq.model||'',power:eq.power||'',category:eq.category};
    await dbPut('equiplib',libEntry);
  }
  capturedImage=null;document.getElementById('modal-equipment').classList.add('hidden');
  refreshAllEquipInline();showToast(editingEqId?'Équipement mis à jour ✓':'Équipement ajouté ✓','success');
}
async function deleteEquipment(id){if(!confirm('Supprimer ?'))return;await dbDel('equipments',id);equipments=equipments.filter(e=>e.id!==id);refreshAllEquipInline();renderSynthesis();showToast('Supprimé');}

document.getElementById('btn-attach-photo')?.addEventListener('click',()=>document.getElementById('attach-file-input').click());
document.getElementById('attach-file-input')?.addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const reader=new FileReader();reader.onload=ev=>{attachedPhoto=ev.target.result;const img=document.getElementById('field-photo-preview');img.src=attachedPhoto;img.classList.remove('hidden');};reader.readAsDataURL(f);e.target.value='';
});


// ── SCAN MODULE ───────────────────────────────────────────────────
let scanModalStream=null;

function openScanForModule(moduleId){
  editingEqContext=moduleId;
  let scanModal=document.getElementById('scan-modal');
  if(!scanModal){
    scanModal=document.createElement('div');scanModal.id='scan-modal';
    scanModal.style.cssText='position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:env(safe-area-inset-bottom)';
    scanModal.innerHTML=`
      <div style="width:100%;max-width:600px;background:var(--bg-dark);border-radius:16px 16px 0 0;padding:14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-family:var(--font-display);font-size:16px;font-weight:700">📷 Scanner une plaque</span>
          <button id="scan-modal-close" style="background:var(--bg-card);border:1px solid var(--border);border-radius:50%;width:30px;height:30px;color:var(--text-secondary);cursor:pointer;font-size:13px">✕</button>
        </div>
        <div style="position:relative;width:100%;aspect-ratio:4/3;background:#000;border-radius:var(--radius);overflow:hidden">
          <video id="scan-modal-video" autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>
          <canvas id="scan-modal-canvas" style="display:none"></canvas>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
            <div style="width:65%;aspect-ratio:2/1;position:relative">
              <div style="position:absolute;top:0;left:0;width:16px;height:16px;border-top:3px solid var(--accent);border-left:3px solid var(--accent)"></div>
              <div style="position:absolute;top:0;right:0;width:16px;height:16px;border-top:3px solid var(--accent);border-right:3px solid var(--accent)"></div>
              <div style="position:absolute;bottom:0;left:0;width:16px;height:16px;border-bottom:3px solid var(--accent);border-left:3px solid var(--accent)"></div>
              <div style="position:absolute;bottom:0;right:0;width:16px;height:16px;border-bottom:3px solid var(--accent);border-right:3px solid var(--accent)"></div>
            </div>
          </div>
          <div id="scan-modal-placeholder" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:var(--bg-card)">
            <span style="font-size:36px;opacity:.3">📷</span>
            <p style="color:var(--text-muted);font-size:13px">Caméra non démarrée</p>
          </div>
        </div>
        <div id="scan-ocr-status" class="ocr-status hidden"><div class="ocr-spinner"></div><span id="scan-ocr-text">Analyse...</span></div>
        <button class="btn-primary" id="scan-modal-start">🎥 Démarrer caméra</button>
        <button class="btn-capture hidden" id="scan-modal-capture">📸 Capturer</button>
        <button class="btn-secondary" id="scan-modal-gallery">🖼️ Depuis la galerie</button>
        <input type="file" id="scan-modal-file" accept="image/*" capture="environment" style="display:none"/>
      </div>`;
    document.body.appendChild(scanModal);
  }
  // Reset state
  const placeholder=document.getElementById('scan-modal-placeholder');
  if(placeholder)placeholder.style.display='flex';
  document.getElementById('scan-modal-start')?.classList.remove('hidden');
  document.getElementById('scan-modal-capture')?.classList.add('hidden');

  scanModal.style.display='flex';
  document.getElementById('scan-modal-close').onclick=()=>stopScanModal();
  document.getElementById('scan-modal-start').onclick=()=>startScanModal();
  document.getElementById('scan-modal-capture').onclick=()=>captureScanModal();
  document.getElementById('scan-modal-gallery').onclick=()=>document.getElementById('scan-modal-file').click();
  document.getElementById('scan-modal-file').onchange=e=>{if(e.target.files[0])processImageFileScan(e.target.files[0]);e.target.value='';};
}

async function startScanModal(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}}});
    scanModalStream=stream;
    const video=document.getElementById('scan-modal-video');video.srcObject=stream;
    document.getElementById('scan-modal-placeholder').style.display='none';
    document.getElementById('scan-modal-start').classList.add('hidden');
    document.getElementById('scan-modal-capture').classList.remove('hidden');
  }catch(e){showToast('Accès caméra refusé — utilisez Galerie','error');}
}

function stopScanModal(){
  if(scanModalStream){scanModalStream.getTracks().forEach(t=>t.stop());scanModalStream=null;}
  const v=document.getElementById('scan-modal-video');if(v)v.srcObject=null;
  const modal=document.getElementById('scan-modal');if(modal)modal.style.display='none';
  document.getElementById('scan-modal-start')?.classList.remove('hidden');
  document.getElementById('scan-modal-capture')?.classList.add('hidden');
}

async function captureScanModal(){
  const video=document.getElementById('scan-modal-video');
  const canvas=document.getElementById('scan-modal-canvas');
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  const dataURL=canvas.toDataURL('image/jpeg',0.9);
  stopScanModal();
  await analyzeImageForModule(dataURL);
}

async function processImageFileScan(file){
  const reader=new FileReader();
  reader.onload=async e=>{stopScanModal();await analyzeImageForModule(e.target.result);};
  reader.readAsDataURL(file);
}

async function analyzeImageForModule(dataURL){
  const se=document.getElementById('scan-ocr-status');
  const st=document.getElementById('scan-ocr-text');
  if(se)se.classList.remove('hidden');
  let result=null;
  if(navigator.onLine&&geminiKey){
    try{if(st)st.textContent='🌐 Gemini Vision...';result=await analyzeWithGemini(dataURL);}
    catch(e){console.warn('Gemini failed:',e);}
  }
  if(!result){
    if(st)st.textContent='🔍 OCR hors-ligne...';
    try{result=await analyzeWithTesseract(dataURL,st||{textContent:''});}
    catch(e){console.error('Tesseract failed:',e);}
  }
  if(se)se.classList.add('hidden');
  // Open equipment modal with captured image and context
  openEqModal(null,editingEqContext,dataURL);
  if(result)prefillModal(result);
}

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
async function loadIncidentData(){
  const zone=document.getElementById('incident-full-zone');
  if(!zone)return;
  const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,objet:'',fields:[],conclusion:'',participants:[]};
  const m=missions.find(x=>x.id===currentMissionId);
  const site=sites.find(s=>s.id===m?.siteId);

  // Build full single-page incident form
  zone.innerHTML='';

  // Header
  const hdr=document.createElement('div');hdr.className='settings-card';
  hdr.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:22px">🚨</span><div><div style="font-family:var(--font-display);font-size:18px;font-weight:700">Rapport d'incident</div><div style="color:var(--text-secondary);font-size:12px">${esc(site?.name||'')} · ${m?.dateStart||''}</div></div></div>`;
  zone.appendChild(hdr);

  // Objet
  const objCard=document.createElement('div');objCard.className='settings-card';
  objCard.innerHTML="<h3>📝 Objet de l'incident</h3>";
  const objTa=document.createElement('textarea');objTa.id='incident-objet';objTa.placeholder="Description du constat, nature de l'incident...";objTa.rows=4;objTa.style.cssText='width:100%;resize:none;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text-primary);font-size:13px;outline:none;font-family:var(--font-body)';
  objTa.value=rec.objet||'';
  objTa.addEventListener('change',saveIncidentData);
  objCard.appendChild(objTa);zone.appendChild(objCard);

  // Champs libres
  const fieldsCard=document.createElement('div');fieldsCard.className='settings-card';
  fieldsCard.innerHTML='<h3>📋 Données relevées</h3>';
  const fieldsList=document.createElement('div');fieldsList.id='incident-fields-list';
  const renderFields=(fields)=>{
    fieldsList.innerHTML='';
    fields.forEach((f,idx)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px';
      const lbl=document.createElement('div');lbl.style.cssText='flex:1;font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)';lbl.textContent=f.label;
      const inp=document.createElement('input');inp.type='text';inp.value=f.value||'';inp.placeholder='Valeur...';
      inp.style.cssText='flex:1;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-primary);font-size:13px;outline:none';
      inp.addEventListener('change',async()=>{
        const r=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};
        if(r.fields[idx])r.fields[idx].value=inp.value;await dbPut('incidentdata',r);
      });
      const del=document.createElement('button');del.className='incident-field-del';del.textContent='✕';
      del.addEventListener('click',async()=>{
        const r=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};
        r.fields.splice(idx,1);await dbPut('incidentdata',r);renderFields(r.fields);
      });
      row.appendChild(lbl);row.appendChild(inp);row.appendChild(del);fieldsList.appendChild(row);
    });
  };
  renderFields(rec.fields||[]);
  // Add field row
  const addRow=document.createElement('div');addRow.style.cssText='display:flex;gap:8px;margin-top:8px';
  const newFieldInp=document.createElement('input');newFieldInp.type='text';newFieldInp.placeholder='Libellé du champ...';
  newFieldInp.style.cssText='flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none';
  const addFieldBtn=document.createElement('button');addFieldBtn.className='btn-primary btn-sm';addFieldBtn.style.cssText='width:auto;padding:8px 14px';addFieldBtn.textContent='＋';
  addFieldBtn.addEventListener('click',async()=>{
    const label=newFieldInp.value.trim();if(!label)return;
    addFieldBtn.disabled=true;
    const r=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};
    r.fields.push({label,value:''});await dbPut('incidentdata',r);
    newFieldInp.value='';addFieldBtn.disabled=false;
    renderFields(r.fields);
  });
  newFieldInp.addEventListener('keydown',e=>{if(e.key==='Enter')addFieldBtn.click();});
  addRow.appendChild(newFieldInp);addRow.appendChild(addFieldBtn);
  fieldsCard.appendChild(fieldsList);fieldsCard.appendChild(addRow);zone.appendChild(fieldsCard);

  // Participants
  const partCard=document.createElement('div');partCard.className='settings-card';
  partCard.innerHTML="<h3>👥 Personnes présentes</h3>";
  const partList=document.createElement('div');partList.id='incident-participants-list';
  const renderParticipants=()=>{
    const participants=missions.find(x=>x.id===currentMissionId)?.participants||[];
    partList.innerHTML='';
    participants.forEach((p,pi)=>{
      const card=document.createElement('div');card.style.cssText='background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;position:relative';
      const IS='background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%';
      card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--accent2)">Personne ${pi+1}</span><button class="btn-del-comment">✕</button></div><div style="display:flex;flex-direction:column;gap:5px"><input type="text" placeholder="Nom / Prénom" value="${esc(p.nom||'')}" data-k="nom" style="${IS}"/><input type="text" placeholder="Société" value="${esc(p.societe||'')}" data-k="societe" style="${IS}"/><input type="text" placeholder="Email" value="${esc(p.email||'')}" data-k="email" style="${IS}"/><input type="text" placeholder="Téléphone" value="${esc(p.tel||'')}" data-k="tel" style="${IS}"/></div>`;
      card.querySelector('.btn-del-comment').addEventListener('click',async()=>{
        const mi=missions.findIndex(x=>x.id===currentMissionId);if(mi<0)return;
        missions[mi].participants.splice(pi,1);await dbPut('missions',missions[mi]);renderParticipants();
      });
      card.querySelectorAll('input[data-k]').forEach(inp=>{
        inp.addEventListener('change',async()=>{
          const mi=missions.findIndex(x=>x.id===currentMissionId);if(mi<0)return;
          if(!missions[mi].participants[pi])missions[mi].participants[pi]={};
          missions[mi].participants[pi][inp.dataset.k]=inp.value;await dbPut('missions',missions[mi]);
        });
      });
      partList.appendChild(card);
    });
  };
  renderParticipants();
  const addPartBtn=document.createElement('button');addPartBtn.className='btn-add-instance';addPartBtn.textContent='+ Ajouter une personne';
  addPartBtn.addEventListener('click',async()=>{
    const mi=missions.findIndex(x=>x.id===currentMissionId);if(mi<0)return;
    if(!missions[mi].participants)missions[mi].participants=[];
    missions[mi].participants.push({nom:'',societe:'',email:'',tel:''});
    await dbPut('missions',missions[mi]);renderParticipants();
  });
  partCard.appendChild(partList);partCard.appendChild(addPartBtn);zone.appendChild(partCard);

  // Photos inline
  const photoCard=document.createElement('div');photoCard.className='settings-card';
  photoCard.innerHTML='<h3>📸 Photos du constat</h3>';
  const photoContainer=document.createElement('div');photoContainer.id='incident-photos';
  const renderIncidentPhotos=async()=>{
    const rows=await getPhotoReport();photoContainer.innerHTML='';
    rows.forEach((row,idx)=>{
      const div=document.createElement('div');div.style.cssText='background:var(--bg-card);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px';
      div.innerHTML=`<div style="display:flex;gap:0;min-height:80px"><div style="width:120px;flex-shrink:0;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center">${row.photo?`<img src="${row.photo}" style="width:120px;height:90px;object-fit:cover;cursor:pointer" class="inc-thumb"/>`:` <span style="font-size:24px;opacity:.3">📷</span>`}</div><div style="flex:1;padding:8px;display:flex;flex-direction:column;gap:6px"><textarea placeholder="Commentaire..." rows="2" class="inc-cmt" style="flex:1;resize:none;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text-primary);font-size:12px;outline:none;font-family:var(--font-body)">${esc(row.comment||'')}</textarea><div style="display:flex;gap:6px"><button class="inc-cam card-btn">📷</button><button class="inc-gal card-btn">🖼️</button><button class="inc-del card-btn" style="color:var(--danger)">🗑️</button></div></div></div>`;
      if(row.photo)div.querySelector('.inc-thumb').addEventListener('click',()=>{const w=window.open();w.document.write(`<img src="${row.photo}" style="max-width:100%;display:block;margin:auto">`);});
      div.querySelector('.inc-cmt').addEventListener('change',async e=>{const r=await getPhotoReport();r[idx].comment=e.target.value;await savePhotoReport(r);});
      div.querySelector('.inc-cam').addEventListener('click',()=>{const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.capture='environment';inp.addEventListener('change',async e=>{if(!e.target.files[0])return;const reader=new FileReader();reader.onload=async ev=>{const r=await getPhotoReport();r[idx].photo=ev.target.result;await savePhotoReport(r);renderIncidentPhotos();};reader.readAsDataURL(e.target.files[0]);});inp.click();});
      div.querySelector('.inc-gal').addEventListener('click',()=>{const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.addEventListener('change',async e=>{if(!e.target.files[0])return;const reader=new FileReader();reader.onload=async ev=>{const r=await getPhotoReport();r[idx].photo=ev.target.result;await savePhotoReport(r);renderIncidentPhotos();};reader.readAsDataURL(e.target.files[0]);});inp.click();});
      div.querySelector('.inc-del').addEventListener('click',async()=>{if(!confirm('Supprimer ?'))return;const r=await getPhotoReport();r.splice(idx,1);await savePhotoReport(r);renderIncidentPhotos();});
      photoContainer.appendChild(div);
    });
    const addPhotoBtn=document.createElement('button');addPhotoBtn.className='btn-add-instance';addPhotoBtn.textContent='+ Ajouter une photo';
    addPhotoBtn.addEventListener('click',async()=>{const r=await getPhotoReport();r.push({photo:null,comment:''});await savePhotoReport(r);renderIncidentPhotos();});
    photoContainer.appendChild(addPhotoBtn);
  };
  await renderIncidentPhotos();
  photoCard.appendChild(photoContainer);zone.appendChild(photoCard);

  // Conclusion
  const conclCard=document.createElement('div');conclCard.className='settings-card';
  conclCard.innerHTML='<h3>✅ Conclusion</h3>';
  const conclSel=document.createElement('select');conclSel.id='incident-conclusion';
  conclSel.style.cssText='width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text-primary);font-size:13px;outline:none';
  ['','urgent','surveiller','traite','info'].forEach((v,i)=>{
    const o=document.createElement('option');o.value=v;o.textContent=['Sélectionner...','⚠️ Intervention urgente requise','👁️ À surveiller','✅ Traité sur place','ℹ️ Informatif'][i];
    if(rec.conclusion===v)o.selected=true;conclSel.appendChild(o);
  });
  conclSel.addEventListener('change',saveIncidentData);
  conclCard.appendChild(conclSel);zone.appendChild(conclCard);

  // Export button
  const expBtn=document.createElement('button');expBtn.className='btn-primary';expBtn.style.cssText='background:var(--danger);margin-top:4px';expBtn.textContent="🚨 Exporter rapport d'incident (PDF)";
  expBtn.addEventListener('click',exportIncidentPDF);zone.appendChild(expBtn);
}
function renderIncidentFields(fields){const list=document.getElementById('incident-fields-list');if(!list)return;list.innerHTML='';fields.forEach((f,idx)=>{const row=document.createElement('div');row.className='incident-field-row';row.innerHTML=`<span class="incident-field-label" style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${esc(f.label)}</span>`;const inp=document.createElement('input');inp.type='text';inp.value=f.value||'';inp.placeholder='Valeur...';inp.style.cssText='background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text-primary);font-size:13px;outline:none;width:120px';inp.addEventListener('change',async()=>{const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};rec.fields[idx].value=inp.value;await dbPut('incidentdata',rec);});const del=document.createElement('button');del.className='incident-field-del';del.textContent='✕';del.addEventListener('click',async()=>{const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};rec.fields.splice(idx,1);await dbPut('incidentdata',rec);renderIncidentFields(rec.fields);});row.appendChild(inp);row.appendChild(del);list.appendChild(row);});}
async function addIncidentField(){const label=document.getElementById('incident-new-field').value.trim();if(!label)return;const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,objet:'',fields:[],conclusion:''};if(!rec.fields)rec.fields=[];rec.fields.push({label,value:''});await dbPut('incidentdata',rec);document.getElementById('incident-new-field').value='';renderIncidentFields(rec.fields);}
async function saveIncidentData(){const rec=await dbGet('incidentdata',currentMissionId)||{id:currentMissionId,fields:[]};rec.objet=document.getElementById('incident-objet').value;rec.conclusion=document.getElementById('incident-conclusion').value;await dbPut('incidentdata',rec);}

// ── SETTINGS ─────────────────────────────────────────────────────
function renderCategoriesOnly(){
  const cl=document.getElementById('categories-list');if(!cl)return;
  cl.innerHTML='';
  const wrap=document.createElement('div');wrap.className='categories-list';
  categories.forEach(cat=>{
    const item=document.createElement('div');item.className='cat-item';
    // Color picker dot
    const dotWrap=document.createElement('div');dotWrap.style.cssText='display:flex;align-items:center;gap:6px;flex:1';
    const dot=document.createElement('div');dot.className='cat-dot';dot.style.background=cat.color;dot.style.cursor='pointer';dot.title='Changer la couleur';
    // Editable name
    const nameEl=document.createElement('input');nameEl.type='text';nameEl.value=cat.name;
    nameEl.style.cssText='background:none;border:none;color:var(--text-primary);font-size:13px;outline:none;flex:1;padding:0';
    nameEl.addEventListener('change',async()=>{
      const c=categories.find(x=>x.id===cat.id);if(c){c.name=nameEl.value.trim()||c.name;}
      await dbPut('config',{key:'categories',value:categories});
    });
    dotWrap.appendChild(dot);dotWrap.appendChild(nameEl);
    item.appendChild(dotWrap);
    if(!(['chaudiere','bruleur','pompe','vanne','echangeur','ballon','electrique','autre'].includes(cat.id))){
      const del=document.createElement('button');del.className='cat-del';del.textContent='✕';
      del.addEventListener('click',()=>deleteCategory(cat.id));
      item.appendChild(del);
    }
    wrap.appendChild(item);
  });
  cl.appendChild(wrap);
}

function renderSettings(){
  const ki=document.getElementById('gemini-key-input');if(ki&&geminiKey)ki.value=geminiKey;
  renderCategoriesOnly();
  // Stats
  document.getElementById('stats-container').innerHTML=`<div class="stats-grid"><div class="stat-item"><div class="stat-value">${sites.length}</div><div class="stat-label">SITES</div></div><div class="stat-item"><div class="stat-value">${missions.length}</div><div class="stat-label">MISSIONS</div></div><div class="stat-item"><div class="stat-value">${equipments.length}</div><div class="stat-label">MATÉRIELS</div></div><div class="stat-item"><div class="stat-value">${users.length}</div><div class="stat-label">UTILISATEURS</div></div></div>`;
  // Users in settings
  renderSettingsUsers();
}
function renderSettingsUsers(){
  // Create panel if needed
  let usersPanel=document.getElementById('settings-users-panel');
  if(!usersPanel){
    usersPanel=document.createElement('div');usersPanel.id='settings-users-panel';usersPanel.className='settings-card';
    // Find settings container and append
    const sc=document.querySelector('#view-settings .settings-content,#view-settings');
    if(sc)sc.appendChild(usersPanel);
  }
  usersPanel.innerHTML=`<h3>👤 Utilisateurs</h3>
    <div id="users-list-settings" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px"></div>
    <div class="settings-form-row">
      <input type="text" id="new-user-prenom" placeholder="Prénom" class="settings-input"/>
      <input type="text" id="new-user-nom" placeholder="Nom" class="settings-input"/>
    </div>
    <input type="text" id="new-user-email" placeholder="Email" class="settings-input" style="margin-top:6px;width:100%"/>
    <button class="btn-primary" id="btn-add-user" style="margin-top:8px">+ Ajouter utilisateur</button>`;
  document.getElementById('btn-add-user')?.addEventListener('click',addUser);

  const list=document.getElementById('users-list-settings');
  if(!list)return;
  list.innerHTML='';
  if(!users.length){list.innerHTML='<p style="color:var(--text-muted);font-size:13px">Aucun utilisateur.</p>';return;}

  users.forEach(u=>{
    const isActive=currentUser?.id===u.id;
    const item=document.createElement('div');
    item.className='user-card'+(isActive?' active-user':'');
    item.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)';
    if(isActive)item.style.borderColor='var(--accent)';

    const avatar=document.createElement('div');avatar.className='user-avatar';
    avatar.textContent=((u.prenom||u.nom||'?')[0]).toUpperCase();

    const info=document.createElement('div');info.style.flex='1';
    info.innerHTML=`<div class="user-name">${esc(u.prenom||'')} ${esc(u.nom||'')}</div><div class="user-email">${esc(u.email||'')}</div>`;

    const actions=document.createElement('div');actions.style.cssText='display:flex;gap:6px;align-items:center';

    if(isActive){
      const badge=document.createElement('span');badge.style.cssText='color:var(--accent);font-size:13px;font-weight:700';badge.textContent='✓ Actif';
      actions.appendChild(badge);
    }else{
      const selBtn=document.createElement('button');selBtn.className='btn-primary btn-sm';
      selBtn.style.cssText='width:auto;padding:6px 12px;font-size:12px';selBtn.textContent='Choisir';
      selBtn.addEventListener('click',async(e)=>{
        e.stopPropagation();
        currentUser=u;
        await dbPut('config',{key:'currentUser',value:u});
        showToast(`Connecté : ${u.prenom} ${u.nom}`,'success');
        renderSettingsUsers(); // refresh list
      });
      actions.appendChild(selBtn);
    }

    const del=document.createElement('button');del.className='card-btn';del.textContent='🗑️';del.title='Supprimer';
    del.addEventListener('click',async(e)=>{
      e.stopPropagation();
      if(!confirm(`Supprimer ${u.prenom} ${u.nom} ?`))return;
      await dbDel('users',u.id);users=users.filter(x=>x.id!==u.id);
      if(currentUser?.id===u.id){currentUser=null;await dbDel('config','currentUser');}
      renderSettingsUsers();
    });
    actions.appendChild(del);

    item.appendChild(avatar);item.appendChild(info);item.appendChild(actions);
    list.appendChild(item);
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
async function addCategory(){
  const inp=document.getElementById('new-cat-input');
  const name=inp.value.trim();
  if(!name)return;
  // Prevent double-click duplicates
  inp.disabled=true;
  const colors=['#f43f5e','#f97316','#eab308','#84cc16','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#d946ef'];
  const id=name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')+'_'+Date.now();
  categories.push({id,name,color:colors[categories.length%colors.length]});
  await dbPut('config',{key:'categories',value:categories});
  inp.value='';inp.disabled=false;
  // Immediate targeted re-render of just the categories list
  renderCategoriesOnly();
  showToast('Catégorie ajoutée ✓','success');
}
async function deleteCategory(id){
  if(equipments.some(e=>e.category===id)){showToast('Catégorie utilisée — réassignez d\'abord les équipements','error');return;}
  if(!confirm('Supprimer cette catégorie ?'))return;
  categories=categories.filter(c=>c.id!==id);
  await dbPut('config',{key:'categories',value:categories});
  renderCategoriesOnly();
  showToast('Catégorie supprimée');
}
async function clearAll(){if(!confirm('Effacer TOUTES les données ?'))return;for(const s of sites)await dbDel('sites',s.id);for(const m of missions)await dbDel('missions',m.id);for(const e of equipments)await dbDel('equipments',e.id);for(const f of formDataStore)await dbDel('formdata',f.id);sites=[];missions=[];equipments=[];formDataStore=[];renderSettings();renderSites();showToast('Données effacées');}
function backupData(){download(JSON.stringify({version:4,app:'adiatool',exportedAt:new Date().toISOString(),sites,missions,equipments:equipments.map(e=>({...e,photo:null})),formDataStore,users,categories},null,2),`adiatool_backup_${today()}.json`,'application/json');showToast('Sauvegarde téléchargée');}
async function restoreData(file){try{const data=JSON.parse(await file.text());if(!data.sites)throw new Error('Format invalide');if(!confirm(`Restaurer ${data.sites.length} sites ?`))return;for(const s of sites)await dbDel('sites',s.id);for(const m of missions)await dbDel('missions',m.id);for(const e of equipments)await dbDel('equipments',e.id);for(const f of formDataStore)await dbDel('formdata',f.id);sites=[];missions=[];equipments=[];formDataStore=[];for(const s of data.sites){await dbPut('sites',s);sites.push(s);}for(const m of data.missions){await dbPut('missions',m);missions.push(m);}for(const e of data.equipments){await dbPut('equipments',e);equipments.push(e);}if(data.formDataStore)for(const f of data.formDataStore){await dbPut('formdata',f);formDataStore.push(f);}if(data.users)for(const u of data.users){await dbPut('users',u);users.push(u);}if(data.categories){categories=data.categories;await dbPut('config',{key:'categories',value:categories});}renderSettings();renderSites();showToast('Restauration réussie ✓','success');}catch(e){showToast('Erreur: '+e.message,'error');}}

// ── EXPORTS (shortened - same as v3) ─────────────────────────────
// ── REPORT TAB ─────────────────────────────────────────────────────
function initReportTab(){
  // Cover photo
  const coverImg=document.getElementById('cover-photo-img');
  const coverPlaceholder=document.getElementById('cover-photo-placeholder');
  const coverRemove=document.getElementById('btn-cover-remove');
  // Load saved cover photo
  const stored=sessionStorage.getItem('cover_photo_'+currentMissionId);
  if(stored){coverImg.src=stored;coverImg.style.display='block';coverPlaceholder.style.display='none';coverRemove.style.display='';}
  else{coverImg.style.display='none';coverPlaceholder.style.display='flex';coverRemove.style.display='none';}

  // Load saved conclusion
  const savedConclusion=sessionStorage.getItem('conclusion_'+currentMissionId)||'';
  const conclEl=document.getElementById('report-conclusion-text');
  if(conclEl&&!conclEl.value)conclEl.value=savedConclusion;
  if(conclEl)conclEl.addEventListener('input',()=>sessionStorage.setItem('conclusion_'+currentMissionId,conclEl.value));

  const setCoverPhoto=(dataURL)=>{
    sessionStorage.setItem('cover_photo_'+currentMissionId,dataURL);
    coverImg.src=dataURL;coverImg.style.display='block';
    coverPlaceholder.style.display='none';coverRemove.style.display='';
  };

  // Prevent duplicate listeners
  const cameraBtn=document.getElementById('btn-cover-camera');
  const galleryBtn=document.getElementById('btn-cover-gallery');
  const fileInput=document.getElementById('cover-photo-input');
  const newCameraBtn=cameraBtn.cloneNode(true);const newGalleryBtn=galleryBtn.cloneNode(true);
  cameraBtn.replaceWith(newCameraBtn);galleryBtn.replaceWith(newGalleryBtn);

  document.getElementById('btn-cover-camera').addEventListener('click',()=>{
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.capture='environment';
    inp.addEventListener('change',e=>{if(!e.target.files[0])return;const r=new FileReader();r.onload=ev=>setCoverPhoto(ev.target.result);r.readAsDataURL(e.target.files[0]);});inp.click();
  });
  document.getElementById('btn-cover-gallery').addEventListener('click',()=>{
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
    inp.addEventListener('change',e=>{if(!e.target.files[0])return;const r=new FileReader();r.onload=ev=>setCoverPhoto(ev.target.result);r.readAsDataURL(e.target.files[0]);});inp.click();
  });
  document.getElementById('btn-cover-remove')?.addEventListener('click',()=>{
    sessionStorage.removeItem('cover_photo_'+currentMissionId);
    coverImg.style.display='none';coverPlaceholder.style.display='flex';
    document.getElementById('btn-cover-remove').style.display='none';
  });
}


function exportCSV(){const mission=missions.find(m=>m.id===currentMissionId);const site=sites.find(s=>s.id===mission?.siteId);const mEqs=equipments.filter(e=>e.missionId===currentMissionId);if(!mEqs.length){showToast('Aucun matériel','error');return;}const headers=['Code affaire','Site','Type mission','Module','Catégorie','Désignation','Marque','Modèle','N° Série','Année','Puissance','Fluide','Localisation','État','Observations'];const rows=mEqs.map(eq=>{const cat=categories.find(c=>c.id===eq.category)?.name||eq.category;const modLabel=FORM_MODULES.find(m=>m.id===eq.moduleId)?.label||eq.moduleId||'';return[site?.codeAffaire,site?.name,TL[mission?.type],modLabel,cat,eq.name,eq.brand,eq.model,eq.serial,eq.year,eq.power,eq.fluid,eq.location,{bon:'Bon état',correct:'Correct',degrade:'Dégradé',hs:'Hors service'}[eq.condition],eq.notes].map(x=>`"${(x||'').toString().replace(/"/g,'""')}"`);}); download('\uFEFF'+[headers.join(';'),...rows.map(r=>r.join(';'))].join('\r\n'),`adiatool_materiels_${today()}.csv`,'text/csv;charset=utf-8;');showToast('CSV exporté');}
async function exportExcel(){showToast('Export Excel — utilisez le PDF pour un rapport complet','');exportCSV();}
async function exportWord(){
  showToast('Génération du rapport Word...','');
  const mission=missions.find(m=>m.id===currentMissionId);
  const site=sites.find(s=>s.id===mission?.siteId);
  const fd=getMFD();
  const notesRec=await dbGet('notes',currentMissionId);
  const photoRec=await dbGet('photoreport',currentMissionId);
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId);

  const inclReleves=document.getElementById('rpt-releves')?.checked!==false;
  const inclNotes=document.getElementById('rpt-notes')?.checked!==false;
  const inclPhotos=document.getElementById('rpt-photos')?.checked!==false;
  const inclMateriels=document.getElementById('rpt-materiels')?.checked!==false;

  const coverPhoto=sessionStorage.getItem('cover_photo_'+currentMissionId)||'';
  const conclusion=document.getElementById('report-conclusion-text')?.value||'';
  const dateStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});

  const yn=(v)=>({oui:"Oui",non:"Non",na:"N/A",pi:"Pas d'info",yes:"Oui",no:"Non"}[v]||v||"—");

  // Build HTML that Word/Pages can open
  let body='';

  // ── PAGE DE GARDE ──
  body+=`
  <div style="page-break-after:always;min-height:25cm;display:flex;flex-direction:column;justify-content:space-between;padding:2cm">
    ${coverPhoto?`<div style="text-align:center;margin-bottom:20mm"><img src="${coverPhoto}" style="max-width:100%;max-height:12cm;object-fit:cover;border-radius:8px"/></div>`:'<div style="height:12cm;background:#f0f4f8;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:20mm"><span style="color:#aaa;font-size:24pt">🏢</span></div>'}
    <div>
      <div style="font-size:28pt;font-weight:700;color:#1e3f5e;margin-bottom:8mm">${esc(TL[mission?.type]||mission?.type||'Rapport')}</div>
      <div style="font-size:18pt;color:#333;margin-bottom:4mm">${esc(site?.name||'')}</div>
      <div style="font-size:12pt;color:#666;margin-bottom:2mm">${[site?.address,site?.zip,site?.city].filter(Boolean).join(', ')}</div>
      ${site?.codeAffaire?`<div style="font-size:11pt;color:#888">Code affaire : ${esc(site.codeAffaire)}</div>`:''}
    </div>
    <div style="border-top:2px solid #1e7fd4;padding-top:8mm;display:flex;justify-content:space-between">
      <div style="color:#666;font-size:10pt">Intervenant : ${esc(mission?.operator||'')}</div>
      <div style="color:#666;font-size:10pt">${mission?.dateStart||dateStr}</div>
    </div>
    <div style="text-align:center;margin-top:4mm"><div style="font-family:monospace;font-size:14pt;letter-spacing:4px;color:#1e7fd4;font-weight:700">ADIATHERM</div></div>
  </div>`;

  // ── SOMMAIRE ──
  body+=`<div style="page-break-after:always;padding:1.5cm">
    <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">Sommaire</h1>
    <div style="margin-top:10mm;font-size:12pt;line-height:2.2">
      <div>1. Informations générales</div>
      ${inclReleves?'<div>2. Relevés techniques</div>':''}
      ${inclNotes&&notesRec?.text?'<div>3. Notes de visite</div>':''}
      ${inclPhotos&&photoRec?.rows?.length?'<div>4. Reportage photographique</div>':''}
      ${conclusion?'<div>5. Conclusion</div>':''}
      ${inclMateriels&&mEqs.length?'<div>6. Annexe — Synthèse matériels</div>':''}
    </div>
  </div>`;

  // ── INFORMATIONS GÉNÉRALES ──
  body+=`<div style="page-break-after:always;padding:1.5cm">
    <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">1. Informations générales</h1>
    <table style="width:100%;border-collapse:collapse;margin-top:8mm;font-size:11pt">
      <tr><td colspan="2" style="background:#1e3f5e;color:white;padding:6px 10px;font-weight:700">SITE</td></tr>
      ${[['Nom',site?.name],['Code affaire',site?.codeAffaire],['Adresse',[site?.address,site?.zip,site?.city].filter(Boolean).join(', ')],['Énergie',site?.energie],['Contact',site?.contact]].filter(([,v])=>v).map(([l,v])=>`<tr><td style="padding:5px 10px;border:1px solid #dee;background:#f8f9fa;width:35%;color:#555">${l}</td><td style="padding:5px 10px;border:1px solid #dee">${esc(String(v))}</td></tr>`).join('')}
      <tr><td colspan="2" style="background:#1e3f5e;color:white;padding:6px 10px;font-weight:700;margin-top:4mm">MISSION</td></tr>
      ${[['Type',TL[mission?.type]],['Date',mission?.dateStart],['Intervenant',mission?.operator],['Référence',mission?.ref],['Statut',SL[mission?.status]]].filter(([,v])=>v).map(([l,v])=>`<tr><td style="padding:5px 10px;border:1px solid #dee;background:#f8f9fa;width:35%;color:#555">${l}</td><td style="padding:5px 10px;border:1px solid #dee">${esc(String(v))}</td></tr>`).join('')}
    </table>
  </div>`;

  // ── RELEVÉS ──
  if(inclReleves){
    const locaux=fd.locaux||[];
    body+=`<div style="padding:1.5cm">
      <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">2. Relevés techniques</h1>`;
    locaux.forEach((loc,li)=>{
      const lk=`local_${li}`;
      const lfd=(fd.localData||{})[lk]||{data:{},repeatData:{},comments:{}};
      const activeModules=(fd.localModules||{})[lk]||[];
      if(!activeModules.length)return;
      body+=`<h2 style="color:#1e7fd4;margin-top:8mm;font-size:15pt">${esc(loc.nom?`${loc.type} — ${loc.nom}`:loc.type||`Local ${li+1}`)}</h2>`;
      FORM_MODULES.forEach(mod=>{
        if(!activeModules.includes(mod.id))return;
        body+=`<h3 style="color:#333;font-size:12pt;margin-top:6mm;border-bottom:1px solid #ccc;padding-bottom:2mm">${mod.icon} ${mod.label}</h3>`;
        if(mod.repeatable){
          const instances=(lfd.repeatData[mod.id]||[{}]);
          instances.forEach((inst,idx)=>{
            if(instances.length>1)body+=`<div style="font-weight:600;color:#1e7fd4;font-size:11pt;margin-top:4mm">${mod.repeatLabel} ${idx+1}</div>`;
            body+=`<table style="width:100%;border-collapse:collapse;font-size:10pt;margin-top:3mm">`;
            mod.fields.filter(f=>f.type!=='section'&&f.type!=='equipment_inline'&&f.type!=='mesures_chauf'&&f.type!=='mesures_temp'&&f.type!=='mesures_libres'&&f.type!=='courbe_chauffe'&&f.type!=='decalage_stepper').forEach(f=>{
              const val=inst[f.id]||'';if(!val)return;
              body+=`<tr><td style="padding:4px 8px;border:1px solid #eee;background:#f8f9fa;width:40%;color:#555;font-size:9pt">${esc(f.label)}</td><td style="padding:4px 8px;border:1px solid #eee">${esc(f.type==='yesno3'||f.type==='yesno'?yn(val):String(val))}</td></tr>`;
              // Comments
              const ck=`${mod.id}_${f.id}_${idx}`;
              const cmts=(lfd.comments||{})[ck]||[];
              cmts.forEach(c=>{body+=`<tr><td colspan="2" style="padding:2px 8px 2px 20px;border:1px solid #eee;font-style:italic;color:${c.type==='pos'?'#166534':c.type==='neg'?'#991b1b':'#6b7280'};font-size:9pt">${c.type==='pos'?'✅':c.type==='neg'?'⚠️':'—'} ${esc(c.text)}</td></tr>`;});
            });
            body+=`</table>`;
          });
        }else{
          const data=lfd.data[mod.id]||{};
          const allF=mod.sections?mod.sections.flatMap(s=>[{type:'__sec',label:s.title},...s.fields]):(mod.fields||[]);
          body+=`<table style="width:100%;border-collapse:collapse;font-size:10pt;margin-top:3mm">`;
          allF.forEach(f=>{
            if(f.type==='__sec'||f.type==='section'){body+=`<tr><td colspan="2" style="padding:5px 8px;background:#e8f0f8;color:#1e3f5e;font-weight:700;font-size:9pt;text-transform:uppercase;letter-spacing:0.5px">${esc(f.label)}</td></tr>`;return;}
            if(['equipment_inline','mesures_chauf','mesures_temp','mesures_libres','courbe_chauffe','decalage_stepper'].includes(f.type))return;
            const val=data[f.id]||'';if(!val)return;
            body+=`<tr><td style="padding:4px 8px;border:1px solid #eee;background:#f8f9fa;width:40%;color:#555;font-size:9pt">${esc(f.label)}</td><td style="padding:4px 8px;border:1px solid #eee">${esc(f.type==='yesno3'||f.type==='yesno'?yn(val):String(val))}</td></tr>`;
            const ck=`${mod.id}_${f.id}`;const cmts=(lfd.comments||{})[ck]||[];
            cmts.forEach(c=>{body+=`<tr><td colspan="2" style="padding:2px 8px 2px 20px;border:1px solid #eee;font-style:italic;color:${c.type==='pos'?'#166534':c.type==='neg'?'#991b1b':'#6b7280'};font-size:9pt">${c.type==='pos'?'✅':c.type==='neg'?'⚠️':'—'} ${esc(c.text)}</td></tr>`;});
          });
          body+=`</table>`;
        }
      });
    });
    body+=`</div>`;
  }

  // ── NOTES ──
  if(inclNotes&&notesRec?.text){
    body+=`<div style="page-break-before:always;padding:1.5cm">
      <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">3. Notes de visite</h1>
      <div style="background:#fff8f0;border-left:4px solid #1e7fd4;padding:10mm;margin-top:8mm;font-size:11pt;line-height:1.7;white-space:pre-wrap">${esc(notesRec.text)}</div>
    </div>`;
  }

  // ── PHOTOS ──
  if(inclPhotos&&photoRec?.rows?.length){
    body+=`<div style="page-break-before:always;padding:1.5cm">
      <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">4. Reportage photographique</h1>`;
    const photoRows=photoRec.rows;
    for(let i=0;i<photoRows.length;i+=2){
      body+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:6mm">`;
      for(let j=i;j<Math.min(i+2,photoRows.length);j++){
        const row=photoRows[j];
        body+=`<div style="border:1px solid #dee;border-radius:6px;overflow:hidden">
          ${row.photo?`<img src="${row.photo}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block"/>`:'<div style="aspect-ratio:4/3;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#aaa">Pas de photo</div>'}
          <div style="padding:6px 8px;font-size:9pt;color:#444;line-height:1.4;min-height:24px">${esc(row.comment||'')}</div>
        </div>`;
      }
      body+=`</div>`;
    }
    body+=`</div>`;
  }

  // ── CONCLUSION ──
  if(conclusion){
    body+=`<div style="page-break-before:always;padding:1.5cm">
      <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">5. Conclusion</h1>
      <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:10mm;margin-top:8mm;font-size:12pt;line-height:1.8;white-space:pre-wrap">${esc(conclusion)}</div>
    </div>`;
  }

  // ── ANNEXE MATÉRIELS ──
  if(inclMateriels&&mEqs.length){
    const moduleOrder=['primaire','chauffage','ecs','autres_materiels'];
    body+=`<div style="page-break-before:always;padding:1.5cm">
      <h1 style="color:#1e3f5e;border-bottom:3px solid #1e7fd4;padding-bottom:5mm;font-size:20pt">6. Annexe — Synthèse matériels</h1>`;
    moduleOrder.forEach(modId=>{
      const grpEqs=mEqs.filter(e=>(e.moduleId||'').replace(/_\d+$/,'')===modId||(e.moduleContext||'').replace(/_\d+$/,'')===modId);
      if(!grpEqs.length)return;
      const mod=FORM_MODULES.find(m=>m.id===modId);
      body+=`<h2 style="color:#1e7fd4;font-size:13pt;margin-top:8mm">${mod?.icon||''} ${mod?.label||modId}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:10pt;margin-top:4mm">
        <tr style="background:#1e3f5e;color:white"><th style="padding:5px 8px;text-align:left">Désignation</th><th style="padding:5px 8px;text-align:left">Marque / Modèle</th><th style="padding:5px 8px;text-align:left">N° Série</th><th style="padding:5px 8px;text-align:left">Puissance</th><th style="padding:5px 8px;text-align:left">État</th></tr>`;
      grpEqs.forEach((eq,i)=>{
        const CLE={bon:'Bon état',correct:'Correct',degrade:'Dégradé',hs:'Hors service'};
        body+=`<tr style="background:${i%2===0?'#f8f9fa':'white'}"><td style="padding:4px 8px;border:1px solid #eee">${esc(eq.name||'—')}</td><td style="padding:4px 8px;border:1px solid #eee">${esc([eq.brand,eq.model].filter(Boolean).join(' '))}</td><td style="padding:4px 8px;border:1px solid #eee;font-family:monospace;font-size:9pt">${esc(eq.serial||'—')}</td><td style="padding:4px 8px;border:1px solid #eee">${esc(eq.power||'—')}</td><td style="padding:4px 8px;border:1px solid #eee">${esc(CLE[eq.condition]||'—')}</td></tr>`;
      });
      body+=`</table>`;
    });
    body+=`</div>`;
  }

  // ── PIED DE PAGE ──
  const footerNote=`<div style="text-align:center;color:#aaa;font-size:8pt;margin-top:15mm;padding-top:5mm;border-top:1px solid #eee">ADIATOOL — ${dateStr} — ${esc(site?.name||'')} — Document généré automatiquement</div>`;

  const fullHtml=`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width"/>
<title>Rapport — ${esc(site?.name||'')} — ${mission?.dateStart||''}</title>
<style>
  @page{size:A4;margin:15mm}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#222;margin:0;padding:0}
  h1,h2,h3{font-family:Arial,Helvetica,sans-serif}
  table{page-break-inside:avoid}
  img{max-width:100%}
  .page-break{page-break-before:always}
</style>
</head>
<body>
${body}
${footerNote}
</body>
</html>`;

  // On iPhone: open in new tab — user can share to Files/Pages/Word
  // On desktop: download as .html (opens in Word via File > Open)
  const blob=new Blob([fullHtml],{type:'application/vnd.ms-word;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const filename=`Rapport_${slugify(site?.name||'ADIATHERM')}_${mission?.dateStart||today()}.doc`;

  // Try download first, fallback to new tab (better for iPhone)
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast('Rapport Word généré — ouvrir avec Word ou Pages','success');
}
async function exportPDF(){
  // On iPhone, the Word export opens in Pages/Word which can export to PDF
  // Direct print-to-PDF is unreliable on iPhone Safari
  // Instead: open a print-friendly HTML page
  showToast('Utilisez l\'export Word puis "Enregistrer en PDF" depuis Pages ou Word','');
  // Still open a printable version for desktop users
  const mission=missions.find(m=>m.id===currentMissionId);
  const site=sites.find(s=>s.id===mission?.siteId);
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;font-size:10pt}</style></head><body><h1>${esc(TL[mission?.type]||'')} — ${esc(site?.name||'')}</h1><p>Pour un rapport complet, utilisez l'export Word.</p><script>window.onload=()=>{if(navigator.userAgent.includes('iPhone')||navigator.userAgent.includes('iPad')){document.body.innerHTML+='<p>Sur iPhone/iPad : utilisez l\'export Word puis partagez vers Pages ou Word.</p>';}else{window.print();}}<\/script></body></html>`;
  window.open(URL.createObjectURL(new Blob([html],{type:'text/html'})),'_blank');
}
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
