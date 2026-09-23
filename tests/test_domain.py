import itertools
import unittest

from app.domain import (
    FIELD_LABELS, _level_for_score, field_is_meaningful, score_task,
    valid_url, validate_fields,
)
from app.seed import seed_data


WEIGHTS = {
    "context": 10, "need": 10, "data": 20, "outcome": 15, "success": 15,
    "constraints": 10, "users": 10, "contact": 5, "interaction": 5,
}


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.fields = {key: "Конкретные сведения от бизнеса" for key in FIELD_LABELS}

    def test_all_confirmation_subsets_obey_weights_and_levels(self):
        keys = list(WEIGHTS)
        for count in range(len(keys) + 1):
            for confirmed in itertools.combinations(keys, count):
                with self.subTest(confirmed=confirmed):
                    score = score_task(self.fields, list(confirmed))
                    expected = sum(WEIGHTS[key] for key in confirmed)
                    self.assertEqual(score["total"], expected)
                    self.assertEqual(score["total"], sum(row["earned"] for row in score["breakdown"]))
                    self.assertEqual(sum(row["weight"] for row in score["breakdown"]), 100)
                    self.assertEqual(len(score["breakdown"]), 7)
                    self.assertEqual(set(score["missingFields"]), set(keys) - set(confirmed))
                    self.assertEqual(len(score["suggestions"]), len(keys) - len(confirmed))
                    expected_level = "priority" if expected >= 90 else "ready" if expected >= 70 else "working" if expected >= 40 else "draft"
                    self.assertEqual(score["level"], expected_level)

    def test_exact_level_boundaries(self):
        # Current integer weights produce multiples of 5. The helper additionally
        # verifies the specification's exact 39/69/89 upper boundaries.
        for total, key, label in [
            (0, "draft", "Черновик"), (39, "draft", "Черновик"),
            (40, "working", "Рабочая"), (69, "working", "Рабочая"),
            (70, "ready", "Готовая"), (89, "ready", "Готовая"),
            (90, "priority", "Приоритетная"), (100, "priority", "Приоритетная"),
        ]:
            with self.subTest(total=total):
                self.assertEqual(_level_for_score(total), (key, label))

    def test_title_is_required_elsewhere_but_does_not_earn_score(self):
        self.assertEqual(score_task(self.fields, ["title"])["total"], 0)
        self.assertNotIn("title", score_task({}, [])["missingFields"])

    def test_unknown_keys_and_duplicate_confirmations_never_inflate_score(self):
        fields = dict(self.fields, bonus="Подтверждено", arbitrary="Да")
        score = score_task(fields, list(FIELD_LABELS) * 5 + ["bonus", "arbitrary", 100, None])
        self.assertEqual(score["total"], 100)
        self.assertEqual(score["missingFields"], [])
        self.assertEqual(score["suggestions"], [])

    def test_filled_but_unconfirmed_card_stays_zero(self):
        score = score_task(self.fields, [])
        self.assertEqual(score["total"], 0)
        self.assertTrue(all(text.startswith("Проверьте и подтвердите") for text in score["suggestions"]))

    def test_blank_or_placeholder_does_not_earn_even_when_confirmed(self):
        for value in ["", "  \n\t", "Не указано", "НЕ УКАЗАНО.", "N/A", "???", "---", "todo", "нет данных"]:
            with self.subTest(value=value):
                fields = {key: value for key in FIELD_LABELS}
                score = score_task(fields, list(FIELD_LABELS))
                self.assertEqual(score["total"], 0)
                self.assertTrue(all(text.startswith("Заполните и подтвердите") for text in score["suggestions"]))

    def test_partial_categories_are_transparent(self):
        score = score_task(self.fields, ["need", "contact"])
        context = score["breakdown"][0]
        contact = score["breakdown"][-1]
        self.assertEqual(score["total"], 15)
        self.assertEqual((context["weight"], context["earned"], context["missingFields"]), (20, 10, ["context"]))
        self.assertEqual((contact["weight"], contact["earned"], contact["missingFields"]), (10, 5, ["interaction"]))

    def test_clearing_a_confirmed_value_reduces_score(self):
        self.assertEqual(score_task(self.fields, list(FIELD_LABELS))["total"], 100)
        self.fields["data"] = ""
        self.assertEqual(score_task(self.fields, list(FIELD_LABELS))["total"], 80)

    def test_malformed_types_never_earn_score_or_crash(self):
        self.assertEqual(score_task(None, None)["total"], 0)
        self.assertEqual(score_task(self.fields, "data")["total"], 0)
        self.assertEqual(score_task({"data": {"value": "text"}}, ["data"])["total"], 0)


class FieldValidationTests(unittest.TestCase):
    def test_empty_object_provides_all_ten_empty_defaults(self):
        self.assertEqual(validate_fields({}), {key: "" for key in FIELD_LABELS})

    def test_normalize_line_endings_and_outer_whitespace(self):
        result = validate_fields({"context": "  Первая строка.\r\n  Вторая строка. \n\n "})
        self.assertEqual(result["context"], "Первая строка.\nВторая строка.")

    def test_unknown_keys_are_rejected(self):
        for key in ["score", "confirmedFields", "__proto__", 42]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_fields({key: "Подмена"})

    def test_non_objects_and_non_text_are_rejected(self):
        for value in [[], None, "text", 123]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_fields(value)
        for value in [None, 100, True, [], {}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_fields({"context": value})

    def test_field_size_boundaries(self):
        for key, maximum in [("title", 180), ("context", 4000)]:
            with self.subTest(key=key):
                self.assertEqual(len(validate_fields({key: "а" * maximum})[key]), maximum)
                with self.assertRaises(ValueError):
                    validate_fields({key: "а" * (maximum + 1)})

    def test_control_characters_are_rejected(self):
        for text in ["Текст\x00ещё", "Текст\x1bещё"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                validate_fields({"context": text})

    def test_meaningfulness_is_structural_not_invented_fact_judgment(self):
        for text in ["CSV", "Нет технологических ограничений", "Данные пока не собраны; подготовим учебный CSV."]:
            with self.subTest(text=text):
                self.assertTrue(field_is_meaningful(text))
        for text in [None, False, {}, 123, "а", "_"]:
            with self.subTest(text=text):
                self.assertFalse(field_is_meaningful(text))


class URLValidationTests(unittest.TestCase):
    def test_valid_absolute_prototype_links(self):
        for value in [
            "https://example.com/prototype", "http://example.com:8080/demo?x=1#view",
            "HTTPS://EXAMPLE.COM/path", "https://demo.example.com/",
            "https://пример.рф/макет", "http://127.0.0.1:3000/demo",
            "http://[::1]:3000/demo",
        ]:
            with self.subTest(value=value):
                self.assertTrue(valid_url(value))

    def test_unsafe_or_malformed_links(self):
        for value in [
            None, [], 100, "", "example.com", "/prototype", "//example.com/demo",
            "javascript:alert(1)", "data:text/html,hello", "file:///tmp/demo.html",
            "ftp://example.com", "https://", "https:///path", "https://localhost/demo",
            "https://example", "https://exa_mple.com", "https://-example.com",
            "https://example-.com", "https://example..com", "https://example.123",
            "https://user:password@example.com", "https://example.com:abc",
            "https://example.com:65536", "https://example.com:0", "https://[broken]",
            "https://example.com/with space", " https://example.com", "https://example.com\n",
            "https://example.com\\evil", "https://" + "a" * 64 + ".com",
            "https://example.com/" + "x" * 2048,
        ]:
            with self.subTest(value=value):
                self.assertFalse(valid_url(value))


class SeedDataTests(unittest.TestCase):
    def test_minimum_data_volumes_and_fixed_ids(self):
        data = seed_data()
        published = [task for task in data["tasks"] if task["status"] == "published"]
        drafts = [task for task in data["tasks"] if task["status"] == "draft"]
        self.assertEqual({task["id"] for task in published}, {"task%d" % i for i in range(1, 6)})
        self.assertEqual({task["id"] for task in drafts}, {"draft%d" % i for i in range(1, 6)})
        self.assertEqual({team["id"] for team in data["teams"]}, {"t%d" % i for i in range(1, 6)})
        self.assertEqual({p["id"] for p in data["proposals"]}, {"p%d" % i for i in range(1, 6)})
        self.assertEqual({task["score"]["level"] for task in published}, {"draft", "working", "ready", "priority"})
        self.assertGreaterEqual(len({task["industry"] for task in drafts}), 5)

    def test_seed_cards_have_all_fields_and_computed_scores(self):
        for task in seed_data()["tasks"]:
            with self.subTest(task=task["id"]):
                self.assertEqual(task["fields"], validate_fields(task["fields"]))
                self.assertEqual(task["score"], score_task(task["fields"], task["confirmedFields"]))
                self.assertTrue(task["draft"])
                if task["status"] == "draft":
                    self.assertEqual(task["confirmedFields"], [])
                    self.assertEqual(task["score"]["total"], 0)

    def test_seed_proposals_reference_existing_entities_and_full_content(self):
        data = seed_data()
        tasks = {task["id"] for task in data["tasks"] if task["status"] == "published"}
        teams = {team["id"] for team in data["teams"]}
        for proposal in data["proposals"]:
            with self.subTest(proposal=proposal["id"]):
                self.assertIn(proposal["taskId"], tasks)
                self.assertIn(proposal["teamId"], teams)
                self.assertEqual(proposal["status"], "pending")
                self.assertIsNone(proposal["milestone"])
                for key in ("idea", "plan", "timeline"):
                    self.assertTrue(field_is_meaningful(proposal[key]))
                self.assertTrue(valid_url(proposal["prototypeUrl"]))
                self.assertTrue(proposal["prototypeUrl"].startswith("https://example.com/"))

    def test_profiles_contain_only_required_team_attributes(self):
        for team in seed_data()["teams"]:
            self.assertEqual(set(team), {"id", "name", "interests", "skills", "technologies", "points"})
            self.assertEqual(team["points"], 0)
            for key in ("interests", "skills", "technologies"):
                self.assertTrue(team[key])
                self.assertTrue(all(isinstance(value, str) for value in team[key]))

    def test_seed_calls_return_independent_mutable_data(self):
        first = seed_data()
        first["tasks"][0]["fields"]["title"] = "Изменено"
        first["teams"][0]["skills"].append("Изменено")
        second = seed_data()
        self.assertNotEqual(first["tasks"][0]["fields"]["title"], second["tasks"][0]["fields"]["title"])
        self.assertNotIn("Изменено", second["teams"][0]["skills"])


if __name__ == "__main__":
    unittest.main()
