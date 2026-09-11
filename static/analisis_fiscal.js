// analisis_fiscal.js — Análisis fiscal: posición de IVA, estimación de
// Ganancias con ajustes cargables, y recomendaciones explicables.
// Adaptado del prototipo backend (calculations.py + rules.py) al frontend
// de Calce, reusando state.comprobantes / state.retenciones.
// Criterio prudente heredado del backend: el resultado documental NO es la
// base de Ganancias; toda recomendación requiere aprobación profesional.

let anPeriodo = "mes"; // mes | anio | todo

function anRango() {
  const hoy = new Date();
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
  const ventasNeto = ventas.reduce((s,c) => s + (c.neto || c.monto || 0), 0);
  const comprasNeto = compras.reduce((s,c) => s + (c.neto || c.monto || 0), 0);
  const resultadoDocumental = ventasNeto - comprasNeto;

  return {
    from, to, ventasNeto, comprasNeto, resultadoDocumental,
    ivaDebito, ivaCreditoPotencial, ivaCreditoValidado, ivaRetPerc, posicionIVA,
    nVentas: ventas.length, nCompras: compras.length,
    retGanancias: rets.filter(r => (r.impuesto||"").toUpperCase().includes("GANANCIA")).reduce((s,r)=>s+(r.importe||0),0),
  };
}

// Estimación de Ganancias con ajustes cargables (orientativa)
function estimarGanancias(fiscal) {
  const alicuota = 0.35; // alícuota de referencia (sociedades/tramos altos)
  let baseAjustada = fiscal.resultadoDocumental;
  (state.ganAjustes || []).forEach(a => {
    const monto = parseFloat(a.monto) || 0;
    baseAjustada += (a.direccion === "resta") ? -monto : monto;
  });
  const impuestoEstimado = Math.max(0, baseAjustada * alicuota);
  const aPagar = Math.max(0, impuestoEstimado - fiscal.retGanancias);
  return { alicuota, baseAjustada, impuestoEstimado, aPagar, retGanancias: fiscal.retGanancias };
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
        <button class="cper ${anPeriodo==="anio"?"active":""}" data-anper="anio">Este año</button>
        <button class="cper ${anPeriodo==="todo"?"active":""}" data-anper="todo">Todo</button>
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
      <div class="af-ganlist">
        <div class="af-ivarow"><span>Resultado documental (ventas − compras, netos)</span><b>${money(fiscal.resultadoDocumental)}</b></div>
        <div id="af-ajustes"></div>
        <div class="af-ivarow"><span>= Base ajustada</span><b>${money(gan.baseAjustada)}</b></div>
        <div class="af-ivarow"><span>Impuesto estimado (${(gan.alicuota*100).toFixed(0)}%)</span><b>${money(gan.impuestoEstimado)}</b></div>
        <div class="af-ivarow"><span>− Retenciones de Ganancias sufridas</span><b class="in">−${money(gan.retGanancias)}</b></div>
        <div class="af-ivarow total ${gan.aPagar>0?'pos':'neg'}"><span>${gan.aPagar>0?'Estimado a pagar':'Sin saldo a pagar'}</span><b>${money(gan.aPagar)}</b></div>
      </div>
      <button class="btn-ghost sm" id="af-add-ajuste">+ Agregar ajuste (amortización, quebranto…)</button>
      <p class="af-nota">El resultado documental no es la base fiscal de Ganancias. Los ajustes acercan la estimación a la realidad, pero la declaración final la determina tu contador con el balance.</p>
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
  const repBtn = $("#af-report");
  if (repBtn) repBtn.onclick = () => { if (typeof exportarReporteFiscalExcel === "function") exportarReporteFiscalExcel(); else alert("Reporte no disponible."); };
  renderGanAjustes();
  const addBtn = $("#af-add-ajuste");
  if (addBtn) addBtn.onclick = () => {
    const concepto = prompt("Concepto del ajuste (ej: Amortización de equipos, Quebranto anterior):");
    if (!concepto) return;
    const montoTxt = prompt("Monto del ajuste:");
    const monto = parseFloat(montoTxt); if (!monto) return;
    const dir = confirm("¿Este ajuste RESTA de la base? (Aceptar = resta, Cancelar = suma)") ? "resta" : "suma";
    state.ganAjustes.push({ id: "aj"+Math.random().toString(36).slice(2,7), concepto, monto: Math.abs(monto), direccion: dir });
    saveState(); renderAnalisisFiscal();
  };
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
