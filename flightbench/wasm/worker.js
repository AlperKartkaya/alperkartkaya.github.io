import {Landing, baseline, loadRuntime, validateControl} from './engine.js';

const PROXY = 'https://flightbench-jev.alperkartkaya.workers.dev/decide';
let runtime, contract, landing, timer, mode, model, command, generation = 0;
let pending, runId, decisionInfo = null, decisionCount = 0, latencyMs = null;
const emit = type => postMessage({type, observation: landing.observation,
  result: landing.result(), done: landing.done, mode, run_id: runId,
  decision_count: decisionCount, decision_info: decisionInfo, latency_ms: latencyMs});
const stop = () => {generation++; clearTimeout(timer); pending?.abort();};

async function decision(run) {
  if (mode === 'baseline') {
    command = baseline(landing.observation, contract.trim); decisionCount++;
    decisionInfo = {controller: 'baseline', command: {...command}};
  }
  if (mode === 'jev') {
    const input = landing.decisionState(), started = performance.now();
    const phase = contract.action_space.phases[input.phase];
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(PROXY, {method: 'POST', cache: 'no-store', redirect: 'error',
        signal: controller.signal, headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...input, model})});
      if (!response.ok) throw Error(`Jev proxy HTTP ${response.status}; flight stopped`);
      const data = await response.json();
      if (data.model !== model) throw Error('Unexpected Jev model');
      validateControl(data.command);
      for (const axis of Object.keys(contract.trim)) {
        const action = phase[axis].actions.find(a => a.id === data.action_ids?.[axis]);
        if (!action || action.command !== data.command[axis]) throw Error('Invalid Jev action');
      }
      if (run !== generation) return;
      command = data.command;
      latencyMs = performance.now() - started; decisionCount++;
      const choices = Object.fromEntries(Object.keys(contract.trim).map(axis => {
        const actions = phase[axis].actions;
        const action = actions.find(a => a.id === data.action_ids[axis]);
        return [axis, {choice: action.id, command: action.command, label: action.criterion,
          confidence: null}];
      }));
      decisionInfo = {controller: 'jev', model: data.model, policy: 'direct-categorical',
        command: {...command}, choices, input, timing: {applied: true}};
    } finally {clearTimeout(timeout); if (pending === controller) pending = null;}
  }
}

async function tick(run) {
  try {
    if (run !== generation || landing.done) return;
    if (landing.ticks % 60 === 0) await decision(run);
    if (run !== generation) return;
    // 4 exact 1/120 s physics ticks; never change dt to catch up a delayed UI.
    landing.advance(command, 4);
    if (landing.ticks % 60 === 0 || landing.done) landing.remember();
    emit('state');
    if (landing.done) {stop(); return;}
    timer = setTimeout(() => tick(run), 1000 / 30);
  } catch (error) {
    if (run !== generation) return;
    stop(); postMessage({type: 'error', run_id: runId, message: error instanceof Error ? error.message : 'Physics failed'});
  }
}

onmessage = async ({data}) => {
  try {
    if (data.type === 'init') {
      const response = await fetch('./flightbench.json');
      if (!response.ok) throw Error('Missing aircraft assets; run prepare_wasm.py');
      contract = await response.json(); runtime = await loadRuntime(contract);
      postMessage({type: 'ready', versions: {python: contract.python_jsbsim, wasm: contract.wasm_jsbsim}});
    } else if (data.type === 'start') {
      stop(); landing?.destroy(); runId = data.run_id;
      decisionCount = 0; decisionInfo = null; latencyMs = null;
      mode = data.mode;
      if (!['human', 'baseline', 'jev'].includes(mode)) throw Error('Unknown mode');
      if (mode === 'jev') {
        model = data.model ?? 'jev-1.13.0';
        if (!['jev-1.13.0', 'jev-1.14.0'].includes(model)) throw Error('Unsupported Jev model');
      }
      landing = new Landing(runtime, contract); command = {...contract.trim};
      emit('state'); tick(generation);
    } else if (data.type === 'control' && mode === 'human') command = {...validateControl(data.command)};
    else if (data.type === 'stop') {stop(); postMessage({type: 'stopped', run_id: runId});}
  } catch (error) {stop(); postMessage({type: 'error', run_id: runId, message: error instanceof Error ? error.message : 'Physics failed'});}
};
