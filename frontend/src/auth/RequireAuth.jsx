import React from "react";
import { Navigate } from "react-router-dom";

export default function RequireAuth({ children }) {
  const [status, setStatus] = React.useState("checking"); // checking | authed | guest

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) Try localStorage token
      let token = null;
      try {
        token = localStorage.getItem("aesp_token");
      } catch {}
      if (token) {
        if (!cancelled) return setStatus("authed");
      }
      // 2) Fallback to cookie-based session
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!cancelled) setStatus(res.ok ? "authed" : "guest");
      } catch (e) {
        if (!cancelled) setStatus("guest");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") return null; // or a loader
  if (status === "guest") return <Navigate to="/login" replace />;
  return children;
}
