"""Agents 3–5: conservative, read-only demo enrichment using existing approved data."""
import re

DIRECTIONS = {'Backend': {'Python','FastAPI','Node.js','SQL','PostgreSQL','Backend'},
 'Frontend': {'React','JavaScript','TypeScript','HTML','CSS','Frontend'},
 'Анализ данных': {'pandas','Power BI','Excel','Анализ данных','Визуализация данных'},
 'Дизайн': {'Figma','UX-дизайн','Прототипирование'}, 'QA': {'Тестирование'}}
GROUPS = ['Наиболее подходящие','Хорошо подходящие','Для развития','Менее подходящие']

def directions(names):
    found = [(key,len(set(names)&values)) for key,values in DIRECTIONS.items()]
    return [key for key,n in sorted(found,key=lambda x:-x[1]) if n]

def specialist(team):
    names = list(dict.fromkeys(team.get('skills',[])+team.get('technologies',[])))
    profile = team.get('profile',{})
    sources = {s['id']:s for s in profile.get('sources',[])}
    skills = []
    for name in names:
        evidence = [e for e in profile.get('evidence',[]) if e.get('name','').casefold()==name.casefold() and e.get('sourceId') in sources and e.get('evidence') and e['evidence'] in sources[e['sourceId']].get('text','')]
        skills.append({'name':name,'level':'недостаточно информации','confirmed':bool(evidence),
                       'evidence':[{'quote':e['evidence'],'source':sources[e['sourceId']].get('label','Источник'),'url':sources[e['sourceId']].get('url','')} for e in evidence]})
    return {'agent':3,'mode':'demo-rules','directions':directions(names),'skills':skills,
            'recommendedComplexity':None,'confidence':'низкая' if not any(s['confirmed'] for s in skills) else 'средняя',
            'note':'Источник подтверждает упоминание навыка, но не мастерство. Уровень и опыт сложных задач требуют уточнения. Отсутствие внешних профилей не снижает соответствие.'}

def task_analysis(task):
    fields = {k:v for k,v in task.get('fields',{}).items() if k in task.get('confirmedFields',[]) and v}
    text = ' '.join(str(v) for k,v in fields.items() if k!='contact')
    required = [s['name'] for s in task.get('requiredSkills',[]) if s.get('confirmed')]
    integrations = re.findall(r'\b(?:API|CRM|ERP|1С|OAuth|webhook)\b',text,re.I)
    risk = bool(re.search(r'персональн\w* данн|платеж|платёж|авторизац|безопасност',text,re.I))
    ai = bool(re.search(r'\bAI\b|машинн\w* обуч|нейросет',text,re.I))
    complexity = 'продвинутый' if len(set(integrations))>=3 or (risk and ai) else 'средний' if integrations or risk or ai or len(required)>=4 else 'начальный'
    reasons = []
    if integrations: reasons.append('Упомянуты интеграции: '+', '.join(sorted(set(integrations))))
    if risk: reasons.append('Есть упоминания безопасности или чувствительных данных')
    if ai: reasons.append('Есть AI-компонент')
    if len(required)>=4: reasons.append('Требуется несколько технологических компетенций')
    if not reasons: reasons.append('В подтверждённых полях пока не выявлены факторы высокой сложности')
    missing = [label for key,label in [('data','наличие и качество данных'),('constraints','сроки и ограничения'),('outcome','состав результата'),('users','масштаб аудитории'),('interaction','формат взаимодействия')] if key not in fields]
    missing += ['нагрузка и поддержка','уровень участников']
    duration = re.search(r'\d+\s*(?:рабочих\s+)?(?:дн\w*|день|дней|недел\w*|месяц\w*)',fields.get('constraints',''),re.I)
    return {'agent':4,'mode':'demo-rules','businessCategory':task.get('industry'),'directions':directions(required),
      'complexity':complexity,'explanation':'; '.join(reasons)+'. Предварительная оценка по доступным сведениям.',
      'requiredSkills':required,'optionalSkills':[],'technologies':required,
      'suggestedRoles':directions(required) or ['Уточнить роль с бизнесом'],
      'duration':duration.group() if duration else 'Не указана','teamSize':'Уточнить с бизнесом',
      'data':fields.get('data','Ответ не найден'),'integrations':sorted(set(integrations)),
      'security':fields.get('constraints','Ответ не найден') if risk else 'Требования необходимо уточнить',
      'workMode':task.get('workMode','flexible'),'missing':missing,'confidence':'низкая' if len(missing)>3 else 'средняя',
      'agent2Status':'Используются существующие подтверждённые ответы. Новые запросы агенту 2 в демо не выполняются.'}

def recommendation(profile,analysis,match):
    score = match.get('score')
    group = GROUPS[0] if score is not None and score>=85 else GROUPS[1] if score is not None and score>=60 else GROUPS[2] if score is not None and score>=30 else GROUPS[3]
    confirmed = [s['name'] for s in profile['skills'] if s['confirmed'] and s['name'] in match.get('matched',[])]
    return {'agent':5,'mode':'demo-rules','group':group,'confirmedSkills':confirmed,
      'role':next((d for d in profile['directions'] if d in analysis['directions']),'Роль обсудить с бизнесом'),
      'complexityFit':'Для сравнения сложности с опытом недостаточно сведений.',
      'availabilityFit':'Доступность и формат работы согласуйте перед откликом.',
      'confidence':profile['confidence'],'note':'Неуказанные навыки требуют уточнения и не считаются отсутствующими. Любая задача доступна для отклика.'}
