const fs = require("fs");

async function transcribeWithOpenAI(openai, wavFile, language) {
  const fileStream = fs.createReadStream(wavFile);
  const tr = await openai.audio.transcriptions.create({
    file: fileStream,
    model: process.env.OPENAI_MODEL_WHISPER || "whisper-1",
    response_format: "json",
    // language, // hint only; OpenAI can auto-detect
  });
  return tr;
}

function approximateWordTimestamps(text, segments, totalDur) {
  const words = (text || "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!words.length) return [];
  const speechDur =
    segments.reduce((s, x) => s + (x.dur || x.end - x.start), 0) ||
    totalDur ||
    1;
  const avgWordDur = speechDur / words.length;
  const result = [];
  let t = segments.length ? segments[0].start : 0;
  let segIdx = 0;
  for (const w of words) {
    if (segments.length) {
      const seg = segments[segIdx] || segments[segments.length - 1];
      if (t + avgWordDur > seg.end && segIdx < segments.length - 1) {
        segIdx++;
        t = Math.max(t, segments[segIdx].start);
      }
    }
    const start = t;
    const end = t + avgWordDur;
    t = end;
    result.push({ word: w, start, end, confidence: 0.7 });
  }
  return result;
}

module.exports = { transcribeWithOpenAI, approximateWordTimestamps };
