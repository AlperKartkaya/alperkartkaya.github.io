// ServicePilot — Active Evidence Orchestration UI (Vanilla JS, no build step).
// Works with FastAPI (/api/*) and falls back deterministically when served statically (e.g. GitHub Pages).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const num = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));

const DRAFT_KEY = "servicepilot_case_draft_v2";
const LOCAL_CASES_KEY = "servicepilot_local_cases_v2";
const LOCAL_SETTINGS_KEY = "servicepilot_local_settings_v2";
const MAX_ATT_COUNT = 4;
const MAX_ATT_BYTES = 750000; // ~500 KB base64

// ---------- Embedded Taxonomy & Fallback Catalog ----------
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

// Complete 13 synthetic demo/replay scenarios matching app/scenarios.py
const FALLBACK_SCENARIOS = [
  {
    id: "lv_starter", title: "Marş basmıyor, tık tık ses",
    vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 184000 },
    technician_note: "Sabah marşa basınca sadece tık tık ses geliyor, motor dönmüyor. Gösterge ışıkları sönük yanıyor.",
    dtc_codes: [], recent_repairs: "", expected: "lv_electrical",
    answers: {
      battery_voltage: "Kontak kapalı 21.4V, marş anında 14.8V'a düşüyor. Akü kutup başları oksitli.",
      connector_photo: "Akü kutup başlarında beyaz oksitlenme var, şase kablosu gevşek.",
    },
    fixture_signals: {
      initial: { route: { lv_electrical: 0.72, ecu_comm: 0.16, engine: 0.12 }, sufficient: 0.38, critical: 0.06, priority: { score: 1.6, probabilities: {} }, has: {} },
      after: {
        battery_voltage: { route: { lv_electrical: 0.94, ecu_comm: 0.04, engine: 0.02 }, sufficient: 0.90, critical: 0.05, priority: { score: 1.6, probabilities: {} }, has: { battery_voltage: 0.96 } },
        connector_photo: { route: { lv_electrical: 0.91, ecu_comm: 0.06, engine: 0.03 }, sufficient: 0.86, critical: 0.05, priority: { score: 1.6, probabilities: {} }, has: { connector_photo: 0.95 } },
      },
    },
  },
  {
    id: "can_comm", title: "Aynı anda çoklu uyarı lambası",
    vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 412000 },
    technician_note: "Göstergede aynı anda ABS, şanzıman ve motor uyarıları yandı, birkaç saniye sonra söndü. Araç normal sürülüyor.",
    dtc_codes: ["U0100", "U0121"], recent_repairs: "Geçen ay gösterge paneli değişti.", expected: "ecu_comm",
    answers: {
      can_resistance: "CAN-H / CAN-L arası 120Ω ölçüldü (60Ω olmalı); bir sonlandırma direnci devre dışı.",
      battery_voltage: "24.6V, normal.",
    },
    fixture_signals: {
      initial: { route: { ecu_comm: 0.68, lv_electrical: 0.22, brakes: 0.06, transmission: 0.04 }, sufficient: 0.34, critical: 0.12, priority: { score: 1.9, probabilities: {} }, has: { battery_voltage: 0.88, service_history: 0.82, connector_photo: 0.85 } },
      after: {
        can_resistance: { route: { ecu_comm: 0.95, lv_electrical: 0.03, brakes: 0.01, transmission: 0.01 }, sufficient: 0.92, critical: 0.10, priority: { score: 1.9, probabilities: {} }, has: { battery_voltage: 0.88, service_history: 0.82, connector_photo: 0.85, can_resistance: 0.98 } },
        battery_voltage: { route: { ecu_comm: 0.82, lv_electrical: 0.12, brakes: 0.04, transmission: 0.02 }, sufficient: 0.72, critical: 0.10, priority: { score: 1.9, probabilities: {} }, has: { battery_voltage: 0.96 } },
      },
    },
  },
  {
    id: "power_loss", title: "Yokuşta çekiş kaybı (belirsiz)",
    vehicle: { family: "Isuzu Novo Lux", fuel: "diesel", km: 265000 },
    technician_note: "Yokuşta çekiş düşüyor, araç ileri gitmekte zorlanıyor.",
    dtc_codes: [], recent_repairs: "", expected: "transmission",
    answers: {
      dtc_scan: "Aktif kod yok; şanzımanda geçmiş P0868 (düşük hat basıncı) kaydı var.",
      trans_log: "Şanzıman yağı 118°C'ye çıkıyor, 3-4 vites geçişinde patinaj kaydı var.",
      fluid_check: "Motor yağı ve antifriz normal seviyede.",
      sound_video: "Hızlanırken devir yükseliyor ama araç hızlanmıyor.",
      road_test: "Yokuşta devir 2200'e fırlıyor, hız artmıyor; kavrama/şanzıman kaçırması var.",
    },
    fixture_signals: {
      initial: { route: { engine: 0.52, transmission: 0.42, lv_electrical: 0.06 }, sufficient: 0.22, critical: 0.10, priority: { score: 1.8, probabilities: {} }, has: {} },
      after: {
        dtc_scan: { route: { transmission: 0.76, engine: 0.20, lv_electrical: 0.04 }, sufficient: 0.54, critical: 0.10, priority: { score: 1.8, probabilities: {} }, has: { dtc_scan: 0.95 } },
        trans_log: { route: { transmission: 0.94, engine: 0.05, lv_electrical: 0.01 }, sufficient: 0.91, critical: 0.10, priority: { score: 1.8, probabilities: {} }, has: { dtc_scan: 0.95, trans_log: 0.96 } },
        sound_video: { route: { transmission: 0.86, engine: 0.12, lv_electrical: 0.02 }, sufficient: 0.80, critical: 0.10, priority: { score: 1.8, probabilities: {} }, has: { sound_video: 0.95 } },
        fluid_check: { route: { transmission: 0.84, engine: 0.14, lv_electrical: 0.02 }, sufficient: 0.78, critical: 0.10, priority: { score: 1.8, probabilities: {} }, has: { fluid_check: 0.95 } },
        road_test: { route: { transmission: 0.93, engine: 0.06, lv_electrical: 0.01 }, sufficient: 0.90, critical: 0.10, priority: { score: 1.8, probabilities: {} }, has: { road_test: 0.96 } },
      },
    },
  },
  {
    id: "engine_overheat", title: "Hararet ve antifriz eksilmesi",
    vehicle: { family: "Isuzu N-Wide", fuel: "diesel", km: 98000 },
    technician_note: "Uzun yolda hararet göstergesi kırmızıya yaklaşıyor, antifriz eksiliyor.",
    dtc_codes: ["P0217"], recent_repairs: "", expected: "engine",
    answers: {
      fluid_check: "Antifriz minimumun altında, yağda emülsiyon yok, radyatör altında sızıntı izi var.",
    },
    fixture_signals: {
      initial: { route: { engine: 0.84, transmission: 0.08, ecu_comm: 0.05, lv_electrical: 0.03 }, sufficient: 0.46, critical: 0.22, priority: { score: 2.0, probabilities: {} }, has: {} },
      after: {
        fluid_check: { route: { engine: 0.94, transmission: 0.03, ecu_comm: 0.02, lv_electrical: 0.01 }, sufficient: 0.89, critical: 0.15, priority: { score: 2.0, probabilities: {} }, has: { fluid_check: 0.96 } },
      },
    },
  },
  {
    id: "hv_charging", title: "Şarj 2-3 dakikada kesiliyor",
    vehicle: { family: "Isuzu Novociti Volt", fuel: "electric", km: 54000 },
    technician_note: "Araç şarja takılıyor ama şarj 2-3 dakika sonra kesiliyor.",
    dtc_codes: [], recent_repairs: "", expected: "hv_charging",
    answers: {
      charging_log: "İstasyon kaydı: 'Vehicle-side contactor open'; oturum 140. saniyede sonlandı. Farklı istasyonda da aynı.",
      connector_photo: "Şarj soketinde pin 4'te renk değişimi ve yanma izi.",
    },
    fixture_signals: {
      initial: { route: { hv_charging: 0.64, hv_battery: 0.26, ecu_comm: 0.06, lv_electrical: 0.04 }, sufficient: 0.32, critical: 0.16, priority: { score: 2.2, probabilities: {} }, has: {} },
      after: {
        charging_log: { route: { hv_charging: 0.76, hv_battery: 0.14, lv_electrical: 0.06, ecu_comm: 0.04 }, sufficient: 0.52, critical: 0.15, priority: { score: 2.2, probabilities: {} }, has: { charging_log: 0.95 } },
        connector_photo: { route: { hv_charging: 0.93, hv_battery: 0.04, lv_electrical: 0.02, ecu_comm: 0.01 }, sufficient: 0.90, critical: 0.14, priority: { score: 2.2, probabilities: {} }, has: { charging_log: 0.95, connector_photo: 0.95 } },
      },
    },
  },
  {
    id: "hv_battery", title: "Menzil düşüşü + batarya sıcaklık uyarısı",
    vehicle: { family: "Isuzu Citivolt 12", fuel: "electric", km: 76000 },
    technician_note: "Menzil son haftada belirgin düştü, batarya sıcaklık uyarısı ara ara yanıyor.",
    dtc_codes: [], recent_repairs: "", expected: "hv_battery",
    answers: {
      hv_isolation: "İzolasyon direnci 2.4 MΩ, normal.",
      charging_log: "Şarj oturumları normal tamamlanıyor; BMS modül 3'te 180 mV hücre dengesizliği uyarısı.",
    },
    fixture_signals: {
      initial: { route: { hv_battery: 0.62, hv_charging: 0.22, hv_inverter: 0.12, ecu_comm: 0.04 }, sufficient: 0.30, critical: 0.24, priority: { score: 2.1, probabilities: {} }, has: {} },
      after: {
        charging_log: { route: { hv_battery: 0.91, hv_charging: 0.05, hv_inverter: 0.03, ecu_comm: 0.01 }, sufficient: 0.86, critical: 0.20, priority: { score: 2.1, probabilities: {} }, has: { charging_log: 0.96 } },
        hv_isolation: { route: { hv_battery: 0.89, hv_inverter: 0.07, hv_charging: 0.04 }, sufficient: 0.84, critical: 0.18, priority: { score: 2.1, probabilities: {} }, has: { hv_isolation: 0.96 } },
      },
    },
  },
  {
    id: "hv_propulsion", title: "Kalkışta sarsıntı, çekiş kesiliyor",
    vehicle: { family: "Isuzu Citivolt 12", fuel: "electric", km: 31000 },
    technician_note: "Araç kalkışta sarsılıyor, bazen çekiş tamamen kesiliyor ve 'sürüş sistemi arızası' uyarısı geliyor.",
    dtc_codes: ["P0A78"], recent_repairs: "", expected: "hv_inverter",
    answers: {
      hv_isolation: "İzolasyon direnci 2.1 MΩ, normal; batarya hücreleri dengeli.",
    },
    fixture_signals: {
      initial: { route: { hv_inverter: 0.86, hv_battery: 0.09, transmission: 0.05 }, sufficient: 0.72, critical: 0.25, priority: { score: 2.3, probabilities: {} }, has: {} },
      after: {
        hv_isolation: { route: { hv_inverter: 0.94, hv_battery: 0.04, transmission: 0.02 }, sufficient: 0.91, critical: 0.18, priority: { score: 2.3, probabilities: {} }, has: { hv_isolation: 0.96 } },
      },
    },
  },
  {
    id: "intermittent_stall", title: "Seyirde ara ara stop etme (belirsiz)",
    vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 156000 },
    technician_note: "Araç seyir halindeyken ara ara stop ediyor, birkaç saniye sonra tekrar çalışıyor.",
    dtc_codes: [], recent_repairs: "", expected: "lv_electrical",
    answers: {
      dtc_scan: "Aktif kod yok; geçmişte U3003 (besleme voltajı) kaydı var.",
      battery_voltage: "Akü 24.9V normal; stop anında besleme voltajı 9V'a düşüyor.",
      connector_photo: "Kontak anahtarı arkasındaki konnektörde gevşeklik ve oksitlenme; konnektör oynatınca gösterge sönüyor.",
      fluid_check: "Yağ ve antifriz normal.",
    },
    fixture_signals: {
      initial: { route: { engine: 0.48, lv_electrical: 0.36, ecu_comm: 0.16 }, sufficient: 0.20, critical: 0.18, priority: { score: 2.0, probabilities: {} }, has: {} },
      after: {
        dtc_scan: { route: { lv_electrical: 0.72, ecu_comm: 0.18, engine: 0.10 }, sufficient: 0.48, critical: 0.16, priority: { score: 2.0, probabilities: {} }, has: { dtc_scan: 0.95 } },
        battery_voltage: { route: { lv_electrical: 0.92, ecu_comm: 0.05, engine: 0.03 }, sufficient: 0.88, critical: 0.14, priority: { score: 2.0, probabilities: {} }, has: { dtc_scan: 0.95, battery_voltage: 0.96 } },
        connector_photo: { route: { lv_electrical: 0.94, ecu_comm: 0.04, engine: 0.02 }, sufficient: 0.91, critical: 0.12, priority: { score: 2.0, probabilities: {} }, has: { connector_photo: 0.95 } },
        fluid_check: { route: { lv_electrical: 0.68, ecu_comm: 0.20, engine: 0.12 }, sufficient: 0.45, critical: 0.16, priority: { score: 2.0, probabilities: {} }, has: { fluid_check: 0.95 } },
      },
    },
  },
  {
    id: "critical_fire", title: "Torpido arkasından yanık kokusu",
    vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 520000 },
    technician_note: "Sürücü torpido arkasından yanık kokusu geldiğini ve hafif duman gördüğünü bildirdi.",
    dtc_codes: [], recent_repairs: "", expected: "ESCALATE", answers: {},
    fixture_signals: {
      initial: { route: { lv_electrical: 0.65, ecu_comm: 0.25, engine: 0.10 }, sufficient: 0.40, critical: 0.92, priority: { score: 2.9, probabilities: {} }, has: {} },
      after: {},
    },
  },
  {
    id: "critical_brake", title: "Fren pedalı derine gidiyor",
    vehicle: { family: "Isuzu NPR 10", fuel: "diesel", km: 230000 },
    technician_note: "Fren pedalı derine gidiyor, araç zor duruyor, hava basıncı uyarısı yanıyor.",
    dtc_codes: [], recent_repairs: "", expected: "ESCALATE", answers: {},
    fixture_signals: {
      initial: { route: { brakes: 0.88, steering_suspension: 0.08, lv_electrical: 0.04 }, sufficient: 0.55, critical: 0.89, priority: { score: 2.9, probabilities: {} }, has: {} },
      after: {},
    },
  },
  {
    id: "brake_noise", title: "Frende gıcırtı, performans normal",
    vehicle: { family: "Isuzu Novo", fuel: "diesel", km: 143000 },
    technician_note: "Frenlemede arka tekerden gıcırtı sesi geliyor, frenleme performansı normal.",
    dtc_codes: [], recent_repairs: "", expected: "brakes",
    answers: {
      brake_pressure: "Sistem basıncı 8.2 bar, kaçak yok. Arka balatalar aşınma sınırında.",
    },
    fixture_signals: {
      initial: { route: { brakes: 0.85, steering_suspension: 0.11, transmission: 0.04 }, sufficient: 0.74, critical: 0.12, priority: { score: 1.3, probabilities: {} }, has: {} },
      after: {
        brake_pressure: { route: { brakes: 0.96, steering_suspension: 0.03, transmission: 0.01 }, sufficient: 0.93, critical: 0.08, priority: { score: 1.3, probabilities: {} }, has: { brake_pressure: 0.96 } },
      },
    },
  },
  {
    id: "steering_vibration", title: "Yüksek hızda direksiyon titremesi",
    vehicle: { family: "Isuzu Kendo", fuel: "diesel", km: 87000 },
    technician_note: "80 km/s üzerinde direksiyonda titreme var, araç hafif sağa çekiyor.",
    dtc_codes: [], recent_repairs: "", expected: "steering_suspension",
    answers: {
      road_test: "80-90 km/s arası titreme belirgin, sağ ön lastikte düzensiz aşınma, rot ayarı bozuk.",
    },
    fixture_signals: {
      initial: { route: { steering_suspension: 0.86, brakes: 0.10, transmission: 0.04 }, sufficient: 0.72, critical: 0.14, priority: { score: 1.5, probabilities: {} }, has: {} },
      after: {
        road_test: { route: { steering_suspension: 0.95, brakes: 0.03, transmission: 0.02 }, sufficient: 0.92, critical: 0.10, priority: { score: 1.5, probabilities: {} }, has: { road_test: 0.96 } },
      },
    },
  },
  {
    id: "vague_noise", title: "Garip ses (çok eksik vaka)",
    vehicle: { family: "Isuzu Novo", fuel: "diesel", km: 301000 },
    technician_note: "Araçta garip bir ses var, müşteri şikayetçi.",
    dtc_codes: [], recent_repairs: "", expected: "engine",
    answers: {
      sound_video: "Ses motor bölmesinden geliyor; rölantide metalik tıkırtı, devirle artıyor.",
      dtc_scan: "Aktif kod yok.",
      fluid_check: "Motor yağı minimumda ve koyu; antifriz normal.",
      road_test: "Tıkırtı motor devriyle artıyor, araç hızından bağımsız.",
    },
    fixture_signals: {
      initial: { route: { steering_suspension: 0.42, engine: 0.34, transmission: 0.24 }, sufficient: 0.15, critical: 0.08, priority: { score: 1.4, probabilities: {} }, has: {} },
      after: {
        sound_video: { route: { engine: 0.76, transmission: 0.16, steering_suspension: 0.08 }, sufficient: 0.52, critical: 0.08, priority: { score: 1.4, probabilities: {} }, has: { sound_video: 0.95 } },
        fluid_check: { route: { engine: 0.92, transmission: 0.05, steering_suspension: 0.03 }, sufficient: 0.88, critical: 0.08, priority: { score: 1.4, probabilities: {} }, has: { sound_video: 0.95, fluid_check: 0.96 } },
        dtc_scan: { route: { engine: 0.88, transmission: 0.08, steering_suspension: 0.04 }, sufficient: 0.82, critical: 0.08, priority: { score: 1.4, probabilities: {} }, has: { sound_video: 0.95, dtc_scan: 0.95 } },
        road_test: { route: { engine: 0.93, transmission: 0.05, steering_suspension: 0.02 }, sufficient: 0.90, critical: 0.08, priority: { score: 1.4, probabilities: {} }, has: { road_test: 0.96 } },
      },
    },
  },
];

// ---------- Application State ----------
const S = {
  mode: "api", // "api" or "local" (strictly separated; api never silently degrades to local)
  catalog: FALLBACK_CATALOG,
  settings: { ...FALLBACK_CATALOG.default_settings },
  cases: [],
  scenarios: FALLBACK_SCENARIOS,
  selected: null,
  caseFilter: "all",
  caseSearch: "",
  reviewTab: "queue",
  wizardStep: 1,
  formDtcs: [],
  formAttachments: [],
  modalAttachment: null,
  userModified: false,
};

// ---------- Helpers & Safety Gates ----------
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

function isCriticalCase(c, s = S.settings) {
  if (!c) return false;
  const tauCrit = s?.tau_crit ?? 0.75;
  for (const st of c.steps || []) {
    if (st.decision?.safety_hits?.length) return true;
    if ((st.signals?.critical ?? 0) >= tauCrit) return true;
  }
  const text = [
    c.technician_note || "",
    c.initial_measurements || "",
    c.recent_repairs || "",
    (c.dtc_codes || []).join(" "),
    ...(c.evidence || []).map((e) => e.result || ""),
  ].join(" ").toLowerCase();
  return SAFETY_RULES.some((r) => text.includes(r));
}

function validateEvidenceForCase(c, eid, s = S.settings) {
  const ev = S.catalog.evidence[eid];
  if (!ev) return `Geçersiz kanıt türü: ${eid}`;
  const isElectric = c.vehicle?.fuel === "electric";
  if (ev.requires_ev && !isElectric) {
    return `Bu kanıt (${ev.label}) yalnızca elektrikli (HV) araçlar için uygulanabilir.`;
  }
  if (isCriticalCase(c, s) && (ev.S || 0) > 0) {
    return `Kritik güvenlik riski bulunan vakalarda saha testi (${ev.label}, S=${ev.S}) uygulanamaz; yalnızca güvenli belge/fotoğraf (S=0) eklenebilir.`;
  }
  return null;
}

// Compute UI status category
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
    inspecting: ["badge-inspecting", "Onay Bekliyor"],
    routed: ["badge-routed", "Yönlendirildi"],
  };
  const [cls, text] = map[cat] || ["badge-neutral", c.status];
  return `<span class="badge ${cls}"><span class="badge-dot" aria-hidden="true"></span>${text}</span>`;
}

function casePriority(c) {
  const step = c.steps?.at(-1);
  const d = step?.decision;
  const sig = step?.signals;
  if (isCriticalCase(c) || c.status === "escalated" || d?.safety_hits?.length || (sig && sig.critical >= S.settings.tau_crit)) {
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

// ---------- Deterministic Client-Side RAEP Math ----------
function jsDecide(caseObj, signals, s) {
  const text = [
    caseObj.technician_note || "",
    caseObj.initial_measurements || "",
    caseObj.recent_repairs || "",
    (caseObj.dtc_codes || []).join(" "),
    ...(caseObj.evidence || []).map((e) => e.result || ""),
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

  if (hits.length) {
    return finish("ESCALATE", `Güvenlik kuralı tetiklendi: ${hits.join(", ")}`);
  }
  if (!signals) {
    return finish("ESCALATE", "Jev erişilemedi; vaka insan uzmana yönlendirildi.");
  }

  const leaves = S.catalog.leaves;
  const rawSum = leaves.reduce((a, l) => a + (signals.route[l] || 0), 0) || 1;
  const route = Object.fromEntries(leaves.map((l) => [l, (signals.route[l] || 0) / rawSum]));
  const nodes = Object.fromEntries(Object.keys(S.catalog.nodes).map((n) => [
    n, Number(leavesUnder(n).reduce((a, l) => a + (route[l] || 0), 0).toFixed(4)),
  ]));
  const best = leaves.reduce((a, b) => (route[a] >= route[b] ? a : b));
  const err = 1 - route[best];
  const pCrit = signals.critical ?? 0.08;
  const suff = signals.sufficient ?? 0.4;
  const L = 1 + s.w_crit * pCrit;

  const collected = new Set((caseObj.evidence || []).map((e) => e.id));
  const unavail = new Set(caseObj.unavailable_evidence || []);
  const has = signals.has || {};
  const isElectric = caseObj.vehicle?.fuel === "electric";
  const cands = [];
  const skipped = {};

  for (const [eid, ev] of Object.entries(S.catalog.evidence)) {
    if (collected.has(eid)) {
      skipped[eid] = "toplandı";
    } else if (unavail.has(eid)) {
      skipped[eid] = "senaryoda kanıt verisi yok";
    } else if (ev.requires_ev && !isElectric) {
      skipped[eid] = "araca uygun değil";
    } else if (eid === "dtc_scan" && caseObj.dtc_codes?.length) {
      skipped[eid] = "vakada DTC var";
    } else if ((has[eid] || 0) >= 0.7) {
      skipped[eid] = `notta mevcut (Jev ${Number(has[eid]).toFixed(2)})`;
    } else {
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
  const txt = `${caseObj.technician_note || ""} ${caseObj.initial_measurements || ""} ${(caseObj.dtc_codes || []).join(" ")} ${(caseObj.evidence || []).map((e) => e.result || "").join(" ")}`.toLowerCase();
  const route = { engine: 0.05, transmission: 0.05, lv_electrical: 0.08, ecu_comm: 0.08, hv_battery: 0.02, hv_charging: 0.02, hv_inverter: 0.02, brakes: 0.04, steering_suspension: 0.04 };
  if (/u0100|u0121|can|haberleşme|gösterge|cluster|120ω/.test(txt)) route.ecu_comm += 0.65;
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

// Append-only decision state manager
function applyLocalDecision(caseObj, d, sig, latencyMs, s, recomputed = false) {
  const ts = new Date().toISOString();
  caseObj.steps = caseObj.steps || [];
  caseObj.steps.push({
    at: ts,
    latency_ms: latencyMs,
    signals: sig,
    decision: d,
    settings: { ...s },
    recomputed,
  });

  const humanLocked = ["confirmed", "approved", "overridden"].includes(caseObj.review_status) && caseObj.final != null;

  if (recomputed && humanLocked) {
    caseObj.machine_recommendation = {
      action: d.action,
      target: d.target,
      target_label: d.target_label,
      evidence_id: d.evidence_id,
      reason: d.reason,
    };
    return;
  }

  const critical = isCriticalCase(caseObj, s);
  if (critical) {
    caseObj.status = "escalated";
    caseObj.review_status = "pending_review";
    caseObj.final = { action: "ESCALATE", target: "expert_desk", target_label: nodeLabel("expert_desk") };
    caseObj.pending_evidence = d.action === "REQUEST_EVIDENCE" ? d.evidence_id : null;
    return;
  }

  if (d.action === "ROUTE") {
    caseObj.status = "routed";
    caseObj.review_status = "pending_confirmation";
    caseObj.pending_evidence = null;
    caseObj.final = { action: "ROUTE", target: d.target, target_label: d.target_label };
  } else if (d.action === "ESCALATE") {
    caseObj.status = "escalated";
    caseObj.review_status = "pending_review";
    caseObj.pending_evidence = null;
    caseObj.final = { action: "ESCALATE", target: "expert_desk", target_label: nodeLabel("expert_desk") };
  } else {
    caseObj.status = "awaiting_evidence";
    caseObj.review_status = null;
    caseObj.pending_evidence = d.evidence_id;
    caseObj.final = null;
  }
}

function buildFallbackDemoCases(settings) {
  const svgCan = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>OBD-II / CAN HATTI TOPOLOJİ GÖRÜNÜMÜ (DEMO)</text><line x1='80' y1='130' x2='400' y2='130' stroke='%2340D9C0' stroke-width='2.5'/><line x1='80' y1='160' x2='400' y2='160' stroke='%2379AFFF' stroke-width='2.5'/><rect x='60' y='110' width='44' height='70' rx='6' fill='%231B2632' stroke='%2340D9C0'/><text x='69' y='149' fill='%23F4F7FA' font-family='monospace' font-size='11'>120Ω</text><rect x='210' y='88' width='76' height='32' rx='5' fill='%231B2632' stroke='%23EAB96B'/><text x='222' y='108' fill='%23EAB96B' font-family='monospace' font-size='11'>ABS ECU</text><rect x='376' y='110' width='44' height='70' rx='6' fill='%231B2632' stroke='%23F17C7C' stroke-dasharray='4 2'/><text x='385' y='149' fill='%23F17C7C' font-family='monospace' font-size='11'>AÇIK</text><text x='44' y='224' fill='%23F4F7FA' font-family='sans-serif' font-size='13'>Gözlem: Gösterge paneli değişimi sonrası X14 konnektör kilidi tam oturmamış.</text></svg>";
  const svgHv = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>CCS2 HV ŞARJ SOKETİ ÖN İNCELEME (DEMO)</text><circle cx='170' cy='145' r='58' fill='%23090D13' stroke='%23253240' stroke-width='2'/><circle cx='152' cy='168' r='14' fill='%231B2632' stroke='%2340D9C0'/><circle cx='188' cy='168' r='14' fill='%233A1D24' stroke='%23F17C7C' stroke-width='2.5'/><text x='255' y='125' fill='%23F4F7FA' font-family='sans-serif' font-size='13' font-weight='bold'>DC+ Pin 4 Termal İz Şüphesi</text><text x='255' y='150' fill='%2396A5B5' font-family='sans-serif' font-size='12'>Oturum 140. sn'de kontaktör açıyor.</text></svg>";
  const svgRad = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>SOĞUTMA HATTI KONTROLÜ (DEMO)</text><text x='44' y='130' fill='%23F4F7FA' font-family='sans-serif' font-size='13'>Antifriz seviyesi MIN çizgisinin 3 cm altında</text><text x='44' y='160' fill='%2340D9C0' font-family='monospace' font-size='12'>Yağda emülsiyon yok · Alt kelepçe sızıntısı</text></svg>";
  const svgBat = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='280' viewBox='0 0 480 280'><rect width='480' height='280' fill='%230E141C'/><rect x='24' y='24' width='432' height='232' rx='10' fill='%23141C26' stroke='%23253240'/><text x='44' y='56' fill='%2396A5B5' font-family='monospace' font-size='12'>24V AKÜ GRUBU GERİLİM TESTİ (DEMO)</text><polyline points='60,110 160,110 185,195 230,190 260,135 410,135' fill='none' stroke='%2340D9C0' stroke-width='3'/><text x='65' y='98' fill='%23F4F7FA' font-family='monospace' font-size='12'>Dinlenme: 21.4V → Marş: 14.8V</text></svg>";

  const demos = [
    {
      id: "SP-0001", created_at: "2026-10-28T08:15:00+00:00", updated_at: "2026-10-28T08:16:00+00:00",
      scenario_id: "can_comm", review_status: null,
      vehicle: { family: "Isuzu Citiport 12", fuel: "diesel", km: 412000, vin: "NLNC12000R0041892", location: "İstanbul İkitelli Yetkili Servis" },
      technician_note: "Göstergede seyir halinde aynı anda ABS, şanzıman ve motor arıza uyarı lambaları yandı, birkaç saniye sonra kendiliğinden söndü. Araç çekişinde ve frenlemesinde anlık bir kesinti hissedilmedi.",
      initial_measurements: "Akü dinlenme voltajı 24.6V (normal). Gösterge konnektörü X14 çevresinde kablo demeti gergin duruyor.",
      dtc_codes: ["U0100", "U0121"], recent_repairs: "Geçen ay gösterge paneli modülü (cluster) garantiden değişti.",
      attachments: [{ name: "citiport-can-topoloji.svg", caption: "Gösterge paneli arkası X14 konnektör ve CAN hattı kontrol şeması", data_url: svgCan }],
      evidence: [], steps: [],
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
      steps: [],
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
      attachments: [], evidence: [], steps: [], signals: null,
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
      steps: [],
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
      steps: [],
      signals: { route: { lv_electrical: 0.95, ecu_comm: 0.03, engine: 0.02 }, sufficient: 0.92, critical: 0.04, priority: { score: 1.6, probabilities: {} }, has: { battery_voltage: 0.98 } },
      audit: [
        { at: "2026-10-28T07:30:00+00:00", actor: "Teknisyen (Gebze Servis)", action: "Vaka Oluşturuldu", detail: "NPR 10 marş basmama ve P0562 koduyla açıldı." },
        { at: "2026-10-28T07:50:00+00:00", actor: "Servis Sorumlusu", action: "Yönlendirme Onaylandı", detail: "Vaka Düşük Voltaj Elektrik uzman ekibine kesin olarak atandı." },
      ],
    },
  ];

  return demos.map((r) => {
    const d = jsDecide(r, r.signals, settings);
    applyLocalDecision(r, d, r.signals, r.signals ? 360 : 0, settings, false);
    return r;
  });
}

// ---------- Deterministic Offline Replay Simulation (No expected-leak, pure RAEP) ----------
function runDeterministicReplay(scenarios, catalog, settings) {
  const leaves = catalog.leaves;

  function replayOne(sc) {
    const isElectric = sc.vehicle.fuel === "electric";
    const caseObj = {
      technician_note: sc.technician_note,
      vehicle: { ...sc.vehicle },
      dtc_codes: [...(sc.dtc_codes || [])],
      recent_repairs: sc.recent_repairs || "",
      evidence: [],
      unavailable_evidence: [],
    };

    const fx = sc.fixture_signals || {};
    let sig = fx.initial || null;
    const requested = [];
    let d = jsDecide(caseObj, sig, settings);

    while (d.action === "REQUEST_EVIDENCE") {
      const eid = d.evidence_id;
      if (!eid) break;
      const ans = sc.answers?.[eid];
      if (ans == null) {
        caseObj.unavailable_evidence.push(eid);
        d = jsDecide(caseObj, sig, settings);
        continue;
      }
      requested.push(eid);
      caseObj.evidence.push({ id: eid, label: catalog.evidence[eid]?.label || eid, result: ans });
      const after = fx.after || {};
      sig = after[eid] || sig;
      d = jsDecide(caseObj, sig, settings);
    }

    const cost = requested.reduce((sum, eid) => {
      const ev = catalog.evidence[eid];
      return sum + (ev ? settings.alpha * ev.T + settings.beta * ev.E + settings.gamma * ev.S : 0);
    }, 0);

    const targetLabel = d.target ? nodeLabel(d.target) : (d.action === "ESCALATE" ? "ESCALATE" : null);

    // Baseline B: fixed static checklist
    const bOrder = isElectric
      ? ["dtc_scan", "connector_photo", "charging_log", "hv_isolation"]
      : ["dtc_scan", "connector_photo", "battery_voltage", "fluid_check"];
    const bReq = [];
    for (const eid of bOrder) {
      if (sc.answers?.[eid] != null) bReq.push(eid);
    }
    const bCost = bReq.reduce((sum, eid) => {
      const ev = catalog.evidence[eid];
      return sum + (ev ? settings.alpha * ev.T + settings.beta * ev.E + settings.gamma * ev.S : 0);
    }, 0);
    const lastSig = bReq.length ? (fx.after?.[bReq.at(-1)] || fx.initial) : fx.initial;
    const bBest = leaves.reduce((a, b) => ((lastSig?.route?.[a] || 0) >= (lastSig?.route?.[b] || 0) ? a : b));

    // Baseline C: initial one-shot argmax without safety gate or evidence requests
    const initSig = fx.initial || {};
    const cBest = leaves.reduce((a, b) => ((initSig.route?.[a] || 0) >= (initSig.route?.[b] || 0) ? a : b));

    return {
      id: sc.id,
      title: sc.title,
      expected: sc.expected,
      expected_label: sc.expected === "ESCALATE" ? "ESCALATE" : nodeLabel(sc.expected),
      servicepilot: {
        action: d.action,
        target: d.target,
        target_label: targetLabel,
        requests: requested.length,
        cost: Number(cost.toFixed(4)),
        evidence: requested.map((e) => catalog.evidence[e]?.label || e),
      },
      baseline_b: {
        action: "ROUTE",
        target: bBest,
        target_label: nodeLabel(bBest),
        requests: bReq.length,
        cost: Number(bCost.toFixed(4)),
      },
      baseline_c: {
        action: "ROUTE",
        target: cBest,
        target_label: nodeLabel(cBest),
        requests: 0,
        cost: 0,
      },
    };
  }

  function computeMetrics(rows, key) {
    const n = rows.length;
    let exact = 0;
    let hier = 0;
    let autoCount = 0;
    let wrong = 0;
    let critTotal = 0;
    let critCaught = 0;
    let totalReq = 0;
    let totalCost = 0;

    for (const r of rows) {
      const x = r[key];
      const exp = r.expected;
      totalReq += x.requests || 0;
      totalCost += x.cost || 0;

      if (exp === "ESCALATE") {
        critTotal++;
        if (x.action === "ESCALATE") {
          exact++;
          hier++;
          critCaught++;
        } else {
          wrong++;
        }
      } else {
        if (x.action === "ROUTE") {
          autoCount++;
          if (x.target === exp) {
            exact++;
            hier++;
          } else if (ancestors(exp).includes(x.target)) {
            hier++;
          } else {
            wrong++;
          }
        }
      }
    }

    return {
      n,
      exact_acc: Number((exact / n).toFixed(4)),
      hier_acc: Number((hier / n).toFixed(4)),
      coverage: Number((autoCount / n).toFixed(4)),
      wrong_route: wrong,
      critical_recall: critTotal ? Number((critCaught / critTotal).toFixed(4)) : 1.0,
      avg_requests: Number((totalReq / n).toFixed(2)),
      avg_cost: Number((totalCost / n).toFixed(3)),
    };
  }

  const rows = scenarios.map(replayOne);
  return {
    settings: { ...settings },
    rows,
    systems: {
      servicepilot: computeMetrics(rows, "servicepilot"),
      baseline_b: computeMetrics(rows, "baseline_b"),
      baseline_c: computeMetrics(rows, "baseline_c"),
    },
  };
}

// ---------- Local Client-Side API for GitHub Pages / Static Hosting ----------
async function localApi(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body || {};

  if (path === "/catalog") return FALLBACK_CATALOG;
  if (path === "/scenarios") return FALLBACK_SCENARIOS;

  if (path === "/settings") {
    if (method === "PUT") {
      S.settings = { ...S.settings, ...body };
      try { localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(S.settings)); } catch {}
    }
    return S.settings;
  }

  if (path === "/cases" && method === "GET") {
    return S.cases;
  }

  if (path === "/cases/seed" || (path === "/cases" && method === "DELETE")) {
    S.cases = buildFallbackDemoCases(S.settings);
    S.userModified = false;
    try { localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases)); } catch {}
    return S.cases;
  }

  if (path === "/cases" && method === "POST") {
    const ts = new Date().toISOString();
    const cid = `SP-${String(S.cases.length + 1).padStart(4, "0")}`;
    const c = {
      id: cid, created_at: ts, updated_at: ts,
      scenario_id: body.scenario_id || null,
      vehicle: { ...body.vehicle },
      technician_note: body.technician_note,
      initial_measurements: body.initial_measurements || "",
      dtc_codes: body.dtc_codes || [],
      recent_repairs: body.recent_repairs || "",
      attachments: body.attachments || [],
      evidence: [],
      pending_evidence: null,
      steps: [],
      audit: [{ at: ts, actor: `Teknisyen (${body.vehicle?.location || "Servis"})`, action: "Vaka Oluşturuldu", detail: "Servis vakası oluşturuldu." }],
      final: null,
    };

    const sc = S.scenarios.find((x) => x.id === c.scenario_id);
    const sig = sc?.fixture_signals?.initial || (SAFETY_RULES.some((r) => `${c.technician_note} ${c.initial_measurements}`.toLowerCase().includes(r)) ? null : inferLocalSignals(c));
    const d = jsDecide(c, sig, S.settings);

    applyLocalDecision(c, d, sig, sig ? 360 : 0, S.settings, false);
    c.audit.push({ at: ts, actor: "ServicePilot (RAEP)", action: d.action, detail: d.reason });

    S.cases.unshift(c);
    S.userModified = true;
    try { localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases)); } catch {}
    return c;
  }

  const evMatch = path.match(/^\/cases\/([^/]+)\/evidence$/);
  if (evMatch && method === "POST") {
    const c = S.cases.find((x) => x.id === evMatch[1]);
    if (!c) throw new Error("Vaka bulunamadı");

    const eid = body.evidence_id;
    const valErr = validateEvidenceForCase(c, eid, S.settings);
    if (valErr) throw new Error(valErr);

    const ts = new Date().toISOString();
    const evLabel = S.catalog.evidence[eid]?.label || eid;

    if (body.attachment) {
      c.attachments = [...(c.attachments || []), body.attachment];
    }
    c.evidence = [...(c.evidence || []), {
      id: eid,
      label: evLabel,
      result: body.result,
      at: ts,
      attachment: body.attachment || null,
    }];
    c.audit.push({ at: ts, actor: "Teknisyen", action: `Kanıt Eklendi: ${evLabel}`, detail: body.result });

    const sc = S.scenarios.find((x) => x.id === c.scenario_id);
    const sig = sc?.fixture_signals?.after?.[eid] || inferLocalSignals(c);
    const d = jsDecide(c, sig, S.settings);

    applyLocalDecision(c, d, sig, 340, S.settings, false);
    c.updated_at = ts;
    c.audit.push({ at: ts, actor: "ServicePilot (RAEP)", action: d.action, detail: d.reason });

    S.userModified = true;
    try { localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases)); } catch {}
    return c;
  }

  const revMatch = path.match(/^\/cases\/([^/]+)\/review$/);
  if (revMatch && method === "POST") {
    const c = S.cases.find((x) => x.id === revMatch[1]);
    if (!c) throw new Error("Vaka bulunamadı");
    const ts = new Date().toISOString();
    const lastStep = c.steps?.at(-1) || {};
    const lastDec = lastStep.decision || {};

    if (body.action === "confirm_route") {
      if (c.status === "awaiting_evidence") {
        throw new Error("Eksik kanıt tamamlanmadan yönlendirme onaylanamaz. Önce kanıt ekleyin veya gerekçeli eskalasyon yapın.");
      }
      if (isCriticalCase(c, S.settings) || c.status === "escalated") {
        throw new Error("Kritik veya uzman incelemesindeki vaka sıradan onay ile kapatılamaz; uzman onayı (approve) veya override gereklidir.");
      }
      const tgt = body.target || lastDec.target;
      if (!tgt || !S.catalog.nodes[tgt]) {
        throw new Error("Geçerli bir hedef uzmanlık düğümü bulunamadı.");
      }
      c.status = "routed";
      c.review_status = "confirmed";
      c.pending_evidence = null;
      c.final = { action: "ROUTE", target: tgt, target_label: nodeLabel(tgt) };
      c.audit.push({ at: ts, actor: "Servis Sorumlusu", action: "Yönlendirme Onaylandı", detail: body.reason || `Vaka '${nodeLabel(tgt)}' ekibine yönlendirildi.` });
    } else if (body.action === "approve") {
      let tgt = body.target || lastDec.target;
      if (!tgt || tgt === "expert_desk" || !S.catalog.nodes[tgt]) {
        throw new Error("Kritik veya uzman masasına eskale edilmiş vakalarda onay için hedef uzman ekibin açıkça seçilmesi ve gerekçe girilmesi zorunludur.");
      }
      c.status = "routed";
      c.review_status = "approved";
      c.pending_evidence = null;
      c.final = { action: "ROUTE", target: tgt, target_label: nodeLabel(tgt) };
      c.audit.push({ at: ts, actor: "Merkez Uzman (ProEye)", action: "Uzman Onayı Verildi", detail: body.reason || `Uzman incelemesi tamamlandı; hedef: ${nodeLabel(tgt)}.` });
    } else if (body.action === "override") {
      const tgt = body.target;
      if (!tgt || !S.catalog.nodes[tgt]) {
        throw new Error("Yönlendirme değişikliği için geçerli bir uzmanlık düğümü seçilmelidir.");
      }
      if (!body.reason || body.reason.trim().length < 3) {
        throw new Error("Yönlendirme değişikliği (override) için en az 3 karakterlik gerekçe yazılması zorunludur.");
      }
      c.status = "routed";
      c.review_status = "overridden";
      c.pending_evidence = null;
      c.final = { action: "ROUTE", target: tgt, target_label: nodeLabel(tgt) };
      c.audit.push({ at: ts, actor: "Merkez Uzman (ProEye)", action: `Yönlendirme Değiştirildi → ${nodeLabel(tgt)}`, detail: `Gerekçe: ${body.reason.trim()}` });
    } else if (body.action === "escalate") {
      c.status = "escalated";
      c.review_status = "pending_review";
      c.pending_evidence = null;
      c.final = { action: "ESCALATE", target: "expert_desk", target_label: nodeLabel("expert_desk") };
      c.audit.push({ at: ts, actor: "Servis Sorumlusu", action: "Uzman İncelemesine Gönderildi", detail: body.reason || "Vaka Merkez Uzman Masası (ProEye) kuyruğuna aktarıldı." });
    } else if (body.action === "request_evidence") {
      const eid = body.evidence_id || lastDec.evidence_id || lastDec.candidates?.[0]?.id || "connector_photo";
      const valErr = validateEvidenceForCase(c, eid, S.settings);
      if (valErr) throw new Error(valErr);
      const evLabel = S.catalog.evidence[eid]?.label || eid;
      if (isCriticalCase(c, S.settings)) {
        c.status = "escalated";
        c.review_status = "pending_review";
        c.final = { action: "ESCALATE", target: "expert_desk", target_label: nodeLabel("expert_desk") };
        c.pending_evidence = eid;
      } else {
        c.status = "awaiting_evidence";
        c.review_status = null;
        c.pending_evidence = eid;
        c.final = null;
      }
      c.audit.push({ at: ts, actor: "Servis Sorumlusu", action: "Kanıt Talebi Kaydedildi", detail: `${evLabel} talep edildi. ${body.reason || ""}`.trim() });
    } else {
      throw new Error(`Bilinmeyen aksiyon: ${body.action}`);
    }

    c.updated_at = ts;
    S.userModified = true;
    try { localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases)); } catch {}
    return c;
  }

  const recMatch = path.match(/^\/cases\/([^/]+)\/recompute$/);
  if (recMatch && method === "POST") {
    const c = S.cases.find((x) => x.id === recMatch[1]);
    if (!c) throw new Error("Vaka bulunamadı");
    const lastStep = c.steps?.at(-1) || {};
    const d = jsDecide(c, lastStep.signals, S.settings);
    applyLocalDecision(c, d, lastStep.signals, lastStep.latency_ms || 0, S.settings, true);
    c.updated_at = new Date().toISOString();
    c.audit.push({ at: c.updated_at, actor: "ServicePilot (RAEP)", action: "Yeniden Hesaplandı", detail: `Politika parametreleri güncellendi (${d.action}).` });
    S.userModified = true;
    try { localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(S.cases)); } catch {}
    return c;
  }

  if (path === "/replay" && method === "POST") {
    return runDeterministicReplay(S.scenarios, S.catalog, S.settings);
  }

  return {};
}

// Strict API Client: In "api" mode, failed writes NEVER silently fall back to local storage
async function api(path, opts = {}) {
  if (S.mode === "local") {
    return localApi(path, opts);
  }

  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Sunucu beklenmeyen bir yanıt döndürdü (HTTP ${res.status}).`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.status);
    throw new Error(msg);
  }
  return data;
}

// ---------- UI Utilities ----------
function showApiError(msg) {
  const banner = $("#api-error-banner");
  const text = $("#api-error-text");
  if (banner && text) {
    text.textContent = msg;
    banner.hidden = false;
  }
}

function hideApiError() {
  const banner = $("#api-error-banner");
  if (banner) banner.hidden = true;
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}

async function busy(btn, label, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> <span>${esc(label)}</span>`;
  try {
    hideApiError();
    return await fn();
  } catch (e) {
    showApiError(`Hata: ${e.message}`);
    toast(`İşlem başarısız: ${e.message}`);
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
  updateNavCounts();
  if (location.hash.startsWith("#cases/") || location.hash === "#cases") {
    renderCaseDetail();
  } else if (location.hash === "#review") {
    renderExpertReview();
  } else {
    renderOverview();
  }
}

function updateNavCounts() {
  const total = S.cases.length;
  const reviewCount = S.cases.filter((c) => caseCategory(c) === "expert_review" || caseCategory(c) === "inspecting").length;
  const c1 = $("#nav-cases-count");
  const c2 = $("#nav-review-count");
  const c3 = $("#tab-review-count");
  if (c1) c1.textContent = total;
  if (c2) c2.textContent = reviewCount;
  if (c3) c3.textContent = reviewCount;

  // Environment pill
  const envLabel = $("#env-label");
  const envDot = $("#env-dot");
  if (envLabel && envDot) {
    if (S.mode === "api") {
      envLabel.textContent = "Canlı API";
      envDot.style.background = "var(--accent)";
    } else {
      envLabel.textContent = "Demo Ortamı (Statik)";
      envDot.style.background = "var(--warning)";
    }
  }
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
      foot: `Toplam ${cases.length} kayıtlı servis vakası`,
      action: () => { S.caseFilter = "all"; location.hash = "#cases"; },
    },
    {
      label: "Kanıt Bekleyen",
      value: awaiting,
      foot: "Teknisyen ölçüm veya görsel girişi bekliyor",
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
      foot: "Uzman ekibe devri onaylanan vakalar",
      action: () => { S.caseFilter = "routed"; location.hash = "#cases"; },
    },
  ];

  const kpiEl = $("#overview-kpis");
  if (kpiEl) {
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
  }

  // Priority Cases List
  const prioListEl = $("#priority-cases-list");
  if (prioListEl) {
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

      $$(".priority-case-card", prioListEl).forEach((card) => {
        card.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            location.hash = `#cases/${card.dataset.openCase}`;
          }
        };
      });
    }
  }

  // Recent Activity Feed
  const feedEl = $("#recent-activity-list");
  if (feedEl) {
    const allAudit = cases.flatMap((c) => (c.audit || []).map((a) => ({ ...a, caseId: c.id, family: c.vehicle.family })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 6);

    if (!allAudit.length) {
      feedEl.innerHTML = `<li class="text-secondary">Henüz kayıtlı aktivite yok.</li>`;
    } else {
      feedEl.innerHTML = allAudit.map((a) => {
        const isCrit = /Eskalasyon|Safety|Kritik/i.test(a.action);
        const isWarn = /Kanıt/i.test(a.action);
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
  }

  // System Posture Card
  const postureEl = $("#system-posture-card");
  if (postureEl) {
    postureEl.innerHTML = `
      <div class="section-header" style="margin-bottom:4px">
        <h3>Karar Katmanı Parametreleri (RAEP)</h3>
        <a href="#policy" class="btn-subtle btn-xs">Ayarlar</a>
      </div>
      <div class="posture-row"><span>Yönlendirme Eşiği (τ_route)</span><strong>${num(S.settings.tau_route, 2)}</strong></div>
      <div class="posture-row"><span>Kanıt Yeterlilik Eşiği (τ_suff)</span><strong>${num(S.settings.tau_suff, 2)}</strong></div>
      <div class="posture-row"><span>Kritik Eskalasyon Eşiği (τ_crit)</span><strong>${num(S.settings.tau_crit, 2)}</strong></div>
      <div class="posture-row"><span>Çalışma Modu</span><strong>${S.mode === "api" ? "FastAPI Sunucusu" : "Statik Yerel Motor"}</strong></div>
    `;
  }
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
    inspecting: "Onay Bekliyor",
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
  if (!container) return;

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
      const input = $("#cases-search-input");
      if (input) input.value = "";
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

  $$(".cases-table tbody tr", container).forEach((tr) => {
    tr.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        location.hash = `#cases/${tr.dataset.openCase}`;
      }
    };
  });
}

// ---------- SCREEN C: Yeni Vaka (3-Step Wizard) ----------
function setWizardStep(step) {
  S.wizardStep = Math.max(1, Math.min(3, step));

  $$(".wizard-stepper .step-tab").forEach((tab) => {
    const s = Number(tab.dataset.stepTarget);
    tab.classList.toggle("active", s === S.wizardStep);
    tab.classList.toggle("completed", s < S.wizardStep);
    if (s === S.wizardStep) tab.setAttribute("aria-current", "step");
    else tab.removeAttribute("aria-current");
  });

  const s1 = $("#form-step-1");
  const s2 = $("#form-step-2");
  const s3 = $("#form-step-3");
  if (s1) s1.hidden = S.wizardStep !== 1;
  if (s2) s2.hidden = S.wizardStep !== 2;
  if (s3) s3.hidden = S.wizardStep !== 3;

  if (S.wizardStep === 3) {
    renderWizardSummary();
  }

  // Scroll to active section heading
  const targetHeader = $(`#sec-${S.wizardStep === 1 ? "vehicle" : S.wizardStep === 2 ? "problem" : "evidence"}-h`);
  targetHeader?.focus();
}

function validateWizardStep(step) {
  const f = $("#case-form");
  if (!f) return false;

  if (step === 1) {
    const family = f.elements.family.value.trim();
    const kmStr = f.elements.km.value.trim();
    const errFam = $("#err-family");
    const errKm = $("#err-km");
    let ok = true;

    if (errFam) errFam.textContent = "";
    if (errKm) errKm.textContent = "";

    if (!family || family.length < 2) {
      if (errFam) errFam.textContent = "Lütfen geçerli bir araç modeli girin (en az 2 karakter).";
      f.elements.family.setAttribute("aria-invalid", "true");
      f.elements.family.focus();
      ok = false;
    } else {
      f.elements.family.removeAttribute("aria-invalid");
    }

    const kmNum = Number(kmStr);
    if (!kmStr || Number.isNaN(kmNum) || kmNum < 0 || kmNum > 5000000) {
      if (errKm) errKm.textContent = "Kilometre 0 ile 5.000.000 arasında geçerli bir sayı olmalıdır.";
      f.elements.km.setAttribute("aria-invalid", "true");
      if (ok) f.elements.km.focus();
      ok = false;
    } else {
      f.elements.km.removeAttribute("aria-invalid");
    }
    return ok;
  }

  if (step === 2) {
    addDtcFromInput();
    const note = f.elements.note.value.trim();
    const errNote = $("#err-note");
    if (errNote) errNote.textContent = "";

    if (!note || note.length < 5) {
      if (errNote) errNote.textContent = "Arıza açıklaması en az 5 karakter olmalıdır.";
      f.elements.note.setAttribute("aria-invalid", "true");
      f.elements.note.focus();
      return false;
    }
    f.elements.note.removeAttribute("aria-invalid");
    return true;
  }

  return true;
}

function renderWizardSummary() {
  const f = $("#case-form");
  const el = $("#form-review-summary");
  if (!f || !el) return;

  const family = f.elements.family.value.trim() || "—";
  const km = f.elements.km.value.trim() ? `${Number(f.elements.km.value).toLocaleString("tr-TR")} km` : "—";
  const fuel = f.elements.fuel?.value === "electric" ? "Elektrik (HV)" : "Dizel (ICE)";
  const note = f.elements.note.value.trim() || "—";
  const dtcText = S.formDtcs.length ? S.formDtcs.join(", ") : "Belirtilmedi";
  const attCount = `${S.formAttachments.length} dosya yüklendi`;

  el.innerHTML = `
    <div><span class="text-secondary">Araç:</span> <strong>${esc(family)} (${fuel})</strong></div>
    <div><span class="text-secondary">Kilometre:</span> <strong class="mono">${esc(km)}</strong></div>
    <div><span class="text-secondary">DTC Kodları:</span> <strong class="mono">${esc(dtcText)}</strong></div>
    <div><span class="text-secondary">Görsel Kanıt:</span> <strong>${esc(attCount)}</strong></div>
    <div style="grid-column:1/-1;border-top:1px solid var(--border-subtle);padding-top:6px">
      <span class="text-secondary">Şikayet Özeti:</span>
      <p style="margin-top:2px;font-size:0.85rem">${esc(note.slice(0, 140))}${note.length > 140 ? "…" : ""}</p>
    </div>
  `;
}

function renderFormDtcChips() {
  const el = $("#dtc-chips");
  if (!el) return;
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
  if (!input) return;
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
  if (!el) return;
  if (!S.formAttachments.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = S.formAttachments.map((att, idx) => `
    <div class="att-card">
      <button type="button" class="att-thumb-btn" data-preview-img="${esc(att.data_url)}" data-preview-cap="${esc(att.caption || att.name)}" aria-label="${esc(att.name)} görselini büyüt">
        <img class="att-thumb" src="${esc(att.data_url)}" alt="${esc(att.caption || att.name)}">
      </button>
      <div class="att-meta">
        <span title="${esc(att.name)}">${esc(att.name)}</span>
        <button type="button" class="btn-subtle btn-xs" data-remove-att="${idx}">Kaldır</button>
      </div>
    </div>
  `).join("");
}

function handleFileReads(files, onAdd) {
  const list = [...files];
  const errEl = $("#err-photo");
  if (errEl) errEl.textContent = "";

  if (S.formAttachments.length + list.length > MAX_ATT_COUNT) {
    const msg = `En fazla ${MAX_ATT_COUNT} görsel referans eklenebilir.`;
    if (errEl) errEl.textContent = msg;
    toast(msg);
    return;
  }

  list.forEach((file) => {
    if (!file.type.startsWith("image/")) {
      const msg = "Lütfen geçerli bir görsel formatı (PNG, JPG, WEBP, SVG) seçin.";
      if (errEl) errEl.textContent = msg;
      toast(msg);
      return;
    }
    if (file.size > MAX_ATT_BYTES) {
      const msg = `"${file.name}" dosya boyutu sınırı aşıyor (en fazla 500 KB).`;
      if (errEl) errEl.textContent = msg;
      toast(msg);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onAdd({
        name: file.name,
        caption: `${file.name} (${Math.round(file.size / 1024)} KB)`,
        data_url: reader.result,
      });
    };
    reader.readAsDataURL(file);
  });
}

function renderScenariosBar() {
  const quickIds = ["can_comm", "hv_charging", "critical_fire", "engine_overheat", "intermittent_stall"];
  const quick = S.scenarios.filter((s) => quickIds.includes(s.id));
  const qEl = $("#quick-scenarios");
  if (qEl) {
    qEl.innerHTML = quick.map((s) => `
      <button type="button" class="scenario-pill-btn" data-fill-scenario="${esc(s.id)}">
        <span>${esc(s.title)}</span>
        <small>${esc(s.vehicle.family)}</small>
      </button>
    `).join("");
  }

  const allEl = $("#all-scenarios-drawer");
  if (allEl) {
    allEl.innerHTML = S.scenarios.map((s) => `
      <button type="button" class="scenario-card-btn" data-fill-scenario="${esc(s.id)}">
        <strong>${esc(s.title)}</strong>
        <span>${esc(s.vehicle.family)} · ${s.vehicle.fuel === "electric" ? "Elektrik" : "Dizel"} · ${Number(s.vehicle.km).toLocaleString("tr-TR")} km</span>
        <span>Beklenen: ${esc(s.expected === "ESCALATE" ? "ESCALATE (Uzman)" : nodeLabel(s.expected))}</span>
      </button>
    `).join("");
  }
}

function prefillScenarioIntoForm(sc) {
  const f = $("#case-form");
  if (!f) return;
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
  S.formAttachments = [];
  renderFormAttachments();

  const bar = $("#active-scenario-bar");
  const title = $("#active-scenario-title");
  if (bar && title) {
    title.textContent = `${sc.title} (${sc.vehicle.family})`;
    bar.hidden = false;
  }

  setWizardStep(1);
  toast(`"${sc.title}" senaryosu forma yüklendi.`);
}

function clearActiveScenario() {
  const f = $("#case-form");
  if (!f) return;
  delete f.dataset.scenarioId;
  const bar = $("#active-scenario-bar");
  if (bar) bar.hidden = true;
  f.reset();
  S.formDtcs = [];
  S.formAttachments = [];
  renderFormDtcChips();
  renderFormAttachments();
  setWizardStep(1);
  toast("Senaryo seçimi kaldırıldı ve form temizlendi.");
}

function saveDraftToStorage() {
  const f = $("#case-form");
  if (!f) return;
  addDtcFromInput();
  const draft = {
    family: f.elements.family?.value || "",
    vin: f.elements.vin?.value || "",
    km: f.elements.km?.value || "",
    location: f.elements.location?.value || "",
    fuel: f.elements.fuel?.value || "diesel",
    note: f.elements.note?.value || "",
    repairs: f.elements.repairs?.value || "",
    initial_measurements: f.elements.initial_measurements?.value || "",
    dtcs: S.formDtcs,
    attachments: S.formAttachments,
    scenarioId: f.dataset.scenarioId || null,
    wizardStep: S.wizardStep,
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    const banner = $("#draft-banner");
    if (banner) banner.hidden = false;
    toast("Taslak tarayıcıya kaydedildi.");
  } catch (err) {
    toast("Taslak kaydedilemedi (tarayıcı kota sınırı).");
  }
}

function loadDraftIfPresent() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const banner = $("#draft-banner");
    if (!raw) {
      if (banner) banner.hidden = true;
      return;
    }
    const d = JSON.parse(raw);
    const f = $("#case-form");
    if (!f) return;
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
    if (d.scenarioId) {
      f.dataset.scenarioId = d.scenarioId;
      const sc = S.scenarios.find((x) => x.id === d.scenarioId);
      const bar = $("#active-scenario-bar");
      const title = $("#active-scenario-title");
      if (bar && title && sc) {
        title.textContent = `${sc.title} (${sc.vehicle.family})`;
        bar.hidden = false;
      }
    }
    S.formDtcs = Array.isArray(d.dtcs) ? d.dtcs : [];
    S.formAttachments = Array.isArray(d.attachments) ? d.attachments : [];
    renderFormDtcChips();
    renderFormAttachments();
    if (d.wizardStep) setWizardStep(d.wizardStep);
    if (banner) banner.hidden = false;
  } catch {
    const banner = $("#draft-banner");
    if (banner) banner.hidden = true;
  }
}

// ---------- SCREEN D: Vaka Detayı (Case Detail) ----------
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
  if (!container) return;

  const c = S.cases.find((x) => x.id === S.selected);
  if (!c) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Vaka bulunamadı</h3>
        <p>Aradığınız <code>${esc(S.selected || "")}</code> numaralı servis vakası sistemde mevcut değil.</p>
        <a href="#cases" class="btn btn-primary btn-sm">Vaka Listesine Dön</a>
      </div>`;
    return;
  }

  const step = c.steps?.at(-1) || { decision: {}, signals: null, latency_ms: 0 };
  const d = step.decision || {};
  const sig = step.signals;
  const st = S.settings;
  const cat = caseCategory(c);
  const team = suggestedTeamInfo(c);
  const scenario = S.scenarios.find((s) => s.id === c.scenario_id);

  const topLeafId = d.target && d.target !== "expert_desk" ? d.target : d.baseline_one_shot;
  const topProb = topLeafId && d.nodes ? d.nodes[topLeafId] : null;

  const reqEvId = c.pending_evidence || d.evidence_id || d.candidates?.[0]?.id;
  const reqEv = reqEvId ? S.catalog.evidence[reqEvId] : null;
  const reqCand = d.candidates?.find((x) => x.id === reqEvId) || d.candidates?.[0];

  // Human vs machine override indicator
  const hasHumanOverride = ["confirmed", "approved", "overridden"].includes(c.review_status) && c.final;
  const machineDiffers = hasHumanOverride && c.machine_recommendation && c.machine_recommendation.target !== c.final.target;

  // Build Top "Sıradaki İşlem" Banner
  let nextActionKicker = "Sıradaki İşlem";
  let nextActionTitle = "";
  let nextActionReason = "";
  let nextActionBtnHtml = "";
  let nextActionCls = "";

  if (cat === "awaiting_evidence" && reqEv) {
    nextActionKicker = "Sıradaki İşlem · Eksik Kanıt Bekleniyor";
    nextActionTitle = `${reqEv.label} sonucunu ekleyin`;
    nextActionReason = `Hedef uzman ekibi belirlemek için ${reqEv.informs.map(nodeLabel).join(" ve ")} olasılıklarının ayrıştırılması gerekiyor.`;
    nextActionBtnHtml = `<button type="button" class="btn btn-primary btn-sm" data-open-ev-modal="${esc(reqEvId)}">Kanıt Ekle</button>`;
    nextActionCls = "is-warning";
  } else if (cat === "expert_review") {
    nextActionKicker = "Sıradaki İşlem · İnsan Uzman Onayı Gerekli";
    nextActionTitle = isCriticalCase(c) ? "Kritik güvenlik eskalasyonunu inceleyin" : "Yönlendirme kararını onaylayın";
    nextActionReason = d.safety_hits?.length
      ? `Güvenlik kuralı tetiklendi (${d.safety_hits.join(", ")}). Otomatik yönlendirme durduruldu.`
      : (d.reason || "Belirsizlik veya risk eşiği aşıldı; insan uzman teyidi gerekiyor.");
    nextActionBtnHtml = team.id === "expert_desk"
      ? `<button type="button" class="btn btn-primary btn-sm" data-open-override="approve">Uzman Kararı Ver / Yönlendir</button>`
      : `<button type="button" class="btn btn-primary btn-sm" data-open-override="approve">Öneriyi Onayla (${esc(team.label)})</button>`;
    nextActionCls = "is-critical";
  } else if (cat === "inspecting") {
    nextActionKicker = "Sıradaki İşlem · Yönlendirme Teyidi";
    nextActionTitle = `${team.label} ekibine devri onaylayın`;
    nextActionReason = `Kanıt yeterliliği (${sig ? pct(sig.sufficient) : "—"}) ve uzmanlık olasılığı eşiği aşıldı.`;
    nextActionBtnHtml = `<button type="button" class="btn btn-primary btn-sm" data-case-action="confirm_route">Yönlendirmeyi Onayla</button>`;
    nextActionCls = "";
  } else {
    nextActionKicker = "İşlem Durumu · Yönlendirildi";
    nextActionTitle = `Vaka ${team.label} uzman ekibine devredildi`;
    nextActionReason = `Operasyonel yönlendirme kararı kayıt altına alındı.`;
    nextActionBtnHtml = `<button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Ekibi Değiştir (Override)</button>`;
    nextActionCls = "";
  }

  const nextActionBannerHtml = `
    <section class="next-action-banner ${nextActionCls}" aria-label="Sıradaki İşlem Özeti">
      <div class="next-action-info">
        <div class="next-action-kicker">${esc(nextActionKicker)}</div>
        <div class="next-action-title">${esc(nextActionTitle)}</div>
        <div class="next-action-reason">${esc(nextActionReason)}</div>
      </div>
      <div class="next-action-cta">
        ${nextActionBtnHtml}
      </div>
    </section>
  `;

  // Missing evidence box
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
          ${isCriticalCase(c) ? "Güvenlik nedeniyle saha testi durduruldu" : "Yönlendirme için mevcut kanıtlar yeterli"}
        </div>
        <p class="me-explanation">
          ${isCriticalCase(c)
            ? "Kritik güvenlik uyarısı bulunan vakalarda teknisyenden ek saha denemesi istenmez; yalnızca güvenli belge/fotoğraf eklenebilir."
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

  // Risk & Human Approval Box
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
            ? `Vaka açıklamasında güvenlik açısından kritik ifade (${esc(d.safety_hits.join(", "))}) yer aldığı için otomatik yönlendirme durduruldu.`
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
          Mevcut kanıt yeterliliği (${sig ? pct(sig.sufficient) : "—"}) hedef eşiğin (${pct(st.tau_suff)}) altında. Yanlış ekibe yönlendirme riskini düşürmek için önce önerilen kanıtı ekleyin.
        </p>
      </div>
    `;
  } else if (cat === "inspecting") {
    riskApprovalHtml = `
      <div class="risk-approval-box">
        <div class="risk-approval-head" style="color:var(--info)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span>Yönlendirme önerisi hazır</span>
        </div>
        <p class="risk-approval-desc">
          Kanıt yeterliliği ve uzmanlık olasılığı eşikleri karşılandı. Önerilen <strong>${esc(team.label)}</strong> yönlendirmesini onaylayarak vakayı devredebilirsiniz.
        </p>
      </div>
    `;
  } else {
    riskApprovalHtml = `
      <div class="risk-approval-box">
        <div class="risk-approval-head" style="color:var(--accent)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span>Yönlendirme kararı kesinleşti</span>
        </div>
        <p class="risk-approval-desc">
          Vaka <strong>${esc(team.label)}</strong> uzman ekibine yönlendirildi.
        </p>
      </div>
    `;
  }

  // Decision Actions Stack
  let stateActionsHtml = "";
  if (cat === "awaiting_evidence") {
    stateActionsHtml = `
      <div class="decision-actions">
        <button type="button" class="btn btn-warning" data-case-action="request_evidence">
          Kanıt Talebini Kaydet
        </button>
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="escalate">Uzman Masasına Gönder</button>
          <button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Ekibi Değiştir (Override)</button>
        </div>
      </div>
    `;
  } else if (cat === "expert_review") {
    stateActionsHtml = `
      <div class="decision-actions">
        <button type="button" class="btn btn-primary" data-open-override="approve">
          ${team.id === "expert_desk" ? "Uzman Yönlendirme Kararı Ver" : "Önerilen Yönlendirmeyi Onayla"}
        </button>
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Farklı Ekibe Yönlendir</button>
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="request_evidence">Güvenli Belge İste</button>
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
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="escalate">Uzman Masasına Gönder</button>
          <button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Farklı Ekibe Yönlendir</button>
        </div>
      </div>
    `;
  } else {
    stateActionsHtml = `
      <div class="decision-actions">
        <div class="decision-actions-secondary">
          <button type="button" class="btn btn-secondary btn-sm" data-open-override="override">Farklı Ekibe Yönlendir</button>
          <button type="button" class="btn btn-secondary btn-sm" data-case-action="escalate">Uzman Masasına Aktar</button>
        </div>
      </div>
    `;
  }

  // Technical Explainability Accordion
  let techAccordionHtml = "";
  if (sig) {
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
              Güncel Politika Ayarlarıyla Yeniden Hesapla
            </button>
          </div>
        </div>
      </details>
    `;
  }

  // Attachments
  const attachments = c.attachments || [];
  const attachmentsHtml = attachments.length
    ? `<div class="attachment-previews">
        ${attachments.map((att) => `
          <div class="att-card">
            <button type="button" class="att-thumb-btn" data-preview-img="${esc(att.data_url)}" data-preview-cap="${esc(att.caption || att.name)}" aria-label="${esc(att.name)} görselini büyüt">
              <img class="att-thumb" src="${esc(att.data_url)}" alt="${esc(att.caption || att.name)}">
            </button>
            <div class="att-meta">
              <span title="${esc(att.caption || att.name)}">${esc(att.caption || att.name)}</span>
            </div>
          </div>
        `).join("")}
      </div>`
    : `<p class="field-hint" style="margin-top:8px">Henüz bu vakaya ait fotoğraf yüklenmedi.</p>`;

  // Timeline
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

  // Audit trail
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

    ${nextActionBannerHtml}

    <div class="detail-grid">
      <!-- LEFT 60%: Case & Evidence Details -->
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
              <p class="section-subtitle">Saha teknisyeni tarafından eklenen görsel kayıtlar</p>
            </div>
            <button type="button" class="btn btn-subtle btn-xs" data-open-ev-modal="connector_photo">+ Fotoğraf Ekle</button>
          </div>
          ${attachmentsHtml}
        </section>

        <section class="card" aria-labelledby="ev-tl-h">
          <div class="section-header" style="margin-bottom:4px">
            <div>
              <h2 id="ev-tl-h">Kanıt Zaman Çizelgesi</h2>
              <p class="section-subtitle">Vaka açılışından itibaren kaydedilen adımlar (${(c.evidence?.length || 0) + 1} kayıt)</p>
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

          <!-- 1. Hedef / Önerilen Uzman Ekip -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Hedef Uzman Ekip</span>
              ${topProb != null ? `<span class="mono">Güven: ${pct(topProb)}</span>` : ""}
            </div>
            <div class="specialist-box">
              <div class="specialist-name">
                <span>${esc(team.label)}</span>
                ${c.review_status === "confirmed" || c.review_status === "approved"
                  ? `<span class="badge badge-routed">Onaylandı</span>`
                  : c.review_status === "overridden"
                  ? `<span class="badge badge-warning">Değiştirildi (Override)</span>`
                  : c.review_status === "pending_confirmation"
                  ? `<span class="badge badge-inspecting">Önerildi · Onay Bekliyor</span>`
                  : `<span class="badge badge-escalated">Uzman Onayında</span>`}
              </div>
              <span class="specialist-path">${esc(hierarchyPath(team.id))}</span>
              ${machineDiffers ? `
                <div class="callout-bar warning-bar" style="margin-top:8px;padding:8px 10px;font-size:0.78rem">
                  <strong>İnsan Tercihi Korundu:</strong> Uzman kararı <em>${esc(c.final.target_label)}</em> olarak kayıtlı. Güncel politika algoritması <em>${esc(c.machine_recommendation.target_label)}</em> öneriyor.
                </div>
              ` : ""}
            </div>
          </div>

          <!-- 2. Değerlendirme Gerekçesi -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Değerlendirme Gerekçesi</span>
            </div>
            <div class="rationale-text">${esc(d.reason || "Vaka analizi tamamlandı.")}</div>
          </div>

          <!-- 3. Eksik Kanıt (Signature Feature) -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Eksik Kanıt Durumu</span>
              ${sig ? `<span class="mono">Yeterlilik: ${pct(sig.sufficient)}</span>` : ""}
            </div>
            ${missingEvidenceHtml}
          </div>

          <!-- 4. Risk ve İnsan Onayı -->
          <div class="analysis-block">
            <div class="analysis-label">
              <span>Risk ve Onay Durumu</span>
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

  const qPanel = $("#review-tab-queue");
  const tPanel = $("#review-tab-teams");
  const pPanel = $("#review-tab-policy");
  if (qPanel) qPanel.hidden = S.reviewTab !== "queue";
  if (tPanel) tPanel.hidden = S.reviewTab !== "teams";
  if (pPanel) pPanel.hidden = S.reviewTab !== "policy";

  // 1. Expert Review Queue
  const pendingReviewCases = S.cases.filter((c) => caseCategory(c) === "expert_review" || caseCategory(c) === "inspecting");
  const reviewedCases = S.cases.filter((c) => c.review_status === "approved" || c.review_status === "overridden" || c.review_status === "confirmed");

  const listEl = $("#expert-review-list");
  if (!listEl) return;

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
      pending_confirmation: ["badge-inspecting", "Onay Bekliyor"],
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
            <h4>Hedef Uzman Ekip</h4>
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
                ${team.id === "expert_desk" ? "Uzman Kararı Ver" : "Yönlendirmeyi Onayla"}
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
        <p class="section-subtitle">Güvenlik kapısı, kritik risk veya yönlendirme teyidi bekleyen vaka kayıtları</p>
      </div>
    </div>
    ${pendingReviewCases.length
      ? `<div class="review-queue-list">${pendingReviewCases.map((c) => renderReviewCard(c, false)).join("")}</div>`
      : `<div class="empty-state">
          <h3>İnceleme bekleyen vaka bulunmuyor</h3>
          <p>Kritik veya onay bekleyen tüm servis vakaları değerlendirildi.</p>
        </div>`
    }

    ${reviewedCases.length ? `
      <div class="section-header" style="margin-top:28px">
        <div>
          <h2>Tamamlanmış Uzman ve Yönlendirme Kararları (${reviewedCases.length})</h2>
          <p class="section-subtitle">Uzman onayı veya yönlendirme değişikliği tamamlanmış vakalar</p>
        </div>
      </div>
      <div class="review-queue-list">${reviewedCases.map((c) => renderReviewCard(c, true)).join("")}</div>
    ` : ""}
  `;

  // 2. Specialist Team Queues
  const groups = {};
  for (const c of S.cases.filter((x) => x.final)) {
    (groups[c.final.target] ??= []).push(c);
  }
  const order = ["expert_desk", ...Object.keys(S.catalog.nodes)];
  const qGrid = $("#queues-grid");
  if (qGrid) {
    qGrid.innerHTML = order
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
}

// ---------- Policy & Replay Rendering ----------
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

  const catEl = $("#evidence-catalog");
  if (catEl) {
    catEl.innerHTML = `
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

  const outEl = $("#replay-out");
  if (outEl) {
    outEl.innerHTML = `
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
}

// ---------- Modals: Evidence Entry & Expert Override ----------
function openEvidenceModal(caseId, preferredEvId) {
  const c = S.cases.find((x) => x.id === caseId);
  if (!c) return;

  const modal = $("#evidence-modal");
  const select = $("#ev-modal-select");
  const banner = $("#ev-modal-requested-banner");
  const fillBtn = $("#ev-modal-fill-btn");
  const sc = S.scenarios.find((s) => s.id === c.scenario_id);

  // Filter to applicable evidence only
  const applicableEntries = Object.entries(S.catalog.evidence).filter(([id]) => {
    return validateEvidenceForCase(c, id, S.settings) == null;
  });

  const chosenId = (preferredEvId && applicableEntries.some(([id]) => id === preferredEvId))
    ? preferredEvId
    : (c.pending_evidence && applicableEntries.some(([id]) => id === c.pending_evidence))
    ? c.pending_evidence
    : applicableEntries[0]?.[0] || "connector_photo";

  select.innerHTML = applicableEntries.map(([id, ev]) => `
    <option value="${esc(id)}" ${id === chosenId ? "selected" : ""}>${esc(ev.label)} (~${ev.T} dk · Efor ${ev.E}/5)</option>
  `).join("");

  if (c.pending_evidence && S.catalog.evidence[c.pending_evidence]) {
    banner.textContent = `Talep Edilen Kanıt: ${S.catalog.evidence[c.pending_evidence].label}`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  const updateEvMeta = () => {
    const ev = S.catalog.evidence[select.value];
    $("#ev-modal-meta").textContent = ev
      ? `Ayırt ettiği uzmanlıklar: ${ev.informs.map(nodeLabel).join(", ")} · Güvenilirlik varsayımı ρ=${ev.rho}`
      : "";

    // Show fillBtn ONLY when scenario actually has an answer for this evidence (no fabricated NO_FINDING)
    const hasScenarioAnswer = Boolean(sc?.answers && sc.answers[select.value]);
    fillBtn.hidden = !hasScenarioAnswer;
    fillBtn.onclick = () => {
      if (hasScenarioAnswer) {
        $("#ev-modal-result").value = sc.answers[select.value];
        $("#ev-modal-error").textContent = "";
      }
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

  const initialTarget = (team.id && team.id !== "expert_desk") ? team.id : S.catalog.leaves[0];

  select.innerHTML = options.map((o) => `
    <option value="${esc(o.id)}" ${o.id === initialTarget ? "selected" : ""}>${esc(o.label)}</option>
  `).join("");

  const isApprove = mode === "approve";
  $("#ov-modal-badge").textContent = isApprove ? "Uzman Onayı" : "Yönlendirme Değişikliği (Override)";
  $("#ov-modal-title").textContent = isApprove ? "Yönlendirme Kararını Onayla" : "Farklı Uzman Ekibe Yönlendir";
  $("#ov-modal-desc").textContent = isApprove
    ? `${c.id} (${c.vehicle.family}) vakası için hedef uzman ekibi teyit edin ve kararı kaydedin.`
    : `${c.id} (${c.vehicle.family}) vakası için hedef ekibi seçin ve değişiklik gerekçesini belirtin.`;
  $("#ov-reason-req").textContent = isApprove ? "İsteğe bağlı" : "Zorunlu (en az 3 karakter)";
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

  // Breadcrumb
  const bc = $("#breadcrumb");
  if (bc) {
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
  }

  // Close mobile drawer on navigation
  const sidebar = $("#sidebar");
  const backdrop = $("#sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.hidden = true;
  $("#sidebar-open")?.setAttribute("aria-expanded", "false");

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

// ---------- Event Listeners & Focus Management ----------
function bindEvents() {
  window.addEventListener("hashchange", routeView);

  // Mobile sidebar drawer & accessibility
  const sidebar = $("#sidebar");
  const sidebarOpen = $("#sidebar-open");
  const sidebarClose = $("#sidebar-close");
  const sidebarBackdrop = $("#sidebar-backdrop");

  const openDrawer = () => {
    if (sidebar) sidebar.classList.add("open");
    if (sidebarBackdrop) sidebarBackdrop.hidden = false;
    sidebarOpen?.setAttribute("aria-expanded", "true");
    sidebarClose?.focus();
  };

  const closeDrawer = () => {
    if (sidebar) sidebar.classList.remove("open");
    if (sidebarBackdrop) sidebarBackdrop.hidden = true;
    sidebarOpen?.setAttribute("aria-expanded", "false");
    sidebarOpen?.focus();
  };

  sidebarOpen?.addEventListener("click", openDrawer);
  sidebarClose?.addEventListener("click", closeDrawer);
  sidebarBackdrop?.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sidebar && sidebar.classList.contains("open")) {
        closeDrawer();
      }
    }
  });

  // Focus trap inside open mobile sidebar
  sidebar?.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !sidebar.classList.contains("open")) return;
    const focusables = $$("a[href], button:not([disabled])", sidebar);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Tablist arrow navigation
  $$('[role="tablist"]').forEach((tablist) => {
    tablist.addEventListener("keydown", (e) => {
      const tabs = $$('[role="tab"]', tablist);
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = tabs[(idx + 1) % tabs.length];
        next.focus();
        next.click();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        prev.focus();
        prev.click();
      }
    });
  });

  // Sidebar footer buttons
  $("#open-policy-btn")?.addEventListener("click", () => {
    S.reviewTab = "policy";
    location.hash = "#policy";
  });

  $("#reset-demo-btn")?.addEventListener("click", async (e) => {
    if (S.userModified) {
      const ok = window.confirm("Mevcut vaka değişiklikleri silinecek ve 5 başlangıç demo vakası yeniden yüklenecektir. Devam edilsin mi?");
      if (!ok) return;
    }
    await busy(e.currentTarget, "Sıfırlanıyor…", async () => {
      S.cases = await api("/cases/seed", { method: "POST" });
      S.selected = S.cases[0]?.id || null;
      S.userModified = false;
      renderAll();
      toast("5 temsili demo vakası başlangıç durumuna sıfırlandı.");
    });
  });

  $("#api-error-dismiss")?.addEventListener("click", hideApiError);

  // Global search input
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

  // Cases search & filter pills
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

  // Wizard Navigation
  $$(".wizard-stepper .step-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetStep = Number(tab.dataset.stepTarget);
      if (targetStep < S.wizardStep || validateWizardStep(S.wizardStep)) {
        setWizardStep(targetStep);
      }
    });
  });

  document.addEventListener("click", (e) => {
    const nextBtn = e.target.closest("[data-next-step]");
    if (nextBtn) {
      const targetStep = Number(nextBtn.dataset.nextStep);
      if (validateWizardStep(S.wizardStep)) {
        setWizardStep(targetStep);
      }
      return;
    }
    const prevBtn = e.target.closest("[data-prev-step]");
    if (prevBtn) {
      setWizardStep(Number(prevBtn.dataset.prevStep));
      return;
    }
    if (e.target.closest("[data-save-draft]")) {
      saveDraftToStorage();
      return;
    }
  });

  // Review screen tabs
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

    const fillSc = e.target.closest("[data-fill-scenario]");
    if (fillSc) {
      const sc = S.scenarios.find((x) => x.id === fillSc.dataset.fillScenario);
      if (sc) prefillScenarioIntoForm(sc);
      return;
    }

    if (e.target.closest("#clear-scenario-btn")) {
      clearActiveScenario();
      return;
    }

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

    const remAtt = e.target.closest("[data-remove-att]");
    if (remAtt) {
      S.formAttachments.splice(Number(remAtt.dataset.removeAtt), 1);
      renderFormAttachments();
      return;
    }

    const prevImg = e.target.closest("[data-preview-img]");
    if (prevImg) {
      const modal = $("#image-modal");
      const src = $("#img-modal-src");
      const cap = $("#img-modal-caption");
      if (modal && src && cap) {
        src.src = prevImg.dataset.previewImg;
        cap.textContent = prevImg.dataset.previewCap || "";
        modal.showModal();
      }
      return;
    }

    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      $(`#${closeBtn.dataset.closeModal}`)?.close();
      return;
    }

    const openEvBtn = e.target.closest("[data-open-ev-modal]");
    if (openEvBtn) {
      openEvidenceModal(S.selected, openEvBtn.dataset.openEvModal);
      return;
    }

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
      const c = S.cases.find((x) => x.id === cid);
      const team = c ? suggestedTeamInfo(c) : null;
      if (team?.id === "expert_desk") {
        openOverrideModal(cid, "approve");
      } else {
        await busy(revApp, "Onaylanıyor…", async () => {
          const updated = await api(`/cases/${cid}/review`, { method: "POST", body: { action: "approve" } });
          upsertCase(updated);
          toast(`${cid} yönlendirmesi onaylandı.`);
        });
      }
      return;
    }

    const caseAct = e.target.closest("[data-case-action]");
    if (caseAct) {
      const action = caseAct.dataset.caseAction;
      const c = S.cases.find((x) => x.id === S.selected);
      if (!c) return;

      if (action === "request_evidence") {
        openEvidenceModal(c.id, c.pending_evidence || "connector_photo");
        return;
      }

      await busy(caseAct, "İşleniyor…", async () => {
        const updated = await api(`/cases/${c.id}/review`, { method: "POST", body: { action } });
        upsertCase(updated);
        const msgMap = {
          confirm_route: "Yönlendirme onaylandı.",
          escalate: "Vaka uzman masasına aktarıldı.",
        };
        toast(msgMap[action] || "Vaka güncellendi.");
      });
    }
  });

  $("#toggle-scenarios-btn")?.addEventListener("click", (e) => {
    const drawer = $("#all-scenarios-drawer");
    if (!drawer) return;
    const open = drawer.hidden;
    drawer.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Senaryoları Gizle" : `Tüm Senaryolar (${S.scenarios.length})`;
  });

  $("#family")?.addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase();
    if (val.includes("volt") || val.includes("citivolt")) {
      const r = $(`#case-form input[name="fuel"][value="electric"]`);
      if (r) r.checked = true;
    }
  });

  $("#add-dtc-btn")?.addEventListener("click", addDtcFromInput);
  $("#dtc-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDtcFromInput();
    }
  });

  // Dropzone
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

  $("#clear-draft-btn")?.addEventListener("click", () => {
    localStorage.removeItem(DRAFT_KEY);
    const f = $("#case-form");
    if (f) {
      f.reset();
      delete f.dataset.scenarioId;
    }
    S.formDtcs = [];
    S.formAttachments = [];
    renderFormDtcChips();
    renderFormAttachments();
    const bar = $("#active-scenario-bar");
    if (bar) bar.hidden = true;
    const banner = $("#draft-banner");
    if (banner) banner.hidden = true;
    setWizardStep(1);
    toast("Taslak temizlendi.");
  });

  // Submit New Case Form
  $("#case-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateWizardStep(1) || !validateWizardStep(2)) return;

    const f = e.target;
    const family = f.elements.family.value.trim();
    const kmStr = f.elements.km.value.trim();
    const note = f.elements.note.value.trim();

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

    await busy($("#submit-case-btn"), "Analiz Ediliyor…", async () => {
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
      toast(`${created.id} oluşturuldu ve triyaj analizi tamamlandı.`);
    });
  });

  // Evidence Modal Upload
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

  // Evidence Modal Submit
  $("#evidence-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const modal = $("#evidence-modal");
    const cid = modal.dataset.caseId;
    const evId = $("#ev-modal-select").value;
    const result = $("#ev-modal-result").value.trim();

    if (!result || result.length < 2) {
      $("#ev-modal-error").textContent = "Lütfen en az 2 karakterlik ölçüm veya gözlem sonucu girin.";
      $("#ev-modal-result").focus();
      return;
    }
    $("#ev-modal-error").textContent = "";

    await busy($("#ev-modal-submit"), "Yeniden Değerlendiriliyor…", async () => {
      const updated = await api(`/cases/${cid}/evidence`, {
        method: "POST",
        body: { evidence_id: evId, result, attachment: S.modalAttachment },
      });
      modal.close();
      upsertCase(updated);
      toast("Yeni kanıt kaydedildi ve analiz güncellendi.");
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

    if (mode === "override" && reason.length < 3) {
      $("#ov-modal-error").textContent = "Yönlendirme değişikliği için en az 3 karakterlik gerekçe zorunludur.";
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
      toast(`${cid} için karar kaydedildi.`);
    });
  });

  // Policy Form Submit & Defaults
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
    busy(e.currentTarget, "Simülasyon Koşuyor…", async () => {
      const data = await api("/replay", { method: "POST" });
      renderReplayOutput(data);
    })
  );
}

// ---------- Bootstrap ----------
(async function init() {
  bindEvents();
  renderFormDtcChips();

  // Mode probe: check if backend API is reachable
  const isStaticHost = location.hostname.endsWith("github.io") || location.protocol === "file:";
  if (isStaticHost) {
    S.mode = "local";
  } else {
    try {
      const ping = await fetch("/api/catalog");
      if (ping.ok && (ping.headers.get("content-type") || "").includes("application/json")) {
        S.mode = "api";
      } else {
        S.mode = "local";
      }
    } catch {
      S.mode = "local";
    }
  }

  // Restore saved state or initialize
  if (S.mode === "local") {
    try {
      const savedSettings = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (savedSettings) S.settings = { ...FALLBACK_CATALOG.default_settings, ...JSON.parse(savedSettings) };
      const savedCases = localStorage.getItem(LOCAL_CASES_KEY);
      if (savedCases) {
        S.cases = JSON.parse(savedCases);
        S.userModified = true;
      } else {
        S.cases = buildFallbackDemoCases(S.settings);
      }
    } catch {
      S.cases = buildFallbackDemoCases(S.settings);
    }
  } else {
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
    } catch (err) {
      showApiError("API bağlantısı kurulamadı. Lütfen sunucunun çalıştığını kontrol edin.");
    }
  }

  S.selected = S.cases[0]?.id || null;
  renderScenariosBar();
  renderPolicySection();
  renderAll();
})();
