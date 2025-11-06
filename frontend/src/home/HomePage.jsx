import React from "react";
import {
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  Stack,
  Box,
} from "@mui/material";

export default function HomePage() {
  const [user, setUser] = React.useState(null);
  const [pron, setPron] = React.useState({
    average: null,
    count: 0,
    loading: true,
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let headers = { Accept: "application/json" };
        try {
          const t = localStorage.getItem("aesp_token");
          if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
        } catch {}
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setUser(data);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load Pronunciation average
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let headers = { Accept: "application/json" };
        try {
          const t = localStorage.getItem("aesp_token");
          if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
        } catch {}
        const res = await fetch(
          "/api/learners/metrics/pronunciation/avg?count=5",
          {
            credentials: "include",
            headers,
          }
        );
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setPron({
              average: data.average,
              count: data.count,
              loading: false,
            });
          } else {
            setPron((p) => ({ ...p, loading: false }));
          }
        }
      } catch {
        if (!cancelled) setPron((p) => ({ ...p, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = React.useMemo(() => {
    const name = user?.name || user?.email || "";
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase() || "U";
  }, [user]);

  const handleLogout = async () => {
    try {
      try {
        localStorage.removeItem("aesp_token");
      } catch {}
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    window.location.href = "/login";
  };

  const [open, setOpen] = React.useState(false);
  const toggleOpen = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  return (
    <Box>
      <main>
        {/* Hero / Welcome */}
        <Box
          sx={{
            mb: 3,
            p: 3,
            borderRadius: 2,
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <Typography variant="h5" fontWeight={700}>
            Welcome back 👋
          </Typography>
          <Typography sx={{ opacity: 0.9, mt: 0.5 }}>
            Practice English speaking with AI—confidence grows with every
            session.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
            <Button href="#ai" variant="contained" color="inherit">
              Start AI Conversation
            </Button>
            <Button href="/level-test" variant="outlined" color="inherit">
              Take Level Test
            </Button>
          </Stack>
        </Box>

        {/* Quick Actions */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[
            {
              title: "AI Level Test",
              desc: "10-min initial assessment",
              cta: "Start",
              anchor: "/level-test",
            },
            {
              title: "AI Conversation",
              desc: "Speak and get instant feedback",
              cta: "Practice",
              anchor: "#ai",
            },
            {
              title: "Community Rooms",
              desc: "Join group speaking rooms",
              cta: "Join",
              anchor: "#community",
            },
          ].map((c) => (
            <Grid key={c.title} item xs={12} md={4}>
              <Card
                component="a"
                href={c.anchor}
                sx={{ textDecoration: "none" }}
              >
                <CardContent>
                  <Typography fontWeight={600}>{c.title}</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    {c.desc}
                  </Typography>
                  <Button size="small" sx={{ mt: 1.5 }}>
                    {c.cta}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Progress & Reports */}
        <Grid id="reports" container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  Weekly Progress
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Sessions this week
                </Typography>
                <Box
                  sx={{
                    mt: 2,
                    height: 96,
                    borderRadius: 1,
                    bgcolor: "#EEF2FF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#4338CA",
                  }}
                >
                  <Typography variant="h5" fontWeight={700}>
                    3/3
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  Pronunciation Score
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Avg. last 5 sessions
                </Typography>
                <Box
                  sx={{
                    mt: 2,
                    height: 96,
                    borderRadius: 1,
                    bgcolor: "#D1FAE5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#065F46",
                  }}
                >
                  <Typography variant="h5" fontWeight={700}>
                    {pron.loading
                      ? "…"
                      : pron.average != null
                      ? Math.round(pron.average)
                      : "-"}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.5, display: "block" }}
                >
                  {pron.count} sessions
                </Typography>
                <Button
                  size="small"
                  sx={{ mt: 1.5 }}
                  onClick={async () => {
                    // Demo: log a random sample score 70-95
                    try {
                      let headers = { "Content-Type": "application/json" };
                      try {
                        const t = localStorage.getItem("aesp_token");
                        if (t)
                          headers = {
                            ...headers,
                            Authorization: `Bearer ${t}`,
                          };
                      } catch {}
                      const sample = Math.round(70 + Math.random() * 25);
                      await fetch("/api/learners/metrics/pronunciation", {
                        method: "POST",
                        credentials: "include",
                        headers,
                        body: JSON.stringify({ score: sample }),
                      });
                      // Refresh
                      const res = await fetch(
                        "/api/learners/metrics/pronunciation/avg?count=5",
                        {
                          credentials: "include",
                          headers: {
                            Accept: "application/json",
                            ...(headers.Authorization
                              ? { Authorization: headers.Authorization }
                              : {}),
                          },
                        }
                      );
                      if (res.ok) {
                        const data = await res.json();
                        setPron({
                          average: data.average,
                          count: data.count,
                          loading: false,
                        });
                      }
                    } catch {}
                  }}
                >
                  Log sample score
                </Button>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  Vocabulary Growth
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  New words learned
                </Typography>
                <Box
                  sx={{
                    mt: 2,
                    height: 96,
                    borderRadius: 1,
                    bgcolor: "#FEF3C7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#92400E",
                  }}
                >
                  <Typography variant="h5" fontWeight={700}>
                    +24
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* AI Section */}
        <Grid id="ai" container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  AI Conversation
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Speak and get real-time feedback
                </Typography>
                <Box
                  sx={{
                    mt: 2,
                    height: 192,
                    borderRadius: 1,
                    bgcolor: "grey.100",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "text.secondary",
                  }}
                >
                  <Typography variant="body2">
                    Microphone + waveform placeholder
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
                  <Button variant="contained">Start</Button>
                  <Button variant="outlined">Upload Audio</Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  Corrections
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Grammar & vocabulary
                </Typography>
                <Box component="ul" sx={{ mt: 1.5, pl: 3 }}>
                  <li>Use present perfect instead of past simple.</li>
                  <li>Pronounce "comfortable" as /ˈkʌmf.tə.bəl/.</li>
                  <li>Try synonyms for "good": excellent, effective, solid.</li>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Community & Mentors */}
        <Grid id="community" container spacing={2} sx={{ mb: 4 }}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  Community Rooms
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Practice with other learners
                </Typography>
                <Grid container spacing={1.5} sx={{ mt: 1 }}>
                  {[
                    "Travel Talk",
                    "Business Pitch",
                    "Daily Chat",
                    "IELTS Speaking",
                  ].map((r) => (
                    <Grid key={r} item xs={12} sm={6}>
                      <Card>
                        <CardContent
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div>
                            <Typography fontWeight={600}>{r}</Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              6–10 participants · Active
                            </Typography>
                          </div>
                          <Button size="small" variant="contained">
                            Join
                          </Button>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography fontWeight={600} gutterBottom>
                  Mentor Spotlight
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Top mentors this week
                </Typography>
                <Box component="ul" sx={{ mt: 1.5, pl: 2 }}>
                  {[
                    { name: "Hannah", specialty: "Pronunciation" },
                    { name: "Long", specialty: "Fluency" },
                    { name: "Chris", specialty: "Business English" },
                  ].map((m) => (
                    <Box
                      key={m.name}
                      component="li"
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        py: 0.5,
                      }}
                    >
                      <span>
                        {m.name} · {m.specialty}
                      </span>
                      <Button size="small" variant="outlined">
                        View
                      </Button>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Packages */}
        <Box sx={{ mb: 6 }}>
          <Card>
            <CardContent>
              <Typography fontWeight={600} gutterBottom>
                Upgrade Your Learning
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Choose a package that fits your goals
              </Typography>
              <Grid container spacing={1.5} sx={{ mt: 1 }}>
                {[
                  {
                    name: "Basic",
                    price: "$0",
                    features: ["AI practice", "Weekly report"],
                  },
                  {
                    name: "Plus",
                    price: "$9/mo",
                    features: [
                      "All Basic",
                      "Mentor feedback",
                      "Community rooms",
                    ],
                  },
                  {
                    name: "Premium",
                    price: "$19/mo",
                    features: ["All Plus", "1:1 Mentor", "Advanced analytics"],
                  },
                ].map((p) => (
                  <Grid key={p.name} item xs={12} sm={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography fontWeight={600}>{p.name}</Typography>
                        <Typography variant="h6" sx={{ mt: 0.5 }}>
                          {p.price}
                        </Typography>
                        <Box component="ul" sx={{ mt: 1.5, pl: 2 }}>
                          {p.features.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </Box>
                        <Button fullWidth variant="contained" sx={{ mt: 1.5 }}>
                          Choose
                        </Button>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Box>
      </main>
    </Box>
  );
}
