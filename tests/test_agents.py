import json
import os
import socket
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib import error

from app.agents import (
    AgentOrchestrator, AnalysisAgent, CompositionAgent, FIELDS, MAX_DRAFT,
    MAX_FIELD, MAX_REMOTE_BYTES, RemoteProvider, ValidationAgent,
)


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.environ = patch.dict(os.environ, {}, clear=True)
        self.environ.start()
        self.addCleanup(self.environ.stop)
        self.agent = AgentOrchestrator()
        self.draft = "У нас кофейня. Хотим уменьшить списания выпечки."

    def remote(self, result=None, exception=None):
        provider = Mock()
        if exception:
            provider.generate.side_effect = exception
        else:
            provider.generate.return_value = result
        self.agent.provider = provider
        return provider

    def grounded_response(self, fields=None, answers=None):
        fields, answers = fields or {}, answers or {}
        result = {key: {"value": "", "source": ""} for key in FIELDS}
        for field, value in fields.items():
            result[field] = {"value": value, "source": "fields." + field}
        for field, value in answers.items():
            result[field] = {"value": value, "source": "answers." + field}
        return {"fields": result}

    def test_local_mode_is_honest_and_questions_contextual(self):
        result = self.agent.questions(self.draft, "Общественное питание")
        self.assertEqual(self.agent.mode, "local")
        self.assertEqual(result["mode"], "local")
        self.assertIn("без языковой модели", result["warning"])
        self.assertGreaterEqual(len(result["questions"]), 3)
        self.assertIn("кофейня", result["questions"][0]["text"])
        self.assertEqual({q["field"] for q in result["questions"]}, set(FIELDS))
        self.assertEqual(len(result["questions"]), len({q["id"] for q in result["questions"]}))
        self.assertEqual([t["agent"] for t in result["trace"]], ["analysis", "interview", "validation"])

    def test_complete_card_still_gets_three_review_questions(self):
        fields = {key: "Проверенная информация" for key in FIELDS}
        result = self.agent.questions(self.draft, "", fields)
        self.assertEqual(len(result["questions"]), 3)
        self.assertTrue(all("для проверки карточки" in q["text"] for q in result["questions"]))

    def test_questions_prioritize_missing_fields(self):
        fields = {key: "Уже указано" for key in FIELDS if key not in ("data", "users", "success")}
        result = self.agent.questions(self.draft, "", fields)
        self.assertEqual({q["field"] for q in result["questions"]}, {"data", "users", "success"})

    def test_extracts_only_explicit_need_leaves_unknowns_empty(self):
        result = self.agent.compose(self.draft, "Питание", {})
        self.assertEqual(set(result["fields"]), set(FIELDS))
        self.assertEqual(result["fields"]["context"], self.draft)
        self.assertEqual(result["fields"]["need"], "Хотим уменьшить списания выпечки.")
        for key in ("users", "data", "constraints", "outcome", "success", "contact", "interaction"):
            self.assertEqual(result["fields"][key], "")

    def test_no_inferred_need(self):
        result = self.agent.compose("У нас кофейня", "Питание", {})
        self.assertEqual(result["fields"]["need"], "")
        self.assertEqual(result["fields"]["success"], "")

    def test_answers_map_only_to_the_target_field_and_preserve_edits(self):
        answers = {"data": "CSV с продажами за 3 месяца", "contact": "Анна, manager@example.test"}
        fields = {"title": "Авторское название", "success": "Точность не менее 80%"}
        result = self.agent.compose(self.draft, "", answers, fields)["fields"]
        self.assertEqual(result["data"], answers["data"])
        self.assertEqual(result["contact"], answers["contact"])
        self.assertEqual(result["title"], fields["title"])
        self.assertEqual(result["success"], fields["success"])
        self.assertEqual(result["users"], "")
        # Inputs are never mutated.
        self.assertEqual(len(fields), 2)
        self.assertEqual(len(answers), 2)

    def test_empty_answer_does_not_erase_manual_edit(self):
        result = self.agent.compose(self.draft, "", {"data": ""}, {"data": "CSV"})
        self.assertEqual(result["fields"]["data"], "CSV")

    def test_unknown_answer_does_not_invent_information(self):
        result = self.agent.compose(self.draft, "", {"success": "Не знаю", "data": "Данных нет"})
        self.assertEqual(result["fields"]["success"], "")
        self.assertEqual(result["fields"]["data"], "Данных нет")

    def test_punctuation_placeholder_is_not_a_fact(self):
        result = self.agent.compose(self.draft, "", {"success": "..."})
        self.assertEqual(result["fields"]["success"], "")

    def test_invalid_inputs_raise_clear_value_error(self):
        calls = [
            lambda: self.agent.questions("", ""),
            lambda: self.agent.questions(None, ""),
            lambda: self.agent.questions("x" * (MAX_DRAFT + 1), ""),
            lambda: self.agent.questions(self.draft, 4),
            lambda: self.agent.questions(self.draft, "x" * 121),
            lambda: self.agent.questions(self.draft, "", {"bogus": "x"}),
            lambda: self.agent.compose(self.draft, "", []),
            lambda: self.agent.compose(self.draft, "", None),
            lambda: self.agent.compose(self.draft, "", {"success": 90}),
            lambda: self.agent.compose(self.draft, "", {"data": "x" * (MAX_FIELD + 1)}),
            lambda: self.agent.compose(self.draft, "", {"title": "x" * 181}),
            lambda: self.agent.questions("text\x00end", ""),
        ]
        for call in calls:
            with self.subTest(call=call), self.assertRaises(ValueError):
                call()

    def test_long_accepted_draft_respects_field_limits(self):
        result = self.agent.compose("Кофейня " * 1000, "", {})["fields"]
        self.assertLessEqual(len(result["title"]), 180)
        self.assertLessEqual(len(result["context"]), MAX_FIELD)

    def test_valid_remote_questions_include_omitted_local_dimensions(self):
        self.remote({"questions": [
            {"field": "data", "text": "Какие файлы учёта списаний можно предоставить?"},
            {"field": "users", "text": "Кто будет пользоваться результатом?"},
            {"field": "success", "text": "Как проверить снижение списаний?"},
        ]})
        result = self.agent.questions(self.draft, "")
        self.assertEqual(result["mode"], "remote")
        self.assertEqual(result["warning"], "")
        self.assertEqual(len(result["questions"]), 10)
        self.assertIn("файлы учёта", result["questions"][0]["text"])

    def test_question_schema_errors_fall_back(self):
        invalid = [None, {}, {"questions": []}, {"questions": [{"field": "data", "text": "x?"}]},
                   {"questions": [{"field": "data", "text": "x?"}] * 3},
                   {"questions": [{"field": ["data"], "text": "x?"}] * 3},
                   {"questions": [{"field": "other", "text": "x?"}] * 3}]
        for value in invalid:
            with self.subTest(value=value):
                self.remote(value)
                result = self.agent.questions(self.draft, "")
                self.assertEqual(result["mode"], "local")
                self.assertGreaterEqual(len(result["questions"]), 3)
                self.assertIn("не прошёл проверку", result["warning"])

    def test_grounded_remote_fields_can_extract_quotes(self):
        answers = {"users": "Администратор кофейни"}
        fields = {"title": "Списания"}
        payload = self.grounded_response(fields, answers)
        payload["fields"]["need"] = {"value": "уменьшить списания выпечки", "source": "draft"}
        self.remote(payload)
        result = self.agent.compose(self.draft, "", answers, fields)
        self.assertEqual(result["mode"], "remote")
        self.assertEqual(result["fields"]["need"], "уменьшить списания выпечки")
        self.assertEqual(result["fields"]["users"], answers["users"])
        self.assertEqual(result["fields"]["context"], self.draft)

    def test_invented_fact_rejects_entire_model_card(self):
        payload = self.grounded_response()
        payload["fields"]["success"] = {"value": "Снижение списаний на 30%", "source": "draft"}
        self.remote(payload)
        result = self.agent.compose(self.draft, "", {})
        self.assertEqual(result["mode"], "local")
        self.assertEqual(result["fields"]["success"], "")
        self.assertTrue(any(step["status"] == "fallback" for step in result["trace"]))

    def test_model_cannot_rewrite_human_input_or_cross_assign_answer(self):
        answers = {"data": "Продажи за май"}
        payload = self.grounded_response(answers=answers)
        payload["fields"]["data"] = {"value": "Продажи за год", "source": "answers.data"}
        self.remote(payload)
        result = self.agent.compose(self.draft, "", answers)
        self.assertEqual(result["mode"], "local")
        self.assertEqual(result["fields"]["data"], "Продажи за май")
        payload = self.grounded_response(answers=answers)
        payload["fields"]["success"] = {"value": "Продажи за май", "source": "answers.data"}
        self.remote(payload)
        result = self.agent.compose(self.draft, "", answers)
        self.assertEqual(result["mode"], "local")
        self.assertEqual(result["fields"]["success"], "")

    def test_model_cannot_erase_existing_field(self):
        self.remote(self.grounded_response())
        result = self.agent.compose(self.draft, "", {}, {"contact": "test@example.test"})
        self.assertEqual(result["mode"], "local")
        self.assertEqual(result["fields"]["contact"], "test@example.test")

    def test_provider_failures_degrade_honestly_without_error_or_secret(self):
        failures = [socket.timeout("secret-api-key"), error.URLError("secret-api-key"),
                    ValueError("bad JSON secret-api-key"), OSError("Network down")]
        for failure in failures:
            with self.subTest(failure=failure):
                self.remote(exception=failure)
                for result in (self.agent.questions(self.draft, ""), self.agent.compose(self.draft, "", {})):
                    self.assertEqual(result["mode"], "local")
                    self.assertNotIn("secret-api-key", json.dumps(result))
                    self.assertTrue(result["warning"])

    def test_configuration_is_explicit_and_invalid_config_stays_local(self):
        with patch.dict(os.environ, {"AI_API_KEY": "test-key", "AI_MODEL": "test-model"}):
            self.assertEqual(AgentOrchestrator().mode, "remote")
        for config in ({"AI_API_KEY": "test"},
                       {"AI_API_KEY": "test", "AI_MODEL": "test", "AI_TIMEOUT_SECONDS": "nan"},
                       {"AI_API_KEY": "test", "AI_MODEL": "test", "AI_BASE_URL": "http://insecure.example"}):
            with self.subTest(config=config), patch.dict(os.environ, config):
                agent = AgentOrchestrator()
                self.assertEqual(agent.mode, "local")
                self.assertIn("Конфигурация", agent.questions(self.draft, "")["warning"])

    def test_explicit_local_mode_never_uses_existing_key(self):
        with patch.dict(os.environ, {"AI_API_KEY": "test", "AI_MODEL": "test", "AI_MODE": "local"}):
            agent = AgentOrchestrator()
            self.assertEqual(agent.mode, "local")
            self.assertIsNone(agent.provider)
        with patch.dict(os.environ, {"AI_MODE": "unrecognized"}):
            self.assertEqual(AgentOrchestrator().mode, "local")


class RemoteProviderTests(unittest.TestCase):
    def provider(self):
        return RemoteProvider("server-secret", "https://api.example.test/v1", "test-model", 2)

    def test_configuration_rejects_unsafe_or_malformed_urls(self):
        for url in ("http://example.test/v1", "file:///tmp/api", "https://u:p@example.test/v1",
                    "https://example.test/v1?secret=x", "https://example.test/#frag", "not-url"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                RemoteProvider("key", url, "model", 2)
        self.assertEqual(RemoteProvider("key", "http://localhost:1234/v1", "model", 2).timeout, 2)

    def test_overall_deadline_returns_even_when_transport_has_not_returned(self):
        provider = self.provider()
        provider.timeout = 0.03
        finished = threading.Event()

        def stalled(*args):
            finished.wait(0.5)
            return {}

        provider._generate = stalled
        started = time.monotonic()
        try:
            with self.assertRaises(socket.timeout):
                provider.generate("JSON", {})
            self.assertLess(time.monotonic() - started, 0.4)
        finally:
            finished.set()

    def test_success_request_has_timeout_json_contract_and_server_auth(self):
        provider = self.provider()
        response = Mock()
        response.read.return_value = json.dumps({"choices": [{
            "finish_reason": "stop", "message": {"content": '{"questions":[]}'},
        }]}).encode()
        context = Mock()
        context.__enter__ = Mock(return_value=response)
        context.__exit__ = Mock(return_value=False)
        provider._opener = Mock()
        provider._opener.open.return_value = context
        self.assertEqual(provider.generate("System JSON instruction", {"draft": "Кофейня"}), {"questions": []})
        req = provider._opener.open.call_args.args[0]
        self.assertEqual(req.get_header("Authorization"), "Bearer server-secret")
        self.assertEqual(provider._opener.open.call_args.kwargs["timeout"], 2)
        data = json.loads(req.data)
        self.assertEqual(data["response_format"], {"type": "json_object"})
        self.assertEqual(data["messages"][0]["role"], "system")
        response.read.assert_called_once_with(MAX_REMOTE_BYTES + 1)

    def test_invalid_remote_envelopes_are_rejected(self):
        values = [b"not-json", b"[]", b"{}", b"\xff", b"x" * (MAX_REMOTE_BYTES + 1),
                  b'{"choices": [], "choices": []}']
        envelopes = [
            {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]},
            {"choices": [{"finish_reason": "stop", "message": {"content": "[]"}}]},
            {"choices": [{"finish_reason": "stop", "message": {"content": "{}", "refusal": "no"}}]},
            {"choices": [{"finish_reason": "stop", "message": {"content": {}}}]},
            {"choices": [{"finish_reason": "stop", "message": {"content": '{"x":1,"x":2}'}}]},
            {"choices": [{"finish_reason": "stop", "message": {"content": '{"x":NaN}'}}]},
        ]
        values.extend(json.dumps(value).encode() for value in envelopes)
        for value in values:
            with self.subTest(value=value[:100]):
                provider = self.provider()
                response = Mock()
                response.read.return_value = value
                context = Mock()
                context.__enter__ = Mock(return_value=response)
                context.__exit__ = Mock(return_value=False)
                provider._opener = Mock()
                provider._opener.open.return_value = context
                with self.assertRaises(ValueError):
                    provider.generate("JSON", {})


if __name__ == "__main__":
    unittest.main()
