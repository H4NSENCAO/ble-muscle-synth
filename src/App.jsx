import React, { useState, useEffect, useRef } from 'react';
import { Activity, Volume2, Usb, Power, AlertCircle, XCircle, Hexagon, Crosshair, Timer, Gamepad2, Sparkles, Music, Loader2, PlayCircle } from 'lucide-react';

const SENSOR_MAX = 1024;

// Real Instrument Soundfont Mapping
const REAL_INSTRUMENTS = [
  { id: 'acoustic_grand_piano', icon: '🎹', name: 'Piano' },
  { id: 'marimba', icon: '🪵', name: 'Marimba' },
  { id: 'electric_guitar_clean', icon: '🎸', name: 'Guitar' },
  { id: 'violin', icon: '🎻', name: 'Violin' },
  { id: 'trumpet', icon: '🎺', name: 'Trumpet' },
  { id: 'choir_aahs', icon: '🗣️', name: 'Choir' }
];

// Vibrant Kid-Friendly Color Palette
const COLOR_MAP = {
  red: { text: 'text-red-500', bg: 'bg-red-400', border: 'border-red-600', hex: '#ef4444' },
  orange: { text: 'text-orange-500', bg: 'bg-orange-400', border: 'border-orange-600', hex: '#f97316' },
  yellow: { text: 'text-yellow-500', bg: 'bg-yellow-400', border: 'border-yellow-600', hex: '#eab308' },
  green: { text: 'text-green-500', bg: 'bg-green-400', border: 'border-green-600', hex: '#22c55e' },
  cyan: { text: 'text-cyan-500', bg: 'bg-cyan-400', border: 'border-cyan-600', hex: '#06b6d4' },
  blue: { text: 'text-blue-500', bg: 'bg-blue-400', border: 'border-blue-600', hex: '#3b82f6' },
  purple: { text: 'text-purple-500', bg: 'bg-purple-400', border: 'border-purple-600', hex: '#a855f7' },
  pink: { text: 'text-pink-500', bg: 'bg-pink-400', border: 'border-pink-600', hex: '#ec4899' }
};

// Playable Kids Songs (Mapped to scale indices 0-7)
const SONGS = [
  { id: 'mary', name: "Mary Had a Little Lamb", notes: [2, 1, 0, 1, 2, 2, 2, 1, 1, 1, 2, 4, 4] },
  { id: 'twinkle', name: "Twinkle Twinkle", notes: [0, 0, 4, 4, 5, 5, 4, 3, 3, 2, 2, 1, 1, 0] },
  { id: 'row', name: "Row Your Boat", notes: [0, 0, 0, 1, 2, 2, 1, 2, 3, 4] }
];

export default function App() {
  const [rawSensorValue, setRawSensorValue] = useState(0);
  const historyRef = useRef(new Float32Array(100));
  const signalCanvasRef = useRef(null);
  
  // Global Thresholds & State
  const [gain, setGain] = useState(1.0);
  const [emgFloor, setEmgFloor] = useState(30);
  const [emgCeil, setEmgCeil] = useState(600);
  const [instrument, setInstrument] = useState('acoustic_grand_piano');
  const [isInstrumentLoading, setIsInstrumentLoading] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.8);
  
  // Musical Key State
  const [rootNote, setRootNote] = useState('C');
  const [scaleType, setScaleType] = useState('Major');

  // Rhythm & Quantization State
  const [isRhythmic, setIsRhythmic] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [activeKeyIndex, setActiveKeyIndex] = useState(-1);
  const [beatTrigger, setBeatTrigger] = useState(0);

  // Music Game State
  const [isGaming, setIsGaming] = useState(false);
  const [gameSongId, setGameSongId] = useState('mary');
  const [gameStep, setGameStep] = useState(0);
  const [score, setScore] = useState(0);
  const [matchEffect, setMatchEffect] = useState(false);
  const isCooldownRef = useRef(false);

  // Calibration State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const calDataRef = useRef([]);

  // Connection State
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Serial Comm Refs
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const keepReadingRef = useRef(true);
  const latestRawRef = useRef(0); // latest value from serial, read at 60fps

  // 3D Visualizer State Refs
  const [engineState, setEngineState] = useState('loading');
  const threeMountRef = useRef(null);
  const latestSignalRef = useRef({ value: 0, color: '#94a3b8', isFlexing: false });

  // Soundfont Audio Refs
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const volumeGainRef = useRef(null);
  const soundfontInstRef = useRef(null);
  const playingNodeRef = useRef(null);
  const playingNoteIndexRef = useRef(-1);

  // Dynamically Generate the 8 Piano Keys (Full Major/Minor Scale)
  const dynamicKeys = React.useMemo(() => {
    const ROOT_FREQS = { 'C': 130.81, 'C#': 138.59, 'D': 146.83, 'Eb': 155.56, 'E': 164.81, 'F': 174.61, 'F#': 185.00, 'G': 196.00, 'Ab': 207.65, 'A': 220.00, 'Bb': 233.08, 'B': 246.94 };
    const ALL_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    
    // Scale intervals in semitones (1, 2, 3, 4, 5, 6, 7, 8)
    const intervals = scaleType === 'Major' 
      ? [0, 2, 4, 5, 7, 9, 11, 12] 
      : [0, 2, 3, 5, 7, 8, 10, 12]; 
      
    const colorKeys = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

    const baseFreq = ROOT_FREQS[rootNote];
    const rootIndex = ALL_NOTES.indexOf(rootNote);
    const keys = [];

    for (let i = 0; i < 8; i++) {
      const semitonesFromRoot = intervals[i];
      const absoluteIndex = rootIndex + semitonesFromRoot;
      
      const noteName = ALL_NOTES[absoluteIndex % 12];
      const octave = 3 + Math.floor(absoluteIndex / 12);
      const freq = baseFreq * Math.pow(2, semitonesFromRoot / 12);

      keys.push({
        note: `${noteName}${octave}`,
        freq: Number(freq.toFixed(2)),
        colorKey: colorKeys[i]
      });
    }
    return keys;
  }, [rootNote, scaleType]);

  const processedValue = Math.max(0, Math.min(SENSOR_MAX, (rawSensorValue - noiseFloor) * gain));
  const isFlexing = activeKeyIndex !== -1 && activeKeyIndex < dynamicKeys.length;
  const activeColorHex = isFlexing ? COLOR_MAP[dynamicKeys[activeKeyIndex].colorKey].hex : '#94a3b8';

  useEffect(() => {
    const buf = historyRef.current;
    buf.copyWithin(0, 1);
    buf[99] = processedValue;
    if (isCalibrating) calDataRef.current.push(rawSensorValue);
  }, [rawSensorValue, processedValue, isCalibrating]);

  useEffect(() => {
    latestSignalRef.current = { value: processedValue, color: activeColorHex, isFlexing };
  }, [processedValue, activeColorHex, isFlexing]);

  // Draw signal history on canvas at 60fps without React re-renders
  useEffect(() => {
    let rafId;
    const canvas = signalCanvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      const buf = historyRef.current;
      ctx.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = (i / (buf.length - 1)) * w;
        const y = h - (buf[i] / SENSOR_MAX) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const { isFlexing: flex, color } = latestSignalRef.current;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = flex ? color : '#ffffff';
      ctx.shadowBlur = 8;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (!document.getElementById('tailwind-cdn')) {
      const script = document.createElement('script');
      script.id = 'tailwind-cdn';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }
    if (!document.getElementById('soundfont-player-cdn')) {
      const script = document.createElement('script');
      script.id = 'soundfont-player-cdn';
      script.src = 'https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js';
      document.head.appendChild(script);
    }
  }, []);

  const noteIntervals = React.useMemo(() => {
    const freqs = dynamicKeys.map(k => k.freq);
    const nPlay = freqs.length;
    const logMin = Math.log2(freqs[0]);
    const logMax = Math.log2(freqs[nPlay - 1]);
    const zones = [];

    for (let i = 0; i < nPlay; i++) {
      let logLo = i === 0 ? logMin : (Math.log2(freqs[i - 1]) + Math.log2(freqs[i])) / 2;
      let logHi = i === nPlay - 1 ? logMax : (Math.log2(freqs[i]) + Math.log2(freqs[i + 1])) / 2;
      let normLo = (logLo - logMin) / (logMax - logMin || 1);
      let normHi = (logHi - logMin) / (logMax - logMin || 1);

      zones.push({
        min: emgFloor + normLo * (emgCeil - emgFloor),
        max: i === nPlay - 1 ? SENSOR_MAX : emgFloor + normHi * (emgCeil - emgFloor)
      });
    }
    return zones;
  }, [emgFloor, emgCeil, dynamicKeys]);

  const instantKeyIndex = React.useMemo(() => {
    if (processedValue < emgFloor) return -1;
    for (let i = noteIntervals.length - 1; i >= 0; i--) {
      if (processedValue >= noteIntervals[i].min) return i; 
    }
    return -1; 
  }, [processedValue, noteIntervals, emgFloor]);

  const instantKeyRef = useRef(-1);
  const activeKeyRef = useRef(-1);
  useEffect(() => { instantKeyRef.current = instantKeyIndex; }, [instantKeyIndex]);
  useEffect(() => { activeKeyRef.current = activeKeyIndex; }, [activeKeyIndex]);

  useEffect(() => {
    if (!isRhythmic && !isGaming) setActiveKeyIndex(instantKeyIndex);
  }, [instantKeyIndex, isRhythmic, isGaming]);

  useEffect(() => {
    if (isRhythmic && !isGaming) {
      const stepMs = (60000 / bpm) / 2; 
      const timer = setInterval(() => {
        setActiveKeyIndex(instantKeyRef.current);
        setBeatTrigger(b => b + 1); 
      }, stepMs);
      return () => clearInterval(timer);
    }
  }, [isRhythmic, bpm, isGaming]);

  // --- MUSIC GAME ENGINE ---
  useEffect(() => {
    let interval;
    if (isGaming) {
      const currentSong = SONGS.find(s => s.id === gameSongId);
      
      interval = setInterval(() => {
        // Sync active key for visual feedback in game mode
        setActiveKeyIndex(instantKeyRef.current);
        const targetIndex = currentSong.notes[gameStep];

        if (instantKeyRef.current === targetIndex && !isCooldownRef.current) {
          isCooldownRef.current = true;
          setMatchEffect(true);
          setScore(s => s + 10);
          
          // Play the single hit note
          if (audioEnabled && soundfontInstRef.current && audioCtxRef.current) {
            let noteName = dynamicKeys[targetIndex].note;
            noteName = noteName.replace('Eb', 'D#').replace('Ab', 'G#').replace('Bb', 'A#');
            soundfontInstRef.current.play(noteName, audioCtxRef.current.currentTime, { duration: 0.8 });
          }

          setTimeout(() => {
            setMatchEffect(false);
            setGameStep(step => (step + 1) % currentSong.notes.length);
            isCooldownRef.current = false;
          }, 400); // 400ms cooldown before next note can be hit
        }
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isGaming, gameSongId, gameStep, audioEnabled, dynamicKeys]);

  // --- REAL INSTRUMENT ENGINE (SOUNDFONT) ---
  const loadInstrument = async (instId) => {
    if (!audioCtxRef.current || !window.Soundfont) return;
    setIsInstrumentLoading(true);
    try {
      const inst = await window.Soundfont.instrument(audioCtxRef.current, instId, {
        destination: masterGainRef.current
      });
      soundfontInstRef.current = inst;
    } catch(e) {
      console.error("Failed to load instrument", e);
    }
    setIsInstrumentLoading(false);
  };

  const initAudio = async () => {
    if (audioCtxRef.current) return;
    
    if (!window.Soundfont) {
      alert("Still downloading the music library, please wait a second and click again!");
      return;
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Volume Control Node
    const volumeGain = ctx.createGain();
    volumeGain.gain.value = masterVolume;
    volumeGain.connect(ctx.destination);
    volumeGainRef.current = volumeGain;

    // Master Envelope Node (connects to Volume Control)
    const masterGain = ctx.createGain();
    masterGain.gain.value = 1.2;
    masterGain.connect(volumeGain);
    masterGainRef.current = masterGain;

    audioCtxRef.current = ctx;
    await loadInstrument(instrument);
    setAudioEnabled(true);
  };

  const stopAudio = () => {
    if (audioCtxRef.current) {
      if (playingNodeRef.current) playingNodeRef.current.stop();
      audioCtxRef.current.close();
      audioCtxRef.current = null;
      soundfontInstRef.current = null;
      volumeGainRef.current = null;
    }
    setAudioEnabled(false);
  };

  useEffect(() => {
    if (audioEnabled) loadInstrument(instrument);
  }, [instrument, audioEnabled]);

  // Update volume gain in real-time
  useEffect(() => {
    if (volumeGainRef.current && audioCtxRef.current) {
      volumeGainRef.current.gain.setTargetAtTime(masterVolume, audioCtxRef.current.currentTime, 0.05);
    }
  }, [masterVolume]);

  // Audio Playback Loop (Freestyle & Rhythm Modes only)
  useEffect(() => {
    if (!audioEnabled || !soundfontInstRef.current || !audioCtxRef.current) return;
    
    const now = audioCtxRef.current.currentTime;

    // In Gaming mode, we manage audio manually on-hit. Just keep gain up and stop lingering notes.
    if (isGaming) {
      masterGainRef.current.gain.setTargetAtTime(1.0, now, 0.1);
      if (playingNodeRef.current) {
        playingNodeRef.current.stop(now + 0.1);
        playingNodeRef.current = null;
        playingNoteIndexRef.current = -1;
      }
      return; 
    }

    if (!isRhythmic && playingNodeRef.current && activeKeyIndex !== playingNoteIndexRef.current) {
      playingNodeRef.current.stop(now + 0.1);
      playingNodeRef.current = null;
    }

    if (activeKeyIndex !== -1 && activeKeyIndex < dynamicKeys.length) {
      let noteName = dynamicKeys[activeKeyIndex].note;
      noteName = noteName.replace('Eb', 'D#').replace('Ab', 'G#').replace('Bb', 'A#');

      if (isRhythmic) {
        const stepSec = (60000 / bpm) / 2 / 1000;
        soundfontInstRef.current.play(noteName, now, { duration: stepSec });
      } else {
        if (activeKeyIndex !== playingNoteIndexRef.current) {
          playingNodeRef.current = soundfontInstRef.current.play(noteName, now);
          playingNoteIndexRef.current = activeKeyIndex;
        }
      }
    } else {
      playingNoteIndexRef.current = -1;
    }
  }, [activeKeyIndex, instrument, audioEnabled, isRhythmic, bpm, beatTrigger, dynamicKeys, isGaming]);

  // --- 3D THREE.JS INTEGRATION ---
  useEffect(() => {
    let isMounted = true;
    let animationId;
    let scene, camera, renderer;
    let geoOuter, matOuter, meshOuter;
    let geoInner, matInner, meshInner;
    let resizeObserver;

    const initScene = () => {
      if (!isMounted || !threeMountRef.current) return;
      if (threeMountRef.current.children.length > 0) return; 

      try {
        const THREE = window.THREE;
        const container = threeMountRef.current;
        const width = container.clientWidth || 400;
        const height = container.clientHeight || 200;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
        camera.position.z = 4.5;

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(width, height);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); 
        container.appendChild(renderer.domElement);

        geoOuter = new THREE.IcosahedronGeometry(1.2, 1);
        matOuter = new THREE.MeshBasicMaterial({ color: 0x94a3b8, wireframe: true, transparent: true, opacity: 0.5 });
        meshOuter = new THREE.Mesh(geoOuter, matOuter);
        scene.add(meshOuter);

        geoInner = new THREE.OctahedronGeometry(0.7, 0);
        matInner = new THREE.MeshPhongMaterial({ color: 0x94a3b8, flatShading: true, shininess: 100 });
        meshInner = new THREE.Mesh(geoInner, matInner);
        scene.add(meshInner);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight.position.set(5, 5, 5);
        scene.add(dirLight);

        // Pre-allocate to avoid GC pressure every frame
        const outerScaleVec = new THREE.Vector3(1, 1, 1);
        const innerScaleVec = new THREE.Vector3(1, 1, 1);

        const animate = () => {
          if (!isMounted) return;
          animationId = requestAnimationFrame(animate);

          const { value, color, isFlexing } = latestSignalRef.current;
          const norm = value / SENSOR_MAX;

          const speed = 0.002 + (isFlexing ? norm * 0.06 : 0);
          meshOuter.rotation.x += speed;
          meshOuter.rotation.y += speed * 1.2;
          meshInner.rotation.x -= speed * 1.5;
          meshInner.rotation.y -= speed;

          const targetScaleOuter = 1 + norm * 0.5;
          const targetScaleInner = 1 + norm * 1.2;

          outerScaleVec.set(targetScaleOuter, targetScaleOuter, targetScaleOuter);
          innerScaleVec.set(targetScaleInner, targetScaleInner, targetScaleInner);
          meshOuter.scale.lerp(outerScaleVec, 0.1);
          meshInner.scale.lerp(innerScaleVec, 0.1);

          if (color) {
            matOuter.color.setStyle(color);
            matInner.color.setStyle(color);
          }
          matOuter.opacity = 0.3 + (norm * 0.7);

          renderer.render(scene, camera);
        };
        
        animate();
        setEngineState('ready');

        resizeObserver = new ResizeObserver((entries) => {
          if (!camera || !renderer) return;
          for (let entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 10 && height > 10) {
              camera.aspect = width / height;
              camera.updateProjectionMatrix();
              renderer.setSize(width, height, false); 
            }
          }
        });
        resizeObserver.observe(container);

      } catch (err) {
        console.error("WebGL Boot Error:", err);
        setEngineState('error');
      }
    };

    const loadThreeScript = () => {
      return new Promise((resolve, reject) => {
        if (window.THREE) return resolve();
        let script = document.getElementById('three-js-cdn');
        if (script) {
          if (window.THREE) return resolve();
          script.addEventListener('load', resolve);
          script.addEventListener('error', reject);
          return;
        }
        script = document.createElement('script');
        script.id = 'three-js-cdn';
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

    loadThreeScript()
      .then(() => setTimeout(() => { if (isMounted) initScene(); }, 100))
      .catch(() => { if (isMounted) setEngineState('error'); });

    return () => {
      isMounted = false;
      if (animationId) cancelAnimationFrame(animationId);
      if (resizeObserver) resizeObserver.disconnect();
      if (threeMountRef.current && renderer && renderer.domElement) threeMountRef.current.removeChild(renderer.domElement);
      if (geoOuter) geoOuter.dispose();
      if (matOuter) matOuter.dispose();
      if (geoInner) geoInner.dispose();
      if (matInner) matInner.dispose();
      if (renderer) renderer.dispose();
    };
  }, []);

  const calibrate = () => {
    setIsCalibrating(true);
    calDataRef.current = [];
    setTimeout(() => {
      setIsCalibrating(false);
      const data = calDataRef.current;
      if (data.length === 0) return;
      const mean = data.reduce((a, b) => a + b, 0) / data.length;
      const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length;
      const computedFloor = mean + 2 * Math.sqrt(variance);
      setNoiseFloor(Math.round(computedFloor));
      setEmgFloor(Math.min(SENSOR_MAX - 50, Math.round(computedFloor * 1.5)));
    }, 3000);
  };

  const readLoop = async (reader) => {
    let buffer = '';
    while (keepReadingRef.current) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        // Only use the last complete line in the batch to stay current
        for (let i = lines.length - 1; i >= 0; i--) {
          const match = lines[i].match(/Sensor:\s*(\d+)/);
          if (match) { latestRawRef.current = parseInt(match[1], 10); break; }
        }
      } catch (error) {
        console.error('Serial Read Error:', error);
        break;
      }
    }
  };

  const connectSerial = async () => {
    setErrorMessage('');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600, bufferSize: 64 });
      portRef.current = port;
      
      setIsConnected(true);
      setIsSimulating(false);
      keepReadingRef.current = true;
      
      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      readLoop(reader);

      // RAF loop: flush serial ref to React state at 60fps
      const rafLoop = () => {
        if (!keepReadingRef.current) return;
        setRawSensorValue(latestRawRef.current);
        requestAnimationFrame(rafLoop);
      };
      requestAnimationFrame(rafLoop);

    } catch (error) {
      console.error('Serial Connection failed:', error);
      setIsConnected(false);

      if (error.name === 'SecurityError' || error.message.includes('permissions policy')) {
        setErrorMessage("Oops! USB isn't allowed here right now. Copy this code to a local project to use real hardware!");
      } else if (error.name === 'NotFoundError') {
        setErrorMessage("No device selected! Try again.");
      } else {
        setErrorMessage(`Uh oh! USB Error: ${error.message}`);
      }
    }
  };

  const disconnectSerial = async () => {
    keepReadingRef.current = false;
    try { if (readerRef.current) await readerRef.current.cancel(); } catch (e) {}
    setIsConnected(false);
    setRawSensorValue(0);
  };

  useEffect(() => {
    let simInterval;
    if (isSimulating) {
      let time = 0;
      simInterval = setInterval(() => {
        time += 0.05;
        const base = Math.sin(time) * 400 + 450; 
        const noise = Math.random() * 80; 
        setRawSensorValue(Math.max(0, Math.min(SENSOR_MAX, Math.floor(base + noise))));
      }, 50);
    }
    return () => clearInterval(simInterval);
  }, [isSimulating]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-sky-100 text-slate-800 p-4 font-sans selection:bg-sky-300 flex flex-col">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
      
      <div className="w-full h-full flex flex-col space-y-4">
        
        {/* Header */}
        <div className="flex items-center space-x-4 shrink-0">
          <div className="bg-white p-3 rounded-full shadow-lg border-4 border-white">
            <Music className="w-10 h-10 text-sky-500" />
          </div>
          <h1 className="text-4xl font-black text-sky-600 drop-shadow-sm tracking-tight">
            EMG Synth Studio 🎹
          </h1>
        </div>

        {errorMessage && (
          <div className="bg-red-100 border-4 border-red-400 p-4 rounded-3xl flex items-center space-x-3 shadow-lg shrink-0">
            <AlertCircle className="w-8 h-8 text-red-500 shrink-0" />
            <div>
              <h3 className="font-bold text-red-600 text-lg">Connection Blocked!</h3>
              <p className="text-red-500 text-sm font-medium">{errorMessage}</p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-4 flex-1 min-h-0 w-full">
          
          {/* Settings Panel - Narrower and perfectly scrollable if needed */}
          <div className="lg:col-span-3 bg-white rounded-[2rem] p-4 border-4 border-white shadow-2xl flex flex-col gap-4 relative overflow-y-auto custom-scrollbar">
            
            <div className="absolute top-[-20px] right-[-20px] opacity-10 pointer-events-none">
              <Sparkles className="w-32 h-32 text-sky-500" />
            </div>

            {/* Connection & Calibration */}
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center text-slate-700 tracking-wide">
                🎮 Start Here!
              </h2>
              <div className="flex gap-2">
                {!isConnected ? (
                  <button onClick={connectSerial} disabled={!isSupported}
                    className="flex-1 py-2.5 px-3 rounded-2xl flex items-center justify-center space-x-2 text-sm font-bold transition-transform hover:scale-105 active:scale-95 bg-emerald-500 text-white shadow-[0_4px_0_rgb(16,185,129)] disabled:opacity-50 disabled:transform-none"
                  >
                    <Usb className="w-4 h-4" /> <span>Connect</span>
                  </button>
                ) : (
                  <button onClick={disconnectSerial}
                    className="flex-1 py-2.5 px-3 rounded-2xl flex items-center justify-center space-x-2 text-sm font-bold transition-transform hover:scale-105 active:scale-95 bg-red-500 text-white shadow-[0_4px_0_rgb(239,68,68)]"
                  >
                    <XCircle className="w-4 h-4" /> <span>Disconnect</span>
                  </button>
                )}
                <button onClick={() => { if(!isConnected) { setErrorMessage(''); setIsSimulating(!isSimulating); } }} disabled={isConnected}
                  className={`flex-1 py-2.5 px-3 rounded-2xl flex items-center justify-center space-x-2 text-sm font-bold transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:transform-none ${isSimulating ? 'bg-amber-400 text-slate-900 shadow-[0_4px_0_rgb(217,119,6)]' : 'bg-slate-200 text-slate-700 shadow-[0_4px_0_rgb(203,213,225)]'}`}
                >
                  <Activity className="w-4 h-4" /> <span>Pretend</span>
                </button>
              </div>

              <div className="flex items-center gap-3 bg-sky-50 p-2.5 rounded-2xl border-2 border-sky-100">
                <button onClick={calibrate} disabled={isCalibrating || (!isConnected && !isSimulating)}
                  className="py-2 px-3 bg-sky-500 hover:bg-sky-400 disabled:bg-slate-300 text-white text-xs font-black rounded-xl shadow-[0_4px_0_rgb(14,165,233)] disabled:shadow-[0_4px_0_rgb(148,163,184)] transition-all flex items-center gap-2 active:translate-y-1 active:shadow-none"
                >
                  <Crosshair className="w-4 h-4" /> FIND REST
                </button>
                <div className="text-xs font-bold text-sky-600">
                  {isCalibrating ? "Relax..." : `Noise: ${noiseFloor}`}
                </div>
              </div>
            </div>

            <hr className="border-sky-100 border-2 rounded-full shrink-0" />

            {/* Global Thresholds */}
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center text-slate-700 tracking-wide">
                🎚️ Muscle Power Settings
              </h2>
              
              <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl">
                <div className="flex justify-between text-sm font-bold text-slate-600">
                  <span>🚀 Super Boost</span>
                  <span className="text-emerald-500">{gain.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.1" max="5.0" step="0.1" value={gain} onChange={e => setGain(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-3 bg-slate-200 rounded-full appearance-none cursor-pointer" />
              </div>

              <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl">
                <div className="flex justify-between text-sm font-bold text-slate-600">
                  <span>💪 Max Flex Level</span>
                  <span className="text-rose-500">{emgCeil}</span>
                </div>
                <input type="range" min="100" max="1024" value={emgCeil} onChange={e => setEmgCeil(Math.max(emgFloor + 50, parseInt(e.target.value)))}
                  className="w-full accent-rose-500 h-3 bg-slate-200 rounded-full appearance-none cursor-pointer" />
              </div>

              <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl">
                <div className="flex justify-between text-sm font-bold text-slate-600">
                  <span>😴 Resting Level</span>
                  <span className="text-cyan-500">{emgFloor}</span>
                </div>
                <input type="range" min="0" max="800" value={emgFloor} onChange={e => setEmgFloor(Math.min(emgCeil - 50, parseInt(e.target.value)))}
                  className="w-full accent-cyan-500 h-3 bg-slate-200 rounded-full appearance-none cursor-pointer" />
              </div>
            </div>

            <hr className="border-sky-100 border-2 rounded-full shrink-0" />

            {/* Key & Scale Selection */}
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center text-slate-700 tracking-wide">
                🎹 Choose Musical Scale
              </h2>
              <div className="flex gap-2">
                <select
                  value={rootNote}
                  onChange={(e) => setRootNote(e.target.value)}
                  className="flex-1 py-1.5 px-2 bg-slate-100 border-2 border-slate-200 text-slate-700 font-black rounded-xl outline-none focus:border-sky-400 cursor-pointer"
                >
                  {['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map(note => (
                    <option key={note} value={note}>{note} Root</option>
                  ))}
                </select>
                <div className="flex bg-slate-100 rounded-xl p-1 border-2 border-slate-200 flex-1">
                  <button onClick={() => setScaleType('Major')}
                    className={`flex-1 py-1 text-xs font-black rounded-lg transition-all ${scaleType === 'Major' ? 'bg-rose-500 text-white shadow-md transform scale-105' : 'text-slate-500 hover:bg-slate-200'}`}
                  >
                    Major
                  </button>
                  <button onClick={() => setScaleType('Minor')}
                    className={`flex-1 py-1 text-xs font-black rounded-lg transition-all ${scaleType === 'Minor' ? 'bg-indigo-500 text-white shadow-md transform scale-105' : 'text-slate-500 hover:bg-slate-200'}`}
                  >
                    Minor
                  </button>
                </div>
              </div>
            </div>

            <hr className="border-sky-100 border-2 rounded-full shrink-0" />

            {/* Real Instrument Selection */}
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center justify-between text-slate-700 tracking-wide">
                <span>🎺 Choose Sound</span>
                {isInstrumentLoading && <Loader2 className="w-4 h-4 animate-spin text-sky-500" />}
              </h2>
              <div className="grid grid-cols-2 gap-2 bg-slate-100 rounded-2xl p-2 border-2 border-slate-200">
                {REAL_INSTRUMENTS.map((inst) => (
                  <button key={inst.id} onClick={() => setInstrument(inst.id)} disabled={isInstrumentLoading}
                    className={`py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${instrument === inst.id ? 'bg-indigo-500 text-white shadow-md transform scale-105' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <span className="text-base">{inst.icon}</span> <span>{inst.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <hr className="border-sky-100 border-2 rounded-full shrink-0" />

            {/* Rhythm & Quantization */}
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center text-slate-700 tracking-wide">
                🥁 Magic Beat
              </h2>
              <div className="flex bg-slate-100 rounded-2xl p-1 border-2 border-slate-200">
                <button onClick={() => setIsRhythmic(false)} disabled={isGaming}
                  className={`flex-1 py-1.5 text-sm font-black rounded-xl transition-all ${!isRhythmic && !isGaming ? 'bg-emerald-500 text-white shadow-md transform scale-105' : 'text-slate-500 hover:bg-slate-200'} disabled:opacity-50 disabled:transform-none`}
                >
                  Freestyle
                </button>
                <button onClick={() => setIsRhythmic(true)} disabled={isGaming}
                  className={`flex-1 py-1.5 text-sm font-black rounded-xl transition-all ${isRhythmic && !isGaming ? 'bg-amber-500 text-white shadow-md transform scale-105' : 'text-slate-500 hover:bg-slate-200'} disabled:opacity-50 disabled:transform-none`}
                >
                  Beat Lock
                </button>
              </div>

              {isRhythmic && !isGaming && (
                <div className="bg-amber-50 space-y-1.5 p-3 rounded-2xl border-2 border-amber-100 animate-in fade-in duration-200">
                  <div className="flex justify-between text-sm font-bold text-slate-600">
                    <span>⚡ Speed</span>
                    <span className="text-amber-500">{bpm} BPM</span>
                  </div>
                  <input type="range" min="60" max="300" step="1" value={bpm} onChange={e => setBpm(parseInt(e.target.value))}
                    className="w-full accent-amber-500 h-3 bg-white rounded-full appearance-none cursor-pointer" />
                </div>
              )}
            </div>

            {/* Play a Song Game Block */}
            <hr className="border-sky-100 border-2 rounded-full shrink-0" />
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center text-slate-700 tracking-wide">
                🎵 Play A Song!
              </h2>
              
              {!isGaming ? (
                <button onClick={() => { setIsGaming(true); setScore(0); setGameStep(0); }} className="w-full py-3 bg-purple-500 hover:bg-purple-400 text-white text-base font-black rounded-2xl transition-all shadow-[0_6px_0_rgb(147,51,234)] active:shadow-none active:translate-y-1 flex items-center justify-center gap-2">
                  <PlayCircle className="w-5 h-5" /> START GAME!
                </button>
              ) : (
                <div className={`p-4 rounded-3xl border-4 ${matchEffect ? 'border-emerald-400 bg-emerald-50' : 'border-purple-300 bg-purple-50'} transition-colors duration-200 flex flex-col items-center relative overflow-hidden shadow-xl`}>
                  <button onClick={() => setIsGaming(false)} className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors bg-white rounded-full p-1 shadow-sm">
                    <XCircle className="w-5 h-5" />
                  </button>
                  
                  <select
                    value={gameSongId}
                    onChange={(e) => { setGameSongId(e.target.value); setGameStep(0); setScore(0); }}
                    className="w-4/5 py-1 px-2 mb-3 bg-white border-2 border-purple-200 text-purple-700 text-sm font-black rounded-xl outline-none focus:border-purple-400 cursor-pointer text-center"
                  >
                    {SONGS.map(song => (
                      <option key={song.id} value={song.id}>{song.name}</option>
                    ))}
                  </select>

                  <div className="text-xs text-slate-500 font-black tracking-widest uppercase mb-1">Flex to hit:</div>
                  
                  {/* Current Target Note */}
                  <div className={`text-6xl font-black my-1 ${COLOR_MAP[dynamicKeys[SONGS.find(s=>s.id===gameSongId).notes[gameStep]].colorKey].text}`} style={{ textShadow: matchEffect ? '0 0 20px currentColor' : 'none' }}>
                    {dynamicKeys[SONGS.find(s=>s.id===gameSongId).notes[gameStep]].note.replace('Eb','D#').replace('Ab','G#').replace('Bb','A#')}
                  </div>

                  {/* Upcoming Notes Preview */}
                  <div className="flex gap-2 mt-3 opacity-60">
                    {[1, 2, 3].map(offset => {
                      const song = SONGS.find(s=>s.id===gameSongId);
                      const futureIndex = gameStep + offset;
                      if (futureIndex >= song.notes.length) return <div key={offset} className="w-6 h-6 rounded-full bg-slate-200" />;
                      const futureNoteIndex = song.notes[futureIndex];
                      const colors = COLOR_MAP[dynamicKeys[futureNoteIndex].colorKey];
                      return (
                        <div key={offset} className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${colors.bg}`}>
                          {dynamicKeys[futureNoteIndex].note.replace(/[0-9]/g, '')}
                        </div>
                      )
                    })}
                  </div>
                  
                  <div className="w-full flex justify-between items-end mt-4 pt-3 border-t-4 border-purple-200 border-dashed">
                    <span className="text-xs text-slate-500 font-black tracking-widest">SCORE</span>
                    <span className="text-3xl font-black text-amber-500 tabular-nums drop-shadow-md">{score}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Master Volume */}
            <hr className="border-sky-100 border-2 rounded-full shrink-0" />
            <div className="space-y-3 z-10 shrink-0">
              <h2 className="text-base font-black flex items-center text-slate-700 tracking-wide">
                <Volume2 className="w-5 h-5 mr-2 text-sky-500" /> Master Volume
              </h2>
              <div className="bg-slate-50 space-y-1.5 p-3 rounded-2xl">
                <div className="flex justify-between text-sm font-bold text-slate-600">
                  <span>Output Level</span>
                  <span className="text-sky-500">{Math.round(masterVolume * 100)}%</span>
                </div>
                <input type="range" min="0" max="1.5" step="0.05" value={masterVolume} onChange={e => setMasterVolume(parseFloat(e.target.value))}
                  className="w-full accent-sky-500 h-3 bg-slate-200 rounded-full appearance-none cursor-pointer" />
              </div>
            </div>

            {/* Audio Engine Toggle */}
            <div className="mt-auto shrink-0 pt-4 pb-2">
              {!audioEnabled ? (
                <button onClick={initAudio} className="w-full py-3 px-4 bg-sky-500 hover:bg-sky-400 text-white rounded-2xl flex items-center justify-center space-x-2 font-black shadow-[0_6px_0_rgb(14,165,233)] active:shadow-none active:translate-y-1 transition-all text-base">
                  <Volume2 className="w-5 h-5" /> <span>Turn ON Music!</span>
                </button>
              ) : (
                <div className="flex items-center justify-between text-sky-600 bg-sky-100 p-3 rounded-2xl border-4 border-sky-200 font-black">
                  <div className="flex items-center text-base animate-pulse">
                    <Music className="w-5 h-5 mr-2" /> MUSIC IS ON!
                  </div>
                  <button onClick={stopAudio} className="p-1.5 bg-red-100 hover:bg-red-200 text-red-500 rounded-xl transition-colors border-2 border-red-200" title="Turn Off">
                    <Power className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Visualization Panel - Dynamic full width/height */}
          <div className="lg:col-span-9 bg-white rounded-[2rem] p-5 border-4 border-white shadow-2xl flex flex-col h-full min-h-0">
            
            <div className="flex justify-between items-end mb-4 shrink-0">
              <div>
                <div className="text-lg text-slate-700 uppercase tracking-wider font-black">Current Flex 💪</div>
                <div className="text-slate-500 mt-1 font-bold text-sm">
                  {isGaming ? (
                    <span className="text-purple-500 font-black">🎮 SONG MODE ACTIVE</span>
                  ) : (
                    activeKeyIndex !== -1 && activeKeyIndex < dynamicKeys.length ? `PLAYING NOTE: ${dynamicKeys[activeKeyIndex].note}` : 'IDLE (RESTING)'
                  )}
                </div>
              </div>
              <div className={`text-6xl font-black tabular-nums transition-colors duration-200 ${isFlexing ? COLOR_MAP[dynamicKeys[activeKeyIndex].colorKey].text : 'text-slate-300'}`}
                style={{ textShadow: isFlexing ? `0 0 20px ${activeColorHex}60` : 'none' }}>
                {Math.round(processedValue)}
              </div>
            </div>

            {/* TOP VISUALIZER ROW (Expanded to fill space) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 flex-1 min-h-0">
              
              {/* Linear Oscilloscope Plot */}
              <div className="w-full h-full min-h-[12rem] bg-slate-900 rounded-[2rem] border-8 border-slate-800 relative overflow-hidden shadow-inner">
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                  {dynamicKeys.map((key, index) => {
                    const interval = noteIntervals[index];
                    const yTop = 100 - (interval.max / SENSOR_MAX) * 100;
                    const height = ((interval.max - interval.min) / SENSOR_MAX) * 100;
                    
                    // Highlight the specific target note if playing a game
                    let isCurrentNote = activeKeyIndex === index;
                    if (isGaming) {
                       const targetNoteIdx = SONGS.find(s=>s.id===gameSongId).notes[gameStep];
                       isCurrentNote = index === targetNoteIdx;
                    }

                    const hexColor = COLOR_MAP[key.colorKey].hex;
                    const muteColor = "#334155";

                    return (
                      <g key={`zone-${key.note}`}>
                        <rect 
                          x="0" y={yTop} width="100" height={Math.max(0.5, height)} 
                          fill={isCurrentNote ? hexColor : muteColor} 
                          opacity={isCurrentNote ? (isGaming ? "0.6" : "0.4") : "0.2"}
                        />
                        <line x1="0" y1={yTop} x2="100" y2={yTop} stroke={hexColor} strokeWidth="0.4" opacity="0.6" />
                      </g>
                    );
                  })}
                  
                  {/* Signal line drawn on canvas overlay to avoid SVG re-renders */}
                  
                  <line x1="0" y1={100 - (emgCeil/SENSOR_MAX)*100} x2="100" y2={100 - (emgCeil/SENSOR_MAX)*100} stroke="#f43f5e" strokeWidth="1" strokeDasharray="4" />
                  <line x1="0" y1={100 - (emgFloor/SENSOR_MAX)*100} x2="100" y2={100 - (emgFloor/SENSOR_MAX)*100} stroke="#06b6d4" strokeWidth="1" strokeDasharray="4" />
                </svg>
                <canvas ref={signalCanvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} />
              </div>

              {/* 3D Geometric Radial Visualizer */}
              <div 
                className="w-full h-full min-h-[12rem] bg-slate-900 rounded-[2rem] border-8 border-slate-800 relative overflow-hidden shadow-inner flex flex-col items-center justify-center transition-all duration-300"
                style={{ boxShadow: isFlexing ? `inset 0 0 40px ${activeColorHex}40` : 'none' }}
              >
                <div className="absolute top-4 left-4 flex items-center text-xs text-slate-400 font-bold tracking-widest z-10 pointer-events-none">
                  <Hexagon className="w-4 h-4 mr-2" /> 💎 3D POWER GEM
                </div>

                {engineState === 'loading' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 font-bold text-sm z-20">
                    <Activity className="w-6 h-6 mb-2 animate-spin text-sky-400" /> WAKING UP GEM...
                  </div>
                )}
                {engineState === 'error' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-red-500 font-bold text-sm z-20">
                    <AlertCircle className="w-6 h-6 mb-2" />
                    <span>GEM IS SLEEPING</span>
                  </div>
                )}
                
                <div 
                  ref={threeMountRef} 
                  className={`absolute inset-0 w-full h-full z-0 transition-opacity duration-1000 ${engineState === 'ready' ? 'opacity-100' : 'opacity-0'}`} 
                />
              </div>

            </div>

            {/* Toy Piano Keyboard Wrapper */}
            <div className="relative w-full flex gap-2 mt-auto bg-slate-100 p-3 rounded-3xl border-4 border-slate-200 shrink-0">
              {dynamicKeys.map((key, index) => {
                
                let isActive = index === activeKeyIndex;
                if (isGaming) {
                   const targetNoteIdx = SONGS.find(s=>s.id===gameSongId).notes[gameStep];
                   isActive = index === targetNoteIdx; // Highlight target note in game mode
                }

                const colors = COLOR_MAP[key.colorKey];
                
                return (
                  <div 
                    key={key.note}
                    className={`flex-1 h-28 rounded-2xl flex items-end justify-center pb-4 transition-all duration-100 border-4 ${
                      isActive 
                        ? `${colors.bg} ${colors.border} border-b-[8px] border-t-4 translate-y-3 shadow-inner` 
                        : `bg-white border-slate-300 border-b-[16px] shadow-lg hover:-translate-y-1 hover:border-b-[20px]`
                    }`}
                  >
                    <div className="flex flex-col items-center">
                      <span className={`font-black text-xs mb-1 ${isActive ? 'text-white/80' : 'text-slate-300'}`}>
                        {key.freq}
                      </span>
                      <span className={`font-black text-2xl ${isActive ? 'text-white' : colors.text}`}>
                        {key.note.replace(/[0-9]/g, '')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}