"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const fmt = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (abs >= 1e3) return Math.round(n / 1e3) + "k";
  return Math.round(n).toString();
};
const money = (n) => "$" + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n));
const ccySymbol = (ccy) => (ccy === "USD" ? "US$" : "$");
const moneyC = (n, ccy) => ccySymbol(ccy) + " " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n));
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Estado
const state = {
  movements: [],
  investments: [], // colocaciones (plazo fijo, FCI, USD, bonos, caución)
  comprobantes: [], // facturas a cobrar (AR) y a pagar (AP)
  proveedores: [], // directorio de proveedores
  retenciones: [], // retenciones y percepciones sufridas (crédito fiscal)
  accounts: [
    { id: "efectivo", name: "Caja / Efectivo", banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 300000 },
    { id: "banco", name: "Cuenta principal", banco: "Banco de la Nación Argentina", tipo: "cc", moneda: "ARS", alias: "", opening: 500000 },
  ],
  empresa: { nombre: "", cuit: "", provincia: "" },
  prefs: { moneda: "ARS", formatoFecha: "dd/mm/aa", colchon: 200000, horizonte: 90 },
  impuestos: { iva: 21, iibb: 3 },
  result: null,
  cfAccount: "",
  cfCurrency: "ARS", // moneda activa del flujo (ARS / USD)
  cfFrom: null, // rango de fechas de la tabla (ISO) — null = default (mes)
  cfTo: null,
  cfRange: "mes", // botón rápido activo
  cfMode: "grilla", // grilla | detalle
  cfGrain: "semana", // dia | semana | mes
};

const TIPOS_CUENTA = [
  { v: "ca", label: "Caja de ahorro" },
  { v: "cc", label: "Cuenta corriente" },
  { v: "efectivo", label: "Efectivo / Caja" },
  { v: "comitente", label: "Cuenta comitente (inversión)" },
];

// Tipos de inversión / colocación
const TIPOS_INVERSION = [
  { v: "plazo_fijo", label: "Plazo fijo", tieneVenc: true, rescateDias: null },
  { v: "fci", label: "FCI (fondo común)", tieneVenc: false, rescateDias: 0 },
  { v: "dolares", label: "Dólares", tieneVenc: false, rescateDias: 0 },
  { v: "bono", label: "Bono", tieneVenc: true, rescateDias: null },
  { v: "caucion", label: "Caución", tieneVenc: true, rescateDias: null },
];
function tipoInvLabel(v) {
  const t = TIPOS_INVERSION.find((x) => x.v === v);
  return t ? t.label : v;
}
// Plazo de rescate sugerido por tipo (días hábiles aprox.). Los FCI money
// market liquidan T+0 (mismo día); otros FCI suelen T+1. Editable por el usuario.
function rescateSugerido(tipo, label) {
  const l = (label || "").toLowerCase();
  if (tipo === "fci") {
    if (l.includes("money market") || l.includes("mercado de dinero") || l.includes("plazo") === false && l.includes("liquidez")) return 0;
    if (l.includes("renta fija") || l.includes("renta") || l.includes("ahorro")) return 1;
    return 0; // por defecto money market
  }
  if (tipo === "dolares") return 0;
  return null; // plazo fijo, bono, caución: vuelven al vencimiento
}

// ── Categorías del cash flow ─────────────────────────────
// Cada categoría es de ingreso (in) o egreso (out). Se usan para agrupar
// el flujo en la grilla tipo planilla.
const CATEGORIAS = [
  // Ingresos
  { v: "ventas", label: "Ventas / Cobranzas", flujo: "in" },
  { v: "certificaciones", label: "Certificaciones de obra", flujo: "in" },
  { v: "anticipos", label: "Anticipos de clientes", flujo: "in" },
  { v: "otros_ingresos", label: "Otros ingresos", flujo: "in" },
  // Egresos
  { v: "sueldos", label: "Sueldos y jornales", flujo: "out" },
  { v: "cargas", label: "Cargas sociales", flujo: "out" },
  { v: "proveedores", label: "Proveedores", flujo: "out" },
  { v: "subcontratos", label: "Subcontratistas", flujo: "out" },
  { v: "materiales", label: "Materiales / Corralón", flujo: "out" },
  { v: "impuestos", label: "Impuestos", flujo: "out" },
  { v: "alquileres", label: "Alquileres", flujo: "out" },
  { v: "servicios", label: "Servicios", flujo: "out" },
  { v: "financiacion", label: "Financiación / Leasing", flujo: "out" },
  { v: "otros_egresos", label: "Otros egresos", flujo: "out" },
];
function catLabel(v) {
  const c = CATEGORIAS.find((x) => x.v === v);
  return c ? c.label : (v || "Sin categoría");
}
function catFlujo(v) {
  const c = CATEGORIAS.find((x) => x.v === v);
  return c ? c.flujo : null;
}

// ── Plan de cuentas (contabilidad) ───────────────────────
// Cada categoría del flujo se mapea a un rubro del Estado de Resultados.
// Los ingresos son "ventas" (o similar); los egresos se separan en costos
// operativos, gastos, impuestos y financieros.
const RUBRO_RESULTADO = {
  // Ingresos
  ventas: { rubro: "Ventas", grupo: "ingresos" },
  certificaciones: { rubro: "Ventas", grupo: "ingresos" },
  anticipos: { rubro: "Ventas", grupo: "ingresos" },
  otros_ingresos: { rubro: "Otros ingresos", grupo: "ingresos" },
  // Costos directos
  materiales: { rubro: "Costo de mercadería / materiales", grupo: "costos" },
  subcontratos: { rubro: "Subcontratos", grupo: "costos" },
  // Gastos operativos
  sueldos: { rubro: "Sueldos y jornales", grupo: "gastos" },
  cargas: { rubro: "Cargas sociales", grupo: "gastos" },
  proveedores: { rubro: "Compras y servicios de terceros", grupo: "gastos" },
  alquileres: { rubro: "Alquileres", grupo: "gastos" },
  servicios: { rubro: "Servicios", grupo: "gastos" },
  otros_egresos: { rubro: "Otros gastos", grupo: "gastos" },
  // Impuestos
  impuestos: { rubro: "Impuestos", grupo: "impuestos" },
  // Financieros
  financiacion: { rubro: "Gastos financieros", grupo: "financieros" },
};
const GRUPOS_RESULTADO = [
  { g: "ingresos", label: "Ingresos", signo: 1 },
  { g: "costos", label: "Costos directos", signo: -1 },
  { g: "gastos", label: "Gastos operativos", signo: -1 },
  { g: "impuestos", label: "Impuestos", signo: -1 },
  { g: "financieros", label: "Resultados financieros", signo: -1 },
];
function rubroDe(cat) {
  return RUBRO_RESULTADO[cat] || { rubro: "Otros", grupo: "gastos" };
}

// Clasificador automático por palabras clave en el concepto
function clasificarCategoria(label, amount) {
  const t = (label || "").toLowerCase();
  const kw = (arr) => arr.some((w) => t.includes(w));
  if (kw(["certific", "avance de obra"])) return "certificaciones";
  if (kw(["anticipo"])) return "anticipos";
  if (kw(["cobr", "venta", "factura", "cliente"])) return "ventas";
  if (kw(["sueldo", "jornal", "salario", "haberes", "uocra", "quincena"])) return "sueldos";
  if (kw(["carga social", "aporte", "sindic", "obra social", "art"])) return "cargas";
  if (kw(["subcontrat", "cuadrilla"])) return "subcontratos";
  if (kw(["corralón", "corralon", "material", "hierro", "cemento", "acopio", "árido", "arido", "hormig"])) return "materiales";
  if (kw(["iva", "iibb", "ingresos brutos", "ganancias", "afip", "arca", "impuesto", "monotributo", "tasa"])) return "impuestos";
  if (kw(["alquiler", "renta"])) return "alquileres";
  if (kw(["luz", "gas", "agua", "internet", "telefon", "electric", "servicio", "combustible", "nafta", "gasoil"])) return "servicios";
  if (kw(["leasing", "cuota", "préstamo", "prestamo", "adelanto", "interés", "interes", "descuento cheque"])) return "financiacion";
  if (kw(["proveedor", "pago a"])) return "proveedores";
  // Fallback según signo
  return amount >= 0 ? "otros_ingresos" : "otros_egresos";
}
// Devuelve la categoría de un movimiento (la guardada, o la clasificada al vuelo)
function movCategoria(m) {
  if (m.categoria) return m.categoria;
  if (m.movTipo === "inversion" || m.movTipo === "rescate") return null; // no cuentan como ingreso/egreso operativo
  return clasificarCategoria(m.label, m.amount);
}

// ── Comprobantes: cobranzas (AR) y pagos (AP) ────────────
function compId() { return "cmp" + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

// Días de atraso respecto de hoy (positivo = vencido hace N días)
function diasAtraso(comp) {
  const venc = new Date(comp.vencimiento + "T00:00:00");
  const hoy = new Date(new Date().toISOString().slice(0,10) + "T00:00:00");
  return Math.round((hoy - venc) / 86400000);
}
// Estado efectivo: saldado / vencido / por-vencer / pendiente
function estadoComp(comp) {
  if (comp.estado === "saldado") return "saldado";
  const d = diasAtraso(comp);
  if (d > 0) return "vencido";
  if (d >= -7) return "por_vencer";
  return "pendiente";
}
// Buckets de aging (antigüedad de la deuda vencida)
function agingBucket(dias) {
  if (dias <= 0) return "corriente";
  if (dias <= 30) return "1-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  return "90+";
}
const AGING_LABELS = { corriente: "Por vencer", "1-30": "1-30 días", "31-60": "31-60 días", "61-90": "61-90 días", "90+": "+90 días" };

// DSO simplificado: (cuentas por cobrar pendientes / ventas del período) × días
function calcularDSO(tipo, dias = 90) {
  const pend = state.comprobantes.filter(c => c.tipo === tipo && c.estado !== "saldado");
  const totalPend = pend.reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(desde.getDate()-dias);
  // Ventas/compras del período (emitidas en la ventana)
  const emitidos = state.comprobantes.filter(c => c.tipo === tipo &&
    new Date(c.emision+"T00:00:00") >= desde);
  const totalEmitido = emitidos.reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
  if (totalEmitido <= 0) return null;
  return Math.round((totalPend / totalEmitido) * dias);
}

// ── Persistencia (autoguardado en el navegador) ──────────
const STORE_KEY = "calce.state.v1";
let _saveTimer = null;
function saveState() {
  // Debounce para no escribir en cada tecla
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const snapshot = {
        movements: state.movements,
        investments: state.investments,
        comprobantes: state.comprobantes,
        proveedores: state.proveedores,
        impMontos: state.impMontos,
        retenciones: state.retenciones,
        accounts: state.accounts,
        empresa: state.empresa,
        prefs: state.prefs,
        impuestos: state.impuestos,
        _acctSeq,
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
      flashSaved();
    } catch (e) { console.warn("No se pudo guardar:", e); }
  }, 400);
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (s.movements) state.movements = s.movements;
    if (s.investments) state.investments = s.investments;
    if (s.comprobantes) state.comprobantes = s.comprobantes;
    if (s.proveedores) state.proveedores = s.proveedores;
    if (s.impMontos) state.impMontos = s.impMontos;
    if (s.retenciones) state.retenciones = s.retenciones;
    if (s.accounts) state.accounts = s.accounts;
    if (s.empresa) state.empresa = s.empresa;
    if (s.prefs) state.prefs = s.prefs;
    if (s.impuestos) state.impuestos = s.impuestos;
    if (s._acctSeq) _acctSeq = s._acctSeq;
    return true;
  } catch (e) { console.warn("No se pudo cargar:", e); return false; }
}
function clearState() {
  localStorage.removeItem(STORE_KEY);
}
function flashSaved() {
  const el = $("#save-indicator");
  if (!el) return;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1200);
}

let _acctSeq = 1;
function newAccountId() { return "acc" + (_acctSeq++) + "-" + Date.now().toString(36); }

// ── Movimientos (guardados en state.movements, no en el DOM) ──
function openMovModal(editIndex = null) {
  state.editingMov = editIndex;
  const isEdit = editIndex !== null;
  $("#mov-modal-title").textContent = isEdit ? "Editar movimiento" : "Nuevo movimiento";
  $("#mov-modal-save").textContent = isEdit ? "Guardar" : "Agregar";

  const m = isEdit ? state.movements[editIndex] : null;
  $("#m-label").value = m ? m.label : "";
  $("#m-value").value = m ? Math.abs(m.amount) : "";
  $("#m-sign").value = m ? (m.amount < 0 ? "-1" : "1") : "1";
  $("#m-date").value = m ? m.date : new Date().toISOString().slice(0, 10);
  $("#m-rec").value = m ? m.recurrence : "none";
  $("#m-medio").value = m ? (m.medio || "transferencia") : "transferencia";
  syncAccountSelectors();
  $("#m-account").value = m && m.account ? m.account : (state.accounts[0]?.id || "");

  // Campo de acreditación de tarjeta: visible solo si el medio es tarjeta
  const syncTarjeta = () => {
    const esTarjeta = $("#m-medio").value === "tarjeta";
    $("#m-tarjeta-field").style.display = esTarjeta ? "" : "none";
  };
  $("#m-medio").onchange = syncTarjeta;
  syncTarjeta();
  // Al editar un cobro con tarjeta, restaurar el plazo guardado
  if (m && m.medio === "tarjeta" && m.tarjetaPlazo != null) {
    $("#m-tarjeta-plazo").value = String(m.tarjetaPlazo);
  } else {
    $("#m-tarjeta-plazo").value = "2";
  }
  // Cuando cambia el plazo de tarjeta, ajustar la fecha estimada
  $("#m-tarjeta-plazo").onchange = () => {
    const v = $("#m-tarjeta-plazo").value;
    if (v !== "custom") {
      const d = new Date(); d.setDate(d.getDate() + parseInt(v));
      $("#m-date").value = d.toISOString().slice(0,10);
    }
  };

  // Modo: si el movimiento es cheque, abrir en modo cheque
  const mode = m && m.medio === "cheque" && m.venc ? "cheque" : "simple";
  setMovMode(mode);
  if (mode === "cheque") {
    $("#m-emision").value = m.emision || new Date().toISOString().slice(0, 10);
    $("#m-venc").value = m.venc || m.date;
  } else {
    $("#m-emision").value = new Date().toISOString().slice(0, 10);
    $("#m-venc").value = "";
  }
  // Cuotas siempre arranca limpio (2 cuotas base)
  state._cuotas = [{ date: new Date().toISOString().slice(0, 10), amount: "" }, { date: "", amount: "" }];
  renderCuotas();
  // Actualizar símbolo de moneda según la cuenta elegida
  updateModalCurrency();

  // Botón eliminar: solo al editar
  let delBtn = $("#mov-modal-del");
  if (isEdit) {
    if (!delBtn) {
      delBtn = document.createElement("button");
      delBtn.id = "mov-modal-del";
      delBtn.className = "btn-ghost danger";
      delBtn.textContent = "Eliminar";
      $(".modal-foot").insertBefore(delBtn, $(".modal-foot").firstChild);
    }
    delBtn.style.display = "";
    delBtn.onclick = () => {
      state.movements.splice(editIndex, 1);
      closeMovModal();
      project();
    };
  } else if (delBtn) {
    delBtn.style.display = "none";
  }

  $("#mov-modal").classList.remove("hidden");
  setTimeout(() => $("#m-label").focus(), 50);
}

// Modo del modal: simple / cheque / cuotas
function setMovMode(mode) {
  state._movMode = mode;
  $$(".mov-mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("#m-simple-row").style.display = mode === "simple" ? "" : "none";
  $("#m-cheque-block").style.display = mode === "cheque" ? "" : "none";
  $("#m-cuotas-block").style.display = mode === "cuotas" ? "" : "none";
  // En cuotas, el monto total es informativo (se calcula de las cuotas)
  $("#m-value-label").textContent = mode === "cuotas" ? "Monto total (se reparte)" : "Monto";
  // En cheque, forzar medio=cheque
  if (mode === "cheque") $("#m-medio").value = "cheque";
}

function updateModalCurrency() {
  const acc = state.accounts.find((a) => a.id === $("#m-account").value);
  $("#m-cur").textContent = acc && acc.moneda === "USD" ? "US$" : "$";
}

function renderCuotas() {
  const list = $("#m-cuotas-list");
  if (!list) return;
  const cuotas = state._cuotas || [];
  list.innerHTML = cuotas.map((c, i) => `
    <div class="cuota-row" data-i="${i}">
      <input type="date" class="cuota-date" value="${c.date}">
      <div class="money-input sm"><em>${$("#m-cur").textContent}</em><input type="number" class="cuota-amount" value="${c.amount}" placeholder="0" step="1000"></div>
      <button type="button" class="cuota-del" title="Quitar">×</button>
    </div>`).join("");
  list.querySelectorAll(".cuota-row").forEach((row) => {
    const i = parseInt(row.dataset.i, 10);
    row.querySelector(".cuota-date").oninput = (e) => { state._cuotas[i].date = e.target.value; };
    row.querySelector(".cuota-amount").oninput = (e) => { state._cuotas[i].amount = e.target.value; updateCuotasTotal(); };
    row.querySelector(".cuota-del").onclick = () => {
      if (state._cuotas.length <= 1) return;
      state._cuotas.splice(i, 1); renderCuotas();
    };
  });
  updateCuotasTotal();
}

function updateCuotasTotal() {
  const total = (state._cuotas || []).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const el = $("#m-cuotas-total");
  if (el) el.textContent = total > 0 ? `Total en cuotas: ${$("#m-cur").textContent} ${new Intl.NumberFormat("es-AR").format(total)}` : "";
}

function closeMovModal() {
  state.editingMov = null;
  $("#mov-modal").classList.add("hidden");
}

function saveMovFromModal() {
  const label = $("#m-label").value.trim();
  const sign = parseInt($("#m-sign").value, 10);
  const medio = $("#m-medio").value;
  const account = $("#m-account").value || (state.accounts[0]?.id || "");
  const mode = state._movMode || "simple";

  if (!label) { alert("Completá el concepto."); return; }

  if (mode === "cuotas") {
    const cuotas = (state._cuotas || []).filter((c) => c.date && parseFloat(c.amount));
    if (!cuotas.length) { alert("Cargá al menos una cuota con fecha y monto."); return; }
    // Al editar en modo cuotas, reemplazamos el movimiento original y agregamos el resto
    if (isEditingMov()) state.movements.splice(state.editingMov, 1);
    cuotas.forEach((c, idx) => {
      state.movements.push({
        label: `${label} (cuota ${idx + 1}/${cuotas.length})`,
        amount: Math.abs(parseFloat(c.amount)) * sign,
        date: c.date, recurrence: "none", medio, account,
      });
    });
    closeMovModal(); project(); return;
  }

  if (mode === "cheque") {
    const venc = $("#m-venc").value;
    const emision = $("#m-emision").value;
    const value = parseFloat($("#m-value").value);
    if (!value || !venc) { alert("Completá el monto y la fecha de vencimiento."); return; }
    const mov = {
      label, amount: Math.abs(value) * sign,
      date: venc,           // impacta la caja al vencimiento
      recurrence: "none", medio: "cheque", account,
      emision, venc,
    };
    if (isEditingMov()) state.movements[state.editingMov] = mov;
    else state.movements.push(mov);
    closeMovModal(); project(); return;
  }

  // Simple
  const value = parseFloat($("#m-value").value);
  if (!value) { alert("Completá el monto."); return; }
  const mov = {
    label, amount: Math.abs(value) * sign,
    date: $("#m-date").value,
    recurrence: $("#m-rec").value,
    medio, account,
  };
  // Cobro con tarjeta: guardar el plazo y marcarlo como estimado (a confirmar)
  if (medio === "tarjeta") {
    const plazo = $("#m-tarjeta-plazo").value;
    mov.tarjetaPlazo = plazo === "custom" ? null : parseInt(plazo);
    // Al crear (no editar), o si venía estimado, queda estimado
    const prev = isEditingMov() ? state.movements[state.editingMov] : null;
    mov.tarjetaEstado = (prev && prev.tarjetaEstado === "acreditado") ? "acreditado" : "estimado";
  }
  if (isEditingMov()) state.movements[state.editingMov] = mov;
  else state.movements.push(mov);
  closeMovModal(); project();
}

function isEditingMov() {
  return state.editingMov !== null && state.editingMov !== undefined;
}

function addMovement(data = {}) {
  // Alta programática (demo, import): agrega a state.movements
  if (!data.label && data.value == null) return;
  state.movements.push({
    label: data.label || "",
    amount: data.value != null ? data.value : (data.amount || 0),
    date: data.date || new Date().toISOString().slice(0, 10),
    recurrence: data.recurrence || "none",
    medio: data.medio || "transferencia",
    account: data.account || (state.accounts[0]?.id || ""),
  });
}

function readMovements() {
  return state.movements.filter((m) => m.amount !== 0 && m.date);
}

// Carga un dataset de demo completo (cuentas, empresa, prefs, movimientos)
function loadDemoDataset(ds) {
  if (ds.empresa) state.empresa = { ...state.empresa, ...ds.empresa };
  if (ds.prefs) state.prefs = { ...state.prefs, ...ds.prefs };
  if (ds.impuestos) state.impuestos = { ...state.impuestos, ...ds.impuestos };
  if (ds.accounts) state.accounts = ds.accounts.map((a) => ({ ...a }));
  // Aplicar prefs al panel
  if ($("#buffer")) $("#buffer").value = state.prefs.colchon;
  if ($("#horizon")) $("#horizon").value = state.prefs.horizonte;
  // Movimientos: traducir fechas relativas "d+N" o "d-N" a ISO
  state.movements = [];
  (ds.movements || []).forEach((m) => {
    let date = m.date;
    const rel = /^d([+-]\d+)$/.exec(m.date || "");
    if (rel) date = addDays(parseInt(rel[1], 10));
    state.movements.push({
      label: m.label, amount: m.amount, date,
      recurrence: m.recurrence || "none",
      medio: m.medio || "transferencia",
      account: m.account || (state.accounts[0]?.id || ""),
    });
  });

  // Inversiones del demo: traducir fechas y generar los movimientos de calce
  state.investments = [];
  const relDate = (v) => {
    const rel = /^d([+-]\d+)$/.exec(v || "");
    return rel ? addDays(parseInt(rel[1], 10)) : v;
  };
  (ds.investments || []).forEach((raw) => {
    const inv = {
      id: invId(), tipo: raw.tipo, label: raw.label, monto: raw.monto,
      sociedad: raw.sociedad || "",
      moneda: (state.accounts.find(a => a.id === raw.account)?.moneda) || "ARS",
      account: raw.account,
      fechaColocacion: relDate(raw.fechaColocacion),
      fechaVenc: raw.fechaVenc ? relDate(raw.fechaVenc) : null,
      rendimiento: raw.rendimiento || 0, estado: raw.estado || "activa",
    };
    state.investments.push(inv);
    // Egreso hoy (colocación) — no es gasto
    state.movements.push({
      label: `Colocación: ${inv.label}`, amount: -Math.abs(inv.monto),
      date: inv.fechaColocacion, recurrence: "none",
      medio: "transferencia", account: inv.account,
      invId: inv.id, movTipo: "inversion",
    });
    // Ingreso al vencimiento (rescate) si tiene fecha
    if (inv.fechaVenc) {
      state.movements.push({
        label: `Vencimiento: ${inv.label}`, amount: Math.abs(estimarRetorno(inv)),
        date: inv.fechaVenc, recurrence: "none",
        medio: "transferencia", account: inv.account,
        invId: inv.id, movTipo: "rescate",
      });
    }
  });

  // Comprobantes del demo: traducir fechas y generar sus movimientos
  state.comprobantes = [];
  (ds.comprobantes || []).forEach((raw) => {
    const comp = {
      id: compId(), tipo: raw.tipo, contraparte: raw.contraparte,
      numero: raw.numero || "", monto: raw.monto,
      moneda: (state.accounts.find(a => a.id === raw.account)?.moneda) || "ARS",
      account: raw.account,
      emision: relDate(raw.emision), vencimiento: relDate(raw.vencimiento),
      categoria: raw.categoria, estado: raw.estado || "pendiente",
      fechaSaldado: raw.fechaSaldado ? relDate(raw.fechaSaldado) : null,
    };
    state.comprobantes.push(comp);
    generarMovComprobante(comp);
  });

  // Proveedores del demo (directorio)
  state.proveedores = (ds.proveedores || []).map((p) => ({ ...p, id: "prov" + Math.random().toString(36).slice(2,8) }));
}

// ── Cuentas ──────────────────────────────────────────────
function totalOpening() {
  return state.accounts.reduce((s, a) => s + (parseFloat(a.opening) || 0), 0);
}

function renderAccounts() {
  const list = $("#accounts-list");
  if (!list) return;
  const today = new Date(); today.setHours(23,59,59,999);
  // Saldo a la fecha de hoy por cuenta (opening + movimientos hasta hoy)
  const balToday = (a) => {
    let bal = parseFloat(a.opening) || 0;
    state.movements.forEach((m) => {
      if (m.account !== a.id || !m.amount || !m.date) return;
      const base = new Date(m.date + "T00:00:00");
      if (m.recurrence === "none") {
        if (base <= today) bal += m.amount;
      } else {
        let d = new Date(base), guard = 0;
        while (d <= today && guard < 2000) {
          bal += m.amount;
          if (m.recurrence === "weekly") d.setDate(d.getDate() + 7);
          else if (m.recurrence === "quincenal") d.setDate(d.getDate() + 14);
          else if (m.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
          else if (m.recurrence === "quarterly") d.setMonth(d.getMonth() + 3);
          else break;
          guard++;
        }
      }
    });
    return bal;
  };
  list.innerHTML = state.accounts.map((a) => `
    <div class="account-row ro" data-id="${a.id}">
      <div class="acc-info">
        <b>${h(a.name)}</b>
        <small>${a.tipo === "efectivo" ? "Efectivo" : (h(bancoShort(a.banco)) + " · " + tipoLabel(a.tipo))}${a.moneda === "USD" ? " · USD" : ""}</small>
      </div>
      <div class="acc-bal-today">${moneyC(balToday(a), a.moneda)}</div>
    </div>`).join("");
  renderAccountsTotal();
}

function bancoShort(banco) {
  if (!banco) return "Sin banco";
  const m = banco.match(/\(([^)]+)\)/);
  if (m) return m[1];
  return banco.replace(/^Banco (de la |de |del )?/, "").split(" ").slice(0, 2).join(" ");
}

// ── Optimizar liquidez ociosa ────────────────────────────
// Muestra la plata parada en cada cuenta bancaria (no efectivo) y ofrece
// colocarla en un FCI money market del mismo banco (rescatable al otro día).
// Suma los pagos (egresos) de una cuenta en los próximos N días, y los lista
function pagosProximos(accId, dias = 30) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fin = new Date(hoy); fin.setDate(fin.getDate() + dias);
  const items = [];
  state.movements.forEach((m) => {
    if (m.account !== accId || !m.amount || m.amount >= 0 || !m.date) return;
    // Expandir recurrencia dentro de la ventana
    const base = new Date(m.date + "T00:00:00");
    const push = (d) => {
      if (d >= hoy && d <= fin) items.push({ label: m.label, monto: Math.abs(m.amount), date: d.toISOString().slice(0,10) });
    };
    if (m.recurrence === "none" || !m.recurrence) push(base);
    else {
      let d = new Date(base), g = 0;
      while (d <= fin && g < 400) {
        push(d);
        if (m.recurrence==="weekly") d.setDate(d.getDate()+7);
        else if (m.recurrence==="quincenal") d.setDate(d.getDate()+14);
        else if (m.recurrence==="monthly") d.setMonth(d.getMonth()+1);
        else if (m.recurrence==="quarterly") d.setMonth(d.getMonth()+3);
        else break;
        g++;
      }
    }
  });
  return items.sort((a,b) => new Date(a.date) - new Date(b.date));
}

// Pagos de HOY de una cuenta (lo único que no podés colocar en money market,
// porque el money market lo rescatás recién mañana T+1).
function pagosDeHoy(accId) {
  const hoy = new Date().toISOString().slice(0,10);
  return pagosProximos(accId, 1).filter(p => p.date === hoy).reduce((s,p) => s + p.monto, 0);
}

// Días hasta el próximo pago "grande" (que consume >40% del saldo colocable).
// Es cuánto tiempo tenés esa plata libre → define si conviene un plazo más largo.
function diasLibres(accId, colocable) {
  const pagos = pagosProximos(accId, 120);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let acum = 0;
  for (const p of pagos) {
    acum += p.monto;
    // Cuando los pagos acumulados superan ~40% de lo colocable, ese es el
    // horizonte en que vas a necesitar la plata de vuelta.
    if (acum > colocable * 0.4) {
      const d = Math.round((new Date(p.date+"T00:00:00") - hoy) / 86400000);
      return Math.max(1, d);
    }
  }
  return 120; // no hay pagos grandes en el horizonte
}

// Sugiere el instrumento según cuántos días tenés la plata libre.
function sugerirInstrumento(dias) {
  if (dias <= 2) return { inst: "Money market", nota: "Rescate al otro día (T+1). Ideal para plata que podés necesitar ya.", tipo: "fci" };
  if (dias <= 7) return { inst: "Money market o caución corta", nota: `Tenés ~${dias} días libres. La caución a pocos días puede rendir algo más si la tasa conviene.`, tipo: "fci" };
  if (dias <= 35) return { inst: "Plazo fijo, caución o money market", nota: `Tenés ~${dias} días libres. Un plazo fijo (30d) o caución suele rendir más que el money market si no vas a tocar la plata.`, tipo: "plazo_fijo" };
  return { inst: "Plazo fijo / bono corto", nota: `Tenés ~${dias} días libres. Con ese horizonte conviene un plazo fijo o un instrumento a plazo que rinda más.`, tipo: "plazo_fijo" };
}

function renderOptimizar() {
  const card = $("#optimizar-card");
  if (!card) return;
  // Cuentas bancarias ARS (excluye efectivo y comitente).
  // COLOCABLE = saldo − pagos de HOY. El money market se rescata mañana,
  // así que casi todo el excedente puede colocarse aunque pagues en unos días.
  const cuentas = state.accounts
    .filter(a => a.moneda === "ARS" && a.tipo !== "efectivo" && a.tipo !== "comitente")
    .map(a => {
      const saldo = saldoCuentaAFecha(a);
      const pagoHoy = pagosDeHoy(a.id);
      const colocable = Math.max(0, saldo - pagoHoy);
      const dias = diasLibres(a.id, colocable);
      const sug = sugerirInstrumento(dias);
      const pagos = pagosProximos(a.id, 30);
      return { acc: a, saldo, pagoHoy, colocable, dias, sug, pagos };
    })
    .filter(x => x.saldo > 0);

  const totalColocable = cuentas.reduce((s,x) => s + x.colocable, 0);

  if (!cuentas.length) {
    card.innerHTML = `<div class="ctrl-head"><h2>Optimizar liquidez</h2></div>
      <p class="mov-hint-panel">No hay liquidez ociosa para colocar ahora.</p>`;
    return;
  }

  card.innerHTML = `
    <div class="ctrl-head"><h2>Optimizar liquidez</h2></div>
    <p class="opt-intro">Podés colocar hoy <b>${moneyC(totalColocable,"ARS")}</b> y generar renta. Un money market se rescata al otro día; si tenés la plata libre más tiempo, te conviene un plazo que rinda más.</p>
    <div class="opt-list">
      ${cuentas.map(x => `
        <div class="opt-card2">
          <div class="opt-card2-head">
            <div class="opt-row-info">
              <b>${h(x.acc.name)}</b>
              <small>${h(bancoShort(x.acc.banco))}</small>
            </div>
            <button class="opt-colocar-btn" data-acc="${x.acc.id}" data-tipo="${x.sug.tipo}" ${x.colocable<=0?"disabled":""}>Colocar</button>
          </div>
          <div class="opt-calc">
            <div class="opt-calc-row"><span>Saldo hoy</span><b>${moneyC(x.saldo,"ARS")}</b></div>
            ${x.pagoHoy ? `<div class="opt-calc-row out"><span>− Pagos de hoy</span><b>−${moneyC(x.pagoHoy,"ARS")}</b></div>` : ""}
            <div class="opt-calc-row total"><span>= Colocable hoy</span><b>${moneyC(x.colocable,"ARS")}</b></div>
          </div>
          <div class="opt-sugerencia">
            <div class="opt-sug-head"><span class="opt-sug-inst">${x.sug.inst}</span><span class="opt-sug-dias">${x.dias>=120?"sin pagos grandes a la vista":`~${x.dias} días libres`}</span></div>
            <p>${x.sug.nota}</p>
          </div>
          ${x.pagos.length ? `<details class="opt-pagos"><summary>Ver ${x.pagos.length} pago${x.pagos.length>1?"s":""} de los próximos 30 días</summary>
            ${x.pagos.slice(0,8).map(p => `<div class="opt-pago-item"><span>${fmtDateShort(p.date)} · ${h(p.label)}</span><b>${moneyC(p.monto,"ARS")}</b></div>`).join("")}
            ${x.pagos.length>8?`<div class="opt-pago-more">+${x.pagos.length-8} más</div>`:""}
          </details>` : ""}
        </div>`).join("")}
    </div>`;

  $$(".opt-colocar-btn").forEach(b => { if (!b.disabled) b.onclick = () => colocarEnFCI(b.dataset.acc, b.dataset.tipo); });
}

// Abre el modal de inversión pre-cargado. tipoSug: instrumento sugerido según el plazo.
function colocarEnFCI(accId, tipoSug) {
  const acc = state.accounts.find(a => a.id === accId);
  if (!acc) return;
  const saldo = saldoCuentaAFecha(acc);
  const colocable = Math.max(0, saldo - pagosDeHoy(acc.id));
  const tipo = tipoSug === "plazo_fijo" ? "plazo_fijo" : "fci";
  openInvModal();
  $("#i-tipo").value = tipo;
  updateInvTipo();
  $("#i-account").value = accId;
  updateInvTipo();
  $("#i-monto").value = Math.max(0, Math.round(colocable));
  if (tipo === "fci") {
    $("#i-label").value = "FCI money market";
    $("#i-sociedad").value = sugerirSociedadFCI(acc.banco);
    $("#i-rend").value = 40;
  } else {
    $("#i-label").value = "Plazo fijo";
    $("#i-rend").value = 42;
  }
  updateInvPreview();
}

// Sugiere la sociedad gerente de FCI según el banco
function sugerirSociedadFCI(banco) {
  const b = (banco || "").toLowerCase();
  if (b.includes("galicia")) return "Galicia Administradora de Fondos";
  if (b.includes("nación") || b.includes("nacion")) return "Pellegrini (Banco Nación)";
  if (b.includes("provincia")) return "Provinfondos (Banco Provincia)";
  if (b.includes("santander")) return "Santander Asset Management";
  if (b.includes("bbva")) return "BBVA Asset Management";
  if (b.includes("macro")) return "Macro Fondos";
  if (b.includes("credicoop")) return "Credicoop (IMSA)";
  return "FCI money market";
}

function tipoLabel(tipo) {
  const t = TIPOS_CUENTA.find((x) => x.v === tipo);
  return t ? t.label : tipo;
}

function renderAccountsTotal() {
  const el = $("#accounts-total");
  if (!el) return;
  // Total del saldo a hoy, por moneda
  const today = new Date(); today.setHours(23,59,59,999);
  const balToday = (a) => {
    let bal = parseFloat(a.opening) || 0;
    state.movements.forEach((m) => {
      if (m.account !== a.id || !m.amount || !m.date) return;
      const base = new Date(m.date + "T00:00:00");
      if (m.recurrence === "none") { if (base <= today) bal += m.amount; }
      else {
        let d = new Date(base), guard = 0;
        while (d <= today && guard < 2000) {
          bal += m.amount;
          if (m.recurrence === "weekly") d.setDate(d.getDate() + 7);
          else if (m.recurrence === "quincenal") d.setDate(d.getDate() + 14);
          else if (m.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
          else if (m.recurrence === "quarterly") d.setMonth(d.getMonth() + 3);
          else break;
          guard++;
        }
      }
    });
    return bal;
  };
  const totARS = state.accounts.filter(a=>a.moneda==="ARS").reduce((s,a)=>s+balToday(a),0);
  const totUSD = state.accounts.filter(a=>a.moneda==="USD").reduce((s,a)=>s+balToday(a),0);
  let html = `<span>Saldo hoy</span><b>${moneyC(totARS, "ARS")}</b>`;
  if (state.accounts.some(a=>a.moneda==="USD")) html += `<span class="tot-usd">${moneyC(totUSD, "USD")}</span>`;
  el.innerHTML = html;
}

function addAccount() {
  state.accounts.push({ id: newAccountId(), name: "Nueva cuenta", opening: 0 });
  renderAccounts(); syncAccountSelectors(); project();
}

// Mantiene sincronizados los <select> de cuenta (modal + filtro tabla)
function syncAccountSelectors() {
  const opts = state.accounts.map((a) => {
    const suffix = a.tipo === "efectivo" ? "" : ` (${bancoShort(a.banco)})`;
    return `<option value="${a.id}">${h(a.name)}${h(suffix)}</option>`;
  }).join("");
  const mSel = $("#m-account");
  if (mSel) { const cur = mSel.value; mSel.innerHTML = opts; if (state.accounts.find(a=>a.id===cur)) mSel.value = cur; }
  const fSel = $("#cf-account-filter");
  if (fSel) {
    const cur = fSel.value;
    fSel.innerHTML = `<option value="">Todas las cuentas (consolidado)</option>` + opts;
    fSel.value = state.accounts.find(a=>a.id===cur) ? cur : "";
  }
}

function accountName(id) {
  const a = state.accounts.find((x) => x.id === id);
  return a ? a.name : "—";
}

// Resuelve el texto de cuenta del import contra las cuentas existentes.
// Match por nombre, banco corto o alias (case-insensitive). Si no hay match
// y el texto no está vacío, crea una cuenta nueva con ese nombre.
function resolveAccountText(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return state.accounts[0]?.id || "";
  const found = state.accounts.find((a) =>
    a.name.toLowerCase() === t ||
    bancoShort(a.banco).toLowerCase() === t ||
    (a.alias && a.alias.toLowerCase() === t) ||
    a.name.toLowerCase().includes(t) || t.includes(a.name.toLowerCase())
  );
  if (found) return found.id;
  // Crear cuenta nueva
  const id = newAccountId();
  state.accounts.push({ id, name: text.trim(), banco: "", tipo: "cc", moneda: "ARS", alias: "", opening: 0 });
  return id;
}

function renderMovSummary() {
  const movs = state.movements;
  const el = $("#mov-summary");
  if (!el) return;
  if (!movs.length) {
    el.innerHTML = `<p class="mov-empty">Todavía no cargaste movimientos. Tocá <b>+ Agregar</b> o <b>Importar</b> un Excel.</p>`;
    return;
  }
  // Movimientos editables (los de inversiones/comprobantes/impuestos se
  // gestionan desde su propio módulo). Guardamos el índice real.
  const editables = movs
    .map((m, idx) => ({ m, idx }))
    .filter(x => !x.m.invId && !x.m.compId && !x.m.impVto);
  const ingresos = movs.filter((m) => m.amount > 0).length;
  const egresos = movs.filter((m) => m.amount < 0).length;

  el.innerHTML = `
    <div class="mov-count">
      <div><b>${movs.length}</b><small>movimientos</small></div>
      <div><b class="in">${ingresos}</b><small>ingresos</small></div>
      <div><b class="out">${egresos}</b><small>egresos</small></div>
    </div>
    <div class="mov-manage-list">
      ${editables.slice(0, 40).map(x => {
        const esTarjetaEst = x.m.medio === "tarjeta" && x.m.tarjetaEstado === "estimado";
        return `
        <div class="mov-manage-item ${esTarjetaEst?'mmi-estimado':''}" data-idx="${x.idx}">
          <div class="mmi-info">
            <span class="mmi-label">${h(x.m.label || "(sin concepto)")}${esTarjetaEst?' <span class="mmi-tag">💳 a acreditar</span>':''}</span>
            <small>${fmtDateShort(x.m.date)}${x.m.recurrence && x.m.recurrence!=="none" ? " · repite" : ""} · ${h(accountName(x.m.account))}</small>
          </div>
          <span class="mmi-monto ${x.m.amount>0?'in':'out'}">${x.m.amount>0?'+':'−'}${moneyC(Math.abs(x.m.amount), movCurrency(x.m))}</span>
          ${esTarjetaEst?`<button class="mmi-confirm" data-confirm="${x.idx}" title="Confirmar que ya se acreditó">✓</button>`:''}
          <button class="mmi-del" data-del="${x.idx}" title="Eliminar">×</button>
        </div>`;
      }).join("")}
      ${editables.length>40 ? `<p class="mov-more">+${editables.length-40} más</p>` : ""}
    </div>
    <p class="mov-hint">Tocá un movimiento para editarlo, o la × para eliminarlo. Los cobros con tarjeta ✓ los confirmás cuando se acreditan.</p>`;

  $$(".mov-manage-item").forEach(row => {
    row.onclick = (e) => {
      if (e.target.classList.contains("mmi-del") || e.target.classList.contains("mmi-confirm")) return;
      openMovModal(parseInt(row.dataset.idx, 10));
    };
  });
  $$(".mmi-confirm").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      confirmarAcreditacionTarjeta(parseInt(btn.dataset.confirm, 10));
    };
  });
  $$(".mmi-del").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.del, 10);
      const m = state.movements[idx];
      if (!m) return;
      if (!confirm(`¿Eliminar "${m.label || "este movimiento"}"?`)) return;
      state.movements.splice(idx, 1);
      project();
    };
  });
}

// Confirmar que un cobro con tarjeta ya se acreditó (ajustar fecha/monto real)
function confirmarAcreditacionTarjeta(idx) {
  const m = state.movements[idx];
  if (!m) return;
  const hoy = new Date().toISOString().slice(0,10);
  const fecha = prompt(`Confirmar acreditación de "${m.label}".\n\n¿En qué fecha se acreditó? (dejá vacío = hoy)`, m.date <= hoy ? m.date : hoy);
  if (fecha === null) return;
  const montoTxt = prompt(`¿Monto real acreditado? (lo que te depositaron, ya neto de comisiones)`, Math.abs(m.amount));
  if (montoTxt === null) return;
  const monto = parseFloat(montoTxt);
  if (!monto || monto <= 0) { alert("Ingresá un monto válido."); return; }
  m.date = fecha.trim() || hoy;
  m.amount = Math.abs(monto) * (m.amount < 0 ? -1 : 1);
  m.tarjetaEstado = "acreditado";
  project();
}

// ── Proyección ───────────────────────────────────────────
// Devuelve la moneda de un movimiento según la cuenta a la que pertenece
function movCurrency(m) {
  const a = state.accounts.find((x) => x.id === m.account);
  return a ? a.moneda : "ARS";
}
// ¿Hay al menos una cuenta en USD?
function hasUSD() { return state.accounts.some((a) => a.moneda === "USD"); }

async function project() {
  saveState();
  renderMovSummary();
  renderAccountsTotal();
  renderCurrencyTabs();

  const filterAcct = state.cfAccount; // "" = consolidado de la moneda activa
  const ccy = filterAcct
    ? (state.accounts.find((a) => a.id === filterAcct)?.moneda || "ARS")
    : state.cfCurrency;

  // Movimientos: de la cuenta filtrada, o de todas las cuentas de la moneda activa
  const movs = readMovements().filter((m) => {
    if (filterAcct) return m.account === filterAcct;
    return movCurrency(m) === ccy;
  });
  // Opening: de la cuenta filtrada, o suma de las cuentas de la moneda activa
  const opening = filterAcct
    ? (parseFloat(state.accounts.find((a) => a.id === filterAcct)?.opening) || 0)
    : state.accounts.filter((a) => a.moneda === ccy).reduce((s, a) => s + (parseFloat(a.opening) || 0), 0);

  const body = {
    opening_balance: opening,
    min_buffer: parseFloat($("#buffer").value) || 0,
    horizon_days: parseInt($("#horizon").value, 10),
    movements: movs,
  };
  try {
    const res = await fetch("/api/cashflow/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.result = await res.json();
    renderKPIs();
    renderAccountBalances();
    renderChart();
    renderCashflowTable();
    renderInsights();
    renderExcedente();
  } catch (e) {
    console.error("Error al proyectar:", e);
  }
}

// ── Selector de moneda (ARS / USD) ───────────────────────
function renderCurrencyTabs() {
  const el = $("#currency-tabs");
  if (!el) return;
  if (!hasUSD()) { el.innerHTML = ""; return; } // si no hay USD, no mostramos tabs
  const tabs = [["ARS", "Pesos"], ["USD", "Dólares"]];
  el.innerHTML = tabs.map(([c, label]) =>
    `<button class="ccy-tab ${state.cfCurrency === c ? "active" : ""}" data-ccy="${c}">${ccySymbol(c)} ${label}</button>`
  ).join("");
  $$(".ccy-tab").forEach((b) => {
    b.onclick = () => {
      state.cfCurrency = b.dataset.ccy;
      state.cfAccount = ""; // al cambiar moneda, volver a consolidado
      const fSel = $("#cf-account-filter"); if (fSel) fSel.value = "";
      project();
    };
  });
}

// ── Saldo por cuenta ─────────────────────────────────────
function renderAccountBalances() {
  const el = $("#account-balances");
  if (!el) return;
  const ccy = state.cfCurrency;

  // Solo las cuentas de la moneda activa. Muestra el SALDO DE HOY (real).
  const accts = state.accounts.filter((a) => a.moneda === ccy);
  const balances = accts.map((a) => ({ ...a, hoy: saldoCuentaAFecha(a) }));

  el.innerHTML = balances.map((a) => `
    <button class="acct-balance ${state.cfAccount === a.id ? "active" : ""}" data-acct="${a.id}">
      <small>${h(a.name)}</small>
      <b>${moneyC(a.hoy, ccy)}</b>
    </button>`).join("") +
    (balances.length > 1 ? `<button class="acct-balance total ${!state.cfAccount ? "active" : ""}" data-acct="">
      <small>Saldo hoy ${ccySymbol(ccy)}</small>
      <b>${moneyC(balances.reduce((s, a) => s + a.hoy, 0), ccy)}</b>
      <span>todas en ${ccy}</span>
    </button>` : "");

  $$(".acct-balance").forEach((btn) => {
    btn.onclick = () => {
      state.cfAccount = btn.dataset.acct;
      const fSel = $("#cf-account-filter");
      if (fSel) fSel.value = state.cfAccount;
      project();
    };
  });
}

// ── KPIs ─────────────────────────────────────────────────
function renderKPIs() {
  const ccy = state.cfAccount
    ? (state.accounts.find(a=>a.id===state.cfAccount)?.moneda || "ARS")
    : state.cfCurrency;
  const mc = (n) => moneyC(n, ccy);
  const { from, to } = cfRangeDates();
  const series = computeDaySeries(from, to);
  const todayISO = new Date().toISOString().slice(0,10);

  // Saldo hoy (de la moneda/cuenta activas)
  const accts = state.accounts.filter(a =>
    state.cfAccount ? a.id === state.cfAccount : a.moneda === ccy);
  const today = new Date(); today.setHours(23,59,59,999);
  const balToday = accts.reduce((tot, a) => {
    let bal = parseFloat(a.opening)||0;
    state.movements.forEach((m) => {
      if (m.account !== a.id || !m.amount || !m.date) return;
      const base = new Date(m.date+"T00:00:00");
      if (m.recurrence === "none") { if (base <= today) bal += m.amount; }
      else { let d=new Date(base),g=0; while(d<=today&&g<2000){bal+=m.amount;
        if(m.recurrence==="weekly")d.setDate(d.getDate()+7);
        else if(m.recurrence==="quincenal")d.setDate(d.getDate()+14);
        else if(m.recurrence==="monthly")d.setMonth(d.getMonth()+1);
        else if(m.recurrence==="quarterly")d.setMonth(d.getMonth()+3);
        else break; g++;} }
    });
    return tot + bal;
  }, 0);

  const totalIn = series.reduce((s,d)=>s+d.inflow,0);
  const totalOut = series.reduce((s,d)=>s+d.outflow,0);
  const endBal = series.length ? series[series.length-1].balance : balToday;
  const minDay = series.reduce((min,d)=> d.balance < min.balance ? d : min, series[0]||{balance:balToday,date:todayISO});
  const minClass = minDay.balance < 0 ? "neg" : "";
  const endClass = endBal >= 0 ? "pos" : "neg";
  const colocado = totalColocado(ccy);

  $("#kpi-row").innerHTML = `
    <div class="kpi hero">
      <div class="kpi-label">Líquido hoy</div>
      <div class="kpi-value">${mc(balToday)}</div>
      <div class="kpi-sub">Disponible en ${ccy} ahora</div>
    </div>
    <div class="kpi kpi-inv">
      <div class="kpi-label">Colocado (invertido)</div>
      <div class="kpi-value">${mc(colocado)}</div>
      <div class="kpi-sub">${colocado > 0 ? "No es gasto · vuelve con rendimiento" : "Sin inversiones activas"}</div>
    </div>`;
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}
// Fecha con año, para cronogramas de bonos/letras (vencen en años futuros)
function fmtDateAnio(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

// ── Chart (SVG) ──────────────────────────────────────────
function renderChart() {
  const { from, to } = cfRangeDates();
  const days = computeDaySeries(from, to);
  const buffer = 0;
  if (!days.length) return;
  const ccy = days[0]?.ccy || state.cfCurrency;

  const W = 900, H = 340, P = { t: 20, r: 20, b: 34, l: 62 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;

  const balances = days.map((d) => d.balance);
  let ymin = Math.min(0, ...balances);
  let ymax = Math.max(...balances, 0);
  const pad = (ymax - ymin) * 0.1 || 1000;
  ymin -= pad; ymax += pad;

  const X = (i) => P.l + (i / (days.length - 1)) * iw;
  const Y = (v) => P.t + ih - ((v - ymin) / (ymax - ymin)) * ih;

  const linePath = days.map((d, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(d.balance).toFixed(1)}`).join("");
  const areaPath = `${linePath}L${X(days.length - 1).toFixed(1)},${Y(ymin).toFixed(1)}L${X(0).toFixed(1)},${Y(ymin).toFixed(1)}Z`;

  // Y gridlines
  const yticks = 5;
  let grid = "";
  for (let i = 0; i <= yticks; i++) {
    const v = ymin + (i / yticks) * (ymax - ymin);
    const y = Y(v).toFixed(1);
    grid += `<line class="grid-line" x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}"/>`;
    grid += `<text class="axis-label" x="${P.l - 8}" y="${+y + 4}" text-anchor="end">${fmt(v)}</text>`;
  }

  // X labels (mostrar ~6)
  const step = Math.max(1, Math.floor(days.length / 6));
  let xlabels = "";
  for (let i = 0; i < days.length; i += step) {
    xlabels += `<text class="axis-label" x="${X(i).toFixed(1)}" y="${H - 12}" text-anchor="middle">${fmtDate(days[i].date)}</text>`;
  }

  const bufferY = Y(buffer).toFixed(1);
  const zeroY = ymin < 0 ? Y(0).toFixed(1) : null;

  $("#chart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2563EB" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#2563EB" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${grid}
      ${xlabels}
      <path class="balance-area" d="${areaPath}"/>
      <path class="balance-line" d="${linePath}"/>
      <line class="buffer-line" x1="${P.l}" y1="${bufferY}" x2="${W - P.r}" y2="${bufferY}"/>
      ${zeroY ? `<line class="zero-line" x1="${P.l}" y1="${zeroY}" x2="${W - P.r}" y2="${zeroY}"/>` : ""}
      <g id="hover-g" style="opacity:0">
        <line class="hover-line" id="hover-line" x1="0" y1="${P.t}" x2="0" y2="${P.t + ih}"/>
        <circle class="hover-dot" id="hover-dot" r="4.5"/>
      </g>
      <rect id="chart-overlay" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>
    <div class="chart-tip" id="chart-tip"></div>`;

  wireChartHover(days, X, Y, P, iw);
}

function wireChartHover(days, X, Y, P, iw) {
  const svg = $("#chart svg");
  const overlay = $("#chart-overlay");
  const g = $("#hover-g");
  const dot = $("#hover-dot");
  const line = $("#hover-line");
  const tip = $("#chart-tip");
  const chartBox = $("#chart");

  overlay.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = 900 / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    let i = Math.round(((svgX - P.l) / iw) * (days.length - 1));
    i = Math.max(0, Math.min(days.length - 1, i));
    const d = days[i];
    const cx = X(i), cy = Y(d.balance);
    g.style.opacity = "1";
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    line.setAttribute("x1", cx); line.setAttribute("x2", cx);

    tip.style.opacity = "1";
    tip.innerHTML = `
      <div class="tip-date">${fmtDate(d.date)}</div>
      <div class="tip-row"><span>Saldo</span><b>${money(d.balance)}</b></div>
      ${d.inflow ? `<div class="tip-row"><span>Entra</span><b>+${fmt(d.inflow)}</b></div>` : ""}
      ${d.outflow ? `<div class="tip-row"><span>Sale</span><b>−${fmt(d.outflow)}</b></div>` : ""}
      <div class="tip-row"><span>Colocable</span><b>${money(d.investable)}</b></div>`;
    const boxRect = chartBox.getBoundingClientRect();
    const px = (cx / 900) * boxRect.width;
    let left = px + 14;
    if (left + 170 > boxRect.width) left = px - 184;
    tip.style.left = Math.max(0, left) + "px";
    tip.style.top = ((cy / 340) * boxRect.height - 10) + "px";
  });
  overlay.addEventListener("mouseleave", () => {
    g.style.opacity = "0";
    tip.style.opacity = "0";
  });
}

// ── Tabla estilo Excel (día / semana, con detalle) ──────
function renderCashflowTable() {
  const { from, to } = cfRangeDates();
  // Grano adaptativo: períodos cortos (hoy/semana) → por día; largos → por semana.
  const r = state.cfRange || "mes";
  const usaRangoCustom = state.cfFrom && state.cfTo;
  let grain = "semana";
  if (!usaRangoCustom && (r === "hoy" || r === "semana")) grain = "dia";
  else if (usaRangoCustom) {
    // Si el rango custom es <= 10 días, mostrar por día
    const dias = Math.round((new Date(to) - new Date(from)) / 86400000);
    grain = dias <= 10 ? "dia" : "semana";
  }
  return renderGrid(from, to, grain);
}

// Genera los períodos (columnas) entre from y to según el grano
function buildPeriods(fromISO, toISO, grain) {
  const from = new Date(fromISO + "T00:00:00");
  const to = new Date(toISO + "T00:00:00");
  const periods = [];
  const dias3 = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  if (grain === "dia") {
    let d = new Date(from);
    while (d <= to) {
      const start = new Date(d);
      const end = new Date(d);
      periods.push({ start, end, label: `${dias3[start.getDay()]} ${start.getDate()}/${start.getMonth()+1}` });
      d.setDate(d.getDate() + 1);
    }
  } else if (grain === "mes") {
    let d = new Date(from.getFullYear(), from.getMonth(), 1);
    while (d <= to) {
      const start = new Date(d);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      periods.push({ start, end, label: d.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }) });
      d.setMonth(d.getMonth() + 1);
    }
  } else { // semana (lunes a domingo)
    let d = new Date(from);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // ir al lunes
    while (d <= to) {
      const start = new Date(d);
      const end = new Date(d); end.setDate(end.getDate() + 6);
      periods.push({ start, end, label: `${dias3[start.getDay()]} ${start.getDate()}/${start.getMonth()+1}` });
      d.setDate(d.getDate() + 7);
    }
  }
  return periods;
}

// ¿En qué período cae una fecha?
function periodIndex(periods, dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  for (let i = 0; i < periods.length; i++) {
    if (d >= periods[i].start && d <= periods[i].end) return i;
  }
  return -1;
}

function renderGrid(fromISO, toISO, grain) {
  const ccy = state.cfAccount
    ? (state.accounts.find(a=>a.id===state.cfAccount)?.moneda || "ARS")
    : state.cfCurrency;
  const mc = (n) => moneyC(n, ccy);
  const periods = buildPeriods(fromISO, toISO, grain);
  const acctIds = new Set(state.accounts.filter(a =>
    state.cfAccount ? a.id === state.cfAccount : a.moneda === ccy).map(a=>a.id));

  // Matriz: categoria -> [monto por período]
  const catData = {}; // {catV: {label, flujo, cells:[], total}}
  const ensureCat = (v) => {
    if (!catData[v]) {
      const c = CATEGORIAS.find(x=>x.v===v) || { label: catLabel(v), flujo: "out" };
      catData[v] = { v, label: c.label, flujo: c.flujo, cells: periods.map(()=>0), total: 0 };
    }
    return catData[v];
  };

  // Expandir movimientos (con recurrencia) dentro del rango y sumarlos a su celda
  const horizonEnd = periods.length ? periods[periods.length-1].end : new Date(toISO+"T00:00:00");
  const horizonStart = periods.length ? periods[0].start : new Date(fromISO+"T00:00:00");
  let invCells = periods.map(()=>0); // fila de "movimientos de inversión" (informativa)
  state.movements.forEach((m) => {
    if (!m.amount || !m.date || !acctIds.has(m.account)) return;
    const expand = [];
    const base = new Date(m.date+"T00:00:00");
    if (m.recurrence === "none") { expand.push(base); }
    else {
      let d = new Date(base), g=0;
      while (d <= horizonEnd && g<3000) {
        expand.push(new Date(d));
        if (m.recurrence==="weekly") d.setDate(d.getDate()+7);
        else if (m.recurrence==="quincenal") d.setDate(d.getDate()+14);
        else if (m.recurrence==="monthly") d.setMonth(d.getMonth()+1);
        else if (m.recurrence==="quarterly") d.setMonth(d.getMonth()+3);
        else break; g++;
      }
    }
    expand.forEach((d) => {
      if (d < horizonStart || d > horizonEnd) return;
      const pi = periodIndex(periods, d.toISOString().slice(0,10));
      if (pi < 0) return;
      // Inversiones: fila aparte
      if (m.movTipo === "inversion" || m.movTipo === "rescate") {
        invCells[pi] += m.amount;
        return;
      }
      const cat = movCategoria(m);
      const row = ensureCat(cat);
      row.cells[pi] += m.amount;
      row.total += m.amount;
    });
  });

  // Separar ingresos y egresos
  const cats = Object.values(catData);
  const ingresos = cats.filter(c => c.flujo === "in" && c.cells.some(v=>v!==0));
  const egresos = cats.filter(c => c.flujo === "out" && c.cells.some(v=>v!==0));

  // Totales por período
  const totIn = periods.map((_,i)=> ingresos.reduce((s,c)=>s+Math.max(0,c.cells[i]),0) + ingresos.reduce((s,c)=>s+Math.min(0,c.cells[i]),0));
  const totInPos = periods.map((_,i)=> ingresos.reduce((s,c)=>s+c.cells[i],0));
  const totOut = periods.map((_,i)=> egresos.reduce((s,c)=>s+c.cells[i],0));
  const neto = periods.map((_,i)=> totInPos[i] + totOut[i]);

  // Saldo running: arranca del saldo al inicio del rango
  const openingSeed = computeDaySeries(
    new Date(horizonStart.getTime()-86400000).toISOString().slice(0,10),
    new Date(horizonStart.getTime()-86400000).toISOString().slice(0,10)
  );
  let saldoIni = openingSeed.length ? openingSeed[0].balance : 0;
  const saldos = [];
  let run = saldoIni;
  periods.forEach((_,i) => { run += neto[i]; saldos.push(run); });

  // Fila de categoría (con detalle expandible)
  const catRow = (c) => {
    const open = state.cfOpenCat === c.v;
    const cells = c.cells.map((v) =>
      `<td class="grid-num ${v>0?'in':v<0?'out':'muted'}">${v ? mc(Math.abs(v)) : "·"}</td>`).join("");
    return `<tr class="grid-cat" data-cat="${c.v}">
      <td class="grid-catname">${open?"▾":"▸"} ${h(c.label)}</td>
      ${cells}
      <td class="grid-num grid-total ${c.total>0?'in':c.total<0?'out':''}">${mc(Math.abs(c.total))}</td>
    </tr>`;
  };

  const secHead = (txt) => `<tr class="grid-sec"><td>${txt}</td>${periods.map(()=>"<td></td>").join("")}<td></td></tr>`;
  const totalRow = (txt, arr, cls) => `<tr class="grid-tot ${cls}">
    <td>${txt}</td>${arr.map(v=>`<td class="grid-num">${v?mc(Math.abs(v)):"·"}</td>`).join("")}
    <td class="grid-num">${mc(Math.abs(arr.reduce((s,v)=>s+v,0)))}</td></tr>`;

  const invRow = invCells.some(v=>v!==0) ? `<tr class="grid-inv">
    <td>◆ Inversiones (no es gasto)</td>
    ${invCells.map(v=>`<td class="grid-num ${v>0?'in':v<0?'inv':'muted'}">${v?(v>0?'+':'−')+mc(Math.abs(v)):"·"}</td>`).join("")}
    <td class="grid-num">${mc(Math.abs(invCells.reduce((s,v)=>s+v,0)))}</td></tr>` : "";

  const saldoRow = `<tr class="grid-saldo">
    <td>Saldo al cierre</td>
    ${saldos.map(v=>`<td class="grid-num ${v<0?'neg':''}">${mc(v)}</td>`).join("")}
    <td class="grid-num">${mc(saldos[saldos.length-1]||0)}</td></tr>`;

  const colHead = periods.map(p=>`<th class="grid-per">${p.label}</th>`).join("");

  const cornerLabel = grain === "dia" ? "Día" : grain === "mes" ? "Mes" : "Semana del";

  $("#cf-table").innerHTML = `
    <div class="cf-table-scroll grid-scroll">
      <table class="cf-grid">
        <thead><tr>
          <th class="grid-corner">${cornerLabel}</th>
          ${colHead}
          <th class="grid-per grid-total-h">Total</th>
        </tr></thead>
        <tbody>
          ${secHead("INGRESOS")}
          ${ingresos.length ? ingresos.map(catRow).join("") : `<tr><td class="grid-catname muted">Sin ingresos</td>${periods.map(()=>'<td class="grid-num muted">·</td>').join("")}<td></td></tr>`}
          ${totalRow("Total ingresos", totInPos, "tot-in")}
          ${secHead("EGRESOS")}
          ${egresos.length ? egresos.map(catRow).join("") : `<tr><td class="grid-catname muted">Sin egresos</td>${periods.map(()=>'<td class="grid-num muted">·</td>').join("")}<td></td></tr>`}
          ${totalRow("Total egresos", totOut, "tot-out")}
          <tr class="grid-neto"><td>Flujo neto</td>${neto.map(v=>`<td class="grid-num ${v>0?'in':v<0?'out':''}">${v?(v>0?'+':'−')+mc(Math.abs(v)):"·"}</td>`).join("")}<td class="grid-num">${mc(neto.reduce((s,v)=>s+v,0))}</td></tr>
          ${invRow}
        </tbody>
      </table>
    </div>
    <div class="cf-table-foot"><span>${fmtDateShort(fromISO)} a ${fmtDateShort(toISO)} · ${grain==="dia"?"cada columna es un día":"cada columna es la semana que arranca esa fecha"} · tocá una categoría para ver el detalle</span></div>`;

  // Expandir categoría → mostrar movimientos individuales
  $$(".grid-cat").forEach((row) => {
    row.onclick = () => {
      const cat = row.dataset.cat;
      state.cfOpenCat = state.cfOpenCat === cat ? null : cat;
      renderGridCatDetail(cat, periods, mc);
    };
  });
  if (state.cfOpenCat) renderGridCatDetail(state.cfOpenCat, periods, mc);
  wireExport();
}

// Inserta filas de detalle bajo una categoría abierta
function renderGridCatDetail(cat, periods, mc) {
  // Quitar detalle previo
  $$(".grid-detail").forEach(r => r.remove());
  $$(".grid-cat").forEach(r => {
    const name = r.querySelector(".grid-catname");
    if (name) name.textContent = (r.dataset.cat === state.cfOpenCat ? "▾ " : "▸ ") + catLabel(r.dataset.cat);
  });
  if (!state.cfOpenCat || state.cfOpenCat !== cat) return;
  const row = $(`.grid-cat[data-cat="${cat}"]`);
  if (!row) return;
  const acctIds = new Set(state.accounts.filter(a =>
    state.cfAccount ? a.id === state.cfAccount : a.moneda === state.cfCurrency).map(a=>a.id));
  // Movimientos de esa categoría en el rango
  const items = {};
  state.movements.forEach((m, idx) => {
    if (!m.amount || !m.date || !acctIds.has(m.account)) return;
    if (m.movTipo === "inversion" || m.movTipo === "rescate") return;
    if (movCategoria(m) !== cat) return;
    const key = m.label || "(sin concepto)";
    if (!items[key]) items[key] = { label: key, cells: periods.map(()=>0), idx };
    // Expandir en el rango
    const base = new Date(m.date+"T00:00:00");
    const push = (d) => { const pi = periodIndex(periods, d.toISOString().slice(0,10)); if (pi>=0) items[key].cells[pi]+=m.amount; };
    if (m.recurrence==="none") push(base);
    else { let d=new Date(base),g=0; const end=periods[periods.length-1].end;
      while(d<=end&&g<3000){push(d);
        if(m.recurrence==="weekly")d.setDate(d.getDate()+7);
        else if(m.recurrence==="quincenal")d.setDate(d.getDate()+14);
        else if(m.recurrence==="monthly")d.setMonth(d.getMonth()+1);
        else if(m.recurrence==="quarterly")d.setMonth(d.getMonth()+3);
        else break; g++;} }
  });
  const detailHtml = Object.values(items).map(it =>
    `<tr class="grid-detail"><td class="grid-detailname">${h(it.label)}</td>${it.cells.map(v=>`<td class="grid-num sm ${v>0?'in':v<0?'out':'muted'}">${v?mc(Math.abs(v)):"·"}</td>`).join("")}<td class="grid-num sm">${mc(Math.abs(it.cells.reduce((s,v)=>s+v,0)))}</td></tr>`
  ).join("");
  row.insertAdjacentHTML("afterend", detailHtml);
}

function renderTableDaily(days) {
  const movByDate = getMovementsByDate();
  const ccy = days[0]?.ccy || state.cfCurrency;
  const mc = (n) => moneyC(n, ccy);
  // Mostramos todos los días del rango que tienen movimiento; si el rango es muy
  // corto (Hoy), mostramos igual el día aunque no tenga movimiento.
  const showAll = days.length <= 2;
  const visible = showAll ? days : days.filter((d) => d.inflow || d.outflow);

  const rows = visible.map((d) => {
    const detail = movByDate[d.date] || [];
    const open = state.cfOpenDay === d.date;
    const isToday = d.date === new Date().toISOString().slice(0,10);
    const alert = d.negative ? "row-neg" : "";
    const main = `<tr class="cf-row ${alert} ${isToday ? "cf-today" : ""}" data-day="${d.date}">
      <td class="cf-caret">${detail.length ? (open ? "▾" : "▸") : ""}</td>
      <td class="cf-date">${fmtDateFull(d.date)}${isToday ? ' <span class="today-tag">hoy</span>' : ''}</td>
      <td class="${d.inflow ? "in" : "muted"}">${d.inflow ? "+" + mc(d.inflow) : "—"}</td>
      <td class="${d.outflow ? "out" : "muted"}">${d.outflow ? "−" + mc(d.outflow) : "—"}</td>
      <td class="${d.net > 0 ? "in" : d.net < 0 ? "out" : "muted"}">${d.net ? (d.net > 0 ? "+" : "") + mc(d.net) : "—"}</td>
      <td class="bal ${d.negative ? "neg" : ""}">${mc(d.balance)}</td>
    </tr>`;
    let detailRows = "";
    if (open && detail.length) {
      detailRows = detail.map((m) => {
        const isInv = m.movTipo === "inversion";
        const isResc = m.movTipo === "rescate";
        const invTag = isInv ? '<span class="mov-inv-tag">◆ colocación</span>'
                     : isResc ? '<span class="mov-resc-tag">◆ vuelve de inversión</span>' : '';
        const rowClass = isInv || isResc ? "cf-detail cf-mov-inv" : "cf-detail cf-mov-edit";
        const editHint = (isInv || isResc) ? '' : '<span class="cf-edit-hint">editar</span>';
        return `<tr class="${rowClass}" data-idx="${m._idx}" title="${isInv||isResc ? 'Movimiento de inversión (se gestiona en Mis inversiones)' : 'Tocá para editar o eliminar'}">
        <td></td>
        <td class="cf-detail-label" colspan="1">${h(m.label || "(sin concepto)")} ${invTag} ${editHint}</td>
        <td class="${m.amount > 0 ? "in" : "muted"}">${m.amount > 0 ? "+" + mc(m.amount) : "—"}</td>
        <td class="${m.amount < 0 ? "out" : "muted"}">${m.amount < 0 ? "−" + mc(Math.abs(m.amount)) : "—"}</td>
        <td colspan="2" class="cf-medio">${medioLabel(m.medio)} · ${h(accountName(m.account))}</td>
      </tr>`;
      }).join("");
    }
    return main + detailRows;
  }).join("");

  const emptyMsg = visible.length === 0
    ? `<tr><td colspan="6" class="cf-empty">No hay movimientos en este período. Probá otro rango o agregá un movimiento.</td></tr>`
    : "";

  $("#cf-table").innerHTML = `
    <div class="cf-table-scroll">
      <table class="cf-table">
        <thead><tr>
          <th></th><th>Fecha</th><th>Entra</th><th>Sale</th><th>Neto</th><th>Saldo</th>
        </tr></thead>
        <tbody>${rows}${emptyMsg}</tbody>
      </table>
    </div>
    <div class="cf-table-foot">
      <span>${fmtDateShort(days[0].date)} a ${fmtDateShort(days[days.length-1].date)} · tocá un día para ver el detalle</span>
    </div>`;

  $$(".cf-row").forEach((row) => {
    row.onclick = () => {
      const day = row.dataset.day;
      state.cfOpenDay = state.cfOpenDay === day ? null : day;
      renderCashflowTable();
    };
  });
  $$(".cf-mov-edit").forEach((r) => {
    r.onclick = (e) => {
      e.stopPropagation();
      openMovModal(parseInt(r.dataset.idx, 10));
    };
  });
  // Filas de inversión: llevan a la cartera en vez de abrir el modal de movimiento
  $$(".cf-mov-inv").forEach((r) => {
    r.onclick = (e) => {
      e.stopPropagation();
      switchView("cartera");
    };
  });
  wireExport();
}

function renderTableWeekly(days) {
  const ccy = days[0]?.ccy || state.cfCurrency;
  const mc = (n) => moneyC(n, ccy);
  const weeks = {};
  days.forEach((d) => {
    const date = new Date(d.date + "T00:00:00");
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { from: key, inflow: 0, outflow: 0, endBal: 0, minBal: Infinity, days: [] };
    const w = weeks[key];
    w.inflow += d.inflow; w.outflow += d.outflow;
    w.endBal = d.balance;
    w.minBal = Math.min(w.minBal, d.balance);
    w.days.push(d);
  });

  const rows = Object.values(weeks).map((w) => {
    const to = w.days[w.days.length - 1].date;
    const net = w.inflow - w.outflow;
    const alert = w.minBal < 0 ? "row-neg" : "";
    return `<tr class="${alert}">
      <td></td>
      <td class="cf-date">${fmtDateShort(w.from)} – ${fmtDateShort(to)}</td>
      <td class="${w.inflow ? "in" : "muted"}">${w.inflow ? "+" + mc(w.inflow) : "—"}</td>
      <td class="${w.outflow ? "out" : "muted"}">${w.outflow ? "−" + mc(w.outflow) : "—"}</td>
      <td class="${net > 0 ? "in" : net < 0 ? "out" : "muted"}">${net ? (net > 0 ? "+" : "") + mc(net) : "—"}</td>
      <td class="bal ${w.minBal < 0 ? "neg" : ""}">${mc(w.endBal)}</td>
    </tr>`;
  }).join("");

  const emptyMsg = Object.keys(weeks).length === 0
    ? `<tr><td colspan="6" class="cf-empty">No hay movimientos en este período.</td></tr>` : "";

  $("#cf-table").innerHTML = `
    <div class="cf-table-scroll">
      <table class="cf-table">
        <thead><tr>
          <th></th><th>Semana</th><th>Entra</th><th>Sale</th><th>Neto</th><th>Saldo fin</th>
        </tr></thead>
        <tbody>${rows}${emptyMsg}</tbody>
      </table>
    </div>
    <div class="cf-table-foot"><span>${Object.keys(weeks).length} semanas en el período</span></div>`;
  wireExport();
}

// ── Rango de fechas de la tabla (pasado + futuro) ────────
function cfRangeDates() {
  const today = new Date(); today.setHours(0,0,0,0);
  const iso = (d) => d.toISOString().slice(0,10);
  // Rango custom tiene prioridad
  if (state.cfFrom && state.cfTo) return { from: state.cfFrom, to: state.cfTo };
  const r = state.cfRange || "mes";
  const from = new Date(today), to = new Date(today);
  if (r === "hoy") { /* from=to=hoy */ }
  else if (r === "semana") {
    from.setDate(today.getDate() - ((today.getDay()+6)%7)); // lunes de esta semana
    to.setTime(from.getTime());
    to.setDate(from.getDate()+6); // domingo
  }
  else if (r === "mes") { from.setDate(1); to.setMonth(to.getMonth()+1); to.setDate(0); }
  else if (r === "90") { to.setDate(today.getDate()+90); }
  else if (r === "pasado") { from.setDate(today.getDate()-180); }
  return { from: iso(from), to: iso(to) };
}

// Calcula el saldo día a día en el rango, para la moneda/cuenta activas.
// El saldo running arranca del opening + todos los movimientos ANTERIORES a "from".
function computeDaySeries(fromISO, toISO) {
  const from = new Date(fromISO + "T00:00:00");
  const to = new Date(toISO + "T00:00:00");
  const ccy = state.cfAccount
    ? (state.accounts.find(a=>a.id===state.cfAccount)?.moneda || "ARS")
    : state.cfCurrency;
  // Cuentas incluidas
  const accts = state.accounts.filter(a =>
    state.cfAccount ? a.id === state.cfAccount : a.moneda === ccy
  );
  const acctIds = new Set(accts.map(a=>a.id));
  const opening = accts.reduce((s,a)=>s+(parseFloat(a.opening)||0),0);

  // Expandir todos los movimientos de esas cuentas a (fecha, monto), hasta "to"
  const byDate = {};
  const horizonEnd = new Date(to); horizonEnd.setDate(horizonEnd.getDate()+1);
  state.movements.forEach((m) => {
    if (!m.amount || !m.date || !acctIds.has(m.account)) return;
    const base = new Date(m.date + "T00:00:00");
    const push = (d) => {
      const k = d.toISOString().slice(0,10);
      byDate[k] = (byDate[k]||0) + m.amount;
    };
    if (m.recurrence === "none") { if (base <= horizonEnd) push(base); return; }
    let d = new Date(base), guard = 0;
    while (d <= horizonEnd && guard < 3000) {
      push(d);
      if (m.recurrence === "weekly") d.setDate(d.getDate()+7);
      else if (m.recurrence === "quincenal") d.setDate(d.getDate()+14);
      else if (m.recurrence === "monthly") d.setMonth(d.getMonth()+1);
      else if (m.recurrence === "quarterly") d.setMonth(d.getMonth()+3);
      else break;
      guard++;
    }
  });

  // Saldo acumulado hasta el día ANTERIOR a "from"
  let balance = opening;
  Object.keys(byDate).forEach((k) => {
    if (new Date(k+"T00:00:00") < from) balance += byDate[k];
  });

  // Serie día a día en el rango
  const days = [];
  let d = new Date(from);
  while (d <= to) {
    const k = d.toISOString().slice(0,10);
    const delta = byDate[k] || 0;
    const inflow = delta > 0 ? delta : 0;
    const outflow = delta < 0 ? -delta : 0;
    balance += delta;
    days.push({
      date: k, inflow, outflow, net: delta, balance,
      investable: Math.max(0, balance),
      negative: balance < 0, below_buffer: false,
      ccy,
    });
    d.setDate(d.getDate()+1);
  }
  return days;
}

// Construye {fecha: [movimientos]} expandiendo recurrencias, para el detalle diario
function getMovementsByDate() {
  const movs = state.movements;
  const byDate = {};
  const start = new Date();
  const end = new Date(); end.setDate(end.getDate() + 400);
  movs.forEach((m, idx) => {
    if (!m.amount || !m.date) return;
    if (state.cfAccount && m.account !== state.cfAccount) return; // filtro por cuenta
    if (!state.cfAccount && movCurrency(m) !== state.cfCurrency) return; // filtro por moneda activa
    const base = new Date(m.date + "T00:00:00");
    const push = (iso) => { (byDate[iso] = byDate[iso] || []).push({ ...m, _idx: idx }); };
    if (m.recurrence === "none") { push(m.date); return; }
    let d = new Date(base), guard = 0;
    while (d <= end && guard < 500) {
      push(d.toISOString().slice(0, 10));
      if (m.recurrence === "weekly") d.setDate(d.getDate() + 7);
      else if (m.recurrence === "quincenal") d.setDate(d.getDate() + 14);
      else if (m.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
      else if (m.recurrence === "quarterly") d.setMonth(d.getMonth() + 3);
      else break;
      guard++;
    }
  });
  return byDate;
}

function medioLabel(medio) {
  const map = { transferencia: "🏦 Transferencia", efectivo: "💵 Efectivo", cheque: "🧾 Cheque", tarjeta: "💳 Tarjeta" };
  return map[medio] || medio || "—";
}

function wireExport() {
  const exp = $("#cf-export");
  if (exp) exp.onclick = exportCashflowCSV;
}

function fmtDateFull(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", weekday: "short" });
}
function fmtDateShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function exportCashflowCSV() {
  const days = state.result.days;
  const header = "Fecha,Entra,Sale,Neto,Saldo,Colocable\n";
  const lines = days.map((d) =>
    [d.date, d.inflow || 0, d.outflow || 0, d.net || 0, d.balance, d.investable || 0].join(",")
  ).join("\n");
  const blob = new Blob([header + lines], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "flujo_de_caja.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Insights ─────────────────────────────────────────────
function renderInsights() {
  const s = state.result.summary;
  const shortfalls = state.result.shortfalls;
  const out = [];

  if (s.stable_surplus > 0) {
    out.push({
      kind: "good", icon: "◆",
      title: "Tenés plata ociosa para invertir",
      html: `Hay <span class="amt">${money(s.stable_surplus)}</span> que podés colocar sin tocar el colchón en todo el horizonte. Puesto en un FCI money market, ese dinero rinde todos los días con liquidez inmediata.`,
      cta: "Ver opciones",
    });
  }

  if (s.has_shortfall) {
    const first = shortfalls.find((x) => true);
    out.push({
      kind: "bad", icon: "▲",
      title: "Vas a quedar en descubierto",
      html: `El saldo cae por debajo de cero${first ? ` alrededor del <span class="amt">${fmtDate(first.from)}</span>` : ""}. Conviene adelantar cobranzas, postergar pagos o dejar una línea disponible.`,
    });
  } else if (s.min_balance < s.min_buffer) {
    out.push({
      kind: "warn", icon: "▲",
      title: "El colchón se perfora",
      html: `El saldo baja hasta <span class="amt">${money(s.min_balance)}</span> el ${fmtDate(s.min_balance_date)}, por debajo del colchón que fijaste. No es descubierto, pero ajustá el margen antes de invertir de más.`,
    });
  }

  if (!out.length) {
    out.push({
      kind: "warn", icon: "○",
      title: "Cargá tus movimientos",
      html: `Agregá las cobranzas y pagos previstos para ver la proyección y cuánto podés invertir.`,
    });
  }

  $("#insights").innerHTML = out.map((i) => `
    <div class="insight ${i.kind}">
      <div class="insight-icon">${i.icon}</div>
      <div class="insight-body">
        <h3>${i.title}</h3>
        <p>${i.html}</p>
      </div>
      ${i.cta ? `<button class="insight-cta" data-goto="excedente">${i.cta}</button>` : ""}
    </div>`).join("");

  $$(".insight-cta").forEach((btn) =>
    btn.addEventListener("click", () => switchView("excedente"))
  );
}

// ── Excedente (placeholder con datos del cash flow) ──────
function renderExcedente() {
  // El excedente es la liquidez que te sobra después de cubrir los pagos
  // próximos. El optimizador (renderOptimizar) hace ese cálculo por cuenta.
  const yaColocado = totalColocado("ARS");

  $("#excedente-wrap").innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Excedente para invertir</div>
        <h2 class="inv-title">Optimizar liquidez</h2>
        <p class="inv-sub">Descontando lo que pagás en los próximos días, esto es lo que te sobra en cada cuenta para colocar en un FCI (se rescata al otro día). Vos decidís cuánto.</p>
      </div>
    </div>

    <div class="ctrl-card" id="optimizar-card" style="max-width:640px"></div>

    ${yaColocado > 0 ? `<p class="exc-note" style="margin-top:16px">Ya tenés ${money(yaColocado)} colocados en inversiones activas. <a href="#" id="exc-ver-cartera">Ver mi cartera →</a></p>` : ""}`;

  renderOptimizar();
  const link = $("#exc-ver-cartera");
  if (link) link.addEventListener("click", (e) => { e.preventDefault(); switchView("cartera"); });
}

// ── Dólar: comprar / vender divisas ──────────────────────
// ═══ MIS INVERSIONES (cartera de colocaciones) ═══════════
// Concepto clave: una inversión NO es un gasto. Es plata que sigue
// siendo tuya, cambia de líquida a colocada, y vuelve en una fecha.

function invId() { return "inv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Estima cuánto vuelve al vencimiento (capital + rendimiento).
function estimarRetorno(inv) {
  const monto = parseFloat(inv.monto) || 0;
  const rend = parseFloat(inv.rendimiento) || 0;
  if (!rend) return monto;
  // Con fecha de vencimiento: interés proporcional a los días (TNA)
  if (inv.fechaVenc && inv.fechaColocacion) {
    const d0 = new Date(inv.fechaColocacion + "T00:00:00");
    const d1 = new Date(inv.fechaVenc + "T00:00:00");
    const dias = Math.max(0, Math.round((d1 - d0) / 86400000));
    return monto * (1 + (rend / 100) * (dias / 365));
  }
  // Sin vencimiento (FCI, dólares): mostramos el capital; el rend es referencia anual
  return monto;
}

// ¿Está activa hoy? (colocada y todavía no venció)
function invActiva(inv) {
  if (inv.estado === "rescatada") return false;
  if (!inv.fechaVenc) return true; // sin vencimiento: activa hasta que la rescaten
  return new Date(inv.fechaVenc + "T00:00:00") >= new Date(new Date().toISOString().slice(0,10) + "T00:00:00");
}

// Total colocado hoy, por moneda (lo que está invertido y todavía no volvió)
function totalColocado(ccy) {
  return state.investments
    .filter((inv) => invActiva(inv) && inv.moneda === ccy)
    .reduce((s, inv) => s + (parseFloat(inv.monto) || 0), 0);
}

// ── Helper: saldo de una cuenta a una fecha (default hoy) ─
function saldoCuentaAFecha(acc, hasta) {
  const lim = hasta ? new Date(hasta + "T23:59:59") : (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();
  let bal = parseFloat(acc.opening) || 0;
  state.movements.forEach((m) => {
    if (m.account !== acc.id || !m.amount || !m.date) return;
    const base = new Date(m.date + "T00:00:00");
    if (m.recurrence === "none") { if (base <= lim) bal += m.amount; }
    else {
      let d = new Date(base), g = 0;
      while (d <= lim && g < 2000) {
        bal += m.amount;
        if (m.recurrence==="weekly") d.setDate(d.getDate()+7);
        else if (m.recurrence==="quincenal") d.setDate(d.getDate()+14);
        else if (m.recurrence==="monthly") d.setMonth(d.getMonth()+1);
        else if (m.recurrence==="quarterly") d.setMonth(d.getMonth()+3);
        else break; g++;
      }
    }
  });
  return bal;
}

// ═══ ESCENARIOS (What-If) ════════════════════════════════
// Palancas del escenario activo (no se guardan; análisis puro)
const escenario = {
  ventasPct: 0,      // % variación de ingresos (cobranzas/ventas)
  gastosPct: 0,      // % variación de egresos operativos
  dolarPct: 0,       // % variación del dólar (afecta cuentas/mov USD)
  retrasoCobros: 0,  // días de retraso en las cobranzas
  retrasoPagos: 0,   // días de corrimiento de los pagos
};

// Aplica las palancas a una copia de los movimientos y devuelve la serie diaria
function simularSerie(fromISO, toISO, esc) {
  const origMovs = state.movements;
  // Copia profunda con las palancas aplicadas
  const simMovs = state.movements.map((m) => {
    const nm = { ...m };
    const cat = movCategoria(m);
    const esIngreso = m.amount > 0;
    const esInversion = m.movTipo === "inversion" || m.movTipo === "rescate";
    if (!esInversion) {
      // Variación de ventas/ingresos
      if (esIngreso && esc.ventasPct) nm.amount = m.amount * (1 + esc.ventasPct/100);
      // Variación de gastos/egresos
      if (!esIngreso && esc.gastosPct) nm.amount = m.amount * (1 + esc.gastosPct/100);
      // Retraso de cobranzas (ingresos futuros se corren)
      if (esIngreso && esc.retrasoCobros && (m.movTipo === "cobranza" || cat === "ventas" || cat === "certificaciones" || cat === "anticipos")) {
        nm.date = addDaysToISO(m.date, esc.retrasoCobros);
      }
      // Retraso de pagos
      if (!esIngreso && esc.retrasoPagos && (m.movTipo === "pago" || catFlujo(cat) === "out")) {
        nm.date = addDaysToISO(m.date, esc.retrasoPagos);
      }
    }
    // Variación del dólar: afecta movimientos de cuentas USD
    const acc = state.accounts.find(a => a.id === m.account);
    if (acc && acc.moneda === "USD" && esc.dolarPct) {
      nm.amount = m.amount * (1 + esc.dolarPct/100);
    }
    return nm;
  });
  // Sustituir temporalmente y calcular
  state.movements = simMovs;
  const serie = computeDaySeries(fromISO, toISO);
  state.movements = origMovs;
  return serie;
}

function addDaysToISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function renderEscenarios() {
  const wrap = $("#esc-wrap");
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const iso = (d) => d.toISOString().slice(0,10);
  const to = new Date(hoy); to.setDate(to.getDate()+90);

  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Tesorería</div>
        <h2 class="inv-title">Escenarios ¿qué pasaría si...?</h2>
        <p class="inv-sub">Simulá situaciones sin tocar tus datos reales. Movés las palancas y ves el impacto en tu caja de los próximos 90 días.</p>
      </div>
      <button class="btn-ghost" id="esc-reset">Reiniciar</button>
    </div>

    <div class="esc-presets">
      <button class="esc-preset" data-preset="dolar">📈 Sube el dólar 20%</button>
      <button class="esc-preset" data-preset="ventas">📉 Caen las ventas 15%</button>
      <button class="esc-preset" data-preset="cobros">⏳ Cobros +15 días</button>
      <button class="esc-preset" data-preset="crisis">🔥 Escenario adverso</button>
    </div>

    <div class="esc-board">
      <aside class="esc-controls ctrl-card">
        <h3>Palancas</h3>
        ${palancaHTML("ventasPct", "Ventas / cobranzas", "%", -50, 50)}
        ${palancaHTML("gastosPct", "Gastos / egresos", "%", -50, 50)}
        ${palancaHTML("dolarPct", "Cotización del dólar", "%", -30, 100)}
        ${palancaHTML("retrasoCobros", "Retraso en cobros", "días", 0, 90)}
        ${palancaHTML("retrasoPagos", "Corrimiento de pagos", "días", 0, 90)}
      </aside>
      <div class="esc-result">
        <div class="esc-compare" id="esc-compare"></div>
        <div class="chart-card" style="margin-top:16px">
          <div class="chart-head"><h2>Base vs. escenario</h2>
            <div class="chart-legend"><span class="lg lg-balance">Base</span><span class="lg" style="color:#E65100">Escenario</span></div>
          </div>
          <div id="esc-chart"></div>
        </div>
      </div>
    </div>`;

  // Wiring palancas
  $$(".esc-slider").forEach(sl => {
    sl.addEventListener("input", () => {
      escenario[sl.dataset.lever] = parseFloat(sl.value);
      $(`#esc-val-${sl.dataset.lever}`).textContent = fmtLever(sl.dataset.lever, sl.value);
      updateEscenario();
    });
  });
  $$(".esc-preset").forEach(b => b.onclick = () => aplicarPreset(b.dataset.preset));
  $("#esc-reset").onclick = () => { resetEscenario(); renderEscenarios(); };

  updateEscenario();
}

function palancaHTML(lever, label, unidad, min, max) {
  const val = escenario[lever];
  return `<div class="esc-lever">
    <div class="esc-lever-head"><span>${label}</span><b id="esc-val-${lever}">${fmtLever(lever, val)}</b></div>
    <input type="range" class="esc-slider" data-lever="${lever}" min="${min}" max="${max}" step="${unidad==="días"?1:5}" value="${val}">
  </div>`;
}
function fmtLever(lever, val) {
  val = parseFloat(val);
  if (lever.startsWith("retraso")) return val === 0 ? "sin cambio" : `+${val} días`;
  return val === 0 ? "sin cambio" : `${val>0?"+":""}${val}%`;
}

function updateEscenario() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const iso = (d) => d.toISOString().slice(0,10);
  const to = new Date(hoy); to.setDate(to.getDate()+90);
  const prevCcy = state.cfCurrency, prevAcct = state.cfAccount;
  state.cfCurrency = "ARS"; state.cfAccount = "";
  const base = computeDaySeries(iso(hoy), iso(to));
  const sim = simularSerie(iso(hoy), iso(to), escenario);
  state.cfCurrency = prevCcy; state.cfAccount = prevAcct;

  // Métricas comparadas
  const finBase = base.length ? base[base.length-1].balance : 0;
  const finSim = sim.length ? sim[sim.length-1].balance : 0;
  const pisoBase = base.reduce((m,d)=>Math.min(m,d.balance), Infinity);
  const pisoSim = sim.reduce((m,d)=>Math.min(m,d.balance), Infinity);
  const primerRojoSim = sim.find(d=>d.balance<0);

  const delta = finSim - finBase;
  $("#esc-compare").innerHTML = `
    <div class="esc-metric">
      <small>Saldo a 90 días</small>
      <div class="esc-metric-vals"><span class="base">${moneyC(finBase,"ARS")}</span><span class="arrow">→</span><b class="${finSim<0?'neg':'pos'}">${moneyC(finSim,"ARS")}</b></div>
      <span class="esc-delta ${delta>=0?'up':'down'}">${delta>=0?"▲":"▼"} ${moneyC(Math.abs(delta),"ARS")}</span>
    </div>
    <div class="esc-metric">
      <small>Piso de caja</small>
      <div class="esc-metric-vals"><span class="base">${moneyC(pisoBase,"ARS")}</span><span class="arrow">→</span><b class="${pisoSim<0?'neg':'pos'}">${moneyC(pisoSim,"ARS")}</b></div>
      ${primerRojoSim ? `<span class="esc-delta down">Descubierto el ${fmtDateShort(primerRojoSim.date)}</span>` : `<span class="esc-delta up">Sin descubierto</span>`}
    </div>`;

  renderEscChart(base, sim);
}

function renderEscChart(base, sim) {
  const host = $("#esc-chart");
  if (!host || !base.length) return;
  const W=880, H=300, P={t:16,r:16,b:26,l:64};
  const iw=W-P.l-P.r, ih=H-P.t-P.b;
  const all=[...base.map(d=>d.balance),...sim.map(d=>d.balance)];
  let ymin=Math.min(0,...all), ymax=Math.max(...all,0);
  const pad=(ymax-ymin)*0.1||1000; ymin-=pad; ymax+=pad;
  const X=(i,arr)=>P.l+(i/(arr.length-1))*iw;
  const Y=(v)=>P.t+ih-((v-ymin)/(ymax-ymin))*ih;
  const line=(arr)=>arr.map((d,i)=>`${X(i,arr).toFixed(1)},${Y(d.balance).toFixed(1)}`).join(" ");
  const zeroY=Y(0).toFixed(1);
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" class="dash-svg">
    <line x1="${P.l}" y1="${zeroY}" x2="${P.l+iw}" y2="${zeroY}" stroke="#E45858" stroke-dasharray="4 4" stroke-width="1"/>
    <polyline points="${line(base)}" fill="none" stroke="#4C8DFF" stroke-width="2" opacity="0.55"/>
    <polyline points="${line(sim)}" fill="none" stroke="#E65100" stroke-width="2.5"/>
    <text x="4" y="${Y(ymax).toFixed(1)+4}" fill="#94A3B8" font-size="10">${money(ymax)}</text>
    <text x="4" y="${zeroY}" fill="#E45858" font-size="9">0</text>
    <text x="4" y="${Y(ymin).toFixed(1)}" fill="#94A3B8" font-size="10">${money(ymin)}</text>
  </svg>`;
}

function aplicarPreset(preset) {
  resetEscenario();
  if (preset === "dolar") escenario.dolarPct = 20;
  else if (preset === "ventas") escenario.ventasPct = -15;
  else if (preset === "cobros") escenario.retrasoCobros = 15;
  else if (preset === "crisis") { escenario.ventasPct = -20; escenario.gastosPct = 10; escenario.retrasoCobros = 20; escenario.dolarPct = 30; }
  renderEscenarios();
}
function resetEscenario() {
  escenario.ventasPct = 0; escenario.gastosPct = 0; escenario.dolarPct = 0;
  escenario.retrasoCobros = 0; escenario.retrasoPagos = 0;
}

// ═══ DASHBOARD (Inicio) + motor de alertas ══════════════
// Motor de alertas: revisa el estado y devuelve avisos priorizados
function generarAlertas() {
  const alertas = [];
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const iso = (d) => d.toISOString().slice(0,10);

  // 1) Saldo proyectado que entra en rojo (próximos 90 días, ARS)
  const prevCcy = state.cfCurrency, prevAcct = state.cfAccount;
  state.cfCurrency = "ARS"; state.cfAccount = "";
  const to = new Date(hoy); to.setDate(to.getDate()+90);
  const serie = computeDaySeries(iso(hoy), iso(to));
  state.cfCurrency = prevCcy; state.cfAccount = prevAcct;
  const primerRojo = serie.find(d => d.balance < 0);
  if (primerRojo) {
    const dias = Math.round((new Date(primerRojo.date+"T00:00:00") - hoy)/86400000);
    alertas.push({
      nivel: "critico", icono: "▼",
      titulo: "Vas a quedar en descubierto",
      detalle: `El ${fmtDateFull(primerRojo.date)}${dias===0?" (hoy)":` (en ${dias} días)`} tu saldo proyectado cae a ${moneyC(primerRojo.balance,"ARS")}.`,
      accion: "flujo",
    });
  }

  // 2) Facturas vencidas (por cobrar y por pagar)
  const cobrarVenc = state.comprobantes.filter(c => c.tipo==="cobrar" && c.estado!=="saldado" && diasAtraso(c)>0);
  if (cobrarVenc.length) {
    const total = cobrarVenc.reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
    alertas.push({
      nivel: "alto", icono: "⏰",
      titulo: `${cobrarVenc.length} cobranza${cobrarVenc.length>1?"s":""} vencida${cobrarVenc.length>1?"s":""}`,
      detalle: `Te deben ${moneyC(total,"ARS")} de facturas ya vencidas. La más atrasada: ${cobrarVenc.sort((a,b)=>diasAtraso(b)-diasAtraso(a))[0].contraparte}.`,
      accion: "comprobantes",
    });
  }
  const pagarVenc = state.comprobantes.filter(c => c.tipo==="pagar" && c.estado!=="saldado" && diasAtraso(c)>0);
  if (pagarVenc.length) {
    const total = pagarVenc.reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
    alertas.push({
      nivel: "alto", icono: "⏰",
      titulo: `${pagarVenc.length} pago${pagarVenc.length>1?"s":""} vencido${pagarVenc.length>1?"s":""}`,
      detalle: `Debés ${moneyC(total,"ARS")} de facturas ya vencidas a proveedores.`,
      accion: "comprobantes",
    });
  }

  // 3) Vencimientos próximos (7 días) — cobros y pagos
  const prox = state.comprobantes.filter(c => c.estado!=="saldado" && diasAtraso(c)<=0 && diasAtraso(c)>=-7);
  if (prox.length) {
    const cobros = prox.filter(c=>c.tipo==="cobrar").reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
    const pagos = prox.filter(c=>c.tipo==="pagar").reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
    let det = [];
    if (cobros) det.push(`cobrás ${moneyC(cobros,"ARS")}`);
    if (pagos) det.push(`pagás ${moneyC(pagos,"ARS")}`);
    alertas.push({
      nivel: "medio", icono: "📅",
      titulo: `${prox.length} vencimiento${prox.length>1?"s":""} esta semana`,
      detalle: `En los próximos 7 días ${det.join(" y ")}.`,
      accion: "comprobantes",
    });
  }

  // 4) Concentración de pagos: un día con egresos > 40% del saldo actual
  const saldoHoy = serie.length ? serie[0].balance : 0;
  const egresosPorDia = {};
  serie.forEach(d => { if (d.outflow > 0) egresosPorDia[d.date] = d.outflow; });
  const diaPico = Object.entries(egresosPorDia).sort((a,b)=>b[1]-a[1])[0];
  if (diaPico && saldoHoy > 0 && diaPico[1] > saldoHoy * 0.4) {
    alertas.push({
      nivel: "medio", icono: "◆",
      titulo: "Concentración de pagos",
      detalle: `El ${fmtDateFull(diaPico[0])} tenés que pagar ${moneyC(diaPico[1],"ARS")} — más del 40% de tu saldo actual. Revisá si podés diferir algo.`,
      accion: "comprobantes",
    });
  }

  // Orden por nivel
  const peso = { critico: 0, alto: 1, medio: 2 };
  return alertas.sort((a,b)=>peso[a.nivel]-peso[b.nivel]);
}

function renderDashboard() {
  const wrap = $("#dash-wrap");
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const iso = (d) => d.toISOString().slice(0,10);

  // Datos consolidados ARS
  const prevCcy = state.cfCurrency, prevAcct = state.cfAccount;
  state.cfCurrency = "ARS"; state.cfAccount = "";
  const to30 = new Date(hoy); to30.setDate(to30.getDate()+30);
  const serie30 = computeDaySeries(iso(hoy), iso(to30));
  state.cfCurrency = prevCcy; state.cfAccount = prevAcct;

  const liquidoARS = state.accounts.filter(a=>a.moneda==="ARS").reduce((s,a)=>s+saldoCuentaAFecha(a),0);
  const colocadoARS = totalColocado("ARS");
  const saldoFin30 = serie30.length ? serie30[serie30.length-1].balance : liquidoARS;
  const pisoMin = serie30.reduce((m,d)=>Math.min(m,d.balance), liquidoARS);
  const porCobrar = state.comprobantes.filter(c=>c.tipo==="cobrar"&&c.estado!=="saldado").reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
  const porPagar = state.comprobantes.filter(c=>c.tipo==="pagar"&&c.estado!=="saldado").reduce((s,c)=>s+(parseFloat(c.monto)||0),0);

  const alertas = generarAlertas();
  const nivelClass = { critico: "al-crit", alto: "al-alto", medio: "al-medio" };

  const empresa = state.empresa.nombre || "Tu empresa";

  wrap.innerHTML = `
    <div class="dash-head">
      <div>
        <div class="eyebrow">Tesorería · ${h(empresa)}</div>
        <h2 class="inv-title">Inicio</h2>
      </div>
      <div class="dash-date">${new Date().toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"})}</div>
    </div>

    ${alertas.length ? `<div class="dash-alertas">
      ${alertas.map(a=>`<div class="dash-alerta ${nivelClass[a.nivel]}" data-goto="${a.accion}">
        <span class="al-icono">${a.icono}</span>
        <div class="al-body"><b>${a.titulo}</b><span>${a.detalle}</span></div>
        <span class="al-arrow">→</span>
      </div>`).join("")}
    </div>` : `<div class="dash-ok">✓ Todo en orden. No hay alertas de tesorería.</div>`}

    <div class="dash-kpis">
      <div class="dash-kpi hero">
        <div class="dk-label">Líquido hoy</div>
        <div class="dk-value">${moneyC(liquidoARS,"ARS")}</div>
        <div class="dk-sub">Disponible ahora en pesos</div>
      </div>
      <div class="dash-kpi">
        <div class="dk-label">Colocado</div>
        <div class="dk-value inv">${moneyC(colocadoARS,"ARS")}</div>
        <div class="dk-sub">Invertido · vuelve con rendimiento</div>
      </div>
      <div class="dash-kpi">
        <div class="dk-label">Saldo proyectado (30d)</div>
        <div class="dk-value ${saldoFin30<0?"neg":"pos"}">${moneyC(saldoFin30,"ARS")}</div>
        <div class="dk-sub">Piso del mes: ${moneyC(pisoMin,"ARS")}</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-card-head"><h3>Flujo proyectado · 30 días</h3><button class="cf-link" data-goto="flujo">Ver detalle →</button></div>
        <div id="dash-chart"></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Cobranzas y pagos</h3><button class="cf-link" data-goto="comprobantes">Ver todo →</button></div>
        <div class="dash-cp">
          <div class="dash-cp-item in">
            <small>Por cobrar</small>
            <b>${moneyC(porCobrar,"ARS")}</b>
          </div>
          <div class="dash-cp-item out">
            <small>Por pagar</small>
            <b>${moneyC(porPagar,"ARS")}</b>
          </div>
          <div class="dash-cp-item ${porCobrar-porPagar>=0?"net-pos":"net-neg"}">
            <small>Neto pendiente</small>
            <b>${moneyC(porCobrar-porPagar,"ARS")}</b>
          </div>
        </div>
        <div class="dash-cp-bar">
          <div class="cp-bar-in" style="width:${porCobrar+porPagar>0?Math.round(porCobrar/(porCobrar+porPagar)*100):50}%"></div>
        </div>
      </div>
    </div>

    <div class="dash-quick">
      <button class="dash-quick-btn" data-goto="flujo">📊 Flujo de caja</button>
      <button class="dash-quick-btn" data-goto="saldos">🏦 Posición de caja</button>
      <button class="dash-quick-btn" data-goto="comprobantes">📄 Cobranzas y Pagos</button>
      <button class="dash-quick-btn" data-goto="cartera">◆ Mis inversiones</button>
    </div>`;

  // Mini-gráfico del flujo
  renderDashChart(serie30);
  // Wiring de navegación
  $$("[data-goto]").forEach(el => el.addEventListener("click", () => switchView(el.dataset.goto)));
}

function renderDashChart(serie) {
  const host = $("#dash-chart");
  if (!host || !serie.length) { if(host) host.innerHTML=""; return; }
  const W=680, H=180, P={t:12,r:12,b:22,l:56};
  const iw=W-P.l-P.r, ih=H-P.t-P.b;
  const bals=serie.map(d=>d.balance);
  let ymin=Math.min(0,...bals), ymax=Math.max(...bals,0);
  const pad=(ymax-ymin)*0.12||1000; ymin-=pad; ymax+=pad;
  const X=(i)=>P.l+(i/(serie.length-1))*iw;
  const Y=(v)=>P.t+ih-((v-ymin)/(ymax-ymin))*ih;
  const pts=serie.map((d,i)=>`${X(i).toFixed(1)},${Y(d.balance).toFixed(1)}`).join(" ");
  const area=`${P.l},${Y(ymin).toFixed(1)} ${pts} ${(P.l+iw).toFixed(1)},${Y(ymin).toFixed(1)}`;
  const zeroY=Y(0).toFixed(1);
  const neg = bals.some(v=>v<0);
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" class="dash-svg">
    <polygon points="${area}" fill="${neg?'rgba(228,88,88,.08)':'rgba(76,141,255,.10)'}"/>
    <line x1="${P.l}" y1="${zeroY}" x2="${P.l+iw}" y2="${zeroY}" stroke="#E45858" stroke-dasharray="4 4" stroke-width="1"/>
    <polyline points="${pts}" fill="none" stroke="${neg?'#E45858':'#4C8DFF'}" stroke-width="2"/>
    <text x="4" y="${Y(ymax).toFixed(1)+4}" fill="#94A3B8" font-size="10">${money(ymax)}</text>
    <text x="4" y="${zeroY}" fill="#E45858" font-size="9">0</text>
  </svg>`;
}

// ═══ COBRANZAS Y PAGOS (AR / AP) ═════════════════════════
let compTab = "cobrar"; // pestaña activa

// ── Directorio de proveedores ────────────────────────────
const CONDICIONES_IVA = ["Responsable Inscripto", "Monotributista", "Exento", "No Responsable", "Consumidor Final"];

function renderProveedores(wrap) {
  const provs = state.proveedores || [];
  const filaProv = (p) => `<tr class="prov-row" data-id="${p.id}">
    <td class="prov-name"><b>${h(p.nombre)}</b><small>${h(p.rubro||"")}</small></td>
    <td class="mono">${h(p.cuit||"—")}</td>
    <td>${h(p.contacto||"—")}<br><small class="muted">${h(p.email||"")}</small></td>
    <td>${h(p.telefono||"—")}</td>
    <td><span class="prov-iva">${h(p.condicionIVA||"—")}</span></td>
    <td class="mono">${p.plazoPago? p.plazoPago+" días":"—"}</td>
    <td class="prov-actions">
      <button class="prov-edit-btn" data-edit="${p.id}" title="Editar">✎</button>
      <button class="prov-del-btn" data-del="${p.id}" title="Eliminar">×</button>
    </td>
  </tr>`;

  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Tesorería</div>
        <h2 class="inv-title">Cobranzas y Pagos</h2>
        <p class="inv-sub">Administrá tus facturas por cobrar y por pagar, con vencimientos y antigüedad de deuda. Todo lo pendiente ya se refleja en tu flujo de caja proyectado.</p>
      </div>
      <button class="btn-primary" id="prov-add">+ Nuevo proveedor</button>
    </div>

    <div class="comp-tabs">
      <button class="comp-tab" data-tab="cobrar">Por cobrar</button>
      <button class="comp-tab" data-tab="pagar">Por pagar</button>
      <button class="comp-tab active" data-tab="proveedores">Proveedores</button>
    </div>

    <div class="table-card">
      <div class="chart-head"><h2>Directorio de proveedores</h2><span class="muted">${provs.length} proveedor${provs.length!==1?"es":""}</span></div>
      ${provs.length ? `<div class="cf-table-scroll"><table class="cf-table">
        <thead><tr><th>Proveedor</th><th>CUIT</th><th>Contacto</th><th>Teléfono</th><th>Cond. IVA</th><th>Plazo</th><th></th></tr></thead>
        <tbody>${provs.map(filaProv).join("")}</tbody>
      </table></div>` : `<p class="cf-empty">Todavía no cargaste proveedores. Tocá "Nuevo proveedor" para empezar tu base.</p>`}
    </div>`;

  $$(".comp-tab").forEach(b => b.onclick = () => { compTab = b.dataset.tab; renderComprobantes(); });
  $("#prov-add").onclick = () => openProvModal();
  $$(".prov-edit-btn").forEach(b => b.onclick = () => openProvModal(b.dataset.edit));
  $$(".prov-del-btn").forEach(b => b.onclick = () => {
    if (!confirm("¿Eliminar este proveedor del directorio?")) return;
    state.proveedores = state.proveedores.filter(p => p.id !== b.dataset.del);
    saveState(); renderComprobantes();
  });
}

let provEditId = null;
function openProvModal(id) {
  provEditId = id || null;
  const p = id ? state.proveedores.find(x=>x.id===id) : {};
  $("#prov-modal-title").textContent = id ? "Editar proveedor" : "Nuevo proveedor";
  $("#p-nombre").value = p?.nombre || "";
  $("#p-cuit").value = p?.cuit || "";
  $("#p-rubro").value = p?.rubro || "";
  $("#p-contacto").value = p?.contacto || "";
  $("#p-email").value = p?.email || "";
  $("#p-telefono").value = p?.telefono || "";
  $("#p-cbu").value = p?.cbu || "";
  $("#p-plazo").value = p?.plazoPago || "";
  const sel = $("#p-iva");
  sel.innerHTML = CONDICIONES_IVA.map(c=>`<option value="${c}" ${p?.condicionIVA===c?"selected":""}>${c}</option>`).join("");
  $("#prov-modal").classList.remove("hidden");
  setTimeout(()=>$("#p-nombre").focus(), 50);
}
function closeProvModal() { $("#prov-modal").classList.add("hidden"); }
function saveProvFromModal() {
  const nombre = $("#p-nombre").value.trim();
  if (!nombre) { alert("Ingresá el nombre del proveedor."); return; }
  const data = {
    nombre, cuit: $("#p-cuit").value.trim(), rubro: $("#p-rubro").value.trim(),
    contacto: $("#p-contacto").value.trim(), email: $("#p-email").value.trim(),
    telefono: $("#p-telefono").value.trim(), cbu: $("#p-cbu").value.trim(),
    condicionIVA: $("#p-iva").value, plazoPago: parseInt($("#p-plazo").value) || null,
  };
  if (provEditId) {
    const p = state.proveedores.find(x=>x.id===provEditId);
    Object.assign(p, data);
  } else {
    state.proveedores.push({ ...data, id: "prov" + Math.random().toString(36).slice(2,8) });
  }
  saveState();
  closeProvModal();
  renderComprobantes();
}

function renderComprobantes() {
  const wrap = $("#comp-wrap");
  if (compTab === "proveedores") return renderProveedores(wrap);
  const tipo = compTab;
  const esCobrar = tipo === "cobrar";
  const comps = state.comprobantes.filter(c => c.tipo === tipo);
  const pend = comps.filter(c => c.estado !== "saldado");

  const totalPend = pend.reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
  const vencidos = pend.filter(c => diasAtraso(c) > 0);
  const totalVencido = vencidos.reduce((s,c)=>s+(parseFloat(c.monto)||0),0);
  const dso = calcularDSO(tipo);

  const buckets = { corriente:0, "1-30":0, "31-60":0, "61-90":0, "90+":0 };
  pend.forEach(c => { buckets[agingBucket(diasAtraso(c))] += (parseFloat(c.monto)||0); });
  const ccyRef = pend[0]?.moneda || "ARS";
  const maxBucket = Math.max(...Object.values(buckets), 1);

  const estadoBadge = (c) => {
    const e = estadoComp(c);
    const map = { saldado:["Saldada","st-ok"], vencido:["Vencida","st-bad"], por_vencer:["Por vencer","st-warn"], pendiente:["Pendiente","st-neutral"] };
    const [txt, cls] = map[e];
    const d = diasAtraso(c);
    const extra = e === "vencido" ? ` (${d}d)` : (e === "por_vencer" && d < 0 ? ` (en ${-d}d)` : "");
    return `<span class="comp-badge ${cls}">${txt}${extra}</span>`;
  };

  const filaComp = (c) => `<tr class="comp-row" data-id="${c.id}">
    <td class="comp-contra"><b>${h(c.contraparte || "—")}</b><small>${h(c.numero || "")}</small></td>
    <td class="mono">${moneyC(c.monto, c.moneda)}</td>
    <td>${fmtDateFull(c.emision)}</td>
    <td>${fmtDateFull(c.vencimiento)}</td>
    <td>${estadoBadge(c)}</td>
    <td class="comp-actions">
      ${c.estado !== "saldado" ? `<button class="comp-saldar-btn" data-saldar="${c.id}">${esCobrar ? "Cobré" : "Pagué"}</button>` : `<span class="muted">${fmtDateShort(c.fechaSaldado||"")}</span>`}
      <button class="comp-del-btn" data-del="${c.id}" title="Eliminar">×</button>
    </td>
  </tr>`;

  const orden = [...comps].sort((a,b) => {
    if ((a.estado==="saldado") !== (b.estado==="saldado")) return a.estado==="saldado" ? 1 : -1;
    return new Date(a.vencimiento) - new Date(b.vencimiento);
  });

  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Tesorería</div>
        <h2 class="inv-title">Cobranzas y Pagos</h2>
        <p class="inv-sub">Administrá tus facturas por cobrar y por pagar, con vencimientos y antigüedad de deuda. Todo lo pendiente ya se refleja en tu flujo de caja proyectado.</p>
      </div>
      <div class="comp-head-actions">
        <button class="btn-ghost" id="afip-import-btn">↑ Importar de AFIP</button>
        <button class="btn-primary" id="comp-add">+ Nueva factura</button>
      </div>
    </div>
    <input type="file" id="afip-file" accept=".xlsx,.xlsm" style="display:none">

    <div class="comp-tabs">
      <button class="comp-tab ${esCobrar?"active":""}" data-tab="cobrar">Por cobrar</button>
      <button class="comp-tab ${!esCobrar?"active":""}" data-tab="pagar">Por pagar</button>
      <button class="comp-tab" data-tab="proveedores">Proveedores</button>
    </div>

    <div class="comp-kpis">
      <div class="kpi"><div class="kpi-label">${esCobrar?"Total a cobrar":"Total a pagar"}</div><div class="kpi-value">${moneyC(totalPend, ccyRef)}</div><div class="kpi-sub">${pend.length} factura${pend.length!==1?"s":""} pendiente${pend.length!==1?"s":""}</div></div>
      <div class="kpi"><div class="kpi-label">Vencido</div><div class="kpi-value ${totalVencido>0?"neg":""}">${moneyC(totalVencido, ccyRef)}</div><div class="kpi-sub">${vencidos.length} vencida${vencidos.length!==1?"s":""}</div></div>
      <div class="kpi"><div class="kpi-label">${esCobrar?"DSO (días de cobro)":"DPO (días de pago)"}</div><div class="kpi-value">${dso!==null?dso+" días":"—"}</div><div class="kpi-sub">promedio del período</div></div>
    </div>

    <div class="table-card" style="margin-top:18px">
      <div class="chart-head"><h2>Antigüedad de la deuda (aging)</h2></div>
      <div class="aging-bars">
        ${Object.keys(buckets).map(k => `
          <div class="aging-col">
            <div class="aging-bar-wrap"><div class="aging-bar ${k==='corriente'?'ok':(k==='90+'||k==='61-90'?'bad':'warn')}" style="height:${Math.round((buckets[k]/maxBucket)*100)}%"></div></div>
            <div class="aging-val">${buckets[k]?moneyC(buckets[k],ccyRef):"·"}</div>
            <div class="aging-lbl">${AGING_LABELS[k]}</div>
          </div>`).join("")}
      </div>
    </div>

    <div class="table-card" style="margin-top:16px">
      <div class="chart-head"><h2>${esCobrar?"Facturas por cobrar":"Facturas por pagar"}</h2></div>
      ${orden.length ? `<div class="cf-table-scroll"><table class="cf-table">
        <thead><tr><th>${esCobrar?"Cliente":"Proveedor"}</th><th>Monto</th><th>Emisión</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead>
        <tbody>${orden.map(filaComp).join("")}</tbody>
      </table></div>` : `<p class="cf-empty">No hay facturas cargadas. Tocá "Nueva factura" para empezar.</p>`}
    </div>`;

  $$(".comp-tab").forEach(b => b.onclick = () => { compTab = b.dataset.tab; renderComprobantes(); });
  $("#comp-add").onclick = () => openCompModal(compTab);
  $$(".comp-saldar-btn").forEach(b => b.onclick = () => saldarComprobante(b.dataset.saldar));
  $$(".comp-del-btn").forEach(b => b.onclick = () => eliminarComprobante(b.dataset.del));
  // Import de AFIP (Libro IVA Compras)
  const afipBtn = $("#afip-import-btn");
  if (afipBtn) {
    afipBtn.onclick = () => $("#afip-file").click();
    $("#afip-file").onchange = (e) => importarAfip(e);
  }
}

// ── Import del Libro IVA Compras de AFIP ──────────────────
let _afipData = null; // guarda el resultado del parseo para confirmar
async function importarAfip(e) {
  const file = e.target.files[0];
  if (!file) return;
  const btn = $("#afip-import-btn");
  const orig = btn.textContent;
  btn.textContent = "Leyendo…";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/afip/libro-iva", { method: "POST", body: fd });
    const data = await res.json();
    if (!data.ok) { alert(data.error || "No se pudo leer el archivo de AFIP."); return; }
    _afipData = data;
    openAfipModal(data);
  } catch {
    alert("Error al leer el archivo. Verificá que sea el Libro IVA de AFIP en Excel.");
  } finally {
    btn.textContent = orig;
    e.target.value = "";
  }
}

function openAfipModal(data) {
  const r = data.resumen;
  const body = $("#afip-modal-body");
  // Cuántos proveedores son nuevos (no están ya en el directorio por CUIT)
  const cuitsExistentes = new Set(state.proveedores.map(p => (p.cuit||"").replace(/\D/g,"")));
  const provNuevos = data.proveedores.filter(p => !cuitsExistentes.has(p.cuit));

  body.innerHTML = `
    <p class="afip-intro">Leímos tu <b>Libro IVA Compras</b> (hoja "${h(r.sheet)}"). Esto es lo que encontramos:</p>
    <div class="afip-kpis">
      <div class="afip-kpi"><b>${r.proveedores}</b><small>proveedores</small><span>${provNuevos.length} nuevos</span></div>
      <div class="afip-kpi"><b>${r.comprobantes}</b><small>facturas de compra</small></div>
      <div class="afip-kpi"><b>${money(r.total_iva)}</b><small>IVA discriminado</small></div>
      <div class="afip-kpi"><b>${money(r.total)}</b><small>total facturado</small></div>
    </div>

    <div class="afip-choices">
      <label class="afip-choice">
        <input type="checkbox" id="afip-imp-prov" ${provNuevos.length?"checked":""} ${provNuevos.length?"":"disabled"}>
        <span><b>Cargar ${provNuevos.length} proveedores nuevos</b> al directorio (CUIT + razón social)${provNuevos.length?"":" — ya los tenés todos"}</span>
      </label>
      <label class="afip-choice">
        <input type="checkbox" id="afip-imp-comp">
        <span><b>Cargar las ${r.comprobantes} facturas</b> como cuentas por pagar (con IVA discriminado)</span>
      </label>
    </div>
    <p class="afip-warn" id="afip-comp-warn" style="display:none">⚠️ Son muchas facturas. Se cargarán todas como pendientes de pago — revisá los vencimientos después.</p>

    <details class="afip-preview">
      <summary>Ver los primeros proveedores</summary>
      <table class="afip-table">
        <thead><tr><th>CUIT</th><th>Proveedor</th><th>Comp.</th><th>Total</th></tr></thead>
        <tbody>${data.proveedores.slice(0,15).map(p => `<tr>
          <td class="mono">${h(p.cuitFmt)}</td><td>${h(p.nombre)}</td>
          <td>${p.comprobantes}</td><td class="mono">${money(p.total)}</td></tr>`).join("")}</tbody>
      </table>
    </details>`;

  $("#afip-imp-comp").onchange = (ev) => {
    $("#afip-comp-warn").style.display = ev.target.checked ? "" : "none";
  };
  $("#afip-modal").classList.remove("hidden");
}
function closeAfipModal() { $("#afip-modal").classList.add("hidden"); _afipData = null; }

function confirmarAfip() {
  if (!_afipData) return;
  const impProv = $("#afip-imp-prov")?.checked;
  const impComp = $("#afip-imp-comp")?.checked;
  let nProv = 0, nComp = 0;

  if (impProv) {
    const cuitsExistentes = new Set(state.proveedores.map(p => (p.cuit||"").replace(/\D/g,"")));
    _afipData.proveedores.forEach(p => {
      if (cuitsExistentes.has(p.cuit)) return;
      state.proveedores.push({
        id: "prov" + Math.random().toString(36).slice(2,8),
        nombre: p.nombre, cuit: p.cuitFmt, rubro: "", contacto: "",
        email: "", telefono: "", cbu: "",
        condicionIVA: "Responsable Inscripto", plazoPago: 30,
      });
      nProv++;
    });
  }

  if (impComp) {
    const cuentaDefault = state.accounts.find(a => a.moneda === "ARS" && a.tipo !== "efectivo" && a.tipo !== "comitente")?.id
      || state.accounts[0]?.id;
    _afipData.comprobantes.forEach(c => {
      // Vencimiento estimado: emisión + 30 días (AFIP no trae fecha de pago)
      const venc = c.emision ? addDaysToISO(c.emision, 30) : new Date().toISOString().slice(0,10);
      const comp = {
        id: compId(), tipo: "pagar", contraparte: c.contraparte,
        cuit: c.cuit, numero: c.numero, tipoComprobante: c.tipoComprobante,
        monto: c.monto, moneda: c.moneda,
        account: cuentaDefault,
        emision: c.emision || new Date().toISOString().slice(0,10),
        vencimiento: venc,
        categoria: "proveedores", estado: "pendiente",
        // Impuestos discriminados (de AFIP, sin estimar)
        neto: c.neto, noGravado: c.noGravado, exento: c.exento, iva: c.iva,
        origen: "afip",
      };
      state.comprobantes.push(comp);
      generarMovComprobante(comp);
      nComp++;
    });
  }

  closeAfipModal();
  saveState();
  if (impComp) project();
  renderComprobantes();
  let msg = [];
  if (nProv) msg.push(`${nProv} proveedores`);
  if (nComp) msg.push(`${nComp} facturas`);
  alert(msg.length ? `Importado de AFIP: ${msg.join(" y ")}.` : "No se importó nada (elegí al menos una opción).");
}

let compModalTipo = "cobrar";
function openCompModal(tipo) {
  compModalTipo = tipo || "cobrar";
  setCompMode(compModalTipo);
  $("#c-contraparte").value = "";
  $("#c-numero").value = "";
  $("#c-monto").value = "";
  ["c-neto","c-iva","c-nograv","c-exento"].forEach(id => { if($("#"+id)) $("#"+id).value = ""; });
  $("#c-emision").value = new Date().toISOString().slice(0,10);
  const v = new Date(); v.setDate(v.getDate()+30);
  $("#c-vencimiento").value = v.toISOString().slice(0,10);
  syncCompAccount();
  syncCompCategoria();
  // Auto-calcular el total desde el desglose de impuestos
  const recalcTotal = () => {
    const neto = parseFloat($("#c-neto").value) || 0;
    const iva = parseFloat($("#c-iva").value) || 0;
    const ng = parseFloat($("#c-nograv").value) || 0;
    const ex = parseFloat($("#c-exento").value) || 0;
    const suma = neto + iva + ng + ex;
    if (suma > 0) $("#c-monto").value = Math.round(suma);
  };
  ["c-neto","c-iva","c-nograv","c-exento"].forEach(id => { if($("#"+id)) $("#"+id).oninput = recalcTotal; });
  $("#comp-modal").classList.remove("hidden");
  setTimeout(()=>$("#c-contraparte").focus(), 50);
}
function closeCompModal() { $("#comp-modal").classList.add("hidden"); }
function setCompMode(tipo) {
  compModalTipo = tipo;
  $$(".comp-mode").forEach(b => b.classList.toggle("active", b.dataset.ctipo === tipo));
  $("#c-contra-label").textContent = tipo === "cobrar" ? "Cliente" : "Proveedor";
  $("#comp-modal-title").textContent = tipo === "cobrar" ? "Nueva factura a cobrar" : "Nueva factura a pagar";
  syncCompCategoria();
}
function syncCompAccount() {
  $("#c-account").innerHTML = state.accounts.map(a =>
    `<option value="${a.id}">${h(a.name)}${a.moneda==="USD"?" (USD)":""}</option>`).join("");
  const acc = state.accounts.find(a=>a.id===$("#c-account").value);
  $("#c-cur").textContent = acc && acc.moneda==="USD" ? "US$" : "$";
}
function syncCompCategoria() {
  const flujo = compModalTipo === "cobrar" ? "in" : "out";
  const cats = CATEGORIAS.filter(c => c.flujo === flujo);
  $("#c-categoria").innerHTML = cats.map(c => `<option value="${c.v}">${c.label}</option>`).join("");
}
function saveCompFromModal() {
  const contraparte = $("#c-contraparte").value.trim();
  const monto = parseFloat($("#c-monto").value);
  const account = $("#c-account").value;
  const acc = state.accounts.find(a=>a.id===account);
  if (!contraparte) { alert("Ingresá el nombre del cliente/proveedor."); return; }
  if (!monto) { alert("Ingresá el monto."); return; }

  const comp = {
    id: compId(), tipo: compModalTipo, contraparte,
    numero: $("#c-numero").value.trim(),
    monto: Math.abs(monto), moneda: acc ? acc.moneda : "ARS", account,
    emision: $("#c-emision").value, vencimiento: $("#c-vencimiento").value,
    categoria: $("#c-categoria").value, estado: "pendiente",
    // Impuestos discriminados (opcionales)
    neto: parseFloat($("#c-neto").value) || 0,
    iva: parseFloat($("#c-iva").value) || 0,
    noGravado: parseFloat($("#c-nograv").value) || 0,
    exento: parseFloat($("#c-exento").value) || 0,
  };
  state.comprobantes.push(comp);
  generarMovComprobante(comp);
  closeCompModal();
  project();
  switchView("comprobantes");
}

function generarMovComprobante(comp) {
  state.movements = state.movements.filter(m => m.compId !== comp.id);
  const signo = comp.tipo === "cobrar" ? 1 : -1;
  const fecha = comp.estado === "saldado" ? (comp.fechaSaldado || comp.vencimiento) : comp.vencimiento;
  state.movements.push({
    label: `${comp.tipo === "cobrar" ? "Cobranza" : "Pago"}: ${comp.contraparte}${comp.numero ? " ("+comp.numero+")" : ""}`,
    amount: signo * Math.abs(comp.monto),
    date: fecha, recurrence: "none",
    medio: "transferencia", account: comp.account,
    categoria: comp.categoria,
    compId: comp.id, movTipo: comp.tipo === "cobrar" ? "cobranza" : "pago",
  });
}

function saldarComprobante(id) {
  const comp = state.comprobantes.find(c => c.id === id);
  if (!comp) return;
  const hoy = new Date().toISOString().slice(0,10);
  const txt = prompt(`Marcar como ${comp.tipo === "cobrar" ? "cobrada" : "pagada"}: ${comp.contraparte}\n\nFecha (dejá vacío = hoy):`, hoy);
  if (txt === null) return;
  comp.estado = "saldado";
  comp.fechaSaldado = txt.trim() || hoy;
  generarMovComprobante(comp);
  project();
  renderComprobantes();
}

function eliminarComprobante(id) {
  if (!confirm("¿Eliminar esta factura? También se quita su movimiento del flujo.")) return;
  state.comprobantes = state.comprobantes.filter(c => c.id !== id);
  state.movements = state.movements.filter(m => m.compId !== id);
  project();
  renderComprobantes();
}

// ═══ SALDOS (tablero consolidado) ════════════════════════
function renderSaldos() {
  const wrap = $("#saldos-wrap");
  const monedas = [...new Set(state.accounts.map(a => a.moneda))];

  // Saldo total por moneda + colocado
  const bloqueMoneda = (ccy) => {
    const accts = state.accounts.filter(a => a.moneda === ccy);
    const liq = accts.reduce((s,a) => s + saldoCuentaAFecha(a), 0);
    const col = totalColocado(ccy);
    const total = liq + col;
    const pctCol = total > 0 ? Math.round((col/total)*100) : 0;
    return `
      <div class="saldo-ccy-card">
        <div class="saldo-ccy-head">
          <span class="saldo-ccy-name">${ccy === "USD" ? "US$ Dólares" : "$ Pesos"}</span>
          <span class="saldo-ccy-total">${moneyC(total, ccy)}</span>
        </div>
        <div class="saldo-split">
          <div><small>Líquido</small><b>${moneyC(liq, ccy)}</b></div>
          <div><small>Colocado</small><b class="col">${moneyC(col, ccy)}</b></div>
        </div>
        ${col > 0 ? `<div class="liq-bar"><div class="liq-fill-liq" style="width:${100-pctCol}%"></div><div class="liq-fill-col" style="width:${pctCol}%"></div></div>` : ""}
      </div>`;
  };

  // Tabla de cuentas: saldo hoy + hace 30 días + variación
  const filaCuenta = (a) => {
    const hoy = saldoCuentaAFecha(a);
    return `<tr>
      <td class="sc-name"><b>${h(a.name)}</b><small>${a.tipo === "efectivo" ? "Efectivo" : h(bancoShort(a.banco)) + " · " + tipoLabel(a.tipo)}</small></td>
      <td class="mono ${hoy < 0 ? "neg" : ""}">${moneyC(hoy, a.moneda)}</td>
    </tr>`;
  };

  // Estado de conciliación (informativo: cuántos movimientos hay cargados)
  const nMovs = state.movements.filter(m => !m.movTipo).length;
  const nInvs = state.investments.filter(invActiva).length;

  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Tesorería</div>
        <h2 class="inv-title">Posición de caja</h2>
        <p class="inv-sub">Tu posición completa: cuánto tenés en cada cuenta, cómo evolucionó, y cuánto está líquido vs invertido.</p>
      </div>
    </div>

    <div class="consulta-card">
      <div class="consulta-head">
        <div>
          <h3>Consultá tu saldo de un día</h3>
          <p>Elegí una fecha y te digo cuánto vas a tener y de qué cuenta conviene sacar.</p>
        </div>
        <div class="consulta-controls">
          <button class="consulta-quick" data-cq="hoy">Hoy</button>
          <button class="consulta-quick" data-cq="manana">Mañana</button>
          <button class="consulta-quick" data-cq="semana">En 7 días</button>
          <input type="date" id="consulta-fecha" value="${new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div id="consulta-result"></div>
    </div>

    <div class="saldos-ccy-row">
      ${monedas.map(bloqueMoneda).join("")}
    </div>

    <div class="table-card" style="margin-top:20px">
      <div class="chart-head"><h2>Saldo por cuenta</h2></div>
      <div class="cf-table-scroll">
        <table class="cf-table">
          <thead><tr><th>Cuenta</th><th>Saldo hoy</th></tr></thead>
          <tbody>${state.accounts.map(filaCuenta).join("")}</tbody>
        </table>
      </div>
    </div>

    <div class="saldos-chart-card table-card" style="margin-top:16px">
      <div class="chart-head"><h2>Evolución del saldo total</h2></div>
      <div id="saldos-chart"></div>
    </div>

    <div class="saldos-info-row">
      <div class="saldos-info-card">
        <div class="si-num">${nMovs}</div>
        <div class="si-label">Movimientos cargados</div>
      </div>
      <div class="saldos-info-card">
        <div class="si-num">${nInvs}</div>
        <div class="si-label">Inversiones activas</div>
      </div>
      <div class="saldos-info-card link" id="saldos-to-concil">
        <div class="si-num">→</div>
        <div class="si-label">Conciliar con el banco</div>
      </div>
    </div>`;

  // Gráfico de evolución del saldo total (últimos 90 + próximos 90)
  renderSaldosChart();
  $("#saldos-to-concil")?.addEventListener("click", () => switchView("conciliacion"));

  // Consultor de saldo por día
  const fechaInput = $("#consulta-fecha");
  const runConsulta = () => consultarSaldoDia(fechaInput.value);
  fechaInput?.addEventListener("change", runConsulta);
  $$(".consulta-quick").forEach(b => b.addEventListener("click", () => {
    const d = new Date();
    if (b.dataset.cq === "manana") d.setDate(d.getDate()+1);
    else if (b.dataset.cq === "semana") d.setDate(d.getDate()+7);
    fechaInput.value = d.toISOString().slice(0,10);
    runConsulta();
  }));
  runConsulta(); // mostrar hoy por defecto
}

// Responde: a la fecha X, cuánto tenés por cuenta y de dónde conviene sacar
function consultarSaldoDia(fechaISO) {
  const host = $("#consulta-result");
  if (!host || !fechaISO) return;
  const hoy = new Date().toISOString().slice(0,10);
  const esFuturo = fechaISO > hoy;
  const esPasado = fechaISO < hoy;

  // Saldo por cuenta ARS a esa fecha
  const cuentasARS = state.accounts.filter(a => a.moneda === "ARS")
    .map(a => ({ acc: a, saldo: saldoCuentaAFecha(a, fechaISO) }))
    .sort((a,b) => b.saldo - a.saldo);
  const cuentasUSD = state.accounts.filter(a => a.moneda === "USD")
    .map(a => ({ acc: a, saldo: saldoCuentaAFecha(a, fechaISO) }));
  const totalARS = cuentasARS.reduce((s,c) => s+c.saldo, 0);
  const totalUSD = cuentasUSD.reduce((s,c) => s+c.saldo, 0);

  // ¿Hay alguna cuenta en rojo ese día?
  const enRojo = cuentasARS.filter(c => c.saldo < 0);
  // La cuenta con más plata (de dónde sacar)
  const masFondos = cuentasARS[0];

  const fechaTxt = new Date(fechaISO+"T00:00:00").toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"});
  const cuando = esFuturo ? "vas a tener" : esPasado ? "tenías" : "tenés";

  let recomendacion = "";
  if (enRojo.length) {
    const falta = Math.abs(enRojo.reduce((s,c)=>s+c.saldo,0));
    const puede = masFondos && masFondos.saldo > 0;
    recomendacion = `<div class="consulta-warn">
      ⚠️ ${enRojo.map(c=>h(c.acc.name)).join(", ")} ${enRojo.length>1?"quedan":"queda"} en rojo ese día.
      ${puede ? `Cubrí el descubierto transfiriendo ${moneyC(falta,"ARS")} desde <b>${h(masFondos.acc.name)}</b> (tiene ${moneyC(masFondos.saldo,"ARS")}).` : "No tenés otra cuenta con fondos suficientes ese día — revisá el flujo."}
    </div>`;
  } else if (masFondos) {
    recomendacion = `<div class="consulta-tip">
      💡 Si necesitás sacar plata ese día, la cuenta con más fondos es <b>${h(masFondos.acc.name)}</b> con ${moneyC(masFondos.saldo,"ARS")}.
    </div>`;
  }

  host.innerHTML = `
    <div class="consulta-total">
      <div>
        <span class="ct-label">El ${fechaTxt} ${cuando}:</span>
        <span class="ct-value ${totalARS<0?'neg':''}">${moneyC(totalARS,"ARS")}</span>
        ${totalUSD ? `<span class="ct-usd">+ ${moneyC(totalUSD,"USD")}</span>` : ""}
      </div>
    </div>
    <div class="consulta-cuentas">
      ${cuentasARS.map(c => `<div class="consulta-cuenta ${c.saldo<0?'neg':''}">
        <span class="cc-name">${h(c.acc.name)}</span>
        <span class="cc-saldo">${moneyC(c.saldo,"ARS")}</span>
      </div>`).join("")}
      ${cuentasUSD.filter(c=>c.saldo).map(c => `<div class="consulta-cuenta">
        <span class="cc-name">${h(c.acc.name)}</span>
        <span class="cc-saldo">${moneyC(c.saldo,"USD")}</span>
      </div>`).join("")}
    </div>
    ${recomendacion}
    ${renderPagosDelDia(fechaISO)}`;
}

// Lista de movimientos (cobros y pagos) que caen en una fecha
function renderPagosDelDia(fechaISO) {
  const items = [];
  state.movements.forEach((m) => {
    if (!m.amount || !m.date) return;
    // Expandir recurrencia y ver si cae ese día
    const base = new Date(m.date + "T00:00:00");
    const target = new Date(fechaISO + "T00:00:00");
    let cae = false;
    if (m.recurrence === "none" || !m.recurrence) {
      cae = m.date === fechaISO;
    } else {
      let d = new Date(base), g = 0;
      while (d <= target && g < 3000) {
        if (d.toISOString().slice(0,10) === fechaISO) { cae = true; break; }
        if (m.recurrence==="weekly") d.setDate(d.getDate()+7);
        else if (m.recurrence==="quincenal") d.setDate(d.getDate()+14);
        else if (m.recurrence==="monthly") d.setMonth(d.getMonth()+1);
        else if (m.recurrence==="quarterly") d.setMonth(d.getMonth()+3);
        else break;
        g++;
      }
    }
    if (cae) items.push(m);
  });

  if (!items.length) {
    return `<div class="pagos-dia"><h4>Movimientos de ese día</h4><p class="pd-empty">No hay cobros ni pagos programados para ese día.</p></div>`;
  }

  const cobros = items.filter(m => m.amount > 0).sort((a,b)=>b.amount-a.amount);
  const pagos = items.filter(m => m.amount < 0).sort((a,b)=>a.amount-b.amount);
  const totalCobros = cobros.reduce((s,m)=>s+m.amount,0);
  const totalPagos = pagos.reduce((s,m)=>s+Math.abs(m.amount),0);

  const fila = (m) => {
    const ccy = movCurrency(m);
    return `<div class="pd-item">
      <span class="pd-label">${h(m.label||"(sin concepto)")}</span>
      <span class="pd-acc">${h(accountName(m.account))}</span>
      <span class="pd-monto ${m.amount>0?'in':'out'}">${m.amount>0?'+':'−'}${moneyC(Math.abs(m.amount), ccy)}</span>
    </div>`;
  };

  return `<div class="pagos-dia">
    <h4>Cobros y pagos de ese día</h4>
    ${cobros.length ? `<div class="pd-group"><span class="pd-group-t in">Entra</span>${cobros.map(fila).join("")}</div>` : ""}
    ${pagos.length ? `<div class="pd-group"><span class="pd-group-t out">Sale</span>${pagos.map(fila).join("")}</div>` : ""}
    <div class="pd-neto">
      <span>Neto del día</span>
      <b class="${totalCobros-totalPagos>=0?'in':'out'}">${totalCobros-totalPagos>=0?'+':'−'}${moneyC(Math.abs(totalCobros-totalPagos),"ARS")}</b>
    </div>
  </div>`;
}

function renderSaldosChart() {
  const host = $("#saldos-chart");
  if (!host) return;
  // Serie de saldo total consolidado (ARS) de -60 a +90 días
  const today = new Date();
  const from = new Date(today); from.setDate(from.getDate()-60);
  const to = new Date(today); to.setDate(to.getDate()+90);
  const prevCcy = state.cfCurrency, prevAcct = state.cfAccount;
  state.cfCurrency = "ARS"; state.cfAccount = "";
  const days = computeDaySeries(from.toISOString().slice(0,10), to.toISOString().slice(0,10));
  state.cfCurrency = prevCcy; state.cfAccount = prevAcct;
  if (!days.length) { host.innerHTML = ""; return; }

  const W = 900, H = 260, P = { t: 16, r: 16, b: 28, l: 64 };
  const iw = W-P.l-P.r, ih = H-P.t-P.b;
  const bals = days.map(d=>d.balance);
  let ymin = Math.min(0,...bals), ymax = Math.max(...bals,0);
  const pad = (ymax-ymin)*0.1 || 1000; ymin-=pad; ymax+=pad;
  const X = (i) => P.l + (i/(days.length-1))*iw;
  const Y = (v) => P.t + ih - ((v-ymin)/(ymax-ymin))*ih;
  const todayIdx = days.findIndex(d => d.date === today.toISOString().slice(0,10));
  const pts = days.map((d,i)=>`${X(i).toFixed(1)},${Y(d.balance).toFixed(1)}`).join(" ");
  const area = `${P.l},${Y(ymin).toFixed(1)} ${pts} ${(P.l+iw).toFixed(1)},${Y(ymin).toFixed(1)}`;
  const zeroY = Y(0).toFixed(1);
  const todayX = todayIdx >= 0 ? X(todayIdx).toFixed(1) : null;

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="saldos-svg">
    <polygon points="${area}" fill="rgba(76,141,255,.10)"/>
    <line x1="${P.l}" y1="${zeroY}" x2="${P.l+iw}" y2="${zeroY}" stroke="#E45858" stroke-dasharray="4 4" stroke-width="1"/>
    ${todayX ? `<line x1="${todayX}" y1="${P.t}" x2="${todayX}" y2="${P.t+ih}" stroke="#94A3B8" stroke-dasharray="3 3" stroke-width="1"/><text x="${todayX}" y="${P.t-4}" fill="#64748B" font-size="10" text-anchor="middle">hoy</text>` : ""}
    <polyline points="${pts}" fill="none" stroke="#4C8DFF" stroke-width="2"/>
    <text x="4" y="${Y(ymax).toFixed(1)}" fill="#94A3B8" font-size="10">${money(ymax)}</text>
    <text x="4" y="${Y(ymin).toFixed(1)+10}" fill="#94A3B8" font-size="10">${money(ymin)}</text>
  </svg>`;
}

function renderCartera() {
  const wrap = $("#cartera-wrap");
  const ccy = "ARS"; // la cartera muestra ARS + USD juntas en tarjetas separadas
  const invs = state.investments;

  // Liquidez hoy (suma de saldos a hoy en ARS)
  const liquidezHoy = (moneda) => {
    const today = new Date(); today.setHours(23,59,59,999);
    return state.accounts.filter(a => a.moneda === moneda).reduce((tot, a) => {
      let bal = parseFloat(a.opening)||0;
      state.movements.forEach((m) => {
        if (m.account !== a.id || !m.amount || !m.date) return;
        const base = new Date(m.date+"T00:00:00");
        if (m.recurrence === "none") { if (base <= today) bal += m.amount; }
        else { let d=new Date(base),g=0; while(d<=today&&g<2000){bal+=m.amount;
          if(m.recurrence==="weekly")d.setDate(d.getDate()+7);
          else if(m.recurrence==="quincenal")d.setDate(d.getDate()+14);
          else if(m.recurrence==="monthly")d.setMonth(d.getMonth()+1);
          else if(m.recurrence==="quarterly")d.setMonth(d.getMonth()+3);
          else break; g++;} }
      });
      return tot + bal;
    }, 0);
  };

  const liqARS = liquidezHoy("ARS"), colARS = totalColocado("ARS");
  const liqUSD = liquidezHoy("USD"), colUSD = totalColocado("USD");
  const hasUSDinv = liqUSD !== 0 || colUSD !== 0;

  // Tablero de liquidez: líquido vs colocado
  const tablero = (moneda, liq, col) => {
    const total = liq + col;
    const pctCol = total > 0 ? Math.round((col / total) * 100) : 0;
    return `
      <div class="liq-board">
        <div class="liq-head">
          <span class="liq-ccy">${moneda === "USD" ? "US$ Dólares" : "$ Pesos"}</span>
          <span class="liq-total">Patrimonio: ${moneyC(total, moneda)}</span>
        </div>
        <div class="liq-bar">
          <div class="liq-fill-liq" style="width:${100-pctCol}%" title="Líquido"></div>
          <div class="liq-fill-col" style="width:${pctCol}%" title="Colocado"></div>
        </div>
        <div class="liq-legend">
          <div class="liq-item">
            <span class="dot dot-liq"></span>
            <div><b>${moneyC(liq, moneda)}</b><small>Líquido disponible</small></div>
          </div>
          <div class="liq-item">
            <span class="dot dot-col"></span>
            <div><b>${moneyC(col, moneda)}</b><small>Colocado (vuelve)</small></div>
          </div>
        </div>
      </div>`;
  };

  // Tabla de colocaciones activas
  const activas = invs.filter(invActiva);
  const rescatadas = invs.filter((i) => !invActiva(i));

  const filaInv = (inv) => {
    const retorno = estimarRetorno(inv);
    const ganancia = retorno - (parseFloat(inv.monto) || 0);
    const diasRest = inv.fechaVenc
      ? Math.round((new Date(inv.fechaVenc+"T00:00:00") - new Date()) / 86400000)
      : null;
    let vencInfo;
    if (inv.fechaVenc) {
      const venc = fmtDateFull(inv.fechaVenc);
      vencInfo = diasRest >= 0 ? `${venc} · en ${diasRest} días` : `${venc} · vencida`;
    } else {
      // Sin vencimiento: mostrar el plazo de rescate
      const pr = inv.plazoRescate != null ? inv.plazoRescate : rescateSugerido(inv.tipo, inv.label);
      vencInfo = pr === 0 ? "Rescate T+0 (mismo día)" : pr === 1 ? "Rescate T+1 (24 hs)" : pr != null ? `Rescate T+${pr}` : "Sin vencimiento";
    }
    const activa = invActiva(inv);
    const acciones = activa
      ? `<button class="inv-rescatar-btn" data-resc="${inv.id}" title="Traer la plata de vuelta a la cuenta">Rescatar</button>
         <button class="inv-del-btn" data-del="${inv.id}" title="Eliminar">×</button>`
      : `<button class="inv-del-btn" data-del="${inv.id}" title="Eliminar">×</button>`;
    return `<tr class="inv-row" data-id="${inv.id}">
      <td><span class="inv-tag inv-${inv.tipo}">${tipoInvLabel(inv.tipo)}</span></td>
      <td class="inv-name">${h(inv.label || tipoInvLabel(inv.tipo))}${inv.sociedad ? `<br><small class="inv-soc">${h(inv.sociedad)}</small>` : ""}<br><small class="inv-acc">en ${h(accountName(inv.account))}</small></td>
      <td class="mono">${moneyC(inv.monto, inv.moneda)}</td>
      <td class="mono">${inv.rendimiento ? num2g(inv.rendimiento) + "%" : "—"}</td>
      <td>${vencInfo}</td>
      <td class="mono ${ganancia > 0 ? "in" : "muted"}">${ganancia > 0 ? "+" + moneyC(ganancia, inv.moneda) : "—"}</td>
      <td class="inv-actions">${acciones}</td>
    </tr>`;
  };

  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Tesorería</div>
        <h2 class="inv-title">Mis inversiones</h2>
        <p class="inv-sub">Todo lo que colocaste sigue siendo tuyo. Acá ves cuánto tenés líquido y cuánto está trabajando, y cuándo vuelve cada colocación.</p>
      </div>
      <button class="btn-primary" id="cartera-add">+ Registrar inversión</button>
    </div>

    <div class="liq-boards ${hasUSDinv ? "two" : ""}">
      ${tablero("ARS", liqARS, colARS)}
      ${hasUSDinv ? tablero("USD", liqUSD, colUSD) : ""}
    </div>

    <div class="table-card" style="margin-top:20px">
      <div class="chart-head"><h2>Colocaciones activas</h2></div>
      ${activas.length ? `<div class="cf-table-scroll"><table class="cf-table inv-table">
        <thead><tr><th>Tipo</th><th>Detalle</th><th>Monto</th><th>Rend.</th><th>Vencimiento</th><th>Ganancia est.</th><th></th></tr></thead>
        <tbody>${activas.map(filaInv).join("")}</tbody>
      </table></div>` : `<p class="cf-empty">Todavía no registraste inversiones. Tocá "Registrar inversión" para empezar.</p>`}
    </div>

    ${rescatadas.length ? `<div class="table-card" style="margin-top:16px">
      <div class="chart-head"><h2>Vencidas / rescatadas</h2></div>
      <div class="cf-table-scroll"><table class="cf-table inv-table">
        <thead><tr><th>Tipo</th><th>Detalle</th><th>Monto</th><th>Rend.</th><th>Vencimiento</th><th>Ganancia</th><th></th></tr></thead>
        <tbody>${rescatadas.map(filaInv).join("")}</tbody>
      </table></div>
    </div>` : ""}`;

  $("#cartera-add").onclick = () => openInvModal();
  $$(".inv-del-btn").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    eliminarInversion(b.dataset.del);
  });
  $$(".inv-rescatar-btn").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    rescatarInversion(b.dataset.resc);
  });
}

// Rescatar: traer la plata de vuelta a la cuenta (para FCI/dólares sin
// vencimiento, o para cerrar un plazo fijo antes de tiempo).
function rescatarInversion(id) {
  const inv = state.investments.find((i) => i.id === id);
  if (!inv) return;
  const sugerido = Math.round(estimarRetorno(inv));
  const hoy = new Date().toISOString().slice(0,10);
  const txt = prompt(
    `Rescatar "${inv.label}".\n\n¿Cuánto vuelve a la cuenta? (capital + lo que rindió)\nSugerido: ${sugerido}`,
    sugerido
  );
  if (txt === null) return;
  const monto = parseFloat(txt);
  if (!monto || monto <= 0) { alert("Ingresá un monto válido."); return; }
  // Fecha en que la plata efectivamente entra: hoy + plazo de rescate
  const pr = inv.plazoRescate != null ? inv.plazoRescate : (rescateSugerido(inv.tipo, inv.label) || 0);
  const fechaEntra = addDaysToISO(hoy, pr);
  // Marcar como rescatada
  inv.estado = "rescatada";
  inv.fechaRescate = hoy;
  inv.montoRescate = monto;
  // Si tenía un rescate automático futuro (plazo fijo con vencimiento), lo quitamos
  state.movements = state.movements.filter((m) => !(m.invId === inv.id && m.movTipo === "rescate"));
  // Generar el ingreso del rescate en la fecha de liquidación
  state.movements.push({
    label: pr > 0 ? `Rescate: ${inv.label} (liquida en T+${pr})` : `Rescate: ${inv.label}`,
    amount: Math.abs(monto),
    date: fechaEntra, recurrence: "none",
    medio: "transferencia", account: inv.account,
    invId: inv.id, movTipo: "rescate",
  });
  project();
  renderCartera();
}

// ── Modal de inversión ───────────────────────────────────
function openInvModal() {
  // Poblar selects
  $("#i-tipo").innerHTML = TIPOS_INVERSION.map(t => `<option value="${t.v}">${t.label}</option>`).join("");
  syncInvAccountSelect();
  $("#i-label").value = "";
  $("#i-sociedad").value = "";
  $("#i-monto").value = "";
  $("#i-fecha").value = new Date().toISOString().slice(0,10);
  $("#i-venc").value = "";
  $("#i-rend").value = "";
  updateInvTipo();
  updateInvPreview();
  $("#inv-modal").classList.remove("hidden");
  setTimeout(() => $("#i-label").focus(), 50);
}
function closeInvModal() { $("#inv-modal").classList.add("hidden"); }

function syncInvAccountSelect(tipoInv) {
  // Bonos, letras y cauciones salen de la cuenta comitente.
  // Plazo fijo, FCI y dólares salen de una cuenta bancaria (no comitente).
  const esBursatil = tipoInv === "bono" || tipoInv === "caucion";
  const cuentas = state.accounts.filter(a =>
    esBursatil ? a.tipo === "comitente" : a.tipo !== "comitente");
  const lista = cuentas.length ? cuentas : state.accounts;
  $("#i-account").innerHTML = lista.map(a =>
    `<option value="${a.id}">${h(a.name)}${a.moneda === "USD" ? " (USD)" : ""}${a.tipo==="comitente"&&a.broker?" · "+h(a.broker):""}</option>`).join("");
}

function updateInvTipo() {
  const tipoV = $("#i-tipo").value;
  // Re-filtrar las cuentas de origen según el tipo (bursátil → comitente)
  const prevAcc = $("#i-account").value;
  syncInvAccountSelect(tipoV);
  if (state.accounts.find(a => a.id === prevAcc && [...$("#i-account").options].some(o=>o.value===prevAcc))) {
    $("#i-account").value = prevAcc;
  }
  const tipo = TIPOS_INVERSION.find(t => t.v === tipoV);
  const acc = state.accounts.find(a => a.id === $("#i-account").value);
  $("#i-cur").textContent = acc && acc.moneda === "USD" ? "US$" : "$";
  // Mostrar/ocultar vencimiento según el tipo
  $("#i-venc-field").style.display = tipo && tipo.tieneVenc ? "" : "none";
  // El plazo de rescate solo aplica a instrumentos SIN vencimiento (FCI, dólares)
  const rescField = $("#i-rescate-field");
  if (rescField) {
    rescField.style.display = tipo && !tipo.tieneVenc ? "" : "none";
    // Sugerir el plazo por defecto del tipo
    if (tipo && !tipo.tieneVenc) {
      const sug = rescateSugerido(tipo.v, $("#i-label").value);
      $("#i-rescate").value = String(sug != null ? sug : 0);
    }
  }
  // Ajustar label del rendimiento
  if (tipo && tipo.tieneVenc) {
    $("#i-rend-label").textContent = "Rendimiento esperado (TNA %)";
    $("#i-rend-hint").textContent = "Tasa nominal anual. La usamos para estimar cuánto vuelve al vencimiento.";
  } else {
    $("#i-rend-label").textContent = "Rendimiento anual estimado (%)";
    $("#i-rend-hint").textContent = "Referencia anual. Sin vencimiento fijo, lo podés rescatar cuando quieras.";
  }
}

function updateInvPreview() {
  const monto = parseFloat($("#i-monto").value) || 0;
  const rend = parseFloat($("#i-rend").value) || 0;
  const tipo = TIPOS_INVERSION.find(t => t.v === $("#i-tipo").value);
  const acc = state.accounts.find(a => a.id === $("#i-account").value);
  const ccy = acc ? acc.moneda : "ARS";
  const box = $("#i-preview");
  if (!monto) { box.innerHTML = ""; return; }
  const inv = {
    monto, rendimiento: rend,
    fechaColocacion: $("#i-fecha").value,
    fechaVenc: (tipo && tipo.tieneVenc) ? $("#i-venc").value : null,
  };
  const retorno = estimarRetorno(inv);
  const ganancia = retorno - monto;
  box.innerHTML = `
    <div class="dv-row"><span>Colocás hoy</span><b>${moneyC(monto, ccy)}</b></div>
    ${inv.fechaVenc && ganancia > 0 ? `
    <div class="dv-row"><span>Vuelve el ${fmtDateShort(inv.fechaVenc)}</span><b class="in">${moneyC(retorno, ccy)}</b></div>
    <div class="dv-row"><span>Ganancia estimada</span><b class="in">+${moneyC(ganancia, ccy)}</b></div>` : ""}
    <p class="modal-note">La plata sale de tu cuenta hoy pero sigue siendo tuya: la vas a ver como "colocada", no como gasto.</p>`;
}

function saveInvFromModal() {
  const tipo = $("#i-tipo").value;
  const tipoDef = TIPOS_INVERSION.find(t => t.v === tipo);
  const label = $("#i-label").value.trim() || tipoInvLabel(tipo);
  const monto = parseFloat($("#i-monto").value);
  const account = $("#i-account").value;
  const acc = state.accounts.find(a => a.id === account);
  const fecha = $("#i-fecha").value;
  const venc = tipoDef.tieneVenc ? $("#i-venc").value : null;
  const rend = parseFloat($("#i-rend").value) || 0;

  if (!monto) { alert("Ingresá el monto a colocar."); return; }
  if (!account) { alert("Elegí de qué cuenta sale."); return; }
  if (tipoDef.tieneVenc && !venc) { alert("Ingresá la fecha de vencimiento."); return; }

  const inv = {
    id: invId(), tipo, label, monto: Math.abs(monto),
    sociedad: $("#i-sociedad").value.trim(),
    plazoRescate: tipoDef && !tipoDef.tieneVenc ? (parseInt($("#i-rescate").value) || 0) : null,
    moneda: acc ? acc.moneda : "ARS", account,
    fechaColocacion: fecha, fechaVenc: venc,
    rendimiento: rend, estado: "activa",
  };
  state.investments.push(inv);

  // ── El "calce": generar los movimientos en el cash flow ──
  // 1) Egreso hoy: sale de la cuenta (marcado como inversión, NO gasto)
  state.movements.push({
    label: `Colocación: ${label}`,
    amount: -Math.abs(monto),
    date: fecha, recurrence: "none",
    medio: "transferencia", account,
    invId: inv.id, movTipo: "inversion",
  });
  // 2) Ingreso futuro al vencimiento: vuelve capital + rendimiento
  if (venc) {
    const retorno = estimarRetorno(inv);
    state.movements.push({
      label: `Vencimiento: ${label}`,
      amount: Math.abs(retorno),
      date: venc, recurrence: "none",
      medio: "transferencia", account,
      invId: inv.id, movTipo: "rescate",
    });
  }

  closeInvModal();
  project();
  switchView("cartera");
}

function eliminarInversion(id) {
  if (!confirm("¿Eliminar esta inversión? También se quitan sus movimientos del flujo.")) return;
  state.investments = state.investments.filter(i => i.id !== id);
  state.movements = state.movements.filter(m => m.invId !== id);
  project();
  renderCartera();
}

async function renderDivisas() {
  const num2 = (v) => v == null ? "—" : new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const wrap = $("#divisas-wrap");
  wrap.innerHTML = `<div class="inv-head"><div>
    <div class="eyebrow">Dólar</div>
    <h2 class="inv-title">Comprar o vender dólares</h2>
    <p class="inv-sub">Simulá una operación de cambio entre una cuenta en pesos y una en dólares. Usa el tipo de cambio en vivo de la sección Variables.</p>
  </div></div>
  <div class="divisas-loading">Cargando cotizaciones…</div>`;

  let vars = null;
  try {
    const res = await fetch("/api/mercado/variables");
    vars = await res.json();
  } catch (e) { /* fallback abajo */ }

  const tc = {
    oficial: vars?.cotizaciones?.find(c => c.nombre === "Mayorista")?.valor || vars?.vars?.mayorista?.valor || null,
    mep: vars?.mep?.valor || null,
    ccl: vars?.ccl?.valor || null,
    blue: vars?.blue?.valor || null,
  };
  const stale = vars?.stale;

  const arsAccts = state.accounts.filter(a => a.moneda === "ARS");
  const usdAccts = state.accounts.filter(a => a.moneda === "USD");

  if (!usdAccts.length) {
    wrap.querySelector(".divisas-loading").outerHTML = `
      <div class="card" style="padding:24px">
        <p>Para operar dólares necesitás al menos una cuenta en USD. Agregala en <button class="cf-link" onclick="switchView('config')">Configuración</button>.</p>
      </div>`;
    return;
  }
  if (!arsAccts.length) {
    wrap.querySelector(".divisas-loading").outerHTML = `
      <div class="card" style="padding:24px"><p>Necesitás al menos una cuenta en pesos para operar.</p></div>`;
    return;
  }

  const tcPairs = [["mep","MEP"],["ccl","CCL"],["blue","Blue"],["oficial","Oficial"]].filter(([k]) => tc[k]);
  const tcOptions = tcPairs.map(([k,l]) => `<option value="${k}">${l} — $${num2(tc[k])}</option>`).join("");

  wrap.querySelector(".divisas-loading").outerHTML = `
    <div class="inv-board">
      <aside class="inv-controls ctrl-card">
        <div class="seg-toggle" id="dv-op">
          <button class="seg active" data-op="comprar">Comprar USD</button>
          <button class="seg" data-op="vender">Vender USD</button>
        </div>
        ${stale ? '<p class="modal-note">⚠ Cotización de la última foto guardada (mercado cerrado).</p>' : ''}
        <label class="field"><span>Tipo de cambio</span>
          <select id="dv-tc">${tcOptions}</select></label>
        <label class="field"><span>Cuenta en pesos</span>
          <select id="dv-ars">${arsAccts.map(a=>`<option value="${a.id}">${h(a.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Cuenta en dólares</span>
          <select id="dv-usd">${usdAccts.map(a=>`<option value="${a.id}">${h(a.name)}</option>`).join("")}</select></label>
        <label class="field"><span id="dv-amount-label">Monto en pesos a convertir</span>
          <div class="money-input"><em id="dv-cur">$</em><input type="number" id="dv-amount" placeholder="0" step="1000"></div></label>
        <label class="field"><span>Fecha de la operación</span>
          <input type="date" id="dv-date" value="${new Date().toISOString().slice(0,10)}"></label>
        <button class="btn-primary" id="dv-confirm" style="margin-top:8px">Registrar operación</button>
      </aside>
      <div class="inv-result">
        <div id="dv-preview" class="card" style="padding:22px"></div>
      </div>
    </div>`;

  const st = { op: "comprar", calc: null };

  const updatePreview = () => {
    const tcKey = $("#dv-tc").value;
    const rate = tc[tcKey] || 0;
    const amount = parseFloat($("#dv-amount").value) || 0;
    const op = st.op;
    $("#dv-cur").textContent = op === "comprar" ? "$" : "US$";
    $("#dv-amount-label").textContent = op === "comprar" ? "Monto en pesos a convertir" : "Monto en dólares a vender";
    let out;
    if (op === "comprar") {
      const usd = rate ? amount / rate : 0;
      out = `<div class="dv-calc">
        <div class="dv-row"><span>Pagás</span><b>${moneyC(amount,"ARS")}</b></div>
        <div class="dv-row"><span>Tipo de cambio (${tcKey.toUpperCase()})</span><b>$${num2(rate)}</b></div>
        <div class="dv-row big"><span>Recibís</span><b class="in">${moneyC(usd,"USD")}</b></div>
      </div>`;
      st.calc = { fromCcy: "ARS", toCcy: "USD", fromAmt: amount, toAmt: usd, rate };
    } else {
      const ars = amount * rate;
      out = `<div class="dv-calc">
        <div class="dv-row"><span>Vendés</span><b>${moneyC(amount,"USD")}</b></div>
        <div class="dv-row"><span>Tipo de cambio (${tcKey.toUpperCase()})</span><b>$${num2(rate)}</b></div>
        <div class="dv-row big"><span>Recibís</span><b class="in">${moneyC(ars,"ARS")}</b></div>
      </div>`;
      st.calc = { fromCcy: "USD", toCcy: "ARS", fromAmt: amount, toAmt: ars, rate };
    }
    $("#dv-preview").innerHTML = `<h3 style="font-family:Fraunces,serif;font-size:16px;margin-bottom:14px">Resumen de la operación</h3>${out}
      <p class="modal-note" style="margin-top:14px">Se registran dos movimientos: uno que sale de la cuenta de origen y otro que entra en la de destino, ambos en la fecha elegida.</p>`;
  };

  $$("#dv-op .seg").forEach(b => b.onclick = () => {
    $$("#dv-op .seg").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    st.op = b.dataset.op;
    updatePreview();
  });
  $("#dv-tc").onchange = updatePreview;
  $("#dv-amount").oninput = updatePreview;

  $("#dv-confirm").onclick = () => {
    const c = st.calc;
    if (!c || !c.fromAmt) { alert("Ingresá un monto."); return; }
    const arsAcc = $("#dv-ars").value, usdAcc = $("#dv-usd").value;
    const date = $("#dv-date").value;
    const tcKey = $("#dv-tc").value.toUpperCase();
    const fromAcc = c.fromCcy === "ARS" ? arsAcc : usdAcc;
    const toAcc = c.toCcy === "ARS" ? arsAcc : usdAcc;
    state.movements.push({ label: `Cambio ${c.fromCcy}→${c.toCcy} (${tcKey})`, amount: -Math.abs(c.fromAmt), date, recurrence: "none", medio: "transferencia", account: fromAcc });
    state.movements.push({ label: `Cambio ${c.fromCcy}→${c.toCcy} (${tcKey})`, amount: Math.abs(c.toAmt), date, recurrence: "none", medio: "transferencia", account: toAcc });
    project();
    alert("Operación registrada. Vas a verla en el flujo de ambas monedas.");
    $("#dv-amount").value = "";
    updatePreview();
  };

  updatePreview();
}

// ── Inversiones ──────────────────────────────────────────
async function renderInversiones() {
  const surplus = state.result ? state.result.summary.stable_surplus : 0;
  const wrap = $("#inv-wrap");
  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Invertir el excedente</div>
        <h2 class="inv-title">Colocá ${money(surplus)} en renta fija</h2>
        <p class="inv-sub">Elegí un instrumento y simulá cuánto y cuándo vas a cobrar. Los flujos salen del cronograma real de cada bono.</p>
      </div>
    </div>
    <div class="inv-board">
      <aside class="inv-controls ctrl-card">
        <label class="field">
          <span>Tipo</span>
          <select id="inv-kind">
            <option value="fci">FCI Money Market</option>
            <option value="caucion">Caución bursátil</option>
            <option value="plazofijo">Plazo fijo</option>
            <option value="lecap">Letra (LECAP)</option>
            <option value="soberano">Bono soberano</option>
            <option value="on">Obligación negociable</option>
          </select>
        </label>
        <div id="inv-fci-controls">
          <label class="field">
            <span>Monto a invertir</span>
            <div class="money-input"><em>$</em><input type="number" id="fci-amount" value="${Math.round(surplus)}" step="1000"></div>
            <small>Precargado con tu excedente colocable.</small>
          </label>
          <label class="field">
            <span>Días</span>
            <input type="number" id="fci-days" value="30" step="1" min="1">
            <small>Cuánto tiempo lo dejás colocado.</small>
          </label>
        </div>
        <div id="inv-bond-controls" class="hidden">
          <label class="field">
            <span>Instrumento</span>
            <select id="inv-symbol"><option value="">— cargando —</option></select>
          </label>
          <label class="field">
            <span>Monto a invertir</span>
            <div class="money-input"><em>$</em><input type="number" id="inv-amount" value="${Math.round(surplus)}" step="1000"></div>
          </label>
          <label class="field">
            <span>Precio (por 100 VN)</span>
            <input type="number" id="inv-price" value="72.5" step="0.01">
          </label>
        </div>
        <button class="btn-primary" id="inv-sim-btn">Simular inversión</button>
      </aside>
      <div class="inv-result" id="inv-result">
        <div class="inv-placeholder">Elegí un instrumento y tocá simular.</div>
      </div>
    </div>`;

  // Alternar controles según tipo
  const toggleControls = () => {
    const kind = $("#inv-kind").value;
    const simple = (kind === "fci" || kind === "caucion" || kind === "plazofijo");
    $("#inv-fci-controls").classList.toggle("hidden", !simple);
    $("#inv-bond-controls").classList.toggle("hidden", simple);
    // Para LECAP el precio lo trae el mercado, ocultamos el input de precio manual
    const priceField = $("#inv-price") ? $("#inv-price").closest(".field") : null;
    if (priceField) priceField.classList.toggle("hidden", kind === "lecap");
  };
  toggleControls();

  // Cargar instrumentos de bonos/lecaps según tipo
  const loadSymbols = async () => {
    const kind = $("#inv-kind").value;
    if (kind === "fci" || kind === "caucion" || kind === "plazofijo") return;
    let url, key, items;
    if (kind === "lecap") { url = "/api/inversiones/lecaps"; key = "lecaps"; }
    else if (kind === "soberano") { url = "/api/inversiones/soberanos"; key = "bonds"; }
    else { url = "/api/inversiones/ons"; key = "ons"; }
    const res = await fetch(url);
    const data = await res.json();
    items = data[key] || [];
    const sel = $("#inv-symbol");
    if (!items.length && kind === "lecap") {
      sel.innerHTML = `<option value="">— sin LECAPs en vivo (requiere BYMA) —</option>`;
      return;
    }
    sel.innerHTML = items.map((b) =>
      `<option value="${b.symbol || b.ticker}">${b.symbol || b.ticker}${b.name ? " · "+b.name : b.tipo ? " · "+b.tipo : ""}</option>`).join("");
  };
  await loadSymbols();

  const runFci = async () => {
    const amount = parseFloat($("#fci-amount").value);
    const days = parseInt($("#fci-days").value, 10);
    if (!amount || !days) return;
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Buscando los mejores fondos…</div>`;
    try {
      const mmRes = await fetch("/api/fci/money-market");
      const mm = await mmRes.json();
      const funds = mm.funds || [];
      if (!funds.length) {
        $("#inv-result").innerHTML = `<div class="inv-placeholder">No se pudieron cargar los fondos.</div>`;
        return;
      }
      // Proyectar con el mejor fondo (mayor TNA)
      const best = funds[0];
      const projRes = await fetch(`/api/fci/simular?amount=${amount}&tna=${best.tna}&days=${days}`);
      const proj = await projRes.json();
      const srcNote = mm.source === "CAFCI"
        ? `Datos en vivo de CAFCI (${mm.live_count} fondos)`
        : "Tasas de referencia — conectá CAFCI en el servidor para datos en vivo";

      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>FCI Money Market</h3>
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(proj.amount)}</b></div>
            <div class="inv-kpi"><small>Mejor TNA</small><b class="pos">${num(best.tna)}%</b></div>
            <div class="inv-kpi"><small>Ganás en ${days}d</small><b class="pos">${money(proj.interest)}</b></div>
            <div class="inv-kpi"><small>Total</small><b>${money(proj.final)}</b></div>
          </div>
          <div class="inv-break">
            <span>Devengás <b>${money(proj.daily_accrual)}</b> por día</span>
            <span>Liquidez <b>inmediata (T+0)</b></span>
            <span>Riesgo <b>muy bajo</b></span>
          </div>
        </div>
        <div class="inv-schedule">
          <h4>Fondos disponibles <small style="font-weight:400;color:var(--slate-2)">· ${srcNote}</small></h4>
          <table class="inv-table">
            <thead><tr><th>Fondo</th><th>Administradora</th><th>TNA</th><th>Ganás en ${days}d</th></tr></thead>
            <tbody>${funds.map((f) => {
              const g = amount * (f.tna/100/365) * days;
              return `<tr>
                <td><b>${f.name}</b></td>
                <td>${f.manager}</td>
                <td><span class="tag-coupon">${num(f.tna)}%</span></td>
                <td>${money(g)}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>
        <div class="inv-confirm-bar">
          <div><b>¿Querés hacer esta inversión?</b><span>Se registra en tu cartera y se descuenta de la cuenta.</span></div>
          <button class="btn-primary" id="inv-confirm-btn"
            data-tipo="fci" data-label="${h(best.name || 'FCI money market')}"
            data-sociedad="${h(best.manager || '')}" data-monto="${Math.round(amount)}"
            data-rend="${num(best.tna)}" data-plazo="0">Registrar esta inversión</button>
        </div>`;
      wireConfirmInversion();
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runTasa = async (kind) => {
    const amount = parseFloat($("#fci-amount").value);
    const days = parseInt($("#fci-days").value, 10);
    if (!amount || !days) return;
    const isCaucion = kind === "caucion";
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Buscando tasas…</div>`;
    try {
      const url = isCaucion ? "/api/tasas/caucion" : "/api/tasas/plazo-fijo";
      const data = await (await fetch(url)).json();
      const bestTna = isCaucion ? data.tna_1d : data.best_tna;
      const proj = await (await fetch(`/api/tasas/simular?amount=${amount}&tna=${bestTna}&days=${days}`)).json();
      const srcNote = data.source === "referencia"
        ? "Tasa de referencia — conectá la fuente en el servidor para datos en vivo"
        : `Datos en vivo de ${data.source}`;

      let listHtml = "";
      if (isCaucion && data.plazos && data.plazos.length > 1) {
        listHtml = `<div class="inv-schedule">
          <h4>Curva de tasas por plazo <small style="font-weight:400;color:var(--slate-2)">· ${srcNote}</small></h4>
          <table class="inv-table">
            <thead><tr><th>Plazo</th><th>TNA</th><th>Ganás en ese plazo</th></tr></thead>
            <tbody>${data.plazos.map((p) => {
              const g = amount * (p.tna/100) * (p.days/365);
              return `<tr><td>${p.days} día${p.days>1?"s":""}</td><td><span class="tag-coupon">${num(p.tna)}%</span></td><td>${money(g)}</td></tr>`;
            }).join("")}</tbody>
          </table></div>`;
      } else if (!isCaucion && data.banks) {
        listHtml = `<div class="inv-schedule">
          <h4>Tasas por banco <small style="font-weight:400;color:var(--slate-2)">· ${srcNote}</small></h4>
          <table class="inv-table">
            <thead><tr><th>Banco</th><th>TNA</th><th>Ganás en ${days}d</th></tr></thead>
            <tbody>${data.banks.slice(0, 15).map((b) => {
              const g = amount * (b.tna/100) * (days/365);
              return `<tr><td><b>${b.bank}</b></td><td><span class="tag-coupon">${num(b.tna)}%</span></td><td>${money(g)}</td></tr>`;
            }).join("")}</tbody>
          </table></div>`;
      }

      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>${isCaucion ? "Caución bursátil" : "Plazo fijo"}</h3>
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(proj.amount)}</b></div>
            <div class="inv-kpi"><small>${isCaucion ? "TNA 1 día" : "Mejor TNA"}</small><b class="pos">${num(bestTna)}%</b></div>
            <div class="inv-kpi"><small>Ganás en ${days}d</small><b class="pos">${money(proj.interest)}</b></div>
            <div class="inv-kpi"><small>Total</small><b>${money(proj.final)}</b></div>
          </div>
          <div class="inv-break">
            <span>Liquidez <b>${data.liquidity || "—"}</b></span>
            <span>Riesgo <b>${data.risk || "bajo"}</b></span>
          </div>
        </div>
        ${listHtml}
        <div class="inv-confirm-bar">
          <div><b>¿Querés hacer esta inversión?</b><span>Se registra en tu cartera y se descuenta de la cuenta.</span></div>
          <button class="btn-primary" id="inv-confirm-btn"
            data-tipo="${isCaucion ? 'caucion' : 'plazo_fijo'}" data-label="${isCaucion ? 'Caución bursátil' : 'Plazo fijo'}"
            data-monto="${Math.round(amount)}" data-rend="${num(bestTna)}" data-dias="${days}">Registrar esta inversión</button>
        </div>`;
      wireConfirmInversion();
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runLecap = async () => {
    const symbol = $("#inv-symbol").value;
    const amount = parseFloat($("#inv-amount").value);
    if (!symbol || !amount) return;
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Calculando…</div>`;
    try {
      const r = await (await fetch(`/api/inversiones/lecap-simular?symbol=${encodeURIComponent(symbol)}&amount=${amount}`)).json();
      if (!r.ok) {
        $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ ${r.error || "No se pudo simular."}</div>`;
        return;
      }
      const retClass = r.total_return >= 0 ? "pos" : "neg";
      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>${r.symbol} · Letra capitalizable</h3>
          <div class="bond-metrics">
            ${r.tna_pct != null ? `<div class="metric"><small>TNA</small><b class="pos">${num(r.tna_pct)}%</b></div>` : ""}
            ${r.tem_pct != null ? `<div class="metric"><small>TEM</small><b>${num(r.tem_pct)}%</b></div>` : ""}
            <div class="metric"><small>Precio</small><b>${num(r.price)}</b></div>
            <div class="metric"><small>Valor final</small><b>${num(r.valor_final)}</b></div>
          </div>
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(r.invested)}</b></div>
            <div class="inv-kpi"><small>Nominales</small><b>${new Intl.NumberFormat("es-AR").format(Math.round(r.nominales))}</b></div>
            <div class="inv-kpi"><small>Cobrás al vto</small><b>${money(r.total_to_collect)}</b></div>
            <div class="inv-kpi"><small>Ganancia</small><b class="${retClass}">${money(r.total_return)} · ${num(r.return_pct)}%</b></div>
          </div>
          <div class="inv-break">
            <span>Vencimiento en <b>${r.days} días</b></span>
            <span>${r.maturity_note}</span>
          </div>
        </div>
        <div class="inv-confirm-bar">
          <div><b>¿Querés comprar esta letra?</b><span>Necesitás una cuenta comitente. Se registra en tu cartera.</span></div>
          <button class="btn-primary" id="inv-confirm-btn"
            data-tipo="bono" data-label="${h(r.symbol)} · LECAP" data-monto="${Math.round(r.invested)}"
            data-rend="${r.tna_pct != null ? num(r.tna_pct) : 0}" data-dias="${r.days}" data-comitente="1">Comprar por la comitente</button>
        </div>`;
      wireConfirmInversion();
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runBond = async () => {
    const kind = $("#inv-kind").value;
    const symbol = $("#inv-symbol").value;
    const amount = parseFloat($("#inv-amount").value);
    const price = parseFloat($("#inv-price").value);
    if (!symbol || !amount || !price) return;
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Calculando…</div>`;
    try {
      const res = await fetch(`/api/inversiones/simular?symbol=${encodeURIComponent(symbol)}&amount=${amount}&price=${price}&kind=${kind}`);
      const r = await res.json();
      if (!r.ok) {
        $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ ${r.error || "No se pudo simular."}</div>`;
        return;
      }
      const retClass = r.total_return >= 0 ? "pos" : "neg";
      // Traer métricas de mercado (TIR, duration, paridad) en paralelo
      let metricsHtml = "";
      try {
        const m = await (await fetch(`/api/inversiones/analizar?symbol=${encodeURIComponent(symbol)}&price=${price}&kind=${kind}`)).json();
        if (m.ok) {
          metricsHtml = `<div class="bond-metrics">
            ${m.tir_pct != null ? `<div class="metric"><small>TIR</small><b class="${m.tir_pct>=0?'pos':'neg'}">${num(m.tir_pct)}%</b></div>` : ""}
            ${m.tna_pct != null ? `<div class="metric"><small>TNA</small><b>${num(m.tna_pct)}%</b></div>` : ""}
            ${m.md != null ? `<div class="metric"><small>Duration mod.</small><b>${num(m.md)}</b></div>` : ""}
            ${m.paridad_pct != null ? `<div class="metric"><small>Paridad</small><b>${num(m.paridad_pct)}%</b></div>` : ""}
          </div>`;
        }
      } catch {}
      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>${r.symbol} · ${r.name || ""}</h3>
          ${metricsHtml}
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(r.invested)}</b></div>
            <div class="inv-kpi"><small>Nominales</small><b>${new Intl.NumberFormat("es-AR").format(Math.round(r.nominales))}</b></div>
            <div class="inv-kpi"><small>Total a cobrar</small><b>${money(r.total_to_collect)}</b></div>
            <div class="inv-kpi"><small>Resultado</small><b class="${retClass}">${money(r.total_return)} · ${num(r.return_pct)}%</b></div>
          </div>
          <div class="inv-break">
            <span>Renta: <b>${money(r.total_interest)}</b></span>
            <span>Capital: <b>${money(r.total_principal)}</b></span>
            <span>${r.payments_count} pagos · próximo ${r.next_payment ? fmtDateAnio(r.next_payment.date) : "—"}</span>
          </div>
        </div>
        <div class="inv-schedule">
          <h4>Cronograma de cobros</h4>
          <table class="inv-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Renta</th><th>Capital</th><th>Total</th></tr></thead>
            <tbody>${r.schedule.map((p) => `<tr>
              <td>${fmtDateAnio(p.date)}</td>
              <td><span class="tag-${p.kind.includes("mort") ? "amort" : "coupon"}">${p.kind}</span></td>
              <td>${money(p.interest)}</td>
              <td>${money(p.principal)}</td>
              <td><b>${money(p.amount)}</b></td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
        <div class="inv-confirm-bar">
          <div><b>¿Querés comprar este bono?</b><span>Necesitás una cuenta comitente. Se registra en tu cartera.</span></div>
          <button class="btn-primary" id="inv-confirm-btn"
            data-tipo="bono" data-label="${h(r.symbol || 'Bono')}" data-monto="${Math.round(r.invested)}"
            data-rend="${r.return_pct != null ? num(r.return_pct) : 0}" data-dias="${r.days_to_maturity || ''}" data-comitente="1">Comprar por la comitente</button>
        </div>`;
      wireConfirmInversion();
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runSim = () => {
    const kind = $("#inv-kind").value;
    if (kind === "fci") return runFci();
    if (kind === "caucion" || kind === "plazofijo") return runTasa(kind);
    if (kind === "lecap") return runLecap();
    return runBond();
  };

  $("#inv-kind").addEventListener("change", async () => {
    toggleControls();
    await loadSymbols();
  });
  $("#inv-sim-btn").addEventListener("click", runSim);
  // Simular FCI al abrir (es la opción por defecto)
  runFci();
}

const num = (v) => v == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(v);
const num2g = (v) => v == null ? "—" : new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

// ── Mercado de bonos (tableros + curvas + carry + variables) ──
const FAM_LABELS = {
  soberanos_ar: "Soberanos Ley Argentina",
  soberanos_ny: "Soberanos Ley NY",
  bopreal: "BOPREAL",
  lecaps: "LECAPs",
  boncaps: "BONCAPs",
};

function _mktTabs() {
  const tabs = [["tableros","📊 Cotizaciones"],["carry","📈 Carry"],["variables","🏦 Variables"]];
  const active = state.mktTab || "tableros";
  return `<div class="mkt-tabs">${tabs.map(([k,l]) =>
    `<button class="mkt-tab ${active===k?"active":""}" data-mtab="${k}">${l}</button>`).join("")}</div>`;
}

function _wireMktTabs() {
  document.querySelectorAll("[data-mtab]").forEach((b) => {
    b.onclick = () => { state.mktTab = b.dataset.mtab; renderMercado(); };
  });
}

// Conecta el botón "Registrar/Comprar inversión" del simulador con el registro real
function wireConfirmInversion() {
  const btn = $("#inv-confirm-btn");
  if (!btn) return;
  btn.onclick = () => {
    const d = btn.dataset;
    // Instrumentos bursátiles (van por la cuenta comitente): bonos, letras y cauciones
    const esBursatil = d.comitente === "1" || d.tipo === "caucion";
    if (esBursatil) {
      const comitentes = state.accounts.filter(a => a.tipo === "comitente");
      if (!comitentes.length) {
        if (confirm("Esta operación es bursátil y necesita una cuenta comitente (en tu broker/ALyC). ¿La creamos ahora en Configuración?")) {
          switchView("config");
          state.cfgSection = "cuentas";
          setTimeout(() => renderConfig(), 50);
        }
        return;
      }
    }
    // Abrir el modal de inversión pre-cargado con los datos simulados
    openInvModal();
    $("#i-tipo").value = d.tipo;
    updateInvTipo();
    // Elegir cuenta de origen:
    // - Bursátil (bono/letra/caución) → la cuenta comitente
    // - Plazo fijo / FCI → dejar que el usuario elija (no forzamos la operativa)
    if (esBursatil) {
      const com = state.accounts.find(a => a.tipo === "comitente");
      if (com) $("#i-account").value = com.id;
    }
    updateInvTipo();
    $("#i-label").value = d.label || "";
    $("#i-monto").value = d.monto || "";
    $("#i-rend").value = d.rend || "";
    if (d.sociedad) $("#i-sociedad").value = d.sociedad;
    // Fecha de vencimiento si vino con días
    if (d.dias && d.dias !== "0") {
      const venc = new Date(); venc.setDate(venc.getDate() + parseInt(d.dias));
      if ($("#i-venc")) $("#i-venc").value = venc.toISOString().slice(0,10);
    }
    updateInvPreview();
  };
}

function renderMercado() {
  const tab = state.mktTab || "tableros";
  if (tab === "carry") return renderMercadoCarry();
  if (tab === "variables") return renderMercadoVariables();
  return renderMercadoTableros();
}

async function renderMercadoTableros() {
  const wrap = $("#mkt-wrap");
  wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Cargando tableros de mercado…</div>`;
  _wireMktTabs();
  try {
    const data = await (await fetch("/api/inversiones/tableros")).json();
    if (!data.ok || !data.families) {
      $("#mkt-wrap").innerHTML = `${_mktTabs()}<div class="inv-placeholder">No se pudieron cargar los tableros. Requiere precios en vivo de BYMA (en el servidor).</div>`;
      _wireMktTabs();
      return;
    }
    const families = data.families;
    const curvePoints = [];
    ["soberanos_ar", "soberanos_ny"].forEach((fam) => {
      (families[fam] || []).forEach((b) => {
        if (b.tir_pct != null && b.md != null) {
          curvePoints.push({ ticker: b.ticker, tir: b.tir_pct, md: b.md, fam });
        }
      });
    });

    let html = _mktTabs() + `<div class="mkt-head">
      <div><div class="eyebrow">Mercado de bonos</div>
      <h2 class="inv-title">Curvas y métricas</h2>
      <p class="inv-sub">TIR, duration y paridad de cada bono, con precios en vivo de BYMA.</p></div>
    </div>`;

    if (curvePoints.length >= 2) {
      html += `<div class="chart-card"><div class="chart-head"><h2>Curva de rendimiento soberana</h2>
        <div class="chart-legend"><span class="lg" style="--c:#2563EB">Ley AR</span><span class="lg" style="--c:#0E7C6B">Ley NY</span></div></div>
        <div id="mkt-curve"></div></div>`;
    }

    const order = ["soberanos_ar", "soberanos_ny", "bopreal", "lecaps", "boncaps"];
    order.forEach((fam) => {
      const items = families[fam];
      if (!items || !items.length) return;
      const isSov = fam.startsWith("soberanos") || fam === "bopreal";
      html += `<div class="mkt-board">
        <h3>${FAM_LABELS[fam] || fam} <small>${items.length}</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr>
            <th>Bono</th><th>Precio</th>
            ${isSov ? "<th>TIR</th><th>MD</th><th>Paridad</th>" : "<th>TNA</th><th>TEM</th>"}
            <th>Vto</th><th>Días</th>
          </tr></thead>
          <tbody>${items.map((b) => `<tr>
            <td><b>${b.ticker}</b></td>
            <td>${b.price != null ? num(b.price) : "—"} <span class="ccy">${b.price_ccy || ""}</span></td>
            ${isSov
              ? `<td class="${(b.tir_pct||0)>=0?'pos':'neg'}">${b.tir_pct != null ? num(b.tir_pct)+"%" : "—"}</td>
                 <td>${b.md != null ? num(b.md) : "—"}</td>
                 <td>${b.paridad_pct != null ? num(b.paridad_pct)+"%" : "—"}</td>`
              : `<td>${b.tna_pct != null ? num(b.tna_pct)+"%" : "—"}</td>
                 <td>${b.tem_pct != null ? num(b.tem_pct)+"%" : "—"}</td>`}
            <td>${b.maturity || "—"}</td>
            <td>${b.days != null ? b.days : "—"}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
    });

    const fin = data.dolares_financieros;
    if (fin && (fin.al?.length || fin.gd?.length)) {
      const rows = [...(fin.al||[]), ...(fin.gd||[])].filter(x => x.mep || x.ccl);
      if (rows.length) {
        html += `<div class="mkt-board">
          <h3>Dólares financieros <small>por bono</small></h3>
          <table class="inv-table mkt-table">
            <thead><tr><th>Bono</th><th>MEP</th><th>CCL</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td><b>${r.ticker}</b></td>
              <td>${r.mep != null ? "$"+num(r.mep) : "—"}</td>
              <td>${r.ccl != null ? "$"+num(r.ccl) : "—"}</td></tr>`).join("")}</tbody>
          </table></div>`;
      }
    }

    wrap.innerHTML = html;
    _wireMktTabs();
    if (curvePoints.length >= 2) drawYieldCurve(curvePoints);
  } catch {
    $("#mkt-wrap").innerHTML = `${_mktTabs()}<div class="inv-placeholder">⚠️ Error al cargar los tableros.</div>`;
    _wireMktTabs();
  }
}

async function renderMercadoCarry() {
  const wrap = $("#mkt-wrap");
  wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Calculando equilibrios de carry…</div>`;
  _wireMktTabs();
  try {
    const d = await (await fetch("/api/mercado/carry")).json();
    if (!d.ok || !(d.rows || []).length) {
      wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Sin datos de LECAPs/BONCAPs ahora (BYMA fuera de rueda o feed caído). Requiere precios en vivo en el servidor.</div>`;
      _wireMktTabs();
      return;
    }
    const dol = d.dolares || {};
    const staleBadge = d.stale ? `<span class="stale-badge" title="El mercado está cerrado o BYMA no responde ahora. Se muestra la última cotización guardada.">Última foto guardada</span>` : "";
    const dolKey = state.carryDol || "mep";
    const boncaps = d.rows.filter((r) => r.tipo === "BONCAP");
    const lecaps = d.rows.filter((r) => r.tipo === "LECAP");
    const bkClass = (v) => v == null ? "" : v >= 30 ? "bk-verde" : v >= 15 ? "bk-amarillo" : v >= 5 ? "bk-naranja" : "bk-rojo";

    const table = (rows, title) => rows.length ? `
      <div class="mkt-board"><h3>${title}</h3>
      <table class="inv-table mkt-table">
        <thead><tr><th>Ticker</th><th>Precio</th><th>Días</th>
          <th>MEP eq.</th><th>CCL eq.</th><th>Blue eq.</th><th>Breakeven anual</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><b>${r.ticker}</b></td><td>${num(r.precio, 2)}</td><td>${r.dias}</td>
          <td class="hl">${r.eq_mep ? "$"+num(r.eq_mep, 0) : "—"}</td>
          <td>${r.eq_ccl ? "$"+num(r.eq_ccl, 0) : "—"}</td>
          <td>${r.eq_blue ? "$"+num(r.eq_blue, 0) : "—"}</td>
          <td class="${bkClass(r.breakeven_anual_pct)}">+${num(r.breakeven_anual_pct, 1)}%</td></tr>`).join("")}</tbody>
      </table></div>` : "";

    wrap.innerHTML = `${_mktTabs()}
      <div class="mkt-head"><div class="eyebrow">Carry trade en dólares ${staleBadge}</div>
        <h2 class="inv-title">Dólar de equilibrio</h2>
        <p class="inv-sub">El valor al que debería estar el dólar al vencimiento para que comprar la letra hoy equivalga a comprar dólares. Si el dólar queda por debajo del equilibrio, el carry fue rentable.</p></div>
      <div class="carry-dolares">${[["oficial","Oficial"],["mep","MEP"],["blue","Blue"],["ccl","CCL"]].map(([k,l]) =>
        `<div class="carry-dol"><small>${l}</small><b>${dol[k] ? "$"+num(dol[k], 2) : "—"}</b></div>`).join("")}</div>
      ${table(boncaps, "BONCAPs (Bonos Capitalizables)")}
      ${table(lecaps, "LECAPs (Letras Capitalizables)")}
      <p class="mkt-note"><b>Breakeven:</b> devaluación anual necesaria para empatar contra el dólar. <span class="bk-verde">Verde</span> = alto margen · <span class="bk-amarillo">Amarillo</span> = moderado · <span class="bk-naranja">Naranja</span> = poco · <span class="bk-rojo">Rojo</span> = perdés vs dólar. Fórmula: ${d.formula}.</p>`;
    _wireMktTabs();
  } catch {
    wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">⚠️ Error al calcular el carry.</div>`;
    _wireMktTabs();
  }
}

async function renderMercadoVariables() {
  const wrap = $("#mkt-wrap");
  wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Consultando variables del BCRA…</div>`;
  _wireMktTabs();
  try {
    const d = await (await fetch("/api/mercado/variables")).json();
    const v = d.vars || {};
    const cotiz = d.cotizaciones || [];
    const fmt$ = (x) => x == null ? "—" : "$" + num(x, 2);

    let html = `${_mktTabs()}
      <div class="mkt-head"><div class="eyebrow">Variables de referencia</div>
        <h2 class="inv-title">Dólares y macro</h2>
        <p class="inv-sub">Cotizaciones con su brecha contra el mayorista, más inflación, CER y tasas del BCRA.</p></div>`;

    if (cotiz.length) {
      html += `<div class="mkt-board"><h3>Cotizaciones del dólar <small>brecha vs mayorista</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr><th>Tipo</th><th>Valor</th><th>Brecha</th></tr></thead>
          <tbody>${cotiz.map((c) => `<tr>
            <td><b>${c.nombre}</b></td><td>${fmt$(c.valor)}</td>
            <td class="${c.brecha == null ? "" : c.brecha >= 4 ? "neg" : "pos"}">${c.brecha == null ? "–" : "+"+num(c.brecha, 1)+"%"}</td>
          </tr>`).join("")}</tbody>
        </table></div>`;
    }

    const macroKeys = Object.keys(v);
    if (macroKeys.length) {
      html += `<div class="mkt-board"><h3>Variables macro <small>BCRA</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr><th>Variable</th><th>Valor</th><th>Fecha</th></tr></thead>
          <tbody>${macroKeys.map((k) => {
            const it = v[k] || {};
            const val = ["cer","mayorista"].includes(k) ? fmt$(it.valor) : (it.valor != null ? num(it.valor, 2) + (k.includes("tasa") || k.includes("inflacion") ? "%" : "") : "—");
            return `<tr><td><b>${it.label || k}</b><br><small style="color:var(--slate-2)">${it.desc || ""}</small></td>
              <td>${val}</td><td>${it.fecha || "—"}</td></tr>`;
          }).join("")}</tbody>
        </table></div>`;
    }

    const bandas = d.bandas || [];
    if (bandas.length) {
      html += `<div class="mkt-board"><h3>Bandas cambiarias <small>piso y techo</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr><th>Mes</th><th>Piso</th><th>Techo</th></tr></thead>
          <tbody>${bandas.map((b) => `<tr><td>${(b.fecha||"").slice(0,7)}</td>
            <td>$${num(b.inferior, 0)}</td><td>$${num(b.superior, 0)}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }

    if (!cotiz.length && !macroKeys.length) {
      html += `<div class="inv-placeholder">Sin datos ahora. Requiere conexión al BCRA y BYMA en el servidor.</div>`;
    }
    wrap.innerHTML = html;
    _wireMktTabs();
  } catch {
    wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">⚠️ Error al cargar las variables.</div>`;
    _wireMktTabs();
  }
}

function drawYieldCurve(points) {
  const W = 900, H = 320, P = { t: 20, r: 20, b: 44, l: 54 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const mds = points.map((p) => p.md), tirs = points.map((p) => p.tir);
  let xmin = Math.min(...mds), xmax = Math.max(...mds);
  let ymin = Math.min(...tirs), ymax = Math.max(...tirs);
  const xpad = (xmax - xmin) * 0.1 || 0.5, ypad = (ymax - ymin) * 0.15 || 1;
  xmin -= xpad; xmax += xpad; ymin -= ypad; ymax += ypad;
  const X = (v) => P.l + ((v - xmin) / (xmax - xmin)) * iw;
  const Y = (v) => P.t + ih - ((v - ymin) / (ymax - ymin)) * ih;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const yv = ymin + (i/4)*(ymax-ymin), yy = Y(yv).toFixed(1);
    grid += `<line class="grid-line" x1="${P.l}" y1="${yy}" x2="${W-P.r}" y2="${yy}"/>`;
    grid += `<text class="axis-label" x="${P.l-8}" y="${+yy+4}" text-anchor="end">${num(yv)}%</text>`;
    const xv = xmin + (i/4)*(xmax-xmin), xx = X(xv).toFixed(1);
    grid += `<text class="axis-label" x="${xx}" y="${H-16}" text-anchor="middle">${num(xv)}</text>`;
  }
  const dots = points.map((p) => {
    const color = p.fam === "soberanos_ar" ? "#2563EB" : "#0E7C6B";
    return `<g><circle cx="${X(p.md).toFixed(1)}" cy="${Y(p.tir).toFixed(1)}" r="5" fill="${color}"/>
      <text x="${X(p.md).toFixed(1)}" y="${(Y(p.tir)-9).toFixed(1)}" text-anchor="middle" class="curve-label">${p.ticker}</text></g>`;
  }).join("");

  $("#mkt-curve").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <text class="axis-title" x="${P.l+iw/2}" y="${H-2}" text-anchor="middle">Duration modificada (años)</text>
    ${dots}
  </svg>`;
}

// ── FCI con filtros ──────────────────────────────────────
async function renderFCI() {
  const wrap = $("#fci-wrap");
  if (!state.fciData) {
    wrap.innerHTML = `<div class="inv-placeholder">Cargando fondos money market…</div>`;
    try {
      state.fciData = await (await fetch("/api/fci/money-market")).json();
    } catch {
      wrap.innerHTML = `<div class="inv-placeholder">⚠️ No se pudieron cargar los fondos.</div>`;
      return;
    }
  }
  const data = state.fciData;
  const funds = data.funds || [];
  const managers = [...new Set(funds.map((f) => f.manager))].sort();
  const fq = state.fciQuery || "";
  const fmgr = state.fciManager || "";
  const fsort = state.fciSort || "tna-desc";
  const amount = state.result ? Math.round(state.result.summary.stable_surplus) : 100000;

  let filtered = funds.filter((f) => {
    if (fq && !f.name.toLowerCase().includes(fq.toLowerCase()) && !f.manager.toLowerCase().includes(fq.toLowerCase())) return false;
    if (fmgr && f.manager !== fmgr) return false;
    return true;
  });
  if (fsort === "tna-desc") filtered.sort((a, b) => b.tna - a.tna);
  else if (fsort === "tna-asc") filtered.sort((a, b) => a.tna - b.tna);
  else if (fsort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));

  const srcNote = data.source === "CAFCI"
    ? `Datos en vivo de CAFCI · ${data.live_count} fondos`
    : "Tasas de referencia — conectá CAFCI en el servidor para datos en vivo";

  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Fondos comunes de inversión</div>
      <h2 class="inv-title">FCI Money Market</h2>
      <p class="inv-sub">Rescate en el día (T+0), riesgo muy bajo. Filtrá y compará el rendimiento. ${srcNote}.</p></div>

    <div class="fci-filters">
      <input type="text" id="fci-search" placeholder="Buscar fondo o administradora…" value="${fq}">
      <select id="fci-mgr">
        <option value="">Todas las administradoras</option>
        ${managers.map((m) => `<option value="${m}" ${m===fmgr?"selected":""}>${m}</option>`).join("")}
      </select>
      <select id="fci-sort">
        <option value="tna-desc" ${fsort==="tna-desc"?"selected":""}>Mayor TNA</option>
        <option value="tna-asc" ${fsort==="tna-asc"?"selected":""}>Menor TNA</option>
        <option value="name" ${fsort==="name"?"selected":""}>Nombre A-Z</option>
      </select>
    </div>

    <div class="fci-count">${filtered.length} fondo${filtered.length!==1?"s":""} · simulando con ${money(amount)} a 30 días</div>

    <div class="fci-grid">
      ${filtered.map((f) => {
        const g30 = amount * (f.tna/100/365) * 30;
        return `<div class="fci-card">
          <div class="fci-card-head">
            <div><b>${f.name}</b><small>${f.manager}</small></div>
            <div class="fci-tna"><b>${num(f.tna)}%</b><small>TNA</small></div>
          </div>
          <div class="fci-card-body">
            <div><small>TEA</small><span>${num(f.tea)}%</span></div>
            <div><small>Liquidez</small><span>${f.liquidity}</span></div>
            <div><small>Riesgo</small><span>${f.risk}</span></div>
            <div><small>Ganás en 30d</small><span class="pos">${money(g30)}</span></div>
          </div>
        </div>`;
      }).join("")}
    </div>
    ${!filtered.length ? `<div class="inv-placeholder">No hay fondos con ese filtro.</div>` : ""}`;

  const search = $("#fci-search");
  if (search) {
    search.oninput = (e) => {
      state.fciQuery = e.target.value;
      renderFCI();
      setTimeout(() => { const el = $("#fci-search"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
    };
  }
  const mgr = $("#fci-mgr");
  if (mgr) mgr.onchange = (e) => { state.fciManager = e.target.value; renderFCI(); };
  const sort = $("#fci-sort");
  if (sort) sort.onchange = (e) => { state.fciSort = e.target.value; renderFCI(); };
}

// ── Impuestos ────────────────────────────────────────────
// Calendario de vencimientos impositivos (fechas típicas AFIP/ARBA).
// Genera los próximos vencimientos con monto estimado desde los movimientos.
function proximosVencimientosImpositivos() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  // Montos: primero un override manual del usuario (state.impMontos), luego lo
  // estimado desde los movimientos, luego un default.
  const overrides = state.impMontos || {};
  const buscarMonto = (cat, kws, def) => {
    if (overrides[cat] != null) return overrides[cat];
    const m = state.movements.find(x => {
      const t = (x.label||"").toLowerCase();
      return x.amount < 0 && kws.some(k => t.includes(k));
    });
    return m ? Math.abs(m.amount) : def;
  };
  const montoIVA = buscarMonto("iva", ["iva"], 4100000);
  const montoIIBB = buscarMonto("iibb", ["iibb","ingresos brutos","arba"], 1500000);
  const montoGanancias = buscarMonto("ganancias", ["ganancias"], 2200000);
  const montoCargas = buscarMonto("cargas", ["cargas","suss","931"], 6200000);

  // Definición de impuestos y su día de vencimiento mensual (aprox.)
  const imp = state.impuestos || {};
  const activo = (k) => imp[k] !== undefined ? imp[k] : true; // por defecto activos
  const defs = [
    { concepto: "IVA (DDJJ mensual)", org: "AFIP", dia: 18, monto: montoIVA, cat: "iva", flag: "ivaOn" },
    { concepto: "IIBB (Ingresos Brutos)", org: "ARBA", dia: 15, monto: montoIIBB, cat: "iibb", flag: "iibbOn" },
    { concepto: "Cargas sociales (F.931)", org: "AFIP", dia: 12, monto: montoCargas, cat: "cargas", flag: "cargasOn" },
    { concepto: "Anticipo Ganancias", org: "AFIP", dia: 22, monto: montoGanancias, cat: "ganancias", bimestral: true, flag: "gananciasOn" },
  ].filter(d => activo(d.flag));

  const vtos = [];
  for (let mesOffset = 0; mesOffset < 3; mesOffset++) {
    defs.forEach(d => {
      // Ganancias es cada 2 meses (anticipos)
      if (d.bimestral && mesOffset % 2 !== 0) return;
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + mesOffset, d.dia);
      if (fecha < hoy) return; // ya pasó
      vtos.push({
        concepto: d.concepto, org: d.org, monto: d.monto, cat: d.cat,
        fecha: fecha.toISOString().slice(0,10),
        dias: Math.round((fecha - hoy)/86400000),
      });
    });
  }
  return vtos.sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
}

function renderCalendarioImpuestos() {
  const host = $("#imp-calendario");
  if (!host) return;
  const vtos = proximosVencimientosImpositivos();
  const total30 = vtos.filter(v => v.dias <= 30).reduce((s,v)=>s+v.monto,0);
  const proximo = vtos[0];

  const catColor = { iva:"#4C8DFF", iibb:"#F5A623", cargas:"#E65100", ganancias:"#7B61FF" };

  host.innerHTML = `
    <div class="imp-cal-card">
      <div class="imp-cal-head">
        <div>
          <h3>Calendario de vencimientos</h3>
          <p>Los próximos impuestos a pagar. Podés llevarlos al flujo de caja.</p>
        </div>
        <div class="imp-cal-kpi">
          <small>A pagar en 30 días</small>
          <b>${money(total30)}</b>
        </div>
      </div>
      <div class="imp-cal-list">
        ${vtos.slice(0,8).map(v => `
          <div class="imp-cal-item">
            <div class="ical-date">
              <span class="ical-day">${new Date(v.fecha+"T00:00:00").getDate()}</span>
              <span class="ical-mon">${new Date(v.fecha+"T00:00:00").toLocaleDateString("es-AR",{month:"short"})}</span>
            </div>
            <div class="ical-body">
              <b>${v.concepto}</b>
              <span class="ical-org" style="color:${catColor[v.cat]||'#64748B'}">${v.org} · ${v.dias===0?"vence hoy":`en ${v.dias} días`}</span>
            </div>
            <div class="ical-monto-edit">
              <em>$</em><input type="number" class="ical-monto-input" data-cat="${v.cat}" value="${Math.round(v.monto)}" step="100000">
            </div>
          </div>`).join("")}
      </div>
      <p class="ical-hint">Podés ajustar cualquier monto — se guarda automáticamente.</p>
      <button class="btn-primary sm" id="imp-cal-tocashflow">Llevar estos vencimientos al flujo de caja →</button>
    </div>`;

  // Editar montos → guardar override por categoría
  $$(".ical-monto-input").forEach(inp => {
    inp.onchange = () => {
      if (!state.impMontos) state.impMontos = {};
      const val = parseFloat(inp.value);
      if (val > 0) state.impMontos[inp.dataset.cat] = val;
      saveState();
      renderCalendarioImpuestos();
    };
  });

  $("#imp-cal-tocashflow").onclick = () => {
    let n = 0;
    vtos.forEach(v => {
      // Evitar duplicar: solo si no existe ya un movimiento imp. en esa fecha/concepto
      const existe = state.movements.some(m => m.date === v.fecha && (m.label||"").includes(v.concepto.split(" ")[0]) && m.impVto);
      if (!existe) {
        state.movements.push({
          label: v.concepto, amount: -Math.abs(v.monto), date: v.fecha,
          recurrence: "none", medio: "transferencia",
          account: state.accounts.find(a=>a.moneda==="ARS")?.id || state.accounts[0]?.id,
          categoria: "impuestos", impVto: true,
        });
        n++;
      }
    });
    project();
    alert(`${n} vencimiento${n!==1?"s":""} agregado${n!==1?"s":""} al flujo de caja.`);
    switchView("flujo");
  };
}

// ── Retenciones y percepciones sufridas (crédito fiscal) ──
function renderRetenciones() {
  const host = $("#imp-retenciones");
  if (!host) return;
  const rets = state.retenciones || [];

  if (!rets.length) {
    host.innerHTML = `
      <div class="reten-card reten-empty">
        <div>
          <h3>Retenciones y percepciones sufridas</h3>
          <p>Importá tus retenciones y percepciones de AFIP (SICORE, Aduana, Ganancias). Son crédito fiscal: plata que ya pagaste a cuenta de un impuesto.</p>
        </div>
        <button class="btn-primary" id="reten-import-btn">↑ Importar de AFIP</button>
      </div>
      <input type="file" id="reten-file" accept=".xls,.xlsx" style="display:none">`;
    wireRetenImport();
    return;
  }

  // Agrupar por impuesto
  const porImp = {};
  rets.forEach(r => {
    const k = r.impuesto || "(sin descripción)";
    if (!porImp[k]) porImp[k] = { impuesto: k, cantidad: 0, retenciones: 0, percepciones: 0 };
    porImp[k].cantidad++;
    if (r.tipo === "percepcion") porImp[k].percepciones += (r.importe || 0);
    else porImp[k].retenciones += (r.importe || 0);
  });
  const grupos = Object.values(porImp).sort((a,b) => (b.retenciones+b.percepciones) - (a.retenciones+a.percepciones));
  const totalRet = rets.filter(r=>r.tipo!=="percepcion").reduce((s,r)=>s+(r.importe||0),0);
  const totalPer = rets.filter(r=>r.tipo==="percepcion").reduce((s,r)=>s+(r.importe||0),0);

  host.innerHTML = `
    <div class="reten-card">
      <div class="reten-head">
        <div>
          <h3>Retenciones y percepciones sufridas</h3>
          <p>Crédito fiscal acumulado — se descuenta de lo que tenés que pagar.</p>
        </div>
        <div class="reten-actions">
          <button class="btn-ghost sm" id="reten-import-btn">↑ Importar más</button>
          <button class="btn-ghost sm reten-clear" id="reten-clear-btn">Vaciar</button>
        </div>
      </div>
      <div class="reten-kpis">
        <div class="reten-kpi"><small>Retenciones</small><b>${money(totalRet)}</b></div>
        <div class="reten-kpi"><small>Percepciones</small><b>${money(totalPer)}</b></div>
        <div class="reten-kpi total"><small>Crédito fiscal total</small><b>${money(totalRet+totalPer)}</b></div>
      </div>
      <table class="reten-table">
        <thead><tr><th>Impuesto</th><th>Cant.</th><th>Retenciones</th><th>Percepciones</th></tr></thead>
        <tbody>${grupos.map(g => `<tr>
          <td>${h(g.impuesto)}</td>
          <td class="mono">${g.cantidad}</td>
          <td class="mono">${g.retenciones ? money(g.retenciones) : "—"}</td>
          <td class="mono">${g.percepciones ? money(g.percepciones) : "—"}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
    <input type="file" id="reten-file" accept=".xls,.xlsx" style="display:none">`;
  wireRetenImport();
  const clr = $("#reten-clear-btn");
  if (clr) clr.onclick = () => {
    if (!confirm("¿Vaciar todas las retenciones y percepciones importadas?")) return;
    state.retenciones = []; saveState(); renderRetenciones();
  };
}

function wireRetenImport() {
  const btn = $("#reten-import-btn");
  if (!btn) return;
  btn.onclick = () => $("#reten-file").click();
  $("#reten-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const orig = btn.textContent;
    btn.textContent = "Leyendo…";
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/afip/retenciones", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) { alert(data.error || "No se pudo leer el archivo."); return; }
      // Agregar evitando duplicar por certificado
      const existentes = new Set(state.retenciones.map(r => r.certificado).filter(Boolean));
      let n = 0;
      data.items.forEach(it => {
        if (it.certificado && existentes.has(it.certificado)) return;
        state.retenciones.push(it);
        n++;
      });
      saveState();
      renderRetenciones();
      const r = data.resumen;
      alert(`Importadas ${n} retenciones/percepciones de AFIP.\nRetenciones: ${money(r.total_retenciones)} · Percepciones: ${money(r.total_percepciones)}`);
    } catch {
      alert("Error al leer el archivo. Verificá que sea el export de AFIP (.xls o .xlsx).");
    } finally {
      btn.textContent = orig;
      e.target.value = "";
    }
  };
}


// ═══ CONTABILIDAD (Estado de Resultados + Sumas y Saldos) ═
// Por DEVENGADO: usa la fecha de EMISIÓN de las facturas (cuándo nació el
// derecho/obligación), no la de cobro/pago. Los movimientos que no vienen
// de una factura se toman por su fecha, para no duplicar.
let contaTab = "resultados";
let contaPeriodo = "anio"; // mes | anio | todo

function contaRango() {
  const hoy = new Date();
  if (contaPeriodo === "mes") {
    const from = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const to = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10), label: hoy.toLocaleDateString("es-AR",{month:"long",year:"numeric"}) };
  }
  if (contaPeriodo === "anio") {
    return { from: `${hoy.getFullYear()}-01-01`, to: `${hoy.getFullYear()}-12-31`, label: `Año ${hoy.getFullYear()}` };
  }
  return { from: "1900-01-01", to: "2100-12-31", label: "Todo el historial" };
}

// Devuelve los resultados devengados del período agrupados por rubro.
function calcularResultados(from, to) {
  const dentro = (iso) => iso && iso >= from && iso <= to;
  // Rubro -> monto acumulado (positivo = ingreso, negativo = gasto)
  const acum = {}; // rubro -> {rubro, grupo, monto}
  const add = (cat, monto) => {
    const r = rubroDe(cat);
    const key = r.rubro;
    if (!acum[key]) acum[key] = { rubro: r.rubro, grupo: r.grupo, monto: 0 };
    acum[key].monto += monto;
  };

  // 1) Facturas (comprobantes): devengan en su fecha de EMISIÓN.
  //    Cobrar = ingreso (ventas); Pagar = gasto (según categoría).
  state.comprobantes.forEach(c => {
    if (!dentro(c.emision)) return;
    // Usar el neto si está discriminado (sin IVA, que no es resultado); si no, el monto.
    const base = (c.neto && c.neto > 0) ? c.neto : c.monto;
    if (c.tipo === "cobrar") add("ventas", Math.abs(base));
    else add(c.categoria || "proveedores", -Math.abs(base));
  });

  // 2) Movimientos que NO vienen de factura ni de inversión: por su fecha.
  //    (los de factura ya se contaron arriba; los de inversión no son resultado)
  state.movements.forEach(m => {
    if (m.compId || m.invId) return; // ya contados / no son resultado
    if (m.movTipo === "inversion" || m.movTipo === "rescate") return;
    if (!m.amount || !dentro(m.date)) return;
    const cat = movCategoria(m);
    if (!cat) return;
    add(cat, m.amount);
  });

  return acum;
}

function renderContabilidad() {
  const wrap = $("#conta-wrap");
  const { from, to, label } = contaRango();

  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Contabilidad</div>
      <h2 class="inv-title">Estado de Resultados y Sumas y Saldos</h2>
      <p class="inv-sub">Por devengado: cuenta las operaciones cuando las hacés (fecha de la factura), no cuando cobrás o pagás.</p></div>

    <div class="conta-bar">
      <div class="conta-tabs">
        <button class="conta-tab ${contaTab==="resultados"?"active":""}" data-ctab="resultados">Estado de Resultados</button>
        <button class="conta-tab ${contaTab==="sumas"?"active":""}" data-ctab="sumas">Sumas y Saldos</button>
      </div>
      <div class="conta-periodo">
        <button class="cper ${contaPeriodo==="mes"?"active":""}" data-cper="mes">Este mes</button>
        <button class="cper ${contaPeriodo==="anio"?"active":""}" data-cper="anio">Este año</button>
        <button class="cper ${contaPeriodo==="todo"?"active":""}" data-cper="todo">Todo</button>
      </div>
    </div>

    <div id="conta-body"></div>`;

  $$(".conta-tab").forEach(b => b.onclick = () => { contaTab = b.dataset.ctab; renderContabilidad(); });
  $$(".cper").forEach(b => b.onclick = () => { contaPeriodo = b.dataset.cper; renderContabilidad(); });

  if (contaTab === "resultados") renderEstadoResultados(from, to, label);
  else renderSumasSaldos(from, to, label);
}

function renderEstadoResultados(from, to, label) {
  const body = $("#conta-body");
  const acum = calcularResultados(from, to);
  const rubros = Object.values(acum);

  // Agrupar por grupo del plan de cuentas
  const porGrupo = {};
  GRUPOS_RESULTADO.forEach(g => porGrupo[g.g] = []);
  rubros.forEach(r => { (porGrupo[r.grupo] = porGrupo[r.grupo] || []).push(r); });

  const totalIngresos = rubros.filter(r=>r.grupo==="ingresos").reduce((s,r)=>s+r.monto,0);
  const totalCostos = Math.abs(rubros.filter(r=>r.grupo==="costos").reduce((s,r)=>s+r.monto,0));
  const totalGastos = Math.abs(rubros.filter(r=>r.grupo==="gastos").reduce((s,r)=>s+r.monto,0));
  const totalImp = Math.abs(rubros.filter(r=>r.grupo==="impuestos").reduce((s,r)=>s+r.monto,0));
  const totalFin = Math.abs(rubros.filter(r=>r.grupo==="financieros").reduce((s,r)=>s+r.monto,0));
  const resultadoBruto = totalIngresos - totalCostos;
  const resultadoOperativo = resultadoBruto - totalGastos;
  const resultadoNeto = resultadoOperativo - totalImp - totalFin;

  const filaGrupo = (grupoKey, gLabel) => {
    const items = (porGrupo[grupoKey] || []).filter(r => Math.abs(r.monto) > 0.01);
    if (!items.length) return "";
    return `<tr class="er-grupo"><td colspan="2">${gLabel}</td></tr>` +
      items.sort((a,b)=>Math.abs(b.monto)-Math.abs(a.monto)).map(r =>
        `<tr class="er-rubro"><td>${h(r.rubro)}</td><td class="mono">${money(Math.abs(r.monto))}</td></tr>`).join("");
  };
  const filaTotal = (txt, val, cls="") => `<tr class="er-total ${cls}"><td>${txt}</td><td class="mono">${money(val)}</td></tr>`;

  const hayDatos = rubros.some(r => Math.abs(r.monto) > 0.01);

  body.innerHTML = `
    <div class="table-card conta-report">
      <div class="conta-report-head">
        <h3>Estado de Resultados</h3>
        <span class="conta-period-label">${h(label)}</span>
      </div>
      ${hayDatos ? `<table class="er-table">
        <tbody>
          ${filaGrupo("ingresos","INGRESOS")}
          ${filaTotal("Total ingresos", totalIngresos, "sub")}
          ${filaGrupo("costos","COSTOS DIRECTOS")}
          ${totalCostos ? filaTotal("Resultado bruto", resultadoBruto, "hl") : ""}
          ${filaGrupo("gastos","GASTOS OPERATIVOS")}
          ${filaTotal("Resultado operativo", resultadoOperativo, "hl") }
          ${filaGrupo("impuestos","IMPUESTOS")}
          ${filaGrupo("financieros","RESULTADOS FINANCIEROS")}
          <tr class="er-neto ${resultadoNeto>=0?'pos':'neg'}"><td>RESULTADO NETO ${resultadoNeto>=0?"(Ganancia)":"(Pérdida)"}</td><td class="mono">${money(resultadoNeto)}</td></tr>
        </tbody>
      </table>
      <button class="btn-ghost sm conta-export" id="er-export">↓ Descargar (CSV)</button>` :
      `<p class="cf-empty">No hay operaciones devengadas en ${h(label)}. Cargá facturas o movimientos para ver el resultado.</p>`}
    </div>
    <p class="conta-note">Devengado: las ventas y gastos se cuentan por la fecha de la factura, aunque el cobro o pago ocurra en otro momento. El IVA no forma parte del resultado (es un pasivo/crédito, no un ingreso ni un gasto).</p>`;

  const exp = $("#er-export");
  if (exp) exp.onclick = () => exportarEstadoResultados(acum, label);
}

function renderSumasSaldos(from, to, label) {
  const body = $("#conta-body");
  // Sumas y saldos simplificado: cuentas patrimoniales (saldos hoy) + de
  // resultado (acumulado del período), en formato Debe/Haber/Saldo.
  const cuentas = [];

  // Patrimoniales: cada cuenta bancaria/caja con su saldo
  state.accounts.forEach(a => {
    const saldo = saldoCuentaAFecha(a);
    cuentas.push({ nombre: a.name, tipo: "Activo", debe: saldo >= 0 ? saldo : 0, haber: saldo < 0 ? -saldo : 0 });
  });
  // Inversiones (activo)
  const colocado = totalColocado("ARS");
  if (colocado > 0) cuentas.push({ nombre: "Inversiones (colocado)", tipo: "Activo", debe: colocado, haber: 0 });
  // Cuentas por cobrar / pagar (pendientes)
  const porCobrar = state.comprobantes.filter(c=>c.tipo==="cobrar"&&c.estado!=="saldado").reduce((s,c)=>s+(c.monto||0),0);
  const porPagar = state.comprobantes.filter(c=>c.tipo==="pagar"&&c.estado!=="saldado").reduce((s,c)=>s+(c.monto||0),0);
  if (porCobrar > 0) cuentas.push({ nombre: "Deudores por ventas", tipo: "Activo", debe: porCobrar, haber: 0 });
  if (porPagar > 0) cuentas.push({ nombre: "Proveedores", tipo: "Pasivo", debe: 0, haber: porPagar });
  // Crédito fiscal (retenciones/percepciones)
  const credFiscal = (state.retenciones||[]).reduce((s,r)=>s+(r.importe||0),0);
  if (credFiscal > 0) cuentas.push({ nombre: "Crédito fiscal (ret./perc.)", tipo: "Activo", debe: credFiscal, haber: 0 });

  // De resultado: ingresos (haber) y gastos (debe)
  const acum = calcularResultados(from, to);
  Object.values(acum).forEach(r => {
    if (Math.abs(r.monto) < 0.01) return;
    if (r.grupo === "ingresos") cuentas.push({ nombre: r.rubro, tipo: "Resultado +", debe: 0, haber: r.monto });
    else cuentas.push({ nombre: r.rubro, tipo: "Resultado −", debe: Math.abs(r.monto), haber: 0 });
  });

  const totalDebe = cuentas.reduce((s,c)=>s+c.debe,0);
  const totalHaber = cuentas.reduce((s,c)=>s+c.haber,0);

  body.innerHTML = `
    <div class="table-card conta-report">
      <div class="conta-report-head">
        <h3>Sumas y Saldos</h3>
        <span class="conta-period-label">${h(label)}</span>
      </div>
      <div class="cf-table-scroll">
        <table class="ss-table">
          <thead><tr><th>Cuenta</th><th>Tipo</th><th>Debe</th><th>Haber</th></tr></thead>
          <tbody>
            ${cuentas.map(c => `<tr>
              <td>${h(c.nombre)}</td>
              <td><span class="ss-tipo">${h(c.tipo)}</span></td>
              <td class="mono">${c.debe?money(c.debe):"—"}</td>
              <td class="mono">${c.haber?money(c.haber):"—"}</td>
            </tr>`).join("")}
            <tr class="ss-total"><td colspan="2">TOTALES</td><td class="mono">${money(totalDebe)}</td><td class="mono">${money(totalHaber)}</td></tr>
          </tbody>
        </table>
      </div>
      <button class="btn-ghost sm conta-export" id="ss-export">↓ Descargar (CSV)</button>
    </div>
    <p class="conta-note">Sumas y saldos simplificado: activos y pasivos por su saldo actual, más las cuentas de resultado del período. Es una vista de gestión, no un balance legal — validá con tu contador.</p>`;

  const exp = $("#ss-export");
  if (exp) exp.onclick = () => exportarSumasSaldos(cuentas, label);
}

function exportarEstadoResultados(acum, label) {
  const rows = [["Rubro","Grupo","Monto"]];
  Object.values(acum).forEach(r => rows.push([r.rubro, r.grupo, r.monto.toFixed(2)]));
  descargarCSV(rows, `estado_resultados_${label.replace(/\s+/g,"_")}.csv`);
}
function exportarSumasSaldos(cuentas, label) {
  const rows = [["Cuenta","Tipo","Debe","Haber"]];
  cuentas.forEach(c => rows.push([c.nombre, c.tipo, c.debe.toFixed(2), c.haber.toFixed(2)]));
  descargarCSV(rows, `sumas_y_saldos_${label.replace(/\s+/g,"_")}.csv`);
}
function descargarCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff"+csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}


function renderImpuestos() {
  const wrap = $("#imp-wrap");
  if (!state.impOps) {
    // Operaciones de ejemplo
    state.impOps = [
      { fecha: monthDay(5), tipo: "venta", neto: 2000000, medio: "banco" },
      { fecha: monthDay(8), tipo: "venta", neto: 800000, medio: "efectivo" },
      { fecha: monthDay(12), tipo: "compra", neto: 1200000, medio: "banco" },
    ];
  }
  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Proyección impositiva</div>
      <h2 class="inv-title">Impuestos</h2>
      <p class="inv-sub">Tu calendario de vencimientos impositivos y un estimador de cuánto vas a pagar. Los vencimientos se pueden llevar al flujo de caja.</p></div>

    <div id="imp-calendario"></div>

    <div id="imp-retenciones"></div>

    <div class="imp-estimador-head">
      <h3>Estimador de impuestos</h3>
      <p>Cargá tus ventas y compras del período y calculamos IVA, IIBB, Ganancias e impuesto al cheque.</p>
    </div>

    <div class="imp-board">
      <aside class="imp-controls ctrl-card">
        <div class="ctrl-head"><h2>Operaciones</h2><button class="add-btn" id="imp-add">+ Agregar</button></div>
        <div class="imp-ops" id="imp-ops"></div>
        <div class="imp-params">
          <label class="field"><span>Ganancias del último ejercicio ($)</span>
            <div class="money-input"><em>$</em><input type="number" id="imp-gan" value="${state.impGan || 3000000}" step="100000"></div>
            <small>Para estimar los anticipos.</small>
          </label>
        </div>
        <button class="btn-primary" id="imp-calc">Calcular impuestos</button>
      </aside>
      <div class="imp-result" id="imp-result"><div class="inv-placeholder">Cargá tus operaciones y calculá.</div></div>
    </div>`;

  renderCalendarioImpuestos();
  renderRetenciones();

  const renderOps = () => {
    $("#imp-ops").innerHTML = state.impOps.map((op, i) => `
      <div class="imp-op-row" data-i="${i}">
        <select class="imp-tipo">
          <option value="venta" ${op.tipo==="venta"?"selected":""}>Venta</option>
          <option value="compra" ${op.tipo==="compra"?"selected":""}>Compra</option>
        </select>
        <div class="money-input"><em>$</em><input type="number" class="imp-neto" value="${op.neto}" step="10000" placeholder="Neto"></div>
        <input type="date" class="imp-fecha" value="${op.fecha}">
        <select class="imp-medio">
          <option value="banco" ${op.medio==="banco"?"selected":""}>Banco</option>
          <option value="efectivo" ${op.medio==="efectivo"?"selected":""}>Efectivo</option>
        </select>
        <button class="imp-del" data-i="${i}">×</button>
      </div>`).join("");
    // Wire
    $$(".imp-op-row").forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector(".imp-tipo").onchange = (e) => { state.impOps[i].tipo = e.target.value; };
      row.querySelector(".imp-neto").oninput = (e) => { state.impOps[i].neto = parseFloat(e.target.value) || 0; };
      row.querySelector(".imp-fecha").onchange = (e) => { state.impOps[i].fecha = e.target.value; };
      row.querySelector(".imp-medio").onchange = (e) => { state.impOps[i].medio = e.target.value; };
      row.querySelector(".imp-del").onclick = () => { state.impOps.splice(i, 1); renderOps(); };
    });
  };
  renderOps();

  $("#imp-add").onclick = () => {
    state.impOps.push({ fecha: monthDay(15), tipo: "venta", neto: 500000, medio: "banco" });
    renderOps();
  };

  const calc = async () => {
    state.impGan = parseFloat($("#imp-gan").value) || 0;
    $("#imp-result").innerHTML = `<div class="inv-placeholder">Calculando…</div>`;
    try {
      const r = await (await fetch("/api/impuestos/estimar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operaciones: state.impOps, ganancias_impuesto_anual: state.impGan }),
      })).json();
      if (!r.ok) { $("#imp-result").innerHTML = `<div class="inv-placeholder">⚠️ Error.</div>`; return; }
      state.impResult = r;
      const s = r.resumen, e = r.efectivo_vs_banco;
      $("#imp-result").innerHTML = `
        <div class="imp-kpis">
          <div class="imp-kpi hero"><small>Carga impositiva estimada</small><b>${money(s.carga_total_estimada)}</b><span>IVA + IIBB + imp. cheque</span></div>
          <div class="imp-kpi"><small>IVA a pagar</small><b>${money(s.total_iva)}</b></div>
          <div class="imp-kpi"><small>IIBB</small><b>${money(s.total_iibb)}</b></div>
          <div class="imp-kpi"><small>Impuesto al cheque</small><b>${money(s.impuesto_cheque)}</b></div>
          <div class="imp-kpi"><small>Anticipo Ganancias / mes</small><b>${money(s.anticipo_ganancias_mensual)}</b></div>
        </div>

        <div class="imp-cash card">
          <h3>Efectivo vs Banco</h3>
          <div class="imp-bar">
            <div class="imp-bar-fill" style="width:${e.pct_efectivo}%"></div>
          </div>
          <div class="imp-bar-labels">
            <span><b>${money(e.ventas_efectivo)}</b> en efectivo (${num(e.pct_efectivo)}%)</span>
            <span><b>${money(e.ventas_banco)}</b> bancarizado</span>
          </div>
          <p class="imp-note">${e.nota}</p>
        </div>

        <div class="imp-vtos card">
          <div class="imp-vtos-head">
            <h3>Vencimientos proyectados</h3>
            <button class="btn-primary sm" id="imp-to-cashflow">Llevar al flujo de caja →</button>
          </div>
          <table class="inv-table">
            <thead><tr><th>Vencimiento</th><th>Impuesto</th><th>Monto</th></tr></thead>
            <tbody>${r.vencimientos.map((v) => `<tr>
              <td>${fmtDate(v.fecha)}</td><td>${v.concepto}</td>
              <td class="neg">${money(v.monto)}</td></tr>`).join("")}</tbody>
          </table>
          <p class="imp-disclaimer">${r.disclaimer}</p>
        </div>`;

      $("#imp-to-cashflow").onclick = () => {
        // Agregar los vencimientos impositivos como movimientos del cash flow
        r.vencimientos.forEach((v) => addMovement({
          label: v.concepto, value: v.monto, date: v.fecha, recurrence: "none",
        }));
        project();
        switchView("flujo");
      };
    } catch {
      $("#imp-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };
  $("#imp-calc").onclick = calc;
  if (state.impResult) calc();
}

// ── Conciliación bancaria ────────────────────────────────
function renderConciliacion() {
  const wrap = $("#conc-wrap");
  const hasMovs = state.result && readMovements().length > 0;
  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Conciliación bancaria</div>
      <h2 class="inv-title">Extracto vs proyección</h2>
      <p class="inv-sub">Subí el extracto de tu banco y lo comparamos contra lo que proyectaste en el flujo de caja. Detecta desvíos, faltantes y movimientos no previstos.</p></div>

    <div class="conc-upload card">
      <div class="conc-upload-inner">
        <div>
          <h3>1. Subí el extracto del banco</h3>
          <p>Excel o CSV. Detecta las columnas automáticamente, sea cual sea el banco.</p>
        </div>
        <input type="file" id="conc-file" accept=".xlsx,.xls,.csv" style="display:none">
        <button class="btn-primary" id="conc-upload-btn" style="width:auto">↑ Subir extracto</button>
      </div>
      ${!hasMovs ? `<p class="conc-warn">⚠️ Primero cargá tus movimientos en Flujo de caja para poder comparar.</p>` : ""}
    </div>

    <div id="conc-result"></div>`;

  $("#conc-upload-btn").onclick = () => $("#conc-file").click();
  $("#conc-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = $("#conc-upload-btn");
    btn.textContent = "Procesando…";
    try {
      // 1. Parsear el extracto
      const fd = new FormData();
      fd.append("file", file);
      const imp = await (await fetch("/api/conciliacion/importar", { method: "POST", body: fd })).json();
      if (!imp.ok) { alert(imp.error || "No se pudo leer el extracto."); return; }

      // 2. Conciliar contra los movimientos proyectados (expandidos)
      const proyectados = expandMovementsForConc();
      const r = await (await fetch("/api/conciliacion/conciliar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proyectados, extracto: imp.movements }),
      })).json();
      renderConcResult(r, imp.count);
    } catch {
      alert("Error al procesar el extracto.");
    } finally {
      btn.textContent = "↑ Subir extracto";
      e.target.value = "";
    }
  };
}

// Expande los movimientos del cash flow a fechas concretas para conciliar
function expandMovementsForConc() {
  const movs = readMovements();
  const out = [];
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 90);
  movs.forEach((m) => {
    const base = new Date(m.date + "T00:00:00");
    if (m.recurrence === "none") {
      out.push({ date: m.date, amount: m.amount, label: m.label });
    } else {
      let d = new Date(base);
      let guard = 0;
      while (d <= end && guard < 200) {
        if (d >= start) out.push({ date: d.toISOString().slice(0, 10), amount: m.amount, label: m.label });
        if (m.recurrence === "weekly") d.setDate(d.getDate() + 7);
        else if (m.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
        else break;
        guard++;
      }
    }
  });
  return out;
}

function renderConcResult(r, extractoCount) {
  if (!r.ok) { $("#conc-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al conciliar.</div>`; return; }
  const s = r.resumen;
  const money2 = (v) => (v >= 0 ? "+" : "−") + money(Math.abs(v));

  const section = (title, items, cols, cls) => {
    if (!items.length) return "";
    return `<div class="conc-section card ${cls}">
      <h3>${title} <span class="conc-badge">${items.length}</span></h3>
      <table class="inv-table">
        <thead><tr>${cols.map((c) => `<th>${c.h}</th>`).join("")}</tr></thead>
        <tbody>${items.map((it) => `<tr>${cols.map((c) => `<td class="${c.cls ? c.cls(it) : ''}">${c.f(it)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
  };

  $("#conc-result").innerHTML = `
    <div class="conc-kpis">
      <div class="conc-kpi"><b>${s.tasa_conciliacion}%</b><small>conciliado</small></div>
      <div class="conc-kpi good"><b>${s.conciliados}</b><small>coinciden</small></div>
      <div class="conc-kpi warn"><b>${s.desvios}</b><small>con desvío</small></div>
      <div class="conc-kpi bad"><b>${s.faltantes}</b><small>faltantes</small></div>
      <div class="conc-kpi"><b>${s.sorpresas}</b><small>no previstos</small></div>
    </div>

    ${section("Con desvío de monto o fecha", r.desvios, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Esperabas", f: (x) => money(x.monto_proyectado) },
      { h: "Real", f: (x) => money(x.monto_real) },
      { h: "Diferencia", f: (x) => money2(x.diferencia), cls: (x) => x.diferencia < 0 ? "neg" : "in" },
      { h: "Días", f: (x) => x.dias_desvio },
    ], "warn")}

    ${section("Faltantes — proyectado que no apareció", r.faltantes, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Fecha", f: (x) => fmtDate(x.fecha) },
      { h: "Monto", f: (x) => money(x.monto), cls: () => "muted" },
    ], "bad")}

    ${section("No previstos — en el banco, sin proyectar", r.sorpresas, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Fecha", f: (x) => fmtDate(x.fecha) },
      { h: "Monto", f: (x) => money2(x.monto), cls: (x) => x.monto < 0 ? "neg" : "in" },
    ], "")}

    ${section("Conciliados correctamente", r.conciliados, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Monto", f: (x) => money(x.monto_real) },
      { h: "Fecha real", f: (x) => fmtDate(x.fecha_real) },
    ], "good")}`;
}

// ── Configuración ────────────────────────────────────────
function renderConfig() {
  const wrap = $("#config-wrap");
  const bancoOptions = (sel) => BANCOS_AR.map((b) => `<option value="${h(b)}" ${b === sel ? "selected" : ""}>${h(b)}</option>`).join("");
  const sec = state.cfgSection || "cuentas";

  const secciones = [
    { v: "cuentas", label: "Cuentas", icono: "🏦" },
    { v: "empresa", label: "Empresa", icono: "🏢" },
    { v: "impuestos", label: "Parámetros impositivos", icono: "📊" },
    { v: "preferencias", label: "Preferencias", icono: "⚙️" },
    { v: "datos", label: "Datos y respaldo", icono: "💾" },
  ];

  // Panel de la sección activa
  let panel = "";
  if (sec === "cuentas") {
    panel = `
      <div class="cfg-sec-head">
        <h3>Cuentas</h3>
        <button class="btn-primary sm" id="cfg-add-account">+ Agregar cuenta</button>
      </div>
      <p class="cfg-hint">Tus cuentas bancarias y la caja de efectivo. El efectivo y las billeteras se distinguen después en el <b>medio de pago</b> de cada movimiento.</p>
      <div id="cfg-accounts"></div>`;
  } else if (sec === "empresa") {
    panel = `
      <div class="cfg-sec-head"><h3>Datos de la empresa</h3></div>
      <p class="cfg-hint">Estos datos aparecen en el encabezado y en los reportes.</p>
      <div class="cfg-grid">
        <label class="field"><span>Nombre / Razón social</span>
          <input type="text" id="cfg-emp-nombre" value="${h(state.empresa.nombre)}" placeholder="Mi Empresa S.A."></label>
        <label class="field"><span>CUIT</span>
          <input type="text" id="cfg-emp-cuit" value="${h(state.empresa.cuit)}" placeholder="30-12345678-9"></label>
        <label class="field"><span>Provincia</span>
          <select id="cfg-emp-prov">${["","CABA","Buenos Aires","Córdoba","Santa Fe","Mendoza","Tucumán","Entre Ríos","Salta","Otra"].map(p=>`<option ${p===state.empresa.provincia?"selected":""}>${p||"Elegir…"}</option>`).join("")}</select></label>
      </div>
      <button class="btn-primary sm cfg-save-btn" id="cfg-save-empresa">Guardar cambios</button>`;
  } else if (sec === "impuestos") {
    const imp = state.impuestos || {};
    const on = (k, def) => imp[k] !== undefined ? imp[k] : def;
    panel = `
      <div class="cfg-sec-head"><h3>Parámetros impositivos</h3></div>
      <p class="cfg-hint">Elegí qué impuestos te aplican y sus alícuotas de referencia. Validalas con tu contador según tu actividad y provincia.</p>
      <div class="cfg-tax-list">
        <label class="cfg-tax-item">
          <input type="checkbox" id="tax-iva-on" ${on("ivaOn",true)?"checked":""}>
          <span class="cfg-tax-name">IVA</span>
          <span class="cfg-tax-rate"><input type="number" id="cfg-iva" value="${imp.iva ?? 21}" step="0.5"><em>%</em></span>
        </label>
        <label class="cfg-tax-item">
          <input type="checkbox" id="tax-iibb-on" ${on("iibbOn",true)?"checked":""}>
          <span class="cfg-tax-name">Ingresos Brutos (IIBB)</span>
          <span class="cfg-tax-rate"><input type="number" id="cfg-iibb" value="${imp.iibb ?? 3}" step="0.1"><em>%</em></span>
        </label>
        <label class="cfg-tax-item">
          <input type="checkbox" id="tax-debcred-on" ${on("debcredOn",true)?"checked":""}>
          <span class="cfg-tax-name">Impuesto a los débitos y créditos</span>
          <span class="cfg-tax-rate"><input type="number" id="cfg-debcred" value="${imp.debcred ?? 1.2}" step="0.1"><em>%</em></span>
        </label>
        <label class="cfg-tax-item">
          <input type="checkbox" id="tax-ganancias-on" ${on("gananciasOn",true)?"checked":""}>
          <span class="cfg-tax-name">Ganancias (anticipos)</span>
          <span class="cfg-tax-rate"><input type="number" id="cfg-ganancias" value="${imp.ganancias ?? 35}" step="1"><em>%</em></span>
        </label>
        <label class="cfg-tax-item">
          <input type="checkbox" id="tax-cargas-on" ${on("cargasOn",true)?"checked":""}>
          <span class="cfg-tax-name">Cargas sociales (F.931)</span>
          <span class="cfg-tax-rate cfg-tax-norate">sobre sueldos</span>
        </label>
      </div>
      <p class="cfg-hint" style="margin-top:10px">Los que dejes tildados aparecen en el calendario de vencimientos y en el estimador.</p>
      <button class="btn-primary sm cfg-save-btn" id="cfg-save-imp">Guardar cambios</button>`;
  } else if (sec === "preferencias") {
    panel = `
      <div class="cfg-sec-head"><h3>Preferencias</h3></div>
      <div class="cfg-grid">
        <label class="field"><span>Moneda de visualización</span>
          <select id="cfg-moneda">
            <option value="ARS" ${state.prefs.moneda==="ARS"?"selected":""}>Pesos (ARS)</option>
            <option value="USD" ${state.prefs.moneda==="USD"?"selected":""}>Dólares (USD)</option>
          </select></label>
        <label class="field"><span>Formato de fecha</span>
          <select id="cfg-fecha">
            <option value="dd/mm/aa" ${state.prefs.formatoFecha==="dd/mm/aa"?"selected":""}>dd/mm/aa</option>
            <option value="dd/mm/aaaa" ${state.prefs.formatoFecha==="dd/mm/aaaa"?"selected":""}>dd/mm/aaaa</option>
          </select></label>
      </div>
      <button class="btn-primary sm cfg-save-btn" id="cfg-save-prefs">Guardar cambios</button>`;
  } else if (sec === "datos") {
    panel = `
      <div class="cfg-sec-head"><h3>Datos y respaldo</h3></div>
      <p class="cfg-hint">Todos tus datos se guardan en este navegador. Podés reiniciar la app para empezar de cero.</p>
      <div class="cfg-datos-actions">
        <button class="btn-ghost cfg-danger" id="cfg-reset">Borrar todos mis datos</button>
      </div>
      <p class="cfg-hint" style="margin-top:12px">La app guarda automáticamente cada cambio. Si algo se ve raro, probá recargar con Cmd/Ctrl+Shift+R.</p>`;
  }

  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Configuración</div>
      <h2 class="inv-title">Ajustes de la aplicación</h2>
      <p class="inv-sub">Elegí una sección para editar. Tus cambios se guardan automáticamente.</p></div>

    <div class="cfg-layout">
      <aside class="cfg-nav">
        ${secciones.map(s => `<button class="cfg-nav-item ${s.v===sec?"active":""}" data-cfgsec="${s.v}">
          <span class="cfg-nav-ico">${s.icono}</span> ${s.label}
        </button>`).join("")}
      </aside>
      <div class="cfg-panel card">
        ${panel}
      </div>
    </div>`;

  // Navegación entre secciones
  $$(".cfg-nav-item").forEach(b => b.onclick = () => { state.cfgSection = b.dataset.cfgsec; renderConfig(); });

  // Sección Datos
  if (sec === "datos") {
    $("#cfg-reset").onclick = () => {
      if (!confirm("¿Borrar TODOS tus datos? Esta acción no se puede deshacer.")) return;
      localStorage.removeItem(STORE_KEY); location.reload();
    };
    return;
  }
  if (sec === "empresa") {
    $("#cfg-save-empresa").onclick = () => {
      state.empresa.nombre = $("#cfg-emp-nombre").value;
      state.empresa.cuit = $("#cfg-emp-cuit").value;
      state.empresa.provincia = $("#cfg-emp-prov").value;
      saveState(); flashSaved();
    };
    return;
  }
  if (sec === "impuestos") {
    $("#cfg-save-imp").onclick = () => {
      const i = state.impuestos;
      i.ivaOn = $("#tax-iva-on").checked;
      i.iibbOn = $("#tax-iibb-on").checked;
      i.debcredOn = $("#tax-debcred-on").checked;
      i.gananciasOn = $("#tax-ganancias-on").checked;
      i.cargasOn = $("#tax-cargas-on").checked;
      i.iva = parseFloat($("#cfg-iva").value) || 0;
      i.iibb = parseFloat($("#cfg-iibb").value) || 0;
      i.debcred = parseFloat($("#cfg-debcred").value) || 0;
      i.ganancias = parseFloat($("#cfg-ganancias").value) || 0;
      saveState(); flashSaved();
    };
    return;
  }
  if (sec === "preferencias") {
    $("#cfg-save-prefs").onclick = () => {
      state.prefs.moneda = $("#cfg-moneda").value;
      state.prefs.formatoFecha = $("#cfg-fecha").value;
      saveState(); flashSaved();
    };
    return;
  }
  // sec === "cuentas": continúa con el render de cuentas abajo

  const renderCfgAccounts = () => {
    if (!$("#cfg-accounts")) return;
    $("#cfg-accounts").innerHTML = state.accounts.map((a) => {
      const isEf = a.tipo === "efectivo";
      const isCom = a.tipo === "comitente";
      return `
      <div class="cfg-account" data-id="${a.id}">
        <div class="cfg-acc-grid">
          <label class="field"><span>Nombre</span>
            <input type="text" class="ca-name" value="${h(a.name)}" placeholder="${isCom?'Ej: Comitente Balanz':'Ej: Cuenta operativa'}"></label>
          <label class="field"><span>Tipo</span>
            <select class="ca-tipo">
              <option value="ca" ${a.tipo==="ca"?"selected":""}>Caja de ahorro</option>
              <option value="cc" ${a.tipo==="cc"?"selected":""}>Cuenta corriente</option>
              <option value="efectivo" ${a.tipo==="efectivo"?"selected":""}>Efectivo / Caja</option>
              <option value="comitente" ${a.tipo==="comitente"?"selected":""}>Cuenta comitente (inversión)</option>
            </select></label>
          <label class="field ca-broker-field" ${isCom?'':'style="display:none"'}><span>Broker / ALyC</span>
            <input type="text" class="ca-broker" value="${h(a.broker||"")}" placeholder="Ej: Balanz, IOL, PPI, Bull Market"></label>
          <label class="field ca-banco-field" ${isEf?'style="display:none"':''}><span>${isCom?'Banco asociado (opcional)':'Banco'}</span>
            <select class="ca-banco"><option value="">${isCom?'— Sin banco asociado —':'Elegir banco'}</option>${bancoOptions(a.banco)}</select></label>
          <label class="field"><span>Moneda</span>
            <select class="ca-moneda">
              <option value="ARS" ${a.moneda==="ARS"?"selected":""}>Pesos (ARS)</option>
              <option value="USD" ${a.moneda==="USD"?"selected":""}>Dólares (USD)</option>
            </select></label>
          <label class="field ca-alias-field" ${isEf?'style="display:none"':''}><span>${isCom?'N° de comitente (opcional)':'N° cuenta / alias (opcional)'}</span>
            <input type="text" class="ca-alias" value="${h(a.alias||"")}" placeholder="${isCom?'123456':'mi.alias.mp'}"></label>
          <label class="field"><span>Saldo inicial</span>
            <div class="money-input"><em>$</em><input type="number" class="ca-opening" value="${a.opening}" step="1000"></div></label>
        </div>
        <button class="cfg-acc-del" title="Eliminar">Eliminar cuenta</button>
      </div>`;
    }).join("");

    $$(".cfg-account").forEach((row) => {
      const id = row.dataset.id;
      const acc = state.accounts.find((a) => a.id === id);
      row.querySelector(".ca-name").oninput = (e) => { acc.name = e.target.value; saveState(); };
      row.querySelector(".ca-banco").onchange = (e) => { acc.banco = e.target.value; saveState(); };
      row.querySelector(".ca-moneda").onchange = (e) => { acc.moneda = e.target.value; renderAccounts(); syncAccountSelectors(); project(); };
      row.querySelector(".ca-alias").oninput = (e) => { acc.alias = e.target.value; saveState(); };
      row.querySelector(".ca-opening").oninput = (e) => { acc.opening = parseFloat(e.target.value) || 0; project(); };
      const brokerInput = row.querySelector(".ca-broker");
      if (brokerInput) brokerInput.oninput = (e) => { acc.broker = e.target.value; saveState(); };
      row.querySelector(".ca-tipo").onchange = (e) => {
        acc.tipo = e.target.value;
        const isEf = acc.tipo === "efectivo";
        const isCom = acc.tipo === "comitente";
        row.querySelector(".ca-banco-field").style.display = isEf ? "none" : "";
        row.querySelector(".ca-alias-field").style.display = isEf ? "none" : "";
        row.querySelector(".ca-broker-field").style.display = isCom ? "" : "none";
        saveState();
        renderCfgAccounts(); // re-render para actualizar labels/placeholders
        renderAccounts(); syncAccountSelectors();
      };
      row.querySelector(".cfg-acc-del").onclick = () => {
        if (state.accounts.length <= 1) { alert("Tenés que tener al menos una cuenta."); return; }
        state.accounts = state.accounts.filter((a) => a.id !== id);
        const fallback = state.accounts[0].id;
        state.movements.forEach((m) => { if (m.account === id) m.account = fallback; });
        renderCfgAccounts();
        renderAccounts(); syncAccountSelectors(); project();
      };
    });
  };
  renderCfgAccounts();

  const addBtn = $("#cfg-add-account");
  if (addBtn) addBtn.onclick = () => {
    state.accounts.push({ id: newAccountId(), name: "Nueva cuenta", banco: BANCOS_AR[0], tipo: "ca", moneda: "ARS", alias: "", opening: 0 });
    renderCfgAccounts();
    renderAccounts(); syncAccountSelectors();
  };
}

// ── Navegación ───────────────────────────────────────────
const INV_GROUP = ["inversiones", "excedente", "fci", "mercado"];
function switchView(view) {
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  $$(".nav-sub").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  // Marcar el grupo "Inversiones" activo si estamos en una de sus vistas
  const dropBtn = document.querySelector(".nav-drop-btn");
  if (dropBtn) dropBtn.classList.toggle("group-active", INV_GROUP.includes(view));
  // Cerrar el menú
  document.querySelector(".nav-dropdown")?.classList.remove("open");

  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  if (view === "dashboard") renderDashboard();
  if (view === "saldos") renderSaldos();
  if (view === "comprobantes") renderComprobantes();
  if (view === "cartera") renderCartera();
  if (view === "inversiones") renderInversiones();
  if (view === "divisas") renderDivisas();
  if (view === "mercado") renderMercado();
  if (view === "fci") renderFCI();
  if (view === "impuestos") renderImpuestos();
  if (view === "contabilidad") renderContabilidad();
  if (view === "conciliacion") renderConciliacion();
  if (view === "config") renderConfig();
}

// ── Init ─────────────────────────────────────────────────
function init() {
  if (loadState()) {
    // Estado restaurado desde el navegador: aplicar prefs al panel
    if ($("#buffer")) $("#buffer").value = state.prefs.colchon;
    if ($("#horizon")) $("#horizon").value = state.prefs.horizonte;
  } else {
    // Primera vez, sin datos guardados: demo mínima para no arrancar en blanco.
    state.accounts = [
      { id: "acc-cc", name: "Cuenta corriente", banco: "Banco de la Nación Argentina", tipo: "cc", moneda: "ARS", alias: "", opening: 2000000 },
      { id: "acc-caja", name: "Caja / Efectivo", banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 150000 },
    ];
    state.movements = [
      { label: "Cobranza de cliente", amount: 800000, date: monthDay(20), recurrence: "monthly", medio: "transferencia", account: "acc-cc" },
      { label: "Alquiler", amount: -250000, date: monthDay(10), recurrence: "monthly", medio: "transferencia", account: "acc-cc" },
      { label: "Sueldos", amount: -450000, date: monthDay(5), recurrence: "monthly", medio: "transferencia", account: "acc-cc" },
    ];
  }

  $("#add-mov").addEventListener("click", () => openMovModal());

  // Modal de movimiento
  $("#mov-modal-close").addEventListener("click", closeMovModal);
  $("#mov-modal-cancel").addEventListener("click", closeMovModal);
  $("#mov-modal").addEventListener("click", (e) => {
    if (e.target.id === "mov-modal") closeMovModal();
  });
  $("#mov-modal-save").addEventListener("click", saveMovFromModal);
  // Tabs de modalidad (simple/cheque/cuotas)
  $$(".mov-mode").forEach((b) => b.addEventListener("click", () => setMovMode(b.dataset.mode)));
  $("#m-add-cuota").addEventListener("click", () => {
    state._cuotas = state._cuotas || [];
    state._cuotas.push({ date: "", amount: "" });
    renderCuotas();
  });
  $("#m-account").addEventListener("change", () => { updateModalCurrency(); renderCuotas(); });

  // Modal de inversión
  $("#inv-modal-save").addEventListener("click", saveInvFromModal);
  $("#inv-modal-close").addEventListener("click", closeInvModal);
  $("#inv-modal-cancel").addEventListener("click", closeInvModal);
  $("#i-tipo").addEventListener("change", () => { updateInvTipo(); updateInvPreview(); });
  $("#i-account").addEventListener("change", () => { updateInvTipo(); updateInvPreview(); });
  ["#i-monto","#i-rend","#i-fecha","#i-venc"].forEach(sel =>
    $(sel).addEventListener("input", updateInvPreview));

  // Modal de comprobante (cobranzas/pagos)
  $("#comp-modal-save").addEventListener("click", saveCompFromModal);
  $("#comp-modal-close").addEventListener("click", closeCompModal);
  $("#comp-modal-cancel").addEventListener("click", closeCompModal);
  $$(".comp-mode").forEach(b => b.addEventListener("click", () => setCompMode(b.dataset.ctipo)));
  $("#c-account").addEventListener("change", syncCompAccount);

  // Modal de proveedor
  // Modal de import AFIP
  $("#afip-modal-confirm").addEventListener("click", confirmarAfip);
  $("#afip-modal-close").addEventListener("click", closeAfipModal);
  $("#afip-modal-cancel").addEventListener("click", closeAfipModal);

  $("#prov-modal-save").addEventListener("click", saveProvFromModal);
  $("#prov-modal-close").addEventListener("click", closeProvModal);
  $("#prov-modal-cancel").addEventListener("click", closeProvModal);

  // Importar desde Excel/CSV
  $("#import-mov").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = $("#import-mov");
    const orig = btn.textContent;
    btn.textContent = "Importando…";
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cashflow/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "No se pudo importar el archivo.");
        return;
      }
      // ¿Reemplazar o agregar a lo existente?
      let replace = true;
      if (state.movements.length > 0) {
        replace = confirm(`Ya tenés ${state.movements.length} movimientos cargados.\n\nAceptar = reemplazar todo por lo importado.\nCancelar = agregar los importados a los que ya tenés.`);
      }
      if (replace) state.movements = [];
      data.movements.forEach((m) => addMovement({
        label: m.label,
        value: m.amount,
        date: m.date,
        recurrence: m.recurrence || "none",
        medio: m.medio,
        account: resolveAccountText(m.account_text),
      }));
      renderAccounts(); syncAccountSelectors();
      project();
      const skipped = data.skipped ? ` (${data.skipped} filas sin datos válidos se omitieron)` : "";
      alert(`Se importaron ${data.count} movimientos${skipped}.`);
    } catch {
      alert("Error al importar el archivo.");
    } finally {
      btn.textContent = orig;
      e.target.value = "";
    }
  });
  ["#buffer", "#horizon"].forEach((sel) =>
    $(sel).addEventListener("input", project)
  );
  // Cuentas
  renderAccounts();
  syncAccountSelectors();
  $("#acc-manage-link")?.addEventListener("click", () => switchView("config"));
  $("#cf-account-filter").addEventListener("change", (e) => {
    state.cfAccount = e.target.value;
    project();
  });
  $$(".nav-item[data-view]").forEach((n) =>
    n.addEventListener("click", () => { if (!n.disabled) switchView(n.dataset.view); })
  );
  $$(".nav-sub").forEach((n) =>
    n.addEventListener("click", () => switchView(n.dataset.view))
  );
  // Dropdown de Inversiones: abrir/cerrar
  const dropBtn = document.querySelector(".nav-drop-btn");
  const dropdown = document.querySelector(".nav-dropdown");
  if (dropBtn && dropdown) {
    dropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("open");
    });
    document.addEventListener("click", () => dropdown.classList.remove("open"));
  }

  // Toggle día / semana en la tabla
  // Botones rápidos de período
  $$("#cf-quick .qk").forEach((b) =>
    b.addEventListener("click", () => {
      state.cfRange = b.dataset.range;
      state.cfFrom = null; state.cfTo = null; // limpiar rango custom
      state.cfOpenDay = null;
      $$("#cf-quick .qk").forEach((x) => x.classList.toggle("active", x.dataset.range === state.cfRange));
      // Limpiar inputs de rango custom
      const { from, to } = cfRangeDates();
      if ($("#cf-from")) $("#cf-from").value = from;
      if ($("#cf-to")) $("#cf-to").value = to;
      renderCashflowTable();
    })
  );
  // Rango personalizado
  const applyCustom = () => {
    const f = $("#cf-from").value, t = $("#cf-to").value;
    if (f && t) {
      state.cfFrom = f; state.cfTo = t;
      $$("#cf-quick .qk").forEach((x) => x.classList.remove("active"));
      renderCashflowTable();
    }
  };
  $("#cf-from")?.addEventListener("change", applyCustom);
  $("#cf-to")?.addEventListener("change", applyCustom);
  // Inicializar los inputs con el rango por defecto
  const initRange = cfRangeDates();
  if ($("#cf-from")) $("#cf-from").value = initRange.from;
  if ($("#cf-to")) $("#cf-to").value = initRange.to;

  project();
  renderDashboard();
}

function monthDay(day) {
  const d = new Date();
  d.setDate(day);
  if (d < new Date()) d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

init();
