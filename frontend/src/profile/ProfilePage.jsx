import React from "react";
import {
  Container,
  Grid,
  Card,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  Stack,
  Alert,
} from "@mui/material";

export default function ProfilePage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const [profile, setProfile] = React.useState({
    display_name: "",
    avatar: "",
    short_bio: "",
    current_level: "",
    accent_preference: "",
    email: "",
    name: "",
  });
  const [prefs, setPrefs] = React.useState({
    main_goal: "",
    ai_voice: "",
    favorite_topics: [],
    daily_minutes: 15,
    correction_strictness: "all",
    notification_preferences: {},
  });

  const authHeaders = React.useCallback(() => {
    let headers = { Accept: "application/json" };
    try {
      const t = localStorage.getItem("aesp_token");
      if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
    } catch {}
    return headers;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [pr, pf] = await Promise.all([
          fetch("/api/learners/profile", {
            credentials: "include",
            headers: authHeaders(),
          }),
          fetch("/api/learners/preferences", {
            credentials: "include",
            headers: authHeaders(),
          }),
        ]);
        if (!cancelled) {
          if (pr.ok) setProfile(await pr.json());
          if (pf.ok) setPrefs(await pf.json());
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const onChangeProfile = (k) => (e) =>
    setProfile((p) => ({ ...p, [k]: e.target.value }));
  const onChangePrefs = (k) => (e) =>
    setPrefs((p) => ({ ...p, [k]: e.target.value }));

  const toggleTopic = (topic) => () => {
    setPrefs((p) => {
      const set = new Set(p.favorite_topics || []);
      if (set.has(topic)) set.delete(topic);
      else set.add(topic);
      return { ...p, favorite_topics: Array.from(set) };
    });
  };

  const saveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetch("/api/learners/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          display_name: profile.display_name,
          avatar_url: profile.avatar,
          short_bio: profile.short_bio,
          current_level: profile.current_level,
          accent_preference: profile.accent_preference,
        }),
      });
      await fetch("/api/learners/preferences", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          main_goal: prefs.main_goal || null,
          ai_voice: prefs.ai_voice || null,
          favorite_topics: prefs.favorite_topics || [],
          daily_minutes: Number(prefs.daily_minutes) || 15,
          correction_strictness: prefs.correction_strictness || "all",
          notification_preferences: prefs.notification_preferences || {},
        }),
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Container sx={{ py: 4 }}>Loading…</Container>;

  const topicOptions = [
    "Business",
    "Tech",
    "Travel",
    "Movies & Culture",
    "Daily Life",
  ];

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Your Profile
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Profile
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Display Name"
                  value={profile.display_name || ""}
                  onChange={onChangeProfile("display_name")}
                  fullWidth
                />
                <TextField
                  label="Avatar URL"
                  value={profile.avatar || ""}
                  onChange={onChangeProfile("avatar")}
                  fullWidth
                />
                <TextField
                  label="Short Bio"
                  value={profile.short_bio || ""}
                  onChange={onChangeProfile("short_bio")}
                  fullWidth
                  multiline
                  minRows={3}
                />
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Current Level"
                      placeholder="A2 / B1 / …"
                      value={profile.current_level || ""}
                      onChange={onChangeProfile("current_level")}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Accent Pref"
                      placeholder="en-US / en-GB"
                      value={profile.accent_preference || ""}
                      onChange={onChangeProfile("accent_preference")}
                      fullWidth
                    />
                  </Grid>
                </Grid>
                <Typography variant="caption" color="text.secondary">
                  Account: {profile.name || ""} · {profile.email || ""}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Preferences
              </Typography>
              <Stack spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Main Goal</InputLabel>
                  <Select
                    label="Main Goal"
                    value={prefs.main_goal || ""}
                    onChange={onChangePrefs("main_goal")}
                  >
                    <MenuItem value="">Select…</MenuItem>
                    <MenuItem value="WORK">Work / Interview</MenuItem>
                    <MenuItem value="TRAVEL">Travel</MenuItem>
                    <MenuItem value="EXAM">Exam (IELTS/TOEIC)</MenuItem>
                    <MenuItem value="CONVERSATION">Daily Conversation</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>AI Voice</InputLabel>
                  <Select
                    label="AI Voice"
                    value={prefs.ai_voice || ""}
                    onChange={onChangePrefs("ai_voice")}
                  >
                    <MenuItem value="">Select…</MenuItem>
                    <MenuItem value="en-US-male">Male (US)</MenuItem>
                    <MenuItem value="en-US-female">Female (US)</MenuItem>
                    <MenuItem value="en-GB-female">Female (UK)</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Daily Minutes</InputLabel>
                  <Select
                    label="Daily Minutes"
                    value={String(prefs.daily_minutes ?? 15)}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        daily_minutes: Number(e.target.value),
                      }))
                    }
                  >
                    <MenuItem value="5">5</MenuItem>
                    <MenuItem value="15">15</MenuItem>
                    <MenuItem value="30">30</MenuItem>
                  </Select>
                </FormControl>
                <div>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Topics
                  </Typography>
                  <FormGroup>
                    {topicOptions.map((t) => (
                      <FormControlLabel
                        key={t}
                        control={
                          <Checkbox
                            checked={(prefs.favorite_topics || []).includes(t)}
                            onChange={toggleTopic(t)}
                          />
                        }
                        label={t}
                      />
                    ))}
                  </FormGroup>
                </div>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
        <Button onClick={saveAll} disabled={saving} variant="contained">
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        <Button href="/level-test" variant="outlined">
          Start Level Test
        </Button>
      </Stack>
    </Container>
  );
}
