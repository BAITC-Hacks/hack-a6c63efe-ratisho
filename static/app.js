import {createAssistant} from "./assistant-ui.js";
import {createBriefWorkflow} from "./brief-ui.js";
import {freshFilters, filterTasks, facetCount} from "./catalog.js";
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
  const timer = setTimeout(() => controller.abort(), 95000);
  try {
    const response = await fetch(path, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal});
    let data;
    try { data = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.'); }
    if (!response.ok) { if(response.status===401&&!path.startsWith('/api/auth')){state.user=null;render();} const error = new Error(data.error || 'Не удалось выполнить действие'); error.status = response.status; throw error; }
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
  if(data.user){state.role=data.user.role;state.teamId=data.user.teamId;}
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
  return `<div class="app-layout"><aside class="sidebar"><a class="brand" href="#catalog" aria-label="HackAlem — каталог"><span class="brand-mark">H<span>·</span></span><span>HackAlem<small>AI SANA · WORKSPACE</small></span></a><p class="nav-label">Рабочее пространство</p><nav aria-label="Основная навигация">${nav('catalog', 'Каталог задач', 'grid')}${state.role === 'business' ? nav('business', 'Мои задачи', 'briefcase', state.tasks.filter(ownTask).length) : nav('submissions', 'Мои отклики', 'briefcase', state.proposals.filter(p => p.teamId === state.teamId).length)}${nav('teams', 'Команды', 'users')}${state.role==='student'?nav('profile','Мой профиль','users'):''}${nav('demo','Репетиция демо','spark')}</nav>${state.role === 'business' ? '<a class="btn sidebar-create" href="#create">'+icon('plus')+' Создать задачу</a>' : ''}<div class="sidebar-note"><span class="note-symbol">${icon('spark')}</span><h3>От идеи к результату</h3><p>Понятная задача.<br>Подходящая команда.<br>Подтверждённый прогресс.</p></div><div class="sidebar-footer"><span class="connection-dot"></span> Демонстрационное пространство<small>HackAlem × AI Sana</small></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Рабочее пространство <span>/</span> <strong>${esc({catalog:'Каталог',business:'Мои задачи',create:'Новая задача',edit:'Редактор задачи',task:'Карточка задачи',teams:'Команды',profile:'Профиль',demo:'Репетиция',submissions:'Мои отклики'}[current] || 'Каталог')}</strong></div><div class="role-controls"><span class="demo-label">Демо-роль</span><label class="sr-only" for="role-switch">Выбрать роль</label><select id="role-switch" aria-label="Выбрать роль"><option value="business" ${state.role === 'business' ? 'selected' : ''}>Бизнес</option><option value="student" ${state.role === 'student' ? 'selected' : ''}>Команда</option></select>${state.role === 'student' ? `<label class="sr-only" for="team-switch">Текущая команда</label><select id="team-switch" aria-label="Текущая команда">${state.teams.map(team => `<option value="${esc(team.id)}" ${team.id === state.teamId ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}</select>` : ''}<span class="avatar" aria-label="${roleName}">${state.role === 'business' ? 'Б' : esc(getTeam(state.teamId)?.name?.charAt(0) || 'К')}</span></div></header><main id="main-content" tabindex="-1">${content}</main><footer class="main-footer"><span>HackAlem · Пространство совместной работы</span><span>Решения подтверждает человек ${icon('check')}</span></footer></div></div>`;
}
function taskCard(task) {
  const proposals = state.proposals.filter(item => item.taskId === task.id);
  return `<article class="task-card"><div class="card-top"><span class="industry">${esc(task.industry || 'Другое')}</span><span class="small-score" title="Рейтинг готовности">${task.score.total}<small>/100</small></span></div><h3><a href="#task/${esc(task.id)}">${esc(taskTitle(task))}</a></h3><p class="card-summary">${esc(task.fields.need || task.fields.context || task.draft || 'Описание пока не заполнено')}</p><div class="readiness-line"><span>Готовность задачи</span><strong>${task.score.total}%</strong></div><div class="progress-track"><span style="width:${task.score.total}%" class="level-bg-${esc(task.score.level)}"></span></div><div class="card-bottom">${levelPill(task)}<a href="#task/${esc(task.id)}" class="arrow-link" aria-label="Открыть задачу: ${esc(taskTitle(task))}">${icon('arrow')}</a></div><div class="card-meta">${icon('users')} ${ownTask(task) ? countWord(proposals.length, ['отклик', 'отклика', 'откликов']) : 'Открыта для предложений'}</div></article>`;
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
  if (!ownTask(task)) return deniedPage();
  const step = state.wizard[id]?.step || (Object.values(task.fields || {}).some(Boolean) ? 3 : 2);
  return step === 2 ? questionPage(task) : editorPage(task);
}
function taskDetail(task) {
  const proposals = state.proposals.filter(item => item.taskId === task.id && (state.role === 'business' || item.teamId === state.teamId));
  return `<a href="#catalog" class="back-link">${icon('back')} К каталогу задач</a><header class="detail-heading"><div class="detail-eyebrow"><span class="industry">${esc(task.industry)}</span>${levelPill(task)}${task.status === 'draft' ? '<span class="pill soft">Не опубликована</span>' : ''}</div><h1>${esc(taskTitle(task))}</h1><div class="detail-meta">${icon('users')} ${ownTask(task) ? countWord(proposals.length, ['предложение команды','предложения команд','предложений команд']) : 'Реальная задача бизнеса'}<span>·</span> Выбор команд — за бизнесом</div></header><div class="detail-layout"><div><section class="panel brief-panel">${Object.entries(FIELDS).filter(([field]) => field !== 'title').map(([field,label],index) => `<section class="brief-field"><div class="brief-field-title"><span class="brief-number">${String(index+1).padStart(2,'0')}</span><h2>${esc(label)}</h2>${task.confirmedFields?.includes(field) ? `<span class="verified" title="Подтверждено бизнесом">${icon('check')}<span>Подтверждено</span></span>` : ''}</div><p class="${task.fields[field] ? '' : 'not-provided'}">${esc(task.fields[field] || 'Пока не указано')}</p></section>`).join('')}</section>${state.role === 'student' && task.status === 'published' ? proposalForm(task) : ''}<section class="proposals-section" aria-label="Предложения команд"><div class="section-title"><h2>${state.role === 'business' ? 'Предложения команд' : 'Отклики вашей команды'}</h2><span class="count-badge">${proposals.length}</span></div>${state.role === 'business' ? '<p class="section-description">Рассмотрите предложения и выберите одну или несколько команд. Можно пока не выбирать никого.</p>' : ''}${proposals.length ? proposals.map(proposalCard).join('') : emptyState('Пока нет откликов', state.role === 'business' ? 'После публикации команды смогут предложить свои идеи.' : 'Расскажите, как ваша команда видит решение этой задачи.')}</section></div><aside class="detail-sidebar">${scorePanel(task, true)}${state.role === 'business' ? `<a class="btn btn-primary full-width" href="#edit/${esc(task.id)}">Редактировать задачу ${icon('arrow')}</a>` : task.status === 'published' ? '<a class="btn btn-primary full-width" href="#proposal-form" data-scroll="proposal-form">Предложить решение '+icon('arrow')+'</a>' : ''}<div class="soft-card"><strong>${icon('info')} Рейтинг не ограничивает участие</strong><p>Он помогает оценить полноту задачи. Решение о сотрудничестве принимает бизнес.</p></div></aside></div>`;
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
  const tasks = state.tasks.filter(ownTask).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
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
function deniedPage() { return emptyState('Эта страница доступна другой роли', 'Войдите в аккаунт с доступом к этой странице.', '<a class="btn btn-primary" href="#catalog">В каталог</a>'); }
function missingPage() { return emptyState('Задача не найдена', 'Возможно, она ещё не опубликована или недоступна текущей роли.', '<a class="btn btn-primary" href="#catalog">В каталог</a>'); }
function render() {
  if(!state.user){app.innerHTML=loginPage();assistantWidget.sync();return;}
  if (!state.initialized) { app.innerHTML = `<div class="boot-screen"><div class="brand-mark">H<span>·</span></div><h1>Не удалось загрузить пространство</h1><p>${esc(state.error || 'Проверьте соединение с сервером.')}</p><button class="btn btn-primary" data-action="retry">Повторить</button></div>`; return; }
  const [page,id] = route();
  let content;
  switch (page) {
    case 'profile': content = profilePage(id); break;
    case 'demo': content = demoPage(); break;
    case 'create': content = createPage(); break;
    case 'edit': content = editPage(id); break;
    case 'task': content = getTask(id) ? taskDetail(getTask(id)) : missingPage(); break;
    case 'business': content = businessPage(); break;
    case 'teams': content = teamsPage(); break;
    case 'submissions': content = submissionsPage(); break;
    default: content = catalogPage();
  }
  app.innerHTML = shell(content);
  assistantWidget.sync();
  const log=document.querySelector('.chat-messages');if(log)log.scrollTop=log.scrollHeight;
  document.title = `${{catalog:'Каталог задач',create:'Новая задача',edit:'Редактор задачи',task: getTask(id) ? taskTitle(getTask(id)) : 'Задача',business:'Мои задачи',teams:'Команды',profile:'Профиль',demo:'Репетиция',submissions:'Мои отклики'}[page] || 'Каталог задач'} · HackAlem`;
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
const WORK_MODES={remote:'Удалённо',onsite:'Очно',hybrid:'Гибрид',flexible:'По договорённости'};
state.filters=freshFilters(); state.chatDrafts={}; state.profileDraft={};
const fmtDate=value=>value?new Date(value).toLocaleDateString('ru-RU'):'Не указана';
const tags=values=>`<div class="tag-list">${values.map(v=>`<span class="tag">${esc(v)}</span>`).join('')}</div>`;
function tracePanel(ai) {
  if(!ai?.trace?.length) return '';
  const labels={context:'Контекст',memory:'Память',analysis:'Анализ',interview:'Диалог',composition:'Карточка',validation:'Проверка',skills:'Навыки',review:'Ревью',profile:'Профиль'};
  return `<details class="agent-trace"><summary>${icon('spark')} Что сделали агенты <span class="pill soft">${ai.mode==='remote'?'Модель':'Локально'}</span></summary><ol>${ai.trace.map(t=>`<li><strong>${esc(labels[t.agent]||t.agent)}</strong><span>${esc(t.summary)}</span></li>`).join('')}</ol></details>`;
}
function matchPanel(m) {
  if(!m) return '';
  return `<div class="match-panel"><div class="match-heading"><span>${icon('spark')} Совместимость по навыкам</span><strong>${m.score==null?'—':m.score+'%'}</strong></div><p class="field-help">${m.score==null?'Требования ещё не согласованы.':'Оценка для этой задачи, не общий рейтинг человека.'}</p>${m.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}<details><summary>Как рассчитано</summary><p>${esc(m.formula)}</p><p>${esc(m.confidence)}</p></details></div>`;
}
const baseTaskCard=taskCard;
taskCard=function(task){return baseTaskCard(task).replace('<div class="card-meta">',`<div class="card-skill-row">${tags((task.requiredSkills||[]).filter(s=>s.confirmed).map(s=>s.name))}</div>${state.role==='student'?`<div class="card-fit"><span>Вам подходит</span><strong>${task.match?.score==null?'Нет оценки':task.match.score+'%'}</strong></div>`:''}<div class="card-meta">`);};
function facet(key,title,options) {
  return `<details class="facet-section" ${key==='industries'||state.filters[key].length?'open':''}><summary>${title}${state.filters[key].length?' · '+state.filters[key].length:''}</summary><fieldset class="facet"><legend class="sr-only">${title}</legend>${options.map(([value,label])=>{const count=facetCount(state.tasks,state.filters,key,value);const checked=state.filters[key].includes(value);return `<label class="facet-option ${!count&&!checked?'muted':''}"><input type="checkbox" data-facet="${key}" value="${esc(value)}" ${checked?'checked':''}><span>${esc(label)}</span><small>${count}</small></label>`;}).join('')}</fieldset></details>`;
}
function filterSidebar() {
 const f=state.filters, published=state.tasks.filter(t=>t.status==='published');
 const skills=[...new Set(published.flatMap(t=>(t.requiredSkills||[]).filter(s=>s.confirmed).map(s=>s.name)))].sort();
 return `<aside class="panel filter-sidebar"><div class="section-title"><h2>Фильтры</h2><button class="text-link" data-action="filters-clear">Сбросить</button></div><p class="field-help">Фильтры работают вместе. Числа учитывают остальные выбранные условия.</p>${facet('industries','Тематика',[...new Set(published.map(t=>t.industry))].map(x=>[x,x]))}${facet('skills','Подтверждённые навыки',skills.map(x=>[x,x]))}<label class="filter-label">Совпадение навыков<select data-filter="skillMode"><option value="any" ${f.skillMode==='any'?'selected':''}>Хотя бы один</option><option value="all" ${f.skillMode==='all'?'selected':''}>Все выбранные</option></select></label>${facet('levels','Готовность',Object.entries(LEVELS))}${facet('modes','Формат',Object.entries(WORK_MODES))}<label class="filter-label">Готовность от <output>${f.minScore}</output><input type="range" min="0" max="100" step="5" value="${f.minScore}" data-filter="minScore"></label>${state.role==='student'?`<label class="filter-label">Совместимость от <output>${f.minMatch}%</output><input type="range" min="0" max="100" step="5" value="${f.minMatch}" data-filter="minMatch"></label>`:''}<fieldset class="facet"><legend>Дата создания</legend><label class="filter-label">С<input type="date" data-filter="from" value="${f.from}"></label><label class="filter-label">По<input type="date" data-filter="to" value="${f.to}"></label></fieldset><label class="facet-option"><input type="checkbox" data-filter="openDeadline" ${f.openDeadline?'checked':''}> Без истёкшего срока</label></aside>`;
}
function activeFilters() {
 const f=state.filters;
 return ['industries','skills','levels','modes'].flatMap(k=>f[k].map(v=>`<button class="filter-chip" data-action="filter-remove" data-key="${k}" data-value="${esc(v)}">${esc(LEVELS[v]||WORK_MODES[v]||v)} <span>×</span></button>`)).join('');
}
filteredTasks=()=>filterTasks(state.tasks,state.filters);
catalogResults=function(){const tasks=filteredTasks();return `<div class="results-heading"><span>${countWord(tasks.length,['задача','задачи','задач'])}</span><label>Сортировать <select data-filter="sort" aria-label="Сортировка">${[['readiness','По готовности'],...(state.role==='student'?[['relevance','По совместимости']]:[]),['newest','Сначала новые']].map(([v,l])=>`<option value="${v}" ${state.filters.sort===v?'selected':''}>${l}</option>`).join('')}</select></label></div>${tasks.length?`<div class="task-grid discovery-grid">${tasks.map(taskCard).join('')}</div>`:emptyState('Нет задач с такими условиями','Уберите один из фильтров или уменьшите порог.','<button class="btn btn-secondary" data-action="filters-clear">Сбросить фильтры</button>')}`;};
catalogPage=function(){return `${sectionHeading('DISCOVER · НАВЫКИ В ДЕЛЕ','Найдите свою задачу',state.role==='student'?`Подбор для ${getTeam(state.teamId)?.name}. Готовность бизнеса и совместимость с вами — два отдельных показателя.`:'Задачи, навыки и команды в одном пространстве.',state.role==='business'?'<a href="#create" class="btn btn-primary">'+icon('plus')+' Создать задачу</a>':'<a href="#profile" class="btn btn-primary">Настроить мой профиль</a>')}<div class="discovery-layout"><div id="facets">${filterSidebar()}</div><section><div class="panel discovery-search"><div class="search-wrap">${icon('search')}<input id="discovery-search" type="search" aria-label="Поиск задач" placeholder="Что вам интересно создавать?" value="${esc(state.filters.query)}"></div></div><div id="active-filters" class="active-filters">${activeFilters()}</div><div id="catalog-results">${catalogResults()}</div></section></div>`;};
questionPage=function(task){
 const ai=task.ai||state.wizard[task.id]?.ai, draft=state.chatDrafts[task.id]||{};
 const history=task.conversation||[], focus=draft.focus||[...history].reverse().find(t=>t.role==='assistant')?.focus||'need';
 return `${sectionHeading('AI STUDIO · КОНСТРУКТОР','Обсудим вашу задачу','Расскажите детали, задавайте вопросы и исправляйте ответы. Переписка сохраняется автоматически.')} ${steps(2)}<div class="chat-layout"><section class="panel chat-panel"><div class="chat-top"><span class="round-icon">${icon('spark')}</span><div><strong>Ассистент по бизнес-задачам</strong><small>${ai?.mode==='remote'?'Модель · память диалога включена':'Локальный режим · для свободного диалога подключите модель'}</small></div><span class="pill soft">${countWord(history.length,['сообщение','сообщения','сообщений'])}</span></div><div class="chat-messages" role="log" aria-label="История диалога"><article class="chat-message user"><span>Исходная идея</span><p>${esc(task.draft)}</p></article>${history.map(m=>`<article class="chat-message ${m.role}"><span>${m.role==='user'?'Вы':'Ассистент'}${m.mode==='local'?' · по правилам':''}</span><p>${esc(m.content)}</p></article>`).join('')}${!history.length?`<div class="empty-inline"><p>Начнём с нескольких вопросов по вашей ситуации.</p><button class="btn btn-primary" data-action="chat-start" data-id="${task.id}">Начать диалог ${icon('spark')}</button></div>`:''}</div>${history.length?`<form id="chat-form" data-task-id="${task.id}" class="chat-composer"><label class="sr-only" for="chat-message">Сообщение ассистенту</label><textarea id="chat-message" name="message" rows="3" maxlength="4000" required placeholder="Напишите ответ или задайте свой вопрос…">${esc(draft.message||'')}</textarea><div class="chat-toolbar"><span class="field-help">✦ Тему определяет ассистент</span><button class="btn btn-primary" type="submit">Отправить ${icon('arrow')}</button></div><small class="field-help">Можно отвечать сразу на несколько вопросов. Агенты контекста, диалога и проверки распределят сведения по полям.</small></form>`:''}</section><aside class="chat-aside"><section class="panel memory-panel"><p class="eyebrow">ПАМЯТЬ ЗАДАЧИ</p><h2>Что уже известно</h2>${Object.entries(task.memory||{}).filter(([,v])=>v.value).map(([k,v])=>`<div class="memory-item"><strong>${esc(FIELDS[k])}</strong><p>${esc(v.value)}</p><small>Источник: ${v.source==='draft'?'описание':'ваше сообщение'}</small></div>`).join('')||'<p class="subtle">Здесь появятся сведения из ваших ответов.</p>'}<button class="btn btn-primary full-width" data-action="chat-compose" data-id="${task.id}">Собрать карточку ${icon('arrow')}</button><p class="field-help">Сведения можно исправить и подтвердить на следующем шаге.</p></section>${ai?.warning?`<div class="soft-card">${esc(ai.warning)}</div>`:''}${tracePanel(ai)}</aside></div>`;
};
function skillEditor(task){
 const existing=task.requiredSkills||[], proposed=task.skillSuggestions?.skills||[];
 const rows=[...existing,...proposed.filter(p=>!existing.some(x=>x.name===p.name))];
 return `<section class="panel innovation-panel"><div class="panel-heading"><span class="round-icon">${icon('users')}</span><div><h2>Кто нужен для этой задачи?</h2><p>Ассистент предлагает навыки. Вы выбираете требования и их важность.</p></div></div><button class="btn btn-secondary" data-action="skills-suggest" data-id="${task.id}">${icon('spark')} Предложить навыки</button>${tracePanel(task.skillSuggestions)}<form id="skills-form" data-task-id="${task.id}"><div class="skill-choices">${rows.map((s,i)=>`<div class="skill-choice"><label><input type="checkbox" name="skill-${i}" data-skill-name="${esc(s.name)}" ${s.confirmed?'checked':''}><strong>${esc(s.name)}</strong><span>${esc(s.reason||'Подтверждено вами')}</span>${s.evidence?`<small>Основание: «${esc(s.evidence)}»</small>`:''}</label><select name="weight-${i}" aria-label="Важность ${esc(s.name)}">${[[1,'Полезно ×1'],[2,'Важно ×2'],[3,'Ключевое ×3']].map(([n,l])=>`<option value="${n}" ${s.weight===n?'selected':''}>${l}</option>`).join('')}</select></div>`).join('')}</div><label class="filter-label">Добавить свои навыки через запятую<input name="customSkills" placeholder="Например: pandas, Power BI, SQL" maxlength="1000"></label><div class="form-row"><label class="filter-label">Формат работы<select name="workMode">${Object.entries(WORK_MODES).map(([v,l])=>`<option value="${v}" ${(task.workMode||'flexible')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="filter-label">Срок задачи<input type="date" name="deadline" value="${esc(task.deadline||'')}"></label></div><button class="btn btn-primary" type="submit">Подтвердить выбранные требования</button></form></section>`;
}
function reviewPanel(task){
 const review=task.review, stale=review&&JSON.stringify(review.fieldsSnapshot)!==JSON.stringify(task.fields);
 return `<section class="panel innovation-panel"><div class="section-title"><div><p class="eyebrow">ВТОРОЙ ВЗГЛЯД</p><h2>Проверка противоречий</h2></div><button class="btn btn-secondary" data-action="review" data-id="${task.id}">${icon('spark')} Проверить</button></div><p>Ассистент отмечает возможные несоответствия. Вы решаете, что исправить.</p>${stale?'<p class="inline-warning">Карточка изменена после проверки. Запустите проверку повторно.</p>':''}${review?`${review.issues.length?review.issues.map(i=>`<article class="review-issue"><strong>${esc(i.title)}</strong><p>${esc(i.question)}</p>${i.evidence.map(q=>`<blockquote>${esc(q)}</blockquote>`).join('')}<span class="pill soft">${{open:'Открыто',resolved:'Исправлено',dismissed:'Отклонено'}[i.status]}</span>${i.status==='open'?`<button class="btn btn-secondary btn-small" data-action="review-resolve" data-id="${task.id}" data-issue="${i.id}" data-status="resolved">Я исправил(а)</button><button class="text-link" data-action="review-resolve" data-id="${task.id}" data-issue="${i.id}" data-status="dismissed">Не относится</button>`:''}</article>`).join(''):'<p>Замечаний не найдено. Проверьте карточку самостоятельно.</p>'}<p class="field-help">${esc(review.warning)}</p>${tracePanel(review)}`:''}</section>`;
}
const baseScorePanel=scorePanel;
scorePanel=function(task,compact=false){let html=baseScorePanel(task,compact);if(!compact&&state.role==='business'){
 const weights={context:10,need:10,data:20,outcome:15,success:15,constraints:10,users:10,contact:5,interaction:5};
 const next=task.score.missingFields.slice().sort((a,b)=>(weights[b]||0)-(weights[a]||0))[0];
 if(next) html+=`<section class="soft-card next-step"><p class="eyebrow">СЛЕДУЮЩИЙ ШАГ</p><h3>+${weights[next]||0} баллов</h3><p>${esc(QUESTION_FOR_FIELD[next]||HINTS[next])}</p><button class="btn btn-secondary" data-action="focus-field" data-field="${next}">Уточнить: ${esc(FIELDS[next])}</button></section>`;
}if(task.scoreHistory?.length)html+=`<details class="agent-trace"><summary>История готовности</summary><ol>${task.scoreHistory.slice(-8).reverse().map(h=>`<li><strong>${h.before} → ${h.after}</strong><span>${fmtDate(h.at)}</span></li>`).join('')}</ol></details>`;return html;};
const QUESTION_FOR_FIELD={data:'Какие данные вы передадите команде?',success:'По какому результату вы примете работу?',constraints:'Какие сроки и ограничения необходимо учесть?'};
const baseEditorPage=editorPage;
editorPage=function(task){return baseEditorPage(task)+`<div class="editor-addons"><div>${skillEditor(task)}${reviewPanel(task)}</div><aside>${tracePanel(task.ai)}${task.status==='draft'?`<button class="btn btn-secondary" data-action="back-chat" data-id="${task.id}">Вернуться к переписке</button>`:''}</aside></div>`;};
function comparison(task,proposals){return proposals.length?`<section class="panel innovation-panel"><h2>Сравнить отклики</h2><div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Команда</th><th>Совместимость</th><th>Идея и план</th><th>Срок</th><th>Прототип</th><th>Решение</th></tr></thead><tbody>${proposals.map(p=>{const m=task.candidates?.find(c=>c.teamId===p.teamId);return `<tr><td><strong>${esc(getTeam(p.teamId)?.name)}</strong></td><td>${m?.score==null?'—':m.score+'%'}</td><td><p>${esc(p.idea)}</p><details><summary>План</summary>${esc(p.plan)}</details></td><td>${esc(p.timeline)}</td><td><a class="text-link" href="${safeUrl(p.prototypeUrl)}" target="_blank" rel="noopener noreferrer">Открыть</a></td><td><span>${esc(STATUS[p.status])}</span>${p.status==='pending'?`<button class="btn btn-primary btn-small" data-action="decision" data-id="${p.id}" data-status="selected">Выбрать</button>`:''}</td></tr>`;}).join('')}</tbody></table></div></section>`:'';}
function candidatesPanel(task){return `<section class="panel innovation-panel"><p class="eyebrow">ПОДБОР ПОД ВАШИ ТРЕБОВАНИЯ</p><h2>Кому подходит эта задача</h2><p>Совместимость зависит от требований именно этой задачи. Приглашение и выбор остаются за вами.</p><div class="candidate-grid">${(task.candidates||[]).map(m=>{const team=getTeam(m.teamId);return `<article class="candidate"><div class="section-title"><h3>${esc(team?.name)}</h3><span class="fit-score">${m.score==null?'—':m.score+'%'}</span></div>${m.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}<details><summary>Опыт и источники</summary><p>${esc(m.summary)}</p>${m.achievements.map(a=>a.url?`<a class="text-link" target="_blank" rel="noopener noreferrer" href="${safeUrl(a.url)}">${esc(a.source)} ${icon('external')}</a>`:'').join('')}<p class="field-help">Сведения подтверждены участником; не независимая оценка квалификации.</p></details><a href="#profile/${team.id}" class="text-link">Посмотреть профиль ${icon('arrow')}</a></article>`;}).join('')}</div></section>`;}
const baseTaskDetail=taskDetail;
taskDetail=function(task){const props=state.proposals.filter(p=>p.taskId===task.id);return `${baseTaskDetail(task)}<div class="detail-addons"><section class="panel innovation-panel"><h2>Навыки и условия</h2>${tags((task.requiredSkills||[]).filter(s=>s.confirmed).map(s=>s.name))}<p>${esc(WORK_MODES[task.workMode]||WORK_MODES.flexible)} · Срок: ${esc(task.deadline||'Не указан')}</p>${state.role==='student'?matchPanel(task.match):''}</section>${state.role==='business'?comparison(task,props)+candidatesPanel(task):''}</div>`;};
const baseTeamsPage=teamsPage;
teamsPage=function(){return baseTeamsPage()+`<section class="panel innovation-panel"><h2>Профили участников</h2><div class="tag-list">${state.teams.map(t=>`<a class="btn btn-secondary" href="#profile/${t.id}">${esc(t.name)} ${icon('arrow')}</a>`).join('')}</div></section>`;};
function profilePage(id){
 const team=getTeam(id||state.teamId);if(!team)return missingPage();const own=state.role==='student'&&team.id===state.teamId;
 const preview=team.profilePreview, p=team.profile||{}, cache=state.profileDraft[team.id]||{};
 const values={name:team.name,skills:(preview?.skills||team.skills).join(', '),technologies:team.technologies.join(', '),interests:team.interests.join(', '),...cache};
 return `${sectionHeading('TALENT · ПРОФИЛЬ',own?'Ваш опыт — новые возможности':team.name,own?'Импортируйте профессиональный опыт и подтвердите навыки. Подбор задач обновится после сохранения.':'Навыки и опыт, которые участник решил показать.')}<div class="profile-layout"><section class="panel innovation-panel"><div class="profile-hero"><span class="team-avatar">${esc(team.name.slice(0,2))}</span><div><h2>${esc(team.name)}</h2><p>${team.points} баллов за подтверждённые этапы</p></div></div>${own?`<form id="profile-form" data-team-id="${team.id}"><label class="filter-label">Имя участника или команды<input name="name" required maxlength="120" value="${esc(values.name)}"></label><label class="filter-label">Навыки через запятую<textarea name="skills" rows="3" maxlength="3200">${esc(values.skills)}</textarea></label><label class="filter-label">Технологии через запятую<input name="technologies" maxlength="3200" value="${esc(values.technologies)}"></label><label class="filter-label">Интересы / отрасли через запятую<input name="interests" maxlength="3200" value="${esc(values.interests)}"></label>${preview?`<section class="import-preview"><h3>Проверьте результат импорта</h3><p>${esc(preview.warning)}</p>${preview.notices.map(n=>`<p class="field-help">${esc(n)}</p>`).join('')}<h4>Достижения и проекты</h4>${preview.achievements.map((a,i)=>`<label class="achievement-choice"><input type="checkbox" name="achievement-${i}" checked><span>${esc(a.text)}</span></label>`).join('')||'<p>Достижения не найдены — их не придумываем.</p>'}<details><summary>Источники предложенных навыков</summary>${preview.evidence.map(e=>`<p><strong>${esc(e.name)}</strong> — «${esc(e.evidence)}» · ${esc(preview.sources.find(s=>s.id===e.sourceId)?.label)}</p>`).join('')}</details><label class="achievement-choice"><input type="checkbox" name="acceptImport" required><span>Проверил(а) навыки и выбранные достижения; разрешаю показать их в профиле</span></label></section>`:''}<button class="btn btn-primary" type="submit">Сохранить и обновить рекомендации</button></form>`:`${tags(team.skills)}${tags(team.technologies)}<p>${esc(team.interests.join(' · '))}</p>`}${p.achievements?.length?`<h3 class="spaced">Подтверждённые участником достижения</h3>${p.achievements.map(a=>`<article class="achievement"><p>${esc(a.text)}</p>${a.url?`<a class="text-link" href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source)} ${icon('external')}</a>`:`<small>${esc(a.source)}</small>`}</article>`).join('')}`:''}${own&&(p.confirmedAt||preview)?`<button class="text-link spaced" data-action="clear-profile-import" data-id="${team.id}">Удалить импортированные сведения</button>`:''}</section>${own?`<aside><section class="panel innovation-panel"><span class="round-icon">${icon('spark')}</span><h2>Собрать профиль с помощником</h2><form id="profile-import-form" data-team-id="${team.id}"><label class="filter-label">GitHub<input name="github" maxlength="300" placeholder="https://github.com/username"></label><label class="filter-label">LinkedIn (ссылка на источник)<input name="linkedin" type="url" maxlength="500" placeholder="https://www.linkedin.com/in/username/"></label><label class="filter-label">Опыт, проекты и навыки из LinkedIn<textarea name="text" id="profile-source-text" rows="7" maxlength="20000" placeholder="Вставьте профессиональную часть профиля. Не добавляйте личные и чувствительные сведения."></textarea></label><label class="filter-label">Или загрузите текстовый экспорт<input id="profile-text-file" type="file" accept=".txt,.csv,.json"></label><p class="field-help">GitHub читается автоматически. Для LinkedIn нужен вставленный текст или TXT/CSV/JSON: закрытые страницы не обходятся. Из PDF скопируйте текст.</p><label class="achievement-choice"><input type="checkbox" name="consent" required><span>Это мой профиль. Разрешаю обработать профессиональные сведения; при подключённой модели они отправятся её провайдеру.</span></label><button class="btn btn-primary full-width" type="submit">Проанализировать профиль</button></form></section><div class="soft-card"><strong>Без выдуманных достижений</strong><p>Помощник предлагает сведения с источниками. Сохранение требует вашего подтверждения.</p></div>${personalRecommendations()}</aside>`:''}</div>`;
}
function personalRecommendations(){
 const tasks=state.tasks.filter(t=>t.status==='published'&&t.match?.score>0).sort((a,b)=>b.match.score-a.match.score||b.score.total-a.score.total).slice(0,3);
 return `<section class="panel innovation-panel"><p class="eyebrow">ВАШ СЛЕДУЮЩИЙ ПРОЕКТ</p><h2>Подходящие задачи</h2>${tasks.length?tasks.map(t=>`<article class="achievement"><a class="text-link" href="#task/${t.id}">${esc(taskTitle(t))}</a><p><strong>${t.match.score}% совместимости</strong> · ${t.score.total}/100 готовности</p><p>${esc(t.match.reasons[0])}</p></article>`).join(''):'<p>Пока нет совпадений с согласованными требованиями. Дополните профиль или изучите весь каталог.</p>'}<a class="text-link" href="#catalog">Открыть весь каталог</a></section>`;
}
function demoPage(){return `${sectionHeading('DEMO · РЕПЕТИЦИЯ','Пять минут до понятной истории','От слабого запроса до команды, которая подходит по навыкам.')}<section class="panel innovation-panel"><ol class="demo-steps"><li><strong>0:00 — Идея</strong><p>Создайте учебную задачу о кофейне.</p></li><li><strong>0:40 — Десять полей</strong><p>Извлеките факты из описания. Заполните пропуски и подтвердите сведения.</p></li><li><strong>1:40 — Оценка</strong><p>Нажмите «Сохранить и оценить». Покажите процент и замечания к каждому полю.</p></li><li><strong>2:30 — Второй агент</strong><p>Завершите проверку карточки, ответьте на 3–5 вопросов, согласуйте навыки и опубликуйте задачу.</p></li><li><strong>3:20 — Студент</strong><p>Войдите в student@demo.local (Data Sprout). Совместите фильтры готовности и навыков, отправьте предложение.</p></li><li><strong>4:10 — Бизнес</strong><p>Сравните отклики, объясните совместимость, вручную выберите команду.</p></li></ol>${state.role==='business'?'<button class="btn btn-primary" data-action="demo-reset">Создать / сбросить учебный пример</button><p class="field-help">Сбрасывается только специальный учебный пример и отклики к нему. Остальные задачи сохраняются.</p>':'<p>Войдите в business@demo.local, чтобы создать учебный пример.</p>'}</section>`;}

// Enhanced controls run before legacy delegated handlers.
app.addEventListener('input',event=>{
 if(event.target.id==='discovery-search'){
  state.filters.query=event.target.value;
  document.querySelector('#catalog-results').innerHTML=catalogResults();
  document.querySelector('#facets').innerHTML=filterSidebar();
 }
 const form=event.target.closest('form');
 if(form?.id==='chat-form') state.chatDrafts[form.dataset.taskId]=Object.fromEntries(new FormData(form));
 if(form?.id==='profile-form') state.profileDraft[form.dataset.teamId]=Object.fromEntries(new FormData(form));
});
app.addEventListener('change',async event=>{
 const el=event.target;
 if(el.dataset.facet){
  const list=state.filters[el.dataset.facet];state.filters[el.dataset.facet]=el.checked?[...list,el.value]:list.filter(x=>x!==el.value);render();
 }
 if(el.dataset.filter){state.filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;render();}
 if(el.id==='profile-text-file'){
  const file=el.files[0];if(!file)return;
  if(file.size>80000){toast('Файл слишком большой: до 80 КБ и 20 000 символов.',true);el.value='';return;}
  try{const content=await file.text();if(content.length>20000)throw new Error('Текст должен быть не длиннее 20 000 символов.');document.querySelector('#profile-source-text').value=content;}
  catch(e){toast(e.message,true);}
 }
},true);
app.addEventListener('submit',event=>{
 const form=event.target;
 if(!['chat-form','skills-form','profile-form','profile-import-form'].includes(form.id))return;
 event.preventDefault();event.stopImmediatePropagation();
 const values=Object.fromEntries(new FormData(form)),id=form.dataset.taskId,teamId=form.dataset.teamId;
 run(event.submitter,async()=>{
  if(form.id==='chat-form'){
   state.chatDrafts[id]=values;
   const response=await api(`/api/tasks/${id}/chat`,'POST',{...values,revision:getTask(id).revision});
   upsertTask(response.task);delete state.chatDrafts[id];render();document.querySelector('#chat-message')?.focus();
  }
  if(form.id==='skills-form'){
   if(state.formCache[`edit-${id}`])throw new Error('Сначала сохраните изменения карточки выше.');
   const skills=[...form.querySelectorAll('[data-skill-name]:checked')].map(input=>({name:input.dataset.skillName,weight:Number(form.elements.namedItem(input.name.replace('skill-','weight-')).value)}));
   skills.push(...values.customSkills.split(',').map(v=>v.trim()).filter(Boolean).map(name=>({name,weight:1})));
   await api(`/api/tasks/${id}/skills`,'POST',{skills,workMode:values.workMode,deadline:values.deadline,revision:getTask(id).revision});
   await refresh();render();toast('Требования подтверждены. Совместимость пересчитана.');
  }
  if(form.id==='profile-import-form'){
   await api(`/api/teams/${teamId}/profile/import`,'POST',{...values,consent:values.consent==='on'});
   delete state.profileDraft[teamId];await refresh();render();toast('Импорт готов. Проверьте навыки и достижения перед сохранением.');
  }
  if(form.id==='profile-form'){
   const split=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
   const payload={description:values.description,university:values.university,education:values.education,experience:values.experience,availability:values.availability,studentStatus:values.studentStatus,memberCount:Number(values.memberCount),name:values.name,skills:split(values.skills),technologies:split(values.technologies),interests:split(values.interests),revision:getTeam(teamId).revision||1,
    acceptImport:values.acceptImport==='on',achievementIndexes:Object.keys(values).filter(k=>k.startsWith('achievement-')).map(k=>Number(k.split('-')[1]))};
   await api(`/api/teams/${teamId}/profile`,'PATCH',payload);delete state.profileDraft[teamId];await refresh();render();toast('Профиль сохранён. Подбор задач обновлён.');
  }
 });
},true);
const extraActions=new Set(['chat-start','chat-compose','back-chat','skills-suggest','review','review-resolve','focus-field','filters-clear','filter-remove','demo-reset','clear-profile-import']);
app.addEventListener('click',event=>{
 const button=event.target.closest('[data-action]');if(!button||!extraActions.has(button.dataset.action))return;
 event.preventDefault();event.stopImmediatePropagation();const {action,id}=button.dataset;
 run(button,async()=>{
  if(action==='filters-clear'){state.filters=freshFilters();render();return;}
  if(action==='filter-remove'){state.filters[button.dataset.key]=state.filters[button.dataset.key].filter(v=>v!==button.dataset.value);render();return;}
  if(action==='focus-field'){const field=document.querySelector(`#field-${button.dataset.field}`);field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus({preventScroll:true});return;}
  if(action==='demo-reset'){
   if(!confirm('Создать новый учебный пример? Предыдущий учебный пример и его отклики будут удалены. Остальные задачи сохранятся.'))return;
   const data=await api('/api/demo/reset','POST',{confirmed:true});await refresh();state.wizard[data.task.id]={step:2};go(`edit/${data.task.id}`);return;
  }
  if(action==='clear-profile-import'){
   const t=getTeam(id);
   await api(`/api/teams/${id}/profile`,'PATCH',{name:t.name,skills:t.skills,technologies:t.technologies,interests:t.interests,revision:t.revision||1,clearImport:true});
   delete state.profileDraft[id];await refresh();render();toast('Источники и достижения удалены. Навыки можно изменить в форме.');return;
  }
  if(state.formCache[`edit-${id}`])throw new Error('Сначала сохраните изменения карточки.');
  if(action==='back-chat'){state.wizard[id]={step:2};render();return;}
  const endpoint={'chat-start':'chat','chat-compose':'chat-compose','skills-suggest':'skills-suggest','review':'review','review-resolve':'review-resolve'}[action];
  const body={revision:getTask(id).revision};
  if(action==='chat-start')body.message='';
  if(action==='review-resolve'){body.issueId=button.dataset.issue;body.status=button.dataset.status;}
  const data=await api(`/api/tasks/${id}/${endpoint}`,'POST',body);upsertTask(data.task);await refresh();
  if(action==='chat-compose'){state.wizard[id]={step:3,ai:data.ai};delete state.formCache[`edit-${id}`];}
  render();
 });
},true);

app.addEventListener('input', event => {
  if (event.target.id === 'catalog-search') { state.query = event.target.value; document.querySelector('#catalog-results').innerHTML = catalogResults(); return; }
  if (event.target.dataset.field) { const checkbox = document.querySelector(`[data-confirm="${event.target.dataset.field}"]`); if (checkbox) checkbox.checked = false; }
  cacheForm(event.target.closest('form'));
});
app.addEventListener('change', async event => {
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
      try { const data = await api(`/api/tasks/${task.id}/chat`, 'POST', {revision:task.revision,message:''}); upsertTask(data.task); state.wizard[task.id].ai = data.ai; if (route()[1] === task.id) render(); }
      catch(error) { toast(`Черновик сохранён. ${error.message}`,true); }
    } else if (form.id === 'answers-form') {
      const data = await api(`/api/tasks/${form.dataset.taskId}/compose`, 'POST', {answers: values});
      upsertTask(data.task); state.wizard[data.task.id] = {step: 3,ai: data.ai}; delete state.formCache[`edit-${data.task.id}`]; render(); window.scrollTo({top:0,behavior:'smooth'}); toast('Карточка собрана. Проверьте и подтвердите сведения.');
    } else if (form.id === 'editor-form') {
      try {
        const data = await api(`/api/tasks/${form.dataset.taskId}`, 'PATCH', {...readEditor(form),revision:Number(form.dataset.revision)});
        upsertTask(data.task); delete state.formCache[`edit-${data.task.id}`]; delete state.conflicts[data.task.id]; await refresh(); render(); toast('Карточка сохранена. Рейтинг обновлён.');
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
    if (action === 'reset-filters') { state.filters=freshFilters(); state.query = ''; state.industry = ''; state.level = ''; render(); }
    if (action === 'questions') { const data = await api(`/api/tasks/${id}/questions`,'POST',{}); upsertTask(data.task); state.wizard[id] = {step:2,ai:data.ai}; render(); }
    if (action === 'publish') {
      if (!document.querySelector('#publish-confirm')?.checked) { document.querySelector('#publish-confirm')?.focus(); throw new Error('Подтвердите публикацию, отметив поле над кнопкой.'); }
      if (state.formCache[`edit-${id}`]) throw new Error('Сначала сохраните изменения карточки, затем опубликуйте задачу.');
      const data = await api(`/api/tasks/${id}/publish`,'POST',{revision:getTask(id).revision,confirmed:true});
      upsertTask(data.task); await refresh(); go(`task/${id}`); toast('Задача опубликована и доступна командам.');
    }
    if (action === 'decision') { const data = await api(`/api/proposals/${id}/decision`,'POST',{status:button.dataset.status}); upsertProposal(data.proposal); await refresh(); render(); toast(button.dataset.status === 'selected' ? 'Команда выбрана. Можно выбрать и другие команды.' : 'Предложение отклонено.'); }
    if (action === 'confirm-stage') { const data = await api(`/api/proposals/${id}/confirm-stage`,'POST',{}); upsertProposal(data.proposal); if (data.teams) state.teams = data.teams; render(); toast('Этап подтверждён. Команде начислено 10 баллов.'); }
  });
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); document.querySelector('#main-content')?.focus({preventScroll:true}); });
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); document.querySelector('#main-content')?.focus(); });

// Account-based workspace and compact talent review.
const DATASETS={'Общественное питание':'food','Логистика':'logistics','Образование':'education','Сельское хозяйство':'agriculture','Ритейл':'retail','Аналитика':'finance'};
const ownTask=task=>state.role==='business'&&(task.canEdit??task.ownerBusinessId===state.user?.id);
const teamStatus={students:'Студенческая команда',mixed:'Студенты и выпускники',graduates:'Выпускники',professionals:'Специалисты'};
function loginPage(){
 const accounts=state.accounts||[],chosen=state.loginChoice||accounts.find(a=>a.id==='b1')?.email||'';
 return `<main id="main-content" class="login-page"><section class="login-story"><a class="brand" href="#catalog"><span class="brand-mark">H<span>·</span></span><span>HackAlem<small>AI SANA · WORKSPACE</small></span></a><p class="eyebrow">ТАЛАНТЫ × РЕАЛЬНЫЕ ЗАДАЧИ</p><h1>Идеи бизнеса.<br>Возможности<br><em>для вашей команды.</em></h1><p>Находите проекты по навыкам, обсуждайте задачи с AI и показывайте подтверждённый результат.</p><div class="login-numbers"><span><strong>40</strong>учебных кейсов</span><span><strong>15</strong>команд</span><span><strong>77</strong>демо-откликов</span></div><small>Синтетическое пространство для хакатона</small></section><section class="login-card"><p class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h2>Войдите в аккаунт</h2><p>Попробуйте путь бизнеса или студента. У каждого — свои задачи, профиль и переписка.</p><div class="demo-account-picks"><button data-demo-account="business@demo.local" class="${chosen==='business@demo.local'?'active':''}">${icon('briefcase')}<strong>Зерно</strong><small>Бизнес · задачи и команды</small></button><button data-demo-account="student@demo.local" class="${chosen==='student@demo.local'?'active':''}">${icon('users')}<strong>Data Sprout</strong><small>Студент · проекты и навыки</small></button></div><form id="login-form"><label class="filter-label">Демо-аккаунт<select name="email" id="login-email">${['business','student'].map(role=>`<optgroup label="${role==='business'?'Бизнес':'Студенты / команды'}">${accounts.filter(a=>a.role===role).map(a=>`<option value="${esc(a.email)}" ${chosen===a.email?'selected':''}>${esc(a.name)} · ${esc(a.email)}</option>`).join('')}</optgroup>`).join('')}</select></label><label class="filter-label">Пароль<input name="password" type="password" value="hackalem2026" required autocomplete="current-password"></label><button class="btn btn-primary full-width" type="submit">Войти в рабочее пространство ${icon('arrow')}</button></form><div class="login-demo-note">Пароль для всех демо-аккаунтов: <code>hackalem2026</code>. Аккаунты общие — используйте только учебные данные.</div>${state.error?`<p class="inline-warning">${esc(state.error)}</p><button class="btn btn-secondary" data-auth-retry>Повторить подключение</button>`:''}</section></main>`;
}
const originalShell=shell;
shell=function(content){return originalShell(content).replace(/<div class="role-controls">[\s\S]*?<\/div><\/header>/,`<div class="account-controls"><span class="avatar">${esc(state.user.name.slice(0,1))}</span><div><strong>${esc(state.user.name)}</strong><small>${state.role==='business'?'Бизнес':'Студент / команда'}</small></div><button class="btn btn-secondary btn-small" data-logout>Выйти</button></div></header>`);};
const originalBusinessPage=businessPage;
businessPage=function(){const html=originalBusinessPage();return html.replace(/<section class="proposals-section">[\s\S]*$/,'');};
const detailedProposal=proposalCard;
proposalCard=function(proposal,includeTask=false){
 const team=getTeam(proposal.teamId),task=getTask(proposal.taskId),match=task?.candidates?.find(c=>c.teamId===proposal.teamId)||task?.match;
 const legacy=detailedProposal(proposal,false);const body=legacy.slice(legacy.indexOf('<h4>'),legacy.lastIndexOf('</article>'));
 return `<details class="panel compact-proposal" id="proposal-${esc(proposal.id)}"><summary><span class="team-avatar">${esc(team?.name.slice(0,2))}</span><span class="applicant-identity"><strong>${esc(team?.name)}</strong><small>${esc(includeTask?taskTitle(task):team?.university||'Университет не указан')}</small><span class="applicant-preview">${esc(proposal.idea)}</span></span><span class="applicant-fit"><strong>${match?.score==null?'—':match.score+'%'}</strong><small>по навыкам</small></span><span class="pill proposal-${esc(proposal.status)}">${esc(STATUS[proposal.status])}</span><span class="disclosure-arrow">⌄</span></summary><div class="applicant-body"><div class="applicant-profile"><p>${esc(team?.description||'Описание ещё не добавлено.')}</p>${tags([...new Set([...(team?.skills||[]),...(team?.technologies||[])])])}${match?.reasons?.map(r=>`<p class="field-help">${esc(r)}</p>`).join('')||''}<a class="text-link" href="#profile/${esc(team.id)}">Полный профиль команды ${icon('arrow')}</a></div>${includeTask?`<a class="text-link" href="#task/${esc(task.id)}">${esc(taskTitle(task))}</a>`:''}${body}</div></details>`;
};
state.reviewTabs={};
function talentPanel(task){
 const props=state.proposals.filter(p=>p.taskId===task.id).sort((a,b)=>(task.candidates?.find(c=>c.teamId===b.teamId)?.score||0)-(task.candidates?.find(c=>c.teamId===a.teamId)?.score||0));
 const tab=state.reviewTabs[task.id]||'applications';
 const applied=new Set(props.map(p=>p.teamId));
 const candidates=(task.candidates||[]).filter(c=>!applied.has(c.teamId));
 return `<section class="talent-panel" aria-label="Команды для задачи"><header class="talent-header"><div><p class="eyebrow">КОМАНДЫ ДЛЯ ЭТОЙ ЗАДАЧИ</p><h2>Выберите, с кем работать</h2></div><div class="segmented" role="group" aria-label="Показать команды"><button data-review-tab="applications" data-task="${task.id}" class="${tab==='applications'?'active':''}" aria-pressed="${tab==='applications'}">Отклики · ${props.length}</button><button data-review-tab="recommendations" data-task="${task.id}" class="${tab==='recommendations'?'active':''}" aria-pressed="${tab==='recommendations'}">Подбор · ${candidates.length}</button></div></header><p class="field-help">По совместимости с требованиями. Раскройте команду, чтобы посмотреть план и принять решение.</p>${tab==='applications'?(props.length?props.map(p=>proposalCard(p)).join(''):emptyState('Откликов пока нет','Команды увидят опубликованную задачу в каталоге.')):candidates.map(m=>{const t=getTeam(m.teamId);return `<details class="panel compact-proposal"><summary><span class="team-avatar">${esc(t.name.slice(0,2))}</span><span class="applicant-identity"><strong>${esc(t.name)}</strong><small>${esc(t.university||'Университет не указан')}</small><span class="applicant-preview">${esc(t.skills.join(' · '))}</span></span><span class="applicant-fit"><strong>${m.score==null?'—':m.score+'%'}</strong><small>по навыкам</small></span><span class="pill soft">Ещё не откликнулись</span><span>⌄</span></summary><div class="applicant-body"><p>${esc(t.description||'')}</p>${m.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}<p class="field-help">${esc(m.summary)}</p><a href="#profile/${t.id}" class="btn btn-secondary btn-small">Профиль команды ${icon('arrow')}</a></div></details>`;}).join('')||'<p>Все команды уже откликнулись.</p>'}</section>`;
}
taskDetail=function(task){
 const owner=ownTask(task),props=state.proposals.filter(p=>p.taskId===task.id);
 return `<a href="#${owner?'business':'catalog'}" class="back-link">${icon('back')} ${owner?'К моим задачам':'К каталогу'}</a><header class="detail-heading"><div class="detail-eyebrow"><span class="industry">${esc(task.industry)}</span>${levelPill(task)}${task.synthetic?'<span class="pill soft">Демо</span>':''}</div><h1>${esc(taskTitle(task))}</h1><p>${esc(task.fields.need||task.fields.context||'Уточним задачу вместе с командой.')}</p></header><section class="panel task-overview"><div class="overview-facts"><span><strong>${task.score.total}/100</strong> готовность</span><span>${esc(WORK_MODES[task.workMode]||WORK_MODES.flexible)}</span><span>Срок: ${fmtDate(task.deadline)}</span>${owner?`<a class="btn btn-secondary btn-small" href="#edit/${task.id}">Редактировать ${icon('arrow')}</a>`:''}</div>${tags((task.requiredSkills||[]).filter(s=>s.confirmed).map(s=>s.name))}${task.synthetic&&DATASETS[task.industry]?`<a class="text-link dataset-link" href="/demo-data/${DATASETS[task.industry]}.csv" download>Скачать учебный CSV отрасли · 300 записей ${icon('file')}</a>`:''}<details class="brief-disclosure" ${owner?'':'open'}><summary>Описание и условия задачи</summary><div class="compact-brief">${Object.entries(FIELDS).filter(([k])=>!['title','need'].includes(k)).map(([k,label])=>`<section><h3>${esc(label)} ${task.confirmedFields.includes(k)?'<span class="verified">✓</span>':''}</h3><p>${esc(task.fields[k]||'Пока не указано')}</p></section>`).join('')}</div></details><details class="brief-disclosure"><summary>Из чего складывается готовность</summary>${scorePanel(task,true)}</details>${state.role==='student'?matchPanel(task.match):''}</section>${owner?talentPanel(task):state.role==='student'?`${props.length?`<section class="proposals-section"><h2>Ваши отклики</h2>${props.map(p=>proposalCard(p)).join('')}</section>`:''}${task.status==='published'?`<details class="proposal-form-disclosure" ${props.length?'':'open'}><summary class="btn btn-primary">Предложить решение ${icon('plus')}</summary>${proposalForm(task)}</details>`:''}`:''}`;
};
const summaryFor=team=>team.aiSummary||{text:`${team.name}: ${[...new Set([...team.skills,...team.technologies])].slice(0,6).join(', ')}. ${team.experience||'Опыт пока не описан.'}`,mode:'local',label:'Сводка по данным профиля'};
function teamSummary(team){const summary=summaryFor(team);return `<section class="team-ai-summary"><span class="summary-spark">✦</span><div><strong>${summary.mode==='remote'?'AI-саммари':'Ассистент · сводка профиля'}</strong><p>${esc(summary.text)}</p><small>${summary.mode==='remote'?'Сформировано моделью по сведениям команды; проверьте факты.':'Собрано по правилам из навыков и опыта команды.'}</small></div></section>`;}
function profileFacts(team){return `<dl class="profile-facts"><div><dt>Состав</dt><dd>${esc(teamStatus[team.studentStatus]||'Не указан')} · ${team.memberCount||'—'} чел.</dd></div><div><dt>Университет</dt><dd>${esc(team.university||'Не указан')}</dd></div><div><dt>Обучение</dt><dd>${esc(team.education||'Не указано')}</dd></div><div><dt>Доступность</dt><dd>${esc(team.availability||'Обсудим с бизнесом')}</dd></div></dl>`;}
teamsPage=function(){return `${sectionHeading('TALENT · КОМАНДЫ','Люди, которые превращают идеи в проекты','Узнайте команду: её опыт, навыки и подход к работе.')}<div class="team-grid rich-team-grid">${state.teams.map((t,i)=>`<article class="panel rich-team-card"><div class="team-profile-top"><span class="team-avatar color-${i%3}">${esc(t.name.slice(0,2))}</span><span class="pill soft">${t.memberCount||'—'} участника</span></div><h2><a href="#profile/${t.id}">${esc(t.name)}</a></h2><p class="team-university">${esc(t.university||'Университет не указан')}</p><p class="team-description">${esc(t.description||'Команда ещё не добавила описание.')}</p>${tags([...new Set([...t.skills,...t.technologies])].slice(0,5))}<footer><span>${t.points} баллов за этапы</span><a href="#profile/${t.id}" class="text-link">Профиль ${icon('arrow')}</a></footer></article>`).join('')}</div>`;};
const existingProfilePage=profilePage;
profilePage=function(id){
 const team=getTeam(id||state.teamId);if(!team)return missingPage();const own=state.role==='student'&&team.id===state.teamId;
 if(own){
  let html=existingProfilePage(id);const cached=state.profileDraft[team.id]||{};const val=k=>cached[k]??team[k]??'';
  const controls=`${teamSummary(team)}<button class="text-link summary-refresh" type="button" data-profile-summary="${team.id}">✦ Обновить AI-саммари сохранённого профиля</button><label class="filter-label">Описание команды своими словами<textarea name="description" maxlength="3000" rows="4" placeholder="Кто вы, как работаете и что хотите создавать">${esc(val('description'))}</textarea></label><div class="form-row"><label class="filter-label">Состав<select name="studentStatus">${Object.entries(teamStatus).map(([v,l])=>`<option value="${v}" ${(val('studentStatus')||'students')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="filter-label">Участников<input type="number" name="memberCount" min="1" max="30" value="${esc(val('memberCount')||1)}"></label></div><label class="filter-label">Университет<input name="university" maxlength="200" value="${esc(val('university'))}"></label><label class="filter-label">Образование и курс<input name="education" maxlength="200" value="${esc(val('education'))}"></label><label class="filter-label">Опыт и проекты<textarea name="experience" maxlength="2000" rows="3">${esc(val('experience'))}</textarea></label><label class="filter-label">Доступность<input name="availability" maxlength="200" value="${esc(val('availability'))}" placeholder="Например, 12 часов в неделю"></label>`;
  return html.replace('<label class="filter-label">Навыки через запятую',controls+'<label class="filter-label">Навыки через запятую');
 }
 return `<a class="back-link" href="#teams">${icon('back')} Все команды</a><section class="panel profile-cover"><span class="team-avatar">${esc(team.name.slice(0,2))}</span><div><p class="eyebrow">${esc(teamStatus[team.studentStatus]||'КОМАНДА')}</p><h1>${esc(team.name)}</h1><p>${esc(team.interests.join(' · '))}</p></div><span class="team-points">${team.points}<small>баллов за этапы</small></span></section><div class="public-profile-layout"><div><section class="panel innovation-panel"><h2>Описание команды</h2><p class="preserve-text">${esc(team.description||'Команда ещё не добавила описание.')}</p><small class="subtle">Описание написано командой${team.synthetic?' · синтетический демо-профиль':''}</small>${teamSummary(team)}<h2 class="spaced">Опыт и проекты</h2><p class="preserve-text">${esc(team.experience||'Пока не указаны.')}</p>${(team.profile?.achievements||[]).map(a=>`<article class="achievement"><p>${esc(a.text)}</p><small>${esc(a.source)}</small>${a.url?`<a class="text-link" href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer"> Источник ${icon('external')}</a>`:''}</article>`).join('')}</section></div><aside><section class="panel innovation-panel"><h2>О команде</h2>${profileFacts(team)}<h2 class="spaced">Навыки и технологии</h2>${tags([...new Set([...team.skills,...team.technologies])])}<p class="field-help">Совместимость рассчитывается отдельно для каждой задачи по навыкам. Университет и состав команды на оценку не влияют.</p></section></aside></div>`;
};
app.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.hasAttribute('data-demo-account')){event.stopImmediatePropagation();state.loginChoice=button.dataset.demoAccount;render();}
 if(button.hasAttribute('data-auth-retry')){event.stopImmediatePropagation();run(button,async()=>{await loadAuth();render();});}
 if(button.hasAttribute('data-logout')){event.stopImmediatePropagation();run(button,async()=>{await api('/api/auth/logout','POST',{});state.user=null;state.initialized=false;state.tasks=[];state.teams=[];state.proposals=[];state.formCache={};state.profileDraft={};state.chatDrafts={};state.wizard={};state.filters=freshFilters();remember('hackalem-description','');await loadAuth();render();});}
 if(button.dataset.reviewTab){event.stopImmediatePropagation();state.reviewTabs[button.dataset.task]=button.dataset.reviewTab;render();}
 if(button.dataset.profileSummary){event.stopImmediatePropagation();run(button,async()=>{if(state.profileDraft[button.dataset.profileSummary])throw new Error('Сначала сохраните изменения профиля.');await api(`/api/teams/${button.dataset.profileSummary}/summary`,'POST',{});await refresh();render();});}
},true);
app.addEventListener('submit',event=>{
 if(event.target.id!=='login-form')return;event.preventDefault();event.stopImmediatePropagation();
 const values=Object.fromEntries(new FormData(event.target));
 run(event.submitter,async()=>{const result=await api('/api/auth/login','POST',values);state.user=result.user;state.role=result.user.role;state.teamId=result.user.teamId;state.filters=freshFilters();await refresh();go(state.role==='business'?'business':'catalog');render();});
},true);
async function loadAuth(){const data=await api('/api/auth');state.accounts=data.accounts;state.user=data.user;state.error=null;if(state.user){state.role=state.user.role;state.teamId=state.user.teamId;await refresh();}}
const assistantWidget=createAssistant({api,getState:()=>state});
const briefWorkflow=createBriefWorkflow({state,app,api,esc,icon,safeUrl,render,run,toast,getTask,upsertTask,refresh,go,route,stored,remember,sectionHeading,ownTask,missingPage,deniedPage});
createPage=briefWorkflow.createPage;
editPage=briefWorkflow.editPage;

try { await loadAuth(); render(); } catch(error) { state.error = error.message; render(); }
