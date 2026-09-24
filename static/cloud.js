// ── Calce Cloud: login + sincronización con Supabase ─────────────────
// Offline-first: el navegador (localStorage) sigue siendo la copia local y
// la nube es el espejo. Con sesión iniciada, cada cambio se sube solo y al
// entrar se baja lo último. Si Supabase no está configurado, no hace nada.

const Cloud = (() => {
  const META_KEY = "calce.sync.meta";
  const PRESYNC_KEY = "calce.state.presync";
  let sb = null;
  let user = null;
  let pushTimer = null;
  let statusCb = null;
  let lastStatus = { kind: "off", msg: "" };

  function configured() {
    return typeof supabase !== "undefined"
      && !!window.SUPABASE_URL && !!window.SUPABASE_ANON_KEY
      && !/^\s*$/.test(window.SUPABASE_URL)
      && !/TU-|PEGA|xxxx|ejemplo/i.test(window.SUPABASE_URL);
  }

  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {}
  }

  function ensureClient() {
    if (sb || !configured()) return sb;
    sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return sb;
  }

  function setStatus(kind, msg) {
    lastStatus = { kind, msg };
    if (statusCb) { try { statusCb(kind, msg); } catch (e) {} }
  }
  function onStatus(cb) { statusCb = cb; if (cb) { try { cb(lastStatus.kind, lastStatus.msg); } catch (e) {} } }
  function status() { return lastStatus; }
  function currentUser() { return user; }

  async function refreshUser() {
    if (!ensureClient()) return null;
    try {
      const { data } = await sb.auth.getSession();
      user = (data && data.session && data.session.user) || null;
    } catch (e) { user = null; }
    return user;
  }

  // Exactamente lo que se persiste en localStorage (mismo formato que loadState lee)
  function stateSnapshot() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
    catch (e) { return null; }
  }

  async function push() {
    if (!ensureClient() || !user) return;
    const snap = stateSnapshot();
    if (!snap) return;
    const nowISO = new Date().toISOString();
    setStatus("saving", "Guardando en la nube…");
    const { error } = await sb.from("user_states")
      .upsert({ user_id: user.id, data: snap, updated_at: nowISO });
    if (error) { setStatus("error", "Sin conexión — guardado local"); return; }
    const m = meta();
    m.lastPushAt = Date.now();
    m.lastPulledUpdatedAt = nowISO;
    m.localDirtyAt = 0;
    setMeta(m);
    setStatus("ok", "Guardado en la nube ✓");
  }

  // Llamado desde saveState() de la app tras escribir en localStorage.
  function onLocalChange() {
    if (!ensureClient() || !user) return;
    const m = meta(); m.localDirtyAt = Date.now(); setMeta(m);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1200);
  }

  async function pullRow() {
    if (!ensureClient() || !user) return null;
    try {
      const { data, error } = await sb.from("user_states")
        .select("data, updated_at").eq("user_id", user.id).maybeSingle();
      if (error) return null;
      return data; // { data, updated_at } o null
    } catch (e) { return null; }
  }

  // Reemplaza lo local por lo de la nube (guardando un backup) y recarga.
  function applyCloud(row) {
    try { localStorage.setItem(PRESYNC_KEY, localStorage.getItem(STORE_KEY) || ""); } catch (e) {}
    try { localStorage.setItem(STORE_KEY, JSON.stringify(row.data)); } catch (e) {}
    const m = meta();
    m.lastPulledUpdatedAt = row.updated_at;
    m.lastPushAt = Date.now();
    m.localDirtyAt = 0;
    setMeta(m);
    location.reload();
  }

  // Sincronización de arranque (ya había sesión): protege cambios locales sin subir.
  async function sync() {
    if (!ensureClient() || !user) return;
    const row = await pullRow();
    const m = meta();
    if (!row) { await push(); return; }                        // nube vacía → sembrar
    const localDirty = (m.localDirtyAt || 0) > (m.lastPushAt || 0);
    if (localDirty) { await push(); return; }                  // cambios locales sin subir → protegerlos
    if (row.updated_at !== m.lastPulledUpdatedAt) { applyCloud(row); return; } // otro dispositivo → bajar
    setStatus("ok", "Guardado en la nube ✓");                  // ya en sync
  }

  // Sincronización al iniciar sesión manualmente.
  async function loginSync() {
    const row = await pullRow();
    if (!row) { await push(); setStatus("ok", "Sincronizado — subimos los datos de este dispositivo"); return; }
    applyCloud(row); // nube con datos → bajar (con backup local) y recargar
  }

  async function boot() {
    if (!configured()) { setStatus("off", ""); return; }
    ensureClient();
    await refreshUser();
    if (!user) { setStatus("anon", ""); return; }
    setStatus("ok", "Conectado como " + user.email);
    await sync();
  }

  async function signIn(email, password) {
    if (!ensureClient()) throw new Error("La nube no está configurada.");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = data.user;
    await loginSync();
    return user;
  }

  async function signUp(email, password) {
    if (!ensureClient()) throw new Error("La nube no está configurada.");
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    if (data.session) { user = data.user; await loginSync(); }
    return data; // si no hay session, hace falta confirmar el mail
  }

  async function signOut() {
    if (!ensureClient()) return;
    try { await sb.auth.signOut(); } catch (e) {}
    user = null;
    setStatus("anon", "");
  }

  return {
    configured, boot, onLocalChange, onStatus, status, currentUser,
    signIn, signUp, signOut, push,
  };
})();
window.Cloud = Cloud;
