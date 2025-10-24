// Build speech segments from silencedetect events
// Return [{start,end,dur}] with minimum segment length 0.8s
function buildSpeechSegments(totalDuration, silenceEvents, minSeg = 0.8) {
  const silences = silenceEvents || [];
  // Convert to silence ranges
  const ranges = [];
  let lastStart = null;
  for (const e of silences) {
    if (e.type === "start") lastStart = e.t;
    if (e.type === "end" && lastStart != null) {
      ranges.push({ start: lastStart, end: e.t });
      lastStart = null;
    }
  }
  // Build speech by subtracting silences
  const speech = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) speech.push({ start: cursor, end: r.start });
    cursor = r.end;
  }
  if (cursor < totalDuration)
    speech.push({ start: cursor, end: totalDuration });
  // Enforce minimum seg length
  const normalized = speech
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.end) }))
    .filter((s) => s.end - s.start >= minSeg)
    .map((s) => ({ ...s, dur: s.end - s.start }));
  return normalized;
}

module.exports = { buildSpeechSegments };
