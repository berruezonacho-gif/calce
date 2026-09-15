// analisis_fiscal.js — Análisis fiscal: posición de IVA, estimación de
// Ganancias con ajustes cargables, y recomendaciones explicables.
// Adaptado del prototipo backend (calculations.py + rules.py) al frontend
// de Calce, reusando state.comprobantes / state.retenciones.
// Criterio prudente heredado del backend: el resultado documental NO es la
// base de Ganancias; toda recomendación requiere aprobación profesional.

let anPeriodo = "mes"; // mes | anio | todo

function anRango() {
  const hoy = new Date();
  if (anPeriodo === "ejercicio") {
    // Ejercicio fiscal según el mes de cierre configurado (1-12). Si cierra en
    // diciembre, coincide con el año calendario. Si cierra en otro mes, el
    // ejercicio va desde el mes siguiente al cierre del año anterior.
    const cierre = (state.empresa && state.empresa.mesCierre) || 12; // mes de cierre 1-12
    // Determinar en qué ejercicio estamos hoy
    let finAño = hoy.getFullYear();
    // el ejercicio termina el último día del mes de cierre
    const finEsteAño = new Date(finAño, cierre, 0); // día 0 del mes siguiente = último del mes cierre
    if (hoy > finEsteAño) finAño++;
    const fin = new Date(finAño, cierre, 0);
    const inicio = new Date(finAño - 1, cierre, 1); // primer día del mes siguiente al cierre anterior
    const nomMes = ["","enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][cierre];
    return { from: inicio.toISOString().slice(0,10), to: fin.toISOString().slice(0,10),
             label: `Ejercicio (cierre ${nomMes} ${finAño})` };
  }
  if (anPeriodo === "anio") return { from: `${hoy.getFullYear()}-01-01`, to: `${hoy.getFullYear()}-12-31`, label: `Año ${hoy.getFullYear()}` };
  if (anPeriodo === "todo") return { from: "1900-01-01", to: "2100-12-31", label: "Todo el historial" };
  const from = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const to = new Date(hoy.getFullYear(), hoy.getMonth()+1, 0);
  return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10), label: hoy.toLocaleDateString("es-AR",{month:"long",year:"numeric"}) };
}

// Cálculo fiscal del período (adaptado de monthly_report en calculations.py)
function calcularFiscal(from, to) {
  const dentro = (iso) => iso && iso >= from && iso <= to;
  const comps = (state.comprobantes || []).filter(c => dentro(c.emision));
  const ventas = comps.filter(c => c.tipo === "cobrar");
  const compras = comps.filter(c => c.tipo === "pagar");

  // IVA
  const ivaDebito = ventas.reduce((s,c) => s + (c.iva || 0), 0);          // IVA de ventas
  const ivaCreditoPotencial = compras.reduce((s,c) => s + (c.iva || 0), 0); // IVA de compras (potencial)
  // Criterio prudente: el crédito NO se computa hasta que se valide
  // explícitamente (c.ivaComputable === true). Nunca por ausencia de dato.
  const ivaCreditoValidado = compras.reduce((s,c) => s + ((c.ivaComputable === true) ? (c.iva || 0) : 0), 0);
  // Retenciones/percepciones de IVA sufridas en el período
  const rets = (state.retenciones || []).filter(r => dentro(r.fecha));
  const ivaRetPerc = rets.filter(r => (r.impuesto||"").toUpperCase().includes("IVA")).reduce((s,r) => s + (r.importe||0), 0);
  const posicionIVA = ivaDebito - ivaCreditoValidado - ivaRetPerc;

  // Resultado documental (ventas netas − compras netas). NO es base de Ganancias.
  // Base de resultado = neto gravado + no gravado + exento (NUNCA el monto
  // total, que incluye IVA). Si no hay ningún componente, es 0 (no el total).
  const baseResultado = (c) => {
    const tiene = (c.neto != null) || (c.noGravado != null) || (c.exento != null);
    if (tiene) return (c.neto||0) + (c.noGravado||0) + (c.exento||0);
    // Sin discriminación fiscal: usar el monto (caja simple, sin IVA conocido)
    return c.monto || 0;
  };
  const ventasNeto = ventas.reduce((s,c) => s + baseResultado(c), 0);
  const comprasNeto = compras.reduce((s,c) => s + baseResultado(c), 0);
  const resultadoDocumental = ventasNeto - comprasNeto;

  return {
    from, to, ventasNeto, comprasNeto, resultadoDocumental,
    ivaDebito, ivaCreditoPotencial, ivaCreditoValidado, ivaRetPerc, posicionIVA,
    nVentas: ventas.length, nCompras: compras.length,
    retGanancias: rets.filter(r => (r.impuesto||"").toUpperCase().includes("GANANCIA")).reduce((s,r)=>s+(r.importe||0),0),
  };
}

// Estimación de Ganancias con ajustes cargables (orientativa)
// Escalas de Ganancias vigentes 2026 (ARCA). Montos actualizados por IPC.
// Cada tramo: {hasta, alicuota, fijo} — impuesto = fijo + alicuota*(base − desde).
const ESCALAS_GANANCIAS = {
  sociedad: {
    label: "Sociedad (SA, SRL) — Art. 73",
    tramos: [
      { desde: 0,           hasta: 133200000,  alicuota: 0.25, fijo: 0 },
      { desde: 133200000,   hasta: 1332000000, alicuota: 0.30, fijo: 33300000 },
      { desde: 1332000000,  hasta: Infinity,   alicuota: 0.35, fijo: 392940000 },
    ],
  },
  persona: {
    label: "Persona humana — Art. 94 (escala progresiva)",
    // Escala anualizada aproximada 2026 (referencia; se actualiza por semestre)
    tramos: [
      { desde: 0,          hasta: 3800000,   alicuota: 0.05, fijo: 0 },
      { desde: 3800000,    hasta: 7600000,   alicuota: 0.09, fijo: 190000 },
      { desde: 7600000,    hasta: 11400000,  alicuota: 0.12, fijo: 532000 },
      { desde: 11400000,   hasta: 15200000,  alicuota: 0.15, fijo: 988000 },
      { desde: 15200000,   hasta: 22800000,  alicuota: 0.19, fijo: 1558000 },
      { desde: 22800000,   hasta: 30400000,  alicuota: 0.23, fijo: 3002000 },
      { desde: 30400000,   hasta: 45600000,  alicuota: 0.27, fijo: 4750000 },
      { desde: 45600000,   hasta: 60800000,  alicuota: 0.31, fijo: 8854000 },
      { desde: 60800000,   hasta: Infinity,  alicuota: 0.35, fijo: 13566000 },
    ],
  },
};

// Calcula el impuesto por escala y en qué tramo cae, más cuánto falta para el siguiente.
function calcularEscala(base, regimen) {
  const esc = ESCALAS_GANANCIAS[regimen] || ESCALAS_GANANCIAS.sociedad;
  if (base <= 0) return { impuesto: 0, tramo: esc.tramos[0], idx: 0, marginal: esc.tramos[0].alicuota, faltaSiguiente: null, escala: esc };
  let idx = esc.tramos.findIndex(t => base <= t.hasta);
  if (idx === -1) idx = esc.tramos.length - 1;
  const t = esc.tramos[idx];
  const impuesto = t.fijo + t.alicuota * (base - t.desde);
  // Cuánto falta para saltar al tramo siguiente (donde la ganancia marginal paga más)
  let faltaSiguiente = null, siguiente = null;
  if (idx < esc.tramos.length - 1) {
    faltaSiguiente = t.hasta - base;
    siguiente = esc.tramos[idx + 1];
  }
  return { impuesto, tramo: t, idx, marginal: t.alicuota, faltaSiguiente, siguiente, escala: esc };
}

function estimarGanancias(fiscal) {
  const regimen = (state.empresa && state.empresa.regimenGan) || "sociedad";
  let baseAjustada = fiscal.resultadoDocumental;
  (state.ganAjustes || []).forEach(a => {
    const monto = parseFloat(a.monto) || 0;
    baseAjustada += (a.direccion === "resta") ? -monto : monto;
  });
  const esc = calcularEscala(Math.max(0, baseAjustada), regimen);
  const impuestoEstimado = Math.max(0, esc.impuesto);
  const aPagar = Math.max(0, impuestoEstimado - fiscal.retGanancias);
  const tasaEfectiva = baseAjustada > 0 ? impuestoEstimado / baseAjustada : 0;
  return {
    regimen, baseAjustada, impuestoEstimado, aPagar, retGanancias: fiscal.retGanancias,
    tramo: esc.tramo, idx: esc.idx, marginal: esc.marginal, faltaSiguiente: esc.faltaSiguiente,
    siguiente: esc.siguiente, escala: esc.escala, tasaEfectiva,
  };
}

// Motor de recomendaciones explicables (adaptado de rules.py)
function recomendacionesFiscales(fiscal, gan) {
  const out = [];
  const add = (variable, condicion, diagnostico, accion, prioridad, evidencia) =>
    out.push({ variable, condicion, diagnostico, accion, prioridad, evidencia });

  if (fiscal.posicionIVA > 0) {
    add("IVA", "Posición a pagar", "El débito de tus ventas supera al crédito computable y las retenciones.",
      "Revisá créditos pendientes de computar, saldos a favor de períodos anteriores y que tengas caja para el vencimiento.", "alta",
      ["Libro IVA", "DDJJ", "certificados de retención", "extractos bancarios"]);
  } else {
    add("IVA", "Saldo a favor", "Tus créditos y retenciones superan el débito del período.",
      "Analizá la composición, antigüedad y recuperabilidad del saldo a favor.", "media",
      ["Libro IVA", "DDJJ"]);
  }
  if (fiscal.ivaCreditoPotencial > fiscal.ivaCreditoValidado) {
    add("IVA", "Crédito potencial no validado", "Hay comprobantes de compra cuyo IVA todavía no fue validado como computable.",
      "Clasificá cada factura por vinculación con la actividad, titularidad y período para confirmar su computabilidad.", "alta",
      ["facturas de compra", "imputación contable"]);
  }
  if (gan.aPagar > 0) {
    add("GANANCIAS", "Estimación a pagar", "La estimación orientativa arroja impuesto a pagar tras los ajustes cargados.",
      "Revisá con tu contador el puente contable-fiscal: amortizaciones, ajuste por inflación, stock, quebrantos y anticipos.", "alta",
      ["balance", "mayor", "papeles de trabajo fiscales"]);
  } else {
    add("GANANCIAS", "Sin impuesto estimado", "Con los ajustes cargados no surge impuesto a pagar en Ganancias.",
      "Confirmá que los ajustes (amortizaciones, quebrantos) estén completos y validados por tu contador.", "media",
      ["balance", "papeles de trabajo"]);
  }
  // Aviso de proximidad al tramo siguiente de la escala
  if (gan.faltaSiguiente != null && gan.siguiente && gan.baseAjustada > 0) {
    const t = gan.tramo, sig = gan.siguiente;
    const porcTramo = (gan.baseAjustada - t.desde) / (t.hasta - t.desde);
    if (porcTramo >= 0.8) {
      add("GANANCIAS", "Cerca de saltar de tramo",
        `Tu ganancia estimada (${money2(gan.baseAjustada)}) está a ${money2(gan.faltaSiguiente)} de superar el tramo del ${(t.alicuota*100).toFixed(0)}%. El excedente pasaría a tributar al ${(sig.alicuota*100).toFixed(0)}%.`,
        "Si estás por cerrar el ejercicio, evaluá con tu contador diferir ingresos o adelantar gastos deducibles para no saltar de tramo.", "alta",
        ["proyección de resultado", "gastos deducibles pendientes", "cronograma de facturación"]);
    }
  }
  // Cash vs mínimo (colchón definido en prefs)
  const colchon = (state.prefs && state.prefs.colchon) || 0;
  const liquido = state.accounts ? state.accounts.filter(a => a.moneda==="ARS").reduce((s,a)=> s + (typeof saldoCuentaAFecha==="function"?saldoCuentaAFecha(a):0), 0) : 0;
  if (liquido < colchon) {
    add("CAJA", "Liquidez bajo el mínimo", "Tu liquidez actual quedó por debajo del colchón de caja definido.",
      "Revisá cobranzas pendientes, vencimientos próximos, opciones de financiación y pagos no críticos que puedas diferir.", "alta",
      ["extractos", "cuentas por cobrar", "cuentas por pagar", "calendario fiscal"]);
  }
  return out;
}

function renderAnalisisFiscal() {
  const wrap = $("#analisis-wrap");
  const { from, to, label } = anRango();
  const fiscal = calcularFiscal(from, to);
  const gan = estimarGanancias(fiscal);
  const recs = recomendacionesFiscales(fiscal, gan);
  const prioColor = { alta: "#B23A3A", media: "#C86A00", baja: "#64748B" };
  const prioLabel = { alta: "Prioridad alta", media: "Prioridad media", baja: "Prioridad baja" };

  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Análisis del negocio</div>
      <h2 class="inv-title">Resultado económico</h2>
      <p class="inv-sub">Tu posición de IVA, una estimación de Ganancias y recomendaciones para revisar con tu contador.</p></div>

    <div class="conta-bar">
      <div class="conta-periodo">
        <button class="cper ${anPeriodo==="mes"?"active":""}" data-anper="mes">Este mes</button>
        <button class="cper ${anPeriodo==="anio"?"active":""}" data-anper="anio">Año calendario</button>
        <button class="cper ${anPeriodo==="ejercicio"?"active":""}" data-anper="ejercicio">Ejercicio fiscal</button>
        <button class="cper ${anPeriodo==="todo"?"active":""}" data-anper="todo">Todo</button>
      </div>
      <div class="af-cierre">
        <label>Cierre de ejercicio:
          <select id="af-mescierre">
            ${["","enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"].slice(1).map((m,i)=>`<option value="${i+1}" ${((state.empresa&&state.empresa.mesCierre)||12)===i+1?"selected":""}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join("")}
          </select>
        </label>
      </div>
      <button class="btn-primary sm" id="af-report">↓ Reporte fiscal-financiero (Excel)</button>
    </div>

    <!-- Posición de IVA -->
    <div class="af-card">
      <h3>Posición de IVA · ${h(label)}</h3>
      <div class="af-ivalist">
        <div class="af-ivarow"><span>IVA débito (ventas)</span><b class="out">${money(fiscal.ivaDebito)}</b></div>
        <div class="af-ivarow"><span>− IVA crédito computable (compras validadas)</span><b class="in">−${money(fiscal.ivaCreditoValidado)}</b></div>
        <div class="af-ivarow"><span>− Retenciones/percepciones IVA</span><b class="in">−${money(fiscal.ivaRetPerc)}</b></div>
        <div class="af-ivarow total ${fiscal.posicionIVA>0?'pos':'neg'}">
          <span>${fiscal.posicionIVA>0?'Posición a PAGAR':'Saldo a FAVOR'}</span>
          <b>${money(Math.abs(fiscal.posicionIVA))}</b>
        </div>
      </div>
      ${fiscal.ivaCreditoPotencial > fiscal.ivaCreditoValidado ? `<p class="af-warn">⚠ Hay ${money(fiscal.ivaCreditoPotencial - fiscal.ivaCreditoValidado)} de IVA crédito <b>potencial sin validar</b>. No se computa hasta que el contador confirme que cada factura es computable (vinculación, titularidad, período).</p>` : ""}
    </div>

    <!-- Estimación de Ganancias -->
    <div class="af-card">
      <div class="af-card-head">
        <h3>Estimación de Ganancias · ${h(label)}</h3>
        <span class="af-orient">Orientativo — no reemplaza la DDJJ</span>
      </div>
      <div class="af-regimen">
        <label>Régimen:
          <select id="af-regimen">
            <option value="sociedad" ${gan.regimen==="sociedad"?"selected":""}>Sociedad (SA, SRL)</option>
            <option value="persona" ${gan.regimen==="persona"?"selected":""}>Persona humana</option>
          </select>
        </label>
        <span class="af-escala-label">${h(gan.escala.label)}</span>
      </div>
      <div class="af-ganlist">
        <div class="af-ivarow"><span>Resultado documental (ventas − compras, netos)</span><b>${money(fiscal.resultadoDocumental)}</b></div>
        <div id="af-ajustes"></div>
        <div class="af-ivarow"><span>= Base ajustada (ganancia neta imponible)</span><b>${money(gan.baseAjustada)}</b></div>
        <div class="af-ivarow"><span>Impuesto por escala (tramo ${(gan.marginal*100).toFixed(0)}% marginal)</span><b>${money(gan.impuestoEstimado)}</b></div>
        <div class="af-ivarow"><span>Tasa efectiva</span><b>${(gan.tasaEfectiva*100).toFixed(1)}%</b></div>
        <div class="af-ivarow"><span>− Retenciones de Ganancias sufridas</span><b class="in">−${money(gan.retGanancias)}</b></div>
        <div class="af-ivarow total ${gan.aPagar>0?'pos':'neg'}"><span>${gan.aPagar>0?'Estimado a pagar':'Sin saldo a pagar'}</span><b>${money(gan.aPagar)}</b></div>
      </div>
      ${gan.faltaSiguiente!=null && gan.siguiente ? `<div class="af-tramo ${(gan.baseAjustada-gan.tramo.desde)/(gan.tramo.hasta-gan.tramo.desde)>=0.8?'af-tramo-alerta':''}">
        <div class="af-tramo-bar"><div class="af-tramo-fill" style="width:${Math.min(100,Math.round((gan.baseAjustada-gan.tramo.desde)/(gan.tramo.hasta-gan.tramo.desde)*100))}%"></div></div>
        <span>Estás en el tramo del <b>${(gan.tramo.alicuota*100).toFixed(0)}%</b>. Te faltan <b>${money(gan.faltaSiguiente)}</b> de ganancia para saltar al <b>${(gan.siguiente.alicuota*100).toFixed(0)}%</b>.</span>
      </div>` : `<div class="af-tramo"><span>Estás en el tramo máximo (${(gan.tramo.alicuota*100).toFixed(0)}%).</span></div>`}
      <button class="btn-ghost sm" id="af-add-ajuste">+ Agregar ajuste (amortización, quebranto…)</button>
      <p class="af-nota">El resultado documental no es la base fiscal de Ganancias. Los ajustes acercan la estimación a la realidad, pero la declaración final la determina tu contador con el balance. Escala vigente 2026 (ARCA).</p>
    </div>

    <!-- Recomendaciones explicables -->
    <div class="af-card">
      <h3>Recomendaciones</h3>
      <p class="af-sub">Revisiones sugeridas según tu posición. Todas requieren aprobación profesional.</p>
      <div class="af-recs">
        ${recs.map(r => `<div class="af-rec">
          <div class="af-rec-head">
            <span class="af-rec-var">${h(r.variable)}</span>
            <span class="af-rec-cond">${h(r.condicion)}</span>
            <span class="af-rec-prio" style="color:${prioColor[r.prioridad]};border-color:${prioColor[r.prioridad]}">${prioLabel[r.prioridad]}</span>
          </div>
          <p class="af-rec-diag">${h(r.diagnostico)}</p>
          <p class="af-rec-accion"><b>Qué hacer:</b> ${h(r.accion)}</p>
          <p class="af-rec-evid"><b>Documentación:</b> ${r.evidencia.map(h).join(" · ")}</p>
        </div>`).join("")}
      </div>
    </div>`;

  $$("[data-anper]").forEach(b => b.onclick = () => { anPeriodo = b.dataset.anper; renderAnalisisFiscal(); });
  const regSel = $("#af-regimen");
  if (regSel) regSel.onchange = () => { if(!state.empresa) state.empresa={}; state.empresa.regimenGan = regSel.value; saveState(); renderAnalisisFiscal(); };
  const cierreSel = $("#af-mescierre");
  if (cierreSel) cierreSel.onchange = () => { if(!state.empresa) state.empresa={}; state.empresa.mesCierre = parseInt(cierreSel.value); saveState(); renderAnalisisFiscal(); };
  const repBtn = $("#af-report");
  if (repBtn) repBtn.onclick = () => { if (typeof exportarReporteFiscalExcel === "function") exportarReporteFiscalExcel(); else alert("Reporte no disponible."); };
  renderGanAjustes();
  const addBtn = $("#af-add-ajuste");
  if (addBtn) addBtn.onclick = () => abrirModalAjuste();
}

// Tipos de ajuste típicos del puente contable-fiscal
const TIPOS_AJUSTE = [
  { v: "amortizacion", label: "Amortización de bienes de uso", dir: "resta", ayuda: "Depreciación de equipos, muebles, rodados (deducible)" },
  { v: "quebranto", label: "Quebranto de ejercicios anteriores", dir: "resta", ayuda: "Pérdidas acumuladas que se compensan (hasta 5 años)" },
  { v: "ajuste_inflacion", label: "Ajuste por inflación impositivo", dir: "resta", ayuda: "Ajuste del Título VI (puede sumar o restar)" },
  { v: "no_deducible", label: "Gastos no deducibles", dir: "suma", ayuda: "Multas, intereses de mora, gastos sin comprobante (suman a la base)" },
  { v: "prevision", label: "Previsiones / provisiones no admitidas", dir: "suma", ayuda: "Previsiones contables que fiscalmente no se admiten" },
  { v: "honorarios", label: "Honorarios directores (tope)", dir: "suma", ayuda: "Excedente del tope deducible de honorarios" },
  { v: "otro", label: "Otro ajuste", dir: "resta", ayuda: "Cualquier otro ajuste contable-fiscal" },
];

function abrirModalAjuste() {
  const m = $("#ajuste-modal");
  if (!m) return;
  $("#aj-tipo").innerHTML = TIPOS_AJUSTE.map(t => `<option value="${t.v}">${t.label}</option>`).join("");
  $("#aj-monto").value = "";
  const syncAyuda = () => {
    const t = TIPOS_AJUSTE.find(x => x.v === $("#aj-tipo").value);
    $("#aj-ayuda").textContent = t ? t.ayuda : "";
    $("#aj-dir").value = t ? t.dir : "resta";
  };
  $("#aj-tipo").onchange = syncAyuda;
  syncAyuda();
  m.classList.remove("hidden");
  setTimeout(() => $("#aj-monto").focus(), 50);
}
function guardarAjuste() {
  const t = TIPOS_AJUSTE.find(x => x.v === $("#aj-tipo").value);
  const monto = parseFloat($("#aj-monto").value);
  if (!monto || monto <= 0) { alert("Ingresá un monto válido."); return; }
  const detalle = $("#aj-detalle").value.trim();
  state.ganAjustes.push({
    id: "aj"+Math.random().toString(36).slice(2,7),
    concepto: t.label + (detalle ? ` — ${detalle}` : ""),
    monto: Math.abs(monto),
    direccion: $("#aj-dir").value,
  });
  saveState();
  $("#ajuste-modal").classList.add("hidden");
  renderAnalisisFiscal();
}

function renderGanAjustes() {
  const host = $("#af-ajustes");
  if (!host) return;
  host.innerHTML = (state.ganAjustes || []).map(a => `
    <div class="af-ivarow af-ajuste">
      <span>${a.direccion==="resta"?"−":"+"} ${h(a.concepto)}</span>
      <b class="${a.direccion==="resta"?'in':'out'}">${a.direccion==="resta"?"−":"+"}${money(a.monto)}</b>
      <button class="af-aj-del" data-aj="${a.id}" title="Quitar">×</button>
    </div>`).join("");
  $$(".af-aj-del").forEach(b => b.onclick = () => {
    state.ganAjustes = state.ganAjustes.filter(a => a.id !== b.dataset.aj);
    saveState(); renderAnalisisFiscal();
  });
}
