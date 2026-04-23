// ===== SUPABASE CONFIG =====
// Hardcoded credentials for immediate use
const SUPABASE_URL = localStorage.getItem('sb_url') || 'https://vvexmypxmnmsokgzkdcq.supabase.co';
const SUPABASE_KEY = localStorage.getItem('sb_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2ZXhteXB4bW5tc29rZ3prZGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NDA3NzEsImV4cCI6MjA5MjUxNjc3MX0.2v6MGqmmQTjmDB0X1VZW-6OqMf-jdhT9Rhx_jTDtczg';

let sb = null;

function initSupabase(url, key) {
  try {
    sb = window.supabase.createClient(url || SUPABASE_URL, key || SUPABASE_KEY);
    return true;
  } catch (e) {
    console.warn('Supabase init failed:', e);
    return false;
  }
}

function saveConfig() {
  console.log('saveConfig initiated');
  let url = document.getElementById('cfg-url').value.trim();
  const key = document.getElementById('cfg-key').value.trim();
  const statusEl = document.getElementById('config-status');
  
  const notify = (msg, type) => {
    if (typeof showToast === 'function') showToast(msg, type);
    else alert(`${type.toUpperCase()}: ${msg}`);
  };

  if (!url || !key) { notify('Completa URL y Key', 'err'); return; }

  // Auto-format URL if only project reference is provided
  if (!url.startsWith('http')) {
    url = `https://${url.supabase ? url.supabase : url}.supabase.co`;
    // If user put just the ID, url is now https://ID.supabase.co
    if (url.includes('undefined')) url = `https://${document.getElementById('cfg-url').value.trim()}.supabase.co`;
  }

  console.log('Connecting to:', url);

  try {
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    
    if (!window.supabase) {
        throw new Error('La librería de Supabase no se cargó correctamente. Revisa tu conexión a internet.');
    }

    const ok = initSupabase(url, key);
    if (ok) {
      statusEl.className = 'config-status ok';
      statusEl.textContent = '✅ Conexión configurada con éxito.';
      const dot = document.getElementById('status-dot');
      const lbl = document.getElementById('status-label');
      if (dot) dot.className = 'status-dot connected';
      if (lbl) lbl.textContent = 'Conectado';
      
      notify('Configuración guardada', 'ok');
      setTimeout(() => {
        if (typeof closeModal === 'function') closeModal('modal-config');
        else document.getElementById('modal-config').classList.remove('open');
      }, 1200);
    } else {
      throw new Error('No se pudo inicializar el cliente de Supabase.');
    }
  } catch (e) {
    console.error('saveConfig Error:', e);
    statusEl.className = 'config-status err';
    statusEl.textContent = '❌ Error: ' + e.message;
    notify(e.message, 'err');
  }
}

// Auto-init on load if creds exist
if (SUPABASE_URL && SUPABASE_KEY) initSupabase(SUPABASE_URL, SUPABASE_KEY);
