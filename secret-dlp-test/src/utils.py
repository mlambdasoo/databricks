"""Small utilities (ordinary source code — should be ALLOWED)."""


def chunk(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def slugify(text: str) -> str:
    return "-".join(text.lower().split())
