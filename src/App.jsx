import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const SUBJECTS = ["Biology", "Math", "Art"];

const RATINGS = [
  { label: "Forgot", value: "forgot", color: "#ef4444", hover: "#dc2626", emoji: "😰" },
  { label: "Hard", value: "hard", color: "#f59e0b", hover: "#d97706", emoji: "😓" },
  { label: "Good", value: "good", color: "#3b82f6", hover: "#2563eb", emoji: "🙂" },
  { label: "Easy", value: "easy", color: "#22c55e", hover: "#16a34a", emoji: "😄" },
];

export default function App() {
  const [subject, setSubject] = useState(null);
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ forgot: 0, hard: 0, good: 0, easy: 0 });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [savingRating, setSavingRating] = useState(false);

  useEffect(() => {
    if (subject) fetchCards();
  }, [subject]);

  async function fetchCards() {
    setLoading(true);
    setDone(false);
    setCurrentIndex(0);
    setFlipped(false);
    setScore({ forgot: 0, hard: 0, good: 0, easy: 0 });
    const { data, error } = await supabase
      .from("flashcards")
      .select("*")
      .eq("subject", subject);
    if (!error) setCards(data);
    setLoading(false);
  }

  async function handleRating(rating) {
    if (savingRating) return;
    setSavingRating(true);
    const card = cards[currentIndex];
    await supabase.from("progress").insert({
      flashcard_id: card.id,
      rating: rating.value,
    });
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

  // Subject selection screen
  if (!subject) {
    return (
      <div style={styles.page}>
        <div style={styles.selectContainer}>
          <div style={styles.logoMark}>⚡</div>
          <h1 style={styles.title}>FlashDeck</h1>
          <p style={styles.subtitle}>Choose a subject to begin your session</p>
          <div style={styles.subjectGrid}>
            {SUBJECTS.map((s) => (
              <button key={s} style={styles.subjectBtn} onClick={() => setSubject(s)}
                onMouseOver={e => e.currentTarget.style.transform = "translateY(-3px)"}
                onMouseOut={e => e.currentTarget.style.transform = "translateY(0)"}
              >
                <span style={styles.subjectEmoji}>{s === "Biology" ? "🧬" : "📐"}</span>
                <span style={styles.subjectLabel}>{s}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.centered}>
          <div style={styles.spinner} />
          <p style={{ color: "#94a3b8", marginTop: 16, fontFamily: "monospace" }}>Loading cards...</p>
        </div>
      </div>
    );
  }

  // Session complete
  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.doneContainer}>
          <div style={styles.doneEmoji}>🎉</div>
          <h2 style={styles.doneTitle}>Session Complete!</h2>
          <p style={styles.doneSubject}>{subject} · {cards.length} cards</p>
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
            <button style={styles.againBtn} onClick={() => fetchCards()}>Study Again</button>
            <button style={styles.switchBtn} onClick={() => setSubject(null)}>Switch Subject</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Top Bar */}
      <div style={styles.topBar}>
        <button style={styles.backBtn} onClick={() => setSubject(null)}>← Back</button>
        <span style={styles.subjectTag}>{subject}</span>
        <div style={styles.topStats}>
          <span style={styles.statChip}>{remaining} left</span>
          <span style={{ ...styles.statChip, background: "#1e3a5f", color: "#60a5fa" }}>
            {totalReviewed} done
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${(totalReviewed / cards.length) * 100}%` }} />
      </div>

      {/* Card */}
      <div style={styles.cardArea}>
        <div
          style={{ ...styles.cardWrapper, ...(flipped ? styles.cardWrapperFlipped : {}) }}
          onClick={() => setFlipped((f) => !f)}
        >
          {/* Front */}
          <div style={styles.cardFront}>
            <span style={styles.cardSide}>QUESTION</span>
            <p style={styles.cardText}>{card?.question}</p>
            <span style={styles.tapHint}>tap to reveal answer</span>
          </div>
          {/* Back */}
          <div style={styles.cardBack}>
            <span style={{ ...styles.cardSide, color: "#64748b" }}>ANSWER</span>
            <p style={{ ...styles.cardText, color: "#0f172a" }}>{card?.answer}</p>
          </div>
        </div>
      </div>

      {/* Rating Buttons */}
      {flipped && (
        <div style={styles.ratingArea}>
          <p style={styles.ratingPrompt}>How did you do?</p>
          <div style={styles.ratingRow}>
            {RATINGS.map((r) => (
              <button
                key={r.value}
                style={{ ...styles.ratingBtn, background: r.color, opacity: savingRating ? 0.6 : 1 }}
                onClick={() => handleRating(r)}
                disabled={savingRating}
                onMouseOver={e => { if (!savingRating) e.currentTarget.style.background = r.hover; }}
                onMouseOut={e => { e.currentTarget.style.background = r.color; }}
              >
                <span style={{ fontSize: 18 }}>{r.emoji}</span>
                <span style={styles.ratingLabel}>{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!flipped && (
        <p style={styles.flipPrompt}>👆 Tap the card to flip it</p>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background: "#0a0f1e",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    fontFamily: "'Georgia', serif",
    padding: "0 16px 40px",
    boxSizing: "border-box",
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
  },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid #1e293b",
    borderTop: "3px solid #3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  // Subject select
  selectContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    maxWidth: 400,
    width: "100%",
    textAlign: "center",
  },
  logoMark: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 36, fontWeight: "bold", color: "#f8fafc", margin: "0 0 8px", letterSpacing: "-1px" },
  subtitle: { color: "#64748b", fontSize: 15, marginBottom: 40 },
  subjectGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%" },
  subjectBtn: {
    background: "#111827",
    border: "1px solid #1e293b",
    borderRadius: 16,
    padding: "28px 20px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    transition: "transform 0.2s ease, border-color 0.2s",
    color: "white",
  },
  subjectEmoji: { fontSize: 32 },
  subjectLabel: { fontSize: 15, fontWeight: "600", color: "#e2e8f0", fontFamily: "sans-serif" },

  // Top bar
  topBar: {
    width: "100%",
    maxWidth: 480,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 0 12px",
    gap: 8,
  },
  backBtn: {
    background: "transparent",
    border: "none",
    color: "#475569",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "sans-serif",
    padding: "4px 0",
  },
  subjectTag: {
    color: "#94a3b8",
    fontFamily: "sans-serif",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  topStats: { display: "flex", gap: 6 },
  statChip: {
    background: "#1a2744",
    color: "#94a3b8",
    borderRadius: 20,
    padding: "3px 10px",
    fontSize: 12,
    fontFamily: "sans-serif",
    fontWeight: "600",
  },

  // Progress
  progressTrack: {
    width: "100%",
    maxWidth: 480,
    height: 3,
    background: "#1e293b",
    borderRadius: 4,
    marginBottom: 32,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
    borderRadius: 4,
    transition: "width 0.4s ease",
  },

  // Card
  cardArea: {
    width: "100%",
    maxWidth: 480,
    perspective: 1000,
    marginBottom: 24,
  },
  cardWrapper: {
    position: "relative",
    width: "100%",
    minHeight: 280,
    transformStyle: "preserve-3d",
    transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
    cursor: "pointer",
    borderRadius: 20,
  },
  cardWrapperFlipped: {
    transform: "rotateY(180deg)",
  },
  cardFront: {
    position: "absolute",
    width: "100%",
    minHeight: 280,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    background: "#111827",
    border: "1px solid #1e293b",
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "36px 28px",
    boxSizing: "border-box",
  },
  cardBack: {
    position: "absolute",
    width: "100%",
    minHeight: 280,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    background: "#f8fafc",
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "36px 28px",
    boxSizing: "border-box",
    transform: "rotateY(180deg)",
  },
  cardSide: {
    fontSize: 10,
    letterSpacing: "0.15em",
    color: "#334155",
    fontFamily: "sans-serif",
    fontWeight: "700",
    marginBottom: 20,
    textTransform: "uppercase",
  },
  cardText: {
    fontSize: 22,
    color: "#f1f5f9",
    textAlign: "center",
    lineHeight: 1.5,
    margin: 0,
  },
  tapHint: {
    marginTop: 28,
    fontSize: 12,
    color: "#334155",
    fontFamily: "sans-serif",
    letterSpacing: "0.05em",
  },

  // Ratings
  ratingArea: {
    width: "100%",
    maxWidth: 480,
  },
  ratingPrompt: {
    color: "#475569",
    fontSize: 13,
    fontFamily: "sans-serif",
    textAlign: "center",
    marginBottom: 12,
  },
  ratingRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: 10,
  },
  ratingBtn: {
    border: "none",
    borderRadius: 14,
    padding: "14px 8px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    transition: "background 0.15s, transform 0.1s",
    color: "white",
  },
  ratingLabel: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "sans-serif",
    letterSpacing: "0.03em",
  },
  flipPrompt: {
    color: "#334155",
    fontSize: 13,
    fontFamily: "sans-serif",
    marginTop: 8,
  },

  // Done screen
  doneContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    maxWidth: 400,
    width: "100%",
    textAlign: "center",
  },
  doneEmoji: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 28, color: "#f8fafc", fontWeight: "bold", margin: "0 0 8px" },
  doneSubject: { color: "#64748b", fontSize: 14, fontFamily: "sans-serif", marginBottom: 32 },
  scoreGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: 10,
    width: "100%",
    marginBottom: 32,
  },
  scoreCard: {
    background: "#111827",
    border: "1px solid",
    borderRadius: 14,
    padding: "16px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  scoreNum: { fontSize: 24, fontWeight: "bold" },
  scoreLabel: { fontSize: 11, color: "#64748b", fontFamily: "sans-serif", fontWeight: "600" },
  btnRow: { display: "flex", gap: 12, width: "100%" },
  againBtn: {
    flex: 1,
    background: "#3b82f6",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "14px",
    fontSize: 15,
    fontWeight: "600",
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
  switchBtn: {
    flex: 1,
    background: "#1e293b",
    color: "#94a3b8",
    border: "none",
    borderRadius: 12,
    padding: "14px",
    fontSize: 15,
    fontWeight: "600",
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
};
