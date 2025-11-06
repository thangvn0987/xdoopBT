import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: { main: "#4f46e5" }, // indigo-600
    secondary: { main: "#9333ea" }, // purple-600
  },
  shape: { borderRadius: 12 },
});

export default theme;
