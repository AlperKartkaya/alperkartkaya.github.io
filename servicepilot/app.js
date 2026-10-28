// ServicePilot UI — vanilla JS, no build step (ADR-1).
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const num = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));
const ACTION_TR = { ROUTE: "ROUTE · Yönlendir", REQUEST_EVIDENCE: "REQUEST EVIDENCE · Kanıt iste", ESCALATE: "ESCALATE · İnsan uzmana" };
const STATUS_TR = { routed: "Yönlendirildi", awaiting_evidence: "Kanıt bekleniyor", escalated: "Eskale" };
// Same text as app/scenarios.py NO_FINDING (fallback answer when a scenario has none).
const NO_FINDING = "Kontrol edildi, belirgin bir bulgu yok / değerler normal.";

const S = { catalog: null, settings: null, cases: [], scenarios: [], selected: null };

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.status));
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${label}`;
  try { return await fn(); }
  catch (e) { toast(`Hata: ${e.message}`); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

const nodeLabel = (id) => (id === "expert_desk" ? "Merkez Uzman Masası (ProEye)" : S.catalog.nodes[id]?.label ?? id);
const depth = (id) => { let d = 0; while ((id = S.catalog.nodes[id].parent)) d++; return d; };
const ancestors = (id) => { const out = []; while ((id = S.catalog.nodes[id]?.parent)) out.push(id); return out; };

// ---------- KPIs (FR-14) ----------
function renderKpis() {
  const c = S.cases, n = c.length;
  const closed = c.filter((x) => x.final);
  const routed = c.filter((x) => x.status === "routed").length;
  const esc_ = c.filter((x) => x.status === "escalated").length;
  const steps = c.flatMap((x) => x.steps).filter((s) => s.signals);
  const lat = steps.length ? steps.reduce((a, s) => a + s.latency_ms, 0) / steps.length : null;
  const req = closed.length ? closed.reduce((a, x) => a + x.evidence.length, 0) / closed.length : null;
  const items = [
    ["Vaka", n], ["Kanıt bekleyen", c.filter((x) => x.status === "awaiting_evidence").length],
    ["Otomatik route", n ? pct(routed / n) : "—"], ["Eskalasyon", n ? pct(esc_ / n) : "—"],
    ["Kanıt isteği / vaka", req == null ? "—" : num(req, 1)], ["Jev gecikmesi", lat == null ? "—" : `${Math.round(lat)} ms`],
  ];
  $("#kpis").innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

// ---------- Case list ----------
function renderCaseList() {
  const el = $("#case-list");
  if (!S.cases.length) {
    el.innerHTML = `<div class="empty">Henüz vaka yok.<br><a href="#new">Yeni vaka açın</a> veya demo senaryosu seçin.</div>`;
    return;
  }
  el.innerHTML = S.cases.map((c) => `
    <button type="button" class="case-item" data-id="${c.id}" aria-current="${c.id === S.selected}">
      <div class="top"><strong class="mono">${c.id}</strong><span class="badge ${c.status}">${STATUS_TR[c.status]}</span></div>
      <div class="small">${esc(c.vehicle.family)}${c.final ? ` → <strong>${esc(c.final.target_label)}</strong>` : ""}</div>
      <div class="note">${esc(c.technician_note)}</div>
    </button>`).join("");
}

// ---------- Case detail (FR-8, FR-9) ----------
function bar(name, p, { thr, cls = "", hit = false } = {}) {
  return `<div class="bar ${cls} ${hit ? "hit" : ""}">
    <span class="name" title="${esc(name)}">${esc(name)}</span>
    <span class="track"><span class="fill" style="width:${Math.max(0, Math.min(1, p)) * 100}%; display:block"></span>${thr != null ? `<span class="thr" style="left:${thr * 100}%" title="eşik ${thr}"></span>` : ""}</span>
    <span class="val">${num(p)}</span></div>`;
}

function renderDetail() {
  const el = $("#case-detail");
  const c = S.cases.find((x) => x.id === S.selected);
  if (!c) {
    el.innerHTML = `<div class="empty">Soldan bir vaka seçin.</div>`;
    return;
  }
  const step = c.steps.at(-1), d = step.decision, sig = step.signals, st = S.settings;
  const ev = d.evidence_id ? S.catalog.evidence[d.evidence_id] : null;
  const scenario = S.scenarios.find((s) => s.id === c.scenario_id);

  const decision = `
    <section class="card decision ${d.action}" aria-labelledby="dec-h">
      <h3 id="dec-h">RAEP kararı · adım ${c.steps.length}${step.recomputed ? " · yeniden hesaplandı" : ""}</h3>
      <div class="action">${ACTION_TR[d.action]}</div>
      <div class="target">${d.action === "REQUEST_EVIDENCE" ? esc(ev.label) : esc(d.target_label)}</div>
      <p class="reason">${esc(d.reason)}</p>
      <div>
        ${d.safety_hits.length ? `<span class="chip">Safety gate: ${esc(d.safety_hits.join(", "))}</span>` : ""}
        ${d.baseline_one_shot ? `<span class="chip">Baseline C (Jev tek-shot): ${esc(nodeLabel(d.baseline_one_shot))}</span>` : ""}
        ${d.risk != null ? `<span class="chip">Risk R(s) = ${num(d.risk, 3)} · L = ${num(d.loss_weight)} · err = ${num(d.err, 3)}</span>` : ""}
        <span class="chip">Jev ${sig ? `${step.latency_ms} ms` : "çağrılmadı"}</span>
      </div>
      ${c.status === "awaiting_evidence" ? `
        <form class="evidence-req" id="ev-form">
          <label for="ev-result"><strong>Teknisyenden istenen kanıt:</strong> ${esc(ev.label)}</label>
          <p class="muted small">Maliyet varsayımı: ${ev.T} dk · efor ${ev.E}/5 · güvenlik ${ev.S}/5 · ρ=${ev.rho}</p>
          <textarea id="ev-result" name="result" rows="2" required placeholder="Ölçüm / gözlem sonucu…"></textarea>
          <div class="actions">
            <button type="submit" class="primary">Kanıtı gönder ve yeniden karar al</button>
            ${scenario ? `<button type="button" class="ghost" id="fill-ev">Senaryo cevabını doldur</button>` : ""}
          </div>
        </form>` : ""}
      <div class="actions" style="margin-top:.7rem">
        <button type="button" class="small ghost" id="recompute" ${sig || d.safety_hits.length ? "" : "disabled"}>Güncel ayarlarla yeniden hesapla (Jev çağrısız)</button>
      </div>
    </section>`;

  let signals = `<section class="card"><h3>Jev sinyalleri</h3><p class="muted">${d.safety_hits.length ? "Safety gate tetiklendiği için Jev çağrılmadı." : "Jev erişilemedi."}</p></section>`;
  if (sig) {
    const leaves = Object.entries(d.nodes).filter(([k]) => S.catalog.leaves.includes(k)).sort((a, b) => b[1] - a[1]);
    signals = `
      <section class="card">
        <h3>Jev sinyalleri (semantic sensor)</h3>
        <div class="bars">
          ${bar("sufficient (yeterli)", sig.sufficient, { thr: st.tau_suff, cls: "suff" })}
          ${bar("critical (risk)", sig.critical, { thr: st.tau_crit, cls: "crit" })}
          ${bar(`priority · ${num(sig.priority.score, 1)} / 3`, sig.priority.score / 3)}
        </div>
        <h3 style="margin-top:1rem">Route · yaprak olasılıkları</h3>
        <div class="bars">${leaves.slice(0, 5).map(([k, p]) => bar(nodeLabel(k), p, { thr: st.tau_route, hit: k === d.target })).join("")}</div>
      </section>`;
  }

  const tree = sig ? `
    <section class="card">
      <h3>Hiyerarşik uzmanlık ağacı · P(düğüm)</h3>
      <div class="bars">${Object.keys(S.catalog.nodes).map((k) => bar(nodeLabel(k), d.nodes[k] ?? 0, { thr: st.tau_route, cls: `depth-${depth(k)}`, hit: k === d.target })).join("")}</div>
      <p class="muted small">Dikey çizgi τ_route = ${st.tau_route}. Yaprakta güven yoksa eşiği geçen en derin düğüme yönlendirilir.</p>
    </section>` : "";

  const cands = sig ? `
    <section class="card">
      <h3>Aday kanıtlar · U(e) = L·Δerr − λ·C</h3>
      <table>
        <thead><tr><th>Kanıt</th><th class="num">Risk azalması</th><th class="num">Maliyet C</th><th class="num">U</th></tr></thead>
        <tbody>${d.candidates.map((x) => `<tr class="${x.id === d.evidence_id ? "chosen" : ""}">
          <td>${esc(x.label)}</td><td class="num">${num(x.gain, 3)}</td><td class="num">${num(x.cost, 3)}</td>
          <td class="num ${x.U > 0 ? "pos" : "neg"}">${num(x.U, 3)}</td></tr>`).join("")}</tbody>
      </table>
      ${Object.keys(d.skipped).length ? `<p class="muted small" style="margin-top:.6rem">Aday dışı: ${Object.entries(d.skipped).map(([k, v]) => `${esc(S.catalog.evidence[k].label)} (${esc(v)})`).join(" · ")}</p>` : ""}
    </section>` : "";

  const tl = c.steps.map((s, i) => `
    ${i > 0 && c.evidence[i - 1] ? `<li class="ev">📎 <strong>${esc(c.evidence[i - 1].label)}:</strong> ${esc(c.evidence[i - 1].result)}</li>` : ""}
    <li><span class="badge ${s.decision.action}">${s.decision.action}</span>
      ${s.decision.action === "REQUEST_EVIDENCE" ? esc(S.catalog.evidence[s.decision.evidence_id].label) : esc(s.decision.target_label)}
      <span class="muted small">· ${s.signals ? `${s.latency_ms} ms` : "Jev yok"}${s.recomputed ? " · yeniden hesaplandı" : ""}</span></li>`).join("");

  el.innerHTML = `
    <div class="detail-head">
      <div><h1 class="mono">${c.id}</h1>
        <div class="meta">${esc(c.vehicle.family)} · ${c.vehicle.fuel === "electric" ? "Elektrik" : "Dizel"} · ${Number(c.vehicle.km).toLocaleString("tr-TR")} km${scenario ? ` · senaryo: ${esc(scenario.title)}` : ""}</div></div>
      <span class="badge ${c.status}">${STATUS_TR[c.status]}</span>
    </div>
    ${decision}
    <div class="grid2">${signals}${tree}</div>
    ${cands}
    <div class="grid2">
      <section class="card"><h3>Vaka bilgisi</h3>
        <dl class="facts">
          <dt>Teknisyen notu</dt><dd>${esc(c.technician_note)}</dd>
          <dt>DTC</dt><dd class="mono">${esc(c.dtc_codes.join(", ") || "—")}</dd>
          <dt>Son onarımlar</dt><dd>${esc(c.recent_repairs || "—")}</dd>
          ${scenario ? `<dt>Beklenen (senaryo)</dt><dd>${esc(scenario.expected === "ESCALATE" ? "ESCALATE" : nodeLabel(scenario.expected))}</dd>` : ""}
        </dl></section>
      <section class="card"><h3>Karar zaman çizelgesi</h3><ol class="timeline">${tl}</ol></section>
    </div>`;

  $("#ev-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = $("#ev-result").value.trim();
    if (!result) return $("#ev-result").focus();
    await busy(e.submitter, "Jev + RAEP…", async () => {
      upsert(await api(`/cases/${c.id}/evidence`, { method: "POST", body: { evidence_id: d.evidence_id, result } }));
    });
  });
  $("#fill-ev")?.addEventListener("click", () => { $("#ev-result").value = scenario.answers[d.evidence_id] ?? NO_FINDING; });
  $("#recompute")?.addEventListener("click", (e) => busy(e.currentTarget, "Hesaplanıyor…", async () => {
    upsert(await api(`/cases/${c.id}/recompute`, { method: "POST" }));
    toast("Karar güncel politika ayarlarıyla yeniden hesaplandı.");
  }));
}

function upsert(c) {
  const i = S.cases.findIndex((x) => x.id === c.id);
  if (i >= 0) S.cases[i] = c; else S.cases.unshift(c);
  S.selected = c.id;
  renderAll();
}

// ---------- New case (FR-1, FR-12) ----------
function renderScenarios() {
  $("#scenarios").innerHTML = S.scenarios.map((s) => `
    <button type="button" class="card scenario" data-scenario="${s.id}">
      <strong>${esc(s.title)}</strong>
      <span>${esc(s.vehicle.family)} · ${s.vehicle.fuel === "electric" ? "Elektrik" : "Dizel"}</span>
      <span>Beklenen: ${esc(s.expected === "ESCALATE" ? "ESCALATE" : nodeLabel(s.expected))}</span>
    </button>`).join("");
}

async function createCase(body, btn) {
  await busy(btn, "Jev + RAEP…", async () => {
    const c = await api("/cases", { method: "POST", body });
    upsert(c);
    location.hash = `#cases/${c.id}`;
  });
}

// ---------- Queues (FR-11) ----------
function renderQueues() {
  const groups = {};
  for (const c of S.cases.filter((x) => x.final)) (groups[c.final.target] ??= []).push(c);
  const order = ["expert_desk", ...Object.keys(S.catalog.nodes)];
  $("#queues").innerHTML = order.filter((k) => groups[k] || S.catalog.leaves.includes(k) || k === "expert_desk").map((k) => {
    const fallback = k !== "expert_desk" && !S.catalog.leaves.includes(k);
    return `<section class="card queue ${k === "expert_desk" ? "desk" : ""} ${fallback ? "fallback" : ""}">
      <h2><span>${esc(nodeLabel(k))}${fallback ? " <small class='muted'>(üst düğüm)</small>" : ""}</span><span class="muted">${groups[k]?.length ?? 0}</span></h2>
      ${(groups[k] ?? []).map((c) => `<a href="#cases/${c.id}"><span class="mono">${c.id}</span> · ${esc(c.vehicle.family)}<br><span class="muted small">${esc(c.technician_note.slice(0, 70))}</span></a>`).join("") || `<p class="muted small">Boş</p>`}
    </section>`;
  }).join("");
}

// ---------- Replay (FR-13) ----------
function correct(expected, x) {
  if (expected === "ESCALATE") return x.action === "ESCALATE" ? "ok" : "bad";
  if (x.target === expected) return "ok";
  return x.action === "ROUTE" && ancestors(expected).includes(x.target) ? "hier" : "bad";
}
const mark = (r) => ({ ok: `<span class="ok">✓</span>`, hier: `<span class="pos">≈</span>`, bad: `<span class="bad">✗</span>` })[r];

function renderReplay(data) {
  const names = { servicepilot: "ServicePilot (Jev + RAEP)", baseline_b: "Baseline B · sabit checklist", baseline_c: "Baseline C · Jev tek-shot" };
  const m = (k) => data.systems[k];
  const cards = Object.keys(names).map((k) => `
    <section class="card ${k === "servicepilot" ? "sp" : ""}"><h3>${names[k]}</h3><dl>
      <dt>Tam doğruluk</dt><dd>${pct(m(k).exact_acc)}</dd>
      <dt>Hiyerarşik doğruluk</dt><dd>${pct(m(k).hier_acc)}</dd>
      <dt>Otomasyon coverage</dt><dd>${pct(m(k).coverage)}</dd>
      <dt>Yanlış otomatik route</dt><dd class="${m(k).wrong_route ? "bad" : "ok"}">${m(k).wrong_route}</dd>
      <dt>Kritik eskalasyon recall</dt><dd class="${m(k).critical_recall === 1 ? "ok" : "bad"}">${pct(m(k).critical_recall)}</dd>
      <dt>Ort. kanıt isteği</dt><dd>${num(m(k).avg_requests, 2)}</dd>
      <dt>Ort. kanıt maliyeti C</dt><dd>${num(m(k).avg_cost, 3)}</dd>
    </dl></section>`).join("");
  const cell = (r, k) => {
    const x = r[k];
    return `<td>${mark(correct(r.expected, x))} ${x.action === "ESCALATE" ? `<span class="badge ESCALATE">ESCALATE</span>` : esc(x.target_label)}
      ${x.requests ? `<div class="muted small">${x.requests} kanıt · C=${num(x.cost, 2)}</div>` : ""}</td>`;
  };
  $("#replay-out").innerHTML = `
    <div class="metric-cards">${cards}</div>
    <section class="card"><h3>Senaryo bazında</h3>
      <table><thead><tr><th>Senaryo</th><th>Beklenen</th><th>ServicePilot</th><th>Baseline B</th><th>Baseline C</th></tr></thead>
      <tbody>${data.rows.map((r) => `<tr>
        <td><strong>${esc(r.title)}</strong>${r.servicepilot.evidence.length ? `<div class="muted small">İstenen: ${esc(r.servicepilot.evidence.join(" → "))}</div>` : ""}</td>
        <td>${esc(r.expected_label)}</td>${cell(r, "servicepilot")}${cell(r, "baseline_b")}${cell(r, "baseline_c")}</tr>`).join("")}</tbody></table>
      <p class="muted small">✓ tam doğru · ≈ doğru üst uzmanlık (hiyerarşik) · ✗ yanlış. Baseline'lar eskale edemez; kritik vakalarda otomatik route ederler.</p>
    </section>`;
}

// ---------- Policy (FR-10) ----------
const POLICY = [
  ["tau_route", "τ_route · otomatik yönlendirme eşiği", 0.5, 0.99, 0.01, "Bir uzmanlık düğümüne route için gereken minimum olasılık."],
  ["tau_suff", "τ_suff · kanıt yeterlilik eşiği", 0, 1, 0.01, "Yaprağa doğrudan route için Jev sufficient alt sınırı."],
  ["tau_crit", "τ_crit · kritik eskalasyon eşiği", 0.1, 0.99, 0.01, "Jev critical bu değeri geçerse insan uzmana eskale."],
  ["lambda", "λ · maliyet ağırlığı", 0, 3, 0.05, "Yüksek λ = daha az kanıt isteği, daha erken karar."],
  ["w_crit", "w_crit · kritik kayıp çarpanı", 0, 10, 0.5, "L = 1 + w_crit·p_crit; kritik vakada belirsizlik daha pahalı."],
  ["alpha", "α · süre ağırlığı (dakika başına)", 0, 0.05, 0.001, ""],
  ["beta", "β · efor ağırlığı", 0, 0.2, 0.005, ""],
  ["gamma", "γ · güvenlik/operasyon ağırlığı", 0, 0.5, 0.01, ""],
  ["max_requests", "Maksimum kanıt isteği", 0, 8, 1, "Limit dolunca hiyerarşik fallback veya eskalasyon."],
];

function renderPolicy() {
  const f = $("#policy-form");
  f.innerHTML = POLICY.map(([k, l, min, max, step, help]) => `
    <div class="field">
      <label for="p-${k}">${l}: <output id="o-${k}" for="p-${k}">${S.settings[k]}</output></label>
      <input type="range" id="p-${k}" name="${k}" min="${min}" max="${max}" step="${step}" value="${S.settings[k]}" ${help ? `aria-describedby="h-${k}"` : ""}>
      ${help ? `<span class="hint" id="h-${k}">${esc(help)}</span>` : ""}
    </div>`).join("") + `
    <div class="actions"><button type="submit" class="primary">Ayarları kaydet</button>
    <button type="button" class="ghost" id="policy-default">Varsayılanlara dön</button></div>`;
  f.oninput = (e) => { if (e.target.name) $(`#o-${e.target.name}`).value = e.target.value; };

  $("#evidence-catalog").innerHTML = `<h2>Kanıt kataloğu (varsayım)</h2><table>
    <thead><tr><th>Kanıt</th><th class="num">T dk</th><th class="num">E</th><th class="num">S</th><th class="num">ρ</th><th>Ayırt ettiği uzmanlıklar</th></tr></thead>
    <tbody>${Object.values(S.catalog.evidence).map((e) => `<tr><td>${esc(e.label)}${e.requires_ev ? " <span class='chip'>EV</span>" : ""}</td>
      <td class="num">${e.T}</td><td class="num">${e.E}</td><td class="num">${e.S}</td><td class="num">${e.rho}</td>
      <td class="small muted">${e.informs.map(nodeLabel).join(", ")}</td></tr>`).join("")}</tbody></table>`;
}

async function savePolicy(values, btn) {
  await busy(btn, "Kaydediliyor…", async () => {
    S.settings = await api("/settings", { method: "PUT", body: values });
    renderPolicy();
    toast("Politika kaydedildi. Yeni kararlar bu ayarları kullanır.");
  });
}

// ---------- Routing / wiring ----------
function show() {
  const [view, id] = (location.hash.slice(1) || "cases").split("/");
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== view));
  document.querySelectorAll(".sidenav a").forEach((a) => (a.dataset.view === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (view === "cases") {
    S.selected = id ?? S.selected ?? S.cases[0]?.id;
    renderCaseList();
    renderDetail();
  }
  if (view === "queues") renderQueues();
}

function renderAll() {
  renderKpis();
  show();
}

document.addEventListener("click", async (e) => {
  const item = e.target.closest(".case-item");
  if (item) location.hash = `#cases/${item.dataset.id}`;
  const sc = e.target.closest("[data-scenario]");
  if (sc) {
    const s = S.scenarios.find((x) => x.id === sc.dataset.scenario);
    createCase({ vehicle: s.vehicle, technician_note: s.technician_note, dtc_codes: s.dtc_codes, recent_repairs: s.recent_repairs, scenario_id: s.id }, sc);
  }
  if (e.target.id === "policy-default") savePolicy(S.catalog.default_settings, e.target);
});

$("#case-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.checkValidity()) {
    $("#form-error").textContent = "Lütfen zorunlu alanları doldurun (araç ailesi, km, en az 3 karakterlik not).";
    f.querySelector(":invalid").focus();
    return;
  }
  $("#form-error").textContent = "";
  const v = Object.fromEntries(new FormData(f));
  createCase({
    vehicle: { family: v.family, fuel: v.fuel, km: Number(v.km) },
    technician_note: v.note, dtc_codes: v.dtc.split(",").map((x) => x.trim()).filter(Boolean), recent_repairs: v.repairs,
  }, e.submitter);
});

$("#policy-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = Object.fromEntries([...new FormData(e.target)].map(([k, x]) => [k, Number(x)]));
  savePolicy(v, e.submitter);
});

$("#run-replay").addEventListener("click", (e) => busy(e.currentTarget, "Senaryolar koşuyor…", async () => renderReplay(await api("/replay", { method: "POST" }))));

$("#reset").addEventListener("click", async () => {
  if (!confirm("Tüm vakalar silinecek. Emin misiniz?")) return;
  await api("/cases", { method: "DELETE" });
  S.cases = [];
  S.selected = null;
  renderAll();
  toast("Vakalar silindi.");
});

window.addEventListener("hashchange", show);

(async function init() {
  [S.catalog, S.settings, S.cases, S.scenarios] = await Promise.all([api("/catalog"), api("/settings"), api("/cases"), api("/scenarios")]);
  renderScenarios();
  renderPolicy();
  renderAll();
})();
