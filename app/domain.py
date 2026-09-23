"""Deterministic task-readiness rules from the HackAlem specification.

AI does not calculate scores. Points require an explicit human confirmation and
a non-placeholder string. This is a transparent completeness check, not an
automated judgment of whether a business statement is true.
"""

import ipaddress
import re
import unicodedata
from urllib.parse import urlsplit


FIELD_LABELS = {
    "title": "Название",
    "context": "Контекст",
    "need": "Потребность",
    "users": "Пользователи",
    "data": "Данные и материалы",
    "constraints": "Ограничения",
    "outcome": "Ожидаемый результат",
    "success": "Критерии успеха",
    "contact": "Контакт",
    "interaction": "Формат взаимодействия",
}

INDUSTRIES = [
    "Общественное питание",
    "Логистика",
    "Образование",
    "Сельское хозяйство",
    "Ритейл",
    "Услуги",
    "Другое",
]

FIELD_MAX_LENGTHS = {key: (180 if key == "title" else 4000) for key in FIELD_LABELS}

# Within each group the weights are explicit; there is no hidden model score.
RUBRIC = (
    ("context_need", "Контекст и потребность", (("context", 10), ("need", 10))),
    ("data", "Данные и материалы", (("data", 20),)),
    ("outcome", "Ожидаемый результат", (("outcome", 15),)),
    ("success", "Критерии успеха", (("success", 15),)),
    ("constraints", "Ограничения", (("constraints", 10),)),
    ("users", "Пользователи", (("users", 10),)),
    ("contact_interaction", "Связь с бизнесом", (("contact", 5), ("interaction", 5))),
)

_PLACEHOLDERS = {
    "не указано", "не указан", "не указана", "не указаны", "неизвестно",
    "не знаю", "пока неизвестно", "нет", "нет данных", "нет информации",
    "отсутствует", "отсутствуют", "уточняется", "уточнить", "нужно уточнить",
    "требует уточнения", "требуется уточнение", "не определено", "не определен",
    "пока не определено", "позже", "будет позже", "заполнить", "ответ",
    "тест", "пример", "placeholder", "test", "todo", "tbd", "n a", "na",
    "none", "null", "undefined", "unknown", "not specified", "not provided",
}


def _normalize_text(value):
    """Trim lines, unify newlines, preserve meaningful paragraph structure."""
    value = unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.strip() for line in value.split("\n")).strip()


def field_is_meaningful(value):
    if not isinstance(value, str):
        return False
    # Normalizing punctuation also rejects common placeholders such as N/A,
    # «Не указано.» and strings made only of dashes or question marks.
    normalized = unicodedata.normalize("NFKC", value).casefold().replace("ё", "е")
    normalized = " ".join(re.findall(r"[^\W_]+", normalized, flags=re.UNICODE))
    return (
        len(normalized.replace(" ", "")) >= 3
        and normalized not in _PLACEHOLDERS
    )


def validate_fields(fields):
    """Return all ten normalized fields or raise a user-readable ValueError."""
    if not isinstance(fields, dict):
        raise ValueError("Поля карточки должны быть JSON-объектом.")
    if any(key not in FIELD_LABELS for key in fields):
        raise ValueError("Карточка содержит неизвестные поля.")
    result = {}
    for key, label in FIELD_LABELS.items():
        value = fields.get(key, "")
        if not isinstance(value, str):
            raise ValueError("Поле «%s» должно содержать текст." % label)
        if len(value) > FIELD_MAX_LENGTHS[key]:
            raise ValueError("Поле «%s» не должно превышать %d символов." % (label, FIELD_MAX_LENGTHS[key]))
        if any(ord(char) < 32 and char not in "\n\r\t" for char in value):
            raise ValueError("Поле «%s» содержит недопустимые управляющие символы." % label)
        result[key] = _normalize_text(value)
    return result


def valid_url(value):
    """Accept an absolute HTTP(S) URL with a syntactically valid host.

    Validation never makes a network request and does not claim a prototype is
    reachable. Domain names, IPv4 and IPv6 are supported; credentials and local
    host-only names are not valid prototype links for the shared catalog.
    """
    if not isinstance(value, str) or not value or len(value) > 2048:
        return False
    if any(char.isspace() or ord(char) < 32 for char in value) or "\\" in value:
        return False
    try:
        parts = urlsplit(value)
        if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
            return False
        if parts.username is not None or parts.password is not None:
            return False
        host = parts.hostname
        if not host or parts.port == 0:
            return False
        # Evaluating .port also rejects nonnumeric and out-of-range ports.
        if parts.port is not None and not (1 <= parts.port <= 65535):
            return False
        try:
            ipaddress.ip_address(host)
            return True
        except ValueError:
            pass
        host = host.rstrip(".").encode("idna").decode("ascii")
        if len(host) > 253:
            return False
        labels = host.split(".")
        if len(labels) < 2 or labels[-1].isdigit():
            return False
        return all(re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label) for label in labels)
    except (ValueError, UnicodeError):
        return False


def _level_for_score(total):
    if total < 40:
        return "draft", "Черновик"
    if total < 70:
        return "working", "Рабочая"
    if total < 90:
        return "ready", "Готовая"
    return "priority", "Приоритетная"


def score_task(fields, confirmed_fields):
    """Calculate seven rubric categories using only allowed confirmed fields."""
    values = fields if isinstance(fields, dict) else {}
    confirmations = confirmed_fields if isinstance(confirmed_fields, (list, tuple, set, frozenset)) else []
    confirmed = {key for key in confirmations if isinstance(key, str) and key in FIELD_LABELS}
    breakdown = []
    missing = []
    suggestions = []
    total = 0
    for category, label, members in RUBRIC:
        earned = 0
        category_missing = []
        for key, points in members:
            meaningful = field_is_meaningful(values.get(key))
            if meaningful and key in confirmed:
                earned += points
            else:
                missing.append(key)
                category_missing.append(key)
                verb = "Проверьте и подтвердите" if meaningful else "Заполните и подтвердите"
                suggestions.append("%s поле «%s»: +%d баллов." % (verb, FIELD_LABELS[key], points))
        breakdown.append({
            "id": category,
            "label": label,
            "weight": sum(points for _, points in members),
            "earned": earned,
            "missingFields": category_missing,
        })
        total += earned
    level, label = _level_for_score(total)
    return {
        "total": total,
        "level": level,
        "levelLabel": label,
        "breakdown": breakdown,
        "missingFields": missing,
        "suggestions": suggestions,
    }
