/* ==========================================================================
   wouyr. — a minimalist writing space
   Single-file app logic. No build step, no dependencies, all state in
   localStorage under STORAGE_KEY. Read top to bottom:
     1. state + persistence
     2. seed data
     3. tree (sheets & folders) rendering + CRUD
     4. editor + autosave + word counting
     5. goals (multiple, per project or per sheet) + rings/bars
     6. dashboard stats
     7. comments
     8. grammar / style checker (heuristic, fully local)
     9. modals, settings, wiring
   ========================================================================== */

const STORAGE_KEY = 'ledger_app_v1';

/* ---------------------------------------------------------------------- */
/* 1. STATE + PERSISTENCE                                                  */
/* ---------------------------------------------------------------------- */

let store = loadStore() || seedStore();
let activeId = store.lastActiveId || null;
let openMenuId = null;

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Could not read saved data', e);
    return null;
  }
}

let saveTimer = null;
function save(immediate) {
  const doSave = () => {
    try {
      store.lastActiveId = activeId;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn('Could not save', e);
    }
  };
  if (immediate) { clearTimeout(saveTimer); doSave(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 300);
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ---------------------------------------------------------------------- */
/* 2. SEED DATA — shown the first time the app is opened                   */
/* ---------------------------------------------------------------------- */

function seedStore() {
  const outlineId = uid();
  const manuscriptGroupId = uid();
  const ch1 = uid();
  const notesGroupId = uid();
  const charId = uid();
  const locId = uid();
  const worldId = uid();

  return {
    projectName: 'My novel',
    settings: {
      theme: 'dark',
      accent: 'sage',
      fontSize: 17,
      lineHeight: 170,
      editorWidth: 700,
      focusMode: false
    },
    goals: [], // { id, title, target, deadline, scope: 'project'|'sheet', sheetId, baseline: {date, words} }
    rootIds: [outlineId, manuscriptGroupId, notesGroupId],
    nodes: {
      [outlineId]: {
        id: outlineId, type: 'sheet', title: 'Outline', parentId: null,
        content:
`ACT ONE
- Opening image establishes ordinary world
- Inciting incident on page ~12
- Protagonist refuses the call, then commits

ACT TWO
- Midpoint: a false victory that reframes the stakes
- Subplot: the mentor's secret comes out
- All is lost beat before the final act

ACT THREE
- Climax pays off the opening image
- Loose threads from Act Two resolved
- Final image mirrors, but inverts, the first`,
        comments: [], excludeFromGoal: true
      },
      [manuscriptGroupId]: {
        id: manuscriptGroupId, type: 'group', title: 'Manuscript', parentId: null,
        open: true, children: [ch1]
      },
      [ch1]: {
        id: ch1, type: 'sheet', title: 'Chapter 1', parentId: manuscriptGroupId,
        content: 'Start writing here…',
        comments: [], excludeFromGoal: false
      },
      [notesGroupId]: {
        id: notesGroupId, type: 'group', title: 'Notes', parentId: null,
        open: true, children: [charId, locId, worldId]
      },
      [charId]: {
        id: charId, type: 'sheet', title: 'Characters', parentId: notesGroupId,
        content: 'Name — role, want, wound, voice notes.',
        comments: [], excludeFromGoal: true
      },
      [locId]: {
        id: locId, type: 'sheet', title: 'Locations', parentId: notesGroupId,
        content: 'Place — sensory details, who\'s tied to it.',
        comments: [], excludeFromGoal: true
      },
      [worldId]: {
        id: worldId, type: 'sheet', title: 'Worldbuilding rules', parentId: notesGroupId,
        content: 'The rules of the world that must stay consistent.',
        comments: [], excludeFromGoal: true
      }
    },
    lastActiveId: ch1
  };
}

/* ---------------------------------------------------------------------- */
/* DOM refs                                                                */
/* ---------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const el = {
  sidebar: $('#sidebar'), tree: $('#tree'),
  toggleSidebar: $('#toggleSidebar'),
  projectName: $('#projectName'),
  editorCol: $('#editorCol'),
  sheetTopbar: $('#sheetTopbar'),
  sheetTitle: $('#sheetTitle'), editor: $('#editor'),
  savingIndicator: $('#savingIndicator'),
  statusWords: $('#statusWords'),
  miniRingFill: $('#miniRingFill'), miniRingPct: $('#miniRingPct'),
  openDashboardRing: $('#openDashboardRing'),
  openDashboard: $('#openDashboard'), closeDashboard: $('#closeDashboard'),
  dashboardModalBackdrop: $('#dashboardModalBackdrop'),
  topStatGrid: $('#topStatGrid'),
  goalList: $('#goalList'), newGoalBtn: $('#newGoalBtn'),
  commentList: $('#commentList'), commentCount: $('#commentCount'),
  issueList: $('#issueList'), issueCount: $('#issueCount'),
  selectionPopover: $('#selectionPopover'), addCommentBtn: $('#addCommentBtn'),
  goalModalBackdrop: $('#goalModalBackdrop'), goalTitle: $('#goalTitle'), goalTarget: $('#goalTarget'),
  goalDeadline: $('#goalDeadline'), goalScopeSegmented: $('#goalScopeSegmented'),
  saveGoalBtn: $('#saveGoalBtn'), cancelGoalBtn: $('#cancelGoalBtn'),
  settingsModalBackdrop: $('#settingsModalBackdrop'), openSettings: $('#openSettings'),
  closeSettingsBtn: $('#closeSettingsBtn'),
  themeSegmented: $('#themeSegmented'), accentSwatches: $('#accentSwatches'),
  fontSizeRange: $('#fontSizeRange'), fontSizeVal: $('#fontSizeVal'),
  lineHeightRange: $('#lineHeightRange'), lineHeightVal: $('#lineHeightVal'),
  editorWidthRange: $('#editorWidthRange'), editorWidthVal: $('#editorWidthVal'),
  focusModeToggle: $('#focusModeToggle'),
  promptModalBackdrop: $('#promptModalBackdrop'), promptTitle: $('#promptTitle'),
  promptInput: $('#promptInput'), promptSaveBtn: $('#promptSaveBtn'), promptCancelBtn: $('#promptCancelBtn'),
  newSheetBtn: $('#newSheetBtn'), newGroupBtn: $('#newGroupBtn')
};

const ACCENTS = {
  sage: { accent: '#8fa382', soft: 'rgba(143,163,130,0.16)', text: '#1b1a18' },
  gold: { accent: '#c9a15f', soft: 'rgba(201,161,95,0.16)', text: '#1b1a18' },
  clay: { accent: '#bd7f68', soft: 'rgba(189,127,104,0.16)', text: '#1b1a18' },
  ink:  { accent: '#7c93b0', soft: 'rgba(124,147,176,0.16)', text: '#1b1a18' }
};

const MINI_RING_CIRC = 94.2478;   // 2 * PI * 15
const GOAL_CARD_RING_CIRC = 138.23; // 2 * PI * 22

/* ---------------------------------------------------------------------- */
/* 3. TREE — rendering + CRUD                                              */
/* ---------------------------------------------------------------------- */

function node(id) { return store.nodes[id]; }

function siblingsArrayFor(id) {
  const n = node(id);
  if (!n.parentId) return store.rootIds;
  return node(n.parentId).children;
}

function renderTree() {
  el.tree.innerHTML = '';
  if (!store.rootIds.length) {
    el.tree.innerHTML = `<div class="tree-empty">Nothing here yet. Use “+ Sheet” or “+ Folder” below to start organizing your draft.</div>`;
    return;
  }
  store.rootIds.forEach((id) => el.tree.appendChild(renderNode(id, 0)));
}

function renderNode(id, depth) {
  const n = node(id);
  const wrap = document.createElement('div');
  wrap.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-row' + (id === activeId ? ' active' : '');
  row.dataset.id = id;
  row.style.paddingLeft = (6 + depth * 2) + 'px';

  const caret = document.createElement('span');
  caret.className = 'caret' + (n.type === 'group' ? (n.open ? ' open' : '') : ' hidden-caret');
  caret.innerHTML = '<svg viewBox="0 0 20 20"><path d="M7 4l6 6-6 6"/></svg>';

  const icon = document.createElement('span');
  icon.className = 'row-icon';
  icon.innerHTML = n.type === 'group'
    ? '<svg viewBox="0 0 20 20"><path d="M2.5 6.5a1 1 0 0 1 1-1h4l1.5 2h7.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8.5z"/></svg>'
    : '<svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12h-10z"/><path d="M12 2.5v3h3"/></svg>';

  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = n.title || (n.type === 'group' ? 'Untitled folder' : 'Untitled sheet');

  const menuBtn = document.createElement('span');
  menuBtn.className = 'row-menu';
  menuBtn.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="4" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="10" cy="16" r="1.3"/></svg>';
  menuBtn.dataset.menuFor = id;

  row.append(caret, icon, label, menuBtn);
  wrap.appendChild(row);

  if (n.type === 'group') {
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'tree-children';
    childrenWrap.hidden = !n.open;
    (n.children || []).forEach((cid) => childrenWrap.appendChild(renderNode(cid, depth + 1)));
    wrap.appendChild(childrenWrap);
  }

  return wrap;
}

el.tree.addEventListener('click', (e) => {
  const menuBtn = e.target.closest('.row-menu');
  if (menuBtn) { e.stopPropagation(); toggleContextMenu(menuBtn); return; }

  const row = e.target.closest('.tree-row');
  if (!row) return;
  const id = row.dataset.id;
  const n = node(id);

  if (e.target.closest('.caret') && n.type === 'group') {
    n.open = !n.open;
    save();
    renderTree();
    return;
  }

  if (n.type === 'group') {
    n.open = !n.open;
    save();
    renderTree();
  } else {
    selectSheet(id);
  }
});

function toggleContextMenu(menuBtn) {
  document.querySelectorAll('.row-context-menu').forEach((m) => m.remove());
  const id = menuBtn.dataset.menuFor;
  if (openMenuId === id) { openMenuId = null; return; }
  openMenuId = id;
  const n = node(id);
  const menu = document.createElement('div');
  menu.className = 'row-context-menu';

  const items = [];
  if (n.type === 'group') {
    items.push(['New sheet here', () => addSheet(id)]);
    items.push(['New folder here', () => addGroup(id)]);
  }
  items.push(['Rename', () => renameNode(id)]);
  items.push(['Delete', () => deleteNode(id), true]);

  items.forEach(([label, fn, danger]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (danger) b.className = 'danger';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenus(); fn(); });
    menu.appendChild(b);
  });

  menuBtn.parentElement.appendChild(menu);
}

function closeMenus() {
  document.querySelectorAll('.row-context-menu').forEach((m) => m.remove());
  openMenuId = null;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.row-context-menu') && !e.target.closest('.row-menu')) closeMenus();
});

function addSheet(parentId) {
  const id = uid();
  store.nodes[id] = { id, type: 'sheet', title: 'Untitled sheet', parentId: parentId || null, content: '', comments: [], excludeFromGoal: false };
  (parentId ? node(parentId).children : store.rootIds).push(id);
  if (parentId) node(parentId).open = true;
  save(true);
  renderTree();
  selectSheet(id);
}

function addGroup(parentId) {
  const id = uid();
  store.nodes[id] = { id, type: 'group', title: 'Untitled folder', parentId: parentId || null, open: true, children: [] };
  (parentId ? node(parentId).children : store.rootIds).push(id);
  save(true);
  renderTree();
}

function renameNode(id) {
  openPrompt('Rename', node(id).title, (val) => {
    if (val && val.trim()) {
      node(id).title = val.trim();
      save(true);
      renderTree();
      if (id === activeId) el.sheetTitle.value = val.trim();
    }
  });
}

function deleteNode(id) {
  const n = node(id);
  const label = n.type === 'group' ? 'this folder and everything inside it' : 'this sheet';
  if (!confirm(`Delete ${label}? This can\'t be undone.`)) return;

  // collect all descendant sheet ids to clear activeId if needed
  const toDelete = new Set([id]);
  const collect = (nid) => {
    const nn = node(nid);
    if (nn.type === 'group') (nn.children || []).forEach((c) => { toDelete.add(c); collect(c); });
  };
  collect(id);

  const arr = siblingsArrayFor(id);
  const idx = arr.indexOf(id);
  if (idx > -1) arr.splice(idx, 1);
  toDelete.forEach((did) => delete store.nodes[did]);

  if (toDelete.has(activeId)) {
    activeId = null;
    el.sheetTitle.value = '';
    el.editor.value = '';
  }
  save(true);
  renderTree();
  renderEditorEmptyStateIfNeeded();
  updateStatusbar();
}

function renderEditorEmptyStateIfNeeded() {
  if (!activeId) {
    el.sheetTitle.placeholder = 'select or create a sheet';
    el.editor.placeholder = 'Nothing selected. Choose a sheet from the sidebar, or create one.';
    el.sheetTitle.disabled = true;
    el.editor.disabled = true;
  } else {
    el.sheetTitle.disabled = false;
    el.editor.disabled = false;
    el.sheetTitle.placeholder = 'untitled';
    el.editor.placeholder = 'Start writing…';
  }
}

/* ---------------------------------------------------------------------- */
/* 4. EDITOR                                                                */
/* ---------------------------------------------------------------------- */

function selectSheet(id) {
  activeId = id;
  const n = node(id);
  el.sheetTitle.value = n.title === 'Untitled sheet' ? '' : n.title;
  el.editor.value = n.content || '';
  renderEditorEmptyStateIfNeeded();
  renderTree();
  clearSavingIndicator();
  updateStatusbar();
  runGrammarCheck();
  save(true);
}

el.sheetTitle.addEventListener('input', () => {
  if (!activeId) return;
  node(activeId).title = el.sheetTitle.value.trim() || 'Untitled sheet';
  flashSaving();
  save();
  renderTree();
});

let editorDebounce = null;
el.editor.addEventListener('input', () => {
  if (!activeId) return;
  node(activeId).content = el.editor.value;
  flashSaving();
  updateStatusbar();
  save();
  clearTimeout(editorDebounce);
  editorDebounce = setTimeout(() => {
    runGrammarCheck();
  }, 500);
});

function wordCount(text) {
  if (!text) return 0;
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function allSheets() {
  return Object.values(store.nodes).filter((n) => n.type === 'sheet');
}

function projectTotalWords(includeExcluded) {
  return allSheets().reduce((sum, s) => {
    if (!includeExcluded && s.excludeFromGoal) return sum;
    return sum + wordCount(s.content);
  }, 0);
}

function updateStatusbar() {
  const n = activeId ? node(activeId) : null;
  const words = n ? wordCount(n.content) : 0;
  el.statusWords.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
  updateMiniRing();
}

/* ---- saving indicator ---- */

let savingTimeout1 = null;
let savingTimeout2 = null;
function flashSaving() {
  clearTimeout(savingTimeout1);
  clearTimeout(savingTimeout2);
  el.savingIndicator.textContent = 'saving…';
  el.savingIndicator.classList.add('visible');
  savingTimeout1 = setTimeout(() => {
    el.savingIndicator.textContent = 'saved';
    savingTimeout2 = setTimeout(() => el.savingIndicator.classList.remove('visible'), 1200);
  }, 400);
}
function clearSavingIndicator() {
  clearTimeout(savingTimeout1);
  clearTimeout(savingTimeout2);
  el.savingIndicator.textContent = '';
  el.savingIndicator.classList.remove('visible');
}

/* ---------------------------------------------------------------------- */
/* 5. GOALS — multiple, scoped to the whole project or a single sheet      */
/* ---------------------------------------------------------------------- */

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function goalCurrentWords(goal) {
  if (!goal) return 0;
  if (goal.scope === 'sheet') {
    const s = goal.sheetId ? node(goal.sheetId) : null;
    return s ? wordCount(s.content) : 0;
  }
  return projectTotalWords(false);
}

function ensureGoalBaseline(goal) {
  const today = todayStr();
  if (!goal.baseline || goal.baseline.date !== today) {
    goal.baseline = { date: today, words: goalCurrentWords(goal) };
  }
}

function goalDaysRemaining(goal) {
  if (!goal.deadline) return null;
  const deadline = new Date(goal.deadline + 'T23:59:59');
  const now = new Date();
  return Math.ceil((deadline - now) / 86400000);
}

function goalPercent(goal) {
  const current = goalCurrentWords(goal);
  return goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 100)) : 0;
}

/* which goal's ring shows in the sheet topbar: a goal scoped to this exact
   sheet takes priority, otherwise the first whole-project goal */
function relevantGoalForActiveSheet() {
  if (!store.goals.length) return null;
  const sheetGoal = store.goals.find((g) => g.scope === 'sheet' && g.sheetId === activeId);
  if (sheetGoal) return sheetGoal;
  return store.goals.find((g) => g.scope === 'project') || null;
}

function updateMiniRing() {
  const goal = relevantGoalForActiveSheet();
  if (!goal) {
    el.miniRingFill.style.strokeDashoffset = MINI_RING_CIRC;
    el.miniRingPct.textContent = '—';
    return;
  }
  ensureGoalBaseline(goal);
  const pct = goalPercent(goal);
  el.miniRingFill.style.strokeDashoffset = MINI_RING_CIRC * (1 - pct / 100);
  el.miniRingPct.textContent = pct + '%';
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderGoals() {
  if (!store.goals.length) {
    el.goalList.innerHTML = `<div class="empty-note">No goals yet. Use “+ New goal” to set one.</div>`;
    return;
  }
  el.goalList.innerHTML = '';
  store.goals.forEach((goal) => {
    ensureGoalBaseline(goal);
    const current = goalCurrentWords(goal);
    const target = goal.target || 0;
    const pct = goalPercent(goal);
    const remaining = Math.max(target - current, 0);
    const days = goalDaysRemaining(goal);

    const sheetNode = goal.scope === 'sheet' && goal.sheetId ? node(goal.sheetId) : null;
    const scopeLabel = goal.scope === 'sheet'
      ? `Single sheet — ${sheetNode ? sheetNode.title : 'deleted sheet'}`
      : 'Whole project';

    let deadlineLine, daysLine, paceLine;
    if (goal.deadline) {
      deadlineLine = formatDate(goal.deadline);
      daysLine = days >= 0 ? `${days} day${days === 1 ? '' : 's'} left` : 'past due';
      const pace = days > 0 ? Math.ceil(remaining / days) : null;
      paceLine = days > 0 ? `${pace.toLocaleString()} words/day` : (remaining > 0 ? 'deadline passed' : 'goal met');
    } else {
      deadlineLine = 'No deadline';
      daysLine = '—';
      paceLine = '—';
    }

    const card = document.createElement('div');
    card.className = 'goal-card';
    card.innerHTML = `
      <button class="goal-card-delete" data-goal-del="${goal.id}" aria-label="Delete goal">×</button>
      <div class="goal-card-top">
        <div class="goal-card-ring-wrap">
          <svg viewBox="0 0 60 60" class="goal-card-ring">
            <circle cx="30" cy="30" r="22" class="ring-track"/>
            <circle cx="30" cy="30" r="22" class="ring-fill" style="stroke-dashoffset:${GOAL_CARD_RING_CIRC * (1 - pct / 100)}"/>
          </svg>
          <div class="goal-card-ring-pct">${pct}%</div>
        </div>
        <div class="goal-card-info">
          <div class="goal-card-title">${escapeHtml(goal.title || 'Untitled goal')}</div>
          <div class="goal-card-scope">${escapeHtml(scopeLabel)}</div>
          <div class="goal-card-words">${current.toLocaleString()} / ${target.toLocaleString()} words</div>
          <div class="goal-card-deadline">${escapeHtml(deadlineLine)}</div>
          <div class="goal-card-days">${escapeHtml(daysLine)}</div>
          <div class="goal-card-pace">${escapeHtml(paceLine)}</div>
        </div>
      </div>
      <div class="goal-card-bar"><div class="goal-card-bar-fill" style="width:${pct}%"></div></div>
    `;
    el.goalList.appendChild(card);
  });
  save();
}

el.goalList.addEventListener('click', (e) => {
  const delBtn = e.target.closest('[data-goal-del]');
  if (!delBtn) return;
  const id = delBtn.dataset.goalDel;
  store.goals = store.goals.filter((g) => g.id !== id);
  save(true);
  renderGoals();
  updateMiniRing();
});

/* ---- new-goal modal ---- */

let goalScopeSelection = 'project';

function openNewGoalModal() {
  el.goalTitle.value = '';
  el.goalTarget.value = '';
  el.goalDeadline.value = '';
  goalScopeSelection = 'project';
  el.goalScopeSegmented.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.scope === 'project'));
  el.goalModalBackdrop.hidden = false;
  setTimeout(() => el.goalTitle.focus(), 30);
}

el.newGoalBtn.addEventListener('click', openNewGoalModal);
el.cancelGoalBtn.addEventListener('click', () => el.goalModalBackdrop.hidden = true);
el.goalModalBackdrop.addEventListener('click', (e) => { if (e.target === el.goalModalBackdrop) el.goalModalBackdrop.hidden = true; });

el.goalScopeSegmented.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  goalScopeSelection = b.dataset.scope;
  el.goalScopeSegmented.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
});

el.saveGoalBtn.addEventListener('click', () => {
  const target = parseInt(el.goalTarget.value, 10);
  if (!target || target <= 0) { el.goalTarget.focus(); return; }
  if (goalScopeSelection === 'sheet' && !activeId) {
    alert('Select a sheet first — single-sheet goals attach to whichever sheet is currently open.');
    return;
  }
  const goal = {
    id: uid(),
    title: el.goalTitle.value.trim() || 'Untitled goal',
    target,
    deadline: el.goalDeadline.value || null,
    scope: goalScopeSelection,
    sheetId: goalScopeSelection === 'sheet' ? activeId : null
  };
  ensureGoalBaseline(goal);
  store.goals.push(goal);
  save(true);
  el.goalModalBackdrop.hidden = true;
  renderGoals();
  updateMiniRing();
});

/* ---------------------------------------------------------------------- */
/* 6. DASHBOARD STATS                                                      */
/* ---------------------------------------------------------------------- */

function statCell(value, label) {
  return `<div class="stat-cell"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

function refreshTopStats() {
  const n = activeId ? node(activeId) : null;
  const sheetWords = n ? wordCount(n.content) : 0;
  const totalWords = projectTotalWords(true);
  const sheetsCount = allSheets().length;

  el.topStatGrid.innerHTML =
    statCell(sheetWords.toLocaleString(), 'current sheet') +
    statCell(totalWords.toLocaleString(), 'project total') +
    statCell(sheetsCount.toLocaleString(), 'sheets total');
}

function refreshDashboard() {
  refreshTopStats();
  renderGoals();
  renderComments();
  runGrammarCheck();
}

/* ---------------------------------------------------------------------- */
/* 7. COMMENTS                                                             */
/* ---------------------------------------------------------------------- */

let pendingSelection = null;

function updateSelectionPopover(e) {
  if (!activeId || el.editor.disabled) return;
  const start = el.editor.selectionStart, end = el.editor.selectionEnd;
  if (start === end) { el.selectionPopover.hidden = true; return; }
  pendingSelection = { start, end, text: el.editor.value.slice(start, end) };
  const x = e.clientX, y = e.clientY;
  el.selectionPopover.style.left = x + 'px';
  el.selectionPopover.style.top = (y + window.scrollY - 40) + 'px';
  el.selectionPopover.hidden = false;
}

el.editor.addEventListener('mouseup', updateSelectionPopover);
el.editor.addEventListener('keyup', (e) => {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  if (el.editor.selectionStart === el.editor.selectionEnd) { el.selectionPopover.hidden = true; }
});
el.editor.addEventListener('blur', () => { setTimeout(() => { el.selectionPopover.hidden = true; }, 150); });

el.addCommentBtn.addEventListener('click', () => {
  if (!pendingSelection || !activeId) return;
  el.selectionPopover.hidden = true;
  const sel = pendingSelection;
  openPrompt('Add a comment', '', (val) => {
    if (!val || !val.trim()) return;
    const n = node(activeId);
    n.comments = n.comments || [];
    n.comments.push({
      id: uid(), start: sel.start, end: sel.end,
      quote: sel.text.slice(0, 80), body: val.trim(), createdAt: Date.now()
    });
    save(true);
    renderComments();
  });
});

function renderComments() {
  const n = activeId ? node(activeId) : null;
  const comments = n && n.comments ? n.comments : [];
  el.commentCount.textContent = comments.length;
  if (!comments.length) {
    el.commentList.innerHTML = `<div class="empty-note">No comments on this sheet yet.</div>`;
    return;
  }
  el.commentList.innerHTML = '';
  comments.slice().reverse().forEach((c) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <span class="item-quote">“${escapeHtml(c.quote)}”</span>
      <span class="item-body">${escapeHtml(c.body)}</span>
      <div class="item-meta">
        <span>${new Date(c.createdAt).toLocaleDateString()}</span>
        <button data-del="${c.id}">Remove</button>
      </div>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      el.editor.focus();
      el.editor.setSelectionRange(c.start, c.end);
    });
    card.querySelector('[data-del]').addEventListener('click', (e) => {
      e.stopPropagation();
      n.comments = n.comments.filter((x) => x.id !== c.id);
      save(true);
      renderComments();
    });
    el.commentList.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------------- */
/* 8. GRAMMAR / STYLE CHECKER — local heuristics, no network calls          */
/* ---------------------------------------------------------------------- */

const FILLER_WORDS = ['very', 'really', 'just', 'actually', 'basically', 'literally', 'somewhat', 'quite'];

function splitSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]*/g) || [];
  let offset = 0;
  return matches.map((s) => {
    const start = text.indexOf(s, offset);
    offset = start + s.length;
    return { text: s.trim(), start };
  }).filter((s) => s.text.length);
}

function runGrammarCheck() {
  const n = activeId ? node(activeId) : null;
  const text = n ? (n.content || '') : '';
  const issues = [];
  const sentences = splitSentences(text);

  sentences.forEach((s) => {
    const words = s.text.split(/\s+/).filter(Boolean);

    if (words.length > 35) {
      issues.push({ tag: 'Long sentence', quote: s.text.slice(0, 70), body: `${words.length} words — consider splitting it up.` });
    }

    if (/\b(is|are|was|were|be|been|being)\s+\w+ed\b/i.test(s.text)) {
      issues.push({ tag: 'Passive voice', quote: s.text.slice(0, 70), body: 'This reads as passive — consider naming who does the action.' });
    }

    const lyMatches = s.text.match(/\b\w+ly\b/gi) || [];
    if (lyMatches.length >= 3) {
      issues.push({ tag: 'Adverb-heavy', quote: s.text.slice(0, 70), body: `${lyMatches.length} “-ly” words in one sentence — a strong verb often does the job alone.` });
    }

    FILLER_WORDS.forEach((fw) => {
      const re = new RegExp(`\\b${fw}\\b`, 'i');
      if (re.test(s.text)) {
        issues.push({ tag: 'Filler word', quote: s.text.slice(0, 70), body: `Consider cutting “${fw}.”` });
      }
    });
  });

  // repeated word close together
  const wordTokens = text.match(/\b[a-z]{4,}\b/gi) || [];
  const seenAt = {};
  wordTokens.forEach((w, i) => {
    const lw = w.toLowerCase();
    if (seenAt[lw] !== undefined && i - seenAt[lw] <= 6) {
      issues.push({ tag: 'Repetition', quote: w, body: `“${w}” repeats within a few words — check if that\'s intentional.` });
    }
    seenAt[lw] = i;
  });

  if (/  +/.test(text)) {
    issues.push({ tag: 'Spacing', quote: '', body: 'Double spaces found — a single space is standard between sentences.' });
  }

  // de-dupe near-identical issues, cap the list
  const seen = new Set();
  const deduped = issues.filter((it) => {
    const key = it.tag + it.quote;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);

  renderIssues(deduped);
}

function renderIssues(issues) {
  el.issueCount.textContent = issues.length;
  if (!issues.length) {
    el.issueList.innerHTML = `<div class="empty-note">No issues flagged on this sheet.</div>`;
    return;
  }
  el.issueList.innerHTML = '';
  issues.forEach((it) => {
    const card = document.createElement('div');
    card.className = 'item-card issue';
    card.innerHTML = `
      <span class="item-tag">${it.tag}</span>
      ${it.quote ? `<span class="item-quote">“${escapeHtml(it.quote)}${it.quote.length >= 70 ? '…' : ''}”</span>` : ''}
      <span class="item-body">${escapeHtml(it.body)}</span>`;
    el.issueList.appendChild(card);
  });
}

/* ---------------------------------------------------------------------- */
/* 9. MODALS, SETTINGS, WIRING                                             */
/* ---------------------------------------------------------------------- */

let promptCallback = null;
function openPrompt(title, initial, cb) {
  el.promptTitle.textContent = title;
  el.promptInput.value = initial || '';
  promptCallback = cb;
  el.promptModalBackdrop.hidden = false;
  setTimeout(() => { el.promptInput.focus(); el.promptInput.select(); }, 30);
}
el.promptCancelBtn.addEventListener('click', () => el.promptModalBackdrop.hidden = true);
el.promptModalBackdrop.addEventListener('click', (e) => { if (e.target === el.promptModalBackdrop) el.promptModalBackdrop.hidden = true; });
el.promptSaveBtn.addEventListener('click', () => {
  el.promptModalBackdrop.hidden = true;
  if (promptCallback) promptCallback(el.promptInput.value);
});
el.promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { el.promptModalBackdrop.hidden = true; if (promptCallback) promptCallback(el.promptInput.value); }
  if (e.key === 'Escape') { el.promptModalBackdrop.hidden = true; }
});

/* sidebar toggle — the tab sits at the sidebar's right edge and follows it */
el.toggleSidebar.addEventListener('click', () => {
  const collapsed = el.sidebar.classList.toggle('collapsed');
  el.toggleSidebar.classList.toggle('collapsed', collapsed);
});

/* dashboard modal */
function openDashboardModal() {
  el.dashboardModalBackdrop.hidden = false;
  refreshDashboard();
}
function closeDashboardModal() {
  el.dashboardModalBackdrop.hidden = true;
}
el.openDashboard.addEventListener('click', openDashboardModal);
el.openDashboardRing.addEventListener('click', openDashboardModal);
el.closeDashboard.addEventListener('click', closeDashboardModal);
el.dashboardModalBackdrop.addEventListener('click', (e) => { if (e.target === el.dashboardModalBackdrop) closeDashboardModal(); });

/* new sheet / folder at root */
el.newSheetBtn.addEventListener('click', () => addSheet(null));
el.newGroupBtn.addEventListener('click', () => addGroup(null));

/* project name */
el.projectName.textContent = store.projectName || 'Untitled project';
el.projectName.addEventListener('input', () => {
  store.projectName = el.projectName.textContent.trim() || 'Untitled project';
  save();
});
el.projectName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.projectName.blur(); } });

/* settings modal */
function applySettings() {
  const s = store.settings;
  document.documentElement.setAttribute('data-theme', s.theme);
  const a = ACCENTS[s.accent] || ACCENTS.sage;
  document.documentElement.style.setProperty('--accent', a.accent);
  document.documentElement.style.setProperty('--accent-soft', a.soft);
  document.documentElement.style.setProperty('--accent-text', a.text);
  document.documentElement.style.setProperty('--editor-font-size', s.fontSize + 'px');
  document.documentElement.style.setProperty('--editor-line-height', (s.lineHeight / 100));
  document.documentElement.style.setProperty('--editor-width', s.editorWidth + 'px');
  el.editorCol.style.maxWidth = s.editorWidth + 'px';
  document.body.classList.toggle('focus-mode', !!s.focusMode);

  el.themeSegmented.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === s.theme));
  el.accentSwatches.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.accent === s.accent));
  el.fontSizeRange.value = s.fontSize; el.fontSizeVal.textContent = s.fontSize + 'px';
  el.lineHeightRange.value = s.lineHeight; el.lineHeightVal.textContent = (s.lineHeight / 100).toFixed(1);
  el.editorWidthRange.value = s.editorWidth; el.editorWidthVal.textContent = s.editorWidth + 'px';
  el.focusModeToggle.checked = !!s.focusMode;
}

el.openSettings.addEventListener('click', () => { applySettings(); el.settingsModalBackdrop.hidden = false; });
el.closeSettingsBtn.addEventListener('click', () => el.settingsModalBackdrop.hidden = true);
el.settingsModalBackdrop.addEventListener('click', (e) => { if (e.target === el.settingsModalBackdrop) el.settingsModalBackdrop.hidden = true; });

el.themeSegmented.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  store.settings.theme = b.dataset.theme; save(); applySettings();
});
el.accentSwatches.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch'); if (!b) return;
  store.settings.accent = b.dataset.accent; save(); applySettings();
});
el.fontSizeRange.addEventListener('input', () => { store.settings.fontSize = +el.fontSizeRange.value; save(); applySettings(); });
el.lineHeightRange.addEventListener('input', () => { store.settings.lineHeight = +el.lineHeightRange.value; save(); applySettings(); });
el.editorWidthRange.addEventListener('input', () => { store.settings.editorWidth = +el.editorWidthRange.value; save(); applySettings(); });
el.focusModeToggle.addEventListener('change', () => { store.settings.focusMode = el.focusModeToggle.checked; save(); applySettings(); });

/* keyboard shortcuts: Esc closes modals/menus */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    [el.goalModalBackdrop, el.settingsModalBackdrop, el.promptModalBackdrop, el.dashboardModalBackdrop].forEach((m) => m.hidden = true);
    el.selectionPopover.hidden = true;
    closeMenus();
  }
});

/* ---------------------------------------------------------------------- */
/* INIT                                                                     */
/* ---------------------------------------------------------------------- */

function init() {
  if (!store.settings) store.settings = { theme: 'dark', accent: 'sage', fontSize: 17, lineHeight: 170, editorWidth: 700, focusMode: false };

  // migrate the old single-goal schema to the new goals array
  if (!store.goals) {
    store.goals = store.goal ? [{ ...store.goal, id: uid(), title: 'Goal', sheetId: store.goal.scope === 'sheet' ? activeId : null }] : [];
    delete store.goal;
    save(true);
  }

  applySettings();
  renderTree();
  if (activeId && node(activeId)) {
    selectSheet(activeId);
  } else {
    renderEditorEmptyStateIfNeeded();
    updateStatusbar();
  }
}

init();