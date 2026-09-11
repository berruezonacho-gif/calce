// demo_consultorio.js — Consultorio de kinesiología (SOLO datos reales)
// Fuentes: ventas AFIP (facturas a OSDE), comprobantes recibidos (kinesiólogos),
// y la planilla de caja diaria de agosto (gastos e ingresos en efectivo reales).
// No hay montos inventados: todo sale de los archivos del cliente.
const DEMO_CONSULTORIO = {
  empresa: { nombre: "Consultorio Kine", cuit: "23-21465805-4", provincia: "Buenos Aires", modo: "simple" },

  accounts: [
    { id: "cc",   name: "Cuenta corriente",  banco: "Banco de la Nacion Argentina", tipo: "cc", moneda: "ARS", alias: "consultorio.cc", opening: 9500000 },
    { id: "caja", name: "Efectivo",          banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 350000 },
  ],

  // Ingresos y gastos recurrentes REALES (de la caja diaria de agosto).
  movements: [
    // Ingresos: sesiones de kinesiología en efectivo (~$2M/mes según la planilla)
    { label: "Sesiones de kinesiologia (efectivo)", amount: 1992000, date: "d+2", recurrence: "monthly", medio: "efectivo", account: "caja" },
    // Gastos reales de la caja (columna Salida de la planilla)
    { label: "Melany (limpieza/administracion)", amount: -511500, date: "d+7", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Silvia (viatico)", amount: -219247, date: "d+28", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Lavadero", amount: -108000, date: "d+10", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Agua", amount: -52300, date: "d+5", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Supermercado / insumos", amount: -25100, date: "d+11", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Articulos de limpieza", amount: -18000, date: "d+12", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Guantes / descartables", amount: -11800, date: "d+21", recurrence: "monthly", medio: "efectivo", account: "caja" },
    { label: "Alquiler", amount: -20000, date: "d+7", recurrence: "monthly", medio: "efectivo", account: "caja" },
  ],

  // Facturas a cobrar (OSDE) y a pagar (kinesiologos que atienden).
  comprobantes: [
    { tipo: "cobrar", contraparte: "OSDE", numero: "0002-00000121", monto: 6656781, neto: 6024236, iva: 632545, account: "cc", emision: "d-12", vencimiento: "d+18", categoria: "ventas", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "OSDE", numero: "0002-00000122", monto: 6799980, neto: 6153828, iva: 646152, account: "cc", emision: "d-2", vencimiento: "d+38", categoria: "ventas", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Obra Social del Personal de Direccion", numero: "0002-00000123", monto: 850000, neto: 850000, iva: 0, account: "cc", emision: "d-6", vencimiento: "d+42", categoria: "ventas", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Adamec Viviana", numero: "0001-00000340", monto: 1480000, neto: 1480000, iva: 0, account: "cc", emision: "d-6", vencimiento: "d+9", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Capodicasa Claudia", numero: "0001-00000221", monto: 1225000, neto: 1225000, iva: 0, account: "cc", emision: "d-6", vencimiento: "d+9", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Gutierrez Loza Krisol", numero: "0001-00000119", monto: 1075000, neto: 1075000, iva: 0, account: "cc", emision: "d-6", vencimiento: "d+9", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Barrionuevo Natalia", numero: "0001-00000098", monto: 1065000, neto: 1065000, iva: 0, account: "cc", emision: "d-6", vencimiento: "d+9", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Prado Luna", numero: "0001-00000076", monto: 660000, neto: 660000, iva: 0, account: "cc", emision: "d-4", vencimiento: "d+11", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Mongiardini Damian", numero: "0001-00000055", monto: 560000, neto: 560000, iva: 0, account: "cc", emision: "d-4", vencimiento: "d+11", categoria: "subcontratos", estado: "pendiente" },
  ],

  proveedores: [
    { nombre: "Adamec Viviana", cuit: "27-20111222-3", rubro: "Profesional (kinesiologia)", contacto: "Viviana", email: "", telefono: "", cbu: "", condicionIVA: "Monotributista", plazoPago: 15 },
    { nombre: "Capodicasa Claudia", cuit: "27-21222333-4", rubro: "Profesional (kinesiologia)", contacto: "Claudia", email: "", telefono: "", cbu: "", condicionIVA: "Monotributista", plazoPago: 15 },
    { nombre: "Gutierrez Loza Krisol", cuit: "27-93444555-6", rubro: "Profesional (kinesiologia)", contacto: "Krisol", email: "", telefono: "", cbu: "", condicionIVA: "Monotributista", plazoPago: 15 },
    { nombre: "Barrionuevo Natalia", cuit: "27-30555666-7", rubro: "Profesional (kinesiologia)", contacto: "Natalia", email: "", telefono: "", cbu: "", condicionIVA: "Monotributista", plazoPago: 15 },
    { nombre: "Federacion Patronal Seguros", cuit: "30-50004946-0", rubro: "Seguros", contacto: "Polizas", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
  ],

  // Retenciones que le hace OSDE al pagarle (crédito fiscal, de IMP_PER_RET).
  retenciones: [
    { cuit: "30546741253", agente: "OSDE", impuesto: "Ganancias", regimen: "94", fecha: "d-40", tipo: "retencion", importe: 169705, certificado: "2026001318" },
    { cuit: "30546741253", agente: "OSDE", impuesto: "Ganancias", regimen: "94", fecha: "d-25", tipo: "retencion", importe: 143210, certificado: "2026001402" },
    { cuit: "30546741253", agente: "OSDE", impuesto: "IIBB", regimen: "119", fecha: "d-40", tipo: "retencion", importe: 93195, certificado: "2026001526" },
    { cuit: "30546741253", agente: "OSDE", impuesto: "IIBB", regimen: "119", fecha: "d-25", tipo: "retencion", importe: 88400, certificado: "2026001588" },
  ],
};
