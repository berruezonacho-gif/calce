"""
data/cashflow.py — Motor de proyección de flujo de caja diario para PyMEs.

Toma los movimientos (entradas y salidas, únicos o recurrentes) y proyecta el
saldo día a día sobre un horizonte. Detecta:
  - excedentes: días con saldo por encima de un colchón mínimo → plata para invertir
  - faltantes: días con saldo por debajo de cero o del mínimo → alerta de descubierto

La granularidad es diaria. Los movimientos recurrentes se expanden a fechas
concretas dentro del horizonte.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from calendar import monthrange


def _to_date(value) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _add_months(d: date, months: int) -> date:
    """Suma meses a una fecha, ajustando el día al último válido del mes."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def expand_movement(mov: dict, start: date, end: date) -> list[tuple[date, float]]:
    """Expande un movimiento (único o recurrente) a (fecha, monto) concretos.

    mov = {
      "date": "2026-09-01",         # fecha del primer (o único) evento
      "amount": 150000,             # positivo = entrada, negativo = salida
      "recurrence": "none|daily|weekly|monthly",  # opcional, default none
      "until": "2026-12-31",        # opcional, fin de la recurrencia
    }
    """
    d0 = _to_date(mov.get("date"))
    amount = float(mov.get("amount") or 0)
    if not d0 or amount == 0:
        return []
    rec = (mov.get("recurrence") or "none").lower()
    until = _to_date(mov.get("until")) or end

    out: list[tuple[date, float]] = []
    if rec in ("none", "", "once"):
        if start <= d0 <= end:
            out.append((d0, amount))
        return out

    d = d0
    guard = 0
    while d <= min(end, until) and guard < 4000:
        if d >= start:
            out.append((d, amount))
        if rec == "daily":
            d = d + timedelta(days=1)
        elif rec == "weekly":
            d = d + timedelta(weeks=1)
        elif rec == "monthly":
            d = _add_months(d, 1)
        else:
            break
        guard += 1
    return out


@dataclass
class CashFlowResult:
    days: list[dict] = field(default_factory=list)   # saldo por día
    surpluses: list[dict] = field(default_factory=list)  # tramos con excedente
    shortfalls: list[dict] = field(default_factory=list)  # tramos con faltante
    summary: dict = field(default_factory=dict)


def project(
    opening_balance: float,
    movements: list[dict],
    horizon_days: int = 90,
    min_buffer: float = 0.0,
    start: date | None = None,
) -> CashFlowResult:
    """Proyecta el saldo diario y detecta excedentes y faltantes.

    - opening_balance: saldo inicial de caja.
    - movements: lista de movimientos (ver expand_movement).
    - horizon_days: cuántos días proyectar.
    - min_buffer: colchón mínimo de caja. El excedente invertible es
      saldo - min_buffer. Un faltante es saldo < 0 (o < min_buffer para alertar).
    """
    start = start or date.today()
    end = start + timedelta(days=horizon_days)

    # Acumular movimientos por fecha
    by_day: dict[date, float] = {}
    for mov in movements:
        for d, amt in expand_movement(mov, start, end):
            by_day[d] = by_day.get(d, 0.0) + amt

    days: list[dict] = []
    balance = float(opening_balance)
    min_balance = balance
    min_balance_date = start
    total_in = 0.0
    total_out = 0.0

    d = start
    while d <= end:
        delta = by_day.get(d, 0.0)
        inflow = delta if delta > 0 else 0.0
        outflow = -delta if delta < 0 else 0.0
        total_in += inflow
        total_out += outflow
        balance += delta
        if balance < min_balance:
            min_balance = balance
            min_balance_date = d
        investable = max(0.0, balance - min_buffer)
        days.append({
            "date": d.isoformat(),
            "inflow": round(inflow, 2),
            "outflow": round(outflow, 2),
            "net": round(delta, 2),
            "balance": round(balance, 2),
            "investable": round(investable, 2),
            "below_buffer": balance < min_buffer,
            "negative": balance < 0,
        })
        d += timedelta(days=1)

    surpluses = _find_runs(days, min_buffer, kind="surplus")
    shortfalls = _find_runs(days, min_buffer, kind="shortfall")

    summary = {
        "opening_balance": round(opening_balance, 2),
        "closing_balance": round(balance, 2),
        "total_inflow": round(total_in, 2),
        "total_outflow": round(total_out, 2),
        "net_change": round(balance - opening_balance, 2),
        "min_balance": round(min_balance, 2),
        "min_balance_date": min_balance_date.isoformat(),
        "min_buffer": round(min_buffer, 2),
        "horizon_days": horizon_days,
        "has_shortfall": any(x["negative"] for x in days),
        # Excedente estable: el menor "investable" sobre todo el horizonte es lo
        # que se puede colocar sin tocar el colchón en ningún momento.
        "stable_surplus": round(min(x["investable"] for x in days), 2) if days else 0.0,
    }

    return CashFlowResult(days=days, surpluses=surpluses,
                          shortfalls=shortfalls, summary=summary)


def _find_runs(days: list[dict], min_buffer: float, kind: str) -> list[dict]:
    """Agrupa días consecutivos en tramos de excedente o de faltante."""
    runs = []
    current = None
    for day in days:
        if kind == "surplus":
            active = day["investable"] > 0 and not day["below_buffer"]
            metric = day["investable"]
        else:  # shortfall
            active = day["below_buffer"] or day["negative"]
            metric = day["balance"]
        if active:
            if current is None:
                current = {"from": day["date"], "to": day["date"],
                           "peak": metric, "days": 1}
            else:
                current["to"] = day["date"]
                current["days"] += 1
                if kind == "surplus":
                    current["peak"] = max(current["peak"], metric)
                else:
                    current["peak"] = min(current["peak"], metric)
        else:
            if current:
                runs.append(current)
                current = None
    if current:
        runs.append(current)
    return runs
