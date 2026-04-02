import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { COLORS, commonStyles } from "./sharedStyles";

export default function StatsTab({ session }) {
  const [loading, setLoading] = useState(true);
  const [totalMastered, setTotalMastered] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [totalStudyTime, setTotalStudyTime] = useState(0);
  const [totalReviewed, setTotalReviewed] = useState(0);
  const [streak, setStreak] = useState(0);
  const [dailyData, setDailyData] = useState([]); // last 14 days
  const [accuracyData, setAccuracyData] = useState({ forgot: 0, hard: 0, good: 0, easy: 0 });

  useEffect(() => {
    if (!session) return;
    fetchStats();
  }, [session]);

  async function fetchStats() {
    setLoading(true);

    // Fetch all cards for total count
    const allCards = [];
    let from = 0;
    while (true) {
      const { data } = await supabase.from("flashcards").select("id").range(from, from + 999);
      if (!data || data.length === 0) break;
      allCards.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    setTotalCards(allCards.length);

    // Fetch all progress
    const { data: progress } = await supabase
      .from("progress")
      .select("flashcard_id, rating, reviewed_at")
      .eq("user_id", session.user.id)
      .order("reviewed_at", { ascending: false });

    if (progress) {
      // Total reviewed
      setTotalReviewed(progress.length);

      // Mastered (latest rating = easy, unique cards)
      const seen = new Set();
      let mastered = 0;
      for (const p of progress) {
        if (seen.has(p.flashcard_id)) continue;
        seen.add(p.flashcard_id);
        if (p.rating === "easy") mastered++;
      }
      setTotalMastered(mastered);

      // Rating distribution (all ratings, not just latest)
      const dist = { forgot: 0, hard: 0, good: 0, easy: 0 };
      for (const p of progress) {
        if (dist[p.rating] !== undefined) dist[p.rating]++;
      }
      setAccuracyData(dist);

      // Daily activity for last 14 days
      const days = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        days.push({ date: d, label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), count: 0 });
      }
      for (const p of progress) {
        const pd = new Date(p.reviewed_at);
        pd.setHours(0, 0, 0, 0);
        const dayEntry = days.find((d) => d.date.getTime() === pd.getTime());
        if (dayEntry) dayEntry.count++;
      }
      setDailyData(days);
    }

    // Fetch study sessions for total time + streak
    const { data: sessions } = await supabase
      .from("study_sessions")
      .select("started_at, ended_at")
      .eq("user_id", session.user.id)
      .order("started_at", { ascending: false });

    if (sessions) {
      const totalMs = sessions
        .filter((s) => s.ended_at)
        .reduce((sum, s) => sum + (new Date(s.ended_at) - new Date(s.started_at)), 0);
      setTotalStudyTime(totalMs);

      // Streak
      const studyDays = new Set(
        sessions.map((s) => {
          const d = new Date(s.started_at);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        })
      );
      const today = new Date();
      let count = 0;
      const check = new Date(today);
      const todayKey = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
      if (!studyDays.has(todayKey)) check.setDate(check.getDate() - 1);
      while (true) {
        const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
        if (studyDays.has(key)) { count++; check.setDate(check.getDate() - 1); }
        else break;
      }
      setStreak(count);
    }

    setLoading(false);
  }

  function formatTime(ms) {
    if (!ms || ms <= 0) return "0m";
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  if (loading) {
    return (
      <div style={styles.centered}>
        <div style={commonStyles.spinner} />
        <p style={styles.loadingText}>Loading stats...</p>
      </div>
    );
  }

  const maxDaily = Math.max(...dailyData.map((d) => d.count), 1);
  const totalRatings = accuracyData.forgot + accuracyData.hard + accuracyData.good + accuracyData.easy;

  return (
    <div style={styles.container}>
      {/* Summary cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <span style={styles.summaryNum}>{totalMastered}</span>
          <span style={styles.summaryLabel}>Mastered</span>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.summaryNum}>{totalCards - totalMastered}</span>
          <span style={styles.summaryLabel}>Remaining</span>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.summaryNum}>{formatTime(totalStudyTime)}</span>
          <span style={styles.summaryLabel}>Study Time</span>
        </div>
        <div style={styles.summaryCard}>
          <span style={{ ...styles.summaryNum, color: streak > 0 ? "#d97706" : COLORS.textDim }}>
            {streak > 0 ? `${streak}${streak >= 7 ? "🔥" : ""}` : "0"}
          </span>
          <span style={styles.summaryLabel}>Day Streak</span>
        </div>
      </div>

      {/* Mastery progress */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Overall Mastery</h3>
        <div style={styles.masteryBar}>
          <div style={commonStyles.progressBarTrack}>
            <div style={{ ...commonStyles.progressBarFill, width: `${totalCards > 0 ? Math.round((totalMastered / totalCards) * 100) : 0}%` }} />
          </div>
          <span style={styles.masteryText}>
            {totalCards > 0 ? Math.round((totalMastered / totalCards) * 100) : 0}% ({totalMastered} / {totalCards})
          </span>
        </div>
      </div>

      {/* Daily activity chart */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Last 14 Days</h3>
        <div style={styles.chartContainer}>
          {dailyData.map((d, i) => (
            <div key={i} style={styles.barCol}>
              <div style={styles.barWrapper}>
                <div style={{
                  ...styles.bar,
                  height: `${(d.count / maxDaily) * 100}%`,
                  background: d.count > 0 ? COLORS.accent : COLORS.border,
                }} />
              </div>
              <span style={styles.barLabel}>{d.date.getDate()}</span>
              {d.count > 0 && <span style={styles.barCount}>{d.count}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Rating distribution */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Rating Distribution</h3>
        <p style={styles.totalReviews}>{totalReviewed} total reviews</p>
        {totalRatings > 0 && (
          <div style={styles.distContainer}>
            {[
              { label: "Easy", value: accuracyData.easy, color: "#22c55e" },
              { label: "Good", value: accuracyData.good, color: "#3b82f6" },
              { label: "Hard", value: accuracyData.hard, color: "#d97706" },
              { label: "Forgot", value: accuracyData.forgot, color: "#ef4444" },
            ].map((item) => {
              const pct = Math.round((item.value / totalRatings) * 100);
              return (
                <div key={item.label} style={styles.distRow}>
                  <span style={styles.distLabel}>{item.label}</span>
                  <div style={styles.distBarTrack}>
                    <div style={{ ...styles.distBarFill, width: `${pct}%`, background: item.color }} />
                  </div>
                  <span style={styles.distPct}>{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  centered: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: "60px 0",
  },
  loadingText: {
    color: COLORS.textMuted, marginTop: 16, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", fontSize: 13,
  },
  container: {
    display: "flex", flexDirection: "column", gap: 20, width: "100%",
  },
  summaryGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%",
  },
  summaryCard: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12,
    padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
  },
  summaryNum: {
    fontSize: 22, fontWeight: "bold", color: COLORS.accentLight, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  summaryLabel: {
    fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", fontWeight: "600",
    textTransform: "uppercase", letterSpacing: "0.05em",
  },
  section: { width: "100%" },
  sectionTitle: {
    fontSize: 14, fontWeight: "bold", color: COLORS.textLight, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
    margin: "0 0 10px",
  },
  masteryBar: { display: "flex", flexDirection: "column", gap: 6 },
  masteryText: {
    fontSize: 12, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },

  // Chart
  chartContainer: {
    display: "flex", gap: 2, alignItems: "flex-end", height: 120,
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12,
    padding: "16px 10px 8px", boxSizing: "border-box",
  },
  barCol: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    position: "relative",
  },
  barWrapper: {
    width: "100%", height: 80, display: "flex", alignItems: "flex-end",
  },
  bar: {
    width: "100%", borderRadius: 2, minHeight: 2, transition: "height 0.3s ease",
  },
  barLabel: {
    fontSize: 9, color: COLORS.textDarkest, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  barCount: {
    fontSize: 8, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", position: "absolute", top: -2,
  },

  // Distribution
  totalReviews: {
    fontSize: 12, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", margin: "0 0 10px",
  },
  distContainer: {
    display: "flex", flexDirection: "column", gap: 8,
  },
  distRow: {
    display: "flex", alignItems: "center", gap: 10,
  },
  distLabel: {
    fontSize: 12, color: COLORS.textMuted, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", width: 50, textAlign: "right",
  },
  distBarTrack: {
    flex: 1, height: 8, background: COLORS.border, borderRadius: 4, overflow: "hidden",
  },
  distBarFill: {
    height: "100%", borderRadius: 4, transition: "width 0.4s ease",
  },
  distPct: {
    fontSize: 12, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", width: 35,
  },
};
