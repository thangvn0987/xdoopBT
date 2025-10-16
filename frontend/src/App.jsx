import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./login/LoginPage";
import HomePage from "./home/HomePage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
