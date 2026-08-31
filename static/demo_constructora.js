// ─────────────────────────────────────────────────────────────
// DEMO: "Constructora del Plata S.R.L."
// PyME constructora argentina. Datos ficticios pero realistas,
// pensados para mostrar la app y estresar el modelo de datos.
//
// Perfil: empresa con 2 obras en curso (un edificio y una refacción
// de local comercial para un cliente corporativo), ~18 empleados,
// factura ~$45M/mes, opera con certificaciones de obra, anticipos,
// acopio de materiales y varios subcontratistas.
//
// Se carga con ?demo=constructora
// ─────────────────────────────────────────────────────────────

const DEMO_CONSTRUCTORA = {
  empresa: {
    nombre: "Constructora del Plata S.R.L.",
    cuit: "30-71234567-8",
    provincia: "Buenos Aires",
  },
  prefs: { moneda: "ARS", formatoFecha: "dd/mm/aaaa", colchon: 8000000, horizonte: 90 },
  impuestos: { iva: 21, iibb: 3.5 },
  accounts: [
    { id: "bna-cc",   name: "Cuenta corriente operativa", banco: "Banco de la Nación Argentina", tipo: "cc", moneda: "ARS", alias: "constplata.bna.cc", opening: 55000000 },
    { id: "gali-ca",  name: "Caja de ahorro haberes",     banco: "Banco de Galicia y Buenos Aires (Galicia)", tipo: "ca", moneda: "ARS", alias: "constplata.sueldos", opening: 18000000 },
    { id: "prov-cc",  name: "Cuenta obra pública",        banco: "Banco de la Provincia de Buenos Aires (Provincia)", tipo: "cc", moneda: "ARS", alias: "constplata.obrapublica", opening: 15000000 },
    { id: "usd-ca",   name: "Caja de ahorro USD",         banco: "Banco de la Nación Argentina", tipo: "ca", moneda: "USD", alias: "constplata.usd", opening: 12000 },
    { id: "caja",     name: "Caja chica de obra",         banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 1500000 },
  ],
  // Los montos son mensuales/recurrentes salvo aclaración.
  // account por id. medio: transferencia / cheque / efectivo / tarjeta
  movements: [
    // ── INGRESOS operativos recurrentes (los grandes van en comprobantes) ──
    { label: "Certificación mensual obra en curso", amount: 32000000, date: "d+15", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Venta materiales sobrantes", amount: 1200000, date: "d+18", recurrence: "none", medio: "efectivo", account: "caja" },
    { label: "Cobro alquiler equipos a terceros", amount: 900000, date: "d+9", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },

    // ── EGRESOS: MANO DE OBRA ───────────────────────────────
    { label: "Sueldos personal de obra (1ra quincena)", amount: -8500000, date: "d+5",  recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Sueldos personal de obra (2da quincena)", amount: -8500000, date: "d+20", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Cargas sociales UOCRA + AFIP", amount: -6200000, date: "d+12", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Sueldos administración", amount: -3800000, date: "d+5", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },

    // ── EGRESOS: ESTRUCTURA Y GASTOS FIJOS ──────────────────
    { label: "Alquiler oficina y obrador", amount: -1600000, date: "d+3", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Combustible y logística", amount: -1100000, date: "d+6", recurrence: "monthly", medio: "tarjeta", account: "bna-cc" },
    { label: "Seguros (ART, obra, vehículos)", amount: -1900000, date: "d+9", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Honorarios estudio contable", amount: -650000, date: "d+11", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Servicios (luz, agua, internet)", amount: -480000, date: "d+14", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Caja chica de obra (reposición)", amount: -600000, date: "d+13", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Alquiler grúa y encofrados", amount: -2100000, date: "d+7", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Cuota leasing camioneta", amount: -780000, date: "d+15", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
  ],

  // ── INVERSIONES YA HECHAS ────────────────────────────────
  // Colocadas con el excedente. Montos que salen de la caja sin dejarla corta.
  investments: [
    { tipo: "plazo_fijo", label: "Plazo fijo Nación 30d", monto: 8000000, account: "bna-cc", fechaColocacion: "d-5", fechaVenc: "d+25", rendimiento: 42, estado: "activa" },
    { tipo: "fci", label: "FCI money market", monto: 6000000, account: "gali-ca", fechaColocacion: "d-2", fechaVenc: null, rendimiento: 38, estado: "activa" },
    { tipo: "dolares", label: "Tenencia en dólares", monto: 8000, account: "usd-ca", fechaColocacion: "d-10", fechaVenc: null, rendimiento: 0, estado: "activa" },
  ],

  // ── COBRANZAS Y PAGOS ────────────────────────────────────
  comprobantes: [
    // Por cobrar — certificaciones y ventas (entran pronto, dan liquidez)
    { tipo: "cobrar", contraparte: "Municipalidad de La Plata", numero: "FC-A-0001-00012", monto: 22000000, account: "bna-cc", emision: "d-15", vencimiento: "d+5", categoria: "certificaciones", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Gobierno de la Provincia", numero: "FC-A-0001-00018", monto: 18500000, account: "bna-cc", emision: "d-10", vencimiento: "d+12", categoria: "certificaciones", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Fideicomiso Nordelta", numero: "FC-A-0002-00031", monto: 15200000, account: "bna-cc", emision: "d-8", vencimiento: "d+18", categoria: "certificaciones", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Desarrolladora del Sur", numero: "FC-B-0003-00021", monto: 5400000, account: "bna-cc", emision: "d-8", vencimiento: "d+22", categoria: "ventas", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Consorcio Edificio Centro", numero: "FC-A-0002-00040", monto: 9800000, account: "bna-cc", emision: "d-3", vencimiento: "d+30", categoria: "certificaciones", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Country Los Robles", numero: "FC-B-0003-00028", monto: 6300000, account: "bna-cc", emision: "d-2", vencimiento: "d+40", categoria: "ventas", estado: "pendiente" },
    // Por pagar — proveedores y subcontratistas (vencimientos escalonados)
    { tipo: "pagar", contraparte: "Corralón El Constructor", numero: "FC-A-0044-00891", monto: 6800000, account: "bna-cc", emision: "d-10", vencimiento: "d+8", categoria: "materiales", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Hormigonera Platense", numero: "FC-A-0012-00340", monto: 4200000, account: "bna-cc", emision: "d-15", vencimiento: "d+14", categoria: "materiales", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Subcontratista Electricidad SRL", numero: "FC-A-0088-00105", monto: 3500000, account: "bna-cc", emision: "d-12", vencimiento: "d+20", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Aceros del Plata SA", numero: "FC-A-0021-00077", monto: 5100000, account: "bna-cc", emision: "d-6", vencimiento: "d+11", categoria: "materiales", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Alquiler de grúas SA", numero: "FC-A-0007-00056", monto: 2800000, account: "bna-cc", emision: "d-5", vencimiento: "d+25", categoria: "servicios", estado: "pendiente" },
  ],

  // ── PROVEEDORES (directorio) ─────────────────────────────
  proveedores: [
    { nombre: "Corralón El Constructor", cuit: "30-70123456-7", rubro: "Materiales", contacto: "Ventas mostrador", email: "ventas@elconstructor.com.ar", telefono: "0221-4567890", cbu: "0110599520000012345678", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
    { nombre: "Hormigonera Platense", cuit: "30-68999888-2", rubro: "Materiales", contacto: "Ing. Rodríguez", email: "pedidos@hormigoneraplatense.com", telefono: "0221-4112233", cbu: "0140333801000098765432", condicionIVA: "Responsable Inscripto", plazoPago: 15 },
    { nombre: "Subcontratista Electricidad SRL", cuit: "30-71222333-9", rubro: "Subcontratos", contacto: "Carlos Méndez", email: "cmendez@electricidadsrl.com.ar", telefono: "011-5566-7788", cbu: "0720111788000045612300", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
    { nombre: "Aceros del Plata SA", cuit: "30-65444555-1", rubro: "Materiales", contacto: "Compras", email: "compras@acerosdelplata.com", telefono: "011-4321-0987", cbu: "0170099640000011223344", condicionIVA: "Responsable Inscripto", plazoPago: 45 },
    { nombre: "Alquiler de grúas SA", cuit: "30-69888777-4", rubro: "Equipos", contacto: "Logística", email: "operaciones@gruassa.com.ar", telefono: "011-4888-9900", cbu: "0290000110000033445566", condicionIVA: "Responsable Inscripto", plazoPago: 15 },
  ],
};
