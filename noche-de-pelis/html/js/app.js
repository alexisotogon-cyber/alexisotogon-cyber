(() => {
  "use strict";
  const MAX = 20, MIN = 2, TOP_PLATS = 24;
  const IMG = "https://image.tmdb.org/t/p/";
  const APPEND = "watch/providers,credits,videos,recommendations";
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- estado ----------
  const state = { movies: [], region: "MX", provs: new Set(), provMeta: {}, paid: false };
  const details = new Map();   // id -> detalle TMDB (o promesa)
  const seen = new Map();      // id -> resultado de lista (filas, búsqueda, recomendaciones)
  const hints = new Map();     // id -> {cls, text} disponibilidad conocida por la fila de donde vino
  let providerList = [], lastDetails = null;

  // ---------- utilidades ----------
  const lang = () => (state.region === "ES" ? "es-ES" : "es-MX");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safePath = p => (typeof p === "string" && /^\/[\w.-]+$/.test(p) ? p : null);
  const img = (p, size) => (safePath(p) ? IMG + size + p : null);
  const year = d => (d || "").slice(0, 4);
  const pad2 = n => String(n).padStart(2, "0");
  const toMin = v => { const [h, m] = (v || "00:00").split(":").map(Number); return h * 60 + m; };
  const fmt = min => { min = ((min % 1440) + 1440) % 1440; return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); };
  const dur = min => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + " h" : "") + (h && m ? " " : "") + (m || !h ? m + " min" : ""); };
  const windowMin = () => { const s = toMin($("start").value); let e = toMin($("end").value); if (e <= s) e += 1440; return e - s; };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const lockSvg = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const playSvg = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 1.5v13l11-6.5z" fill="currentColor"/></svg>';

  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function api(path, params) {
    const r = await fetch("/api/" + path + "?" + new URLSearchParams(params), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status === 401 ? "token" : r.status === 429 || r.status === 503 ? "limite" : "http" + r.status);
    return r.json();
  }
  const apiError = e => e && e.message === "token" ? "El servidor no tiene un token válido de TMDB."
    : e && e.message === "limite" ? "Demasiadas búsquedas seguidas. Espera unos segundos."
    : "No pudimos conectar con TMDB. Revisa tu conexión y vuelve a intentar.";

  function save() {
    try {
      localStorage.setItem("ndp4", JSON.stringify({ movies: state.movies, region: state.region, provs: [...state.provs], provMeta: state.provMeta, paid: state.paid,
        start: $("start").value, end: $("end").value, brk: $("breakMin").value }));
    } catch (e) { /* sin almacenamiento */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("ndp4") || "null");
      if (!s) return;
      state.movies = Array.isArray(s.movies) ? s.movies.slice(0, MAX) : [];
      state.region = s.region || "MX"; state.provs = new Set(s.provs || []); state.provMeta = s.provMeta || {}; state.paid = !!s.paid;
      if (s.start) $("start").value = s.start;
      if (s.end) $("end").value = s.end;
      if (s.brk) $("breakMin").value = s.brk;
    } catch (e) { /* ignorar */ }
  }

  // ---------- capas (ficha, panel, función, plataformas) ----------
  const open = new Set();
  function showLayer(el) { el.hidden = false; open.add(el); document.body.classList.add("locked"); }
  function hideLayer(el) { el.hidden = true; open.delete(el); if (!open.size) document.body.classList.remove("locked"); }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("fx").hidden) closeFicha();
    else if (!$("panel").hidden) hideLayer($("panel"));
    else if (!$("show").hidden) hideLayer($("show"));
    else if (!$("onboard").hidden && state.provs.size) hideLayer($("onboard"));
  });
  document.addEventListener("click", e => {
    const c = e.target.closest("[data-close]"); if (c) { hideLayer($(c.dataset.close)); return; }
    const a = e.target.closest("[data-add]"); if (a) { toggleMovie(+a.dataset.add); return; }
    const o = e.target.closest("[data-open]"); if (o) { openFicha(+o.dataset.open); }
  });

  // ---------- detalle y disponibilidad ----------
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

  function eligibility(d) {
    const wp = regionProviders(d);
    if (!wp) return { ok: false, kind: "no", why: "No está en streaming en este país." };
    const mine = (list, tipo) => (list || []).filter(p => state.provs.has(p.provider_id)).map(p => ({ ...p, tipo }));
    const uniq = arr => { const s = new Set(); return arr.filter(p => !s.has(p.provider_id) && s.add(p.provider_id)); };
    const inc = uniq([...mine(wp.flatrate, "incluida"), ...mine(wp.free, "gratis"), ...mine(wp.ads, "con anuncios")]);
    const pay = uniq([...mine(wp.rent, "renta"), ...mine(wp.buy, "compra")]);
    if (inc.length) return { ok: true, kind: "inc", via: inc, link: wp.link };
    if (pay.length) return state.paid ? { ok: true, kind: "pay", via: pay, link: wp.link } : { ok: false, kind: "pay", via: pay, why: "En tus plataformas solo está en renta o compra." };
    const names = [...new Set(["flatrate", "free", "ads", "rent", "buy"].flatMap(k => (wp[k] || []).map(p => p.provider_name)))];
    return { ok: false, kind: "no", why: names.length ? "Está en " + names.slice(0, 3).join(", ") + ", que no tienes." : "No está en streaming en este país." };
  }
  function badgeFor(id) {
    const d = detailNow(id);
    if (d) {
      const el = eligibility(d);
      if (el.kind === "inc") return { cls: "inc", text: "En tu " + el.via[0].provider_name };
      if (el.kind === "pay") return { cls: "pay", text: "Renta en " + el.via[0].provider_name };
      return { cls: "no", text: "No está en tus plataformas" };
    }
    return hints.get(id) || null;
  }
  function paintBadges(id) {
    const b = badgeFor(id);
    document.querySelectorAll(`[data-b="${id}"]`).forEach(el => {
      el.hidden = !b; if (b) { el.className = "badge " + b.cls; el.textContent = b.text; }
    });
  }

  // ---------- mi noche ----------
  const inList = id => state.movies.some(m => m.id === id);
  function toggleMovie(id) {
    if (inList(id)) { removeMovie(id); return; }
    const src = detailNow(id) || seen.get(id);
    if (!src) return;
    if (state.movies.length >= MAX) { toast("Ya tienes 20 películas, el máximo."); return; }
    state.movies.push({ id, title: src.title, year: year(src.release_date), poster: safePath(src.poster_path), backdrop: safePath(src.backdrop_path), locked: false });
    save(); refreshNight();
    toast(`Agregada a tu noche (${state.movies.length}/20)`);
    getDetail(id).then(() => { paintBadges(id); refreshNight(); }).catch(() => {});
  }
  function removeMovie(id) {
    state.movies = state.movies.filter(m => m.id !== id);
    save(); refreshNight();
  }
  function refreshNight() {
    document.querySelectorAll("[data-add]").forEach(b => {
      const isIn = inList(+b.dataset.add);
      if (b.classList.contains("add")) { b.classList.toggle("in", isIn); b.textContent = isIn ? "✓" : "+"; b.setAttribute("aria-label", isIn ? "Quitar de mi noche" : "Agregar a mi noche"); }
      else if (b.dataset.kind === "hero" || b.dataset.kind === "fx") { b.innerHTML = isIn ? "✓ En tu noche" : "+ Agregar a mi noche"; }
    });
    renderTray(); renderPanel();
  }

  function lenOf(m) { const d = detailNow(m.id); return d && d.runtime > 0 ? d.runtime : null; }
  function fitInfo() {
    const W = windowMin(), B = +$("breakMin").value;
    const rows = state.movies.map(m => { const d = detailNow(m.id); return { m, d, len: lenOf(m) || 120, known: !!(d && d.runtime > 0), el: d ? eligibility(d) : null }; });
    const elig = rows.filter(r => !r.el || r.el.ok);
    const locked = elig.filter(r => r.m.locked);
    const lockedUse = locked.reduce((s, r) => s + r.len, 0) + B * Math.max(0, locked.length - 1);
    const rest = elig.filter(r => !r.m.locked).map(r => r.len);
    const fill = arr => { let u = lockedUse, n = locked.length; for (const l of arr) { const need = (n ? B : 0) + l; if (u + need <= W) { u += need; n++; } } return n; };
    return { W, B, rows, elig, locked, lockedUse, over: lockedUse > W, min: fill(rest.slice().sort((a, b) => b - a)), max: fill(rest.slice().sort((a, b) => a - b)), loading: rows.some(r => !r.d) };
  }

  function renderTray() {
    const n = state.movies.length;
    $("tray").hidden = n === 0;
    if (!n) return;
    $("trayPosters").innerHTML = state.movies.slice(-5).map(m => img(m.poster, "w92") ? `<img src="${img(m.poster, "w92")}" alt="" width="36" height="54">` : '<span class="ph"></span>').join("");
    const f = fitInfo();
    const total = state.movies.reduce((s, m) => s + (lenOf(m) || 0), 0);
    const range = f.min === f.max ? f.max : `${f.min} a ${f.max}`;
    $("trayTxt").innerHTML = n < MIN
      ? `<b>${n} peli</b> <span>· agrega al menos 2 para armar la función</span>`
      : `<b>${n} pelis</b> <span>· ${total ? dur(total) : "…"} en total · ${f.loading ? "calculando…" : `caben aprox. ${range} en tu horario`}</span>`;
  }

  function renderPanel() {
    const list = $("nightList");
    if (!state.movies.length) {
      list.innerHTML = '<li class="empty">Tu noche está vacía. Toca el “+” en cualquier peli para agregarla.</li>';
    } else {
      list.innerHTML = state.movies.map(m => {
        const d = detailNow(m.id), el = d ? eligibility(d) : null, b = badgeFor(m.id);
        const len = lenOf(m);
        const av = b ? `<span class="${b.cls === "no" ? "" : b.cls}">${esc(b.text)}</span>` : "";
        const unavail = el && !el.ok;
        return `<li class="${m.locked ? "locked" : ""} ${unavail ? "unavail" : ""}">
          ${img(m.poster, "w92") ? `<img class="pt" src="${img(m.poster, "w92")}" alt="" width="46" height="69">` : '<span class="pt"></span>'}
          <div><div class="nt">${esc(m.title)}</div><div class="ns">${[m.year, len ? dur(len) : (d ? "duración s/d" : "…")].filter(Boolean).map(esc).join(" · ")}${av ? " · " + av : ""}${unavail ? "<br>No entra al sorteo" : ""}</div></div>
          <button class="lock" type="button" data-lock="${m.id}" aria-pressed="${m.locked}" aria-label="${m.locked ? "Quitar candado a" : "Fijar"} ${esc(m.title)}" ${unavail ? "disabled" : ""}>${lockSvg}</button>
          <button class="rm" type="button" data-rm="${m.id}" aria-label="Quitar ${esc(m.title)}">✕</button>
        </li>`;
      }).join("");
    }
    const f = fitInfo();
    let segs = "", u = 0;
    f.locked.forEach((r, i) => {
      if (i && f.B) { segs += `<i class="b" style="width:${(f.B / f.W) * 100}%"></i>`; u += f.B; }
      segs += `<i class="${u + r.len > f.W ? "over" : ""}" style="width:${Math.min(r.len, Math.max(0, f.W - u)) / f.W * 100}%" title="${esc(r.m.title)}"></i>`; u += r.len;
    });
    $("timeline").innerHTML = segs;
    const ft = $("fitTxt");
    ft.classList.toggle("err", f.over);
    const range = f.min === f.max ? f.max : `${f.min} a ${f.max}`;
    ft.innerHTML = f.over
      ? `Las fijadas suman <b>${dur(f.lockedUse)}</b> y tu horario es de <b>${dur(f.W)}</b>. Quita un candado o alarga la función.`
      : `Tienes <b>${dur(f.W)}</b>${toMin($("end").value) <= toMin($("start").value) ? " (terminas al día siguiente)" : ""}. ${f.locked.length ? `Fijadas: <b>${dur(f.lockedUse)}</b>. ` : ""}${state.movies.length ? `Caben aprox. <b>${range}</b> ${range === 1 ? "peli" : "pelis"}.` : ""}`;
    $("goBtn").disabled = f.over || state.movies.length < MIN;
  }
  $("nightList").addEventListener("click", e => {
    const l = e.target.closest("[data-lock]");
    if (l) { const m = state.movies.find(x => x.id === +l.dataset.lock); if (m) { m.locked = !m.locked; save(); refreshNight(); } return; }
    const r = e.target.closest("[data-rm]"); if (r) removeMovie(+r.dataset.rm);
  });
  $("trayOpen").addEventListener("click", () => { showLayer($("panel")); renderPanel(); $("panel").querySelector("[data-close].icon-btn").focus(); });
  ["start", "end", "breakMin"].forEach(id => $(id).addEventListener("change", () => { save(); renderPanel(); renderTray(); }));

  // ---------- plataformas ----------
  let draft = new Set(), showAll = false;
  async function loadProviders() {
    $("obGrid").innerHTML = '<p class="ob-loading">Cargando plataformas…</p>';
    $("obMore").hidden = true;
    try {
      const data = await api("watch/providers/movie", { watch_region: state.region, language: lang() });
      const r = state.region, prio = p => (p.display_priorities && p.display_priorities[r]) ?? p.display_priority ?? 999;
      providerList = (data.results || []).sort((a, b) => prio(a) - prio(b));
      renderTiles();
    } catch (e) { $("obGrid").innerHTML = `<p class="ob-loading">${esc(apiError(e))}</p>`; }
  }
  function renderTiles() {
    const list = showAll ? providerList : providerList.filter((p, i) => i < TOP_PLATS || draft.has(p.provider_id));
    $("obGrid").innerHTML = list.map(p => `<button type="button" class="ob-tile" data-pid="${p.provider_id}" aria-pressed="${draft.has(p.provider_id)}">
      <span class="lg">${img(p.logo_path, "w154") ? `<img src="${img(p.logo_path, "w154")}" alt="" width="110" height="110" loading="lazy">` : ""}</span>${esc(p.provider_name)}</button>`).join("");
    $("obMore").hidden = providerList.length <= TOP_PLATS;
    $("obMore").textContent = showAll ? "Ver menos" : `Ver todas (${providerList.length})`;
    $("obDone").disabled = !draft.size;
  }
  $("obGrid").addEventListener("click", e => {
    const t = e.target.closest("[data-pid]"); if (!t) return;
    const id = +t.dataset.pid; draft.has(id) ? draft.delete(id) : draft.add(id);
    t.setAttribute("aria-pressed", String(draft.has(id))); $("obDone").disabled = !draft.size;
  });
  $("obMore").addEventListener("click", () => { showAll = !showAll; renderTiles(); });
  $("country").addEventListener("change", () => { state.region = $("country").value; draft.clear(); showAll = false; loadProviders(); });
  const renderPaid = () => { $("freeBtn").setAttribute("aria-pressed", String(!state.paid)); $("paidBtn").setAttribute("aria-pressed", String(state.paid)); };
  $("freeBtn").addEventListener("click", () => { state.paid = false; renderPaid(); });
  $("paidBtn").addEventListener("click", () => { state.paid = true; renderPaid(); });
  function openOnboard() {
    draft = new Set(state.provs); showAll = false;
    $("country").value = state.region; renderPaid();
    showLayer($("onboard")); loadProviders();
  }
  $("platBtn").addEventListener("click", openOnboard);
  $("obDone").addEventListener("click", () => {
    state.provs = new Set(draft); state.provMeta = {};
    providerList.filter(p => draft.has(p.provider_id)).forEach(p => { state.provMeta[p.provider_id] = { name: p.provider_name, logo: safePath(p.logo_path) }; });
    save(); hideLayer($("onboard"));
    renderPlatLogos(); buildHome(); refreshNight();
    state.movies.forEach(m => paintBadges(m.id));
  });
  function renderPlatLogos() {
    $("platLogos").innerHTML = [...state.provs].slice(0, 3).map(id => { const m = state.provMeta[id]; return m && img(m.logo, "w92") ? `<img src="${img(m.logo, "w92")}" alt="" width="28" height="28">` : ""; }).join("");
  }

  // ---------- inicio: portada y filas ----------
  function card(m, hint) {
    seen.set(m.id, m);
    if (hint && !hints.has(m.id)) hints.set(m.id, hint);
    const bd = img(m.backdrop_path, "w780") || img(m.poster_path, "w500");
    const b = badgeFor(m.id), isIn = inList(m.id);
    return `<article class="card">
      ${bd ? `<img class="bd" src="${bd}" alt="" loading="lazy" width="780" height="439">` : `<div class="noimg">${esc(m.title)}</div>`}
      <span data-b="${m.id}" class="badge ${b ? b.cls : ""}" ${b ? "" : "hidden"}>${b ? esc(b.text) : ""}</span>
      <span class="ct">${esc(m.title)}</span>
      <button class="open" type="button" data-open="${m.id}" aria-label="Más info de ${esc(m.title)}"></button>
      <button class="add ${isIn ? "in" : ""}" type="button" data-add="${m.id}" aria-label="${isIn ? "Quitar de mi noche" : "Agregar a mi noche"}">${isIn ? "✓" : "+"}</button>
    </article>`;
  }

  function rowSpecs() {
    const base = { watch_region: state.region, language: lang(), include_adult: "false", sort_by: "popularity.desc", "vote_count.gte": "30",
      with_watch_monetization_types: "flatrate|free|ads", with_watch_providers: [...state.provs].join("|") };
    const specs = [{ title: "Para no dormir", spooky: true, params: { ...base, with_genres: "27" }, hint: { cls: "inc", text: "En tus plataformas" }, hero: true }];
    [...state.provs].slice(0, 4).forEach(id => {
      const name = (state.provMeta[id] && state.provMeta[id].name) || "plataforma";
      specs.push({ title: `Terror en tu ${name}`, spooky: true, params: { ...base, with_genres: "27", with_watch_providers: String(id) }, hint: { cls: "inc", text: "En tu " + name } });
    });
    specs.push({ title: "Suspenso que no te suelta", params: { ...base, with_genres: "53" }, hint: { cls: "inc", text: "En tus plataformas" } });
    specs.push({ title: "Lo más visto en tus plataformas", params: { ...base }, hint: { cls: "inc", text: "En tus plataformas" } });
    if (state.paid) specs.push({ title: "Para rentar esta noche", params: { ...base, with_genres: "27|53", with_watch_monetization_types: "rent" }, hint: { cls: "pay", text: "Para rentar" } });
    return specs;
  }

  let homeToken = 0;
  function buildHome() {
    const token = ++homeToken;
    const specs = rowSpecs();
    $("rows").innerHTML = specs.map((s, i) => `<section class="row" id="row${i}" aria-labelledby="rt${i}">
      <h2 class="row-title ${s.spooky ? "spooky" : ""}" id="rt${i}">${esc(s.title)}</h2>
      <button class="arrow l" type="button" data-scroll="-1" aria-label="Anteriores">‹</button>
      <div class="track">${'<div class="skel"></div>'.repeat(6)}</div>
      <button class="arrow r" type="button" data-scroll="1" aria-label="Siguientes">›</button></section>`).join("");
    specs.forEach((s, i) => {
      api("discover/movie", s.params).then(data => {
        if (token !== homeToken) return;
        const res = (data.results || []).filter(m => m.backdrop_path || m.poster_path).slice(0, 20);
        const row = $("row" + i);
        if (!res.length) { row.hidden = true; return; }
        row.querySelector(".track").innerHTML = res.map(m => card(m, s.hint)).join("");
        if (s.hero) setHero(res.filter(m => m.backdrop_path).slice(0, 6));
      }).catch(e => {
        if (token !== homeToken) return;
        const row = $("row" + i);
        row.querySelector(".track").outerHTML = `<p class="row-empty">${esc(apiError(e))}</p>`;
      });
    });
  }
  $("rows").addEventListener("click", e => {
    const b = e.target.closest("[data-scroll]"); if (!b) return;
    const t = b.parentElement.querySelector(".track");
    t.scrollBy({ left: +b.dataset.scroll * t.clientWidth * .85, behavior: reduceMotion ? "auto" : "smooth" });
  });

  function setHero(list) {
    if (!list.length) return;
    const m = list[Math.floor(Math.random() * list.length)];
    const bg = $("heroBg");
    bg.style.backgroundImage = `url("${img(m.backdrop_path, "w1280")}")`;
    bg.classList.remove("has-img"); void bg.offsetWidth; bg.classList.add("has-img");
    $("heroTitle").textContent = m.title;
    $("heroMeta").innerHTML = [m.vote_average ? `<span class="match">★ ${m.vote_average.toFixed(1)}</span>` : "", year(m.release_date) ? `<span>${esc(year(m.release_date))}</span>` : "", '<span class="tag">Terror</span>'].join("");
    $("heroOv").textContent = m.overview || "";
    const isIn = inList(m.id);
    $("heroActions").innerHTML = `<button class="btn white" type="button" data-add="${m.id}" data-kind="hero">${isIn ? "✓ En tu noche" : "+ Agregar a mi noche"}</button>
      <button class="btn gray" type="button" data-open="${m.id}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Más info</button>`;
  }

  // ---------- búsqueda ----------
  const q = $("q");
  let searchTimer, searchCtl;
  $("searchToggle").addEventListener("click", () => { $("navSearch").classList.add("open"); q.focus(); });
  q.addEventListener("blur", () => { if (!q.value.trim()) $("navSearch").classList.remove("open"); });
  q.addEventListener("keydown", e => { if (e.key === "Escape") { q.value = ""; exitSearch(); q.blur(); } });
  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const term = q.value.trim();
    if (!term) { exitSearch(); return; }
    if (term.length < 2) return;
    searchTimer = setTimeout(() => search(term), 320);
  });
  function exitSearch() { document.body.classList.remove("searching"); $("searchView").hidden = true; }
  async function search(term) {
    searchCtl?.abort(); searchCtl = new AbortController();
    document.body.classList.add("searching"); $("searchView").hidden = false;
    $("searchTitle").textContent = `Resultados para “${term}”`;
    $("searchGrid").innerHTML = '<p class="msg">Buscando…</p>';
    try {
      const r = await fetch("/api/search/movie?" + new URLSearchParams({ query: term, language: lang(), include_adult: "false", page: "1" }), { signal: searchCtl.signal });
      if (!r.ok) throw new Error(r.status === 401 ? "token" : "http");
      const res = ((await r.json()).results || []).slice(0, 18);
      if (!res.length) { $("searchGrid").innerHTML = `<p class="msg">No encontramos “${esc(term)}”. Prueba con otro nombre o en inglés.</p>`; return; }
      $("searchGrid").innerHTML = res.map(m => card(m)).join("");
      res.slice(0, 12).forEach(m => getDetail(m.id).then(() => paintBadges(m.id)).catch(() => {}));
    } catch (e) {
      if (e.name !== "AbortError") $("searchGrid").innerHTML = `<p class="msg">${esc(apiError(e))}</p>`;
    }
  }

  // ---------- ficha ----------
  const fx = $("fx");
  let fxId = null, lastFocus = null;
  async function openFicha(id) {
    const seed = seen.get(id) || detailNow(id);
    fxId = id; lastFocus = document.activeElement;
    showLayer(fx); $("fxScroll").scrollTop = 0;
    const bd = seed && img(seed.backdrop_path, "w1280");
    $("fxBg").style.backgroundImage = bd ? `url("${bd}")` : "none";
    $("fxIn").innerHTML = `<div class="fx-loading">${seed ? esc(seed.title) : "Apagando las luces…"}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => fx.classList.add("on")));
    $("fxClose").focus();
    try { const d = await getDetail(id); if (fxId === id) { renderFicha(d); paintBadges(id); } }
    catch (e) { if (fxId === id) $("fxIn").innerHTML = `<div class="fx-loading">${esc(apiError(e))}</div>`; }
  }
  function closeFicha() {
    fx.classList.remove("on");
    const tr = fx.querySelector(".trailer"); if (tr) tr.innerHTML = "";
    fxId = null;
    setTimeout(() => { if (!fxId) hideLayer(fx); }, reduceMotion ? 0 : 300);
    lastFocus?.focus?.();
  }
  $("fxClose").addEventListener("click", closeFicha);
  fx.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const f = [...fx.querySelectorAll("button, a[href], iframe")].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
  });
  function renderFicha(d) {
    const bd = img(d.backdrop_path, "w1280"); if (bd) $("fxBg").style.backgroundImage = `url("${bd}")`;
    const director = ((d.credits && d.credits.crew) || []).filter(c => c.job === "Director").map(c => c.name).slice(0, 2).join(" y ");
    const vids = (d.videos && d.videos.results) || [];
    const trailer = vids.find(v => v.site === "YouTube" && v.type === "Trailer" && v.iso_639_1 === "es") || vids.find(v => v.site === "YouTube" && v.type === "Trailer") || vids.find(v => v.site === "YouTube" && v.type === "Teaser");
    const wp = regionProviders(d), provs = [];
    if (wp) [["flatrate", "Incluida"], ["free", "Gratis"], ["ads", "Con anuncios"], ["rent", "Renta"], ["buy", "Compra"]].forEach(([k, label]) =>
      (wp[k] || []).forEach(p => { if (!provs.some(x => x.provider_id === p.provider_id)) provs.push({ ...p, label }); }));
    provs.sort((a, b) => state.provs.has(b.provider_id) - state.provs.has(a.provider_id));
    const cast = ((d.credits && d.credits.cast) || []).slice(0, 12);
    const recs = ((d.recommendations && d.recommendations.results) || []).slice(0, 12);
    recs.forEach(r => seen.set(r.id, r));
    const country = $("country").selectedOptions[0].textContent;
    const el = eligibility(d), isIn = inList(d.id);
    $("fxIn").innerHTML = `
      <div class="fx-hero">
        ${director ? `<p class="fx-by">Dirigida por ${esc(director)}</p>` : ""}
        <h2 class="fx-title" id="fxTitle">${esc(d.title)}</h2>
        ${d.tagline ? `<p class="fx-tag">“${esc(d.tagline)}”</p>` : ""}
        <p class="fx-meta">${d.vote_average ? `<span class="match">★ ${d.vote_average.toFixed(1)}</span>` : ""}${year(d.release_date) ? `<span>${esc(year(d.release_date))}</span>` : ""}${d.runtime ? `<span>${dur(d.runtime)}</span>` : ""}${(d.genres || []).slice(0, 3).map(g => `<span class="tag">${esc(g.name)}</span>`).join("")}</p>
        ${d.overview ? `<p class="fx-ov">${esc(d.overview)}</p>` : ""}
        <div class="fx-actions">
          <button class="btn red" type="button" data-add="${d.id}" data-kind="fx" ${!isIn && state.movies.length >= MAX ? "disabled" : ""}>${isIn ? "✓ En tu noche" : "+ Agregar a mi noche"}</button>
          ${trailer ? `<button class="btn gray" type="button" id="fxPlay">${playSvg}Tráiler</button>` : ""}
        </div>
        <p class="fx-msg">${el.ok ? `Disponible en tu ${esc(el.via[0].provider_name)}${el.kind === "pay" ? " (renta)" : ""}.` : esc(el.why) + " Si la agregas, no entra al sorteo."}</p>
      </div>
      ${trailer ? `<section class="fx-sec" id="fxTrailerSec" hidden><h3>Tráiler</h3><div class="trailer" id="fxTrailer"></div></section>` : ""}
      <section class="fx-sec"><h3>Dónde verla <span>en ${esc(country)}</span></h3>
        ${provs.length ? `<div class="wtw">${provs.map(p => { const u = img(p.logo_path, "w92"), mine = state.provs.has(p.provider_id);
          return `<span class="p ${mine ? "mine" : ""}">${u ? `<img src="${u}" alt="" width="34" height="34">` : ""}<span>${esc(p.provider_name)}<small>${esc(p.label)}${mine ? " · la tienes" : ""}</small></span></span>`; }).join("")}</div>
          ${wp && wp.link ? `<p class="fx-msg"><a href="${esc(wp.link)}" target="_blank" rel="noopener">Ver todas las opciones</a></p>` : ""}`
        : '<p class="fx-msg">No aparece en streaming en este país.</p>'}
      </section>
      ${cast.length ? `<section class="fx-sec"><h3>Reparto</h3><div class="rail">${cast.map(c => { const u = img(c.profile_path, "w185");
        return `<div class="cast">${u ? `<img src="${u}" alt="" loading="lazy" width="132" height="198">` : `<div class="noimg">${esc(c.name)}</div>`}<b>${esc(c.name)}</b><span>${esc(c.character || "")}</span></div>`; }).join("")}</div></section>` : ""}
      ${recs.length ? `<section class="fx-sec"><h3>Más como esta</h3><div class="rail">${recs.map(r => { const u = img(r.poster_path, "w185");
        return `<button class="rec" type="button" data-rec="${r.id}">${u ? `<img src="${u}" alt="" loading="lazy" width="132" height="198">` : `<div class="noimg">${esc(r.title)}</div>`}<b>${esc(r.title)}</b></button>`; }).join("")}</div></section>` : ""}`;
    if (trailer) $("fxPlay").addEventListener("click", () => {
      $("fxTrailerSec").hidden = false;
      $("fxTrailer").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0" title="Tráiler de ${esc(d.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      $("fxTrailerSec").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
    $("fxIn").querySelectorAll("[data-rec]").forEach(b => b.addEventListener("click", () => {
      fx.classList.remove("on"); setTimeout(() => openFicha(+b.dataset.rec), reduceMotion ? 0 : 250);
    }));
  }

  // ---------- sorteo y función ----------
  function countdown() {
    if (reduceMotion) return Promise.resolve();
    const L = $("leader"), n = $("leaderNo");
    L.hidden = false;
    return new Promise(res => {
      let k = 3; n.textContent = k;
      const iv = setInterval(() => { k--; if (k === 0) { clearInterval(iv); L.hidden = true; res(); } else n.textContent = k; }, 600);
    });
  }

  function draw() {
    const B = +$("breakMin").value, W = windowMin(), out = [], locked = [], pool = [];
    lastDetails.forEach(({ movie, d }) => {
      if (!d) { out.push({ movie, why: "No pudimos traer sus datos." }); return; }
      const el = eligibility(d);
      if (!el.ok) { out.push({ movie, why: el.why }); return; }
      const item = { movie, d, via: el.via, link: el.link, len: d.runtime > 0 ? d.runtime : 120, estimated: !(d.runtime > 0) };
      (movie.locked ? locked : pool).push(item);
    });
    let used = locked.reduce((s, x) => s + x.len, 0) + B * Math.max(0, locked.length - 1);
    if (used > W) return { error: `Las fijadas suman ${dur(used)} y tu horario es de ${dur(W)}.` };
    const picked = locked.slice();
    for (const it of shuffle(pool)) {
      const need = (picked.length ? B : 0) + it.len;
      if (used + need <= W) { used += need; picked.push(it); }
      else out.push({ movie: it.movie, why: `Disponible, pero esta vez no alcanzó el tiempo (${dur(it.len)}).` });
    }
    return { picked: shuffle(picked), out, W, B };
  }

  let lastShow = null;
  function renderShow(r) {
    lastShow = r;
    const start = toMin($("start").value);
    let t = start, used = 0;
    const slots = [];
    const chapters = r.picked.map((p, i) => {
      if (i) { t += r.B; used += r.B; }
      const s = t; t += p.len; used += p.len;
      slots.push({ s, e: t, p });
      const bd = img(p.d.backdrop_path, "w780") || img(p.movie.poster, "w780");
      const via = p.via.map(v => `<span class="via">${img(v.logo_path, "w45") ? `<img src="${img(v.logo_path, "w45")}" alt="" width="22" height="22">` : ""}${esc(v.provider_name)} <span class="pill ${v.tipo === "renta" || v.tipo === "compra" ? "pay" : "inc"}">${esc(v.tipo)}</span></span>`).join("");
      const sep = i < r.picked.length - 1 ? `<div class="neon"><span>${r.B ? `Intermedio · ${r.B} min` : "Sin pausa"}</span></div>` : "";
      return `<article class="chapter ${i % 2 ? "rev" : ""}" style="animation-delay:${i * 120}ms">
        <div class="ch-text">
          <div class="ch-no"><span>Función</span><b>${pad2(i + 1)}</b></div>
          <h3>${p.movie.locked ? `<span class="lk" title="Fijada">${lockSvg}</span> ` : ""}${esc(p.d.title || p.movie.title)}${p.movie.year ? `<small>${esc(p.movie.year)}</small>` : ""}</h3>
          <div class="slot-times">${fmt(s)} <i>→</i> ${fmt(t)}</div>
          ${p.d.overview ? `<p class="ov">${esc(p.d.overview)}</p>` : ""}
          <div class="where"><span>${dur(p.len)}${p.estimated ? " (estimado)" : ""}</span>${via}</div>
          <div class="ch-actions"><button class="btn gray" type="button" data-open="${p.movie.id}">Más info</button></div>
        </div>
        <div class="ch-art"><div class="ch-img">
          ${bd ? `<img src="${bd}" alt="" loading="lazy" width="780" height="439">` : ""}
          <span class="tt">${esc(p.d.title || p.movie.title)}</span>
          ${p.link ? `<a class="play" href="${esc(p.link)}" target="_blank" rel="noopener">${playSvg}Dónde verla</a>` : ""}
        </div></div>
      </article>${sep}`;
    }).join("");
    r.slots = slots;
    const outHtml = r.out.length ? `<details class="out"><summary>${r.out.length} ${r.out.length === 1 ? "peli se quedó" : "pelis se quedaron"} fuera esta vez</summary><ul class="outlist">${
      r.out.map(o => `<li><b>${esc(o.movie.title)}</b> · ${esc(o.why)}</li>`).join("")}</ul></details>` : "";
    const actions = `<div class="show-actions">
      <button class="btn red" type="button" id="redrawBtn">Volver a sortear</button>
      ${r.picked.length ? '<button class="btn gray" type="button" id="shareBtn">Compartir</button>' : ""}
      <button class="btn gray" type="button" id="editBtn">Editar mi noche</button></div>`;
    $("result").innerHTML = !r.picked.length
      ? `<div class="nothing"><b>Esta noche no hay función.</b>Ninguna peli disponible cabe en tu horario. Alarga la función o agrega otras.</div>${outHtml}${actions}`
      : `<div class="bill"><div><b>${pad2(r.picked.length)}</b><span>${r.picked.length === 1 ? "película" : "películas"}</span></div>
          <div><b>${fmt(start)}</b><span>Arranca</span></div><div><b>${fmt(start + used)}</b><span>Termina · sobran ${dur(r.W - used)}</span></div></div>
        ${chapters}${outHtml}${actions}`;
    $("redrawBtn").addEventListener("click", () => { const n = draw(); if (!n.error) { renderShow(n); $("show").scrollTop = 0; toast("Nuevo sorteo. Las fijadas se quedan."); } });
    $("editBtn").addEventListener("click", () => { hideLayer($("show")); showLayer($("panel")); renderPanel(); });
    if ($("shareBtn")) $("shareBtn").addEventListener("click", share);
  }

  async function share() {
    const r = lastShow; if (!r) return;
    const text = "Noche de Pelis\n" + r.slots.map(x => `${fmt(x.s)} ${x.p.d.title || x.p.movie.title} (${x.p.via[0].provider_name})`).join("\n");
    try { if (navigator.share) { await navigator.share({ title: "Noche de Pelis", text }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); toast("Copiado. Pégalo en WhatsApp."); }
    catch (e) { toast("No se pudo copiar. Toma captura de pantalla."); }
  }

  let busy = false;
  $("goBtn").addEventListener("click", async () => {
    if (busy) return;
    if (state.movies.length < MIN) { $("status").textContent = "Agrega al menos 2 películas."; return; }
    busy = true; $("goBtn").disabled = true; $("status").textContent = ""; $("status").classList.remove("err");
    const [res] = await Promise.all([Promise.allSettled(state.movies.map(m => getDetail(m.id))), countdown()]);
    lastDetails = state.movies.map((movie, i) => ({ movie, d: res[i].status === "fulfilled" ? res[i].value : null }));
    busy = false; renderPanel();
    if (res.every(r => r.status === "rejected")) { $("status").textContent = apiError(res[0].reason); $("status").classList.add("err"); return; }
    const r = draw();
    if (r.error) { $("status").textContent = r.error; $("status").classList.add("err"); return; }
    hideLayer($("panel")); showLayer($("show")); $("show").scrollTop = 0; renderShow(r);
  });

  // ---------- inicio ----------
  window.addEventListener("scroll", () => $("nav").classList.toggle("solid", window.scrollY > 60), { passive: true });
  document.querySelectorAll(".credit-photo img").forEach(im => {
    const hide = () => { im.closest(".credit-photo").classList.add("missing"); if (!document.querySelector(".credit-photo:not(.missing)")) $("credits").hidden = true; };
    if (im.complete && im.naturalWidth === 0) hide(); else im.addEventListener("error", hide);
  });
  load();
  $("country").value = state.region;
  refreshNight();
  state.movies.forEach(m => getDetail(m.id).then(() => { paintBadges(m.id); renderTray(); renderPanel(); }).catch(() => {}));
  if (!state.provs.size) openOnboard(); else { renderPlatLogos(); buildHome(); }
})();
