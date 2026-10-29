// Browser easy-scenario port of environment.py + default V2 scoring. No benchmark writes.
export const FT = 0.3048;
const rad = n => n * Math.PI / 180;
const deg = n => n * 180 / Math.PI;
const round = (n, digits = 4) => Number(n.toFixed(digits));
const wrap = n => ((n + 180) % 360 + 360) % 360 - 180;
const clip = (n, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));
export const AXES = ['aileron', 'elevator', 'rudder', 'throttle'];

export function validateControl(command) {
  if (!command || Object.keys(command).sort().join() !== [...AXES].sort().join() ||
      AXES.some(k => !Number.isFinite(command[k]) || command[k] > 1 ||
        command[k] < (k === 'throttle' ? 0 : -1))) throw Error('Invalid four-channel command');
  return command;
}

export function baseline(o, trim) {
  const r = o.runway, f = o.flight;
  const command = {
    aileron: clip(trim.aileron - .015 * r.centerline_offset_m - .025 * r.heading_error_deg -
      .08 * f.roll_deg - .3 * f.p_rad_s),
    elevator: clip(trim.elevator + .10 * r.glideslope_error_deg + .08 * (f.vertical_speed_mps + 1.5) +
      .04 * (f.pitch_deg - 3) - .2 * f.q_rad_s),
    rudder: clip(trim.rudder + .03 * r.heading_error_deg - .04 * f.beta_deg - .15 * f.r_rad_s),
    throttle: clip(.5 + .05 * (30 - f.airspeed_mps), 0, 1),
  };
  if (r.altitude_agl_m < 20) {
    command.elevator = clip(-.05 + .15 * (f.vertical_speed_mps + .8));
    command.throttle = clip(command.throttle - .25, 0, .25);
  }
  return command;
}

export function touchdownSafe(t, c) {
  return Boolean(t && t.along_track_m >= 0 && t.along_track_m <= c.runway_length_m &&
    Math.abs(t.cross_track_m) <= c.runway_width_m / 2 && Math.abs(t.sink_rate_mps) <= c.max_sink_mps &&
    Math.abs(t.roll_deg) <= c.max_bank_deg && Math.abs(t.heading_error_deg) <= c.max_heading_deg &&
    t.airspeed_mps >= c.min_airspeed_mps && t.airspeed_mps <= c.max_airspeed_mps);
}

export function evaluate(t, success, reason, c, trajectory) {
  if (c.version !== 'v2') throw Error('Browser runtime requires default V2 scoring');
  const safe = touchdownSafe(t, c);
  success = Boolean(success && safe);
  const lateral = trajectory.lateral / c.reference_duration_s;
  const pitch = trajectory.pitch / c.reference_duration_s;
  const glide = trajectory.glide / c.reference_duration_s;
  const touchdown = t ? .50 * (Math.abs(t.sink_rate_mps) / c.touchdown_sink_normalization_mps) ** 2 +
    .25 * (Math.abs(t.cross_track_m) / c.touchdown_lateral_normalization_m) ** 2 +
    .25 * (Math.abs(t.along_track_m - c.touchdown_target_m) / c.touchdown_longitudinal_normalization_m) ** 2 : 0;
  const total = .30 * lateral + .25 * pitch + .20 * glide + .25 * touchdown;
  const quality = 100 * Math.exp(-total);
  return {success, quality: round(success ? quality : 0, 3), raw_quality: round(quality, 3), reason,
    touchdown: t, touchdown_safe: safe, scoring_version: c.version, scoring: c,
    components: {lateral_error: lateral, pitch_error: pitch, glide_error: glide,
      touchdown_error: touchdown, total_error: total}, trajectory_error_integrals: {...trajectory}};
}

export class Landing {
  constructor(module, contract, maxTime = 120) {
    this.contract = contract;
    this.hz = contract.physics_hz;
    this.c = contract.scoring;
    this.maxTime = maxTime;
    this.f = new module.FGFDMExec();
    const f = this.f;
    f.SetDebugLevel(0);
    f.DisableOutput();
    f.SetRootDir('/data');
    f.SetAircraftPath('aircraft'); f.SetEnginePath('engine'); f.SetSystemsPath('systems');
    if (!f.LoadModel('c172x', true)) throw Error('C172x model unavailable');
    f.Setdt(1 / this.hz);
    for (const [key, value] of Object.entries(contract.initial)) f.SetPropertyValue(key, value);
    if (!f.RunIC()) throw Error('JSBSim initial conditions failed');
    f.SetPropertyValue('propulsion/set-running', -1);
    this.control = {...contract.trim};
    for (const k of AXES) f.SetPropertyValue(`fcs/${k}-cmd-norm`, this.control[k]);
    this.ticks = 0; this.done = false; this.reason = 'running'; this.success = false;
    this.touchdown = null; this.trajectory = {lateral: 0, pitch: 0, glide: 0};
    this.observation = this.observe();
    this.history = [this.observation];
  }
  observe() {
    const g = k => this.f.GetPropertyValue(k);
    const x = -1500 + g('position/from-start-neu-e-ft') * FT;
    const z = -g('position/from-start-neu-n-ft') * FT;
    const h = g('position/h-agl-ft') * FT;
    const heading = g('attitude/psi-deg');
    const ground = Boolean(g('gear/wow'));
    const speed = Math.hypot(g('velocities/v-north-fps'), g('velocities/v-east-fps')) * FT;
    const phase = ground ? (speed < 3 ? 'STOPPED' : this.touchdown ? 'ROLLOUT' : 'MAIN-GEAR TOUCHDOWN') : 'AIRBORNE / APPROACH';
    return {
      time_s: this.ticks / this.hz, decision_dt_s: .5, phase,
      runway: {distance_to_threshold_m: Math.max(0, -x), along_track_m: x,
        cross_track_error_m: round(z > 5 ? z - 5 : z < -5 ? z + 5 : 0),
        centerline_offset_m: round(z), runway_width_m: this.c.runway_width_m, altitude_agl_m: h,
        glideslope_error_deg: deg(Math.atan2(h - 15, Math.max(1, -x))) - 3,
        heading_error_deg: wrap(heading - 90)},
      flight: {airspeed_mps: g('velocities/vc-fps') * FT, groundspeed_mps: speed,
        vertical_speed_mps: g('velocities/h-dot-fps') * FT, flight_path_angle_deg: g('flight-path/gamma-deg'),
        angle_of_attack_deg: g('aero/alpha-deg'), alpha_deg: g('aero/alpha-deg'),
        roll_deg: g('attitude/phi-deg'), pitch_deg: g('attitude/theta-deg'), heading_deg: heading,
        p_rad_s: g('velocities/p-rad_sec'), q_rad_s: g('velocities/q-rad_sec'), r_rad_s: g('velocities/r-rad_sec'), beta_deg: g('aero/beta-deg')},
      environment: {headwind_mps: 0, crosswind_mps: 0},
      controls: Object.fromEntries([...AXES.map(k => [k, g(`fcs/${k}-cmd-norm`)]), ['flaps_deg', g('fcs/flap-pos-deg')]]),
      status: {on_ground: ground, main_gear_on_ground: Boolean(g('gear/unit[1]/WOW') || g('gear/unit[2]/WOW'))},
      ground_contact: {any_gear_wow: ground, nose_gear_wow: Boolean(g('gear/unit[0]/WOW')),
        left_main_gear_wow: Boolean(g('gear/unit[1]/WOW')), right_main_gear_wow: Boolean(g('gear/unit[2]/WOW'))},
    };
  }
  advance(command, ticks = 1) {
    if (this.done) throw Error('Episode ended; reset before stepping');
    if (!Number.isInteger(ticks) || ticks < 1) throw Error('Invalid tick count');
    this.control = {...validateControl(command)};
    for (const k of AXES) this.f.SetPropertyValue(`fcs/${k}-cmd-norm`, command[k]);
    for (let i = 0; i < ticks && !this.done; i++) {
      const previous = this.observation;
      if (this.touchdown) {
        this.f.SetPropertyValue('fcs/throttle-cmd-norm', 0);
        this.f.SetPropertyValue('fcs/left-brake-cmd-norm', .7);
        this.f.SetPropertyValue('fcs/right-brake-cmd-norm', .7);
        this.control.throttle = 0;
      }
      if (!this.f.Run()) {this.done = true; this.reason = 'simulation_failure'; break;}
      this.ticks++;
      const o = this.observe(), r = o.runway, f = o.flight;
      if (![...Object.values(r), ...Object.values(f)].every(Number.isFinite)) {
        this.done = true; this.reason = 'nonfinite_state'; break;
      }
      this.observation = o;
      if (!this.touchdown) {
        const limit = r.altitude_agl_m <= this.c.flare_altitude_m ? this.c.flare_pitch_limit_deg : this.c.approach_pitch_limit_deg;
        const pitchExcess = Math.max(0, Math.abs(f.pitch_deg) - limit);
        const glide = r.altitude_agl_m > this.c.flare_altitude_m ?
          (r.altitude_agl_m - (15 + r.distance_to_threshold_m * Math.tan(rad(3)))) / this.c.glide_normalization_m : 0;
        this.trajectory.lateral += (r.centerline_offset_m / this.c.lateral_normalization_m) ** 2 / this.hz;
        this.trajectory.pitch += (.7 * (pitchExcess / this.c.pitch_excess_normalization_deg) ** 2 +
          .3 * (deg(f.q_rad_s) / this.c.pitch_rate_normalization_deg_s) ** 2) / this.hz;
        this.trajectory.glide += glide ** 2 / this.hz;
      }
      const end = reason => {this.done = true; this.reason = reason;};
      const lateral = r.centerline_offset_m;
      if (!this.touchdown && o.status.main_gear_on_ground) {
        this.touchdown = {along_track_m: r.along_track_m, cross_track_m: lateral,
          sink_rate_mps: previous.flight.vertical_speed_mps, airspeed_mps: previous.flight.airspeed_mps,
          heading_error_deg: r.heading_error_deg, roll_deg: f.roll_deg, pitch_deg: f.pitch_deg};
        if (!touchdownSafe(this.touchdown, this.c)) end('unsafe_touchdown');
      }
      if (Math.abs(f.roll_deg) > 70 || Math.abs(f.pitch_deg) > 45 || r.altitude_agl_m < 0) end('crash');
      if (this.touchdown) {
        if (r.along_track_m < 0 || r.along_track_m > this.c.runway_length_m || Math.abs(lateral) > this.c.runway_width_m / 2) end('runway_excursion');
        else if (o.status.on_ground && f.groundspeed_mps < 3 && !this.done) {end('landed'); this.success = true;}
      } else if (o.status.on_ground) end('nose_first_contact');
      if (Math.abs(lateral) > 500 || r.along_track_m > this.c.runway_length_m + 200) end('out_of_bounds');
      if (this.ticks / this.hz >= this.maxTime && !this.done) end('time_limit');
    }
    return this.observation;
  }
  decisionState() {
    const o = this.observation, now = o.time_s;
    const before = time => this.history.findLast(s => s.time_s <= time);
    const reference = before(now - .5) ?? this.history[0];
    const dt = Math.max(now - reference.time_s, 1e-6);
    const fields = [['flight', 'airspeed_mps', 'airspeed_rate_mps2'],
      ['flight', 'vertical_speed_mps', 'vertical_speed_rate_mps2'],
      ['runway', 'centerline_offset_m', 'cross_track_rate_mps'],
      ['runway', 'glideslope_error_deg', 'glideslope_error_rate_deg_s'],
      ['runway', 'heading_error_deg', 'heading_error_rate_deg_s'],
      ['flight', 'flight_path_angle_deg', 'flight_path_angle_rate_deg_s'],
      ['flight', 'angle_of_attack_deg', 'angle_of_attack_rate_deg_s']];
    const motion = Object.fromEntries(fields.map(([group, field, key]) => [key,
      round((field === 'heading_error_deg' ? wrap(o[group][field] - reference[group][field]) : o[group][field] - reference[group][field]) / dt)]));
    const closureRef = before(now - .5);
    motion.distance_closure_rate_mps = closureRef ? round(-(o.runway.distance_to_threshold_m - closureRef.runway.distance_to_threshold_m) / Math.max(now - closureRef.time_s, 1e-6)) : 0;
    const available = Math.max(now - this.history[0].time_s, 0);
    const window = available > .04 ? Math.min(.5, Math.max(.08, available / 2)) : .5;
    const r1 = before(now - window) ?? (this.history.length >= 2 ? this.history[0] : null);
    const r2 = r1 && (before(r1.time_s - window) ?? (this.history.length >= 3 ? this.history[0] : null));
    const dt01 = r1 && Math.max(now - r1.time_s, 1e-6), dt12 = r2 && Math.max(r1.time_s - r2.time_s, 1e-6);
    motion.cross_track_accel_mps2 = r2 && dt01 >= .02 && dt12 >= .02 ? round(
      ((o.runway.centerline_offset_m - r1.runway.centerline_offset_m) / dt01 -
        (r1.runway.centerline_offset_m - r2.runway.centerline_offset_m) / dt12) / (.5 * (dt01 + dt12))) : 0;
    return {flight: {...o.flight}, runway: {...o.runway}, current_controls: {...o.controls}, time_s: now,
      motion, status: {...o.status}, phase: o.status.on_ground ? 'ROLLOUT' : o.runway.altitude_agl_m < 20 ? 'FLARE' : 'APPROACH'};
  }
  remember() {this.history.push(this.observation); if (this.history.length > 240) this.history.shift();}
  result() {return evaluate(this.touchdown, this.success, this.reason, this.c, this.trajectory);}
  destroy() {this.f.delete();}
}

export async function loadRuntime(contract, options = {}) {
  const {default: create} = await import('./vendor/jsbsim_wasm.mjs');
  const module = await create({print() {}, printErr() {}, ...options});
  for (const [path, text] of Object.entries(contract.files)) {
    const target = `/data/${path}`;
    module.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
    module.FS.writeFile(target, text);
  }
  return module;
}
