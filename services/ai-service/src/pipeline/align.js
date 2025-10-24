const leven = require("leven");

// Very lightweight phonemeizer placeholder for English.
// Maps letters/groups to pseudo-ARPAbet tokens. Not linguistically perfect,
// but provides a stable unit for PER/GOP-like proxies.
function pseudoPhonemes(word) {
  const w = (word || "").toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return [];
  return w
    .replace(/ch/g, "CH")
    .replace(/sh/g, "SH")
    .replace(/th/g, "TH")
    .replace(/ph/g, "F")
    .replace(/ng/g, "NG")
    .split("")
    .map((c) =>
      ({
        a: "AEIOU",
        e: "AEIOU",
        i: "AEIOU",
        o: "AEIOU",
        u: "AEIOU",
        y: "AEIOU",
      }[c] || c.toUpperCase())
    );
}

function wordLevelAlign(refWords, hypWords) {
  const ref = refWords.slice();
  const hyp = hypWords.slice();
  const dp = Array(ref.length + 1)
    .fill(null)
    .map(() => Array(hyp.length + 1).fill(0));
  for (let i = 0; i <= ref.length; i++) dp[i][0] = i;
  for (let j = 0; j <= hyp.length; j++) dp[0][j] = j;
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  // backtrack to get operations
  let i = ref.length,
    j = hyp.length;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ op: "D", ref: ref[i - 1] });
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      ops.push({ op: "I", hyp: hyp[j - 1] });
      j--;
    } else {
      const match = ref[i - 1] === hyp[j - 1];
      ops.push({ op: match ? "M" : "S", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    }
  }
  ops.reverse();
  const stats = { S: 0, D: 0, I: 0, M: 0 };
  ops.forEach((o) => (stats[o.op]++));
  return { ops, stats };
}

function phonemeErrorRate(refWords, hypWords) {
  const refPh = refWords.flatMap(pseudoPhonemes);
  const hypPh = hypWords.flatMap(pseudoPhonemes);
  if (!refPh.length) return 0;
  const dist = leven(refPh.join(" "), hypPh.join(" "));
  return dist / refPh.length;
}

function gopProxy(refWords, hypWords) {
  // GOP proxy: more mismatch -> higher error; bound 0..1
  const per = phonemeErrorRate(refWords, hypWords);
  // invert and clamp to 0..1
  const goodness = Math.max(0, 1 - per);
  return { per, normGOPerr: (1 - goodness) * 100 };
}

function phonemeizeAndAlign({ mode, language, referenceText, transcriptText, words }) {
  const refWords = (referenceText || transcriptText || "")
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z']/g, ""))
    .filter(Boolean);
  const hypWords = (transcriptText || "")
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z']/g, ""))
    .filter(Boolean);
  const align = wordLevelAlign(refWords, hypWords);
  const per = phonemeErrorRate(refWords, hypWords);
  const gop = gopProxy(refWords, hypWords);

  return {
    refWords,
    hypWords,
    wordOps: align.ops,
    wordStats: align.stats,
    per,
    normGOPerr: gop.normGOPerr,
  };
}

module.exports = { phonemeizeAndAlign };
