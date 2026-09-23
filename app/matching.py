"""Transparent task-specific skill coverage; never an automatic hiring decision."""
import re

ALIASES = {
 'Python': ['python','питон'], 'pandas': ['pandas','пандас'], 'Power BI': ['power bi','powerbi'],
 'SQL': ['sql'], 'JavaScript': ['javascript','js'], 'TypeScript': ['typescript'],
 'React': ['react','reactjs'], 'HTML': ['html'], 'CSS': ['css'], 'Excel': ['excel','эксель'],
 'SQLite': ['sqlite'], 'PostgreSQL': ['postgresql','postgres'], 'FastAPI': ['fastapi'],
 'Node.js': ['node.js','nodejs'], 'Figma': ['figma'], 'Git': ['git'],
 'Анализ данных': ['анализ данных','аналитика данных','data analysis'],
 'Визуализация данных': ['визуализация данных','data visualization'],
 'Веб-разработка': ['веб-разработка','web development'], 'Backend': ['backend','бэкенд'],
 'Frontend': ['frontend','фронтенд'], 'UX-дизайн': ['ux-дизайн','ux design','ux'],
 'Тестирование': ['тестирование','testing','qa'], 'Кибербезопасность': ['кибербезопасность','cybersecurity'],
 'Linux': ['linux'], 'Финансовый анализ': ['финансовый анализ','financial analysis'],
 'Прототипирование': ['прототипирование','prototyping'], 'Проектирование процессов': ['проектирование процессов'],
}

def canon(value):
    clean = ' '.join(str(value).split())
    return next((key for key, aliases in ALIASES.items() if clean.casefold() in [key.casefold()] + aliases), clean)

def skills_in(text):
    result = []
    for skill, aliases in ALIASES.items():
        for alias in aliases:
            found = re.search(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', text, re.I)
            if found:
                result.append({'skill':skill,'evidence':found.group()})
                break
    return result

def normalize_skills(values):
    if not isinstance(values, list) or len(values) > 40:
        raise ValueError('Укажите не больше 40 навыков списком.')
    result = []
    for value in values:
        if not isinstance(value, str) or not value.strip() or len(value) > 80:
            raise ValueError('Название навыка должно содержать от 1 до 80 символов.')
        value = canon(value)
        if value.casefold() not in [v.casefold() for v in result]: result.append(value)
    return result

def match(task, team):
    requirements = [s for s in task.get('requiredSkills', []) if s.get('confirmed')]
    owned = {canon(s).casefold() for s in team.get('skills', []) + team.get('technologies', [])}
    matched, missing = [], []
    for item in requirements:
        (matched if canon(item['name']).casefold() in owned else missing).append(item['name'])
    weight = sum(s.get('weight', 1) for s in requirements)
    got = sum(s.get('weight', 1) for s in requirements if s['name'] in matched)
    score = round(100 * got / weight) if weight else None
    reasons = []
    if matched: reasons.append('В профиле указаны нужные навыки: ' + ', '.join(matched) + '.')
    if missing: reasons.append('Не подтверждены профилем: ' + ', '.join(missing) + '. Уточните в отклике.')
    if task.get('industry') in team.get('interests', []): reasons.append('Тематика задачи совпадает с указанным интересом команды.')
    if not weight: reasons.append('Бизнес ещё не подтвердил требования к навыкам. Оценка появится после согласования.')
    achievements = team.get('profile', {}).get('achievements', [])[:4]
    return {'score':score,'matched':matched,'missing':missing,'reasons':reasons,
            'summary': ' '.join(a.get('text','') for a in achievements) or 'В профиле пока нет подтверждённых участником достижений.',
            'achievements':achievements,'formula':'100 × вес совпавших навыков / вес всех подтверждённых требований',
            'confidence':'Самооценка участника и подтверждённые им публичные источники; не проверка квалификации.'}

def decorate(data, role, team_id):
    team = next((x for x in data['teams'] if x['id'] == team_id), data['teams'][0])
    for task in data['tasks']:
        task['match'] = match(task, team)
        if role == 'business':
            task['candidates'] = sorted([{'teamId':t['id'], **match(task,t)} for t in data['teams']],
                                        key=lambda x: (-(x['score'] if x['score'] is not None else -1), x['teamId']))
        else:
            for key in ('conversation','memory','review','ai','skillSuggestions','scoreHistory'):
                task.pop(key, None)
    return data
