function logistic(x, k = 0.1, x0 = 0) {
  // 0..100 mapping using logistic-like curve
  const y = 1 / (1 + Math.exp(-k * (x - x0)));
  return Math.max(0, Math.min(100, 100 * y));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function scoreFluency({ duration, segments, words }) {
  const totalSpeech = segments.reduce((s, x) => s + (x.dur || x.end - x.start), 0);
  const totalPause = Math.max(0, duration - totalSpeech);
  const pauses = [];
  let lastEnd = 0;
  for (const seg of segments) {
    if (seg.start > lastEnd) pauses.push(seg.start - lastEnd);
    lastEnd = seg.end;
  }
  if (lastEnd < duration) pauses.push(duration - lastEnd);

  const syllPerWord = 1.4; // heuristic
  const syllables = Math.max(1, Math.round((words?.length || 0) * syllPerWord));
  const articulationRate = totalSpeech > 0 ? syllables / totalSpeech : 0; // syll/s
  const pauseOver200 = pauses.filter((p) => p > 0.2);
  const longPause = pauseOver200.reduce((s, p) => s + p, 0);

  const articulationScore = logistic(articulationRate * 25, 0.1, 50); // tuned heuristic
  const pausePenalty = clamp01(longPause / Math.max(1, duration)) * 100;
  const disfluencyScore = logistic((words?.length || 0), 0.02, 50);

  const FLU = 0.4 * articulationScore + 0.3 * (100 - pausePenalty) + 0.3 * disfluencyScore;
  return { articulationRate, pausePenalty, disfluencyScore, FLU };
}

function scoreSegmental({ per, normGOPerr }) {
  const SEG = 0.6 * (100 - normGOPerr) + 0.4 * (100 - 100 * per);
  return { SEG };
}

function scoreProsody({}) {
  // Placeholder without F0 extraction. Use balanced default and let alignment carry weight.
  const LexicalStress = 65; // default mid
  const IntonationStability = 65;
  const PROS = 0.5 * LexicalStress + 0.5 * IntonationStability;
  return { LexicalStress, IntonationStability, PROS };
}

function scoreIntelligibility({ mode, werAdjusted = 0.2, avgAsrConf = 0.7 }) {
  let INT = 0;
  if (mode === "read-aloud") {
    INT = 100 - 100 * clamp01(werAdjusted);
  } else {
    const oovPenalty = 10 * (1 - clamp01(avgAsrConf));
    INT = Math.max(0, Math.min(100, 100 * clamp01(avgAsrConf) - oovPenalty));
  }
  return { INT };
}

function adaptiveOverall(levelHint, { SEG, PROS, FLU, INT }) {
  let w = { SEG: 0.35, PROS: 0.25, FLU: 0.25, INT: 0.15 }; // default B1–B2
  if (levelHint === "A1" || levelHint === "A2") w = { SEG: 0.2, PROS: 0.1, FLU: 0.3, INT: 0.4 };
  if (levelHint === "C1" || levelHint === "C2") w = { SEG: 0.3, PROS: 0.35, FLU: 0.2, INT: 0.15 };
  const OVERALL = w.SEG * SEG + w.PROS * PROS + w.FLU * FLU + w.INT * INT;
  return { OVERALL, weights: w };
}

function mapCEFR(overall, INT) {
  if (overall > 82) return "C1+";
  if (overall >= 70) return "B2";
  if (overall >= 55) return "B1";
  if (overall >= 40 && INT >= 45) return "A2";
  return "A1";
}

function scoreAll({ mode, duration, segments, words, alignment, qc }) {
  const seg = scoreSegmental(alignment);
  const flu = scoreFluency({ duration, segments, words });
  // WER proxy from word ops
  const totalRef = Math.max(1, alignment.refWords.length);
  const wer = (alignment.wordStats.S + alignment.wordStats.D + alignment.wordStats.I) / totalRef;
  const pros = scoreProsody({});
  const intel = scoreIntelligibility({ mode, werAdjusted: wer, avgAsrConf: 0.7 });

  const levelHint = flu.FLU > 70 ? "B1" : "A2";
  const overall = adaptiveOverall(levelHint, { ...seg, ...pros, ...flu, ...intel });

  // Feedback heuristics
  const feedback = [];
  if (alignment.per > 0.3) feedback.push("Work on individual sounds. Practice minimal pairs like /θ/ vs /t/.");
  if (flu.pausePenalty > 20) feedback.push("Reduce long pauses. Try shadowing 4–7 syllables per run.");

  return {
    qc,
    scores: { ...seg, ...pros, ...flu, ...intel, ...overall },
    feedback,
  };
}

module.exports = { scoreAll };
