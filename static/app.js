const FIELDS = {
  title: 'Название задачи', context: 'Контекст бизнеса', need: 'Проблема / потребность',
  users: 'Целевые пользователи', data: 'Данные и материалы', constraints: 'Ограничения',
  outcome: 'Ожидаемый результат', success: 'Критерии успеха', contact: 'Контакт', interaction: 'Формат взаимодействия',
};
const HINTS = {
  title: 'Коротко опишите, что предстоит сделать',
  context: 'Чем занимается бизнес и как сейчас устроен процесс?', need: 'Что не работает и почему это важно?',
  users: 'Кто будет пользоваться результатом?', data: 'Какие данные или материалы вы готовы предоставить?',
  constraints: 'Сроки, бюджет, технологии и другие ограничения', outcome: 'Что команда должна передать в конце работы?',
  success: 'По каким измеримым признакам вы примете результат?', contact: 'Имя и способ связи с представителем бизнеса',
  interaction: 'Как часто и в каком формате вы готовы общаться?',
};
const LEVELS = {draft: 'Черновик', working: 'Рабочая задача', ready: 'Готова к работе', priority: 'Приоритетная'};
const STATUS = {pending: 'На рассмотрении', selected: 'Команда выбрана', rejected: 'Отклонено'};
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c5 4 13 4 18 0M12 11v5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4zM20 2v4M18 4h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>', search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>', external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const safeUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? esc(url.href) : '#'; } catch { return '#'; } };
const stored = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const state = {role: stored('hackalem-role', 'business'), teamId: stored('hackalem-team', 't1'), tasks: [], teams: [], proposals: [], meta: {}, query: '', industry: '', level: '', wizard: {}, formCache: {}, conflicts: {}, busy: false, initialized: false, error: null};
if (!['business', 'student'].includes(state.role)) state.role = 'business';
let toastTimer;
const app = document.querySelector('#app');
const route = () => { try { return decodeURIComponent(location.hash.slice(1) || 'catalog').split('/'); } catch { return ['catalog']; } };
const getTask = id => state.tasks.find(task => task.id === id);
const getTeam = id => state.teams.find(team => team.id === id);
const taskTitle = task => task.fields?.title || task.draft?.slice(0, 70) || 'Без названия';
const countWord = (number, words) => { const n = number % 100; return `${number} ${words[n > 10 && n < 20 ? 2 : number % 10 === 1 ? 0 : number % 10 >= 2 && number % 10 <= 4 ? 1 : 2]}`; };
function toast(message, error = false) {
  const host = document.querySelector('#notifications');
  host.className = `notifications${error ? ' is-error' : ''}`;
  host.textContent = message;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.textContent = ''; }, error ? 10000 : 5000);
}
async function api(path, method = 'GET', body, identity = state) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(path, {method, headers: {'Content-Type': 'application/json', 'X-Role': identity.role, 'X-Team-Id': identity.teamId}, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal});
    let data;
    try { data = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.'); }
    if (!response.ok) { const error = new Error(data.error || 'Не удалось выполнить действие'); error.status = response.status; throw error; }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Время ожидания истекло. Ваш текст сохранён в форме — попробуйте ещё раз.');
    if (error instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте, что приложение запущено, и повторите действие.');
    throw error;
  } finally { clearTimeout(timer); }
}
function upsertTask(task) { const index = state.tasks.findIndex(item => item.id === task.id); index < 0 ? state.tasks.push(task) : state.tasks[index] = task; }
function upsertProposal(proposal) { const index = state.proposals.findIndex(item => item.id === proposal.id); index < 0 ? state.proposals.push(proposal) : state.proposals[index] = proposal; }
async function refresh(identity) {
  const data = await api('/api/bootstrap', 'GET', undefined, identity || state);
  Object.assign(state, data, identity || {}, {initialized: true, error: null});
  if (!getTeam(state.teamId) && state.teams.length) state.teamId = state.teams[0].id;
}
function setBusy(busy) { state.busy = busy; app.inert = busy; app.setAttribute('aria-busy', String(busy)); document.body.classList.toggle('is-working', busy); }
async function run(button, action) {
  if (button?.disabled || state.busy) return;
  setBusy(true);
  const before = button?.innerHTML;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Подождите…'; }
  try { await action(); } catch (error) { toast(error.message, true); }
  finally { setBusy(false); if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = before; } }
}
function go(path) { if (location.hash === `#${path}`) render(); else location.hash = path; }
function levelPill(task) { return `<span class="pill level-${esc(task.score.level)}"><span class="dot"></span>${esc(task.score.levelLabel || LEVELS[task.score.level])}</span>`; }
function sectionHeading(eyebrow, title, text, action = '') { return `<header class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${text ? `<p class="page-description">${esc(text)}</p>` : ''}</div>${action}</header>`; }
function emptyState(title, text, button = '') { return `<div class="empty-state"><div class="empty-icon">${icon('file')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${button}</div>`; }
function shell(content) {
  const current = route()[0];
  const roleName = state.role === 'business' ? 'Бизнес' : 'Студенческая команда';
  const nav = (path, name, glyph, count = '') => `<a href="#${path}" class="nav-item ${current === path ? 'active' : ''}" ${current === path ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${name}</span>${count !== '' ? `<span class="nav-count">${count}</span>` : ''}</a>`;
  return `<div class="app-layout"><aside class="sidebar"><a class="brand" href="#catalog" aria-label="HackAlem — каталог"><span class="brand-mark">H<span>·</span></span><span>HackAlem<small>AI SANA · WORKSPACE</small></span></a><p class="nav-label">Рабочее пространство</p><nav aria-label="Основная навигация">${nav('catalog', 'Каталог задач', 'grid')}${state.role === 'business' ? nav('business', 'Мои задачи', 'briefcase', state.tasks.length) : nav('submissions', 'Мои отклики', 'briefcase', state.proposals.filter(p => p.teamId === state.teamId).length)}${nav('teams', 'Команды', 'users')}</nav>${state.role === 'business' ? '<a class="btn sidebar-create" href="#create">'+icon('plus')+' Создать задачу</a>' : ''}<div class="sidebar-note"><span class="note-symbol">${icon('spark')}</span><h3>От идеи к результату</h3><p>Понятная задача.<br>Подходящая команда.<br>Подтверждённый прогресс.</p></div><div class="sidebar-footer"><span class="connection-dot"></span> Демонстрационное пространство<small>HackAlem × AI Sana</small></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Рабочее пространство <span>/</span> <strong>${esc({catalog:'Каталог',business:'Мои задачи',create:'Новая задача',edit:'Редактор задачи',task:'Карточка задачи',teams:'Команды',submissions:'Мои отклики'}[current] || 'Каталог')}</strong></div><div class="role-controls"><span class="demo-label">Демо-роль</span><label class="sr-only" for="role-switch">Выбрать роль</label><select id="role-switch" aria-label="Выбрать роль"><option value="business" ${state.role === 'business' ? 'selected' : ''}>Бизнес</option><option value="student" ${state.role === 'student' ? 'selected' : ''}>Команда</option></select>${state.role === 'student' ? `<label class="sr-only" for="team-switch">Текущая команда</label><select id="team-switch" aria-label="Текущая команда">${state.teams.map(team => `<option value="${esc(team.id)}" ${team.id === state.teamId ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}</select>` : ''}<span class="avatar" aria-label="${roleName}">${state.role === 'business' ? 'Б' : esc(getTeam(state.teamId)?.name?.charAt(0) || 'К')}</span></div></header><main id="main-content" tabindex="-1">${content}</main><footer class="main-footer"><span>HackAlem · Пространство совместной работы</span><span>Решения подтверждает человек ${icon('check')}</span></footer></div></div>`;
}
function taskCard(task) {
  const proposals = state.proposals.filter(item => item.taskId === task.id);
  return `<article class="task-card"><div class="card-top"><span class="industry">${esc(task.industry || 'Другое')}</span><span class="small-score" title="Рейтинг готовности">${task.score.total}<small>/100</small></span></div><h3><a href="#task/${esc(task.id)}">${esc(taskTitle(task))}</a></h3><p class="card-summary">${esc(task.fields.need || task.fields.context || task.draft || 'Описание пока не заполнено')}</p><div class="readiness-line"><span>Готовность задачи</span><strong>${task.score.total}%</strong></div><div class="progress-track"><span style="width:${task.score.total}%" class="level-bg-${esc(task.score.level)}"></span></div><div class="card-bottom">${levelPill(task)}<a href="#task/${esc(task.id)}" class="arrow-link" aria-label="Открыть задачу: ${esc(taskTitle(task))}">${icon('arrow')}</a></div><div class="card-meta">${icon('users')} ${state.role === 'business' ? countWord(proposals.length, ['отклик', 'отклика', 'откликов']) : 'Открыта для предложений'}</div></article>`;
}
function filteredTasks() {
  return state.tasks.filter(task => task.status === 'published' && (!state.industry || task.industry === state.industry) && (!state.level || task.score.level === state.level) && (!state.query || `${taskTitle(task)} ${task.fields.need} ${task.industry} ${task.fields.context}`.toLocaleLowerCase('ru').includes(state.query.toLocaleLowerCase('ru')))).sort((a,b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
}
function catalogResults() {
  const tasks = filteredTasks();
  return `<div class="results-heading"><span>${countWord(tasks.length, ['задача', 'задачи', 'задач'])}</span><span class="sort-label">По рейтингу готовности ↓</span></div>${tasks.length ? `<div class="task-grid">${tasks.map(taskCard).join('')}</div>` : emptyState('Задачи не найдены', 'Измените запрос или сбросьте фильтры.', '<button class="btn btn-secondary" data-action="reset-filters">Сбросить фильтры</button>')}`;
}
function catalogPage() {
  const published = state.tasks.filter(task => task.status === 'published');
  const ready = published.filter(task => task.score.total >= 70).length;
  return `${sectionHeading('Возможности для совместной работы', 'Задачи, с которых всё начинается', 'Находите реальные запросы бизнеса и предлагайте своё решение.', state.role === 'business' ? '<a href="#create" class="btn btn-primary">'+icon('plus')+' Создать задачу</a>' : '')}<div class="stats-grid"><div class="stat-card"><span class="stat-icon blue">${icon('briefcase')}</span><div><span class="stat-title">Опубликованные задачи</span><strong>${published.length}<small>для ваших идей</small></strong></div></div><div class="stat-card"><span class="stat-icon teal">${icon('check')}</span><div><span class="stat-title">Готовы к работе</span><strong>${ready}<small>рейтинг от 70 баллов</small></strong></div></div><div class="stat-card"><span class="stat-icon violet">${icon('users')}</span><div><span class="stat-title">Студенческие команды</span><strong>${state.teams.length}<small>разные навыки, одна цель</small></strong></div></div></div><section aria-label="Каталог задач"><div class="filter-bar"><div class="search-wrap">${icon('search')}<label class="sr-only" for="catalog-search">Поиск по задачам</label><input id="catalog-search" type="search" placeholder="Поиск по названию или описанию" value="${esc(state.query)}"></div><label class="sr-only" for="industry-filter">Тематика</label><select id="industry-filter"><option value="">Все тематики</option>${(state.meta.industries || []).map(industry => `<option ${state.industry === industry ? 'selected' : ''}>${esc(industry)}</option>`).join('')}</select><label class="sr-only" for="level-filter">Уровень готовности</label><select id="level-filter"><option value="">Любая готовность</option>${Object.entries(LEVELS).map(([key,value]) => `<option value="${key}" ${state.level === key ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div id="catalog-results">${catalogResults()}</div></section><div class="info-strip">${icon('info')}<p>Рейтинг показывает полноту подтверждённых сведений. Откликнуться можно на задачу с любым рейтингом.</p></div>`;
}
function aiNotice(ai) {
  const mode = ai?.mode || state.meta.aiMode;
  return `<div class="ai-notice">${icon('spark')}<div><strong>${mode === 'local' ? 'Локальный помощник' : 'AI-помощник'}</strong><p>${mode === 'local' ? 'Работает без внешнего API: структурирует введённые сведения по правилам. Неизвестные данные остаются пустыми.' : 'Помогает уточнить описание и собрать карточку. Проверьте сведения перед подтверждением.'}</p>${ai?.warning ? `<p class="ai-warning">${esc(ai.warning)}</p>` : ''}</div></div>`;
}
function steps(current) { return `<ol class="wizard-steps" aria-label="Шаги создания задачи">${['Ваша идея','Уточнение','Карточка задачи'].map((name,index) => `<li class="${index + 1 < current ? 'complete' : index + 1 === current ? 'current' : ''}" ${index + 1 === current ? 'aria-current="step"' : ''}><span>${index + 1 < current ? icon('check') : index+1}</span><strong>${name}</strong></li>`).join('')}</ol>`; }
function createPage() {
  if (state.role !== 'business') return deniedPage();
  const saved = state.formCache.create || {draft: stored('hackalem-description',''), industry: ''};
  return `${sectionHeading('Конструктор задачи', 'Расскажите о вашей идее', 'Помощник задаст уточняющие вопросы и соберёт понятную карточку для команд.')} ${steps(1)}<div class="wizard-layout"><section class="panel wizard-panel"><div class="panel-heading"><span class="step-number">01</span><div><h2>С чего начнём?</h2><p>Опишите ситуацию своими словами. Структура появится дальше.</p></div></div><form id="create-form"><div class="form-field"><label for="draft">Описание идеи <span class="required">*</span></label><textarea id="draft" name="draft" rows="7" required maxlength="12000" placeholder="Например: у нас небольшая кофейня. Каждый вечер остаётся непроданная выпечка. Хотим лучше планировать закупки и уменьшить списания…">${esc(saved.draft)}</textarea><span class="field-help">Что происходит сейчас, что хотите изменить и зачем?</span></div><div class="form-field"><label for="industry">Тематика <span class="required">*</span></label><select id="industry" name="industry" required><option value="" disabled ${!saved.industry ? 'selected' : ''}>Выберите тематику</option>${(state.meta.industries || []).map(industry => `<option ${saved.industry === industry ? 'selected' : ''}>${esc(industry)}</option>`).join('')}</select></div><div class="form-actions"><span class="subtle">Сначала сохраним черновик</span><button class="btn btn-primary" type="submit">Уточнить с помощником ${icon('arrow')}</button></div></form></section><aside class="wizard-aside"><div class="aside-illustration">${icon('spark')}</div><h2>Хорошая задача начинается с диалога</h2><p>Не нужно сразу писать техническое задание. Помощник поможет последовательно уточнить важные детали.</p><ul class="check-list"><li>${icon('check')} Вопросы по вашей ситуации</li><li>${icon('check')} Редактируемая карточка</li><li>${icon('check')} Прозрачный рейтинг готовности</li></ul>${aiNotice()}</aside></div>`;
}
function questionPage(task) {
  const wizard = state.wizard[task.id] || {};
  const answers = state.formCache[`answers-${task.id}`] || task.answers || {};
  return `${sectionHeading('Конструктор задачи', 'Добавим важные детали', 'Ответьте на вопросы — это поможет командам понять задачу.')} ${steps(2)}<div class="wizard-layout"><section class="panel wizard-panel"><div class="original-draft"><span class="eyebrow">Ваша идея</span><p>${esc(task.draft)}</p></div>${aiNotice(wizard.ai)}${task.questions?.length ? `<form id="answers-form" data-task-id="${esc(task.id)}"><div class="question-list">${task.questions.map((question,index) => `<div class="form-field question-field"><label for="answer-${esc(question.id)}"><span class="question-number">${String(index+1).padStart(2,'0')}</span>${esc(question.text)}</label><textarea id="answer-${esc(question.id)}" name="${esc(question.field || question.id)}" rows="3" maxlength="${(question.field || question.id) === 'title' ? 180 : 4000}" placeholder="Введите ответ или оставьте пустым, если пока не знаете">${esc(answers[question.field || question.id] || '')}</textarea></div>`).join('')}</div><div class="form-actions"><span class="subtle">Неизвестные сведения можно добавить позже</span><button class="btn btn-primary" type="submit">Собрать карточку ${icon('arrow')}</button></div></form>` : `<div class="empty-inline"><p>Черновик сохранён. Теперь помощник подготовит вопросы.</p><button class="btn btn-primary" data-action="questions" data-id="${esc(task.id)}">${icon('spark')} Получить вопросы</button></div>`}</section><aside class="wizard-aside"><h2>Конкретика помогает</h2><p>Опишите доступные данные, ожидаемый результат и способ связи. Не придумывайте то, чего ещё нет.</p><div class="soft-card"><strong>Можно двигаться дальше</strong><p>Пустые ответы не блокируют создание карточки. Заполните и подтвердите сведения, когда будете готовы.</p></div><a class="text-link" href="#business">Вернуться к моим задачам</a></aside></div>`;
}
function scorePanel(task, compact = false) {
  return `<section class="panel score-panel"><div class="score-label"><span>${icon('check')} Рейтинг готовности</span><span class="pill soft">из 100</span></div><div class="score-hero"><div class="score-ring" style="--score:${task.score.total}%"><span>${task.score.total}<small>баллов</small></span></div><div>${levelPill(task)}<p>За заполненные<br>и подтверждённые сведения</p></div></div><div class="score-breakdown">${task.score.breakdown.map(item => `<div class="breakdown-item"><div><span>${esc(item.label)}</span><strong>${item.earned}<small>/${item.weight}</small></strong></div><div class="mini-progress"><span style="width:${Math.round(item.earned/item.weight*100)}%"></span></div></div>`).join('')}</div>${!compact && task.score.missingFields.length ? `<div class="score-suggestions"><strong>Что ещё можно уточнить</strong><ul>${task.score.missingFields.map(field => `<li>${esc(FIELDS[field] || field)}</li>`).join('')}</ul></div>` : ''}<p class="score-footnote">Баллы пересчитываются после сохранения. Текст помощника нужно подтвердить вручную.</p></section>`;
}
function editorPage(task) {
  if (state.role !== 'business') return deniedPage();
  const cached = state.formCache[`edit-${task.id}`];
  const fields = cached?.fields || task.fields;
  const confirmed = cached?.confirmedFields || task.confirmedFields || [];
  return `${sectionHeading(task.status === 'published' ? 'Управление задачей' : 'Конструктор задачи', task.status === 'published' ? 'Редактирование карточки' : 'Проверьте карточку задачи', 'Исправьте формулировки и подтвердите только те сведения, в которых уверены.')} ${task.status !== 'published' ? steps(3) : ''}<div class="editor-layout"><div><form id="editor-form" data-task-id="${esc(task.id)}" data-revision="${task.revision}">${state.conflicts[task.id] ? `<div class="conflict-panel" role="alert"><strong>Карточка изменилась в другом окне</strong><p>Ваш текст сохранён в этой форме. Обновите версию перед повторным сохранением.</p><div><button class="btn btn-secondary btn-small" type="button" data-action="conflict-reload" data-id="${esc(task.id)}">Загрузить сохранённую карточку</button><button class="btn btn-secondary btn-small" type="button" data-action="conflict-keep" data-id="${esc(task.id)}">Продолжить с моим текстом</button></div></div>` : ''}<section class="panel editor-panel"><div class="editor-intro"><span class="round-icon">${icon('file')}</span><div><h2>Карточка задачи</h2><p>Вы управляете содержимым и подтверждаете факты.</p></div></div><div class="form-field"><label for="edit-industry">Тематика</label><select id="edit-industry" name="industry">${(state.meta.industries || []).map(industry => `<option ${(cached?.industry || task.industry) === industry ? 'selected' : ''}>${esc(industry)}</option>`).join('')}</select></div>${Object.entries(FIELDS).map(([field,label],index) => `<div class="form-field editor-field"><div class="field-title"><label for="field-${field}">${String(index+1).padStart(2,'0')} <span>${esc(label)}</span>${field === 'title' ? ' <span class="required">*</span>' : ''}</label>${field !== 'title' ? `<label class="confirm-control"><input type="checkbox" name="confirm-${field}" data-confirm="${field}" aria-label="Подтверждаю: ${esc(label)}" ${confirmed.includes(field) ? 'checked' : ''}><span>Подтверждаю</span></label>` : ''}</div>${field === 'title' ? `<input id="field-${field}" name="${field}" maxlength="180" value="${esc(fields[field])}" placeholder="${esc(HINTS[field])}">` : `<textarea id="field-${field}" name="${field}" data-field="${field}" rows="${['contact','interaction'].includes(field) ? 2 : 3}" maxlength="4000" placeholder="${esc(HINTS[field])}">${esc(fields[field])}</textarea>`}${field !== 'title' ? '<span class="field-help">При изменении текста подтверждение снимается.</span>' : ''}</div>`).join('')}</section><div class="editor-bottom"><div><strong>Сначала сохраните изменения</strong><span>Сохранение обновит рейтинг готовности.</span></div><button type="submit" class="btn btn-primary">${icon('check')} Сохранить карточку</button></div></form><section class="panel publish-panel"><div><h3>${task.status === 'published' ? 'Задача уже опубликована' : 'Готовы показать задачу командам?'}</h3><p>${task.status === 'published' ? 'Сохранённые изменения сразу доступны в каталоге.' : 'Публикация доступна с любым рейтингом. Даже неполную задачу могут выбрать команды.'}</p></div>${task.status === 'published' ? `<a class="btn btn-secondary" href="#task/${esc(task.id)}">Открыть карточку ${icon('arrow')}</a>` : `<label class="publish-confirm"><input id="publish-confirm" type="checkbox">Я проверил(а) карточку и подтверждаю публикацию</label><button class="btn btn-primary" data-action="publish" data-id="${esc(task.id)}">Опубликовать задачу ${icon('arrow')}</button>`}</section></div><aside class="editor-sidebar">${scorePanel(task)}${aiNotice(state.wizard[task.id]?.ai)}<a href="#business" class="text-link">Сохранённые задачи ${icon('arrow')}</a></aside></div>`;
}
function editPage(id) {
  const task = getTask(id);
  if (!task) return missingPage();
  if (state.role !== 'business') return deniedPage();
  const step = state.wizard[id]?.step || (Object.values(task.fields || {}).some(Boolean) ? 3 : 2);
  return step === 2 ? questionPage(task) : editorPage(task);
}
function taskDetail(task) {
  const proposals = state.proposals.filter(item => item.taskId === task.id && (state.role === 'business' || item.teamId === state.teamId));
  return `<a href="#catalog" class="back-link">${icon('back')} К каталогу задач</a><header class="detail-heading"><div class="detail-eyebrow"><span class="industry">${esc(task.industry)}</span>${levelPill(task)}${task.status === 'draft' ? '<span class="pill soft">Не опубликована</span>' : ''}</div><h1>${esc(taskTitle(task))}</h1><div class="detail-meta">${icon('users')} ${state.role === 'business' ? countWord(proposals.length, ['предложение команды','предложения команд','предложений команд']) : 'Реальная задача бизнеса'}<span>·</span> Выбор команд — за бизнесом</div></header><div class="detail-layout"><div><section class="panel brief-panel">${Object.entries(FIELDS).filter(([field]) => field !== 'title').map(([field,label],index) => `<section class="brief-field"><div class="brief-field-title"><span class="brief-number">${String(index+1).padStart(2,'0')}</span><h2>${esc(label)}</h2>${task.confirmedFields?.includes(field) ? `<span class="verified" title="Подтверждено бизнесом">${icon('check')}<span>Подтверждено</span></span>` : ''}</div><p class="${task.fields[field] ? '' : 'not-provided'}">${esc(task.fields[field] || 'Пока не указано')}</p></section>`).join('')}</section>${state.role === 'student' && task.status === 'published' ? proposalForm(task) : ''}<section class="proposals-section" aria-label="Предложения команд"><div class="section-title"><h2>${state.role === 'business' ? 'Предложения команд' : 'Отклики вашей команды'}</h2><span class="count-badge">${proposals.length}</span></div>${state.role === 'business' ? '<p class="section-description">Рассмотрите предложения и выберите одну или несколько команд. Можно пока не выбирать никого.</p>' : ''}${proposals.length ? proposals.map(proposalCard).join('') : emptyState('Пока нет откликов', state.role === 'business' ? 'После публикации команды смогут предложить свои идеи.' : 'Расскажите, как ваша команда видит решение этой задачи.')}</section></div><aside class="detail-sidebar">${scorePanel(task, true)}${state.role === 'business' ? `<a class="btn btn-primary full-width" href="#edit/${esc(task.id)}">Редактировать задачу ${icon('arrow')}</a>` : task.status === 'published' ? '<a class="btn btn-primary full-width" href="#proposal-form" data-scroll="proposal-form">Предложить решение '+icon('arrow')+'</a>' : ''}<div class="soft-card"><strong>${icon('info')} Рейтинг не ограничивает участие</strong><p>Он помогает оценить полноту задачи. Решение о сотрудничестве принимает бизнес.</p></div></aside></div>`;
}
function proposalForm(task) {
  const cache = state.formCache[`proposal-${task.id}`] || {};
  return `<section class="panel proposal-form-panel"><div class="panel-heading"><span class="round-icon">${icon('spark')}</span><div><h2>Предложите своё решение</h2><p>Отклик от команды ${esc(getTeam(state.teamId)?.name || '')}</p></div></div><form id="proposal-form" data-task-id="${esc(task.id)}"><div class="form-field"><label for="proposal-idea">Идея решения <span class="required">*</span></label><textarea id="proposal-idea" name="idea" rows="3" maxlength="4000" required placeholder="Что вы предлагаете и какую проблему это решит?">${esc(cache.idea || '')}</textarea></div><div class="form-field"><label for="proposal-plan">Краткий план <span class="required">*</span></label><textarea id="proposal-plan" name="plan" rows="3" maxlength="4000" required placeholder="Основные шаги вашей команды">${esc(cache.plan || '')}</textarea></div><div class="form-row"><div class="form-field"><label for="proposal-timeline">Сроки <span class="required">*</span></label><input id="proposal-timeline" name="timeline" required maxlength="300" placeholder="Например, 2 недели" value="${esc(cache.timeline || '')}"></div><div class="form-field"><label for="proposal-url">Ссылка на прототип <span class="required">*</span></label><input id="proposal-url" name="prototypeUrl" type="url" pattern="https?://.*" required maxlength="2000" placeholder="https://…" value="${esc(cache.prototypeUrl || '')}"></div></div><div class="form-actions"><span class="subtle">Бизнес рассмотрит отклик вручную</span><button class="btn btn-primary" type="submit">Отправить предложение ${icon('arrow')}</button></div></form></section>`;
}
function proposalCard(proposal, includeTask = false) {
  const team = getTeam(proposal.teamId);
  const task = getTask(proposal.taskId);
  const milestone = proposal.milestone;
  const stageCache = state.formCache[`stage-${proposal.id}`] || {};
  return `<article class="panel proposal-card" id="proposal-${esc(proposal.id)}"><div class="proposal-top"><div class="team-heading"><span class="team-avatar">${esc(team?.name?.slice(0,2) || 'К')}</span><div><h3>${esc(team?.name || 'Команда')}</h3>${includeTask && task ? `<a class="text-link small" href="#task/${esc(task.id)}">${esc(taskTitle(task))}</a>` : `<span class="subtle">${esc((team?.skills || []).slice(0,3).join(' · '))}</span>`}</div></div><span class="pill proposal-${esc(proposal.status)}">${esc(STATUS[proposal.status])}</span></div><h4>Идея решения</h4><p class="preserve-text">${esc(proposal.idea)}</p><h4>План работы</h4><p class="preserve-text">${esc(proposal.plan)}</p><div class="proposal-details"><span>${icon('clock')} ${esc(proposal.timeline)}</span><a href="${safeUrl(proposal.prototypeUrl)}" target="_blank" rel="noopener noreferrer">Прототип ${icon('external')}</a></div>${state.role === 'business' ? `<div class="proposal-actions">${proposal.status !== 'selected' ? `<button class="btn btn-primary btn-small" data-action="decision" data-id="${esc(proposal.id)}" data-status="selected">${icon('check')} Выбрать команду</button>` : '<span class="selected-label">'+icon('check')+' Выбрана для работы</span>'}${proposal.status !== 'rejected' && !milestone?.confirmedAt ? `<button class="btn btn-secondary btn-small" data-action="decision" data-id="${esc(proposal.id)}" data-status="rejected">Отклонить</button>` : ''}</div>` : ''}${milestone ? `<div class="milestone ${milestone.confirmedAt ? 'confirmed' : ''}"><div class="milestone-title">${icon(milestone.confirmedAt ? 'check' : 'clock')}<strong>${milestone.confirmedAt ? 'Этап подтверждён' : 'Этап ожидает подтверждения'}</strong>${milestone.confirmedAt ? '<span class="points-badge">+10 баллов</span>' : ''}</div><p>${esc(milestone.title)}</p><a href="${safeUrl(milestone.evidenceUrl)}" target="_blank" rel="noopener noreferrer" class="text-link">Посмотреть результат ${icon('external')}</a>${state.role === 'business' && !milestone.confirmedAt && proposal.status === 'selected' ? `<button class="btn btn-primary btn-small" data-action="confirm-stage" data-id="${esc(proposal.id)}">Подтвердить этап · +10 баллов</button>` : ''}</div>` : proposal.status === 'selected' && state.role === 'student' && proposal.teamId === state.teamId ? `<details class="stage-details"><summary>Отправить завершённый этап на проверку ${icon('plus')}</summary><form class="stage-form" data-proposal-id="${esc(proposal.id)}"><div class="form-field"><label for="stage-title-${esc(proposal.id)}">Название этапа</label><input id="stage-title-${esc(proposal.id)}" name="title" required maxlength="300" placeholder="Например, интерактивный прототип" value="${esc(stageCache.title || '')}"></div><div class="form-field"><label for="stage-url-${esc(proposal.id)}">Ссылка на результат</label><input id="stage-url-${esc(proposal.id)}" name="evidenceUrl" type="url" pattern="https?://.*" required maxlength="2000" placeholder="https://…" value="${esc(stageCache.evidenceUrl || '')}"></div><p class="field-help">После подтверждения бизнесом команда получит 10 баллов. Повторно баллы не начисляются.</p><button class="btn btn-primary btn-small" type="submit">Отправить на подтверждение</button></form></details>` : ''}</article>`;
}
function businessPage() {
  if (state.role !== 'business') return deniedPage();
  const tasks = [...state.tasks].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const pending = state.proposals.filter(p => p.status === 'pending').length;
  return `${sectionHeading('Кабинет бизнеса', 'Мои задачи', 'Уточняйте запросы, рассматривайте отклики и подтверждайте результаты.', '<a href="#create" class="btn btn-primary">'+icon('plus')+' Создать задачу</a>')}<div class="business-summary"><span><strong>${tasks.filter(t => t.status === 'published').length}</strong> опубликовано</span><span><strong>${tasks.filter(t => t.status !== 'published').length}</strong> черновиков</span><span><strong>${pending}</strong> откликов на рассмотрении</span></div><section class="panel business-table-wrap"><table class="business-table"><thead><tr><th scope="col">Задача</th><th scope="col">Статус</th><th scope="col">Готовность</th><th scope="col">Отклики</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead><tbody>${tasks.map(task => `<tr><td><a class="table-task-title" href="#${task.status === 'published' ? 'task' : 'edit'}/${esc(task.id)}">${esc(taskTitle(task))}</a><span class="table-subtitle">${esc(task.industry)}</span></td><td><span class="pill ${task.status === 'published' ? 'published' : 'soft'}">${task.status === 'published' ? 'В каталоге' : 'Черновик'}</span></td><td><span class="table-score">${task.score.total}<small>/100</small></span><div class="mini-progress"><span style="width:${task.score.total}%"></span></div></td><td>${state.proposals.filter(p => p.taskId === task.id).length}</td><td><a class="btn btn-secondary btn-small" href="#${task.status === 'published' ? 'task' : 'edit'}/${esc(task.id)}">${task.status === 'published' ? 'Открыть' : 'Продолжить'} ${icon('arrow')}</a></td></tr>`).join('')}</tbody></table>${!tasks.length ? emptyState('Начните с первой идеи', 'Помощник поможет превратить её в понятную задачу.') : ''}</section><section class="proposals-section"><div class="section-title"><h2>Все отклики</h2><span class="count-badge">${state.proposals.length}</span></div>${state.proposals.length ? state.proposals.map(p => proposalCard(p,true)).join('') : emptyState('Отклики появятся здесь','Опубликуйте задачу, чтобы команды могли предложить решение.')}</section>`;
}
function teamsPage() {
  return `${sectionHeading('Участники пространства', 'Команды, готовые создавать', 'Навыки, интересы и прогресс, подтверждённый бизнесом.')}<div class="team-grid">${state.teams.map((team,index) => `<article class="panel team-profile"><div class="team-profile-top"><span class="team-avatar color-${index%3}">${esc(team.name.slice(0,2))}</span><span class="team-points">${team.points}<small>баллов</small></span></div><h2>${esc(team.name)}</h2><p class="team-interests">${esc(team.interests.join(' · '))}</p><h3>Навыки</h3><div class="tag-list">${team.skills.map(skill => `<span class="tag">${esc(skill)}</span>`).join('')}</div><h3>Технологии</h3><div class="tag-list technology-tags">${team.technologies.map(technology => `<span class="tag">${esc(technology)}</span>`).join('')}</div><div class="team-profile-footer">${icon('check')} Баллы только за подтверждённые этапы</div></article>`).join('')}</div><div class="info-strip">${icon('info')}<p>Каждый подтверждённый бизнесом этап приносит команде 10 баллов. Отправка отклика сама по себе баллов не даёт.</p></div>`;
}
function submissionsPage() {
  if (state.role !== 'student') return deniedPage();
  const proposals = state.proposals.filter(p => p.teamId === state.teamId);
  const team = getTeam(state.teamId);
  return `${sectionHeading('Кабинет команды', 'Мои отклики', `${team?.name || 'Команда'} · От первого предложения до подтверждённого результата`, '<a href="#catalog" class="btn btn-primary">Найти задачу '+icon('arrow')+'</a>')}<div class="business-summary"><span><strong>${proposals.length}</strong> отправлено</span><span><strong>${proposals.filter(p => p.status === 'selected').length}</strong> выбрано бизнесом</span><span><strong>${team?.points || 0}</strong> баллов за прогресс</span></div>${proposals.length ? proposals.map(p => proposalCard(p,true)).join('') : emptyState('Найдите вашу первую задачу','Откликнитесь на запрос бизнеса и предложите команде новый вызов.','<a href="#catalog" class="btn btn-primary">Перейти в каталог</a>')}`;
}
function deniedPage() { return emptyState('Эта страница доступна другой роли', 'Выберите подходящую демонстрационную роль в верхней панели.', '<a class="btn btn-primary" href="#catalog">В каталог</a>'); }
function missingPage() { return emptyState('Задача не найдена', 'Возможно, она ещё не опубликована или недоступна текущей роли.', '<a class="btn btn-primary" href="#catalog">В каталог</a>'); }
function render() {
  if (!state.initialized) { app.innerHTML = `<div class="boot-screen"><div class="brand-mark">H<span>·</span></div><h1>Не удалось загрузить пространство</h1><p>${esc(state.error || 'Проверьте соединение с сервером.')}</p><button class="btn btn-primary" data-action="retry">Повторить</button></div>`; return; }
  const [page,id] = route();
  let content;
  switch (page) {
    case 'create': content = createPage(); break;
    case 'edit': content = editPage(id); break;
    case 'task': content = getTask(id) ? taskDetail(getTask(id)) : missingPage(); break;
    case 'business': content = businessPage(); break;
    case 'teams': content = teamsPage(); break;
    case 'submissions': content = submissionsPage(); break;
    default: content = catalogPage();
  }
  app.innerHTML = shell(content);
  document.title = `${{catalog:'Каталог задач',create:'Новая задача',edit:'Редактор задачи',task: getTask(id) ? taskTitle(getTask(id)) : 'Задача',business:'Мои задачи',teams:'Команды',submissions:'Мои отклики'}[page] || 'Каталог задач'} · HackAlem`;
}
function readEditor(form) {
  return {fields: Object.fromEntries(Object.keys(FIELDS).map(field => [field,form.elements.namedItem(field).value])), confirmedFields: Object.keys(FIELDS).filter(field => form.elements.namedItem(`confirm-${field}`)?.checked), industry: form.elements.namedItem('industry').value};
}
function cacheForm(form) {
  if (!form) return;
  if (form.id === 'create-form') { state.formCache.create = Object.fromEntries(new FormData(form)); remember('hackalem-description',state.formCache.create.draft); }
  if (form.id === 'answers-form') state.formCache[`answers-${form.dataset.taskId}`] = Object.fromEntries(new FormData(form));
  if (form.id === 'editor-form') state.formCache[`edit-${form.dataset.taskId}`] = readEditor(form);
  if (form.id === 'proposal-form') state.formCache[`proposal-${form.dataset.taskId}`] = Object.fromEntries(new FormData(form));
  if (form.classList.contains('stage-form')) state.formCache[`stage-${form.dataset.proposalId}`] = Object.fromEntries(new FormData(form));
}
app.addEventListener('input', event => {
  if (event.target.id === 'catalog-search') { state.query = event.target.value; document.querySelector('#catalog-results').innerHTML = catalogResults(); return; }
  if (event.target.dataset.field) { const checkbox = document.querySelector(`[data-confirm="${event.target.dataset.field}"]`); if (checkbox) checkbox.checked = false; }
  cacheForm(event.target.closest('form'));
});
app.addEventListener('change', async event => {
  if (['role-switch','team-switch'].includes(event.target.id)) {
    const control = event.target;
    if (state.busy) return;
    const previousRole = state.role, previousTeam = state.teamId;
    const identity = {role: control.id === 'role-switch' ? control.value : state.role, teamId: control.id === 'team-switch' ? control.value : state.teamId};
    control.disabled = true; setBusy(true);
    try { await refresh(identity); remember('hackalem-role',state.role); remember('hackalem-team',state.teamId); state.formCache = {}; const current = route()[0]; if (['create','edit','business','submissions'].includes(current)) go(state.role === 'business' ? 'business' : 'submissions'); else render(); }
    catch(error) { state.role = previousRole; state.teamId = previousTeam; control.value = control.id === 'role-switch' ? previousRole : previousTeam; toast(error.message,true); }
    finally { setBusy(false); if(control.isConnected) control.disabled = false; }
    return;
  }
  if (event.target.id === 'industry-filter') state.industry = event.target.value;
  if (event.target.id === 'level-filter') state.level = event.target.value;
  if (['industry-filter','level-filter'].includes(event.target.id)) document.querySelector('#catalog-results').innerHTML = catalogResults();
  cacheForm(event.target.closest('form'));
});
app.addEventListener('submit', event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  cacheForm(form);
  const button = event.submitter || form.querySelector('[type="submit"]');
  run(button, async () => {
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'create-form') {
      const {task} = await api('/api/tasks', 'POST', values);
      upsertTask(task); state.wizard[task.id] = {step: 2}; delete state.formCache.create; remember('hackalem-description','');
      go(`edit/${task.id}`);
      try { const data = await api(`/api/tasks/${task.id}/questions`, 'POST', {}); upsertTask(data.task); state.wizard[task.id].ai = data.ai; if (route()[1] === task.id) render(); }
      catch(error) { toast(`Черновик сохранён. ${error.message}`,true); }
    } else if (form.id === 'answers-form') {
      const data = await api(`/api/tasks/${form.dataset.taskId}/compose`, 'POST', {answers: values});
      upsertTask(data.task); state.wizard[data.task.id] = {step: 3,ai: data.ai}; delete state.formCache[`edit-${data.task.id}`]; render(); window.scrollTo({top:0,behavior:'smooth'}); toast('Карточка собрана. Проверьте и подтвердите сведения.');
    } else if (form.id === 'editor-form') {
      try {
        const data = await api(`/api/tasks/${form.dataset.taskId}`, 'PATCH', {...readEditor(form),revision:Number(form.dataset.revision)});
        upsertTask(data.task); delete state.formCache[`edit-${data.task.id}`]; delete state.conflicts[data.task.id]; render(); toast('Карточка сохранена. Рейтинг обновлён.');
      } catch (error) {
        if (error.status === 409) { state.conflicts[form.dataset.taskId] = true; render(); }
        throw error;
      }
    } else if (form.id === 'proposal-form') {
      const data = await api(`/api/tasks/${form.dataset.taskId}/proposals`, 'POST', values);
      upsertProposal(data.proposal); delete state.formCache[`proposal-${form.dataset.taskId}`]; render(); document.querySelector(`#proposal-${CSS.escape(data.proposal.id)}`)?.scrollIntoView({behavior:'smooth',block:'center'}); toast('Предложение отправлено бизнесу.');
    } else if (form.classList.contains('stage-form')) {
      const data = await api(`/api/proposals/${form.dataset.proposalId}/submit-stage`, 'POST', values);
      upsertProposal(data.proposal); delete state.formCache[`stage-${form.dataset.proposalId}`]; render(); toast('Этап отправлен на подтверждение бизнесу.');
    }
  });
});
app.addEventListener('click', event => {
  const scroll = event.target.closest('[data-scroll]');
  if (scroll) { event.preventDefault(); document.getElementById(scroll.dataset.scroll)?.scrollIntoView({behavior:'smooth',block:'start'}); document.querySelector('#proposal-idea')?.focus({preventScroll:true}); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const {action,id} = button.dataset;
  run(button, async () => {
    if (action === 'retry') { await refresh(); render(); }
    if (action === 'conflict-reload' || action === 'conflict-keep') { await refresh(); if (action === 'conflict-reload') delete state.formCache[`edit-${id}`]; delete state.conflicts[id]; render(); toast(action === 'conflict-keep' ? 'Загружена новая версия. Проверьте ваш текст и сохраните карточку повторно.' : 'Показана последняя сохранённая карточка.'); }
    if (action === 'reset-filters') { state.query = ''; state.industry = ''; state.level = ''; render(); }
    if (action === 'questions') { const data = await api(`/api/tasks/${id}/questions`,'POST',{}); upsertTask(data.task); state.wizard[id] = {step:2,ai:data.ai}; render(); }
    if (action === 'publish') {
      if (!document.querySelector('#publish-confirm')?.checked) { document.querySelector('#publish-confirm')?.focus(); throw new Error('Подтвердите публикацию, отметив поле над кнопкой.'); }
      if (state.formCache[`edit-${id}`]) throw new Error('Сначала сохраните изменения карточки, затем опубликуйте задачу.');
      const data = await api(`/api/tasks/${id}/publish`,'POST',{revision:getTask(id).revision,confirmed:true});
      upsertTask(data.task); go(`task/${id}`); toast('Задача опубликована и доступна командам.');
    }
    if (action === 'decision') { const data = await api(`/api/proposals/${id}/decision`,'POST',{status:button.dataset.status}); upsertProposal(data.proposal); render(); toast(button.dataset.status === 'selected' ? 'Команда выбрана. Можно выбрать и другие команды.' : 'Предложение отклонено.'); }
    if (action === 'confirm-stage') { const data = await api(`/api/proposals/${id}/confirm-stage`,'POST',{}); upsertProposal(data.proposal); if (data.teams) state.teams = data.teams; render(); toast('Этап подтверждён. Команде начислено 10 баллов.'); }
  });
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); document.querySelector('#main-content')?.focus({preventScroll:true}); });
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); document.querySelector('#main-content')?.focus(); });
try { await refresh(); render(); } catch(error) { state.error = error.message; render(); }
