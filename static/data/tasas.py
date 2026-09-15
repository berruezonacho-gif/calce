"""
data/tasas.py — Tasas de corto plazo: caución bursátil y plazo fijo.

Dos instrumentos más para colocar el excedente de una PyME:

  CAUCIÓN BURSÁTIL — el "plazo fijo de la bolsa". Se coloca desde la cuenta
  comitente, plazos desde 1 día, garantizada por BYMA. La tasa de referencia es
  el Índice de Caución BYMA a 1 día (VWAP en tiempo real). Se toma de data912
  (endpoint de cauciones) o del snapshot de BYMA.

  PLAZO FIJO — tradicional bancario, mínimo 30 días. Las tasas por banco salen
  de la API oficial del BCRA (Régimen de Transparencia), que las entidades deben
  reportar. Endpoint público, sin auth.

Ambos degradan a una tasa de referencia si la fuente no responde, para que la
herramienta siga usable offline.
"""
from __future__ import annotations

import httpx

from .cache import get_json, set_json, get_json_stale

TTL = 3 * 3600  # 3 h

# ── Caución ───────────────────────────────────────────────────────────────────
_CAUCION_FALLBACK_TNA = 20.0  # referencia si no hay dato en vivo


def caucion(force: bool = False) -> dict:
    """Tasa de caución a 1 día (Índice BYMA) y curva por plazos si está.

    Intenta data912 (endpoint de cauciones); si no, usa referencia.
    """
    cache_key = "tasas_caucion"
    if not force:
        cached = get_json(cache_key, TTL)
        if cached is not None:
            return cached

    tna = None
    plazos = []
    try:
        r = httpx.get("https://data912.com/live/arg_caucion", timeout=12,
                      headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code == 200:
            rows = r.json()
            if isinstance(rows, list):
                for row in rows:
                    dias = row.get("plazo") or row.get("days") or row.get("term")
                    rate = row.get("tasa") or row.get("rate") or row.get("tna") or row.get("c")
                    if rate:
                        rate = float(rate)
                        rate = rate * 100 if rate < 1 else rate
                        plazos.append({"days": int(dias) if dias else 1, "tna": round(rate, 2)})
                plazos.sort(key=lambda x: x["days"])
                one_day = next((p for p in plazos if p["days"] == 1), None)
                tna = one_day["tna"] if one_day else (plazos[0]["tna"] if plazos else None)
    except Exception:
        pass

    src = "BYMA/data912"
    if tna is None:
        tna = _CAUCION_FALLBACK_TNA
        src = "referencia"
        plazos = [{"days": 1, "tna": tna}]

    result = {
        "ok": True, "source": src, "tna_1d": round(tna, 2),
        "plazos": plazos, "instrument": "Caución bursátil",
        "liquidity": "Al vencimiento (1-120 días)", "risk": "Muy bajo (garantía BYMA)",
    }
    if src != "referencia":
        return set_json(cache_key, result)
    stale = get_json_stale(cache_key)
    return stale or result


# ── Plazo fijo ────────────────────────────────────────────────────────────────
_PF_FALLBACK_TNA = 19.0
_BCRA_PF_URL = "https://api.bcra.gob.ar/estadisticas/v3.0/monetarias"  # base API BCRA


def plazo_fijo(force: bool = False) -> dict:
    """Tasas de plazo fijo tradicional a 30 días, por banco (API BCRA).

    Usa el Régimen de Transparencia del BCRA. Si no responde, devuelve una tasa
    de referencia.
    """
    cache_key = "tasas_plazo_fijo"
    if not force:
        cached = get_json(cache_key, TTL)
        if cached is not None:
            return cached

    banks = []
    try:
        # API de Régimen de Transparencia — endpoint de plazos fijos.
        r = httpx.get(
            "https://api.bcra.gob.ar/regimen-transparencia/v1.0/plazos-fijos",
            timeout=15, headers={"User-Agent": "Mozilla/5.0"}, verify=False,
        )
        if r.status_code == 200:
            payload = r.json()
            rows = payload.get("results") or payload.get("data") or payload
            if isinstance(rows, list):
                for row in rows:
                    name = row.get("entidad") or row.get("banco") or row.get("nombre")
                    tna = row.get("tnaClientes") or row.get("tna") or row.get("tasa")
                    if name and tna:
                        tna = float(tna)
                        tna = tna * 100 if tna < 1 else tna
                        banks.append({"bank": name, "tna": round(tna, 2)})
    except Exception:
        pass

    src = "BCRA"
    if not banks:
        src = "referencia"
        banks = [{"bank": "Referencia mercado", "tna": _PF_FALLBACK_TNA}]

    banks.sort(key=lambda x: x["tna"], reverse=True)
    result = {
        "ok": True, "source": src, "best_tna": banks[0]["tna"] if banks else None,
        "banks": banks, "instrument": "Plazo fijo tradicional",
        "liquidity": "Al vencimiento (mín. 30 días)", "risk": "Muy bajo (garantía bancaria)",
    }
    if src != "referencia":
        return set_json(cache_key, result)
    stale = get_json_stale(cache_key)
    return stale or result


# ── Proyección común ──────────────────────────────────────────────────────────
def project(amount: float, tna: float, days: int) -> dict:
    """Interés simple de colocar un monto a TNA por N días.

    Fórmula estándar de plaza: Interés = Capital × TNA × (días / 365).
    """
    if amount <= 0 or tna <= 0 or days <= 0:
        return {"ok": False, "error": "Parámetros inválidos."}
    interest = amount * (tna / 100) * (days / 365)
    return {
        "ok": True,
        "amount": round(amount, 2),
        "tna": tna,
        "days": days,
        "interest": round(interest, 2),
        "final": round(amount + interest, 2),
    }
