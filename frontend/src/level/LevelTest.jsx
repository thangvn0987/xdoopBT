import React from "react";
import {
  Container,
  Grid,
  Card,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Stack,
  Box,
} from "@mui/material";

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
        "Toalk about a memorable experience.",
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
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Grid container justifyContent="space-between" alignItems="center">
        <Grid item>
          <Typography variant="h5" fontWeight={700}>
            AI Level Test
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Speak for ~45–60 seconds. We'll transcribe and analyze your grammar,
            vocabulary, and fluency.
          </Typography>
        </Grid>
        <Grid item sx={{ display: { xs: "none", sm: "block" } }}>
          <Typography variant="caption" color="text.secondary">
            {recording ? "Recording…" : analyzing ? "Analyzing…" : "Ready"}
          </Typography>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        {/* Left: Controls */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Grid container spacing={2} alignItems="flex-end">
                <Grid item xs={12} sm>
                  <TextField
                    fullWidth
                    label="Suggested topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Describe your last trip to the countryside."
                  />
                </Grid>
                <Grid item xs={12} sm={5}>
                  <FormControl fullWidth>
                    <InputLabel>Category</InputLabel>
                    <Select
                      label="Category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {Object.keys(TOPIC_PRESETS).map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              {/* Script controls */}
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth>
                    <InputLabel>Sentences</InputLabel>
                    <Select
                      label="Sentences"
                      value={sentenceCount}
                      onChange={(e) =>
                        setSentenceCount(parseInt(e.target.value, 10))
                      }
                    >
                      {[3, 5, 7, 10].map((n) => (
                        <MenuItem key={n} value={n}>
                          {n}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth>
                    <InputLabel>Length</InputLabel>
                    <Select
                      label="Length"
                      value={lengthHint}
                      onChange={(e) => setLengthHint(e.target.value)}
                    >
                      <MenuItem value="short">Short</MenuItem>
                      <MenuItem value="medium">Medium</MenuItem>
                      <MenuItem value="long">Long</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ display: "flex", alignItems: "end" }}
                >
                  <Button
                    onClick={generateScript}
                    disabled={generating}
                    fullWidth
                    variant="contained"
                    color="success"
                  >
                    {generating ? "Generating..." : "Generate Script"}
                  </Button>
                </Grid>
              </Grid>

              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="wrap"
                sx={{ mt: 1 }}
                aria-label="Topic suggestions"
              >
                {suggestions.map((s) => {
                  const selected = topic === s;
                  return (
                    <Button
                      key={s}
                      size="small"
                      variant={selected ? "contained" : "outlined"}
                      onClick={() => setTopic(s)}
                    >
                      {s}
                    </Button>
                  );
                })}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={pickRandomTopic}
                >
                  Randomize
                </Button>
              </Stack>

              <Grid
                container
                justifyContent="space-between"
                alignItems="center"
                sx={{ mt: 2 }}
              >
                <Grid item>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: recording
                          ? "error.main"
                          : analyzing
                          ? "warning.main"
                          : "success.main",
                      }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {recording
                        ? "Recording"
                        : analyzing
                        ? "Analyzing"
                        : generating
                        ? "Preparing script"
                        : "Idle"}
                    </Typography>
                  </Stack>
                </Grid>
                <Grid item>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    }}
                  >
                    {mmss}
                  </Typography>
                </Grid>
              </Grid>

              {/* Live waveform */}
              <Box
                sx={{
                  mt: 2,
                  height: 112,
                  borderRadius: 2,
                  bgcolor: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 0.5,
                  p: 1.5,
                  overflow: "hidden",
                }}
              >
                {bars.map((h, i) => (
                  <Box
                    key={i}
                    sx={{
                      width: 4,
                      bgcolor: "primary.main",
                      opacity: 0.7,
                      height: `${h}%`,
                    }}
                  />
                ))}
              </Box>

              {/* Script area */}
              <Box sx={{ mt: 2 }}>
                <TextField
                  label="Script to read"
                  placeholder="Click Generate Script or paste your own text here..."
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  This text will be used as reference for pronunciation
                  assessment.
                </Typography>
              </Box>

              <Stack
                direction="row"
                alignItems="center"
                spacing={2}
                sx={{ mt: 2 }}
              >
                {!recording ? (
                  <Button
                    onClick={start}
                    disabled={analyzing}
                    variant="contained"
                  >
                    Start Recording
                  </Button>
                ) : (
                  <Button onClick={stop} color="error" variant="contained">
                    Stop & Analyze
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary">
                  Tip: Aim for 45–60s speaking time.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Results */}
        <Grid item xs={12} md={6}>
          <Card sx={{ position: "relative" }}>
            <CardContent>
              {analyzing && (
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    bgcolor: "rgba(255,255,255,0.7)",
                    backdropFilter: "blur(2px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 2,
                    zIndex: 10,
                  }}
                >
                  <div className="spinner" />
                </Box>
              )}

              {!result ? (
                <Box
                  sx={{
                    minHeight: 280,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    color: "text.secondary",
                    p: 2,
                  }}
                >
                  Your result will appear here after analysis.
                </Box>
              ) : (
                <Stack spacing={2.5}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Box
                      sx={{
                        position: "relative",
                        width: 112,
                        height: 112,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: `conic-gradient(#4f46e5 ${
                          (result.pronScore || 0) * 3.6
                        }deg, #e5e7eb 0deg)`,
                      }}
                    >
                      <Box
                        sx={{
                          position: "absolute",
                          inset: 8,
                          borderRadius: "50%",
                          bgcolor: "background.paper",
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        <Typography variant="h6" color="primary">
                          {Math.round(result.pronScore ?? 0)}
                        </Typography>
                      </Box>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Overall Pronunciation
                      </Typography>
                      <Typography fontWeight={600}>
                        Reference topic: {topic}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Higher is better (0–100)
                      </Typography>
                    </Box>
                  </Stack>

                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" fontWeight={600}>
                            Sub-scores
                          </Typography>
                          <Typography variant="body2">
                            Accuracy: {result.accuracyScore ?? "-"}
                          </Typography>
                          <Typography variant="body2">
                            Fluency: {result.fluencyScore ?? "-"}
                          </Typography>
                          <Typography variant="body2">
                            Completeness: {result.completenessScore ?? "-"}
                          </Typography>
                          <Typography variant="body2">
                            Prosody: {result.prosodyScore ?? "-"}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" fontWeight={600}>
                            Tips
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Improve by speaking clearly, maintaining steady
                            pace, and finishing sentences.
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="body2" fontWeight={600}>
                        Recognized Text
                      </Typography>
                      <Typography
                        sx={{ whiteSpace: "pre-wrap", mt: 1 }}
                        variant="body2"
                      >
                        {result.text || "(empty)"}
                      </Typography>
                    </CardContent>
                  </Card>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
