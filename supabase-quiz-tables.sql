-- Quiz-Review Feature: Database Schema
-- Run this in the Supabase SQL Editor

-- 1. Quiz Questions (preloaded from CSV)
CREATE TABLE quiz_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject TEXT NOT NULL,
  section TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  key TEXT NOT NULL,
  distractor_1 TEXT NOT NULL,
  distractor_2 TEXT NOT NULL,
  distractor_3 TEXT NOT NULL,
  source TEXT,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_qq_subject ON quiz_questions(subject);
CREATE INDEX idx_qq_subject_section ON quiz_questions(subject, section);
CREATE INDEX idx_qq_subject_section_type ON quiz_questions(subject, section, type);

-- 2. Quiz Releases (coach controls student access)
CREATE TABLE quiz_releases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID REFERENCES auth.users(id) NOT NULL,
  subject TEXT NOT NULL,
  section TEXT NOT NULL,
  type TEXT NOT NULL,
  released_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject, section, type)
);

CREATE INDEX idx_qr_subject ON quiz_releases(subject);

-- 3. Quiz Attempts (student quiz sessions)
CREATE TABLE quiz_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  subject TEXT NOT NULL,
  section TEXT NOT NULL,
  type TEXT NOT NULL,
  difficulty TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('review', 'test')),
  session_type TEXT NOT NULL CHECK (session_type IN ('fixed', 'open')),
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  total_questions INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  score_percent NUMERIC(5,2)
);

CREATE INDEX idx_qa_user ON quiz_attempts(user_id);

-- 4. Quiz Responses (individual answers)
CREATE TABLE quiz_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID REFERENCES quiz_attempts(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES quiz_questions(id) NOT NULL,
  selected_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_qresp_attempt ON quiz_responses(attempt_id);

-- 5. Quiz Reports (student-submitted issue reports)
CREATE TABLE quiz_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  question_id UUID REFERENCES quiz_questions(id) NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('typo', 'factual_error', 'other')),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_qrep_question ON quiz_reports(question_id);

-- Row Level Security

ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read quiz questions"
  ON quiz_questions FOR SELECT
  USING (auth.role() = 'authenticated');

ALTER TABLE quiz_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read releases"
  ON quiz_releases FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "Coaches can insert releases"
  ON quiz_releases FOR INSERT
  WITH CHECK (auth.uid() = coach_id);
CREATE POLICY "Coaches can delete releases"
  ON quiz_releases FOR DELETE
  USING (auth.uid() = coach_id);

ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own attempts"
  ON quiz_attempts FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Coaches can read student attempts"
  ON quiz_attempts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM coach_students
    WHERE coach_students.coach_id = auth.uid()
    AND coach_students.student_id = quiz_attempts.user_id
  ));
CREATE POLICY "Users can insert own attempts"
  ON quiz_attempts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own attempts"
  ON quiz_attempts FOR UPDATE
  USING (auth.uid() = user_id);

ALTER TABLE quiz_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own responses"
  ON quiz_responses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM quiz_attempts
    WHERE quiz_attempts.id = quiz_responses.attempt_id
    AND quiz_attempts.user_id = auth.uid()
  ));
CREATE POLICY "Users can insert own responses"
  ON quiz_responses FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM quiz_attempts
    WHERE quiz_attempts.id = quiz_responses.attempt_id
    AND quiz_attempts.user_id = auth.uid()
  ));

ALTER TABLE quiz_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own reports"
  ON quiz_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own reports"
  ON quiz_reports FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Coaches can read all reports"
  ON quiz_reports FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM coach_students
    WHERE coach_students.coach_id = auth.uid()
  ));
