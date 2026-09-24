// evolucion.js — Reportería de evolución en términos REALES (ajustada por
// inflación), no solo nominales. Responde: "¿facturé más o solo más pesos?".
// Métricas: Facturación, Ganancia, Gastos, IVA. Comparación: año vs año o
// mes vs mismo mes del año anterior.

let evolMetrica = "facturacion"; // facturacion | ganancia | gastos | iva
let evolModo = "anio";           // anio (año vs año) | mes (mensual)
let _serieInflacion = null;      // cache de la serie IPC

const EVOL_METRICAS = {
  facturacion: { label: "Facturación", desc: "Ventas netas emitidas" },
  ganancia:    { label: "Ganancia (resultado)", desc: "Ventas − compras (neto)" },
  gastos:      { label: "Gastos / compras", desc: "Compras y gastos netos" },
  iva:         { label: "IVA débito", desc: "IVA de las ventas" },
};

// Valor de una métrica para un comprobante
function _valorMetrica(comp, metrica) {
  const tiene = (comp.neto != null) || (comp.noGravado != null) || (comp.exento != null);
  const base = tiene ? ((comp.neto||0)+(comp.noGravado||0)+(comp.exento||0)) : (comp.monto||0);
  if (metrica === "facturacion") return comp.tipo === "cobrar" ? base : 0;
  if (metrica === "gastos")      return comp.tipo === "pagar" ? base : 0;
  if (metrica === "iva")         return comp.tipo === "cobrar" ? (comp.iva||0) : 0;
  if (metrica === "ganancia")    return comp.tipo === "cobrar" ? base : -base;
  return 0;
}

// Agrega la métrica por mes (YYYY-MM). Devuelve {mes: total}.
function _agregarPorMes(metrica) {
  const meses = {};
  (state.comprobantes || []).forEach(c => {
    if (!c.emision) return;
    const m = c.emision.slice(0,7);
    meses[m] = (meses[m] || 0) + _valorMetrica(c, metrica);
  });
  return meses;
}

// Trae la serie de inflación (una vez) y calcula el factor de un mes a hoy.
async function _cargarInflacion() {
  if (_serieInflacion) return _serieInflacion;
  try {
    const res = await fetch("/api/inflacion/serie");
    const data = await res.json();
    if (data.ok && data.serie && data.serie.length) { _serieInflacion = data.serie; return _serieInflacion; }
  } catch (e) {}
  return null;
}
function _factorAHoy(mes, hastaMes) {
  if (!_serieInflacion) return 1;
  let f = 1;
  _serieInflacion.forEach(it => { if (it.fecha > mes && it.fecha <= hastaMes) f *= (1 + it.valor/100); });
  return f;
}

async function renderEvolucion() {
  const wrap = $("#evol-wrap");
  const met = EVOL_METRICAS[evolMetrica];
  const porMes = _agregarPorMes(evolMetrica);
  const hoyMes = new Date().toISOString().slice(0,10).slice(0,7);

  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Reportería</div>
      <h2 class="inv-title">Evolución real vs nominal</h2>
      <p class="inv-sub">Compará tu ${met.label.toLowerCase()} contra la inflación: si creciste en pesos pero perdiste poder adquisitivo, acá se ve.</p></div>

    <div class="conta-bar" style="flex-wrap:wrap;gap:12px">
      <div class="conta-periodo">
        <button class="cper ${evolModo==="anio"?"active":""}" data-emodo="anio">Año vs año</button>
        <button class="cper ${evolModo==="mes"?"active":""}" data-emodo="mes">Mensual</button>
      </div>
    </div>

    <div id="evol-content"><div class="inv-placeholder">Ajustando por inflación…</div></div>`;

  $$("[data-emodo]").forEach(b => b.onclick = () => { evolModo = b.dataset.emodo; renderEvolucion(); });

  await _cargarInflacion();
  const host = $("#evol-content");
  if (!host) return;

  if (evolModo === "anio") renderEvolAnio(host, porMes, hoyMes);
  else renderEvolMensual(host, porMes, hoyMes);
}

// ── Año vs año ────────────────────────────────────────────
function renderEvolAnio(host, porMes, hoyMes) {
  // Agrupar por año, nominal y real (cada mes ajustado a hoy)
  const anios = {};
  Object.entries(porMes).forEach(([mes, val]) => {
    const y = mes.slice(0,4);
    if (!anios[y]) anios[y] = { nominal: 0, real: 0 };
    anios[y].nominal += val;
    anios[y].real += val * _factorAHoy(mes, hoyMes);
  });
  const aniosOrd = Object.keys(anios).sort();
  if (aniosOrd.length === 0) { host.innerHTML = `<p class="cf-empty">No hay datos cargados para comparar.</p>`; return; }

  const hayInflacion = _serieInflacion != null;
  // Variaciones interanuales
  const filas = aniosOrd.map((y, i) => {
    const a = anios[y];
    const prev = i > 0 ? anios[aniosOrd[i-1]] : null;
    const varNom = prev ? (a.nominal - prev.nominal) / prev.nominal * 100 : null;
    const varReal = prev ? (a.real - prev.real) / prev.real * 100 : null;
    return { y, ...a, varNom, varReal };
  });

  // KPI destacado: última variación
  const ult = filas[filas.length - 1];
  const kpiHtml = (ult.varReal != null) ? `
    <div class="evol-hero">
      <div class="evol-hero-item">
        <small>Crecimiento nominal (${aniosOrd[aniosOrd.length-2]}→${ult.y})</small>
        <b class="${ult.varNom>=0?'in':'out'}">${ult.varNom>=0?'+':''}${ult.varNom.toFixed(1)}%</b>
      </div>
      <div class="evol-hero-item evol-hero-real">
        <small>Crecimiento REAL (ajustado por inflación)</small>
        <b class="${ult.varReal>=0?'in':'out'}">${ult.varReal>=0?'+':''}${ult.varReal.toFixed(1)}%</b>
        <span>${ult.varReal>=0 ? "Creciste por encima de la inflación 👍" : "En pesos creciste, pero perdiste poder adquisitivo"}</span>
      </div>
    </div>` : "";

  host.innerHTML = `
    ${kpiHtml}
    ${!hayInflacion ? `<div class="evol-warn">⚠ No se pudo traer el IPC (sin conexión). Se muestran solo valores nominales.</div>` : ""}
    <div class="table-card" style="margin-top:16px">
      <div class="chart-head"><h2>${EVOL_METRICAS[evolMetrica].label} por año</h2></div>
      <div id="evol-chart"></div>
      <div class="cf-table-scroll" style="margin-top:12px"><table class="cf-table">
        <thead><tr><th>Año</th><th>Nominal</th>${hayInflacion?"<th>Real (pesos de hoy)</th><th>Var. nominal</th><th>Var. real</th>":""}</tr></thead>
        <tbody>${filas.map(f=>`<tr>
          <td><b>${f.y}</b></td>
          <td class="mono">${money(f.nominal)}</td>
          ${hayInflacion?`<td class="mono">${money(f.real)}</td>
          <td class="mono ${f.varNom==null?'':f.varNom>=0?'in':'out'}">${f.varNom==null?'—':(f.varNom>=0?'+':'')+f.varNom.toFixed(1)+'%'}</td>
          <td class="mono ${f.varReal==null?'':f.varReal>=0?'in':'out'}">${f.varReal==null?'—':(f.varReal>=0?'+':'')+f.varReal.toFixed(1)+'%'}</td>`:""}
        </tr>`).join("")}</tbody>
      </table></div>
    </div>
    <p class="conta-note">El valor real ajusta cada mes a pesos de hoy con el IPC (INDEC vía ArgentinaDatos). Un crecimiento nominal alto con crecimiento real negativo significa que facturaste más pesos pero de menor poder adquisitivo.</p>`;

  // Gráfico de barras nominal vs real por año
  dibujarEvolChart(filas, hayInflacion);
}

// ── Mensual (mes vs mismo mes del año anterior) ───────────
function renderEvolMensual(host, porMes, hoyMes) {
  const mesesOrd = Object.keys(porMes).sort();
  if (mesesOrd.length === 0) { host.innerHTML = `<p class="cf-empty">No hay datos cargados.</p>`; return; }
  const hayInflacion = _serieInflacion != null;
  const nombreMes = (m) => { const [y,mm]=m.split("-"); return ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][parseInt(mm)]+" "+y; };

  const filas = mesesOrd.map(m => {
    const nominal = porMes[m];
    const real = nominal * _factorAHoy(m, hoyMes);
    // mismo mes año anterior
    const [y,mm] = m.split("-");
    const prevKey = `${parseInt(y)-1}-${mm}`;
    const prevNom = porMes[prevKey];
    const varInter = (prevNom != null && prevNom !== 0) ? (nominal - prevNom)/prevNom*100 : null;
    const prevReal = prevNom != null ? prevNom * _factorAHoy(prevKey, hoyMes) : null;
    const varRealInter = (prevReal != null && prevReal !== 0) ? (real - prevReal)/prevReal*100 : null;
    return { m, nominal, real, varInter, varRealInter };
  });

  host.innerHTML = `
    ${!hayInflacion ? `<div class="evol-warn">⚠ No se pudo traer el IPC (sin conexión). Se muestran solo valores nominales.</div>` : ""}
    <div class="table-card">
      <div class="chart-head"><h2>${EVOL_METRICAS[evolMetrica].label} mensual</h2></div>
      <div class="cf-table-scroll"><table class="cf-table">
        <thead><tr><th>Mes</th><th>Nominal</th>${hayInflacion?"<th>Real (pesos hoy)</th>":""}<th>Var. interanual nom.</th>${hayInflacion?"<th>Var. interanual real</th>":""}</tr></thead>
        <tbody>${filas.slice().reverse().map(f=>`<tr>
          <td>${nombreMes(f.m)}</td>
          <td class="mono">${money(f.nominal)}</td>
          ${hayInflacion?`<td class="mono">${money(f.real)}</td>`:""}
          <td class="mono ${f.varInter==null?'':f.varInter>=0?'in':'out'}">${f.varInter==null?'—':(f.varInter>=0?'+':'')+f.varInter.toFixed(1)+'%'}</td>
          ${hayInflacion?`<td class="mono ${f.varRealInter==null?'':f.varRealInter>=0?'in':'out'}">${f.varRealInter==null?'—':(f.varRealInter>=0?'+':'')+f.varRealInter.toFixed(1)+'%'}</td>`:""}
        </tr>`).join("")}</tbody>
      </table></div>
    </div>
    <p class="conta-note">La variación interanual compara cada mes con el mismo mes del año anterior. La real ajusta ambos a pesos de hoy: es la que muestra si el negocio creció de verdad.</p>`;
}

// Gráfico de barras: nominal vs real por año
function dibujarEvolChart(filas, hayInflacion) {
  const host = $("#evol-chart");
  if (!host || !filas.length) return;
  const W=760, H=220, P={t:16,r:16,b:34,l:70};
  const iw=W-P.l-P.r, ih=H-P.t-P.b;
  const maxVal = Math.max(...filas.map(f=>Math.max(f.nominal, hayInflacion?f.real:0)), 1);
  const n = filas.length;
  const groupW = iw / n;
  const barW = hayInflacion ? groupW*0.28 : groupW*0.4;
  const Y = (v) => P.t + ih - (v/maxVal)*ih;

  let bars = "";
  filas.forEach((f, i) => {
    const cx = P.l + groupW*i + groupW/2;
    // Nominal
    const xN = hayInflacion ? cx - barW - 3 : cx - barW/2;
    bars += `<rect x="${xN}" y="${Y(f.nominal).toFixed(1)}" width="${barW}" height="${(P.t+ih-Y(f.nominal)).toFixed(1)}" fill="#4C8DFF" rx="2"/>`;
    if (hayInflacion) {
      const xR = cx + 3;
      bars += `<rect x="${xR}" y="${Y(f.real).toFixed(1)}" width="${barW}" height="${(P.t+ih-Y(f.real)).toFixed(1)}" fill="#2DD4BF" rx="2"/>`;
    }
    bars += `<text x="${cx}" y="${H-14}" fill="#64748B" font-size="11" text-anchor="middle">${f.y}</text>`;
  });
  const leyenda = hayInflacion
    ? `<g><rect x="${P.l}" y="2" width="10" height="10" fill="#4C8DFF" rx="2"/><text x="${P.l+14}" y="11" font-size="10" fill="#64748B">Nominal</text>
       <rect x="${P.l+70}" y="2" width="10" height="10" fill="#2DD4BF" rx="2"/><text x="${P.l+84}" y="11" font-size="10" fill="#64748B">Real (pesos hoy)</text></g>`
    : "";
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="dash-svg">
    <text x="6" y="${Y(maxVal)+4}" fill="#94A3B8" font-size="10">${money(maxVal)}</text>
    <text x="6" y="${P.t+ih}" fill="#94A3B8" font-size="10">$0</text>
    ${bars}${leyenda}
  </svg>`;
}
