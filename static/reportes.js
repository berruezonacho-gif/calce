// reportes.js — Exportación de reportes a Excel y PDF con estilo de marca.
// Colores: navy #0B1F3A (títulos/resultados), teal #2DD4BF (subsecciones),
// gris #F2F2F2 (subtotales). Formato moneda $#,##0.

const RPT_NAVY = "0B1F3A", RPT_TEAL = "2DD4BF", RPT_GREY = "F2F2F2";
const MONEY_FMT = '$#,##0;($#,##0);\\-';

function _emp() { return (typeof state !== "undefined" && state.empresa) ? state.empresa : { nombre: "Mi Empresa" }; }
function _hoyTxt() { return new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" }); }

// ── Encabezado reutilizable para PDF (logo + empresa + fecha) ────
function agregarEncabezadoPDF(doc, empresa) {
  empresa = empresa || _emp();
  let x = 40, y = 40, textX = 40;
  if (empresa.logo) {
    try {
      doc.addImage(empresa.logo, "PNG", 40, 28, 90, 36);
      textX = 145;
    } catch (e) { /* logo inválido, seguir sin él */ }
  }
  doc.setTextColor(11, 31, 58);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(empresa.nombre || "Mi Empresa", textX, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  let sub = [];
  if (empresa.cuit) sub.push("CUIT " + empresa.cuit);
  sub.push("Generado el " + _hoyTxt());
  doc.text(sub.join("  ·  "), textX, 60);
  doc.setDrawColor(45, 212, 191); doc.setLineWidth(1.5);
  doc.line(40, 70, 555, 70);
  return 88; // Y donde puede empezar el contenido
}

// ── Helpers Excel (SheetJS) ─────────────────────────────────────
function _wsFromAoa(aoa) { return XLSX.utils.aoa_to_sheet(aoa); }
function _styleRange(ws, from, to, style) {
  // SheetJS community no aplica estilos; se dejan los valores y fórmulas.
  // El formato visual se logra en el PDF; el Excel mantiene fórmulas vivas.
}
function _saveXlsx(wb, filename) { XLSX.writeFile(wb, filename); }

function _money(n) { return (typeof money === "function") ? money(n) : "$" + Math.round(n).toLocaleString("es-AR"); }
function _short(iso) { return (typeof fmtDateShort === "function" && iso) ? fmtDateShort(iso) : (iso || "—"); }

// ════════════════════════════════════════════════════════════════
// 1. FLUJO DE CAJA
// ════════════════════════════════════════════════════════════════
function _flujoDatos() {
  // Reusa la lógica de grilla: categorías por período. Simplificado a
  // ingresos/egresos por categoría en el rango activo (state.cf*).
  const from = state.cfFrom, to = state.cfTo;
  const cuentaFiltro = state.cfAccount || "";
  const ccy = state.cfCurrency || "ARS";
  // Movimientos del rango, moneda y cuenta
  const movs = (state.movements || []).filter(m => {
    if (!m.amount || !m.date) return false;
    if (m.date < from || m.date > to) return false;
    if (cuentaFiltro && m.account !== cuentaFiltro) return false;
    if (typeof movCurrency === "function" && movCurrency(m) !== ccy) return false;
    return true;
  });
  // Agrupar por categoría
  const ingresos = {}, egresos = {};
  movs.forEach(m => {
    const cat = (typeof movCategoria === "function" ? movCategoria(m) : null) || (m.amount > 0 ? "otros_ingresos" : "otros_egresos");
    const lbl = (typeof catLabel === "function" ? catLabel(cat) : cat);
    if (m.amount > 0) ingresos[lbl] = (ingresos[lbl]||0) + m.amount;
    else egresos[lbl] = (egresos[lbl]||0) + Math.abs(m.amount);
  });
  return { from, to, ccy, cuentaFiltro, ingresos, egresos };
}

function exportarFlujoExcel() {
  const d = _flujoDatos();
  const emp = _emp();
  const aoa = [
    [`${emp.nombre} — Flujo de Caja (resumen)`],
    [`Cuenta: ${d.cuentaFiltro ? accountName(d.cuentaFiltro) : "Todas (consolidado)"}  |  Moneda: ${d.ccy}  |  Periodo: ${_short(d.from)} a ${_short(d.to)}`],
    [],
    ["Categoria", "Monto"],
    ["INGRESOS"],
  ];
  let rIni = 6;
  const ingKeys = Object.keys(d.ingresos);
  ingKeys.forEach(k => aoa.push([k, d.ingresos[k]]));
  const ingFrom = rIni, ingTo = rIni + ingKeys.length - 1;
  aoa.push(["Subtotal Ingresos", ingKeys.length ? { f: `SUM(B${ingFrom}:B${ingTo})` } : 0]);
  aoa.push([]);
  aoa.push(["EGRESOS"]);
  const egrStart = aoa.length + 1;
  const egrKeys = Object.keys(d.egresos);
  egrKeys.forEach(k => aoa.push([k, d.egresos[k]]));
  const egrTo = egrStart + egrKeys.length - 1;
  aoa.push(["Subtotal Egresos", egrKeys.length ? { f: `SUM(B${egrStart}:B${egrTo})` } : 0]);
  const subIngRow = ingTo + 1, subEgrRow = aoa.length;
  aoa.push([]);
  aoa.push(["FLUJO NETO", { f: `B${subIngRow}-B${subEgrRow}` }]);

  const ws = _wsFromAoa(aoa);
  ws["!cols"] = [{ wch: 40 }, { wch: 16 }];
  // Formato moneda a la columna B
  for (let R = 4; R < aoa.length; R++) {
    const cell = ws["B" + (R + 1)];
    if (cell && typeof cell.v !== "undefined") cell.z = MONEY_FMT;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Flujo de Caja");
  _saveXlsx(wb, `Flujo_de_Caja_${_short(d.from)}_${_short(d.to)}.xlsx`.replace(/[\/\s]/g,"-"));
}

function exportarFlujoPDF() {
  const d = _flujoDatos();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Flujo de Caja (resumen)", 40, y); y += 16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Cuenta: ${d.cuentaFiltro?accountName(d.cuentaFiltro):"Todas (consolidado)"}  ·  Moneda: ${d.ccy}  ·  ${_short(d.from)} a ${_short(d.to)}`, 40, y); y += 10;

  const body = [];
  body.push([{ content: "INGRESOS", colSpan: 2, styles: { fillColor: [45,212,191], textColor: [11,31,58], fontStyle: "bold" } }]);
  let tIng = 0;
  Object.keys(d.ingresos).forEach(k => { body.push([k, _money(d.ingresos[k])]); tIng += d.ingresos[k]; });
  body.push([{ content: "Subtotal Ingresos", styles: { fillColor: [242,242,242], fontStyle: "bold" } }, { content: _money(tIng), styles: { fillColor: [242,242,242], fontStyle: "bold" } }]);
  body.push([{ content: "EGRESOS", colSpan: 2, styles: { fillColor: [45,212,191], textColor: [11,31,58], fontStyle: "bold" } }]);
  let tEgr = 0;
  Object.keys(d.egresos).forEach(k => { body.push([k, _money(d.egresos[k])]); tEgr += d.egresos[k]; });
  body.push([{ content: "Subtotal Egresos", styles: { fillColor: [242,242,242], fontStyle: "bold" } }, { content: _money(tEgr), styles: { fillColor: [242,242,242], fontStyle: "bold" } }]);
  body.push([{ content: "FLUJO NETO", styles: { fillColor: [11,31,58], textColor: [255,255,255], fontStyle: "bold" } }, { content: _money(tIng - tEgr), styles: { fillColor: [11,31,58], textColor: [255,255,255], fontStyle: "bold" } }]);

  doc.autoTable({
    startY: y + 6, head: [["Categoría", "Monto"]], body,
    theme: "grid", headStyles: { fillColor: [11,31,58], textColor: [255,255,255] },
    columnStyles: { 1: { halign: "right" } }, styles: { fontSize: 9 },
  });
  doc.save(`Flujo_de_Caja_${_short(d.from)}_${_short(d.to)}.pdf`.replace(/[\/\s]/g,"-"));
}

// ════════════════════════════════════════════════════════════════
// 2. RENDIMIENTO DEL EXCEDENTE
// ════════════════════════════════════════════════════════════════
function exportarRendimientoExcel(detalle, label, to) {
  const emp = _emp();
  const aoa = [
    [`${emp.nombre} — Rendimiento del Excedente Invertido`],
    ["Moneda: ARS"],
    [],
    ["Fecha del reporte", _hoyTxt()],
    [],
    ["Total generado por el excedente invertido en el periodo"],
    [""], // se completa con fórmula al final
    [],
    ["Tipo", "Instrumento", "Monto colocado", "TNA / TIR", "Fecha colocacion", "Estado", "Rendimiento devengado"],
  ];
  const rIni = 10;
  detalle.forEach(x => aoa.push([
    (typeof tipoInvLabel === "function" ? tipoInvLabel(x.inv.tipo) : x.inv.tipo),
    x.inv.label || "", x.inv.monto, (x.inv.rendimiento||0)/100,
    x.inv.fechaColocacion || "", x.inv.estado || "", x.rend,
  ]));
  const rFin = rIni + detalle.length - 1;
  aoa.push(["Total", "", "", "", "", "", detalle.length ? { f: `SUM(G${rIni}:G${rFin})` } : 0]);
  const totalRow = aoa.length;
  aoa[6] = [{ f: `G${totalRow}` }]; // KPI = total
  aoa.push([]);
  aoa.push(["Rendimiento devengado = Monto x Tasa x Dias/365 (interes simple, sin descontar comisiones/impuestos)."]);
  aoa.push(["Este es dinero que, sin colocarlo, habria quedado parado en la cuenta sin generar nada."]);

  const ws = _wsFromAoa(aoa);
  ws["!cols"] = [{wch:18},{wch:26},{wch:16},{wch:10},{wch:16},{wch:12},{wch:20}];
  // formato moneda col C y G
  for (let R = rIni; R <= totalRow; R++) {
    ["C","G"].forEach(col => { const c = ws[col+R]; if (c) c.z = MONEY_FMT; });
    const d = ws["D"+R]; if (d) d.z = "0.0%";
  }
  const kpi = ws["A7"]; if (kpi) kpi.z = MONEY_FMT;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rendimiento Excedente");
  _saveXlsx(wb, `Rendimiento_Excedente_${(label||"").replace(/\s+/g,"_")}.xlsx`);
}

function exportarRendimientoPDF(detalle, label, to) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Rendimiento del Excedente Invertido", 40, y); y += 16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Periodo: ${label}  ·  Moneda: ARS`, 40, y); y += 14;

  const total = detalle.reduce((s,x)=>s+x.rend,0);
  // KPI destacado
  doc.setFillColor(11,31,58); doc.rect(40, y, 515, 52, "F");
  doc.setTextColor(255,255,255); doc.setFontSize(8);
  doc.text("TOTAL GENERADO POR EL EXCEDENTE INVERTIDO", 54, y+18);
  doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.setTextColor(74,222,128);
  doc.text(_money(total), 54, y+42);
  y += 68;

  const body = detalle.map(x => [
    (typeof tipoInvLabel==="function"?tipoInvLabel(x.inv.tipo):x.inv.tipo),
    x.inv.label||"", _money(x.inv.monto),
    x.inv.rendimiento?x.inv.rendimiento+"%":"—",
    _short(x.inv.fechaColocacion), x.inv.estado||"", _money(x.rend),
  ]);
  body.push([{content:"TOTAL",colSpan:6,styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(total),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}}]);
  doc.autoTable({
    startY: y, head: [["Tipo","Instrumento","Monto","TNA","Colocación","Estado","Rendimiento"]],
    body, theme:"grid", headStyles:{fillColor:[11,31,58],textColor:[255,255,255]},
    columnStyles:{2:{halign:"right"},6:{halign:"right"}}, styles:{fontSize:8},
  });
  let fy = doc.lastAutoTable.finalY + 16;
  doc.setFontSize(8); doc.setTextColor(90,90,90);
  doc.text("Rendimiento devengado = Monto x Tasa x Dias/365 (interés simple, sin comisiones/impuestos).", 40, fy);
  doc.setTextColor(46,125,50); doc.setFont("helvetica","bold");
  doc.text("Este es dinero que, sin colocarlo, habría quedado parado en la cuenta sin generar nada.", 40, fy+14);
  doc.save(`Rendimiento_Excedente_${(label||"").replace(/\s+/g,"_")}.pdf`);
}

// ════════════════════════════════════════════════════════════════
// 3. ESTADO DE RESULTADOS
// ════════════════════════════════════════════════════════════════
function exportarEstadoResultadosXlsx(acum, label) {
  const emp = _emp();
  const grupos = { ingresos: [], costos: [], gastos: [], impuestos: [], financieros: [] };
  Object.values(acum).forEach(r => { if (grupos[r.grupo]) grupos[r.grupo].push(r); });
  const aoa = [
    [`${emp.nombre} — Estado de Resultados (por devengado)`],
    [`Periodo: ${label}  |  Criterio: devengado (fecha de emision)`],
    [], ["Categoria", "Monto"],
  ];
  const push = (label, monto, style) => aoa.push([label, monto]);
  const seccion = (titulo, arr, signo=1) => {
    aoa.push([titulo]);
    let t = 0;
    arr.forEach(r => { const v = Math.abs(r.monto); aoa.push([r.rubro, v]); t += v; });
    return t;
  };
  const tIng = seccion("INGRESOS", grupos.ingresos);
  aoa.push(["Total INGRESOS", tIng]);
  const tCos = seccion("COSTOS (directos)", grupos.costos);
  if (grupos.costos.length) aoa.push(["Total Costos", tCos]);
  aoa.push(["RESULTADO BRUTO", tIng - tCos]);
  const tGas = seccion("GASTOS (administracion)", grupos.gastos);
  aoa.push(["Total Gastos", tGas]);
  aoa.push(["RESULTADO OPERATIVO", tIng - tCos - tGas]);
  const tImp = seccion("IMPUESTOS", grupos.impuestos);
  if (grupos.impuestos.length) aoa.push(["Total IMPUESTOS", tImp]);
  const tFin = seccion("FINANCIEROS", grupos.financieros);
  if (grupos.financieros.length) aoa.push(["Total FINANCIEROS", tFin]);
  aoa.push(["RESULTADO NETO", tIng - tCos - tGas - tImp - tFin]);
  aoa.push([]);
  aoa.push(["Devengado = se imputa a la fecha de emision del comprobante, no a la de cobro/pago."]);

  const ws = _wsFromAoa(aoa);
  ws["!cols"] = [{wch:40},{wch:16}];
  for (let R=4; R<aoa.length; R++){ const c=ws["B"+(R+1)]; if(c && typeof c.v!=="undefined") c.z=MONEY_FMT; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estado de Resultados");
  _saveXlsx(wb, `Estado_de_Resultados_${label.replace(/\s+/g,"_")}.xlsx`);
}

function exportarEstadoResultadosPdf(acum, label) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Estado de Resultados (por devengado)", 40, y); y+=16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Periodo: ${label}  ·  Criterio: devengado`, 40, y); y+=8;

  const grupos = { ingresos:[], costos:[], gastos:[], impuestos:[], financieros:[] };
  Object.values(acum).forEach(r => { if (grupos[r.grupo]) grupos[r.grupo].push(r); });
  const body = [];
  const sub = (txt) => body.push([{content:txt,colSpan:2,styles:{fillColor:[45,212,191],textColor:[11,31,58],fontStyle:"bold"}}]);
  const tot = (txt,v) => body.push([{content:txt,styles:{fillColor:[242,242,242],fontStyle:"bold"}},{content:_money(v),styles:{fillColor:[242,242,242],fontStyle:"bold"}}]);
  const res = (txt,v) => body.push([{content:txt,styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(v),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}}]);
  let tIng=0,tCos=0,tGas=0,tImp=0,tFin=0;
  sub("INGRESOS"); grupos.ingresos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tIng+=v;}); tot("Total INGRESOS",tIng);
  if(grupos.costos.length){sub("COSTOS (directos)");grupos.costos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tCos+=v;});tot("Total Costos",tCos);}
  res("RESULTADO BRUTO", tIng-tCos);
  sub("GASTOS (administración)"); grupos.gastos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tGas+=v;}); tot("Total Gastos",tGas);
  res("RESULTADO OPERATIVO", tIng-tCos-tGas);
  if(grupos.impuestos.length){sub("IMPUESTOS");grupos.impuestos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tImp+=v;});tot("Total IMPUESTOS",tImp);}
  if(grupos.financieros.length){sub("FINANCIEROS");grupos.financieros.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tFin+=v;});tot("Total FINANCIEROS",tFin);}
  res("RESULTADO NETO", tIng-tCos-tGas-tImp-tFin);
  doc.autoTable({ startY:y+6, head:[["Categoría","Monto"]], body, theme:"grid",
    headStyles:{fillColor:[11,31,58],textColor:[255,255,255]}, columnStyles:{1:{halign:"right"}}, styles:{fontSize:9} });
  let fy = doc.lastAutoTable.finalY + 14;
  doc.setFontSize(8); doc.setTextColor(90,90,90);
  doc.text("Devengado = se imputa a la fecha de emisión del comprobante, no a la de cobro/pago (a diferencia del Flujo de Caja).", 40, fy);
  doc.save(`Estado_de_Resultados_${label.replace(/\s+/g,"_")}.pdf`);
}

// ════════════════════════════════════════════════════════════════
// 4. SUMAS Y SALDOS
// ════════════════════════════════════════════════════════════════
function exportarSumasSaldosXlsx(cuentas, label) {
  const emp = _emp();
  const aoa = [
    [`${emp.nombre} — Sumas y Saldos (vista de gestion)`],
    [`Periodo: ${label}`],
    [], ["Fecha de corte", _hoyTxt()], [],
    ["Cuenta", "Debe", "Haber"],
  ];
  const rIni = 7;
  cuentas.forEach(c => aoa.push([c.nombre, c.debe || "", c.haber || ""]));
  const rFin = rIni + cuentas.length - 1;
  aoa.push(["TOTAL", { f: `SUM(B${rIni}:B${rFin})` }, { f: `SUM(C${rIni}:C${rFin})` }]);
  const totalRow = aoa.length;
  aoa.push(["Diferencia (Debe - Haber)", { f: `B${totalRow}-C${totalRow}` }, ""]);
  aoa.push([]);
  aoa.push(["ADVERTENCIA: el Debe y el Haber NO cierran en cero porque no se registra una cuenta de Patrimonio/Capital inicial. Es una vista de gestion, no un balance contable legal."]);

  const ws = _wsFromAoa(aoa);
  ws["!cols"] = [{wch:48},{wch:16},{wch:16}];
  for (let R=6; R<=totalRow; R++){ ["B","C"].forEach(col=>{const c=ws[col+R]; if(c) c.z=MONEY_FMT;}); }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sumas y Saldos");
  _saveXlsx(wb, `Sumas_y_Saldos_${label.replace(/\s+/g,"_")}.xlsx`);
}

function exportarSumasSaldosPdf(cuentas, label) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Sumas y Saldos (vista de gestión)", 40, y); y+=16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Periodo: ${label}  ·  Corte: ${_hoyTxt()}`, 40, y); y+=8;

  const body = cuentas.map(c => [c.nombre, c.debe?_money(c.debe):"—", c.haber?_money(c.haber):"—"]);
  const totD = cuentas.reduce((s,c)=>s+(c.debe||0),0), totH = cuentas.reduce((s,c)=>s+(c.haber||0),0);
  body.push([{content:"TOTAL",styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(totD),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(totH),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}}]);
  body.push([{content:"Diferencia (Debe − Haber)",styles:{fontStyle:"bold"}},{content:_money(totD-totH),styles:{fontStyle:"bold"}},""]);
  doc.autoTable({ startY:y+6, head:[["Cuenta","Debe","Haber"]], body, theme:"grid",
    headStyles:{fillColor:[11,31,58],textColor:[255,255,255]}, columnStyles:{1:{halign:"right"},2:{halign:"right"}}, styles:{fontSize:9} });
  let fy = doc.lastAutoTable.finalY + 16;
  doc.setFillColor(251,237,237); doc.rect(40, fy, 515, 40, "F");
  doc.setTextColor(178,58,58); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
  doc.text("ADVERTENCIA: el Debe y el Haber no cierran en cero porque no se registra una cuenta de", 50, fy+16);
  doc.text("Patrimonio/Capital inicial. Es una vista de gestión, no un balance contable legal.", 50, fy+29);
  doc.save(`Sumas_y_Saldos_${label.replace(/\s+/g,"_")}.pdf`);
}

// ════════════════════════════════════════════════════════════════
// 5. REPORTE FISCAL-FINANCIERO (multi-hoja, estilo Copilot)
// ════════════════════════════════════════════════════════════════
// Consolida ventas, compras, IVA, retenciones y caja en un Excel de
// varias hojas: Dashboard, Indicadores mensuales, Posición IVA,
// Recomendaciones, Metodología. Datos de state (comprobantes/retenciones).

function _mesDe(iso) { return iso ? iso.slice(0,7) : ""; }

function exportarReporteFiscalExcel() {
  const emp = _emp();
  const comps = state.comprobantes || [];
  const rets = state.retenciones || [];
  const ventas = comps.filter(c => c.tipo === "cobrar");
  const compras = comps.filter(c => c.tipo === "pagar");

  // ── Indicadores mensuales ──
  const meses = {};
  const bucket = (m) => (meses[m] = meses[m] || { ventasNeto:0, facturacion:0, ivaDebito:0, comprasBase:0, comprasTotal:0, ivaCredito:0 });
  ventas.forEach(c => { const m=_mesDe(c.emision); if(!m)return; const b=bucket(m); b.ventasNeto+=(c.neto||0); b.facturacion+=(c.monto||0); b.ivaDebito+=(c.iva||0); });
  compras.forEach(c => { const m=_mesDe(c.emision); if(!m)return; const b=bucket(m); b.comprasBase+=(c.neto||0); b.comprasTotal+=(c.monto||0); b.ivaCredito+=(c.iva||0); });
  const mesesOrd = Object.keys(meses).sort();

  // ── Totales / último mes ──
  const ultMes = mesesOrd[mesesOrd.length-1];
  const u = ultMes ? meses[ultMes] : { ventasNeto:0,facturacion:0,ivaDebito:0,ivaCredito:0 };
  // Retenciones/percepciones de IVA DEL MISMO MES (no de todo el historial)
  const retIVA = rets.filter(r => (r.impuesto||"").toUpperCase().includes("IVA") && _mesDe(r.fecha) === ultMes).reduce((s,r)=>s+(r.importe||0),0);
  const ivaPreliminar = u.ivaDebito - u.ivaCredito - retIVA;
  const totalVentasNeto = ventas.reduce((s,c)=>s+(c.neto||0),0);
  const totalComprasBase = compras.reduce((s,c)=>s+(c.neto||0),0);
  const resultadoDoc = totalVentasNeto - totalComprasBase;

  const wb = XLSX.utils.book_new();

  // Hoja Dashboard
  const dash = [
    [`${emp.nombre} — REPORTE FISCAL Y FINANCIERO`],
    [`Generado el ${_hoyTxt()}  ·  CUIT ${emp.cuit||"—"}`],
    [],
    ["Ventas netas (últ. mes)", u.ventasNeto],
    ["Facturación (últ. mes)", u.facturacion],
    ["IVA débito (últ. mes)", u.ivaDebito],
    ["IVA crédito (últ. mes)", u.ivaCredito],
    ["Retenciones/percepciones IVA", retIVA],
    ["IVA preliminar", ivaPreliminar],
    [],
    ["Resultado documental (total)", resultadoDoc],
    ["Comprobantes emitidos", ventas.length],
    ["Comprobantes recibidos", compras.length],
    [],
    ["Lectura ejecutiva"],
    [ivaPreliminar > 0 ? "• IVA preliminar a pagar en el período (validar créditos con el contador)." : "• Saldo de IVA a favor en el período."],
    ["• Las ventas netas documentadas surgen del Libro IVA."],
    ["• El resultado documental NO es la base imponible de Ganancias."],
    ["• La caja se muestra según lo cargado; requiere conciliación bancaria."],
  ];
  const wsDash = XLSX.utils.aoa_to_sheet(dash);
  wsDash["!cols"] = [{wch:32},{wch:18}];
  for (let R=4;R<=13;R++){ const c=wsDash["B"+R]; if(c&&typeof c.v==="number") c.z=MONEY_FMT; }
  XLSX.utils.book_append_sheet(wb, wsDash, "Dashboard");

  // Hoja Indicadores mensuales
  const ind = [["INDICADORES MENSUALES"],["Cálculos normalizados por período"],[],
    ["Período","Ventas netas","Facturación","IVA débito","Compras base","Compras total","IVA crédito","IVA preliminar"]];
  mesesOrd.forEach(m => { const b=meses[m]; ind.push([m, b.ventasNeto, b.facturacion, b.ivaDebito, b.comprasBase, b.comprasTotal, b.ivaCredito, b.ivaDebito-b.ivaCredito]); });
  const wsInd = XLSX.utils.aoa_to_sheet(ind);
  wsInd["!cols"] = [{wch:10},{wch:14},{wch:14},{wch:13},{wch:13},{wch:14},{wch:12},{wch:13}];
  for (let R=5;R<ind.length+1;R++){ ["B","C","D","E","F","G","H"].forEach(col=>{const c=wsInd[col+R]; if(c) c.z=MONEY_FMT;}); }
  XLSX.utils.book_append_sheet(wb, wsInd, "Indicadores_Mensuales");

  // Hoja Posición IVA (detalle del último mes)
  const posiva = [["POSICIÓN DE IVA — "+(ultMes||"")],[],
    ["Concepto","Monto"],
    ["IVA débito (ventas)", u.ivaDebito],
    ["IVA crédito (compras)", u.ivaCredito],
    ["Retenciones/percepciones IVA", retIVA],
    ["POSICIÓN (débito − crédito − ret.)", ivaPreliminar],
  ];
  const wsPos = XLSX.utils.aoa_to_sheet(posiva);
  wsPos["!cols"] = [{wch:36},{wch:16}];
  for (let R=4;R<=7;R++){ const c=wsPos["B"+R]; if(c) c.z=MONEY_FMT; }
  XLSX.utils.book_append_sheet(wb, wsPos, "Posicion_IVA");

  // Hoja Recomendaciones (reusa el motor de análisis si existe)
  const recRows = [["RECOMENDACIONES DEL MODELO"],["Requieren aprobación profesional"],[],
    ["Variable","Condición","Diagnóstico","Recomendación","Prioridad","Evidencia"]];
  if (typeof calcularFiscal === "function" && typeof recomendacionesFiscales === "function" && typeof estimarGanancias === "function") {
    const f = calcularFiscal("1900-01-01","2100-12-31");
    const recs = recomendacionesFiscales(f, estimarGanancias(f));
    recs.forEach(r => recRows.push([r.variable, r.condicion, r.diagnostico, r.accion, r.prioridad, (r.evidencia||[]).join(", ")]));
  }
  const wsRec = XLSX.utils.aoa_to_sheet(recRows);
  wsRec["!cols"] = [{wch:12},{wch:22},{wch:38},{wch:40},{wch:12},{wch:30}];
  XLSX.utils.book_append_sheet(wb, wsRec, "Recomendaciones");

  // Hoja Metodología
  const met = [["METODOLOGÍA Y LIMITACIONES"],[],["Concepto","Definición"],
    ["Ventas netas","Neto gravado + no gravado + exento de comprobantes emitidos."],
    ["Compras base","Neto gravado + no gravado + exento de comprobantes recibidos."],
    ["IVA débito","IVA de comprobantes de venta."],
    ["IVA crédito","IVA de comprobantes de compra (potencial hasta validación profesional)."],
    ["IVA preliminar","IVA débito − IVA crédito − retenciones/percepciones IVA."],
    ["Resultado documental","Ventas netas − compras base. NO es la base imponible de Ganancias."],
    ["Ganancias","Requiere puente contable-fiscal (balance, ajustes, amortizaciones, quebrantos)."],
  ];
  const wsMet = XLSX.utils.aoa_to_sheet(met);
  wsMet["!cols"] = [{wch:22},{wch:70}];
  XLSX.utils.book_append_sheet(wb, wsMet, "Metodologia");

  XLSX.writeFile(wb, `Reporte_Fiscal_Financiero_${_hoyTxt().replace(/\//g,"-")}.xlsx`);
}
