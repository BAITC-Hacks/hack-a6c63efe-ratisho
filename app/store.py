"""SQLite-backed workflow. Every state transition is checked server-side."""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .domain import FIELD_LABELS, score_task, validate_fields, valid_url, field_is_meaningful
from .seed import seed_data


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class WorkflowError(Exception):
    def __init__(self, message, status=422, code="validation"):
        super().__init__(message)
        self.status = status
        self.code = code


def text_value(value, label, limit=4000, required=True):
    if not isinstance(value, str):
        raise WorkflowError("Поле «%s» должно быть текстом." % label)
    value = value.strip()
    if len(value) > limit:
        raise WorkflowError("Поле «%s» длиннее %s символов." % (label, limit))
    if required and not field_is_meaningful(value):
        raise WorkflowError("Заполните поле «%s»." % label)
    return value


class Store:
    def __init__(self, db_path):
        self.path = str(db_path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection(write=True) as db:
            db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("""CREATE TABLE IF NOT EXISTS proposals (
                id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
                team_id TEXT NOT NULL REFERENCES teams(id), payload TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_proposals_task ON proposals(task_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_proposals_team ON proposals(team_id)")
            if not db.execute("SELECT value FROM metadata WHERE key='initialized'").fetchone():
                data = seed_data()
                for task in data["tasks"]:
                    self._save_task(db, task)
                for team in data["teams"]:
                    db.execute("INSERT INTO teams VALUES (?, ?)", (team["id"], self._dump(team)))
                for proposal in data["proposals"]:
                    self._save_proposal(db, proposal)
                db.execute("INSERT INTO metadata VALUES ('initialized', '1')")

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _dump(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def _save_task(self, db, task):
        clean = dict(task)
        clean.pop("score", None)
        db.execute("INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                   (clean["id"], self._dump(clean)))

    def _save_proposal(self, db, proposal):
        db.execute("""INSERT INTO proposals VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET payload=excluded.payload""",
                   (proposal["id"], proposal["taskId"], proposal["teamId"], self._dump(proposal)))

    @staticmethod
    def _task(db, task_id):
        row = db.execute("SELECT payload FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            raise WorkflowError("Задача не найдена.", 404, "not_found")
        task = json.loads(row[0])
        task["score"] = score_task(task["fields"], task["confirmedFields"])
        return task

    @staticmethod
    def _proposal(db, proposal_id):
        row = db.execute("SELECT payload FROM proposals WHERE id=?", (proposal_id,)).fetchone()
        if not row:
            raise WorkflowError("Предложение не найдено.", 404, "not_found")
        return json.loads(row[0])

    @staticmethod
    def _teams(db):
        teams = [json.loads(row[0]) for row in db.execute("SELECT payload FROM teams ORDER BY id")]
        points = {team["id"]: 0 for team in teams}
        for row in db.execute("SELECT payload FROM proposals"):
            p = json.loads(row[0])
            stage = p.get("milestone")
            if stage and stage.get("confirmedAt"):
                points[p["teamId"]] += stage["points"]
        for team in teams:
            team["points"] = points[team["id"]]
        return teams

    def bootstrap(self, role, team_id):
        with self.connection() as db:
            tasks = []
            for row in db.execute("SELECT id FROM tasks"):
                task = self._task(db, row[0])
                if role == "business" or task["status"] == "published":
                    tasks.append(task)
            tasks.sort(key=lambda t: (-t["score"]["total"], t["id"]))
            query = "SELECT payload FROM proposals"
            args = ()
            if role == "student":
                query += " WHERE team_id=?"
                args = (team_id,)
            proposals = [json.loads(row[0]) for row in db.execute(query, args)]
            proposals.sort(key=lambda p: (p["createdAt"], p["id"]), reverse=True)
            return {"tasks": tasks, "teams": self._teams(db), "proposals": proposals}

    def require_team(self, team_id):
        with self.connection() as db:
            if not db.execute("SELECT id FROM teams WHERE id=?", (team_id,)).fetchone():
                raise WorkflowError("Выберите существующую команду.", 422, "invalid_team")

    def get_task(self, task_id):
        with self.connection() as db:
            return self._task(db, task_id)

    @staticmethod
    def _revision(task, revision):
        if type(revision) is not int or revision != task["revision"]:
            raise WorkflowError("Задача изменена в другой вкладке. Обновите данные перед сохранением.", 409, "stale_revision")

    @staticmethod
    def _changed(task):
        task["revision"] += 1
        task["updatedAt"] = now()
        task["score"] = score_task(task["fields"], task["confirmedFields"])

    def create_task(self, payload):
        draft = text_value(payload.get("draft"), "Описание", 12000)
        industry = text_value(payload.get("industry"), "Тема", 120)
        stamp = now()
        task = {"id": "task-" + uuid.uuid4().hex, "draft": draft, "industry": industry,
                "fields": {key: "" for key in FIELD_LABELS}, "confirmedFields": [], "status": "draft",
                "revision": 1, "createdAt": stamp, "updatedAt": stamp, "questions": [], "answers": {}}
        with self.connection(write=True) as db:
            self._save_task(db, task)
        task["score"] = score_task(task["fields"], [])
        return task

    def save_ai(self, task_id, revision, result, answers=None):
        with self.connection(write=True) as db:
            task = self._task(db, task_id)
            self._revision(task, revision)
            if task["status"] != "draft":
                raise WorkflowError("AI-конструктор доступен для неопубликованных черновиков.", 409, "already_published")
            if answers is None:
                task["questions"] = result["questions"]
            else:
                fields = validate_fields(result["fields"])
                task["confirmedFields"] = [key for key in task["confirmedFields"] if fields[key] == task["fields"][key]]
                task["fields"] = fields
                task["answers"] = answers
            self._changed(task)
            self._save_task(db, task)
            return task

    def update_task(self, task_id, payload):
        fields = validate_fields(payload.get("fields"))
        confirmed = payload.get("confirmedFields")
        if not isinstance(confirmed, list) or any(not isinstance(key, str) or key not in FIELD_LABELS for key in confirmed):
            raise WorkflowError("Некорректный список подтверждённых полей.")
        confirmed = [key for key in FIELD_LABELS if key in confirmed and field_is_meaningful(fields[key])]
        industry = text_value(payload.get("industry"), "Тема", 120)
        with self.connection(write=True) as db:
            task = self._task(db, task_id)
            self._revision(task, payload.get("revision"))
            if task["status"] == "published" and not field_is_meaningful(fields["title"]):
                raise WorkflowError("У опубликованной задачи должно быть название.")
            task.update(fields=fields, confirmedFields=confirmed, industry=industry)
            self._changed(task)
            self._save_task(db, task)
            return task

    def publish_task(self, task_id, payload):
        if payload.get("confirmed") is not True:
            raise WorkflowError("Подтвердите публикацию карточки.")
        with self.connection(write=True) as db:
            task = self._task(db, task_id)
            self._revision(task, payload.get("revision"))
            if not field_is_meaningful(task["fields"]["title"]):
                raise WorkflowError("Добавьте название перед публикацией.")
            task["status"] = "published"
            self._changed(task)
            self._save_task(db, task)
            return task

    def create_proposal(self, task_id, team_id, payload):
        idea = text_value(payload.get("idea"), "Идея решения")
        plan = text_value(payload.get("plan"), "План")
        timeline = text_value(payload.get("timeline"), "Срок", 300)
        url = text_value(payload.get("prototypeUrl"), "Ссылка на прототип", 2000)
        if not valid_url(url):
            raise WorkflowError("Укажите корректную ссылку на прототип, начинающуюся с https:// или http://.")
        with self.connection(write=True) as db:
            task = self._task(db, task_id)
            if task["status"] != "published":
                raise WorkflowError("Откликнуться можно только на опубликованную задачу.", 409, "not_published")
            if not db.execute("SELECT id FROM teams WHERE id=?", (team_id,)).fetchone():
                raise WorkflowError("Команда не найдена.", 404, "not_found")
            proposal = {"id": "proposal-" + uuid.uuid4().hex, "taskId": task_id, "teamId": team_id,
                        "idea": idea, "plan": plan, "timeline": timeline, "prototypeUrl": url,
                        "status": "pending", "createdAt": now(), "milestone": None}
            self._save_proposal(db, proposal)
            return proposal

    def decide(self, proposal_id, payload):
        status = payload.get("status")
        if status not in ("selected", "rejected"):
            raise WorkflowError("Выберите команду или отклоните предложение.")
        with self.connection(write=True) as db:
            proposal = self._proposal(db, proposal_id)
            if status == "rejected" and (proposal.get("milestone") or {}).get("confirmedAt"):
                raise WorkflowError("По этому предложению уже подтверждён этап. История сохраняется.", 409, "completed_progress")
            proposal["status"] = status
            self._save_proposal(db, proposal)
            return proposal

    def submit_stage(self, proposal_id, team_id, payload):
        title = text_value(payload.get("title"), "Название этапа", 300)
        url = text_value(payload.get("evidenceUrl"), "Ссылка на результат", 2000)
        if not valid_url(url):
            raise WorkflowError("Укажите корректную ссылку на результат (http:// или https://).")
        with self.connection(write=True) as db:
            proposal = self._proposal(db, proposal_id)
            if proposal["teamId"] != team_id:
                raise WorkflowError("Этот отклик принадлежит другой команде.", 403, "forbidden")
            if proposal["status"] != "selected":
                raise WorkflowError("Сдать этап может только выбранная бизнесом команда.", 409, "not_selected")
            if (proposal.get("milestone") or {}).get("confirmedAt"):
                raise WorkflowError("Этап уже подтверждён.", 409, "completed_progress")
            proposal["milestone"] = {"title": title, "evidenceUrl": url, "submittedAt": now(), "confirmedAt": None, "points": 0}
            self._save_proposal(db, proposal)
            return proposal

    def confirm_stage(self, proposal_id):
        with self.connection(write=True) as db:
            proposal = self._proposal(db, proposal_id)
            stage = proposal.get("milestone")
            if proposal["status"] != "selected" or not stage:
                raise WorkflowError("Сначала выбранная команда должна отправить результат этапа.", 409, "no_progress")
            if not stage.get("confirmedAt"):
                stage.update(confirmedAt=now(), points=10)
                self._save_proposal(db, proposal)
            return {"proposal": proposal, "teams": self._teams(db)}
