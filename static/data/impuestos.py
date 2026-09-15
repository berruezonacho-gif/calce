"""
data/impuestos.py — Estimador impositivo para tesorería PyME.

IMPORTANTE: esto es un ESTIMADOR/PROYECTOR, no un liquidador fiscal. No reemplaza
al contador ni calcula la DDJJ exacta. Su objetivo es anticipar cuánto y cuándo
va a pagar impuestos la PyME, para que esos vencimientos caigan en el flujo de
caja y no sorprendan. Los números son aproximados y deben validarse con el
contador antes de pagar.

Cubre los impuestos que más impactan la caja de una PyME argentina:
  - IVA: débito fiscal (ventas) − crédito fiscal (compras) = saldo a pagar mensual
  - IIBB (Ingresos Brutos): alícuota sobre la facturación (varía por provincia/actividad)
  - Ganancias: anticipos (estimados sobre el impuesto del período anterior)
  - Impuesto al cheque (débitos y créditos bancarios): 0,6% cada uno

Un punto central para PyMEs con mucho efectivo: distingue operaciones en efectivo
vs bancarizadas. El efectivo no paga impuesto al cheque, pero tampoco genera
crédito de ese impuesto contra Ganancias, y aumenta la exposición si no está
declarado. La herramienta lo muestra para que la decisión sea informada.

Las alícuotas son parámetros configurables (defaults de referencia), no valores
grabados: cada PyME ajusta según su situación (responsable inscripto, provincia,
actividad, régimen).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from calendar import monthrange


# ── Parámetros por defecto (configurables) ────────────────────────────────────
DEFAULTS = {
    "iva_alicuota": 21.0,        # % IVA general (puede ser 10.5 o 27 según rubro)
    "iibb_alicuota": 3.0,        # % IIBB sobre ventas (varía por provincia/actividad)
    "ganancias_alicuota": 35.0,  # % sobre utilidad estimada (sociedades)
    "ganancias_anticipos": 10,   # cantidad de anticipos anuales
    "cheque_alicuota": 0.6,      # % impuesto al cheque por cada lado (débito/crédito)
    "iva_dia_vto": 20,           # día del mes de vencimiento de IVA
    "iibb_dia_vto": 15,          # día del mes de vencimiento de IIBB
}


@dataclass
class Operacion:
    """Una operación de venta o compra."""
    fecha: str
    tipo: str            # "venta" | "compra"
    neto: float          # monto neto (sin IVA)
    medio: str = "banco" # "banco" | "efectivo"
    iva_alicuota: float = 21.0


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def _to_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def estimar(
    operaciones: list[dict],
    params: dict | None = None,
    ganancias_impuesto_anual: float = 0.0,
) -> dict:
    """Estima los impuestos a pagar a partir de las operaciones del período.

    operaciones: lista de {fecha, tipo (venta/compra), neto, medio (banco/efectivo), iva_alicuota}
    params: override de las alícuotas y días de vencimiento (ver DEFAULTS).
    ganancias_impuesto_anual: impuesto a las ganancias del último ejercicio, para
        estimar los anticipos.

    Devuelve el detalle por impuesto y los vencimientos proyectados (para el cash flow).
    """
    p = {**DEFAULTS, **(params or {})}

    # ── Agrupar por mes ──
    meses: dict[str, dict] = {}
    total_ventas = total_compras = 0.0
    ventas_efectivo = ventas_banco = 0.0
    debitos_bancarios = creditos_bancarios = 0.0

    for op in operaciones:
        d = _to_date(op.get("fecha"))
        if not d:
            continue
        neto = float(op.get("neto") or 0)
        if neto == 0:
            continue
        tipo = (op.get("tipo") or "venta").lower()
        medio = (op.get("medio") or "banco").lower()
        ali = float(op.get("iva_alicuota") or p["iva_alicuota"])
        iva = neto * ali / 100
        mes = d.strftime("%Y-%m")
        m = meses.setdefault(mes, {"debito": 0.0, "credito": 0.0, "ventas": 0.0, "compras": 0.0})

        if tipo == "venta":
            m["debito"] += iva          # IVA débito (lo que cobrás)
            m["ventas"] += neto
            total_ventas += neto
            if medio == "efectivo":
                ventas_efectivo += neto + iva
            else:
                ventas_banco += neto + iva
                creditos_bancarios += neto + iva  # entra a la cuenta
        else:  # compra
            m["credito"] += iva         # IVA crédito (lo que pagás)
            m["compras"] += neto
            total_compras += neto
            if medio == "banco":
                debitos_bancarios += neto + iva   # sale de la cuenta

    # ── IVA por mes ──
    iva_vtos = []
    total_iva = 0.0
    for mes in sorted(meses):
        m = meses[mes]
        saldo = m["debito"] - m["credito"]
        total_iva += max(0.0, saldo)
        # vence el día X del mes siguiente
        y, mo = map(int, mes.split("-"))
        vto = _add_months(date(y, mo, 1), 1).replace(day=min(p["iva_dia_vto"], 28))
        iva_vtos.append({
            "mes": mes, "debito": round(m["debito"], 2), "credito": round(m["credito"], 2),
            "saldo": round(saldo, 2), "a_pagar": round(max(0.0, saldo), 2),
            "vencimiento": vto.isoformat(),
        })

    # ── IIBB por mes (sobre ventas) ──
    iibb_vtos = []
    total_iibb = 0.0
    for mes in sorted(meses):
        base = meses[mes]["ventas"]
        monto = base * p["iibb_alicuota"] / 100
        total_iibb += monto
        y, mo = map(int, mes.split("-"))
        vto = _add_months(date(y, mo, 1), 1).replace(day=min(p["iibb_dia_vto"], 28))
        iibb_vtos.append({
            "mes": mes, "base": round(base, 2), "alicuota": p["iibb_alicuota"],
            "a_pagar": round(monto, 2), "vencimiento": vto.isoformat(),
        })

    # ── Impuesto al cheque (sobre movimientos bancarios) ──
    imp_cheque = (debitos_bancarios + creditos_bancarios) * p["cheque_alicuota"] / 100
    # Del impuesto al cheque, ~33% del crédito es pago a cuenta de Ganancias
    cheque_pago_a_cuenta = creditos_bancarios * p["cheque_alicuota"] / 100 * 0.33

    # ── Anticipos de Ganancias ──
    anticipo_mensual = (ganancias_impuesto_anual / p["ganancias_anticipos"]) if ganancias_impuesto_anual else 0.0

    # ── Comparación efectivo vs banco (el diferencial para la PyME) ──
    total_facturado = ventas_efectivo + ventas_banco
    pct_efectivo = (ventas_efectivo / total_facturado * 100) if total_facturado else 0.0

    return {
        "ok": True,
        "resumen": {
            "total_ventas": round(total_ventas, 2),
            "total_compras": round(total_compras, 2),
            "total_iva": round(total_iva, 2),
            "total_iibb": round(total_iibb, 2),
            "impuesto_cheque": round(imp_cheque, 2),
            "cheque_pago_a_cuenta_ganancias": round(cheque_pago_a_cuenta, 2),
            "anticipo_ganancias_mensual": round(anticipo_mensual, 2),
            "carga_total_estimada": round(total_iva + total_iibb + imp_cheque, 2),
        },
        "efectivo_vs_banco": {
            "ventas_efectivo": round(ventas_efectivo, 2),
            "ventas_banco": round(ventas_banco, 2),
            "pct_efectivo": round(pct_efectivo, 1),
            "nota": "El efectivo no paga impuesto al cheque, pero tampoco genera "
                    "crédito contra Ganancias ni queda documentado. Blanquear más "
                    "operaciones sube el impuesto al cheque pero mejora el crédito "
                    "fiscal y reduce la exposición.",
        },
        "iva": iva_vtos,
        "iibb": iibb_vtos,
        "vencimientos": _build_vencimientos(iva_vtos, iibb_vtos, anticipo_mensual, p),
        "disclaimer": "Estimación orientativa, no liquidación fiscal. Validá con "
                      "tu contador antes de pagar.",
    }


def _build_vencimientos(iva_vtos, iibb_vtos, anticipo_mensual, p) -> list[dict]:
    """Arma la lista de vencimientos como movimientos negativos para el cash flow."""
    vtos = []
    for v in iva_vtos:
        if v["a_pagar"] > 0:
            vtos.append({"fecha": v["vencimiento"], "concepto": f"IVA {v['mes']}",
                         "monto": -v["a_pagar"], "impuesto": "IVA"})
    for v in iibb_vtos:
        if v["a_pagar"] > 0:
            vtos.append({"fecha": v["vencimiento"], "concepto": f"IIBB {v['mes']}",
                         "monto": -v["a_pagar"], "impuesto": "IIBB"})
    vtos.sort(key=lambda x: x["fecha"])
    return vtos


def as_movements(estimacion: dict) -> list[dict]:
    """Convierte los vencimientos impositivos en movimientos para el cash flow."""
    out = []
    for v in estimacion.get("vencimientos", []):
        out.append({
            "date": v["fecha"],
            "amount": v["monto"],
            "label": v["concepto"],
            "recurrence": "none",
            "category": "impuestos",
        })
    return out
