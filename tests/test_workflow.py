"""Real HTTP + SQLite acceptance checks; no remote service is required."""
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from app.agents import AgentOrchestrator
from app.domain import FIELD_LABELS
from server import make_server


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls.temp.name) / "tests.sqlite3"
        with patch.dict("os.environ", {"AI_MODE": "local", "AI_API_KEY": "", "AI_MODEL": ""}):
            cls.server = make_server(port=0, db_path=cls.db_path, orchestrator=AgentOrchestrator())
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        cls.temp.cleanup()

    def request(self, method, path, payload=None, role="business", team="t1", extra=None, raw=None):
        headers = {"Content-Type": "application/json", "X-Role": role, "X-Team-Id": team}
        headers.update(extra or {})
        body = json.dumps(payload).encode() if payload is not None else raw
        req = Request(self.url + path, data=body, headers=headers, method=method)
        try:
            with urlopen(req, timeout=5) as response:
                body = response.read()
                return response.status, json.loads(body) if "application/json" in response.headers.get("Content-Type", "") else body
        except HTTPError as response:
            return response.code, json.loads(response.read())

    def create(self):
        code, result = self.request("POST", "/api/tasks", {"draft": "В кофейне много списаний выпечки. Нужен понятный план закупок.", "industry": "Общественное питание"})
        self.assertEqual(code, 201, result)
        return result["task"]

    def save(self, task, fields=None, confirmed=None):
        values = fields if fields is not None else task["fields"]
        code, result = self.request("PATCH", "/api/tasks/" + task["id"], {
            "fields": values, "confirmedFields": confirmed or [], "industry": task["industry"], "revision": task["revision"]})
        self.assertEqual(code, 200, result)
        return result["task"]

    def publish(self, task):
        code, result = self.request("POST", "/api/tasks/%s/publish" % task["id"], {"confirmed": True, "revision": task["revision"]})
        self.assertEqual(code, 200, result)
        return result["task"]

    def propose(self, task, team="t1"):
        code, result = self.request("POST", "/api/tasks/%s/proposals" % task["id"], {
            "idea": "Сделаем веб-панель по данным продаж.", "plan": "Разберём CSV, соберём экран и проверим на примерах.",
            "timeline": "Одна неделя", "prototypeUrl": "https://example.com/prototype"}, role="student", team=team)
        self.assertEqual(code, 201, result)
        return result["proposal"]

    def test_complete_flow_with_human_confirmation_and_progress(self):
        task = self.create()
        code, result = self.request("POST", "/api/tasks/%s/questions" % task["id"], {})
        self.assertEqual(code, 200, result)
        self.assertGreaterEqual(len(result["questions"]), 3)
        self.assertEqual(result["ai"]["mode"], "local")
        answers = {"context": "Остаётся выпечка после закрытия кофейни.", "need": "Планировать количество выпечки по продажам.",
                   "users": "Управляющий кофейней", "data": "CSV продаж за восемь недель", "constraints": "Срок семь дней",
                   "outcome": "Панель загрузки CSV и планирования выпечки", "success": "Обработка 100 строк без потерь",
                   "contact": "demo@example.com", "interaction": "Две встречи по двадцать минут"}
        code, result = self.request("POST", "/api/tasks/%s/compose" % task["id"], {"answers": answers})
        self.assertEqual(code, 200, result)
        task = result["task"]
        self.assertEqual(task["score"]["total"], 0)
        task = self.save(task, confirmed=list(FIELD_LABELS))
        self.assertEqual(task["score"]["total"], 100)
        task = self.publish(task)
        proposal = self.propose(task)
        code, result = self.request("POST", "/api/proposals/%s/decision" % proposal["id"], {"status": "selected"})
        self.assertEqual(code, 200, result)
        code, result = self.request("POST", "/api/proposals/%s/submit-stage" % proposal["id"], {"title": "Прототип", "evidenceUrl": "https://example.com/result"}, role="student")
        self.assertEqual(code, 200, result)
        before = next(t["points"] for t in self.request("GET", "/api/bootstrap")[1]["teams"] if t["id"] == "t1")
        code, result = self.request("POST", "/api/proposals/%s/confirm-stage" % proposal["id"], {})
        self.assertEqual(code, 200, result)
        self.assertEqual(next(t["points"] for t in result["teams"] if t["id"] == "t1"), before + 10)
        code, repeated = self.request("POST", "/api/proposals/%s/confirm-stage" % proposal["id"], {})
        self.assertEqual(code, 200)
        self.assertEqual(repeated, result)

    def test_low_score_can_publish_and_accept_unlimited_teams(self):
        task = self.create()
        task = self.save(task, {"title": "Задача с низким рейтингом"})
        self.assertEqual(task["score"]["total"], 0)
        task = self.publish(task)
        ids = []
        for team in ("t1", "t2", "t3", "t4", "t5", "t1"):
            ids.append(self.propose(task, team)["id"])
        self.assertEqual(len(set(ids)), 6)
        for proposal_id in ids[:2]:
            self.assertEqual(self.request("POST", "/api/proposals/%s/decision" % proposal_id, {"status": "selected"})[0], 200)
        all_proposals = self.request("GET", "/api/bootstrap")[1]["proposals"]
        self.assertEqual(sum(p["status"] == "selected" for p in all_proposals if p["taskId"] == task["id"]), 2)

    def test_no_automatic_choice_and_manual_rejection(self):
        proposal = self.propose({"id": "task4"}, team="t3")
        self.assertEqual(proposal["status"], "pending")
        code, result = self.request("POST", "/api/proposals/%s/decision" % proposal["id"], {"status": "rejected"})
        self.assertEqual(code, 200)
        self.assertEqual(result["proposal"]["status"], "rejected")

    def test_drafts_not_visible_to_students(self):
        task = self.create()
        student = self.request("GET", "/api/bootstrap", role="student")[1]
        self.assertNotIn(task["id"], [t["id"] for t in student["tasks"]])
        self.assertTrue(all(t["status"] == "published" for t in student["tasks"]))
        code, _ = self.request("POST", "/api/tasks/%s/proposals" % task["id"], {"idea": "Предлагаем решение", "plan": "Разработаем прототип", "timeline": "Неделя", "prototypeUrl": "https://example.com"}, role="student")
        self.assertEqual(code, 409)

    def test_score_sorted_and_seed_minimums(self):
        data = self.request("GET", "/api/bootstrap")[1]
        self.assertGreaterEqual(len(data["tasks"]), 10)
        self.assertGreaterEqual(len(data["teams"]), 5)
        self.assertGreaterEqual(len(data["proposals"]), 5)
        scores = [t["score"]["total"] for t in data["tasks"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_edit_recalculate_stale_revision_and_persistence(self):
        task = self.create()
        values = {key: "Подтверждённые сведения по задаче" for key in FIELD_LABELS}
        old = task
        task = self.save(task, values, list(FIELD_LABELS))
        self.assertEqual(task["score"]["total"], 100)
        code, _ = self.request("PATCH", "/api/tasks/" + task["id"], {"fields": values, "confirmedFields": [], "industry": task["industry"], "revision": old["revision"]})
        self.assertEqual(code, 409)
        values["data"] = "Новый CSV за другой период"
        task = self.save(task, values, [key for key in FIELD_LABELS if key != "data"])
        self.assertEqual(task["score"]["total"], 80)
        from app.store import Store
        self.assertEqual(Store(self.db_path).get_task(task["id"]), task)

    def test_roles_and_proposal_ownership(self):
        self.assertEqual(self.request("POST", "/api/tasks", {"draft": "Новая задача", "industry": "Другое"}, role="student")[0], 403)
        proposal = self.propose({"id": "task1"}, team="t2")
        self.assertEqual(self.request("POST", "/api/proposals/%s/decision" % proposal["id"], {"status": "selected"}, role="student")[0], 403)
        self.request("POST", "/api/proposals/%s/decision" % proposal["id"], {"status": "selected"})
        self.assertEqual(self.request("POST", "/api/proposals/%s/submit-stage" % proposal["id"], {"title": "Прототип", "evidenceUrl": "https://example.com"}, role="student", team="t1")[0], 403)
        own = self.request("GET", "/api/bootstrap", role="student", team="t1")[1]["proposals"]
        self.assertTrue(all(p["teamId"] == "t1" for p in own))

    def test_progress_requires_submitted_selected_stage(self):
        proposal = self.propose({"id": "task2"}, team="t4")
        base = "/api/proposals/" + proposal["id"]
        self.assertEqual(self.request("POST", base + "/confirm-stage", {})[0], 409)
        self.assertEqual(self.request("POST", base + "/submit-stage", {"title": "Прототип", "evidenceUrl": "https://example.com"}, role="student", team="t4")[0], 409)
        self.request("POST", base + "/decision", {"status": "selected"})
        self.request("POST", base + "/submit-stage", {"title": "Прототип", "evidenceUrl": "https://example.com"}, role="student", team="t4")
        before = next(t["points"] for t in self.request("GET", "/api/bootstrap")[1]["teams"] if t["id"] == "t4")
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.request("POST", base + "/confirm-stage", {}), range(4)))
        self.assertTrue(all(code == 200 for code, _ in responses))
        after = next(t["points"] for t in self.request("GET", "/api/bootstrap")[1]["teams"] if t["id"] == "t4")
        self.assertEqual(after, before + 10)
        self.assertEqual(self.request("POST", base + "/decision", {"status": "rejected"})[0], 409)

    def test_validation_missing_title_confirmation_and_bad_url(self):
        task = self.create()
        self.assertEqual(self.request("POST", "/api/tasks/%s/publish" % task["id"], {"confirmed": True, "revision": task["revision"]})[0], 422)
        task = self.save(task, {"title": "Задача перед публикацией"})
        self.assertEqual(self.request("POST", "/api/tasks/%s/publish" % task["id"], {"confirmed": False, "revision": task["revision"]})[0], 422)
        self.assertEqual(self.request("POST", "/api/tasks/task1/proposals", {"idea": "Новая идея", "plan": "План работ", "timeline": "Неделя", "prototypeUrl": "javascript:alert(1)"}, role="student")[0], 422)
        self.assertEqual(self.request("POST", "/api/tasks", {"draft": "x" * 12001, "industry": "Другое"})[0], 422)

    def test_bad_json_origin_no_secret_static_leak(self):
        self.assertEqual(self.request("POST", "/api/tasks", raw=b'{broken')[0], 400)
        self.assertEqual(self.request("POST", "/api/tasks", {"draft": "Новая задача", "industry": "Другое"}, extra={"Origin": "https://other.example"})[0], 403)
        self.assertEqual(self.request("GET", "/%2e%2e/server.py")[0], 404)
        self.assertEqual(self.request("GET", "/.env")[0], 404)
        self.assertEqual(self.request("GET", "/api/bootstrap", role="unknown")[0], 403)
        self.assertEqual(self.request("GET", "/api/bootstrap", role="student", team="unknown")[0], 422)


if __name__ == "__main__":
    unittest.main()
