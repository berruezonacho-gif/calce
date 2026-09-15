# Colgar la demo online

La app ya está lista para deploy. Incluye configuración para **Railway** y
**Render** (los dos más simples y con plan gratuito). Elegí uno.

Antes de empezar, necesitás el código en un repo de GitHub (los dos servicios
deployан desde GitHub).

## Subir el código a GitHub (una vez)

```bash
cd tesoreria
git init
git add .
git commit -m "Tesorería PyME - demo"
# Creá un repo vacío en github.com y después:
git remote add origin https://github.com/TU_USUARIO/tesoreria-pyme.git
git branch -M main
git push -u origin main
```

El `.gitignore` ya excluye cache, logs y archivos temporales.

---

## Opción A — Railway (recomendada, la más rápida)

1. Entrá a **railway.app** y registrate con tu cuenta de GitHub.
2. Click en **New Project** → **Deploy from GitHub repo**.
3. Elegí el repo `tesoreria-pyme`.
4. Railway detecta el `railway.toml` y el `requirements.txt` automáticamente,
   instala las dependencias y levanta el server.
5. Cuando termine, andá a **Settings → Networking → Generate Domain**.
6. Te da una URL pública tipo `tesoreria-pyme.up.railway.app`. Listo.

Railway da $5 de crédito gratis por mes, suficiente para una demo.

---

## Opción B — Render

1. Entrá a **render.com** y registrate con GitHub.
2. Click en **New → Web Service** → conectá el repo.
3. Render detecta el `render.yaml`. Confirmá:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
4. Elegí el plan **Free**.
5. **Create Web Service**. En unos minutos te da una URL tipo
   `tesoreria-pyme.onrender.com`.

Nota: en el plan free de Render, la app "se duerme" tras 15 min de inactividad
y tarda ~30 segundos en despertar la primera vez. Para una demo está bien.

---

## Qué funciona en la demo

Sin configurar nada más, funcionan de una (son cálculos, no necesitan datos
externos):

- **Flujo de caja**: proyección, excedente, alertas.
- **Importar Excel/CSV**.
- **Simulador de inversión**: bonos, FCI, caución, plazo fijo (con la proyección).
- **Métricas de bonos**: TIR, duration, paridad.

Los **datos en vivo** (rendimientos reales de FCI desde CAFCI, precios de BYMA
para los tableros, tasas del BCRA) andan porque Railway y Render tienen salida a
internet. Si alguna fuente no responde, la app usa datos de referencia y sigue
funcionando.

---

## Lo que NO va en estos hostings (por ahora)

El scraper de dividendos de Comafi (Playwright) del proyecto Hormiga necesita un
navegador headless, que requiere configuración extra. La tesorería PyME **no usa
Playwright**, así que no es un problema para esta demo.

---

## Después de la demo: dominio propio

Cuando quieras un dominio tipo `tesoreria.com.ar`:
- En Railway/Render podés agregar un **custom domain** en Settings.
- Comprás el dominio (Namecheap, Google Domains, o .ar en nic.ar) y apuntás el
  DNS al servicio.

Para clientes reales con datos sensibles de PyMEs, conviene migrar a un **VPS**
(DigitalOcean, ~US$6/mes) con tu propio control de seguridad y base de datos.
