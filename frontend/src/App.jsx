import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./login/LoginPage";
import HomePage from "./home/HomePage";
import RequireAuth from "./auth/RequireAuth";
import AuthCallback from "./auth/AuthCallback";
import LevelTest from "./level/LevelTest";
import ProfilePage from "./profile/ProfilePage";
import Onboarding from "./onboarding/Onboarding";
import AppShell from "./components/AppShell";
import OnboardingGate from "./auth/OnboardingGate";
import RoadmapPage from "./learning-path/RoadmapPage";
import SubscriptionPage from "./plans/SubscriptionPage";
import ChatLessonPage from "./learning-path/ChatLessonPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Protected routes inside AppShell and onboarding gate */}
      <Route
        element={
          <RequireAuth>
            <OnboardingGate>
              <AppShell />
            </OnboardingGate>
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/roadmap" element={<RoadmapPage />} />
  <Route path="/lesson/:lessonId/chat" element={<ChatLessonPage />} />
        <Route path="/plans" element={<SubscriptionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/level-test" element={<LevelTest />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
