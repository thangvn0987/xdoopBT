// This service is being refactored with a new strategy.
// The content will be updated shortly.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}. Ready for requests.`);
});
