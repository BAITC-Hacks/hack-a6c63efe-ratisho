const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readData = file => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Не удалось прочитать файл.'));r.readAsDataURL(file);});
const waitMedia = (media,event,action) => new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Браузер не смог открыть медиа. Попробуйте другой формат.')),12000);const done=e=>{clearTimeout(timer);media.removeEventListener(event,ok);media.removeEventListener('error',bad);e?reject(e):resolve();};const ok=()=>done(),bad=()=>done(new Error('Не удалось прочитать медиа.'));media.addEventListener(event,ok,{once:true});media.addEventListener('error',bad,{once:true});action();});
function frame(media){const width=media.videoWidth||media.naturalWidth,height=media.videoHeight||media.naturalHeight;if(!width||!height)throw new Error('Пустое изображение.');const scale=Math.min(1,1000/Math.max(width,height));const c=document.createElement('canvas');c.width=Math.round(width*scale);c.height=Math.round(height*scale);c.getContext('2d').drawImage(media,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.76);}
export async function packAttachments(files){
 if(files.length>3)throw new Error('Выберите до 3 вложений.');
 const result=[];
 for(const file of files){
  const name=file.name.slice(0,160),url=URL.createObjectURL(file);
  try{
   if(file.type.startsWith('image/')){
    if(file.size>8*1024*1024)throw new Error('Фото: до 8 МБ.');
    const media=new Image();await waitMedia(media,'load',()=>{media.src=url;});result.push({kind:'image',name,data:frame(media)});
   }else if(file.type.startsWith('video/')){
    if(file.size>40*1024*1024)throw new Error('Видео: до 40 МБ.');
    const v=document.createElement('video');v.muted=true;v.preload='auto';v.playsInline=true;
    await waitMedia(v,'loadeddata',()=>{v.src=url;v.load();});
    try{
     if(!Number.isFinite(v.duration)||v.duration>120||v.duration<=0)throw new Error('Видео: до 2 минут.');
     const frames=[];
     for(let i=0;i<6;i++){const time=Math.min(v.duration-0.01,v.duration*(i+0.5)/6);await waitMedia(v,'seeked',()=>{v.currentTime=Math.max(0,time);});frames.push(frame(v));}
     result.push({kind:'video',name,duration:v.duration,frames});
    }finally{v.removeAttribute('src');v.load();}
   }else if(file.type.startsWith('audio/')||/\.(mp3|m4a|wav|ogg|webm|flac)$/i.test(file.name)){
    if(file.size>5*1024*1024)throw new Error('Аудио: до 5 МБ.');
    let mime=file.type||({'mp3':'audio/mpeg','m4a':'audio/mp4','wav':'audio/wav','ogg':'audio/ogg','webm':'audio/webm','flac':'audio/flac'}[file.name.split('.').pop().toLowerCase()]);
    result.push({kind:'audio',name,mime,data:(await readData(file)).split(',')[1]});
   }else throw new Error('Выберите фото, видео или аудио.');
  }finally{URL.revokeObjectURL(url);}
 }
 return result;
}
export function createAssistant({api,getState,applyCatalogCommand}){
 const host=document.createElement('div');host.id='assistant-root';document.body.append(host);
 let open=false,busy=false,messages=[],revision=0,draft='',files=[],userId=null,error='',request=0;
 const account=()=>getState().user;
 const body=()=>`${!account()?'<p class="assistant-empty">Войдите в демо-аккаунт, чтобы начать диалог. Переписка сохранится в этом аккаунте.</p>':messages.length?messages.map(m=>`<article class="chat-message ${m.role}"><span>${m.role==='user'?'Вы':m.mode==='remote'?'AI-ассистент':'Локальная справка'}</span><p>${escape(m.content)}</p>${(m.attachments||[]).map(a=>`<small class="attachment-result">${escape(a.name)} · ${escape(a.status)}${a.transcript?`<details><summary>Расшифровка</summary><p>${escape(a.transcript)}</p></details>`:''}</small>`).join('')}${m.warning?`<small class="assistant-warning">${escape(m.warning)}</small>`:''}</article>`).join(''):'<div class="assistant-empty"><strong>С чем помочь?</strong><p>Обсудим задачу, подберём проект или разберём ваш вопрос. Я вижу открытую карточку и помню нашу переписку.</p><div class="assistant-prompts"><button data-prompt="Объясни, как считается рейтинг и совместимость">Как считается рейтинг?</button><button data-prompt="Покажи задачи с готовностью 90+">Готовность 90+</button></div></div>'}`;
 function render(){
  host.innerHTML=`<button class="assistant-launcher" aria-label="Открыть AI-ассистента" aria-expanded="${open}"><span>✦</span> AI-ассистент</button>${open?`<section class="assistant-drawer" role="dialog" aria-label="AI-ассистент"><header><div><strong>✦ Ассистент HackAlem</strong><small>Помощь рядом · память диалога</small></div><button data-assistant="close" aria-label="Закрыть ассистента">×</button></header><div class="assistant-context">${escape(({catalog:'Каталог задач',task:'Карточка задачи',edit:'Конструктор задачи',profile:'Профиль',business:'Кабинет бизнеса'})[location.hash.slice(1).split('/')[0]]||'Рабочее пространство')}<button data-assistant="clear" ${busy||!account()?'disabled':''}>Новый диалог</button></div><div class="assistant-messages" role="log" aria-live="polite">${body()}${busy?'<p class="assistant-thinking"><span class="spinner"></span> Разбираю ваш вопрос…</p>':''}</div>${error?`<p class="assistant-error" role="alert">${escape(error)}</p>`:''}${account()?`<form id="assistant-form"><label class="sr-only" for="assistant-message">Ваш вопрос</label><textarea id="assistant-message" maxlength="4000" rows="3" placeholder="Ваш вопрос или комментарий к файлу…" ${busy?'disabled':''}>${escape(draft)}</textarea><div class="attachment-list">${files.map((f,i)=>`<span>${escape(f.name)} <button type="button" data-remove="${i}" aria-label="Убрать ${escape(f.name)}" ${busy?'disabled':''}>×</button></span>`).join('')}</div><div class="assistant-actions"><label class="btn btn-secondary btn-small attachment-button">+ Медиа<input type="file" id="assistant-files" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/*,.m4a,.mp3,.wav" multiple ${busy?'disabled':''}></label><button class="btn btn-primary btn-small" type="submit" ${busy?'disabled':''}>Отправить</button></div><details class="media-help"><summary>Фото, видео, аудио · условия</summary><p>Фото до 8 МБ. Видео до 40 МБ и 2 минут: анализ 6 кадров без звука. Аудио до 5 МБ: расшифровка речи. До 3 вложений, одного аудио и 8 кадров за раз.</p><p>При отправке медиа передаются подключённому AI-провайдеру. На сервере остаются переписка и расшифровки; сами файлы не сохраняются. В демо-аккаунты могут войти другие участники.</p></details></form>`:''}</section>`:''}`;
  const log=host.querySelector('.assistant-messages');if(log)log.scrollTop=log.scrollHeight;
 }
 async function load(){const current=++request;try{const data=await api('/api/assistant');if(current!==request)return;messages=data.messages;revision=data.revision;error='';}catch(e){error=e.message;}render();}
 host.addEventListener('input',e=>{if(e.target.id==='assistant-message')draft=e.target.value;});
 host.addEventListener('change',e=>{if(e.target.id==='assistant-files'){const next=[...files,...e.target.files];if(next.length>3)error='Можно прикрепить до 3 файлов.';else{files=next;error='';}render();}});
 host.addEventListener('click',async e=>{
  if(e.target.closest('.assistant-launcher')){open=!open;render();if(open&&account())await load();host.querySelector('#assistant-message')?.focus();return;}
  const action=e.target.closest('[data-assistant]')?.dataset.assistant;
  if(action==='close'){open=false;render();host.querySelector('.assistant-launcher').focus();}
  if(action==='clear'&&!busy&&confirm('Начать новый диалог? Текущая переписка этого демо-аккаунта будет удалена.')){try{const d=await api('/api/assistant/clear','POST',{});messages=d.messages;revision=d.revision;error='';render();}catch(e){error=e.message;render();}}
  const remove=e.target.closest('[data-remove]');if(remove&&!busy){files.splice(Number(remove.dataset.remove),1);render();}
  const prompt=e.target.closest('[data-prompt]');if(prompt){draft=prompt.dataset.prompt;render();host.querySelector('#assistant-message')?.focus();}
 });
 host.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){open=false;render();host.querySelector('.assistant-launcher').focus();}});
 host.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||(!draft.trim()&&!files.length))return;
  if(!files.length&&applyCatalogCommand){const answer=applyCatalogCommand(draft);if(answer){messages.push({role:'user',content:draft},{role:'assistant',content:answer,mode:'local'});draft='';render();return;}}
  const currentUser=account()?.id;busy=true;error='';render();
  try{
   const attachments=await packAttachments(files);const parts=location.hash.slice(1).split('/');
   const result=await api('/api/assistant','POST',{message:draft,attachments,revision,page:parts[0]||'catalog',taskId:['task','edit'].includes(parts[0])?parts[1]:null,teamId:parts[0]==='profile'?(parts[1]||account()?.teamId):null});
   if(currentUser===account()?.id){messages=result.messages;revision=result.revision;draft='';files=[];}
  }catch(e){error=e.message;}finally{busy=false;render();host.querySelector('#assistant-message')?.focus();}
 });
 return {sync(){if(userId!==account()?.id){userId=account()?.id;request++;open=false;messages=[];draft='';files=[];revision=0;error='';}render();}};
}
