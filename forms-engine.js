
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
  // Get type de production for current local
  const lfd=getLocalFd();
  const typeProduction=(lfd.data['chauffage']||{})[0]?.['type_prod'] || 
    (lfd.data['generalites']||{})['type_chaufferie'] || '';
  const isChauffageSeul=typeProduction==='Chauffage seul';

  // Always render in FORM_MODULES order
  FORM_MODULES.forEach(mod=>{
    if(!activeModules.includes(mod.id))return;
    // Hide ECS module if chauffage seul
    if(mod.id==='ecs'&&isChauffageSeul)return;
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

  // Check ECS visibility
  const lfdR=getLocalFd();
  const tpR=(lfdR.data['generalites']||{})['type_chaufferie']||'';
  if(modId==='ecs'&&tpR==='Chauffage seul')return;
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
const CL_EQ={bon:'✅ Bon état',correct:'🔵 Correct',degrade:'⚠️ Dégradé',hs:'❌ Hors service'};

function getModuleEquipments(moduleId){
  // Match by exact moduleContext OR by base moduleId if no index suffix
  const baseId=moduleId.replace(/_\d+$/,'');
  const hasIdx=/_\d+$/.test(moduleId);
  return equipments.filter(e=>{
    if(e.missionId!==currentMissionId)return false;
    if(e.moduleContext===moduleId)return true;
    if(!hasIdx&&e.moduleId===baseId&&!e.moduleContext)return true;
    return false;
  });
}

function buildEquipmentInline(moduleId){
  const block=document.createElement('div');block.className='equip-inline-block';block.dataset.moduleId=moduleId;

  const refreshList=()=>{
    const listDiv=block.querySelector('.equip-cards-list');if(!listDiv)return;
    const mEqs=getModuleEquipments(moduleId);
    listDiv.innerHTML='';
    if(!mEqs.length){
      listDiv.innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:8px 0;font-style:italic">Aucun matériel — utilisez les boutons ci-dessous</div>';
      return;
    }
    mEqs.forEach(eq=>{
      const cat=categories.find(c=>c.id===eq.category)||{name:eq.category||'Autre',color:'#6b7280'};
      const card=document.createElement('div');
      card.style.cssText='background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;position:relative;overflow:hidden;margin-bottom:6px';
      card.innerHTML=`
        <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${cat.color};border-radius:3px 0 0 3px"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-left:6px">
          <div style="flex:1">
            <div style="font-family:var(--font-display);font-size:15px;font-weight:700;margin-bottom:2px">${esc(eq.name||'—')}</div>
            ${eq.brand||eq.model?`<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${[eq.brand,eq.model,eq.year?'('+eq.year+')':''].filter(Boolean).join(' ')}</div>`:''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
              ${eq.serial?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">SN: ${esc(eq.serial)}</span>`:''}
              ${eq.power?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--accent2)">${esc(eq.power)}</span>`:''}
              ${eq.condition?`<span style="font-family:var(--font-mono);font-size:10px">${CL_EQ[eq.condition]||eq.condition}</span>`:''}
            </div>
            ${eq.notes?`<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;font-style:italic">${esc(eq.notes.slice(0,80))}${eq.notes.length>80?'…':''}</div>`:''}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">
            <button class="card-btn" data-action="edit" title="Modifier">✏️</button>
            <button class="card-btn" data-action="del" title="Supprimer">🗑️</button>
          </div>
        </div>`;
      card.querySelector('[data-action=edit]').addEventListener('click',()=>openEqModal(eq.id,moduleId));
      card.querySelector('[data-action=del]').addEventListener('click',async()=>{
        if(!confirm('Supprimer cet équipement ?'))return;
        await dbDel('equipments',eq.id);equipments=equipments.filter(e=>e.id!==eq.id);
        refreshList();renderSynthesis();
      });
      listDiv.appendChild(card);
    });
  };

  const listDiv=document.createElement('div');listDiv.className='equip-cards-list';
  const btnRow=document.createElement('div');btnRow.style.cssText='display:flex;gap:8px;margin-top:6px';
  const addBtn=document.createElement('button');addBtn.className='equip-add-btn';addBtn.textContent='＋ Saisir manuellement';
  addBtn.addEventListener('click',()=>openEqModal(null,moduleId));
  const scanBtn=document.createElement('button');scanBtn.className='equip-scan-btn';scanBtn.textContent='📷 Scanner la plaque';
  scanBtn.addEventListener('click',()=>{editingEqContext=moduleId;openScanForModule(moduleId);});
  btnRow.appendChild(addBtn);btnRow.appendChild(scanBtn);
  block.appendChild(listDiv);block.appendChild(btnRow);
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
      const updt=()=>{const d=parseFloat(row.querySelector('.mp-dep').value),r=parseFloat(row.querySelector('.mp-ret').value);const el=document.getElementById(`dt${modId}${pi}`);if(el)el.textContent=(!isNaN(d)&&!isNaN(r))?(d-r).toFixed(1)+' °C':'—';};
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
        if(isTR){const d=parseFloat(row.querySelector('.mc-d')?.value),r=parseFloat(row.querySelector('.mc-r')?.value);el.textContent=(!isNaN(d)&&!isNaN(r))?(d-r).toFixed(1)+' °C':'—';}
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

  const lk=getLocalKey();

  // Get energy from site for conditional obligations
  const site=(typeof sites!=='undefined'?sites:[]).find(s=>s.id===currentSiteId)||null;
  const energie=(site?.energie||'').toLowerCase();
  const isCombustion=energie.includes('gaz')||energie.includes('fioul');

  // Nb years control
  const nbRow=document.createElement('div');nbRow.className='form-group';
  nbRow.innerHTML=`<label>Années à renseigner</label><input type="number" id="cahier-nb-${lk}" min="1" max="10" value="1" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);width:100%;font-size:14px;outline:none"/>`;
  const actBtn=document.createElement('button');actBtn.className='btn-secondary btn-sm';actBtn.textContent='↻ Actualiser';actBtn.style.marginBottom='10px';
  actBtn.addEventListener('click',async()=>{
    const nb=parseInt(document.getElementById(`cahier-nb-${lk}`)?.value)||1;
    const mainFd=getMFD();if(!mainFd.localData)mainFd.localData={};
    if(!mainFd.localData[lk])mainFd.localData[lk]={data:{},repeatData:{},comments:{},cahierYears:{}};
    for(let i=0;i<nb;i++){const yr=String(new Date().getFullYear()-i);if(!mainFd.localData[lk].cahierYears[yr])mainFd.localData[lk].cahierYears[yr]={obligations:{},customOps:[]};}
    await saveMFD(mainFd);
    yearsDiv.innerHTML='';
    renderYears(yearsDiv);
  });
  body.appendChild(nbRow);body.appendChild(actBtn);

  // Get puissance from primaire module
  const lfd=getLocalFd();
  const puiss=(lfd.data['primaire']||{})['prim_puissance']||'';
  // Filter obligations based on energy
  const allOblDefs=OBLIGATIONS_CHAUFFERIE[puiss]||OBLIGATIONS_CHAUFFERIE['≥ 70 kW et < 400 kW'];
  const oblDefs=allOblDefs.filter(o=>{
    if((o.id==='ramonage'||o.id==='combustion')&&!isCombustion)return false;
    return true;
  });

  const yearsDiv=document.createElement('div');yearsDiv.className='cahier-years';

  const renderYears=(container)=>{
    container.innerHTML=''; // clear before re-render
    const lfd2=getLocalFd();const yrs=lfd2.cahierYears||{};
    // Update nb input
    const nbEl=document.getElementById(`cahier-nb-${lk}`);
    if(nbEl)nbEl.value=Object.keys(yrs).length||1;

    Object.keys(yrs).sort().reverse().forEach(yr=>{
      const yData=yrs[yr];
      const yBlock=document.createElement('div');yBlock.className='year-block';
      const yhdr=document.createElement('div');yhdr.className='year-block-header';
      yhdr.innerHTML=`<span class="year-block-title">📅 Année ${yr}</span><button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;padding:0">▾</button>`;
      const yBody=document.createElement('div');yBody.className='year-block-body';
      let yCollapsed=false;
      yhdr.addEventListener('click',()=>{yCollapsed=!yCollapsed;yBody.className='year-block-body'+(yCollapsed?' collapsed':'');yhdr.querySelector('button').textContent=yCollapsed?'▸':'▾';});

      // Saison dates
      [{id:'date_allumage',label:"Date allumage"},{id:'date_arret',label:"Date arrêt"}].forEach(sf=>{
        const fg=document.createElement('div');fg.className='form-group';
        fg.innerHTML=`<label>${sf.label}</label><input type="date" value="${yData[sf.id]||''}"/>`;
        fg.querySelector('input').addEventListener('change',async e=>{
          const mf=getMFD();if(!mf.localData?.[lk]?.cahierYears?.[yr])return;
          mf.localData[lk].cahierYears[yr][sf.id]=e.target.value;await saveMFD(mf);
        });
        yBody.appendChild(fg);
      });

      // Predefined obligations
      const oblTitle=document.createElement('div');oblTitle.className='form-section-title';oblTitle.textContent='OPÉRATIONS RÉGLEMENTAIRES';yBody.appendChild(oblTitle);
      if(!isCombustion){
        const warn=document.createElement('div');warn.style.cssText='font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:8px';
        warn.textContent='ℹ️ Ramonage & combustion masqués (énergie non combustible)';yBody.appendChild(warn);
      }
      if(!yData.obligations)yData.obligations={};
      oblDefs.forEach(obl=>{
        if(!yData.obligations[obl.id])yData.obligations[obl.id]={freq:obl.freq_default,dates:[]};
        const oblData=yData.obligations[obl.id];
        const oblRow=document.createElement('div');oblRow.className='obligation-row';
        oblRow.innerHTML=`<div class="obligation-header"><span class="obligation-label">${obl.label}</span><select class="obl-freq" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--accent);font-family:var(--font-mono);font-size:11px;outline:none">${FREQ_OPTIONS.map(f=>`<option value="${f}"${f===oblData.freq?' selected':''}>${f}</option>`).join('')}</select></div>`;
        const datesDiv=document.createElement('div');datesDiv.className='obligation-dates';
        const renderDates=(dates)=>{
          datesDiv.innerHTML='';
          dates.forEach((dv,di)=>{
            const dr=document.createElement('div');dr.className='obl-date-row';
            dr.innerHTML=`<span class="obl-date-label">${di+1}.</span><input type="date" value="${dv||''}" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text-primary);font-size:12px;outline:none"/><button style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 5px;font-size:12px">✕</button>`;
            dr.querySelector('input').addEventListener('change',async e=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id]?.dates)mf.localData[lk].cahierYears[yr].obligations[obl.id].dates[di]=e.target.value;await saveMFD(mf);});
            dr.querySelector('button').addEventListener('click',async()=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id]?.dates){mf.localData[lk].cahierYears[yr].obligations[obl.id].dates.splice(di,1);await saveMFD(mf);renderDates(mf.localData[lk].cahierYears[yr].obligations[obl.id].dates);}});
            datesDiv.appendChild(dr);
          });
          const addBtn=document.createElement('button');addBtn.className='btn-add-comment';addBtn.textContent='+ Ajouter une date';
          addBtn.addEventListener('click',async()=>{const mf=getMFD();if(!mf.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id])return;if(!mf.localData[lk].cahierYears[yr].obligations[obl.id].dates)mf.localData[lk].cahierYears[yr].obligations[obl.id].dates=[];mf.localData[lk].cahierYears[yr].obligations[obl.id].dates.push('');await saveMFD(mf);renderDates(mf.localData[lk].cahierYears[yr].obligations[obl.id].dates);});
          datesDiv.appendChild(addBtn);
        };
        renderDates(oblData.dates||[]);
        oblRow.querySelector('.obl-freq').addEventListener('change',async e=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.obligations?.[obl.id])mf.localData[lk].cahierYears[yr].obligations[obl.id].freq=e.target.value;await saveMFD(mf);});
        oblRow.appendChild(datesDiv);yBody.appendChild(oblRow);
      });

      // Custom operations
      const customTitle=document.createElement('div');customTitle.className='form-section-title';customTitle.textContent='OPÉRATIONS PERSONNALISÉES';yBody.appendChild(customTitle);
      const customList=document.createElement('div');
      const renderCustomOps=(ops)=>{
        customList.innerHTML='';
        (ops||[]).forEach((op,oi)=>{
          const opRow=document.createElement('div');opRow.className='obligation-row';
          const IS='background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-size:12px;outline:none';
          opRow.innerHTML=`<div class="obligation-header" style="flex-wrap:wrap;gap:4px"><input type="text" class="op-label" value="${esc(op.label||'')}" placeholder="Libellé de l'opération" style="${IS};flex:1;min-width:120px"/><select class="op-freq" style="${IS};color:var(--accent);font-family:var(--font-mono);font-size:11px">${FREQ_OPTIONS.map(f=>`<option value="${f}"${f===op.freq?' selected':''}>${f}</option>`).join('')}</select><button class="op-del" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;padding:0 4px">✕</button></div>`;
          const datesDiv2=document.createElement('div');datesDiv2.className='obligation-dates';
          const renderOpDates=(dates)=>{
            datesDiv2.innerHTML='';
            (dates||[]).forEach((dv,di)=>{
              const dr=document.createElement('div');dr.className='obl-date-row';
              dr.innerHTML=`<span class="obl-date-label">${di+1}.</span><input type="date" value="${dv||''}" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text-primary);font-size:12px;outline:none"/><button style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 5px;font-size:12px">✕</button>`;
              dr.querySelector('input').addEventListener('change',async e=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.customOps?.[oi])mf.localData[lk].cahierYears[yr].customOps[oi].dates[di]=e.target.value;await saveMFD(mf);});
              dr.querySelector('button').addEventListener('click',async()=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.customOps?.[oi]?.dates){mf.localData[lk].cahierYears[yr].customOps[oi].dates.splice(di,1);await saveMFD(mf);renderOpDates(mf.localData[lk].cahierYears[yr].customOps[oi].dates);}});
              datesDiv2.appendChild(dr);
            });
            const addDateBtn=document.createElement('button');addDateBtn.className='btn-add-comment';addDateBtn.textContent='+ Ajouter une date';
            addDateBtn.addEventListener('click',async()=>{const mf=getMFD();if(!mf.localData?.[lk]?.cahierYears?.[yr]?.customOps?.[oi])return;if(!mf.localData[lk].cahierYears[yr].customOps[oi].dates)mf.localData[lk].cahierYears[yr].customOps[oi].dates=[];mf.localData[lk].cahierYears[yr].customOps[oi].dates.push('');await saveMFD(mf);renderOpDates(mf.localData[lk].cahierYears[yr].customOps[oi].dates);});
            datesDiv2.appendChild(addDateBtn);
          };
          renderOpDates(op.dates||[]);
          opRow.querySelector('.op-label').addEventListener('change',async e=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.customOps?.[oi])mf.localData[lk].cahierYears[yr].customOps[oi].label=e.target.value;await saveMFD(mf);});
          opRow.querySelector('.op-freq').addEventListener('change',async e=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.customOps?.[oi])mf.localData[lk].cahierYears[yr].customOps[oi].freq=e.target.value;await saveMFD(mf);});
          opRow.querySelector('.op-del').addEventListener('click',async()=>{const mf=getMFD();if(mf.localData?.[lk]?.cahierYears?.[yr]?.customOps)mf.localData[lk].cahierYears[yr].customOps.splice(oi,1);await saveMFD(mf);renderCustomOps(mf.localData?.[lk]?.cahierYears?.[yr]?.customOps||[]);});
          opRow.appendChild(datesDiv2);customList.appendChild(opRow);
        });
        const addOpBtn=document.createElement('button');addOpBtn.className='btn-add-instance';addOpBtn.textContent='+ Ajouter une opération';addOpBtn.style.marginTop='4px';
        addOpBtn.addEventListener('click',async()=>{
          const mf=getMFD();if(!mf.localData?.[lk]?.cahierYears?.[yr])return;
          if(!mf.localData[lk].cahierYears[yr].customOps)mf.localData[lk].cahierYears[yr].customOps=[];
          mf.localData[lk].cahierYears[yr].customOps.push({label:'',freq:'Annuel',dates:[]});
          await saveMFD(mf);renderCustomOps(mf.localData[lk].cahierYears[yr].customOps);
        });
        customList.appendChild(addOpBtn);
      };
      renderCustomOps(yData.customOps||[]);
      yBody.appendChild(customList);
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

