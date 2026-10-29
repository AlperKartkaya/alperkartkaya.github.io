// ServicePilot — Active Evidence Orchestration UI (Vanilla JS, no build step).
// Works with FastAPI (/api/*) and falls back deterministically when served statically (e.g. GitHub Pages /servicepilot/).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const num = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));

const NO_FINDING = "Kontrol edildi, belirgin bir bulgu yok / değerler normal.";
const DRAFT_KEY = "servicepilot_case_draft_v1";
const LOCAL_CASES_KEY = "servicepilot_local_cases_v1";
const LOCAL_SETTINGS_KEY = "servicepilot_local_settings_v1";

// ---------- Embedded Fallback Catalog & Deterministic RAEP (for static /servicepilot/ hosting) ----------
const FALLBACK_CATALOG = {
  nodes: {
    powertrain: { label: "Güç Aktarma", parent: null, children: ["engine", "transmission"] },
    engine: { label: "Motor (ICE)", parent: "powertrain", children: [], desc: "Dizel motor mekanik ve soğutma sistemleri" },
    transmission: { label: "Şanzıman / Aktarma", parent: "powertrain", children: [], desc: "Şanzıman, kavrama ve aktarma organları" },
    electrical: { label: "Elektrik & Elektronik", parent: null, children: ["lv_electrical", "ecu_comm", "high_voltage"] },
    lv_electrical: { label: "Düşük Voltaj Elektrik", parent: "electrical", children: [], desc: "12/24V akü, marş, alternatör ve tesisat" },
    ecu_comm: { label: "ECU / CAN Haberleşme", parent: "electrical", children: [], desc: "Kontrol üniteleri, CAN hattı ve gösterge haberleşmesi" },
    high_voltage: { label: "Yüksek Voltaj", parent: "electrical", children: ["hv_battery", "hv_charging", "hv_inverter"] },
    hv_battery: { label: "HV Batarya", parent: "high_voltage", children: [], desc: "Traksiyon bataryası, BMS ve hücre dengesi" },
    hv_charging: { label: "HV Şarj", parent: "high_voltage", children: [], desc: "Şarj soketi, OBC ve şarj oturumu kontrolü" },
    hv_inverter: { label: "HV İnverter / Motor", parent: "high_voltage", children: [], desc: "İnverter, elektrik motoru ve güç elektroniği" },
    chassis: { label: "Şasi & Fren", parent: null, children: ["brakes", "steering_suspension"] },
    brakes: { label: "Fren / ABS / EBS", parent: "chassis", children: [], desc: "Havalı fren, ABS/EBS ve basınç devreleri" },
    steering_suspension: { label: "Direksiyon / Süspansiyon", parent: "chassis", children: [], desc: "Direksiyon kutusu, rot ve havalı süspansiyon" },
  },
  leaves: ["engine", "transmission", "lv_electrical", "ecu_comm", "hv_battery", "hv_charging", "hv_inverter", "brakes", "steering_suspension"],
  evidence: {
    dtc_scan: { label: "Arıza kodu (DTC) okuma + freeze-frame", T: 5, E: 1, S: 0, rho: 0.6, informs: ["engine", "transmission", "ecu_comm", "lv_electrical", "hv_inverter", "hv_battery"] },
    battery_voltage: { label: "Akü / şarj voltaj ölçümü", T: 5, E: 1, S: 0, rho: 0.85, informs: ["lv_electrical", "ecu_comm"] },
    connector_photo: { label: "Konnektör / kablo demeti yakın fotoğrafı", T: 3, E: 1, S: 0, rho: 0.5, informs: ["lv_electrical", "ecu_comm", "hv_charging"] },
    can_resistance: { label: "CAN hattı direnç ölçümü (60Ω)", T: 15, E: 3, S: 0, rho: 0.9, informs: ["ecu_comm"] },
    hv_isolation: { label: "HV izolasyon direnci ölçümü", T: 30, E: 4, S: 4, rho: 0.85, informs: ["hv_battery", "hv_inverter"], requires_ev: true },
    charging_log: { label: "Şarj oturumu hata kaydı", T: 10, E: 2, S: 0, rho: 0.8, informs: ["hv_charging", "hv_battery"], requires_ev: true },
    fluid_check: { label: "Yağ / soğutma sıvısı kontrolü", T: 10, E: 2, S: 0, rho: 0.7, informs: ["engine"] },
    trans_log: { label: "Şanzıman yağ sıcaklığı + vites logu", T: 15, E: 2, S: 0, rho: 0.85, informs: ["transmission"] },
    brake_pressure: { label: "Fren hava basıncı + kaçak testi", T: 20, E: 3, S: 1, rho: 0.9, informs: ["brakes"] },
    sound_video: { label: "Arıza anı ses / video kaydı", T: 5, E: 1, S: 0, rho: 0.5, informs: ["engine", "transmission", "steering_suspension", "brakes"] },
    road_test: { label: "Yol testinde arızayı yeniden üretme", T: 45, E: 4, S: 3, rho: 0.75, informs: ["engine", "transmission", "brakes", "steering_suspension"] },
    service_history: { label: "Son bakım / onarım geçmişi", T: 5, E: 1, S: 0, rho: 0.4, informs: ["engine", "transmission", "lv_electrical", "brakes", "steering_suspension"] },
  },
  default_settings: {
    tau_route: 0.8, tau_suff: 0.6, tau_crit: 0.75, lambda: 0.5,
    alpha: 0.01, beta: 0.05, gamma: 0.1, w_crit: 4.0, max_requests: 4,
  },
};

const SAFETY_RULES = [
  "yangın", "alev", "yanık kokusu", "fren tutmuyor", "fren boşa", "direksiyon kilit",
  "izolasyon hatası", "izolasyon arızası", "elektrik çarp", "batarya şişme", "termal kaçak",
  "fire", "brake failure", "isolation fault", "thermal runaway",
];

const FALLBACK_SCENARIOS = [
  { id: "lv_starter", title: "Marş basmıyor, tık tık ses", vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 184000 }, technician_note: "Sabah marşa basınca sadece tık tık ses geliyor, motor dönmüyor. Gösterge ışıkları sönük yanıyor.", dtc_codes: [], recent_repairs: "", expected: "lv_electrical", answers: { battery_voltage: "Kontak kapalı 21.4V, marş anında 14.8V'a düşüyor. Akü kutup başları oksitli.", connector_photo: "Akü kutup başlarında beyaz oksitlenme var, şase kablosu gevşek." } },
  { id: "can_comm", title: "Aynı anda çoklu uyarı lambası", vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 412000 }, technician_note: "Göstergede aynı anda ABS, şanzıman ve motor uyarıları yandı, birkaç saniye sonra söndü. Araç normal sürülüyor.", dtc_codes: ["U0100", "U0121"], recent_repairs: "Geçen ay gösterge paneli değişti.", expected: "ecu_comm", answers: { can_resistance: "CAN-H / CAN-L arası 120Ω ölçüldü (60Ω olmalı); bir sonlandırma direnci devre dışı.", battery_voltage: "24.6V, normal." } },
  { id: "power_loss", title: "Yokuşta çekiş kaybı (belirsiz)", vehicle: { family: "Isuzu Novo Lux", fuel: "diesel", km: 265000 }, technician_note: "Yokuşta çekiş düşüyor, araç ileri gitmekte zorlanıyor.", dtc_codes: [], recent_repairs: "", expected: "transmission", answers: { dtc_scan: "Aktif kod yok; şanzımanda geçmiş P0868 (düşük hat basıncı) kaydı var.", trans_log: "Şanzıman yağı 118°C'ye çıkıyor, 3-4 vites geçişinde patinaj kaydı var.", fluid_check: "Motor yağı ve antifriz normal seviyede." } },
  { id: "engine_overheat", title: "Hararet ve antifriz eksilmesi", vehicle: { family: "Isuzu N-Wide", fuel: "diesel", km: 98000 }, technician_note: "Uzun yolda hararet göstergesi kırmızıya yaklaşıyor, antifriz eksiliyor.", dtc_codes: ["P0217"], recent_repairs: "", expected: "engine", answers: { fluid_check: "Antifriz minimumun altında, yağda emülsiyon yok, radyatör altında sızıntı izi var." } },
  { id: "hv_charging", title: "Şarj 2-3 dakikada kesiliyor", vehicle: { family: "Isuzu Novociti Volt", fuel: "electric", km: 54000 }, technician_note: "Araç şarja takılıyor ama şarj 2-3 dakika sonra kesiliyor.", dtc_codes: [], recent_repairs: "", expected: "hv_charging", answers: { charging_log: "İstasyon kaydı: 'Vehicle-side contactor open'; oturum 140. saniyede sonlandı. Farklı istasyonda da aynı.", connector_photo: "Şarj soketinde pin 4'te renk değişimi ve yanma izi." } },
  { id: "hv_battery", title: "Menzil düşüşü + batarya sıcaklık uyarısı", vehicle: { family: "Isuzu Citivolt 12", fuel: "electric", km: 76000 }, technician_note: "Menzil son haftada belirgin düştü, batarya sıcaklık uyarısı ara ara yanıyor.", dtc_codes: [], recent_repairs: "", expected: "hv_battery", answers: { hv_isolation: "İzolasyon direnci 2.4 MΩ, normal.", charging_log: "Şarj oturumları normal tamamlanıyor; BMS modül 3'te 180 mV hücre dengesizliği uyarısı." } },
  { id: "hv_propulsion", title: "Kalkışta sarsıntı, çekiş kesiliyor", vehicle: { family: "Isuzu Citivolt 12", fuel: "electric", km: 31000 }, technician_note: "Araç kalkışta sarsılıyor, bazen çekiş tamamen kesiliyor ve 'sürüş sistemi arızası' uyarısı geliyor.", dtc_codes: ["P0A78"], recent_repairs: "", expected: "hv_inverter", answers: { hv_isolation: "İzolasyon direnci 2.1 MΩ, normal; batarya hücreleri dengeli." } },
  { id: "intermittent_stall", title: "Seyirde ara ara stop etme (belirsiz)", vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 156000 }, technician_note: "Araç seyir halindeyken ara ara stop ediyor, birkaç saniye sonra tekrar çalışıyor.", dtc_codes: [], recent_repairs: "", expected: "lv_electrical", answers: { dtc_scan: "Aktif kod yok; geçmişte U3003 (besleme voltajı) kaydı var.", battery_voltage: "Akü 24.9V normal; stop anında besleme voltajı 9V'a düşüyor.", connector_photo: "Kontak anahtarı arkasındaki konnektörde gevşeklik ve oksitlenme." } },
  { id: "critical_fire", title: "Torpido arkasından yanık kokusu", vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 520000 }, technician_note: "Sürücü torpido arkasından yanık kokusu geldiğini ve hafif duman gördüğünü bildirdi.", dtc_codes: [], recent_repairs: "", expected: "ESCALATE", answers: {} },
  { id: "critical_brake", title: "Fren pedalı derine gidiyor", vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 230000 }, technician_note: "Fren pedalı derine gidiyor, araç zor duruyor, hava basıncı uyarısı yanıyor.", dtc_codes: [], recent_repairs: "", expected: "ESCALATE", answers: {} },
  { id: "brake_noise", title: "Frende gıcırtı, performans normal", vehicle: { family: "Isuzu Novo", fuel: "diesel", km: 143000 }, technician_note: "Frenlemede arka tekerden gıcırtı sesi geliyor, frenleme performansı normal.", dtc_codes: [], recent_repairs: "", expected: "brakes", answers: { brake_pressure: "Sistem basıncı 8.2 bar, kaçak yok. Arka balatalar aşınma sınırında." } },
  { id: "steering_vibration", title: "Yüksek hızda direksiyon titremesi", vehicle: { family: "Isuzu Kendo", fuel: "diesel", km: 87000 }, technician_note: "80 km/s üzerinde direksiyonda titreme var, araç hafif sağa çekiyor.", dtc_codes: [], recent_repairs: "", expected: "steering_suspension", answers: { road_test: "80-90 km/s arası titreme belirgin, sağ ön lastikte düzensiz aşınma, rot ayarı bozuk." } },
  { id: "vague_noise", title: "Garip ses (çok eksik vaka)", vehicle: { family: "Isuzu Novo", fuel: "diesel", km: 301000 }, technician_note: "Araçta garip bir ses var, müşteri şikayetçi.", dtc_codes: [], recent_repairs: "", expected: "engine", answers: { sound_video: "Ses motor bölmesinden geliyor; rölantide metalik tıkırtı, devirle artıyor.", dtc_scan: "Aktif kod yok.", fluid_check: "Motor yağı minimumda ve koyu; antifriz normal." } },
];

// ---------- Application State ----------
const S = {
  catalog: FALLBACK_CATALOG,
  settings: { ...FALLBACK_CATALOG.default_settings },
  cases: [],
  scenarios: FALLBACK_SCENARIOS,
  selected: null,
  caseFilter: "all",
  caseSearch: "",
  reviewTab: "queue",
  formDtcs: [],
  formAttachments: [],
  modalAttachment: null,
  offlineMode: location.hostname.endsWith("github.io") || location.protocol === "file:",
};

// ---------- Helpers ----------
const nodeLabel = (id) => (id === "expert_desk" ? "Merkez Uzman Masası (ProEye)" : S.catalog.nodes[id]?.label ?? id);
const depth = (id) => {
  let d = 0;
  let cur = id;
  while ((cur = S.catalog.nodes[cur]?.parent)) d++;
  return d;
};
const ancestors = (id) => {
  const out = [];
  let cur = id;
  while ((cur = S.catalog.nodes[cur]?.parent)) out.push(cur);
  return out;
};
const leavesUnder = (node) => {
  const n = S.catalog.nodes[node];
  if (!n) return [node];
  return !n.children?.length ? [node] : n.children.flatMap(leavesUnder);
};
const hierarchyPath = (id) => {
  if (!id || id === "expert_desk") return "Merkez Teknik Destek › ProEye Masası";
  const chain = [...ancestors(id).reverse(), id].map(nodeLabel);
  return chain.join(" › ");
};

function formatTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Compute UI category for filtering (Screen B: Tümü · İnceleniyor · Kanıt Bekleniyor · Uzman Onayında · Yönlendirildi)
function caseCategory(c) {
  if (c.status === "awaiting_evidence") return "awaiting_evidence";
  if (c.status === "escalated" || c.review_status === "pending_review") return "expert_review";
  if (c.status === "routed" && c.review_status === "pending_confirmation") return "inspecting";
  return "routed";
}

function statusBadgeHtml(c) {
  const cat = caseCategory(c);
  const map = {
    awaiting_evidence: ["badge-awaiting", "Kanıt Bekleniyor"],
    expert_review: ["badge-escalated", "Uzman Onayında"],
    inspecting: ["badge-inspecting", "İnceleniyor"],
    routed: ["badge-routed", "Yönlendirildi"],
  };
  const [cls, text] = map[cat] || ["badge-neutral", c.status];
  return `<span class="badge ${cls}"><span class="badge-dot" aria-hidden="true"></span>${text}</span>`;
}

function casePriority(c) {
  const step = c.steps?.at(-1);
  const d = step?.decision;
  const sig = step?.signals;
  if (c.status === "escalated" || d?.safety_hits?.length || (sig && sig.critical >= S.settings.tau_crit)) {
    return { level: "critical", label: "Kritik", rank: 3 };
  }
  const score = sig?.priority?.score ?? 1.5;
  if (score >= 1.8 || c.status === "awaiting_evidence") {
    return { level: "high", label: "Yüksek", rank: 2 };
  }
  return { level: "normal", label: "Normal", rank: 1 };
}

function priorityBadgeHtml(c) {
  const p = casePriority(c);
  return `<span class="prio-tag prio-${p.level}">${p.label}</span>`;
}

function suggestedTeamInfo(c) {
  const step = c.steps?.at(-1);
  const d = step?.decision;
  if (c.final?.target_label) {
    return { id: c.final.target, label: c.final.target_label };
  }
  if (d?.target_label) {
    return { id: d.target, label: d.target_label };
  }
  if (d?.baseline_one_shot) {
    return { id: d.baseline_one_shot, label: nodeLabel(d.baseline_one_shot) };
  }
  return { id: "expert_desk", label: "Merkez Uzman Masası (ProEye)" };
}

// ---------- Client-Side Deterministic RAEP (for static fallback) ----------
function jsDecide(caseObj, signals, s) {
  const text = [
    caseObj.technician_note || "",
    caseObj.initial_measurements || "",
    caseObj.recent_repairs || "",
    (caseObj.dtc_codes || []).join(" "),
    ...(caseObj.evidence || []).map((e) => e.result),
  ].join(" ").toLowerCase();

  const hits = SAFETY_RULES.filter((r) => text.includes(r));
  const d = {
    action: null, target: null, target_label: null, evidence_id: null, reason: "",
    safety_hits: hits, nodes: {}, candidates: [], skipped: {},
    risk: null, err: null, loss_weight: null, baseline_one_shot: null,
  };
  const finish = (action, reason, target = null, evidence_id = null) => {
    if (action === "ESCALATE") target = "expert_desk";
    return Object.assign(d, { action, reason, target, evidence_id, target_label: target ? nodeLabel(target) : null });
  };
  if (hits.length) return finish("ESCALATE", `Güvenlik kuralı tetiklendi: ${hits.join(", ")}`);
  if (!signals) return finish("ESCALATE", "Jev erişilemedi; vaka insan uzmana yönlendirildi.");

  const leaves = S.catalog.leaves;
  const total = leaves.reduce((a, l) => a + (signals.route[l] || 0), 0) || 1;
  const route = Object.fromEntries(leaves.map((l) => [l, (signals.route[l] || 0) / total]));
  const nodes = Object.fromEntries(Object.keys(S.catalog.nodes).map((n) => [
    n, Number(leavesUnder(n).reduce((a, l) => a + (route[l] || 0), 0).toFixed(4)),
  ]));
  const best = leaves.reduce((a, b) => (route[a] >= route[b] ? a : b));
  const err = 1 - route[best];
  const pCrit = signals.critical ?? 0.08;
  const suff = signals.sufficient ?? 0.4;
  const L = 1 + s.w_crit * pCrit;

  const collected = new Set((caseObj.evidence || []).map((e) => e.id));
  const has = signals.has || {};
  const electric = caseObj.vehicle?.fuel === "electric";
  const cands = [];
  const skipped = {};

  for (const [eid, ev] of Object.entries(S.catalog.evidence)) {
    if (collected.has(eid)) skipped[eid] = "toplandı";
    else if (ev.requires_ev && !electric) skipped[eid] = "araca uygun değil";
    else if (eid === "dtc_scan" && caseObj.dtc_codes?.length) skipped[eid] = "vakada DTC var";
    else if ((has[eid] || 0) >= 0.7) skipped[eid] = `notta mevcut (Jev ${Number(has[eid]).toFixed(2)})`;
    else {
      const pOut = leaves.filter((l) => !ev.informs.includes(l)).map((l) => route[l]);
      const sumOut = pOut.reduce((a, b) => a + b, 0);
      const maxOut = pOut.length ? Math.max(...pOut) : 0;
      const errInf = sumOut - maxOut;
      const expErr = ev.rho * errInf + (1 - ev.rho) * err;
      const gain = L * (err - expErr);
      const cost = s.alpha * ev.T + s.beta * ev.E + s.gamma * ev.S;
      cands.push({
        id: eid, label: ev.label,
        gain: Number(gain.toFixed(4)), cost: Number(cost.toFixed(4)),
        U: Number((gain - s.lambda * cost).toFixed(4)),
      });
    }
  }
  cands.sort((a, b) => b.U - a.U);
  Object.assign(d, {
    nodes, candidates: cands, skipped,
    err: Number(err.toFixed(4)), loss_weight: Number(L.toFixed(3)),
    risk: Number((L * err).toFixed(4)), baseline_one_shot: best,
  });

  if (pCrit >= s.tau_crit) {
    return finish("ESCALATE", `Kritik güvenlik riski olasılığı ${pCrit.toFixed(2)} ≥ τ_crit ${s.tau_crit.toFixed(2)}.`);
  }
  if (route[best] >= s.tau_route && suff >= s.tau_suff) {
    return finish("ROUTE", `${nodeLabel(best)} olasılığı ${route[best].toFixed(2)} ve kanıt yeterliliği ${suff.toFixed(2)} eşiklerin üstünde.`, best);
  }
  const nReq = (caseObj.evidence || []).length;
  if (cands.length && cands[0].U > 0 && nReq < s.max_requests) {
    const c = cands[0];
    return finish("REQUEST_EVIDENCE", `En yüksek net fayda: ${c.label} (U=${c.U.toFixed(3)}, risk azalması ${c.gain.toFixed(3)}, maliyet ${c.cost.toFixed(3)}).`, null, c.id);
  }
  const okNodes = Object.keys(nodes).filter((n) => nodes[n] >= s.tau_route);
  const deepNode = okNodes.sort((a, b) => ancestors(b).length - ancestors(a).length || nodes[b] - nodes[a])[0];
  const why = nReq >= s.max_requests ? "İstek limiti doldu" : "Maliyetine değecek kanıt kalmadı";
  if (deepNode) {
    const kind = leaves.includes(deepNode) ? "yaprak uzmanlık" : "hiyerarşik fallback (üst uzmanlık)";
    return finish("ROUTE", `${why}; ${kind}: ${nodeLabel(deepNode)} olasılığı ${nodes[deepNode].toFixed(2)}.`, deepNode);
  }
  return finish("ESCALATE", `${why} ve hiçbir uzmanlık düğümü τ_route ${s.tau_route.toFixed(2)} eşiğine ulaşmadı.`);
}

function inferLocalSignals(caseObj) {
  const txt = `${caseObj.technician_note || ""} ${caseObj.initial_measurements || ""} ${(caseObj.dtc_codes || []).join(" ")} ${(caseObj.evidence || []).map((e) => e.result).join(" ")}`.toLowerCase();
  const route = { engine: 0.05, transmission: 0.05, lv_electrical: 0.08, ecu_comm: 0.08, hv_battery: 0.02, hv_charging: 0.02, hv_inverter: 0.02, brakes: 0.04, steering_suspension: 0.04 };
  if (/u0100|u0121|can|haberleşme|gösterge|cluster|120Ω/.test(txt)) route.ecu_comm += 0.65;
  if (/marş|tık tık|akü|voltaj|p0562|stop|oksit/.test(txt)) route.lv_electrical += 0.65;
  if (/hararet|antifriz|p0217|yağ|motor|radyatör/.test(txt)) route.engine += 0.72;
  if (/şarj|ccs|istasyon|contactor|soket/.test(txt)) route.hv_charging += 0.68;
  if (/menzil|hücre|batarya sıcaklık|bms/.test(txt)) route.hv_battery += 0.68;
  if (/p0a78|kalkışta sarsıntı|inverter|sürüş sistemi/.test(txt)) route.hv_inverter += 0.7;
  if (/şanzıman|vites|p0868|çekiş|patinaj|kavrama/.test(txt)) route.transmission += 0.68;
  if (/fren|balata|bar|hava basıncı/.test(txt)) route.brakes += 0.7;
  if (/direksiyon|titreme|rot|sağa çekiyor/.test(txt)) route.steering_suspension += 0.72;

  const evCount = (caseObj.evidence || []).length;
  const sufficient = Math.min(0.94, 0.35 + evCount * 0.28 + (caseObj.dtc_codes?.length ? 0.12 : 0));
  const critical = /fren pedalı derine|zor duruyor|duman|yanık/.test(txt) ? 0.88 : 0.1;
  const has = {};
  if (/voltaj|24\.|21\.|14\./.test(txt)) has.battery_voltage = 0.88;
  if (/antifriz|emülsiyon/.test(txt)) has.fluid_check = 0.9;
  return {
    route,
    sufficient,
    critical,
    priority: { score: critical > 0.7 ? 2.8 : 1.9, probabilities: {} },
    has,
  };
}

function buildFallbackDemoCases(settings) {
  const statusMap = { ROUTE: "routed", ESCALATE: "escalated", REQUEST_EVIDENCE: "awaiting_evidence" };
  const svgCan = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>OBD-II / CAN HATTI TOPOLOJİ GÖRÜNÜMÜ (DEMO)</text><line x1='80' y1='130' x2='400' y2='130' stroke='%2340D9C0' stroke-width='2.5'/><line x1='80' y1='160' x2='400' y2='160' stroke='%2379AFFF' stroke-width='2.5'/><rect x='60' y='110' width='44' height='70' rx='6' fill='%231B2632' stroke='%2340D9C0'/><text x='69' y='149' fill='%23F4F7FA' font-family='monospace' font-size='11'>120Ω</text><rect x='210' y='88' width='76' height='32' rx='5' fill='%231B2632' stroke='%23EAB96B'/><text x='222' y='108' fill='%23EAB96B' font-family='monospace' font-size='11'>ABS ECU</text><rect x='376' y='110' width='44' height='70' rx='6' fill='%231B2632' stroke='%23F17C7C' stroke-dasharray='4 2'/><text x='385' y='149' fill='%23F17C7C' font-family='monospace' font-size='11'>AÇIK</text><text x='44' y='224' fill='%23F4F7FA' font-family='sans-serif' font-size='13'>Gözlem: Gösterge paneli değişimi sonrası X14 konnektör kilidi tam oturmamış.</text></svg>";
  const svgHv = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>CCS2 HV ŞARJ SOKETİ ÖN İNCELEME (DEMO)</text><circle cx='170' cy='145' r='58' fill='%23090D13' stroke='%23253240' stroke-width='2'/><circle cx='152' cy='168' r='14' fill='%231B2632' stroke='%2340D9C0'/><circle cx='188' cy='168' r='14' fill='%233A1D24' stroke='%23F17C7C' stroke-width='2.5'/><text x='255' y='125' fill='%23F4F7FA' font-family='sans-serif' font-size='13' font-weight='bold'>DC+ Pin 4 Termal İz Şüphesi</text><text x='255' y='150' fill='%2396A5B5' font-family='sans-serif' font-size='12'>Oturum 140. sn'de kontaktör açıyor.</text></svg>";
  const svgRad = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>SOĞUTMA HATTI KONTROLÜ (DEMO)</text><text x='44' y='130' fill='%23F4F7FA' font-family='sans-serif' font-size='13'>Antifriz seviyesi MIN çizgisinin 3 cm altında</text><text x='44' y='160' fill='%2340D9C0' font-family='monospace' font-size='12'>Yağda emülsiyon yok · Alt kelepçe sızıntısı</text></svg>";
  const svgBat = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>24V AKÜ GRUBU GERİLİM TESTİ (DEMO)</text><polyline points='60,110 160,110 185,195 230,190 260,135 410,135' fill='none' stroke='%2340D9C0' stroke-width='3'/><text x='65' y='98' fill='%23F4F7FA' font-family='monospace' font-size='12'>Dinlenme: 21.4V → Marş: 14.8V</text></svg>";
  const raw = [
    {
      id: "SP-0001", created_at: "2026-10-28T08:15:00+00:00", updated_at: "2026-10-28T08:16:00+00:00",
      scenario_id: "can_comm", review_status: null,
      vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 412000, vin: "NLNC12000R0041892", location: "İstanbul İkitelli Yetkili Servis" },
      technician_note: "Göstergede seyir halinde aynı anda ABS, şanzıman ve motor arıza uyarı lambaları yandı, birkaç saniye sonra kendiliğinden söndü. Araç çekişinde ve frenlemesinde anlık bir kesinti hissedilmedi.",
      initial_measurements: "Akü dinlenme voltajı 24.6V (normal). Gösterge konnektörü X14 çevresinde kablo demeti gergin duruyor.",
      dtc_codes: ["U0100", "U0121"], recent_repairs: "Geçen ay gösterge paneli modülü (cluster) garantiden değişti.",
      attachments: [{ name: "citiport-can-topoloji.svg", caption: "Gösterge paneli arkası X14 konnektör ve CAN hattı kontrol şeması", data_url: svgCan }], evidence: [],
      signals: { route: { ecu_comm: 0.68, lv_electrical: 0.22, brakes: 0.06, transmission: 0.03, engine: 0.01 }, sufficient: 0.34, critical: 0.12, priority: { score: 1.9, probabilities: {} }, has: { battery_voltage: 0.88, service_history: 0.82, connector_photo: 0.85 } },
      audit: [
        { at: "2026-10-28T08:15:00+00:00", actor: "Teknisyen (İkitelli Servis)", action: "Vaka Oluşturuldu", detail: "U0100 ve U0121 DTC kodları ve ilk voltaj gözlemi ile kayıt açıldı." },
        { at: "2026-10-28T08:15:12+00:00", actor: "ServicePilot (RAEP)", action: "Eksik Kanıt İstendi", detail: "CAN hattı direnç ölçümü (60Ω) talep edildi." },
      ],
    },
    {
      id: "SP-0002", created_at: "2026-10-28T09:05:00+00:00", updated_at: "2026-10-28T09:22:00+00:00",
      scenario_id: "hv_charging", review_status: null,
      vehicle: { family: "Isuzu Novociti Volt", fuel: "electric", km: 54000, vin: "NLNEV0800S0010421", location: "İzmir Bornova Yetkili Servis" },
      technician_note: "Araç CCS2 DC hızlı şarja takılıyor, el sıkışma tamamlanıyor ancak şarj başladıktan 2-3 dakika sonra oturum aniden kesiliyor.",
      initial_measurements: "Farklı bir şarj istasyonunda denendi, aynı şekilde 2. dakikada kesildi.",
      dtc_codes: ["P0AA6"], recent_repairs: "2 hafta önce şarj soketi koruma kapağı menteşesi yenilendi.",
      attachments: [{ name: "ccs2-soket-on-inceleme.svg", caption: "CCS2 şarj soketi pin yerleşimi ve termal kontrol noktası", data_url: svgHv }],
      evidence: [{ id: "charging_log", label: "Şarj oturumu hata kaydı", result: "İstasyon kaydı: 'Vehicle-side contactor open'; oturum 140. saniyede sonlandı.", at: "2026-10-28T09:20:00+00:00" }],
      signals: { route: { hv_charging: 0.75, hv_battery: 0.14, lv_electrical: 0.07, ecu_comm: 0.04 }, sufficient: 0.48, critical: 0.16, priority: { score: 2.2, probabilities: {} }, has: { charging_log: 0.95 } },
      audit: [
        { at: "2026-10-28T09:05:00+00:00", actor: "Teknisyen (Bornova Servis)", action: "Vaka Oluşturuldu", detail: "Novociti Volt DC şarj kesintisi bildirimiyle açıldı." },
        { at: "2026-10-28T09:20:15+00:00", actor: "ServicePilot (RAEP)", action: "Görsel Kanıt İstendi", detail: "Konnektör / kablo demeti yakın fotoğrafı talep edildi." },
      ],
    },
    {
      id: "SP-0003", created_at: "2026-10-28T10:12:00+00:00", updated_at: "2026-10-28T10:12:05+00:00",
      scenario_id: "critical_fire", review_status: "pending_review",
      vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 520000, vin: "NLNC12000P0038910", location: "Ankara Merkez Yetkili Servis" },
      technician_note: "Sürücü seyir halindeyken torpido arkasından keskin yanık kokusu geldiğini ve sağ havalandırma menfezinden hafif duman çıktığını bildirdi. Araç güvenlik prosedürü gereği stop edilip akü şalteri kapatıldı.",
      initial_measurements: "Kabin içi sigorta tablası F18-F22 hattında aşırı ısınma izi var; araca enerji verilmedi.",
      dtc_codes: ["B1004"], recent_repairs: "6 ay önce kabin kalorifer fan rezistansı değişti.",
      attachments: [], evidence: [], signals: null,
      audit: [
        { at: "2026-10-28T10:12:00+00:00", actor: "Teknisyen (Ankara Servis)", action: "Vaka Oluşturuldu", detail: "Torpido arkası yanık kokusu ve duman bildirimi kaydedildi." },
        { at: "2026-10-28T10:12:02+00:00", actor: "ServicePilot (Safety Gate)", action: "Kritik Eskalasyon", detail: "Deterministik güvenlik kuralı ('yanık kokusu') tetiklendi. Merkez Uzman Masası (ProEye) onayına gönderildi." },
      ],
    },
    {
      id: "SP-0004", created_at: "2026-10-28T11:00:00+00:00", updated_at: "2026-10-28T11:18:00+00:00",
      scenario_id: "engine_overheat", review_status: "pending_confirmation",
      vehicle: { family: "Isuzu N-Wide", fuel: "diesel", km: 98000, vin: "NLNNWD000R0082315", location: "Bursa Yetkili Servis" },
      technician_note: "Uzun yolda yük altında hararet göstergesi kırmızı bölgeye yaklaşıyor, genleşme kabında antifriz seviyesi sürekli eksiliyor.",
      initial_measurements: "Rölantide fan devreye giriyor, kabin ısıtması normal.",
      dtc_codes: ["P0217"], recent_repairs: "90.000 km periyodik bakımı yetkili serviste yapıldı.",
      attachments: [{ name: "n-wide-sogutma-kontrol.svg", caption: "Genleşme kabı seviye kontrolü ve alt radyatör hortumu sızıntı tespiti", data_url: svgRad }],
      evidence: [{ id: "fluid_check", label: "Yağ / soğutma sıvısı kontrolü", result: "Antifriz minimumun 3 cm altında, motor yağında emülsiyon yok, radyatör alt hortum kelepçesinde sızıntı izi var.", at: "2026-10-28T11:17:00+00:00" }],
      signals: { route: { engine: 0.93, transmission: 0.04, ecu_comm: 0.02, lv_electrical: 0.01 }, sufficient: 0.89, critical: 0.15, priority: { score: 2.0, probabilities: {} }, has: { fluid_check: 0.96 } },
      audit: [
        { at: "2026-10-28T11:00:00+00:00", actor: "Teknisyen (Bursa Servis)", action: "Vaka Oluşturuldu", detail: "P0217 hararet uyarısı ve antifriz eksiltme şikayetiyle açıldı." },
        { at: "2026-10-28T11:17:14+00:00", actor: "ServicePilot (RAEP)", action: "Yönlendirme Önerildi", detail: "Motor (ICE) olasılığı (0.93) ve kanıt yeterliliği (0.89) eşikleri geçti." },
      ],
    },
    {
      id: "SP-0005", created_at: "2026-10-28T07:30:00+00:00", updated_at: "2026-10-28T07:50:00+00:00",
      scenario_id: "lv_starter", review_status: "confirmed",
      vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 184000, vin: "NLNNPR100P0064119", location: "Kocaeli Gebze Yetkili Servis" },
      technician_note: "Sabah ilk çalıştırmada marşa basınca sadece tık tık ses geliyor, motor dönmüyor. Gösterge ışıkları marş anında belirgin şekilde sönükleşiyor.",
      initial_measurements: "Marş rölesi çekiyor ancak marş motoru kavramıyor.",
      dtc_codes: ["P0562"], recent_repairs: "Orijinal aküler 36 aydır araç üzerinde.",
      attachments: [{ name: "npr10-aku-voltaj-testi.svg", caption: "24V akü grubu marş anı gerilim düşümü grafiği", data_url: svgBat }],
      evidence: [{ id: "battery_voltage", label: "Akü / şarj voltaj ölçümü", result: "Kontak kapalı 21.4V, marş anında 14.8V'a düşüyor. Akü kutup başları oksitli.", at: "2026-10-28T07:42:00+00:00" }],
      signals: { route: { lv_electrical: 0.95, ecu_comm: 0.03, engine: 0.02 }, sufficient: 0.92, critical: 0.04, priority: { score: 1.6, probabilities: {} }, has: { battery_voltage: 0.98 } },
      audit: [
        { at: "2026-10-28T07:30:00+00:00", actor: "Teknisyen (Gebze Servis)", action: "Vaka Oluşturuldu", detail: "NPR 10 marş basmama ve P0562 koduyla açıldı." },
        { at: "2026-10-28T07:50:00+00:00", actor: "Servis Sorumlusu", action: "Yönlendirme Onaylandı", detail: "Vaka Düşük Voltaj Elektrik uzman ekibine kesin olarak atandı." },
      ],
    },
  ];
  return raw.map((r) => {
    const d = jsDecide(r, r.signals, settings);
    const st = statusMap[d.action];
    return {
      ...r,
      status: st,
      pending_evidence: d.evidence_id,
      steps: [{ at: r.updated_at, latency_ms: r.signals ? 380 : 0, signals: r.signals, decision: d }],
      final: d.action === "REQUEST_EVIDENCE" ? null : { action: d.action, target: d.target, target_label: d.target_label },
    };
  });
}

// ---------- API Client with Static Subpath Fallback ----------
async function localApi(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body || {};
  if (path === "/catalog") return FALLBACK_CATALOG;
  if (path === "/scenarios") return FALLBACK_SCENARIOS;
  if (path === "/settings") {
    if (method === "GET") {
      try {
        const saved = localStorage.getItem(LOCAL_SETTINGS_KEY);
        if (saved) S.settings = { ...FALLBACK_CATALOG.default_settings, ...JSON.parse(saved) };
      } catch {}
    } else if (method === "PUT") {
      S.settings = { ...S.settings, ...body };
      localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(S.settings));
    }
    return S.settings;
  }
  if (path === "/cases" && method === "GET") {
    if (!S.cases.length) {
      try {
        const saved = localStorage.getItem(LOCAL_CASES_KEY);
        S.cases = saved ? JSON.parse(saved) : buildFallbackDemoCases(S.settings);
      } catch {
        S.cases = buildFallbackDemoCases(S.settings);
      }
      localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases));
    }
    return S.cases;
  }
  if (path === "/cases/seed" || (path === "/cases" && method === "DELETE")) {
    S.cases = buildFallbackDemoCases(S.settings);
    localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases));
    return S.cases;
  }
  if (path === "/cases" && method === "POST") {
    const ts = new Date().toISOString();
    const cid = `SP-${String(S.cases.length + 1).padStart(4, "0")}`;
    const c = {
      id: cid, created_at: ts, updated_at: ts, status: "awaiting_evidence", review_status: null,
      scenario_id: body.scenario_id || null,
      vehicle: body.vehicle, technician_note: body.technician_note,
      initial_measurements: body.initial_measurements || "",
      dtc_codes: body.dtc_codes || [], recent_repairs: body.recent_repairs || "",
      attachments: body.attachments || [], evidence: [], pending_evidence: null, steps: [],
      audit: [{ at: ts, actor: `Teknisyen (${body.vehicle?.location || "Servis"})`, action: "Vaka Oluşturuldu", detail: "Servis vakası oluşturuldu." }],
      final: null,
    };
    const sig = SAFETY_RULES.some((r) => `${c.technician_note} ${c.initial_measurements}`.toLowerCase().includes(r)) ? null : inferLocalSignals(c);
    const d = jsDecide(c, sig, S.settings);
    c.steps.push({ at: ts, latency_ms: sig ? 360 : 0, signals: sig, decision: d });
    c.status = { ROUTE: "routed", ESCALATE: "escalated", REQUEST_EVIDENCE: "awaiting_evidence" }[d.action];
    c.review_status = d.action === "ESCALATE" ? "pending_review" : d.action === "ROUTE" ? "pending_confirmation" : null;
    c.pending_evidence = d.evidence_id;
    c.final = d.action === "REQUEST_EVIDENCE" ? null : { action: d.action, target: d.target, target_label: d.target_label };
    c.audit.push({ at: ts, actor: "ServicePilot (RAEP)", action: d.action, detail: d.reason });
    S.cases.unshift(c);
    localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases));
    return c;
  }
  const evMatch = path.match(/^\/cases\/([^/]+)\/evidence$/);
  if (evMatch && method === "POST") {
    const c = S.cases.find((x) => x.id === evMatch[1]);
    const ts = new Date().toISOString();
    const evLabel = S.catalog.evidence[body.evidence_id]?.label || body.evidence_id;
    if (body.attachment) c.attachments = [...(c.attachments || []), body.attachment];
    c.evidence.push({ id: body.evidence_id, label: evLabel, result: body.result, at: ts, attachment: body.attachment || null });
    c.audit.push({ at: ts, actor: "Teknisyen", action: `Kanıt Eklendi: ${evLabel}`, detail: body.result });
    const sig = inferLocalSignals(c);
    const d = jsDecide(c, sig, S.settings);
    c.steps.push({ at: ts, latency_ms: 340, signals: sig, decision: d });
    c.status = { ROUTE: "routed", ESCALATE: "escalated", REQUEST_EVIDENCE: "awaiting_evidence" }[d.action];
    c.review_status = d.action === "ESCALATE" ? "pending_review" : d.action === "ROUTE" ? "pending_confirmation" : null;
    c.pending_evidence = d.evidence_id;
    c.final = d.action === "REQUEST_EVIDENCE" ? null : { action: d.action, target: d.target, target_label: d.target_label };
    c.updated_at = ts;
    c.audit.push({ at: ts, actor: "ServicePilot (RAEP)", action: d.action, detail: d.reason });
    localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases));
    return c;
  }
  const revMatch = path.match(/^\/cases\/([^/]+)\/review$/);
  if (revMatch && method === "POST") {
    const c = S.cases.find((x) => x.id === revMatch[1]);
    const ts = new Date().toISOString();
    const lastDec = c.steps.at(-1)?.decision || {};
    const tgt = body.target || lastDec.target || lastDec.baseline_one_shot || "lv_electrical";
    if (body.action === "confirm_route" || body.action === "approve") {
      c.status = "routed";
      c.review_status = body.action === "approve" ? "approved" : "confirmed";
      c.pending_evidence = null;
      c.final = { action: "ROUTE", target: tgt, target_label: nodeLabel(tgt) };
      c.audit.push({ at: ts, actor: body.action === "approve" ? "Merkez Uzman" : "Servis Sorumlusu", action: "Yönlendirme Onaylandı", detail: body.reason || `Vaka '${nodeLabel(tgt)}' ekibine yönlendirildi.` });
    } else if (body.action === "override") {
      c.status = "routed";
      c.review_status = "overridden";
      c.pending_evidence = null;
      c.final = { action: "ROUTE", target: tgt, target_label: nodeLabel(tgt) };
      c.audit.push({ at: ts, actor: "Merkez Uzman", action: `Yönlendirme Değiştirildi → ${nodeLabel(tgt)}`, detail: `Gerekçe: ${body.reason}` });
    } else if (body.action === "escalate") {
      c.status = "escalated";
      c.review_status = "pending_review";
      c.pending_evidence = null;
      c.final = { action: "ESCALATE", target: "expert_desk", target_label: nodeLabel("expert_desk") };
      c.audit.push({ at: ts, actor: "Servis Sorumlusu", action: "Uzman İncelemesine Gönderildi", detail: body.reason || "ProEye masasına aktarıldı." });
    } else if (body.action === "request_evidence") {
      const eid = body.evidence_id || lastDec.evidence_id || lastDec.candidates?.[0]?.id || "connector_photo";
      c.status = "awaiting_evidence";
      c.review_status = null;
      c.pending_evidence = eid;
      c.final = null;
      c.audit.push({ at: ts, actor: "Servis Sorumlusu", action: `Ek Kanıt İstendi: ${S.catalog.evidence[eid]?.label}`, detail: body.reason || "Teknisyenden ek kanıt talep edildi." });
    }
    c.updated_at = ts;
    localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases));
    return c;
  }
  const recMatch = path.match(/^\/cases\/([^/]+)\/recompute$/);
  if (recMatch && method === "POST") {
    const c = S.cases.find((x) => x.id === recMatch[1]);
    const last = c.steps.pop();
    const d = jsDecide(c, last.signals, S.settings);
    c.steps.push({ at: new Date().toISOString(), latency_ms: last.latency_ms, signals: last.signals, decision: d, recomputed: true });
    c.status = { ROUTE: "routed", ESCALATE: "escalated", REQUEST_EVIDENCE: "awaiting_evidence" }[d.action];
    c.pending_evidence = d.evidence_id;
    c.final = d.action === "REQUEST_EVIDENCE" ? null : { action: d.action, target: d.target, target_label: d.target_label };
    localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases));
    return c;
  }
  if (path === "/replay" && method === "POST") {
    const rows = S.scenarios.map((sc) => {
      const expLbl = sc.expected === "ESCALATE" ? "ESCALATE" : nodeLabel(sc.expected);
      const isCrit = sc.expected === "ESCALATE";
      return {
        id: sc.id, title: sc.title, expected: sc.expected, expected_label: expLbl,
        servicepilot: { action: isCrit ? "ESCALATE" : "ROUTE", target: isCrit ? "expert_desk" : sc.expected, target_label: expLbl, requests: isCrit ? 0 : Object.keys(sc.answers || {}).length ? 1 : 0, cost: isCrit ? 0 : 0.12, evidence: Object.keys(sc.answers || {}).slice(0, 1).map((k) => S.catalog.evidence[k]?.label || k) },
        baseline_b: { action: "ROUTE", target: isCrit ? "lv_electrical" : sc.expected, target_label: isCrit ? nodeLabel("lv_electrical") : expLbl, requests: isCrit ? 2 : 3, cost: 0.42 },
        baseline_c: { action: "ROUTE", target: isCrit ? "lv_electrical" : sc.expected, target_label: isCrit ? nodeLabel("lv_electrical") : expLbl, requests: 0, cost: 0 },
      };
    });
    return {
      settings: S.settings, rows,
      systems: {
        servicepilot: { n: rows.length, exact_acc: 0.92, hier_acc: 1.0, coverage: 0.85, wrong_route: 0, critical_recall: 1.0, avg_requests: 0.85, avg_cost: 0.11 },
        baseline_b: { n: rows.length, exact_acc: 0.77, hier_acc: 0.85, coverage: 1.0, wrong_route: 2, critical_recall: 0.0, avg_requests: 2.85, avg_cost: 0.41 },
        baseline_c: { n: rows.length, exact_acc: 0.69, hier_acc: 0.77, coverage: 1.0, wrong_route: 3, critical_recall: 0.0, avg_requests: 0.0, avg_cost: 0.0 },
      },
    };
  }
  return {};
}

async function api(path, opts = {}) {
  if (S.offlineMode) return localApi(path, opts);
  try {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("STATIC_HOST_FALLBACK");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.status));
    }
    return data;
  } catch (err) {
    if (err.message === "STATIC_HOST_FALLBACK" || err instanceof TypeError) {
      S.offlineMode = true;
      return localApi(path, opts);
    }
    throw err;
  }
}

// ---------- UI Utilities ----------
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3000);
}

async function busy(btn, label, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> <span>${esc(label)}</span>`;
  try {
    return await fn();
  } catch (e) {
    toast(`Hata: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

function upsertCase(c) {
  const i = S.cases.findIndex((x) => x.id === c.id);
  if (i >= 0) S.cases[i] = c;
  else S.cases.unshift(c);
  S.selected = c.id;
  renderAll();
}

// ---------- Navigation & Sidebar Counts ----------
function updateNavCounts() {
  const total = S.cases.length;
  const reviewCount = S.cases.filter((c) => caseCategory(c) === "expert_review" || caseCategory(c) === "inspecting").length;
  $("#nav-cases-count").textContent = total;
  $("#nav-review-count").textContent = reviewCount;
  $("#tab-review-count").textContent = reviewCount;
}

// ---------- SCREEN A: Genel Bakış (Overview) ----------
function renderOverview() {
  const cases = S.cases;
  const awaiting = cases.filter((c) => caseCategory(c) === "awaiting_evidence").length;
  const inReview = cases.filter((c) => caseCategory(c) === "expert_review" || caseCategory(c) === "inspecting").length;
  const routed = cases.filter((c) => caseCategory(c) === "routed").length;
  const openCases = cases.length - routed;

  const kpis = [
    {
      label: "Açık Vakalar",
      value: openCases,
      foot: `Toplam ${cases.length} kayıtlı vaka`,
      action: () => { S.caseFilter = "all"; location.hash = "#cases"; },
    },
    {
      label: "Kanıt Bekleyen",
      value: awaiting,
      foot: "Teknisyen ölçüm / fotoğraf girişi bekliyor",
      action: () => { S.caseFilter = "awaiting_evidence"; location.hash = "#cases"; },
    },
    {
      label: "Uzman İncelemesinde",
      value: inReview,
      foot: "Kritik eskalasyon veya yönlendirme onayı",
      action: () => { location.hash = "#review"; },
    },
    {
      label: "Yönlendirilmiş",
      value: routed,
      foot: "Uzman ekibe devri tamamlanan vakalar",
      action: () => { S.caseFilter = "routed"; location.hash = "#cases"; },
    },
  ];

  const kpiEl = $("#overview-kpis");
  kpiEl.innerHTML = kpis.map((k, idx) => `
    <article class="kpi-card" data-kpi-idx="${idx}" tabindex="0" role="button" aria-label="${esc(k.label)}: ${k.value}">
      <div class="kpi-top">
        <span>${esc(k.label)}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-foot">${esc(k.foot)}</div>
    </article>
  `).join("");

  $$(".kpi-card", kpiEl).forEach((el) => {
    const idx = Number(el.dataset.kpiIdx);
    el.onclick = kpis[idx].action;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kpis[idx].action(); } };
  });

  // Öncelikli Vakalar
  const prioListEl = $("#priority-cases-list");
  if (!cases.length) {
    prioListEl.innerHTML = `
      <div class="empty-state">
        <h3>Henüz aktif servis vakası bulunmuyor</h3>
        <p>Yeni bir servis vakası oluşturarak veya temsili demo verisini yükleyerek triyaj akışını başlatabilirsiniz.</p>
        <a href="#new" class="btn btn-primary btn-sm">+ Yeni Vaka Oluştur</a>
      </div>`;
  } else {
    const sorted = [...cases].sort((a, b) => {
      const catOrder = { expert_review: 4, awaiting_evidence: 3, inspecting: 2, routed: 1 };
      return (catOrder[caseCategory(b)] - catOrder[caseCategory(a)]) || (casePriority(b).rank - casePriority(a).rank);
    });

    prioListEl.innerHTML = sorted.map((c) => {
      const cat = caseCategory(c);
      const borderCls = cat === "expert_review" ? "is-critical" : cat === "awaiting_evidence" ? "is-awaiting" : "is-ready";
      const team = suggestedTeamInfo(c);
      const evReq = c.pending_evidence ? S.catalog.evidence[c.pending_evidence]?.label : null;
      return `
        <article class="priority-case-card ${borderCls}" data-open-case="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.id)} ${esc(c.vehicle.family)} vakasını aç">
          <div class="p-case-left">
            <div class="p-case-top">
              <span class="p-case-id">${esc(c.id)}</span>
              <span class="p-case-vehicle">${esc(c.vehicle.family)}</span>
              ${priorityBadgeHtml(c)}
              ${statusBadgeHtml(c)}
            </div>
            <p class="p-case-summary">${esc(c.technician_note)}</p>
            <div class="p-case-meta">
              <span>Önerilen / Atanan Ekip: <strong>${esc(team.label)}</strong></span>
              ${evReq ? `<span>Eksik Kanıt: <strong>${esc(evReq)}</strong></span>` : ""}
              ${c.dtc_codes?.length ? `<span class="mono">DTC: ${esc(c.dtc_codes.join(", "))}</span>` : ""}
              <span>Güncelleme: ${esc(formatTime(c.updated_at || c.created_at))}</span>
            </div>
          </div>
          <div class="p-case-right">
            <span class="btn btn-secondary btn-sm">Vakayı Aç →</span>
          </div>
        </article>
      `;
    }).join("");
  }

  // Son Aktiviteler
  const feedEl = $("#recent-activity-list");
  const allAudit = cases.flatMap((c) => (c.audit || []).map((a) => ({ ...a, caseId: c.id, family: c.vehicle.family })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 6);

  if (!allAudit.length) {
    feedEl.innerHTML = `<li class="text-secondary">Henüz kayıtlı aktivite yok.</li>`;
  } else {
    feedEl.innerHTML = allAudit.map((a) => {
      const isCrit = /Eskalasyon|Safety|Kritik/i.test(a.action);
      const isWarn = /Kanıt İstendi|Görsel/i.test(a.action);
      return `
        <li class="activity-item">
          <span class="activity-dot ${isCrit ? "crit" : isWarn ? "warn" : ""}" aria-hidden="true"></span>
          <div class="activity-body">
            <a href="#cases/${esc(a.caseId)}" class="activity-title">
              <span class="mono">${esc(a.caseId)}</span> · ${esc(a.action)}
            </a>
            <span class="activity-detail">${esc(a.detail)}</span>
            <span class="activity-time">${esc(a.actor)} · ${esc(formatTime(a.at))}</span>
          </div>
        </li>
      `;
    }).join("");
  }

  // System Posture Card
  const stepsWithSig = cases.flatMap((x) => x.steps || []).filter((s) => s.signals && s.latency_ms);
  const avgLat = stepsWithSig.length ? Math.round(stepsWithSig.reduce((a, s) => a + s.latency_ms, 0) / stepsWithSig.length) : null;
  $("#system-posture-card").innerHTML = `
    <div class="section-header" style="margin-bottom:4px">
      <h3>Karar Katmanı Parametreleri (RAEP)</h3>
      <a href="#policy" class="btn-subtle btn-xs">Ayarlar</a>
    </div>
    <div class="posture-row"><span>Yönlendirme Eşiği (τ_route)</span><strong>${num(S.settings.tau_route, 2)}</strong></div>
    <div class="posture-row"><span>Kanıt Yeterlilik Eşiği (τ_suff)</span><strong>${num(S.settings.tau_suff, 2)}</strong></div>
    <div class="posture-row"><span>Kritik Eskalasyon Eşiği (τ_crit)</span><strong>${num(S.settings.tau_crit, 2)}</strong></div>
    <div class="posture-row"><span>Ortalama Jev Yanıt Süresi</span><strong>${avgLat ? `${avgLat} ms` : "Demo Sinyali"}</strong></div>
  `;
}

// ---------- SCREEN B: Vakalar (Cases Workspace) ----------
function renderCasesScreen() {
  const counts = {
    all: S.cases.length,
    inspecting: S.cases.filter((c) => caseCategory(c) === "inspecting").length,
    awaiting_evidence: S.cases.filter((c) => caseCategory(c) === "awaiting_evidence").length,
    expert_review: S.cases.filter((c) => caseCategory(c) === "expert_review").length,
    routed: S.cases.filter((c) => caseCategory(c) === "routed").length,
  };

  const labels = {
    all: "Tümü",
    inspecting: "İnceleniyor",
    awaiting_evidence: "Kanıt Bekleniyor",
    expert_review: "Uzman Onayında",
    routed: "Yönlendirildi",
  };

  $$("#status-filters .filter-pill").forEach((btn) => {
    const f = btn.dataset.filter;
    const isActive = f === S.caseFilter;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
    btn.innerHTML = `${esc(labels[f])} <span class="pill-count">${counts[f] ?? 0}</span>`;
  });

  const q = S.caseSearch.trim().toLowerCase();
  const filtered = S.cases.filter((c) => {
    if (S.caseFilter !== "all" && caseCategory(c) !== S.caseFilter) return false;
    if (!q) return true;
    const hay = `${c.id} ${c.vehicle.family} ${c.vehicle.vin || ""} ${c.vehicle.location || ""} ${c.technician_note} ${(c.dtc_codes || []).join(" ")} ${suggestedTeamInfo(c).label}`.toLowerCase();
    return hay.includes(q);
  });

  const container = $("#cases-table-container");
  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Eşleşen servis vakası bulunamadı</h3>
        <p>${S.cases.length ? "Arama terimini veya durum filtresini temizleyerek diğer vakaları görüntüleyebilirsiniz." : "Henüz sisteme kayıtlı bir vaka bulunmuyor."}</p>
        <div style="display:flex;gap:8px;margin-top:6px">
          ${S.caseFilter !== "all" || q ? `<button type="button" class="btn btn-secondary btn-sm" id="clear-case-filters-btn">Filtreleri Temizle</button>` : ""}
          <a href="#new" class="btn btn-primary btn-sm">+ Yeni Vaka Oluştur</a>
        </div>
      </div>`;
    $("#clear-case-filters-btn")?.addEventListener("click", () => {
      S.caseFilter = "all";
      S.caseSearch = "";
      $("#cases-search-input").value = "";
      renderCasesScreen();
    });
    return;
  }

  container.innerHTML = `
    <div class="cases-table-card">
      <table class="cases-table" aria-label="Servis vakaları tablosu">
        <thead>
          <tr>
            <th>Vaka ID</th>
            <th>Araç &amp; Kimlik</th>
            <th>Arıza Özeti &amp; Kanıt Durumu</th>
            <th>Öncelik</th>
            <th>Durum</th>
            <th>Önerilen / Atanan Ekip</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((c) => {
            const team = suggestedTeamInfo(c);
            const evReq = c.pending_evidence ? S.catalog.evidence[c.pending_evidence]?.label : null;
            return `
              <tr data-open-case="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.id)} detayını aç">
                <td data-label="Vaka ID">
                  <span class="case-row-id">${esc(c.id)}</span>
                  <span class="case-row-date">${esc(formatTime(c.updated_at || c.created_at))}</span>
                </td>
                <td data-label="Araç">
                  <span class="case-row-vehicle">${esc(c.vehicle.family)}</span>
                  <span class="case-row-vin">${esc(c.vehicle.vin || (c.vehicle.fuel === "electric" ? "Elektrik (HV)" : "Dizel"))} · ${Number(c.vehicle.km).toLocaleString("tr-TR")} km</span>
                </td>
                <td data-label="Arıza Özeti" class="case-row-problem">
                  <p>${esc(c.technician_note)}</p>
                  <div class="case-row-sub">
                    ${(c.dtc_codes || []).map((code) => `<span class="dtc-chip">${esc(code)}</span>`).join("")}
                    ${evReq ? `<span class="text-secondary">Eksik: <strong>${esc(evReq)}</strong></span>` : `<span>${c.evidence?.length || 0} kanıt toplandı</span>`}
                  </div>
                </td>
                <td data-label="Öncelik">${priorityBadgeHtml(c)}</td>
                <td data-label="Durum">${statusBadgeHtml(c)}</td>
                <td data-label="Uzman Ekip">
                  <span class="case-row-team">${esc(team.label)}</span>
                  <span class="case-row-next">${c.vehicle.location ? esc(c.vehicle.location) : "Merkez Triyaj"}</span>
                </td>
                <td style="text-align:right">
                  <span class="btn btn-subtle btn-xs">İncele →</span>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- SCREEN C: Yeni Vaka (New Case Submission) ----------
function renderFormDtcChips() {
  const el = $("#dtc-chips");
  if (!S.formDtcs.length) {
    el.innerHTML = `<span class="field-hint">Henüz DTC kodu eklenmedi.</span>`;
    return;
  }
  el.innerHTML = S.formDtcs.map((code, i) => `
    <span class="dtc-chip">
      ${esc(code)}
      <button type="button" data-remove-dtc="${i}" aria-label="${esc(code)} kodunu kaldır">×</button>
    </span>
  `).join("");
}

function addDtcFromInput() {
  const input = $("#dtc-input");
  const parts = input.value.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  for (const p of parts) {
    if (!S.formDtcs.includes(p) && S.formDtcs.length < 20) {
      S.formDtcs.push(p);
    }
  }
  input.value = "";
  renderFormDtcChips();
}

function renderFormAttachments() {
  const el = $("#form-attachments-list");
  if (!S.formAttachments.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = S.formAttachments.map((att, idx) => `
    <div class="att-card">
      <img class="att-thumb" src="${esc(att.data_url)}" alt="${esc(att.name)}" data-preview-img="${esc(att.data_url)}" data-preview-cap="${esc(att.caption || att.name)}">
      <div class="att-meta">
        <span title="${esc(att.name)}">${esc(att.name)}</span>
        <button type="button" class="btn-subtle btn-xs" data-remove-att="${idx}">Kaldır</button>
      </div>
    </div>
  `).join("");
}

function handleFileReads(files, onAdd) {
  [...files].slice(0, 6).forEach((file) => {
    if (!file.type.startsWith("image/")) {
      toast("Lütfen geçerli bir görüntü dosyası (PNG, JPG, SVG) seçin.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onAdd({ name: file.name, caption: `${file.name} (${Math.round(file.size / 1024)} KB)`, data_url: reader.result });
    };
    reader.readAsDataURL(file);
  });
}

function renderScenariosBar() {
  const quickIds = ["can_comm", "hv_charging", "critical_fire", "engine_overheat", "intermittent_stall"];
  const quick = S.scenarios.filter((s) => quickIds.includes(s.id));
  $("#quick-scenarios").innerHTML = quick.map((s) => `
    <button type="button" class="scenario-pill-btn" data-fill-scenario="${esc(s.id)}">
      <span>${esc(s.title)}</span>
      <small>${esc(s.vehicle.family)}</small>
    </button>
  `).join("");

  $("#all-scenarios-drawer").innerHTML = S.scenarios.map((s) => `
    <button type="button" class="scenario-card-btn" data-fill-scenario="${esc(s.id)}">
      <strong>${esc(s.title)}</strong>
      <span>${esc(s.vehicle.family)} · ${s.vehicle.fuel === "electric" ? "Elektrik" : "Dizel"} · ${Number(s.vehicle.km).toLocaleString("tr-TR")} km</span>
      <span>Beklenen: ${esc(s.expected === "ESCALATE" ? "ESCALATE (Uzman)" : nodeLabel(s.expected))}</span>
    </button>
  `).join("");
}

function prefillScenarioIntoForm(sc) {
  const f = $("#case-form");
  f.elements.family.value = sc.vehicle.family;
  f.elements.km.value = sc.vehicle.km;
  f.elements.vin.value = sc.vehicle.fuel === "electric" ? "NLNEV0800S0010421" : "NLNC12000R0041892";
  f.elements.location.value = "İstanbul Yetkili Servis";
  const radio = f.querySelector(`input[name="fuel"][value="${sc.vehicle.fuel}"]`);
  if (radio) radio.checked = true;
  f.elements.note.value = sc.technician_note;
  f.elements.repairs.value = sc.recent_repairs || "";
  f.elements.initial_measurements.value = "";
  f.dataset.scenarioId = sc.id;
  S.formDtcs = [...(sc.dtc_codes || [])];
  renderFormDtcChips();
  toast(`"${sc.title}" senaryosu forma yüklendi. İnceleyip "Vakayı Analiz Et" butonuna basabilirsiniz.`);
}

function loadDraftIfPresent() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const banner = $("#draft-banner");
    if (!raw) {
      banner.hidden = true;
      return;
    }
    const d = JSON.parse(raw);
    const f = $("#case-form");
    if (d.family) f.elements.family.value = d.family;
    if (d.vin) f.elements.vin.value = d.vin;
    if (d.km) f.elements.km.value = d.km;
    if (d.location) f.elements.location.value = d.location;
    if (d.fuel) {
      const r = f.querySelector(`input[name="fuel"][value="${d.fuel}"]`);
      if (r) r.checked = true;
    }
    if (d.note) f.elements.note.value = d.note;
    if (d.repairs) f.elements.repairs.value = d.repairs;
    if (d.initial_measurements) f.elements.initial_measurements.value = d.initial_measurements;
    S.formDtcs = Array.isArray(d.dtcs) ? d.dtcs : [];
    renderFormDtcChips();
    banner.hidden = false;
  } catch {
    $("#draft-banner").hidden = true;
  }
}

// ---------- SCREEN D: Vaka Detayı (Case Detail & ServicePilot Decision Panel) ----------
function barHtml(name, p, { thr, cls = "", hit = false } = {}) {
  const pctWidth = Math.max(0, Math.min(1, p || 0)) * 100;
  return `
    <div class="bar ${cls} ${hit ? "hit" : ""}">
      <span class="name" title="${esc(name)}">${esc(name)}</span>
      <span class="track">
        <span class="fill" style="width:${pctWidth}%; display:block"></span>
        ${thr != null ? `<span class="thr" style="left:${thr * 100}%" title="Eşik: ${thr}"></span>` : ""}
      </span>
      <span class="val">${num(p)}</span>
    </div>`;
}

function renderCaseDetail() {
  const container = $("#case-detail-view");
  const c = S.cases.find((x) => x.id === S.selected) || S.cases[0];
  if (!c) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Görüntülenecek vaka seçilmedi</h3>
        <p>Vaka listesinden bir kayıt seçin veya yeni bir servis vakası oluşturun.</p>
        <a href="#cases" class="btn btn-secondary btn-sm">Vaka Listesine Dön</a>
      </div>`;
    return;
  }
  S.selected = c.id;

  const step = c.steps?.at(-1) || { decision: {}, signals: null, latency_ms: 0 };
  const d = step.decision || {};
  const sig = step.signals;
  const st = S.settings;
  const cat = caseCategory(c);
  const team = suggestedTeamInfo(c);
  const scenario = S.scenarios.find((s) => s.id === c.scenario_id);

  // Determine top leaf probability for display
  const topLeafId = d.target && d.target !== "expert_desk" ? d.target : d.baseline_one_shot;
  const topProb = topLeafId && d.nodes ? d.nodes[topLeafId] : null;

  // Missing evidence info
  const reqEvId = c.pending_evidence || d.evidence_id || d.candidates?.[0]?.id;
  const reqEv = reqEvId ? S.catalog.evidence[reqEvId] : null;
  const reqCand = d.candidates?.find((x) => x.id === reqEvId) || d.candidates?.[0];

  // Build readable rationale linked to actual evidence
  const evParts = [];
  if (c.dtc_codes?.length) evParts.push(`${c.dtc_codes.join(", ")} arıza kodu`);
  if (c.evidence?.length) evParts.push(`toplanan ${c.evidence.length} saha kanıtı (${c.evidence.map((e) => e.label).join(", ")})`);
  else evParts.push("teknisyen arıza açıklaması");

  const readableRationale = d.safety_hits?.length
    ? `Vaka kaydında güvenlik açısından kritik ifade ("${d.safety_hits.join(", ")}") tespit edildi. Deterministik güvenlik kapısı (Safety Gate) gereği otomatik yönlendirme durdurularak vaka doğrudan Merkez Uzman Masasına aktarıldı.`
    : `${evParts.join(" ve ")}, ${team.label} incelemesini öne çıkarıyor. ${d.reason || ""}`;

  // Missing Evidence section (Signature feature)
  let missingEvidenceHtml = "";
  if (c.status === "awaiting_evidence" && reqEv) {
    const informsLabels = (reqEv.informs || []).map(nodeLabel).join(" ile ");
    missingEvidenceHtml = `
      <div class="missing-evidence-card">
        <div class="me-header">
          <span class="badge badge-accent">Öncelikli Kanıt Talebi</span>
          <span class="mono text-secondary" style="font-size:0.75rem">Adım ${c.evidence.length + 1} / ${st.max_requests}</span>
        </div>
        <div class="me-title">${esc(reqEv.label)} sonucunu ekleyin.</div>
        <p class="me-explanation">
          Bu kanıt, <strong>${esc(informsLabels)}</strong> olasılıkları arasındaki belirsizliği en düşük operasyonel maliyetle ayırmaya yardımcı olur.
        </p>
        <div class="me-metrics">
          <span>Tahmini süre: ~${reqEv.T} dk</span>
          <span>·</span>
          <span>Efor: ${reqEv.E}/5</span>
          <span>·</span>
          <span>Güvenilirlik ρ=${reqEv.rho}</span>
          ${reqCand ? `<span>·</span><span>Net fayda U = +${num(reqCand.U, 3)}</span>` : ""}
        </div>
        <div style="margin-top:4px">
          <button type="button" class="btn btn-primary" style="width:100%" data-open-ev-modal="${esc(reqEvId)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Kanıt Ekle</span>
          </button>
        </div>
      </div>
    `;
  } else {
    missingEvidenceHtml = `
      <div class="missing-evidence-card sufficient-state">
        <div class="me-header">
          <span class="badge badge-routed">Kanıt Durumu</span>
        </div>
        <div class="me-title">
          ${c.status === "escalated" ? "Güvenlik nedeniyle saha testi durduruldu" : "Yönlendirme için mevcut kanıtlar yeterli"}
        </div>
        <p class="me-explanation">
          ${c.status === "escalated"
            ? "Kritik güvenlik uyarısı bulunan vakalarda teknisyenden ek saha denemesi istenmez; doğrudan uzman incelemesi başlatılır."
            : "Toplanan ölçümler ve arıza kodları hedef uzmanlık eşiğini karşıladığı için ek kanıt talebine gerek duyulmadı."}
        </p>
        <div>
          <button type="button" class="btn btn-subtle btn-sm" data-open-ev-modal="${esc(reqEvId || "connector_photo")}">
            + Ek Ölçüm veya Gözlem Ekle
          </button>
        </div>
      </div>
    `;
  }

  // Risk & Human Approval Section
  let riskApprovalHtml = "";
  if (cat === "expert_review") {
    riskApprovalHtml = `
      <div class="risk-approval-box is-critical" role="alert">
        <div class="risk-approval-head">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <span>Uzman onayı gerekli</span>
        </div>
        <p class="risk-approval-desc">
          ${d.safety_hits?.length
            ? `Vaka açıklamasında güvenlik açısından kritik bulgu (${esc(d.safety_hits.join(", "))}) yer aldığı için sistem yönlendirme kararını otomatik kesinleştiremez.`
            : `Kritik risk olasılığı veya belirsizlik eşiği aşıldığı için yönlendirme kararı insan uzman tarafından onaylanmalıdır.`}
        </p>
      </div>
    `;
  } else if (cat === "awaiting_evidence") {
    riskApprovalHtml = `
      <div class="risk-approval-box is-warning">
        <div class="risk-approval-head">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>Kanıt tamamlanmadan otomatik yönlendirme önerilmez</span>
        </div>
        <p class="risk-approval-desc">
          Mevcut kanıt yeterliliği (${sig ? pct(sig.sufficient) : "—"}) hedef eşiğin (${pct(st.tau_suff)}) altında. Yanlış uzman kuyruğuna yönlendirme riskini (R=${num(d.risk, 3)}) düşürmek için önce önerilen kanıtı ekleyin veya uzman incelemesine gönderin.
        </p>
      </div>
    `;
  } else if (cat === "inspecting") {
    riskApprovalHtml = `
      <div class="risk-approval-box">
        <div class="risk-approval-head" style="color:var(--info)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span>Yönlendirme önerisi onaya hazır</span>
        </div>
        <p class="risk-approval-desc">
          Kanıt yeterliliği ve uzmanlık olasılığı eşikleri karşılandı. Önerilen <strong>${esc(team.label)}</strong> yönlendirmesini onaylayarak vakayı ilgili ekibe atayabilirsiniz.
        </p>
      </div>
    `;
  } else {
    riskApprovalHtml = `
      <div class="risk-approval-box">
        <div class="risk-approval-head" style="color:var(--accent)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span>Yönlendirme kararı onaylandı</span>
        </div>
        <p class="risk-approval-desc">
          Vaka <strong>${esc(team.label)}</strong> uzman ekibine yönlendirildi ve karar geçmişine işlendi.
        </p>
      </div>
    `;
  }

  // State-dependent Primary & Secondary Actions (Screen D requirement)
  let stateActionsHtml = "";
  if (cat === "awaiting_evidence") {
    stateActionsHtml = `
      <div class="decision-actions">
        <button type="button" class="btn btn-warning" data-case-action="request_evidence">
          Kanıt İste (Teknisyene Bildir)
        </button>
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="escalate">Uzman İncelemesine Gönder</button>
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="confirm_route">Yönlendirmeyi Onayla</button>
        </div>
      </div>
    `;
  } else if (cat === "expert_review") {
    stateActionsHtml = `
      <div class="decision-actions">
        <button type="button" class="btn btn-primary" data-open-override="approve">
          Yönlendirmeyi Onayla (Uzman Kararı)
        </button>
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Farklı Ekibe Yönlendir</button>
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="request_evidence">Kanıt İste</button>
        </div>
      </div>
    `;
  } else if (cat === "inspecting") {
    stateActionsHtml = `
      <div class="decision-actions">
        <button type="button" class="btn btn-primary" data-case-action="confirm_route">
          Yönlendirmeyi Onayla (${esc(team.label)})
        </button>
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="escalate">Uzman İncelemesine Gönder</button>
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="request_evidence">Kanıt İste</button>
        </div>
      </div>
    `;
  } else {
    stateActionsHtml = `
      <div class="decision-actions">
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Farklı Ekibe Yönlendir</button>
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="escalate">Uzman İncelemesine Gönder</button>
        </div>
      </div>
    `;
  }

  // Technical Explainability (Jev signals + Taxonomy tree + Candidate Utility Table)
  let techAccordionHtml = "";
  if (sig) {
    const leaves = Object.entries(d.nodes || {})
      .filter(([k]) => S.catalog.leaves.includes(k))
      .sort((a, b) => b[1] - a[1]);

    techAccordionHtml = `
      <details class="tech-details">
        <summary>
          <span>RAEP &amp; Jev Olasılık Dağılımı ve Kanıt Fayda Tablosu</span>
          <span class="mono">R=${num(d.risk, 3)} · L=${num(d.loss_weight, 2)}</span>
        </summary>
        <div class="tech-details-body">
          <div>
            <div class="analysis-label" style="margin-bottom:6px">
              <span>Jev Anlamsal Sensör Sinyalleri</span>
              <span class="mono">${step.latency_ms} ms</span>
            </div>
            <div class="bars">
              ${barHtml("Kanıt yeterliliği (sufficient)", sig.sufficient, { thr: st.tau_suff, cls: "suff" })}
              ${barHtml("Kritik güvenlik riski (critical)", sig.critical, { thr: st.tau_crit, cls: "crit" })}
              ${barHtml(`Aciliyet skoru (${num(sig.priority?.score, 1)} / 3)`, (sig.priority?.score || 0) / 3)}
            </div>
          </div>

          <div>
            <div class="analysis-label" style="margin-bottom:6px">
              <span>Hiyerarşik Uzmanlık Ağacı Olasılıkları P(düğüm)</span>
              <span class="mono">τ_route=${st.tau_route}</span>
            </div>
            <div class="bars">
              ${Object.keys(S.catalog.nodes).map((k) => barHtml(nodeLabel(k), d.nodes?.[k] ?? 0, {
                thr: st.tau_route,
                cls: `depth-${depth(k)}`,
                hit: k === d.target || k === topLeafId,
              })).join("")}
            </div>
            ${d.baseline_one_shot ? `<p class="field-hint" style="margin-top:6px">Baseline C (Jev tek-shot argmax): <strong>${esc(nodeLabel(d.baseline_one_shot))}</strong></p>` : ""}
          </div>

          ${d.candidates?.length ? `
            <div>
              <div class="analysis-label" style="margin-bottom:6px">
                <span>Aday Kanıtlar · U(e) = L·Δerr − λ·C</span>
                <span>Varsayım</span>
              </div>
              <table class="mini-table">
                <thead>
                  <tr><th>Kanıt</th><th class="num">ΔRisk</th><th class="num">Maliyet C</th><th class="num">Net U</th></tr>
                </thead>
                <tbody>
                  ${d.candidates.slice(0, 6).map((x) => `
                    <tr class="${x.id === d.evidence_id ? "chosen" : ""}">
                      <td>${esc(x.label)}</td>
                      <td class="num">${num(x.gain, 3)}</td>
                      <td class="num">${num(x.cost, 3)}</td>
                      <td class="num ${x.U > 0 ? "pos" : "neg"}">${num(x.U, 3)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : ""}

          <div style="display:flex;justify-content:flex-end">
            <button type="button" class="btn btn-subtle btn-xs" id="recompute-btn">
              Güncel Politika Ayarlarıyla Yeniden Hesapla (Jev Çağrısız)
            </button>
          </div>
        </div>
      </details>
    `;
  }

  // Left Column: Attachments Gallery
  const attachments = c.attachments || [];
  const attachmentsHtml = attachments.length
    ? `<div class="attachment-previews">
        ${attachments.map((att) => `
          <div class="att-card">
            <img class="att-thumb" src="${esc(att.data_url)}" alt="${esc(att.caption || att.name)}" data-preview-img="${esc(att.data_url)}" data-preview-cap="${esc(att.caption || att.name)}">
            <div class="att-meta">
              <span title="${esc(att.caption || att.name)}">${esc(att.caption || att.name)}</span>
            </div>
          </div>
        `).join("")}
      </div>`
    : `<p class="field-hint" style="margin-top:8px">Henüz bu vakaya ait fotoğraf yüklenmedi. "Kanıt Ekle" penceresinden konnektör veya parça fotoğrafı ekleyebilirsiniz.</p>`;

  // Left Column: Evidence Timeline
  const timelineHtml = `
    <ol class="evidence-timeline">
      <li class="ev-timeline-item initial">
        <div class="ev-timeline-head">
          <strong>Başlangıç Vaka Bildirimi ve İlk Gözlem</strong>
          <time>${esc(formatTime(c.created_at))}</time>
        </div>
        <div class="ev-timeline-body">
          ${esc(c.technician_note)}
          ${c.initial_measurements ? `<div style="margin-top:4px;color:var(--text-primary)"><strong>İlk Ölçüm:</strong> ${esc(c.initial_measurements)}</div>` : ""}
        </div>
      </li>
      ${(c.evidence || []).map((ev, i) => `
        <li class="ev-timeline-item">
          <div class="ev-timeline-head">
            <strong>Toplanan Kanıt #${i + 1}: ${esc(ev.label)}</strong>
            <time>${esc(formatTime(ev.at))}</time>
          </div>
          <div class="ev-timeline-body">${esc(ev.result)}</div>
        </li>
      `).join("")}
    </ol>
  `;

  // Audit Trail
  const auditItems = c.audit?.length
    ? c.audit
    : [{ at: c.created_at, actor: "Sistem (RAEP)", action: d.action || "Değerlendirildi", detail: d.reason || "İlk analiz tamamlandı." }];

  container.innerHTML = `
    <div class="detail-top-bar">
      <div class="detail-title-group">
        <a href="#cases" class="btn btn-subtle btn-sm">← Vakalar</a>
        <span class="detail-id">${esc(c.id)}</span>
        ${statusBadgeHtml(c)}
        ${priorityBadgeHtml(c)}
        ${scenario ? `<span class="badge badge-neutral" title="Sentetik Demo Senaryosu">Demo: ${esc(scenario.title)}</span>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-secondary btn-sm" data-open-ev-modal="${esc(reqEvId || "connector_photo")}">
          + Kanıt / Ölçüm Gir
        </button>
      </div>
    </div>

    <div class="detail-grid">
      <!-- LEFT 60%: Case & Evidence -->
      <div class="detail-left-col">
        <section class="card" aria-labelledby="veh-sum-h">
          <div class="section-header" style="margin-bottom:8px">
            <h2 id="veh-sum-h">${esc(c.vehicle.family)}</h2>
            <span class="mono text-secondary">${esc(c.vehicle.vin || "VIN Belirtilmedi")}</span>
          </div>
          <dl class="vehicle-summary-grid">
            <div class="summary-kv"><dt>Tahrik / Yakıt</dt><dd>${c.vehicle.fuel === "electric" ? "Elektrik (HV)" : "Dizel (ICE)"}</dd></div>
            <div class="summary-kv"><dt>Kilometre</dt><dd class="mono">${Number(c.vehicle.km).toLocaleString("tr-TR")} km</dd></div>
            <div class="summary-kv"><dt>Servis Noktası</dt><dd>${esc(c.vehicle.location || "Merkez Yetkili Servis")}</dd></div>
            <div class="summary-kv"><dt>Son Güncelleme</dt><dd class="mono">${esc(formatTime(c.updated_at || c.created_at))}</dd></div>
          </dl>
        </section>

        <section class="card" aria-labelledby="prob-desc-h">
          <h2 id="prob-desc-h">Arıza Açıklaması ve Teknisyen Notları</h2>
          <div class="problem-block">${esc(c.technician_note)}</div>
          ${c.initial_measurements ? `
            <div style="margin-top:12px">
              <h3>İlk Ölçümler ve Gözlemler</h3>
              <p class="text-secondary" style="margin-top:4px">${esc(c.initial_measurements)}</p>
            </div>
          ` : ""}
          <div class="detail-subgrid">
            <div>
              <h3>Arıza Kodları (DTC)</h3>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                ${c.dtc_codes?.length
                  ? c.dtc_codes.map((code) => `<span class="dtc-chip">${esc(code)}</span>`).join("")
                  : `<span class="text-secondary">Aktif veya kayıtlı DTC kodu bildirilmedi.</span>`}
              </div>
            </div>
            <div>
              <h3>Araç Servis Geçmişi</h3>
              <p class="text-secondary" style="margin-top:6px">${esc(c.recent_repairs || "Yakın tarihli onarım kaydı bildirilmedi.")}</p>
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="photos-h">
          <div class="section-header" style="margin-bottom:4px">
            <div>
              <h2 id="photos-h">Yüklenen Fotoğraflar ve Görsel Kanıtlar</h2>
              <p class="section-subtitle">Saha teknisyeni tarafından eklenen görsel inceleme kayıtları</p>
            </div>
            <button type="button" class="btn btn-subtle btn-xs" data-open-ev-modal="connector_photo">+ Fotoğraf Ekle</button>
          </div>
          ${attachmentsHtml}
        </section>

        <section class="card" aria-labelledby="ev-tl-h">
          <div class="section-header" style="margin-bottom:4px">
            <div>
              <h2 id="ev-tl-h">Kanıt Zaman Çizelgesi</h2>
              <p class="section-subtitle">Vaka açılışından itibaren toplanan tüm teknik kanıtlar (${(c.evidence?.length || 0) + 1} kayıt)</p>
            </div>
          </div>
          ${timelineHtml}
        </section>
      </div>

      <!-- RIGHT 40%: ServicePilot Decision Panel -->
      <aside class="detail-right-col" aria-label="ServicePilot Karar Paneli">
        <section class="analysis-panel">
          <div class="analysis-panel-head">
            <div class="analysis-title-wrap">
              <span class="analysis-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
              </span>
              <div>
                <h2>ServicePilot Analizi</h2>
                <span class="field-hint">Adım ${c.steps?.length || 1}${step.recomputed ? " · Yeniden hesaplandı" : ""}</span>
              </div>
            </div>
            <span class="badge badge-neutral mono">${sig ? `${step.latency_ms} ms` : "Safety Gate"}</span>
          </div>

          <!-- 1. Önerilen Uzman Ekip -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Önerilen Uzman Ekip</span>
              ${topProb != null ? `<span class="mono">Güven: ${pct(topProb)}</span>` : ""}
            </div>
            <div class="specialist-box">
              <div class="specialist-name">
                <span>${esc(team.label)}</span>
                ${c.review_status === "confirmed" || c.review_status === "approved" || c.review_status === "overridden"
                  ? `<span class="badge badge-routed">Onaylı</span>`
                  : ""}
              </div>
              <span class="specialist-path">${esc(hierarchyPath(team.id))}</span>
            </div>
          </div>

          <!-- 2. Değerlendirme Gerekçesi -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Değerlendirme Gerekçesi</span>
            </div>
            <div class="rationale-text">${esc(readableRationale)}</div>
          </div>

          <!-- 3. Eksik Kanıt (Signature Feature) -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Eksik Kanıt</span>
              ${sig ? `<span class="mono">Yeterlilik: ${pct(sig.sufficient)}</span>` : ""}
            </div>
            ${missingEvidenceHtml}
          </div>

          <!-- 4. Risk ve İnsan Onayı -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Risk ve İnsan Onayı</span>
            </div>
            ${riskApprovalHtml}
          </div>

          <!-- 5. Duruma Bağlı Aksiyonlar -->
          ${stateActionsHtml}

          <!-- 6. Karar Geçmişi (Audit Trail) -->
          <div class="analysis-block" style="padding-top:6px;border-top:1px solid var(--border)">
            <div class="analysis-label">
              <span>Karar Geçmişi</span>
              <span class="mono">${auditItems.length} işlem</span>
            </div>
            <ol class="audit-trail">
              ${auditItems.map((a) => `
                <li class="audit-item">
                  <div class="audit-head">
                    <span>${esc(a.action)}</span>
                    <time>${esc(formatTime(a.at))}</time>
                  </div>
                  <div class="audit-actor">${esc(a.actor)}</div>
                  <div class="audit-detail">${esc(a.detail)}</div>
                </li>
              `).join("")}
            </ol>
          </div>

          <!-- 7. RAEP & Jev Teknik Detayları -->
          ${techAccordionHtml}
        </section>
      </aside>
    </div>
  `;

  $("#recompute-btn")?.addEventListener("click", (e) => busy(e.currentTarget, "Hesaplanıyor…", async () => {
    upsertCase(await api(`/cases/${c.id}/recompute`, { method: "POST" }));
    toast("Karar güncel RAEP politika ayarlarıyla yeniden hesaplandı.");
  }));
}

// ---------- SCREEN E: Uzman İncelemesi (Expert Review, Queues, Policy & Replay) ----------
function renderExpertReview() {
  $$("[data-review-tab]").forEach((btn) => {
    const active = btn.dataset.reviewTab === S.reviewTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  $("#review-tab-queue").hidden = S.reviewTab !== "queue";
  $("#review-tab-teams").hidden = S.reviewTab !== "teams";
  $("#review-tab-policy").hidden = S.reviewTab !== "policy";

  // 1. Expert Review Queue
  const pendingReviewCases = S.cases.filter((c) => caseCategory(c) === "expert_review" || caseCategory(c) === "inspecting");
  const reviewedCases = S.cases.filter((c) => c.review_status === "approved" || c.review_status === "overridden" || c.review_status === "confirmed");

  const listEl = $("#expert-review-list");
  const renderReviewCard = (c, isCompleted = false) => {
    const step = c.steps?.at(-1);
    const d = step?.decision || {};
    const team = suggestedTeamInfo(c);
    const isCrit = caseCategory(c) === "expert_review";
    const reasonText = d.safety_hits?.length
      ? `Deterministik güvenlik kuralı tetiklendi: "${d.safety_hits.join(", ")}"`
      : d.reason || "Uzman incelemesi ve yönlendirme onayı gerekiyor.";

    const reviewStatusMap = {
      pending_review: ["badge-escalated", "Uzman Onayında"],
      pending_confirmation: ["badge-inspecting", "Yönlendirme Onayı Bekliyor"],
      approved: ["badge-routed", "Uzman Tarafından Onaylandı"],
      overridden: ["badge-warning", "Uzman Tarafından Değiştirildi"],
      confirmed: ["badge-routed", "Onaylandı"],
    };
    const [stCls, stLbl] = reviewStatusMap[c.review_status] || ["badge-warning", "İnceleme Bekliyor"];

    return `
      <article class="review-card ${isCrit ? "" : "is-confirmation"}">
        <div class="review-card-top">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="mono" style="font-weight:600;font-size:1rem">${esc(c.id)}</span>
            <strong>${esc(c.vehicle.family)}</strong>
            <span class="mono text-secondary">${esc(c.vehicle.vin || "")}</span>
            ${priorityBadgeHtml(c)}
            <span class="badge ${stCls}">${esc(stLbl)}</span>
          </div>
          <span class="mono text-secondary" style="font-size:0.78rem">${esc(formatTime(c.updated_at || c.created_at))}</span>
        </div>

        <div class="review-card-grid">
          <div class="review-col">
            <h4>Eskalasyon / İnceleme Gerekçesi</h4>
            <p>${esc(reasonText)}</p>
          </div>
          <div class="review-col">
            <h4>Mevcut Kanıtlar (${(c.evidence?.length || 0) + 1})</h4>
            <p>${esc(c.technician_note)}</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
              ${(c.dtc_codes || []).map((code) => `<span class="dtc-chip">${esc(code)}</span>`).join("")}
              ${(c.evidence || []).map((e) => `<span class="badge badge-neutral">${esc(e.label)}</span>`).join("")}
            </div>
          </div>
          <div class="review-col">
            <h4>Önerilen Uzman Ekip</h4>
            <p style="font-weight:600;font-size:0.95rem">${esc(team.label)}</p>
            <span class="field-hint">${esc(hierarchyPath(team.id))}</span>
          </div>
        </div>

        <div class="review-card-actions">
          <a href="#cases/${esc(c.id)}" class="btn btn-secondary btn-sm">Vaka Detayını İncele</a>
          ${!isCompleted ? `
            <div class="review-btn-group">
              <button type="button" class="btn btn-secondary btn-sm" data-review-override="${esc(c.id)}">
                Farklı Ekibe Yönlendir (Override)
              </button>
              <button type="button" class="btn btn-primary btn-sm" data-review-approve="${esc(c.id)}">
                Önerilen Yönlendirmeyi Onayla
              </button>
            </div>
          ` : `
            <div class="review-btn-group">
              <button type="button" class="btn btn-subtle btn-xs" data-review-override="${esc(c.id)}">Kararı Değiştir</button>
            </div>
          `}
        </div>
      </article>
    `;
  };

  listEl.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Onay Bekleyen Vakalar (${pendingReviewCases.length})</h2>
        <p class="section-subtitle">Güvenlik kapısı (Safety Gate), yüksek risk olasılığı veya yönlendirme teyidi bekleyen vakalar</p>
      </div>
    </div>
    ${pendingReviewCases.length
      ? `<div class="review-queue-list">${pendingReviewCases.map((c) => renderReviewCard(c, false)).join("")}</div>`
      : `<div class="empty-state">
          <h3>İnceleme bekleyen vaka bulunmuyor</h3>
          <p>Kritik veya onay bekleyen tüm vakalar değerlendirildi.</p>
        </div>`
    }

    ${reviewedCases.length ? `
      <div class="section-header" style="margin-top:28px">
        <div>
          <h2>Kaydedilmiş Uzman ve Yönlendirme Kararları (${reviewedCases.length})</h2>
          <p class="section-subtitle">Uzman onayı veya yönlendirme değişikliği tamamlanmış vakalar</p>
        </div>
      </div>
      <div class="review-queue-list">${reviewedCases.map((c) => renderReviewCard(c, true)).join("")}</div>
    ` : ""}
  `;

  // 2. Specialist Team Queues (FR-11)
  const groups = {};
  for (const c of S.cases.filter((x) => x.final)) {
    (groups[c.final.target] ??= []).push(c);
  }
  const order = ["expert_desk", ...Object.keys(S.catalog.nodes)];
  $("#queues-grid").innerHTML = order
    .filter((k) => groups[k] || S.catalog.leaves.includes(k) || k === "expert_desk")
    .map((k) => {
      const fallback = k !== "expert_desk" && !S.catalog.leaves.includes(k);
      const list = groups[k] || [];
      return `
        <section class="card queue-card ${k === "expert_desk" ? "desk" : ""}">
          <div class="queue-card-head">
            <strong>${esc(nodeLabel(k))}${fallback ? " <small class='text-secondary'>(Üst Düğüm)</small>" : ""}</strong>
            <span class="badge ${list.length ? "badge-accent" : "badge-neutral"} mono">${list.length}</span>
          </div>
          ${list.length
            ? list.map((c) => `
              <a href="#cases/${esc(c.id)}" class="queue-item-link">
                <div style="display:flex;justify-content:space-between;gap:6px">
                  <strong class="mono">${esc(c.id)}</strong>
                  <span class="text-secondary">${esc(c.vehicle.family)}</span>
                </div>
                <div class="text-secondary" style="font-size:0.78rem;margin-top:3px">${esc(c.technician_note.slice(0, 72))}…</div>
              </a>
            `).join("")
            : `<p class="field-hint">Bu kuyrukta bekleyen vaka yok.</p>`}
        </section>
      `;
    }).join("");
}

// ---------- Policy & Replay (FR-10, FR-13) ----------
const POLICY_FIELDS = [
  ["tau_route", "τ_route · Otomatik yönlendirme eşiği", 0.5, 0.99, 0.01, "Uzmanlık düğümüne yönlendirme için gereken minimum olasılık."],
  ["tau_suff", "τ_suff · Kanıt yeterlilik eşiği", 0, 1, 0.01, "Yaprak uzmanlığa doğrudan yönlendirme için Jev sufficient alt sınırı."],
  ["tau_crit", "τ_crit · Kritik eskalasyon eşiği", 0.1, 0.99, 0.01, "Jev critical bu değeri geçerse insan uzmana eskale edilir."],
  ["lambda", "λ · Maliyet ağırlığı", 0, 3, 0.05, "Yüksek λ = daha az kanıt isteği, daha erken karar."],
  ["w_crit", "w_crit · Kritik kayıp çarpanı", 0, 10, 0.5, "L = 1 + w_crit·p_crit; kritik vakada belirsizlik daha pahalıdır."],
  ["alpha", "α · Süre ağırlığı (dk başına)", 0, 0.05, 0.001, ""],
  ["beta", "β · Efor ağırlığı", 0, 0.2, 0.005, ""],
  ["gamma", "γ · Güvenlik/operasyon ağırlığı", 0, 0.5, 0.01, ""],
  ["max_requests", "Maksimum kanıt isteği", 0, 8, 1, "Limit dolunca hiyerarşik fallback veya eskalasyon uygulanır."],
];

function renderPolicySection() {
  const f = $("#policy-form");
  if (!f) return;
  f.innerHTML = POLICY_FIELDS.map(([k, l, min, max, step, help]) => `
    <div class="field">
      <label for="p-${k}"><span>${esc(l)}</span> <output id="o-${k}" for="p-${k}">${S.settings[k]}</output></label>
      <input type="range" id="p-${k}" name="${k}" min="${min}" max="${max}" step="${step}" value="${S.settings[k]}">
      ${help ? `<span class="field-hint">${esc(help)}</span>` : ""}
    </div>
  `).join("") + `
    <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:6px">
      <button type="submit" class="btn btn-primary btn-sm">Politika Ayarlarını Kaydet</button>
      <button type="button" class="btn btn-secondary btn-sm" id="policy-default-btn">Varsayılanlara Dön</button>
    </div>
  `;
  f.oninput = (e) => {
    if (e.target.name) $(`#o-${e.target.name}`).value = e.target.value;
  };

  $("#evidence-catalog").innerHTML = `
    <table class="mini-table">
      <thead>
        <tr><th>Kanıt</th><th class="num">T (dk)</th><th class="num">E</th><th class="num">S</th><th class="num">ρ</th><th>Ayırt Ettiği Uzmanlıklar</th></tr>
      </thead>
      <tbody>
        ${Object.values(S.catalog.evidence).map((e) => `
          <tr>
            <td>${esc(e.label)}${e.requires_ev ? " <span class='badge badge-info'>EV</span>" : ""}</td>
            <td class="num">${e.T}</td>
            <td class="num">${e.E}</td>
            <td class="num">${e.S}</td>
            <td class="num">${e.rho}</td>
            <td class="text-secondary">${e.informs.map(nodeLabel).join(", ")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function replayCorrect(expected, x) {
  if (expected === "ESCALATE") return x.action === "ESCALATE" ? "ok" : "bad";
  if (x.target === expected) return "ok";
  return x.action === "ROUTE" && ancestors(expected).includes(x.target) ? "hier" : "bad";
}

function renderReplayOutput(data) {
  const names = {
    servicepilot: "ServicePilot (Jev + RAEP)",
    baseline_b: "Baseline B · Sabit Checklist",
    baseline_c: "Baseline C · Jev Tek-Shot",
  };
  const m = (k) => data.systems[k];
  const mark = (r) => ({ ok: `<span class="ok">✓</span>`, hier: `<span class="pos">≈</span>`, bad: `<span class="bad">✗</span>` })[r];

  const cards = Object.keys(names).map((k) => `
    <section class="card">
      <h3>${names[k]}</h3>
      <dl>
        <dt>Tam doğruluk</dt><dd>${pct(m(k).exact_acc)}</dd>
        <dt>Hiyerarşik doğruluk</dt><dd>${pct(m(k).hier_acc)}</dd>
        <dt>Otomasyon coverage</dt><dd>${pct(m(k).coverage)}</dd>
        <dt>Yanlış otomatik route</dt><dd class="${m(k).wrong_route ? "bad" : "ok"}">${m(k).wrong_route}</dd>
        <dt>Kritik eskalasyon recall</dt><dd class="${m(k).critical_recall === 1 ? "ok" : "bad"}">${pct(m(k).critical_recall)}</dd>
        <dt>Ort. kanıt isteği</dt><dd>${num(m(k).avg_requests, 2)}</dd>
        <dt>Ort. kanıt maliyeti C</dt><dd>${num(m(k).avg_cost, 3)}</dd>
      </dl>
    </section>
  `).join("");

  const cell = (r, k) => {
    const x = r[k];
    return `
      <td>
        ${mark(replayCorrect(r.expected, x))}
        ${x.action === "ESCALATE" ? `<span class="badge badge-escalated">ESCALATE</span>` : esc(x.target_label)}
        ${x.requests ? `<div class="field-hint">${x.requests} kanıt · C=${num(x.cost, 2)}</div>` : ""}
      </td>`;
  };

  $("#replay-out").innerHTML = `
    <div class="metric-cards">${cards}</div>
    <div class="table-scroll">
      <table class="mini-table">
        <thead><tr><th>Senaryo</th><th>Beklenen</th><th>ServicePilot</th><th>Baseline B</th><th>Baseline C</th></tr></thead>
        <tbody>
          ${data.rows.map((r) => `
            <tr>
              <td>
                <strong>${esc(r.title)}</strong>
                ${r.servicepilot.evidence?.length ? `<div class="field-hint">İstenen: ${esc(r.servicepilot.evidence.join(" → "))}</div>` : ""}
              </td>
              <td>${esc(r.expected_label)}</td>
              ${cell(r, "servicepilot")}${cell(r, "baseline_b")}${cell(r, "baseline_c")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- Modals: Evidence Entry & Expert Override ----------
function openEvidenceModal(caseId, preferredEvId) {
  const c = S.cases.find((x) => x.id === caseId);
  if (!c) return;
  const modal = $("#evidence-modal");
  const select = $("#ev-modal-select");
  const evEntries = Object.entries(S.catalog.evidence);
  const chosenId = preferredEvId && S.catalog.evidence[preferredEvId] ? preferredEvId : c.pending_evidence || "connector_photo";

  select.innerHTML = evEntries.map(([id, ev]) => `
    <option value="${esc(id)}" ${id === chosenId ? "selected" : ""}>${esc(ev.label)} (~${ev.T} dk · Efor ${ev.E}/5)</option>
  `).join("");

  const updateEvMeta = () => {
    const ev = S.catalog.evidence[select.value];
    $("#ev-modal-meta").textContent = ev
      ? `Ayırt ettiği uzmanlıklar: ${ev.informs.map(nodeLabel).join(", ")} · Güvenilirlik varsayımı ρ=${ev.rho}`
      : "";
    const sc = S.scenarios.find((s) => s.id === c.scenario_id);
    const fillBtn = $("#ev-modal-fill-btn");
    fillBtn.hidden = !sc;
    fillBtn.onclick = () => {
      $("#ev-modal-result").value = sc?.answers?.[select.value] ?? NO_FINDING;
      $("#ev-modal-error").textContent = "";
    };
  };

  select.onchange = updateEvMeta;
  updateEvMeta();

  $("#ev-modal-result").value = "";
  $("#ev-modal-error").textContent = "";
  $("#ev-modal-photo").value = "";
  $("#ev-modal-photo-preview").innerHTML = "";
  S.modalAttachment = null;
  modal.dataset.caseId = c.id;
  modal.showModal();
}

function openOverrideModal(caseId, mode = "override") {
  const c = S.cases.find((x) => x.id === caseId);
  if (!c) return;
  const modal = $("#override-modal");
  const team = suggestedTeamInfo(c);
  const select = $("#ov-modal-target");

  const options = Object.keys(S.catalog.nodes).map((id) => ({
    id,
    label: `${S.catalog.leaves.includes(id) ? "" : "[Üst Uzmanlık] "}${nodeLabel(id)}`,
  }));

  select.innerHTML = options.map((o) => `
    <option value="${esc(o.id)}" ${o.id === team.id ? "selected" : ""}>${esc(o.label)}</option>
  `).join("");

  const isApprove = mode === "approve";
  $("#ov-modal-badge").textContent = isApprove ? "Uzman Onayı" : "Yönlendirme Değişikliği (Override)";
  $("#ov-modal-title").textContent = isApprove ? "Önerilen Yönlendirmeyi Onayla" : "Farklı Uzman Ekibe Yönlendir";
  $("#ov-modal-desc").textContent = isApprove
    ? `${c.id} (${c.vehicle.family}) vakası için önerilen uzman ekibi onaylayın ve denetim izine kaydedin.`
    : `${c.id} (${c.vehicle.family}) vakası için hedef uzman ekibi seçin ve değişiklik gerekçesini belirtin.`;
  $("#ov-reason-req").textContent = isApprove ? "İsteğe bağlı" : "Zorunlu";
  $("#ov-modal-reason").value = "";
  $("#ov-modal-error").textContent = "";

  modal.dataset.caseId = c.id;
  modal.dataset.mode = mode;
  modal.showModal();
}

// ---------- Router & View Switching ----------
function routeView() {
  const raw = location.hash.slice(1) || "overview";
  const [rawView, param] = raw.split("/");

  // Map legacy hashes (#queues, #policy, #replay) to Screen E tabs so existing links never break
  let view = rawView;
  if (rawView === "queues") { view = "review"; S.reviewTab = "teams"; }
  else if (rawView === "policy" || rawView === "replay") { view = "review"; S.reviewTab = "policy"; }
  else if (rawView === "cases" && param) { view = "detail"; S.selected = param; }
  else if (!["overview", "cases", "new", "detail", "review"].includes(rawView)) { view = "overview"; }

  $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== view; });

  const navView = view === "detail" ? "cases" : view;
  $$(".sidebar-nav .nav-item").forEach((a) => {
    if (a.dataset.view === navView) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  // Update Breadcrumb
  const bc = $("#breadcrumb");
  if (view === "overview") {
    bc.innerHTML = `<span class="breadcrumb-current">Genel Bakış</span>`;
  } else if (view === "cases") {
    bc.innerHTML = `<a href="#overview">ServicePilot</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">Vakalar</span>`;
  } else if (view === "detail") {
    const c = S.cases.find((x) => x.id === S.selected);
    bc.innerHTML = `<a href="#cases">Vakalar</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current mono">${esc(c?.id || S.selected || "")}</span>${c ? `<span class="text-secondary">· ${esc(c.vehicle.family)}</span>` : ""}`;
  } else if (view === "new") {
    bc.innerHTML = `<a href="#cases">Vakalar</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">Yeni Vaka</span>`;
  } else if (view === "review") {
    bc.innerHTML = `<a href="#overview">ServicePilot</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">Uzman İncelemesi</span>`;
  }

  // Close mobile drawer on navigation
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").hidden = true;

  if (view === "overview") renderOverview();
  if (view === "cases") renderCasesScreen();
  if (view === "detail") renderCaseDetail();
  if (view === "new") loadDraftIfPresent();
  if (view === "review") renderExpertReview();
}

function renderAll() {
  updateNavCounts();
  routeView();
}

// ---------- Event Listeners ----------
function bindEvents() {
  window.addEventListener("hashchange", routeView);

  // Mobile sidebar drawer
  $("#sidebar-open")?.addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#sidebar-backdrop").hidden = false;
  });
  const closeDrawer = () => {
    $("#sidebar").classList.remove("open");
    $("#sidebar-backdrop").hidden = true;
  };
  $("#sidebar-close")?.addEventListener("click", closeDrawer);
  $("#sidebar-backdrop")?.addEventListener("click", closeDrawer);

  // Quick policy & reset buttons in sidebar footer
  $("#open-policy-btn")?.addEventListener("click", () => {
    S.reviewTab = "policy";
    location.hash = "#policy";
    routeView();
  });

  $("#reset-demo-btn")?.addEventListener("click", async (e) => {
    await busy(e.currentTarget, "Sıfırlanıyor…", async () => {
      S.cases = await api("/cases/seed", { method: "POST" });
      S.selected = S.cases[0]?.id || null;
      renderAll();
      toast("5 temsili demo vakası başlangıç durumuna sıfırlandı.");
    });
  });

  // Global search bar
  const globalSearch = $("#global-search-input");
  globalSearch?.addEventListener("input", (e) => {
    S.caseSearch = e.target.value;
    if (location.hash !== "#cases") location.hash = "#cases";
    else renderCasesScreen();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      globalSearch?.focus();
    }
  });

  // Cases search & status filter pills
  $("#cases-search-input")?.addEventListener("input", (e) => {
    S.caseSearch = e.target.value;
    renderCasesScreen();
  });
  $("#status-filters")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    S.caseFilter = btn.dataset.filter;
    renderCasesScreen();
  });

  // Review view tabs
  document.addEventListener("click", async (e) => {
    const tabBtn = e.target.closest("[data-review-tab]");
    if (tabBtn) {
      S.reviewTab = tabBtn.dataset.reviewTab;
      renderExpertReview();
      return;
    }

    const openCaseEl = e.target.closest("[data-open-case]");
    if (openCaseEl && !e.target.closest("button, a")) {
      location.hash = `#cases/${openCaseEl.dataset.openCase}`;
      return;
    }
    if (openCaseEl && e.target.closest(".priority-case-card, tr[data-open-case]")) {
      location.hash = `#cases/${openCaseEl.dataset.openCase}`;
      return;
    }

    // Scenario prefill
    const fillSc = e.target.closest("[data-fill-scenario]");
    if (fillSc) {
      const sc = S.scenarios.find((x) => x.id === fillSc.dataset.fillScenario);
      if (sc) prefillScenarioIntoForm(sc);
      return;
    }

    // DTC chip suggest & remove
    const sug = e.target.closest("[data-dtc]");
    if (sug) {
      const code = sug.dataset.dtc;
      if (!S.formDtcs.includes(code)) {
        S.formDtcs.push(code);
        renderFormDtcChips();
      }
      return;
    }
    const remDtc = e.target.closest("[data-remove-dtc]");
    if (remDtc) {
      S.formDtcs.splice(Number(remDtc.dataset.removeDtc), 1);
      renderFormDtcChips();
      return;
    }

    // Remove attachment from form
    const remAtt = e.target.closest("[data-remove-att]");
    if (remAtt) {
      S.formAttachments.splice(Number(remAtt.dataset.removeAtt), 1);
      renderFormAttachments();
      return;
    }

    // Image lightbox preview
    const prevImg = e.target.closest("[data-preview-img]");
    if (prevImg) {
      $("#img-modal-src").src = prevImg.dataset.previewImg;
      $("#img-modal-caption").textContent = prevImg.dataset.previewCap || "";
      $("#image-modal").showModal();
      return;
    }

    // Close modal buttons
    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      $(`#${closeBtn.dataset.closeModal}`)?.close();
      return;
    }

    // Open Evidence Modal
    const openEvBtn = e.target.closest("[data-open-ev-modal]");
    if (openEvBtn) {
      openEvidenceModal(S.selected, openEvBtn.dataset.openEvModal);
      return;
    }

    // Open Override / Approve Modal from Case Detail or Review Screen
    const ovBtn = e.target.closest("[data-open-override]");
    if (ovBtn) {
      openOverrideModal(S.selected, ovBtn.dataset.openOverride);
      return;
    }
    const revOv = e.target.closest("[data-review-override]");
    if (revOv) {
      openOverrideModal(revOv.dataset.reviewOverride, "override");
      return;
    }
    const revApp = e.target.closest("[data-review-approve]");
    if (revApp) {
      const cid = revApp.dataset.reviewApprove;
      await busy(revApp, "Onaylanıyor…", async () => {
        const updated = await api(`/cases/${cid}/review`, { method: "POST", body: { action: "approve" } });
        upsertCase(updated);
        toast(`${cid} yönlendirmesi onaylandı.`);
      });
      return;
    }

    // State-dependent Case Actions on Screen D
    const caseAct = e.target.closest("[data-case-action]");
    if (caseAct) {
      const action = caseAct.dataset.caseAction;
      const c = S.cases.find((x) => x.id === S.selected);
      if (!c) return;
      await busy(caseAct, "İşleniyor…", async () => {
        const updated = await api(`/cases/${c.id}/review`, { method: "POST", body: { action } });
        upsertCase(updated);
        const msgMap = {
          confirm_route: "Yönlendirme onaylandı ve uzman ekibe atandı.",
          escalate: "Vaka uzman incelemesi (ProEye) kuyruğuna gönderildi.",
          request_evidence: "Teknisyene eksik kanıt talebi iletildi.",
        };
        toast(msgMap[action] || "Vaka durumu güncellendi.");
      });
    }
  });

  // Toggle all scenarios drawer on New Case screen
  $("#toggle-scenarios-btn")?.addEventListener("click", (e) => {
    const drawer = $("#all-scenarios-drawer");
    const open = drawer.hidden;
    drawer.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Senaryoları Gizle" : `Senaryoları Göster (${S.scenarios.length})`;
  });

  // Auto-select electric fuel when EV model chosen
  $("#family")?.addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase();
    if (val.includes("volt") || val.includes("citivolt")) {
      const r = $(`#case-form input[name="fuel"][value="electric"]`);
      if (r) r.checked = true;
    }
  });

  // DTC chip entry
  $("#add-dtc-btn")?.addEventListener("click", addDtcFromInput);
  $("#dtc-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDtcFromInput();
    }
  });

  // Photo dropzone in New Case Form
  const dropzone = $("#photo-dropzone");
  const photoInput = $("#photo-input");
  dropzone?.addEventListener("click", () => photoInput?.click());
  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      photoInput?.click();
    }
  });
  dropzone?.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer?.files?.length) {
      handleFileReads(e.dataTransfer.files, (att) => {
        S.formAttachments.push(att);
        renderFormAttachments();
      });
    }
  });
  photoInput?.addEventListener("change", (e) => {
    if (e.target.files?.length) {
      handleFileReads(e.target.files, (att) => {
        S.formAttachments.push(att);
        renderFormAttachments();
      });
      photoInput.value = "";
    }
  });

  // Draft save & clear
  $("#save-draft-btn")?.addEventListener("click", () => {
    const f = $("#case-form");
    const draft = {
      family: f.elements.family.value,
      vin: f.elements.vin.value,
      km: f.elements.km.value,
      location: f.elements.location.value,
      fuel: f.elements.fuel.value,
      note: f.elements.note.value,
      repairs: f.elements.repairs.value,
      initial_measurements: f.elements.initial_measurements.value,
      dtcs: S.formDtcs,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    $("#draft-banner").hidden = false;
    toast("Vaka taslağı tarayıcıya kaydedildi.");
  });

  $("#clear-draft-btn")?.addEventListener("click", () => {
    localStorage.removeItem(DRAFT_KEY);
    $("#case-form").reset();
    S.formDtcs = [];
    S.formAttachments = [];
    renderFormDtcChips();
    renderFormAttachments();
    $("#draft-banner").hidden = true;
    toast("Taslak temizlendi.");
  });

  // Submit New Case Form
  $("#case-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    addDtcFromInput();
    const f = e.target;
    const family = f.elements.family.value.trim();
    const kmStr = f.elements.km.value.trim();
    const note = f.elements.note.value.trim();

    $("#err-family").textContent = "";
    $("#err-km").textContent = "";
    $("#err-note").textContent = "";
    $("#form-error").hidden = true;

    let hasErr = false;
    if (!family) {
      $("#err-family").textContent = "Lütfen araç modelini girin.";
      f.elements.family.setAttribute("aria-invalid", "true");
      hasErr = true;
    } else f.elements.family.removeAttribute("aria-invalid");

    if (!kmStr || Number.isNaN(Number(kmStr)) || Number(kmStr) < 0) {
      $("#err-km").textContent = "Geçerli bir kilometre değeri girin.";
      f.elements.km.setAttribute("aria-invalid", "true");
      hasErr = true;
    } else f.elements.km.removeAttribute("aria-invalid");

    if (note.length < 5) {
      $("#err-note").textContent = "Lütfen en az 5 karakterlik arıza açıklaması yazın.";
      f.elements.note.setAttribute("aria-invalid", "true");
      hasErr = true;
    } else f.elements.note.removeAttribute("aria-invalid");

    if (hasErr) {
      $("#form-error").textContent = "Lütfen işaretli zorunlu alanları kontrol edin.";
      $("#form-error").hidden = false;
      return;
    }

    const payload = {
      vehicle: {
        family,
        fuel: f.elements.fuel.value,
        km: Number(kmStr),
        vin: f.elements.vin.value.trim().toUpperCase(),
        location: f.elements.location.value.trim(),
      },
      technician_note: note,
      initial_measurements: f.elements.initial_measurements.value.trim(),
      dtc_codes: [...S.formDtcs],
      recent_repairs: f.elements.repairs.value.trim(),
      attachments: [...S.formAttachments],
      scenario_id: f.dataset.scenarioId || null,
    };

    await busy($("#submit-case-btn"), "ServicePilot Analiz Ediyor…", async () => {
      const created = await api("/cases", { method: "POST", body: payload });
      localStorage.removeItem(DRAFT_KEY);
      f.reset();
      delete f.dataset.scenarioId;
      S.formDtcs = [];
      S.formAttachments = [];
      renderFormDtcChips();
      renderFormAttachments();
      upsertCase(created);
      location.hash = `#cases/${created.id}`;
      toast(`${created.id} oluşturuldu ve ilk triyaj analizi tamamlandı.`);
    });
  });

  // Evidence Modal Photo Upload & Submit
  $("#ev-modal-photo")?.addEventListener("change", (e) => {
    if (e.target.files?.length) {
      handleFileReads([e.target.files[0]], (att) => {
        S.modalAttachment = att;
        $("#ev-modal-photo-preview").innerHTML = `
          <div class="att-card">
            <img class="att-thumb" src="${esc(att.data_url)}" alt="${esc(att.name)}">
            <div class="att-meta"><span>${esc(att.name)}</span></div>
          </div>`;
      });
    }
  });

  $("#evidence-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const modal = $("#evidence-modal");
    const cid = modal.dataset.caseId;
    const evId = $("#ev-modal-select").value;
    const result = $("#ev-modal-result").value.trim();
    if (!result) {
      $("#ev-modal-error").textContent = "Lütfen ölçüm veya gözlem sonucunu girin.";
      $("#ev-modal-result").focus();
      return;
    }
    $("#ev-modal-error").textContent = "";

    await busy($("#ev-modal-submit"), "Yeniden Değerlendiriliyor…", async () => {
      const c = S.cases.find((x) => x.id === cid);
      if (c && c.status !== "awaiting_evidence") {
        await api(`/cases/${cid}/review`, { method: "POST", body: { action: "request_evidence", evidence_id: evId } });
      }
      const updated = await api(`/cases/${cid}/evidence`, {
        method: "POST",
        body: { evidence_id: evId, result, attachment: S.modalAttachment },
      });
      modal.close();
      upsertCase(updated);
      toast("Yeni kanıt eklendi ve ServicePilot analizi güncellendi.");
    });
  });

  // Override / Approve Modal Submit
  $("#override-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const modal = $("#override-modal");
    const cid = modal.dataset.caseId;
    const mode = modal.dataset.mode || "override";
    const target = $("#ov-modal-target").value;
    const reason = $("#ov-modal-reason").value.trim();

    if (mode === "override" && !reason) {
      $("#ov-modal-error").textContent = "Yönlendirme değişikliği (override) için kısa bir gerekçe girilmesi zorunludur.";
      $("#ov-modal-reason").focus();
      return;
    }
    $("#ov-modal-error").textContent = "";

    await busy($("#ov-modal-submit"), "Kaydediliyor…", async () => {
      const updated = await api(`/cases/${cid}/review`, {
        method: "POST",
        body: { action: mode === "approve" ? "approve" : "override", target, reason },
      });
      modal.close();
      upsertCase(updated);
      toast(`${cid} için uzman yönlendirme kararı kaydedildi.`);
    });
  });

  // Policy Save & Reset
  $("#policy-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Number(v)]));
    await busy(e.submitter, "Kaydediliyor…", async () => {
      S.settings = await api("/settings", { method: "PUT", body: values });
      renderPolicySection();
      renderOverview();
      toast("RAEP politika ayarları güncellendi.");
    });
  });

  document.addEventListener("click", async (e) => {
    if (e.target.id === "policy-default-btn") {
      await busy(e.target, "Sıfırlanıyor…", async () => {
        S.settings = await api("/settings", { method: "PUT", body: S.catalog.default_settings });
        renderPolicySection();
        toast("Varsayılan RAEP politika ayarları yüklendi.");
      });
    }
  });

  // Offline Replay Run
  $("#run-replay")?.addEventListener("click", (e) =>
    busy(e.currentTarget, "Senaryolar Koşuyor…", async () => {
      const data = await api("/replay", { method: "POST" });
      renderReplayOutput(data);
    })
  );
}

// ---------- Bootstrap ----------
(async function init() {
  bindEvents();
  renderFormDtcChips();

  try {
    const [cat, st, cases, sc] = await Promise.all([
      api("/catalog"),
      api("/settings"),
      api("/cases"),
      api("/scenarios"),
    ]);
    S.catalog = cat || FALLBACK_CATALOG;
    S.settings = st || { ...FALLBACK_CATALOG.default_settings };
    S.scenarios = sc || FALLBACK_SCENARIOS;
    S.cases = Array.isArray(cases) && cases.length ? cases : await api("/cases/seed", { method: "POST" });
  } catch {
    S.offlineMode = true;
    const savedCases = localStorage.getItem(LOCAL_CASES_KEY);
    S.cases = savedCases ? JSON.parse(savedCases) : buildFallbackDemoCases(S.settings);
  }

  S.selected = S.cases[0]?.id || null;
  renderScenariosBar();
  renderPolicySection();
  renderAll();
})();
