import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./login/LoginPage";
import HomePage from "./home/HomePage";
import RequireAuth from "./auth/RequireAuth";
import AuthCallback from "./auth/AuthCallback";
import LevelTest from "./level/LevelTest";
import ProfilePage from "./profile/ProfilePage";
import SubscriptionPage from "./plans/SubscriptionPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/level-test"
        element={
          <RequireAuth>
            <LevelTest />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/plans"
        element={
          <RequireAuth>
            <SubscriptionPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
