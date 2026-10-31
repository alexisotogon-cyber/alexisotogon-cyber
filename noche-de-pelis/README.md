# Noche de Pelis

Buscas tus películas por nombre (con póster y sinopsis), marcas tus plataformas y tu horario, y la app sortea cuáles caben en la noche.

Los datos vienen de TMDB: póster, duración, sinopsis y plataformas por país (TMDB las toma de JustWatch). nginx sirve la página y hace de proxy hacia TMDB, así el token nunca llega al navegador. No hay backend aparte.

## Estructura

```
noche-de-pelis/
├── docker-compose.yml
├── .env.example                      # TMDB_TOKEN=
├── nginx/templates/default.conf.template
└── html/
    ├── index.html  favicon.svg
    ├── css/app.css
    ├── js/app.js
    └── img/foto-1.jpg  img/foto-2.jpg   # las dos fotos del banner (tú las pones)
```

## Montarlo en el Mac mini

1. Saca tu token en themoviedb.org: Ajustes > API > **API Read Access Token** (el largo que empieza con `eyJ`).
2. Copia la carpeta a `~/docker/noche-de-pelis/`.
3. Pon tus dos fotos como `html/img/foto-1.jpg` (izquierda) y `html/img/foto-2.jpg` (derecha). Recomendado: vertical 3:4, al menos 600×800 px. Si falta alguna, el banner se acomoda solo.
4. Crea el `.env`:

```bash
cd ~/docker/noche-de-pelis && cp .env.example .env && nano .env
```

5. Levanta el contenedor:

```bash
docker compose up -d
```

6. Prueba que el proxy responda (debe regresar JSON con películas):

```bash
docker exec noche-de-pelis wget -qO- "http://localhost/api/search/movie?query=matrix&language=es-MX" | head -c 300
```

7. En Cloudflare: Zero Trust > Networks > Tunnels > tu tunnel > Rutas > Agregar ruta > Aplicación publicada.
   - Dominio: el que elijas, por ejemplo `pelis.tudominio.com`
   - Servicio: `http://noche-de-pelis:80`

## Notas

- Las respuestas de TMDB se guardan 6 h en caché dentro del contenedor para ahorrar llamadas y datos.
- El proxy solo deja pasar tres rutas de lectura (`search/movie`, `movie/<id>`, `watch/providers/movie`) y limita a 8 peticiones por segundo por IP.
- TMDB pide mostrar el aviso de atribución que está en el pie de página.
