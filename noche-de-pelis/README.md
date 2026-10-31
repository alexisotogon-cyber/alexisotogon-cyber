# Noche de Pelis

Eliges tus plataformas una vez, exploras filas de terror y suspenso que sí puedes ver, agregas pelis a "Mi noche", fijas con candado las imperdibles y la app sortea el resto según tu horario.

Flujo: plataformas, luego inicio con filas, luego Mi noche (candados y horario), luego Tu función (capítulos, compartir y volver a sortear).

Los datos vienen de TMDB; las plataformas por país, de JustWatch a través de TMDB. El token de TMDB vive en el servidor y nunca llega al navegador.

```
noche-de-pelis/
├── html/                         # la página (index.html, css, js, img)
│   └── img/foto-1.jpg, foto-2.jpg   # tus dos fotos del crédito "presentan" (tú las pones)
├── functions/api/[[path]].js     # proxy a TMDB para Cloudflare Pages
├── nginx/templates/…             # proxy a TMDB para Docker en el Mac mini
└── docker-compose.yml, .env.example
```

## Token de TMDB

themoviedb.org > Ajustes > API > **API Read Access Token** (el largo que empieza con `eyJ`).

## Opción A: Cloudflare Pages (recomendada)

Las Functions no corren si subes la carpeta arrastrándola en el dashboard. Usa una de estas dos rutas:

**Con Git:** Workers & Pages > Create > Pages > Connect to Git, y elige este repo y la rama.
- Root directory: `noche-de-pelis`
- Build command: vacío
- Build output directory: `html`

Luego, en Settings > Variables and Secrets, agrega `TMDB_TOKEN` como secreto y vuelve a desplegar.

**Con Wrangler, desde tu compu:**

```bash
cd noche-de-pelis
```

```bash
npx wrangler pages deploy html --project-name noche-de-pelis
```

```bash
npx wrangler pages secret put TMDB_TOKEN --project-name noche-de-pelis
```

Después agrega tu dominio en Custom domains.

## Opción B: Docker en el Mac mini con el tunnel

```bash
cd ~/docker/noche-de-pelis && cp .env.example .env && nano .env
```

```bash
docker compose up -d
```

Ruta en el tunnel: servicio `http://noche-de-pelis:80`.

## Notas

- Solo pasan cuatro rutas de lectura a TMDB: `search/movie`, `discover/movie`, `movie/<id>` y `watch/providers/movie`. Las respuestas se guardan 6 h en caché.
- Si faltan las fotos de `html/img/`, el crédito "presentan" se oculta solo.
- Fuentes: Bebas Neue y Poppins (Google Fonts). Netflix Sans es propietaria y no se usa.
- TMDB pide mostrar el aviso de atribución que está en el pie de página.
