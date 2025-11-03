require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sdk = require("microsoft-cognitiveservices-speech-sdk");

const app = express();
const PORT = Number(process.env.PORT) || 8085;
const SERVICE_NAME = "pronunciation-assessment";

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: function (origin, cb) {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

// Uploads setup
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

// Azure Speech config
function makeSpeechConfig() {
  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  if (!key || !region) {
    throw new Error("Missing SPEECH_KEY or SPEECH_REGION env var");
  }
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  // Default to en-US for assessment
  speechConfig.speechRecognitionLanguage =
    process.env.SPEECH_LANGUAGE || "en-US";
  return speechConfig;
}

// Health
app.get("/health", (req, res) => {
  const ok = Boolean(process.env.SPEECH_KEY && process.env.SPEECH_REGION);
  res.json({
    status: ok ? "ok" : "misconfigured",
    service: SERVICE_NAME,
    language: process.env.SPEECH_LANGUAGE || "en-US",
    time: new Date().toISOString(),
  });
});

// POST /assess
// multipart/form-data with field name "audio" (wav file) and optional fields:
// - referenceText (string) for scripted assessment; omit for unscripted
// - granularity (Phoneme|Word|FullText) default Phoneme
// - enableMiscue (true/false) default true only when referenceText present
// - phonemeAlphabet (IPA|SAPI) default IPA
// - nBestPhonemeCount (int) default 5
app.post("/assess", upload.single("audio"), async (req, res) => {
  let tempFile = null;
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ error: "Missing audio file (field: audio)" });
    tempFile = req.file.path;

    const {
      referenceText = undefined,
      granularity = "Phoneme",
      enableMiscue = "true",
      phonemeAlphabet = "IPA",
      nBestPhonemeCount = "5",
    } = req.body || {};

    const speechConfig = makeSpeechConfig();
    // Build PA config JSON per docs.
    const cfg = {
      gradingSystem: "HundredMark",
      granularity: ["Phoneme", "Word", "FullText"].includes(granularity)
        ? granularity
        : "Phoneme",
      phonemeAlphabet: ["IPA", "SAPI"].includes(phonemeAlphabet)
        ? phonemeAlphabet
        : "IPA",
      nBestPhonemeCount: Math.max(
        1,
        Math.min(10, parseInt(nBestPhonemeCount, 10) || 5)
      ),
    };
    if (referenceText && String(referenceText).trim().length > 0) {
      cfg.referenceText = String(referenceText);
      cfg.enableMiscue = String(enableMiscue).toLowerCase() === "true";
    }
    const paConfig = sdk.PronunciationAssessmentConfig.fromJSON(
      JSON.stringify(cfg)
    );
    // Prosody assessment when supported
    if (typeof paConfig.enableProsodyAssessment === "function") {
      paConfig.enableProsodyAssessment();
    }

    const audioBuffer = fs.readFileSync(tempFile);
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    paConfig.applyTo(recognizer);

    // Wrap recognizeOnceAsync in a Promise with timeout
    const recognizeOnce = () =>
      new Promise((resolve, reject) => {
        const to = setTimeout(
          () => reject(new Error("Recognition timeout")),
          45000
        );
        recognizer.recognizeOnceAsync(
          (result) => {
            clearTimeout(to);
            resolve(result);
          },
          (err) => {
            clearTimeout(to);
            reject(err);
          }
        );
      });

    const result = await recognizeOnce();
    const paResult = sdk.PronunciationAssessmentResult.fromResult(result);
    const jsonRaw = result.properties.getProperty(
      sdk.PropertyId.SpeechServiceResponse_JsonResult
    );

    res.json({
      ok: true,
      text: result.text,
      scores: {
        accuracyScore: paResult?.accuracyScore ?? null,
        fluencyScore: paResult?.fluencyScore ?? null,
        completenessScore: paResult?.completenessScore ?? null,
        prosodyScore: paResult?.prosodyScore ?? null,
        pronScore: paResult?.pronunciationScore ?? null,
      },
      raw: jsonRaw ? JSON.parse(jsonRaw) : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (tempFile) {
      try {
        fs.unlinkSync(tempFile);
      } catch (_) {}
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on ${PORT}`);
});
