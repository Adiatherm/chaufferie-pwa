/* ============================================
   CHAUFFERIE LOG — APPLICATION PRINCIPALE
   ============================================ */

'use strict';

// ─── CONFIGURATION ───────────────────────────
const DB_NAME    = 'ChaufferieLogDB';
const DB_VERSION = 1;
const STORE_EQ   = 'equipments';
const STORE_CFG  = 'config';

const DEFAULT_CATEGORIES = [
  { id: 'chaudiere',   name: 'Chaudière',        color: '#f97316' },
  { id: 'bruleur',     name: 'Brûleur',           color: '#ef4444' },
  { id: 'pompe',       name: 'Pompe / Circulateur', color: '#3b82f6' },
  { id: 'vanne',       name: 'Vanne / Régulation', color: '#a855f7' },
  { id: 'echangeur',   name: 'Échangeur',          color: '#22d3ee' },
  { id: 'ballon',      name: 'Ballon ECS',         color: '#10b981' },
  { id: 'electrique',  name: 'Équipement élec.',   color: '#eab308' },
  { id: 'autre',       name: 'Autre',              color: '#6b7280' },
];

// ─── STATE ────────────────────────────────────
let db           = null;
let equipments   = [];
let categories   = [...DEFAULT_CATEGORIES];
let geminiKey    = '';
let editingId    = null;
let cameraStream = null;
let capturedImage = null;
let attachedPhoto = null;
let filterText   = '';
let filterCat    = '';

// ─── DB ───────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_EQ))  d.createObjectStore(STORE_EQ,  { keyPath: 'id' });
      if (!d.objectStoreNames.contains(STORE_CFG)) d.createObjectStore(STORE_CFG, { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbPut(store, value) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// ─── INIT ─────────────────────────────────────
async function init() {
  db = await openDB();

  // Load config
  const catCfg = await dbGet(STORE_CFG, 'categories');
  if (catCfg) categories = catCfg.value;

  const keyCfg = await dbGet(STORE_CFG, 'geminiKey');
  if (keyCfg) geminiKey = keyCfg.value;

  equipments = await dbGetAll(STORE_EQ);

  renderAll();
  setupEvents();

  // Network status
  updateNetworkStatus();
  window.addEventListener('online',  updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

  // Splash fade
  await sleep(1900);
  document.getElementById('splash').classList.add('fade-out');
  await sleep(500);
  document.getElementById('splash').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── NETWORK ──────────────────────────────────
function updateNetworkStatus() {
  const el = document.getElementById('network-icon');
  if (navigator.onLine) {
    el.textContent = '🌐';
    el.title = 'En ligne';
  } else {
    el.textContent = '📵';
    el.title = 'Hors ligne';
  }
}

// ─── TABS ─────────────────────────────────────
function setupEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // List search/filter
  document.getElementById('search-input').addEventListener('input', e => {
    filterText = e.target.value.toLowerCase();
    renderList();
  });
  document.getElementById('filter-cat').addEventListener('change', e => {
    filterCat = e.target.value;
    renderList();
  });

  // FAB add
  document.getElementById('btn-add-manual').addEventListener('click', () => openModal());

  // Camera
  document.getElementById('btn-start-camera').addEventListener('click', startCamera);
  document.getElementById('btn-capture').addEventListener('click', captureFromCamera);
  document.getElementById('btn-upload-photo').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) processImageFile(file);
    e.target.value = '';
  });

  // Settings
  document.getElementById('btn-save-gemini').addEventListener('click', saveGeminiKey);
  document.getElementById('btn-add-cat').addEventListener('click', addCategory);
  document.getElementById('new-cat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCategory();
  });
  document.getElementById('btn-clear-all').addEventListener('click', clearAllData);

  // Modal
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-equipment').querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('btn-modal-save').addEventListener('click', saveEquipment);
  document.getElementById('btn-attach-photo').addEventListener('click', () => {
    document.getElementById('attach-file-input').click();
  });
  document.getElementById('attach-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        attachedPhoto = ev.target.result;
        const img = document.getElementById('field-photo-preview');
        img.src = attachedPhoto;
        img.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
  if (name !== 'scan') stopCamera();
}

// ─── RENDER ALL ───────────────────────────────
function renderAll() {
  renderList();
  renderFilterSelect();
  renderCategorySelector();
  renderSettings();
  updateHeaderCount();
}

function updateHeaderCount() {
  document.getElementById('header-count').textContent =
    `${equipments.length} équipement${equipments.length !== 1 ? 's' : ''}`;
}

function renderFilterSelect() {
  const sel = document.getElementById('filter-cat');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Toutes catégories</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    if (cat.id === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderCategorySelector() {
  const sel = document.getElementById('field-category');
  sel.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    sel.appendChild(opt);
  });
}

// ─── LIST RENDER ──────────────────────────────
function renderList() {
  const container = document.getElementById('equipment-list');
  let filtered = equipments.filter(eq => {
    const matchText = !filterText ||
      (eq.name   || '').toLowerCase().includes(filterText) ||
      (eq.brand  || '').toLowerCase().includes(filterText) ||
      (eq.model  || '').toLowerCase().includes(filterText) ||
      (eq.serial || '').toLowerCase().includes(filterText);
    const matchCat = !filterCat || eq.category === filterCat;
    return matchText && matchCat;
  });

  // Sort: by category then by name
  filtered.sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔧</div>
        <p>${equipments.length === 0
          ? 'Aucun équipement enregistré.<br>Utilisez le bouton + ou scannez une plaque.'
          : 'Aucun résultat pour cette recherche.'}</p>
      </div>`;
    return;
  }

  filtered.forEach(eq => {
    const cat = categories.find(c => c.id === eq.category) || { name: eq.category, color: '#6b7280' };
    const card = document.createElement('div');
    card.className = 'eq-card';
    card.style.setProperty('--cat-color', cat.color);
    card.innerHTML = `
      <div class="eq-card-header">
        <span class="eq-badge">${cat.name.toUpperCase()}</span>
        <div class="eq-card-actions">
          <button class="eq-action-btn" data-id="${eq.id}" data-action="edit" title="Modifier">✏️</button>
          <button class="eq-action-btn" data-id="${eq.id}" data-action="delete" title="Supprimer">🗑️</button>
        </div>
      </div>
      <div class="eq-name">${escHtml(eq.name || '—')}</div>
      <div class="eq-details">
        ${eq.brand  ? `<span class="eq-detail"><span class="eq-detail-label">MARQUE</span> ${escHtml(eq.brand)}</span>` : ''}
        ${eq.model  ? `<span class="eq-detail"><span class="eq-detail-label">MOD.</span> ${escHtml(eq.model)}</span>` : ''}
        ${eq.serial ? `<span class="eq-detail"><span class="eq-detail-label">SN</span> ${escHtml(eq.serial)}</span>` : ''}
        ${eq.power  ? `<span class="eq-detail"><span class="eq-detail-label">PUIS.</span> ${escHtml(eq.power)}</span>` : ''}
        ${eq.year   ? `<span class="eq-detail"><span class="eq-detail-label">AN</span> ${escHtml(String(eq.year))}</span>` : ''}
      </div>`;
    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return openModal(eq.id);
      if (btn.dataset.action === 'edit')   openModal(eq.id);
      if (btn.dataset.action === 'delete') deleteEquipment(eq.id);
    });
    container.appendChild(card);
  });
}

// ─── MODAL ────────────────────────────────────
function openModal(id = null) {
  editingId    = id;
  attachedPhoto = null;
  const modal = document.getElementById('modal-equipment');
  const eq = id ? equipments.find(e => e.id === id) : null;

  document.getElementById('modal-title').textContent = id ? 'Modifier équipement' : 'Nouvel équipement';
  renderCategorySelector();

  document.getElementById('field-category').value = eq?.category || categories[0]?.id || '';
  document.getElementById('field-name').value      = eq?.name     || '';
  document.getElementById('field-brand').value     = eq?.brand    || '';
  document.getElementById('field-model').value     = eq?.model    || '';
  document.getElementById('field-serial').value    = eq?.serial   || '';
  document.getElementById('field-year').value      = eq?.year     || '';
  document.getElementById('field-power').value     = eq?.power    || '';
  document.getElementById('field-fluid').value     = eq?.fluid    || '';
  document.getElementById('field-location').value  = eq?.location || '';
  document.getElementById('field-notes').value     = eq?.notes    || '';
  document.getElementById('field-ocr-raw').value   = eq?.ocrRaw   || '';

  const photoPreview = document.getElementById('field-photo-preview');
  if (eq?.photo) {
    photoPreview.src = eq.photo;
    photoPreview.classList.remove('hidden');
    attachedPhoto = eq.photo;
  } else {
    photoPreview.src = '';
    photoPreview.classList.add('hidden');
  }

  // Pre-fill from captured image (scan tab)
  if (!id && capturedImage) {
    const img = document.getElementById('field-photo-preview');
    img.src = capturedImage;
    img.classList.remove('hidden');
    attachedPhoto = capturedImage;
  }

  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('field-name').focus(), 300);
}

function closeModal() {
  document.getElementById('modal-equipment').classList.add('hidden');
  editingId     = null;
  attachedPhoto = null;
}

async function saveEquipment() {
  const name = document.getElementById('field-name').value.trim();
  if (!name) { showToast('Le nom est obligatoire', 'error'); return; }

  const eq = {
    id:       editingId || crypto.randomUUID(),
    category: document.getElementById('field-category').value,
    name,
    brand:    document.getElementById('field-brand').value.trim(),
    model:    document.getElementById('field-model').value.trim(),
    serial:   document.getElementById('field-serial').value.trim(),
    year:     document.getElementById('field-year').value ? parseInt(document.getElementById('field-year').value) : null,
    power:    document.getElementById('field-power').value.trim(),
    fluid:    document.getElementById('field-fluid').value.trim(),
    location: document.getElementById('field-location').value.trim(),
    notes:    document.getElementById('field-notes').value.trim(),
    ocrRaw:   document.getElementById('field-ocr-raw').value.trim(),
    photo:    attachedPhoto || null,
    updatedAt: new Date().toISOString(),
    createdAt: editingId ? (equipments.find(e => e.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
  };

  await dbPut(STORE_EQ, eq);
  if (editingId) {
    const idx = equipments.findIndex(e => e.id === editingId);
    if (idx >= 0) equipments[idx] = eq; else equipments.push(eq);
  } else {
    equipments.push(eq);
  }

  capturedImage = null;
  closeModal();
  renderAll();
  showToast(editingId ? 'Équipement mis à jour ✓' : 'Équipement ajouté ✓', 'success');
}

async function deleteEquipment(id) {
  if (!confirm('Supprimer cet équipement ?')) return;
  await dbDelete(STORE_EQ, id);
  equipments = equipments.filter(e => e.id !== id);
  renderAll();
  showToast('Équipement supprimé');
}

// ─── CAMERA ───────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    cameraStream = stream;
    const video = document.getElementById('camera-preview');
    video.srcObject = stream;
    document.getElementById('camera-placeholder').style.display = 'none';
    document.getElementById('btn-start-camera').classList.add('hidden');
    document.getElementById('btn-capture').classList.remove('hidden');
  } catch (err) {
    showToast('Accès caméra refusé. Utilisez "Importer photo".', 'error');
    console.error(err);
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('camera-preview');
  video.srcObject = null;
  document.getElementById('camera-placeholder').style.display = '';
  document.getElementById('btn-start-camera').classList.remove('hidden');
  document.getElementById('btn-capture').classList.add('hidden');
}

async function captureFromCamera() {
  const video  = document.getElementById('camera-preview');
  const canvas = document.getElementById('camera-canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataURL = canvas.toDataURL('image/jpeg', 0.9);
  stopCamera();
  await analyzeImage(dataURL);
}

async function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    await analyzeImage(e.target.result);
  };
  reader.readAsDataURL(file);
}

// ─── OCR / ANALYSE ────────────────────────────
async function analyzeImage(dataURL) {
  // Show image preview
  const previewContainer = document.getElementById('image-preview-container');
  const preview          = document.getElementById('image-preview');
  preview.src = dataURL;
  previewContainer.classList.remove('hidden');
  capturedImage = dataURL;

  const statusEl     = document.getElementById('ocr-status');
  const statusTextEl = document.getElementById('ocr-status-text');
  statusEl.classList.remove('hidden');

  let result = null;

  // Try Gemini first if online + key available
  if (navigator.onLine && geminiKey) {
    try {
      statusTextEl.textContent = '🌐 Analyse Gemini Vision...';
      result = await analyzeWithGemini(dataURL);
    } catch (err) {
      console.warn('Gemini failed, falling back to Tesseract:', err);
    }
  }

  // Fallback: Tesseract offline
  if (!result) {
    statusTextEl.textContent = '🔍 OCR hors-ligne (Tesseract)...';
    try {
      result = await analyzeWithTesseract(dataURL, statusTextEl);
    } catch (err) {
      console.error('Tesseract error:', err);
      showToast('Erreur OCR. Saisie manuelle.', 'error');
    }
  }

  statusEl.classList.add('hidden');

  // Open modal with pre-filled data
  openModal();
  if (result) prefillModal(result);
}

// ─── TESSERACT OCR ────────────────────────────
async function analyzeWithTesseract(dataURL, statusEl) {
  const { data } = await Tesseract.recognize(dataURL, 'fra+eng', {
    logger: m => {
      if (m.status === 'recognizing text') {
        statusEl.textContent = `🔍 OCR: ${Math.round(m.progress * 100)}%`;
      }
    }
  });

  const text = data.text;
  document.getElementById('field-ocr-raw').value = text;

  // Parse extracted text
  return parseOCRText(text);
}

function parseOCRText(text) {
  const result = { ocrRaw: text };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Brand detection (common brands)
  const brands = ['Viessmann','Viesmann','De Dietrich','Buderus','Saunier Duval','Frisquet',
    'Bosch','Remeha','Atlantic','Ariston','Chaffoteaux','Daikin','Mitsubishi',
    'Grundfos','Wilo','DAB','ITT','Xylem','Siemens','Honeywell','Danfoss',
    'Carrier','Trane','York','LG','Samsung','Lennox','Dungs','Weishaupt',
    'Riello','Cuenod','Baltur','Elco','Oilon'];
  for (const brand of brands) {
    if (text.toUpperCase().includes(brand.toUpperCase())) {
      result.brand = brand;
      break;
    }
  }

  // Serial number patterns
  const snPatterns = [
    /(?:S[\.\/]?N|N[°o]?\s*[Ss]érie|SERIAL\s*N[°o]?)[:\s#]*([A-Z0-9\-\/]{6,20})/i,
    /(?:SERIE|SER\.?)[:\s]*([A-Z0-9\-]{6,20})/i,
  ];
  for (const p of snPatterns) {
    const m = text.match(p);
    if (m) { result.serial = m[1].trim(); break; }
  }

  // Power
  const powerMatch = text.match(/(\d[\d\s,\.]*)\s*k[Ww]/);
  if (powerMatch) result.power = powerMatch[1].trim() + ' kW';

  // Year (4-digit, 1980-2030)
  const yearMatch = text.match(/\b(19[89]\d|20[0-3]\d)\b/);
  if (yearMatch) result.year = parseInt(yearMatch[1]);

  // Model (line with letters + numbers after brand)
  const modelPatterns = [
    /(?:TYPE|MODELE|MODEL|TYPE\s*DE\s*MACHINE)[:\s]*([A-Z0-9\s\-\.\/]{3,25})/i,
    /(?:Ref\.?|Référence)[:\s]*([A-Z0-9\s\-\.\/]{3,25})/i,
  ];
  for (const p of modelPatterns) {
    const m = text.match(p);
    if (m) { result.model = m[1].trim().replace(/\s+/g, ' '); break; }
  }

  // Fluid
  if (/gaz\s*naturel/i.test(text)) result.fluid = 'Gaz naturel';
  else if (/propane/i.test(text))  result.fluid = 'Propane';
  else if (/fioul|fuel/i.test(text)) result.fluid = 'Fioul';
  else if (/élec|electr/i.test(text)) result.fluid = 'Électrique';

  return result;
}

// ─── GEMINI VISION ────────────────────────────
async function analyzeWithGemini(dataURL) {
  const base64 = dataURL.split(',')[1];
  const mime   = dataURL.split(';')[0].split(':')[1];

  const prompt = `Tu analyses une photo de plaque signalétique d'équipement de chaufferie.
Extrais toutes les informations disponibles et réponds UNIQUEMENT en JSON valide, sans commentaire, sans backtick.
Format exact :
{
  "name": "désignation courte de l'équipement",
  "brand": "marque",
  "model": "modèle ou référence",
  "serial": "numéro de série",
  "year": null ou année entière,
  "power": "puissance avec unité",
  "fluid": "fluide ou énergie (gaz, fioul, électrique...)",
  "category": "chaudiere|bruleur|pompe|vanne|echangeur|ballon|electrique|autre",
  "ocrRaw": "tout le texte brut visible sur la plaque"
}
Si une info n'est pas visible, mets null.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mime, data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
      })
    }
  );

  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─── PREFILL MODAL ────────────────────────────
function prefillModal(data) {
  if (data.name)     document.getElementById('field-name').value     = data.name;
  if (data.brand)    document.getElementById('field-brand').value    = data.brand;
  if (data.model)    document.getElementById('field-model').value    = data.model;
  if (data.serial)   document.getElementById('field-serial').value   = data.serial;
  if (data.year)     document.getElementById('field-year').value     = data.year;
  if (data.power)    document.getElementById('field-power').value    = data.power;
  if (data.fluid)    document.getElementById('field-fluid').value    = data.fluid;
  if (data.ocrRaw)   document.getElementById('field-ocr-raw').value  = data.ocrRaw;
  if (data.category) {
    const sel = document.getElementById('field-category');
    const opt = Array.from(sel.options).find(o => o.value === data.category);
    if (opt) sel.value = data.category;
  }
  showToast('Plaque analysée — vérifiez les données', 'success');
}

// ─── SETTINGS ─────────────────────────────────
function renderSettings() {
  renderCategoriesSettings();
  renderStats();
  const inp = document.getElementById('gemini-key-input');
  if (geminiKey) inp.value = geminiKey;
}

async function saveGeminiKey() {
  const key = document.getElementById('gemini-key-input').value.trim();
  geminiKey = key;
  await dbPut(STORE_CFG, { key: 'geminiKey', value: key });
  const statusEl = document.getElementById('gemini-status');
  if (key) {
    statusEl.textContent = '✓ Clé sauvegardée';
    statusEl.className = 'settings-status success';
  } else {
    statusEl.textContent = 'Clé supprimée';
    statusEl.className = 'settings-status';
  }
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'settings-status'; }, 3000);
}

function renderCategoriesSettings() {
  const container = document.getElementById('categories-list');
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'categories-list';
  categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'cat-item';
    item.innerHTML = `
      <div class="cat-color-dot" style="background:${cat.color}"></div>
      <span class="cat-name">${escHtml(cat.name)}</span>
      ${DEFAULT_CATEGORIES.find(d => d.id === cat.id) ? '' :
        `<button class="cat-delete" data-id="${cat.id}">✕</button>`}`;
    item.querySelector('.cat-delete')?.addEventListener('click', () => deleteCategory(cat.id));
    list.appendChild(item);
  });
  container.appendChild(list);
}

async function addCategory() {
  const inp = document.getElementById('new-cat-input');
  const name = inp.value.trim();
  if (!name) return;

  const colors = ['#f43f5e','#f97316','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#8b5cf6','#d946ef'];
  const color  = colors[categories.length % colors.length];
  const id     = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();

  categories.push({ id, name, color });
  await dbPut(STORE_CFG, { key: 'categories', value: categories });
  inp.value = '';
  renderAll();
}

async function deleteCategory(id) {
  if (equipments.some(e => e.category === id)) {
    showToast('Catégorie utilisée par des équipements', 'error');
    return;
  }
  categories = categories.filter(c => c.id !== id);
  await dbPut(STORE_CFG, { key: 'categories', value: categories });
  renderAll();
}

function renderStats() {
  const container = document.getElementById('stats-container');
  const catCounts = {};
  equipments.forEach(eq => { catCounts[eq.category] = (catCounts[eq.category] || 0) + 1; });
  const topCat = Object.entries(catCounts).sort((a,b) => b[1]-a[1])[0];
  const catName = topCat ? (categories.find(c => c.id === topCat[0])?.name || topCat[0]) : '—';

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${equipments.length}</div>
        <div class="stat-label">ÉQUIPEMENTS</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${categories.length}</div>
        <div class="stat-label">CATÉGORIES</div>
      </div>
      <div class="stat-item" style="grid-column:1/-1">
        <div class="stat-value" style="font-size:16px">${catName}</div>
        <div class="stat-label">CATÉGORIE PRINCIPALE</div>
      </div>
    </div>`;
}

async function clearAllData() {
  if (!confirm('Supprimer TOUS les équipements ? Cette action est irréversible.')) return;
  for (const eq of equipments) await dbDelete(STORE_EQ, eq.id);
  equipments = [];
  renderAll();
  showToast('Données supprimées');
}

// ─── EXPORT CSV ───────────────────────────────
function exportCSV() {
  if (equipments.length === 0) { showToast('Aucun équipement à exporter', 'error'); return; }

  const headers = ['Catégorie','Désignation','Marque','Modèle','N° Série','Année','Puissance','Fluide','Localisation','Notes','Date création'];
  const rows = equipments.map(eq => {
    const cat = categories.find(c => c.id === eq.category)?.name || eq.category;
    return [
      cat, eq.name, eq.brand, eq.model, eq.serial, eq.year, eq.power,
      eq.fluid, eq.location, eq.notes,
      eq.createdAt ? new Date(eq.createdAt).toLocaleDateString('fr-FR') : ''
    ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`);
  });

  const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
  const bom  = '\uFEFF'; // UTF-8 BOM for Excel
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `chaufferie_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Export CSV — ${equipments.length} équipement(s)`);
}

// ─── UTILS ────────────────────────────────────
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ─── SERVICE WORKER ───────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  });
}

// ─── START ────────────────────────────────────
init().catch(console.error);
