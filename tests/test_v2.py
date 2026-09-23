import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from app.intelligence import ConversationAgent
from app.matching import match, decorate
from app.profiles import preview, public_github, github_username, _CACHE
from app.store import Store, WorkflowError
from tests import test_workflow as workflow

class IntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'test.db')
        self.task=self.store.create_task({'draft':'Кофейне нужен анализ продаж. Есть CSV за 8 недель.','industry':'Общественное питание'})
        self.agent=ConversationAgent()
    def tearDown(self): self.temp.cleanup()
    def turn(self,text,focus=None):
        result=self.agent.respond(self.task,text,'u-1',focus)
        self.task=self.store.save_chat(self.task['id'],self.task['revision'],text,'u-1',result)
        return result
    def test_chat_persists_and_unknown_reasks(self):
        initial=self.turn(''); self.assertGreaterEqual(initial['reply'].count('?'),3)
        self.turn('CSV за 8 недель','data');r=self.turn('не знаю','success')
        self.assertEqual(r['focus'],'success');self.assertEqual(r['updates'],[])
        reopened=Store(self.store.path).get_task(self.task['id'])
        self.assertEqual(len(reopened['conversation']),5)
        self.assertEqual(reopened['memory']['data']['value'],'CSV за 8 недель')
    def test_compose_does_not_confirm_and_corrections_override(self):
        self.turn('CSV за 8 недель','data')
        self.turn('CSV за 12 недель','data')
        result=self.store.compose_chat(self.task['id'],self.task['revision'])
        self.assertEqual(result['fields']['data'],'CSV за 12 недель');self.assertEqual(result['score']['total'],0)
    def test_model_receives_full_history_and_rejects_hallucination(self):
        self.turn('');self.turn('CSV за 8 недель','data')
        provider=Mock();provider.generate.return_value={'reply':'Уточните критерии?','focus':'success','updates':[{'field':'data','value':'Миллион клиентов','source':'u-2'}]}
        agent=ConversationAgent(provider)
        r=agent.respond(self.task,'Уточним критерии','u-2','success')
        self.assertEqual(r['mode'],'local')
        sent=provider.generate.call_args[0][1]
        self.assertEqual(sent['conversation'],self.task['conversation'])
    def test_grounded_remote_update(self):
        self.turn('')
        provider=Mock();provider.generate.return_value={'reply':'Уточните критерии?','focus':'success','updates':[{'field':'data','value':'CSV за 12 недель','source':'u-2'}]}
        r=ConversationAgent(provider).respond(self.task,'Теперь CSV за 12 недель','u-2')
        self.assertEqual(r['mode'],'remote');self.assertEqual(r['updates'][0]['value'],'CSV за 12 недель')
    def test_rejects_assistant_as_evidence(self):
        self.turn('')
        provider=Mock();provider.generate.return_value={'reply':'Хорошо','focus':'success','updates':[{'field':'data','value':'CSV','source':self.task['conversation'][0]['id']}]}
        self.assertEqual(ConversationAgent(provider).respond(self.task,'да','u-2')['mode'],'local')
    def test_skills_are_only_suggestions(self):
        result=self.agent.suggest_skills(self.task)
        self.assertIn('pandas',[s['name'] for s in result['skills']])
        saved=self.store.save_insight(self.task['id'],self.task['revision'],'skillSuggestions',result)
        self.assertEqual(match(saved,{'skills':['pandas'],'technologies':[]})['score'],None)
    def test_skill_weights_and_context_change(self):
        t={'requiredSkills':[{'name':'Python','weight':3,'confirmed':True},{'name':'Power BI','weight':1,'confirmed':True}]}
        candidate={'skills':['python'],'technologies':[]}
        self.assertEqual(match(t,candidate)['score'],75)
        t['requiredSkills'][0]['name']='Кибербезопасность'
        self.assertEqual(match(t,candidate)['score'],0)
    def test_review_grounding(self):
        provider=Mock();provider.generate.return_value={'issues':[{'title':'Проблема','question':'Уточните?','evidence':['несуществующая цитата']}]}
        r=ConversationAgent(provider).review(self.task);self.assertEqual(r['mode'],'local')
    def test_review_detects_possible_contradiction(self):
        self.task['fields']['data']='Персональных данных нет. Передадим телефоны клиентов.'
        self.assertIn('Возможное противоречие в данных',[x['title'] for x in self.agent.review(self.task)['issues']])
    def test_history_and_legacy_database(self):
        task=self.store.update_task(self.task['id'],{'revision':1,'fields':{'data':'CSV за 8 недель'},'confirmedFields':['data'],'industry':self.task['industry']})
        self.assertEqual(task['scoreHistory'][0]['after'],20)
        Store(self.store.path)
        self.assertEqual(self.store.get_task(task['id'])['revision'],2)
    def test_stale_chat_cannot_overwrite(self):
        r=self.agent.respond(self.task,'','u-1');self.turn('')
        with self.assertRaises(WorkflowError): self.store.save_chat(self.task['id'],1,'','u-1',r)
    def test_practice_reset_preserves_normal_data(self):
        normal=self.task['id'];old=self.store.reset_demo();new=self.store.reset_demo()
        self.assertEqual(self.store.get_task(normal)['id'],normal)
        self.assertNotEqual(old['id'],new['id'])
        with self.assertRaises(WorkflowError): self.store.get_task(old['id'])
    def test_students_do_not_receive_business_conversation(self):
        self.turn('')
        self.task=self.store.compose_chat(self.task['id'],self.task['revision'])
        self.task=self.store.publish_task(self.task['id'],{'revision':self.task['revision'],'confirmed':True})
        data=decorate(self.store.bootstrap('student','t1'),'student','t1')
        task=next(t for t in data['tasks'] if t['id']==self.task['id'])
        self.assertNotIn('conversation',task);self.assertNotIn('memory',task)

class ProfileTests(unittest.TestCase):
    def test_url_allowlist(self):
        self.assertEqual(github_username('https://github.com/octocat'),'octocat')
        for url in ['https://127.0.0.1/foo','https://github.com.evil.org/a','https://github.com/a/repo','https://github.com@evil.org/a','http://github.com/a','https://github.com:443/a']:
            with self.assertRaises(ValueError): github_username(url)
    def test_requires_consent_and_linkedin_text(self):
        with self.assertRaises(ValueError): preview({'text':'Python'})
        with self.assertRaises(ValueError): preview({'consent':True,'linkedin':'https://linkedin.com/in/example/'})
    def test_text_extracts_skills_not_protected_data(self):
        result=preview({'consent':True,'text':'Опыт: Python, pandas и Power BI. Возраст 21 год.'})
        self.assertEqual(set(result['skills']),{'Python','pandas','Power BI'})
        self.assertEqual(result['achievements'],[])
    def test_remote_profile_hallucinations_rejected(self):
        provider=Mock();provider.generate.return_value={'skills':[],'achievements':[{'text':'Победитель десяти хакатонов','sourceId':'s0'}]}
        r=preview({'consent':True,'text':'Создал проект на Python.'},provider)
        self.assertEqual(r['mode'],'local');self.assertEqual(r['achievements'],[])
    def test_grounded_achievement(self):
        provider=Mock();provider.generate.return_value={'skills':[{'name':'Python','sourceId':'s0','evidence':'Python'}],'achievements':[{'text':'Создал проект на Python.','sourceId':'s0'}]}
        r=preview({'consent':True,'text':'Создал проект на Python.'},provider)
        self.assertEqual(r['mode'],'remote');self.assertEqual(r['skills'],['Python'])
    def test_github_read_cache_excludes_forks(self):
        _CACHE.clear()
        with patch('app.profiles.github_get',side_effect=[{},[{'name':'mine','description':'Data tool','language':'Python','topics':['pandas']},{'name':'fork','fork':True,'language':'Rust'}]]) as get:
            first=public_github('sample-user');second=public_github('sample-user')
            self.assertEqual(get.call_count,2);self.assertEqual(first,second)
            self.assertEqual(len(first['sources']),1);self.assertNotIn('Rust',first['sources'][0]['text'])

class V2HTTPTests(unittest.TestCase):
    setUpClass=classmethod(workflow.WorkflowTests.setUpClass.__func__)
    tearDownClass=classmethod(workflow.WorkflowTests.tearDownClass.__func__)
    request=workflow.WorkflowTests.request
    create=workflow.WorkflowTests.create
    def test_chat_http_and_origin(self):
        task=self.create();path='/api/tasks/'+task['id']+'/chat'
        body={'revision':task['revision'],'message':''}
        with patch.dict('os.environ',{'PUBLIC_ORIGIN':'https://demo.trycloudflare.com'}):
            self.assertEqual(self.request('POST',path,body,extra={'Origin':'https://evil.org'})[0],403)
            code,response=self.request('POST',path,body,extra={'Origin':'https://demo.trycloudflare.com'})
        self.assertEqual(code,200,response);self.assertEqual(len(response['task']['conversation']),1)
        self.assertEqual(self.request('POST',path,body)[0],409)
        self.assertEqual(self.request('POST',path,body,role='student')[0],403)
    def test_import_is_preview_then_explicit_confirmation(self):
        endpoint='/api/teams/t1/profile'
        payload={'consent':True,'text':'Навыки: Python, pandas, SQL.'}
        old=self.request('GET','/api/bootstrap',role='student')[1]['teams'][0]
        code,result=self.request('POST',endpoint+'/import',payload,role='student')
        self.assertEqual(code,200,result);team=result['team']
        self.assertEqual(team['skills'],old['skills']);self.assertIn('profilePreview',team)
        self.assertEqual(self.request('POST','/api/teams/t2/profile/import',payload,role='student')[0],403)
        business=self.request('GET','/api/bootstrap')[1]
        self.assertNotIn('profilePreview',next(t for t in business['teams'] if t['id']=='t1'))
        data={'revision':team['revision'],'name':team['name'],'skills':['Python','pandas','SQL'],'technologies':[],'interests':[],'acceptImport':True,'achievementIndexes':[]}
        code,response=self.request('PATCH',endpoint,data,role='student');self.assertEqual(code,200,response)
        self.assertNotIn('profilePreview',response['team']);self.assertIn('confirmedAt',response['team']['profile'])
        self.assertEqual(self.request('PATCH',endpoint,data,role='student')[0],409)
    def test_skills_workflow_and_matching(self):
        task=self.create();base='/api/tasks/'+task['id']
        code,r=self.request('POST',base+'/skills-suggest',{'revision':task['revision']});self.assertEqual(code,200,r)
        task=r['task']
        code,r=self.request('POST',base+'/skills',{'revision':task['revision'],'skills':[{'name':'Python','weight':3},{'name':'SQL','weight':1}],'workMode':'remote','deadline':'2026-12-01'})
        self.assertEqual(code,200,r)
        data=self.request('GET','/api/bootstrap')[1];task=next(t for t in data['tasks'] if t['id']==task['id'])
        self.assertEqual(task['score']['total'],0);self.assertEqual(len(task['candidates']),5)
        self.assertEqual(task['candidates'][0]['score'],100)
    def test_chat_composition_automatically_suggests_skills(self):
        task=self.create();base='/api/tasks/'+task['id']
        code,result=self.request('POST',base+'/chat',{'revision':task['revision'],'message':'Нужен анализ CSV продаж','focus':'data'})
        self.assertEqual(code,200,result);task=result['task']
        code,result=self.request('POST',base+'/chat-compose',{'revision':task['revision']})
        self.assertEqual(code,200,result)
        self.assertEqual(result['task']['score']['total'],0)
        self.assertTrue(result['task']['skillSuggestions']['skills'])
        self.assertEqual(result['task']['ai']['trace'][0]['agent'],'composition')
        code,review=self.request('POST',base+'/review',{'revision':result['task']['revision']})
        self.assertEqual(code,200,review)
        issue=review['task']['review']['issues'][0]
        code,resolved=self.request('POST',base+'/review-resolve',{'revision':review['task']['revision'],'issueId':issue['id'],'status':'dismissed'})
        self.assertEqual(code,200,resolved)
        self.assertEqual(resolved['task']['review']['issues'][0]['status'],'dismissed')

    def test_invalid_inputs_stay_errors(self):
        task=self.create();base='/api/tasks/'+task['id']
        self.assertEqual(self.request('POST',base+'/chat',{'revision':task['revision'],'message':'x'*4001})[0],422)
        self.assertEqual(self.request('POST',base+'/skills',{'revision':task['revision'],'skills':[{'name':'Python','weight':True}]})[0],422)
        self.assertEqual(self.request('POST',base+'/skills',{'revision':task['revision'],'skills':[],'deadline':'yesterday'})[0],422)
        self.assertEqual(self.request('POST','/api/demo/reset',{})[0],422)
        self.assertEqual(self.request('POST','/api/demo/reset',{'confirmed':True},role='student')[0],403)
