import React from "react";

export default function LevelTest() {
  const [recording, setRecording] = React.useState(false);
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const [topic, setTopic] = React.useState("Introduce yourself and your goals.");
  const [seconds, setSeconds] = React.useState(0);
  const timerRef = React.useRef(null);
  const [analyzing, setAnalyzing] = React.useState(false);

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
  };

  async function submit(blob) {
    try {
      // 1) Call AI service for analysis
      const fd = new FormData();
      fd.append("audio", blob, "level-test.webm");
      fd.append("topic", topic);

      let headers = {};
      try {
        const t = localStorage.getItem("aesp_token");
        if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
      } catch {}

      const aiRes = await fetch("/api/ai/level-test", {
        method: "POST",
        body: fd,
        headers,
      });
      if (!aiRes.ok) throw new Error("AI service error");
      const aiData = await aiRes.json();

      // 2) Persist to learner-service
      const lsRes = await fetch("/api/learners/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(headers.Authorization ? { Authorization: headers.Authorization } : {}),
        },
        body: JSON.stringify({
          topic: "initial-level-test",
          ai_score: aiData.ai_score,
          transcript: aiData.transcript,
          grammar_feedback: aiData.grammar_feedback,
        }),
        credentials: "include",
      });
      if (!lsRes.ok) throw new Error("Persist error");

      setResult({
        score: aiData.ai_score,
        transcript: aiData.transcript,
        feedback: aiData.grammar_feedback,
      });
    } catch (e) {
      setError(e.message);
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
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">AI Level Test</h1>
            <p className="text-sm text-gray-600 mt-1">
              Speak for ~45–60 seconds. We'll transcribe and analyze your grammar, vocabulary, and fluency.
            </p>
          </div>
          <div className="text-sm text-gray-500 hidden sm:block">{recording ? "Recording…" : analyzing ? "Analyzing…" : "Ready"}</div>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          {/* Left: Controls */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <label className="block text-sm font-medium">Suggested topic</label>
            <input
              className="mt-1 w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Describe your last trip to the countryside."
            />

            <div className="mt-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${recording ? "bg-red-500 animate-pulse" : analyzing ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`}
                />
                <span className="text-sm text-gray-600">{recording ? "Recording" : analyzing ? "Analyzing" : "Idle"}</span>
              </div>
              <div className="text-sm font-mono tabular-nums text-gray-700">{mmss}</div>
            </div>

            {/* Waveform placeholder */}
            <div className="mt-5 h-28 rounded-xl bg-slate-50 border flex items-end gap-1 p-3 overflow-hidden">
              {Array.from({ length: 48 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded bg-indigo-500/70 ${recording ? "wave-bar" : ""}`}
                  style={{ height: recording ? `${10 + ((i * 13) % 60)}%` : `${10 + ((i * 7) % 30)}%` }}
                />
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!recording ? (
                <button
                  onClick={start}
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M8.25 5.75a.75.75 0 0 1 1.06 0l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 0 1-1.06-1.06L13.94 12 8.25 6.81a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                  Start Recording
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M6.75 5.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75V5.25Z" />
                  </svg>
                  Stop & Analyze
                </button>
              )}
              <span className="text-xs text-gray-500">Tip: Aim for 45–60s speaking time.</span>
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
                      background: `conic-gradient(#4f46e5 ${result.score * 3.6}deg, #e5e7eb 0deg)`,
                    }}
                  >
                    <div className="absolute inset-2 rounded-full bg-white grid place-items-center">
                      <div className="text-2xl font-bold text-indigo-700">{result.score}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Overall Score</div>
                    <div className="text-lg font-semibold">Estimated CEFR: {result?.feedback?.level || "-"}</div>
                    <div className="text-xs text-gray-500">Higher is better (0–100)</div>
                  </div>
                </div>

                {/* Summary */}
                {result.feedback?.summary && (
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium">Summary</div>
                    <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{result.feedback.summary}</p>
                  </div>
                )}

                {/* Issues & Corrections */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium">Issues</div>
                    {Array.isArray(result.feedback?.issues) && result.feedback.issues.length > 0 ? (
                      <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                        {result.feedback.issues.map((it, i) => (
                          <li key={i}>{it}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-sm text-gray-500">No significant issues detected.</div>
                    )}
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium">Corrections</div>
                    {Array.isArray(result.feedback?.corrections) && result.feedback.corrections.length > 0 ? (
                      <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                        {result.feedback.corrections.map((c, i) => (
                          <li key={i}>
                            <span className="text-gray-500">{c.from}</span> → <span>{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-sm text-gray-500">No corrections suggested.</div>
                    )}
                  </div>
                </div>

                {/* Transcript */}
                <div className="rounded-xl border p-4">
                  <div className="text-sm font-medium">Transcript</div>
                  <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{result.transcript || "(empty)"}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
