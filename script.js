/**
 * ═══════════════════════════════════════════════════════════════════
 * QuizIn — script.js
 * IBM AI Builders Challenge — Capstone Project
 *
 * Architecture:
 *   • AppState  : single source of truth for runtime state
 *   • Storage   : localStorage CRUD helpers
 *   • Router    : SPA view navigation
 *   • Creator   : quiz & question builder logic
 *   • Lobby     : quiz listing & search
 *   • QuizEngine: gameplay logic (timer, scoring, feedback, streak)
 *   • Results   : results rendering, review modal & export
 *   • UI Helpers: toast, stats, streak display, shared DOM helpers
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
──────────────────────────────────────────────────────────────────── */
const LS_KEY_QUIZZES    = 'quizin_quizzes';
const LS_KEY_SCORES     = 'quizin_scores';
const SCORE_PER_CORRECT = 100;
const FEEDBACK_DELAY_MS = 1500;  // ms before advancing to next question
const TIMER_CIRCUMF     = 314.16; // 2 * π * 50  (r=50 in SVG)

/* Category → emoji map */
const CATEGORY_EMOJI = {
  'Umum':       '🌍',
  'Sains':      '🔬',
  'Matematika': '🧮',
  'Sejarah':    '📜',
  'Teknologi':  '💻',
  'Bahasa':     '🗣️',
  'Olahraga':   '⚽',
  'Hiburan':    '🎬',
};

/* ─────────────────────────────────────────────────────────────────
   APP STATE  — single mutable object for runtime state
──────────────────────────────────────────────────────────────────── */
const AppState = {
  role:            'creator',   // 'creator' | 'player'
  currentView:     'home',      // view id string (without 'view-' prefix)
  // ── Creator
  editingQuiz:     null,        // quiz object being edited (or null for new)
  // ── Player / Quiz Engine
  activeQuiz:      null,        // quiz object currently being played
  questionIndex:   0,           // 0-based index of current question
  score:           0,
  correctCount:    0,
  streak:          0,           // consecutive correct answers in current quiz
  startTime:       null,        // Date.now() when quiz started
  questionStart:   null,        // Date.now() when question started (for timing)
  answered:        false,       // whether current question is answered
  timerInterval:   null,        // setInterval handle
  timerRemaining:  0,           // seconds left on timer
  answerLog:       [],          // [{question, chosen, correct, wasCorrect}]
};

/* ─────────────────────────────────────────────────────────────────
   STORAGE MODULE  — localStorage CRUD for quizzes & scores
──────────────────────────────────────────────────────────────────── */
const Storage = {
  /** Load all quizzes from localStorage */
  getQuizzes() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY_QUIZZES)) || [];
    } catch {
      return [];
    }
  },

  /** Persist quizzes array */
  saveQuizzes(quizzes) {
    localStorage.setItem(LS_KEY_QUIZZES, JSON.stringify(quizzes));
  },

  /** Save a single quiz (insert or update by id) */
  upsertQuiz(quiz) {
    const quizzes = Storage.getQuizzes();
    const idx = quizzes.findIndex(q => q.id === quiz.id);
    if (idx !== -1) {
      quizzes[idx] = quiz;
    } else {
      quizzes.unshift(quiz);
    }
    Storage.saveQuizzes(quizzes);
  },

  /** Delete a quiz by id */
  deleteQuiz(id) {
    const quizzes = Storage.getQuizzes().filter(q => q.id !== id);
    Storage.saveQuizzes(quizzes);
  },

  /** Get a single quiz by id */
  getQuizById(id) {
    return Storage.getQuizzes().find(q => q.id === id) || null;
  },

  /** Load scores */
  getScores() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY_SCORES)) || [];
    } catch {
      return [];
    }
  },

  /** Append a score entry */
  saveScore(entry) {
    const scores = Storage.getScores();
    scores.unshift(entry);
    // Keep only last 50
    localStorage.setItem(LS_KEY_SCORES, JSON.stringify(scores.slice(0, 50)));
  },

  /** Best score for a given quiz id */
  getBestScore(quizId) {
    const scores = Storage.getScores().filter(s => s.quizId === quizId);
    if (!scores.length) return null;
    return Math.max(...scores.map(s => s.score));
  },

  /** Global best score across all quizzes */
  globalBestScore() {
    const scores = Storage.getScores();
    if (!scores.length) return null;
    return Math.max(...scores.map(s => s.score));
  },
};

/* ─────────────────────────────────────────────────────────────────
   ROUTER MODULE  — SPA view switching
──────────────────────────────────────────────────────────────────── */
const Router = {
  /**
   * Navigate to a named view.
   * @param {string} viewName - e.g. 'home', 'creator', 'lobby', 'quiz', 'results'
   */
  go(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active');
      v.hidden = true;
    });

    const target = document.getElementById(`view-${viewName}`);
    if (!target) return;

    target.hidden = false;
    // Trigger reflow for animation
    void target.offsetWidth;
    target.classList.add('active');
    AppState.currentView = viewName;

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
};

/* ─────────────────────────────────────────────────────────────────
   UI HELPERS  — toasts, stats, DOM utilities
──────────────────────────────────────────────────────────────────── */
const UI = {
  /** Show a toast notification */
  toast(message, type = 'info', duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => {
      el.className = 'toast';
    }, duration);
  },

  /** Update home screen stats */
  refreshStats() {
    const quizzes = Storage.getQuizzes();
    const totalQ  = quizzes.reduce((sum, q) => sum + (q.questions?.length || 0), 0);
    const best    = Storage.globalBestScore();

    document.getElementById('stat-total-quizzes').textContent   = quizzes.length;
    document.getElementById('stat-total-questions').textContent = totalQ;
    document.getElementById('stat-best-score').textContent      = best !== null ? best : '—';
  },

  /** Update role button visual state and avatar */
  setRole(role) {
    AppState.role = role;
    document.querySelectorAll('.role-btn').forEach(btn => {
      const isActive = btn.dataset.role === role;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    const label  = role === 'creator' ? 'Creator' : 'Player';
    const letter = role === 'creator' ? 'C' : 'P';
    document.getElementById('avatar-label').textContent = label;
    document.getElementById('avatar-img').textContent   = letter;
  },

  /**
   * Safely set textContent (escaping via DOM, no XSS)
   */
  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  /**
   * Show / update the streak badge.
   * Hides the badge when streak < 2.
   * @param {number} streak - current consecutive-correct count
   */
  showStreak(streak) {
    const badge = document.getElementById('streak-badge');
    if (!badge) return;

    if (streak < 2) {
      badge.hidden = true;
      return;
    }

    // Build label and pick intensity class
    const flames  = streak >= 5 ? '🔥🔥🔥' : streak >= 3 ? '🔥🔥' : '🔥';
    badge.textContent = `${flames} ${streak} berturut-turut!`;
    badge.className   = `streak-badge streak-${streak >= 5 ? 'epic' : streak >= 3 ? 'hot' : 'warm'}`;
    badge.hidden      = false;

    // Re-trigger the pop animation by forcing a reflow
    badge.classList.remove('streak-pop');
    void badge.offsetWidth;
    badge.classList.add('streak-pop');
  },
};

/* ─────────────────────────────────────────────────────────────────
   CREATOR MODULE  — quiz & question builder
──────────────────────────────────────────────────────────────────── */
const Creator = {
  /** Array of question draft objects in the builder */
  questions: [],

  /** Reset the creator form to a blank state */
  reset() {
    Creator.questions = [];
    document.getElementById('quiz-title').value = '';
    document.getElementById('quiz-category').value = 'Umum';
    document.getElementById('quiz-time-limit').value = '20';
    AppState.editingQuiz = null;
    Creator.renderQuestions();
  },

  /** Load an existing quiz into the creator for editing */
  loadForEdit(quiz) {
    AppState.editingQuiz = quiz;
    document.getElementById('quiz-title').value      = quiz.title;
    document.getElementById('quiz-category').value   = quiz.category;
    document.getElementById('quiz-time-limit').value = String(quiz.timeLimit);
    Creator.questions = quiz.questions.map(q => ({ ...q }));
    Creator.renderQuestions();
  },

  /** Build a fresh blank question object */
  blankQuestion() {
    return {
      id:      `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text:    '',
      options: { A: '', B: '', C: '', D: '' },
      correct: 'A',
    };
  },

  /** Add a blank question to the builder */
  addQuestion() {
    Creator.questions.push(Creator.blankQuestion());
    Creator.renderQuestions();
    // Scroll to bottom of question list
    setTimeout(() => {
      const list = document.getElementById('questions-list');
      list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  },

  /** Remove a question by its id */
  removeQuestion(qid) {
    Creator.questions = Creator.questions.filter(q => q.id !== qid);
    Creator.renderQuestions();
  },

  /** Render the full question list DOM */
  renderQuestions() {
    const list  = document.getElementById('questions-list');
    const empty = document.getElementById('empty-questions');

    list.innerHTML = '';

    if (Creator.questions.length === 0) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    Creator.questions.forEach((q, idx) => {
      list.appendChild(Creator.buildQuestionCard(q, idx));
    });
  },

  /** Build a single question card DOM element */
  buildQuestionCard(q, idx) {
    const card = document.createElement('div');
    card.className = 'question-item';
    card.dataset.qid = q.id;

    // ── Header row
    const header = document.createElement('div');
    header.className = 'question-item-header';

    const badge = document.createElement('span');
    badge.className = 'question-num-badge';
    badge.textContent = `Soal ${idx + 1}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '🗑 Hapus';
    delBtn.addEventListener('click', () => Creator.removeQuestion(q.id));

    header.append(badge, delBtn);

    // ── Question text
    const qInput = document.createElement('input');
    qInput.type        = 'text';
    qInput.className   = 'form-input';
    qInput.placeholder = `Teks pertanyaan soal ${idx + 1}…`;
    qInput.value       = q.text;
    qInput.maxLength   = 200;
    qInput.setAttribute('aria-label', `Teks soal ${idx + 1}`);
    qInput.addEventListener('input', e => { q.text = e.target.value; });

    // ── Options grid
    const optGrid = document.createElement('div');
    optGrid.className = 'options-builder';

    ['A', 'B', 'C', 'D'].forEach(key => {
      const row = document.createElement('div');
      row.className = 'option-builder-row';

      const keyLabel = document.createElement('span');
      keyLabel.className   = 'option-key-label';
      keyLabel.textContent = key;

      const input = document.createElement('input');
      input.type        = 'text';
      input.className   = 'form-input';
      input.placeholder = `Pilihan ${key}`;
      input.value       = q.options[key];
      input.maxLength   = 160;
      input.setAttribute('aria-label', `Pilihan ${key} soal ${idx + 1}`);
      input.addEventListener('input', e => { q.options[key] = e.target.value; });

      row.append(keyLabel, input);
      optGrid.appendChild(row);
    });

    // ── Correct answer selector
    const correctWrap = document.createElement('div');
    correctWrap.className = 'correct-radio-wrap';

    const correctLabel = document.createElement('span');
    correctLabel.className = 'form-label';
    correctLabel.textContent = 'Jawaban Benar:';
    correctWrap.appendChild(correctLabel);

    ['A', 'B', 'C', 'D'].forEach(key => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type  = 'radio';
      radio.name  = `correct_${q.id}`;
      radio.value = key;
      radio.checked = q.correct === key;
      radio.setAttribute('aria-label', `Jawaban benar pilihan ${key}`);
      radio.addEventListener('change', () => { q.correct = key; });

      const span = document.createElement('span');
      span.textContent = key;

      label.append(radio, span);
      correctWrap.appendChild(label);
    });

    card.append(header, qInput, optGrid, correctWrap);
    return card;
  },

  /** Validate and collect quiz data. Returns quiz object or null. */
  collectAndValidate() {
    const title     = document.getElementById('quiz-title').value.trim();
    const category  = document.getElementById('quiz-category').value;
    const timeLimit = parseInt(document.getElementById('quiz-time-limit').value, 10);

    if (!title) {
      UI.toast('⚠️ Judul kuis tidak boleh kosong!', 'error');
      document.getElementById('quiz-title').focus();
      return null;
    }
    if (Creator.questions.length === 0) {
      UI.toast('⚠️ Tambahkan minimal 1 soal!', 'error');
      return null;
    }

    // Validate each question
    for (let i = 0; i < Creator.questions.length; i++) {
      const q = Creator.questions[i];
      if (!q.text.trim()) {
        UI.toast(`⚠️ Soal ${i + 1}: teks pertanyaan kosong!`, 'error');
        return null;
      }
      const emptyOpts = ['A', 'B', 'C', 'D'].filter(k => !q.options[k].trim());
      if (emptyOpts.length > 0) {
        UI.toast(`⚠️ Soal ${i + 1}: pilihan ${emptyOpts.join(', ')} masih kosong!`, 'error');
        return null;
      }
    }

    const now = new Date();
    return {
      id:        AppState.editingQuiz?.id || `quiz_${Date.now()}`,
      title,
      category,
      timeLimit,
      questions: Creator.questions.map(q => ({ ...q, options: { ...q.options } })),
      createdAt: AppState.editingQuiz?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };
  },

  /** Save quiz to localStorage */
  saveQuiz() {
    const quiz = Creator.collectAndValidate();
    if (!quiz) return;

    Storage.upsertQuiz(quiz);
    UI.toast(`✅ Kuis "${quiz.title}" berhasil disimpan!`, 'success');
    UI.refreshStats();
    Creator.reset();
    Router.go('home');
  },

  /** Export current builder state as JSON file download */
  exportCurrentDraft() {
    const quiz = Creator.collectAndValidate();
    if (!quiz) return;
    Creator.downloadJSON(quiz, `${quiz.title.replace(/\s+/g, '_')}.json`);
  },

  /** Download a JSON object as a file */
  downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Handle JSON file import */
  handleImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        // Basic validation
        if (!data.title || !Array.isArray(data.questions)) {
          throw new Error('Format tidak valid');
        }
        // Give imported quiz a fresh id
        data.id = `quiz_${Date.now()}`;
        data.importedAt = new Date().toISOString();
        Creator.loadForEdit(data);
        UI.toast(`📥 Kuis "${data.title}" berhasil diimpor!`, 'info');
      } catch (err) {
        UI.toast('❌ File JSON tidak valid: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  },
};

/* ─────────────────────────────────────────────────────────────────
   LOBBY MODULE  — quiz listing for players
──────────────────────────────────────────────────────────────────── */
const Lobby = {
  searchTerm: '',

  /** Render the quiz selection grid */
  render() {
    const quizzes   = Storage.getQuizzes();
    const grid      = document.getElementById('quiz-grid');
    const emptyEl   = document.getElementById('empty-lobby');
    const term      = Lobby.searchTerm.toLowerCase();

    const filtered = quizzes.filter(q =>
      q.title.toLowerCase().includes(term) ||
      q.category.toLowerCase().includes(term)
    );

    grid.innerHTML = '';

    if (filtered.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    filtered.forEach(quiz => {
      grid.appendChild(Lobby.buildCard(quiz));
    });
  },

  /** Build a quiz lobby card */
  buildCard(quiz) {
    const card = document.createElement('div');
    card.className    = 'quiz-lobby-card glass-card';
    card.tabIndex     = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Mainkan kuis: ${quiz.title}`);

    const emoji = CATEGORY_EMOJI[quiz.category] || '📋';
    const best  = Storage.getBestScore(quiz.id);

    card.innerHTML = `
      <div class="qlc-emoji">${emoji}</div>
      <div class="qlc-title">${escapeHtml(quiz.title)}</div>
      <div class="qlc-meta">
        <span class="qlc-badge">${escapeHtml(quiz.category)}</span>
        <span class="qlc-badge amber">⏱ ${quiz.timeLimit}dtk/soal</span>
        <span class="qlc-badge">${quiz.questions.length} soal</span>
        ${best !== null ? `<span class="qlc-badge amber">🏆 Best: ${best}</span>` : ''}
      </div>
      <button class="btn btn-primary qlc-play-btn">▶ Mainkan</button>
    `;

    const playBtn = card.querySelector('.qlc-play-btn');
    const doPlay  = () => QuizEngine.start(quiz);
    playBtn.addEventListener('click', doPlay);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doPlay(); }
    });

    return card;
  },
};

/* ─────────────────────────────────────────────────────────────────
   QUIZ ENGINE MODULE  — gameplay, timer, scoring, feedback
──────────────────────────────────────────────────────────────────── */
const QuizEngine = {
  /** Start a quiz */
  start(quiz) {
    AppState.activeQuiz    = quiz;
    AppState.questionIndex = 0;
    AppState.score         = 0;
    AppState.correctCount  = 0;
    AppState.streak        = 0;   // reset streak on new game
    AppState.answerLog     = [];
    AppState.startTime     = Date.now();

    // Hide streak badge from any previous game
    const streakBadge = document.getElementById('streak-badge');
    streakBadge.hidden = true;

    Router.go('quiz');
    QuizEngine.showQuestion();
  },

  /** Display the current question */
  showQuestion() {
    const quiz = AppState.activeQuiz;
    const idx  = AppState.questionIndex;
    const q    = quiz.questions[idx];
    const total = quiz.questions.length;

    AppState.answered     = false;
    AppState.questionStart = Date.now();

    // ── Progress bar
    const pct = (idx / total) * 100;
    document.getElementById('quiz-progress-bar').style.width = `${pct}%`;

    // ── Counter & live score
    UI.setText('quiz-counter', `Soal ${idx + 1} dari ${total}`);
    UI.setText('quiz-score-live', `🏆 ${AppState.score}`);

    // ── Question text
    UI.setText('question-text', q.text);

    // ── Options
    ['A', 'B', 'C', 'D'].forEach(key => {
      const btn  = document.getElementById(`opt-${key}`);
      const span = document.getElementById(`opt-${key}-text`);
      span.textContent  = q.options[key];
      btn.disabled      = false;
      btn.className     = 'option-card';
    });

    // ── Hide feedback overlay
    const overlay = document.getElementById('feedback-overlay');
    overlay.hidden = true;

    // ── Start timer
    QuizEngine.startTimer(quiz.timeLimit);
  },

  /** Start the countdown timer for the current question */
  startTimer(seconds) {
    clearInterval(AppState.timerInterval);
    AppState.timerRemaining = seconds;

    const ringFg    = document.getElementById('timer-ring-fg');
    const numEl     = document.getElementById('timer-number');
    const total     = seconds;

    const update = () => {
      const t    = AppState.timerRemaining;
      const pct  = t / total;
      const dash = TIMER_CIRCUMF * (1 - pct);

      ringFg.style.strokeDashoffset = dash;
      numEl.textContent = t;

      // Colour transitions — also drive progress-bar danger state (≤ 5 s or ≤ 20%)
      const colorClass = t <= Math.ceil(total * 0.2) ? 'danger'
                       : t <= Math.ceil(total * 0.4) ? 'warning'
                       : '';
      ringFg.className = `timer-ring-fg${colorClass ? ' ' + colorClass : ''}`;
      numEl.className  = `timer-number${colorClass ? ' ' + colorClass : ''}`;
      // Apply danger class to progress-wrap so CSS can switch gradient to red
      document.getElementById('quiz-progress-bar').closest('.quiz-progress-wrap')
        .classList.toggle('danger', colorClass === 'danger');
    };

    // Initial render
    ringFg.style.strokeDashoffset = '0';
    update();

    AppState.timerInterval = setInterval(() => {
      AppState.timerRemaining--;
      update();

      if (AppState.timerRemaining <= 0) {
        clearInterval(AppState.timerInterval);
        if (!AppState.answered) {
          QuizEngine.handleTimeout();
        }
      }
    }, 1000);
  },

  /** Called when user clicks an option */
  handleAnswer(chosenKey) {
    if (AppState.answered) return;
    AppState.answered = true;
    clearInterval(AppState.timerInterval);

    const q        = AppState.activeQuiz.questions[AppState.questionIndex];
    const isCorrect = chosenKey === q.correct;
    const timeTaken = Math.round((Date.now() - AppState.questionStart) / 1000);

    // Speed bonus: up to 50 extra points for answering quickly
    const bonus = isCorrect
      ? Math.max(0, Math.round(SCORE_PER_CORRECT * 0.5 * (AppState.timerRemaining / AppState.activeQuiz.timeLimit)))
      : 0;
    const points = isCorrect ? SCORE_PER_CORRECT + bonus : 0;

    if (isCorrect) {
      AppState.score        += points;
      AppState.correctCount++;
      AppState.streak++;
    } else {
      AppState.streak = 0;        // break the streak on wrong answer
    }

    // ── Log the answer
    AppState.answerLog.push({
      question:   q.text,
      options:    q.options,
      chosen:     chosenKey,
      correct:    q.correct,
      wasCorrect: isCorrect,
    });

    // ── Visual feedback on option cards
    QuizEngine.renderFeedback(chosenKey, q.correct, isCorrect);

    // ── Streak display (shown when streak ≥ 2)
    UI.showStreak(AppState.streak);

    // ── Overlay feedback banner
    QuizEngine.showFeedbackBanner(isCorrect ? 'correct' : 'wrong', points);

    // ── Auto-advance after delay
    setTimeout(() => {
      QuizEngine.advance();
    }, FEEDBACK_DELAY_MS);
  },

  /** Called when timer runs out without an answer */
  handleTimeout() {
    AppState.answered = true;
    AppState.streak   = 0;        // timeout breaks the streak
    UI.showStreak(0);

    const q = AppState.activeQuiz.questions[AppState.questionIndex];

    AppState.answerLog.push({
      question:   q.text,
      options:    q.options,
      chosen:     null,
      correct:    q.correct,
      wasCorrect: false,
    });

    // Reveal correct answer
    ['A', 'B', 'C', 'D'].forEach(key => {
      const btn = document.getElementById(`opt-${key}`);
      btn.disabled = true;
      if (key === q.correct) btn.classList.add('reveal');
    });

    QuizEngine.showFeedbackBanner('timeout', 0);

    setTimeout(() => {
      QuizEngine.advance();
    }, FEEDBACK_DELAY_MS);
  },

  /** Colour-code option cards after answer */
  renderFeedback(chosen, correct, isCorrect) {
    ['A', 'B', 'C', 'D'].forEach(key => {
      const btn = document.getElementById(`opt-${key}`);
      btn.disabled = true;

      if (key === chosen && isCorrect)  btn.classList.add('correct');
      if (key === chosen && !isCorrect) btn.classList.add('wrong');
      if (key === correct && !isCorrect && key !== chosen) btn.classList.add('reveal');
    });
  },

  /** Show a brief feedback banner */
  showFeedbackBanner(type, points) {
    const overlay = document.getElementById('feedback-overlay');
    const content = document.getElementById('feedback-content');

    const msgs = {
      correct: `✅ Benar! +${points} poin`,
      wrong:   '❌ Salah!',
      timeout: '⏰ Waktu Habis!',
    };
    content.textContent = msgs[type];
    content.className   = `feedback-content feedback-${type}`;
    overlay.hidden      = false;

    // Update live score
    UI.setText('quiz-score-live', `🏆 ${AppState.score}`);
  },

  /** Advance to the next question or end the quiz */
  advance() {
    const total = AppState.activeQuiz.questions.length;
    AppState.questionIndex++;

    if (AppState.questionIndex >= total) {
      QuizEngine.finish();
    } else {
      QuizEngine.showQuestion();
    }
  },

  /** Finish the quiz — save score and show results */
  finish() {
    clearInterval(AppState.timerInterval);

    const elapsed = Math.round((Date.now() - AppState.startTime) / 1000);
    const total   = AppState.activeQuiz.questions.length;
    const accuracy = total > 0 ? Math.round((AppState.correctCount / total) * 100) : 0;

    // Save score
    Storage.saveScore({
      quizId:    AppState.activeQuiz.id,
      quizTitle: AppState.activeQuiz.title,
      score:     AppState.score,
      correct:   AppState.correctCount,
      total,
      accuracy,
      elapsed,
      playedAt:  new Date().toISOString(),
    });

    UI.refreshStats();
    Results.render(elapsed, accuracy, total);
    Router.go('results');
  },
};

/* ─────────────────────────────────────────────────────────────────
   RESULTS MODULE  — end screen rendering & export
──────────────────────────────────────────────────────────────────── */
const Results = {
  render(elapsed, accuracy, total) {
    const quiz   = AppState.activeQuiz;
    const score  = AppState.score;
    const correct = AppState.correctCount;

    // Trophy emoji based on performance
    const trophy = accuracy >= 90 ? '🏆'
                 : accuracy >= 70 ? '🥇'
                 : accuracy >= 50 ? '🥈'
                 : '🥉';

    document.getElementById('results-trophy').textContent   = trophy;
    document.getElementById('results-title').textContent    = accuracy >= 70 ? 'Luar Biasa!' : accuracy >= 50 ? 'Bagus!' : 'Kuis Selesai!';
    document.getElementById('results-quiz-name').textContent = `📋 ${quiz.title}`;
    document.getElementById('res-score').textContent        = score;
    document.getElementById('res-accuracy').textContent     = `${accuracy}%`;
    document.getElementById('res-correct').textContent      = `${correct}/${total}`;
    document.getElementById('res-time').textContent         = `${elapsed} dtk`;

    // Colour score by accuracy
    const scoreEl = document.getElementById('res-score');
    scoreEl.style.color = accuracy >= 70 ? 'var(--clr-success)'
                        : accuracy >= 40 ? 'var(--clr-amber)'
                        : 'var(--clr-danger)';

    // Breakdown list
    const breakdown = document.getElementById('results-breakdown');
    breakdown.innerHTML = '';
    AppState.answerLog.forEach((entry, i) => {
      const item = document.createElement('div');
      item.className = `breakdown-item ${entry.wasCorrect ? 'correct-bd' : 'wrong-bd'}`;

      const icon = document.createElement('span');
      icon.className   = 'bd-icon';
      icon.textContent = entry.wasCorrect ? '✅' : '❌';

      const info = document.createElement('div');
      const qText = document.createElement('div');
      qText.className   = 'bd-q';
      qText.textContent = `${i + 1}. ${entry.question}`;

      const ansText = document.createElement('div');
      ansText.className = 'bd-ans';

      if (entry.chosen) {
        const chosenTxt = entry.options[entry.chosen];
        const correctTxt = entry.options[entry.correct];
        if (entry.wasCorrect) {
          ansText.textContent = `✔ ${entry.chosen}: ${chosenTxt}`;
        } else {
          ansText.textContent = `✘ Kamu pilih ${entry.chosen}: ${chosenTxt} — Benar: ${entry.correct}: ${correctTxt}`;
        }
      } else {
        ansText.textContent = `⏰ Tidak dijawab — Benar: ${entry.correct}: ${entry.options[entry.correct]}`;
      }

      info.append(qText, ansText);
      item.append(icon, info);
      breakdown.appendChild(item);
    });
  },

  /** Export result as JSON */
  exportResult() {
    const quiz    = AppState.activeQuiz;
    const elapsed = Math.round((Date.now() - AppState.startTime) / 1000);
    const data = {
      quiz:    quiz.title,
      score:   AppState.score,
      correct: AppState.correctCount,
      total:   quiz.questions.length,
      answers: AppState.answerLog,
      playedAt: new Date().toISOString(),
    };
    Creator.downloadJSON(data, `hasil_${quiz.title.replace(/\s+/g, '_')}.json`);
    UI.toast('📊 Hasil berhasil diekspor!', 'success');
  },

  /**
   * Open the "Tinjau Jawaban" review modal.
   * Builds a full per-question breakdown inside the modal DOM.
   */
  openReviewModal() {
    const log     = AppState.answerLog;
    const summary = document.getElementById('modal-summary');
    const body    = document.getElementById('modal-body');
    const backdrop = document.getElementById('modal-backdrop');

    // ── Summary pills
    const totalQ   = log.length;
    const totalOk  = log.filter(e => e.wasCorrect).length;
    const totalBad = totalQ - totalOk;
    summary.innerHTML = '';

    const makePill = (label, cls) => {
      const p = document.createElement('span');
      p.className   = `modal-pill modal-pill-${cls}`;
      p.textContent = label;
      return p;
    };
    summary.appendChild(makePill(`${totalQ} Soal`, 'neutral'));
    summary.appendChild(makePill(`✅ ${totalOk} Benar`, 'correct'));
    summary.appendChild(makePill(`❌ ${totalBad} Salah`, 'wrong'));

    // ── Per-question cards
    body.innerHTML = '';
    log.forEach((entry, i) => {
      const card = document.createElement('div');
      card.className = `review-card ${entry.wasCorrect ? 'review-correct' : 'review-wrong'}`;

      // Question number + text
      const qHeader = document.createElement('div');
      qHeader.className = 'review-q-header';

      const badge = document.createElement('span');
      badge.className   = `review-num ${entry.wasCorrect ? 'badge-correct' : 'badge-wrong'}`;
      badge.textContent = `#${i + 1}`;

      const qText = document.createElement('span');
      qText.className   = 'review-q-text';
      qText.textContent = entry.question;

      qHeader.append(badge, qText);
      card.appendChild(qHeader);

      // Options list
      const optList = document.createElement('div');
      optList.className = 'review-options';

      ['A', 'B', 'C', 'D'].forEach(key => {
        const row = document.createElement('div');
        const isCorrectOpt = key === entry.correct;
        const isChosenOpt  = key === entry.chosen;

        let rowClass = 'review-opt';
        if (isCorrectOpt)                      rowClass += ' review-opt-correct';
        if (isChosenOpt && !entry.wasCorrect)  rowClass += ' review-opt-wrong';
        row.className = rowClass;

        const keySpan = document.createElement('span');
        keySpan.className   = 'review-opt-key';
        keySpan.textContent = key;

        const valSpan = document.createElement('span');
        valSpan.className   = 'review-opt-val';
        valSpan.textContent = entry.options[key];

        // Icon hint
        const icon = document.createElement('span');
        icon.className = 'review-opt-icon';
        if (isCorrectOpt)                        icon.textContent = '✅';
        else if (isChosenOpt && !isCorrectOpt)   icon.textContent = '❌';

        row.append(keySpan, valSpan, icon);
        optList.appendChild(row);
      });

      card.appendChild(optList);

      // Timeout note
      if (!entry.chosen) {
        const note = document.createElement('div');
        note.className   = 'review-timeout-note';
        note.textContent = '⏰ Tidak dijawab (waktu habis)';
        card.appendChild(note);
      }

      body.appendChild(card);
    });

    // ── Show modal
    backdrop.hidden = false;
    // Trap focus on close button
    document.getElementById('modal-close').focus();
  },

  /** Close the review modal */
  closeReviewModal() {
    document.getElementById('modal-backdrop').hidden = true;
    // Return focus to the button that triggered the modal
    document.getElementById('btn-review-answers').focus();
  },
};

/* ─────────────────────────────────────────────────────────────────
   HELPER — HTML escape to prevent XSS
──────────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/* ─────────────────────────────────────────────────────────────────
   SEED DATA  — demo quizzes for first-time visitors
──────────────────────────────────────────────────────────────────── */
function seedDemoData() {
  const existing = Storage.getQuizzes();
  if (existing.length > 0) return; // Already has data

  const demoQuizzes = [
    {
      id: 'demo_sains_1',
      title: 'Trivia Sains Dasar',
      category: 'Sains',
      timeLimit: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'dq1', text: 'Planet manakah yang paling dekat dengan Matahari?',
          options: { A: 'Venus', B: 'Bumi', C: 'Merkurius', D: 'Mars' }, correct: 'C',
        },
        {
          id: 'dq2', text: 'Apa simbol kimia untuk air?',
          options: { A: 'CO2', B: 'H2O', C: 'O2', D: 'NaCl' }, correct: 'B',
        },
        {
          id: 'dq3', text: 'Berapa jumlah tulang pada tubuh manusia dewasa?',
          options: { A: '196', B: '206', C: '216', D: '226' }, correct: 'B',
        },
        {
          id: 'dq4', text: 'Gas apa yang paling banyak terdapat di atmosfer Bumi?',
          options: { A: 'Oksigen', B: 'Karbon dioksida', C: 'Nitrogen', D: 'Argon' }, correct: 'C',
        },
        {
          id: 'dq5', text: 'Siapa yang menemukan teori gravitasi?',
          options: { A: 'Albert Einstein', B: 'Isaac Newton', C: 'Galileo Galilei', D: 'Nikola Tesla' }, correct: 'B',
        },
      ],
    },
    {
      id: 'demo_teknologi_1',
      title: 'Teknologi & Komputer',
      category: 'Teknologi',
      timeLimit: 15,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'dt1', text: 'Singkatan dari CPU adalah…',
          options: { A: 'Central Processing Unit', B: 'Computer Power Unit', C: 'Central Power Unit', D: 'Core Processing Utility' }, correct: 'A',
        },
        {
          id: 'dt2', text: 'Bahasa pemrograman manakah yang dikenal dengan simbol ular?',
          options: { A: 'Java', B: 'Ruby', C: 'Python', D: 'Go' }, correct: 'C',
        },
        {
          id: 'dt3', text: 'Protokol apa yang digunakan untuk mengakses website secara aman?',
          options: { A: 'FTP', B: 'HTTP', C: 'HTTPS', D: 'SMTP' }, correct: 'C',
        },
        {
          id: 'dt4', text: 'Apa kepanjangan dari RAM?',
          options: { A: 'Read Access Memory', B: 'Random Access Memory', C: 'Rapid Array Module', D: 'Real Allocated Memory' }, correct: 'B',
        },
      ],
    },
    {
      id: 'demo_umum_1',
      title: 'Pengetahuan Umum Indonesia',
      category: 'Umum',
      timeLimit: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'du1', text: 'Ibu kota Indonesia adalah…',
          options: { A: 'Surabaya', B: 'Bandung', C: 'Jakarta', D: 'Yogyakarta' }, correct: 'C',
        },
        {
          id: 'du2', text: 'Hari kemerdekaan Indonesia diperingati setiap tanggal…',
          options: { A: '1 Juni', B: '17 Agustus', C: '28 Oktober', D: '10 November' }, correct: 'B',
        },
        {
          id: 'du3', text: 'Gunung berapi tertinggi di Indonesia adalah…',
          options: { A: 'Gunung Semeru', B: 'Gunung Merapi', C: 'Gunung Bromo', D: 'Gunung Rinjani' }, correct: 'A',
        },
        {
          id: 'du4', text: 'Bahasa resmi Indonesia adalah…',
          options: { A: 'Bahasa Jawa', B: 'Bahasa Sunda', C: 'Bahasa Melayu', D: 'Bahasa Indonesia' }, correct: 'D',
        },
        {
          id: 'du5', text: 'Mata uang Indonesia adalah…',
          options: { A: 'Ringgit', B: 'Baht', C: 'Rupiah', D: 'Peso' }, correct: 'C',
        },
      ],
    },
    // ── Extra quiz: Sejarah Dunia
    {
      id: 'demo_sejarah_1',
      title: 'Sejarah Dunia',
      category: 'Sejarah',
      timeLimit: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'ds1', text: 'Tembok Besar China dibangun terutama untuk melindungi dari serangan…',
          options: { A: 'Persia', B: 'Mongolia', C: 'Jepang', D: 'India' }, correct: 'B',
        },
        {
          id: 'ds2', text: 'Perang Dunia II berakhir pada tahun…',
          options: { A: '1943', B: '1944', C: '1945', D: '1946' }, correct: 'C',
        },
        {
          id: 'ds3', text: 'Siapakah tokoh yang memimpin revolusi Prancis?',
          options: { A: 'Napoleon Bonaparte', B: 'Marie Antoinette', C: 'Louis XVI', D: 'Maximilien Robespierre' }, correct: 'D',
        },
        {
          id: 'ds4', text: 'Negara mana yang pertama kali mendarat di Bulan?',
          options: { A: 'Uni Soviet', B: 'Amerika Serikat', C: 'Tiongkok', D: 'Inggris' }, correct: 'B',
        },
        {
          id: 'ds5', text: 'Piramida Agung Giza dibangun untuk menghormati Firaun…',
          options: { A: 'Tutankhamun', B: 'Ramses II', C: 'Khufu', D: 'Cleopatra' }, correct: 'C',
        },
        {
          id: 'ds6', text: 'Benua manakah yang pertama kali ditemukan oleh Christopher Columbus pada 1492?',
          options: { A: 'Amerika Selatan', B: 'Amerika Utara', C: 'Karibia', D: 'Afrika' }, correct: 'C',
        },
      ],
    },
    // ── Extra quiz: Matematika Dasar
    {
      id: 'demo_matematika_1',
      title: 'Matematika Dasar',
      category: 'Matematika',
      timeLimit: 15,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'dm1', text: 'Berapakah hasil dari 7 × 8?',
          options: { A: '54', B: '56', C: '64', D: '48' }, correct: 'B',
        },
        {
          id: 'dm2', text: 'Berapakah akar kuadrat dari 144?',
          options: { A: '10', B: '14', C: '12', D: '11' }, correct: 'C',
        },
        {
          id: 'dm3', text: 'Jika sebuah lingkaran memiliki jari-jari 7 cm, berapakah kelilingnya? (π ≈ 22/7)',
          options: { A: '44 cm', B: '22 cm', C: '154 cm', D: '49 cm' }, correct: 'A',
        },
        {
          id: 'dm4', text: '25% dari 200 adalah…',
          options: { A: '40', B: '50', C: '25', D: '75' }, correct: 'B',
        },
        {
          id: 'dm5', text: 'Berapakah nilai dari 2³ + 3²?',
          options: { A: '15', B: '17', C: '13', D: '11' }, correct: 'B',
        },
        {
          id: 'dm6', text: 'Sebuah segitiga siku-siku memiliki sisi 3 cm dan 4 cm. Panjang sisi miringnya adalah…',
          options: { A: '6 cm', B: '7 cm', C: '5 cm', D: '4,5 cm' }, correct: 'C',
        },
      ],
    },
  ];

  Storage.saveQuizzes(demoQuizzes);
}

/* ─────────────────────────────────────────────────────────────────
   EVENT BINDING  — wire all UI interactions on DOMContentLoaded
──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // ── Seed demo data
  seedDemoData();
  UI.refreshStats();

  // ── Header: Home logo
  document.getElementById('btn-home').addEventListener('click', e => {
    e.preventDefault();
    clearInterval(AppState.timerInterval);
    Router.go('home');
    UI.refreshStats();
  });

  // ── Role switcher buttons
  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role;
      UI.setRole(role);
      // Navigate to appropriate default view
      if (role === 'creator') {
        Creator.reset();
        Router.go('creator');
      } else {
        Lobby.searchTerm = '';
        document.getElementById('lobby-search').value = '';
        Lobby.render();
        Router.go('lobby');
      }
    });
  });

  // ── Home screen CTA buttons
  document.getElementById('btn-start-creator').addEventListener('click', () => {
    UI.setRole('creator');
    Creator.reset();
    Router.go('creator');
  });
  document.getElementById('btn-start-player').addEventListener('click', () => {
    UI.setRole('player');
    Lobby.searchTerm = '';
    document.getElementById('lobby-search').value = '';
    Lobby.render();
    Router.go('lobby');
  });

  // ── Creator: Add question
  document.getElementById('btn-add-question').addEventListener('click', () => {
    Creator.addQuestion();
  });

  // ── Creator: Save quiz
  document.getElementById('btn-save-quiz').addEventListener('click', () => {
    Creator.saveQuiz();
  });

  // ── Creator: Import JSON
  document.getElementById('import-file').addEventListener('change', e => {
    Creator.handleImport(e.target.files[0]);
    // Reset file input so the same file can be re-imported
    e.target.value = '';
  });

  // ── Lobby: Search
  document.getElementById('lobby-search').addEventListener('input', e => {
    Lobby.searchTerm = e.target.value;
    Lobby.render();
  });

  // ── Quiz gameplay: Option buttons
  ['A', 'B', 'C', 'D'].forEach(key => {
    document.getElementById(`opt-${key}`).addEventListener('click', () => {
      QuizEngine.handleAnswer(key);
    });
  });

  // ── Results: action buttons
  document.getElementById('btn-retry-quiz').addEventListener('click', () => {
    if (AppState.activeQuiz) QuizEngine.start(AppState.activeQuiz);
  });
  document.getElementById('btn-choose-quiz').addEventListener('click', () => {
    Lobby.searchTerm = '';
    document.getElementById('lobby-search').value = '';
    Lobby.render();
    Router.go('lobby');
  });
  document.getElementById('btn-export-result').addEventListener('click', () => {
    Results.exportResult();
  });

  // ── Results: "Tinjau Jawaban" button opens review modal
  document.getElementById('btn-review-answers').addEventListener('click', () => {
    Results.openReviewModal();
  });

  // ── Modal: close button + backdrop click + Escape key
  document.getElementById('modal-close').addEventListener('click', () => {
    Results.closeReviewModal();
  });
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    // Close only when clicking the dark backdrop itself (not the panel)
    if (e.target === e.currentTarget) Results.closeReviewModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('modal-backdrop').hidden) {
      Results.closeReviewModal();
    }
  });

  // ── Keyboard accessibility: Enter/Space on role buttons
  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });
  });

  // ── Initial state: start on Home, role = creator
  UI.setRole('creator');
  Router.go('home');
});
