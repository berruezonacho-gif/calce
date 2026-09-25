// demo_constructora.js — EJEMPLO FICTICIO (no es un cliente real).
// Constructora con: inversiones (FCI, plazo fijo, caución, dólar, bono),
// y una serie mensual de facturación/compras 2025→hoy para el reporte de
// comparativa (Evolución real vs nominal) y la parte impositiva.
const DEMO_CONSTRUCTORA = (function () {
  const clientes = [
    { n: "Municipio de Pilar", c: "30-99887766-5" },
    { n: "Gobierno Provincia Bs As", c: "30-99001122-8" },
    { n: "Desarrollos del Norte S.A.", c: "30-71112223-4" },
  ];
  const provs = [
    { n: "Aceros del Sur S.A.", c: "30-65111222-3", cat: "Materiales" },
    { n: "Hormigones Pilar S.R.L.", c: "30-66222333-4", cat: "Materiales" },
    { n: "Alquiler de Grúas Norte", c: "30-67333444-5", cat: "Maquinaria" },
  ];

  const hoy = new Date();
  const comprobantes = [];

  // Serie mensual: enero 2025 hasta el mes actual.
  let y = 2025, m = 1, i = 0;
  const endY = hoy.getFullYear(), endM = hoy.getMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    const mm = String(m).padStart(2, "0");
    const emision = `${y}-${mm}-12`;
    const venc = `${y}-${mm}-27`;
    const factor = Math.pow(1.045, i);          // crecimiento nominal ~4,5%/mes
    const wave = 1 + 0.12 * Math.sin(i * 1.1);  // estacionalidad de obra
    const vencDate = new Date(venc + "T00:00:00");
    const saldada = (hoy - vencDate) > 12 * 86400000; // cobradas/pagadas si vencieron hace >12 días

    // Venta del mes (certificado de obra)
    const netoV = Math.round(12000000 * factor * wave / 10000) * 10000;
    const cli = clientes[i % clientes.length];
    comprobantes.push({
      tipo: "cobrar", contraparte: cli.n, cuit: cli.c, numero: `A 0003-${String(1000 + i).padStart(8, "0")}`,
      neto: netoV, iva: Math.round(netoV * 0.21), noGravado: 0, exento: 0, monto: netoV + Math.round(netoV * 0.21),
      account: "cc", emision, vencimiento: venc,
      estado: saldada ? "saldado" : "pendiente", fechaSaldado: saldada ? venc : null,
      categoria: "Certificado de obra", tipoComprobante: "Factura A",
    });

    // Compra del mes (materiales ~58% de la venta)
    const netoC = Math.round(netoV * 0.58 / 10000) * 10000;
    const prov = provs[i % provs.length];
    comprobantes.push({
      tipo: "pagar", contraparte: prov.n, cuit: prov.c, numero: `A 00${10 + (i % 9)}-${String(4000 + i).padStart(8, "0")}`,
      neto: netoC, iva: Math.round(netoC * 0.21), noGravado: 0, exento: 0, monto: netoC + Math.round(netoC * 0.21),
      account: "cc", emision, vencimiento: venc,
      estado: saldada ? "saldado" : "pendiente", fechaSaldado: saldada ? venc : null,
      categoria: prov.cat, tipoComprobante: "Factura A",
    });

    i++; m++; if (m > 12) { m = 1; y++; }
  }

  // Algunas facturas pendientes "de hoy" para Cobranzas y Pagos (fechas relativas).
  comprobantes.push(
    { tipo: "cobrar", contraparte: "Desarrollos del Norte S.A.", cuit: "30-71112223-4", numero: "A 0003-00009001",
      neto: 22000000, iva: 4620000, noGravado: 0, exento: 0, monto: 26620000, account: "cc",
      emision: "d-8", vencimiento: "d+12", estado: "pendiente", categoria: "Obra privada", tipoComprobante: "Factura A" },
    { tipo: "cobrar", contraparte: "Gobierno Provincia Bs As", cuit: "30-99001122-8", numero: "A 0003-00009002",
      neto: 18000000, iva: 3780000, noGravado: 0, exento: 0, monto: 21780000, account: "cc",
      emision: "d-3", vencimiento: "d+25", estado: "pendiente", categoria: "Certificado de obra", tipoComprobante: "Factura A" },
    { tipo: "pagar", contraparte: "Aceros del Sur S.A.", cuit: "30-65111222-3", numero: "A 0012-00009501",
      neto: 9500000, iva: 1995000, noGravado: 0, exento: 0, monto: 11495000, account: "cc",
      emision: "d-10", vencimiento: "d+5", estado: "pendiente", categoria: "Materiales", tipoComprobante: "Factura A" },
    { tipo: "pagar", contraparte: "YPF (combustible)", cuit: "30-54668997-9", numero: "A 0021-00009777",
      neto: 1500000, iva: 315000, noGravado: 0, exento: 0, monto: 1815000, account: "cc",
      emision: "d-6", vencimiento: "d-1", estado: "pendiente", categoria: "Combustible", tipoComprobante: "Factura A" }
  );

  return {
    empresa: { nombre: "Constructora Demo S.A.", cuit: "30-71234567-9", provincia: "CABA", modo: "completo" },

    accounts: [
      { id: "cc",   name: "Cuenta corriente",   banco: "Banco Galicia", tipo: "cc", moneda: "ARS", alias: "constructora.cc", opening: 78000000 },
      { id: "usd",  name: "Cuenta en dólares",  banco: "Banco Galicia", tipo: "cc", moneda: "USD", alias: "constructora.usd", opening: 40000 },
      { id: "comitente", name: "Cuenta comitente", banco: "Balanz", tipo: "comitente", moneda: "ARS", alias: "", opening: 15000000 },
      { id: "caja", name: "Efectivo",           banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 1200000 },
    ],

    movements: [
      { label: "Sueldos y cargas sociales", amount: -22000000, date: "d+5", recurrence: "monthly", medio: "transferencia", account: "cc" },
      { label: "Subcontratistas (mano de obra)", amount: -16500000, date: "d+15", recurrence: "monthly", medio: "transferencia", account: "cc" },
      { label: "Alquiler de maquinaria", amount: -3400000, date: "d+10", recurrence: "monthly", medio: "transferencia", account: "cc" },
      { label: "Combustible y logística", amount: -1900000, date: "d+18", recurrence: "monthly", medio: "transferencia", account: "cc" },
    ],

    investments: [
      { tipo: "fci", label: "FCI Money Market (liquidez)", monto: 25000000, sociedad: "Balanz Money Market",
        account: "cc", fechaColocacion: "d-6", fechaVenc: null, rendimiento: 42, estado: "activa" },
      { tipo: "plazo_fijo", label: "Plazo fijo 30 días", monto: 20000000, sociedad: "Banco Galicia",
        account: "cc", fechaColocacion: "d-10", fechaVenc: "d+20", rendimiento: 47, estado: "activa" },
      { tipo: "dolares", label: "Dólares (cobertura de obra)", monto: 30000, sociedad: "MEP",
        account: "usd", fechaColocacion: "d-20", fechaVenc: null, rendimiento: 0, estado: "activa" },
      { tipo: "caucion", label: "Caución colocadora 7 días", monto: 12000000, sociedad: "Balanz",
        account: "comitente", fechaColocacion: "d-2", fechaVenc: "d+5", rendimiento: 40, estado: "activa" },
      { tipo: "bono", label: "Bono soberano corto (AL30)", monto: 9000000, sociedad: "Balanz",
        account: "comitente", fechaColocacion: "d-45", fechaVenc: "d+120", rendimiento: 52, estado: "activa" },
    ],

    comprobantes: comprobantes,

    proveedores: [
      { nombre: "Aceros del Sur S.A.", cuit: "30-65111222-3", rubro: "Materiales (acero)", contacto: "Ventas", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
      { nombre: "Hormigones Pilar S.R.L.", cuit: "30-66222333-4", rubro: "Hormigón elaborado", contacto: "Pedidos", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 15 },
      { nombre: "Alquiler de Grúas Norte", cuit: "30-67333444-5", rubro: "Maquinaria", contacto: "Logística", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
    ],

    retenciones: [
      { cuit: "30998877665", agente: "Municipio de Pilar", impuesto: "Ganancias", regimen: "94", fecha: "d-28", tipo: "retencion", importe: 900000, certificado: "2026003011" },
      { cuit: "30998877665", agente: "Municipio de Pilar", impuesto: "IIBB", regimen: "119", fecha: "d-28", tipo: "retencion", importe: 640000, certificado: "2026003044" },
      { cuit: "30990011228", agente: "Gobierno Prov. Bs As", impuesto: "SUSS", regimen: "IERIC", fecha: "d-10", tipo: "retencion", importe: 1200000, certificado: "2026003190" },
    ],
  };
})();
