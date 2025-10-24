import React from "react";

export default function ProfilePage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [goals, setGoals] = React.useState("");
  const [interests, setInterests] = React.useState([]);
  const [interestInput, setInterestInput] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  // Keep a snapshot of what is saved on the server so we can
  // show a nice preview and detect unsaved changes.
  const [lastSaved, setLastSaved] = React.useState({
    goals: "",
    interests: [],
  });
  const [savedAt, setSavedAt] = React.useState(null);

  const hasChanges = React.useMemo(() => {
    const norm = (arr) => (Array.isArray(arr) ? arr : []).join("|#|");
    return (
      (goals ?? "").trim() !== (lastSaved.goals ?? "") ||
      norm(interests) !== norm(lastSaved.interests)
    );
  }, [goals, interests, lastSaved]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let headers = { Accept: "application/json" };
        try {
          const t = localStorage.getItem("aesp_token");
          if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
        } catch {}
        const res = await fetch("/api/learners/profiles/me", {
          credentials: "include",
          headers,
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setGoals(data.goals || "");
          setInterests(Array.isArray(data.interests) ? data.interests : []);
          setLastSaved({
            goals: data.goals || "",
            interests: Array.isArray(data.interests) ? data.interests : [],
          });
          setSavedAt(new Date());
        }
      } catch (e) {
        if (!cancelled) setError("Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function addInterestFromInput() {
    const parts = interestInput
      .split(/[\s,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = Array.from(new Set([...interests, ...parts])).slice(0, 30);
    setInterests(next);
    setInterestInput("");
  }

  function removeInterest(i) {
    setInterests((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function onSave() {
    setSaving(true);
    setMessage("");
    setError("");
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000); // 15s timeout
    try {
      let headers = { "Content-Type": "application/json" };
      try {
        const t = localStorage.getItem("aesp_token");
        if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
      } catch {}
      const res = await fetch("/api/learners/profiles/me", {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({ goals, interests }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage("Profile saved");
      setLastSaved({
        goals: (goals ?? "").trim(),
        interests: interests.slice(0),
      });
      setSavedAt(new Date());
    } catch (e) {
      if (e.name === "AbortError") {
        setError("Save timed out. Please try again.");
      } else {
        setError(e.message || "Save failed");
      }
    } finally {
      clearTimeout(id);
      setSaving(false);
      setTimeout(() => setMessage(""), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Learning Profile</h1>
          <p className="text-sm text-gray-600 mt-1">
            Tell us your goals and interests to get better topic suggestions.
          </p>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          {loading ? (
            <div className="text-gray-500">Loading…</div>
          ) : (
            <>
              {/* Goals */}
              <div>
                <label className="block text-sm font-medium">Goals</label>
                <textarea
                  className="mt-1 w-full rounded-xl px-3 py-2 border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 min-h-[120px]"
                  placeholder="e.g., Improve fluency for job interviews, reach IELTS Speaking 6.5, practice daily for 15 minutes"
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                />
              </div>

              {/* Interests */}
              <div className="mt-5">
                <label className="block text-sm font-medium">Interests</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {interests.map((it, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-800 text-xs border border-indigo-100"
                    >
                      {it}
                      <button
                        onClick={() => removeInterest(i)}
                        className="ml-1 text-indigo-600 hover:text-indigo-800"
                        title="Remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded-xl px-3 py-2 border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    placeholder="Add interests (comma or Enter)"
                    value={interestInput}
                    onChange={(e) => setInterestInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addInterestFromInput();
                      }
                    }}
                  />
                  <button
                    onClick={addInterestFromInput}
                    className="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Examples: Travel, Business English, Technology, Movies, IELTS
                </p>
              </div>

              {/* Actions */}
              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={onSave}
                  disabled={saving || !hasChanges}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Profile"}
                </button>
                {hasChanges && !saving && (
                  <span className="text-sm text-amber-600 fade-in-up">
                    Unsaved changes
                  </span>
                )}
                {message && (
                  <span className="text-sm text-emerald-600 fade-in-up">
                    {message}
                  </span>
                )}
                {error && (
                  <span className="text-sm text-red-600 fade-in-up">
                    {error}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {/* Saved preview & tips */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm fade-in-up">
            <h2 className="text-lg font-semibold">Profile Summary</h2>
            <p className="text-xs text-gray-500 mt-1">
              This is what’s currently saved. It updates right after you save.
            </p>
            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700">Goals</div>
              <div className="mt-1 whitespace-pre-line text-gray-800 bg-indigo-50/30 rounded-lg p-3">
                {lastSaved.goals ? (
                  lastSaved.goals
                ) : (
                  <span className="text-gray-400">No goals yet</span>
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700">Interests</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {lastSaved.interests?.length ? (
                  lastSaved.interests.map((it, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-800 text-xs border border-indigo-100"
                    >
                      {it}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-400">No interests yet</span>
                )}
              </div>
            </div>
            <div className="mt-4 text-xs text-gray-500">
              {savedAt
                ? `Last saved: ${new Date(savedAt).toLocaleString()}`
                : "Not saved yet"}
            </div>
          </div>

          {/* Tip card */}
          <div className="rounded-2xl border bg-gradient-to-br from-white to-indigo-50 p-5 shadow-sm slide-in-right">
            <h2 className="text-lg font-semibold">Tips</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-600 space-y-1">
              <li>
                Write specific, measurable goals for better AI suggestions.
              </li>
              <li>Use 5–10 interests to diversify practice topics.</li>
              <li>Changes are saved securely to your profile.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 text-sm text-gray-500">
          Your profile helps us suggest better topics in Level Test and AI
          Conversation.
        </div>
      </div>
    </div>
  );
}
