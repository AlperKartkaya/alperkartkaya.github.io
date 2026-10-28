/* TEBDİL Interactive Landing Page Controller
 * Driven 100% by real ByteDance/Ouro-1.4B-Thinking traces in window.TEBDIL_DATA.
 */
(function () {
  "use strict";

  const DATA = window.TEBDIL_DATA || {};
  const FINAL = DATA.final_results || {};
  const GRID = (DATA.grid_summary && DATA.grid_summary.grid) || [];
  const DIM_ABL = (DATA.dimension_ablations && DATA.dimension_ablations.ablations) || [];
  const TRACES_VAL = (DATA.traces && DATA.traces.validation_phase3) || [];
  const TRACES_TEST = (DATA.traces && DATA.traces.test_phase4) || [];

  // Index traces by (splitKey, problem_id, seed, method)
  const traceIndex = new Map();
  const problemCatalog = [];
  const seenProblemSeeds = new Set();

  function addTraces(splitKey, list) {
    list.forEach((row) => {
      const key = `${splitKey}|${row.problem_id}|${row.seed}`;
      if (!traceIndex.has(key)) {
        traceIndex.set(key, {});
      }
      traceIndex.get(key)[row.method] = row;
      if (!seenProblemSeeds.has(key)) {
        seenProblemSeeds.add(key);
        problemCatalog.push({
          key,
          splitKey,
          problem_id: row.problem_id,
          seed: row.seed,
          family: row.family,
          gold_answer: row.gold_answer,
          prompt: row.prompt,
        });
      }
    });
  }

  addTraces("test_phase4", TRACES_TEST);
  addTraces("validation_phase3", TRACES_VAL);

  // Curated highlights at top of selector
  const CURATED_KEYS = [
    {
      key: "test_phase4|arith_test_003|42",
      tag: "★ Emergent Cooperative Rescue (A=42, B=40 → E1/E2=48)",
    },
    {
      key: "validation_phase3|graph_validation_002|42",
      tag: "★ Causal Curvature Rescue (M1=13, E1_rand=13 → E1=17)",
    },
    {
      key: "test_phase4|graph_test_005|42",
      tag: "★ Test Graph Rescue (S0=17 → E1/E2=12)",
    },
    {
      key: "validation_phase3|arith_validation_003|42",
      tag: "⚠ Honest Failure Case (Borderline S0=38 → E1=33)",
    },
  ];

  let activeProblemKey = CURATED_KEYS[0].key;
  let activeMethod = "E2";
  let activeStep = 2; // 1..4
  let autoLoopTimer = null;

  const $ = (id) => document.getElementById(id);

  function fmtPct(v) {
    if (v === undefined || v === null || Number.isNaN(v)) return "--";
    return (v * 100).toFixed(2) + "%";
  }

  function fmtSignedPct(v) {
    if (v === undefined || v === null || Number.isNaN(v)) return "--";
    const s = (v * 100).toFixed(2) + "%";
    return v > 0 ? "+" + s : s;
  }

  function fmtNum(v, digits = 2) {
    if (v === undefined || v === null || Number.isNaN(v)) return "--";
    return Number(v).toFixed(digits);
  }

  /* ============================================================
   * 1. STAGE SELECTORS & CONTROLS
   * ============================================================ */
  function initStageControls() {
    const caseSel = $("caseSelect");
    const methodSel = $("methodSelect");
    if (!caseSel || !methodSel) return;

    caseSel.innerHTML = "";

    const optGroupCurated = document.createElement("optgroup");
    optGroupCurated.label = "Featured Mechanistic Cases";
    CURATED_KEYS.forEach((item) => {
      if (traceIndex.has(item.key)) {
        const opt = document.createElement("option");
        opt.value = item.key;
        opt.textContent = item.tag;
        optGroupCurated.appendChild(opt);
      }
    });
    caseSel.appendChild(optGroupCurated);

    const optGroupAll = document.createElement("optgroup");
    optGroupAll.label = "All Benchmark Problem Instances";
    problemCatalog.forEach((p) => {
      const methods = traceIndex.get(p.key) || {};
      const s0 = methods.S0;
      const e1 = methods.E1;
      let statusTag = "";
      if (s0 && e1) {
        if (!s0.is_correct && e1.is_correct) statusTag = " [RESCUED]";
        else if (s0.is_correct && !e1.is_correct) statusTag = " [DEGRADED]";
        else if (e1.is_correct) statusTag = " [CORRECT]";
      }
      const opt = document.createElement("option");
      opt.value = p.key;
      opt.textContent = `${p.problem_id} (seed=${p.seed}, ${p.family}, gold=${p.gold_answer})${statusTag}`;
      optGroupAll.appendChild(opt);
    });
    caseSel.appendChild(optGroupAll);

    caseSel.value = activeProblemKey;
    caseSel.addEventListener("change", () => {
      activeProblemKey = caseSel.value;
      syncMethodDropdown();
      renderStage();
    });

    methodSel.addEventListener("change", () => {
      activeMethod = methodSel.value;
      renderStage();
    });

    document.querySelectorAll(".step-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        stopAutoLoop();
        activeStep = Number(btn.getAttribute("data-step")) || 2;
        renderStage();
      });
    });

    const playBtn = $("playLoopBtn");
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (autoLoopTimer) {
          stopAutoLoop();
        } else {
          startAutoLoop();
        }
      });
    }

    syncMethodDropdown();
    renderStage();
  }

  function syncMethodDropdown() {
    const methodSel = $("methodSelect");
    const methodsObj = traceIndex.get(activeProblemKey) || {};
    const available = Object.keys(methodsObj);
    const preferredOrder = [
      "E2",
      "E1",
      "M1",
      "E1_no_curv",
      "E1_rand_curv",
      "M0",
      "C0",
      "P0",
      "P1",
      "R0",
      "E0",
      "S1",
      "S0",
    ];
    const ordered = preferredOrder.filter((m) => available.includes(m));
    const labels = {
      E2: "E2 — Adaptive TEBDİL Excursion (Label-Free Trigger)",
      E1: "E1 — Fixed TEBDİL Excursion (α=0.5, β=0.5)",
      M1: "M1 — Linear Update Mixing (Curvature C₂ = 0)",
      E1_no_curv: "E1_no_curv — Causal Curvature Stripped (C₂ = 0)",
      E1_rand_curv: "E1_rand_curv — Random Direction Curvature Control",
      M0: "M0 — Direct Hidden State Mixing",
      C0: "C0 — Visit Midpoint Without Return",
      P0: "P0 — Parallel 2-Branch Confidence Vote",
      P1: "P1 — Oracle Best-of-2 Selection",
      R0: "R0 — Norm-Matched Random State Noise",
      E0: "E0 — Random-Direction Excursion Probe",
      S1: "S1 — Single Trajectory + Extra Depth (5 Steps)",
      S0: "S0 — Standard Single Trajectory (4 Steps)",
    };

    methodSel.innerHTML = "";
    ordered.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = labels[m] || m;
      methodSel.appendChild(opt);
    });
    if (!ordered.includes(activeMethod)) {
      activeMethod = ordered.includes("E2") ? "E2" : ordered[0] || "E1";
    }
    methodSel.value = activeMethod;
  }

  function startAutoLoop() {
    stopAutoLoop();
    const icon = $("playLoopIcon");
    const txt = $("playLoopText");
    if (icon) icon.className = "fas fa-pause";
    if (txt) txt.textContent = "Pause";
    autoLoopTimer = setInterval(() => {
      activeStep = (activeStep % 4) + 1;
      renderStage();
    }, 1800);
  }

  function stopAutoLoop() {
    if (autoLoopTimer) {
      clearInterval(autoLoopTimer);
      autoLoopTimer = null;
    }
    const icon = $("playLoopIcon");
    const txt = $("playLoopText");
    if (icon) icon.className = "fas fa-play";
    if (txt) txt.textContent = "Auto-Loop";
  }

  /* ============================================================
   * 2. RENDER INTERACTIVE STAGE (SVG + PCA + TELEMETRY)
   * ============================================================ */
  function renderStage() {
    const methodsObj = traceIndex.get(activeProblemKey) || {};
    const trace = methodsObj[activeMethod] || methodsObj.E1 || methodsObj.S0;
    const s0Trace = methodsObj.S0 || trace;
    const e1Trace = methodsObj.E1 || trace;
    if (!trace) return;

    // Update step pills
    document.querySelectorAll(".step-pill").forEach((btn) => {
      const s = Number(btn.getAttribute("data-step"));
      btn.classList.toggle("is-active", s === activeStep);
    });

    const stepTitles = {
      1: "UT Step t = 1 · Branch Fork & Full-Sequence Perturbation",
      2: "UT Step t = 2 · Cooperative Midpoint Excursion & Curvature",
      3: "UT Step t = 3 · Trust-Region Return into Primary Trajectory",
      4: "UT Step t = 4 · Final Recurrent Refinement & Token Readout",
    };
    $("stageStepLabel").textContent = stepTitles[activeStep] || stepTitles[2];

    $("liveProblemHeader").textContent =
      `Problem: ${trace.problem_id} (seed=${trace.seed}) · Split: ${trace.split} · Family: ${trace.family.toUpperCase()}`;
    $("liveGoldBadge").textContent = `Gold Answer: ${trace.gold_answer}`;
    $("livePromptBody").textContent = trace.prompt;

    const snapshots = trace.step_snapshots || [];
    const snap = snapshots.find((s) => s.step === activeStep) || snapshots[Math.min(activeStep - 1, snapshots.length - 1)] || {};
    const snap2 = snapshots.find((s) => s.step === 2) || {};

    renderExcursionSvg(trace, snap, snap2);
    renderPcaSvg(trace, e1Trace);
    renderTelemetryGrid(trace, snap, snap2);
    renderTerminalComparison(methodsObj, trace, s0Trace);
  }

  function renderExcursionSvg(trace, snap, snap2) {
    const svg = $("excursionStageSvg");
    if (!svg) return;

    const m = trace.method;
    const hasBranchB = m !== "S0" && m !== "S1";
    const hasMidpointEval = ["E1", "E2", "C0", "E0", "E1_no_curv", "E1_rand_curv"].includes(m);
    const e2Skipped = m === "E2" && trace.policy_action === "skip";
    const curvFrob = fmtNum(trace.curvature_frob, 2);
    const relDist2 = fmtNum(snap2.ab_relative_distance || trace.branch_relative_distance, 3);
    const marginA2 = snap2.branch_margin && snap2.branch_margin.A !== undefined ? fmtNum(snap2.branch_margin.A, 3) : "--";
    const entA2 = snap2.branch_entropy && snap2.branch_entropy.A !== undefined ? fmtNum(snap2.branch_entropy.A, 3) : "--";

    // Active highlights based on activeStep (1..4)
    const s1Active = activeStep === 1;
    const s2Active = activeStep === 2;
    const s3Active = activeStep === 3;
    const s4Active = activeStep === 4;

    const colActive = "#4338ca";
    const colDonor = "#0ea5e9";
    const colVisit = "#7c3aed";
    const colReturn = "#059669";
    const colMuted = "#cbd5e1";

    svg.innerHTML = `
      <defs>
        <marker id="arrIndigo" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#4338ca"/>
        </marker>
        <marker id="arrSky" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#0ea5e9"/>
        </marker>
        <marker id="arrViolet" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#7c3aed"/>
        </marker>
        <marker id="arrEmerald" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#059669"/>
        </marker>
        <marker id="arrGray" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8"/>
        </marker>
      </defs>

      <!-- Step column background bands -->
      <rect x="18" y="10" width="135" height="298" rx="10" fill="${s1Active ? 'rgba(99,102,241,0.09)' : '#f8fafc'}" stroke="${s1Active ? '#6366f1' : '#e2e8f0'}" stroke-width="${s1Active ? 2 : 1}"/>
      <rect x="168" y="10" width="185" height="298" rx="10" fill="${s2Active ? 'rgba(124,58,237,0.09)' : '#f8fafc'}" stroke="${s2Active ? '#7c3aed' : '#e2e8f0'}" stroke-width="${s2Active ? 2 : 1}"/>
      <rect x="368" y="10" width="140" height="298" rx="10" fill="${s3Active ? 'rgba(5,150,105,0.09)' : '#f8fafc'}" stroke="${s3Active ? '#059669' : '#e2e8f0'}" stroke-width="${s3Active ? 2 : 1}"/>
      <rect x="522" y="10" width="144" height="298" rx="10" fill="${s4Active ? 'rgba(14,165,233,0.09)' : '#f8fafc'}" stroke="${s4Active ? '#0ea5e9' : '#e2e8f0'}" stroke-width="${s4Active ? 2 : 1}"/>

      <text x="85" y="28" text-anchor="middle" font-size="10" font-weight="800" fill="#475569">STEP t = 1 (FORK)</text>
      <text x="260" y="28" text-anchor="middle" font-size="10" font-weight="800" fill="#475569">STEP t = 2 (EXCURSION)</text>
      <text x="438" y="28" text-anchor="middle" font-size="10" font-weight="800" fill="#475569">STEP t = 3 (RETURN)</text>
      <text x="594" y="28" text-anchor="middle" font-size="10" font-weight="800" fill="#475569">STEP t = 4 (READOUT)</text>

      <!-- ================= PRIMARY BRANCH A (TOP RAIL) ================= -->
      <rect x="34" y="44" width="104" height="52" rx="10" fill="#fff" stroke="${colActive}" stroke-width="${s1Active ? 3 : 2}"/>
      <text x="86" y="65" text-anchor="middle" font-size="12" font-weight="800" fill="#1e1b4b">Primary H₁ᴬ</text>
      <text x="86" y="82" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#475569">Anchor State</text>

      <line x1="138" y1="70" x2="196" y2="70" stroke="${colActive}" stroke-width="2.5" marker-end="url(#arrIndigo)"/>
      <text x="167" y="62" text-anchor="middle" font-size="9" font-weight="700" fill="#4338ca">F_θ,1</text>

      <rect x="202" y="44" width="116" height="52" rx="10" fill="#fff" stroke="${colActive}" stroke-width="${s2Active ? 3 : 2}"/>
      <text x="260" y="64" text-anchor="middle" font-size="12" font-weight="800" fill="#1e1b4b">State H₂ᴬ</text>
      <text x="260" y="81" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#475569">m=${marginA2} | H=${entA2}</text>

      <!-- Baseline V2^A arrow -->
      <line x1="318" y1="70" x2="376" y2="70" stroke="${colActive}" stroke-width="2.5" marker-end="url(#arrIndigo)"/>
      <text x="347" y="61" text-anchor="middle" font-size="9" font-weight="700" fill="#4338ca">(1-β)V₂ᴬ</text>

      <!-- Returned state H3^{A'} -->
      <rect x="382" y="44" width="112" height="54" rx="10" fill="${s3Active ? '#ecfdf5' : '#fff'}" stroke="${colReturn}" stroke-width="${s3Active ? 3 : 2}"/>
      <text x="438" y="64" text-anchor="middle" font-size="12" font-weight="800" fill="#065f46">Return H₃ᴬ′</text>
      <text x="438" y="81" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#047857">${m === 'S0' ? 'Standard H₃ᴬ' : 'Excursion Merged'}</text>

      <line x1="494" y1="70" x2="532" y2="70" stroke="${colReturn}" stroke-width="2.5" marker-end="url(#arrEmerald)"/>
      <text x="513" y="61" text-anchor="middle" font-size="9" font-weight="700" fill="#059669">F_θ,3</text>

      <!-- Final Readout Node -->
      <rect x="538" y="42" width="116" height="58" rx="10" fill="${trace.is_correct ? '#ecfdf5' : '#fff1f2'}" stroke="${trace.is_correct ? '#059669' : '#e11d48'}" stroke-width="${s4Active ? 3 : 2}"/>
      <text x="596" y="62" text-anchor="middle" font-size="11" font-weight="800" fill="${trace.is_correct ? '#065f46' : '#9f1239'}">LM Head H₄ᴬ′</text>
      <text x="596" y="80" text-anchor="middle" font-size="11" font-family="JetBrains Mono,monospace" font-weight="800" fill="${trace.is_correct ? '#047857' : '#be123c'}">Pred: ${trace.extracted_answer || '--'} ${trace.is_correct ? '✓' : '✗'}</text>
      <text x="596" y="93" text-anchor="middle" font-size="8.5" font-family="JetBrains Mono,monospace" fill="#64748b">Gold: ${trace.gold_answer}</text>

      <!-- ================= MIDPOINT EXCURSION ZONE (CENTER RAIL) ================= -->
      <g opacity="${hasMidpointEval && !e2Skipped ? '1.0' : '0.32'}">
        <!-- Arrows from H2^A and H2^B into H2^visit -->
        <path d="M 245 96 L 245 126" stroke="${colVisit}" stroke-width="2" stroke-dasharray="4 2" marker-end="url(#arrViolet)"/>
        <path d="M 245 236 L 245 200" stroke="${colVisit}" stroke-width="2" stroke-dasharray="4 2" marker-end="url(#arrViolet)"/>

        <rect x="182" y="132" width="156" height="62" rx="11" fill="${s2Active ? '#f5f3ff' : '#fff'}" stroke="${colVisit}" stroke-width="${s2Active ? 3 : 2}"/>
        <text x="260" y="151" text-anchor="middle" font-size="11" font-weight="800" fill="#5b21b6">Midpoint H₂ᵛⁱˢⁱᵗ (α=${trace.alpha})</text>
        <text x="260" y="167" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#6d28d9">V₂ᵛⁱˢⁱᵗ = Lin + C₂</text>
        <text x="260" y="182" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" font-weight="700" fill="#4c1d95">||C₂||_F = ${curvFrob}</text>

        <!-- Return arrow from Midpoint to H3^{A'} -->
        <path d="M 338 162 Q 415 162 432 104" fill="none" stroke="${colReturn}" stroke-width="2.8" marker-end="url(#arrEmerald)"/>
        <rect x="355" y="130" width="96" height="22" rx="6" fill="#ecfdf5" stroke="#6ee7b7"/>
        <text x="403" y="145" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" font-weight="700" fill="#047857">+ β Ṽ₂ᵛⁱˢⁱᵗ (β=${trace.beta})</text>
      </g>

      <!-- ================= PERTURBED DONOR BRANCH B (BOTTOM RAIL) ================= -->
      <g opacity="${hasBranchB ? '1.0' : '0.28'}">
        <!-- Fork arrow at t=1 -->
        <path d="M 86 96 L 86 230" stroke="${colDonor}" stroke-width="2" stroke-dasharray="4 2" marker-end="url(#arrSky)"/>
        <rect x="38" y="148" width="96" height="22" rx="6" fill="#e0f2fe" stroke="#7dd3fc"/>
        <text x="86" y="163" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0369a1">+ε₁ (η=0.25, full)</text>

        <rect x="34" y="236" width="104" height="52" rx="10" fill="#fff" stroke="${colDonor}" stroke-width="${s1Active ? 3 : 2}"/>
        <text x="86" y="257" text-anchor="middle" font-size="12" font-weight="800" fill="#0c4a6e">Donor H₁ᴮ</text>
        <text x="86" y="274" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#0369a1">Perturbed Fork</text>

        <line x1="138" y1="262" x2="196" y2="262" stroke="${colDonor}" stroke-width="2.5" marker-end="url(#arrSky)"/>
        <text x="167" y="254" text-anchor="middle" font-size="9" font-weight="700" fill="#0284c7">F_θ,1</text>

        <rect x="202" y="236" width="116" height="52" rx="10" fill="#fff" stroke="${colDonor}" stroke-width="${s2Active ? 3 : 2}"/>
        <text x="260" y="256" text-anchor="middle" font-size="12" font-weight="800" fill="#0c4a6e">Donor H₂ᴮ</text>
        <text x="260" y="273" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#0369a1">RelDist=${relDist2}</text>

        <!-- Donor termination badge at t=3 for E1/E2 -->
        <rect x="378" y="242" width="124" height="40" rx="8" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4 2"/>
        <text x="440" y="259" text-anchor="middle" font-size="9.5" font-weight="700" fill="#475569">${m === 'P0' || m === 'P1' ? 'Donor Continues →' : 'Donor Terminated'}</text>
        <text x="440" y="273" text-anchor="middle" font-size="8.5" font-family="JetBrains Mono,monospace" fill="#64748b">${m === 'P0' || m === 'P1' ? `Ans B: ${trace.donor_b_answer || '--'}` : 'Saves t=3 Compute'}</text>
      </g>
    `;

    // Narrative text below SVG
    const narratives = {
      1: `<b>Step t = 1 (Branch Fork):</b> Primary trajectory $H_1^A$ clones a companion donor state $H_1^B = \\mathrm{Clip}(H_1^A + \\epsilon_1, \\tau{=}0.35)$ with full-sequence Gaussian noise ($\\eta=0.25$). Both states pass through the 24 shared decoder layers of $F_{\\theta,1}$.`,
      2: `<b>Step t = 2 (Cooperative Midpoint Excursion):</b> Branch divergence reaches $\\|H_2^A - H_2^B\\|_F / \\|H_2^A\\|_F = ${relDist2}$. Method <code>${m}</code> ${
        e2Skipped
          ? "detects high confidence on Branch A and skips the midpoint probe."
          : hasMidpointEval
          ? `evaluates $F_{\\theta,2}$ at midpoint $H_2^{\\mathrm{visit}}$, extracting nonlinear curvature $\\|C_2\\|_F = ${curvFrob}$ (${fmtNum(trace.curvature_relative * 100, 1)}% of midpoint velocity).`
          : "combines branch states without midpoint curvature evaluation."
      }`,
      3: `<b>Step t = 3 (Trust-Region Return):</b> Primary trajectory imports the norm-clipped midpoint update vector $\\tilde{V}_2^{\\mathrm{visit}}$ with weight $\\beta=${trace.beta}$, advancing to $H_3^{A'}$ (${trace.clipped ? "clipped" : "unclipped, within trust region"}). Donor branch $B$ is retired to save recurrent calls.`,
      4: `<b>Step t = 4 (Final Refinement & Readout):</b> $H_3^{A'}$ completes the final recurrent pass $F_{\\theta,3} \\to H_4^{A'}$ and decodes <code>${trace.extracted_answer}</code> (Gold: <code>${trace.gold_answer}</code>, $\\Delta \\log p(\\text{gold}) = ${fmtNum(trace.delta_gold_logprob, 4)}$ vs $S_0$).`,
    };
    $("stageStepNarrative").innerHTML = narratives[activeStep] || narratives[2];
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([$("stageStepNarrative")]).catch(() => {});
    }
  }

  function renderPcaSvg(trace, e1Trace) {
    const svg = $("pcaPlotSvg");
    if (!svg) return;

    const source = (trace.pca_coords && trace.pca_coords.B && trace.pca_coords.B.length) ? trace : (e1Trace || trace);
    const coordsA = (source.pca_coords && source.pca_coords.A) || [];
    const coordsB = (source.pca_coords && source.pca_coords.B) || [];
    const ev = source.pca_explained_variance || [];
    $("pcaVarLabel").textContent = ev.length >= 2
      ? `PC1 ${(ev[0] * 100).toFixed(1)}% · PC2 ${(ev[1] * 100).toFixed(1)}%`
      : "2D SVD Projection";

    const allPts = [...coordsA, ...coordsB];
    if (!allPts.length) {
      svg.innerHTML = `<text x="190" y="90" text-anchor="middle" font-size="11" fill="#64748b">No PCA points recorded</text>`;
      return;
    }

    const xs = allPts.map((p) => p[0]);
    const ys = allPts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = Math.max((maxX - minX) * 0.18, 1.0);
    const padY = Math.max((maxY - minY) * 0.22, 1.0);

    const W = 380;
    const H = 175;
    const mapX = (x) => 28 + ((x - (minX - padX)) / (maxX - minX + 2 * padX)) * (W - 56);
    const mapY = (y) => H - 24 - ((y - (minY - padY)) / (maxY - minY + 2 * padY)) * (H - 46);

    const pathStr = (pts) =>
      pts.map((p, i) => `${i === 0 ? "M" : "L"} ${mapX(p[0]).toFixed(1)} ${mapY(p[1]).toFixed(1)}`).join(" ");

    let midpointHtml = "";
    if (coordsA.length >= 2 && coordsB.length >= 2) {
      const mx = (mapX(coordsA[1][0]) + mapX(coordsB[1][0])) / 2;
      const my = (mapY(coordsA[1][1]) + mapY(coordsB[1][1])) / 2;
      const ax3 = coordsA[2] ? mapX(coordsA[2][0]) : mx;
      const ay3 = coordsA[2] ? mapY(coordsA[2][1]) : my;
      midpointHtml = `
        <line x1="${mapX(coordsA[1][0])}" y1="${mapY(coordsA[1][1])}" x2="${mapX(coordsB[1][0])}" y2="${mapY(coordsB[1][1])}" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="3 3"/>
        <line x1="${mx}" y1="${my}" x2="${ax3}" y2="${ay3}" stroke="#059669" stroke-width="2" stroke-dasharray="4 2"/>
        <circle cx="${mx}" cy="${my}" r="5.5" fill="#7c3aed" stroke="#fff" stroke-width="1.5"/>
        <text x="${mx + 7}" y="${my + 3}" font-size="8.5" font-weight="800" fill="#5b21b6">H₂ᵛⁱˢⁱᵗ</text>
      `;
    }

    const nodesHtml = (pts, color, prefix) =>
      pts
        .map((p, i) => {
          const cx = mapX(p[0]).toFixed(1);
          const cy = mapY(p[1]).toFixed(1);
          const isCurr = i + 1 === activeStep;
          return `
            <circle cx="${cx}" cy="${cy}" r="${isCurr ? 6.5 : 4.2}" fill="${color}" stroke="#fff" stroke-width="1.5"/>
            <text x="${Number(cx) + 6}" y="${Number(cy) - 5}" font-size="8.5" font-family="JetBrains Mono,monospace" font-weight="700" fill="${color}">${prefix}${i + 1}</text>
          `;
        })
        .join("");

    svg.innerHTML = `
      <line x1="20" y1="${H - 18}" x2="${W - 16}" y2="${H - 18}" stroke="#e2e8f0" stroke-width="1"/>
      <line x1="24" y1="12" x2="24" y2="${H - 14}" stroke="#e2e8f0" stroke-width="1"/>
      ${coordsB.length ? `<path d="${pathStr(coordsB)}" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-dasharray="4 2"/>` : ""}
      ${coordsA.length ? `<path d="${pathStr(coordsA)}" fill="none" stroke="#4338ca" stroke-width="2.5"/>` : ""}
      ${midpointHtml}
      ${nodesHtml(coordsB, "#0284c7", "B")}
      ${nodesHtml(coordsA, "#4338ca", "A")}
    `;
  }

  function renderTelemetryGrid(trace, snap, snap2) {
    const grid = $("telemetryGrid");
    if (!grid) return;
    $("telemetryStepTag").textContent = `Step t = ${activeStep} (${trace.method})`;

    const rmsA = snap.branch_rms && snap.branch_rms.A !== undefined ? fmtNum(snap.branch_rms.A, 4) : fmtNum(trace.post_rms_a, 4);
    const entA = snap.branch_entropy && snap.branch_entropy.A !== undefined ? fmtNum(snap.branch_entropy.A, 3) : fmtNum(trace.first_token_entropy, 3);
    const marA = snap.branch_margin && snap.branch_margin.A !== undefined ? fmtNum(snap.branch_margin.A, 3) : fmtNum(trace.first_token_margin, 3);
    const relDist = snap.ab_relative_distance !== null && snap.ab_relative_distance !== undefined
      ? fmtNum(snap.ab_relative_distance, 4)
      : fmtNum(trace.branch_relative_distance, 4);
    const cosSim = snap.ab_cosine_similarity !== null && snap.ab_cosine_similarity !== undefined
      ? fmtNum(snap.ab_cosine_similarity, 4)
      : fmtNum(trace.branch_cosine_similarity, 4);

    const items = [
      { k: `Branch A Entropy (t=${activeStep})`, v: entA },
      { k: `Branch A Margin (t=${activeStep})`, v: marA },
      { k: "A–B Relative Distance", v: relDist },
      { k: "A–B Cosine Similarity", v: cosSim },
      { k: "Midpoint Curvature ||C₂||_F", v: fmtNum(trace.curvature_frob, 2) },
      { k: "Δ Gold Log-Prob vs S0", v: fmtNum(trace.delta_gold_logprob, 4) },
    ];

    grid.innerHTML = items
      .map(
        (it) => `
      <div class="t-kv">
        <div class="k">${it.k}</div>
        <div class="v">${it.v}</div>
      </div>`
      )
      .join("");
  }

  function renderTerminalComparison(methodsObj, trace, s0Trace) {
    $("terminalCallCost").textContent = `Recurrent Block Calls: ${trace.recurrent_block_calls} · Wall Time: ${fmtNum(trace.wall_time_ms, 0)} ms`;
    const statusHtml = trace.is_correct
      ? `<span style="color:#34d399; font-weight:800;">✓ CORRECT</span>`
      : `<span style="color:#fda4af; font-weight:800;">✗ INCORRECT</span>`;

    $("terminalMainText").innerHTML = `
      <div><b>Active Method [${trace.method}]:</b> Decoded = <code>${JSON.stringify(trace.decoded_text)}</code> &rarr; Extracted = <b>${trace.extracted_answer}</b> (Gold = <b>${trace.gold_answer}</b>) ${statusHtml}</div>
      <div style="font-size:0.78rem; color:#94a3b8; margin-top:0.25rem;">
        Policy Action: <code>${trace.policy_action}</code> (${trace.policy_reason || "n/a"}) &middot;
        Gold LogProb: <code>${fmtNum(trace.gold_logprob, 4)}</code> (S0: <code>${fmtNum(s0Trace.gold_logprob, 4)}</code>, &Delta; = <code>${fmtNum(trace.delta_gold_logprob, 4)}</code>)
      </div>
    `;

    const order = ["S0", "S1", "P0", "P1", "M0", "M1", "C0", "R0", "E0", "E1_no_curv", "E1_rand_curv", "E1", "E2"];
    const badgesBar = $("terminalMethodBadges");
    badgesBar.innerHTML = order
      .filter((m) => methodsObj[m])
      .map((m) => {
        const r = methodsObj[m];
        const cls = r.is_correct ? "pass" : "fail";
        const activeCls = m === trace.method ? "active-method" : "";
        return `<span class="m-chip ${cls} ${activeCls}" style="cursor:pointer;" data-method="${m}" title="Click to inspect ${m}">
          ${m}: ${r.extracted_answer} ${r.is_correct ? "✓" : "✗"}
        </span>`;
      })
      .join("");

    badgesBar.querySelectorAll(".m-chip").forEach((el) => {
      el.addEventListener("click", () => {
        activeMethod = el.getAttribute("data-method");
        $("methodSelect").value = activeMethod;
        renderStage();
      });
    });
  }

  /* ============================================================
   * 3. POPULATE EMPIRICAL TABLES & PARETO CHART
   * ============================================================ */
  function renderResultsTables() {
    // 1. Phase 4 Test Table
    const p4 = FINAL.runs && FINAL.runs.phase4_adaptive;
    if (p4 && p4.rescue_matrix && $("phase4TestTable")) {
      const methods = p4.rescue_matrix.methods;
      const order = ["S0", "S1", "P0", "P1", "M1", "E1", "E2"];
      const names = {
        S0: "S0 — Single Trajectory (4 UT steps)",
        S1: "S1 — Extra Recurrent Depth (5 UT steps)",
        P0: "P0 — Parallel 2-Branch Confidence Vote",
        P1: "P1 — Oracle Best-of-2 Selection (Upper Bound)",
        M1: "M1 — Linear Update Mixing (Curvature C₂ = 0)",
        E1: "E1 — Fixed TEBDİL Excursion (α=0.5, β=0.5)",
        E2: "E2 — Adaptive TEBDİL Excursion (Label-Free Trigger)",
      };
      $("phase4TestTable").innerHTML = `
        <thead>
          <tr>
            <th>Method</th>
            <th>Accuracy</th>
            <th>Paired Δ vs S0</th>
            <th>95% Bootstrap CI</th>
            <th>Rescued</th>
            <th>Degraded</th>
            <th>Mean ||C₂||_F</th>
            <th>Δ Gold LogProb</th>
            <th>Recurrent Calls</th>
          </tr>
        </thead>
        <tbody>
          ${order
            .filter((k) => methods[k])
            .map((k) => {
              const m = methods[k];
              const isOurs = k === "E1" || k === "E2";
              const diffCls = m.paired_accuracy_diff > 0 ? "delta-up" : m.paired_accuracy_diff < 0 ? "delta-down" : "";
              return `
                <tr class="${isOurs ? "row-ours" : ""}">
                  <td><b>${names[k] || k}</b></td>
                  <td><b>${fmtPct(m.accuracy)}</b></td>
                  <td class="${diffCls}">${fmtSignedPct(m.paired_accuracy_diff)}</td>
                  <td>[${fmtSignedPct(m.ci_95_low)}, ${fmtSignedPct(m.ci_95_high)}]</td>
                  <td>${m.rescued_count} / ${m.base_wrong_count} (${fmtPct(m.rescue_rate)})</td>
                  <td>${m.degraded_count} / ${m.base_correct_count} (${fmtPct(m.degradation_rate)})</td>
                  <td>${fmtNum(m.mean_curvature_frob, 2)}</td>
                  <td>${fmtNum(m.mean_delta_gold_logprob, 4)}</td>
                  <td>${fmtNum(m.mean_recurrent_calls, 2)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      `;

      // Family Breakdown Table
      const byFam = p4.rescue_matrix.by_family || {};
      if ($("familyBreakdownTable")) {
        $("familyBreakdownTable").innerHTML = `
          <thead>
            <tr>
              <th>Method</th>
              <th>Arithmetic (n=12)</th>
              <th>2-SAT Logic (n=12)</th>
              <th>Shortest Path (n=12)</th>
              <th>Overall (n=36)</th>
            </tr>
          </thead>
          <tbody>
            ${order
              .filter((k) => methods[k])
              .map((k) => {
                const isOurs = k === "E1" || k === "E2";
                const ar = byFam.arithmetic && byFam.arithmetic[k] ? fmtPct(byFam.arithmetic[k].accuracy) : "--";
                const lg = byFam.logic && byFam.logic[k] ? fmtPct(byFam.logic[k].accuracy) : "--";
                const gr = byFam.graph && byFam.graph[k] ? fmtPct(byFam.graph[k].accuracy) : "--";
                return `
                  <tr class="${isOurs ? "row-ours" : ""}">
                    <td><b>${k}</b></td>
                    <td>${ar}</td>
                    <td>${lg}</td>
                    <td>${gr}</td>
                    <td><b>${fmtPct(methods[k].accuracy)}</b></td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        `;
      }

      // Pareto Chart SVG
      renderParetoSvg(p4.pareto_frontier && p4.pareto_frontier.points);
    }

    // 2. Phase 3 Validation Table (12 Methods)
    const p3 = FINAL.runs && FINAL.runs.phase3_ablations;
    if (p3 && p3.rescue_matrix && $("phase3ValidationTable")) {
      const methods = p3.rescue_matrix.methods;
      const order = ["S0", "S1", "P0", "P1", "M0", "M1", "C0", "R0", "E0", "E1_no_curv", "E1_rand_curv", "E1"];
      $("phase3ValidationTable").innerHTML = `
        <thead>
          <tr>
            <th>Method</th>
            <th>Accuracy (n=18)</th>
            <th>Paired Δ vs S0</th>
            <th>Rescued</th>
            <th>Degraded</th>
            <th>Net Rescue</th>
            <th>Mean ||C₂||_F</th>
            <th>Δ Gold LogProb</th>
            <th>Calls</th>
          </tr>
        </thead>
        <tbody>
          ${order
            .filter((k) => methods[k])
            .map((k) => {
              const m = methods[k];
              const isOurs = k === "E1";
              const net = m.rescued_count - m.degraded_count;
              const netStr = net > 0 ? `+${net}` : `${net}`;
              return `
                <tr class="${isOurs ? "row-ours" : ""}">
                  <td><b>${k}</b></td>
                  <td><b>${fmtPct(m.accuracy)}</b></td>
                  <td class="${m.paired_accuracy_diff > 0 ? "delta-up" : m.paired_accuracy_diff < 0 ? "delta-down" : ""}">${fmtSignedPct(m.paired_accuracy_diff)}</td>
                  <td>${m.rescued_count} / ${m.base_wrong_count}</td>
                  <td>${m.degraded_count} / ${m.base_correct_count}</td>
                  <td><b>${netStr}</b></td>
                  <td>${fmtNum(m.mean_curvature_frob, 2)}</td>
                  <td>${fmtNum(m.mean_delta_gold_logprob, 4)}</td>
                  <td>${fmtNum(m.mean_recurrent_calls, 2)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      `;
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([$("dimAblationTable")]).catch(() => {});
      }
    }
  }

  function renderParetoSvg(points) {
    const svg = $("paretoChartSvg");
    if (!svg || !points || !points.length) return;

    const W = 440;
    const H = 250;
    const padL = 54;
    const padR = 30;
    const padT = 24;
    const padB = 38;

    const mapX = (calls) => padL + ((calls - 6.5) / (15.8 - 6.5)) * (W - padL - padR);
    const mapY = (acc) => H - padB - ((acc - 0.19) / (0.305 - 0.19)) * (H - padT - padB);

    // Pareto frontier line: S0 -> M1 -> E2
    const pS0 = points.find((p) => p.method === "S0");
    const pM1 = points.find((p) => p.method === "M1");
    const pE2 = points.find((p) => p.method === "E2");
    const frontierPts = [pS0, pM1, pE2].filter(Boolean);
    const frontierPath = frontierPts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${mapX(p.mean_recurrent_calls).toFixed(1)} ${mapY(p.accuracy).toFixed(1)}`)
      .join(" ");

    const yTicks = [0.20, 0.2222, 0.25, 0.2778, 0.30];
    const xTicks = [7.33, 9.33, 12.83, 14.03, 14.67];

    const offsets = {
      S0: { dx: 8, dy: -8 },
      S1: { dx: 8, dy: 14 },
      P0: { dx: -26, dy: 16 },
      P1: { dx: -28, dy: -10 },
      M1: { dx: 8, dy: 12 },
      E2: { dx: -32, dy: -10 },
      E1: { dx: 8, dy: -10 },
    };

    svg.innerHTML = `
      <rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="#f8fafc" stroke="#e2e8f0"/>
      ${yTicks
        .map((y) => {
          const py = mapY(y).toFixed(1);
          return `
            <line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="#e2e8f0" stroke-dasharray="3 3"/>
            <text x="${padL - 6}" y="${Number(py) + 3}" text-anchor="end" font-size="9" font-family="JetBrains Mono,monospace" fill="#64748b">${(y * 100).toFixed(1)}%</text>
          `;
        })
        .join("")}
      ${xTicks
        .map((x) => {
          const px = mapX(x).toFixed(1);
          return `
            <line x1="${px}" y1="${padT}" x2="${px}" y2="${H - padB}" stroke="#f1f5f9"/>
            <text x="${px}" y="${H - padB + 14}" text-anchor="middle" font-size="8.5" font-family="JetBrains Mono,monospace" fill="#64748b">${x}</text>
          `;
        })
        .join("")}
      <text x="${(padL + W - padR) / 2}" y="${H - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="#334155">Mean Recurrent Block Calls per Instance</text>

      <path d="${frontierPath}" fill="none" stroke="#4338ca" stroke-width="2.5" stroke-dasharray="5 3"/>

      ${points
        .map((p) => {
          const cx = mapX(p.mean_recurrent_calls).toFixed(1);
          const cy = mapY(p.accuracy).toFixed(1);
          const isOurs = p.method === "E1" || p.method === "E2";
          const color = isOurs ? "#059669" : p.is_oracle ? "#f59e0b" : "#4338ca";
          const off = offsets[p.method] || { dx: 7, dy: -7 };
          return `
            <circle cx="${cx}" cy="${cy}" r="${isOurs ? 6.5 : 5}" fill="${color}" stroke="#fff" stroke-width="1.8"/>
            <text x="${Number(cx) + off.dx}" y="${Number(cy) + off.dy}" font-size="10" font-family="JetBrains Mono,monospace" font-weight="800" fill="${color}">${p.method}</text>
          `;
        })
        .join("")}
    `;
  }

  /* ============================================================
   * 4. PHASE 1 HEATMAP & PHASE 3 DIMENSION ABLATIONS
   * ============================================================ */
  function initGridAndAblations() {
    const sel = $("gridMetricSelect");
    if (sel) {
      sel.addEventListener("change", () => renderHeatmap(sel.value));
      renderHeatmap(sel.value);
    }

    if ($("dimAblationTable") && DIM_ABL.length) {
      $("dimAblationTable").innerHTML = `
        <thead>
          <tr>
            <th>Visit Step $t_{\\mathrm{visit}}$</th>
            <th>Token Perturbation Scope</th>
            <th>Mean $\\|C_t\\|_F$</th>
            <th>Subset Accuracy</th>
          </tr>
        </thead>
        <tbody>
          ${DIM_ABL.map((row) => {
            const isBest = row.visit_step === 2 && row.token_scope === "full";
            return `
              <tr class="${isBest ? "row-ours" : ""}">
                <td><b>Step $t = ${row.visit_step}$</b></td>
                <td><code>${row.token_scope}</code></td>
                <td>${fmtNum(row.mean_curvature_frob, 2)}</td>
                <td><b>${fmtPct(row.accuracy)}</b></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      `;
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([$("dimAblationTable")]).catch(() => {});
      }
    }
  }

  function renderHeatmap(metricKey) {
    const container = $("alphaBetaHeatmap");
    if (!container || !GRID.length) return;

    const alphas = [0.0, 0.25, 0.5, 0.75, 1.0];
    const betas = [0.0, 0.25, 0.5, 1.0];
    const vals = GRID.map((g) => Number(g[metricKey]) || 0);
    const maxV = Math.max(...vals.map(Math.abs), 1e-6);

    let html = `<div class="hm-head">α \\ β</div>`;
    betas.forEach((b) => {
      html += `<div class="hm-head">β = ${b.toFixed(2)}</div>`;
    });

    alphas.forEach((a) => {
      html += `<div class="hm-head">α = ${a.toFixed(2)}</div>`;
      betas.forEach((b) => {
        const cell = GRID.find((g) => g.alpha === a && g.beta === b) || {};
        const v = Number(cell[metricKey]) || 0;
        const ratio = Math.min(Math.abs(v) / maxV, 1);
        const bg =
          v === 0
            ? "#f8fafc"
            : v > 0
            ? `rgba(67, 56, 202, ${(0.1 + 0.72 * ratio).toFixed(2)})`
            : `rgba(225, 29, 72, ${(0.1 + 0.65 * ratio).toFixed(2)})`;
        const fg = ratio > 0.52 && v !== 0 ? "#ffffff" : "#0f172a";
        const digits = metricKey === "mean_curvature_frob" ? 2 : 4;
        html += `<div class="hm-cell" style="background:${bg}; color:${fg};" title="α=${a}, β=${b}: ${v.toFixed(6)}">${v.toFixed(digits)}</div>`;
      });
    });

    container.innerHTML = html;
  }

  /* ============================================================
   * 5. INTERACTIVE TRACE EXPLORER
   * ============================================================ */
  function initTraceExplorer() {
    const splitSel = $("explorerSplitFilter");
    const famSel = $("explorerFamilyFilter");
    const methSel = $("explorerMethodFilter");
    if (!splitSel || !famSel || !methSel) return;

    const update = () => {
      const splitKey = splitSel.value;
      const fam = famSel.value;
      const meth = methSel.value;
      const src = splitKey === "test_phase4" ? TRACES_TEST : TRACES_VAL;

      const filtered = src.filter((r) => {
        if (fam !== "all" && r.family !== fam) return false;
        if (meth !== "all" && r.method !== meth) return false;
        return true;
      });

      $("explorerCountBadge").textContent = `Showing ${filtered.length} of ${src.length} trace records`;
      const tbody = $("traceExplorerBody");
      tbody.innerHTML = filtered
        .map((r) => {
          const s0 = (traceIndex.get(`${splitKey}|${r.problem_id}|${r.seed}`) || {}).S0;
          let statusBadge = r.is_correct
            ? `<span style="color:#059669; font-weight:700;">✓ Correct</span>`
            : `<span style="color:#94a3b8;">✗ Wrong</span>`;
          if (s0 && !s0.is_correct && r.is_correct) {
            statusBadge = `<span style="background:#ecfdf5; color:#047857; padding:0.15rem 0.45rem; border-radius:6px; font-weight:800;">★ RESCUED</span>`;
          } else if (s0 && s0.is_correct && !r.is_correct) {
            statusBadge = `<span style="background:#fff1f2; color:#be123c; padding:0.15rem 0.45rem; border-radius:6px; font-weight:800;">⚠ DEGRADED</span>`;
          }
          return `
            <tr>
              <td><code>${r.problem_id}</code></td>
              <td>${r.family}</td>
              <td>${r.seed}</td>
              <td><b>${r.method}</b></td>
              <td><b>${r.gold_answer}</b></td>
              <td><code>${r.extracted_answer}</code></td>
              <td>${statusBadge}</td>
              <td>${fmtNum(r.curvature_frob, 2)}</td>
              <td>${fmtNum(r.delta_gold_logprob, 4)}</td>
              <td>${r.recurrent_block_calls}</td>
              <td>
                <button type="button" class="stage-btn load-trace-btn" style="padding:0.25rem 0.55rem; font-size:0.74rem;"
                  data-key="${splitKey}|${r.problem_id}|${r.seed}" data-method="${r.method}">
                  Inspect &uarr;
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      tbody.querySelectorAll(".load-trace-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeProblemKey = btn.getAttribute("data-key");
          activeMethod = btn.getAttribute("data-method");
          $("caseSelect").value = activeProblemKey;
          syncMethodDropdown();
          $("methodSelect").value = activeMethod;
          renderStage();
          document.getElementById("demo").scrollIntoView({ behavior: "smooth" });
        });
      });
    };

    splitSel.addEventListener("change", update);
    famSel.addEventListener("change", update);
    methSel.addEventListener("change", update);
    update();
  }

  /* ============================================================
   * 6. TOC NAVIGATION & BIBTEX COPY
   * ============================================================ */
  function initTocAndUtilities() {
    const tocRail = $("tocRail");
    const tocToggle = $("tocToggle");
    if (tocToggle && tocRail) {
      tocToggle.addEventListener("click", () => {
        const collapsed = tocRail.classList.toggle("is-collapsed");
        tocToggle.setAttribute("aria-expanded", String(!collapsed));
      });
    }

    const links = Array.from(document.querySelectorAll(".toc-link[href^='#']"));
    const sections = links.map((l) => document.querySelector(l.getAttribute("href"))).filter(Boolean);
    if ("IntersectionObserver" in window && sections.length) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === "#" + entry.target.id));
            }
          });
        },
        { rootMargin: "-25% 0px -60% 0px", threshold: 0.01 }
      );
      sections.forEach((s) => io.observe(s));
    }

    const copyBtn = $("copyBibBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const text = $("bibtexCode").textContent;
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.innerHTML = `<i class="fas fa-check"></i>&nbsp;Copied!`;
          setTimeout(() => {
            copyBtn.innerHTML = `<i class="fas fa-copy"></i>&nbsp;Copy`;
          }, 1800);
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initStageControls();
    renderResultsTables();
    initGridAndAblations();
    initTraceExplorer();
    initTocAndUtilities();
  });
})();
