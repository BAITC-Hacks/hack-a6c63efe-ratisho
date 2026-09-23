// Guided two-agent brief workflow. Server owns stages, revisions and verification.
const LABELS={title:'Название задачи',context:'Контекст',need:'Проблема бизнеса',users:'Пользователи',data:'Данные и материалы',constraints:'Ограничения',outcome:'Ожидаемый результат',success:'Критерии успеха',contact:'Контактное лицо',interaction:'Формат взаимодействия'};
const HINTS={title:'Как можно назвать задачу одним предложением?',context:'Чем занимается компания и в какой ситуации возникает проблема?',need:'Что именно вызывает трудности, потери или неудобства?',users:'Кто будет пользоваться результатом: сотрудники, клиенты или партнёры?',data:'Какие данные, документы или файлы можно предоставить и в каком формате?',constraints:'Есть ли ограничения по срокам, бюджету, технологиям или конфиденциальности?',outcome:'Какой конкретный результат необходимо получить?',success:'По каким измеримым признакам будет понятно, что решение работает?',contact:'С кем команда сможет уточнять детали и согласовывать результат?',interaction:'Как часто возможны встречи и в каком формате будет проходить общение?'};
export function createBriefWorkflow({state,app,api,esc,icon,safeUrl,render,run,toast,getTask,upsertTask,refresh,go,route,stored,remember,sectionHeading,ownTask,missingPage,deniedPage}){
 const cache=()=>state.formCache;
 const modeLabel=mode=>mode==='remote'?'AI-модель':'По правилам';
 const steps=stage=>`<ol class="brief-steps" aria-label="Этапы карточки">${['Описание','10 полей','Уточнения','Состав команды'].map((s,i)=>`<li class="${i+1===stage?'current':i+1<stage?'complete':''}"><span>${i+1}</span>${s}</li>`).join('')}</ol>`;
 const notice=text=>text?`<p class="brief-notice">${esc(text)}</p>`:'';
 function createPage(){
  if(state.role!=='business')return deniedPage();const saved=cache().create||{draft:stored('hackalem-description',''),industry:''};
  return `${sectionHeading('AI STUDIO · ДВА АГЕНТА','Один рассказ — понятная задача','Опишите ситуацию. Первый агент разложит факты по полям, второй изучит компанию.')} ${steps(1)}<div class="brief-create"><section class="panel brief-panel"><form id="brief-create-form"><label class="brief-label" for="brief-description">Расскажите о задаче своими словами</label><textarea id="brief-description" name="draft" rows="12" maxlength="12000" required placeholder="Чем занимается компания? Что хотите изменить? Какие данные, сроки и ожидания уже известны?">${esc(saved.draft)}</textarea><p class="field-help">Укажите название компании и официальный сайт в описании, чтобы агент мог найти публичные источники. Неизвестное можно оставить незаполненным.</p><label class="brief-label" for="brief-industry">Тематика</label><select id="brief-industry" name="industry" required><option value="">Выберите тематику</option>${(state.meta.industries||[]).map(v=>`<option ${saved.industry===v?'selected':''}>${esc(v)}</option>`).join('')}</select><div class="brief-actions"><span>Все факты проверяете вы</span><button class="btn btn-primary" type="submit">Разобрать описание ${icon('arrow')}</button></div></form></section><aside class="brief-how"><p class="eyebrow">КАК ЭТО РАБОТАЕТ</p><h2>Два агента.<br>Окончательное слово — ваше.</h2><article><span>01</span><div><strong>Структура и качество</strong><p>Только сведения из вашего текста. Исправьте 10 полей и получите оценку каждого.</p></div></article><article><span>02</span><div><strong>Контекст и специалисты</strong><p>После проверки карточки — 3–5 уточнений, направления и навыки команды.</p></div></article><p class="brief-notice">Первый агент не задаёт вопросов. Подсказки рядом с полями помогают заполнить их самостоятельно.</p></aside></div>`;
 }
 function researchPanel(task){
  const r=task.companyResearch||{};const running=r.status==='running',stalled=running&&Date.now()-Date.parse(r.startedAt)>120000;
  return `<section class="panel brief-panel brief-research"><div class="brief-panel-heading"><div><p class="eyebrow">АГЕНТ 02 · КОМПАНИЯ</p><h3>${running?'Изучает публичные источники':r.status==='complete'?'Найден публичный контекст':'Контекст компании'}</h3></div>${running?'<span class="spinner"></span>':icon('search')}</div>${r.summary?`<p class="research-text">${esc(r.summary.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1'))}</p><div class="research-sources">${r.sources.map(s=>`<a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${esc(s.title)}</a>`).join('')}</div>`:`<p class="subtle">${running?'Поиск идёт параллельно. Можно уже редактировать поля.':'Сведения из интернета не подменяют ответы бизнеса.'}</p>`}${notice(r.warning)}${!r.status||stalled?`<button type="button" class="btn btn-secondary btn-small" data-brief="research" data-id="${task.id}">Найти информацию о компании</button>`:''}</section>`;
 }
 function assessmentPanel(task){
  const a=task.briefAssessment,dirty=!!cache()[`brief-${task.id}`];
  return `<section class="panel brief-panel brief-quality"><p class="eyebrow">АГЕНТ 01 · ОЦЕНКА</p><div class="brief-percent">${a?a.percent:'—'}<small>${a?'%':' '}</small></div><h3>Качество описания</h3><p class="subtle">${a?'Заполненность, соответствие полям, конкретность и противоречия.':'Сохраните поля и запустите проверку, чтобы увидеть оценку.'}</p>${a?`<div class="brief-progress"><span style="width:${a.percent}%"></span></div><p class="field-help">${a.fields.filter(f=>f.filled).length} из 10 полей заполнены · ${modeLabel(a.mode)}</p>${dirty?notice('В форме есть изменения. Оценка относится к последней сохранённой версии.'):''}${a.contradictions.map(c=>`<div class="brief-issue"><strong>Возможное противоречие</strong><p>${esc(c.explanation)}</p><small>${c.fields.map(k=>esc(LABELS[k])).join(' · ')}</small></div>`).join('')}${notice(a.warning)}<details><summary>Как считается процент</summary><p class="field-help">${a.fields.map(r=>`${esc(LABELS[r.field])}: ${r.earned}/${r.weight}${r.weight===0?' (проверяется отдельно)':''}`).join('<br>')}</p></details>`:''}<div class="brief-rating"><strong>${task.score.total}/100</strong><span>Рейтинг подтверждённых сведений в каталоге</span></div></section>`;
 }
 function fieldsPanel(task){
  const saved=cache()[`brief-${task.id}`],fields=saved?.fields||task.fields,confirmed=saved?.confirmedFields||task.confirmedFields,assessment=task.briefAssessment;
  return `<section class="panel brief-panel"><div class="brief-panel-heading"><div><p class="eyebrow">АГЕНТ 01 · СТРУКТУРА</p><h2>Проверьте 10 полей</h2><p class="subtle">Исправьте формулировки и самостоятельно заполните пропуски.</p></div><span class="pill soft">${Object.values(fields).filter(v=>v.trim()).length} / 10</span></div>${!Object.values(task.fields).some(Boolean)&&!task.briefExtraction?`<button class="btn btn-secondary" data-brief="extract" data-id="${task.id}">Извлечь факты из описания</button>`:''}${notice(task.briefExtraction?.warning)}<form id="brief-fields-form" data-task-id="${task.id}" data-revision="${saved?.revision||task.revision}"><label class="brief-label" for="edit-brief-industry">Тематика</label><select id="edit-brief-industry" name="industry">${state.meta.industries.map(v=>`<option ${(saved?.industry||task.industry)===v?'selected':''}>${esc(v)}</option>`).join('')}</select><div class="brief-fields">${Object.entries(LABELS).map(([key,label],i)=>{
   const feedback=assessment?.fields.find(f=>f.field===key);return `<div class="brief-field"><div class="brief-field-heading"><label for="brief-${key}"><span>${String(i+1).padStart(2,'0')}</span>${label}</label>${feedback?`<span class="brief-status ${feedback.status}">${{good:'Конкретно',improve:'Уточнить',empty:'Нет сведений'}[feedback.status]}</span>`:''}</div><p class="field-help" id="hint-${key}">${HINTS[key]}</p><textarea id="brief-${key}" name="${key}" data-brief-field="${key}" rows="${key==='title'?2:3}" maxlength="${key==='title'?180:4000}" aria-describedby="hint-${key}" placeholder="Информация пока не указана">${esc(fields[key])}</textarea><div class="brief-field-bottom"><label><input type="checkbox" name="confirm-${key}" ${confirmed.includes(key)?'checked':''}> Сведения проверены</label>${task.briefExtraction?.evidence?.[key]?`<details><summary>Цитата из описания</summary><blockquote>${esc(task.briefExtraction.evidence[key])}</blockquote></details>`:''}</div>${feedback?`<div class="brief-feedback ${feedback.status}"><p>${esc(feedback.explanation)}</p>${feedback.improvement?`<p><strong>Как улучшить:</strong> ${esc(feedback.improvement)}</p>`:''}</div>`:''}</div>`;
  }).join('')}</div><div class="brief-actions"><button class="btn btn-secondary" type="submit" value="save">Сохранить</button><button class="btn btn-primary" type="submit" value="assess">Сохранить и оценить ${icon('spark')}</button></div></form></section>`;
 }
 function questionsPanel(task){
  const q=task.qualification;if(!q)return '';
  const answers=cache()[`qualification-${task.id}`]||q.answers;
  return `<section class="panel brief-panel" id="brief-questions"><div class="brief-panel-heading"><div><p class="eyebrow">АГЕНТ 02 · УТОЧНЕНИЯ</p><h2>${q.questions.length} ${q.questions.length===5?'вопросов':'вопроса'} для вашей задачи</h2><p class="subtle">Нужны для подбора направлений, специалистов и навыков.</p></div><span class="pill soft">${modeLabel(q.mode)}</span></div>${notice(q.warning)}<form id="qualification-form" data-task-id="${task.id}" data-set-id="${q.id}" data-revision="${task.revision}">${q.questions.map((question,i)=>`<div class="brief-question"><label for="qual-${question.id}"><span>${i+1}</span>${esc(question.question)}</label><p class="field-help"><strong>Зачем:</strong> ${esc(question.why)}</p><textarea id="qual-${question.id}" name="${question.id}" required rows="3" maxlength="3000" placeholder="Ваш ответ. Если пока неизвестно, так и напишите.">${esc(answers[question.id]||'')}</textarea><details><summary>Основание и проверка вопроса</summary>${question.evidence.map(e=>`<blockquote>${esc(e.quote)}</blockquote>`).join('')}<p class="field-help">Проверены: связь с задачей, отсутствие ответа в тексте, обоснованность, безопасность, цель и нейтральность. ${question.checkedBy==='rules'?'Проверка по правилам.':'Проверка моделью и правилами.'}</p></details></div>`).join('')}<div class="brief-actions"><span>Можно ответить «пока неизвестно»</span><button class="btn btn-primary" type="submit">${q.recommendations?'Обновить рекомендации':'Подобрать специалистов'} ${icon('arrow')}</button></div></form></section>`;
 }
 function recommendationsPanel(task){
  const r=task.qualification?.recommendations;if(!r)return '';
  const rows=[...r.requiredSkills.map(s=>({...s,category:'required',weight:3})),...r.optionalSkills.map(s=>({...s,category:'optional',weight:1}))];
  for(const skill of task.requiredSkills||[])if(!rows.some(s=>s.name===skill.name))rows.push({...skill,category:skill.category||'required'});
  return `<section class="panel brief-panel" id="brief-team"><p class="eyebrow">АГЕНТ 02 · КОМАНДА</p><h2>Предлагаемый состав</h2><p class="subtle">Вы определяете окончательные требования. Подтвердите нужные навыки или добавьте свои.</p>${notice(r.warning)}<div class="brief-recommendations">${[['directions','IT-направления'],['specialists','Специалисты']].map(([key,label])=>`<div><h3>${label}</h3>${r[key].map(s=>`<article><strong>${esc(s.name)}</strong><p>${esc(s.reason)}</p><details><summary>На чём основано</summary>${s.evidence.map(e=>`<blockquote>${esc(e.quote)}</blockquote>`).join('')}</details></article>`).join('')}</div>`).join('')}</div><form id="brief-skills-form" data-task-id="${task.id}" data-revision="${task.revision}">${[['required','Обязательные навыки'],['optional','Дополнительные навыки']].map(([category,label])=>`<h3 class="spaced">${label}</h3>${rows.filter(s=>s.category===category).map(s=>{const i=rows.indexOf(s);return `<label class="brief-skill"><input type="checkbox" name="skill-${i}" data-name="${esc(s.name)}" data-category="${category}" data-weight="${s.weight}" ${task.requiredSkills?.some(x=>x.confirmed&&x.name===s.name)?'checked':''}><span><strong>${esc(s.name)}</strong><small>${esc(s.reason)}</small></span></label>`;}).join('')||'<p class="subtle">Не предложены.</p>'}`).join('')}<label class="brief-label" for="brief-custom-skills">Добавить обязательные навыки через запятую</label><input id="brief-custom-skills" name="customSkills" maxlength="1500" placeholder="Например, pandas, Power BI"><div class="brief-row"><label class="brief-label">Формат работы<select name="workMode">${Object.entries({flexible:'По договорённости',remote:'Удалённо',onsite:'Очно',hybrid:'Гибрид'}).map(([v,l])=>`<option value="${v}" ${task.workMode===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="brief-label">Срок, если согласован<input type="date" name="deadline" value="${esc(task.deadline||'')}"></label></div><div class="brief-actions"><span>${task.requirementsConfirmed?'✓ Требования согласованы бизнесом':'Навыки пока не согласованы'}</span><button class="btn btn-primary" type="submit">Подтвердить выбранные требования</button></div></form></section>`;
 }
 function editPage(id){
  const task=getTask(id);if(!task)return missingPage();if(!ownTask(task))return deniedPage();
  const stage=task.qualification?.recommendations?4:task.qualification?3:2;
  if(task.companyResearch?.status==='running')scheduleResearch(id);
  const ready=task.briefAssessment&&!cache()[`brief-${id}`];
  return `${sectionHeading('AI STUDIO · КОНСТРУКТОР',task.fields.title||'Соберите понятную карточку','Сначала проверка фактов. Затем — технические уточнения и согласование команды.')} ${steps(stage)}<div class="brief-layout"><div class="brief-main"><details class="panel brief-original"><summary>Исходное описание</summary><p>${esc(task.draft)}</p></details>${fieldsPanel(task)}<section class="panel brief-panel brief-next"><div><h3>Все поля просмотрены?</h3><p>Можно продолжить с пропусками. Второй агент уточнит технические детали только после вашего подтверждения.</p></div><button class="btn btn-primary" data-brief="finish" data-id="${id}" ${!ready||task.companyResearch?.status==='running'?'disabled':''}>${task.qualification?'Пересоздать вопросы':'Карточка проверена — получить вопросы'}</button>${!ready?'<p class="field-help">Сначала сохраните и оцените текущую версию полей.</p>':''}</section>${questionsPanel(task)}${recommendationsPanel(task)}${task.qualification?.recommendations?`<section class="panel brief-panel brief-publish"><h3>${task.status==='published'?'Карточка опубликована':'Показать задачу командам'}</h3><p>Проверьте все сведения перед публикацией. AI-предложения становятся требованиями после вашего подтверждения.</p>${task.status==='published'?`<a href="#task/${id}" class="btn btn-secondary">Открыть карточку</a>`:`<label class="brief-skill"><input id="brief-publish-confirm" type="checkbox"><span>Я проверил(а) содержание и подтверждаю публикацию</span></label><button class="btn btn-primary" data-brief="publish" data-id="${id}" ${!task.requirementsConfirmed?'disabled':''}>Опубликовать задачу</button>`}</section>`:''}</div><aside class="brief-sidebar">${assessmentPanel(task)}<div id="brief-research-panel">${researchPanel(task)}</div></aside></div>`;
 }
 const researchTimers=new Map();
 function scheduleResearch(id){
  if(researchTimers.has(id))return;
  const owner=state.user?.id;
  researchTimers.set(id,setTimeout(async()=>{
   researchTimers.delete(id);if(state.user?.id!==owner||route()[0]!=='edit'||route()[1]!==id)return;
   try{const data=await api('/api/bootstrap');if(state.user?.id!==owner)return;const latest=data.tasks.find(t=>t.id===id);if(!latest)return;
    const current=getTask(id);if(!current)return;current.companyResearch=latest.companyResearch;
    const target=document.querySelector('#brief-research-panel');if(target)target.innerHTML=researchPanel(current);
    const finish=document.querySelector('[data-brief="finish"]');if(finish)finish.disabled=!current.briefAssessment||!!cache()[`brief-${id}`]||latest.companyResearch?.status==='running';
    if(latest.companyResearch?.status==='running')scheduleResearch(id);
   }catch{scheduleResearch(id);}
  },3000));
 }
 function readFields(form){return {fields:Object.fromEntries(Object.keys(LABELS).map(k=>[k,form.elements.namedItem(k).value])),confirmedFields:Object.keys(LABELS).filter(k=>form.elements.namedItem('confirm-'+k).checked),industry:form.elements.namedItem('industry').value,revision:Number(form.dataset.revision)};}
 async function mutate(id,endpoint,body={}){const data=await api(`/api/tasks/${id}/${endpoint}`,'POST',{revision:getTask(id).revision,...body});upsertTask(data.task);return data.task;}
 function noPendingEdits(id){if(cache()[`brief-${id}`])throw new Error('Сначала сохраните и оцените изменения в десяти полях.');}
 for(const name of ['input','change'])app.addEventListener(name,event=>{
  const form=event.target.closest('form');if(!form)return;const id=form.dataset.taskId;
  if(form.id==='brief-create-form'){cache().create=Object.fromEntries(new FormData(form));remember('hackalem-description',cache().create.draft);}
  if(form.id==='brief-fields-form'){
   if(event.target.dataset.briefField)form.elements.namedItem('confirm-'+event.target.dataset.briefField).checked=false;
   cache()[`brief-${id}`]=readFields(form);document.querySelector('[data-brief="finish"]')?.setAttribute('disabled','');
  }
  if(form.id==='qualification-form')cache()[`qualification-${id}`]=Object.fromEntries(new FormData(form));
 });
 app.addEventListener('submit',event=>{
  const form=event.target;if(!['brief-create-form','brief-fields-form','qualification-form','brief-skills-form'].includes(form.id))return;
  event.preventDefault();event.stopImmediatePropagation();if(!form.reportValidity())return;
  const button=event.submitter,action=button?.value,id=form.dataset.taskId;
  run(button,async()=>{
   if(form.id==='brief-create-form'){
    const {task}=await api('/api/tasks','POST',Object.fromEntries(new FormData(form)));upsertTask(task);delete cache().create;remember('hackalem-description','');go(`edit/${task.id}`);
    // Start the independent company job before awaiting field extraction.
    const research=api(`/api/tasks/${task.id}/company-research`,'POST',{}).then(data=>{const t=getTask(task.id);if(t)t.companyResearch=data.task.companyResearch;scheduleResearch(task.id);}).catch(()=>{});
    try{await mutate(task.id,'brief-extract');}finally{await research;render();}
   }else if(form.id==='brief-fields-form'){
    cache()[`brief-${id}`]=readFields(form);
    const data=await api(`/api/tasks/${id}`,'PATCH',cache()[`brief-${id}`]);upsertTask(data.task);delete cache()[`brief-${id}`];
    try{if(action==='assess')await mutate(id,'brief-assess');}finally{render();}toast(action==='assess'?'Оценка готова — замечания показаны рядом с каждым полем.':'Изменения сохранены.');
   }else if(form.id==='qualification-form'){
    noPendingEdits(id);cache()[`qualification-${id}`]=Object.fromEntries(new FormData(form));
    await mutate(id,'qualification-answers',{revision:Number(form.dataset.revision),questionSetId:form.dataset.setId,answers:cache()[`qualification-${id}`]});delete cache()[`qualification-${id}`];render();document.querySelector('#brief-team')?.scrollIntoView({behavior:'smooth'});
   }else{
    noPendingEdits(id);const values=Object.fromEntries(new FormData(form));
    const skills=[...form.querySelectorAll('[data-name]:checked')].map(el=>({name:el.dataset.name,category:el.dataset.category,weight:Number(el.dataset.weight)}));
    skills.push(...values.customSkills.split(',').map(v=>v.trim()).filter(Boolean).map(name=>({name,category:'required',weight:3})));
    await mutate(id,'skills',{revision:Number(form.dataset.revision),skills,workMode:values.workMode,deadline:values.deadline});render();document.querySelector('.brief-publish')?.scrollIntoView({behavior:'smooth'});toast('Требования согласованы. Подбор команд обновлён.');
   }
  });
 },true);
 app.addEventListener('click',event=>{
  const button=event.target.closest('[data-brief]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();
  const id=button.dataset.id,action=button.dataset.brief;
  run(button,async()=>{
   if(action==='research'){const data=await api(`/api/tasks/${id}/company-research`,'POST',{});getTask(id).companyResearch=data.task.companyResearch;render();}
   if(action==='extract'){noPendingEdits(id);await mutate(id,'brief-extract');render();}
   if(action==='finish'){noPendingEdits(id);await mutate(id,'brief-finish',{confirmed:true});delete cache()[`qualification-${id}`];render();document.querySelector('#brief-questions')?.scrollIntoView({behavior:'smooth'});}
   if(action==='publish'){
    noPendingEdits(id);if(!document.querySelector('#brief-publish-confirm')?.checked)throw new Error('Подтвердите публикацию карточки.');
    await mutate(id,'publish',{confirmed:true});await refresh();go(`task/${id}`);toast('Задача опубликована.');
   }
  });
 },true);
 return {createPage,editPage};
}
