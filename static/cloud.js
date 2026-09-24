// ── Calce Cloud: login + empresas + sincronización (Supabase) ────────
// Modelo multiempresa: los datos viven por EMPRESA (company_states), y
// varios usuarios (memberships) comparten la misma empresa. Offline-first:
// el navegador (localStorage) es la copia local y la nube es el espejo.

const Cloud = (() => {
  const META_KEY = "calce.sync.meta";
  const PRESYNC_KEY = "calce.state.presync";
  const COMPANY_KEY = "calce.company.id";
  let sb = null;
  let user = null;
  let companyId = null;
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
  function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {} }

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
  function currentCompany() { return companyId; }
  function needsCompany() { return configured() && !!user && !companyId; }

  async function refreshUser() {
    if (!ensureClient()) return null;
    try {
      const { data } = await sb.auth.getSession();
      user = (data && data.session && data.session.user) || null;
    } catch (e) { user = null; }
    return user;
  }

  function stateSnapshot() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
    catch (e) { return null; }
  }

  // ── Empresas ──────────────────────────────────────────
  async function resolveCompany() {
    companyId = null;
    if (!ensureClient() || !user) return null;
    try {
      const { data, error } = await sb.from("memberships")
        .select("company_id").eq("user_id", user.id).limit(1);
      if (!error && data && data.length) {
        companyId = data[0].company_id;
        try { localStorage.setItem(COMPANY_KEY, companyId); } catch (e) {}
        return companyId;
      }
    } catch (e) {}
    try { localStorage.removeItem(COMPANY_KEY); } catch (e) {}
    return null;
  }

  async function createCompany(nombre) {
    if (!ensureClient() || !user) throw new Error("No hay sesión.");
    const { data: comp, error: e1 } = await sb.from("companies")
      .insert({ nombre: nombre }).select("id").single();
    if (e1) throw e1;
    const cid = comp.id;
    const { error: e2 } = await sb.from("memberships")
      .insert({ company_id: cid, user_id: user.id, role: "owner" });
    if (e2) throw e2;
    companyId = cid;
    try { localStorage.setItem(COMPANY_KEY, cid); } catch (e) {}
    // Sembrar el estado de la empresa con lo que haya cargado local.
    await push();
    return cid;
  }

  async function joinCompany(code) {
    if (!ensureClient() || !user) throw new Error("No hay sesión.");
    const cid = (code || "").trim();
    if (!cid) throw new Error("Ingresá un código.");
    const { error } = await sb.from("memberships")
      .insert({ company_id: cid, user_id: user.id, role: "member" });
    if (error) throw new Error("Código inválido o ya sos miembro de esa empresa.");
    companyId = cid;
    try { localStorage.setItem(COMPANY_KEY, cid); } catch (e) {}
    // Traer el estado de la empresa (con backup de lo local).
    const row = await pullRow();
    if (row) { applyCloud(row); } else { await push(); }
    return cid;
  }

  // ── Estado (por empresa) ──────────────────────────────
  async function push() {
    if (!ensureClient() || !user || !companyId) return;
    const snap = stateSnapshot();
    if (!snap) return;
    const nowISO = new Date().toISOString();
    setStatus("saving", "Guardando en la nube…");
    const { error } = await sb.from("company_states")
      .upsert({ company_id: companyId, data: snap, updated_at: nowISO });
    if (error) { setStatus("error", "Sin conexión — guardado local"); return; }
    const m = meta();
    m.lastPushAt = Date.now(); m.lastPulledUpdatedAt = nowISO; m.localDirtyAt = 0;
    setMeta(m);
    setStatus("ok", "Guardado en la nube ✓");
  }

  function onLocalChange() {
    if (!ensureClient() || !user || !companyId) return;
    const m = meta(); m.localDirtyAt = Date.now(); setMeta(m);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1200);
  }

  async function pullRow() {
    if (!ensureClient() || !user || !companyId) return null;
    try {
      const { data, error } = await sb.from("company_states")
        .select("data, updated_at").eq("company_id", companyId).maybeSingle();
      if (error) return null;
      return data;
    } catch (e) { return null; }
  }

  function applyCloud(row) {
    try { localStorage.setItem(PRESYNC_KEY, localStorage.getItem(STORE_KEY) || ""); } catch (e) {}
    try { localStorage.setItem(STORE_KEY, JSON.stringify(row.data)); } catch (e) {}
    const m = meta();
    m.lastPulledUpdatedAt = row.updated_at; m.lastPushAt = Date.now(); m.localDirtyAt = 0;
    setMeta(m);
    location.reload();
  }

  async function sync() {
    if (!ensureClient() || !user || !companyId) return;
    const row = await pullRow();
    const m = meta();
    if (!row) { await push(); return; }
    const localDirty = (m.localDirtyAt || 0) > (m.lastPushAt || 0);
    if (localDirty) { await push(); return; }
    if (row.updated_at !== m.lastPulledUpdatedAt) { applyCloud(row); return; }
    setStatus("ok", "Guardado en la nube ✓");
  }

  async function boot() {
    if (!configured()) { setStatus("off", ""); return; }
    ensureClient();
    await refreshUser();
    if (!user) { setStatus("anon", ""); return; }
    await resolveCompany();
    if (!companyId) { setStatus("nocompany", ""); return; }
    setStatus("ok", "Conectado como " + user.email);
    await sync();
  }

  async function signIn(email, password) {
    if (!ensureClient()) throw new Error("La nube no está configurada.");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = data.user;
    await resolveCompany();
    if (companyId) {
      const row = await pullRow();
      if (row) { applyCloud(row); } else { await push(); }
    }
    return user;
  }

  async function signUp(email, password) {
    if (!ensureClient()) throw new Error("La nube no está configurada.");
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    if (data.session) { user = data.user; await resolveCompany(); }
    return data; // sin session ⇒ falta confirmar el mail
  }

  async function signOut() {
    if (!ensureClient()) return;
    try { await sb.auth.signOut(); } catch (e) {}
    user = null; companyId = null;
    try { localStorage.removeItem(COMPANY_KEY); } catch (e) {}
    setStatus("anon", "");
  }

  return {
    configured, boot, onLocalChange, onStatus, status,
    currentUser, currentCompany, needsCompany,
    resolveCompany, createCompany, joinCompany,
    signIn, signUp, signOut, push,
  };
})();
window.Cloud = Cloud;
