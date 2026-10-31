(() => {
  "use strict";
  const MAX = 20, MIN = 2, TOP_PLATS = 16;
  const IMG = "https://image.tmdb.org/t/p/";
  const LANG = { ES: "es-ES" };
  const $ = id => document.getElementById(id);

  const state = { movies: [], region: "MX", provs: new Set(), paid: false };
  const details = new Map();   // id -> detalle de TMDB (incluye watch/providers de todos los países)
  let providerList = [], showAllPlats = false;

  const lang = () => LANG[state.region] || "es-MX";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const year = d => (d || "").slice(0, 4);
  const initials = t => String(t).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  const toMin = v => { const [h, m] = (v || "00:00").split(":").map(Number); return h * 60 + m; };
  const fmt = min => { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); };
  const dur = min => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + " h" : "") + (h && m ? " " : "") + (m || !h ? m + " min" : ""); };
  const windowMin = () => { const s = toMin($("start").value); let e = toMin($("end").value); if (e <= s) e += 1440; return e - s; };
  const poster = (path, size, alt, cls) => path
    ? `<img class="${cls || ""}" src="${IMG}${size}${esc(path)}" alt="${esc(alt)}" loading="lazy" width="${size === "w92" ? 46 : 185}" height="${size === "w92" ? 69 : 278}">`
    : `<div class="noimg" aria-hidden="true">${esc(initials(alt))}</div>`;

  async function api(path, params) {
    const url = "/api/" + path + "?" + new URLSearchParams(params);
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status === 401 ? "token" : r.status === 429 || r.status === 503 ? "limite" : "http" + r.status);
    return r.json();
  }
  function apiError(e) {
    return e.message === "token" ? "El servidor no tiene un token válido de TMDB. Revisa el archivo .env."
      : e.message === "limite" ? "Demasiadas búsquedas seguidas. Espera unos segundos."
      : "No pudimos conectar con TMDB. Revisa tu conexión y vuelve a intentar.";
  }

  // ---------- guardar en el navegador ----------
  function save() {
    try {
      localStorage.setItem("ndp2", JSON.stringify({
        movies: state.movies, region: state.region, provs: [...state.provs], paid: state.paid,
        start: $("start").value, end: $("end").value, brk: $("breakMin").value,
      }));
    } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("ndp2") || "null");
      if (!s) return;
      state.movies = Array.isArray(s.movies) ? s.movies.slice(0, MAX) : [];
      state.region = s.region || "MX"; state.provs = new Set(s.provs || []); state.paid = !!s.paid;
      if (s.start) $("start").value = s.start;
      if (s.end) $("end").value = s.end;
      if (s.brk) $("breakMin").value = s.brk;
    } catch (e) { /* ignorar */ }
  }

  function setStatus(msg, err) { $("status").textContent = msg; $("status").classList.toggle("err", !!err); }

  // ---------- búsqueda ----------
  const q = $("q"), results = $("results");
  let searchTimer, searchCtl, hits = [], active = -1;

  function closeResults() { results.hidden = true; q.setAttribute("aria-expanded", "false"); active = -1; }
  function renderResults(html) { results.innerHTML = html; results.hidden = false; q.setAttribute("aria-expanded", "true"); }

  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const term = q.value.trim();
    if (term.length < 2) { closeResults(); return; }
    searchTimer = setTimeout(() => search(term), 300);
  });
  async function search(term) {
    searchCtl?.abort(); searchCtl = new AbortController();
    renderResults('<li class="msg">Buscando…</li>');
    try {
      const r = await fetch("/api/search/movie?" + new URLSearchParams({ query: term, language: lang(), include_adult: "false", page: "1" }), { signal: searchCtl.signal });
      if (!r.ok) throw new Error(r.status === 401 ? "token" : "http");
      const data = await r.json();
      hits = (data.results || []).slice(0, 8);
      active = -1;
      if (!hits.length) { renderResults(`<li class="msg">No encontramos “${esc(term)}”. Prueba con otro nombre o en inglés.</li>`); return; }
      paintHits();
    } catch (e) {
      if (e.name === "AbortError") return;
      renderResults(`<li class="msg">${esc(apiError(e))}</li>`);
    }
  }
  function paintHits() {
    renderResults(hits.map((m, i) => {
      const added = state.movies.some(x => x.id === m.id);
      return `<li role="option" id="opt${i}" data-i="${i}" aria-selected="${i === active}">
        ${m.poster_path ? `<img class="thumb" src="${IMG}w92${esc(m.poster_path)}" alt="" loading="lazy" width="46" height="69">` : '<div class="thumb"></div>'}
        <div><div class="t">${esc(m.title)} <small>${esc(year(m.release_date)) || "s/f"}${m.vote_average ? " · ★ " + m.vote_average.toFixed(1) : ""}</small></div>
        ${added ? '<div class="added">Ya está en tu lista</div>' : ""}
        <div class="ov">${esc(m.overview || "Sin sinopsis en español.")}</div></div></li>`;
    }).join(""));
    q.setAttribute("aria-activedescendant", active >= 0 ? "opt" + active : "");
  }
  q.addEventListener("keydown", e => {
    if (results.hidden || !hits.length) return;
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); paintHits(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); paintHits(); e.preventDefault(); }
    else if (e.key === "Enter") { pick(hits[active >= 0 ? active : 0]); e.preventDefault(); }
    else if (e.key === "Escape") closeResults();
  });
  results.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    e.preventDefault(); pick(hits[+li.dataset.i]);
  });
  q.addEventListener("blur", () => setTimeout(closeResults, 120));
  q.addEventListener("focus", () => { if (hits.length && q.value.trim().length >= 2) paintHits(); });

  function pick(m) {
    if (!m) return;
    if (state.movies.some(x => x.id === m.id)) { setStatus(`“${m.title}” ya está en tu lista.`, true); return; }
    if (state.movies.length >= MAX) { setStatus("Ya tienes 20 películas, el máximo.", true); return; }
    state.movies.push({ id: m.id, title: m.title, year: year(m.release_date), poster: m.poster_path || null });
    q.value = ""; hits = []; closeResults(); setStatus("");
    renderList(); save();
    getDetail(m.id).then(renderList).catch(() => {});
  }

  // ---------- detalle: duración y plataformas ----------
  function getDetail(id) {
    if (details.has(id)) return Promise.resolve(details.get(id));
    const p = api("movie/" + id, { language: lang(), append_to_response: "watch/providers" })
      .then(d => { details.set(id, d); return d; })
      .catch(e => { details.delete(id); throw e; });
    details.set(id, p);
    return p;
  }
  const detailNow = id => { const d = details.get(id); return d && !(d instanceof Promise) ? d : null; };
  const regionProviders = d => (d && d["watch/providers"] && d["watch/providers"].results && d["watch/providers"].results[state.region]) || null;

  function renderList() {
    $("count").textContent = state.movies.length;
    q.disabled = state.movies.length >= MAX;
    q.placeholder = state.movies.length >= MAX ? "Llegaste al máximo de 20" : "Ej. Top Gun Maverick";
    if (!state.movies.length) {
      $("list").innerHTML = '<div class="empty">Tu lista está vacía. Busca una película arriba y tócala para agregarla.</div>';
      return;
    }
    $("list").innerHTML = state.movies.map((m, i) => {
      const d = detailNow(m.id), wp = regionProviders(d);
      const seen = new Map();
      if (wp) ["flatrate", "free", "ads", "rent", "buy"].forEach(k => (wp[k] || []).forEach(p => { if (!seen.has(p.provider_id)) seen.set(p.provider_id, p); }));
      const logos = [...seen.values()].slice(0, 6).map(p =>
        `<img src="${IMG}w45${esc(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}" class="${state.provs.has(p.provider_id) ? "mine" : ""}" width="22" height="22" loading="lazy">`).join("");
      const sub = [m.year, d && d.runtime ? dur(d.runtime) : (d ? "duración s/d" : "…")].filter(Boolean).join(" · ");
      return `<article class="mv">
        ${poster(m.poster, "w185", m.title, "poster")}
        <button class="x" type="button" data-i="${i}" aria-label="Quitar ${esc(m.title)}">×</button>
        <div class="meta"><span class="nm">${esc(m.title)}</span><span class="sub">${esc(sub)}</span>
        ${d ? `<div class="logos">${logos || '<span class="sub">Sin streaming aquí</span>'}</div>` : ""}</div>
      </article>`;
    }).join("");
  }
  $("list").addEventListener("click", e => {
    const b = e.target.closest(".x"); if (!b) return;
    state.movies.splice(+b.dataset.i, 1); renderList(); save();
  });
  $("clearBtn").addEventListener("click", () => { state.movies = []; renderList(); save(); });

  // ---------- plataformas ----------
  async function loadProviders() {
    $("platChips").innerHTML = '<span class="loading">Cargando plataformas…</span>';
    $("morePlats").hidden = true;
    try {
      const data = await api("watch/providers/movie", { watch_region: state.region, language: lang() });
      const r = state.region;
      providerList = (data.results || []).sort((a, b) =>
        ((a.display_priorities && a.display_priorities[r]) ?? a.display_priority ?? 999) - ((b.display_priorities && b.display_priorities[r]) ?? b.display_priority ?? 999));
      renderChips();
    } catch (e) {
      $("platChips").innerHTML = `<span class="loading">${esc(apiError(e))}</span>`;
    }
  }
  function renderChips() {
    const list = showAllPlats ? providerList : providerList.filter((p, i) => i < TOP_PLATS || state.provs.has(p.provider_id));
    $("platChips").innerHTML = list.map(p =>
      `<button type="button" class="chip" aria-pressed="${state.provs.has(p.provider_id)}" data-id="${p.provider_id}">
        <img src="${IMG}w45${esc(p.logo_path)}" alt="" width="24" height="24" loading="lazy">${esc(p.provider_name)}</button>`).join("");
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
  $("country").addEventListener("change", () => {
    state.region = $("country").value; state.provs.clear(); showAllPlats = false;
    loadProviders(); renderList(); save();
  });

  function renderPaid() { $("freeBtn").setAttribute("aria-pressed", String(!state.paid)); $("paidBtn").setAttribute("aria-pressed", String(state.paid)); }
  $("freeBtn").addEventListener("click", () => { state.paid = false; renderPaid(); save(); });
  $("paidBtn").addEventListener("click", () => { state.paid = true; renderPaid(); save(); });

  function renderWindow() {
    const crosses = toMin($("end").value) <= toMin($("start").value);
    $("windowTxt").innerHTML = `Tienes <b>${dur(windowMin())}</b> de función, de ${fmt(toMin($("start").value))} a ${fmt(toMin($("end").value))}${crosses ? " del día siguiente" : ""}.`;
  }
  ["start", "end", "breakMin"].forEach(id => $(id).addEventListener("change", () => { renderWindow(); save(); }));

  // ---------- sorteo ----------
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function eligibility(d) {
    const wp = regionProviders(d);
    if (!wp) return { ok: false, why: "No está en streaming en este país." };
    const mine = list => (list || []).filter(p => state.provs.has(p.provider_id));
    const inc = [...mine(wp.flatrate).map(p => ({ ...p, tipo: "incluida" })), ...mine(wp.free).map(p => ({ ...p, tipo: "gratis" })), ...mine(wp.ads).map(p => ({ ...p, tipo: "con anuncios" }))];
    const pay = [...mine(wp.rent).map(p => ({ ...p, tipo: "renta" })), ...mine(wp.buy).map(p => ({ ...p, tipo: "compra" }))];
    const uniq = arr => { const s = new Set(); return arr.filter(p => !s.has(p.provider_id) && s.add(p.provider_id)); };
    if (inc.length) return { ok: true, via: uniq(inc), link: wp.link };
    if (state.paid && pay.length) return { ok: true, via: uniq(pay), link: wp.link };
    if (pay.length) return { ok: false, why: "En tus plataformas solo está en renta o compra." };
    const names = [...new Set(["flatrate", "free", "ads", "rent", "buy"].flatMap(k => (wp[k] || []).map(p => p.provider_name)))];
    return { ok: false, why: names.length ? "Está en " + names.slice(0, 4).join(", ") + ", que no marcaste." : "No está en streaming en este país." };
  }

  let lastDetails = null;
  function draw() {
    const brk = +$("breakMin").value, total = windowMin();
    const pool = [], out = [];
    lastDetails.forEach(({ movie, d }) => {
      if (!d) { out.push({ movie, why: "No pudimos traer sus datos." }); return; }
      const el = eligibility(d);
      el.ok ? pool.push({ movie, d, via: el.via, link: el.link }) : out.push({ movie, why: el.why });
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
    const slots = picked.map((p, i) => {
      if (i) { t += brk; used += brk; }
      const s = t; t += p.len; used += p.len;
      const via = p.via.map(v => `<span class="via"><img src="${IMG}w45${esc(v.logo_path)}" alt="" width="20" height="20">${esc(v.provider_name)}<span class="pill ${v.tipo === "renta" || v.tipo === "compra" ? "pay" : "inc"}">${esc(v.tipo)}</span></span>`).join("");
      const inter = i < picked.length - 1 && brk ? `<div class="intermission">Intermedio · ${brk} min</div>` : "";
      return `<article class="slot" style="animation-delay:${i * 80}ms">
        <div class="pwrap">${poster(p.movie.poster, "w185", p.movie.title)}<em>${i + 1}ª</em></div>
        <div style="min-width:0">
          <h3>${esc(p.d.title || p.movie.title)}${p.movie.year ? `<small>(${esc(p.movie.year)})</small>` : ""}</h3>
          <div class="times"><span class="time">${fmt(s)}</span><span class="time end">→ ${fmt(t)}</span></div>
          <div class="where">${dur(p.len)}${p.estimated ? " (estimado)" : ""} · ${via}</div>
          ${p.d.overview ? `<p class="ov">${esc(p.d.overview)}</p>` : ""}
          ${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">Ver dónde verla</a>` : ""}
        </div></article>${inter}`;
    }).join("");
    const outHtml = out.length ? `<details class="out"><summary>${out.length} ${out.length === 1 ? "peli se quedó" : "pelis se quedaron"} fuera esta vez</summary><ul class="outlist">${
      out.map(o => `<li><b>${esc(o.movie.title)}</b> · ${esc(o.why)}</li>`).join("")}</ul></details>` : "";

    if (!picked.length) {
      $("result").innerHTML = `<div class="placeholder"><div class="seats" aria-hidden="true"><i></i><i></i><i></i></div>Ninguna peli cumple con tus plataformas y tu horario. Marca más plataformas, permite renta o alarga la función.</div>${outHtml}`;
      return;
    }
    $("result").innerHTML = `
      <div class="summary">
        <div><b>${picked.length}</b><span>${picked.length === 1 ? "película" : "películas"} esta noche</span></div>
        <div><b>${fmt(start)}</b><span>arranca</span></div>
        <div><b>${fmt(start + used)}</b><span>termina · sobran ${dur(total - used)}</span></div>
      </div>
      <div class="program">${slots}</div>
      ${outHtml}
      <div class="actions"><button class="btn" type="button" id="redrawBtn">Volver a sortear</button></div>`;
    $("redrawBtn").addEventListener("click", () => { draw(); setStatus("Nuevo sorteo con las mismas pelis."); });
  }

  let busy = false;
  $("goBtn").addEventListener("click", async () => {
    if (busy) return;
    if (state.movies.length < MIN) { setStatus("Agrega al menos 2 películas.", true); return; }
    if (!state.provs.size) { setStatus("Marca al menos una plataforma.", true); return; }
    busy = true; $("goBtn").disabled = true; $("goBtn").textContent = "Revisando la cartelera…";
    setStatus("");
    const res = await Promise.allSettled(state.movies.map(m => getDetail(m.id)));
    lastDetails = state.movies.map((movie, i) => ({ movie, d: res[i].status === "fulfilled" ? res[i].value : null }));
    const failed = res.filter(r => r.status === "rejected");
    if (failed.length === res.length) setStatus(apiError(failed[0].reason), true);
    else { draw(); setStatus(failed.length ? `Sorteo listo. ${failed.length} no se pudieron revisar.` : "Sorteo listo."); }
    renderList();
    busy = false; $("goBtn").disabled = false; $("goBtn").textContent = "Armar mi función";
  });

  // ---------- inicio ----------
  const bulbs = Array.from({ length: 24 }, () => "<i></i>").join("");
  document.querySelectorAll(".bulbs").forEach(b => { b.innerHTML = bulbs; });
  // Si falta alguna foto del banner, se oculta su marco sin dejar hueco
  document.querySelectorAll(".frame img").forEach(img => {
    const hide = () => {
      img.closest(".frame").classList.add("missing");
      if (document.querySelectorAll(".frame:not(.missing)").length === 0) document.querySelector(".hero").classList.add("solo");
    };
    if (img.complete && img.naturalWidth === 0) hide(); else img.addEventListener("error", hide);
  });
  load();
  $("country").value = state.region;
  renderList(); renderPaid(); renderWindow(); loadProviders();
  state.movies.forEach(m => getDetail(m.id).then(renderList).catch(() => {}));
})();
