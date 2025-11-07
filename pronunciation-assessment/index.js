require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sdk = require("microsoft-cognitiveservices-speech-sdk");

const app = express();
const PORT = Number(process.env.PORT) || 8085;
const SERVICE_NAME = "pronunciation-assessment";

// TTS Cache: Map from hash(text+voice) -> filename
const ttsCache = new Map();

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

// Initialize TTS cache by scanning existing files
function initTtsCache() {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    let loaded = 0;
    files.forEach((file) => {
      if (file.startsWith("tts_") && file.endsWith(".mp3")) {
        const match = file.match(/^tts_([a-f0-9]{16})\.mp3$/);
        if (match) {
          const cacheKey = match[1];
          ttsCache.set(cacheKey, file);
          loaded++;
        }
      }
    });
    console.log(`[TTS Cache] Loaded ${loaded} cached audio files`);
  } catch (e) {
    console.warn("[TTS Cache] Failed to initialize:", e.message);
  }
}
initTtsCache();

// Serve generated / uploaded audio files (TTS output + user uploads transiently)
app.use("/uploads", express.static(UPLOAD_DIR));

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

// POST /tts { text, voice }
// Synthesizes text to an MP3 file using Azure Speech HTTP API and returns { url }
// Smart caching: same text+voice combination returns cached file
app.post("/tts", async (req, res) => {
  console.log(`[TTS] Request: ${JSON.stringify(req.body)}`);
  try {
    const { text, voice } = req.body || {};
    if (!text || !String(text).trim()) {
      console.log("[TTS] Error: Missing text");
      return res.status(400).json({ error: "Missing text" });
    }

    // Map short voice codes to Azure neural voices
    const VOICE_MAP = {
      "en-US-male": "en-US-GuyNeural",
      "en-US-female": "en-US-JennyNeural",
      "en-GB-female": "en-GB-LibbyNeural",
    };
    const voiceName =
      VOICE_MAP[voice] ||
      VOICE_MAP[process.env.DEFAULT_AI_VOICE] ||
      "en-US-GuyNeural";

    console.log(`[TTS] Using voice: ${voiceName}`);

    // Create cache key from text + voice
    const cacheKey = crypto
      .createHash("sha1")
      .update(`${text.trim()}|${voiceName}`)
      .digest("hex")
      .substring(0, 16);

    const cachedFileName = `tts_${cacheKey}.mp3`;
    const cachedFilePath = path.join(UPLOAD_DIR, cachedFileName);

    // Check if cached file exists and is valid
    if (ttsCache.has(cacheKey) && fs.existsSync(cachedFilePath)) {
      console.log(`[TTS] Cache hit: ${cachedFileName}`);
      return res.json({
        ok: true,
        url: `/api/pronunciation/uploads/${cachedFileName}`,
        voice: voiceName,
        cached: true,
      });
    }

    console.log(`[TTS] Cache miss, generating audio via HTTP API...`);

    // Use Azure Speech HTTP API directly (more reliable than SDK)
    const speechKey = process.env.SPEECH_KEY;
    const speechRegion = process.env.SPEECH_REGION;
    if (!speechKey || !speechRegion) {
      throw new Error("Missing SPEECH_KEY or SPEECH_REGION env var");
    }

    const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${voiceName}'>${text.trim()}</voice></speak>`;
    console.log(`[TTS] SSML: ${ssml}`);

    const azureUrl = `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const azureResponse = await fetch(azureUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
        "User-Agent": "aesp-tts-service",
      },
      body: ssml,
    });

    console.log(`[TTS] Azure response status: ${azureResponse.status}`);

    if (!azureResponse.ok) {
      const errorText = await azureResponse.text();
      console.error(`[TTS] Azure API error: ${errorText}`);
      throw new Error(`Azure TTS failed: ${azureResponse.status} ${errorText}`);
    }

    const audioData = await azureResponse.arrayBuffer();
    console.log(`[TTS] Audio data size: ${audioData.byteLength} bytes`);

    if (!audioData || audioData.byteLength === 0) {
      console.error(`[TTS] Empty audio data from Azure`);
      return res.status(500).json({ error: "Empty audio data" });
    }

    // Save to cache file
    fs.writeFileSync(cachedFilePath, Buffer.from(audioData));
    ttsCache.set(cacheKey, cachedFileName);
    console.log(
      `[TTS] Audio saved to ${cachedFileName}, size: ${audioData.byteLength} bytes`
    );

    res.json({
      ok: true,
      url: `/api/pronunciation/uploads/${cachedFileName}`,
      voice: voiceName,
      cached: false,
    });
  } catch (e) {
    console.error(`[TTS] Unexpected error:`, e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on ${PORT}`);
});
