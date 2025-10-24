require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const tmp = require("tmp");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const ffmpeg = require("fluent-ffmpeg");
const {
  convertToWavMono16k,
  getAudioInfo,
  detectSilenceSegments,
} = require("./pipeline/ffmpeg");
const { buildSpeechSegments } = require("./pipeline/vad");
const { transcribeWithOpenAI, approximateWordTimestamps } = require("./pipeline/asr");
const { phonemeizeAndAlign } = require("./pipeline/align");
const { scoreWithLLM } = require("./pipeline/llm");

const app = express();
app.use(cors());
app.use(express.json());

const SERVICE_NAME = process.env.SERVICE_NAME || "ai-service";
const PORT = Number(process.env.PORT) || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHISPER_MODEL = process.env.OPENAI_MODEL_WHISPER || "whisper-1";
const GPT_MODEL = process.env.OPENAI_MODEL_TTS || "gpt-4o-mini"; // reuse env name; model used for text

const upload = multer({ dest: path.join(__dirname, "../tmp") });

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Configure ffmpeg/fluent-ffmpeg binary paths (works in Docker and local)
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

app.get("/", (req, res) => {
  res.json({ service: SERVICE_NAME, message: "Welcome to AESP AI Service" });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    time: new Date().toISOString(),
    openai: !!OPENAI_API_KEY,
  });
});

// New: Pronunciation scoring endpoint
// POST /pronunciation/score
// form-data: audio (file), language, sample_rate_target, reference_text
app.post("/pronunciation/score", upload.single("audio"), async (req, res) => {
  const cleanup = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };
  try {
    if (!OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    if (!req.file) return res.status(400).json({ error: "Missing audio" });
    const language = (req.body?.language || "en-US").toString();
    const referenceText = (req.body?.reference_text || "").toString().trim();
    const mode = referenceText ? "read-aloud" : "free";

    // 1) Ingest & QC
    const wavFile = await convertToWavMono16k(req.file.path);
    const info = await getAudioInfo(wavFile);
    if (!info?.duration || info.duration < 5) {
      cleanup();
      fs.unlink(wavFile, () => {});
      return res.status(400).json({ error: "Audio too short (<5s)" });
    }

    // 2) VAD via silencedetect
    const silences = await detectSilenceSegments(wavFile);
    const segments = buildSpeechSegments(info.duration, silences);

    // 3) ASR (OpenAI whisper) -> text
    const tr = await transcribeWithOpenAI(openai, wavFile, language);
    const transcriptText = tr.text || "";
    const words = approximateWordTimestamps(transcriptText, segments, info.duration);

    // 4) Alignment & phonemeization
    const alignment = phonemeizeAndAlign({
      mode,
      language,
      referenceText,
      transcriptText,
      words,
    });

    // 5) Scoring via LLM only (no local fallback for a lighter project)
    const scoring = await scoreWithLLM(openai, {
      mode,
      language,
      qc: { duration: info.duration, format: info.format, sample_rate: info.sample_rate },
      referenceText,
      transcriptText,
      words,
      segments,
      alignment,
    });

    fs.unlink(wavFile, () => {});
    cleanup();
    return res.json({ ok: true, mode, language, qc: scoring.qc, transcript: transcriptText, words, alignment, scores: scoring.scores, feedback: scoring.feedback });
  } catch (e) {
    console.error("/pronunciation/score error", e);
    cleanup();
    const msg = e?.message || String(e);
    // If AI not available or JSON parse fails, return 503 to indicate service dependency
    const code = /openai|api|model|key|quota|rate|json/i.test(msg) ? 503 : 500;
    return res.status(code).json({ error: msg });
  }
});

// Level test: upload audio, transcribe, analyze, return score and feedback
app.post("/level-test", upload.single("audio"), async (req, res) => {
  const cleanup = () => {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  };
  try {
    if (!OPENAI_API_KEY) {
      cleanup();
      return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ error: "Missing audio file (field 'audio')" });
    }
    const topic = req.body?.topic || "initial-level-test";

    // 1) Transcribe using Whisper
    const fileStream = fs.createReadStream(req.file.path);
    let transcriptText = "";
    try {
      const tr = await openai.audio.transcriptions.create({
        file: fileStream,
        model: WHISPER_MODEL,
        response_format: "json",
        // language: "en" // optional hint
      });
      transcriptText = tr.text || tr.transcription || "";
    } catch (e) {
      cleanup();
      return res
        .status(502)
        .json({ error: "Transcription failed", detail: e.message });
    }

    // 2) Analyze grammar and assign an overall level score (0-100)
    const systemPrompt = `You are an English speaking evaluator. Given a learner's spoken transcript, assess grammar, vocabulary, and fluency. Return a concise JSON with fields: overall_score (0-100 integer), level (A1-C2), issues (array of strings), corrections (array of {from, to}), summary (string). Keep it short.`;
    let analysis;
    try {
      const chat = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Topic: ${topic}\nTranscript: ${transcriptText}`,
          },
        ],
        temperature: 0.2,
      });
      const content = chat.choices?.[0]?.message?.content || "{}";
      // Try parse JSON (model may return JSON or text containing JSON)
      const match = content.match(/\{[\s\S]*\}/);
      analysis = match ? JSON.parse(match[0]) : JSON.parse(content);
    } catch (e) {
      analysis = {
        overall_score: 70,
        level: "B1",
        issues: ["Fallback analysis"],
        corrections: [],
        summary: "Default fallback when model parsing fails.",
      };
    } finally {
      cleanup();
    }

    const ai_score = Math.max(
      0,
      Math.min(100, Math.round(Number(analysis.overall_score) || 70))
    );
    const grammar_feedback = {
      level: analysis.level || "B1",
      issues: Array.isArray(analysis.issues) ? analysis.issues : [],
      corrections: Array.isArray(analysis.corrections)
        ? analysis.corrections
        : [],
      summary: analysis.summary || "",
      topic,
    };

    return res.json({
      ok: true,
      transcript: transcriptText,
      ai_score,
      grammar_feedback,
    });
  } catch (e) {
    cleanup();
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
