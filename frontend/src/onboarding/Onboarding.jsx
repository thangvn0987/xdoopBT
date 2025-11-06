import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Card,
  CardContent,
  Typography,
  Stack,
  TextField,
  Button,
  Grid,
  Alert,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  FormControlLabel,
  Select,
  MenuItem,
  InputLabel,
  FormGroup,
  Checkbox,
} from "@mui/material";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const [displayName, setDisplayName] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const [primaryGoal, setPrimaryGoal] = React.useState("");
  const [topics, setTopics] = React.useState([]);
  const [aiVoice, setAiVoice] = React.useState("");
  const [dailyMinutes, setDailyMinutes] = React.useState(15);

  const authHeaders = React.useCallback(() => {
    let headers = { Accept: "application/json" };
    try {
      const t = localStorage.getItem("aesp_token");
      if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
    } catch {}
    return headers;
  }, []);

  const toggleTopic = (t) => () => {
    setTopics((arr) => {
      const set = new Set(arr);
      if (set.has(t)) set.delete(t);
      else set.add(t);
      return Array.from(set);
    });
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/learners/onboarding/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          display_name: displayName,
          avatar_url: avatarUrl || undefined,
          primary_goal: primaryGoal || undefined,
          topics,
          ai_voice: aiVoice || undefined,
          daily_goal_minutes: dailyMinutes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed with ${res.status}`);
      }
      navigate("/level-test", { replace: true });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      {step === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h5" fontWeight={600} gutterBottom>
              Chào mừng bạn đến với AESP!
            </Typography>
            <Typography color="text.secondary" gutterBottom>
              Hãy bắt đầu bằng cách tạo hồ sơ học tập của bạn.
            </Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Tên hiển thị"
                placeholder="Ví dụ: Minh Trần"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                fullWidth
              />
              <TextField
                label="Ảnh đại diện (tùy chọn)"
                placeholder="https://..."
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                fullWidth
              />
            </Stack>
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
              <Button variant="contained" onClick={() => setStep(2)}>
                Tiếp tục
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Mục tiêu của bạn là gì?
            </Typography>
            <Typography color="text.secondary" gutterBottom>
              Hãy cho AESP biết lý do bạn học tiếng Anh.
            </Typography>
            <FormControl sx={{ mt: 2 }}>
              <FormLabel>Chọn mục tiêu</FormLabel>
              <RadioGroup
                value={primaryGoal}
                onChange={(e) => setPrimaryGoal(e.target.value)}
              >
                <FormControlLabel
                  value="WORK"
                  control={<Radio />}
                  label="Để phỏng vấn/làm việc"
                />
                <FormControlLabel
                  value="TRAVEL"
                  control={<Radio />}
                  label="Để đi du lịch"
                />
                <FormControlLabel
                  value="EXAM"
                  control={<Radio />}
                  label="Để thi lấy chứng chỉ"
                />
                <FormControlLabel
                  value="CONVERSATION"
                  control={<Radio />}
                  label="Để giao tiếp hàng ngày"
                />
              </RadioGroup>
            </FormControl>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Bạn muốn luyện tập chuyên sâu về chủ đề nào? (có thể chọn nhiều)
            </Typography>
            <Grid container spacing={1} sx={{ mt: 1 }}>
              {[
                "Business",
                "Tech",
                "Travel",
                "Movies & Culture",
                "Daily Life",
              ].map((t) => (
                <Grid item xs={12} sm={6} key={t}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={topics.includes(t)}
                        onChange={toggleTopic(t)}
                      />
                    }
                    label={t}
                  />
                </Grid>
              ))}
            </Grid>

            <Stack
              direction="row"
              justifyContent="space-between"
              sx={{ mt: 3 }}
            >
              <Button variant="outlined" onClick={() => setStep(1)}>
                Quay lại
              </Button>
              <Button variant="contained" onClick={() => setStep(3)}>
                Tiếp tục
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Tùy chỉnh trải nghiệm của bạn
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Giọng AI</InputLabel>
                  <Select
                    label="Giọng AI"
                    value={aiVoice}
                    onChange={(e) => setAiVoice(e.target.value)}
                  >
                    <MenuItem value="">Chọn…</MenuItem>
                    <MenuItem value="en-US-male">Giọng Nam (Anh-Mỹ)</MenuItem>
                    <MenuItem value="en-US-female">Giọng Nữ (Anh-Mỹ)</MenuItem>
                    <MenuItem value="en-GB-female">Giọng Nữ (Anh-Anh)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Mục tiêu luyện tập hàng ngày</InputLabel>
                  <Select
                    label="Mục tiêu luyện tập hàng ngày"
                    value={String(dailyMinutes)}
                    onChange={(e) => setDailyMinutes(Number(e.target.value))}
                  >
                    <MenuItem value="5">5 phút/ngày</MenuItem>
                    <MenuItem value="15">15 phút/ngày</MenuItem>
                    <MenuItem value="30">30 phút/ngày</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}

            <Stack
              direction="row"
              justifyContent="space-between"
              sx={{ mt: 3 }}
            >
              <Button variant="outlined" onClick={() => setStep(2)}>
                Quay lại
              </Button>
              <Button
                variant="contained"
                onClick={finish}
                disabled={saving || !displayName}
              >
                {saving ? "Đang lưu…" : "Lưu và bắt đầu Level Test"}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
