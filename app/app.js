/* Salesforce true or false, Reels-style.
   One question per full-screen slide. Swipe right = true, left = false, up = next.
   One way only: the next question appears once you've answered this one, and
   the question you leave is removed, so you can't skip ahead or go back. Double-tap saves a question. The feed never ends: questions are drawn completely
   at random (no weighting), each one once before any repeats. Everything stays on this device. */
(() => {
  "use strict";

  const KEYS = {
    history: "sfqb.history.v1", // session scores from the older, session-based app (kept for export)
    stats: "sfqb.stats.v2",
    saved: "sfqb.saved.v1",
    prefs: "sfqb.prefs.v1",
    coach: "sfqb.coach.v1",
    learn: "sfqb.learn.v1",     // how many times you've answered and moved on, to fade the gesture cues
  };
  const SWIPE_DISTANCE = 90;   // px past which a release counts as an answer
  const SWIPE_VELOCITY = 0.55; // px/ms flick speed that also counts
  const DOUBLE_TAP_MS = 320;
  // Gesture cues fade away once you've shown you know the gestures.
  const LEARN_NEXTS = 3;       // the chevron shows until you've moved on after answering this many times
  const NUDGE_ANSWERS = 3;     // a hesitant new user gets a gentle sway until this many answers
  const NUDGE_DELAY = 4500;

  const AREA_NAMES = {
    "architecture-practice": "Architecture practice",
    "automation": "Automation",
    "clouds-and-products": "Clouds and products",
    "data-cloud-and-ai": "Data Cloud and AI",
    "data-model": "Data model",
    "development": "Development",
    "devops-and-alm": "DevOps and ALM",
    "identity": "Identity",
    "integration": "Integration",
    "platform-architecture": "Platform architecture",
    "public-sector-and-compliance": "Public sector and compliance",
    "security-and-sharing": "Security and sharing",
  };
  // Each area gets its own background hue so the feed feels varied as you scroll.
  const AREA_HUES = {
    "architecture-practice": 265, "automation": 28, "clouds-and-products": 200, "data-cloud-and-ai": 290,
    "data-model": 172, "development": 222, "devops-and-alm": 145, "identity": 340,
    "integration": 190, "platform-architecture": 238, "public-sector-and-compliance": 12, "security-and-sharing": 355,
  };
  const DIFFICULTY = { 1: "Core", 2: "Practitioner", 3: "Architect" };
  const SMALL_WORDS = new Set(["and", "of", "for"]);
  const UPPER_WORDS = { ai: "AI", alm: "ALM", cta: "CTA", api: "API" };
  const BOOKMARK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/></svg>';

  const $ = (id) => document.getElementById(id);
  const el = {
    feed: $("feed"), tpl: $("slide-tpl"), toast: $("toast"), loadError: $("load-error"),
    filterBtn: $("filter-btn"), scope: $("scope-label"), streak: $("streak"),
    coach: $("coach"), coachGo: $("coach-go"),
    sheet: $("sheet"), sheetForm: $("sheet-form"), area: $("f-area"), cert: $("f-cert"),
    poolCount: $("pool-count"), savedCount: $("saved-count"),
    sToday: $("s-today"), sBest: $("s-best"), sAll: $("s-all"), exportBtn: $("export"),
  };

  // ---------- storage ----------
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

  const prefs = Object.assign({ feed: "all", area: "", cert: "" }, load(KEYS.prefs, {}));
  const saved = new Set(load(KEYS.saved, []));
  const learn = Object.assign({ answers: 0, nexts: 0 }, load(KEYS.learn, {}));
  const stats = Object.assign({ streak: 0, best: 0, total: 0, correct: 0, days: {} }, load(KEYS.stats, {}));

  // ---------- state ----------
  let all = [];
  let pool = [];
  let deck = [];       // shuffled questions still to show before any repeat
  let lastId = null;
  let slides = [];     // [{ q, showsTrue, answered, el }]
  let current = 0;
  let feedKey = "";    // filters the feed was built with

  // ---------- helpers ----------
  const areaName = (slug) => AREA_NAMES[slug] || slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const certName = (id) => id.replace(/^kt:/, "").replace(/-certification$/, "").split("-")
    .map((w, i) => UPPER_WORDS[w] || (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
  const todayKey = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function randomInt(max) {
    if (window.crypto && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / max) * max; // avoid modulo bias
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(list) { // Fisher-Yates: every order equally likely
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1600);
  }

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ }
  }

  // ---------- pool and deck ----------
  function computePool() {
    return all.filter((q) => q.status === "active"
      && (!prefs.area || q.area === prefs.area)
      && (!prefs.cert || q.certs.includes(prefs.cert))
      && (prefs.feed !== "saved" || saved.has(q.id)));
  }

  function draw() {
    if (!deck.length) {
      deck = shuffle(pool);
      // Don't show the same question twice in a row across a reshuffle.
      if (deck.length > 1 && deck[deck.length - 1].id === lastId) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
    }
    const q = deck.pop();
    lastId = q.id;
    return q;
  }

  // ---------- slides ----------
  function buildSlide(q) {
    const node = el.tpl.content.firstElementChild.cloneNode(true);
    const item = { q, showsTrue: randomInt(2) === 1, answered: false, el: node };
    node._item = item;
    node.style.setProperty("--h", AREA_HUES[q.area] ?? 215);
    node.setAttribute("aria-label", "Question");
    node.querySelector(".q").setAttribute("aria-label", `${areaName(q.area)}, ${DIFFICULTY[q.difficulty] || "Practitioner"}`);
    node.querySelector(".q-text").textContent = item.showsTrue ? q.t : q.f;
    node.querySelector(".act-source").href = q.source;
    syncSaveButton(item);
    return item;
  }

  function append(n) {
    if (!pool.length) return;
    const frag = document.createDocumentFragment();
    for (let k = 0; k < n; k++) {
      const item = buildSlide(draw());
      slides.push(item);
      frag.appendChild(item.el);
    }
    el.feed.appendChild(frag);
    for (const item of slides.slice(-n)) observer.observe(item.el);
  }

  function renderEmpty() {
    const node = document.createElement("section");
    node.className = "slide empty";
    const h = document.createElement("h2");
    const p = document.createElement("p");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    if (prefs.feed === "saved" && !saved.size) {
      h.textContent = "Nothing saved yet";
      p.textContent = "Double-tap a question, or tap Save, to keep it here for later.";
      btn.textContent = "Back to all questions";
      btn.addEventListener("click", () => { prefs.feed = "all"; savePrefs(); resetFeed(); });
    } else {
      h.textContent = "No questions match";
      p.textContent = "Try another area or certification.";
      btn.textContent = "Change filters";
      btn.addEventListener("click", openSheet);
    }
    node.append(h, p, btn);
    el.feed.appendChild(node);
  }

  function resetFeed() {
    for (const s of slides) observer.unobserve(s.el);
    el.feed.replaceChildren();
    slides = [];
    deck = [];
    current = 0;
    clearNudge();
    pool = computePool();
    feedKey = JSON.stringify([prefs.feed, prefs.area, prefs.cert]);
    if (pool.length) append(1); // the next slide is added only after this one is answered
    else renderEmpty();
    el.feed.scrollTop = 0;
    updateScope();
    scheduleNudge();
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
      const i = slides.indexOf(entry.target._item);
      if (i < 0 || i === current) continue;
      const prev = slides[current];
      if (i === current + 1 && prev && prev.answered) { learn.nexts += 1; saveLearn(); }
      current = i;
      scheduleNudge();
    }
  }, { root: el.feed, threshold: [0.6] });

  // Once you've moved on, drop the questions above so you can't scroll back to them.
  let settleTimer = 0;
  function dropPassed() {
    clearTimeout(settleTimer);
    const h = el.feed.clientHeight || 1;
    const idx = Math.round(el.feed.scrollTop / h);
    if (idx <= 0 || !slides[idx] || Math.abs(el.feed.scrollTop - idx * h) > 2) return; // still moving
    const gone = slides.splice(0, idx);
    for (const s of gone) { observer.unobserve(s.el); s.el.remove(); }
    current = 0;
    el.feed.scrollTop = 0;
  }
  el.feed.addEventListener("scroll", () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(dropPassed, 200);
  }, { passive: true });
  if ("onscrollend" in window) el.feed.addEventListener("scrollend", dropPassed);

  function goTo(i) {
    const item = slides[Math.max(0, Math.min(i, slides.length - 1))];
    if (item) item.el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  }

  // ---------- learning cues ----------
  function saveLearn() {
    store(KEYS.learn, learn);
    applyLearn();
  }
  function applyLearn() {
    const stage = document.getElementById("app");
    stage.classList.toggle("learn-next", learn.nexts < LEARN_NEXTS);
  }

  let nudgeTimer = 0;
  function clearNudge() {
    clearTimeout(nudgeTimer);
    for (const q of el.feed.querySelectorAll(".q.nudge")) q.classList.remove("nudge");
  }
  function scheduleNudge() {
    clearNudge();
    if (learn.answers >= NUDGE_ANSWERS || reduceMotion()) return;
    const item = slides[current];
    if (!item || item.answered) return;
    nudgeTimer = setTimeout(() => {
      if (!el.coach.hidden || el.sheet.open || item !== slides[current] || item.answered) return;
      const q = item.el.querySelector(".q");
      q.classList.add("nudge");
      q.addEventListener("animationend", () => q.classList.remove("nudge"), { once: true });
    }, NUDGE_DELAY);
  }

  // ---------- answering ----------
  function answer(item, saidTrue) {
    if (!item || item.answered) return;
    item.answered = true;
    const { q, showsTrue, el: node } = item;
    const right = saidTrue === showsTrue;

    node.classList.add("answered", right ? "right" : "wrong", saidTrue ? "said-true" : "said-false");
    node.style.setProperty("--lean", 0);
    const card = node.querySelector(".q");
    card.style.transform = "";

    // The icon and flash show right or wrong; the words are for screen readers.
    node.querySelector(".verdict").textContent = `${right ? "Correct." : "Not quite."} The statement was ${showsTrue ? "true" : "false"}.`;
    // The results screen is just a right/wrong icon (from the slide's class) and the explanation.
    node.querySelector(".explanation").textContent = q.x;
    node.querySelector(".act-source").title = verifiedText(q);
    node.querySelector(".reveal").hidden = false;
    node.querySelector(".btn-next").hidden = false;
    for (const b of node.querySelectorAll(".sr-answer")) b.hidden = true;
    node.querySelector(".act-source").hidden = false;
    clearNudge();
    learn.answers += 1;
    saveLearn();

    if (!reduceMotion()) {
      node.querySelector(".flash").animate([{ opacity: 0.45 }, { opacity: 0 }], { duration: 900, easing: "ease-out" });
    }
    buzz(right ? 12 : [24, 50, 24]);
    record(right);
    // Unlock the next question now that this one is answered.
    if (slides[slides.length - 1] === item) append(1);
  }

  const verifiedText = (q) => `Verified for ${q.release}${q.featureStatus && q.featureStatus !== "current" ? ` (${q.featureStatus})` : ""}`;



  function record(right) {
    const day = todayKey();
    const d = stats.days[day] || [0, 0];
    d[0] += 1;
    if (right) d[1] += 1;
    stats.days[day] = d;
    stats.total += 1;
    if (right) { stats.correct += 1; stats.streak += 1; stats.best = Math.max(stats.best, stats.streak); }
    else stats.streak = 0;
    // Keep about a year of daily totals.
    const days = Object.keys(stats.days).sort();
    for (const old of days.slice(0, Math.max(0, days.length - 400))) delete stats.days[old];
    store(KEYS.stats, stats);

    updateTop(right);
    if (right && stats.streak > 0 && stats.streak % 10 === 0) setTimeout(() => toast(`${stats.streak} in a row`), 350);
  }

  function updateTop(bump) {
    el.streak.textContent = stats.streak;
    if (bump && stats.streak > 0 && !reduceMotion()) {
      const s = el.streak.parentElement;
      s.classList.remove("bump"); void s.offsetWidth; s.classList.add("bump");
    }
  }

  function updateScope() {
    el.scope.textContent = prefs.feed === "saved" ? "Saved"
      : prefs.area ? areaName(prefs.area)
      : prefs.cert ? certName(prefs.cert)
      : "All areas";
  }

  // ---------- saving ----------
  function syncSaveButton(item) {
    const btn = item.el.querySelector(".act-save");
    const on = saved.has(item.q.id);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Saved" : "Save");
  }

  function setSaved(item, on) {
    const was = saved.has(item.q.id);
    if (on) saved.add(item.q.id); else saved.delete(item.q.id);
    store(KEYS.saved, [...saved]);
    // The same question can sit on more than one slide after a reshuffle.
    for (const s of slides) if (s.q.id === item.q.id) syncSaveButton(s);
    const btn = item.el.querySelector(".act-save");
    if (on && !was && !reduceMotion()) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
    if (on !== was) toast(on ? "Saved" : "Removed from saved");
  }

  function burst(item, x, y) {
    if (reduceMotion()) return;
    const rect = item.el.getBoundingClientRect();
    const b = document.createElement("div");
    b.className = "burst";
    b.innerHTML = BOOKMARK_SVG;
    b.style.left = `${x - rect.left}px`;
    b.style.top = `${y - rect.top}px`;
    item.el.appendChild(b);
    b.addEventListener("animationend", () => b.remove());
  }

  async function share(item) {
    const text = `True or false? ${item.showsTrue ? item.q.t : item.q.f}`;
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) { await navigator.share({ title: "Salesforce true or false", text, url }); return; }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("Copied to share");
    } catch (err) {
      if (err && err.name !== "AbortError") toast("Couldn't share this one");
    }
  }

  // ---------- gestures ----------
  let drag = null;
  let tap = null;
  let lastTap = null;

  el.feed.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tap = { x: e.clientX, y: e.clientY, t: performance.now() };
    clearNudge();
    const card = e.target.closest(".q");
    const slide = e.target.closest(".slide");
    const item = slide && slide._item;
    if (!card || !item || item.answered) return;
    const now = performance.now();
    drag = { item, card, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, lastX: e.clientX, lastT: now, v: 0, horizontal: null };
    card.classList.remove("settle");
  });

  el.feed.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.horizontal === null && Math.hypot(dx, dy) > 8) {
      drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.1;
      if (drag.horizontal) { try { drag.card.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
      else { drag = null; return; } // vertical: let the feed scroll
    }
    if (!drag.horizontal) return;
    const now = performance.now();
    drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
    drag.lastX = e.clientX; drag.lastT = now; drag.dx = dx;
    drag.card.classList.add("dragging");
    drag.card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    drag.item.el.style.setProperty("--lean", Math.max(-1, Math.min(1, dx / 120)).toFixed(3));
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { item, card, dx, v, horizontal } = drag;
    drag = null;
    card.classList.remove("dragging");
    card.classList.add("settle");
    card.style.transform = "";
    item.el.style.setProperty("--lean", 0);
    if (horizontal && (Math.abs(dx) > SWIPE_DISTANCE || (Math.abs(v) > SWIPE_VELOCITY && Math.abs(dx) > 30))) {
      answer(item, dx > 0); // right = true, left = false
    }
  }
  el.feed.addEventListener("pointercancel", endDrag);
  el.feed.addEventListener("pointerup", (e) => {
    endDrag(e);
    // Double-tap anywhere on a slide (except its buttons) saves it, like a Reels like.
    const t = tap; tap = null;
    if (!t || e.target.closest("button, a")) return;
    const now = performance.now();
    if (now - t.t > 300 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12) { lastTap = null; return; }
    const slide = e.target.closest(".slide");
    const item = slide && slide._item;
    if (!item) return;
    if (lastTap && lastTap.item === item && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      lastTap = null;
      burst(item, e.clientX, e.clientY);
      setSaved(item, true);
    } else {
      lastTap = { item, t: now, x: e.clientX, y: e.clientY };
    }
  });
  el.feed.addEventListener("dblclick", (e) => e.preventDefault());

  // Buttons inside slides
  el.feed.addEventListener("click", (e) => {
    const slide = e.target.closest(".slide");
    const item = slide && slide._item;
    if (!item) return;
    if (e.target.closest(".act-source")) toast(verifiedText(item.q));
    const ans = e.target.closest("[data-answer]");
    if (ans) { answer(item, ans.dataset.answer === "true"); return; }
    if (e.target.closest(".btn-next")) { goTo(slides.indexOf(item) + 1); return; }
    if (e.target.closest(".act-save")) { setSaved(item, !saved.has(item.q.id)); return; }
    if (e.target.closest(".act-share")) { share(item); }
  });

  // Keyboard: ←/→ answer, ↑/↓ (or j/k, space) move, s saves
  document.addEventListener("keydown", (e) => {
    if (el.sheet.open || !el.coach.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest("select, input")) return;
    const item = slides[current];
    if (!item) return;
    const k = e.key;
    if ((k === "ArrowRight" || k === "ArrowLeft") && !item.answered) { e.preventDefault(); answer(item, k === "ArrowRight"); }
    else if ((k === "ArrowDown" || k === "j" || (k === " " && !e.shiftKey)) && !e.repeat) { e.preventDefault(); goTo(current + 1); }
    else if ((k === "ArrowUp" || k === "k" || (k === " " && e.shiftKey)) && !e.repeat) { e.preventDefault(); goTo(current - 1); }
    else if (k === "s") setSaved(item, !saved.has(item.q.id));
  });

  // ---------- filters sheet ----------
  function fillSelect(select, values, label) {
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = label(v);
      select.appendChild(opt);
    }
  }

  function savePrefs() { store(KEYS.prefs, prefs); }

  function readSheet() {
    const f = el.sheetForm;
    prefs.feed = f.querySelector("input[name=feed]:checked").value;
    prefs.area = el.area.value;
    prefs.cert = el.cert.value;
    savePrefs();
  }

  function writeSheet() {
    const f = el.sheetForm;
    const feedInput = f.querySelector(`input[name=feed][value="${prefs.feed}"]`);
    if (feedInput) feedInput.checked = true;
    el.area.value = prefs.area;
    el.cert.value = prefs.cert;
    if (el.area.value !== prefs.area) prefs.area = "";
    if (el.cert.value !== prefs.cert) prefs.cert = "";
    el.savedCount.textContent = saved.size;
    const [answered, correct] = stats.days[todayKey()] || [0, 0];
    el.sToday.textContent = answered ? `${correct}/${answered}` : "0";
    el.sBest.textContent = stats.best;
    el.sAll.textContent = stats.total ? `${Math.round((stats.correct / stats.total) * 100)}%` : "–";
    el.sAll.title = `${stats.correct} of ${stats.total} correct`;
    updatePoolCount();
  }

  function updatePoolCount() {
    const n = computePool().length;
    el.poolCount.textContent = n === 0
      ? (prefs.feed === "saved" ? "No saved questions match these filters." : "No questions match these filters yet.")
      : `${n} question${n === 1 ? "" : "s"} in your feed, in random order.`;
  }

  function openSheet() {
    writeSheet();
    el.sheet.showModal();
  }

  el.filterBtn.addEventListener("click", openSheet);
  el.sheetForm.addEventListener("change", () => { readSheet(); updatePoolCount(); updateTop(false); });
  el.sheet.addEventListener("close", () => {
    readSheet();
    updateTop(false);
    if (JSON.stringify([prefs.feed, prefs.area, prefs.cert]) !== feedKey) resetFeed();
  });
  // Tap the dimmed backdrop to close
  el.sheet.addEventListener("click", (e) => { if (e.target === el.sheet) el.sheet.close(); });

  el.exportBtn.addEventListener("click", async () => {
    const text = JSON.stringify({ exported: new Date().toISOString(), stats, saved: [...saved], sessions: load(KEYS.history, []) }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      el.exportBtn.textContent = "Copied";
    } catch {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = "salesforce-quiz-history.json";
      a.click();
      el.exportBtn.textContent = "Downloaded";
    }
    setTimeout(() => { el.exportBtn.textContent = "Copy scores"; }, 2200);
  });

  // ---------- coach marks ----------
  el.coachGo.addEventListener("click", () => {
    el.coach.hidden = true;
    store(KEYS.coach, true);
    scheduleNudge();
    const first = slides[0];
    if (first) first.el.querySelector(".q").focus({ preventScroll: true });
  });

  // ---------- load ----------
  async function loadQuestions() {
    for (const url of ["questions.json", "../index/questions.json"]) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) return (await res.json()).questions || [];
      } catch { /* try the next location */ }
    }
    throw new Error("Couldn't load the questions. Check your connection and reload the page.");
  }

  async function init() {
    applyLearn();
    updateTop(false);
    updateScope();
    if (!load(KEYS.coach, false)) el.coach.hidden = false;
    try {
      all = await loadQuestions();
    } catch (err) {
      el.loadError.textContent = err.message;
      el.loadError.hidden = false;
      return;
    }
    const active = all.filter((q) => q.status === "active");
    fillSelect(el.area, [...new Set(active.map((q) => q.area))].sort((a, b) => areaName(a).localeCompare(areaName(b))), areaName);
    fillSelect(el.cert, [...new Set(active.flatMap((q) => q.certs))].sort((a, b) => certName(a).localeCompare(certName(b))), certName);
    writeSheet(); // drops a saved area or cert that no longer exists
    savePrefs();
    resetFeed();
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
})();
