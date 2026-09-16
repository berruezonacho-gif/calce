# data/inflacion.py — Índice de inflación (IPC INDEC vía ArgentinaDatos)
# para ajustar comparativas a términos reales. El IPC se actualiza una vez al
# mes, así que se cachea con TTL largo. La serie confiable arranca en 2017.
import httpx
from .cache import get_json, get_json_stale, set_json

_API = "https://api.argentinadatos.com/v1/finanzas/indices/inflacion"
_CACHE_KEY = "inflacion_mensual"
_TTL = 24 * 3600  # un día (el dato cambia una vez al mes)


def _fetch():
    """Trae la serie de variación mensual del IPC (lista de {fecha, valor})."""
    r = httpx.get(_API, timeout=20)
    r.raise_for_status()
    data = r.json()
    # ArgentinaDatos devuelve [{"fecha":"2017-01-01","valor":1.3}, ...]
    serie = []
    for it in data:
        f = it.get("fecha"); v = it.get("valor")
        if f and v is not None:
            serie.append({"fecha": f[:7], "valor": float(v)})  # YYYY-MM
    serie.sort(key=lambda x: x["fecha"])
    return serie


def serie_mensual(force: bool = False):
    """Serie de inflación mensual cacheada. Devuelve {ok, serie, source}."""
    if not force:
        cached = get_json(_CACHE_KEY, _TTL)
        if cached is not None:
            return {"ok": True, "serie": cached, "source": "cache"}
    try:
        serie = _fetch()
        set_json(_CACHE_KEY, serie)
        return {"ok": True, "serie": serie, "source": "ArgentinaDatos/INDEC"}
    except Exception as e:
        stale = get_json_stale(_CACHE_KEY)
        if stale is not None:
            return {"ok": True, "serie": stale, "source": "cache-stale"}
        return {"ok": False, "error": str(e), "serie": []}


def factor_ajuste(desde_mes: str, hasta_mes: str, force: bool = False):
    """Factor para ajustar un valor de `desde_mes` a pesos de `hasta_mes`.
    valor_ajustado = valor_historico * factor. Encadena las variaciones
    mensuales entre ambos meses (YYYY-MM). Factor 1.0 si no hay datos."""
    res = serie_mensual(force=force)
    if not res.get("ok") or not res.get("serie"):
        return {"ok": False, "factor": 1.0, "error": res.get("error", "sin datos")}
    serie = res["serie"]
    # Acumular las variaciones de los meses POSTERIORES a desde_mes hasta hasta_mes
    factor = 1.0
    for it in serie:
        if it["fecha"] > desde_mes and it["fecha"] <= hasta_mes:
            factor *= (1 + it["valor"] / 100.0)
    return {"ok": True, "factor": factor, "source": res.get("source")}
