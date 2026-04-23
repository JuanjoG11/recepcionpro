/**
 * DB.JS - Database Abstraction Layer for RecepciónPro
 */

// Helper to check if Supabase is ready
function checkSB() {
    if (!sb) {
        showToast('Supabase no está configurado. Ve a ⚙️ Config', 'err');
        return false;
    }
    return true;
}

// 1. Save Planilla and its items
async function db_savePlanilla(name, supplier, items) {
    if (!checkSB()) return null;
    
    try {
        // Insert parent planilla
        const { data: pData, error: pError } = await sb
            .from('planillas')
            .insert([{ nombre: name, proveedor: supplier, total_items: items.length }])
            .select()
            .single();

        if (pError) throw pError;

        // Insert items in chunks to avoid payload limits
        const planillaId = pData.id;
        const itemsToInsert = items.map(item => ({
            planilla_id: planillaId,
            codigo_barras: String(item.codigo),
            alias_barras: item.alias || null,
            descripcion: item.descripcion,
            cantidad_esperada: parseInt(item.cantidad) || 0,
            unidad: item.unidad || ''
        }));

        const chunkSize = 100;
        for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
            const chunk = itemsToInsert.slice(i, i + chunkSize);
            const { error: iError } = await sb
                .from('planilla_items')
                .insert(chunk);
            if (iError) throw iError;
        }

        return pData;
    } catch (e) {
        console.error('Error db_savePlanilla:', e);
        showToast('Error al guardar planilla', 'err');
        return null;
    }
}

// 2. Get all planillas
async function db_getPlanillas() {
    if (!checkSB()) return [];
    const { data, error } = await sb
        .from('planillas')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) {
        console.error(error);
        return [];
    }
    return data;
}

// 3. Create a Reception Session
async function db_createSession(planillaId, name, supplier, notes) {
    if (!checkSB()) return null;
    const { data, error } = await sb
        .from('sesiones')
        .insert([{
            planilla_id: planillaId,
            nombre: name,
            proveedor: supplier,
            notas: notes,
            estado: 'abierta'
        }])
        .select()
        .single();
    
    if (error) {
        console.error(error);
        showToast('Error al crear sesión', 'err');
        return null;
    }
    return data;
}

// 4. Register a scan (with Offline support)
async function db_saveScan(sessionId, barcode, qty, method) {
    const scanObj = {
        sesion_id: sessionId,
        codigo_barras: String(barcode),
        cantidad: qty,
        metodo: method,
        created_at: new Date().toISOString()
    };

    if (!navigator.onLine) {
        console.warn('Offline: Guardando escaneo localmente...');
        const offlineQueue = JSON.parse(localStorage.getItem('offline_scans') || '[]');
        offlineQueue.push(scanObj);
        localStorage.setItem('offline_scans', JSON.stringify(offlineQueue));
        showToast('Guardado local (Sin Internet)', 'warn');
        return { ...scanObj, id: 'temp-' + Date.now() };
    }

    if (!checkSB()) return null;
    const { data, error } = await sb
        .from('escaneos')
        .insert([scanObj])
        .select()
        .single();
    
    if (error) {
        console.error(error);
        return null;
    }
    return data;
}

async function db_syncOfflineScans() {
    if (!navigator.onLine || !sb) return;
    const offlineQueue = JSON.parse(localStorage.getItem('offline_scans') || '[]');
    if (offlineQueue.length === 0) return;

    console.log(`Sincronizando ${offlineQueue.length} escaneos pendientes...`);
    showToast(`Sincronizando ${offlineQueue.length} escaneos...`, 'ok');

    // Remove temp IDs if any and insert
    const toInsert = offlineQueue.map(s => {
        const { id, ...rest } = s;
        return rest;
    });

    const { error } = await sb.from('escaneos').insert(toInsert);
    
    if (!error) {
        localStorage.setItem('offline_scans', '[]');
        showToast('Sincronización completa', 'ok');
    } else {
        console.error('Error en sincronización:', error);
    }
}

// 5. Delete last scan (Undo)
async function db_deleteLastScan(sessionId) {
    if (!checkSB()) return false;
    // Get last scan for this session
    const { data: lastScan, error: findError } = await sb
        .from('escaneos')
        .select('id')
        .eq('sesion_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    
    if (findError || !lastScan) return false;

    const { error: delError } = await sb
        .from('escaneos')
        .delete()
        .eq('id', lastScan.id);
    
    return !delError;
}

// 6. Get complete session state (Planilla Items + Scans)
async function db_getSessionFullData(sessionId) {
    if (!checkSB()) return null;

    // Get session info
    const { data: session, error: sErr } = await sb
        .from('sesiones')
        .select('*, planillas(*)')
        .eq('id', sessionId)
        .single();
    
    if (sErr) return null;

    // Get expected items
    const { data: expectedItems, error: eErr } = await sb
        .from('planilla_items')
        .select('*')
        .eq('planilla_id', session.planilla_id);
    
    // Get actual scans
    const { data: scans, error: scErr } = await sb
        .from('escaneos')
        .select('*')
        .eq('sesion_id', sessionId);
    
    return {
        session,
        expected: expectedItems || [],
        scans: scans || []
    };
}

// 7. Get History
async function db_getSessionsHistory() {
    if (!checkSB()) return [];
    const { data, error } = await sb
        .from('sesiones')
        .select(`
            *,
            planillas (nombre),
            escaneos (id)
        `)
        .order('created_at', { ascending: false });
    
    if (error) return [];
    return data;
}
