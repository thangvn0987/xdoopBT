const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const tmp = require("tmp");

function ffprobeAsync(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

async function getAudioInfo(file) {
  const p = await ffprobeAsync(file);
  const stream = p.streams?.find((s) => s.codec_type === "audio") || {};
  const format = p.format || {};
  return {
    duration: Number(format.duration) || 0,
    sample_rate: Number(stream.sample_rate) || 0,
    channels: Number(stream.channels) || 0,
    codec: stream.codec_name,
    format: format.format_long_name || format.format_name,
  };
}

async function convertToWavMono16k(inputFile) {
  return new Promise((resolve, reject) => {
    const out = tmp.tmpNameSync({ postfix: ".wav" });
    ffmpeg(inputFile)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .on("error", reject)
      .on("end", () => resolve(out))
      .save(out);
  });
}

// Use ffmpeg silencedetect to list silence periods, then we can infer speech segments
async function detectSilenceSegments(
  file,
  silenceThresholdDb = -35,
  minSilence = 0.2
) {
  return new Promise((resolve) => {
    const silences = [];
    let stderr = "";
    ffmpeg(file)
      .audioFilters(
        `silencedetect=noise=${silenceThresholdDb}dB:duration=${minSilence}`
      )
      .format("null")
      .on("stderr", (line) => {
        stderr += line + "\n";
        // parse lines like: silence_start: 1.23 or silence_end: 2.34 | silence_duration: 1.11
        const startMatch = line.match(/silence_start: ([0-9.]+)/);
        const endMatch = line.match(/silence_end: ([0-9.]+)/);
        if (startMatch) {
          silences.push({ type: "start", t: parseFloat(startMatch[1]) });
        } else if (endMatch) {
          const durMatch = line.match(/silence_duration: ([0-9.]+)/);
          silences.push({
            type: "end",
            t: parseFloat(endMatch[1]),
            d: durMatch ? parseFloat(durMatch[1]) : undefined,
          });
        }
      })
      .on("end", () => resolve(silences))
      .on("error", () => resolve(silences))
      .save("/dev/null");
  });
}

module.exports = {
  getAudioInfo,
  convertToWavMono16k,
  detectSilenceSegments,
};
