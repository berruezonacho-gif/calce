"""
data/fci.py — Fondos Comunes de Inversión (money market) con rendimientos reales.

Fuente: CAFCI (Cámara Argentina de Fondos Comunes de Inversión), el organismo
oficial que centraliza los datos de todas las administradoras. Su API pública
en api.cafci.org.ar expone rendimientos y patrimonio por fondo/clase.

Los FCI money market (mercado de dinero) son la estrella para tesorería PyME:
invierten en plazos fijos, cauciones y letras de corto plazo, con rescate en el
día (T+0) y riesgo muy bajo. Es donde una PyME coloca la plata que entra y sale.

Estructura CAFCI: cada fondo tiene un ID de fondo y un ID de clase. La base
curada de abajo mapea los money market más grandes del mercado. La API completa
`/fondo` lista todos; cuando esté disponible en el servidor se puede refrescar.

Si la API de CAFCI no responde (sandbox sin salida, o caída), el módulo degrada
con una tabla de referencia de TNA típicas para que la herramienta siga usable.
"""
from __future__ import annotations

import httpx

from .cache import get_json, set_json, get_json_stale

CAFCI_BASE = "https://api.cafci.org.ar"
TTL = 6 * 3600  # 6 h: los rendimientos se publican una vez por día

# Money market más operados del mercado argentino. El id_fondo/id_clase se toman
# de la URL de ficha del fondo en cafci.org.ar (…?q=FONDO;CLASE).
# Nombre y administradora curados; el rendimiento se trae en vivo de CAFCI.
MONEY_MARKET = [
    {"name": "Mercado Fondo",             "manager": "Mercado Pago AM",   "fondo": 798,  "clase": 1982},
    {"name": "Cocos Ahorro",              "manager": "Cocos AM",          "fondo": 1394, "clase": 3521},
    {"name": "Fima Premium",              "manager": "Galicia AM",        "fondo": 22,   "clase": 61},
    {"name": "Balanz Money Market",       "manager": "Balanz AM",         "fondo": 611,  "clase": 1533},
    {"name": "Delta Pesos",               "manager": "Delta AM",          "fondo": 74,   "clase": 195},
    {"name": "Schroder Liquidez",         "manager": "Schroder AM",       "fondo": 132,  "clase": 355},
    {"name": "IEB Ahorro",                "manager": "IEB AM",            "fondo": 1289, "clase": 3210},
    {"name": "Allaria Ahorro",            "manager": "Allaria AM",        "fondo": 921,  "clase": 2295},
    {"name": "ST Zero",                   "manager": "Santander AM",      "fondo": 168,  "clase": 447},
    {"name": "Premier Renta CP",          "manager": "Supervielle AM",    "fondo": 310,  "clase": 812},
]

# Referencia de respaldo (TNA money market típica) si CAFCI no responde.
# Se actualiza a mano cuando cambian mucho las tasas; es solo un fallback.
_FALLBACK_TNA = 28.0


def _fetch_fondo_yield(fondo: int, clase: int) -> dict | None:
    """Rendimiento diario y patrimonio de un fondo/clase desde CAFCI."""
    try:
        url = f"{CAFCI_BASE}/fondo/{fondo}/clase/{clase}/ficha"
        r = httpx.get(url, timeout=12, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def _extract_tna(payload: dict) -> float | None:
    """Extrae la TNA de la respuesta de CAFCI, probando campos habituales."""
    if not payload:
        return None
    data = payload.get("data") or payload
    # CAFCI suele exponer rendimientos en distintos formatos según endpoint
    for key in ("tna", "TNA", "rendimiento", "diario", "rendimientoDiario"):
        val = data.get(key) if isinstance(data, dict) else None
        try:
            if val is not None:
                f = float(val)
                # Si viene como fracción (0.28) lo pasamos a %
                return f * 100 if f < 1 else f
        except (TypeError, ValueError):
            continue
    return None


def money_market(force: bool = False) -> dict:
    """Lista de FCI money market con su TNA real (o de referencia si falla CAFCI).

    Devuelve {"ok", "source", "funds": [{name, manager, tna, tna_source}...]}.
    Ordenada por TNA descendente.
    """
    cache_key = "fci_money_market"
    if not force:
        cached = get_json(cache_key, TTL)
        if cached is not None:
            return cached

    funds = []
    live_count = 0
    for f in MONEY_MARKET:
        payload = _fetch_fondo_yield(f["fondo"], f["clase"])
        tna = _extract_tna(payload) if payload else None
        if tna is not None:
            live_count += 1
            src = "CAFCI"
        else:
            tna = _FALLBACK_TNA
            src = "referencia"
        funds.append({
            "name": f["name"],
            "manager": f["manager"],
            "tna": round(tna, 2),
            "tea": round(((1 + tna / 100 / 365) ** 365 - 1) * 100, 2),
            "tna_source": src,
            "type": "Money Market",
            "liquidity": "T+0",
            "risk": "Muy bajo",
        })

    funds.sort(key=lambda x: x["tna"], reverse=True)
    result = {
        "ok": True,
        "source": "CAFCI" if live_count else "referencia",
        "live_count": live_count,
        "count": len(funds),
        "funds": funds,
    }
    # Solo cachear si al menos algo vino en vivo; si todo es fallback, no fijamos
    # cache largo para reintentar pronto.
    if live_count:
        return set_json(cache_key, result)
    stale = get_json_stale(cache_key)
    return stale or result


def project_investment(amount: float, tna: float, days: int) -> dict:
    """Proyecta cuánto rinde un monto en un FCI a TNA dada, por N días.

    Interés simple diario (los money market capitalizan diario pero para
    tesorería a corto plazo la diferencia es mínima; usamos devengado diario).
    """
    if amount <= 0 or tna <= 0 or days <= 0:
        return {"ok": False, "error": "Parámetros inválidos."}
    daily = tna / 100 / 365
    interest = amount * daily * days
    # Serie de devengado diario para graficar
    series = []
    acc = 0.0
    for d in range(1, days + 1):
        acc += amount * daily
        series.append({"day": d, "accrued": round(acc, 2), "balance": round(amount + acc, 2)})
    return {
        "ok": True,
        "amount": round(amount, 2),
        "tna": tna,
        "days": days,
        "interest": round(interest, 2),
        "final": round(amount + interest, 2),
        "daily_accrual": round(amount * daily, 2),
        "series": series,
    }
