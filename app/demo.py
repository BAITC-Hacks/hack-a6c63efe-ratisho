"""Additive, versioned synthetic demo migration. Never overwrites user-entered fields."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
from .seed import seed_data, _task

BUSINESSES = [
 ('b1','business@demo.local','Зерно · кофейня'),
 ('b2','logistics@demo.local','RouteHub · логистика'),
 ('b3','education@demo.local','LearnSpace · образование'),
 ('b4','green@demo.local','GreenHouse · агротех'),
 ('b5','retail@demo.local','MarketLab · ритейл'),
 ('b6','finance@demo.local','FinScope · аналитика'),
]
# These are fictional teams and sample education entries, not actual affiliations.
TRACKS = [
 ('Metric Minds','Аналитика','Python,pandas,SQL,Power BI','Анализ данных'),
 ('FinPilot','Ритейл','Excel,SQL,Power BI','Финансовый анализ'),
 ('Secure Steps','Логистика','Python,Linux,Git','Кибербезопасность'),
 ('Pixel Partners','Образование','Figma,HTML,CSS,JavaScript','UX-дизайн,Прототипирование'),
 ('Query Crew','Ритейл','PostgreSQL,SQL,Python,pandas','Анализ данных,Backend'),
 ('Web Atlas','Общественное питание','React,TypeScript,Node.js,Git','Frontend,Веб-разработка'),
 ('Test Garden','Сельское хозяйство','Python,JavaScript,Git','Тестирование'),
 ('Forecast Lab','Аналитика','Python,pandas,Excel,Power BI','Анализ данных,Визуализация данных'),
 ('Process People','Логистика','Figma,Excel,SQL','Проектирование процессов,Прототипирование'),
 ('Campus Makers','Образование','React,TypeScript,Python,FastAPI','Frontend,Backend'),
]
BRIEFS = [
 ('Общественное питание','b1','Прогноз закупок для кофейни','Сверять спрос и остатки перед закупкой','заказы и остатки','Python,pandas,Excel'),
 ('Общественное питание','b1','Дашборд популярности меню','Находить блюда с высокой долей списаний','продажи блюд и списания','Power BI,SQL,Анализ данных'),
 ('Общественное питание','b1','Экран бронирования столиков','Сократить пересечения броней','заявки и временные слоты','React,TypeScript,UX-дизайн'),
 ('Общественное питание','b1','Проверка формы заказа','Находить ошибки до передачи заказа кухне','сценарии заказов','Тестирование,JavaScript'),
 ('Логистика','b2','План загрузки курьеров','Распределять заявки по доступным сменам','заявки и смены','Python,FastAPI,SQL'),
 ('Логистика','b2','Анализ задержек доставки','Выделять районы с частыми задержками','заказы и интервалы доставки','pandas,Power BI,Анализ данных'),
 ('Логистика','b2','Прототип кабинета диспетчера','Согласовать понятный сценарий работы','макеты и перечень операций','Figma,UX-дизайн,Прототипирование'),
 ('Логистика','b2','Аудит доступа к учебной панели','Проверить разграничение доступа в тестовом стенде','тестовые роли и журналы','Кибербезопасность,Linux,Python'),
 ('Образование','b3','Карта прогресса учебной группы','Показывать темы, которые нужно повторить','обезличенные результаты тестов','Python,Power BI,Визуализация данных'),
 ('Образование','b3','Каталог учебных проектов','Помочь студентам находить проекты по навыкам','учебные проекты и теги','React,TypeScript,Frontend'),
 ('Образование','b3','Проверка доступности учебного сайта','Выявить трудности навигации с клавиатуры','страницы учебного стенда','Тестирование,HTML,CSS'),
 ('Образование','b3','Конструктор расписания консультаций','Исключить пересечения выбранных слотов','слоты и учебные заявки','FastAPI,Python,PostgreSQL'),
 ('Сельское хозяйство','b4','Дашборд влажности теплицы','Замечать отклонения от заданных порогов','синтетические измерения датчиков','Python,pandas,Визуализация данных'),
 ('Сельское хозяйство','b4','Мобильный журнал смены','Фиксировать работы на грядках','грядки и виды работ','JavaScript,HTML,CSS'),
 ('Сельское хозяйство','b4','Учёт расхода воды','Сравнивать потребление по зонам','ежедневные показания расходомеров','Excel,Power BI,SQL'),
 ('Сельское хозяйство','b4','Тестирование журнала полива','Проверить сохранность записей при повторной отправке','учебные записи полива','Python,Тестирование,Git'),
 ('Ритейл','b5','Сегментация ассортимента','Разделить товары по вкладу в продажи','товары и продажи','pandas,SQL,Анализ данных'),
 ('Ритейл','b5','Витрина локального магазина','Помочь посетителю найти нужный товар','каталог товаров','React,JavaScript,UX-дизайн'),
 ('Ритейл','b5','Панель возвратов','Выявить частые причины возврата товаров','возвраты и причины','Power BI,Excel,Визуализация данных'),
 ('Ритейл','b5','Импорт складского CSV','Предотвратить дубли товаров при повторном импорте','остатки и товарные коды','Python,SQLite,Тестирование'),
 ('Аналитика','b6','План-факт учебного бюджета','Показывать отклонения расходов от плана','плановые и фактические расходы','Финансовый анализ,Excel,Power BI'),
 ('Аналитика','b6','Проверка качества финансового CSV','Находить пропуски и неверные суммы','синтетические операции','Python,pandas,SQL'),
 ('Аналитика','b6','Дашборд денежного потока','Показывать баланс поступлений и расходов','синтетические операции','Финансовый анализ,Power BI,SQL'),
 ('Аналитика','b6','Прототип отчёта для предпринимателя','Сделать результаты анализа понятными без таблиц','обезличенные агрегаты','Figma,UX-дизайн,Визуализация данных'),
]

def expanded_data():
    base=seed_data(); teams=base['teams']
    for index,(name,interest,tech,skills) in enumerate(TRACKS,6):
        teams.append(dict(id='t%s'%index,name=name,interests=[interest],skills=skills.split(','),technologies=tech.split(','),points=0))
    universities=['Учебный университет технологий','Демо-университет прикладных наук','Учебная академия цифровых решений']
    for i,t in enumerate(teams):
        specialty=(t['skills']+t['technologies'])[:3]
        t.update(synthetic=True,revision=1,description='Мы — %s. Объединяем %s, чтобы делать понятные и проверяемые решения для бизнеса. Начинаем с уточнения задачи, показываем промежуточный прототип и проверяем результат на данных.'%(t['name'],', '.join(specialty)),
          studentStatus='students' if i%5!=4 else 'mixed',university=universities[i%3],education='Бакалавриат · %s курс'%(2+i%3),
          experience='%s учебных проектов; опыт от %s месяцев. Работали с таблицами, прототипами и проверкой пользовательских сценариев.'%(2+i%6,6+i*2),
          memberCount=2+i%4,availability='%s часов в неделю'%(8+i%4*4),workMode=['remote','hybrid','flexible'][i%3],
          profile={'achievements':[{'text':'Создали учебный прототип по направлению «%s» и проверили 20 пользовательских сценариев.'%t['skills'][0], 'source':'Синтетический демо-профиль','url':''}], 'confirmedAt':'2026-09-23T09:00:00Z'})
    tasks=[]; proposals=[]; stamp=datetime(2026,9,1,tzinfo=timezone.utc)
    for i,(industry,owner,title,need,materials,skills) in enumerate(BRIEFS):
        fields=dict(title=title,context='Демонстрационный бизнес ведёт процесс вручную в нескольких таблицах.',need=need+'.',users='Куратор проекта и сотрудники операционной команды.',
          data='Синтетические данные: %s, 300 записей за 12 недель; без реальных персональных данных.'%materials,
          constraints='Прототип за %s дней. Работа на учебных данных, без платных интеграций.'%(7+i%4*3),
          outcome='Рабочий прототип: %s. Инструкция по запуску и контрольные примеры.'%title.lower(),
          success='Все 20 контрольных сценариев проходят; 300 строк импортируются без потерь; повторная загрузка не создаёт дубли.',
          contact=next(b[1] for b in BUSINESSES if b[0]==owner),interaction='Онлайн-консультация два раза в неделю, итоговая проверка по согласованному списку.')
        # Keep varied readiness without unconfirmed skill requirements.
        if i%6==1: fields['success']=''
        if i%6==2:
            for k in ('contact','interaction','constraints'):fields[k]=''
        if i%6==3:
            for k in ('success','data','constraints','context'):fields[k]=''
        task=_task('demo-task-%02d'%(i+1),industry,title+'. '+need+'.',fields,True)
        task.update(ownerBusinessId=owner,synthetic=True,createdAt=(stamp+timedelta(days=i)).isoformat(),updatedAt=(stamp+timedelta(days=i)).isoformat(),
           deadline=(stamp+timedelta(days=30+i*2)).date().isoformat(),workMode=['remote','hybrid','onsite','flexible'][i%4],requiredSkills=[{'name':n,'weight':3 if j==0 else 1,'confirmed':True} for j,n in enumerate(skills.split(','))])
        tasks.append(task)
        from .matching import match
        best=sorted(teams,key=lambda t:-(match(task,t)['score'] or 0))
        for j,t in enumerate(best[:3]):
            pid='demo-p-%02d-%s'%(i+1,j+1);status='selected' if j==0 and i%3==0 else 'rejected' if j==2 and i%4==0 else 'pending'
            milestone=None
            if status=='selected':
                done=i%2==0
                milestone=dict(title='Учебный прототип и проверка сценариев',evidenceUrl='https://example.com/demo/'+pid,submittedAt='2026-09-22T09:00:00Z',confirmedAt='2026-09-23T09:00:00Z' if done else None,points=10 if done else 0)
            proposals.append(dict(id=pid,taskId=task['id'],teamId=t['id'],idea='Предлагаем %s. Используем %s.'%(title.lower(),', '.join(t['technologies'][:2])),plan='1. Уточнить критерии. 2. Проверить данные. 3. Собрать прототип. 4. Показать результат и проверить контрольные сценарии.',timeline='%s дней'%(7+j*3),prototypeUrl='https://example.com/demo/'+pid,status=status,milestone=milestone,createdAt=task['createdAt'],synthetic=True))
    for i,b in enumerate(BUSINESSES):
        t=_task('demo-draft-%s'%(i+1),BRIEFS[i*4][0],'Хотим улучшить процесс: '+BRIEFS[i*4][3].lower()+'. Нужна помощь с уточнением результата.')
        t.update(ownerBusinessId=b[0],synthetic=True,requiredSkills=[{'name':s,'weight':1,'confirmed':True} for s in BRIEFS[i*4][5].split(',')]);tasks.append(t)
    summaries_path=Path(__file__).with_name('demo_summaries.json')
    summaries=json.loads(summaries_path.read_text()) if summaries_path.is_file() else {}
    for team in teams:
        if team['id'] in summaries:team['aiSummary']=summaries[team['id']]
    return dict(tasks=tasks,teams=teams,proposals=proposals)

def migrate(store,db):
    if db.execute("SELECT 1 FROM metadata WHERE key='demo-v3'").fetchone():return
    import json
    extended=expanded_data(); original={t['id']:t for t in seed_data()['tasks']}
    for row in db.execute('SELECT id,payload FROM tasks').fetchall():
        t=json.loads(row[1]);t.setdefault('ownerBusinessId','b1')
        if t['id'] in original:
            t['synthetic']=True
            if not t.get('requiredSkills'):
                t['requiredSkills']=original[t['id']].get('requiredSkills',[{'name':'Прототипирование','weight':1,'confirmed':True}])
            t.setdefault('workMode','remote');t.setdefault('deadline','2026-10-15')
        store._save_task(db,t)
    for t in extended['teams']:
        row=db.execute('SELECT payload FROM teams WHERE id=?',(t['id'],)).fetchone()
        if row:
            current=json.loads(row[0]); defaults={k:v for k,v in t.items() if k not in current}
            # Precomputed AI summaries only describe the unchanged synthetic profile.
            if any(k in current and current[k]!=t[k] for k in ('description','skills','technologies','experience')):
                defaults.pop('aiSummary',None)
            current.update(defaults);t=current
        db.execute('INSERT INTO teams VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',(t['id'],store._dump(t)))
    for t in extended['tasks']:
        if not db.execute('SELECT 1 FROM tasks WHERE id=?',(t['id'],)).fetchone():store._save_task(db,t)
    for p in extended['proposals']:
        if not db.execute('SELECT 1 FROM proposals WHERE id=?',(p['id'],)).fetchone():store._save_proposal(db,p)
    db.execute("INSERT INTO metadata VALUES ('demo-v3','1')")
