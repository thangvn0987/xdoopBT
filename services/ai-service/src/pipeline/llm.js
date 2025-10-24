function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const m = text && text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (_) {}
    }
    throw new Error("LLM returned non-JSON content");
  }
}

async function scoreWithLLM(openai, payload) {
  const {
    mode,
    language,
    qc,
    referenceText,
    transcriptText,
    words,
    segments,
    alignment,
  } = payload;

  const system = `You are a strict, calibration-aware speech pronunciation rater. 
Given ASR transcript, optional reference text, VAD segments, and lightweight alignment stats, you will assign scores 0-100 for SEG (segmental), PROS (stress & intonation), FLU (fluency), INT (intelligibility), and the adaptive OVERALL. 
Follow these rules exactly:
- Return ONLY JSON. No commentary.
- Obey the formulas:
  SEG = 0.6*(100 - normGOPerr) + 0.4*(100 - 100*PER)
  PROS = 0.5*LexicalStress + 0.5*IntonationStability
  FLU = 0.4*ArticulationRateScore + 0.3*(100 - PausePenalty) + 0.3*DisfluencyScore
  Mode A INT = 100 - 100*WER_adjusted; Mode B INT ~ based on avg ASR confidence proxy and OOV penalty.
- Normalize sub-scores to 0..100. Avoid giving 0 or 100 (use 5..95 unless obviously perfect/bad).
- Provide: topPhonemeIssues (array), exampleWordsStress (array), coachingTips (array of short strings).
- Apply adaptive weights based on expected CEFR (A1/A2, B1/B2, C1+).
- Output MUST include numeric fields and arrays as in the schema below.`;

  const user = {
    mode,
    language,
    qc,
    referenceText,
    transcriptText,
    words: (words || []).slice(0, 500),
    segments: (segments || []).slice(0, 200),
    alignment: alignment || {},
    schema: {
      required: ["scores", "feedback"],
      scoresShape: {
        SEG: "number",
        PROS: "number",
        FLU: "number",
        INT: "number",
        OVERALL: "number",
        weights: {
          SEG: "number",
          PROS: "number",
          FLU: "number",
          INT: "number",
        },
        LexicalStress: "number",
        IntonationStability: "number",
        ArticulationRateScore: "number",
        PausePenalty: "number",
        DisfluencyScore: "number",
        PER: "number",
        normGOPerr: "number",
        WER_adjusted: "number",
        level: "string",
      },
    },
  };

  const prompt = `Mode: ${mode}\nLanguage: ${language}\nQC: ${JSON.stringify(
    qc
  )}\nReference: ${referenceText || ""}\nTranscript: ${
    transcriptText || ""
  }\nAlignment: ${JSON.stringify(
    alignment
  )}\nSegments(sample): ${JSON.stringify(
    (segments || []).slice(0, 5)
  )}\nWords(sample): ${JSON.stringify(
    (words || []).slice(0, 10)
  )}\n\nTask: Compute the numeric scores using the formulas. Where a value is missing (e.g., true GOP), estimate it from alignment stats and typical distributions. Keep outputs consistent and realistic. Return JSON with this shape:\n{\n  \"scores\": {\n    \"SEG\": 0-100, \"PROS\": 0-100, \"FLU\": 0-100, \"INT\": 0-100, \n    \"OVERALL\": 0-100, \"weights\": {\"SEG\":n,\"PROS\":n,\"FLU\":n,\"INT\":n},\n    \"LexicalStress\": 0-100, \"IntonationStability\": 0-100, \n    \"ArticulationRateScore\": 0-100, \"PausePenalty\": 0-100, \"DisfluencyScore\": 0-100,\n    \"PER\": 0-1, \"normGOPerr\": 0-100, \"WER_adjusted\": 0-1, \"level\": \"A1|A2|B1|B2|C1+\"\n  },\n  \"feedback\": {\n    \"topPhonemeIssues\": [..], \n    \"exampleWordsStress\": [..], \n    \"coachingTips\": [..]\n  }\n}`;

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL_TTS || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  const content = resp.choices?.[0]?.message?.content || "{}";
  const j = extractJson(content);
  // Minimal shaping with defaults
  const scores = j.scores || {};
  const feedback = j.feedback || {};
  return { qc, scores, feedback };
}

module.exports = { scoreWithLLM };
