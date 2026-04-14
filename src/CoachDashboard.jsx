import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { COLORS, commonStyles } from "./sharedStyles";

function formatDuration(ms) {
  if (!ms || ms <= 0) return "0m";
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function CoachDashboard({ session, profile, onLogout }) {
  const [students, setStudents] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentStats, setStudentStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");

  // Student detail
  const [plans, setPlans] = useState([]);
  const [planStatuses, setPlanStatuses] = useState({});
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);

  // Student name editing
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");

  // Plan form
  const [planType, setPlanType] = useState("daily_cards");
  const [planSubject, setPlanSubject] = useState("");
  const [planTopic, setPlanTopic] = useState("");
  const [planTarget, setPlanTarget] = useState(20);
  const [planNoTarget, setPlanNoTarget] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);

  // Quiz analytics (student detail)
  const [studentQuizAttempts, setStudentQuizAttempts] = useState([]);

  // Quiz management
  const [showQuizMgmt, setShowQuizMgmt] = useState(false);
  const [quizSets, setQuizSets] = useState([]); // [{subject, section, type, count}]
  const [quizReleases, setQuizReleases] = useState([]); // [{id, subject, section, type}]
  const [quizLoading, setQuizLoading] = useState(false);

  // Fetch student list
  useEffect(() => {
    fetchStudents();
  }, []);

  async function fetchStudents() {
    setLoading(true);
    const { data: links } = await supabase
      .from("coach_students")
      .select("*")
      .eq("coach_id", session.user.id);

    if (!links) { setLoading(false); return; }

    const claimed = [];
    const pending = [];
    for (const link of links) {
      if (link.student_id) {
        claimed.push(link);
      } else {
        pending.push(link);
      }
    }
    setPendingInvites(pending);

    // Fetch profiles for claimed students
    if (claimed.length > 0) {
      const studentIds = claimed.map((l) => l.student_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("*")
        .in("id", studentIds);

      const profileMap = {};
      if (profiles) {
        for (const p of profiles) profileMap[p.id] = p;
      }

      const enriched = claimed.map((link) => ({
        ...link,
        profile: profileMap[link.student_id] || null,
      }));
      setStudents(enriched);

      // Fetch stats for all students
      await fetchAllStats(studentIds);
    } else {
      setStudents([]);
    }
    setLoading(false);
  }

  async function fetchAllStats(studentIds) {
    // Fetch sessions for all students
    const { data: allSessions } = await supabase
      .from("study_sessions")
      .select("user_id, started_at, ended_at, cards_studied")
      .in("user_id", studentIds);

    // Fetch all flashcards for subject totals
    const allCards = [];
    let from = 0;
    while (true) {
      const { data: page } = await supabase
        .from("flashcards")
        .select("id, subject")
        .range(from, from + 999);
      if (!page || page.length === 0) break;
      allCards.push(...page);
      if (page.length < 1000) break;
      from += 1000;
    }

    const cardsBySubject = {};
    const cardIdToSubject = {};
    for (const c of allCards) {
      cardsBySubject[c.subject] = (cardsBySubject[c.subject] || 0) + 1;
      cardIdToSubject[c.id] = c.subject;
    }
    const subjectList = Object.keys(cardsBySubject).sort();

    // Fetch easy progress for all students
    const { data: allProgress } = await supabase
      .from("progress")
      .select("user_id, flashcard_id, rating, reviewed_at")
      .in("user_id", studentIds)
      .eq("rating", "easy")
      .order("reviewed_at", { ascending: false });

    const stats = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > today) weekStart.setDate(weekStart.getDate() - 7);

    for (const sid of studentIds) {
      // Study time
      const sessions = (allSessions || []).filter((s) => s.user_id === sid);
      const totalTime = sessions
        .filter((s) => s.ended_at)
        .reduce((sum, s) => sum + (new Date(s.ended_at) - new Date(s.started_at)), 0);
      const dailyCards = sessions
        .filter((s) => new Date(s.started_at) >= today)
        .reduce((sum, s) => sum + (s.cards_studied || 0), 0);
      const weeklyCards = sessions
        .filter((s) => new Date(s.started_at) >= weekStart)
        .reduce((sum, s) => sum + (s.cards_studied || 0), 0);

      // Subject progress
      const progress = (allProgress || []).filter((p) => p.user_id === sid);
      const seen = new Set();
      const easyBySubject = {};
      for (const p of progress) {
        if (seen.has(p.flashcard_id)) continue;
        seen.add(p.flashcard_id);
        const subj = cardIdToSubject[p.flashcard_id];
        if (subj) easyBySubject[subj] = (easyBySubject[subj] || 0) + 1;
      }

      const subjectProgress = {};
      for (const s of subjectList) {
        const total = cardsBySubject[s] || 0;
        const easy = easyBySubject[s] || 0;
        subjectProgress[s] = { total, easy, pct: total > 0 ? Math.round((easy / total) * 100) : 0 };
      }

      stats[sid] = { totalTime, dailyCards, weeklyCards, subjectProgress };
    }

    setStudentStats(stats);
    setSubjects(subjectList);
  }

  async function handleInvite(e) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteMsg("");
    const email = inviteEmail.trim().toLowerCase();
    const name = inviteName.trim();
    if (!email) { setInviteLoading(false); return; }

    // Check if already invited
    const { data: existing } = await supabase
      .from("coach_students")
      .select("id")
      .eq("coach_id", session.user.id)
      .eq("student_email", email);
    if (existing && existing.length > 0) {
      setInviteMsg("Already invited.");
      setInviteLoading(false);
      return;
    }

    const { error } = await supabase.from("coach_students").insert({
      coach_id: session.user.id,
      student_email: email,
      student_name: name || null,
    });

    if (error) {
      setInviteMsg("Error: " + error.message);
    } else {
      setInviteMsg("Invited!");
      setInviteEmail("");
      setInviteName("");
      fetchStudents();
    }
    setInviteLoading(false);
  }

  async function saveStudentName() {
    const name = editName.trim();
    if (!name) return;
    await supabase
      .from("coach_students")
      .update({ student_name: name })
      .eq("id", selectedStudent.id);
    setSelectedStudent((prev) => ({ ...prev, student_name: name }));
    setEditingName(false);
    // Refresh list so name shows there too
    fetchStudents();
  }

  // Student detail
  async function selectStudent(student) {
    setSelectedStudent(student);
    setPlanStatuses({});
    setStudentQuizAttempts([]);
    const { data } = await supabase
      .from("study_plans")
      .select("*")
      .eq("student_id", student.student_id)
      .eq("coach_id", session.user.id)
      .order("created_at", { ascending: false });
    setPlans(data || []);
    if (data && data.length > 0) {
      computePlanStatuses(data, student.student_id);
    }
    // Fetch quiz attempts
    const { data: attempts } = await supabase
      .from("quiz_attempts")
      .select("*")
      .eq("user_id", student.student_id)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(50);
    setStudentQuizAttempts(attempts || []);
  }

  async function fetchTopicsForSubject(subj) {
    const { data } = await supabase
      .from("flashcards")
      .select("topic")
      .eq("subject", subj)
      .limit(1000);
    if (data) {
      const unique = [...new Set(data.map((d) => d.topic).filter(Boolean))].sort();
      setTopics(unique);
    }
  }

  async function handleAddPlan(e) {
    e.preventDefault();
    setPlanLoading(true);
    const plan = {
      coach_id: session.user.id,
      student_id: selectedStudent.student_id,
      plan_type: planType,
      cards_target: planNoTarget ? null : planTarget,
    };
    if (planType === "topic") {
      plan.subject = planSubject;
      plan.topic = planTopic || null;
    }
    const { error } = await supabase.from("study_plans").insert(plan);
    if (!error) {
      const { data } = await supabase
        .from("study_plans")
        .select("*")
        .eq("student_id", selectedStudent.student_id)
        .eq("coach_id", session.user.id)
        .order("created_at", { ascending: false });
      setPlans(data || []);
      if (data) computePlanStatuses(data, selectedStudent.student_id);
    }
    setPlanLoading(false);
  }

  async function computePlanStatuses(plansData, studentId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > today) weekStart.setDate(weekStart.getDate() - 7);

    // Fetch sessions for daily/weekly
    const { data: sessions } = await supabase
      .from("study_sessions")
      .select("started_at, cards_studied")
      .eq("user_id", studentId);

    const dailyCards = (sessions || [])
      .filter((s) => new Date(s.started_at) >= today)
      .reduce((sum, s) => sum + (s.cards_studied || 0), 0);
    const weeklyCards = (sessions || [])
      .filter((s) => new Date(s.started_at) >= weekStart)
      .reduce((sum, s) => sum + (s.cards_studied || 0), 0);

    // Fetch easy progress for topic plans
    const { data: progress } = await supabase
      .from("progress")
      .select("flashcard_id, rating, reviewed_at")
      .eq("user_id", studentId)
      .eq("rating", "easy")
      .order("reviewed_at", { ascending: false });

    const statuses = {};
    for (const plan of plansData) {
      if (plan.plan_type === "daily_cards") {
        if (!plan.cards_target) {
          statuses[plan.id] = dailyCards > 0 ? { label: "Active today", color: COLORS.success } : { label: "No activity today", color: COLORS.textDim };
        } else if (dailyCards >= plan.cards_target) {
          statuses[plan.id] = { label: "Up to date", color: COLORS.success };
        } else {
          statuses[plan.id] = { label: "Lapsed", color: COLORS.danger };
        }
      } else if (plan.plan_type === "weekly_cards") {
        if (!plan.cards_target) {
          statuses[plan.id] = weeklyCards > 0 ? { label: "Active this week", color: COLORS.success } : { label: "No activity this week", color: COLORS.textDim };
        } else if (weeklyCards >= plan.cards_target) {
          statuses[plan.id] = { label: "Up to date", color: COLORS.success };
        } else {
          // Check if they're on pace
          const dayOfWeek = today.getDay() || 7; // 1=Mon, 7=Sun
          const expectedByNow = Math.round((plan.cards_target / 7) * dayOfWeek);
          if (weeklyCards >= expectedByNow) {
            statuses[plan.id] = { label: "On track", color: COLORS.accentLight };
          } else {
            statuses[plan.id] = { label: "Behind", color: COLORS.warning };
          }
        }
      } else if (plan.plan_type === "topic") {
        let query = supabase.from("flashcards").select("id").eq("subject", plan.subject);
        if (plan.topic) query = query.eq("topic", plan.topic);
        const { data: cards } = await query.limit(10000);
        const total = cards ? cards.length : 0;
        const cardIds = new Set((cards || []).map((c) => c.id));
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
        const target = plan.cards_target || total;
        if (target > 0 && easyCount >= target) {
          statuses[plan.id] = { label: "Complete", color: COLORS.success };
        } else {
          const pct = total > 0 ? Math.round((easyCount / target) * 100) : 0;
          statuses[plan.id] = { label: `${pct}% mastered`, color: COLORS.accentLight };
        }
      }
    }
    setPlanStatuses(statuses);
  }

  async function deactivatePlan(planId) {
    await supabase.from("study_plans").update({ active: false }).eq("id", planId);
    setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, active: false } : p)));
  }

  async function deletePlan(planId) {
    await supabase.from("study_plans").delete().eq("id", planId);
    setPlans((prev) => prev.filter((p) => p.id !== planId));
  }

  // Quiz management
  async function fetchQuizSets() {
    setQuizLoading(true);
    // Get all questions to compute distinct sets with counts
    const allQuestions = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from("quiz_questions")
        .select("subject, section, type")
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      allQuestions.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // Deduplicate into sets with counts
    const map = {};
    for (const q of allQuestions) {
      const key = `${q.subject}|||${q.section}|||${q.type}`;
      if (!map[key]) map[key] = { subject: q.subject, section: q.section, type: q.type, count: 0 };
      map[key].count++;
    }
    setQuizSets(Object.values(map).sort((a, b) =>
      a.subject.localeCompare(b.subject) || a.section.localeCompare(b.section) || a.type.localeCompare(b.type)
    ));

    // Get existing releases
    const { data: rels } = await supabase
      .from("quiz_releases")
      .select("id, subject, section, type")
      .eq("coach_id", session.user.id);

    // Filter out orphaned releases that no longer match any quiz set
    const validSets = Object.values(map);
    const validRels = (rels || []).filter(r =>
      validSets.some(s => s.subject === r.subject && s.section === r.section && s.type === r.type)
    );

    // Clean up orphaned rows from DB
    const orphaned = (rels || []).filter(r =>
      !validSets.some(s => s.subject === r.subject && s.section === r.section && s.type === r.type)
    );
    for (const o of orphaned) {
      supabase.from("quiz_releases").delete().eq("id", o.id).then(() => {});
    }

    setQuizReleases(validRels);
    setQuizLoading(false);
  }

  function isReleased(subject, section, type) {
    return quizReleases.some(r => r.subject === subject && r.section === section && r.type === type);
  }

  async function toggleRelease(subject, section, type) {
    const existing = quizReleases.find(r => r.subject === subject && r.section === section && r.type === type);
    if (existing) {
      await supabase.from("quiz_releases").delete().eq("id", existing.id);
      setQuizReleases(prev => prev.filter(r => r.id !== existing.id));
    } else {
      const { data } = await supabase
        .from("quiz_releases")
        .insert({ coach_id: session.user.id, subject, section, type })
        .select()
        .single();
      if (data) setQuizReleases(prev => [...prev, data]);
    }
  }

  async function releaseAllForSubject(subject) {
    const setsForSubj = quizSets.filter(s => s.subject === subject);
    for (const s of setsForSubj) {
      if (!isReleased(s.subject, s.section, s.type)) {
        const { data } = await supabase
          .from("quiz_releases")
          .insert({ coach_id: session.user.id, subject: s.subject, section: s.section, type: s.type })
          .select()
          .single();
        if (data) setQuizReleases(prev => [...prev, data]);
      }
    }
  }

  async function lockAllForSubject(subject) {
    const toRemove = quizReleases.filter(r => r.subject === subject);
    for (const r of toRemove) {
      await supabase.from("quiz_releases").delete().eq("id", r.id);
    }
    setQuizReleases(prev => prev.filter(r => r.subject !== subject));
  }

  // Loading
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.centered}>
          <div style={commonStyles.spinner} />
          <p style={{ color: COLORS.textMuted, marginTop: 16, fontFamily: "monospace" }}>Loading...</p>
        </div>
      </div>
    );
  }

  // Student detail screen
  if (selectedStudent) {
    const stat = studentStats[selectedStudent.student_id] || {};
    const sp = stat.subjectProgress || {};
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <button style={commonStyles.logoutBtn} onClick={onLogout}>Log out</button>
          <div style={styles.header}>
            <button style={commonStyles.backBtn} onClick={() => setSelectedStudent(null)}>← Back</button>
          </div>
          {editingName ? (
            <div style={styles.editNameRow}>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveStudentName()}
                autoFocus
                style={styles.editNameInput}
              />
              <button style={styles.editNameSave} onClick={saveStudentName}>Save</button>
              <button style={styles.editNameCancel} onClick={() => setEditingName(false)}>Cancel</button>
            </div>
          ) : (
            <div style={styles.nameRow}>
              <h1 style={styles.studentName}>
                {selectedStudent.student_name || selectedStudent.profile?.name || selectedStudent.student_email}
              </h1>
              <button
                style={styles.editNameBtn}
                onClick={() => { setEditName(selectedStudent.student_name || selectedStudent.profile?.name || ""); setEditingName(true); }}
              >
                Edit Name
              </button>
            </div>
          )}
          <p style={styles.email}>{selectedStudent.student_email}</p>

          {/* Stats */}
          <div style={styles.statsRow}>
            <div style={styles.statCard}>
              <span style={styles.statNum}>{formatDuration(stat.totalTime)}</span>
              <span style={styles.statLabel}>Total Time</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statNum}>{stat.dailyCards || 0}</span>
              <span style={styles.statLabel}>Today</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statNum}>{stat.weeklyCards || 0}</span>
              <span style={styles.statLabel}>This Week</span>
            </div>
          </div>

          {/* Subject progress */}
          <h2 style={styles.sectionTitle}>Subject Progress</h2>
          {subjects.map((s) => {
            const prog = sp[s] || { pct: 0 };
            return (
              <div key={s} style={styles.subjectRow}>
                <div style={styles.subjectRowHeader}>
                  <span style={styles.subjectName}>{s}</span>
                  <span style={styles.subjectPct}>{prog.pct}%</span>
                </div>
                <div style={commonStyles.progressBarTrack}>
                  <div style={{ ...commonStyles.progressBarFill, width: `${prog.pct}%` }} />
                </div>
              </div>
            );
          })}

          {/* Study Plans */}
          <h2 style={styles.sectionTitle}>Study Plans</h2>
          {plans.filter((p) => p.active).length === 0 && (
            <p style={styles.emptyText}>No active plans</p>
          )}
          {plans.filter((p) => p.active).map((p) => {
            const status = planStatuses[p.id];
            return (
              <div key={p.id} style={styles.planCard}>
                <div style={styles.planInfo}>
                  <span style={styles.planType}>
                    {p.plan_type === "daily_cards" && (p.cards_target ? `${p.cards_target} cards/day` : "Daily practice")}
                    {p.plan_type === "weekly_cards" && (p.cards_target ? `${p.cards_target} cards/week` : "Weekly practice")}
                    {p.plan_type === "topic" && (p.topic ? `${p.subject} > ${p.topic}` : p.subject)}
                  </span>
                  {p.cards_target && p.plan_type === "topic" && (
                    <span style={styles.planDetail}>Target: {p.cards_target} cards mastered</span>
                  )}
                  {status && (
                    <span style={{ ...styles.statusBadge, color: status.color, borderColor: status.color }}>
                      {status.label}
                    </span>
                  )}
                </div>
                <button style={styles.deactivateBtn} onClick={() => deactivatePlan(p.id)}>Remove</button>
              </div>
            );
          })}

          {/* Add Plan Form */}
          <h3 style={styles.subSectionTitle}>Add Plan</h3>
          <form onSubmit={handleAddPlan} style={styles.form}>
            <label style={styles.fieldLabel}>Plan type</label>
            <select
              style={styles.select}
              value={planType}
              onChange={(e) => { setPlanType(e.target.value); setPlanSubject(""); setPlanTopic(""); setPlanNoTarget(false); }}
            >
              <option value="daily_cards">Daily card goal</option>
              <option value="weekly_cards">Weekly card goal</option>
              <option value="topic">Subject / topic assignment</option>
            </select>

            {planType === "topic" && (
              <>
                <label style={styles.fieldLabel}>Subject</label>
                <select
                  style={styles.select}
                  value={planSubject}
                  onChange={(e) => { setPlanSubject(e.target.value); setPlanTopic(""); fetchTopicsForSubject(e.target.value); }}
                >
                  <option value="">Select subject...</option>
                  {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {planSubject && (
                  <>
                    <label style={styles.fieldLabel}>Topic (optional)</label>
                    <select style={styles.select} value={planTopic} onChange={(e) => setPlanTopic(e.target.value)}>
                      <option value="">All topics</option>
                      {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </>
                )}
              </>
            )}

            <div style={styles.targetRow}>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={planNoTarget}
                  onChange={(e) => setPlanNoTarget(e.target.checked)}
                  style={styles.checkbox}
                />
                No specific target
              </label>
            </div>

            {!planNoTarget && (
              <div style={styles.targetRow}>
                <label style={styles.targetLabel}>
                  {planType === "topic" ? "Cards to master:" : "Cards:"}
                </label>
                <input
                  type="number"
                  min="1"
                  value={planTarget}
                  onChange={(e) => setPlanTarget(parseInt(e.target.value) || 1)}
                  style={styles.numberInput}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={planLoading || (planType === "topic" && !planSubject)}
              style={{ ...styles.addBtn, opacity: planLoading ? 0.6 : 1 }}
            >
              {planLoading ? "..." : "Add Plan"}
            </button>
          </form>

          {/* Quiz Performance */}
          <h2 style={styles.sectionTitle}>Quiz Performance</h2>
          {studentQuizAttempts.length === 0 ? (
            <p style={styles.emptyText}>No completed quizzes</p>
          ) : (() => {
            const bySubject = {};
            for (const a of studentQuizAttempts) {
              if (!bySubject[a.subject]) bySubject[a.subject] = [];
              bySubject[a.subject].push(a);
            }
            return Object.entries(bySubject).map(([subj, attempts]) => {
              const avg = Math.round(attempts.reduce((s, a) => s + (a.score_percent || 0), 0) / attempts.length);
              const best = Math.round(Math.max(...attempts.map(a => a.score_percent || 0)));
              const recent = attempts[0];
              return (
                <div key={subj} style={{ width: "100%", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.text }}>{subj}</span>
                    <span style={{ fontSize: 12, color: COLORS.textDim }}>
                      Avg: {avg}% · Best: {best}% · {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {attempts.slice(0, 5).map(a => {
                    const date = new Date(a.started_at);
                    const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    const pct = Math.round(a.score_percent || 0);
                    const pctColor = pct >= 80 ? COLORS.success : pct >= 60 ? COLORS.warning : COLORS.danger;
                    return (
                      <div key={a.id} style={styles.quizAttemptRow}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: COLORS.textLight, fontWeight: 500 }}>
                            {a.section} · {a.type}
                          </div>
                          <div style={{ fontSize: 11, color: COLORS.textDim }}>
                            {dateStr} · {a.mode} · {a.correct_count}/{a.total_questions}
                          </div>
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: pctColor }}>{pct}%</span>
                      </div>
                    );
                  })}
                  {attempts.length > 5 && (
                    <p style={{ fontSize: 12, color: COLORS.textDim, textAlign: "center", margin: "4px 0 0" }}>
                      +{attempts.length - 5} more
                    </p>
                  )}
                </div>
              );
            });
          })()}

          {/* Inactive plans */}
          {plans.filter((p) => !p.active).length > 0 && (
            <>
              <h3 style={styles.subSectionTitle}>Past Plans</h3>
              {plans.filter((p) => !p.active).map((p) => (
                <div key={p.id} style={{ ...styles.planCard, opacity: 0.5 }}>
                  <span style={styles.planType}>
                    {p.plan_type === "daily_cards" && (p.cards_target ? `${p.cards_target} cards/day` : "Daily practice")}
                    {p.plan_type === "weekly_cards" && (p.cards_target ? `${p.cards_target} cards/week` : "Weekly practice")}
                    {p.plan_type === "topic" && (p.topic ? `${p.subject} > ${p.topic}` : p.subject)}
                  </span>
                  <button style={styles.deleteBtn} onClick={() => deletePlan(p.id)}>Delete</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  // Student list screen
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <button style={commonStyles.logoutBtn} onClick={onLogout}>Log out</button>
        <h1 style={styles.title}>Coach Dashboard</h1>
        <p style={styles.subtitle}>
          {students.length} student{students.length !== 1 ? "s" : ""}
          {pendingInvites.length > 0 && ` · ${pendingInvites.length} pending`}
        </p>

        {/* Invite form */}
        <form onSubmit={handleInvite} style={styles.inviteForm}>
          <div style={styles.inviteFields}>
            <input
              type="text"
              placeholder="Student name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              style={styles.inviteInput}
            />
            <input
              type="email"
              placeholder="Student email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              style={styles.inviteInput}
            />
          </div>
          <button type="submit" disabled={inviteLoading} style={styles.inviteBtn}>
            {inviteLoading ? "..." : "Invite"}
          </button>
        </form>
        {inviteMsg && <p style={styles.inviteMsg}>{inviteMsg}</p>}

        {/* Quiz Management */}
        <button
          style={styles.quizMgmtToggle}
          onClick={() => {
            setShowQuizMgmt(!showQuizMgmt);
            if (!showQuizMgmt && quizSets.length === 0) fetchQuizSets();
          }}
        >
          {showQuizMgmt ? "▾" : "▸"} Quiz Management
          {quizReleases.length > 0 && (
            <span style={styles.releasedCount}>{quizReleases.length} released</span>
          )}
        </button>

        {showQuizMgmt && (
          <div style={styles.quizMgmtSection}>
            {quizLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
                <div style={commonStyles.spinner} />
              </div>
            ) : quizSets.length === 0 ? (
              <p style={styles.emptyText}>No quiz questions found in the database.</p>
            ) : (
              (() => {
                const bySubject = {};
                for (const s of quizSets) {
                  if (!bySubject[s.subject]) bySubject[s.subject] = [];
                  bySubject[s.subject].push(s);
                }
                return Object.entries(bySubject).map(([subj, sets]) => {
                  const allReleased = sets.every(s => isReleased(s.subject, s.section, s.type));
                  const noneReleased = sets.every(s => !isReleased(s.subject, s.section, s.type));
                  return (
                    <div key={subj} style={{ marginBottom: 16 }}>
                      <div style={styles.quizSubjectHeader}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.text }}>{subj}</span>
                        <button
                          style={styles.bulkBtn}
                          onClick={() => allReleased ? lockAllForSubject(subj) : releaseAllForSubject(subj)}
                        >
                          {allReleased ? "Lock All" : "Release All"}
                        </button>
                      </div>
                      {sets.map((s, i) => {
                        const released = isReleased(s.subject, s.section, s.type);
                        return (
                          <div key={i} style={styles.quizSetRow}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, color: COLORS.textLight, fontWeight: 500 }}>
                                {s.section}
                              </div>
                              <div style={{ fontSize: 11, color: COLORS.textDim }}>
                                {s.type} · {s.count} Q
                              </div>
                            </div>
                            <button
                              style={{
                                ...styles.releaseBtn,
                                background: released ? COLORS.success : "transparent",
                                color: released ? "white" : COLORS.textDim,
                                border: released ? "none" : `1px solid ${COLORS.border}`,
                              }}
                              onClick={() => toggleRelease(s.subject, s.section, s.type)}
                            >
                              {released ? "Released" : "Locked"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()
            )}
          </div>
        )}

        {/* Search */}
        {students.length > 3 && (
          <input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
        )}

        {/* Student list */}
        <div style={styles.studentList}>
          {students
            .filter((s) => {
              if (!searchQuery) return true;
              const q = searchQuery.toLowerCase();
              const name = (s.student_name || s.profile?.name || "").toLowerCase();
              const email = (s.student_email || "").toLowerCase();
              return name.includes(q) || email.includes(q);
            })
            .map((s) => {
            const stat = studentStats[s.student_id] || {};
            const sp = stat.subjectProgress || {};
            const displayName = s.student_name || s.profile?.name || s.student_email;
            return (
              <div key={s.id} style={styles.studentCard}>
                <div style={styles.studentCardHeader}>
                  <div style={styles.studentCardNameArea}>
                    <span style={styles.studentCardName}>{displayName}</span>
                    {displayName !== s.student_email && (
                      <span style={styles.studentCardEmail}>{s.student_email}</span>
                    )}
                  </div>
                  <span style={styles.lastLogin}>
                    {formatRelativeTime(s.profile?.last_login)}
                  </span>
                </div>
                <div style={styles.studentCardStats}>
                  <span style={styles.miniStat}>{formatDuration(stat.totalTime)} studied</span>
                  <span style={styles.miniStat}>{stat.dailyCards || 0} today</span>
                </div>
                <div style={styles.subjectBars}>
                  {subjects.map((subj) => {
                    const prog = sp[subj] || { pct: 0 };
                    return (
                      <div key={subj} style={styles.miniSubject}>
                        <div style={styles.miniSubjectHeader}>
                          <span style={styles.miniSubjectName}>{subj}</span>
                          <span style={styles.miniSubjectPct}>{prog.pct}%</span>
                        </div>
                        <div style={styles.miniProgressTrack}>
                          <div style={{ ...styles.miniProgressFill, width: `${prog.pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button style={styles.viewBtn} onClick={() => selectStudent(s)}>
                  View Details →
                </button>
              </div>
            );
          })}
        </div>

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <>
            <h2 style={styles.sectionTitle}>Pending Invites</h2>
            {pendingInvites.map((inv) => (
              <div key={inv.id} style={styles.pendingCard}>
                <span style={styles.pendingEmail}>{inv.student_email}</span>
                <span style={styles.pendingBadge}>Pending</span>
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  );
}

const styles = {
  page: commonStyles.page,
  centered: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "100vh",
  },
  container: {
    display: "flex", flexDirection: "column", alignItems: "center",
    minHeight: "100vh", maxWidth: 480, width: "100%", padding: "20px 0",
    position: "relative",
  },
  title: {
    fontSize: 32, fontWeight: "bold", color: COLORS.text,
    margin: "40px 0 8px", letterSpacing: "-1px",
  },
  subtitle: {
    color: COLORS.textDim, fontSize: 14, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", marginBottom: 20,
  },
  header: {
    width: "100%", display: "flex", alignItems: "center", marginBottom: 8,
  },

  // Invite
  inviteForm: {
    display: "flex", gap: 8, width: "100%", marginBottom: 8, alignItems: "flex-end",
  },
  inviteFields: {
    display: "flex", flexDirection: "column", gap: 6, flex: 1,
  },
  inviteInput: {
    ...commonStyles.input, borderRadius: 10, padding: "10px 14px", fontSize: 13,
  },
  inviteBtn: {
    background: COLORS.accent, color: "white", border: "none", borderRadius: 10,
    padding: "10px 18px", fontSize: 13, fontWeight: "600", cursor: "pointer",
    fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", whiteSpace: "nowrap", height: 38,
  },
  inviteMsg: {
    color: COLORS.accentLight, fontSize: 12, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", margin: "0 0 12px",
  },
  searchInput: {
    ...commonStyles.input, borderRadius: 10, padding: "10px 14px", fontSize: 13,
    marginBottom: 12, width: "100%",
  },

  // Student list
  studentList: { display: "flex", flexDirection: "column", gap: 12, width: "100%" },
  studentCard: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 14,
    padding: "16px 18px", cursor: "pointer", display: "flex", flexDirection: "column",
    gap: 10, textAlign: "left", transition: "border-color 0.2s", width: "100%",
    boxSizing: "border-box",
  },
  studentCardHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  studentCardNameArea: {
    display: "flex", flexDirection: "column", gap: 2,
  },
  studentCardName: {
    fontSize: 15, fontWeight: "600", color: COLORS.textLight, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  studentCardEmail: {
    fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  viewBtn: {
    background: COLORS.accentBg, color: COLORS.accentLight, border: "none",
    borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: "600",
    cursor: "pointer", fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", width: "100%", marginTop: 4,
  },
  lastLogin: {
    fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  studentCardStats: {
    display: "flex", gap: 12,
  },
  miniStat: {
    fontSize: 12, color: COLORS.textMuted, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  subjectBars: { display: "flex", flexDirection: "column", gap: 6 },
  miniSubject: { display: "flex", flexDirection: "column", gap: 2 },
  miniSubjectHeader: { display: "flex", justifyContent: "space-between" },
  miniSubjectName: { fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },
  miniSubjectPct: { fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },
  miniProgressTrack: {
    width: "100%", height: 3, background: COLORS.border, borderRadius: 3, overflow: "hidden",
  },
  miniProgressFill: {
    height: "100%", background: COLORS.success, borderRadius: 3, transition: "width 0.4s ease",
  },

  // Pending
  pendingCard: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: "12px 16px", display: "flex", justifyContent: "space-between",
    alignItems: "center", width: "100%", boxSizing: "border-box", marginBottom: 8,
  },
  pendingEmail: { fontSize: 13, color: COLORS.textMuted, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },
  pendingBadge: {
    fontSize: 11, color: COLORS.warning, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", fontWeight: "600",
    background: "#fef3c7", padding: "2px 8px", borderRadius: 8,
  },

  // Student detail
  studentName: {
    fontSize: 24, fontWeight: "bold", color: COLORS.text, margin: "8px 0 4px",
  },
  nameRow: {
    display: "flex", alignItems: "center", gap: 10,
  },
  editNameBtn: {
    background: COLORS.accentBg, border: "none", borderRadius: 8,
    color: COLORS.accentLight, fontSize: 13, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", cursor: "pointer",
    padding: "6px 14px", fontWeight: "600",
  },
  editNameRow: {
    display: "flex", alignItems: "center", gap: 8, marginBottom: 4, width: "100%",
  },
  editNameInput: {
    ...commonStyles.input, flex: 1, borderRadius: 8, padding: "8px 12px", fontSize: 15,
  },
  editNameSave: {
    background: COLORS.accent, color: "white", border: "none", borderRadius: 6,
    padding: "8px 14px", fontSize: 12, fontWeight: "600", cursor: "pointer",
    fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  editNameCancel: {
    background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 6,
    color: COLORS.textDim, fontSize: 12, cursor: "pointer", padding: "8px 12px",
    fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  email: {
    color: COLORS.textDim, fontSize: 13, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", marginBottom: 16,
  },
  statsRow: {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, width: "100%", marginBottom: 24,
  },
  statCard: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12,
    padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
  },
  statNum: { fontSize: 20, fontWeight: "bold", color: COLORS.accentLight },
  statLabel: { fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },

  sectionTitle: {
    fontSize: 16, fontWeight: "bold", color: COLORS.textLight, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
    margin: "20px 0 12px", alignSelf: "flex-start",
  },
  subSectionTitle: {
    fontSize: 14, fontWeight: "600", color: COLORS.textMuted, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
    margin: "16px 0 10px", alignSelf: "flex-start",
  },
  emptyText: {
    color: COLORS.textDarkest, fontSize: 13, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },

  // Subject progress
  subjectRow: { width: "100%", marginBottom: 12 },
  subjectRowHeader: {
    display: "flex", justifyContent: "space-between", marginBottom: 4,
  },
  subjectName: { fontSize: 13, color: COLORS.textLight, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },
  subjectPct: { fontSize: 13, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },

  // Plans
  planCard: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: "12px 16px", display: "flex", justifyContent: "space-between",
    alignItems: "center", width: "100%", boxSizing: "border-box", marginBottom: 8,
  },
  planInfo: { display: "flex", flexDirection: "column", gap: 2 },
  planType: { fontSize: 14, color: COLORS.textLight, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", fontWeight: "600" },
  planDetail: { fontSize: 11, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },
  statusBadge: {
    fontSize: 11, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", fontWeight: "600",
    border: "1px solid", borderRadius: 8, padding: "2px 8px", alignSelf: "flex-start",
  },
  deactivateBtn: {
    background: "transparent", border: `1px solid ${COLORS.danger}`, borderRadius: 8,
    color: COLORS.danger, fontSize: 11, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", cursor: "pointer",
    padding: "4px 10px", whiteSpace: "nowrap",
  },
  deleteBtn: {
    background: "transparent", border: `1px solid ${COLORS.textDarkest}`, borderRadius: 8,
    color: COLORS.textDarkest, fontSize: 11, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", cursor: "pointer",
    padding: "4px 10px", whiteSpace: "nowrap",
  },

  // Add plan form
  form: { display: "flex", flexDirection: "column", gap: 10, width: "100%" },
  select: {
    width: "100%", padding: "10px 14px", background: COLORS.card,
    border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.text,
    fontSize: 13, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", outline: "none",
    appearance: "none", WebkitAppearance: "none",
  },
  fieldLabel: {
    fontSize: 12, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", fontWeight: "600",
    marginBottom: -4, textTransform: "uppercase", letterSpacing: "0.05em",
  },
  targetRow: {
    display: "flex", alignItems: "center", gap: 10,
  },
  targetLabel: { fontSize: 13, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif" },
  checkboxLabel: {
    fontSize: 13, color: COLORS.textDim, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
  },
  checkbox: { accentColor: COLORS.accent },
  numberInput: {
    width: 80, padding: "8px 12px", background: COLORS.card,
    border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text,
    fontSize: 14, fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", outline: "none", textAlign: "center",
  },
  addBtn: {
    background: COLORS.accent, color: "white", border: "none", borderRadius: 10,
    padding: "10px", fontSize: 13, fontWeight: "600", cursor: "pointer",
    fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },

  // Quiz management
  quizMgmtToggle: {
    background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: "10px 14px", fontSize: 14, fontWeight: "600", cursor: "pointer",
    fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif", color: COLORS.text,
    width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
    marginBottom: 12,
  },
  releasedCount: {
    fontSize: 11, color: COLORS.success, fontWeight: 600,
    background: "#f0fdf4", padding: "2px 8px", borderRadius: 8, marginLeft: "auto",
  },
  quizMgmtSection: {
    width: "100%", marginBottom: 16,
  },
  quizSubjectHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 8, padding: "0 2px",
  },
  quizSetRow: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
    marginBottom: 6,
  },
  releaseBtn: {
    borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 600,
    cursor: "pointer", fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
    whiteSpace: "nowrap",
  },
  bulkBtn: {
    background: COLORS.accentBg, color: COLORS.accentLight, border: "none",
    borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600,
    cursor: "pointer", fontFamily: "'Inter', 'Open Sans', Helvetica, Arial, sans-serif",
  },
  quizAttemptRow: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
    marginBottom: 6, width: "100%", boxSizing: "border-box",
  },
};
