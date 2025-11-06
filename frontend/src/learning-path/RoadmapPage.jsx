import React, { useEffect, useMemo, useState } from "react";
import {
  Grid,
  Card,
  CardContent,
  CardActions,
  Typography,
  Chip,
  Button,
  Stack,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  Alert,
} from "@mui/material";

function StatusChip({ status }) {
  const color =
    status === "completed"
      ? "success"
      : status === "unlocked"
      ? "primary"
      : "default";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Chip size="small" color={color} label={label} />;
}

export default function RoadmapPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [startOpen, setStartOpen] = useState(false);
  const [startMsg, setStartMsg] = useState("");
  const [pendingLesson, setPendingLesson] = useState(null);
  const [score, setScore] = useState("");
  const unlockedCount = useMemo(
    () => items.filter((i) => i.status === "unlocked").length,
    [items]
  );

  async function parseJsonSafe(resp) {
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      return await resp.json();
    }
    // Fallback: read text and throw a helpful error
    const text = await resp.text();
    throw new Error(
      `Unexpected response (${resp.status} ${resp.statusText}): ${text.slice(
        0,
        200
      )}`
    );
  }

  // Gateway fallback: prefer v1 route, fallback to older /api/learners proxy path
  const API_BASES = ["/api/v1/learning-path", "/api/learners/learning-path"];
  async function fetchWithFallback(path, init) {
    let lastErr = null;
    for (const base of API_BASES) {
      try {
        const resp = await fetch(`${base}${path}`, init);
        const data = await parseJsonSafe(resp);
        return { resp, data };
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    throw lastErr || new Error("All API bases failed");
  }

  async function loadRoadmap() {
    setLoading(true);
    setError("");
    try {
      const { resp, data } = await fetchWithFallback("/roadmap", {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(data?.error || "Failed to load roadmap");
      setItems(data.roadmap || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRoadmap();
  }, []);

  async function handleStartPractice(lesson) {
    try {
      setError("");
      setPendingLesson(lesson);
      const { resp, data } = await fetchWithFallback("/start-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lesson_id: lesson.lesson_id }),
      });
      if (!resp.ok) throw new Error(data?.error || "Start practice failed");
      setStartMsg(data.start_message || "");
      setStartOpen(true);
    } catch (e) {
      setError(e.message);
      setPendingLesson(null);
    }
  }

  async function handleComplete() {
    if (!pendingLesson) return setStartOpen(false);
    try {
      setError("");
      const numScore = score === "" ? null : Number(score);
      if (
        numScore != null &&
        (Number.isNaN(numScore) || numScore < 0 || numScore > 100)
      ) {
        throw new Error("Score must be between 0 and 100");
      }
      const { resp, data } = await fetchWithFallback("/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lesson_id: pendingLesson.lesson_id,
          score: numScore,
        }),
      });
      if (!resp.ok) throw new Error(data?.error || "Complete failed");
      setStartOpen(false);
      setPendingLesson(null);
      setScore("");
      await loadRoadmap();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Typography variant="h5" fontWeight={600}>
          Your Learning Roadmap
        </Typography>
        <Button variant="outlined" onClick={loadRoadmap} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          {items.map((item) => (
            <Grid key={item.lesson_id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ mb: 1 }}
                  >
                    <StatusChip status={item.status} />
                    {item.score != null ? (
                      <Chip
                        size="small"
                        color="success"
                        label={`Score: ${Math.round(item.score)}`}
                      />
                    ) : null}
                  </Stack>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Lesson {item.order_in_path}
                  </Typography>
                  <Typography variant="h6">{item.title}</Typography>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2 }}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={item.status !== "unlocked"}
                    onClick={() => handleStartPractice(item)}
                  >
                    Start
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={item.status !== "completed"}
                    onClick={() => {
                      // allow re-practice flow
                      handleStartPractice(item);
                    }}
                  >
                    Practice again
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog
        open={startOpen}
        onClose={() => setStartOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Practice kickoff</DialogTitle>
        <DialogContent>
          <Typography sx={{ whiteSpace: "pre-wrap", mb: 2 }}>
            {startMsg}
          </Typography>
          <TextField
            label="Score (0-100)"
            type="number"
            fullWidth
            size="small"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            inputProps={{ min: 0, max: 100 }}
            helperText="Optional: set a score to mark as completed right away"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStartOpen(false)}>Close</Button>
          <Button variant="contained" onClick={handleComplete}>
            Mark complete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
