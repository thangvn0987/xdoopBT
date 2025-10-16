import React from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { search } = useLocation();

  React.useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token");
    if (token) {
      try {
        localStorage.setItem("aesp_token", token);
      } catch {}
    }
    navigate("/", { replace: true });
  }, [search, navigate]);

  return null;
}
