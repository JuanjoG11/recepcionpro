/**
 * APP.JS - Main Application Logic for RecepciónPro
 */

// --- GLOBAL STATE ---
let currentSession = null;
let sessionData = { expected: [], scans: [] };
let excelData = null; // Temporary for preview
let codeReader = null;
let activeFilter = 'all';

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
    // Update Sidebar
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Update Views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    // Update Title
    const titles = {
        dashboard: 'Dashboard',
        upload: 'Cargar Planillas',
        scanner: 'Escaneo en Vivo',
        compare: 'Comparación',
        reports: 'Reporte Final',
        history: 'Historial'
    };
    document.getElementById('topbar-title').textContent = titles[viewId] || 'RecepciónPro';
    
    // Close sidebar mobile
    document.getElementById('sidebar').classList.remove('open');

    // View specific logic
    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'compare') renderCompareTable();
    if (viewId === 'history') loadHistory();
}

// --- FILE UPLOAD & EXCEL ---
function initFileUpload() {
    const dropzone = document.getElementById('dropzone');
    const input = document.getElementById('file-input');

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });
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
        
        if (excelData.length === 0) {
            showToast('El archivo está vacío', 'err');
            return;
        }

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
            // Auto-detect
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
    
    thead.innerHTML = '';
    cols.forEach(c => thead.innerHTML += `<th>${c}</th>`);
    
    tbody.innerHTML = '';
    excelData.slice(0, 5).forEach(row => {
        let tr = '<tr>';
        cols.forEach(c => tr += `<td>${row[c] || ''}</td>`);
        tbody.innerHTML += tr + '</tr>';
    });
    
    document.getElementById('preview-count-tag').textContent = `${excelData.length} ítems`;
    document.getElementById('preview-card').style.display = 'block';
}

async function importExcel() {
    const colBarcode = document.getElementById('map-barcode').value;
    const colDesc = document.getElementById('map-description').value;
    const colQty = document.getElementById('map-quantity').value;
    const colUnit = document.getElementById('map-unit').value;
    const colAlias = document.getElementById('map-alias').value; // new alias column

    if (!colBarcode || !colQty) {
        showToast('Mapea al menos Código y Cantidad', 'warn');
        return;
    }

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
        showToast('Planilla importada con éxito', 'ok');
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
            <div>
                <strong>${p.nombre}</strong>
                <div style="font-size:11px;color:var(--text3)">${p.total_items} productos</div>
            </div>
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
    if (!data) {
        localStorage.removeItem('active_session_id');
        return;
    }
    currentSession = data.session;
    sessionData = { expected: data.expected, scans: data.scans };
    
    // UI Updates
    document.getElementById('session-badge').classList.add('active');
    document.getElementById('session-badge-text').textContent = currentSession.nombre;
    document.getElementById('session-name-display').textContent = currentSession.nombre;
    
    updateDashboard();
    renderScannedList();
}

// --- SCANNER LOGIC ---
function initBarcodeListeners() {
    // Handle manual input focus
    const manualInput = document.getElementById('manual-barcode-input');
    manualInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') processManualScan();
    });

    // Hidden global listener for HID scanners (they usually end with Enter)
    let buffer = "";
    let lastKeyTime = Date.now();
    document.addEventListener('keydown', (e) => {
        // Only if not in an input and we are in scanner view
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        if (!document.getElementById('view-scanner').classList.contains('active')) return;

        const currentTime = Date.now();
        if (currentTime - lastKeyTime > 100) buffer = ""; // Reset if slow (human typing)
        
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
    const container = document.getElementById('camera-view');
    const btn = document.getElementById('btn-start-camera');
    const status = document.getElementById('camera-status');
    
    try {
        console.log('Iniciando cámara...');
        if (status) status.textContent = "⌛ Iniciando...";
        
        container.innerHTML = '<video id="video" style="width:100%; height:100%; object-fit:cover; border-radius:12px;"></video><div class="scanner-laser"></div>';
        
        // ZXing might be under different names depending on bundle
        const ZXingLib = window.ZXing || window.ZXingJS;
        if (!ZXingLib) {
            throw new Error('Librería de escaneo no cargada.');
        }

        if (!codeReader) {
            codeReader = new ZXingLib.BrowserMultiFormatReader();
        }

        const devices = await codeReader.listVideoInputDevices();
        console.log('Dispositivos:', devices);
        
        if (devices.length === 0) throw new Error('No se encontraron cámaras.');
        
        // Prefer back camera
        const selectedDevice = devices.find(d => 
            d.label.toLowerCase().includes('back') || 
            d.label.toLowerCase().includes('trasera') ||
            d.label.toLowerCase().includes('rear')
        ) || devices[devices.length - 1];
        
        console.log('Usando:', selectedDevice.label);
        if (btn) btn.innerHTML = '⌛ Iniciando...';
        
        await codeReader.decodeFromVideoDevice(selectedDevice.deviceId, 'video', (result, err) => {
            if (result) {
                const text = result.getText();
                console.log('Escaneado:', text);
                processBarcode(text, 'camara');
                playBeep('ok');
                container.classList.add('scan-success');
                setTimeout(() => container.classList.remove('scan-success'), 300);
            }
        });
        
        if (btn) btn.style.display = 'none';
        if (status) status.style.display = 'none';
        showToast('Cámara activa', 'ok');
        
    } catch (e) {
        console.error('Error cámara:', e);
        container.innerHTML = `<div class="scanner-error">❌ Error: ${e.message}</div>`;
        if (btn) {
            btn.style.display = 'inline-flex';
            btn.innerHTML = '▶ Reintentar Cámara';
        }
        showToast('Error: ' + e.message, 'err');
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
    const qtyInput = document.getElementById('manual-qty');
    const code = input.value.trim();
    const qty = parseInt(qtyInput.value) || 1;

    if (!code) return;
    await processBarcode(code, 'manual', qty);
    input.value = "";
    input.focus();
}

// ---- LISTA MODE (no barcodes) ----
function renderListaPanel() {
    const container = document.getElementById('lista-items');
    if (!sessionData.expected.length) {
        container.innerHTML = '<div class="feed-empty">Crea una sesión con una planilla para ver los productos</div>';
        return;
    }
    const search = (document.getElementById('lista-search')?.value || '').toLowerCase();
    // Build received map
    const receivedMap = {};
    sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);

    const items = sessionData.expected.filter(item =>
        !search || item.descripcion.toLowerCase().includes(search) || item.codigo_barras.includes(search)
    );

    if (!items.length) { container.innerHTML = '<div class="feed-empty">Sin resultados</div>'; return; }

    container.innerHTML = items.map(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        const statusClass = received === 0 ? 'zero' : received >= item.cantidad_esperada ? (received > item.cantidad_esperada ? 'over' : 'done') : '';
        const icon = received === 0 ? '⬜' : received >= item.cantidad_esperada ? (received > item.cantidad_esperada ? '⚠️' : '✅') : '🟡';
        return `
        <div class="lista-item ${statusClass}" id="li-${item.id}">
            <div class="li-info">
                <span class="li-name">${icon} ${item.descripcion}</span>
                <span class="li-code">${item.codigo_barras}</span>
                <span class="li-progress">Recibido: <strong>${received}</strong> / Esperado: <strong>${item.cantidad_esperada}</strong></span>
            </div>
            <div class="li-controls">
                <button class="li-btn li-btn-minus" onclick="listaAdjust('${item.codigo_barras}', -1)">−</button>
                <span class="li-qty">${received}</span>
                <button class="li-btn li-btn-plus" onclick="listaAdjust('${item.codigo_barras}', 1)">+</button>
            </div>
        </div>`;
    }).join('');
}

async function listaAdjust(code, delta) {
    if (!currentSession) { showToast('Crea una sesión primero', 'err'); return; }
    if (delta > 0) {
        // Add a scan
        const scan = await db_saveScan(currentSession.id, code, 1, 'lista');
        if (scan) {
            sessionData.scans.push(scan);
            playBeep('ok');
        }
    } else {
        // Remove one scan for this code
        const idx = [...sessionData.scans].reverse().findIndex(s => s.codigo_barras === code);
        if (idx === -1) return;
        const realIdx = sessionData.scans.length - 1 - idx;
        const scan = sessionData.scans[realIdx];
        const { error } = await sb.from('escaneos').delete().eq('id', scan.id);
        if (!error) sessionData.scans.splice(realIdx, 1);
    }
    renderListaPanel();
    updateDashboard();
    addToLiveFeed(code, 'lista');
}

async function processBarcode(code, method, qty = 1) {
    if (!currentSession) { showToast('Crea una sesión primero', 'err'); return; }

    const scan = await db_saveScan(currentSession.id, code, qty, method);
    if (scan) {
        sessionData.scans.push(scan);
        updateLastScanBox(code, qty);
        updateDashboard();
        renderScannedList();
        addToLiveFeed(code, method);
    }
}

// Core matching: finds expected item by barcode OR by alias
function findExpectedItem(code) {
    const direct = sessionData.expected.find(i => i.codigo_barras === String(code));
    if (direct) return direct;
    // Check aliases (stored as comma-separated string)
    return sessionData.expected.find(i => {
        if (!i.alias_barras) return false;
        const aliases = i.alias_barras.split(',').map(a => a.trim());
        return aliases.includes(String(code));
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
        const matchCode = item.codigo_barras;
        const totalReceived = sessionData.scans.filter(s => s.codigo_barras === code || s.codigo_barras === matchCode).reduce((a,b) => a + b.cantidad, 0);
        const isAlias = item.codigo_barras !== String(code);
        if (totalReceived > item.cantidad_esperada) {
            box.className = 'last-scan-box warn';
            title.textContent = '⚠️ Sobrante Detectado';
            detail.textContent = `${item.descripcion} (${totalReceived}/${item.cantidad_esperada})${isAlias ? ' — vía alias' : ''}`;
            playBeep('err');
        } else {
            box.className = 'last-scan-box ok';
            title.textContent = `✅ Producto Correcto${isAlias ? ' (Alias)' : ''}`;
            detail.textContent = `${item.descripcion} · Código planilla: ${item.codigo_barras} · Recibido: ${totalReceived}`;
        }
    } else {
        box.className = 'last-scan-box err';
        title.textContent = '🔴 No está en planilla';
        detail.textContent = 'Código no encontrado ni en planilla ni en alias.';
        playBeep('err');
    }
}

async function undoLastScan() {
    if (!currentSession) return;
    const ok = await db_deleteLastScan(currentSession.id);
    if (ok) {
        sessionData.scans.pop();
        updateDashboard();
        renderScannedList();
        showToast('Último escaneo eliminado', 'ok');
    }
}

// --- LOGIC & DASHBOARD ---
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
    
    // Update counters in scanner view
    document.getElementById('sc-ok').textContent = `✅ ${stats.ok}`;
    document.getElementById('sc-err').textContent = `❌ ${stats.faltantes}`;
    document.getElementById('sc-warn').textContent = `⚠️ ${stats.sobrantes}`;
}

function calculateStats() {
    if (!sessionData.expected.length) return { totalEsperados: 0, totalEscaneados: 0, ok: 0, faltantes: 0, sobrantes: 0 };

    let ok = 0;
    let faltantes = 0;
    let sobrantes = 0;
    
    // Group scans by code
    const receivedMap = {};
    sessionData.scans.forEach(s => {
        receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad;
    });

    sessionData.expected.forEach(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        if (received === item.cantidad_esperada) ok++;
        else if (received < item.cantidad_esperada) faltantes++;
        else if (received > item.cantidad_esperada) sobrantes++;
    });

    return {
        totalEsperados: sessionData.expected.length,
        totalEscaneados: sessionData.scans.length,
        ok, faltantes, sobrantes
    };
}

function renderScannedList() {
    const container = document.getElementById('scanned-list');
    if (sessionData.scans.length === 0) {
        container.innerHTML = '<div class="feed-empty">No hay escaneos aún</div>';
        return;
    }
    
    const reversed = [...sessionData.scans].reverse();
    container.innerHTML = reversed.slice(0, 20).map(s => {
        const item = sessionData.expected.find(i => i.codigo_barras === s.codigo_barras);
        return `
            <div class="scanned-item">
                <span class="si-status">${item ? '✅' : '🔴'}</span>
                <span class="si-code">${s.codigo_barras}</span>
                <span class="si-desc">${item ? item.descripcion : 'Producto desconocido'}</span>
                <span class="si-qty">x${s.cantidad}</span>
            </div>
        `;
    }).join('');
}

// --- COMPARISON TABLE ---
function setFilter(filter, el) {
    activeFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    renderCompareTable();
}

function renderCompareTable() {
    const tbody = document.getElementById('compare-tbody');
    const search = document.getElementById('compare-search').value.toLowerCase();
    
    // Group scans
    const receivedMap = {};
    sessionData.scans.forEach(s => {
        receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad;
    });

    const rows = [];
    
    // Add expected items
    sessionData.expected.forEach(item => {
        const received = receivedMap[item.codigo_barras] || 0;
        const diff = received - item.cantidad_esperada;
        let status = 'ok';
        if (received === 0) status = 'faltante';
        else if (received < item.cantidad_esperada) status = 'faltante';
        else if (received > item.cantidad_esperada) status = 'sobrante';

        if (activeFilter !== 'all' && activeFilter !== status) return;
        if (search && !item.codigo_barras.includes(search) && !item.descripcion.toLowerCase().includes(search)) return;

        rows.push({
            status,
            codigo: item.codigo_barras,
            desc: item.descripcion,
            esperado: item.cantidad_esperada,
            recibido: received,
            diff: diff > 0 ? `+${diff}` : diff
        });
    });

    // Add scans NOT in planilla
    Object.keys(receivedMap).forEach(code => {
        if (!sessionData.expected.find(i => i.codigo_barras === code)) {
            if (activeFilter !== 'all' && activeFilter !== 'no_planilla') return;
            if (search && !code.includes(search)) return;
            
            rows.push({
                status: 'no_planilla',
                codigo: code,
                desc: 'NO EN PLANILLA',
                esperado: 0,
                recibido: receivedMap[code],
                diff: `+${receivedMap[code]}`
            });
        }
    });

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="feed-empty">No se encontraron resultados</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><span class="badge badge-${r.status}">${r.status}</span></td>
            <td class="si-code">${r.codigo}</td>
            <td>${r.desc}</td>
            <td><strong>${r.esperado}</strong></td>
            <td><strong>${r.recibido}</strong></td>
            <td style="color:${r.recibido < r.esperado ? 'var(--red)' : (r.recibido > r.esperado ? 'var(--yellow)' : 'var(--green)')}">
                <strong>${r.diff}</strong>
            </td>
        </tr>
    `).join('');
}

// --- REPORTING ---
function generateReport() {
    const stats = calculateStats();
    const container = document.getElementById('report-content');
    const emptyMsg = document.getElementById('report-empty-msg');
    
    emptyMsg.style.display = 'none';
    container.style.display = 'block';
    
    container.innerHTML = `
        <div class="report-summary">
            <div class="rep-stat"><div class="rep-stat-val">${stats.totalEsperados}</div><div class="rep-stat-lbl">Ítems Planilla</div></div>
            <div class="rep-stat"><div class="rep-stat-val" style="color:var(--green)">${stats.ok}</div><div class="rep-stat-lbl">Correctos</div></div>
            <div class="rep-stat"><div class="rep-stat-val" style="color:var(--red)">${stats.faltantes}</div><div class="rep-stat-lbl">Faltantes</div></div>
            <div class="rep-stat"><div class="rep-stat-val" style="color:var(--yellow)">${stats.sobrantes}</div><div class="rep-stat-lbl">Sobrantes</div></div>
        </div>
        <h3>Detalle de Novedades</h3>
        <div class="table-wrap">
            <table class="data-table">
                <thead><tr><th>Código</th><th>Descripción</th><th>Esperado</th><th>Recibido</th><th>Diferencia</th></tr></thead>
                <tbody>
                    ${renderReportTableRows()}
                </tbody>
            </table>
        </div>
    `;
}

function renderReportTableRows() {
    // Similar to compare but only novelty
    const receivedMap = {};
    sessionData.scans.forEach(s => receivedMap[s.codigo_barras] = (receivedMap[s.codigo_barras] || 0) + s.cantidad);
    
    return sessionData.expected.filter(item => (receivedMap[item.codigo_barras] || 0) !== item.cantidad_esperada)
        .map(item => {
            const received = receivedMap[item.codigo_barras] || 0;
            const diff = received - item.cantidad_esperada;
            return `<tr>
                <td>${item.codigo_barras}</td>
                <td>${item.descripcion}</td>
                <td>${item.cantidad_esperada}</td>
                <td>${received}</td>
                <td style="color:var(--red)">${diff}</td>
            </tr>`;
        }).join('');
}

async function loadHistory() {
    const history = await db_getSessionsHistory();
    const tbody = document.getElementById('history-tbody');
    if (history.length === 0) return;
    
    tbody.innerHTML = history.map(h => `
        <tr>
            <td><strong>${h.nombre}</strong></td>
            <td>${h.proveedor || '—'}</td>
            <td>${new Date(h.created_at).toLocaleDateString()}</td>
            <td>${h.escaneos.length} escaneos</td>
            <td><span class="badge badge-ok">${h.estado}</span></td>
            <td>
                <button class="btn btn-ghost" onclick="resumeSession('${h.id}')">📂 Abrir</button>
            </td>
        </tr>
    `).join('');
}

// --- UTILS ---
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showToast(msg, type = 'ok') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'ok' ? '✅' : (type === 'err' ? '❌' : '⚠️')}</span> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function playBeep(type) {
    const audio = document.getElementById(type === 'ok' ? 'beep-ok' : 'beep-err');
    if (audio) audio.play().catch(() => {});
}

function addToLiveFeed(code, method) {
    const feed = document.getElementById('live-feed');
    const empty = feed.querySelector('.feed-empty');
    if (empty) empty.remove();
    
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
        <span class="feed-item-icon">${method === 'camara' ? '📷' : '⌨️'}</span>
        <span class="feed-item-code">${code}</span>
        <span class="feed-item-time">${new Date().toLocaleTimeString()}</span>
    `;
    feed.prepend(item);
    if (feed.children.length > 30) feed.lastElementChild.remove();
}
