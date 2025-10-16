import React from "react";

export default function HomePage() {
  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let headers = { Accept: "application/json" };
        try {
          const t = localStorage.getItem("aesp_token");
          if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
        } catch {}
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setUser(data);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = React.useMemo(() => {
    const name = user?.name || user?.email || "";
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase() || "U";
  }, [user]);

  const handleLogout = async () => {
    try {
      try {
        localStorage.removeItem("aesp_token");
      } catch {}
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    window.location.href = "/login";
  };

  const [open, setOpen] = React.useState(false);
  const toggleOpen = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-indigo-600" />
            <span className="font-semibold">AESP</span>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden sm:flex items-center gap-4 text-sm">
              <a className="hover:text-indigo-600" href="#ai">
                AI Conversation
              </a>
              <a className="hover:text-indigo-600" href="#community">
                Community
              </a>
              <a className="hover:text-indigo-600" href="#reports">
                Reports
              </a>
            </nav>
            <div className="relative">
              <button
                onClick={toggleOpen}
                className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold overflow-hidden border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </button>
              {open && (
                <div
                  className="absolute right-0 mt-2 w-56 rounded-xl border bg-white shadow-lg z-20"
                  onMouseLeave={close}
                >
                  <div className="p-3 flex items-center gap-3 border-b">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold overflow-hidden border border-indigo-200">
                      {user?.avatar ? (
                        <img
                          src={user.avatar}
                          alt="Profile"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{initials}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {user?.name || "User"}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {user?.email || ""}
                      </p>
                    </div>
                  </div>
                  <button className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                    Settings (coming soon)
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Hero / Welcome */}
        <section className="mb-6">
          <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 shadow">
            <h1 className="text-2xl font-bold">Welcome back 👋</h1>
            <p className="mt-1 opacity-90">
              Practice English speaking with AI—confidence grows with every
              session.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="#ai"
                className="inline-flex items-center gap-2 bg-white text-indigo-700 font-medium px-4 py-2 rounded hover:opacity-95"
              >
                <span>Start AI Conversation</span>
              </a>
              <a
                href="#level"
                className="inline-flex items-center gap-2 bg-indigo-500 text-white font-medium px-4 py-2 rounded hover:bg-indigo-400"
              >
                <span>Take Level Test</span>
              </a>
            </div>
          </div>
        </section>

        {/* Quick Actions */}
        <section className="grid md:grid-cols-3 gap-4 mb-6">
          {[
            {
              title: "AI Level Test",
              desc: "10-min initial assessment",
              cta: "Start",
              anchor: "#level",
            },
            {
              title: "AI Conversation",
              desc: "Speak and get instant feedback",
              cta: "Practice",
              anchor: "#ai",
            },
            {
              title: "Community Rooms",
              desc: "Join group speaking rooms",
              cta: "Join",
              anchor: "#community",
            },
          ].map((c) => (
            <a
              key={c.title}
              href={c.anchor}
              className="rounded-xl border bg-white p-4 hover:shadow transition-shadow"
            >
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{c.desc}</p>
              <div className="mt-3 inline-flex items-center gap-2 text-indigo-600 font-medium">
                <span>{c.cta}</span>
                <span>→</span>
              </div>
            </a>
          ))}
        </section>

        {/* Progress & Reports */}
        <section id="reports" className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Weekly Progress</h3>
            <p className="text-sm text-gray-500">Sessions this week</p>
            <div className="mt-4 h-24 rounded bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-700">
              <span className="text-2xl font-bold">3/3</span>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Pronunciation Score</h3>
            <p className="text-sm text-gray-500">Avg. last 5 sessions</p>
            <div className="mt-4 h-24 rounded bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-emerald-700">
              <span className="text-2xl font-bold">86</span>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Vocabulary Growth</h3>
            <p className="text-sm text-gray-500">New words learned</p>
            <div className="mt-4 h-24 rounded bg-gradient-to-br from-amber-100 to-yellow-100 flex items-center justify-center text-amber-700">
              <span className="text-2xl font-bold">+24</span>
            </div>
          </div>
        </section>

        {/* AI Section */}
        <section id="ai" className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2 rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">AI Conversation</h3>
            <p className="text-sm text-gray-500">
              Speak and get real-time feedback
            </p>
            <div className="mt-4 h-48 rounded bg-gray-100 flex items-center justify-center text-gray-500">
              <span>Microphone + waveform placeholder</span>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-500">
                Start
              </button>
              <button className="px-4 py-2 rounded border hover:bg-gray-50">
                Upload Audio
              </button>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Corrections</h3>
            <p className="text-sm text-gray-500">Grammar & vocabulary</p>
            <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
              <li>Use present perfect instead of past simple.</li>
              <li>Pronounce "comfortable" as /ˈkʌmf.tə.bəl/.</li>
              <li>Try synonyms for "good": excellent, effective, solid.</li>
            </ul>
          </div>
        </section>

        {/* Community & Mentors */}
        <section id="community" className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2 rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Community Rooms</h3>
            <p className="text-sm text-gray-500">
              Practice with other learners
            </p>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              {[
                "Travel Talk",
                "Business Pitch",
                "Daily Chat",
                "IELTS Speaking",
              ].map((r) => (
                <div
                  key={r}
                  className="rounded-lg border p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium">{r}</p>
                    <p className="text-xs text-gray-500">
                      6–10 participants · Active
                    </p>
                  </div>
                  <button className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-500">
                    Join
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Mentor Spotlight</h3>
            <p className="text-sm text-gray-500">Top mentors this week</p>
            <ul className="mt-3 space-y-2 text-sm">
              {[
                { name: "Hannah", specialty: "Pronunciation" },
                { name: "Long", specialty: "Fluency" },
                { name: "Chris", specialty: "Business English" },
              ].map((m) => (
                <li key={m.name} className="flex items-center justify-between">
                  <span>
                    {m.name} · {m.specialty}
                  </span>
                  <button className="px-3 py-1 rounded border text-gray-700 hover:bg-gray-50">
                    View
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Packages */}
        <section className="mb-10">
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold mb-1">Upgrade Your Learning</h3>
            <p className="text-sm text-gray-500">
              Choose a package that fits your goals
            </p>
            <div className="mt-4 grid sm:grid-cols-3 gap-3">
              {[
                {
                  name: "Basic",
                  price: "$0",
                  features: ["AI practice", "Weekly report"],
                },
                {
                  name: "Plus",
                  price: "$9/mo",
                  features: ["All Basic", "Mentor feedback", "Community rooms"],
                },
                {
                  name: "Premium",
                  price: "$19/mo",
                  features: ["All Plus", "1:1 Mentor", "Advanced analytics"],
                },
              ].map((p) => (
                <div key={p.name} className="rounded-lg border p-4">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xl mt-1">{p.price}</p>
                  <ul className="mt-2 text-sm text-gray-600 list-disc pl-5 space-y-1">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button className="mt-3 w-full px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-500">
                    Choose
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
