import ast

ALLOWED_IMPORTS = {"manim", "math", "numpy"}
FORBIDDEN_NAMES = {
    "eval",
    "exec",
    "compile",
    "open",
    "input",
    "breakpoint",
    "__import__",
    "getattr",
    "setattr",
    "delattr",
    "globals",
    "locals",
    "vars",
    "memoryview",
    "os",
    "sys",
    "subprocess",
    "socket",
    "pathlib",
    "shutil",
    "importlib",
    "builtins",
    "config",
    "tempconfig",
}
MAX_LINES = 300


def check(source: str) -> list[str]:
    if len(source.splitlines()) > MAX_LINES:
        return [f"the file has more than {MAX_LINES} lines"]
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return [f"syntax error line {error.lineno}: {error.msg}"]

    problems: list[str] = []
    scenes = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] not in ALLOWED_IMPORTS:
                    problems.append(f"line {node.lineno}: import of {alias.name} is not allowed")
        elif isinstance(node, ast.ImportFrom):
            module = (node.module or "").split(".")[0]
            if node.level != 0 or module not in ALLOWED_IMPORTS:
                problems.append(f"line {node.lineno}: import from {node.module} is not allowed")
        elif isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES or node.id.startswith("__"):
                problems.append(f"line {node.lineno}: use of {node.id} is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                problems.append(f"line {node.lineno}: access to {node.attr} is not allowed")
        elif isinstance(node, ast.ClassDef):
            bases = [base.id if isinstance(base, ast.Name) else getattr(base, "attr", "") for base in node.bases]
            if any(base.endswith("Scene") for base in bases):
                scenes += 1
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            problems.append(f"line {node.lineno}: global and nonlocal are not allowed")
    if scenes != 1:
        problems.append(f"expected exactly one class deriving from Scene, found {scenes}")
    return problems


def scene_name(source: str) -> str:
    for node in ast.parse(source).body:
        if isinstance(node, ast.ClassDef):
            bases = [base.id if isinstance(base, ast.Name) else getattr(base, "attr", "") for base in node.bases]
            if any(base.endswith("Scene") for base in bases):
                return node.name
    raise ValueError("no scene class")
