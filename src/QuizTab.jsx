import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { COLORS, FONT, commonStyles } from "./sharedStyles";

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleOptions(question) {
  return shuffleArray([question.key, question.distractor_1, question.distractor_2, question.distractor_3]);
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function scoreColor(pct) {
  if (pct >= 80) return COLORS.success;
  if (pct >= 60) return COLORS.warning;
  return COLORS.danger;
}

export default function QuizTab({ session }) {
  // Navigation
  const [screen, setScreen] = useState("subjects"); // subjects | quizList | setup | quiz | results | history
  // Browse state
  const [releases, setReleases] = useState([]);
  const [quizSubjects, setQuizSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [quizSets, setQuizSets] = useState([]); // [{subject, section, type, count}]
  const [filterSection, setFilterSection] = useState("all");
  const [filterDifficulty, setFilterDifficulty] = useState("all");
  const [filterType, setFilterType] = useState("all");
  // Setup state
  const [selectedQuizSet, setSelectedQuizSet] = useState(null); // {subject, section, type}
  const [quizMode, setQuizMode] = useState(null); // "review" | "test"
  const [sessionType, setSessionType] = useState(null); // "fixed" | "open"
  const [questionCount, setQuestionCount] = useState(20); // for open-ended
  const [availableCount, setAvailableCount] = useState(0);
  // Quiz state
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [options, setOptions] = useState([]);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [responses, setResponses] = useState([]);
  const [attemptId, setAttemptId] = useState(null);
  // Results state
  const [finalScore, setFinalScore] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(null); // null = summary, number = reviewing that question
  const [allOptions, setAllOptions] = useState([]); // shuffled options per question, stored for review
  // History state
  const [history, setHistory] = useState([]);
  // Report state
  const [reportQuestion, setReportQuestion] = useState(null); // question object being reported
  const [reportType, setReportType] = useState(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  // Timer state (test mode)
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerHidden, setTimerHidden] = useState(false);
  const timerRef = useRef(null);
  // Loading
  const [loading, setLoading] = useState(false);

  const inputRef = useRef(null);

  // Timer for test mode
  useEffect(() => {
    if (screen === "quiz" && quizMode === "test") {
      timerRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [screen, quizMode]);

  // Fetch releases on mount
  useEffect(() => {
    if (!session) return;
    fetchReleases();
  }, [session]);

  async function fetchReleases() {
    setLoading(true);
    const { data } = await supabase.from("quiz_releases").select("subject, section, type");
    setReleases(data || []);
    const subjects = [...new Set((data || []).map(r => r.subject))].sort();
    setQuizSubjects(subjects);
    setLoading(false);
  }

  async function selectSubject(subj) {
    setSelectedSubject(subj);
    setFilterSection("all");
    setFilterDifficulty("all");
    setFilterType("all");
    setLoading(true);

    // Get released (section, type) combos for this subject
    const releasedCombos = releases.filter(r => r.subject === subj);

    // Fetch question counts for each combo
    const sets = [];
    for (const combo of releasedCombos) {
      const { count } = await supabase
        .from("quiz_questions")
        .select("*", { count: "exact", head: true })
        .eq("subject", combo.subject)
        .eq("section", combo.section)
        .eq("type", combo.type);
      sets.push({ ...combo, count: count || 0 });
    }
    setQuizSets(sets);
    setScreen("quizList");
    setLoading(false);
  }

  function getFilterOptions() {
    const sections = [...new Set(quizSets.map(q => q.section))].sort();
    const types = [...new Set(quizSets.map(q => q.type))].sort();
    return { sections, types };
  }

  function filteredQuizSets() {
    return quizSets.filter(q => {
      if (filterSection !== "all" && q.section !== filterSection) return false;
      if (filterType !== "all" && q.type !== filterType) return false;
      return true;
    });
  }

  function openReport(question) {
    setReportQuestion(question);
    setReportType(null);
    setReportDetails("");
    setReportDone(false);
  }

  function closeReport() {
    setReportQuestion(null);
    setReportType(null);
    setReportDetails("");
    setReportDone(false);
  }

  async function submitReport() {
    if (!reportType || !reportQuestion) return;
    setReportSubmitting(true);
    await supabase.from("quiz_reports").insert({
      user_id: session.user.id,
      question_id: reportQuestion.id,
      report_type: reportType,
      details: reportDetails.trim() || null,
    });
    setReportSubmitting(false);
    setReportDone(true);
  }

  async function fetchHistory() {
    setLoading(true);
    const { data } = await supabase
      .from("quiz_attempts")
      .select("*")
      .eq("user_id", session.user.id)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(50);
    setHistory(data || []);
    setScreen("history");
    setLoading(false);
  }

  async function openSetup(quizSet) {
    setSelectedQuizSet(quizSet);
    setQuizMode(null);
    setSessionType(null);
    setQuestionCount(20);
    setAvailableCount(quizSet.count);
    setScreen("setup");
  }

  async function startQuiz() {
    setLoading(true);

    let query = supabase
      .from("quiz_questions")
      .select("*")
      .eq("subject", selectedQuizSet.subject)
      .eq("section", selectedQuizSet.section)
      .eq("type", selectedQuizSet.type);

    if (filterDifficulty !== "all") {
      query = query.eq("difficulty", filterDifficulty);
    }

    const { data } = await query;
    let qs = shuffleArray(data || []);

    // For open-ended, limit to questionCount
    if (sessionType === "open") {
      qs = qs.slice(0, questionCount);
    }

    if (qs.length === 0) {
      setLoading(false);
      return;
    }

    // Pre-shuffle options for all questions
    const allOpts = qs.map(q => shuffleOptions(q));
    setAllOptions(allOpts);

    // Create attempt
    const { data: attempt } = await supabase
      .from("quiz_attempts")
      .insert({
        user_id: session.user.id,
        subject: selectedQuizSet.subject,
        section: selectedQuizSet.section,
        type: selectedQuizSet.type,
        difficulty: filterDifficulty !== "all" ? filterDifficulty : null,
        mode: quizMode,
        session_type: sessionType,
        total_questions: qs.length,
      })
      .select()
      .single();

    setQuestions(qs);
    setCurrentQ(0);
    setOptions(allOpts[0]);
    setSelectedAnswer(null);
    setAnswered(false);
    setResponses([]);
    setAttemptId(attempt?.id || null);
    setFinalScore(null);
    setReviewIndex(null);
    setTimerSeconds(0);
    setScreen("quiz");
    setLoading(false);
  }

  async function handleAnswer(answer) {
    if (answered && quizMode === "review") return;
    if (selectedAnswer !== null && quizMode === "test") return;

    const q = questions[currentQ];
    const isCorrect = answer === q.key;
    setSelectedAnswer(answer);

    if (quizMode === "review") {
      setAnswered(true);
      // Save response immediately
      if (attemptId) {
        await supabase.from("quiz_responses").insert({
          attempt_id: attemptId,
          question_id: q.id,
          selected_answer: answer,
          is_correct: isCorrect,
        });
      }
      setResponses(prev => [...prev, { questionId: q.id, selected: answer, isCorrect }]);
    } else {
      // Test mode: record locally, auto-advance after brief highlight
      setResponses(prev => [...prev, { questionId: q.id, selected: answer, isCorrect }]);
      setTimeout(() => {
        advanceQuestion([...responses, { questionId: q.id, selected: answer, isCorrect }]);
      }, 400);
    }
  }

  function nextQuestion() {
    advanceQuestion(responses);
  }

  async function advanceQuestion(currentResponses) {
    const nextIdx = currentQ + 1;
    if (nextIdx >= questions.length) {
      await finishQuiz(currentResponses);
      return;
    }
    setCurrentQ(nextIdx);
    setOptions(allOptions[nextIdx]);
    setSelectedAnswer(null);
    setAnswered(false);
  }

  async function finishQuiz(finalResponses) {
    const correct = finalResponses.filter(r => r.isCorrect).length;
    const total = finalResponses.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    setFinalScore({ correct, total, percent: pct });

    // Update attempt
    if (attemptId) {
      await supabase
        .from("quiz_attempts")
        .update({
          ended_at: new Date().toISOString(),
          correct_count: correct,
          score_percent: pct,
        })
        .eq("id", attemptId);

      // Bulk-insert responses for test mode
      if (quizMode === "test") {
        const rows = finalResponses.map(r => ({
          attempt_id: attemptId,
          question_id: r.questionId,
          selected_answer: r.selected,
          is_correct: r.isCorrect,
        }));
        await supabase.from("quiz_responses").insert(rows);
      }
    }

    setScreen("results");
    setReviewIndex(null);
  }

  async function retakeQuiz() {
    const reshuffled = shuffleArray(questions);
    const allOpts = reshuffled.map(q => shuffleOptions(q));
    setAllOptions(allOpts);

    const { data: attempt } = await supabase
      .from("quiz_attempts")
      .insert({
        user_id: session.user.id,
        subject: selectedQuizSet.subject,
        section: selectedQuizSet.section,
        type: selectedQuizSet.type,
        difficulty: filterDifficulty !== "all" ? filterDifficulty : null,
        mode: quizMode,
        session_type: sessionType,
        total_questions: reshuffled.length,
      })
      .select()
      .single();

    setQuestions(reshuffled);
    setCurrentQ(0);
    setOptions(allOpts[0]);
    setSelectedAnswer(null);
    setAnswered(false);
    setResponses([]);
    setAttemptId(attempt?.id || null);
    setFinalScore(null);
    setReviewIndex(null);
    setTimerSeconds(0);
    setScreen("quiz");
  }

  function backToBrowse() {
    setScreen("subjects");
    setSelectedSubject(null);
    setSelectedQuizSet(null);
    setQuestions([]);
    setResponses([]);
    setFinalScore(null);
  }

  function renderReportModal() {
    if (!reportQuestion) return null;
    return (
      <div style={styles.reportOverlay}>
        <div style={styles.reportModal}>
          {reportDone ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.success, marginBottom: 8 }}>
                Report submitted
              </div>
              <p style={{ fontSize: 14, color: COLORS.textMuted, margin: "0 0 16px" }}>
                Thanks for helping improve the quizzes.
              </p>
              <button style={commonStyles.primaryBtn} onClick={closeReport}>Close</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text, marginBottom: 4 }}>
                Report an Issue
              </div>
              <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "0 0 16px", lineHeight: 1.4 }}>
                {reportQuestion.stem.length > 80
                  ? reportQuestion.stem.slice(0, 80) + "..."
                  : reportQuestion.stem}
              </p>

              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>
                What's the issue?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                {[
                  { value: "typo", label: "Typo or grammar error" },
                  { value: "factual_error", label: "Incorrect answer or factual error" },
                  { value: "other", label: "Other issue" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    style={{
                      ...styles.reportTypeBtn,
                      ...(reportType === opt.value ? styles.reportTypeBtnActive : {}),
                    }}
                    onClick={() => setReportType(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <textarea
                style={styles.reportTextarea}
                placeholder="Details (optional)"
                value={reportDetails}
                onChange={e => setReportDetails(e.target.value)}
                rows={3}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  style={{ ...commonStyles.primaryBtn, flex: 1, opacity: reportType ? 1 : 0.5 }}
                  onClick={reportType ? submitReport : undefined}
                  disabled={reportSubmitting}
                >
                  {reportSubmitting ? "Submitting..." : "Submit"}
                </button>
                <button style={{ ...styles.secondaryBtn, flex: 1 }} onClick={closeReport}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <div style={commonStyles.spinner} />
      </div>
    );
  }

  // ── Subject Grid ──
  if (screen === "subjects") {
    if (quizSubjects.length === 0) {
      return (
        <div style={{ textAlign: "center", padding: "40px 0", color: COLORS.textMuted }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>No quizzes available yet</p>
          <p style={{ fontSize: 14 }}>Your coach hasn't released any quizzes.</p>
        </div>
      );
    }
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <p style={{ color: COLORS.textMuted, fontSize: 15, margin: 0 }}>
            Choose a subject
          </p>
          <button style={styles.historyBtn} onClick={fetchHistory}>
            History
          </button>
        </div>
        <div style={styles.subjectGrid}>
          {quizSubjects.map(s => {
            const count = releases.filter(r => r.subject === s).length;
            return (
              <button
                key={s}
                style={styles.subjectBtn}
                onClick={() => selectSubject(s)}
                onMouseOver={e => { e.currentTarget.style.transform = "translateY(-3px)"; }}
                onMouseOut={e => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <span style={styles.subjectLabel}>{s}</span>
                <span style={{ fontSize: 13, color: COLORS.textDim }}>
                  {count} quiz{count !== 1 ? "zes" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Quiz List ──
  if (screen === "quizList") {
    const { sections, types } = getFilterOptions();
    const filtered = filteredQuizSets();
    return (
      <div>
        <button style={commonStyles.backBtn} onClick={backToBrowse}>← Back</button>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.text, margin: "8px 0 4px" }}>
          {selectedSubject}
        </h2>
        <p style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 12 }}>
          {quizSets.length} released quiz{quizSets.length !== 1 ? "zes" : ""}
        </p>

        {/* Filters */}
        {sections.length > 1 && (
          <div style={styles.filterRow}>
            <span style={styles.filterLabel}>Section:</span>
            <div style={styles.pillRow}>
              <button
                style={{ ...styles.pill, ...(filterSection === "all" ? styles.pillActive : {}) }}
                onClick={() => setFilterSection("all")}
              >All</button>
              {sections.map(s => (
                <button
                  key={s}
                  style={{ ...styles.pill, ...(filterSection === s ? styles.pillActive : {}) }}
                  onClick={() => setFilterSection(s)}
                >{s}</button>
              ))}
            </div>
          </div>
        )}
        {types.length > 1 && (
          <div style={styles.filterRow}>
            <span style={styles.filterLabel}>Type:</span>
            <div style={styles.pillRow}>
              <button
                style={{ ...styles.pill, ...(filterType === "all" ? styles.pillActive : {}) }}
                onClick={() => setFilterType("all")}
              >All</button>
              {types.map(t => (
                <button
                  key={t}
                  style={{ ...styles.pill, ...(filterType === t ? styles.pillActive : {}) }}
                  onClick={() => setFilterType(t)}
                >{t}</button>
              ))}
            </div>
          </div>
        )}
        <div style={styles.filterRow}>
          <span style={styles.filterLabel}>Difficulty:</span>
          <div style={styles.pillRow}>
            {["all", "Easy", "Medium", "Hard"].map(d => (
              <button
                key={d}
                style={{ ...styles.pill, ...(filterDifficulty === d ? styles.pillActive : {}) }}
                onClick={() => setFilterDifficulty(d)}
              >{d === "all" ? "All" : d}</button>
            ))}
          </div>
        </div>

        {/* Quiz set cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {filtered.map((qs, i) => (
            <div key={i} style={styles.quizCard}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.text }}>{qs.section}</div>
                <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>
                  {qs.type} · {qs.count} question{qs.count !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                style={styles.quizStartBtn}
                onClick={() => openSetup(qs)}
              >Start →</button>
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={{ color: COLORS.textMuted, textAlign: "center", padding: 20, fontSize: 14 }}>
              No quizzes match these filters
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Setup Screen ──
  if (screen === "setup") {
    const canStart = quizMode && sessionType;
    return (
      <div>
        <button style={commonStyles.backBtn} onClick={() => setScreen("quizList")}>← Back</button>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.text, margin: "8px 0 4px" }}>
          {selectedQuizSet.section}
        </h2>
        <p style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 20 }}>
          {selectedQuizSet.type} · {availableCount} question{availableCount !== 1 ? "s" : ""}
        </p>

        {/* Mode selection */}
        <div style={styles.setupSection}>
          <div style={styles.setupLabel}>Mode</div>
          <div style={styles.setupRow}>
            <button
              style={{ ...styles.modeBtn, ...(quizMode === "review" ? styles.modeBtnActive : {}) }}
              onClick={() => setQuizMode("review")}
            >
              <span style={{ fontSize: 20 }}>📖</span>
              <span style={{ fontWeight: 600 }}>Review</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>Feedback after each question</span>
            </button>
            <button
              style={{ ...styles.modeBtn, ...(quizMode === "test" ? styles.modeBtnActive : {}) }}
              onClick={() => setQuizMode("test")}
            >
              <span style={{ fontSize: 20 }}>📝</span>
              <span style={{ fontWeight: 600 }}>Test</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>Score at the end</span>
            </button>
          </div>
        </div>

        {/* Session type */}
        <div style={styles.setupSection}>
          <div style={styles.setupLabel}>Session</div>
          <div style={styles.setupRow}>
            <button
              style={{ ...styles.modeBtn, ...(sessionType === "fixed" ? styles.modeBtnActive : {}) }}
              onClick={() => setSessionType("fixed")}
            >
              <span style={{ fontSize: 20 }}>📋</span>
              <span style={{ fontWeight: 600 }}>Full Quiz</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>All {availableCount} questions</span>
            </button>
            <button
              style={{ ...styles.modeBtn, ...(sessionType === "open" ? styles.modeBtnActive : {}) }}
              onClick={() => setSessionType("open")}
            >
              <span style={{ fontSize: 20 }}>🔀</span>
              <span style={{ fontWeight: 600 }}>Practice</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>Choose how many</span>
            </button>
          </div>
        </div>

        {/* Question count for open-ended */}
        {sessionType === "open" && (
          <div style={{ marginBottom: 20 }}>
            <div style={styles.setupLabel}>How many questions?</div>
            <div style={styles.pillRow}>
              {[10, 20, 30, 50].filter(n => n <= availableCount).map(n => (
                <button
                  key={n}
                  style={{ ...styles.pill, ...(questionCount === n ? styles.pillActive : {}) }}
                  onClick={() => setQuestionCount(n)}
                >{n}</button>
              ))}
              {availableCount > 50 && (
                <button
                  style={{ ...styles.pill, ...(questionCount === availableCount ? styles.pillActive : {}) }}
                  onClick={() => setQuestionCount(availableCount)}
                >All ({availableCount})</button>
              )}
            </div>
          </div>
        )}

        <button
          style={{ ...commonStyles.primaryBtn, opacity: canStart ? 1 : 0.5, marginTop: 8 }}
          onClick={canStart ? startQuiz : undefined}
        >
          Start {quizMode === "review" ? "Review" : "Test"} →
        </button>
      </div>
    );
  }

  // ── Quiz Screen ──
  if (screen === "quiz") {
    const q = questions[currentQ];
    const progress = ((currentQ + (quizMode === "test" && selectedAnswer ? 1 : 0)) / questions.length) * 100;
    const isReviewAnswered = quizMode === "review" && answered;

    return (
      <div>
        {/* Top bar */}
        <div style={styles.topBar}>
          <button style={commonStyles.backBtn} onClick={() => {
            if (confirm("Leave this quiz? Your progress will be lost.")) {
              setScreen("quizList");
            }
          }}>← Quit</button>
          <div style={styles.topBarInfo}>
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>
              {currentQ + 1} / {questions.length}
            </span>
            {quizMode === "test" && (
              <span
                style={{ ...styles.timerBadge, cursor: "pointer" }}
                onClick={() => setTimerHidden(h => !h)}
                title={timerHidden ? "Show timer" : "Hide timer"}
              >
                {timerHidden ? "—:——" : formatTimer(timerSeconds)}
              </span>
            )}
            <span style={styles.modeBadge}>
              {quizMode === "review" ? "📖 Review" : "📝 Test"}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={commonStyles.progressBarTrack}>
          <div style={{ ...commonStyles.progressBarFill, width: `${progress}%` }} />
        </div>

        {/* Question */}
        <div style={styles.questionCard}>
          <div style={styles.stemText}>{q.stem}</div>
          {q.source && (
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 8 }}>Source: p. {q.source}</div>
          )}
        </div>

        {/* Options */}
        <div style={styles.optionsList}>
          {options.map((opt, i) => {
            let optStyle = { ...styles.optionBtn };
            if (isReviewAnswered) {
              if (opt === q.key) {
                optStyle = { ...optStyle, ...styles.optionCorrect };
              } else if (opt === selectedAnswer) {
                optStyle = { ...optStyle, ...styles.optionWrong };
              } else {
                optStyle = { ...optStyle, opacity: 0.5 };
              }
            } else if (quizMode === "test" && selectedAnswer === opt) {
              optStyle = { ...optStyle, ...styles.optionSelected };
            }
            const letter = String.fromCharCode(65 + i); // A, B, C, D
            return (
              <button
                key={i}
                style={optStyle}
                onClick={() => handleAnswer(opt)}
                disabled={isReviewAnswered || (quizMode === "test" && selectedAnswer !== null)}
              >
                <span style={styles.optionLetter}>{letter}</span>
                <span style={{ flex: 1 }}>{opt}</span>
                {isReviewAnswered && opt === q.key && <span>✓</span>}
                {isReviewAnswered && opt === selectedAnswer && opt !== q.key && <span>✗</span>}
              </button>
            );
          })}
        </div>

        {/* Review mode feedback */}
        {isReviewAnswered && (
          <div style={styles.feedbackBox}>
            <div style={{
              fontWeight: 600,
              fontSize: 15,
              color: selectedAnswer === q.key ? COLORS.success : COLORS.danger,
              marginBottom: 8
            }}>
              {selectedAnswer === q.key ? "Correct!" : "Incorrect"}
            </div>
            {q.explanation && (
              <div style={{ fontSize: 14, color: COLORS.textLight, lineHeight: 1.5 }}>
                {q.explanation}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button style={{ ...commonStyles.primaryBtn, flex: 1 }} onClick={nextQuestion}>
                {currentQ + 1 < questions.length ? "Next Question →" : "See Results →"}
              </button>
              <button style={styles.reportBtn} onClick={() => openReport(q)}>
                Report
              </button>
            </div>
          </div>
        )}

        {renderReportModal()}
      </div>
    );
  }

  // ── Results Screen ──
  if (screen === "results" && finalScore) {
    // Reviewing a specific question
    if (reviewIndex !== null) {
      const q = questions[reviewIndex];
      const r = responses[reviewIndex];
      const opts = allOptions[reviewIndex];
      return (
        <div>
          <button style={commonStyles.backBtn} onClick={() => setReviewIndex(null)}>← Back to Results</button>
          <div style={{ fontSize: 13, color: COLORS.textMuted, margin: "8px 0 16px" }}>
            Question {reviewIndex + 1} of {questions.length}
          </div>
          <div style={styles.questionCard}>
            <div style={styles.stemText}>{q.stem}</div>
            {q.source && (
              <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 8 }}>Source: p. {q.source}</div>
            )}
          </div>
          <div style={styles.optionsList}>
            {opts.map((opt, i) => {
              let optStyle = { ...styles.optionBtn };
              if (opt === q.key) {
                optStyle = { ...optStyle, ...styles.optionCorrect };
              } else if (opt === r.selected) {
                optStyle = { ...optStyle, ...styles.optionWrong };
              } else {
                optStyle = { ...optStyle, opacity: 0.5 };
              }
              const letter = String.fromCharCode(65 + i);
              return (
                <button key={i} style={optStyle} disabled>
                  <span style={styles.optionLetter}>{letter}</span>
                  <span style={{ flex: 1 }}>{opt}</span>
                  {opt === q.key && <span>✓</span>}
                  {opt === r.selected && opt !== q.key && <span>✗</span>}
                </button>
              );
            })}
          </div>
          {q.explanation && (
            <div style={styles.feedbackBox}>
              <div style={{ fontSize: 14, color: COLORS.textLight, lineHeight: 1.5 }}>{q.explanation}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              style={{ ...styles.navBtn, opacity: reviewIndex === 0 ? 0.4 : 1 }}
              disabled={reviewIndex === 0}
              onClick={() => setReviewIndex(reviewIndex - 1)}
            >← Prev</button>
            <button style={styles.reportBtn} onClick={() => openReport(q)}>Report</button>
            <button
              style={{ ...styles.navBtn, opacity: reviewIndex === questions.length - 1 ? 0.4 : 1 }}
              disabled={reviewIndex === questions.length - 1}
              onClick={() => setReviewIndex(reviewIndex + 1)}
            >Next →</button>
          </div>

          {renderReportModal()}
        </div>
      );
    }

    // Results summary
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>
          {finalScore.percent >= 80 ? "🎉" : finalScore.percent >= 60 ? "👍" : "📚"}
        </div>
        <div style={{
          fontSize: 48,
          fontWeight: 700,
          color: scoreColor(finalScore.percent),
          marginBottom: 4,
        }}>
          {finalScore.percent}%
        </div>
        <div style={{ fontSize: 16, color: COLORS.textMuted, marginBottom: 4 }}>
          {finalScore.correct} of {finalScore.total} correct
        </div>
        <div style={{ fontSize: 14, color: COLORS.textDim, marginBottom: 4 }}>
          {selectedQuizSet?.section} · {selectedQuizSet?.type}
        </div>
        {timerSeconds > 0 && (
          <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 24 }}>
            Time: {formatTimer(timerSeconds)}
          </div>
        )}
        {!timerSeconds && <div style={{ marginBottom: 20 }} />}

        {/* Question review list */}
        <div style={{ textAlign: "left", marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.text, marginBottom: 10 }}>
            Review Answers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {responses.map((r, i) => (
              <button
                key={i}
                style={styles.reviewRow}
                onClick={() => setReviewIndex(i)}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: 12,
                  background: r.isCorrect ? COLORS.success : COLORS.danger,
                  color: "white", fontSize: 13, fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {r.isCorrect ? "✓" : "✗"}
                </span>
                <span style={{
                  flex: 1, fontSize: 14, color: COLORS.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {questions[i]?.stem}
                </span>
                <span style={{ fontSize: 13, color: COLORS.textDim }}>→</span>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{ ...commonStyles.primaryBtn, flex: 1 }}
            onClick={retakeQuiz}
          >Retake</button>
          <button
            style={{ ...styles.secondaryBtn, flex: 1 }}
            onClick={backToBrowse}
          >Back to Quizzes</button>
        </div>
      </div>
    );
  }

  // ── History Screen ──
  if (screen === "history") {
    // Group by subject
    const bySubject = {};
    for (const a of history) {
      if (!bySubject[a.subject]) bySubject[a.subject] = [];
      bySubject[a.subject].push(a);
    }
    return (
      <div>
        <button style={commonStyles.backBtn} onClick={() => setScreen("subjects")}>← Back</button>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.text, margin: "8px 0 16px" }}>
          Quiz History
        </h2>
        {history.length === 0 ? (
          <p style={{ color: COLORS.textMuted, textAlign: "center", padding: 40, fontSize: 14 }}>
            No completed quizzes yet
          </p>
        ) : (
          Object.entries(bySubject).map(([subj, attempts]) => {
            const avg = Math.round(attempts.reduce((s, a) => s + (a.score_percent || 0), 0) / attempts.length);
            return (
              <div key={subj} style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: COLORS.text }}>{subj}</span>
                  <span style={{ fontSize: 13, color: COLORS.textDim }}>Avg: {avg}%</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {attempts.map(a => {
                    const date = new Date(a.started_at);
                    const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    const duration = a.ended_at
                      ? Math.round((new Date(a.ended_at) - date) / 1000)
                      : null;
                    return (
                      <div key={a.id} style={styles.historyCard}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.text }}>
                            {a.section} · {a.type}
                          </div>
                          <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>
                            {dateStr} · {a.mode} · {a.correct_count}/{a.total_questions}
                            {duration !== null && ` · ${formatTimer(duration)}`}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 18, fontWeight: 700,
                          color: scoreColor(a.score_percent || 0),
                        }}>
                          {Math.round(a.score_percent || 0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  return null;
}

const styles = {
  subjectGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  subjectBtn: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: "18px 14px",
    cursor: "pointer",
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    transition: "transform 0.15s ease",
  },
  subjectLabel: {
    fontWeight: 600,
    fontSize: 15,
    color: COLORS.text,
  },
  filterRow: {
    marginBottom: 10,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: COLORS.textMuted,
    marginBottom: 4,
    display: "block",
  },
  pillRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
    fontFamily: FONT,
    color: COLORS.textLight,
    cursor: "pointer",
  },
  pillActive: {
    background: COLORS.accent,
    color: "white",
    border: `1px solid ${COLORS.accent}`,
  },
  quizCard: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  quizStartBtn: {
    background: COLORS.accent,
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: FONT,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  setupSection: {
    marginBottom: 20,
  },
  setupLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: 8,
  },
  setupRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  modeBtn: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: "16px 12px",
    cursor: "pointer",
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    color: COLORS.text,
    fontSize: 14,
    transition: "all 0.15s ease",
  },
  modeBtnActive: {
    borderColor: COLORS.accent,
    background: COLORS.accentBg,
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  topBarInfo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  modeBadge: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: 600,
    background: COLORS.accentBg,
    padding: "3px 8px",
    borderRadius: 8,
  },
  questionCard: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: "20px",
    marginTop: 16,
    marginBottom: 16,
  },
  stemText: {
    fontSize: 16,
    fontWeight: 500,
    color: COLORS.text,
    lineHeight: 1.5,
  },
  optionsList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  optionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 15,
    color: COLORS.text,
    textAlign: "left",
    transition: "all 0.15s ease",
    width: "100%",
    boxSizing: "border-box",
  },
  optionLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    background: COLORS.borderLight,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: 13,
    color: COLORS.textMuted,
    flexShrink: 0,
  },
  optionCorrect: {
    borderColor: COLORS.success,
    background: "#f0fdf4",
    color: COLORS.success,
  },
  optionWrong: {
    borderColor: COLORS.danger,
    background: "#fef2f2",
    color: COLORS.danger,
  },
  optionSelected: {
    borderColor: COLORS.accent,
    background: COLORS.accentBg,
  },
  feedbackBox: {
    background: COLORS.cardAlt,
    border: `1px solid ${COLORS.borderLight}`,
    borderRadius: 12,
    padding: "16px",
    marginTop: 16,
  },
  reviewRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "10px 12px",
    cursor: "pointer",
    fontFamily: FONT,
    width: "100%",
    boxSizing: "border-box",
    textAlign: "left",
  },
  navBtn: {
    flex: 1,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "10px",
    fontSize: 14,
    fontWeight: 500,
    fontFamily: FONT,
    color: COLORS.text,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "14px",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: FONT,
    color: COLORS.text,
    cursor: "pointer",
  },
  historyBtn: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: FONT,
    color: COLORS.textMuted,
    cursor: "pointer",
  },
  historyCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "12px 16px",
  },
  timerBadge: {
    fontSize: 13,
    fontWeight: 600,
    color: COLORS.textLight,
    fontFamily: "monospace",
    background: COLORS.borderLight,
    padding: "3px 8px",
    borderRadius: 8,
  },
  reportBtn: {
    background: "transparent",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: FONT,
    color: COLORS.textDim,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  reportOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  reportModal: {
    background: COLORS.card,
    borderRadius: 16,
    padding: 24,
    maxWidth: 400,
    width: "100%",
    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
  },
  reportTypeBtn: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: FONT,
    color: COLORS.text,
    cursor: "pointer",
    textAlign: "left",
  },
  reportTypeBtnActive: {
    borderColor: COLORS.accent,
    background: COLORS.accentBg,
    color: COLORS.accent,
    fontWeight: 600,
  },
  reportTextarea: {
    width: "100%",
    padding: "10px 14px",
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    color: COLORS.text,
    fontSize: 14,
    fontFamily: FONT,
    boxSizing: "border-box",
    outline: "none",
    resize: "vertical",
  },
};
