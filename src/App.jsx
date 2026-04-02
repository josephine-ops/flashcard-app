import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import CoachDashboard from "./CoachDashboard";
import StudyPlanTab from "./StudyPlanTab";
import StatsTab from "./StatsTab";
import logo from "./assets/DemiDec Logo.png";

const RATINGS = [
  { label: "Forgot", value: "forgot", color: "#ef4444", hover: "#dc2626", emoji: "😰" },
  { label: "Hard", value: "hard", color: "#f59e0b", hover: "#d97706", emoji: "😓" },
  { label: "Good", value: "good", color: "#3b82f6", hover: "#2563eb", emoji: "🙂" },
  { label: "Easy", value: "easy", color: "#22c55e", hover: "#16a34a", emoji: "😄" },
];

const DIFFICULTIES = ["all", "Easy", "Medium", "Hard"];
const RATING_PRIORITY = { forgot: 0, hard: 1, good: 2, easy: 3 };

// SRS interval calculation
function getNextInterval(currentInterval, rating) {
  if (rating === "forgot") return 1;
  if (currentInterval === 0) {
    // First review
    if (rating === "hard") return 2;
    if (rating === "good") return 3;
    if (rating === "easy") return 7;
  }
  if (rating === "hard") return Math.max(2, Math.round(currentInterval * 1.2));
  if (rating === "good") return Math.max(3, Math.round(currentInterval * 2.5));
  if (rating === "easy") return Math.max(7, Math.round(currentInterval * 3.5));
  return 1;
}

function FormatText({ text }) {
  if (!text) return null;
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) =>
    part.startsWith("*") && part.endsWith("*")
      ? <em key={i}>{part.slice(1, -1)}</em>
      : part
  );
}

function MiniPie({ data, size = 32 }) {
  const total = data.forgot + data.hard + data.good + data.easy + data.unrated;
  if (total === 0) return <div style={{ width: size, height: size, borderRadius: "50%", background: "#1e293b" }} />;
  const pct = data.easy / total;
  if (pct === 0) return <div style={{ width: size, height: size, borderRadius: "50%", background: "#1e293b" }} />;
  if (pct === 1) return <div style={{ width: size, height: size, borderRadius: "50%", background: "#22c55e" }} />;
  const r = size / 2;
  const endAngle = pct * 2 * Math.PI - Math.PI / 2;
  const startAngle = -Math.PI / 2;
  const largeArc = pct > 0.5 ? 1 : 0;
  const x1 = r + r * Math.cos(startAngle);
  const y1 = r + r * Math.sin(startAngle);
  const x2 = r + r * Math.cos(endAngle);
  const y2 = r + r * Math.sin(endAngle);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r} cy={r} r={r} fill="#1e293b" />
      <path d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`} fill="#22c55e" />
    </svg>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login"); // "login" or "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [subjects, setSubjects] = useState([]);
  const [selectedSubjects, setSelectedSubjects] = useState([]);
  const [mixedMode, setMixedMode] = useState(false);
  const [subject, setSubject] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topic, setTopic] = useState(null);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [difficulty, setDifficulty] = useState("all");
  const [mode, setMode] = useState("random");
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ forgot: 0, hard: 0, good: 0, easy: 0 });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [subjectProgress, setSubjectProgress] = useState({}); // { subject: { total, easy } }
  const [topicProgress, setTopicProgress] = useState({}); // { topic: { forgot, hard, good, easy, unrated } }
  const [profile, setProfile] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [homeTab, setHomeTab] = useState("subjects");
  const [dueCount, setDueCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastRating, setLastRating] = useState(null); // { progressId, ratingValue }
  const [flaggedIds, setFlaggedIds] = useState(new Set());

  // Listen for auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auto-create profile and update last_login
  useEffect(() => {
    if (!session) { setProfile(null); return; }
    async function ensureProfile() {
      const { data: existing } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      if (existing) {
        setProfile(existing);
      } else {
        const { data: created } = await supabase
          .from("profiles")
          .insert({ id: session.user.id, role: "student", name: session.user.email })
          .select()
          .single();
        if (created) setProfile(created);
      }
      // Auto-link to coach if invited
      await supabase.rpc("claim_coach_invite", {
        user_email: session.user.email,
        user_id: session.user.id,
      });
      // Update last_login
      await supabase
        .from("profiles")
        .update({ last_login: new Date().toISOString() })
        .eq("id", session.user.id);
    }
    ensureProfile();
  }, [session]);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    const { error } = authMode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (error) setAuthError(error.message);
    setAuthSubmitting(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    resetAll();
  }

  useEffect(() => {
    if (!session) return;
    async function fetchSubjects() {
      const results = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data } = await supabase.from("flashcards").select("subject").range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      if (results.length > 0) {
        const unique = [...new Set(results.map((d) => d.subject))].sort();
        setSubjects(unique);
      }
    }
    fetchSubjects();
  }, [session]);

  useEffect(() => {
    if (!session || subjects.length === 0) return;
    async function fetchProgress() {
      const allCards = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("flashcards").select("id, subject").range(from, from + 999);
        if (!data || data.length === 0) break;
        allCards.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      if (allCards.length === 0) return;

      const cardsBySubject = {};
      const cardIdToSubject = {};
      for (const c of allCards) {
        cardsBySubject[c.subject] = (cardsBySubject[c.subject] || 0) + 1;
        cardIdToSubject[c.id] = c.subject;
      }

      const { data: progressData } = await supabase
        .from("progress")
        .select("flashcard_id, rating, reviewed_at")
        .eq("user_id", session.user.id)
        .eq("rating", "easy")
        .order("reviewed_at", { ascending: false });

      const easyBySubject = {};
      const seen = new Set();
      if (progressData) {
        for (const p of progressData) {
          if (seen.has(p.flashcard_id)) continue;
          seen.add(p.flashcard_id);
          const subj = cardIdToSubject[p.flashcard_id];
          if (subj) easyBySubject[subj] = (easyBySubject[subj] || 0) + 1;
        }
      }

      const progress = {};
      for (const s of subjects) {
        progress[s] = { total: cardsBySubject[s] || 0, easy: easyBySubject[s] || 0 };
      }
      setSubjectProgress(progress);

      // Calculate due count for SRS
      const { data: allProgress } = await supabase
        .from("progress")
        .select("flashcard_id, next_review_at, reviewed_at")
        .eq("user_id", session.user.id)
        .order("reviewed_at", { ascending: false });

      const allCardIds = new Set(allCards.map((c) => c.id));
      const latestByCard = {};
      if (allProgress) {
        for (const p of allProgress) {
          if (!allCardIds.has(p.flashcard_id)) continue;
          if (!latestByCard[p.flashcard_id]) latestByCard[p.flashcard_id] = p;
        }
      }
      const now = new Date();
      const neverStudied = allCards.filter((c) => !latestByCard[c.id]).length;
      const due = Object.values(latestByCard).filter(
        (p) => !p.next_review_at || new Date(p.next_review_at) <= now
      ).length;
      setDueCount(neverStudied + due);

      // Calculate study streak
      const { data: sessions } = await supabase
        .from("study_sessions")
        .select("started_at")
        .eq("user_id", session.user.id)
        .order("started_at", { ascending: false });

      if (sessions && sessions.length > 0) {
        const studyDays = new Set(
          sessions.map((s) => {
            const d = new Date(s.started_at);
            return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          })
        );
        const today = new Date();
        let count = 0;
        const check = new Date(today);
        // Check if studied today; if not, start from yesterday
        const todayKey = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
        if (!studyDays.has(todayKey)) {
          check.setDate(check.getDate() - 1);
        }
        while (true) {
          const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
          if (studyDays.has(key)) {
            count++;
            check.setDate(check.getDate() - 1);
          } else {
            break;
          }
        }
        setStreak(count);
      }

      // Load flagged cards
      const { data: flags } = await supabase
        .from("flagged_cards")
        .select("flashcard_id")
        .eq("user_id", session.user.id);
      if (flags) {
        setFlaggedIds(new Set(flags.map((f) => f.flashcard_id)));
      }
    }
    fetchProgress();
  }, [session, subjects]);

  useEffect(() => {
    if (!subject && !mixedMode) return;
    async function fetchTopics() {
      setLoading(true);
      const subjectsToFetch = mixedMode ? selectedSubjects : [subject];
      const data = [];
      let from = 0;
      while (true) {
        const { data: page } = await supabase.from("flashcards").select("id, topic, subject").in("subject", subjectsToFetch).range(from, from + 999);
        if (!page || page.length === 0) break;
        data.push(...page);
        if (page.length < 1000) break;
        from += 1000;
      }
      if (data.length > 0) {
        const unique = [...new Set(data.map((d) => d.topic).filter(Boolean))].sort();
        setTopics(unique);

        // Fetch per-topic progress
        const ids = data.map((c) => c.id);
        const cardIdToTopic = {};
        const totalByTopic = {};
        for (const c of data) {
          if (!c.topic) continue;
          cardIdToTopic[c.id] = c.topic;
          totalByTopic[c.topic] = (totalByTopic[c.topic] || 0) + 1;
        }

        const { data: progressData } = await supabase
          .from("progress")
          .select("flashcard_id, rating, reviewed_at")
          .eq("user_id", session.user.id)
          .order("reviewed_at", { ascending: false });

        const idSet = new Set(ids);
        const latestByCard = {};
        if (progressData) {
          for (const p of progressData) {
            if (!idSet.has(p.flashcard_id)) continue;
            if (!latestByCard[p.flashcard_id]) latestByCard[p.flashcard_id] = p.rating;
          }
        }

        const tp = {};
        for (const t of unique) {
          tp[t] = { forgot: 0, hard: 0, good: 0, easy: 0, unrated: 0 };
        }
        for (const c of data) {
          if (!c.topic || !tp[c.topic]) continue;
          const rating = latestByCard[c.id];
          if (rating) tp[c.topic][rating]++;
          else tp[c.topic].unrated++;
        }
        setTopicProgress(tp);
      }
      setLoading(false);
    }
    fetchTopics();
  }, [subject, mixedMode]);

  function toggleSubject(s) {
    setSelectedSubjects((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function toggleTopic(t) {
    setSelectedTopics((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  async function fetchCards(selectedTopic, selectedDifficulty, selectedMode) {
    setLoading(true);
    setDone(false);
    setCurrentIndex(0);
    setFlipped(false);
    setScore({ forgot: 0, hard: 0, good: 0, easy: 0 });

    let query = supabase.from("flashcards").select("*");

    if (mixedMode) {
      query = query.in("subject", selectedSubjects);
      if (selectedTopics.length > 0) query = query.in("topic", selectedTopics);
    } else {
      query = query.eq("subject", subject);
      if (selectedTopic !== "all") query = query.eq("topic", selectedTopic);
    }

    if (selectedDifficulty !== "all") query = query.eq("difficulty", selectedDifficulty);

    const data = [];
    let from = 0;
    while (true) {
      const { data: page, error: err } = await query.range(from, from + 999);
      if (err || !page || page.length === 0) break;
      data.push(...page);
      if (page.length < 1000) break;
      from += 1000;
    }

    if (data.length > 0) {
      // Start a study session
      const { data: sessionData } = await supabase
        .from("study_sessions")
        .insert({ user_id: session.user.id, cards_studied: 0 })
        .select()
        .single();
      if (sessionData) setCurrentSessionId(sessionData.id);

      if (selectedMode === "spaced") {
        const idSet = new Set(data.map((c) => c.id));
        const { data: progressData } = await supabase
          .from("progress")
          .select("flashcard_id, rating, reviewed_at, next_review_at, interval_days")
          .eq("user_id", session.user.id)
          .order("reviewed_at", { ascending: false });

        // Get latest review per card
        const latestByCard = {};
        if (progressData) {
          for (const p of progressData) {
            if (!idSet.has(p.flashcard_id)) continue;
            if (!latestByCard[p.flashcard_id]) latestByCard[p.flashcard_id] = p;
          }
        }

        const now = new Date();
        // Filter to: cards never studied + cards that are due
        const dueCards = data.filter((c) => {
          const latest = latestByCard[c.id];
          if (!latest) return true; // never studied
          if (!latest.next_review_at) return true; // no schedule yet
          return new Date(latest.next_review_at) <= now; // due
        });

        // Sort: overdue first (most overdue at top), then never-studied, then by priority
        const sorted = dueCards.sort((a, b) => {
          const la = latestByCard[a.id];
          const lb = latestByCard[b.id];
          // Never studied goes after overdue but before not-due
          if (!la && !lb) return Math.random() - 0.5;
          if (!la) return 1;
          if (!lb) return -1;
          // Both have reviews — sort by next_review_at (most overdue first)
          const na = la.next_review_at ? new Date(la.next_review_at).getTime() : 0;
          const nb = lb.next_review_at ? new Date(lb.next_review_at).getTime() : 0;
          return na - nb;
        });
        setCards(sorted.length > 0 ? sorted : data.sort(() => Math.random() - 0.5));
      } else {
        setCards(data.sort(() => Math.random() - 0.5));
      }
    }
    setLoading(false);
  }

  async function handleRating(rating) {
    if (savingRating) return;
    setSavingRating(true);
    const card = cards[currentIndex];

    // Get current interval for this card
    const { data: prev } = await supabase
      .from("progress")
      .select("interval_days")
      .eq("flashcard_id", card.id)
      .eq("user_id", session.user.id)
      .order("reviewed_at", { ascending: false })
      .limit(1);
    const currentInterval = prev && prev.length > 0 ? (prev[0].interval_days || 0) : 0;
    const newInterval = getNextInterval(currentInterval, rating.value);
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + newInterval);

    const { data: inserted } = await supabase.from("progress").insert({
      flashcard_id: card.id,
      rating: rating.value,
      user_id: session.user.id,
      interval_days: newInterval,
      next_review_at: nextReview.toISOString(),
    }).select("id").single();
    setLastRating(inserted ? { progressId: inserted.id, ratingValue: rating.value } : null);
    setScore((prev) => ({ ...prev, [rating.value]: prev[rating.value] + 1 }));
    const cardsCompleted = Object.values(score).reduce((a, b) => a + b, 0) + 1;
    // Update study session card count
    if (currentSessionId) {
      await supabase.from("study_sessions")
        .update({ cards_studied: cardsCompleted })
        .eq("id", currentSessionId);
    }
    if (currentIndex + 1 >= cards.length) {
      // End study session
      if (currentSessionId) {
        await supabase.from("study_sessions")
          .update({ ended_at: new Date().toISOString(), cards_studied: cardsCompleted })
          .eq("id", currentSessionId);
        setCurrentSessionId(null);
      }
      setDone(true);
    } else {
      setFlipped(false);
      setTimeout(() => setCurrentIndex((i) => i + 1), 150);
    }
    setSavingRating(false);
  }

  async function handleUndo() {
    if (!lastRating) return;
    await supabase.from("progress").delete().eq("id", lastRating.progressId);
    setScore((prev) => ({ ...prev, [lastRating.ratingValue]: prev[lastRating.ratingValue] - 1 }));
    const cardsCompleted = Object.values(score).reduce((a, b) => a + b, 0) - 1;
    if (currentSessionId) {
      await supabase.from("study_sessions")
        .update({ cards_studied: Math.max(0, cardsCompleted) })
        .eq("id", currentSessionId);
    }
    if (done) {
      setDone(false);
    } else {
      setCurrentIndex((i) => Math.max(0, i - 1));
    }
    setFlipped(false);
    setLastRating(null);
  }

  async function fetchFlaggedCards() {
    setLoading(true);
    setDone(false);
    setCurrentIndex(0);
    setFlipped(false);
    setScore({ forgot: 0, hard: 0, good: 0, easy: 0 });

    const { data: flags } = await supabase
      .from("flagged_cards")
      .select("flashcard_id")
      .eq("user_id", session.user.id);

    if (!flags || flags.length === 0) {
      setCards([]);
      setLoading(false);
      return;
    }

    const flagIds = flags.map((f) => f.flashcard_id);
    const { data } = await supabase
      .from("flashcards")
      .select("*")
      .in("id", flagIds);

    if (data && data.length > 0) {
      const { data: sessionData } = await supabase
        .from("study_sessions")
        .insert({ user_id: session.user.id, cards_studied: 0 })
        .select()
        .single();
      if (sessionData) setCurrentSessionId(sessionData.id);
      setCards(data.sort(() => Math.random() - 0.5));
    }
    setLoading(false);
  }

  async function toggleFlag(cardId) {
    if (flaggedIds.has(cardId)) {
      await supabase.from("flagged_cards").delete()
        .eq("user_id", session.user.id)
        .eq("flashcard_id", cardId);
      setFlaggedIds((prev) => { const next = new Set(prev); next.delete(cardId); return next; });
    } else {
      await supabase.from("flagged_cards").insert({ user_id: session.user.id, flashcard_id: cardId });
      setFlaggedIds((prev) => new Set(prev).add(cardId));
    }
  }

  function resetAll() {
    setSubject(null);
    setTopic(null);
    setMixedMode(false);
    setSelectedSubjects([]);
    setSelectedTopics([]);
    setDifficulty("all");
    setMode("random");
  }

  // Keyboard shortcuts for card study
  useEffect(() => {
    function handleKeyDown(e) {
      // Only active during card study (topic is set, not done, cards loaded)
      if (!topic || done || cards.length === 0) return;
      if (savingRating) return;

      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped) {
        if (e.key === "1") handleRating(RATINGS[0]); // Forgot
        else if (e.key === "2") handleRating(RATINGS[1]); // Hard
        else if (e.key === "3") handleRating(RATINGS[2]); // Good
        else if (e.key === "4") handleRating(RATINGS[3]); // Easy
      }
      if (e.key === "z" && lastRating && !flipped) {
        handleUndo();
      }
      if (e.key === "f" && cards[currentIndex]) {
        toggleFlag(cards[currentIndex].id);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [topic, done, cards, flipped, savingRating, lastRating]);

  async function endCurrentSession() {
    if (currentSessionId) {
      const cardsCompleted = Object.values(score).reduce((a, b) => a + b, 0);
      await supabase.from("study_sessions")
        .update({ ended_at: new Date().toISOString(), cards_studied: cardsCompleted })
        .eq("id", currentSessionId);
      setCurrentSessionId(null);
    }
  }

  function backToTopics() {
    endCurrentSession();
    setTopic(null);
    setCards([]);
    setDone(false);
    setCurrentIndex(0);
    setFlipped(false);
    setScore({ forgot: 0, hard: 0, good: 0, easy: 0 });
  }

  const card = cards[currentIndex];
  const remaining = cards.length - currentIndex;
  const totalReviewed = Object.values(score).reduce((a, b) => a + b, 0);

  // Auth loading
  if (authLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.centered}>
          <div style={styles.spinner} />
          <p style={{ color: "#94a3b8", marginTop: 16, fontFamily: "monospace" }}>Loading...</p>
        </div>
      </div>
    );
  }

  // Login / Signup screen
  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <img src={logo} alt="DemiDec" style={styles.logoImg} />
          <h1 style={styles.title}>DemiDec Flashcards</h1>
          <p style={styles.subtitle}>
            {authMode === "login" ? "Log in to your account" : "Create a new account"}
          </p>
          <form onSubmit={handleAuth} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.authInput}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={styles.authInput}
            />
            {authError && <p style={styles.authError}>{authError}</p>}
            <button type="submit" disabled={authSubmitting} style={{ ...styles.startBtn, opacity: authSubmitting ? 0.6 : 1 }}>
              {authSubmitting ? "..." : authMode === "login" ? "Log In" : "Sign Up"}
            </button>
          </form>
          <button
            style={styles.authToggle}
            onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }}
          >
            {authMode === "login" ? "Don't have an account? Sign up" : "Already have an account? Log in"}
          </button>
        </div>
      </div>
    );
  }

  // Coach dashboard
  if (profile && profile.role === "coach") {
    return <CoachDashboard session={session} profile={profile} onLogout={handleLogout} />;
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.centered}>
          <div style={styles.spinner} />
          <p style={{ color: "#94a3b8", marginTop: 16, fontFamily: "monospace" }}>Loading...</p>
        </div>
      </div>
    );
  }

  // Subject screen
  if (!subject && !mixedMode) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <button style={styles.logoutBtn} onClick={handleLogout}>Log out</button>
          <img src={logo} alt="DemiDec" style={styles.logoImg} />
          <h1 style={styles.title}>DemiDec Flashcards</h1>

          <div style={styles.tabBar}>
            <button
              style={{ ...styles.tab, ...(homeTab === "subjects" ? styles.tabActive : {}) }}
              onClick={() => setHomeTab("subjects")}>
              Subjects
            </button>
            <button
              style={{ ...styles.tab, ...(homeTab === "plans" ? styles.tabActive : {}) }}
              onClick={() => setHomeTab("plans")}>
              My Plans
            </button>
            <button
              style={{ ...styles.tab, ...(homeTab === "stats" ? styles.tabActive : {}) }}
              onClick={() => setHomeTab("stats")}>
              My Stats
            </button>
          </div>

          {homeTab === "subjects" ? (
            <>
              <div style={styles.homeStats}>
                {streak > 0 && (
                  <div style={styles.streakBadge}>
                    <span style={styles.streakFire}>{streak >= 7 ? "🔥" : "⚡"}</span>
                    <span style={styles.streakCount}>{streak}</span>
                    <span style={styles.streakLabel}>day{streak !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {dueCount > 0 && (
                  <div style={styles.dueBadge}>
                    <span style={styles.dueCount}>{dueCount}</span>
                    <span style={styles.dueLabel}>due</span>
                  </div>
                )}
              </div>
              <p style={styles.subtitle}>
                {selectedSubjects.length > 0 ? "Select subjects then start mixed session" : "Choose a subject or mix multiple"}
              </p>
              <div style={styles.subjectGrid}>
                {subjects.map((s) => {
                  const isSelected = selectedSubjects.includes(s);
                  const prog = subjectProgress[s];
                  const pct = prog && prog.total > 0 ? Math.round((prog.easy / prog.total) * 100) : 0;
                  return (
                    <button key={s}
                      style={{ ...styles.subjectBtn, ...(isSelected ? styles.subjectBtnSelected : {}) }}
                      onClick={() => toggleSubject(s)}
                      onMouseOver={e => { if (!isSelected) e.currentTarget.style.transform = "translateY(-3px)"; }}
                      onMouseOut={e => e.currentTarget.style.transform = "translateY(0)"}>
                      {isSelected && <span style={styles.checkmark}>✓</span>}
                      <span style={styles.subjectLabel}>{s}</span>
                      <div style={styles.progressBarTrack}>
                        <div style={{ ...styles.progressBarFill, width: `${pct}%` }} />
                      </div>
                      <span style={styles.progressPct}>{pct}% mastered</span>
                    </button>
                  );
                })}
              </div>

              {selectedSubjects.length === 1 && (
                <button style={styles.startBtn} onClick={() => setSubject(selectedSubjects[0])}>
                  Study {selectedSubjects[0]} →
                </button>
              )}

              {selectedSubjects.length > 1 && (
                <button style={styles.mixedBtn} onClick={() => setMixedMode(true)}>
                  🔀 Start Mixed Session ({selectedSubjects.length} subjects)
                </button>
              )}

              {selectedSubjects.length === 0 && (
                <p style={styles.hintText}>Tap one subject to study it, or tap multiple to mix</p>
              )}
            </>
          ) : homeTab === "plans" ? (
            <StudyPlanTab session={session} />
          ) : (
            <StatsTab session={session} />
          )}
        </div>
      </div>
    );
  }

  // Mixed topic selection screen
  if (mixedMode && !done && cards.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <button style={styles.logoutBtn} onClick={handleLogout}>Log out</button>
          <button style={styles.backBtn} onClick={resetAll}>← Back</button>
          <h1 style={styles.title}>Mixed Session</h1>
          <p style={styles.subtitle}>{selectedSubjects.join(" · ")}</p>

          <div style={styles.pillRow}>
            {DIFFICULTIES.map((d) => (
              <button key={d} style={{ ...styles.pill, ...(difficulty === d ? styles.pillActive : {}) }}
                onClick={() => setDifficulty(d)}>
                {d === "all" ? "All" : d}
              </button>
            ))}
          </div>

          <div style={styles.modeRow}>
            <button style={{ ...styles.modeBtn, ...(mode === "random" ? styles.modeBtnActive : {}) }}
              onClick={() => setMode("random")}>🎲 Random</button>
            <button style={{ ...styles.modeBtn, ...(mode === "spaced" ? styles.modeBtnActive : {}) }}
              onClick={() => setMode("spaced")}>🧠 Spaced</button>
          </div>

          <p style={{ color: "#475569", fontSize: 13, fontFamily: "sans-serif", marginBottom: 12 }}>
            {selectedTopics.length === 0 ? "Pick topics or start with all" : `${selectedTopics.length} topic(s) selected`}
          </p>

          <div style={styles.topicList}>
            <button style={styles.topicBtn}
              onClick={() => { setSelectedTopics([]); fetchCards(null, difficulty, mode).then(() => setTopic("all")); }}
              onMouseOver={e => e.currentTarget.style.borderColor = "#3b82f6"}
              onMouseOut={e => e.currentTarget.style.borderColor = "#1e293b"}>
              <span style={styles.topicLabel}>⚡ All Topics</span>
            </button>
            {topics.map((t) => {
              const isSelected = selectedTopics.includes(t);
              return (
                <button key={t}
                  style={{ ...styles.topicBtn, ...(isSelected ? styles.topicBtnSelected : {}) }}
                  onClick={() => toggleTopic(t)}
                  onMouseOver={e => e.currentTarget.style.borderColor = "#3b82f6"}
                  onMouseOut={e => e.currentTarget.style.borderColor = isSelected ? "#3b82f6" : "#1e293b"}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {topicProgress[t] && <MiniPie data={topicProgress[t]} />}
                    <span style={styles.topicLabel}>{t}</span>
                  </span>
                  {isSelected && <span style={{ color: "#60a5fa", fontSize: 16 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {selectedTopics.length > 0 && (
            <button style={styles.mixedBtn}
              onClick={() => fetchCards(null, difficulty, mode).then(() => setTopic("mixed"))}>
              🔀 Start with {selectedTopics.length} topic(s)
            </button>
          )}
        </div>
      </div>
    );
  }

  // Single subject topic screen
  if (!topic) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <button style={styles.logoutBtn} onClick={handleLogout}>Log out</button>
          <button style={styles.backBtn} onClick={resetAll}>← Back</button>
          <h1 style={styles.title}>{subject}</h1>
          <p style={styles.subtitle}>Choose a topic</p>

          <div style={styles.pillRow}>
            {DIFFICULTIES.map((d) => (
              <button key={d} style={{ ...styles.pill, ...(difficulty === d ? styles.pillActive : {}) }}
                onClick={() => setDifficulty(d)}>
                {d === "all" ? "All" : d}
              </button>
            ))}
          </div>

          <div style={styles.modeRow}>
            <button style={{ ...styles.modeBtn, ...(mode === "random" ? styles.modeBtnActive : {}) }}
              onClick={() => setMode("random")}>🎲 Random</button>
            <button style={{ ...styles.modeBtn, ...(mode === "spaced" ? styles.modeBtnActive : {}) }}
              onClick={() => setMode("spaced")}>🧠 Spaced</button>
          </div>

          <div style={styles.topicList}>
            <button style={styles.topicBtn}
              onClick={() => fetchCards("all", difficulty, mode).then(() => setTopic("all"))}
              onMouseOver={e => e.currentTarget.style.borderColor = "#3b82f6"}
              onMouseOut={e => e.currentTarget.style.borderColor = "#1e293b"}>
              <span style={styles.topicLabel}>⚡ All Topics</span>
            </button>
            {topics.map((t) => (
              <button key={t} style={styles.topicBtn}
                onClick={() => fetchCards(t, difficulty, mode).then(() => setTopic(t))}
                onMouseOver={e => e.currentTarget.style.borderColor = "#3b82f6"}
                onMouseOut={e => e.currentTarget.style.borderColor = "#1e293b"}>
                <span style={styles.topicLabel}>{t}</span>
                {topicProgress[t] && <MiniPie data={topicProgress[t]} />}
              </button>
            ))}
            {flaggedIds.size > 0 && (
              <button style={styles.flaggedBtn}
                onClick={() => fetchFlaggedCards().then(() => setTopic("flagged"))}
                onMouseOver={e => e.currentTarget.style.borderColor = "#f59e0b"}
                onMouseOut={e => e.currentTarget.style.borderColor = "#1e293b"}>
                <span style={styles.topicLabel}>★ Flagged Cards ({flaggedIds.size})</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.doneContainer}>
          <button style={styles.logoutBtn} onClick={handleLogout}>Log out</button>
          <div style={styles.doneEmoji}>🎉</div>
          <h2 style={styles.doneTitle}>Session Complete!</h2>
          <p style={styles.doneSubject}>
            {mixedMode ? selectedSubjects.join(" · ") : subject}
            {" · "}{cards.length} cards
          </p>
          <div style={styles.scoreGrid}>
            {RATINGS.map((r) => (
              <div key={r.value} style={{ ...styles.scoreCard, borderColor: r.color }}>
                <span style={{ fontSize: 22 }}>{r.emoji}</span>
                <span style={{ ...styles.scoreNum, color: r.color }}>{score[r.value]}</span>
                <span style={styles.scoreLabel}>{r.label}</span>
              </div>
            ))}
          </div>
          <div style={styles.btnRow}>
            <button style={styles.againBtn} onClick={() => fetchCards(topic, difficulty, mode)}>Study Again</button>
            <button style={styles.switchBtn} onClick={backToTopics}>Change Topic</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <button style={styles.backBtn} onClick={backToTopics}>← Back</button>
        <span style={styles.subjectTag}>
          {mixedMode ? "Mixed" : (topic === "all" ? subject : topic)}
        </span>
        <div style={styles.topStats}>
          <span style={styles.statChip}>{remaining} left</span>
          <span style={{ ...styles.statChip, background: "#1e3a5f", color: "#60a5fa" }}>{totalReviewed} done</span>
          <button
            style={{ ...styles.flagBtn, color: card && flaggedIds.has(card.id) ? "#f59e0b" : "#334155" }}
            onClick={(e) => { e.stopPropagation(); if (card) toggleFlag(card.id); }}
          >
            {card && flaggedIds.has(card.id) ? "★" : "☆"}
          </button>
          <button style={{ ...styles.logoutBtn, position: "static", padding: "3px 10px", fontSize: 11 }} onClick={handleLogout}>Log out</button>
        </div>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${(totalReviewed / cards.length) * 100}%` }} />
      </div>
      <div style={styles.cardArea}>
        <div style={{ ...styles.cardWrapper, ...(flipped ? styles.cardWrapperFlipped : {}) }} onClick={() => setFlipped((f) => !f)}>
          <div style={styles.cardFront}>
            <span style={styles.cardSide}>QUESTION</span>
            <p style={styles.cardText}><FormatText text={card?.question} /></p>
            <span style={styles.tapHint}>tap to reveal answer</span>
          </div>
          <div style={styles.cardBack}>
            <span style={{ ...styles.cardSide, color: "#64748b" }}>ANSWER</span>
            <p style={{ ...styles.cardText, color: "#0f172a" }}><FormatText text={card?.answer} /></p>
          </div>
        </div>
      </div>
      {flipped && (
        <div style={styles.ratingArea}>
          <p style={styles.ratingPrompt}>How did you do?</p>
          <div style={styles.ratingRow}>
            {RATINGS.map((r) => (
              <button key={r.value}
                style={{ ...styles.ratingBtn, background: r.color, opacity: savingRating ? 0.6 : 1 }}
                onClick={() => handleRating(r)} disabled={savingRating}
                onMouseOver={e => { if (!savingRating) e.currentTarget.style.background = r.hover; }}
                onMouseOut={e => { e.currentTarget.style.background = r.color; }}>
                <span style={{ fontSize: 18 }}>{r.emoji}</span>
                <span style={styles.ratingLabel}>{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!flipped && lastRating && (
        <button style={styles.undoBtn} onClick={handleUndo}>↩ Undo last rating</button>
      )}
      {!flipped && !lastRating && <p style={styles.flipPrompt}>👆 Tap the card to flip it</p>}
      <div style={styles.shortcutHint}>
        <span style={styles.shortcutKey}>Space</span> flip
        {flipped && (
          <>
            <span style={styles.shortcutSep}>·</span>
            <span style={styles.shortcutKey}>1</span> Forgot
            <span style={styles.shortcutSep}>·</span>
            <span style={styles.shortcutKey}>2</span> Hard
            <span style={styles.shortcutSep}>·</span>
            <span style={styles.shortcutKey}>3</span> Good
            <span style={styles.shortcutSep}>·</span>
            <span style={styles.shortcutKey}>4</span> Easy
          </>
        )}
        <span style={styles.shortcutSep}>·</span>
        <span style={styles.shortcutKey}>F</span> flag
        {!flipped && lastRating && (
          <>
            <span style={styles.shortcutSep}>·</span>
            <span style={styles.shortcutKey}>Z</span> undo
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", width: "100%", background: "#0a0f1e", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Georgia', serif", padding: "0 16px 40px", boxSizing: "border-box" },
  centered: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" },
  spinner: { width: 40, height: 40, border: "3px solid #1e293b", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  selectContainer: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", maxWidth: 480, width: "100%", textAlign: "center" },
  logoImg: { width: 160, height: 160, marginBottom: 8, objectFit: "contain" },
  title: { fontSize: 36, fontWeight: "bold", color: "#f8fafc", margin: "0 0 8px", letterSpacing: "-1px" },
  subtitle: { color: "#64748b", fontSize: 15, marginBottom: 16 },
  hintText: { color: "#334155", fontSize: 13, fontFamily: "sans-serif", marginTop: 16 },
  pillRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", justifyContent: "center" },
  pill: { background: "#111827", border: "1px solid #1e293b", borderRadius: 20, padding: "6px 16px", color: "#64748b", fontSize: 13, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.15s" },
  pillActive: { background: "#1e3a5f", border: "1px solid #3b82f6", color: "#60a5fa" },
  modeRow: { display: "flex", gap: 8, marginBottom: 24, width: "100%" },
  modeBtn: { flex: 1, background: "#111827", border: "1px solid #1e293b", borderRadius: 12, padding: "10px", color: "#64748b", fontSize: 13, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.15s" },
  modeBtnActive: { background: "#1e3a5f", border: "1px solid #3b82f6", color: "#60a5fa" },
  subjectGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%", marginBottom: 16 },
  subjectBtn: { background: "#111827", border: "1px solid #1e293b", borderRadius: 16, padding: "28px 20px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, transition: "transform 0.2s ease, border-color 0.2s", color: "white", position: "relative" },
  subjectBtnSelected: { border: "1px solid #3b82f6", background: "#1a2744" },
  checkmark: { position: "absolute", top: 10, right: 14, color: "#60a5fa", fontSize: 14, fontWeight: "bold" },
  subjectLabel: { fontSize: 15, fontWeight: "600", color: "#e2e8f0", fontFamily: "sans-serif" },
  startBtn: { width: "100%", background: "#3b82f6", color: "white", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif", marginTop: 8 },
  mixedBtn: { width: "100%", background: "#5b21b6", color: "white", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif", marginTop: 8 },
  topicList: { display: "flex", flexDirection: "column", gap: 10, width: "100%", marginBottom: 16 },
  topicBtn: { background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: "18px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color 0.2s", textAlign: "left" },
  topicBtnSelected: { border: "1px solid #3b82f6", background: "#1a2744" },
  topicLabel: { fontSize: 15, fontWeight: "600", color: "#e2e8f0", fontFamily: "sans-serif" },
  topBar: { width: "100%", maxWidth: 480, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 0 12px", gap: 8 },
  backBtn: { background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, fontFamily: "sans-serif", padding: "4px 0" },
  subjectTag: { color: "#94a3b8", fontFamily: "sans-serif", fontSize: 14, fontWeight: "600", letterSpacing: "0.05em", textTransform: "uppercase" },
  topStats: { display: "flex", gap: 6 },
  statChip: { background: "#1a2744", color: "#94a3b8", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontFamily: "sans-serif", fontWeight: "600" },
  progressTrack: { width: "100%", maxWidth: 480, height: 3, background: "#1e293b", borderRadius: 4, marginBottom: 32, overflow: "hidden" },
  progressFill: { height: "100%", background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", borderRadius: 4, transition: "width 0.4s ease" },
  cardArea: { width: "100%", maxWidth: 480, perspective: 1000, marginBottom: 24 },
  cardWrapper: { position: "relative", width: "100%", minHeight: 280, transformStyle: "preserve-3d", transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)", cursor: "pointer", borderRadius: 20 },
  cardWrapperFlipped: { transform: "rotateY(180deg)" },
  cardFront: { position: "absolute", width: "100%", minHeight: 280, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", background: "#111827", border: "1px solid #1e293b", borderRadius: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "36px 28px", boxSizing: "border-box" },
  cardBack: { position: "absolute", width: "100%", minHeight: 280, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", background: "#f8fafc", borderRadius: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "36px 28px", boxSizing: "border-box", transform: "rotateY(180deg)" },
  cardSide: { fontSize: 10, letterSpacing: "0.15em", color: "#334155", fontFamily: "sans-serif", fontWeight: "700", marginBottom: 20, textTransform: "uppercase" },
  cardText: { fontSize: 22, color: "#f1f5f9", textAlign: "center", lineHeight: 1.5, margin: 0 },
  tapHint: { marginTop: 28, fontSize: 12, color: "#334155", fontFamily: "sans-serif", letterSpacing: "0.05em" },
  ratingArea: { width: "100%", maxWidth: 480 },
  ratingPrompt: { color: "#475569", fontSize: 13, fontFamily: "sans-serif", textAlign: "center", marginBottom: 12 },
  ratingRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 },
  ratingBtn: { border: "none", borderRadius: 14, padding: "14px 8px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, transition: "background 0.15s", color: "white" },
  ratingLabel: { fontSize: 12, fontWeight: "700", fontFamily: "sans-serif", letterSpacing: "0.03em" },
  flagBtn: { background: "transparent", border: "none", fontSize: 20, cursor: "pointer", padding: "2px 6px", lineHeight: 1 },
  flaggedBtn: { background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: "18px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color 0.2s", textAlign: "left", color: "#f59e0b" },
  undoBtn: { background: "transparent", border: "1px solid #1e293b", borderRadius: 10, color: "#64748b", fontSize: 13, fontFamily: "sans-serif", cursor: "pointer", padding: "8px 18px", marginTop: 8 },
  shortcutHint: { display: "flex", alignItems: "center", gap: 6, marginTop: 16, color: "#334155", fontSize: 11, fontFamily: "sans-serif", flexWrap: "wrap", justifyContent: "center" },
  shortcutKey: { background: "#1e293b", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: "700", color: "#64748b", fontFamily: "monospace" },
  shortcutSep: { color: "#1e293b" },
  flipPrompt: { color: "#334155", fontSize: 13, fontFamily: "sans-serif", marginTop: 8 },
  doneContainer: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", maxWidth: 400, width: "100%", textAlign: "center" },
  doneEmoji: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 28, color: "#f8fafc", fontWeight: "bold", margin: "0 0 8px" },
  doneSubject: { color: "#64748b", fontSize: 14, fontFamily: "sans-serif", marginBottom: 32 },
  scoreGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, width: "100%", marginBottom: 32 },
  scoreCard: { background: "#111827", border: "1px solid", borderRadius: 14, padding: "16px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  scoreNum: { fontSize: 24, fontWeight: "bold" },
  scoreLabel: { fontSize: 11, color: "#64748b", fontFamily: "sans-serif", fontWeight: "600" },
  btnRow: { display: "flex", gap: 12, width: "100%" },
  againBtn: { flex: 1, background: "#3b82f6", color: "white", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif" },
  switchBtn: { flex: 1, background: "#1e293b", color: "#94a3b8", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif" },
  authInput: { width: "100%", padding: "14px 16px", background: "#111827", border: "1px solid #1e293b", borderRadius: 12, color: "#f1f5f9", fontSize: 15, fontFamily: "sans-serif", boxSizing: "border-box", outline: "none" },
  authError: { color: "#ef4444", fontSize: 13, fontFamily: "sans-serif", margin: 0, textAlign: "center" },
  authToggle: { background: "transparent", border: "none", color: "#60a5fa", fontSize: 13, fontFamily: "sans-serif", cursor: "pointer", marginTop: 16, padding: 0 },
  logoutBtn: { position: "absolute", top: 20, right: 20, background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#64748b", fontSize: 13, fontFamily: "sans-serif", cursor: "pointer", padding: "6px 14px" },
  homeStats: { display: "flex", gap: 10, marginBottom: 12, justifyContent: "center" },
  streakBadge: { display: "flex", alignItems: "center", gap: 6, background: "#422006", borderRadius: 12, padding: "8px 16px" },
  streakFire: { fontSize: 18 },
  streakCount: { fontSize: 20, fontWeight: "bold", color: "#f59e0b", fontFamily: "sans-serif" },
  streakLabel: { fontSize: 13, color: "#d97706", fontFamily: "sans-serif" },
  dueBadge: { display: "flex", alignItems: "center", gap: 8, background: "#1e3a5f", borderRadius: 12, padding: "8px 16px" },
  dueCount: { fontSize: 20, fontWeight: "bold", color: "#60a5fa", fontFamily: "sans-serif" },
  dueLabel: { fontSize: 13, color: "#94a3b8", fontFamily: "sans-serif" },
  tabBar: { display: "flex", gap: 0, width: "100%", marginBottom: 16, borderBottom: "1px solid #1e293b" },
  tab: { flex: 1, background: "transparent", border: "none", borderBottom: "2px solid transparent", color: "#64748b", fontSize: 14, fontWeight: "600", fontFamily: "sans-serif", cursor: "pointer", padding: "12px 0", transition: "all 0.15s" },
  tabActive: { color: "#60a5fa", borderBottom: "2px solid #3b82f6" },
  progressBarTrack: { width: "100%", height: 4, background: "#1e293b", borderRadius: 4, overflow: "hidden", marginTop: 4 },
  progressBarFill: { height: "100%", background: "#22c55e", borderRadius: 4, transition: "width 0.4s ease" },
  progressPct: { fontSize: 11, color: "#64748b", fontFamily: "sans-serif", marginTop: 2 },
};