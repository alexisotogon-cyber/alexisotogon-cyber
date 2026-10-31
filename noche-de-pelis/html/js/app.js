(() => {
  "use strict";
  const MAX = 20, MIN = 2, TOP_PLATS = 16;
  const IMG = "https://image.tmdb.org/t/p/";
  const APPEND = "watch/providers,credits,videos,recommendations";
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = { movies: [], region: "MX", provs: new Set(), paid: false };
  const details = new Map();
  let providerList = [], showAllPlats = false;

  // ---------- utilidades ----------
  const lang = () => (state.region === "ES" ? "es-ES" : "es-MX");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safePath = p => (typeof p === "string" && /^\/[\w.-]+$/.test(p) ? p : null);
  const img = (p, size) => (safePath(p) ? IMG + size + p : null);
  const year = d => (d || "").slice(0, 4);
  const toMin = v => { const [h, m] = (v || "00:00").split(":").map(Number); return h * 60 + m; };
  const fmt = min => { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); };
  const dur = min => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + " h" : "") + (h && m ? " " : "") + (m || !h ? m + " min" : ""); };
  const windowMin = () => { const s = toMin($("start").value); let e = toMin($("end").value); if (e <= s) e += 1440; return e - s; };
  const pad2 = n => String(n).padStart(2, "0");
  const posterTag = (path, size, alt) => {
    const u = img(path, size);
    return u ? `<img src="${u}" alt="${esc(alt)}" loading="lazy" width="185" height="278">` : `<div class="noimg">${esc(alt)}</div>`;
  };

  async function api(path, params) {
    const r = await fetch("/api/" + path + "?" + new URLSearchParams(params), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status === 401 ? "token" : r.status === 429 || r.status === 503 ? "limite" : "http" + r.status);
    return r.json();
  }
  const apiError = e => e.message === "token" ? "El servidor no tiene un token válido de TMDB."
    : e.message === "limite" ? "Demasiadas búsquedas seguidas. Espera unos segundos."
    : "No pudimos conectar con TMDB. Revisa tu conexión y vuelve a intentar.";

  function save() {
    try {
      localStorage.setItem("ndp3", JSON.stringify({ movies: state.movies, region: state.region, provs: [...state.provs], paid: state.paid, start: $("start").value, end: $("end").value, brk: $("breakMin").value }));
    } catch (e) { /* sin almacenamiento */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("ndp3") || "null");
      if (!s) return;
      state.movies = Array.isArray(s.movies) ? s.movies.slice(0, MAX) : [];
      state.region = s.region || "MX"; state.provs = new Set(s.provs || []); state.paid = !!s.paid;
      if (s.start) $("start").value = s.start;
      if (s.end) $("end").value = s.end;
      if (s.brk) $("breakMin").value = s.brk;
    } catch (e) { /* ignorar */ }
  }
  const setStatus = (msg, err) => { $("status").textContent = msg; $("status").classList.toggle("err", !!err); };

  // ---------- detalle (una sola llamada con todo) ----------
  function getDetail(id) {
    if (details.has(id)) return Promise.resolve(details.get(id));
    const p = api("movie/" + id, { language: lang(), append_to_response: APPEND, include_video_language: "es,en,null" })
      .then(d => { details.set(id, d); return d; })
      .catch(e => { details.delete(id); throw e; });
    details.set(id, p);
    return p;
  }
  const detailNow = id => { const d = details.get(id); return d && !(d instanceof Promise) ? d : null; };
  const regionProviders = d => (d && d["watch/providers"] && d["watch/providers"].results && d["watch/providers"].results[state.region]) || null;
  const inList = id => state.movies.some(m => m.id === id);

  function addMovie(m) {
    if (inList(m.id)) return "ya";
    if (state.movies.length >= MAX) return "max";
    state.movies.push({ id: m.id, title: m.title, year: year(m.release_date), poster: safePath(m.poster_path), backdrop: safePath(m.backdrop_path) });
    renderList(); save(); refreshHero();
    getDetail(m.id).then(renderList).catch(() => {});
    return "ok";
  }
  function removeMovie(id) {
    state.movies = state.movies.filter(m => m.id !== id);
    renderList(); save(); refreshHero();
  }

  // ---------- portada: fondos de tus pelis ----------
  let heroTimer, heroIdx = 0;
  function refreshHero() {
    const bg = $("heroBg");
    const withBg = state.movies.filter(m => m.backdrop);
    clearInterval(heroTimer);
    bg.innerHTML = withBg.map(m => `<div class="layer" style="background-image:url('${img(m.backdrop, "w1280")}')"></div>`).join("");
    const ns = $("nowShowing");
    if (!withBg.length) { ns.hidden = true; return; }
    const layers = bg.querySelectorAll(".layer");
    const show = i => {
      layers.forEach((l, j) => l.classList.toggle("on", j === i));
      ns.hidden = false; ns.innerHTML = `En tu cartelera · <b>${esc(withBg[i].title)}</b>`;
    };
    heroIdx = Math.floor(Math.random() * withBg.length); show(heroIdx);
    if (withBg.length > 1 && !reduceMotion) heroTimer = setInterval(() => { heroIdx = (heroIdx + 1) % withBg.length; show(heroIdx); }, 7000);
  }

  // ---------- búsqueda ----------
  const q = $("q"), results = $("results");
  let searchTimer, searchCtl, hits = [], active = -1;
  const closeResults = () => { results.hidden = true; q.setAttribute("aria-expanded", "false"); active = -1; };
  const showResults = html => { results.innerHTML = html; results.hidden = false; q.setAttribute("aria-expanded", "true"); };

  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const term = q.value.trim();
    if (term.length < 2) { closeResults(); return; }
    searchTimer = setTimeout(() => search(term), 300);
  });
  async function search(term) {
    searchCtl?.abort(); searchCtl = new AbortController();
    showResults('<li class="msg">Buscando en la cartelera…</li>');
    try {
      const r = await fetch("/api/search/movie?" + new URLSearchParams({ query: term, language: lang(), include_adult: "false", page: "1" }), { signal: searchCtl.signal });
      if (!r.ok) throw new Error(r.status === 401 ? "token" : "http");
      hits = ((await r.json()).results || []).slice(0, 8); active = -1;
      if (!hits.length) { showResults(`<li class="msg">No encontramos “${esc(term)}”. Prueba con otro nombre o en inglés.</li>`); return; }
      paintHits();
    } catch (e) {
      if (e.name !== "AbortError") showResults(`<li class="msg">${esc(apiError(e))}</li>`);
    }
  }
  function paintHits() {
    showResults(hits.map((m, i) => {
      const t = img(m.poster_path, "w92");
      return `<li role="option" id="opt${i}" data-i="${i}" aria-selected="${i === active}">
        ${t ? `<img class="thumb" src="${t}" alt="" loading="lazy" width="52" height="78">` : '<div class="thumb"></div>'}
        <div><div class="t">${esc(m.title)} <small>${esc(year(m.release_date)) || "s/f"}${m.vote_average ? " · ★ " + m.vote_average.toFixed(1) : ""}</small></div>
        <div class="ov">${esc(m.overview || "Sin sinopsis en español.")}</div></div>
        <span class="open ${inList(m.id) ? "added" : ""}">${inList(m.id) ? "En tu lista" : "Abrir ficha"}</span></li>`;
    }).join(""));
    q.setAttribute("aria-activedescendant", active >= 0 ? "opt" + active : "");
  }
  q.addEventListener("keydown", e => {
    if (results.hidden || !hits.length) return;
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); paintHits(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); paintHits(); e.preventDefault(); }
    else if (e.key === "Enter") { const m = hits[active >= 0 ? active : 0]; closeResults(); openFicha(m.id, m); e.preventDefault(); }
    else if (e.key === "Escape") closeResults();
  });
  results.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    e.preventDefault(); const m = hits[+li.dataset.i]; closeResults(); openFicha(m.id, m);
  });
  q.addEventListener("blur", () => setTimeout(closeResults, 120));
  q.addEventListener("focus", () => { if (hits.length && q.value.trim().length >= 2) paintHits(); });

  // ---------- lista de pósters ----------
  function renderList() {
    $("count").textContent = pad2(state.movies.length);
    q.disabled = state.movies.length >= MAX;
    q.placeholder = state.movies.length >= MAX ? "Llegaste al máximo de 20" : "Busca una película…";
    if (!state.movies.length) {
      $("list").innerHTML = '<div class="empty"><b>La sala está vacía.</b>Busca una película arriba y ábrela para agregarla a tu noche.</div>';
      return;
    }
    $("list").innerHTML = state.movies.map(m => {
      const d = detailNow(m.id), wp = regionProviders(d), seen = new Map();
      if (wp) ["flatrate", "free", "ads", "rent", "buy"].forEach(k => (wp[k] || []).forEach(p => { if (!seen.has(p.provider_id)) seen.set(p.provider_id, p); }));
      const logos = [...seen.values()].slice(0, 6).map(p => {
        const u = img(p.logo_path, "w45");
        return u ? `<img src="${u}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}" class="${state.provs.has(p.provider_id) ? "mine" : ""}" width="22" height="22" loading="lazy">` : "";
      }).join("");
      const sub = [m.year, d ? (d.runtime ? dur(d.runtime) : "duración s/d") : "…"].filter(Boolean).join(" · ");
      return `<article class="pc">
        <div class="art">${posterTag(m.poster, "w342", m.title)}<button class="open-btn" type="button" data-open="${m.id}" aria-label="Abrir ficha de ${esc(m.title)}"></button></div>
        <button class="x" type="button" data-rm="${m.id}" aria-label="Quitar ${esc(m.title)}">✕</button>
        <span class="nm">${esc(m.title)}</span><span class="sub">${esc(sub)}</span>
        ${d ? `<div class="logos">${logos || '<span class="sub">Sin streaming aquí</span>'}</div>` : ""}
      </article>`;
    }).join("");
  }
  $("list").addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]"); if (rm) { removeMovie(+rm.dataset.rm); return; }
    const op = e.target.closest("[data-open]"); if (op) openFicha(+op.dataset.open);
  });
  $("clearBtn").addEventListener("click", () => { state.movies = []; renderList(); save(); refreshHero(); });

  // ---------- FICHA INMERSIVA ----------
  const fx = $("fx");
  let fxId = null, lastFocus = null;

  async function openFicha(id, seed) {
    fxId = id; lastFocus = document.activeElement;
    fx.hidden = false; document.body.classList.add("locked");
    $("fxScroll").scrollTop = 0;
    const bdSeed = seed && img(seed.backdrop_path, "w1280");
    $("fxBg").style.backgroundImage = bdSeed ? `url("${bdSeed}")` : "none";
    $("fxIn").innerHTML = `<div class="fx-loading">${seed ? esc(seed.title) : "Apagando las luces…"}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => fx.classList.add("on")));
    $("fxClose").focus();
    try {
      const d = await getDetail(id);
      if (fxId !== id) return;
      renderFicha(d);
    } catch (e) {
      if (fxId === id) $("fxIn").innerHTML = `<div class="fx-loading">${esc(apiError(e))}</div>`;
    }
  }
  function closeFicha() {
    fx.classList.remove("on");
    const tr = fx.querySelector(".trailer"); if (tr) tr.innerHTML = "";
    fxId = null;
    setTimeout(() => { if (!fxId) { fx.hidden = true; document.body.classList.remove("locked"); } }, reduceMotion ? 0 : 350);
    lastFocus?.focus?.();
  }
  $("fxClose").addEventListener("click", closeFicha);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !fx.hidden) closeFicha(); });
  fx.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const f = [...fx.querySelectorAll("button, a[href], iframe, [tabindex]:not([tabindex='-1'])")].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
  });

  function renderFicha(d) {
    const bd = img(d.backdrop_path, "w1280");
    if (bd) $("fxBg").style.backgroundImage = `url("${bd}")`;
    const director = ((d.credits && d.credits.crew) || []).filter(c => c.job === "Director").map(c => c.name).slice(0, 2).join(" y ");
    const genres = (d.genres || []).slice(0, 3).map(g => g.name);
    const vids = (d.videos && d.videos.results) || [];
    const trailer = vids.find(v => v.site === "YouTube" && v.type === "Trailer" && v.iso_639_1 === "es")
      || vids.find(v => v.site === "YouTube" && v.type === "Trailer")
      || vids.find(v => v.site === "YouTube" && v.type === "Teaser");
    const wp = regionProviders(d);
    const provs = [];
    if (wp) [["flatrate", "Incluida"], ["free", "Gratis"], ["ads", "Con anuncios"], ["rent", "Renta"], ["buy", "Compra"]].forEach(([k, label]) =>
      (wp[k] || []).forEach(p => { if (!provs.some(x => x.provider_id === p.provider_id)) provs.push({ ...p, label }); }));
    const cast = ((d.credits && d.credits.cast) || []).slice(0, 12);
    const recs = ((d.recommendations && d.recommendations.results) || []).slice(0, 12);
    const country = $("country").selectedOptions[0].textContent;

    $("fxIn").innerHTML = `
      <div class="fx-hero">
        ${director ? `<p class="fx-by">Una película de ${esc(director)}</p>` : ""}
        <h2 class="fx-title" id="fxTitle">${esc(d.title)}</h2>
        ${d.tagline ? `<p class="fx-tag">“${esc(d.tagline)}”</p>` : ""}
        <p class="fx-meta">${[year(d.release_date), d.runtime ? dur(d.runtime) : "", ...genres].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join("")}${d.vote_average ? `<span class="star">★ ${d.vote_average.toFixed(1)}</span>` : ""}</p>
        ${d.overview ? `<p class="fx-ov">${esc(d.overview)}</p>` : ""}
        <div class="fx-actions">
          <button class="btn-add" type="button" id="fxAdd"></button>
          ${trailer ? `<button class="btn-play" type="button" id="fxPlay"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13l11-6.5z" fill="currentColor"/></svg>Ver tráiler</button>` : ""}
        </div>
        <p class="fx-msg" id="fxMsg" role="status"></p>
      </div>
      ${trailer ? `<section class="fx-sec" id="fxTrailerSec" hidden><h3>Tráiler <span>${esc(trailer.name || "")}</span></h3><div class="trailer" id="fxTrailer"></div></section>` : ""}
      <section class="fx-sec"><h3>Dónde verla <span>en ${esc(country)}</span></h3>
        ${provs.length ? `<div class="wtw">${provs.map(p => {
          const u = img(p.logo_path, "w92"), mine = state.provs.has(p.provider_id);
          return `<span class="p ${mine ? "mine" : ""}">${u ? `<img src="${u}" alt="" width="34" height="34">` : ""}<span>${esc(p.provider_name)}<small>${esc(p.label)}${mine ? " · la tienes" : ""}</small></span></span>`;
        }).join("")}</div>${wp && wp.link ? `<p class="fx-msg"><a href="${esc(wp.link)}" target="_blank" rel="noopener">Ver todas las opciones</a></p>` : ""}`
        : '<p class="fx-msg">No aparece en streaming en este país.</p>'}
      </section>
      ${cast.length ? `<section class="fx-sec"><h3>Reparto</h3><div class="rail">${cast.map(c =>
        `<div class="cast">${img(c.profile_path, "w185") ? `<img src="${img(c.profile_path, "w185")}" alt="" loading="lazy" width="132" height="198">` : `<div class="noimg">${esc(c.name)}</div>`}<b>${esc(c.name)}</b><span>${esc(c.character || "")}</span></div>`).join("")}</div></section>` : ""}
      ${recs.length ? `<section class="fx-sec"><h3>Más como esta</h3><div class="rail">${recs.map((r, i) =>
        `<button class="rec" type="button" data-rec="${i}">${posterTag(r.poster_path, "w185", r.title)}<b>${esc(r.title)}</b></button>`).join("")}</div></section>` : ""}`;

    paintAdd(d);
    $("fxAdd").addEventListener("click", () => {
      if (inList(d.id)) { removeMovie(d.id); $("fxMsg").textContent = "La quitaste de tu noche."; }
      else {
        const r = addMovie(d);
        $("fxMsg").textContent = r === "ok" ? `Lista. Llevas ${state.movies.length} de 20.` : r === "max" ? "Ya tienes 20 películas, el máximo." : "";
      }
      paintAdd(d);
    });
    if (trailer) $("fxPlay").addEventListener("click", () => {
      $("fxTrailerSec").hidden = false;
      $("fxTrailer").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0" title="Tráiler de ${esc(d.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      $("fxTrailerSec").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
    $("fxIn").querySelectorAll("[data-rec]").forEach(b => b.addEventListener("click", () => {
      const r = recs[+b.dataset.rec];
      fx.classList.remove("on");
      setTimeout(() => openFicha(r.id, r), reduceMotion ? 0 : 250);
    }));
  }
  function paintAdd(d) {
    const b = $("fxAdd"); if (!b) return;
    const isIn = inList(d.id);
    b.classList.toggle("in", isIn);
    b.textContent = isIn ? "✓ En tu noche · Quitar" : "Agregar a mi noche";
    b.disabled = !isIn && state.movies.length >= MAX;
  }

  // ---------- plataformas ----------
  async function loadProviders() {
    $("platChips").innerHTML = '<span class="loading">Cargando plataformas…</span>';
    $("morePlats").hidden = true;
    try {
      const data = await api("watch/providers/movie", { watch_region: state.region, language: lang() });
      const r = state.region, prio = p => (p.display_priorities && p.display_priorities[r]) ?? p.display_priority ?? 999;
      providerList = (data.results || []).sort((a, b) => prio(a) - prio(b));
      renderChips();
    } catch (e) { $("platChips").innerHTML = `<span class="loading">${esc(apiError(e))}</span>`; }
  }
  function renderChips() {
    const list = showAllPlats ? providerList : providerList.filter((p, i) => i < TOP_PLATS || state.provs.has(p.provider_id));
    $("platChips").innerHTML = list.map(p => {
      const u = img(p.logo_path, "w92");
      return `<button type="button" class="chip" aria-pressed="${state.provs.has(p.provider_id)}" data-id="${p.provider_id}">${u ? `<img src="${u}" alt="" width="26" height="26" loading="lazy">` : ""}${esc(p.provider_name)}</button>`;
    }).join("");
    $("morePlats").hidden = providerList.length <= TOP_PLATS;
    $("morePlats").textContent = showAllPlats ? "Ver menos" : `Ver todas (${providerList.length})`;
  }
  $("platChips").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const id = +b.dataset.id;
    state.provs.has(id) ? state.provs.delete(id) : state.provs.add(id);
    b.setAttribute("aria-pressed", String(state.provs.has(id)));
    renderList(); save();
  });
  $("morePlats").addEventListener("click", () => { showAllPlats = !showAllPlats; renderChips(); });
  $("country").addEventListener("change", () => { state.region = $("country").value; state.provs.clear(); showAllPlats = false; loadProviders(); renderList(); save(); });

  const renderPaid = () => { $("freeBtn").setAttribute("aria-pressed", String(!state.paid)); $("paidBtn").setAttribute("aria-pressed", String(state.paid)); };
  $("freeBtn").addEventListener("click", () => { state.paid = false; renderPaid(); save(); });
  $("paidBtn").addEventListener("click", () => { state.paid = true; renderPaid(); save(); });

  function renderWindow() {
    const crosses = toMin($("end").value) <= toMin($("start").value);
    $("windowTxt").innerHTML = `Tienes <b>${dur(windowMin())}</b> de función${crosses ? ", terminando al día siguiente" : ""}.`;
  }
  ["start", "end", "breakMin"].forEach(id => $(id).addEventListener("change", () => { renderWindow(); save(); }));

  // ---------- sorteo ----------
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function eligibility(d) {
    const wp = regionProviders(d);
    if (!wp) return { ok: false, why: "No está en streaming en este país." };
    const mine = (list, tipo) => (list || []).filter(p => state.provs.has(p.provider_id)).map(p => ({ ...p, tipo }));
    const uniq = arr => { const s = new Set(); return arr.filter(p => !s.has(p.provider_id) && s.add(p.provider_id)); };
    const inc = uniq([...mine(wp.flatrate, "incluida"), ...mine(wp.free, "gratis"), ...mine(wp.ads, "con anuncios")]);
    const pay = uniq([...mine(wp.rent, "renta"), ...mine(wp.buy, "compra")]);
    if (inc.length) return { ok: true, via: inc };
    if (state.paid && pay.length) return { ok: true, via: pay };
    if (pay.length) return { ok: false, why: "En tus plataformas solo está en renta o compra." };
    const names = [...new Set(["flatrate", "free", "ads", "rent", "buy"].flatMap(k => (wp[k] || []).map(p => p.provider_name)))];
    return { ok: false, why: names.length ? "Está en " + names.slice(0, 3).join(", ") + ", que no marcaste." : "No está en streaming en este país." };
  }

  let lastDetails = null;
  function draw() {
    const brk = +$("breakMin").value, total = windowMin(), pool = [], out = [];
    lastDetails.forEach(({ movie, d }) => {
      if (!d) { out.push({ movie, why: "No pudimos traer sus datos." }); return; }
      const el = eligibility(d);
      el.ok ? pool.push({ movie, d, via: el.via }) : out.push({ movie, why: el.why });
    });
    let t = 0; const picked = [];
    for (const item of shuffle(pool)) {
      const len = item.d.runtime > 0 ? item.d.runtime : 120;
      const need = (picked.length ? brk : 0) + len;
      if (t + need <= total) { t += need; picked.push({ ...item, len, estimated: !(item.d.runtime > 0) }); }
      else out.push({ movie: item.movie, why: `Disponible, pero esta vez no alcanzó el tiempo (${dur(len)}).` });
    }
    renderProgram(picked, out, total, brk);
  }

  function renderProgram(picked, out, total, brk) {
    const start = toMin($("start").value);
    let t = start, used = 0;
    const chapters = picked.map((p, i) => {
      if (i) { t += brk; used += brk; }
      const s = t; t += p.len; used += p.len;
      const bd = img(p.d.backdrop_path, "w780") || img(p.movie.poster, "w780");
      const via = p.via.map(v => `<span class="via">${img(v.logo_path, "w45") ? `<img src="${img(v.logo_path, "w45")}" alt="" width="22" height="22">` : ""}${esc(v.provider_name)} <span class="pill ${v.tipo === "renta" || v.tipo === "compra" ? "pay" : "inc"}">${esc(v.tipo)}</span></span>`).join("");
      const inter = i < picked.length - 1 ? `<div class="intermission"><span>${brk ? `Intermedio · ${brk} min` : "Sin pausa"}</span></div>` : "";
      return `<article class="chapter ${i % 2 ? "rev" : ""}" style="animation-delay:${i * 120}ms">
        <div class="ch-text">
          <div class="ch-no"><span>Función</span><b>${pad2(i + 1)}</b></div>
          <h3>${esc(p.d.title || p.movie.title)}${p.movie.year ? `<small>${esc(p.movie.year)}</small>` : ""}</h3>
          <div class="slot-times">${fmt(s)} <i>→</i> ${fmt(t)}</div>
          ${p.d.overview ? `<p class="ov">${esc(p.d.overview)}</p>` : ""}
          <div class="where"><span>${dur(p.len)}${p.estimated ? " (estimado)" : ""}</span>${via}</div>
          <div class="ch-actions"><button class="btn-line" type="button" data-open="${p.movie.id}">Ver ficha</button></div>
        </div>
        <div class="ch-art">${bd ? `<img src="${bd}" alt="" loading="lazy" width="780" height="439">` : `<div class="noimg">${esc(p.movie.title)}</div>`}
          ${p.d.tagline ? `<span class="tt">“${esc(p.d.tagline)}”</span>` : ""}
          <button type="button" data-open="${p.movie.id}" aria-label="Abrir ficha de ${esc(p.movie.title)}"></button></div>
      </article>${inter}`;
    }).join("");
    const outHtml = out.length ? `<details class="out"><summary>${out.length} ${out.length === 1 ? "peli se quedó" : "pelis se quedaron"} fuera esta vez</summary><ul class="outlist">${
      out.map(o => `<li><b>${esc(o.movie.title)}</b> · ${esc(o.why)}</li>`).join("")}</ul></details>` : "";

    $("acto-3").hidden = false;
    if (!picked.length) {
      $("result").innerHTML = `<div class="nothing"><b>Esta noche no hay función.</b>Ninguna peli cumple con tus plataformas y tu horario. Marca más plataformas, permite renta o alarga la función.</div>${outHtml}`;
      return;
    }
    $("result").innerHTML = `
      <div class="bill">
        <div><b>${pad2(picked.length)}</b><span>${picked.length === 1 ? "película" : "películas"}</span></div>
        <div><b>${fmt(start)}</b><span>Arranca</span></div>
        <div><b>${fmt(start + used)}</b><span>Termina · sobran ${dur(total - used)}</span></div>
      </div>
      ${chapters}
      ${outHtml}
      <div class="again"><button class="btn-amber" type="button" id="redrawBtn">Volver a sortear</button></div>`;
    $("redrawBtn").addEventListener("click", () => { draw(); setStatus("Nuevo sorteo con las mismas pelis."); $("acto-3").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); });
  }
  $("result").addEventListener("click", e => { const op = e.target.closest("[data-open]"); if (op) openFicha(+op.dataset.open); });

  function countdown() {
    if (reduceMotion) return Promise.resolve();
    const L = $("leader"), n = $("leaderNo");
    L.hidden = false;
    return new Promise(res => {
      let k = 3; n.textContent = k;
      const iv = setInterval(() => { k--; if (k === 0) { clearInterval(iv); L.hidden = true; res(); } else n.textContent = k; }, 600);
    });
  }

  let busy = false;
  $("goBtn").addEventListener("click", async () => {
    if (busy) return;
    if (state.movies.length < MIN) { setStatus("Agrega al menos 2 películas.", true); return; }
    if (!state.provs.size) { setStatus("Marca al menos una plataforma.", true); return; }
    busy = true; $("goBtn").disabled = true; $("goBtn").textContent = "Apagando las luces…"; setStatus("");
    const [res] = await Promise.all([Promise.allSettled(state.movies.map(m => getDetail(m.id))), countdown()]);
    lastDetails = state.movies.map((movie, i) => ({ movie, d: res[i].status === "fulfilled" ? res[i].value : null }));
    const failed = res.filter(r => r.status === "rejected");
    if (failed.length === res.length) setStatus(apiError(failed[0].reason), true);
    else {
      draw();
      setStatus(failed.length ? `${failed.length} no se pudieron revisar.` : "");
      $("acto-3").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    }
    renderList();
    busy = false; $("goBtn").disabled = false; $("goBtn").textContent = "Que empiece la función";
  });

  // ---------- inicio ----------
  document.querySelectorAll(".credit-photo img").forEach(im => {
    const hide = () => {
      im.closest(".credit-photo").classList.add("missing");
      if (!document.querySelector(".credit-photo:not(.missing)")) $("credits").hidden = true;
    };
    if (im.complete && im.naturalWidth === 0) hide(); else im.addEventListener("error", hide);
  });
  load();
  $("country").value = state.region;
  renderList(); renderPaid(); renderWindow(); loadProviders(); refreshHero();
  state.movies.forEach(m => getDetail(m.id).then(renderList).catch(() => {}));
})();
