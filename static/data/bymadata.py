from __future__ import annotations

from datetime import datetime, timedelta
import re

import httpx

from .cache import get_json, get_json_stale, set_json


BASE_URL = "https://open.bymadata.com.ar"
API_URL = f"{BASE_URL}/vanoms-be-core/rest/api"
TTL = 60
STATIC_TOKEN = "dc826d4c2dde7519e882a250359a23a7"


def _headers(options: str = "renta-variable") -> dict:
    return {
        "Origin": BASE_URL,
        "Referer": f"{BASE_URL}/",
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache,no-store,max-age=1,must-revalidate",
        "Token": STATIC_TOKEN,
        "Options": options,
        "Expires": "1",
    }


def _get(path: str):
    r = httpx.get(f"{BASE_URL}{path}", timeout=20, verify=False)
    r.raise_for_status()
    return r.json()


def _post(path: str, payload: dict):
    r = httpx.post(f"{API_URL}{path}", json=payload, headers=_headers(), timeout=20, verify=False)
    r.raise_for_status()
    return r.json()


def _post_with_options(path: str, payload: dict, options: str, timeout: int = 20):
    r = httpx.post(f"{API_URL}{path}", json=payload, headers=_headers(options), timeout=timeout, verify=False)
    r.raise_for_status()
    return r.json()


def _first_number(row: dict, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = row.get(key)
        if value in (None, ""):
            continue
        try:
            number = float(str(value).replace(",", "."))
        except ValueError:
            continue
        return number / 100 if number > 1 else number
    return None


def _extract_coupon_rate(row: dict) -> float | None:
    rate = _first_number(row, (
        "couponRate", "interestRate", "rate", "annualRate", "fixedRate",
        "nominalAnnualRate", "nominalRate", "tna", "coupon",
    ))
    if rate is not None:
        return rate
    text = " ".join(str(row.get(k) or "") for k in ("securityDesc", "description", "longDescription"))
    match = re.search(r"(\d{1,2}(?:[,.]\d{1,4})?)\s*%", text)
    if not match:
        return None
    return float(match.group(1).replace(",", ".")) / 100


def _extract_frequency(row: dict) -> int | None:
    value = row.get("frequency") or row.get("paymentFrequency") or row.get("couponFrequency")
    if value not in (None, ""):
        try:
            number = int(float(str(value).replace(",", ".")))
            if number in {1, 2, 4, 12}:
                return number
        except ValueError:
            pass
    text = " ".join(str(row.get(k) or "") for k in ("securityDesc", "description", "longDescription")).lower()
    if "mensual" in text:
        return 12
    if "trimestral" in text:
        return 4
    if "semestral" in text:
        return 2
    if "anual" in text:
        return 1
    return None


def _candidate_paths(symbol: str):
    s = symbol.upper()
    return [
        "/bymadata/free/get-market-data",
        f"/vanoms-be-core/rest/api/bymadata/free/cedears/{s}",
        f"/vanoms-be-core/rest/api/bymadata/free/instruments/{s}",
        f"/vanoms-be-core/rest/api/bymadata/free/leaderboard/{s}",
        f"/api/v1/market-data/securities/{s}",
        f"/api/v1/securities/{s}",
    ]


def quote(symbol: str, force: bool = False):
    """Cotización local vía BYMADATA.

    BYMADATA fue cambiando rutas públicas; este conector prueba rutas
    candidatas y cachea la primera respuesta válida. La capa superior puede
    normalizar campos cuando fijemos la ruta oficial más estable.
    """
    symbol = symbol.upper()
    cache_key = f"bymadata_quote_{symbol}"
    if not force:
        cached = get_json(cache_key, TTL)
        if cached is not None:
            return cached

    errors = []
    for path in _candidate_paths(symbol):
        try:
            if path == "/bymadata/free/get-market-data":
                data = _post(path, {
                    "excludeZeroPxAndQty": False,
                    "T0": True,
                    "page_number": 1,
                    "page_size": 5000,
                    "specie": True,
                })
            else:
                data = _get(path)
            return set_json(cache_key, {"symbol": symbol, "source_path": path, "raw": data})
        except Exception as e:
            errors.append(f"{path}: {e}")
    return set_json(cache_key, {"symbol": symbol, "error": "no se encontró cotización", "attempts": errors})


def cedears_market_data(force: bool = False):
    """Universo CEDEAR publicado por BYMADATA.

    La pantalla pública usa el selector btnCedears. La respuesta incluye
    variantes por moneda; por defecto guardamos las especies ARS como universo
    operativo local y mantenemos el raw para auditar duplicados.
    """
    cache_key = "bymadata_cedears_market_data"
    if not force:
        cached = get_json(cache_key, 5 * 60)
        if cached is not None:
            return cached
    try:
        data = _post("/bymadata/free/get-market-data", {
            "excludeZeroPxAndQty": False,
            "T0": True,
            "page_number": 1,
            "page_size": 5000,
            "btnCedears": True,
        })
        rows = data.get("data") or []
        ars_rows = [r for r in rows if r.get("denominationCcy") == "ARS"]
        currencies: dict[str, list[str]] = {}
        for row in rows:
            symbol = (row.get("symbol") or "").upper()
            currency = row.get("denominationCcy")
            if not symbol or not currency:
                continue
            keys = {symbol}
            if currency in {"USD", "EXT"} and len(symbol) > 1 and symbol[-1] in {"D", "C"}:
                keys.add(symbol[:-1])
            for key in keys:
                bucket = currencies.setdefault(key, [])
                label = "CCL" if currency == "EXT" else currency
                if label not in bucket:
                    bucket.append(label)
        return set_json(cache_key, {
            "ok": bool(rows),
            "source": "BYMADATA get-market-data btnCedears",
            "total_rows": len(rows),
            "ars_rows": len(ars_rows),
            "currencies": currencies,
            "all_rows": rows,
            "rows": ars_rows,
        })
    except Exception as e:
        stale = get_json_stale(cache_key)
        if stale and stale.get("rows"):
            return {**stale, "stale": True, "error": str(e)}
        return {"ok": False, "error": str(e), "rows": []}


def _pick_price(row: dict):
    """Mejor precio ARS disponible de una fila del snapshot, salteando ceros."""
    for field in ("trade", "closingPrice", "settlementPrice", "vwap",
                  "previousClosingPrice", "previousSettlementPrice"):
        val = row.get(field)
        try:
            if val and float(val) > 0:
                return float(val)
        except (TypeError, ValueError):
            continue
    return None


def cedears_price_map(force: bool = False) -> dict[str, dict]:
    """{symbol -> {price_ars, price_usd_local, volume_ars, ...}} para TODOS los CEDEARs.

    Captura ARS (ticker base), USD local (tickerD) y EXT/CCL (tickerC) del mismo
    snapshot. El CCL implícito real es precio_ARS / precio_USD_local (ambos de
    plaza BYMA, sin ratio de conversión).
    """
    # Necesitamos todas las filas (ARS + USD + EXT), no solo las ARS.
    data = cedears_market_data(force=force)
    all_rows = data.get("all_rows") or []
    if force or not all_rows:
        try:
            raw = _post("/bymadata/free/get-market-data", {
                "excludeZeroPxAndQty": False,
                "T0": True,
                "page_number": 1,
                "page_size": 5000,
                "btnCedears": True,
            })
            all_rows = raw.get("data") or []
        except Exception:
            # Fallback: solo usamos las filas ARS del cache
            all_rows = data.get("rows") or []

    # Índice por symbol → row para cada moneda
    ars_map: dict[str, dict] = {}
    usd_map: dict[str, dict] = {}   # tickerD → precio USD local
    ext_map: dict[str, dict] = {}   # tickerC → precio EXT (CCL)

    for row in all_rows:
        symbol = (row.get("symbol") or "").upper()
        ccy = (row.get("denominationCcy") or "").upper()
        if not symbol:
            continue
        price = _pick_price(row)
        if ccy == "ARS":
            ars_map[symbol] = row
        elif ccy == "USD" and symbol.endswith("D"):
            usd_map[symbol[:-1]] = {"price_usd_local": price, "row": row}
        elif ccy == "EXT" and symbol.endswith("C"):
            ext_map[symbol[:-1]] = {"price_ext_local": price, "row": row}

    out: dict[str, dict] = {}
    for symbol, row in ars_map.items():
        price_ars = _pick_price(row)
        usd_entry = usd_map.get(symbol) or {}
        ext_entry = ext_map.get(symbol) or {}
        price_usd_local = usd_entry.get("price_usd_local")
        price_ext_local = ext_entry.get("price_ext_local")

        # CCL implícito real: precio ARS / precio USD local (plaza BYMA).
        # No usa el ratio de conversión.
        implied_ccl = None
        if price_ars and price_usd_local:
            try:
                implied_ccl = float(price_ars) / float(price_usd_local)
            except (TypeError, ValueError, ZeroDivisionError):
                implied_ccl = None

        out[symbol] = {
            "price_ars": price_ars,
            "price_usd_local": price_usd_local,   # precio en USD de plaza local (tickerD)
            "price_ext_local": price_ext_local,   # precio EXT/CCL (tickerC)
            "implied_ccl_byma": implied_ccl,       # CCL real = ARS / USD_local
            "volume_ars": row.get("volumeAmount"),
            "volume_nominal": row.get("volume"),
            "trade_hour": row.get("tradeHour"),
            "vwap": row.get("vwap"),
            "high": row.get("tradingHighPrice"),
            "low": row.get("tradingLowPrice"),
            "source": "BYMADATA snapshot",
        }
    return out


def instrument_profile(symbol: str, force: bool = False):
    """Ficha técnica pública de BYMADATA para validar especie/CEDEAR.

    Probado con AAPL: devuelve tipoEspecie=Cedears, ISIN, mercado de origen,
    denominación, símbolo de mercado y emisor. No trae ratio ni precio.
    """
    symbol = symbol.upper()
    cache_key = f"bymadata_profile_{symbol}"
    if not force:
        cached = get_json(cache_key, 24 * 3600)
        if cached is not None:
            return cached
    try:
        data = _post("/bymadata/free/bnown/fichatecnica/especies/general", {"symbol": symbol})
        rows = data.get("data") or []
        return set_json(cache_key, {
            "symbol": symbol,
            "ok": bool(rows),
            "source_path": "/bymadata/free/bnown/fichatecnica/especies/general",
            "profile": rows[0] if rows else None,
        })
    except Exception as e:
        return set_json(cache_key, {"symbol": symbol, "ok": False, "error": str(e)})


def cached_instrument_profile(symbol: str):
    return get_json(f"bymadata_profile_{symbol.upper()}", 24 * 3600)


def historical_prices(symbol: str, days: int = 25, force: bool = False):
    """BYMADATA historical local prices.

    Uses maturity=2 because the public site returns data there for equities and
    CEDEARs. Fields include precioCierre, volumenNominal and fecha.
    """
    symbol = symbol.upper()
    cache_key = f"bymadata_hist_{symbol}_{days}"
    if not force:
        cached = get_json(cache_key, 30 * 60)
        if cached is not None:
            return cached
    today = datetime.now()
    start = today - timedelta(days=days)
    payload = {
        "symbol": symbol,
        "maturity": "2",
        "fromDate": start.strftime("%Y-%m-%d"),
        "toDate": today.strftime("%Y-%m-%d"),
        "homogeneous": "1",
        "period": "1",
    }
    try:
        data = _post_with_options("/bymadata/free/bnown/seriesHistoricas/especies", payload, "technical-details", timeout=60)
        rows = data.get("data") or []
        rows.sort(key=lambda r: r.get("fecha") or "")
        return set_json(cache_key, {"symbol": symbol, "ok": bool(rows), "rows": rows[-90:]})
    except Exception as e:
        return set_json(cache_key, {"symbol": symbol, "ok": False, "error": str(e), "rows": []})


def latest_local_price(symbol: str, force: bool = False):
    hist = historical_prices(symbol, force=force)
    rows = hist.get("rows") or []
    if not rows:
        return {"symbol": symbol.upper(), "ok": False, "error": hist.get("error") or "sin histórico BYMADATA"}
    last = rows[-1]
    close = last.get("precioCierre") or last.get("precio cierre") or last.get("closingPrice")
    if close is None:
        return {"symbol": symbol.upper(), "ok": False, "error": "histórico sin precio de cierre", "raw": last}
    return {
        "symbol": symbol.upper(),
        "ok": True,
        "price_ars": close,
        "volume": last.get("volumenNominal"),
        "date": last.get("fecha"),
        "source": "BYMADATA histórico",
        "raw": last,
    }


def balances(symbol: str, force: bool = False):
    symbol = symbol.upper()
    cache_key = f"bymadata_balances_{symbol}"
    if not force:
        cached = get_json(cache_key, 6 * 3600)
        if cached is not None:
            return cached
    try:
        data = _post_with_options(
            "/bymadata/free/bnown/seriesHistoricas/balances",
            {"symbol": symbol},
            "technical-details",
            timeout=45,
        )
        rows = data.get("data") or []
        return set_json(cache_key, {
            "symbol": symbol,
            "ok": bool(rows),
            "source": "BYMADATA/Bolsar balances",
            "rows": rows,
        })
    except Exception as e:
        return set_json(cache_key, {"symbol": symbol, "ok": False, "error": str(e), "rows": []})


def bond_indexes(force: bool = False):
    cache_key = "bymadata_bond_indexes"
    if not force:
        cached = get_json(cache_key, 30 * 60)
        if cached is not None:
            return cached
    try:
        data = _post_with_options(
            "/bymadata/free/index-bonds",
            {"page_number": 1, "page_size": 50},
            "renta-fija",
            timeout=30,
        )
        rows = data.get("data") or []
        return set_json(cache_key, {"ok": bool(rows), "source": "BYMADATA índices de bonos", "rows": rows})
    except Exception as e:
        stale = get_json_stale(cache_key)
        if stale and stale.get("rows"):
            return {**stale, "stale": True, "error": str(e)}
        return {"ok": False, "error": str(e), "rows": []}


def _merge_ons_last_prices(rows: list[dict]) -> None:
    """Persiste el último precio conocido de cada ON y rellena los que hoy
    vienen en 0 (fuera de rueda BYMA manda todo en cero).

    El almacén `ons_last_prices` no caduca: guarda {symbol: {price, date}} con
    el último precio > 0 visto. Cuando el feed trae 0, se completa la fila con
    ese precio y se marca price_stale=True + price_date para que la UI avise.
    """
    from datetime import date as _date
    store = get_json_stale("ons_last_prices") or {}
    today = _date.today().isoformat()
    changed = False
    for r in rows:
        sym = r.get("symbol") or ""
        if not sym:
            continue
        if (r.get("price") or 0) > 0:
            prev = store.get(sym) or {}
            if prev.get("price") != r["price"] or prev.get("date") != today:
                store[sym] = {"price": r["price"], "date": today}
                changed = True
        else:
            saved = store.get(sym)
            if saved and saved.get("price"):
                r["price"] = float(saved["price"])
                r["price_stale"] = True
                r["price_date"] = saved.get("date")
    if changed:
        set_json("ons_last_prices", store)


def _merge_data912_prices(rows: list[dict]) -> None:
    """Completa precios de ONs que BYMA no tiene, usando data912 como respaldo.

    Solo rellena filas cuyo precio sigue en 0 tras el merge del histórico BYMA.
    data912 puede tener delay, así que es complementario: BYMA manda, data912
    rellena huecos (especies de baja liquidez o mercado cerrado sin histórico).
    El match es por raíz del símbolo (sin sufijo de moneda D/C).
    """
    # ¿Hay algún hueco para completar? Si no, evitamos la llamada de red.
    if not any((r.get("price") or 0) <= 0 for r in rows):
        return
    try:
        from . import data912
        d912 = data912.ons_prices()  # {symbol: price} en USD
    except Exception:
        return
    if not d912:
        return
    # Índice por raíz (los símbolos de data912 suelen venir en USD, raíz sin sufijo)
    by_root: dict[str, float] = {}
    for sym, price in d912.items():
        root = sym.rstrip("DC").upper() if len(sym) > 2 else sym.upper()
        by_root.setdefault(root, price)
        by_root.setdefault(sym.upper(), price)
    for r in rows:
        if (r.get("price") or 0) > 0:
            continue
        sym = (r.get("symbol") or "").upper()
        root = sym.rstrip("DC") if len(sym) > 2 else sym
        price = d912.get(sym) or by_root.get(root)
        if price and price > 0:
            r["price"] = float(price)
            r["price_stale"] = True
            r["price_source"] = "data912"


def negociable_obligations(force: bool = False):
    """Obligaciones negociables (ONs) cotizando en BYMA.

    Trae las 3 especies por símbolo (ARS, USD/D, CCL/C). Fuera del horario de
    mercado los precios vienen en 0; igual devolvemos el universo con
    vencimiento y días al vencimiento para la calculadora.
    """
    cache_key = "bymadata_ons"
    if not force:
        cached = get_json(cache_key, 5 * 60)
        if cached is not None:
            return cached
    try:
        data = _post_with_options(
            "/bymadata/free/negociable-obligations",
            {"excludeZeroPxAndQty": False, "T0": True, "page_number": 1, "page_size": 5000},
            "renta-fija",
            timeout=30,
        )
        rows = data if isinstance(data, list) else data.get("data") or []
        out = []
        for r in rows:
            # Último precio robusto a mercado cerrado: prioriza el de hoy, y si
            # no operó cae al cierre/ajuste anterior o al VWAP.
            price = (r.get("settlementPrice") or r.get("closingPrice")
                     or r.get("previousClosingPrice") or r.get("previousSettlementPrice")
                     or r.get("vwap") or 0)
            bid, offer = r.get("bidPrice") or 0, r.get("offerPrice") or 0
            vol = r.get("tradeVolume") or 0
            coupon_rate = _extract_coupon_rate(r)
            frequency = _extract_frequency(r)
            out.append({
                "symbol": (r.get("symbol") or "").upper(),
                "description": r.get("securityDesc") or r.get("description") or "",
                "currency": r.get("denominationCcy") or "",
                "price": float(price or 0),
                "bid": float(bid or 0),
                "offer": float(offer or 0),
                "volume": float(vol or 0),
                "maturity": (r.get("maturityDate") or "")[:10],
                "days_to_maturity": r.get("daysToMaturity"),
                "coupon_rate": coupon_rate,
                "coupon_pct": round(coupon_rate * 100, 4) if coupon_rate is not None else None,
                "frequency": frequency,
                "has_market": bool(price or bid or offer or vol),
            })
        _merge_ons_last_prices(out)
        _merge_data912_prices(out)
        return set_json(cache_key, {"ok": bool(out), "source": "BYMADATA negociable-obligations", "rows": out})
    except Exception as e:
        stale = get_json_stale(cache_key)
        if stale and stale.get("rows"):
            return {**stale, "stale": True, "error": str(e)}
        return {"ok": False, "error": str(e), "rows": []}


def health():
    try:
        r = httpx.get(BASE_URL, timeout=10, verify=False)
        return {"ok": r.status_code < 500, "status_code": r.status_code, "url": BASE_URL}
    except Exception as e:
        return {"ok": False, "error": str(e), "url": BASE_URL}


def public_bonds(force: bool = False):
    """Bonos públicos BYMA (soberanos AL/GD/AE, BOPREAL, dólar-linked, BONCAPs).
    Incluye especies por moneda (base=ARS, D=USD, C=CABLE)."""
    cache_key = "bymadata_public_bonds"
    if not force:
        cached = get_json(cache_key, 5 * 60)
        if cached is not None:
            return cached
    try:
        data = _post_with_options(
            "/bymadata/free/public-bonds",
            {"excludeZeroPxAndQty": False, "T0": True, "page_number": 1, "page_size": 3000},
            "renta-fija", timeout=40,
        )
        rows = data if isinstance(data, list) else data.get("data") or []
        return set_json(cache_key, {"ok": bool(rows), "rows": rows, "source": "BYMADATA public-bonds"})
    except Exception as e:
        stale = get_json_stale(cache_key)
        if stale and stale.get("rows"):
            return {**stale, "stale": True, "error": str(e)}
        return {"ok": False, "error": str(e), "rows": []}


def lebacs(force: bool = False):
    """Letras BYMA (LECAPs S.., LECER X.., etc.)."""
    cache_key = "bymadata_lebacs"
    if not force:
        cached = get_json(cache_key, 5 * 60)
        if cached is not None:
            return cached
    try:
        data = _post_with_options(
            "/bymadata/free/lebacs",
            {"excludeZeroPxAndQty": False, "T0": True, "page_number": 1, "page_size": 3000},
            "renta-fija", timeout=40,
        )
        rows = data if isinstance(data, list) else data.get("data") or []
        return set_json(cache_key, {"ok": bool(rows), "rows": rows, "source": "BYMADATA lebacs"})
    except Exception as e:
        stale = get_json_stale(cache_key)
        if stale and stale.get("rows"):
            return {**stale, "stale": True, "error": str(e)}
        return {"ok": False, "error": str(e), "rows": []}
