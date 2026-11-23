import React, { useEffect, useRef, useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, RotateCcw, Usb, Loader2, Compass, Play, Drama,
  CircleCheck, TriangleAlert, CircleX,
} from 'lucide-react';
import {
  ISSUES, SENSOR_MAX, RAIL_HIGH, MIN_RATE_HZ,
  assessDataStream, assessHookup, assessRest, assessFlex, computeSettings,
} from './calibration';

const STEPS = [
  { id: 'connect', label: 'Plug In', emoji: '🔌' },
  { id: 'data', label: 'Data', emoji: '📡' },
  { id: 'sensor', label: 'Sensor', emoji: '🩹' },
  { id: 'rest', label: 'Relax', emoji: '😴' },
  { id: 'flex', label: 'Squeeze', emoji: '💪' },
  { id: 'test', label: 'Test', emoji: '🎹' },
];
const S = { CONNECT: 0, DATA: 1, SENSOR: 2, REST: 3, FLEX: 4, TEST: 5, DONE: 6 };

const CAPTURE = {
  rest: { countdownMs: 2000, captureMs: 3000 },
  flex: { countdownMs: 3000, captureMs: 3000 },
};

const NOTE_HEX = {
  red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e',
  cyan: '#06b6d4', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899',
};

const STATUS_STYLE = {
  pass: { box: 'bg-emerald-50 border-emerald-300', text: 'text-emerald-700', Icon: CircleCheck },
  warn: { box: 'bg-amber-50 border-amber-300', text: 'text-amber-700', Icon: TriangleAlert },
  fail: { box: 'bg-red-50 border-red-300', text: 'text-red-700', Icon: CircleX },
  checking: { box: 'bg-sky-50 border-sky-200', text: 'text-sky-700', Icon: Loader2 },
};

const sanitize = (line) => (line || '').replace(/[^\x20-\x7e]/g, '·').slice(0, 42);

// ---------------------------------------------------------------------------

export default function CalibrationWizard({
  onClose,
  isSupported,
  isConnected,
  isSimulating,
  portLabel,
  connectIssue,
  onConnect,
  onPretend,
  bufferRef,
  statsRef,
  setSimIntent,
  rawValue,
  processedValue,
  keyIndex,
  keys,
  noteIntervals,
  emgFloor,
  emgCeil,
  onApply,
}) {
  const [nav, setNav] = useState({ step: S.CONNECT, visit: 0 });
  const [live, setLive] = useState(null);           // continuous check result, tagged with nav.visit
  const [capture, setCapture] = useState(null);     // running rest/flex capture
  const [results, setResults] = useState({});       // per-step outcomes
  const [goals, setGoals] = useState({ quiet: false, low: false, top: false });
  const [connecting, setConnecting] = useState(false);

  const step = nav.step;
  const goTo = (next) => {
    setCapture(null);
    if (next === S.TEST) setGoals({ quiet: false, low: false, top: false });
    setNav((n) => ({ step: next, visit: n.visit + 1 }));
  };

  // Follow the connection: jump ahead once connected, back to step 1 if it drops.
  const connectedOk = isConnected || isSimulating;
  const [wasConnected, setWasConnected] = useState(connectedOk);
  if (wasConnected !== connectedOk) {
    setWasConnected(connectedOk);
    if (connectedOk && step === S.CONNECT) {
      setNav((n) => ({ step: S.DATA, visit: n.visit + 1 }));
    } else if (!connectedOk && step !== S.CONNECT) {
      setCapture(null);
      setNav((n) => ({ step: S.CONNECT, visit: n.visit + 1 }));
    }
  }

  // Pretend mode: the make-believe muscle follows the instructions on screen.
  const captureKind = capture?.kind;
  const capturePhase = capture?.phase;
  const captureStart = capture?.startedAt;
  useEffect(() => {
    let intent = 'rest';
    if (step === S.FLEX && captureKind === 'flex' && capturePhase === 'capturing') intent = 'flex';
    if (step === S.TEST) intent = 'sweep';
    setSimIntent(intent);
  }, [step, captureKind, capturePhase, setSimIntent]);
  useEffect(() => () => setSimIntent('wave'), [setSimIntent]);

  // Continuous checks for the Data and Sensor steps.
  const visit = nav.visit;
  useEffect(() => {
    if (step !== S.DATA && step !== S.SENSOR) return;
    const startedAt = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsedMs = now - startedAt;
      const stats = statsRef.current;
      const buffer = bufferRef.current;
      if (step === S.DATA) {
        const check = assessDataStream({ now, elapsedMs, stats, buffer });
        setLive({
          visit,
          ...check,
          parsed: stats.parsed,
          unparsed: stats.unparsed,
          bytes: stats.bytes,
          lastLine: stats.lastLine,
          lastBadLine: stats.lastBadLine,
          recentText: stats.recentText.slice(-42),
        });
      } else {
        const check = elapsedMs < 1500
          ? { status: 'checking' }
          : assessHookup(buffer.range(now - 2000, now));
        setLive({ visit, ...check });
      }
    }, 250);
    return () => clearInterval(id);
  }, [step, visit, statsRef, bufferRef]);
  const liveCheck = live && live.visit === visit ? live : { status: 'checking' };

  // Timed captures for the Relax and Squeeze steps.
  useEffect(() => {
    if (!captureKind) return;
    const { countdownMs, captureMs } = CAPTURE[captureKind];
    const id = setInterval(() => {
      const t = performance.now() - captureStart;
      if (t < countdownMs + captureMs) {
        setCapture((c) => c && { ...c, phase: t < countdownMs ? 'countdown' : 'capturing', t });
        return;
      }
      clearInterval(id);
      const from = captureStart + countdownMs;
      const values = bufferRef.current.range(from, from + captureMs);
      setResults((r) => (captureKind === 'rest'
        ? { ...r, rest: assessRest(values), flex: undefined }
        : r.rest ? { ...r, flex: assessFlex(values, r.rest.stats) } : r));
      setCapture(null);
    }, 100);
    return () => clearInterval(id);
  }, [captureKind, captureStart, bufferRef]);

  const startCapture = (kind) => {
    setResults((r) => ({ ...r, [kind]: undefined }));
    setCapture({ kind, startedAt: performance.now(), phase: 'countdown', t: 0 });
  };

  // Test step: can the player stay quiet, hold a low note, and reach the top?
  const keyIndexRef = useRef(keyIndex);
  useEffect(() => { keyIndexRef.current = keyIndex; }, [keyIndex]);
  useEffect(() => {
    if (step !== S.TEST) return;
    let quietSince = null;
    let lowSince = null;
    const id = setInterval(() => {
      const now = performance.now();
      const k = keyIndexRef.current;
      quietSince = k === -1 ? (quietSince ?? now) : null;
      lowSince = k >= 0 && k <= 2 ? (lowSince ?? now) : null;
      const hit = {
        quiet: quietSince !== null && now - quietSince >= 1000,
        low: lowSince !== null && now - lowSince >= 500,
        top: k === keys.length - 1,
      };
      if (hit.quiet || hit.low || hit.top) {
        setGoals((g) => (
          (hit.quiet && !g.quiet) || (hit.low && !g.low) || (hit.top && !g.top)
            ? { quiet: g.quiet || hit.quiet, low: g.low || hit.low, top: g.top || hit.top }
            : g
        ));
      }
    }, 100);
    return () => clearInterval(id);
  }, [step, keys.length]);

  // ---- Navigation rules ----
  const handleConnect = async () => {
    setConnecting(true);
    await onConnect();
    setConnecting(false);
  };

  const applySettings = () => {
    const settings = computeSettings(results.rest.stats, results.flex.peak);
    const steps = [results.data, results.sensor, results.rest, results.flex];
    onApply({
      settings,
      rest: { mean: Math.round(results.rest.stats.mean), std: Math.round(results.rest.stats.std) },
      flexPeak: Math.round(results.flex.peak),
      quality: steps.every((r) => r?.status === 'pass') ? 'great' : 'ok',
    });
  };

  const next = ({ anyway = false } = {}) => {
    if (step === S.DATA) setResults((r) => ({ ...r, data: liveCheck }));
    if (step === S.SENSOR) {
      setResults((r) => ({ ...r, sensor: anyway ? { ...liveCheck, status: 'warn', skipped: true } : liveCheck }));
    }
    if (step === S.REST && anyway) setResults((r) => ({ ...r, rest: { ...r.rest, status: 'warn', skipped: true } }));
    if (step === S.FLEX) applySettings();
    if (step === S.TEST) setResults((r) => ({ ...r, test: { status: goals.quiet && goals.low && goals.top ? 'pass' : 'warn', goals } }));
    goTo(step + 1);
  };

  const makeEasier = () => {
    const ceil = Math.max(emgFloor + 50, Math.round(emgCeil * 0.85));
    onApply({ settings: { emgCeil: ceil } });
  };

  let canNext = false;
  let canContinueAnyway = false;
  if (step === S.CONNECT) canNext = connectedOk;
  if (step === S.DATA) canNext = liveCheck.status === 'pass' || liveCheck.status === 'warn';
  if (step === S.SENSOR) {
    canNext = liveCheck.status === 'pass' || liveCheck.status === 'warn';
    canContinueAnyway = liveCheck.status === 'fail';
  }
  if (step === S.REST) {
    canNext = !capture && (results.rest?.status === 'pass' || results.rest?.status === 'warn');
    canContinueAnyway = !capture && results.rest?.status === 'fail' && results.rest.issue !== 'no-samples';
  }
  if (step === S.FLEX) canNext = !capture && (results.flex?.status === 'pass' || results.flex?.status === 'warn');
  if (step === S.TEST) canNext = true;
  const canRemeasure = !capture && ((step === S.REST && results.rest) || (step === S.FLEX && results.flex));

  // Status dot for each step in the progress bar.
  const stepStatus = (i) => {
    if (i === S.CONNECT) return connectedOk ? 'pass' : null;
    const r = results[STEPS[i].id];
    return r?.status ?? null;
  };

  // ---- Step bodies ----
  let body;
  if (step === S.CONNECT) {
    body = (
      <ConnectStep
        isSupported={isSupported}
        connectedOk={connectedOk}
        isSimulating={isSimulating}
        portLabel={portLabel}
        connectIssue={connectIssue}
        connecting={connecting}
        onConnect={handleConnect}
        onPretend={onPretend}
      />
    );
  } else if (step === S.DATA) {
    body = <DataStep check={liveCheck} bufferRef={bufferRef} rawValue={rawValue} isSimulating={isSimulating} />;
  } else if (step === S.SENSOR) {
    body = <SensorStep check={liveCheck} bufferRef={bufferRef} rawValue={rawValue} />;
  } else if (step === S.REST || step === S.FLEX) {
    body = (
      <CaptureStep
        kind={step === S.REST ? 'rest' : 'flex'}
        capture={capture}
        result={step === S.REST ? results.rest : results.flex}
        rest={results.rest}
        onStart={startCapture}
        bufferRef={bufferRef}
        rawValue={rawValue}
      />
    );
  } else if (step === S.TEST) {
    body = (
      <TestStep
        goals={goals}
        keys={keys}
        noteIntervals={noteIntervals}
        processedValue={processedValue}
        keyIndex={keyIndex}
        emgFloor={emgFloor}
        onEasier={makeEasier}
      />
    );
  } else {
    body = <DoneStep results={results} portLabel={isSimulating ? 'Pretend mode' : portLabel} emgFloor={emgFloor} emgCeil={emgCeil} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <div className="bg-white w-full max-w-5xl h-full max-h-[46rem] rounded-[2rem] border-4 border-white shadow-2xl flex flex-col overflow-hidden text-left">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-4 pb-2 shrink-0">
          <div className="bg-sky-100 p-2 rounded-2xl"><Compass className="w-6 h-6 text-sky-500" /></div>
          <div className="flex-1">
            <h2 id="wizard-title" className="text-xl font-black text-sky-600 tracking-tight leading-tight">Setup Wizard</h2>
            <p className="text-sm font-bold text-slate-400">Let's get your muscle sensor ready, one step at a time.</p>
          </div>
          {isSimulating && (
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-black border-2 border-amber-200">🎭 PRETEND MODE</span>
          )}
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="Close setup">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Stepper */}
        <ol className="flex items-start px-6 pb-3 shrink-0">
          {STEPS.map((s, i) => {
            const status = stepStatus(i);
            const active = i === step;
            const done = i < step || step === S.DONE;
            let circle = 'bg-slate-100 text-slate-400 border-slate-200';
            if (done && status === 'pass') circle = 'bg-emerald-400 border-emerald-500 text-white';
            else if (done && (status === 'warn' || status === 'fail')) circle = 'bg-amber-300 border-amber-400 text-white';
            if (active) circle = 'bg-sky-500 border-sky-300 text-white ring-4 ring-sky-200 scale-110';
            return (
              <li key={s.id} className="flex-1 flex flex-col items-center relative">
                {i > 0 && (
                  <div className={`absolute top-[1.125rem] right-1/2 w-full h-1.5 rounded-full ${i <= step ? 'bg-sky-300' : 'bg-slate-100'}`} />
                )}
                <div className={`relative z-10 w-10 h-10 rounded-full border-4 flex items-center justify-center text-lg transition-all ${circle}`}>
                  {done && status === 'pass' ? '✓' : done && status ? '!' : s.emoji}
                </div>
                <span className={`mt-1.5 text-xs font-black tracking-wide ${active ? 'text-sky-600' : 'text-slate-400'}`}>
                  {i + 1}. {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-4 border-t-4 border-sky-50 pt-4">
          {body}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-3 border-t-4 border-sky-50 bg-slate-50/60 shrink-0">
          {step === S.DONE ? (
            <>
              <button onClick={() => { setResults({}); goTo(connectedOk ? S.DATA : S.CONNECT); }}
                className="py-2.5 px-4 rounded-2xl text-sm font-black text-slate-600 bg-slate-200 hover:bg-slate-300 flex items-center gap-2 transition-colors">
                <RotateCcw className="w-4 h-4" /> Redo setup
              </button>
              <div className="flex-1" />
              <button onClick={onClose}
                className="py-3 px-6 rounded-2xl text-base font-black text-white bg-emerald-500 hover:bg-emerald-400 shadow-[0_5px_0_rgb(5,150,105)] active:shadow-none active:translate-y-1 transition-all">
                Start playing! 🎶
              </button>
            </>
          ) : (
            <>
              {step > S.CONNECT ? (
                <button onClick={() => goTo(step - 1)}
                  className="py-2.5 px-4 rounded-2xl text-sm font-black text-slate-600 bg-slate-200 hover:bg-slate-300 flex items-center gap-1 transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
              ) : (
                <button onClick={onClose} className="py-2.5 px-4 rounded-2xl text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">
                  Skip setup
                </button>
              )}
              <div className="flex-1 text-center text-xs font-bold text-slate-400">
                Step {step + 1} of {STEPS.length}
              </div>
              {canRemeasure && (
                <button onClick={() => startCapture(step === S.REST ? 'rest' : 'flex')}
                  className="py-2.5 px-4 rounded-2xl text-sm font-black text-slate-600 bg-slate-200 hover:bg-slate-300 flex items-center gap-2 transition-colors">
                  <RotateCcw className="w-4 h-4" /> Measure again
                </button>
              )}
              {canContinueAnyway && (
                <button onClick={() => next({ anyway: true })} className="py-2.5 px-3 text-sm font-bold text-slate-400 hover:text-slate-600 underline underline-offset-4">
                  Continue anyway
                </button>
              )}
              <button onClick={() => next()} disabled={!canNext}
                className={`py-3 px-6 rounded-2xl text-base font-black flex items-center gap-1 transition-all ${canNext
                  ? 'text-white bg-sky-500 hover:bg-sky-400 shadow-[0_5px_0_rgb(2,132,199)] active:shadow-none active:translate-y-1'
                  : 'text-slate-400 bg-slate-200 cursor-not-allowed'}`}>
                {step === S.TEST ? (goals.quiet && goals.low && goals.top ? 'Finish' : 'Finish anyway') : 'Next'}
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps

function StepIntro({ emoji, title, children }) {
  return (
    <div className="mb-3">
      <h3 className="text-xl font-black text-slate-700 flex items-center gap-2">
        <span className="text-2xl">{emoji}</span> {title}
      </h3>
      <p className="mt-1 text-sm font-semibold text-slate-500 leading-relaxed">{children}</p>
    </div>
  );
}

function StatusCard({ status, issue, title, detail }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.checking;
  const info = issue ? ISSUES[issue] : null;
  const heading = title || info?.title;
  const text = detail ?? info?.detail;
  const tips = status === 'pass' || status === 'checking' ? [] : info?.tips || [];
  const { Icon } = style;
  return (
    <div className={`rounded-2xl border-4 p-3.5 ${style.box}`} role="status">
      <div className={`flex items-start gap-3 ${style.text}`}>
        <Icon className={`w-6 h-6 shrink-0 mt-0.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
        <div className="min-w-0">
          <div className="font-black text-base leading-snug">{heading}</div>
          {text && <div className="text-sm font-semibold opacity-80 mt-0.5">{text}</div>}
        </div>
      </div>
      {tips.length > 0 && (
        <div className="mt-2.5 bg-white/80 rounded-xl px-3 py-2.5">
          <div className="text-xs font-black tracking-widest text-slate-400 uppercase mb-1.5">How to fix it</div>
          <ol className="space-y-1">
            {tips.map((tip, i) => (
              <li key={tip} className="flex gap-2 text-sm font-semibold text-slate-600 leading-snug">
                <span className="shrink-0 w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-black flex items-center justify-center mt-px">{i + 1}</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ConnectStep({ isSupported, connectedOk, isSimulating, portLabel, connectIssue, connecting, onConnect, onPretend }) {
  let status = null;
  if (!isSupported && !isSimulating) status = <StatusCard status="fail" issue="unsupported" />;
  else if (connectedOk) {
    status = isSimulating
      ? <StatusCard status="pass" title="Pretend mode is on" detail="We'll use a make-believe muscle, so you can try everything without a sensor." />
      : <StatusCard status="pass" title="Device connected!" detail={portLabel} />;
  } else if (connecting) {
    status = <StatusCard status="checking" title="Waiting for you to pick a device…" detail="Choose your board in the window that popped up." />;
  } else if (connectIssue) {
    status = (
      <StatusCard
        status="fail"
        issue={connectIssue.kind}
        detail={connectIssue.kind === 'usb-error' ? connectIssue.message : undefined}
      />
    );
  }

  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3 space-y-4">
        <StepIntro emoji="🔌" title="Plug in your muscle sensor">
          Connect the sensor board to this computer with a USB cable. Then press <b>Connect</b> and pick your board from the list.
        </StepIntro>
        <div className="flex flex-wrap gap-3">
          <button onClick={onConnect} disabled={connectedOk || connecting || !isSupported}
            className="py-3 px-5 rounded-2xl flex items-center gap-2 text-base font-black text-white bg-emerald-500 hover:bg-emerald-400 shadow-[0_5px_0_rgb(5,150,105)] active:shadow-none active:translate-y-1 transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-y-0">
            <Usb className="w-5 h-5" /> Connect device
          </button>
          <button onClick={onPretend} disabled={connectedOk}
            className="py-3 px-5 rounded-2xl flex items-center gap-2 text-base font-black text-slate-700 bg-amber-300 hover:bg-amber-200 shadow-[0_5px_0_rgb(217,119,6)] active:shadow-none active:translate-y-1 transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-y-0">
            <Drama className="w-5 h-5" /> No device? Pretend
          </button>
        </div>
        {status}
      </div>
      <div className="md:col-span-2">
        <WiringDiagram connected={connectedOk && !isSimulating} />
      </div>
    </div>
  );
}

function DataStep({ check, bufferRef, rawValue, isSimulating }) {
  let card;
  if (check.status === 'checking') card = <StatusCard status="checking" title="Listening for readings…" detail="This takes a couple of seconds." />;
  else if (check.status === 'pass') {
    card = <StatusCard status="pass" title="Readings are coming in!" detail={`${Math.round(check.rate)} readings every second, in the right format.`} />;
  } else if (check.issue === 'slow') {
    card = <StatusCard status="warn" issue="slow" detail={`Only ${check.rate.toFixed(1)} readings per second (${MIN_RATE_HZ}+ is best). The music may feel laggy.`} />;
  } else card = <StatusCard status={check.status} issue={check.issue} />;

  const lastMessage = check.lastLine || check.lastBadLine || check.recentText;
  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3 space-y-4">
        <StepIntro emoji="📡" title="Listening to your board">
          We're checking that sensor readings are arriving, quickly and in the right format.
          {isSimulating && ' (In pretend mode the readings come from the make-believe muscle.)'}
        </StepIntro>
        {card}
      </div>
      <div className="md:col-span-2 space-y-3">
        <LivePanel bufferRef={bufferRef} rawValue={rawValue} />
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Per second" value={check.rate != null ? Math.round(check.rate) : '–'} good={check.rate >= MIN_RATE_HZ} />
          <Stat label="Good lines" value={check.parsed ?? '–'} good={check.parsed > 0} />
          <Stat label="Unknown lines" value={check.unparsed ?? '–'} bad={check.unparsed > 0 && !check.parsed} />
        </div>
        <div className="bg-slate-100 rounded-xl px-3 py-2">
          <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">Last message</div>
          <div className="font-mono text-sm text-slate-700 truncate">{lastMessage ? sanitize(lastMessage) : '(nothing yet)'}</div>
        </div>
      </div>
    </div>
  );
}

function SensorStep({ check, bufferRef, rawValue }) {
  let card;
  if (check.status === 'checking') card = <StatusCard status="checking" title="Watching the signal…" detail="Keep your arm relaxed and still." />;
  else if (check.status === 'pass') card = <StatusCard status="pass" title="The sensor signal looks healthy" detail="Calm and steady while you rest. Nice!" />;
  else card = <StatusCard status={check.status} issue={check.issue} />;

  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3 space-y-4">
        <StepIntro emoji="🩹" title="Check the sensor on your arm">
          Stick the 3 pads on like the picture, then rest your arm on the table and keep still.
        </StepIntro>
        {card}
      </div>
      <div className="md:col-span-2 space-y-3">
        <LivePanel
          bufferRef={bufferRef}
          rawValue={rawValue}
          short
          stats={[
            ['Level', check.stats ? Math.round(check.stats.mean) : '–'],
            ['Wiggle', check.stats ? `±${Math.round(check.stats.std)}` : '–'],
            ['Range', check.stats ? `${Math.round(check.stats.min)}–${Math.round(check.stats.max)}` : '–'],
          ]}
        />
        <ArmDiagram compact />
      </div>
    </div>
  );
}

function CaptureStep({ kind, capture, result, rest, onStart, bufferRef, rawValue }) {
  const isRest = kind === 'rest';
  const cfg = CAPTURE[kind];
  const running = capture && capture.kind === kind;

  let prompt;
  if (running && capture.phase === 'countdown') {
    const left = Math.max(1, Math.ceil((cfg.countdownMs - capture.t) / 1000));
    prompt = (
      <div className="rounded-3xl bg-sky-50 border-4 border-sky-200 p-6 text-center">
        <div className="text-sm font-black text-sky-500 tracking-widest uppercase">{isRest ? 'Put your arm down and relax…' : 'Get ready to squeeze…'}</div>
        <div className="text-7xl font-black text-sky-600 tabular-nums mt-1">{left}</div>
      </div>
    );
  } else if (running) {
    const progress = Math.min(1, (capture.t - cfg.countdownMs) / cfg.captureMs);
    prompt = (
      <div className={`rounded-3xl border-4 p-6 text-center ${isRest ? 'bg-cyan-50 border-cyan-200' : 'bg-rose-50 border-rose-300'}`}>
        <div className={`text-4xl font-black ${isRest ? 'text-cyan-600' : 'text-rose-500 animate-pulse'}`}>
          {isRest ? 'Stay relaxed… 😴' : 'SQUEEZE! 💪'}
        </div>
        <div className="mt-4 h-4 bg-white rounded-full overflow-hidden border-2 border-white shadow-inner">
          <div className={`h-full rounded-full ${isRest ? 'bg-cyan-400' : 'bg-rose-400'}`} style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-2 text-sm font-bold text-slate-500 tabular-nums">
          {Math.max(0, (cfg.captureMs - (capture.t - cfg.countdownMs)) / 1000).toFixed(1)}s left
        </div>
      </div>
    );
  } else if (result) {
    prompt = null;
  } else {
    prompt = (
      <button onClick={() => onStart(kind)}
        className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-lg font-black text-white transition-all active:shadow-none active:translate-y-1 ${isRest
          ? 'bg-cyan-500 hover:bg-cyan-400 shadow-[0_6px_0_rgb(8,145,178)]'
          : 'bg-rose-500 hover:bg-rose-400 shadow-[0_6px_0_rgb(225,29,72)]'}`}>
        <Play className="w-5 h-5" />
        {isRest ? 'Start measuring (3 seconds)' : "I'm ready, start!"}
      </button>
    );
  }

  let card = null;
  if (!running && result) {
    if (isRest) {
      const detail = `Resting level ${Math.round(result.stats.mean)}, wiggle ±${Math.round(result.stats.std)}.`;
      card = result.status === 'pass'
        ? <StatusCard status="pass" title="Nice and relaxed!" detail={detail} />
        : <StatusCard status={result.status} issue={result.issue} detail={result.issue === 'no-samples' ? undefined : `${ISSUES[result.issue].detail} ${detail}`} />;
    } else {
      const detail = `Your signal jumped from ${Math.round(rest.stats.mean)} to ${Math.round(result.peak)}.`;
      card = result.status === 'pass'
        ? <StatusCard status="pass" title="Great squeeze!" detail={detail} />
        : <StatusCard status={result.status} issue={result.issue} detail={result.issue === 'no-samples' ? undefined : `${ISSUES[result.issue].detail} ${detail}`} />;
    }
  }

  const markers = [];
  if (rest) markers.push({ value: rest.stats.mean, color: '#22d3ee', label: 'rest', align: 'left' });
  if (!isRest && result && !running) markers.push({ value: result.peak, color: '#fb7185', label: 'squeeze' });

  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3 space-y-4">
        {isRest ? (
          <StepIntro emoji="😴" title="Relax your arm">
            Open your hand and let your arm go floppy on the table. We'll measure your resting signal.
          </StepIntro>
        ) : (
          <StepIntro emoji="💪" title="Squeeze as hard as you can!">
            Make a tight fist and hold it for 3 seconds when you see <b>SQUEEZE!</b>
          </StepIntro>
        )}
        {card}
        {prompt}
      </div>
      <div className="md:col-span-2 space-y-3">
        <LivePanel bufferRef={bufferRef} rawValue={rawValue} markers={markers} />
        {!isRest && result?.status === 'fail' && <ArmDiagram compact />}
      </div>
    </div>
  );
}

function TestStep({ goals, keys, noteIntervals, processedValue, keyIndex, emgFloor, onEasier }) {
  const items = [
    { done: goals.quiet, emoji: '😴', text: 'Relax: no notes play' },
    { done: goals.low, emoji: '🙂', text: 'Squeeze gently: hold a low note (red, orange or yellow)' },
    { done: goals.top, emoji: '💪', text: 'Squeeze hard: reach the top note (pink)' },
  ];
  const all = items.every((i) => i.done);
  const active = keyIndex >= 0 ? keys[keyIndex] : null;

  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3 space-y-4">
        <StepIntro emoji="🎹" title="Try it out!">
          Your settings are ready. Let's make sure you can play every note.
        </StepIntro>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.text} className={`flex items-center gap-3 px-3 py-2 rounded-2xl border-4 transition-colors ${item.done ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-100'}`}>
              <span className="text-2xl">{item.emoji}</span>
              <span className={`flex-1 text-sm font-black ${item.done ? 'text-emerald-700' : 'text-slate-600'}`}>{item.text}</span>
              {item.done
                ? <CircleCheck className="w-7 h-7 text-emerald-500" />
                : <div className="w-7 h-7 rounded-full border-4 border-slate-200" />}
            </li>
          ))}
        </ul>
        {all ? (
          <StatusCard status="pass" title="Perfect! You can reach every note." detail="Press Finish to start making music." />
        ) : (
          !goals.top && (
            <div className="text-sm font-semibold text-slate-500">
              Can't reach the top note?{' '}
              <button onClick={onEasier} className="font-black text-sky-600 underline underline-offset-4 hover:text-sky-500">Make it easier</button>
            </div>
          )
        )}
      </div>
      <div className="md:col-span-2">
        <div className="bg-slate-900 rounded-3xl border-8 border-slate-800 p-4 flex gap-4 h-72">
          <NoteMeter keys={keys} noteIntervals={noteIntervals} value={processedValue} keyIndex={keyIndex} emgFloor={emgFloor} />
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">Now playing</div>
            <div className="text-5xl font-black mt-1" style={{ color: active ? NOTE_HEX[active.colorKey] : '#475569' }}>
              {active ? active.note.replace(/[0-9]/g, '') : '—'}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1">{active ? 'note' : 'quiet'}</div>
            <div className="mt-4 text-3xl font-black text-white tabular-nums">{Math.round(processedValue)}</div>
            <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase">muscle power</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DoneStep({ results, portLabel, emgFloor, emgCeil }) {
  const { data, sensor, rest, flex, test } = results;
  const settings = flex && rest ? computeSettings(rest.stats, flex.peak) : null;
  const rows = [
    { emoji: '🔌', label: 'Device', value: portLabel || 'Connected', status: 'pass' },
    { emoji: '📡', label: 'Data', value: data?.rate ? `${Math.round(data.rate)} readings / second` : '—', status: data?.status },
    { emoji: '🩹', label: 'Sensor', value: sensor?.skipped ? 'Skipped' : sensor?.status === 'pass' ? 'Healthy signal' : sensor?.issue ? ISSUES[sensor.issue].title : '—', status: sensor?.status },
    { emoji: '😴', label: 'Resting', value: rest ? `${Math.round(rest.stats.mean)} ± ${Math.round(rest.stats.std)}` : '—', status: rest?.status },
    { emoji: '💪', label: 'Squeeze', value: flex ? `${Math.round(flex.peak)}` : '—', status: flex?.status },
    { emoji: '🎹', label: 'Test', value: test ? `${Object.values(test.goals).filter(Boolean).length} of 3 checks` : '—', status: test?.status },
  ];
  const allGood = rows.every((r) => r.status === 'pass');
  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3">
        <div className="text-center">
          <div className="text-5xl">{allGood ? '🎉' : '👍'}</div>
          <h3 className="text-3xl font-black text-slate-700 mt-1">{allGood ? 'All set!' : 'Ready to play!'}</h3>
          <p className="text-sm font-semibold text-slate-500 mt-1">
            {allGood ? 'Everything checks out. Your sensor is set up and calibrated.' : 'Setup is done. A few checks had warnings, so the sound may be a little less steady.'}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {rows.map((r) => {
            const style = STATUS_STYLE[r.status] || { text: 'text-slate-400' };
            const Icon = style.Icon;
            return (
              <div key={r.label} className="flex items-center gap-2.5 bg-slate-50 rounded-2xl px-3 py-2 border-2 border-slate-100">
                <span className="text-xl">{r.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">{r.label}</div>
                  <div className="text-sm font-black text-slate-700 truncate">{r.value}</div>
                </div>
                {Icon && <Icon className={`w-5 h-5 shrink-0 ${style.text}`} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className="md:col-span-2">
        <div className="bg-sky-50 border-4 border-sky-100 rounded-3xl p-5">
          <div className="text-xs font-black tracking-widest text-sky-500 uppercase mb-3">Settings we picked for you</div>
          {settings ? (
            <dl className="space-y-3">
              <Setting label="🚀 Super Boost" value={`${settings.gain.toFixed(1)}x`} color="text-emerald-500" />
              <Setting label="😴 Resting Level" value={emgFloor} color="text-cyan-500" />
              <Setting label="💪 Max Flex Level" value={emgCeil} color="text-rose-500" />
              <Setting label="🔇 Noise filter" value={settings.noiseFloor} color="text-slate-500" />
            </dl>
          ) : (
            <p className="text-sm font-semibold text-slate-500">No settings changed.</p>
          )}
          <p className="text-xs font-semibold text-slate-400 mt-4 leading-relaxed">
            You can fine-tune these anytime in <b>Muscle Power Settings</b>. Run setup again whenever you move the pads.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces

function Setting({ label, value, color }) {
  return (
    <div className="flex justify-between items-center bg-white rounded-xl px-3 py-2">
      <dt className="text-sm font-bold text-slate-600">{label}</dt>
      <dd className={`text-lg font-black tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

function Stat({ label, value, good, bad }) {
  const color = bad ? 'text-red-500' : good ? 'text-emerald-600' : 'text-slate-700';
  return (
    <div className="bg-slate-100 rounded-xl px-2 py-2 text-center">
      <div className={`text-lg font-black tabular-nums leading-tight ${color}`}>{value}</div>
      <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">{label}</div>
    </div>
  );
}

function LivePanel({ bufferRef, rawValue, markers = [], stats = null, short = false }) {
  return (
    <div className="bg-slate-900 rounded-3xl border-8 border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Live signal
        </span>
        <span className="text-2xl font-black text-white tabular-nums">{Math.round(rawValue)}</span>
      </div>
      <LiveTrace bufferRef={bufferRef} markers={markers} heightClass={short ? 'h-24' : 'h-32'} />
      {stats && (
        <div className="grid grid-cols-3 border-t-2 border-slate-800">
          {stats.map(([label, value]) => (
            <div key={label} className="text-center py-1.5">
              <div className="text-base font-black text-white tabular-nums leading-tight">{value}</div>
              <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase">{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Last few seconds of raw readings, drawn straight from the sample buffer.
function LiveTrace({ bufferRef, markers, heightClass, windowMs = 5000 }) {
  const canvasRef = useRef(null);
  const markersRef = useRef(markers);
  useEffect(() => { markersRef.current = markers; }, [markers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const y = (v) => h - 4 - (v / SENSOR_MAX) * (h - 8);

      // Top-of-range zone: readings here mean the sensor is maxed out.
      ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
      ctx.fillRect(0, 0, w, y(RAIL_HIGH));
      ctx.fillStyle = 'rgba(251, 113, 133, 0.7)';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('MAX', 6, y(RAIL_HIGH) + 10);

      for (const m of markersRef.current) {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y(m.value));
        ctx.lineTo(w, y(m.value));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = m.color;
        const label = m.label.toUpperCase();
        const lx = m.align === 'left' ? 6 : w - ctx.measureText(label).width - 6;
        ctx.fillText(label, lx, y(m.value) - 4);
      }

      const now = performance.now();
      const pts = bufferRef.current.points(now - windowMs);
      if (pts.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 12px system-ui, sans-serif';
        const msg = 'waiting for data…';
        ctx.fillText(msg, (w - ctx.measureText(msg).width) / 2, h / 2);
        return;
      }
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = ((p.t - (now - windowMs)) / windowMs) * w;
        if (i === 0) ctx.moveTo(x, y(p.v)); else ctx.lineTo(x, y(p.v));
      });
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bufferRef, windowMs]);

  return <canvas ref={canvasRef} className={`block w-full ${heightClass}`} />;
}

// Vertical "thermometer" of the 8 note zones with the live level.
function NoteMeter({ keys, noteIntervals, value, keyIndex, emgFloor }) {
  const pct = (v) => `${(Math.min(SENSOR_MAX, Math.max(0, v)) / SENSOR_MAX) * 100}%`;
  return (
    <div className="relative w-14 h-full rounded-xl bg-slate-800 overflow-hidden">
      <div className="absolute inset-x-0 bottom-0 bg-slate-700/60" style={{ height: pct(emgFloor) }} />
      {keys.map((k, i) => {
        const zone = noteIntervals[i];
        return (
          <div key={k.note} className="absolute inset-x-0 border-t border-slate-900/60"
            style={{
              bottom: pct(zone.min),
              height: `calc(${pct(zone.max)} - ${pct(zone.min)})`,
              background: NOTE_HEX[k.colorKey],
              opacity: i === keyIndex ? 1 : 0.35,
            }} />
        );
      })}
      <div className="absolute inset-x-0 h-1 bg-white shadow-[0_0_8px_white] transition-all duration-75" style={{ bottom: pct(value) }} />
    </div>
  );
}

function DiagramTile({ emoji, label }) {
  return (
    <div className="flex flex-col items-center gap-1 w-20">
      <div className="w-16 h-16 rounded-2xl bg-white border-4 border-slate-200 flex items-center justify-center text-3xl shadow-sm">{emoji}</div>
      <div className="text-xs font-black text-slate-600 text-center leading-tight">{label}</div>
    </div>
  );
}

function DiagramLink({ label, on }) {
  return (
    <div className="flex-1 flex flex-col items-center -mt-5">
      <div className={`w-full h-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-300'}`} />
      <div className={`text-[10px] font-black mt-1 ${on ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</div>
    </div>
  );
}

function WiringDiagram({ connected }) {
  return (
    <div className="bg-slate-50 border-4 border-slate-100 rounded-3xl p-4">
      <div className="text-xs font-black tracking-widest text-slate-400 uppercase mb-4">How it all connects</div>
      <div className="flex items-center">
        <DiagramTile emoji="💻" label="Computer" />
        <DiagramLink label={connected ? 'USB ✓' : 'USB cable'} on={connected} />
        <DiagramTile emoji="🟦" label="Arduino board" />
        <DiagramLink label="3 wires" />
        <DiagramTile emoji="🩹" label="Muscle sensor" />
      </div>
      <div className="mt-5 text-xs font-black tracking-widest text-slate-400 uppercase mb-2">Sensor wires</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['+', '5V', 'bg-red-100 text-red-600'], ['−', 'GND', 'bg-slate-200 text-slate-700'], ['SIG', 'A0', 'bg-sky-100 text-sky-700']].map(([from, to, color]) => (
          <div key={from} className={`rounded-xl py-2 font-black text-sm ${color}`}>{from} → {to}</div>
        ))}
      </div>
      <div className="mt-4 text-xs font-semibold text-slate-500 leading-relaxed">
        Tip: use a <b>data</b> USB cable. Some cables can only charge.
      </div>
    </div>
  );
}

// Where the electrodes go on the forearm.
function ArmDiagram({ compact = false }) {
  return (
    <div className={`bg-orange-50/60 border-4 border-orange-100 rounded-3xl flex justify-center ${compact ? 'p-1.5' : 'p-3'}`}>
      <svg viewBox="0 0 340 168" className={`w-full ${compact ? 'max-h-36' : 'h-auto'}`} role="img" aria-label="Electrode placement: two pads on the forearm muscle bulge in a line, reference pad on the elbow bone">
        {/* forearm */}
        <path d="M 28 52 C 90 38, 190 50, 252 60 L 252 104 C 190 112, 90 128, 28 116 C 12 104, 12 64, 28 52 Z" fill="#fde2c8" stroke="#e8b48a" strokeWidth="3" />
        {/* fist */}
        <rect x="244" y="54" width="64" height="58" rx="22" fill="#fde2c8" stroke="#e8b48a" strokeWidth="3" />
        <ellipse cx="262" cy="57" rx="18" ry="8" fill="#fde2c8" stroke="#e8b48a" strokeWidth="3" />
        <path d="M 290 66 q 8 4 0 10 M 290 80 q 8 4 0 10 M 290 94 q 8 4 0 10" fill="none" stroke="#e8b48a" strokeWidth="2.5" strokeLinecap="round" />
        {/* muscle belly */}
        <ellipse cx="113" cy="84" rx="60" ry="25" fill="#fb7185" fillOpacity="0.22" stroke="#f43f5e" strokeWidth="2" strokeDasharray="5 4" />
        {/* signal electrodes, in a line along the arm */}
        {[94, 132].map((cx, i) => (
          <g key={cx}>
            <circle cx={cx} cy="84" r="13" fill="white" stroke="#94a3b8" strokeWidth="2.5" />
            <circle cx={cx} cy="84" r="5" fill="#ef4444" />
            <text x={cx + (i ? 9 : -9)} y="104" textAnchor="middle" fontSize="11" fontWeight="900" fill="#be123c">{i + 1}</text>
          </g>
        ))}
        {/* reference electrode on the elbow */}
        <circle cx="38" cy="86" r="13" fill="white" stroke="#94a3b8" strokeWidth="2.5" />
        <circle cx="38" cy="86" r="5" fill="#1e293b" />
        <text x="38" y="112" textAnchor="middle" fontSize="11" fontWeight="900" fill="#334155">3</text>
        {/* labels */}
        <line x1="113" y1="28" x2="113" y2="58" stroke="#f43f5e" strokeWidth="2" />
        <text x="8" y="20" fontSize="13" fontWeight="900" fill="#be123c">Pads 1 + 2: on the muscle bulge, in a line</text>
        <line x1="38" y1="118" x2="38" y2="140" stroke="#475569" strokeWidth="2" />
        <text x="18" y="156" fontSize="13" fontWeight="900" fill="#334155">Pad 3: reference on the elbow bone</text>
        <text x="276" y="132" textAnchor="middle" fontSize="11" fontWeight="800" fill="#b45309">hand</text>
        <text x="24" y="42" textAnchor="middle" fontSize="11" fontWeight="800" fill="#b45309">elbow</text>
      </svg>
    </div>
  );
}
