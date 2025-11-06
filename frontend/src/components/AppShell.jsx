import React from "react";
import {
  Outlet,
  useNavigate,
  useLocation,
  Link as RouterLink,
} from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  Box,
  Stack,
} from "@mui/material";

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const onLogout = async () => {
    try {
      try {
        localStorage.removeItem("aesp_token");
      } catch {}
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    navigate("/login", { replace: true, state: { from: location } });
  };

  return (
    <Box
      sx={{ minHeight: "100vh", bgcolor: (t) => t.palette.background.default }}
    >
      <AppBar position="sticky" color="primary" enableColorOnDark>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            AESP
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button color="inherit" component={RouterLink} to="/">
              Home
            </Button>
            <Button color="inherit" component={RouterLink} to="/roadmap">
              Roadmap
            </Button>
            <Button color="inherit" component={RouterLink} to="/level-test">
              Level Test
            </Button>
            <Button color="inherit" component={RouterLink} to="/profile">
              Profile
            </Button>
            <Button color="inherit" onClick={onLogout}>
              Logout
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
