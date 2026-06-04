'use strict';
// ═══════════════════════════════════════════════════════════════
//  ADIATOOL — Application principale
//  Nouveautés : Notes libres · Reportage photo · Export Excel
// ═══════════════════════════════════════════════════════════════

// ── DB ──────────────────────────────────────────────────────────
const DB_NAME='AdiatoolDB',DB_VER=2;
let db;
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      ['sites','missions','equipments','formdata','notes','photoreport','config'].forEach(s=>{
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

// ── STATE ────────────────────────────────────────────────────────
let sites=[],missions=[],equipments=[],formDataStore=[],categories=[],geminiKey='';
let currentSiteId=null,currentMissionId=null;
let editingSiteId=null,editingMissionId=null,editingEqId=null;
let capturedImage=null,attachedPhoto=null,cameraStream=null;
let notesSaveTimer=null;

const DEFAULT_CATEGORIES=[
  {id:'chaudiere',name:'Chaudière',color:'#f97316'},{id:'bruleur',name:'Brûleur',color:'#ef4444'},
  {id:'pompe',name:'Pompe / Circulateur',color:'#3b82f6'},{id:'vanne',name:'Vanne / Régulation',color:'#a855f7'},
  {id:'echangeur',name:'Échangeur',color:'#22d3ee'},{id:'ballon',name:'Ballon ECS',color:'#10b981'},
  {id:'electrique',name:'Équipement élec.',color:'#eab308'},{id:'autre',name:'Autre',color:'#6b7280'},
];
const SL={en_cours:'En cours',termine:'Terminée',planifie:'Planifiée'};
const TL={audit:'Audit',inventaire:'Inventaire',controle:'Contrôle',maintenance:'Maintenance',expertise:'Expertise',autre:'Autre'};
const CL={bon:'Bon état',correct:'Correct',degrade:'Dégradé',hs:'Hors service'};

// ── INIT ─────────────────────────────────────────────────────────
async function init(){
  db=await openDB();
  const catCfg=await dbGet('config','categories');categories=catCfg?catCfg.value:[...DEFAULT_CATEGORIES];
  const keyCfg=await dbGet('config','geminiKey');geminiKey=keyCfg?keyCfg.value:'';
  [sites,missions,equipments,formDataStore]=await Promise.all([
    dbGetAll('sites'),dbGetAll('missions'),dbGetAll('equipments'),dbGetAll('formdata')
  ]);
  document.getElementById('splash-logo').src=LOGO_URI;
  document.getElementById('header-logo').src=LOGO_URI;
  setupEvents();
  updateNet();
  window.addEventListener('online',updateNet);window.addEventListener('offline',updateNet);
  await sleep(1900);
  document.getElementById('splash').classList.add('fade-out');
  await sleep(500);
  document.getElementById('splash').style.display='none';
  document.getElementById('app').classList.remove('hidden');
  showView('dashboard');
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function updateNet(){document.getElementById('net-dot').classList.toggle('offline',!navigator.onLine);}

// ── VIEWS ─────────────────────────────────────────────────────────
function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  const backBtn=document.getElementById('btn-back');
  const expBtn=document.getElementById('btn-header-export');
  backBtn.classList.add('hidden');expBtn.style.display='none';
  document.getElementById('btn-settings-nav').style.display='';
  const title=document.getElementById('header-title');
  const sub=document.getElementById('header-sub');
  if(name==='dashboard'){title.innerHTML='ADIA<span>TOOL</span>';sub.textContent='Tableau de bord';}
  else if(name==='site'){
    const s=sites.find(x=>x.id===currentSiteId);
    title.innerHTML=esc(s?.name||'Site');sub.textContent=s?.city||'';
    backBtn.classList.remove('hidden');document.getElementById('btn-settings-nav').style.display='none';
    renderSiteView();
  }else if(name==='mission'){
    const m=missions.find(x=>x.id===currentMissionId);
    const s=sites.find(x=>x.id===m?.siteId);
    title.innerHTML=esc(m?.name||'Mission');sub.textContent=s?.name||'';
    backBtn.classList.remove('hidden');expBtn.style.display='';expBtn.onclick=()=>switchMTab('report');
    document.getElementById('btn-settings-nav').style.display='none';
    renderMissionView();
  }else if(name==='settings'){
    title.innerHTML='ADIA<span>TOOL</span>';sub.textContent='Paramètres';
    backBtn.classList.remove('hidden');document.getElementById('btn-settings-nav').style.display='none';
    renderSettings();
  }
}

function switchMTab(name){
  document.querySelectorAll('[data-mtab]').forEach(b=>b.classList.toggle('active',b.dataset.mtab===name));
  document.querySelectorAll('[id^="mtab-"]').forEach(c=>c.classList.toggle('active',c.id==='mtab-'+name));
  if(name==='forms')renderFormsZone();
  if(name==='notes')loadNotes();
  if(name==='photos')renderPhotoRows();
  if(name!=='scan')stopCamera();
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
    if(av.id==='view-mission')showView('site');
    else if(av.id==='view-site')showView('dashboard');
    else if(av.id==='view-settings')showView('dashboard');
    stopCamera();
  });
  document.getElementById('btn-settings-nav').addEventListener('click',()=>showView('settings'));
  document.getElementById('site-search').addEventListener('input',e=>renderSites(e.target.value));
  document.getElementById('mission-search-all').addEventListener('input',renderAllMissions);
  document.getElementById('mission-filter-status').addEventListener('change',renderAllMissions);
  document.getElementById('eq-search').addEventListener('input',renderMissionEqs);
  document.getElementById('eq-filter-cat').addEventListener('change',renderMissionEqs);
  document.getElementById('btn-add-site').addEventListener('click',()=>openSiteModal());
  document.getElementById('btn-add-mission').addEventListener('click',()=>openMissionModal());
  document.getElementById('btn-add-eq').addEventListener('click',()=>openEqModal());
  document.querySelectorAll('.modal-close,[data-modal]').forEach(btn=>{
    btn.addEventListener('click',()=>{const id=btn.dataset.modal||btn.closest('.modal')?.id;if(id)document.getElementById(id).classList.add('hidden');});
  });
  document.querySelectorAll('.modal-backdrop').forEach(bd=>{bd.addEventListener('click',()=>bd.closest('.modal').classList.add('hidden'));});
  document.getElementById('btn-save-site').addEventListener('click',saveSite);
  document.getElementById('btn-save-mission').addEventListener('click',saveMission);
  document.getElementById('btn-save-equipment').addEventListener('click',saveEquipment);
  document.getElementById('btn-start-camera').addEventListener('click',startCamera);
  document.getElementById('btn-capture').addEventListener('click',captureFromCamera);
  document.getElementById('btn-upload-photo').addEventListener('click',()=>document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change',e=>{if(e.target.files[0])processImageFile(e.target.files[0]);e.target.value='';});
  document.getElementById('btn-attach-photo').addEventListener('click',()=>document.getElementById('attach-file-input').click());
  document.getElementById('attach-file-input').addEventListener('change',e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();reader.onload=ev=>{attachedPhoto=ev.target.result;const img=document.getElementById('field-photo-preview');img.src=attachedPhoto;img.classList.remove('hidden');};reader.readAsDataURL(f);e.target.value='';
  });
  // Notes auto-save
  document.getElementById('notes-textarea').addEventListener('input',()=>{
    if(notesSaveTimer)clearTimeout(notesSaveTimer);
    document.getElementById('notes-saved').textContent='';
    notesSaveTimer=setTimeout(saveNotes,1000);
  });
  // Photo report
  document.getElementById('btn-add-photo-row').addEventListener('click',addPhotoRow);
  // Exports
  document.getElementById('btn-export-pdf').addEventListener('click',exportPDF);
  document.getElementById('btn-export-excel').addEventListener('click',exportExcel);
  document.getElementById('btn-export-csv').addEventListener('click',exportCSV);
  // Settings
  document.getElementById('btn-save-gemini').addEventListener('click',saveGeminiKey);
  document.getElementById('btn-add-cat').addEventListener('click',addCategory);
  document.getElementById('new-cat-input').addEventListener('keydown',e=>{if(e.key==='Enter')addCategory();});
  document.getElementById('btn-clear-all').addEventListener('click',clearAll);
  document.getElementById('btn-backup').addEventListener('click',backupData);
  document.getElementById('btn-restore-btn').addEventListener('click',()=>document.getElementById('restore-input').click());
  document.getElementById('restore-input').addEventListener('change',e=>{if(e.target.files[0])restoreData(e.target.files[0]);e.target.value='';});
  renderSites();renderCatFilter();
}

// ── RENDER DASHBOARD ──────────────────────────────────────────────
function renderSites(search=''){
  const list=document.getElementById('sites-list');
  const f=sites.filter(s=>!search||(s.name||'').toLowerCase().includes(search.toLowerCase())||(s.city||'').toLowerCase().includes(search.toLowerCase()));
  if(!f.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">🏢</div><p>${sites.length===0?'Aucun site.<br>Appuyez sur + pour commencer.':'Aucun résultat.'}</p></div>`;return;}
  list.innerHTML='';
  f.sort((a,b)=>a.name.localeCompare(b.name)).forEach(site=>{
    const sm=missions.filter(m=>m.siteId===site.id);
    const se=equipments.filter(e=>sm.some(m=>m.id===e.missionId));
    const card=document.createElement('div');card.className='site-card';
    card.innerHTML=`<div class="card-header"><div><div class="card-title">${esc(site.name)}</div><div class="card-sub">${esc([site.address,site.zip,site.city].filter(Boolean).join(' '))}</div></div><div class="card-actions"><button class="card-btn" data-id="${site.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${site.id}" data-action="delete">🗑️</button></div></div><div class="card-stats"><span class="cstat"><span>${sm.length}</span> mission${sm.length!==1?'s':''}</span><span class="cstat"><span>${se.length}</span> équip.</span>${site.energie?`<span class="cstat">${esc(site.energie)}</span>`:''}</div>`;
    card.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn){currentSiteId=site.id;showView('site');return;}if(btn.dataset.action==='edit')openSiteModal(site.id);else deleteSite(site.id);});
    list.appendChild(card);
  });
}
function renderAllMissions(){
  const search=document.getElementById('mission-search-all').value.toLowerCase();
  const sf=document.getElementById('mission-filter-status').value;
  const list=document.getElementById('all-missions-list');
  let f=missions.filter(m=>{const s=sites.find(x=>x.id===m.siteId);return(!search||(m.name||'').toLowerCase().includes(search)||(s?.name||'').toLowerCase().includes(search))&&(!sf||m.status===sf);});
  f.sort((a,b)=>(b.dateStart||'').localeCompare(a.dateStart||''));
  if(!f.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><p>Aucune mission.</p></div>`;return;}
  list.innerHTML='';f.forEach(m=>renderMissionCard(m,list,true));
}
function renderMissionCard(m,container,showSite=false){
  const site=sites.find(s=>s.id===m.siteId);
  const eqc=equipments.filter(e=>e.missionId===m.id).length;
  const card=document.createElement('div');card.className=`mission-card status-${m.status||'planifie'}`;
  card.innerHTML=`<div class="card-header"><div style="flex:1"><div class="card-title">${esc(m.name)}</div><div style="display:flex;gap:5px;flex-wrap:wrap;margin:4px 0"><span class="badge s-${m.status||'planifie'}">${SL[m.status]||m.status}</span><span class="badge">${TL[m.type]||m.type||'—'}</span>${m.ref?`<span class="badge">${esc(m.ref)}</span>`:''}</div>${showSite&&site?`<div class="card-sub">🏢 ${esc(site.name)}</div>`:''}<div class="card-sub">${m.dateStart||''}${m.dateEnd?' → '+m.dateEnd:''}</div><div class="card-sub" style="color:var(--accent2)"><span>${eqc}</span> équip.</div></div><div class="card-actions"><button class="card-btn" data-id="${m.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${m.id}" data-action="delete">🗑️</button></div></div>`;
  card.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn){currentMissionId=m.id;currentSiteId=m.siteId;showView('mission');return;}if(btn.dataset.action==='edit')openMissionModal(m.id);else deleteMission(m.id);});
  container.appendChild(card);
}

// ── SITE VIEW ─────────────────────────────────────────────────────
function renderSiteView(){
  document.querySelectorAll('[data-stab]').forEach(b=>b.classList.toggle('active',b.dataset.stab==='missions'));
  document.querySelectorAll('[id^="stab-"]').forEach(c=>c.classList.toggle('active',c.id==='stab-missions'));
  const list=document.getElementById('site-missions-list');list.innerHTML='';
  const sm=missions.filter(m=>m.siteId===currentSiteId).sort((a,b)=>(b.dateStart||'').localeCompare(a.dateStart||''));
  if(!sm.length)list.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><p>Aucune mission.<br>Appuyez sur + pour créer une mission.</p></div>`;
  else sm.forEach(m=>renderMissionCard(m,list));
  const site=sites.find(s=>s.id===currentSiteId);
  const panel=document.getElementById('site-info-panel');panel.innerHTML='';
  if(site){
    [['Nom',site.name],['Adresse',[site.address,site.zip,site.city].filter(Boolean).join(', ')],['Construction',site.construction],['Niveaux',site.niveaux],['Logements',site.logements],['Énergie',site.energie],['Chaufferie',site.emplacement],['Contact',site.contact]].filter(([,v])=>v).forEach(([l,v])=>{const d=document.createElement('div');d.className='info-row';d.innerHTML=`<div class="info-label">${l}</div><div class="info-value">${esc(String(v))}</div>`;panel.appendChild(d);});
    const btn=document.createElement('button');btn.className='btn-secondary';btn.textContent='✏️ Modifier ce site';btn.addEventListener('click',()=>openSiteModal(currentSiteId));panel.appendChild(btn);
  }
}

// ── MISSION VIEW ──────────────────────────────────────────────────
function renderMissionView(){switchMTab('equipments');renderMissionEqs();renderCatFilter();}
function renderMissionEqs(){
  const search=document.getElementById('eq-search').value.toLowerCase();
  const catF=document.getElementById('eq-filter-cat').value;
  const list=document.getElementById('mission-eq-list');
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId);
  let f=mEqs.filter(e=>(!search||(e.name||'').toLowerCase().includes(search)||(e.brand||'').toLowerCase().includes(search)||(e.serial||'').toLowerCase().includes(search))&&(!catF||e.category===catF));
  f.sort((a,b)=>(a.category||'').localeCompare(b.category||'')||(a.name||'').localeCompare(b.name||''));
  list.innerHTML='';
  if(!f.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">🔧</div><p>${mEqs.length===0?'Aucun équipement.<br>Utilisez + ou l\'onglet Scan.':'Aucun résultat.'}</p></div>`;return;}
  f.forEach(eq=>{
    const cat=categories.find(c=>c.id===eq.category)||{name:eq.category,color:'#6b7280'};
    const card=document.createElement('div');card.className='eq-card';card.style.setProperty('--cat-color',cat.color);
    card.innerHTML=`<div class="card-header"><span class="badge" style="color:${cat.color};border-color:${cat.color}40">${esc(cat.name.toUpperCase())}</span><div class="card-actions"><button class="card-btn" data-id="${eq.id}" data-action="edit">✏️</button><button class="card-btn" data-id="${eq.id}" data-action="delete">🗑️</button></div></div><div class="card-title">${esc(eq.name||'—')}</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:4px">${eq.brand?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary)">${esc(eq.brand)}</span>`:''} ${eq.model?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary)">${esc(eq.model)}</span>`:''} ${eq.serial?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">SN:${esc(eq.serial)}</span>`:''} ${eq.power?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--accent2)">${esc(eq.power)}</span>`:''}</div>${eq.condition?`<div style="font-family:var(--font-mono);font-size:10px;margin-top:3px" class="cond-${eq.condition}">${CL[eq.condition]}</div>`:''}`;
    card.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn){openEqModal(eq.id);return;}if(btn.dataset.action==='edit')openEqModal(eq.id);else deleteEquipment(eq.id);});
    list.appendChild(card);
  });
}
function renderCatFilter(){
  const sel=document.getElementById('eq-filter-cat');const cur=sel.value;
  sel.innerHTML='<option value="">Toutes</option>';
  categories.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;if(c.id===cur)o.selected=true;sel.appendChild(o);});
}

// ── NOTES ─────────────────────────────────────────────────────────
async function loadNotes(){
  const rec=await dbGet('notes',currentMissionId);
  document.getElementById('notes-textarea').value=rec?.text||'';
  document.getElementById('notes-saved').textContent='';
}
async function saveNotes(){
  const text=document.getElementById('notes-textarea').value;
  await dbPut('notes',{id:currentMissionId,text,updatedAt:now()});
  document.getElementById('notes-saved').textContent='✓ Sauvegardé';
  setTimeout(()=>{const el=document.getElementById('notes-saved');if(el)el.textContent='';},2000);
}

// ── PHOTO REPORT ──────────────────────────────────────────────────
async function getPhotoReport(){
  const rec=await dbGet('photoreport',currentMissionId);
  return rec?.rows||[];
}
async function savePhotoReport(rows){
  await dbPut('photoreport',{id:currentMissionId,rows,updatedAt:now()});
}

async function renderPhotoRows(){
  const rows=await getPhotoReport();
  const container=document.getElementById('photo-rows-container');
  const empty=document.getElementById('photo-empty');
  container.innerHTML='';
  if(!rows.length){empty.style.display='flex';return;}
  empty.style.display='none';
  rows.forEach((row,idx)=>renderPhotoRow(row,idx,container,rows.length));
}

function renderPhotoRow(row,idx,container,total){
  const div=document.createElement('div');div.className='photo-row';
  div.innerHTML=`
    <div class="photo-row-left">
      <div class="photo-row-num">Photo ${idx+1}</div>
      <div id="photo-thumb-${idx}" style="width:100%"></div>
      <div style="display:flex;gap:6px;width:100%">
        <button class="photo-add-btn" style="flex:1" data-idx="${idx}" data-src="camera">📷 Caméra</button>
        <button class="photo-add-btn" style="flex:1" data-idx="${idx}" data-src="gallery">🖼️ Galerie</button>
      </div>
    </div>
    <div class="photo-row-right">
      <textarea class="photo-comment-textarea" data-idx="${idx}" placeholder="Commentaire sur cette photo...">${esc(row.comment||'')}</textarea>
      <div class="photo-row-actions">
        <button class="photo-del-row" data-idx="${idx}">🗑️ Supprimer cette ligne</button>
      </div>
    </div>`;
  container.appendChild(div);

  // Render existing thumb
  const thumbContainer=document.getElementById('photo-thumb-'+idx);
  if(row.photo){
    thumbContainer.innerHTML=`<div class="photo-thumb-container"><img class="photo-thumb" src="${row.photo}" /><button class="photo-remove-btn" data-idx="${idx}">✕</button></div>`;
    thumbContainer.querySelector('.photo-remove-btn').addEventListener('click',async()=>{
      const rows=await getPhotoReport();rows[idx].photo=null;await savePhotoReport(rows);renderPhotoRows();
    });
    thumbContainer.querySelector('.photo-thumb').addEventListener('click',()=>{
      const win=window.open();win.document.write(`<img src="${row.photo}" style="max-width:100%;margin:auto;display:block">`);
    });
  }

  // Camera / gallery buttons
  div.querySelectorAll('[data-src]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const input=document.createElement('input');input.type='file';input.accept='image/*';
      if(btn.dataset.src==='camera')input.capture='environment';
      input.addEventListener('change',async e=>{
        const f=e.target.files[0];if(!f)return;
        const reader=new FileReader();
        reader.onload=async ev=>{
          const rows=await getPhotoReport();
          rows[idx].photo=ev.target.result;
          await savePhotoReport(rows);renderPhotoRows();
        };reader.readAsDataURL(f);
      });input.click();
    });
  });

  // Comment save on change
  div.querySelector('.photo-comment-textarea').addEventListener('change',async e=>{
    const rows=await getPhotoReport();rows[idx].comment=e.target.value;await savePhotoReport(rows);
  });

  // Delete row
  div.querySelector('.photo-del-row').addEventListener('click',async()=>{
    if(!confirm('Supprimer cette ligne ?'))return;
    const rows=await getPhotoReport();rows.splice(idx,1);await savePhotoReport(rows);renderPhotoRows();
  });
}

async function addPhotoRow(){
  const rows=await getPhotoReport();rows.push({photo:null,comment:''});
  await savePhotoReport(rows);renderPhotoRows();
}

// ── FORMS ENGINE ──────────────────────────────────────────────────
function getMissionFormData(){return formDataStore.find(f=>f.id===currentMissionId)||{id:currentMissionId,activeModules:[],data:{},repeatData:{}};}
async function saveMissionFormData(fd){await dbPut('formdata',fd);const idx=formDataStore.findIndex(f=>f.id===currentMissionId);if(idx>=0)formDataStore[idx]=fd;else formDataStore.push(fd);}
function renderFormsZone(){
  const fd=getMissionFormData();const container=document.getElementById('active-forms-container');container.innerHTML='';
  const sel=document.getElementById('modules-selector');
  sel.innerHTML='<h3>Modules à relever pour cette mission</h3><div class="module-toggles" id="module-toggles"></div>';
  const grid=document.getElementById('module-toggles');
  FORM_MODULES.forEach(mod=>{
    const isActive=fd.activeModules.includes(mod.id);
    const btn=document.createElement('div');btn.className='module-toggle'+(isActive?' active':'');
    btn.innerHTML=`<span class="module-toggle-icon">${mod.icon}</span><span class="module-toggle-label" style="color:${mod.color}">${mod.label}</span><div class="mt-check"></div>`;
    btn.addEventListener('click',async()=>{
      const fdd=getMissionFormData();
      if(fdd.activeModules.includes(mod.id))fdd.activeModules=fdd.activeModules.filter(x=>x!==mod.id);
      else fdd.activeModules.push(mod.id);
      await saveMissionFormData(fdd);renderFormsZone();
    });
    grid.appendChild(btn);
  });
  fd.activeModules.forEach(modId=>{
    const mod=FORM_MODULES.find(m=>m.id===modId);if(!mod)return;
    if(mod.repeatable)renderRepeatableBlock(mod,fd,container);else renderFormBlock(mod,fd,container);
  });
}
function renderFormBlock(mod,fd,container){
  const block=document.createElement('div');block.className='form-block';
  block.innerHTML=`<div class="form-block-header"><div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div></div><div class="form-block-body" id="fb-${mod.id}"></div>`;
  container.appendChild(block);
  const body=document.getElementById('fb-'+mod.id);const data=fd.data[mod.id]||{};
  if(mod.sections){mod.sections.forEach(sec=>{const st=document.createElement('div');st.className='form-section-title';st.textContent=sec.title;body.appendChild(st);sec.fields.forEach(f=>renderField(f,data,body,mod,fd));});if(mod.notes_field)renderField(mod.notes_field,data,body,mod,fd);}
  else mod.fields.forEach(f=>renderField(f,data,body,mod,fd));
}
function renderField(field,data,body,mod,fd,iIdx=null){
  if(field.type==='section'){const d=document.createElement('div');d.className='field-section-divider';d.textContent=field.label.replace(/^—\s*/,'').replace(/\s*—$/,'');body.appendChild(d);return;}
  const key=iIdx!==null?`${field.id}_${iIdx}`:field.id;
  const wrap=document.createElement('div');wrap.className='form-group';
  if(field.type==='yesno'){
    wrap.innerHTML=`<label>${esc(field.label)}</label>`;
    const grp=document.createElement('div');grp.className='yesno-group';
    const val=iIdx!==null?(fd.repeatData[mod.id]?.[iIdx]?.[field.id]||''):(data[field.id]||'');
    ['Oui','Non','N/A'].forEach((lbl,i)=>{
      const code=['oui','non','na'][i];
      const btn=document.createElement('button');btn.className='yesno-btn '+['yes','no','na'][i]+(val===code?' active':'');btn.textContent=lbl;
      btn.addEventListener('click',async()=>{
        const fdd=getMissionFormData();
        if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=code;}
        else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=code;}
        await saveMissionFormData(fdd);
        grp.querySelectorAll('.yesno-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      });
      grp.appendChild(btn);
    });wrap.appendChild(grp);
  }else if(field.type==='computed'){
    wrap.innerHTML=`<label>${esc(field.label)}</label><div class="computed-value" id="cv-${key}">—</div>`;
    setTimeout(()=>updateComputed(field,fd,mod,iIdx,key),100);
  }else{
    const val=iIdx!==null?(fd.repeatData[mod.id]?.[iIdx]?.[field.id]||''):(data[field.id]||'');
    if(field.type==='select')wrap.innerHTML=`<label>${esc(field.label)}</label><select id="ff-${key}">${(field.options||[]).map(o=>`<option value="${esc(o)}"${val===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
    else if(field.type==='textarea')wrap.innerHTML=`<label>${esc(field.label)}</label><textarea id="ff-${key}" placeholder="${esc(field.placeholder||'')}" rows="3">${esc(val)}</textarea>`;
    else wrap.innerHTML=`<label>${esc(field.label)}</label><input type="${field.type==='number'?'number':field.type==='date'?'date':field.type==='time'?'time':'text'}" id="ff-${key}" placeholder="${esc(field.placeholder||field.label)}" value="${esc(val)}" ${field.step?'step='+field.step:''}/>`;
    const el=wrap.querySelector(`#ff-${key}`);
    if(el)el.addEventListener('change',async()=>{
      const fdd=getMissionFormData();
      if(iIdx!==null){if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];if(!fdd.repeatData[mod.id][iIdx])fdd.repeatData[mod.id][iIdx]={};fdd.repeatData[mod.id][iIdx][field.id]=el.value;}
      else{if(!fdd.data[mod.id])fdd.data[mod.id]={};fdd.data[mod.id][field.id]=el.value;}
      await saveMissionFormData(fdd);updateAllComputed(mod,fd,iIdx);
    });
  }
  body.appendChild(wrap);
}
function updateComputed(field,fd,mod,iIdx,key){
  const el=document.getElementById('cv-'+key);if(!el)return;
  try{
    const vars={};const allF=(mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)]);
    allF.forEach(f=>{const k=iIdx!==null?`ff-${f.id}_${iIdx}`:`ff-${f.id}`;const inp=document.getElementById(k);if(inp){const v=parseFloat(inp.value);if(!isNaN(v))vars[f.id]=v;}});
    const result=new Function(...Object.keys(vars),'return '+field.formula)(...Object.values(vars));
    el.textContent=isNaN(result)?'—':(Math.round(result*100)/100)+' '+(field.unit||'');
  }catch{el.textContent='—';}
}
function updateAllComputed(mod,fd,iIdx){
  const af=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)];
  af.filter(f=>f.type==='computed').forEach(f=>{const key=iIdx!==null?`${f.id}_${iIdx}`:f.id;updateComputed(f,fd,mod,iIdx,key);});
}
function renderRepeatableBlock(mod,fd,container){
  const instances=fd.repeatData[mod.id]||[{}];
  const block=document.createElement('div');block.className='form-block';
  const header=document.createElement('div');header.className='form-block-header';
  header.innerHTML=`<div class="form-block-title" style="color:${mod.color}">${mod.icon} ${mod.label}</div>`;
  block.appendChild(header);const body=document.createElement('div');body.className='form-block-body';block.appendChild(body);container.appendChild(block);
  instances.forEach((_,idx)=>{
    const inst=document.createElement('div');inst.className='repeat-instance';
    const instTitle=document.createElement('div');instTitle.className='repeat-instance-title';
    instTitle.innerHTML=`<span style="color:${mod.color}">${mod.repeatLabel} ${idx+1}</span>`;
    if(instances.length>1){const del=document.createElement('button');del.className='btn-remove-instance';del.textContent='✕';del.addEventListener('click',async()=>{const fdd=getMissionFormData();if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];fdd.repeatData[mod.id].splice(idx,1);await saveMissionFormData(fdd);renderFormsZone();});instTitle.appendChild(del);}
    inst.appendChild(instTitle);mod.fields.forEach(f=>renderField(f,fd.data,inst,mod,fd,idx));body.appendChild(inst);
  });
  const addBtn=document.createElement('button');addBtn.className='btn-add-instance';addBtn.textContent=`+ Ajouter ${mod.repeatLabel}`;
  addBtn.addEventListener('click',async()=>{const fdd=getMissionFormData();if(!fdd.repeatData[mod.id])fdd.repeatData[mod.id]=[];fdd.repeatData[mod.id].push({});await saveMissionFormData(fdd);renderFormsZone();});
  body.appendChild(addBtn);
}

// ── MODALS ────────────────────────────────────────────────────────
function openSiteModal(id=null){
  editingSiteId=id;const s=id?sites.find(x=>x.id===id):null;
  document.getElementById('modal-site-title').textContent=id?'Modifier le site':'Nouveau site';
  ['name','address','city','zip','contact','notes','emplacement'].forEach(k=>{const el=document.getElementById('site-'+k);if(el)el.value=s?.[k]||'';});
  document.getElementById('site-construction').value=s?.construction||'classique';
  document.getElementById('site-energie').value=s?.energie||'Gaz naturel';
  ['batiments','niveaux','logements','hauteur'].forEach(k=>{const el=document.getElementById('site-'+k);if(el)el.value=s?.[k]||'';});
  document.getElementById('modal-site').classList.remove('hidden');setTimeout(()=>document.getElementById('site-name').focus(),300);
}
async function saveSite(){
  const name=document.getElementById('site-name').value.trim();if(!name){showToast('Nom obligatoire','error');return;}
  const s={id:editingSiteId||uid(),name,address:v('site-address'),city:v('site-city'),zip:v('site-zip'),construction:v('site-construction'),energie:v('site-energie'),batiments:vn('site-batiments'),niveaux:vn('site-niveaux'),logements:vn('site-logements'),hauteur:vn('site-hauteur'),emplacement:v('site-emplacement'),contact:v('site-contact'),notes:v('site-notes'),updatedAt:now(),createdAt:editingSiteId?(sites.find(x=>x.id===editingSiteId)?.createdAt||now()):now()};
  await dbPut('sites',s);if(editingSiteId){const i=sites.findIndex(x=>x.id===editingSiteId);if(i>=0)sites[i]=s;else sites.push(s);}else sites.push(s);
  document.getElementById('modal-site').classList.add('hidden');renderSites(document.getElementById('site-search').value);if(currentSiteId===editingSiteId)renderSiteView();showToast(editingSiteId?'Site mis à jour ✓':'Site créé ✓','success');
}
async function deleteSite(id){
  const c=missions.filter(m=>m.siteId===id).length;if(!confirm(`Supprimer ce site et ses ${c} mission(s) ?`))return;
  const sm=missions.filter(m=>m.siteId===id);
  for(const m of sm){const me=equipments.filter(e=>e.missionId===m.id);for(const e of me)await dbDel('equipments',e.id);equipments=equipments.filter(e=>e.missionId!==m.id);await dbDel('missions',m.id);}
  missions=missions.filter(m=>m.siteId!==id);await dbDel('sites',id);sites=sites.filter(s=>s.id!==id);renderSites();showToast('Site supprimé');
}
function openMissionModal(id=null){
  editingMissionId=id;const m=id?missions.find(x=>x.id===id):null;
  document.getElementById('modal-mission-title').textContent=id?'Modifier la mission':'Nouvelle mission';
  document.getElementById('mission-name').value=m?.name||'';document.getElementById('mission-type').value=m?.type||'audit';
  document.getElementById('mission-date-start').value=m?.dateStart||today();document.getElementById('mission-date-end').value=m?.dateEnd||'';
  document.getElementById('mission-operator').value=m?.operator||'';document.getElementById('mission-status').value=m?.status||'en_cours';
  document.getElementById('mission-ref').value=m?.ref||'';document.getElementById('mission-notes').value=m?.notes||'';
  document.getElementById('modal-mission').classList.remove('hidden');setTimeout(()=>document.getElementById('mission-name').focus(),300);
}
async function saveMission(){
  const name=document.getElementById('mission-name').value.trim();if(!name){showToast('Intitulé obligatoire','error');return;}
  const m={id:editingMissionId||uid(),siteId:currentSiteId,name,type:v('mission-type'),dateStart:v('mission-date-start'),dateEnd:v('mission-date-end'),operator:v('mission-operator'),status:v('mission-status'),ref:v('mission-ref'),notes:v('mission-notes'),updatedAt:now(),createdAt:editingMissionId?(missions.find(x=>x.id===editingMissionId)?.createdAt||now()):now()};
  await dbPut('missions',m);if(editingMissionId){const i=missions.findIndex(x=>x.id===editingMissionId);if(i>=0)missions[i]=m;else missions.push(m);}else missions.push(m);
  document.getElementById('modal-mission').classList.add('hidden');renderSiteView();showToast(editingMissionId?'Mission mise à jour ✓':'Mission créée ✓','success');
}
async function deleteMission(id){
  const c=equipments.filter(e=>e.missionId===id).length;if(!confirm(`Supprimer cette mission et ses ${c} équipement(s) ?`))return;
  const me=equipments.filter(e=>e.missionId===id);for(const e of me)await dbDel('equipments',e.id);equipments=equipments.filter(e=>e.missionId!==id);
  await dbDel('missions',id);missions=missions.filter(m=>m.id!==id);
  if(document.getElementById('view-site').classList.contains('active'))renderSiteView();else renderAllMissions();showToast('Mission supprimée');
}
function openEqModal(id=null){
  editingEqId=id;attachedPhoto=null;const eq=id?equipments.find(e=>e.id===id):null;
  document.getElementById('modal-eq-title').textContent=id?'Modifier équipement':'Nouvel équipement';
  const sel=document.getElementById('field-category');sel.innerHTML='';categories.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;sel.appendChild(o);});
  document.getElementById('field-category').value=eq?.category||categories[0]?.id||'';
  ['name','brand','model','serial','power','fluid','location','notes'].forEach(k=>{const el=document.getElementById('field-'+k);if(el)el.value=eq?.[k]||'';});
  document.getElementById('field-ocr-raw').value=eq?.ocrRaw||'';
  document.getElementById('field-year').value=eq?.year||'';document.getElementById('field-condition').value=eq?.condition||'';
  const pp=document.getElementById('field-photo-preview');
  if(eq?.photo){pp.src=eq.photo;pp.classList.remove('hidden');attachedPhoto=eq.photo;}else{pp.src='';pp.classList.add('hidden');}
  if(!id&&capturedImage){pp.src=capturedImage;pp.classList.remove('hidden');attachedPhoto=capturedImage;}
  document.getElementById('modal-equipment').classList.remove('hidden');setTimeout(()=>document.getElementById('field-name').focus(),300);
}
async function saveEquipment(){
  const name=document.getElementById('field-name').value.trim();if(!name){showToast('Nom obligatoire','error');return;}
  const eq={id:editingEqId||uid(),missionId:currentMissionId,category:v('field-category'),name,brand:v('field-brand'),model:v('field-model'),serial:v('field-serial'),year:vn('field-year'),power:v('field-power'),fluid:v('field-fluid'),location:v('field-location'),condition:v('field-condition'),notes:v('field-notes'),ocrRaw:v('field-ocr-raw'),photo:attachedPhoto||null,updatedAt:now(),createdAt:editingEqId?(equipments.find(e=>e.id===editingEqId)?.createdAt||now()):now()};
  await dbPut('equipments',eq);if(editingEqId){const i=equipments.findIndex(e=>e.id===editingEqId);if(i>=0)equipments[i]=eq;else equipments.push(eq);}else equipments.push(eq);
  capturedImage=null;document.getElementById('modal-equipment').classList.add('hidden');renderMissionEqs();showToast(editingEqId?'Équipement mis à jour ✓':'Équipement ajouté ✓','success');
}
async function deleteEquipment(id){if(!confirm('Supprimer cet équipement ?'))return;await dbDel('equipments',id);equipments=equipments.filter(e=>e.id!==id);renderMissionEqs();showToast('Équipement supprimé');}

// ── OCR ───────────────────────────────────────────────────────────
async function startCamera(){try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}}});cameraStream=stream;const video=document.getElementById('camera-preview');video.srcObject=stream;document.getElementById('camera-placeholder').style.display='none';document.getElementById('btn-start-camera').classList.add('hidden');document.getElementById('btn-capture').classList.remove('hidden');}catch{showToast('Accès caméra refusé','error');}}
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}const vid=document.getElementById('camera-preview');if(vid)vid.srcObject=null;document.getElementById('camera-placeholder').style.display='';document.getElementById('btn-start-camera')?.classList.remove('hidden');document.getElementById('btn-capture')?.classList.add('hidden');}
async function captureFromCamera(){const video=document.getElementById('camera-preview'),canvas=document.getElementById('camera-canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);stopCamera();await analyzeImage(canvas.toDataURL('image/jpeg',.9));}
async function processImageFile(file){const reader=new FileReader();reader.onload=async e=>await analyzeImage(e.target.result);reader.readAsDataURL(file);}
async function analyzeImage(dataURL){
  document.getElementById('image-preview').src=dataURL;document.getElementById('image-preview-container').classList.remove('hidden');capturedImage=dataURL;
  const se=document.getElementById('ocr-status'),st=document.getElementById('ocr-status-text');se.classList.remove('hidden');
  let result=null;
  if(navigator.onLine&&geminiKey){try{st.textContent='🌐 Gemini Vision...';result=await analyzeWithGemini(dataURL);}catch(e){console.warn(e);}}
  if(!result){st.textContent='🔍 OCR hors-ligne...';try{result=await analyzeWithTesseract(dataURL,st);}catch(e){console.error(e);}}
  se.classList.add('hidden');switchMTab('equipments');openEqModal();if(result)prefillModal(result);
}
async function analyzeWithTesseract(dataURL,statusEl){const{data}=await Tesseract.recognize(dataURL,'fra+eng',{logger:m=>{if(m.status==='recognizing text')statusEl.textContent=`🔍 OCR: ${Math.round(m.progress*100)}%`;}});return parseOCRText(data.text);}
function parseOCRText(text){const r={ocrRaw:text};const brands=['Viessmann','De Dietrich','Buderus','Saunier Duval','Frisquet','Bosch','Remeha','Atlantic','Ariston','Chaffoteaux','Daikin','Grundfos','Wilo','DAB','Siemens','Honeywell','Danfoss','Weishaupt','Riello','Elco','Baltur'];for(const b of brands)if(text.toUpperCase().includes(b.toUpperCase())){r.brand=b;break;}const snM=text.match(/(?:S[\.\/]?N|N[°o]?\s*[Ss]érie|SERIAL)[:\s#]*([A-Z0-9\-\/]{6,20})/i);if(snM)r.serial=snM[1].trim();const pwM=text.match(/(\d[\d\s,\.]*)\s*k[Ww]/);if(pwM)r.power=pwM[1].trim()+' kW';const yrM=text.match(/\b(19[89]\d|20[0-3]\d)\b/);if(yrM)r.year=parseInt(yrM[1]);const mdM=text.match(/(?:TYPE|MODELE|MODEL)[:\s]*([A-Z0-9\s\-\.]{3,25})/i);if(mdM)r.model=mdM[1].trim();if(/gaz\s*naturel/i.test(text))r.fluid='Gaz naturel';else if(/propane/i.test(text))r.fluid='Propane';else if(/fioul|fuel/i.test(text))r.fluid='Fioul';return r;}
async function analyzeWithGemini(dataURL){const base64=dataURL.split(',')[1],mime=dataURL.split(';')[0].split(':')[1];const prompt=`Analyse cette plaque signalétique de chaufferie. JSON uniquement sans backtick: {"name":"","brand":"","model":"","serial":"","year":null,"power":"","fluid":"","category":"chaudiere|bruleur|pompe|vanne|echangeur|ballon|electrique|autre","condition":"bon|correct|degrade|hs","ocrRaw":""}`;const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{inline_data:{mime_type:mime,data:base64}},{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:512}})});if(!resp.ok)throw new Error('Gemini '+resp.status);const data=await resp.json();return JSON.parse(data.candidates[0].content.parts[0].text.replace(/```json|```/g,'').trim());}
function prefillModal(data){if(data.name)document.getElementById('field-name').value=data.name;if(data.brand)document.getElementById('field-brand').value=data.brand;if(data.model)document.getElementById('field-model').value=data.model;if(data.serial)document.getElementById('field-serial').value=data.serial;if(data.year)document.getElementById('field-year').value=data.year;if(data.power)document.getElementById('field-power').value=data.power;if(data.fluid)document.getElementById('field-fluid').value=data.fluid;if(data.ocrRaw)document.getElementById('field-ocr-raw').value=data.ocrRaw;if(data.condition)document.getElementById('field-condition').value=data.condition;if(data.category){const sel=document.getElementById('field-category');if([...sel.options].some(o=>o.value===data.category))sel.value=data.category;}showToast('Plaque analysée — vérifiez ✓','success');}

// ══════════════════════════════════════════════════════════════════
//  EXPORT EXCEL  (génération XLSX native sans librairie externe)
// ══════════════════════════════════════════════════════════════════

async function exportExcel(){
  const mission=missions.find(m=>m.id===currentMissionId);
  const site=sites.find(s=>s.id===mission?.siteId);
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId);
  const fd=getMissionFormData();
  const notesRec=await dbGet('notes',currentMissionId);
  const photoRec=await dbGet('photoreport',currentMissionId);

  showToast('Génération Excel en cours...','');

  const wb=new XLSXWorkbook();

  // ── Feuille RÉCAP ──
  const recapWs=wb.addSheet('Récapitulatif');
  recapWs.setColWidths([30,40]);
  recapWs.addRow(['ADIATOOL — Rapport de mission'],{bold:true,size:14,bg:'1e3f5e',fg:'FFFFFF'});
  recapWs.addRow([]);
  recapWs.addRow(['SITE',''],{bold:true,bg:'2d5a8e',fg:'FFFFFF'});
  recapWs.addRow(['Nom',site?.name||'']);recapWs.addRow(['Adresse',[site?.address,site?.zip,site?.city].filter(Boolean).join(', ')]);
  recapWs.addRow(['Énergie',site?.energie||'']);recapWs.addRow(['Contact',site?.contact||'']);
  recapWs.addRow([]);
  recapWs.addRow(['MISSION',''],{bold:true,bg:'2d5a8e',fg:'FFFFFF'});
  recapWs.addRow(['Intitulé',mission?.name||'']);recapWs.addRow(['Type',TL[mission?.type]||mission?.type||'']);
  recapWs.addRow(['Statut',SL[mission?.status]||'']);recapWs.addRow(['Période',[mission?.dateStart,mission?.dateEnd].filter(Boolean).join(' → ')]);
  recapWs.addRow(['Intervenant',mission?.operator||'']);recapWs.addRow(['Référence',mission?.ref||'']);
  recapWs.addRow([]);
  recapWs.addRow(['Équipements inventoriés',mEqs.length]);
  recapWs.addRow(['Modules de relevés activés',fd.activeModules.map(id=>FORM_MODULES.find(m=>m.id===id)?.label||id).join(', ')]);
  recapWs.addRow(['Date d\'export',new Date().toLocaleDateString('fr-FR')+' '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})]);

  // ── Feuille ÉQUIPEMENTS ──
  const eqWs=wb.addSheet('Équipements');
  eqWs.setColWidths([20,25,18,18,20,8,12,14,20,10,30]);
  eqWs.addRow(['Catégorie','Désignation','Marque','Modèle','N° Série','Année','Puissance','Fluide','Localisation','État','Observations'],{bold:true,bg:'1e3f5e',fg:'FFFFFF'});
  mEqs.forEach(eq=>{
    const cat=categories.find(c=>c.id===eq.category)?.name||eq.category;
    eqWs.addRow([cat,eq.name||'',eq.brand||'',eq.model||'',eq.serial||'',eq.year||'',eq.power||'',eq.fluid||'',eq.location||'',CL[eq.condition]||'',eq.notes||'']);
  });

  // ── Feuilles par module ──
  fd.activeModules.forEach(modId=>{
    const mod=FORM_MODULES.find(m=>m.id===modId);if(!mod)return;
    const ws=wb.addSheet(mod.label.substring(0,28));
    ws.setColWidths([35,30]);
    ws.addRow([mod.icon+' '+mod.label],{bold:true,size:12,bg:'1e3f5e',fg:'FFFFFF'});
    ws.addRow([]);
    const yesnoDisplay=v=>({oui:'✅ Oui',non:'❌ Non',na:'N/A'}[v]||v||'');

    if(mod.repeatable){
      const instances=fd.repeatData[mod.id]||[{}];
      instances.forEach((inst,idx)=>{
        ws.addRow([`${mod.repeatLabel} ${idx+1}`],{bold:true,bg:'2d5a8e',fg:'FFFFFF'});
        mod.fields.filter(f=>f.type!=='section').forEach(field=>{
          const val=inst[field.id]||'';
          if(!val&&field.type!=='yesno')return;
          ws.addRow([field.label, field.type==='yesno'?yesnoDisplay(val):val]);
        });
        ws.addRow([]);
      });
    }else{
      const data=fd.data[modId]||{};
      const renderFields=(fields)=>fields.forEach(field=>{
        if(field.type==='section'){ws.addRow([field.label.replace(/^—\s*/,'').replace(/\s*—$/,''),''],{bold:true,bg:'e8f0f8',fg:'1e3f5e'});return;}
        if(field.type==='computed'){
          // compute value
          let result='';try{const vars={};const af=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields)];af.forEach(f=>{const n=parseFloat(data[f.id]);if(!isNaN(n))vars[f.id]=n;});result=new Function(...Object.keys(vars),'return '+field.formula)(...Object.values(vars));result=isNaN(result)?'':(Math.round(result*100)/100)+' '+(field.unit||'');}catch{}
          ws.addRow([field.label,result]);return;
        }
        const val=data[field.id]||'';if(!val&&field.type!=='yesno')return;
        ws.addRow([field.label, field.type==='yesno'?yesnoDisplay(val):val]);
      });
      if(mod.sections){mod.sections.forEach(sec=>{ws.addRow([sec.title],{bold:true,bg:'dbeafe',fg:'1e3f5e'});renderFields(sec.fields);ws.addRow([]);});if(mod.notes_field){const val=data[mod.notes_field.id]||'';if(val)ws.addRow([mod.notes_field.label,val]);}}
      else renderFields(mod.fields);
    }
  });

  // ── Feuille NOTES ──
  const notesText=notesRec?.text||'';
  if(notesText){
    const notesWs=wb.addSheet('Notes de visite');
    notesWs.setColWidths([100]);
    notesWs.addRow(['✏️ Notes de visite'],{bold:true,bg:'1e3f5e',fg:'FFFFFF'});
    notesWs.addRow([]);
    notesText.split('\n').forEach(line=>notesWs.addRow([line]));
  }

  // ── Feuille PHOTOS (données texte + référence) ──
  const photoRows=photoRec?.rows||[];
  if(photoRows.length){
    const photoWs=wb.addSheet('Reportage photo');
    photoWs.setColWidths([20,60]);
    photoWs.addRow(['🖼️ PHOTOS','COMMENTAIRES'],{bold:true,bg:'1e3f5e',fg:'FFFFFF'});
    photoRows.forEach((row,idx)=>{
      photoWs.addRow([`Photo ${idx+1}`,row.comment||'']);
      // Note: images Excel requires binary encoding beyond scope of pure JS
      // We add the photo as a hyperlink note in a following row if present
      if(row.photo){
        photoWs.addRow(['  → Image intégrée dans le PDF','(Export PDF pour visualiser les photos)'],{fg:'666666'});
      }
    });
    photoWs.addRow([]);
    photoWs.addRow(['Note : Pour un reportage complet avec photos intégrées, utilisez l\'export PDF.',''],[]);
  }

  // Generate and download
  const xlsxBlob=wb.generate();
  download(xlsxBlob,`adiatool_${slugify(mission?.name||'mission')}_${today()}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  showToast('Excel généré ✓','success');
}

// ══════════════════════════════════════════════════════════════════
//  XLSX BUILDER — génération native sans dépendance externe
//  Format SpreadsheetML (Office Open XML)
// ══════════════════════════════════════════════════════════════════
class XLSXWorkbook {
  constructor(){this.sheets=[];}
  addSheet(name){const ws=new XLSXSheet(name);this.sheets.push(ws);return ws;}
  generate(){
    const sharedStrings=[];const ssMap=new Map();
    const getSS=s=>{const k=String(s||'');if(ssMap.has(k))return ssMap.get(k);const i=sharedStrings.length;sharedStrings.push(k);ssMap.set(k,i);return i;};

    // Build sheet XML
    const sheetsXml=this.sheets.map((ws,si)=>ws.buildXml(getSS));

    // Shared strings XML
    const ssXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map(s=>`<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;

    // Styles XML
    const stylesXml=buildStylesXml();

    // Workbook XML
    const wbXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${this.sheets.map((ws,i)=>`<sheet name="${xmlEsc(ws.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;

    // Relationships
    const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${this.sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${this.sheets.length+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

    const pkgRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${this.sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

    // Build ZIP
    const zip=new JSZip();
    zip.file('[Content_Types].xml',contentTypes);
    zip.file('_rels/.rels',pkgRels);
    zip.file('xl/workbook.xml',wbXml);
    zip.file('xl/_rels/workbook.xml.rels',wbRels);
    zip.file('xl/sharedStrings.xml',ssXml);
    zip.file('xl/styles.xml',stylesXml);
    this.sheets.forEach((ws,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,sheetsXml[i]));
    return zip.generate({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
}

class XLSXSheet {
  constructor(name){this.name=name.replace(/[\\\/\?\*\[\]]/g,'').substring(0,31);this.rows=[];this.colWidths=[];}
  setColWidths(widths){this.colWidths=widths;}
  addRow(cells,style=null){this.rows.push({cells,style});}
  buildXml(getSS){
    const cols=this.colWidths.length?`<cols>${this.colWidths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`:'';
    const rows=this.rows.map((row,ri)=>{
      const rn=ri+1;
      const cellsXml=row.cells.map((cell,ci)=>{
        const col=colName(ci+1);const addr=`${col}${rn}`;
        const val=cell===null||cell===undefined?'':cell;
        const si=getStyleIdx(row.style);
        if(val===''&&!row.style)return`<c r="${addr}"/>`;
        const sVal=String(val);const isNum=typeof val==='number'||(/^-?\d+\.?\d*$/.test(sVal)&&sVal!=='');
        if(isNum)return`<c r="${addr}" t="n" s="${si}"><v>${sVal}</v></c>`;
        const ssIdx=getSS(sVal);return`<c r="${addr}" t="s" s="${si}"><v>${ssIdx}</v></c>`;
      }).join('');
      return`<row r="${rn}">${cellsXml}</row>`;
    }).join('');
    return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetView workbookViewId="0"/>${cols}<sheetData>${rows}</sheetData></worksheet>`;
  }
}

// Style registry: map style key -> index
const STYLE_MAP=new Map();const STYLES=[];
function getStyleIdx(style){
  if(!style)return 0;
  const key=JSON.stringify(style);if(STYLE_MAP.has(key))return STYLE_MAP.get(key);
  const idx=STYLES.length+1;STYLES.push(style);STYLE_MAP.set(key,idx);return idx;
}
function buildStylesXml(){
  // Fixed palette of fills and fonts
  const fills=['none','gray125',...STYLES.map(s=>s.bg||null)].filter((v,i,a)=>a.indexOf(v)===i);
  const fonts=[{size:11},...STYLES.map(s=>({bold:s.bold,size:s.size||11,color:s.fg||'000000'}))];
  const fillsXml=fills.map(f=>f&&f!=='none'&&f!=='gray125'?`<fill><patternFill patternType="solid"><fgColor rgb="${f}"/></patternFill></fill>`:`<fill><patternFill patternType="${f||'none'}"/></fill>`).join('');
  const fontsXml=fonts.map(f=>`<font><sz val="${f.size||11}"/>${f.bold?'<b/>':''}<color rgb="${f.color||'000000'}"/><name val="Calibri"/></font>`).join('');
  const xfsBase=`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>`;
  const xfsCustom=STYLES.map(s=>{
    const fi=fills.indexOf(s.bg||null);const fni=fonts.findIndex(f=>f.bold===s.bold&&f.size===(s.size||11)&&f.color===(s.fg||'000000'));
    return`<xf numFmtId="0" fontId="${Math.max(0,fni)}" fillId="${Math.max(0,fi)}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>`;
  }).join('');
  return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fontsXml}</fonts><fills count="${fills.length}">${fillsXml}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${STYLES.length+1}">${xfsBase}${xfsCustom}</cellXfs></styleSheet>`;
}

function colName(n){let s='';while(n>0){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;}
function xmlEsc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}

// JSZip minimal implementation for XLSX packaging
class JSZip{
  constructor(){this.files={};}
  file(name,content){this.files[name]=content;}
  generate({type,mimeType}={}){
    // Build a real ZIP using the ZIP spec
    const encoder=new TextEncoder();
    const fileEntries=[];
    const localHeaders=[];
    let offset=0;
    const u8=(n,bytes)=>{const a=new Uint8Array(bytes);for(let i=0;i<bytes;i++)a[i]=(n>>(8*i))&0xFF;return a;};
    const str2u8=s=>encoder.encode(s);
    const crc32=(data)=>{let crc=0xFFFFFFFF;const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?(0xEDB88320^(c>>>1)):c>>>1;t[i]=c;}for(const b of data)crc=t[(crc^b)&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;};
    const concat=(...arrays)=>{const total=arrays.reduce((s,a)=>s+a.length,0);const r=new Uint8Array(total);let p=0;arrays.forEach(a=>{r.set(a,p);p+=a.length;});return r;};
    for(const[name,content]of Object.entries(this.files)){
      const nameBytes=str2u8(name);
      const dataBytes=typeof content==='string'?str2u8(content):new Uint8Array(content);
      const crc=crc32(dataBytes);
      const lh=concat(u8(0x04034B50,4),u8(20,2),u8(0,2),u8(0,2),u8(0,2),u8(0,2),u8(crc,4),u8(dataBytes.length,4),u8(dataBytes.length,4),u8(nameBytes.length,2),u8(0,2),nameBytes);
      fileEntries.push({name,nameBytes,dataBytes,crc,offset,lhLen:lh.length});
      localHeaders.push(concat(lh,dataBytes));
      offset+=lh.length+dataBytes.length;
    }
    const cd=fileEntries.map(e=>{const cdh=concat(u8(0x02014B50,4),u8(20,2),u8(20,2),u8(0,2),u8(0,2),u8(0,2),u8(0,2),u8(e.crc,4),u8(e.dataBytes.length,4),u8(e.dataBytes.length,4),u8(e.nameBytes.length,2),u8(0,2),u8(0,2),u8(0,2),u8(0,2),u8(0,4),u8(e.offset,4),e.nameBytes);return cdh;});
    const cdBytes=concat(...cd);const cdOffset=offset;const eocd=concat(u8(0x06054B50,4),u8(0,2),u8(0,2),u8(fileEntries.length,2),u8(fileEntries.length,2),u8(cdBytes.length,4),u8(cdOffset,4),u8(0,2));
    return new Blob([...localHeaders,cdBytes,eocd],{type:mimeType||'application/zip'});
  }
}

// ── CSV ───────────────────────────────────────────────────────────
function exportCSV(){
  const mission=missions.find(m=>m.id===currentMissionId);const site=sites.find(s=>s.id===mission?.siteId);
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId);
  if(!mEqs.length){showToast('Aucun équipement à exporter','error');return;}
  const headers=['Site','Mission','Type','Statut','Réf','Catégorie','Désignation','Marque','Modèle','N° Série','Année','Puissance','Fluide','Localisation','État','Observations'];
  const rows=mEqs.map(eq=>{const cat=categories.find(c=>c.id===eq.category)?.name||eq.category;return[site?.name,mission?.name,TL[mission?.type],SL[mission?.status],mission?.ref,cat,eq.name,eq.brand,eq.model,eq.serial,eq.year,eq.power,eq.fluid,eq.location,CL[eq.condition],eq.notes].map(x=>`"${(x||'').toString().replace(/"/g,'""')}"`);}); 
  download('\uFEFF'+[headers.join(';'),...rows.map(r=>r.join(';'))].join('\r\n'),`adiatool_equipements_${today()}.csv`,'text/csv;charset=utf-8;');
  showToast('CSV équipements exporté');
}

// ── PDF ───────────────────────────────────────────────────────────
async function exportPDF(){
  const mission=missions.find(m=>m.id===currentMissionId);
  const site=sites.find(s=>s.id===mission?.siteId);
  const mEqs=equipments.filter(e=>e.missionId===currentMissionId);
  const fd=getMissionFormData();
  const notesRec=await dbGet('notes',currentMissionId);
  const photoRec=await dbGet('photoreport',currentMissionId);
  const obs=document.getElementById('report-obs').value;
  const concl=document.getElementById('report-conclusion').value;
  const inclEq=document.getElementById('rpt-equipments').checked;
  const inclForms=document.getElementById('rpt-forms').checked;
  const inclNotes=document.getElementById('rpt-notes').checked;
  const inclPhotos=document.getElementById('rpt-photos').checked;
  const conclMap={conforme:'✅ Installation conforme',reserves:'⚠️ Conforme avec réserves',non_conforme:'❌ Non conforme',a_completer:'🔄 À compléter'};
  const yn=v=>({oui:'✅ Oui',non:'❌ Non',na:'N/A'}[v]||v||'');

  let formsHtml='';
  if(inclForms&&fd.activeModules.length>0){
    fd.activeModules.forEach(modId=>{
      const mod=FORM_MODULES.find(m=>m.id===modId);if(!mod)return;
      formsHtml+=`<h3 style="font-size:11px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #1e7fd4;padding-bottom:4px;margin:16px 0 8px">${mod.icon} ${mod.label}</h3>`;
      if(mod.repeatable){
        const instances=fd.repeatData[mod.id]||[{}];
        instances.forEach((inst,idx)=>{
          formsHtml+=`<div style="margin-bottom:8px;border:1px solid #dee2e6;border-radius:4px;padding:8px"><strong style="color:#1e7fd4;font-size:10px">${mod.repeatLabel} ${idx+1}</strong><table style="width:100%;border-collapse:collapse;margin-top:5px;font-size:9px">`;
          mod.fields.filter(f=>f.type!=='section').forEach(f=>{const val=inst[f.id]||'';if(!val)return;formsHtml+=`<tr><td style="padding:2px 5px;color:#666;width:50%">${esc(f.label)}</td><td style="padding:2px 5px;font-weight:500">${f.type==='yesno'?yn(val):esc(String(val))}</td></tr>`;});
          formsHtml+=`</table></div>`;
        });
      }else{
        const data=fd.data[modId]||{};const allF=mod.fields||[...(mod.sections||[]).flatMap(s=>s.fields),...(mod.notes_field?[mod.notes_field]:[])];
        formsHtml+=`<table style="width:100%;border-collapse:collapse;font-size:9px">`;
        allF.filter(f=>f.type!=='section'&&f.type!=='computed').forEach(f=>{const val=data[f.id]||'';if(!val)return;formsHtml+=`<tr><td style="padding:2px 5px;color:#666;border-bottom:1px solid #f0f0f0;width:50%">${esc(f.label)}</td><td style="padding:2px 5px;border-bottom:1px solid #f0f0f0;font-weight:500">${f.type==='yesno'?yn(val):esc(String(val))}</td></tr>`;});
        formsHtml+=`</table>`;
      }
    });
  }

  // Photo report section
  let photosHtml='';
  if(inclPhotos&&photoRec?.rows?.length){
    photosHtml=`<div style="page-break-before:always"><h2 style="font-size:13px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #1e7fd4;padding-bottom:5px;margin-bottom:12px">🖼️ Reportage photographique</h2><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr><th style="background:#0d1b2a;color:white;padding:6px 8px;width:55%;text-align:left">PHOTOS</th><th style="background:#0d1b2a;color:white;padding:6px 8px;text-align:left">COMMENTAIRES</th></tr></thead><tbody>`;
    photoRec.rows.forEach((row,idx)=>{
      const photoCell=row.photo?`<img src="${row.photo}" style="max-width:100%;max-height:180px;border-radius:4px;display:block" />`:`<div style="border:1px dashed #ccc;padding:20px;text-align:center;color:#aaa;border-radius:4px">Photo ${idx+1}</div>`;
      photosHtml+=`<tr style="border-bottom:2px solid #dee2e6"><td style="padding:8px;vertical-align:top">${photoCell}</td><td style="padding:8px;vertical-align:top;font-size:11px;line-height:1.5">${esc(row.comment||'').replace(/\n/g,'<br>')}</td></tr>`;
    });
    photosHtml+=`</tbody></table></div>`;
  }

  const eqRows=inclEq?mEqs.map(eq=>{const cat=categories.find(c=>c.id===eq.category)?.name||eq.category;return`<tr><td>${esc(cat)}</td><td><strong>${esc(eq.name)}</strong></td><td>${esc(eq.brand||'—')}</td><td>${esc(eq.model||'—')}</td><td>${esc(eq.serial||'—')}</td><td>${esc(eq.year||'—')}</td><td>${esc(eq.power||'—')}</td><td>${CL[eq.condition]||'—'}</td></tr>`;}).join(''):'';

  const html=`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>ADIATOOL — ${esc(mission?.name||'Rapport')}</title>
<style>
body{font-family:Arial,sans-serif;font-size:10px;color:#222;margin:0;padding:16px}
.hdr{background:#0d1b2a;color:white;padding:16px 18px;border-radius:5px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
.hdr h1{font-size:18px;margin:0;letter-spacing:2px}.hdr h1 span{color:#1e7fd4}
.hdr p{font-size:8px;color:#6a90b0;margin:2px 0 0;letter-spacing:2px;text-transform:uppercase}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.card{background:#f8f9fa;border:1px solid #dee2e6;border-radius:5px;padding:10px}
.card h2{font-size:10px;font-weight:700;margin:0 0 7px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:2px solid #1e7fd4;padding-bottom:3px}
.f{margin-bottom:4px}.fl{font-size:8px;color:#888;text-transform:uppercase;letter-spacing:.5px;display:block}.fv{font-size:9px}
.badge{display:inline-block;padding:2px 6px;border-radius:8px;font-size:8px;font-weight:700}
.b-en_cours{background:#fef9c3;color:#854d0e}.b-termine{background:#dcfce7;color:#166534}.b-planifie{background:#dbeafe;color:#1e40af}
table{width:100%;border-collapse:collapse;font-size:9px}th{background:#0d1b2a;color:white;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase}
td{padding:3px 6px;border-bottom:1px solid #dee2e6;vertical-align:top}tr:nth-child(even) td{background:#f8f9fa}
.obs{background:#fff8f0;border-left:4px solid #1e7fd4;padding:8px;margin:12px 0;border-radius:0 5px 5px 0;font-size:10px;line-height:1.4}
.concl{background:#f0fdf4;border-left:4px solid #22c55e;padding:8px;margin:12px 0;border-radius:0 5px 5px 0;font-size:11px;font-weight:700}
.notes-block{background:#fafafa;border:1px solid #e5e7eb;border-radius:5px;padding:10px;margin:12px 0;font-size:10px;line-height:1.6;white-space:pre-wrap}
.footer{text-align:center;font-size:8px;color:#aaa;margin-top:20px;padding-top:8px;border-top:1px solid #eee}
@media print{body{padding:0}.page-break{page-break-before:always}}
</style></head><body>
<div class="hdr"><div><h1>ADIA<span>TOOL</span></h1><p>Rapport de visite technique</p><div style="color:#e8f0f8;font-size:13px;font-weight:700;margin-top:6px">${esc(mission?.name||'—')}</div></div><div style="text-align:right;color:#6a90b0;font-size:8px">Généré le ${new Date().toLocaleDateString('fr-FR')}<br>${mEqs.length} équipement(s)</div></div>
<div class="grid">
<div class="card"><h2>🏢 Site</h2><div class="f"><span class="fl">Nom</span><span class="fv">${esc(site?.name||'—')}</span></div><div class="f"><span class="fl">Adresse</span><span class="fv">${esc([site?.address,site?.zip,site?.city].filter(Boolean).join(', ')||'—')}</span></div><div class="f"><span class="fl">Énergie</span><span class="fv">${esc(site?.energie||'—')}</span></div><div class="f"><span class="fl">Contact</span><span class="fv">${esc(site?.contact||'—')}</span></div></div>
<div class="card"><h2>📋 Mission</h2><div class="f"><span class="fl">Type</span><span class="fv">${TL[mission?.type]||'—'}</span></div><div class="f"><span class="fl">Statut</span><span class="fv"><span class="badge b-${mission?.status}">${SL[mission?.status]||'—'}</span></span></div><div class="f"><span class="fl">Période</span><span class="fv">${mission?.dateStart||'—'}${mission?.dateEnd?' → '+mission.dateEnd:''}</span></div><div class="f"><span class="fl">Intervenant</span><span class="fv">${esc(mission?.operator||'—')}</span></div><div class="f"><span class="fl">Référence</span><span class="fv">${esc(mission?.ref||'—')}</span></div></div>
</div>
${inclEq&&mEqs.length?`<h2 style="font-size:11px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #1e7fd4;padding-bottom:4px;margin-bottom:8px">🔧 Équipements (${mEqs.length})</h2><table><thead><tr><th>Catégorie</th><th>Désignation</th><th>Marque</th><th>Modèle</th><th>N° Série</th><th>Année</th><th>Puissance</th><th>État</th></tr></thead><tbody>${eqRows}</tbody></table>`:''}
${formsHtml}
${inclNotes&&notesRec?.text?`<h2 style="font-size:11px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #1e7fd4;padding-bottom:4px;margin:14px 0 8px">✏️ Notes de visite</h2><div class="notes-block">${esc(notesRec.text)}</div>`:''}
${obs?`<div class="obs"><strong>Observations :</strong><br>${esc(obs).replace(/\n/g,'<br>')}</div>`:''}
${concl?`<div class="concl">${conclMap[concl]||concl}</div>`:''}
${photosHtml}
<div class="footer">ADIATOOL — Rapport généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
<script>window.onload=()=>window.print()<\/script>
</body></html>`;
  window.open(URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),'_blank');
  showToast('PDF prêt — Imprimer / Enregistrer en PDF');
}

// ── SETTINGS ─────────────────────────────────────────────────────
function renderSettings(){
  if(geminiKey)document.getElementById('gemini-key-input').value=geminiKey;
  const cl=document.getElementById('categories-list');cl.innerHTML='';const wrap=document.createElement('div');wrap.className='categories-list';
  categories.forEach(cat=>{const item=document.createElement('div');item.className='cat-item';item.innerHTML=`<div class="cat-dot" style="background:${cat.color}"></div><span style="flex:1;font-size:13px">${esc(cat.name)}</span>`;
    if(!DEFAULT_CATEGORIES.find(d=>d.id===cat.id)){const del=document.createElement('button');del.className='cat-del';del.textContent='✕';del.addEventListener('click',()=>deleteCategory(cat.id));item.appendChild(del);}wrap.appendChild(item);});cl.appendChild(wrap);
  document.getElementById('stats-container').innerHTML=`<div class="stats-grid"><div class="stat-item"><div class="stat-value">${sites.length}</div><div class="stat-label">SITES</div></div><div class="stat-item"><div class="stat-value">${missions.length}</div><div class="stat-label">MISSIONS</div></div><div class="stat-item"><div class="stat-value">${equipments.length}</div><div class="stat-label">ÉQUIPEMENTS</div></div><div class="stat-item"><div class="stat-value">${missions.filter(m=>m.status==='en_cours').length}</div><div class="stat-label">EN COURS</div></div></div>`;
}
async function saveGeminiKey(){geminiKey=document.getElementById('gemini-key-input').value.trim();await dbPut('config',{key:'geminiKey',value:geminiKey});const el=document.getElementById('gemini-status');el.textContent=geminiKey?'✓ Clé sauvegardée':'Clé supprimée';el.className='settings-status'+(geminiKey?' success':'');setTimeout(()=>{el.textContent='';el.className='settings-status';},3000);}
async function addCategory(){const inp=document.getElementById('new-cat-input'),name=inp.value.trim();if(!name)return;const colors=['#f43f5e','#f97316','#eab308','#84cc16','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#d946ef'];const id=name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')+'_'+Date.now();categories.push({id,name,color:colors[categories.length%colors.length]});await dbPut('config',{key:'categories',value:categories});inp.value='';renderSettings();renderCatFilter();}
async function deleteCategory(id){if(equipments.some(e=>e.category===id)){showToast('Catégorie utilisée','error');return;}categories=categories.filter(c=>c.id!==id);await dbPut('config',{key:'categories',value:categories});renderSettings();renderCatFilter();}
async function clearAll(){if(!confirm('Effacer TOUTES les données ?'))return;for(const s of sites)await dbDel('sites',s.id);for(const m of missions)await dbDel('missions',m.id);for(const e of equipments)await dbDel('equipments',e.id);for(const f of formDataStore)await dbDel('formdata',f.id);sites=[];missions=[];equipments=[];formDataStore=[];renderSettings();renderSites();showToast('Données effacées');}
function backupData(){download(JSON.stringify({version:4,app:'adiatool',exportedAt:new Date().toISOString(),sites,missions,equipments:equipments.map(e=>({...e,photo:null})),formDataStore,categories},null,2),`adiatool_backup_${today()}.json`,'application/json');showToast('Sauvegarde téléchargée');}
async function restoreData(file){try{const data=JSON.parse(await file.text());if(!data.sites)throw new Error('Format invalide');if(!confirm(`Restaurer ${data.sites.length} sites ?`))return;for(const s of sites)await dbDel('sites',s.id);for(const m of missions)await dbDel('missions',m.id);for(const e of equipments)await dbDel('equipments',e.id);for(const f of formDataStore)await dbDel('formdata',f.id);sites=[];missions=[];equipments=[];formDataStore=[];for(const s of data.sites){await dbPut('sites',s);sites.push(s);}for(const m of data.missions){await dbPut('missions',m);missions.push(m);}for(const e of data.equipments){await dbPut('equipments',e);equipments.push(e);}if(data.formDataStore)for(const f of data.formDataStore){await dbPut('formdata',f);formDataStore.push(f);}if(data.categories){categories=data.categories;await dbPut('config',{key:'categories',value:categories});}renderSettings();renderSites();showToast('Restauration réussie ✓','success');}catch(e){showToast('Erreur: '+e.message,'error');}}

// ── UTILS ─────────────────────────────────────────────────────────
const uid=()=>crypto.randomUUID();const now=()=>new Date().toISOString();const today=()=>new Date().toISOString().slice(0,10);
const esc=s=>(s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const v=id=>(document.getElementById(id)?.value||'').trim();const vn=id=>{const n=parseFloat(document.getElementById(id)?.value);return isNaN(n)?null:n;};
const slugify=s=>(s||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,30);
function download(content,filename,mime){const blob=content instanceof Blob?content:new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let tt;function showToast(msg,type=''){const el=document.getElementById('toast');el.textContent=msg;el.className='toast'+(type?' '+type:'');el.classList.remove('hidden');if(tt)clearTimeout(tt);tt=setTimeout(()=>el.classList.add('hidden'),2800);}

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
init().catch(console.error);
