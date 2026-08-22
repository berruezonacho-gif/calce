"""
Perinola.Dashboard — Calculadora de bonos / ONs.

Matemática de renta fija independiente de la fuente del precio: dado un precio
de mercado (BYMADATA cuando el mercado está abierto, o ingresado a mano) y los
términos del bono (cupón, frecuencia, vencimiento, amortización), calcula:

  - TIR (tasa interna de retorno) por Newton-Raphson sobre el flujo de fondos
  - Duration de Macaulay y modificada
  - Paridad (precio / valor técnico)
  - Valor técnico, intereses corridos y próximo cupón

Convención: precios y flujos por cada 100 de valor nominal (VN), como cotiza
BYMA. Las ONs argentinas suelen ser bullet (amortizan todo al vencimiento) o
con amortizaciones parciales; soportamos ambos vía la lista `amortizations`.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta


def _to_date(value) -> date | None:
    if isinstance(value, date):
        return value
    if not value:
        return None
    s = str(value)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def build_cashflow(
    *,
    coupon_rate: float,
    frequency: int,
    maturity,
    settlement=None,
    amort_start=None,
    amort_count: int = 1,
    face: float = 100.0,
):
    """Construye el flujo de fondos futuro por cada `face` (100) de VN.

    - coupon_rate: tasa nominal anual (ej. 0.095 = 9,5 %).
    - frequency: cupones por año (1, 2, 4, 12).
    - maturity: fecha de vencimiento.
    - amort_start: fecha del primer pago de capital (None = bullet al final).
    - amort_count: en cuántas cuotas iguales amortiza el capital.

    Devuelve [(fecha, monto), ...] solo con los pagos posteriores a settlement.
    El cupón se calcula sobre el VN residual (vivo) en cada período.
    """
    mat = _to_date(maturity)
    if not mat or frequency <= 0:
        return []
    settle = _to_date(settlement) or date.today()
    step = 12 // frequency  # meses entre cupones

    # Fechas de cupón hacia atrás desde el vencimiento hasta cubrir settlement.
    coupon_dates: list[date] = []
    d = mat
    while d > settle:
        coupon_dates.append(d)
        d = _add_months(d, -step)
    coupon_dates.reverse()
    if not coupon_dates:
        return []

    # Cronograma completo de amortización, incluyendo cuotas ya pagadas. Es
    # imprescindible para calcular el VN residual: si miramos sólo los flujos
    # futuros, una ON parcialmente amortizada vuelve erróneamente a VN 100.
    all_amort_dates: list[date] = []
    if amort_start:
        a = _to_date(amort_start)
        if a:
            count = max(1, amort_count)
            if count == 1:
                all_amort_dates = [mat]
            else:
                total_months = (mat.year - a.year) * 12 + (mat.month - a.month)
                amort_step = total_months // (count - 1) if total_months > 0 else step
                if amort_step <= 0 or amort_step * (count - 1) != total_months:
                    amort_step = step
                all_amort_dates = [_add_months(a, amort_step * i) for i in range(count)]
                all_amort_dates[-1] = mat
    if not all_amort_dates:
        all_amort_dates = [mat]  # bullet
    amort_each = face / len(all_amort_dates)
    paid_installments = sum(1 for ad in all_amort_dates if ad <= settle)
    outstanding = max(0.0, face - amort_each * paid_installments)
    future_amort_dates = {ad for ad in all_amort_dates if ad > settle}

    period_rate = coupon_rate / frequency
    flows: list[dict] = []
    coupon_date_set = set(coupon_dates)
    event_dates = sorted(coupon_date_set | future_amort_dates)
    for cd in event_dates:
        opening = outstanding
        interest = opening * period_rate if cd in coupon_date_set else 0.0
        principal = min(opening, amort_each) if cd in future_amort_dates else 0.0
        outstanding = max(0.0, outstanding - principal)
        flows.append({
            "date": cd,
            "opening_residual": round(opening, 6),
            "interest": round(interest, 6),
            "principal": round(principal, 6),
            "amount": round(interest + principal, 6),
            "residual": round(outstanding, 6),
        })
    return flows


def _flow_date(flow):
    return flow["date"] if isinstance(flow, dict) else flow[0]


def _flow_amount(flow):
    return flow["amount"] if isinstance(flow, dict) else flow[1]


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    year = d.year + m // 12
    month = m % 12 + 1
    day = min(d.day, _days_in_month(year, month))
    return date(year, month, day)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - timedelta(days=1)).day


def _npv(rate: float, price: float, flows, settle: date) -> float:
    total = -price
    for flow in flows:
        d = _flow_date(flow)
        amount = _flow_amount(flow)
        t = (d - settle).days / 365.0
        total += amount / (1 + rate) ** t
    return total


def tir(price: float, flows, settlement=None) -> float | None:
    """TIR anual por Newton-Raphson. None si no converge o faltan datos."""
    if not flows or not price or price <= 0:
        return None
    settle = _to_date(settlement) or date.today()
    rate = 0.10
    for _ in range(100):
        f = _npv(rate, price, flows, settle)
        # derivada numérica
        df = (_npv(rate + 1e-5, price, flows, settle) - f) / 1e-5
        if abs(df) < 1e-12:
            break
        new = rate - f / df
        if new <= -0.99:
            new = (rate - 0.99) / 2
        if abs(new - rate) < 1e-8:
            return round(new, 6)
        rate = new
    return round(rate, 6) if -0.99 < rate < 10 else None


def duration(price: float, flows, ytm: float, settlement=None) -> dict | None:
    """Duration de Macaulay y modificada, dada la TIR (ytm)."""
    if not flows or ytm is None:
        return None
    settle = _to_date(settlement) or date.today()
    weighted, pv_total = 0.0, 0.0
    for flow in flows:
        d = _flow_date(flow)
        amount = _flow_amount(flow)
        t = (d - settle).days / 365.0
        pv = amount / (1 + ytm) ** t
        weighted += t * pv
        pv_total += pv
    if pv_total <= 0:
        return None
    macaulay = weighted / pv_total
    modified = macaulay / (1 + ytm)
    return {"macaulay": round(macaulay, 3), "modified": round(modified, 3)}


def analyze(*, price: float, coupon_rate: float, frequency: int, maturity,
            settlement=None, amort_start=None, amort_count: int = 1,
            currency: str | None = None, symbol: str | None = None):
    """Cálculo completo a partir del precio LIMPIO de mercado (por cada 100 VN).

    Suma el interés corrido para descontar sobre el precio sucio (convención
    correcta de TIR), y devuelve duration, paridad y el flujo de fondos.
    """
    settle = _to_date(settlement) or date.today()
    flows = build_cashflow(
        coupon_rate=coupon_rate, frequency=frequency, maturity=maturity,
        settlement=settle, amort_start=amort_start, amort_count=amort_count,
    )
    if not flows:
        return {"ok": False, "error": "No se pudo armar el flujo (revisá vencimiento/frecuencia)."}

    # Interés corrido: días desde el último cupón / días del período × cupón.
    step = 12 // frequency
    next_coupon_flow = next((f for f in flows if not isinstance(f, dict) or f.get("interest", 0) > 0), flows[0])
    next_cd = _flow_date(next_coupon_flow)
    prev_cd = _add_months(next_cd, -step)
    period_days = (next_cd - prev_cd).days or 1
    elapsed = max(0, (settle - prev_cd).days)
    residual_vn = float(flows[0].get("opening_residual", 100.0))
    accrued = round(residual_vn * (coupon_rate / frequency) * (elapsed / period_days), 4)

    dirty = price + accrued
    y = tir(dirty, flows, settle)
    dur = duration(dirty, flows, y, settle) if y is not None else None
    technical = round(residual_vn + accrued, 4)          # valor técnico
    parity = round(price / residual_vn * 100, 2) if residual_vn else None
    is_ars = (currency or "").upper() in {"ARS", "PESOS", "$"} or price > 1000
    amount_ars = round(price, 4) if is_ars else None
    price_vr_ars = round(price / residual_vn * 100, 4) if is_ars and residual_vn else None

    return {
        "ok": True,
        "symbol": symbol,
        "currency": currency,
        "tir": y,
        "tir_pct": round(y * 100, 2) if y is not None else None,
        "duration": dur,
        "modified_duration_years": dur["modified"] if dur else None,
        "clean_price": round(price, 4),
        "amount_ars": amount_ars,
        "residual_value": round(residual_vn, 4),
        "price_vr_ars": price_vr_ars,
        "accrued": accrued,
        "accrued_usd": accrued,
        "dirty_price": round(dirty, 4),
        "technical_value": technical,
        "technical_value_usd": technical,
        "coupon_rate": coupon_rate,
        "coupon_pct": round(coupon_rate * 100, 4),
        "parity": parity,
        "flows": [{
            "date": _flow_date(f).isoformat(),
            "interest": round(f.get("interest", 0), 4) if isinstance(f, dict) else None,
            "principal": round(f.get("principal", 0), 4) if isinstance(f, dict) else None,
            "amount": round(_flow_amount(f), 4),
            "residual": round(f.get("residual", 0), 4) if isinstance(f, dict) else None,
        } for f in flows],
        "next_coupon": {"date": _flow_date(next_coupon_flow).isoformat(),
                        "amount": round(_flow_amount(next_coupon_flow), 4)},
        "total_future": round(sum(_flow_amount(f) for f in flows), 2),
        "days_to_maturity": (_to_date(maturity) - settle).days if _to_date(maturity) else None,
    }
