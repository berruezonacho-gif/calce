// demo_consultorio.js — Ejemplo: consultorio de kinesiología (PyME simple)
// Basado en un caso real: factura a obras sociales (OSDE), paga a los
// profesionales que atienden y algunos insumos. Negocio simple, sin
// complejidad de inversiones sofisticadas ni múltiples monedas.
const DEMO_CONSULTORIO = {
  empresa: { nombre: "Consultorio Kiné", cuit: "23-21465805-4", provincia: "Buenos Aires" },

  accounts: [
    { id: "cc",   name: "Cuenta corriente",  banco: "Banco de la Nación Argentina", tipo: "cc", moneda: "ARS", alias: "consultorio.cc", opening: 6500000 },
    { id: "caja", name: "Efectivo",          banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 250000 },
  ],

  // Gastos e ingresos recurrentes del consultorio (los cobros grandes de
  // obras sociales van como facturas por cobrar más abajo).
  movements: [
    // Ingresos: consultas particulares en efectivo (pequeñas, frecuentes)
    { label: "Consultas particulares (efectivo)", amount: 600000, date: "d+3", recurrence: "monthly", medio: "efectivo", account: "caja" },
    // Egresos: estructura del consultorio
    { label: "Alquiler del consultorio", amount: -450000, date: "d+5", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Secretaria (sueldo)", amount: -520000, date: "d+5", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Expensas y servicios", amount: -180000, date: "d+8", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Insumos (vendas, geles, descartables)", amount: -220000, date: "d+12", recurrence: "monthly", medio: "tarjeta", account: "cc" },
    { label: "Monotributo", amount: -85000, date: "d+18", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Contador", amount: -120000, date: "d+10", recurrence: "monthly", medio: "transferencia", account: "cc" },
  ],

  // Facturas a cobrar (obras sociales, pagan a 30-60 días) y a pagar
  // (los kinesiólogos que atienden facturan al consultorio).
  comprobantes: [
    // Por cobrar — obras sociales
    { tipo: "cobrar", contraparte: "OSDE", numero: "0002-00000073", monto: 8500000, neto: 8500000, iva: 0, account: "cc", emision: "d-10", vencimiento: "d+20", categoria: "ventas", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "OSDE", numero: "0002-00000074", monto: 6200000, neto: 6200000, iva: 0, account: "cc", emision: "d-2", vencimiento: "d+35", categoria: "ventas", estado: "pendiente" },
    { tipo: "cobrar", contraparte: "Obra Social del Personal de Dirección", numero: "0002-00000075", monto: 1800000, neto: 1800000, iva: 0, account: "cc", emision: "d-5", vencimiento: "d+40", categoria: "ventas", estado: "pendiente" },
    // Por pagar — profesionales que atienden en el consultorio
    { tipo: "pagar", contraparte: "Kin. Capodicasa Claudia", numero: "0001-00000210", monto: 1350000, neto: 1350000, iva: 0, account: "cc", emision: "d-8", vencimiento: "d+7", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Kin. Mongiardini Damián", numero: "0001-00000118", monto: 980000, neto: 980000, iva: 0, account: "cc", emision: "d-8", vencimiento: "d+7", categoria: "subcontratos", estado: "pendiente" },
    { tipo: "pagar", contraparte: "Kin. Barrionuevo Carla", numero: "0001-00000095", monto: 720000, neto: 720000, iva: 0, account: "cc", emision: "d-8", vencimiento: "d+7", categoria: "subcontratos", estado: "pendiente" },
  ],

  proveedores: [
    { nombre: "Kin. Capodicasa Claudia", cuit: "27-12345678-4", rubro: "Profesional", contacto: "Claudia", email: "", telefono: "", cbu: "", condicionIVA: "Monotributista", plazoPago: 7 },
    { nombre: "Kin. Mongiardini Damián", cuit: "20-23456789-5", rubro: "Profesional", contacto: "Damián", email: "", telefono: "", cbu: "", condicionIVA: "Monotributista", plazoPago: 7 },
    { nombre: "Instituto Carranza S.R.L.", cuit: "30-61234567-8", rubro: "Insumos", contacto: "Ventas", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
  ],
};
