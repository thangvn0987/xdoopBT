import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Stack,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Divider,
  RadioGroup,
  FormControlLabel,
  Radio,
  CircularProgress,
  Avatar,
} from "@mui/material";

// Reuse audio capture from LevelTest patterns
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

  const buffer = new ArrayBuffer(44 + pcmFloat.length * 2);
  const view = new DataView(buffer);
  function writeString(off, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
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
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, dstRate, true);
  view.setUint32(28, dstRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcmFloat.length * 2, true);
  floatTo16BitPCM(view, 44, pcmFloat);
  const wavBlob = new Blob([view], { type: "audio/wav" });
  await ctx.close();
  return wavBlob;
}

export default function ChatLessonPage() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = React.useState("scripted");
  const [starting, setStarting] = React.useState(false);
  const [session, setSession] = React.useState(null); // {id, mode, target_learner_turns}
  const [messages, setMessages] = React.useState([]); // [{role,text,tts_url,learner_hint}]
  const [recording, setRecording] = React.useState(false);
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const audioRef = React.useRef(null);

  const authHeaders = React.useMemo(() => {
    let headers = { Accept: "application/json" };
    try {
      const t = localStorage.getItem("aesp_token");
      if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
    } catch {}
    return headers;
  }, []);

  const startSession = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/learners/learning-path/lessons/${lessonId}/start`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ mode, turns: 4 }),
      });
      if (!res.ok) throw new Error("Start failed");
      const data = await res.json();
      setSession(data.session);
      setMessages([{ role: "ai", text: data.ai.text, tts_url: data.ai.tts_url, hint: data.learner_hint || null }]);
    } catch (e) {
      alert(e.message || "Failed to start session");
    } finally {
      setStarting(false);
    }
  };

  const play = (url) => {
    try {
      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      audioRef.current.play();
    } catch {}
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks = [];
      mr.ondataavailable = e => e.data && chunks.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        await submitTurn(blob);
      };
      mr.start();
      setMediaRecorder(mr);
      setRecording(true);
    } catch (e) {
      alert("Cannot access microphone: " + e.message);
    }
  };
  const stopRec = () => {
    try { mediaRecorder?.stop(); mediaRecorder?.stream?.getTracks().forEach(t=>t.stop()); } catch {}
    setRecording(false);
  };

  const submitTurn = async (webm) => {
    try {
      const wav = await webmToWavBlob(webm, 16000);
      const fd = new FormData();
      fd.append("audio", wav, "turn.wav");
      const last = messages[messages.length - 1];
      const scripted = session?.mode === "scripted" && last?.role === "ai" && last?.hint;
      if (scripted) {
        fd.append("referenceText", last.hint);
        fd.append("granularity", "Word");
      }
      const assess = await fetch(`/api/pronunciation/assess`, { method: "POST", body: fd });
      if (!assess.ok) throw new Error("Assessment failed");
      const pa = await assess.json();

      const lr = await fetch(`/api/learners/learning-path/sessions/${session.id}/learner-turn`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ recognized_text: pa.text || "", pa_scores: pa.scores || {} }),
      });
      if (!lr.ok) throw new Error("Turn submit failed");
      const next = await lr.json();
      setMessages(prev => [
        ...prev,
        { role: "learner", text: pa.text || "", score: pa.scores?.pronScore ?? null },
        ...(next.done ? [] : [{ role: "ai", text: next.ai.text, tts_url: next.ai.tts_url, hint: next.learner_hint || null }])
      ]);
      if (next.done) {
        const doneRes = await fetch(`/api/learners/learning-path/sessions/${session.id}/complete`, {
          method: "POST", credentials: "include", headers: authHeaders
        });
        const doneData = doneRes.ok ? await doneRes.json() : { final_score: null };
        alert(`Session completed. Final score: ${doneData.final_score ?? "-"}`);
        // navigate back to roadmap after finish
        navigate("/roadmap");
      }
    } catch (e) {
      alert(e.message || "Failed to submit turn");
    }
  };

  return (
    <Box>
      {!session ? (
        <Card>
          <CardContent>
            <Typography variant="h6">Start Chat Lesson</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Choose mode and begin your guided conversation.
            </Typography>
            <Divider sx={{ my: 2 }} />
            <RadioGroup
              row
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <FormControlLabel value="scripted" control={<Radio />} label="Scripted (AI + Learner prompts)" />
              <FormControlLabel value="ai-only" control={<Radio />} label="AI-only (free learner reply)" />
            </RadioGroup>
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button variant="contained" onClick={startSession} disabled={starting}>
                {starting ? "Starting..." : "Start"}
              </Button>
              <Button variant="outlined" onClick={() => navigate("/roadmap")}>Back</Button>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  {messages.map((m, idx) => (
                    <Stack key={idx} direction="row" spacing={2} alignItems="flex-start">
                      <Avatar>{m.role === 'ai' ? 'AI' : 'U'}</Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{m.text}</Typography>
                        {m.tts_url ? (
                          <Button size="small" sx={{ mt: 0.5 }} onClick={() => play(m.tts_url)}>Play</Button>
                        ) : null}
                        {m.hint ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display:'block', mt: 0.5 }}>
                            Suggested reply: {m.hint}
                          </Typography>
                        ) : null}
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Your turn
                </Typography>
                <Stack direction="row" spacing={2}>
                  {!recording ? (
                    <Button variant="contained" onClick={startRec}>Record</Button>
                  ) : (
                    <Button color="error" variant="contained" onClick={stopRec}>Stop</Button>
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display:'block', mt: 1 }}>
                  We don't store your audio; it is processed transiently for scoring only.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
