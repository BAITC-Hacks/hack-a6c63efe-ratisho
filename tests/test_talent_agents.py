import copy
import unittest
from app.talent_agents import specialist, task_analysis, recommendation

class TalentTests(unittest.TestCase):
    def test_missing_sources_do_not_remove_skills(self):
        t={'skills':['Python'],'technologies':[]}; before=copy.deepcopy(t)
        a=specialist(t)
        self.assertEqual(t,before)
        self.assertEqual(a['skills'][0]['name'],'Python')
        self.assertFalse(a['skills'][0]['confirmed'])
    def test_only_confirmed_task_fields(self):
        a=task_analysis({'fields':{'need':'AI OAuth CRM ERP'},'confirmedFields':[]})
        self.assertEqual(a['integrations'],[])
        self.assertEqual(a['confidence'],'низкая')
    def test_source_quote_required(self):
        t={'skills':['Python'],'profile':{'sources':[{'id':'s0','text':'SQL','label':'Resume'}],'evidence':[{'name':'Python','sourceId':'s0','evidence':'Python'}]}}
        self.assertFalse(specialist(t)['skills'][0]['confirmed'])
    def test_unknown_match_not_invented(self):
        p=specialist({'skills':[]})
        result=recommendation(p,task_analysis({}),{'score':None})
        self.assertEqual(result['group'],'Менее подходящие')
