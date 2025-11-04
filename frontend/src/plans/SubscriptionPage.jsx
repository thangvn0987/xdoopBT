import React from "react";

function currencyVND(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "-";
  try {
    return new Intl.NumberFormat("vi-VN").format(num) + " VND";
  } catch {
    return `${num} VND`;
  }
}

export default function SubscriptionPage() {
  const [plans, setPlans] = React.useState([]);
  const [sub, setSub] = React.useState(null); // {exists, subscription}
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const authHeaders = React.useMemo(() => {
    let headers = { Accept: "application/json" };
    try {
      const t = localStorage.getItem("aesp_token");
      if (t) headers = { ...headers, Authorization: `Bearer ${t}` };
    } catch {}
    return headers;
  }, []);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/learners/subscriptions/plans", {
          credentials: "include",
          headers: authHeaders,
        }),
        fetch("/api/learners/subscriptions/me", {
          credentials: "include",
          headers: authHeaders,
        }),
      ]);
      if (pRes.ok) {
        const p = await pRes.json();
        setPlans(p.plans || []);
      }
      if (sRes.ok) {
        const s = await sRes.json();
        setSub(s);
      }
    } catch (e) {
      setError("Failed to load plans");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  const currentPlanId = sub?.exists ? sub.subscription.plan_id : null;
  const cancelAtPeriodEnd = !!sub?.subscription?.cancel_at_period_end;

  const [quote, setQuote] = React.useState(null);
  const [quoteError, setQuoteError] = React.useState("");
  const [quoteLoading, setQuoteLoading] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);

  async function getQuote(newPlanId) {
    setQuote(null);
    setQuoteError("");
    setQuoteLoading(true);
    try {
      const res = await fetch(
        `/api/learners/subscriptions/upgrade/quote?new_plan_id=${encodeURIComponent(
          newPlanId
        )}`,
        { credentials: "include", headers: authHeaders }
      );
      if (!res.ok) throw new Error("Quote failed");
      const data = await res.json();
      setQuote(data);
      setShowModal(true);
    } catch (e) {
      setQuoteError(e.message || "Quote failed");
    } finally {
      setQuoteLoading(false);
    }
  }

  async function confirmUpgrade(newPlanId) {
    try {
      const res = await fetch(`/api/learners/subscriptions/upgrade`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ new_plan_id: newPlanId }),
      });
      if (!res.ok) {
        let msg = "Upgrade failed";
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {}
        throw new Error(msg);
      }
      await refresh();
      setShowModal(false);
    } catch (e) {
      setQuoteError(e.message || "Upgrade failed");
    }
  }

  async function choosePlan(planId) {
    try {
      const res = await fetch(`/api/learners/subscriptions/choose`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        let msg = "Subscribe failed";
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {}
        throw new Error(msg);
      }
      await refresh();
    } catch (e) {
      setError(e.message || "Subscribe failed");
    }
  }

  async function scheduleCancel() {
    try {
      const res = await fetch(`/api/learners/subscriptions/cancel`, {
        method: "POST",
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Cancel failed");
      await refresh();
    } catch (e) {
      setError(e.message || "Cancel failed");
    }
  }

  const mentorPlan = React.useMemo(
    () => plans.find((p) => p.id === "mentor_plus"),
    [plans]
  );
  const basicPlan = React.useMemo(
    () => plans.find((p) => p.id === "ai_basic"),
    [plans]
  );

  const canUpgradeToMentor =
    !!sub?.exists && currentPlanId === "ai_basic" && !!mentorPlan;
  // Always allow demo switch to AI-Only to enable the required upgrade flow demo
  const canDemoSwitchToBasic = !!sub?.exists && currentPlanId === "mentor_plus";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Subscription</h1>
        </div>

        {loading ? (
          <div className="text-gray-500">Loading…</div>
        ) : (
          <>
            {sub?.exists ? (
              <div className="mb-6 p-4 rounded-xl border bg-white flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-500">Current plan</div>
                  <div className="text-lg font-semibold">
                    {sub.subscription.plan_name} ·{" "}
                    {currencyVND(sub.subscription.price_vnd)} / month
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Renewal date:{" "}
                    {new Date(
                      sub.subscription.current_period_end
                    ).toLocaleDateString("vi-VN")}
                  </div>
                  {cancelAtPeriodEnd && (
                    <div className="mt-2 inline-flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full text-xs">
                      Will cancel at end of cycle
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {!cancelAtPeriodEnd ? (
                    <button
                      onClick={scheduleCancel}
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm"
                    >
                      Cancel at period end
                    </button>
                  ) : null}
                  <a
                    href="/"
                    className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-500"
                  >
                    Back to Home
                  </a>
                </div>
              </div>
            ) : (
              <div className="mb-6 p-4 rounded-xl border bg-white">
                <div className="text-sm text-gray-600">
                  You don't have a subscription yet. Pick a plan below.
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {/* Basic Plan */}
              <PlanCard
                plan={basicPlan}
                highlight={false}
                current={currentPlanId === basicPlan?.id}
                onChoose={async () => {
                  if (canDemoSwitchToBasic) {
                    try {
                      const res = await fetch(`/api/learners/subscriptions/demo/set-plan`, {
                        method: "POST",
                        credentials: "include",
                        headers: { ...authHeaders, "Content-Type": "application/json" },
                        body: JSON.stringify({ plan_id: basicPlan.id }),
                      });
                      if (!res.ok) {
                        let msg = "Switch failed";
                        try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
                        throw new Error(msg);
                      }
                      await refresh();
                    } catch (e) {
                      setError(e.message || "Switch failed");
                    }
                  } else {
                    await choosePlan(basicPlan.id);
                  }
                }}
                onUpgrade={null}
                canChoose={!sub?.exists || canDemoSwitchToBasic}
                actionLabel={
                  currentPlanId === basicPlan?.id
                    ? "Current"
                    : canDemoSwitchToBasic
                    ? "Demo: switch to AI‑Only"
                    : "Choose AI‑Only"
                }
              />

              {/* Mentor Plan */}
              <PlanCard
                plan={mentorPlan}
                highlight
                current={currentPlanId === mentorPlan?.id}
                onChoose={() => choosePlan(mentorPlan.id)}
                onUpgrade={() => getQuote(mentorPlan.id)}
                canChoose={!sub?.exists}
                canUpgrade={canUpgradeToMentor}
                pendingCancel={cancelAtPeriodEnd}
              />
            </div>

            {/* Upgrade Modal */}
            {showModal && quote && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
                  <h2 className="text-xl font-semibold">Confirm Upgrade</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    You are upgrading. You will be charged immediately for the
                    pro‑rated difference for the remaining days of this cycle.
                  </p>
                  <div className="mt-4 rounded-xl border bg-gray-50 p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Remaining days in cycle</span>
                      <span className="font-medium">
                        {quote.remaining_days} days
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span>Daily difference</span>
                      <span className="font-medium">
                        {currencyVND(quote.daily_difference_vnd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span>Amount due now</span>
                      <span className="font-semibold text-indigo-700">
                        {currencyVND(quote.amount_due_now_vnd)}
                      </span>
                    </div>
                    {quote.cancel_at_period_end && (
                      <div className="mt-3 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                        Your previous "cancel at end of cycle" will be removed.
                      </div>
                    )}
                  </div>
                  <div className="mt-5 flex items-center justify-end gap-3">
                    <button
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 rounded-xl border hover:bg-gray-50"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => confirmUpgrade(quote.to_plan_id)}
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500"
                    >
                      Agree to Pay
                    </button>
                  </div>
                  {quoteError && (
                    <div className="mt-3 text-sm text-red-600">
                      {quoteError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {quoteLoading && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
                <div className="px-4 py-2 rounded bg-white shadow text-sm">
                  Calculating…
                </div>
              </div>
            )}

            {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  highlight,
  current,
  onChoose,
  onUpgrade,
  canChoose,
  canUpgrade,
  actionLabel,
  pendingCancel,
}) {
  if (!plan)
    return (
      <div className="rounded-2xl border bg-white p-5">
        <div className="text-gray-400">Loading plan…</div>
      </div>
    );
  return (
    <div
      className={
        "rounded-2xl border bg-white p-5 relative " +
        (highlight ? "ring-2 ring-indigo-500" : "")
      }
    >
      {highlight && (
        <div className="absolute -top-3 right-4 text-xs bg-indigo-600 text-white px-2 py-1 rounded-full shadow">
          Recommended
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-gray-900 truncate">
          {plan.name}
        </h3>
        <div className="text-right">
          <div className="text-2xl font-bold text-indigo-700">
            {currencyVND(plan.price_vnd)}
          </div>
          <div className="text-xs text-gray-500">per month</div>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-gray-700">
        {(plan.features || []).map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>{f}</span>
          </li>
        ))}
        {plan.mentor_sessions_per_week > 0 && (
          <li className="flex items-start gap-2">
            <span className="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              {plan.mentor_sessions_per_week}× 1-on-1 mentor sessions/week
            </span>
          </li>
        )}
      </ul>
      <div className="mt-5">
        {current ? (
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm">
            <span>✓</span>
            <span>Current plan</span>
          </span>
        ) : canChoose ? (
          <button
            onClick={onChoose}
            className={
              "px-4 py-2 rounded-xl font-medium " +
              (highlight
                ? "bg-indigo-600 text-white hover:bg-indigo-500"
                : "bg-gray-900 text-white hover:bg-gray-800")
            }
          >
            {actionLabel || "Choose"}
          </button>
        ) : canUpgrade ? (
          <div className="flex flex-col gap-2">
            {pendingCancel && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                Upgrading will remove your scheduled cancellation.
              </div>
            )}
            <button
              onClick={onUpgrade}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 font-medium"
            >
              Upgrade to {plan.name}
            </button>
          </div>
        ) : (
          <button
            className="px-4 py-2 rounded-xl border text-gray-400"
            disabled
          >
            Not available
          </button>
        )}
      </div>
    </div>
  );
}
