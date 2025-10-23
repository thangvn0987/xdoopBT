import React from "react";

export default function LevelTest() {
  const [recording, setRecording] = React.useState(false);
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const [topic, setTopic] = React.useState(
    "Introduce yourself and your goals."
  );

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
        await submit(blob);
      };
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
          ...(headers.Authorization
            ? { Authorization: headers.Authorization }
            : {}),
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

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold">AI Level Test</h1>
        <p className="text-sm text-gray-600 mt-1">
          Speak for ~45–60 seconds. We'll transcribe and analyze your grammar,
          vocabulary, and fluency.
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium">Suggested topic</label>
          <input
            className="mt-1 w-full border rounded px-3 py-2"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          {!recording ? (
            <button
              onClick={start}
              className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-500"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stop}
              className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-500"
            >
              Stop & Analyze
            </button>
          )}
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        {result && (
          <div className="mt-6 space-y-3">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-500">Overall Score</div>
              <div className="text-3xl font-bold text-indigo-700">
                {result.score}
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-500">Transcript</div>
              <div className="mt-2 whitespace-pre-wrap">
                {result.transcript || "(empty)"}
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-gray-500">Feedback</div>
              <div className="mt-2 space-y-2">
                {result.feedback?.summary && (
                  <div>{result.feedback.summary}</div>
                )}
                {Array.isArray(result.feedback?.issues) &&
                  result.feedback.issues.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-gray-700">
                      {result.feedback.issues.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ul>
                  )}
                {Array.isArray(result.feedback?.corrections) &&
                  result.feedback.corrections.length > 0 && (
                    <div>
                      <div className="text-sm font-medium">Corrections</div>
                      <ul className="list-disc pl-5 text-sm text-gray-700">
                        {result.feedback.corrections.map((c, i) => (
                          <li key={i}>
                            <span className="text-gray-500">{c.from}</span> →{" "}
                            <span>{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
