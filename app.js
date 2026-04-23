/**
 * APP.JS - Main Application Logic for RecepciónPro
 */

// --- GLOBAL STATE ---
let currentSession = null;
let sessionData = { expected: [], scans: [] };
let excelData = null; // Temporary for preview
let codeReader = null;
let activeFilter = 'all';

let lastScannedCode = null;
let lastScannedTime = 0;
const SCAN_COOLDOWN = 2500; // 2.5 seconds between same code

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initFileUpload();
    initBarcodeListeners();
    loadPlanillasList();
    loadHistory();
    
    // Check if there is an active session in local storage
    const savedSessionId = localStorage.getItem('active_session_id');
    if (savedSessionId) {
        resumeSession(savedSessionId);
    }
});

// --- NAVIGATION ---
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const viewId = item.getAttribute('data-view');
            switchView(viewId);
        });
    });

    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });

    document.getElementById('btn-config').addEventListener('click', () => {
        document.getElementById('cfg-url').value = localStorage.getItem('sb_url') || '';
        document.getElementById('cfg-key').value = localStorage.getItem('sb_key') || '';
        openModal('modal-config');
    });
}

function switchView(viewId) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (activeNav) activeNav.classList.add('active');

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    const titles = {
        dashboard: 'Dashboard',
        upload: 'Cargar Planillas',
        scanner: 'Escaneo en Vivo',
        compare: 'Comparación',
        reports: 'Reporte Final',
        history: 'Historial'
    };
    document.getElementById('topbar-title').textContent = titles[viewId] || 'RecepciónPro';
    document.getElementById('sidebar').classList.remove('open');

    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'compare') renderCompareTable();
    if (viewId === 'history') loadHistory();
}

// --- FILE UPLOAD & EXCEL ---
function initFileUpload() {
    const dropzone = document.getElementById('dropzone');
    const input = document.getElementById('file-input');
    if (!dropzone) return;

    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        handleExcelFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => handleExcelFile(e.target.files[0]));
}

function handleExcelFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        excelData = XLSX.utils.sheet_to_json(sheet);
        setupColumnMapping(Object.keys(excelData[0]));
    };
    reader.readAsArrayBuffer(file);
}

function setupColumnMapping(cols) {
    const selects = ['map-barcode', 'map-description', 'map-quantity', 'map-unit', 'map-alias'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="">— Opcional —</option>';
        cols.forEach(col => {
            const opt = document.createElement('option');
            opt.value = col;
            opt.textContent = col;
            const low = col.toLowerCase();
            if (id === 'map-barcode' && (low.includes('bar') || low.includes('cod') || low.includes('ean'))) opt.selected = true;
            if (id === 'map-description' && (low.includes('desc') || low.includes('prod') || low.includes('nom'))) opt.selected = true;
            if (id === 'map-quantity' && (low.includes('cant') || low.includes('esper'))) opt.selected = true;
            if (id === 'map-alias' && (low.includes('alias') || low.includes('ean') || low.includes('alterno') || low.includes('barra'))) opt.selected = true;
            sel.appendChild(opt);
        });
    });
    document.getElementById('col-mapping').style.display = 'block';
    renderPreviewTable(cols);
}

function renderPreviewTable(cols) {
    const table = document.getElementById('preview-table');
    const thead = table.querySelector('thead tr');
    const tbody = table.querySelector('tbody');
    thead.innerHTML = cols.map(c => `<th>${c}</th>`).join('');
    tbody.innerHTML = excelData.slice(0, 5).map(row => `<tr>${cols.map(c => `<td>${row[c] || ''}</td>`).join('')}</tr>`).join('');
    document.getElementById('preview-count-tag').textContent = `${excelData.length} ítems`;
    document.getElementById('preview-card').style.display = 'block';
}

async function importExcel() {
    const colBarcode = document.getElementById('map-barcode').value;
    const colDesc = document.getElementById('map-description').value;
    const colQty = document.getElementById('map-quantity').value;
    const colUnit = document.getElementById('map-unit').value;
    const colAlias = document.getElementById('map-alias').value;

    if (!colBarcode || !colQty) { showToast('Mapea al menos Código y Cantidad', 'warn'); return; }

    const name = `Planilla ${new Date().toLocaleDateString()}`;
    const items = excelData.map(row => ({
        codigo: row[colBarcode],
        descripcion: row[colDesc] || 'Sin descripción',
        cantidad: row[colQty],
        unidad: row[colUnit] || '',
        alias: colAlias && row[colAlias] ? String(row[colAlias]) : ''
    }));

    const btn = document.getElementById('btn-import-excel');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const p = await db_savePlanilla(name, '', items);
    if (p) {
        showToast('Planilla importada', 'ok');
        loadPlanillasList();
        document.getElementById('col-mapping').style.display = 'none';
        document.getElementById('preview-card').style.display = 'none';
    }
    btn.disabled = false;
    btn.textContent = '✅ Importar Planilla';
}

async function loadPlanillasList() {
    const list = await db_getPlanillas();
    const container = document.getElementById('planillas-list');
    if (list.length === 0) {
        container.innerHTML = '<div class="feed-empty">Sin planillas cargadas</div>';
        return;
    }
    container.innerHTML = list.map(p => `
        <div class="planilla-item" onclick="selectPlanilla('${p.id}', this)">
            <div><strong>${p.nombre}</strong><div style="font-size:11px;color:var(--text3)">${p.total_items} productos</div></div>
            <span class="tag">ID: ${p.id.substring(0,8)}</span>
        </div>
    `).join('');
}

let selectedPlanillaId = null;
function selectPlanilla(id, el) {
    selectedPlanillaId = id;
    document.querySelectorAll('.planilla-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('session-name').value = `Recepción — ${el.querySelector('strong').textContent}`;
}

async function createSession() {
    if (!selectedPlanillaId) { showToast('Selecciona una planilla primero', 'warn'); return; }
    const name = document.getElementById('session-name').value;
    const supplier = document.getElementById('session-supplier').value;
    const notes = document.getElementById('session-notes').value;

    const session = await db_createSession(selectedPlanillaId, name, supplier, notes);
    if (session) {
        localStorage.setItem('active_session_id', session.id);
        await resumeSession(session.id);
        showToast('Sesión iniciatizada', 'ok');
        switchView('scanner');
    }
}

async function resumeSession(id) {
    const data = await db_getSessionFullData(id);
    if (!data) { localStorage.removeItem('active_session_id'); return; }
    currentSession = data.session;
    sessionData = { expected: data.expected, scans: data.scans };
    document.getElementById('session-badge').classList.add('active');
    document.getElementById('session-badge-text').textContent = currentSession.nombre;
    document.getElementById('session-name-display').textContent = currentSession.nombre;
    updateDashboard();
    renderScannedList();
}

// --- SCANNER LOGIC ---
function initBarcodeListeners() {
    const manualInput = document.getElementById('manual-barcode-input');
    if (manualInput) {
        manualInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') processManualScan();
        });
    }

    let buffer = "";
    let lastKeyTime = Date.now();
    document.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        if (!document.getElementById('view-scanner').classList.contains('active')) return;

        const currentTime = Date.now();
        if (currentTime - lastKeyTime > 100) buffer = ""; 
        
        if (e.key === 'Enter') {
            if (buffer.length > 2) { processBarcode(buffer, 'lector'); buffer = ""; }
        } else if (e.key.length === 1) {
            buffer += e.key;
        }
        lastKeyTime = currentTime;
    });
}

async function startCamera() {
    console.log('Iniciando cámara...');
    const wrap = document.getElementById('camera-wrap');
    const btnStart = document.getElementById('btn-start-camera');
    const btnStop = document.getElementById('btn-stop-camera');
    const status = document.getElementById('camera-status');
    
    try {
        if (status) { status.style.display = 'flex'; status.textContent = "⌛ Iniciando..."; }
        
        const ZXingLib = window.ZXing || window.ZXingJS;
        if (!ZXingLib) throw new Error('Librería no cargada');

        if (!codeReader) codeReader = new ZXingLib.BrowserMultiFormatReader();

        const devices = await codeReader.listVideoInputDevices();
        if (devices.length === 0) throw new Error('No se detectó cámara');
        
        const selectedDevice = devices.find(d => 
            d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('trasera') || d.label.toLowerCase().includes('rear')
        ) || devices[devices.length - 1];

        if (btnStart) btnStart.innerHTML = '⌛ Conectando...';
        
        await codeReader.decodeFromVideoDevice(selectedDevice.deviceId, 'scanner-video', (result, err) => {
            if (result) {
                processBarcode(result.getText(), 'camara');
            }
        });
        
        if (btnStart) btnStart.style.display = 'none';
        if (btnStop) btnStop.style.display = 'inline-flex';
        if (status) status.style.display = 'none';
        showToast('Cámara activa', 'ok');
        
    } catch (e) {
        console.error(e);
        if (status) { status.style.display = 'flex'; status.textContent = `❌ ${e.message}`; }
        if (btnStart) { btnStart.style.display = 'inline-flex'; btnStart.innerHTML = '▶ Reintentar'; }
    }
}

function stopCamera() {
    if (codeReader) codeReader.reset();
    const status = document.getElementById('camera-status');
    const btnStart = document.getElementById('btn-start-camera');
    const btnStop = document.getElementById('btn-stop-camera');
    if (status) { status.style.display = 'flex'; status.textContent = "📷 Cámara apagada"; }
    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnStop) btnStop.style.display = 'none';
}

function switchScannerTab(tab) {
    document.getElementById('tab-camera').classList.toggle('active', tab === 'camera');
    document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');
    document.getElementById('tab-lista').classList.toggle('active', tab === 'lista');
    document.getElementById('scanner-camera-panel').style.display = tab === 'camera' ? 'block' : 'none';
    document.getElementById('scanner-manual-panel').style.display = tab === 'manual' ? 'block' : 'none';
    document.getElementById('scanner-lista-panel').style.display = tab === 'lista' ? 'block' : 'none';
    if (tab === 'manual') document.getElementById('manual-barcode-input').focus();
    if (tab === 'lista') renderListaPanel();
    if (tab !== 'camera') stopCamera();
}

async function processManualScan() {
    const input = document.getElementById('manual-barcode-input');
    const qtyInput = document.getElementById('manual-qty');
    const code = input.value.trim();
    if (!code) return;
    await processBarcode(code, 'manual', parseInt(qtyInput.value) || 1);
    input.value = ""; input.focus();
}

async function processBarcode(code, method, qty = 1) {
    if (!currentSession) { showToast('Crea una sesión primero', 'err'); return; }

    const now = Date.now();
    if (code === lastScannedCode && (now - lastScannedTime) < SCAN_COOLDOWN) return;
    
    lastScannedCode = code;
    lastScannedTime = now;

    const item = findExpectedItem(code);
    if (!item && method !== 'manual_confirm') {
        if (codeReader) codeReader.reset();
        openAssociateModal(code);
        return;
    }

    const scan = await db_saveScan(currentSession.id, code, qty, method);
    if (scan) {
        sessionData.scans.push(scan);
        updateLastScanBox(code, qty);
        updateDashboard();
        renderScannedList();
        addToLiveFeed(code, method);
        playBeep('ok');
        const wrap = document.getElementById('camera-wrap');
        if (wrap) {
            wrap.classList.add('scan-success');
            setTimeout(() => wrap.classList.remove('scan-success'), 300);
        }
    }
}

// --- ASSOCIATION LOGIC ---
let pendingBarcode = null;
function openAssociateModal(code) {
    pendingBarcode = String(code);
    document.getElementById('unknown-code-display').textContent = pendingBarcode;
    document.getElementById('associate-search').value = '';
    renderAssociateList();
    openModal('modal-associate');
}

function renderAssociateList() {
    const container = document.getElementById('associate-list');
    const search = document.getElementById('associate-search').value.toLowerCase();
    const items = sessionData.expected.filter(i => !search || i.descripcion.toLowerCase().includes(search) || i.codigo_barras.includes(search));

    if (items.length === 0) { container.innerHTML = '<div class="feed-empty">No hay productos</div>'; return; }
    container.innerHTML = items.map(i => `
        <div class="lista-item" onclick="associateAndProcess('${i.id}')">
            <div class="li-info"><span class="li-name">📦 ${i.descripcion}</span><span class="li-code">Planilla: ${i.codigo_barras}</span></div>
            <button class="btn btn-ghost btn-sm">Vincular</button>
        </div>
    `).join('');
}

async function associateAndProcess(itemId) {
    const item = sessionData.expected.find(i => i.id === itemId);
    if (!item) return;
    const currentAliases = item.alias_barras ? item.alias_barras.split(',').map(a => a.trim()) : [];
    if (!currentAliases.includes(pendingBarcode)) {
        currentAliases.push(pendingBarcode);
        item.alias_barras = currentAliases.join(', ');
        await sb.from('planilla_items').update({ alias_barras: item.alias_barras }).eq('id', itemId);
        showToast('Código vinculado', 'ok');
    }
    closeModal('modal-associate');
    await startCamera(); // Restart camera
    await processBarcode(pendingBarcode, 'manual_confirm', 1);
}

// --- LISTA MODE ---
function renderListaPanel() {
    const container = document.getElementById('lista-items');
    if (!sessionData.expected.length) { container.innerHTML = '<div class="feed-empty">Sin planilla activa</div>'; return; }
    const search = (document.getElementById('lista-search')?.value || '').toLowerCase();
    const receivedMap = {};
    sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);

    const items = sessionData.expected.filter(item => !search || item.descripcion.toLowerCase().includes(search) || item.codigo_barras.includes(search));
    container.innerHTML = items.map(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        const statusClass = received === 0 ? 'zero' : received >= item.cantidad_esperada ? (received > item.cantidad_esperada ? 'over' : 'done') : '';
        return `<div class="lista-item ${statusClass}">
            <div class="li-info"><span class="li-name">${received >= item.cantidad_esperada ? '✅' : '⬜'} ${item.descripcion}</span><span class="li-code">${item.codigo_barras}</span><span class="li-progress">Recibido: ${received}/${item.cantidad_esperada}</span></div>
            <div class="li-controls"><button class="li-btn" onclick="listaAdjust('${item.codigo_barras}', -1)">−</button><span class="li-qty">${received}</span><button class="li-btn" onclick="listaAdjust('${item.codigo_barras}', 1)">+</button></div>
        </div>`;
    }).join('');
}

async function listaAdjust(code, delta) {
    if (delta > 0) {
        const scan = await db_saveScan(currentSession.id, code, 1, 'lista');
        if (scan) { sessionData.scans.push(scan); playBeep('ok'); }
    } else {
        const idx = [...sessionData.scans].reverse().findIndex(s => s.codigo_barras === code);
        if (idx !== -1) {
            const realIdx = sessionData.scans.length - 1 - idx;
            const { error } = await sb.from('escaneos').delete().eq('id', sessionData.scans[realIdx].id);
            if (!error) sessionData.scans.splice(realIdx, 1);
        }
    }
    renderListaPanel(); updateDashboard();
}

// --- LOGIC & DASHBOARD ---
function findExpectedItem(code) {
    const direct = sessionData.expected.find(i => i.codigo_barras === String(code));
    if (direct) return direct;
    return sessionData.expected.find(i => {
        if (!i.alias_barras) return false;
        return i.alias_barras.split(',').map(a => a.trim()).includes(String(code));
    });
}

function updateLastScanBox(code, qty) {
    const box = document.getElementById('last-scan-box');
    const title = document.getElementById('last-scan-status');
    const detail = document.getElementById('last-scan-detail');
    const codeEl = document.getElementById('last-scan-code');
    codeEl.textContent = code;
    const item = findExpectedItem(code);
    if (item) {
        const total = sessionData.scans.filter(s => s.codigo_barras === code || s.codigo_barras === item.codigo_barras).reduce((a,b) => a + b.cantidad, 0);
        if (total > item.cantidad_esperada) { box.className = 'last-scan-box warn'; title.textContent = '⚠️ Sobrante'; detail.textContent = `${item.descripcion} (${total}/${item.cantidad_esperada})`; playBeep('err'); }
        else { box.className = 'last-scan-box ok'; title.textContent = '✅ Correcto'; detail.textContent = `${item.descripcion} · Total: ${total}`; }
    } else { box.className = 'last-scan-box err'; title.textContent = '🔴 No en planilla'; detail.textContent = 'Desconocido'; playBeep('err'); }
}

function updateDashboard() {
    const stats = calculateStats();
    document.getElementById('stat-val-esperados').textContent = stats.totalEsperados;
    document.getElementById('stat-val-correctos').textContent = stats.ok;
    document.getElementById('stat-val-faltantes').textContent = stats.faltantes;
    document.getElementById('stat-val-sobrantes').textContent = stats.sobrantes;
    document.getElementById('stat-val-escaneados').textContent = stats.totalEscaneados;
    const progress = stats.totalEsperados > 0 ? Math.round((stats.ok / stats.totalEsperados) * 100) : 0;
    document.getElementById('main-progress-bar').style.width = `${progress}%`;
    document.getElementById('main-progress-label').textContent = `${progress}%`;
}

function calculateStats() {
    if (!sessionData.expected.length) return { totalEsperados: 0, totalEscaneados: 0, ok: 0, faltantes: 0, sobrantes: 0 };
    const receivedMap = {};
    sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);
    let ok = 0, faltantes = 0, sobrantes = 0;
    sessionData.expected.forEach(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        if (received === item.cantidad_esperada) ok++;
        else if (received < item.cantidad_esperada) faltantes++;
        else if (received > item.cantidad_esperada) sobrantes++;
    });
    return { totalEsperados: sessionData.expected.length, totalEscaneados: sessionData.scans.length, ok, faltantes, sobrantes };
}

function renderScannedList() {
    const container = document.getElementById('scanned-list');
    if (sessionData.scans.length === 0) { container.innerHTML = '<div class="feed-empty">No hay escaneos</div>'; return; }
    container.innerHTML = [...sessionData.scans].reverse().slice(0, 15).map(s => {
        const item = sessionData.expected.find(i => i.codigo_barras === s.codigo_barras);
        return `<div class="scanned-item"><span class="si-status">${item ? '✅' : '🔴'}</span><span class="si-code">${s.codigo_barras}</span><span class="si-desc">${item ? item.descripcion : 'Desconocido'}</span><span class="si-qty">x${s.cantidad}</span></div>`;
    }).join('');
}

function renderCompareTable() {
    const tbody = document.getElementById('compare-tbody');
    const search = document.getElementById('compare-search').value.toLowerCase();
    const receivedMap = {};
    sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);
    const rows = sessionData.expected.filter(i => !search || i.codigo_barras.includes(search) || i.descripcion.toLowerCase().includes(search)).map(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        const diff = received - item.cantidad_esperada;
        return `<tr><td><span class="badge badge-${received === item.cantidad_esperada ? 'ok' : 'faltante'}">${received === item.cantidad_esperada ? 'ok' : 'novedad'}</span></td><td class="si-code">${item.codigo_barras}</td><td>${item.descripcion}</td><td>${item.cantidad_esperada}</td><td>${received}</td><td>${diff}</td></tr>`;
    });
    tbody.innerHTML = rows.join('') || '<tr><td colspan="6" class="feed-empty">Sin resultados</td></tr>';
}

function generateReport() {
    const stats = calculateStats();
    const container = document.getElementById('report-content');
    document.getElementById('report-empty-msg').style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = `<div class="report-summary"><h3>Resumen de Recepción</h3><p>Total Esperados: ${stats.totalEsperados} | Recibidos: ${stats.totalEscaneados}</p></div>`;
}

async function loadHistory() {
    const history = await db_getSessionsHistory();
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = history.map(h => `<tr><td>${h.nombre}</td><td>${h.proveedor || '—'}</td><td>${new Date(h.created_at).toLocaleDateString()}</td><td>${h.escaneos.length}</td><td><span class="badge badge-ok">${h.estado}</span></td><td><button class="btn btn-ghost" onclick="resumeSession('${h.id}')">📂 Abrir</button></td></tr>`).join('');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showToast(msg, type = 'ok') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'ok' ? '✅' : '❌'}</span> ${msg}`;
    container.appendChild(toast); setTimeout(() => toast.remove(), 3000);
}
function playBeep(type) { const audio = document.getElementById(type === 'ok' ? 'beep-ok' : 'beep-err'); if (audio) audio.play().catch(() => {}); }
function addToLiveFeed(code, method) {
    const feed = document.getElementById('live-feed');
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `<span class="feed-item-icon">${method === 'camara' ? '📷' : '⌨️'}</span><span class="feed-item-code">${code}</span><span class="feed-item-time">${new Date().toLocaleTimeString()}</span>`;
    feed.prepend(item); if (feed.children.length > 20) feed.lastElementChild.remove();
}
