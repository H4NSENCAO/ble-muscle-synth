// Device setup & calibration: detection logic.
//
// Everything here is pure (no React) so the checks can be reasoned about and
// tuned in one place. The wizard UI lives in CalibrationWizard.jsx.

export const SENSOR_MAX = 1024;

// ---- Detection thresholds (raw ADC counts, 10-bit Arduino: 0..1023) ----
export const RAIL_HIGH = 1015;          // at/above this the sensor is pinned at the top
const RAIL_FRACTION = 0.6;              // this share of samples railed => "stuck at the top"
const SILENT_MAX = 3;                   // every sample at/below this => sensor reads nothing
const UNSTABLE_STD = 120;               // at rest, std above this => floating / electrode off
const UNSTABLE_SPREAD = 400;            // at rest, p95-p5 above this => floating / electrode off
const REST_STD_WARN = 25;
const REST_STD_FAIL = 60;
const REST_MEAN_HIGH = 600;
const FLEX_DELTA_FAIL = 40;             // flex must rise at least this far above rest
const FLEX_SNR_FAIL = 3;                // ...and this many rest-noise std's
const FLEX_DELTA_WEAK = 120;
export const MIN_RATE_HZ = 10;          // slower than this feels laggy

// ---- Sample buffer: every parsed reading with its arrival time ----
export class SampleBuffer {
  constructor(capacity = 4096) {
    this.t = new Float64Array(capacity);
    this.v = new Float32Array(capacity);
    this.capacity = capacity;
    this.head = 0;   // next write index
    this.size = 0;
  }

  push(time, value) {
    this.t[this.head] = time;
    this.v[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  clear() {
    this.head = 0;
    this.size = 0;
  }

  // Values with time in [from, to], oldest first.
  range(from, to = Infinity) {
    const out = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      const time = this.t[idx];
      if (time >= from && time <= to) out.push(this.v[idx]);
    }
    return out;
  }

  // {t, v} pairs since `from`, oldest first (for drawing).
  points(from) {
    const out = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      if (this.t[idx] >= from) out.push({ t: this.t[idx], v: this.v[idx] });
    }
    return out;
  }
}

export function createSerialStats() {
  return {
    bytes: 0,
    lines: 0,
    parsed: 0,
    unparsed: 0,
    lastByteAt: 0,
    lastLine: '',
    lastBadLine: '',
    recentText: '',
    readError: null,
  };
}

// ---- Small stats helpers ----
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

export function summarize(values, trim = 0) {
  const sorted = Float32Array.from(values).sort();
  const n = sorted.length;
  const cut = Math.floor(n * trim);
  const core = trim > 0 && n - 2 * cut >= 5 ? sorted.subarray(cut, n - cut) : sorted;
  let sum = 0;
  for (const x of core) sum += x;
  const mean = core.length ? sum / core.length : 0;
  let sq = 0;
  for (const x of core) sq += (x - mean) ** 2;
  const std = core.length ? Math.sqrt(sq / core.length) : 0;
  let railed = 0;
  for (const x of sorted) if (x >= RAIL_HIGH) railed++;
  return {
    n,
    mean,
    std,
    min: n ? sorted[0] : 0,
    max: n ? sorted[n - 1] : 0,
    p5: percentile(sorted, 0.05),
    p95: percentile(sorted, 0.95),
    railedFraction: n ? railed / n : 0,
  };
}

// Share of characters that are not printable ASCII / whitespace. A baud-rate
// mismatch decodes as mostly replacement characters and random high bytes.
export function garbageRatio(text) {
  if (!text) return 0;
  let bad = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const ok = (c >= 32 && c < 127) || c === 9 || c === 10 || c === 13;
    if (!ok) bad++;
  }
  return bad / text.length;
}

// ---- USB identification (purely informational) ----
const USB_VENDORS = {
  0x2341: 'Arduino',
  0x2a03: 'Arduino',
  0x1a86: 'CH340 USB-serial (Arduino clone)',
  0x0403: 'FTDI USB-serial',
  0x10c4: 'Silicon Labs CP210x USB-serial',
  0x239a: 'Adafruit board',
  0x2e8a: 'Raspberry Pi Pico',
  0x303a: 'Espressif ESP32',
};

export function describePort(info) {
  if (!info || info.usbVendorId == null) return 'USB serial device';
  const hex = (n) => n.toString(16).padStart(4, '0').toUpperCase();
  const name = USB_VENDORS[info.usbVendorId] || 'USB serial device';
  const pid = info.usbProductId != null ? `:${hex(info.usbProductId)}` : '';
  return `${name} (${hex(info.usbVendorId)}${pid})`;
}

// ---- Issue catalogue: what went wrong and how to fix it ----
export const ISSUES = {
  // Step 1: connection
  unsupported: {
    title: "This browser can't talk to USB devices",
    detail: 'Web Serial is not available here.',
    tips: ['Use the BLE Muscle Synth desktop app, or open this page in Chrome or Edge.'],
  },
  'not-selected': {
    title: 'No device was picked',
    detail: 'The port list was closed without choosing a device.',
    tips: [
      'Click Connect again and choose the entry that says Arduino, USB Serial, or a COM port.',
      'If the list was empty, push the USB cable in all the way.',
      'Try a different cable. Some cables only charge and cannot send data.',
      'Try another USB port on the computer.',
      'Clone boards may need the CH340 USB driver installed.',
    ],
  },
  busy: {
    title: 'Another program is using the device',
    detail: "The port was found but couldn't be opened.",
    tips: [
      'Close the Arduino IDE Serial Monitor or Serial Plotter.',
      'Close any other window or app that might be connected to the board.',
      'Unplug the USB cable, plug it back in, and click Connect again.',
    ],
  },
  blocked: {
    title: 'USB access is blocked here',
    detail: 'This page is not allowed to use USB devices.',
    tips: ['Run the BLE Muscle Synth desktop app, or a local copy of this project.'],
  },
  lost: {
    title: 'The device was disconnected',
    detail: 'We stopped hearing from the board. The cable may have come loose.',
    tips: [
      'Check the USB cable is plugged in at both ends.',
      'Click Connect to pick the device again.',
    ],
  },
  'usb-error': {
    title: 'USB error',
    detail: '',
    tips: [
      'Unplug the USB cable, plug it back in, and try again.',
      'Restart the app if it keeps happening.',
    ],
  },

  // Step 2: data stream
  'no-data': {
    title: "Connected, but the board isn't sending anything",
    detail: 'No bytes have arrived for 3 seconds.',
    tips: [
      "Check the board's power light is on.",
      'Make sure the EMG sketch is uploaded to the board.',
      "Press the board's RESET button.",
      'Unplug the USB cable, plug it back in, and reconnect.',
    ],
  },
  garbled: {
    title: 'The data is scrambled',
    detail: "The board is talking at a different speed (baud rate) than the app.",
    tips: [
      'In the Arduino sketch, set Serial.begin(9600);',
      'Upload the sketch again, then reconnect.',
    ],
  },
  format: {
    title: 'Messages arrive, but no sensor readings',
    detail: 'Each line should look like "Sensor: 512".',
    tips: [
      'In the sketch, print readings like this:  Serial.print("Sensor: "); Serial.println(analogRead(A0));',
      'Upload the sketch again, then reconnect.',
    ],
  },
  slow: {
    title: 'Readings are arriving slowly',
    detail: 'The music may feel laggy.',
    tips: ['Use a shorter delay() in the sketch loop (10 to 20 ms works well).'],
  },

  // Step 3: sensor hook-up
  silent: {
    title: 'The sensor reads zero',
    detail: "That's OK if the number jumps when you squeeze. We'll check that in the Squeeze step.",
    tips: [
      "Check the sensor's power wires: + to 5V, - to GND.",
      'Check the signal wire (SIG) goes to pin A0.',
      'If the sensor has a power switch, turn it on.',
    ],
  },
  railed: {
    title: 'The signal is stuck at the top',
    detail: 'The reading is pinned at its maximum (1023).',
    tips: [
      'Press all 3 electrode pads firmly onto clean, dry skin.',
      'Snap the sensor cable all the way onto each electrode.',
      "Turn the sensor's gain knob down a little.",
    ],
  },
  unstable: {
    title: 'The signal is jumping around a lot',
    detail: 'A relaxed arm should give a calm, steady reading.',
    tips: [
      'Press each electrode pad down firmly.',
      'Put the reference electrode (usually the black one) on the bony part of your elbow.',
      'Rest your arm on the table and keep it still.',
      'Move away from chargers and power cables.',
    ],
  },

  // Step 4: rest capture
  'no-samples': {
    title: 'No readings during the test',
    detail: 'The data stopped while we were measuring.',
    tips: ['Go back to the Data step and check the connection.'],
  },
  noisy: {
    title: 'Your resting signal is too wiggly',
    detail: "We can't tell resting apart from squeezing yet.",
    tips: [
      'Open your hand and let your arm go floppy on the table.',
      'Press each electrode pad down firmly.',
      'Put the reference electrode on the bony part of your elbow.',
      'Move away from chargers and power cables.',
    ],
  },
  jittery: {
    title: 'A little wiggly, but usable',
    detail: 'Pressing the pads down firmly will make it steadier.',
    tips: [],
  },
  'high-rest': {
    title: 'Your resting level is high',
    detail: 'Your muscle may not be fully relaxed.',
    tips: [
      'Open your hand and let your arm go floppy.',
      "If it stays high, turn the sensor's gain knob down a little.",
    ],
  },

  // Step 5: flex capture
  'no-response': {
    title: "We can't see your muscle squeezing",
    detail: 'The reading barely changed when you squeezed.',
    tips: [
      'Move pads 1 and 2 onto the fattest part of your forearm muscle (squeeze to feel where it bulges), in a line about 2 cm apart.',
      'Put pad 3 (reference) on the bony part of your elbow.',
      'Check the signal wire (SIG) goes to pin A0.',
      "Turn the sensor's gain knob up a little, and make a really tight fist!",
    ],
  },
  saturated: {
    title: 'Your squeeze maxed out the sensor',
    detail: "Super strong! We'll still use it.",
    tips: ["For finer control, turn the sensor's gain knob down a little and redo this step."],
  },
  weak: {
    title: 'The signal is a bit weak',
    detail: "We'll turn up the boost to make up for it.",
    tips: [
      'Move the signal electrodes onto the middle of the muscle for a stronger signal.',
      "Or turn the sensor's gain knob up a little.",
    ],
  },
};

export function classifyConnectionError(error) {
  const name = error?.name || '';
  const message = error?.message || String(error || '');
  if (name === 'SecurityError' || /permissions policy/i.test(message)) return { kind: 'blocked', message };
  if (name === 'NotFoundError') return { kind: 'not-selected', message };
  if (name === 'NetworkError' || /failed to open/i.test(message)) return { kind: 'busy', message };
  if (name === 'InvalidStateError' || /already open/i.test(message)) return { kind: 'busy', message };
  return { kind: 'usb-error', message };
}

// ---- Step checks ----

// Step 2: is a stream of "Sensor: N" lines arriving fast enough?
// `elapsedMs` is how long the check has been running.
export function assessDataStream({ now, elapsedMs, stats, buffer }) {
  const windowMs = Math.min(3000, Math.max(elapsedMs, 1));
  const recent = buffer.range(now - windowMs, now).length;
  const rate = recent / (windowMs / 1000);

  if (recent > 0) {
    if (elapsedMs < 1500) return { status: 'checking', rate };
    if (rate >= MIN_RATE_HZ) return { status: 'pass', rate };
    if (elapsedMs < 3000) return { status: 'checking', rate };
    return { status: 'warn', issue: 'slow', rate };
  }
  if (elapsedMs < 3000) return { status: 'checking', rate: 0 };
  if (!stats.lastByteAt || now - stats.lastByteAt > 3000) return { status: 'fail', issue: 'no-data', rate: 0 };
  if (garbageRatio(stats.recentText) > 0.2) return { status: 'fail', issue: 'garbled', rate: 0 };
  return { status: 'fail', issue: 'format', rate: 0 };
}

// Step 3: with the arm relaxed, does the signal look like a sensor on skin?
export function assessHookup(values) {
  const s = summarize(values);
  if (s.n < 8) return { status: 'checking', stats: s };
  if (s.railedFraction >= RAIL_FRACTION) return { status: 'fail', issue: 'railed', stats: s };
  if (s.max <= SILENT_MAX) return { status: 'warn', issue: 'silent', stats: s };
  if (s.std > UNSTABLE_STD || s.p95 - s.p5 > UNSTABLE_SPREAD) return { status: 'fail', issue: 'unstable', stats: s };
  return { status: 'pass', stats: s };
}

// Step 4: resting baseline. Trims the extremes so one twitch doesn't spoil it.
export function assessRest(values) {
  const s = summarize(values, 0.05);
  if (s.n < 10) return { status: 'fail', issue: 'no-samples', stats: s };
  if (s.railedFraction >= RAIL_FRACTION) return { status: 'fail', issue: 'railed', stats: s };
  if (s.std > REST_STD_FAIL) return { status: 'fail', issue: 'noisy', stats: s };
  if (s.std > REST_STD_WARN) return { status: 'warn', issue: 'jittery', stats: s };
  if (s.mean > REST_MEAN_HIGH) return { status: 'warn', issue: 'high-rest', stats: s };
  return { status: 'pass', stats: s };
}

// Step 5: full squeeze. Uses the 95th percentile as the peak so the ramp-up
// and any single spike don't count.
export function assessFlex(values, rest) {
  const s = summarize(values);
  const peak = s.p95;
  const delta = peak - rest.mean;
  const snr = delta / Math.max(rest.std, 2);
  const result = { stats: s, peak, delta, snr };
  if (s.n < 10) return { ...result, status: 'fail', issue: 'no-samples' };
  if (delta < FLEX_DELTA_FAIL || snr < FLEX_SNR_FAIL) return { ...result, status: 'fail', issue: 'no-response' };
  if (peak >= RAIL_HIGH) return { ...result, status: 'warn', issue: 'saturated' };
  if (delta < FLEX_DELTA_WEAK) return { ...result, status: 'warn', issue: 'weak' };
  return { ...result, status: 'pass' };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Turn the rest/flex measurements into the app's settings.
//   noiseFloor: subtracted from the raw reading (rest mean + 2 std)
//   gain:       a full squeeze lands at ~80% of the display range
//   emgCeil:    the top note at ~85% of a full squeeze, so it's reachable without straining
//   emgFloor:   notes start ~12% of the way up, above any leftover rest noise
export function computeSettings(rest, flexPeak) {
  const noiseFloor = Math.round(rest.mean + 2 * rest.std);
  const span = Math.max(1, flexPeak - noiseFloor);
  const gain = clamp(Math.round(((0.8 * SENSOR_MAX) / span) * 10) / 10, 0.1, 5.0);
  const processedPeak = Math.min(SENSOR_MAX, span * gain);
  const emgCeil = Math.round(clamp(processedPeak * 0.85, 100, SENSOR_MAX));
  const emgFloor = Math.round(clamp(
    Math.max(processedPeak * 0.12, rest.std * gain * 2, 10),
    0,
    Math.min(800, emgCeil - 50),
  ));
  return { noiseFloor, gain, emgFloor, emgCeil };
}

// ---- Pretend mode ----
// A make-believe muscle. 'wave' is the original demo signal; the others
// follow the wizard's instructions so Pretend mode can walk through setup.
const SIM_TARGETS = { rest: 55, flex: 760 };

export function simulateReading(intent, time, state) {
  if (intent === 'wave') {
    const base = Math.sin(time) * 400 + 450;
    return clamp(Math.floor(base + Math.random() * 80), 0, SENSOR_MAX);
  }
  let target = SIM_TARGETS[intent] ?? SIM_TARGETS.rest;
  if (intent === 'sweep') {
    // relax -> gentle squeeze -> hard squeeze -> relax, every 6 seconds
    const phase = time % 6;
    target = phase < 1.5 ? 55 : phase < 3 ? 230 : phase < 4.5 ? 800 : 55;
  }
  state.level += (target - state.level) * 0.2;
  const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * (6 + 0.04 * state.level);
  return clamp(Math.round(state.level + noise), 0, SENSOR_MAX - 1);
}
