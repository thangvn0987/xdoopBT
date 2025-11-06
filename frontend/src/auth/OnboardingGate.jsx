import React from "react";
import { Navigate, useLocation } from "react-router-dom";

export default function OnboardingGate({ children }) {
  const [status, setStatus] = React.useState("checking"); // checking | ok | need
  const location = useLocation();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let headers = { Accept: "application/json" };
        try {
          const t = localStorage.getItem("aesp_token");
          if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
        } catch {}
        const res = await fetch("/api/learners/profile", {
          credentials: "include",
          headers,
        });
        if (cancelled) return;
        if (res.status === 404) setStatus("need");
        else setStatus("ok");
      } catch {
        setStatus("ok");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") return null;
  if (status === "need" && location.pathname !== "/onboarding")
    return <Navigate to="/onboarding" replace />;
  return children;
}
