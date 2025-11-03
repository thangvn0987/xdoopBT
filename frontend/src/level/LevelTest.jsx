import React from "react";

export default function LevelTest() {
  const [recording, setRecording] = React.useState(false);
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const [topic, setTopic] = React.useState(
    "Introduce yourself and your goals."
  );
  const [reference, setReference] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [sentenceCount, setSentenceCount] = React.useState(5);
  const [lengthHint, setLengthHint] = React.useState("short");
  const [seconds, setSeconds] = React.useState(0);
  const timerRef = React.useRef(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [category, setCategory] = React.useState("General");

  // Live waveform state/refs
  const BAR_COUNT = 48;
  const [bars, setBars] = React.useState(
    Array.from({ length: BAR_COUNT }, () => 10)
  );
  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const freqArrayRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const lastDrawRef = React.useRef(0);

  const TOPIC_PRESETS = React.useMemo(
    () => ({
      General: [
        "Introduce yourself and your goals.",
        "Describe your daily routine.",
        "Talk about a memorable experience.",
        "Share your learning plan for English.",
      ],
      Travel: [
        "Describe your last trip.",
        "Talk about a place you want to visit.",
        "Share your best travel tips.",
      ],
      Business: [
        "Pitch a product in 60 seconds.",
        "Explain your role in your company.",
        "Describe a business challenge you solved.",
      ],
      IELTS: [
        "Describe a piece of technology you find useful.",
        "Talk about a book that influenced you.",
        "Explain an environmental problem in your city.",
      ],
    }),
    []
  );

  const suggestions = TOPIC_PRESETS[category] || [];

  function pickRandomTopic() {
    const pool = suggestions.length ? suggestions : TOPIC_PRESETS.General;
    const next = pool[Math.floor(Math.random() * pool.length)];
    setTopic(next);
  }

  const start = async () => {
    setError("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks = [];
      mr.ondataavailable = (e) => e.data && chunks.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        setAnalyzing(true);
        await submit(blob);
        setAnalyzing(false);
      };
      // Setup Web Audio API for live waveform
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; // -> frequencyBinCount 128
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);
      analyserRef.current = analyser;
      const freqArray = new Uint8Array(analyser.frequencyBinCount);
      freqArrayRef.current = freqArray;

      const draw = (ts) => {
        if (!analyserRef.current || !freqArrayRef.current) {
          rafRef.current = requestAnimationFrame(draw);
          return;
        }
        // throttle ~30fps
        if (!lastDrawRef.current || ts - lastDrawRef.current > 33) {
          lastDrawRef.current = ts;
          analyserRef.current.getByteFrequencyData(freqArrayRef.current);
          const arr = freqArrayRef.current;
          const step = Math.max(1, Math.floor(arr.length / BAR_COUNT));
          const nextBars = new Array(BAR_COUNT).fill(10).map((_, i) => {
            const v = arr[i * step] || 0; // 0..255
            const norm = v / 255; // 0..1
            const h = 8 + norm * 85; // 8%..93%
            return Math.max(8, Math.min(95, Math.round(h)));
          });
          setBars(nextBars);
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      rafRef.current = requestAnimationFrame(draw);
      setSeconds(0);
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setMediaRecorder(mr);
      mr.start();
      setRecording(true);
    } catch (e) {
      setError("Cannot access microphone: " + e.message);
    }
  };

  const stop = () => {
    try {
      mediaRecorder?.stop();
      mediaRecorder?.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    setRecording(false);
    clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
  };

  async function generateScript() {
    setError("");
    setGenerating(true);
    try {
      let headers = { "Content-Type": "application/json" };
      try {
        const t = localStorage.getItem("aesp_token");
        if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
      } catch {}

      const resp = await fetch("/api/ai/generate-script", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category,
          topicHint: topic,
          sentences: sentenceCount,
          length: lengthHint,
          level: "A2-B1",
        }),
      });
      if (!resp.ok) {
        let msg = "Failed to generate script";
        try {
          const j = await resp.json();
          msg = j.error || j.detail || msg;
        } catch {}
        throw new Error(msg);
      }
      const data = await resp.json();
      setReference(data.text || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  // Convert recorded WebM/Opus to 16-bit PCM WAV using Web Audio decode + re-encode
  async function webmToWavBlob(webmBlob, targetSampleRate) {
    const arrayBuf = await webmBlob.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    let audioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuf);
    } catch (e) {
      ctx.close?.();
      throw new Error("Failed to decode audio. Please try again.");
    }
    // Downmix to mono
    const channelData =
      audioBuffer.numberOfChannels > 1
        ? (() => {
            const ch0 = audioBuffer.getChannelData(0);
            const ch1 = audioBuffer.getChannelData(1);
            const out = new Float32Array(audioBuffer.length);
            for (let i = 0; i < out.length; i++) out[i] = (ch0[i] + ch1[i]) / 2;
            return out;
          })()
        : audioBuffer.getChannelData(0);

    const srcRate = audioBuffer.sampleRate;
    const dstRate = targetSampleRate || srcRate;

    // Resample if needed (simple linear interpolation)
    let pcmFloat;
    if (srcRate === dstRate) {
      pcmFloat = channelData;
    } else {
      const ratio = srcRate / dstRate;
      const newLen = Math.round(channelData.length / ratio);
      pcmFloat = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const srcIndex = i * ratio;
        const i0 = Math.floor(srcIndex);
        const i1 = Math.min(channelData.length - 1, i0 + 1);
        const t = srcIndex - i0;
        pcmFloat[i] = channelData[i0] * (1 - t) + channelData[i1] * t;
      }
    }

    // Encode WAV (PCM 16-bit mono)
    const buffer = new ArrayBuffer(44 + pcmFloat.length * 2);
    const view = new DataView(buffer);

    function writeString(off, str) {
      for (let i = 0; i < str.length; i++)
        view.setUint8(off + i, str.charCodeAt(i));
    }
    function floatTo16BitPCM(output, offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, s, true);
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + pcmFloat.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // format PCM
    view.setUint16(22, 1, true); // channels: mono
    view.setUint32(24, dstRate, true); // sample rate
    view.setUint32(28, dstRate * 2, true); // byte rate (sampleRate * blockAlign)
    view.setUint16(32, 2, true); // block align (channels * bytesPerSample)
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, "data");
    view.setUint32(40, pcmFloat.length * 2, true);

    floatTo16BitPCM(view, 44, pcmFloat);

    const wavBlob = new Blob([view], { type: "audio/wav" });
    await ctx.close();
    return wavBlob;
  }

  async function submit(blob) {
    try {
      // Convert WebM to WAV for pronunciation service
      const wav = await webmToWavBlob(blob, 16000); // 16kHz mono PCM

      // 1) Call Pronunciation Assessment API
      const fd = new FormData();
      fd.append("audio", wav, "level-test.wav");
      fd.append("referenceText", reference || topic);
      fd.append("granularity", "Word"); // or Phoneme/FullText

      let headers = {};
      try {
        const t = localStorage.getItem("aesp_token");
        if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
      } catch {}

      const aiRes = await fetch("/api/pronunciation/assess", {
        method: "POST",
        body: fd,
        headers,
      });

      if (!aiRes.ok) {
        let errorBody = "Pronunciation service error";
        try {
          const errJson = await aiRes.json();
          errorBody = errJson.detail || errJson.error || errorBody;
        } catch {}
        throw new Error(errorBody);
      }
      const pa = await aiRes.json();

      setResult({
        pronScore: pa?.scores?.pronScore ?? null,
        accuracyScore: pa?.scores?.accuracyScore ?? null,
        fluencyScore: pa?.scores?.fluencyScore ?? null,
        completenessScore: pa?.scores?.completenessScore ?? null,
        prosodyScore: pa?.scores?.prosodyScore ?? null,
        text: pa?.text || "",
        raw: pa?.raw || null,
      });
    } catch (e) {
      console.error("Submit failed:", e);
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  const mmss = React.useMemo(() => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [seconds]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-gray-900 level-test-container">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">AI Level Test</h1>
            <p className="text-sm text-gray-600 mt-1">
              Speak for ~45–60 seconds. We'll transcribe and analyze your
              grammar, vocabulary, and fluency.
            </p>
          </div>
          <div className="text-sm text-gray-500 hidden sm:block">
            {recording ? "Recording…" : analyzing ? "Analyzing…" : "Ready"}
          </div>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          {/* Left: Controls */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-800">
                  Suggested topic
                </label>
                <input
                  className="mt-1 w-full rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white text-slate-900 placeholder-slate-500 border border-slate-300 shadow-inner"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Describe your last trip to the countryside."
                />
              </div>
              <div className="min-w-[200px]">
                <label className="block text-sm font-medium text-slate-800">
                  Category
                </label>
                <select
                  className="mt-1 w-full rounded-xl px-3 py-2 bg-white text-slate-900 border border-slate-300 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.keys(TOPIC_PRESETS).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Script controls */}
            <div className="mt-3 grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium">Sentences</label>
                <select
                  className="mt-1 w-full border rounded-xl px-3 py-2 bg-white"
                  value={sentenceCount}
                  onChange={(e) =>
                    setSentenceCount(parseInt(e.target.value, 10))
                  }
                >
                  {[3, 5, 7, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Length</label>
                <select
                  className="mt-1 w-full border rounded-xl px-3 py-2 bg-white"
                  value={lengthHint}
                  onChange={(e) => setLengthHint(e.target.value)}
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={generateScript}
                  disabled={generating}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {generating ? "Generating..." : "Generate Script"}
                </button>
              </div>
            </div>

            <div
              className="mt-3 flex flex-wrap gap-2"
              aria-label="Topic suggestions"
            >
              {suggestions.map((s) => {
                const selected = topic === s;
                return (
                  <button
                    key={s}
                    onClick={() => setTopic(s)}
                    aria-pressed={selected}
                    title={s}
                    className={[
                      "px-3 py-1.5 rounded-full text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                      selected
                        ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm hover:shadow-md hover:-translate-y-0.5"
                        : "bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 hover:shadow-sm",
                    ].join(" ")}
                  >
                    {s}
                  </button>
                );
              })}
              <button
                onClick={pickRandomTopic}
                className="px-3 py-1.5 rounded-full text-xs bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 hover:shadow-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 inline-flex items-center gap-1"
                title="Pick a random topic"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25V6.75Zm6.75-.75a.75.75 0 0 0 0 1.5h5.25a.75.75 0 0 0 0-1.5H11.25ZM7.5 9.75A1.5 1.5 0 1 0 7.5 12a1.5 1.5 0 0 0 0-2.25Zm3.75 6A1.5 1.5 0 1 0 12.75 18a1.5 1.5 0 0 0 0-2.25Zm-4.5 1.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" />
                </svg>
                Randomize
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${
                    recording
                      ? "bg-red-500 animate-pulse"
                      : analyzing
                      ? "bg-amber-500 animate-pulse"
                      : "bg-emerald-500"
                  }`}
                />
                <span className="text-sm text-gray-600">
                  {recording
                    ? "Recording"
                    : analyzing
                    ? "Analyzing"
                    : generating
                    ? "Preparing script"
                    : "Idle"}
                </span>
              </div>
              <div className="text-sm font-mono tabular-nums text-gray-700">
                {mmss}
              </div>
            </div>

            {/* Live waveform */}
            <div className="mt-5 h-28 rounded-xl bg-slate-50 border flex items-end gap-1 p-3 overflow-hidden">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className="live-bar w-1 bg-indigo-500/70"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>

            {/* Script area */}
            <div className="mt-5">
              <label className="block text-sm font-medium">
                Script to read
              </label>
              <textarea
                className="mt-1 w-full min-h-[100px] border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="Click Generate Script or paste your own text here..."
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <div className="text-xs text-gray-500 mt-1">
                This text will be used as reference for pronunciation
                assessment.
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!recording ? (
                <button
                  onClick={start}
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5"
                  >
                    <path d="M8.25 5.75a.75.75 0 0 1 1.06 0l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 0 1-1.06-1.06L13.94 12 8.25 6.81a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                  Start Recording
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-500"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5"
                  >
                    <path d="M6.75 5.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75V5.25Z" />
                  </svg>
                  Stop & Analyze
                </button>
              )}
              <span className="text-xs text-gray-500">
                Tip: Aim for 45–60s speaking time.
              </span>
            </div>
          </div>

          {/* Right: Results */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm relative">
            {analyzing && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-2xl z-10">
                <div className="spinner" />
              </div>
            )}

            {!result ? (
              <div className="h-full min-h-[280px] flex items-center justify-center text-center text-gray-500 p-6">
                Your result will appear here after analysis.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Score Gauge */}
                <div className="flex items-center gap-4">
                  <div
                    className="relative w-28 h-28 rounded-full grid place-items-center"
                    style={{
                      background: `conic-gradient(#4f46e5 ${
                        (result.pronScore || 0) * 3.6
                      }deg, #e5e7eb 0deg)`,
                    }}
                  >
                    <div className="absolute inset-2 rounded-full bg-white grid place-items-center">
                      <div className="text-2xl font-bold text-indigo-700">
                        {Math.round(result.pronScore ?? 0)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">
                      Overall Pronunciation
                    </div>
                    <div className="text-lg font-semibold">
                      Reference topic: {topic}
                    </div>
                    <div className="text-xs text-gray-500">
                      Higher is better (0–100)
                    </div>
                  </div>
                </div>
                {/* Sub-scores */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border p-4 space-y-2">
                    <div className="text-sm font-medium">Sub-scores</div>
                    <div className="text-sm text-gray-700">
                      Accuracy: {result.accuracyScore ?? "-"}
                    </div>
                    <div className="text-sm text-gray-700">
                      Fluency: {result.fluencyScore ?? "-"}
                    </div>
                    <div className="text-sm text-gray-700">
                      Completeness: {result.completenessScore ?? "-"}
                    </div>
                    <div className="text-sm text-gray-700">
                      Prosody: {result.prosodyScore ?? "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium">Tips</div>
                    <div className="mt-2 text-sm text-gray-500">
                      Improve by speaking clearly, maintaining steady pace, and
                      finishing sentences.
                    </div>
                  </div>
                </div>

                {/* Transcript */}
                <div className="rounded-xl border p-4">
                  <div className="text-sm font-medium">Recognized Text</div>
                  <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                    {result.text || "(empty)"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
