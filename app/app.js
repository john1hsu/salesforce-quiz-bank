/* Salesforce true or false: swipe right = true, swipe left = false.
   Questions are drawn completely at random (no weighting); scores stay on this device. */
(() => {
  "use strict";

  const HISTORY_KEY = "sfqb.history.v1";
  const SWIPE_DISTANCE = 90;   // px past which a release counts as an answer
  const SWIPE_VELOCITY = 0.55; // px/ms flick speed that also counts

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
  const SMALL_WORDS = new Set(["and", "of", "for"]);
  const UPPER_WORDS = { ai: "AI", alm: "ALM", cta: "CTA", api: "API" };

  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $("setup"), practice: $("practice"), results: $("results"),
    form: $("setup-form"), area: $("f-area"), cert: $("f-cert"), poolCount: $("pool-count"), start: $("start"),
    historyList: $("history-list"), historyEmpty: $("history-empty"), exportBtn: $("export"), loadError: $("load-error"),
    quit: $("quit"), progressText: $("progress-text"), scoreText: $("score-text"), progressFill: $("progress-fill"),
    card: $("card"), cardArea: $("card-area"), cardText: $("card-text"),
    feedback: $("feedback"), verdict: $("verdict"), answerLine: $("answer-line"),
    trueVersion: $("true-version"), trueText: $("true-text"), explanation: $("explanation"),
    release: $("release"), sourceLink: $("source-link"), next: $("next"),
    answerButtons: $("answer-buttons"), btnTrue: $("btn-true"), btnFalse: $("btn-false"),
    resultsTitle: $("results-title"), resultsNote: $("results-note"), again: $("again"), change: $("change"),
  };

  let all = [];
  let session = null; // { items: [{q, showsTrue}], i, correct, answered, area, cert, locked }

  // ---------- helpers ----------
  const areaName = (slug) => AREA_NAMES[slug] || slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const certName = (id) => id.replace(/^kt:/, "").replace(/-certification$/, "").split("-")
    .map((w, i) => UPPER_WORDS[w] || (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

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

  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  }
  function writeHistory(entries) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* storage unavailable */ }
  }

  function show(screen) {
    for (const s of [el.setup, el.practice, el.results]) s.hidden = s !== screen;
    window.scrollTo(0, 0);
  }

  // ---------- setup ----------
  function filters() {
    const length = el.form.querySelector("input[name=length]:checked").value;
    return { area: el.area.value, cert: el.cert.value, length: length === "all" ? Infinity : Number(length) };
  }

  function pool({ area, cert }) {
    return all.filter((q) => q.status === "active" && (!area || q.area === area) && (!cert || q.certs.includes(cert)));
  }

  function fillSelect(select, values, label) {
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = label(v);
      select.appendChild(opt);
    }
  }

  function updatePoolCount() {
    const f = filters();
    const n = pool(f).length;
    el.start.disabled = n === 0;
    el.poolCount.textContent = n === 0
      ? "No questions match these filters yet. Try another area or certification."
      : `${n} question${n === 1 ? "" : "s"} available${f.length < n ? `, ${f.length} per session` : ""}.`;
  }

  function renderHistory() {
    const entries = readHistory();
    el.historyList.replaceChildren();
    for (const h of entries.slice(-5).reverse()) {
      const li = document.createElement("li");
      const when = document.createElement("span");
      when.className = "when";
      const d = new Date(h.date);
      const scope = h.area ? areaName(h.area) : h.cert ? certName(h.cert) : "All areas";
      when.textContent = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${scope}`;
      const pct = document.createElement("span");
      pct.className = "pct";
      pct.textContent = `${h.correct}/${h.answered}`;
      li.append(when, pct);
      el.historyList.appendChild(li);
    }
    el.historyEmpty.hidden = entries.length > 0;
    el.exportBtn.hidden = entries.length === 0;
  }

  async function exportHistory() {
    const text = JSON.stringify(readHistory(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      el.exportBtn.textContent = "Copied score history";
    } catch {
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "salesforce-quiz-history.json";
      a.click();
      el.exportBtn.textContent = "Downloaded score history";
    }
    setTimeout(() => { el.exportBtn.textContent = "Copy score history"; }, 2500);
  }

  // ---------- practice ----------
  function startSession() {
    const f = filters();
    const picked = shuffle(pool(f));
    const items = picked.slice(0, Math.min(f.length, picked.length))
      .map((q) => ({ q, showsTrue: randomInt(2) === 1 }));
    if (!items.length) return;
    session = { items, i: 0, correct: 0, answered: 0, area: f.area, cert: f.cert, locked: false };
    show(el.practice);
    renderCard();
  }

  function renderCard() {
    const { items, i } = session;
    const item = items[i];
    el.progressText.textContent = `${i + 1} of ${items.length}`;
    el.scoreText.textContent = session.answered ? `${session.correct} right` : "";
    el.progressFill.style.width = `${(i / items.length) * 100}%`;
    el.cardArea.textContent = areaName(item.q.area);
    el.cardText.textContent = item.showsTrue ? item.q.t : item.q.f;
    el.feedback.hidden = true;
    el.card.hidden = false;
    el.answerButtons.hidden = false;
    el.card.className = "card enter";
    el.card.style.transform = "";
    el.card.style.setProperty("--lean", 0);
    session.locked = false;
    el.card.focus({ preventScroll: true });
  }

  function answer(saidTrue) {
    if (!session || session.locked) return;
    session.locked = true;
    const item = session.items[session.i];
    const right = saidTrue === item.showsTrue;
    session.answered += 1;
    if (right) session.correct += 1;

    el.verdict.textContent = right ? "Correct" : "Not quite";
    el.verdict.className = `verdict ${right ? "right" : "wrong"}`;
    el.answerLine.textContent = `This statement is ${item.showsTrue ? "true" : "false"}.`;
    el.trueVersion.hidden = item.showsTrue;
    el.trueText.textContent = item.q.t;
    el.explanation.textContent = item.q.x;
    el.release.textContent = `Verified for ${item.q.release}.`;
    el.sourceLink.href = item.q.source;
    el.scoreText.textContent = `${session.correct} right`;
    el.progressFill.style.width = `${((session.i + 1) / session.items.length) * 100}%`;

    el.card.hidden = true;
    el.answerButtons.hidden = true;
    el.feedback.hidden = false;
    el.feedback.scrollTop = 0;
    el.next.textContent = session.i + 1 < session.items.length ? "Next question" : "See results";
    el.next.focus({ preventScroll: true });
  }

  function flyAndAnswer(saidTrue) {
    if (!session || session.locked) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { answer(saidTrue); return; }
    const width = el.card.offsetWidth || 320;
    el.card.classList.remove("dragging", "settle", "enter");
    el.card.classList.add("fly");
    el.card.style.setProperty("--lean", saidTrue ? 1 : -1);
    el.card.style.transform = `translateX(${saidTrue ? width * 1.4 : -width * 1.4}px) rotate(${saidTrue ? 18 : -18}deg)`;
    session.locked = true;
    setTimeout(() => { session.locked = false; answer(saidTrue); }, 230);
  }

  function nextCard() {
    if (!session) return;
    session.i += 1;
    if (session.i < session.items.length) renderCard();
    else finish(true);
  }

  function finish(completed) {
    if (session && session.answered) {
      const entries = readHistory();
      entries.push({ date: new Date().toISOString(), answered: session.answered, correct: session.correct,
        area: session.area || null, cert: session.cert || null });
      writeHistory(entries.slice(-200));
    }
    if (!completed || !session || !session.answered) { session = null; renderHistory(); show(el.setup); return; }
    const { correct, answered } = session;
    el.resultsTitle.textContent = `${correct} of ${answered} correct`;
    const pct = Math.round((correct / answered) * 100);
    el.resultsNote.textContent = pct === 100 ? "Every one right." : `${pct}% this session.`;
    renderHistory();
    show(el.results);
  }

  // ---------- swipe ----------
  let drag = null;
  el.card.addEventListener("pointerdown", (e) => {
    if (!session || session.locked || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, t: performance.now(), lastX: e.clientX, lastT: performance.now(), v: 0, horizontal: null };
    el.card.setPointerCapture(e.pointerId);
    el.card.classList.remove("settle", "enter");
  });
  el.card.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.horizontal === null && Math.hypot(dx, dy) > 8) drag.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!drag.horizontal) return;
    const now = performance.now();
    drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
    drag.lastX = e.clientX; drag.lastT = now; drag.dx = dx;
    el.card.classList.add("dragging");
    el.card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    el.card.style.setProperty("--lean", Math.max(-1, Math.min(1, dx / 120)).toFixed(3));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, v, horizontal } = drag;
    drag = null;
    el.card.classList.remove("dragging");
    if (horizontal && (Math.abs(dx) > SWIPE_DISTANCE || (Math.abs(v) > SWIPE_VELOCITY && Math.abs(dx) > 30))) {
      flyAndAnswer(dx > 0); // right = true, left = false
    } else {
      el.card.classList.add("settle");
      el.card.style.transform = "";
      el.card.style.setProperty("--lean", 0);
    }
  };
  el.card.addEventListener("pointerup", endDrag);
  el.card.addEventListener("pointercancel", endDrag);

  // ---------- controls ----------
  el.btnTrue.addEventListener("click", () => flyAndAnswer(true));
  el.btnFalse.addEventListener("click", () => flyAndAnswer(false));
  el.next.addEventListener("click", nextCard);
  el.quit.addEventListener("click", () => finish(true));
  el.again.addEventListener("click", startSession);
  el.change.addEventListener("click", () => { session = null; show(el.setup); });
  el.exportBtn.addEventListener("click", exportHistory);
  el.form.addEventListener("submit", (e) => { e.preventDefault(); startSession(); });
  el.form.addEventListener("change", updatePoolCount);
  document.addEventListener("keydown", (e) => {
    if (el.practice.hidden || !session) return;
    if (!el.card.hidden && e.key === "ArrowRight") { e.preventDefault(); flyAndAnswer(true); }
    else if (!el.card.hidden && e.key === "ArrowLeft") { e.preventDefault(); flyAndAnswer(false); }
  });

  // ---------- load ----------
  async function loadQuestions() {
    for (const url of ["questions.json", "../index/questions.json"]) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) return (await res.json()).questions || [];
      } catch { /* try the next location */ }
    }
    throw new Error("Couldn't load the question list. Check your connection and reload the page.");
  }

  async function init() {
    renderHistory();
    try {
      all = await loadQuestions();
    } catch (err) {
      el.loadError.textContent = err.message;
      el.loadError.hidden = false;
      el.start.disabled = true;
      return;
    }
    const active = all.filter((q) => q.status === "active");
    fillSelect(el.area, [...new Set(active.map((q) => q.area))].sort((a, b) => areaName(a).localeCompare(areaName(b))), areaName);
    fillSelect(el.cert, [...new Set(active.flatMap((q) => q.certs))].sort((a, b) => certName(a).localeCompare(certName(b))), certName);
    updatePoolCount();
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
})();
