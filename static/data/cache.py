import json
import time
from pathlib import Path


CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "ar"
# Semilla que viaja con el código (read-only): último snapshot bueno guardado
# en el repo. Sirve de fallback final cuando el cache efímero está vacío (p. ej.
# tras un reinicio en Render) y BYMA no responde o el mercado está cerrado.
SEED_DIR = Path(__file__).resolve().parent.parent / "seed" / "ar"


def get_json(name: str, ttl: int):
    path = CACHE_DIR / f"{name}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    if time.time() - payload.get("fetched_at", 0) > ttl:
        return None
    return payload.get("data")


def get_json_stale(name: str):
    """Último dato guardado, sin importar el TTL. Busca primero en el cache
    efímero y, si no está, en la semilla del repo."""
    for base in (CACHE_DIR, SEED_DIR):
        path = base / f"{name}.json"
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        data = payload.get("data")
        if data is not None:
            return data
    return None


def find_json_stale(prefix: str):
    best = None
    best_count = -1
    for base in (CACHE_DIR, SEED_DIR):
        if not base.exists():
            continue
        for path in base.glob(f"{prefix}*.json"):
            try:
                payload = json.loads(path.read_text())
            except json.JSONDecodeError:
                continue
            data = payload.get("data")
            count = len(data) if isinstance(data, list) else 0
            if count > best_count:
                best = data
                best_count = count
    return best


def set_json(name: str, data):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        return data
    path = CACHE_DIR / f"{name}.json"
    try:
        path.write_text(json.dumps({"fetched_at": time.time(), "data": data}, ensure_ascii=False))
    except OSError:
        # En entornos read-only devolvemos igual el dato fresco; el servidor
        # real sí puede persistir cache.
        pass
    return data
