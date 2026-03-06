import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const RATINGS = [
  { label: "Forgot", value: "forgot", color: "#ef4444", hover: "#dc2626", emoji: "😰" },
  { label: "Hard", value: "hard", color: "#f59e0b", hover: "#d97706", emoji: "😓" },
  { label: "Good", value: "good", color: "#3b82f6", hover: "#2563eb", emoji: "🙂" },
  { label: "Easy", value: "easy", color: "#22c55e", hover: "#16a34a", emoji: "😄" },
];

const DIFFICULTIES = ["all", "Easy", "Medium", "Hard"];

export default function App() {
  const [subjects, setSubjects] = useState([]);
  const [subject, setSubject] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topic, setTopic] = useState(null);
  const [difficulty, setDifficulty] = useState("all");
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ forgot: 0, hard: 0, good: 0, easy: 0 });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [savingRating, setSavingRating] = useState(false);

  useEffect(() => {
    async function fetchSubjects() {
      const { data } = await supabase.from("flashcards").select("subject");
      if (data) {
        const unique = [...new Set(data.map((d) => d.subject))].sort();
        setSubjects(unique);
      }
    }
    fetchSubjects();
  }, []);

  useEffect(() => {
    if (!subject) return;
    async function fetchTopics() {
      setLoading(true);
      const { data } = await supabase.from("flashcards").select("topic").eq("subject", subject);
      if (data) {
        const unique = [...new Set(data.map((d) => d.topic).filter(Boolean))].sort();
        setTopics(unique);
      }
      setLoading(false);
    }
    fetchTopics();
  }, [subject]);

  async function fetchCards(selectedTopic, selectedDifficulty) {
    setLoading(true);
    setDone(false);
    setCurrentIndex(0);
    setFlipped(false);
    setScore({ forgot: 0, hard: 0, good: 0, easy: 0 });
    let query = supabase.from("flashcards").select("*").eq("subject", subject);
    if (selectedTopic !== "all") query = query.eq("topic", selectedTopic);
    if (selectedDifficulty !== "all") query = query.eq("difficulty", selectedDifficulty);
    const { data, error } = await query;
    if (!error) setCards(data.sort(() => Math.random() - 0.5));
    setLoading(false);
  }

  async function handleRating(rating) {
    if (savingRating) return;
    setSavingRating(true);
    const card = cards[currentIndex];
    await supabase.from("progress").insert({ flashcard_id: card.id, rating: rating.value });
    setScore((prev) => ({ ...prev, [rating.value]: prev[rating.value] + 1 }));
    if (currentIndex + 1 >= cards.length) {
      setDone(true);
    } else {
      setFlipped(false);
      setTimeout(() => setCurrentIndex((i) => i + 1), 150);
    }
    setSavingRating(false);
  }

  const card = cards[currentIndex];
  const remaining = cards.length - currentIndex;
  const totalReviewed = Object.values(score).reduce((a, b) => a + b, 0);

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

  if (!subject) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <div style={styles.logoMark}>⚡</div>
          <h1 style={styles.title}>FlashDeck</h1>
          <p style={styles.subtitle}>Choose a subject to begin</p>
          <div style={styles.subjectGrid}>
            {subjects.map((s) => (
              <button key={s} style={styles.subjectBtn} onClick={() => setSubject(s)}
                onMouseOver={e => e.currentTarget.style.transform = "translateY(-3px)"}
                onMouseOut={e => e.currentTarget.style.transform = "translateY(0)"}>
                <span style={styles.subjectLabel}>{s}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!topic) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <button style={styles.backBtn} onClick={() => { setSubject(null); setDifficulty("all"); }}>← Back</button>
          <h1 style={styles.title}>{subject}</h1>
          <p style={styles.subtitle}>Choose a topic</p>

          {/* Difficulty filter pills */}
          <div style={styles.pillRow}>
            {DIFFICULTIES.map((d) => (
              <button key={d} style={{ ...styles.pill, ...(difficulty === d ? styles.pillActive : {}) }}
                onClick={() => setDifficulty(d)}>
                {d === "all" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <div style={styles.topicList}>
            <button style={styles.topicBtn}
              onClick={() => fetchCards("all", difficulty).then(() => setTopic("all"))}
              onMouseOver={e => e.currentTarget.style.borderColor = "#3b82f6"}
              onMouseOut={e => e.currentTarget.style.borderColor = "#1e293b"}>
              <span style={styles.topicLabel}>⚡ All Topics</span>
            </button>
            {topics.map((t) => (
              <button key={t} style={styles.topicBtn}
                onClick={() => fetchCards(t, difficulty).then(() => setTopic(t))}
                onMouseOver={e => e.currentTarget.style.borderColor = "#3b82f6"}
                onMouseOut={e => e.currentTarget.style.borderColor = "#1e293b"}>
                <span style={styles.topicLabel}>{t}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.doneContainer}>
          <div style={styles.doneEmoji}>🎉</div>
          <h2 style={styles.doneTitle}>Session Complete!</h2>
          <p style={styles.doneSubject}>
            {subject} · {topic === "all" ? "All Topics" : topic}
            {difficulty !== "all" ? ` · ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}` : ""}
            {" "}· {cards.length} cards
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
            <button style={styles.againBtn} onClick={() => fetchCards(topic, difficulty)}>Study Again</button>
            <button style={styles.switchBtn} onClick={() => setTopic(null)}>Change Topic</button>
            <button style={styles.switchBtn} onClick={() => { setSubject(null); setTopic(null); setDifficulty("all"); }}>Change Subject</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <button style={styles.backBtn} onClick={() => setTopic(null)}>← Back</button>
        <span style={styles.subjectTag}>{topic === "all" ? subject : topic}</span>
        <div style={styles.topStats}>
          <span style={styles.statChip}>{remaining} left</span>
          <span style={{ ...styles.statChip, background: "#1e3a5f", color: "#60a5fa" }}>{totalReviewed} done</span>
        </div>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${(totalReviewed / cards.length) * 100}%` }} />
      </div>
      <div style={styles.cardArea}>
        <div style={{ ...styles.cardWrapper, ...(flipped ? styles.cardWrapperFlipped : {}) }} onClick={() => setFlipped((f) => !f)}>
          <div style={styles.cardFront}>
            <span style={styles.cardSide}>QUESTION</span>
            <p style={styles.cardText}>{card?.question}</p>
            <span style={styles.tapHint}>tap to reveal answer</span>
          </div>
          <div style={styles.cardBack}>
            <span style={{ ...styles.cardSide, color: "#64748b" }}>ANSWER</span>
            <p style={{ ...styles.cardText, color: "#0f172a" }}>{card?.answer}</p>
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
      {!flipped && <p style={styles.flipPrompt}>👆 Tap the card to flip it</p>}
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", width: "100%", background: "#0a0f1e", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Georgia', serif", padding: "0 16px 40px", boxSizing: "border-box" },
  centered: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" },
  spinner: { width: 40, height: 40, border: "3px solid #1e293b", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  selectContainer: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", maxWidth: 480, width: "100%", textAlign: "center" },
  logoMark: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 36, fontWeight: "bold", color: "#f8fafc", margin: "0 0 8px", letterSpacing: "-1px" },
  subtitle: { color: "#64748b", fontSize: 15, marginBottom: 16 },
  pillRow: { display: "flex", gap: 8, marginBottom: 24 },
  pill: { background: "#111827", border: "1px solid #1e293b", borderRadius: 20, padding: "6px 16px", color: "#64748b", fontSize: 13, fontWeight: "600", cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.15s" },
  pillActive: { background: "#1e3a5f", border: "1px solid #3b82f6", color: "#60a5fa" },
  subjectGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%" },
  subjectBtn: { background: "#111827", border: "1px solid #1e293b", borderRadius: 16, padding: "28px 20px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, transition: "transform 0.2s ease", color: "white" },
  subjectLabel: { fontSize: 15, fontWeight: "600", color: "#e2e8f0", fontFamily: "sans-serif" },
  topicList: { display: "flex", flexDirection: "column", gap: 10, width: "100%" },
  topicBtn: { background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: "18px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color 0.2s", textAlign: "left" },
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
};