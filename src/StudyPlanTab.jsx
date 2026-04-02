import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { COLORS, commonStyles } from "./sharedStyles";

export default function StudyPlanTab({ session }) {
  const [plans, setPlans] = useState([]);
  const [planProgress, setPlanProgress] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetchPlans();
  }, [session]);

  async function fetchPlans() {
    setLoading(true);

    // Fetch active plans
    const { data: plansData } = await supabase
      .from("study_plans")
      .select("*")
      .eq("student_id", session.user.id)
      .eq("active", true);

    if (!plansData || plansData.length === 0) {
      setPlans([]);
      setLoading(false);
      return;
    }
    setPlans(plansData);

    // Fetch study sessions for daily/weekly counts
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > today) weekStart.setDate(weekStart.getDate() - 7);

    const { data: sessions } = await supabase
      .from("study_sessions")
      .select("started_at, cards_studied")
      .eq("user_id", session.user.id)
      .gte("started_at", weekStart.toISOString());

    const dailyCards = (sessions || [])
      .filter((s) => new Date(s.started_at) >= today)
      .reduce((sum, s) => sum + (s.cards_studied || 0), 0);
    const weeklyCards = (sessions || [])
      .reduce((sum, s) => sum + (s.cards_studied || 0), 0);

    // For topic plans, fetch progress
    const topicPlans = plansData.filter((p) => p.plan_type === "topic");
    const topicProgress = {};

    for (const plan of topicPlans) {
      // Get total cards in this subject/topic
      let query = supabase.from("flashcards").select("id").eq("subject", plan.subject);
      if (plan.topic) query = query.eq("topic", plan.topic);
      const { data: cards } = await query.limit(10000);

      const total = cards ? cards.length : 0;

      // Get easy-rated cards
      if (total > 0) {
        const { data: progress } = await supabase
          .from("progress")
          .select("flashcard_id, rating, reviewed_at")
          .eq("user_id", session.user.id)
          .eq("rating", "easy")
          .order("reviewed_at", { ascending: false });

        const cardIds = new Set(cards.map((c) => c.id));
        const seen = new Set();
        let easyCount = 0;
        if (progress) {
          for (const p of progress) {
            if (!cardIds.has(p.flashcard_id)) continue;
            if (seen.has(p.flashcard_id)) continue;
            seen.add(p.flashcard_id);
            easyCount++;
          }
        }
        topicProgress[plan.id] = { total, easy: easyCount, pct: Math.round((easyCount / total) * 100) };
      } else {
        topicProgress[plan.id] = { total: 0, easy: 0, pct: 0 };
      }
    }

    const progress = {};
    for (const plan of plansData) {
      if (plan.plan_type === "daily_cards") {
        progress[plan.id] = {
          done: dailyCards,
          target: plan.cards_target,
          pct: plan.cards_target ? Math.min(100, Math.round((dailyCards / plan.cards_target) * 100)) : null,
        };
      } else if (plan.plan_type === "weekly_cards") {
        progress[plan.id] = {
          done: weeklyCards,
          target: plan.cards_target,
          pct: plan.cards_target ? Math.min(100, Math.round((weeklyCards / plan.cards_target) * 100)) : null,
        };
      } else if (plan.plan_type === "topic") {
        progress[plan.id] = topicProgress[plan.id] || { total: 0, easy: 0, pct: 0 };
      }
    }
    setPlanProgress(progress);
    setLoading(false);
  }

  if (loading) {
    return (
      <div style={styles.centered}>
        <div style={commonStyles.spinner} />
        <p style={styles.loadingText}>Loading plans...</p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div style={styles.emptyContainer}>
        <div style={styles.emptyIcon}>📋</div>
        <p style={styles.emptyTitle}>No Study Plans</p>
        <p style={styles.emptySubtitle}>Your coach hasn't assigned any plans yet.</p>
      </div>
    );
  }

  return (
    <div style={styles.planList}>
      {plans.map((plan) => {
        const prog = planProgress[plan.id] || {};
        return (
          <div key={plan.id} style={styles.planCard}>
            <div style={styles.planHeader}>
              <span style={styles.planIcon}>
                {plan.plan_type === "daily_cards" && "📅"}
                {plan.plan_type === "weekly_cards" && "📆"}
                {plan.plan_type === "topic" && "📚"}
              </span>
              <div style={styles.planTitleArea}>
                <span style={styles.planTitle}>
                  {plan.plan_type === "daily_cards" && "Daily Goal"}
                  {plan.plan_type === "weekly_cards" && "Weekly Goal"}
                  {plan.plan_type === "topic" && (plan.topic ? `${plan.subject} > ${plan.topic}` : plan.subject)}
                </span>
                <span style={styles.planDesc}>
                  {plan.plan_type === "daily_cards" && (
                    plan.cards_target
                      ? `${prog.done || 0} / ${plan.cards_target} cards today`
                      : `${prog.done || 0} cards studied today`
                  )}
                  {plan.plan_type === "weekly_cards" && (
                    plan.cards_target
                      ? `${prog.done || 0} / ${plan.cards_target} cards this week`
                      : `${prog.done || 0} cards studied this week`
                  )}
                  {plan.plan_type === "topic" && `${prog.easy || 0} / ${prog.total || 0} cards mastered`}
                </span>
              </div>
              {prog.pct != null && <span style={styles.planPct}>{prog.pct}%</span>}
            </div>
            {prog.pct != null && (
              <div style={commonStyles.progressBarTrack}>
                <div
                  style={{
                    ...commonStyles.progressBarFill,
                    width: `${prog.pct || 0}%`,
                    background: (prog.pct || 0) >= 100 ? COLORS.success : COLORS.accent,
                  }}
                />
              </div>
            )}
            {prog.pct != null && prog.pct >= 100 && (
              <span style={styles.completeBadge}>Complete!</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  centered: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: "60px 0",
  },
  loadingText: {
    color: COLORS.textMuted, marginTop: 16, fontFamily: "monospace", fontSize: 13,
  },
  emptyContainer: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "40px 0", textAlign: "center",
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: {
    fontSize: 18, fontWeight: "bold", color: COLORS.textLight, margin: "0 0 6px",
    fontFamily: "sans-serif",
  },
  emptySubtitle: {
    color: COLORS.textDim, fontSize: 13, fontFamily: "sans-serif", margin: 0,
  },
  planList: {
    display: "flex", flexDirection: "column", gap: 12, width: "100%",
  },
  planCard: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 14,
    padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10,
  },
  planHeader: {
    display: "flex", alignItems: "center", gap: 12,
  },
  planIcon: { fontSize: 24 },
  planTitleArea: {
    flex: 1, display: "flex", flexDirection: "column", gap: 2,
  },
  planTitle: {
    fontSize: 14, fontWeight: "600", color: COLORS.textLight, fontFamily: "sans-serif",
  },
  planDesc: {
    fontSize: 12, color: COLORS.textDim, fontFamily: "sans-serif",
  },
  planPct: {
    fontSize: 18, fontWeight: "bold", color: COLORS.accentLight, fontFamily: "sans-serif",
  },
  completeBadge: {
    alignSelf: "flex-start", fontSize: 11, color: COLORS.success,
    fontFamily: "sans-serif", fontWeight: "600", background: "#052e16",
    padding: "2px 8px", borderRadius: 8,
  },
};
