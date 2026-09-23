export const freshFilters = () => ({industries:[], levels:[], skills:[], modes:[], from:'', to:'', minScore:0, minMatch:0, skillMode:'any', sort:'readiness', query:'', openDeadline:false});
export function matchesFilters(task, f, omit='') {
  if(task.status!=='published') return false;
  const includes=(key,value)=>omit===key||!f[key]?.length||f[key].includes(value);
  if(!includes('industries',task.industry)||!includes('levels',task.score.level)||!includes('modes',task.workMode||'flexible')) return false;
  if(omit!=='skills'&&f.skills.length) {
    const names=(task.requiredSkills||[]).filter(s=>s.confirmed).map(s=>s.name);
    if(!(f.skillMode==='all'?f.skills.every(s=>names.includes(s)):f.skills.some(s=>names.includes(s)))) return false;
  }
  const date=task.createdAt.slice(0,10);
  if(f.from&&date<f.from||f.to&&date>f.to||task.score.total<Number(f.minScore)) return false;
  if(Number(f.minMatch)>0&&(task.match?.score==null||task.match.score<Number(f.minMatch))) return false;
  if(f.openDeadline&&task.deadline&&task.deadline<new Date().toISOString().slice(0,10)) return false;
  return !f.query||[task.fields.title,task.draft,task.industry,task.fields.need].join(' ').toLocaleLowerCase('ru').includes(f.query.toLocaleLowerCase('ru'));
}
export function filterTasks(tasks,f) {
  return tasks.filter(t=>matchesFilters(t,f)).sort((a,b)=>
    (f.sort==='relevance'?(b.match?.score??-1)-(a.match?.score??-1):f.sort==='newest'?b.createdAt.localeCompare(a.createdAt):b.score.total-a.score.total)||b.score.total-a.score.total||a.id.localeCompare(b.id));
}
export const facetCount=(tasks,f,key,value)=>tasks.filter(t=>matchesFilters(t,f,key)&&(key==='skills'?(t.requiredSkills||[]).some(s=>s.confirmed&&s.name===value):key==='industries'?t.industry===value:key==='levels'?t.score.level===value:(t.workMode||'flexible')===value)).length;
