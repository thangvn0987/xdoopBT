// This service is being refactored with a new strategy.
// The content will be updated shortly.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const fs = require("fs");
const multer = require("multer");
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
const {
  transcribeWithOpenAI,
  approximateWordTimestamps,
} = require("./pipeline/asr");
const { phonemeizeAndAlign } = require("./pipeline/align");
const { scoreWithLLM } = require("./pipeline/llm");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SERVICE_NAME = "ai-service";

app.use(cors());
app.use(express.json());

// OpenAI-compatible client (Gemini via provider's OpenAI API)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Multer temp upload dir
const upload = multer({ dest: "/tmp" });

// Configure ffmpeg/fluent-ffmpeg binary paths (works in Docker and local)
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

app.get("/", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    message:
      "AI utilities online. Use /generate-script to create speaking scripts.",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    time: new Date().toISOString(),
  });
});

// POST /generate-script
// Body: { category?: string, topicHint?: string, sentences?: number, length?: "short"|"medium"|"long", level?: string }
// Returns: { ok: true, text: string }
app.post("/generate-script", async (req, res) => {
  try {
    const {
      category = "General",
      topicHint = "Introduce yourself and your goals.",
      sentences = 5,
      length = "short",
      level = "A2-B1",
    } = req.body || {};

    const nSent = Math.max(1, Math.min(20, parseInt(sentences, 10) || 5));
    const lengthGuides = {
      short: "concise sentences (8-14 words)",
      medium: "moderate sentences (12-20 words)",
      long: "richer sentences (18-28 words)",
    };
    const lengthHint = lengthGuides[length] || lengthGuides.short;

    const system = `You are an expert ESL speaking coach. Generate a clean, plain-English practice script for learners to read aloud. Output plain text only, with line breaks between sentences, no numbering or extra commentary.`;
    const user = `Create an English speaking script for category: ${category}.
Topic hint: ${topicHint}.
Target level: ${level}.
Constraints:
- Exactly ${nSent} sentences.
- Use ${lengthHint}.
- Everyday vocabulary and natural flow.
- Avoid special characters or markdown.

Return only the ${nSent} sentences on separate lines.`;

    const model = process.env.OPENAI_MODEL_TTS || "gemini-2.5-pro";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = (completion.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Empty response from AI provider");

    res.json({ ok: true, text });
  } catch (e) {
    console.error("/generate-script error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// New: Pronunciation scoring endpoint
// POST /pronunciation/score
// form-data: audio (file), language, sample_rate_target, reference_text
app.post("/pronunciation/score", upload.single("audio"), async (req, res) => {
  const cleanup = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };
  try {
    if (!OPENAI_API_KEY)
      return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
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
    const words = approximateWordTimestamps(
      transcriptText,
      segments,
      info.duration
    );

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
      qc: {
        duration: info.duration,
        format: info.format,
        sample_rate: info.sample_rate,
      },
      referenceText,
      transcriptText,
      words,
      segments,
      alignment,
    });

    fs.unlink(wavFile, () => {});
    cleanup();
    return res.json({
      ok: true,
      mode,
      language,
      qc: scoring.qc,
      transcript: transcriptText,
      words,
      alignment,
      scores: scoring.scores,
      feedback: scoring.feedback,
    });
  } catch (e) {
    console.error("/pronunciation/score error", e);
    cleanup();
    const msg = e?.message || String(e);
    const code = /openai|api|model|key|quota|rate|json/i.test(msg) ? 503 : 500;
    return res.status(code).json({ error: msg });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}. Ready for requests.`);
});
