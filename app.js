/**
 * APP.JS - Main Application Logic for RecepciónPro
 */

// --- GLOBAL STATE ---
let currentSession = null;
let sessionData = { expected: [], scans: [] };
let excelData = null; 
let codeReader = null;
let activeFilter = 'all';

let lastScannedCode = null;
let lastScannedTime = 0;
const SCAN_COOLDOWN = 2000; 

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initFileUpload();
    initBarcodeListeners();
    loadPlanillasList();
    loadHistory();
    const savedSessionId = localStorage.getItem('active_session_id');
    if (savedSessionId) resumeSession(savedSessionId);
});

// --- NAVIGATION ---
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(item.getAttribute('data-view'));
        });
    });
    document.getElementById('menu-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
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
    const titles = { dashboard: 'Dashboard', upload: 'Cargar Planillas', scanner: 'Escaneo en Vivo', compare: 'Comparación', reports: 'Reporte Final', history: 'Historial' };
    document.getElementById('topbar-title').textContent = titles[viewId] || 'RecepciónPro';
    document.getElementById('sidebar').classList.remove('open');
    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'compare') renderCompareTable();
    if (viewId === 'history') loadHistory();
}

// --- FILE UPLOAD ---
function initFileUpload() {
    const dropzone = document.getElementById('dropzone');
    const input = document.getElementById('file-input');
    if (!dropzone) return;
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); handleExcelFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', (e) => handleExcelFile(e.target.files[0]));
}

function handleExcelFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        excelData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
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
            opt.value = col; opt.textContent = col;
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
    table.querySelector('thead tr').innerHTML = cols.map(c => `<th>${c}</th>`).join('');
    table.querySelector('tbody').innerHTML = excelData.slice(0, 5).map(row => `<tr>${cols.map(c => `<td>${row[c] || ''}</td>`).join('')}</tr>`).join('');
    document.getElementById('preview-count-tag').textContent = `${excelData.length} ítems`;
    document.getElementById('preview-card').style.display = 'block';
}

async function importExcel() {
    const colBarcode = document.getElementById('map-barcode').value;
    const colQty = document.getElementById('map-quantity').value;
    if (!colBarcode || !colQty) { showToast('Mapea Código y Cantidad', 'warn'); return; }
    const items = excelData.map(row => ({
        codigo: row[colBarcode],
        descripcion: row[document.getElementById('map-description').value] || 'Sin descripción',
        cantidad: row[colQty],
        unidad: row[document.getElementById('map-unit').value] || '',
        alias: document.getElementById('map-alias').value ? String(row[document.getElementById('map-alias').value] || '') : ''
    }));
    const btn = document.getElementById('btn-import-excel');
    btn.disabled = true; btn.textContent = 'Guardando...';
    if (await db_savePlanilla(`Planilla ${new Date().toLocaleDateString()}`, '', items)) {
        showToast('Planilla importada', 'ok');
        loadPlanillasList();
        document.getElementById('col-mapping').style.display = 'none';
        document.getElementById('preview-card').style.display = 'none';
    }
    btn.disabled = false; btn.textContent = '✅ Importar Planilla';
}

async function loadPlanillasList() {
    const list = await db_getPlanillas();
    const container = document.getElementById('planillas-list');
    if (list.length === 0) { container.innerHTML = '<div class="feed-empty">Sin planillas</div>'; return; }
    container.innerHTML = list.map(p => `<div class="planilla-item" onclick="selectPlanilla('${p.id}', this)"><div><strong>${p.nombre}</strong><div style="font-size:11px">${p.total_items} productos</div></div></div>`).join('');
}

let selectedPlanillaId = null;
function selectPlanilla(id, el) {
    selectedPlanillaId = id;
    document.querySelectorAll('.planilla-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('session-name').value = `Recepción — ${el.querySelector('strong').textContent}`;
}

async function createSession() {
    if (!selectedPlanillaId) return showToast('Selecciona planilla', 'warn');
    const session = await db_createSession(selectedPlanillaId, document.getElementById('session-name').value, document.getElementById('session-supplier').value, '');
    if (session) { localStorage.setItem('active_session_id', session.id); await resumeSession(session.id); switchView('scanner'); }
}

async function resumeSession(id) {
    const data = await db_getSessionFullData(id);
    if (!data) return localStorage.removeItem('active_session_id');
    currentSession = data.session; sessionData = { expected: data.expected, scans: data.scans };
    document.getElementById('session-badge').classList.add('active');
    document.getElementById('session-badge-text').textContent = currentSession.nombre;
    document.getElementById('session-name-display').textContent = currentSession.nombre;
    
    // Render all views that might be active
    updateDashboard(); 
    renderScannedList();
    renderCompareTable();
    renderListaPanel();
}

// --- SCANNER LOGIC ---
function initBarcodeListeners() {
    const manualInput = document.getElementById('manual-barcode-input');
    if (manualInput) manualInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') processManualScan(); });

    // Support for HID Scanners (Pistols)
    let buffer = "";
    let lastKeyTime = Date.now();
    document.addEventListener('keydown', (e) => {
        // Skip if focused on an input
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        
        const currentTime = Date.now();
        // Reset buffer if delay > 50ms (human typing is slower than scanner)
        if (currentTime - lastKeyTime > 50) buffer = "";
        
        if (e.key === 'Enter') {
            if (buffer.length > 2) {
                processBarcode(buffer, 'lector');
                buffer = "";
            }
        } else if (e.key.length === 1) {
            buffer += e.key;
        }
        lastKeyTime = currentTime;
    });
}

async function startCamera() {
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
        const selectedDevice = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('trasera')) || devices[devices.length - 1];
        if (btnStart) btnStart.innerHTML = '⌛ Conectando...';
        
        let isScanning = true;
        await codeReader.decodeFromVideoDevice(selectedDevice.deviceId, 'scanner-video', async (result, err) => {
            if (result && isScanning) {
                isScanning = false;
                if (wrap) wrap.classList.add('scan-success');
                await processBarcode(result.getText(), 'camara');
                setTimeout(() => { isScanning = true; if (wrap) wrap.classList.remove('scan-success'); }, 2000);
            }
        });
        if (btnStart) btnStart.style.display = 'none';
        if (btnStop) btnStop.style.display = 'inline-flex';
        if (status) status.style.display = 'none';
    } catch (e) {
        if (status) status.textContent = `❌ ${e.message}`;
        if (btnStart) btnStart.innerHTML = '▶ Reintentar';
    }
}

function stopCamera() {
    if (codeReader) codeReader.reset();
    document.getElementById('camera-status').style.display = 'flex';
    document.getElementById('camera-status').textContent = "📷 Cámara apagada";
    document.getElementById('btn-start-camera').style.display = 'inline-flex';
    document.getElementById('btn-stop-camera').style.display = 'none';
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
    const code = input.value.trim();
    if (!code) return;
    await processBarcode(code, 'manual', parseInt(document.getElementById('manual-qty').value) || 1);
    input.value = ""; input.focus();
}

async function processBarcode(code, method, qty = 1) {
    if (!currentSession) return showToast('Crea sesión', 'err');
    const item = findExpectedItem(code);
    if (!item && method !== 'manual_confirm') {
        if (codeReader) codeReader.reset();
        openAssociateModal(code);
        return;
    }
    const scan = await db_saveScan(currentSession.id, code, qty, method);
    if (scan) {
        sessionData.scans.push(scan); updateLastScanBox(code, qty); updateDashboard(); renderScannedList(); addToLiveFeed(code, method); playBeep('ok');
    }
}

// --- ASSOCIATION ---
let pendingBarcode = null;
function openAssociateModal(code) {
    pendingBarcode = String(code);
    document.getElementById('unknown-code-display').textContent = pendingBarcode;
    document.getElementById('associate-search').value = '';
    renderAssociateList(); openModal('modal-associate');
}
function renderAssociateList() {
    const container = document.getElementById('associate-list');
    const search = document.getElementById('associate-search').value.toLowerCase();
    const items = sessionData.expected.filter(i => !search || i.descripcion.toLowerCase().includes(search) || i.codigo_barras.includes(search));
    container.innerHTML = items.map(i => `<div class="lista-item" onclick="associateAndProcess('${i.id}')"><div class="li-info"><strong>📦 ${i.descripcion}</strong><br><small>${i.codigo_barras}</small></div><button class="btn btn-ghost btn-sm">Vincular</button></div>`).join('');
}
async function associateAndProcess(itemId) {
    const item = sessionData.expected.find(i => i.id === itemId);
    if (!item) return;
    const currentAliases = item.alias_barras ? item.alias_barras.split(',').map(a => a.trim()) : [];
    if (!currentAliases.includes(pendingBarcode)) {
        currentAliases.push(pendingBarcode); item.alias_barras = currentAliases.join(', ');
        await sb.from('planilla_items').update({ alias_barras: item.alias_barras }).eq('id', itemId);
    }
    closeModal('modal-associate');
    await startCamera(); await processBarcode(pendingBarcode, 'manual_confirm', 1);
}

// --- LISTA ---
function renderListaPanel() {
    const container = document.getElementById('lista-items');
    if (!sessionData.expected.length) return;
    const search = (document.getElementById('lista-search')?.value || '').toLowerCase();
    const receivedMap = {}; sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);
    const items = sessionData.expected.filter(i => !search || i.descripcion.toLowerCase().includes(search) || i.codigo_barras.includes(search));
    container.innerHTML = items.map(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        return `<div class="lista-item ${received >= item.cantidad_esperada ? 'done' : ''}"><div class="li-info"><strong>${item.descripcion}</strong><br><small>${item.codigo_barras}</small><br>Recibido: ${received}/${item.cantidad_esperada}</div><div class="li-controls"><button class="li-btn" onclick="listaAdjust('${item.codigo_barras}', -1)">−</button><button class="li-btn" onclick="listaAdjust('${item.codigo_barras}', 1)">+</button></div></div>`;
    }).join('');
}
async function listaAdjust(code, delta) {
    if (delta > 0) { const scan = await db_saveScan(currentSession.id, code, 1, 'lista'); if (scan) { sessionData.scans.push(scan); playBeep('ok'); } }
    else { const idx = [...sessionData.scans].reverse().findIndex(s => s.codigo_barras === code); if (idx !== -1) { const realIdx = sessionData.scans.length - 1 - idx; if (!(await sb.from('escaneos').delete().eq('id', sessionData.scans[realIdx].id)).error) sessionData.scans.splice(realIdx, 1); } }
    renderListaPanel(); updateDashboard();
}

// --- UTILS ---
function findExpectedItem(code) {
    const direct = sessionData.expected.find(i => i.codigo_barras === String(code));
    if (direct) return direct;
    return sessionData.expected.find(i => i.alias_barras && i.alias_barras.split(',').map(a => a.trim()).includes(String(code)));
}
function updateLastScanBox(code, qty) {
    const box = document.getElementById('last-scan-box');
    const item = findExpectedItem(code);
    const displayCode = code.length > 50 ? code.substring(0, 47) + '...' : code;
    document.getElementById('last-scan-code').textContent = displayCode;
    
    if (item) {
        const total = sessionData.scans.filter(s => s.codigo_barras === code || s.codigo_barras === item.codigo_barras).reduce((a,b) => a + b.cantidad, 0);
        box.className = total > item.cantidad_esperada ? 'last-scan-box warn' : 'last-scan-box ok';
        document.getElementById('last-scan-status').textContent = total > item.cantidad_esperada ? '⚠️ Sobrante' : '✅ Correcto';
        document.getElementById('last-scan-detail').textContent = `${item.descripcion} (${total}/${item.cantidad_esperada})`;
    } else { 
        box.className = 'last-scan-box err'; 
        document.getElementById('last-scan-status').textContent = '🔴 No en planilla'; 
        document.getElementById('last-scan-detail').textContent = code.length > 100 ? 'Código muy largo (posible Factura DIAN)' : 'Desconocido'; 
    }
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
    const receivedMap = {}; sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);
    let ok = 0, faltantes = 0, sobrantes = 0;
    sessionData.expected.forEach(item => { const received = receivedMap[item.codigo_barras] || 0; if (received === item.cantidad_esperada) ok++; else if (received < item.cantidad_esperada) faltantes++; else if (received > item.cantidad_esperada) sobrantes++; });
    return { totalEsperados: sessionData.expected.length, totalEscaneados: sessionData.scans.length, ok, faltantes, sobrantes };
}
function renderScannedList() {
    const container = document.getElementById('scanned-list');
    if (sessionData.scans.length === 0) { container.innerHTML = '<div class="feed-empty">No hay escaneos</div>'; return; }
    container.innerHTML = [...sessionData.scans].reverse().slice(0, 10).map(s => {
        const item = sessionData.expected.find(i => i.codigo_barras === s.codigo_barras);
        return `<div class="scanned-item"><span class="si-status">${item ? '✅' : '🔴'}</span><span class="si-code">${s.codigo_barras}</span><span class="si-desc">${item ? item.descripcion : 'Desconocido'}</span><span class="si-qty">x${s.cantidad}</span></div>`;
    }).join('');
}
let compareFilter = 'all';

function setCompareFilter(filter, el) {
    compareFilter = filter;
    document.querySelectorAll('#view-compare .filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    renderCompareTable();
}

function renderCompareTable() {
    const tbody = document.getElementById('compare-tbody');
    const search = document.getElementById('compare-search').value.toLowerCase();
    
    const receivedMap = {};
    sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);

    let ok = 0, faltantes = 0, sobrantes = 0;
    
    const rows = sessionData.expected.map(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        const diff = received - item.cantidad_esperada;
        
        if (diff === 0) ok++;
        else if (diff < 0) faltantes++;
        else sobrantes++;

        // Filter logic
        if (compareFilter === 'novedad' && diff === 0) return null;
        if (search && !item.codigo_barras.includes(search) && !item.descripcion.toLowerCase().includes(search)) return null;

        const badge = diff === 0 ? 'badge-ok' : (diff < 0 ? 'badge-faltante' : 'badge-sobrante');
        const badgeText = diff === 0 ? 'OK' : (diff < 0 ? 'Faltante' : 'Sobrante');
        const diffClass = diff === 0 ? 'zero' : (diff < 0 ? 'neg' : 'pos');

        return `
            <tr>
                <td><span class="badge ${badge}">${badgeText}</span></td>
                <td class="si-code">${item.codigo_barras}</td>
                <td>${item.descripcion}</td>
                <td style="font-weight:600">${item.cantidad_esperada}</td>
                <td style="font-weight:600">${received}</td>
                <td class="diff-val ${diffClass}">${diff > 0 ? '+' : ''}${diff}</td>
            </tr>
        `;
    }).filter(r => r !== null);

    // Update Comparison Summary Cards
    document.getElementById('comp-val-ok').textContent = ok;
    document.getElementById('comp-val-faltantes').textContent = faltantes;
    document.getElementById('comp-val-sobrantes').textContent = sobrantes;

    tbody.innerHTML = rows.join('') || `<tr><td colspan="6" class="feed-empty">No hay ${compareFilter === 'novedad' ? 'novedades' : 'datos'} que coincidan</td></tr>`;
}
function loadHistory() {
    db_getSessionsHistory().then(history => {
        document.getElementById('history-tbody').innerHTML = history.map(h => `<tr><td>${h.nombre}</td><td>${h.proveedor || '—'}</td><td>${new Date(h.created_at).toLocaleDateString()}</td><td>${h.escaneos.length}</td><td><button class="btn btn-ghost" onclick="resumeSession('${h.id}')">📂 Abrir</button></td></tr>`).join('');
    });
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
    feed.prepend(item); if (feed.children.length > 15) feed.lastElementChild.remove();
}
