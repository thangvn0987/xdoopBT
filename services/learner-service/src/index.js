require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const SERVICE_NAME = process.env.SERVICE_NAME || "learner-service";
const PORT = Number(process.env.PORT) || 3000;

app.get("/", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    message: "Welcome to AESP Learner Service",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    time: new Date().toISOString(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
