"""Reject dependency cycles and imports that invert application boundaries."""

import ast
import re
from pathlib import Path


class ArchitectureError(ValueError):
    """A source import violates the repository's dependency boundaries."""


def python_dependencies(root: Path) -> dict[Path, tuple[Path, ...]]:
    sources = tuple(root.rglob("*.py"))
    graph: dict[Path, tuple[Path, ...]] = {}
    for source in sources:
        dependencies: list[Path] = []
        for node in ast.walk(ast.parse(source.read_text())):
            modules = (
                (node.module,)
                if isinstance(node, ast.ImportFrom) and node.module is not None
                else tuple(alias.name for alias in node.names)
                if isinstance(node, ast.Import)
                else ()
            )
            for module in modules:
                if not module.startswith("transler."):
                    continue
                target = root.joinpath(*module.split(".")[1:]).with_suffix(".py")
                if not target.is_file():
                    target = target.with_suffix("") / "__init__.py"
                if not target.is_file():
                    raise ArchitectureError(f"{source}: unresolved Python import {module}")
                dependencies.append(target)
        graph[source] = tuple(dependencies)
    return graph


def typescript_dependencies(root: Path) -> dict[Path, tuple[Path, ...]]:
    graph: dict[Path, tuple[Path, ...]] = {}
    for source in (*root.rglob("*.ts"), *root.rglob("*.tsx")):
        dependencies: list[Path] = []
        for match in re.finditer(
            r"(?:import\s+(?:([^;]*?)\s+from\s+)?|import\s*\(\s*)[\"'](\.[^\"']+)[\"']",
            source.read_text(),
        ):
            clause, specifier = match.groups()
            # Type-only references do not create runtime dependency cycles.
            if clause and (
                clause.strip().startswith("type ")
                or all(
                    binding.strip().startswith("type ")
                    for binding in clause.strip().strip("{}").split(",")
                    if binding.strip()
                )
            ):
                continue
            location = (source.parent / specifier.split("?")[0]).resolve()
            if location.suffix == ".js":
                location = location.with_suffix(".ts")
            candidates = (location, Path(str(location) + ".ts"), Path(str(location) + ".tsx"))
            target = next((path for path in candidates if path.is_file()), None)
            if target is None:
                raise ArchitectureError(f"{source}: unresolved TypeScript import {specifier}")
            if target.suffix in {".ts", ".tsx"}:
                dependencies.append(target)
        graph[source] = tuple(dependencies)
    return graph


def validate_boundaries(
    graph: dict[Path, tuple[Path, ...]], root: Path, forbidden: dict[str, tuple[str, ...]]
) -> None:
    for source, dependencies in graph.items():
        layer = source.relative_to(root).parts[0]
        for dependency in dependencies:
            target = dependency.relative_to(root).parts[0]
            if target in forbidden.get(layer, ()):
                raise ArchitectureError(
                    f"{source}: {layer} must not depend on {target}: {dependency}"
                )


def validate_cycles(graph: dict[Path, tuple[Path, ...]]) -> None:
    visited: set[Path] = set()
    active: list[Path] = []

    def visit(source: Path) -> None:
        if source in active:
            cycle = active[active.index(source) :] + [source]
            raise ArchitectureError("Dependency cycle: " + " -> ".join(str(path) for path in cycle))
        if source in visited:
            return
        active.append(source)
        for dependency in graph.get(source, ()):
            visit(dependency)
        active.pop()
        visited.add(source)

    for source in graph:
        visit(source)


def main() -> None:
    repository = Path(__file__).resolve().parents[1]
    roots = (
        (
            repository / "backend/src/transler",
            python_dependencies,
            {
                "core": ("jobs", "http", "processing", "infrastructure", "worker.py"),
                "processing": ("jobs", "http", "infrastructure", "worker.py"),
                "infrastructure": ("jobs", "http", "processing", "worker.py"),
                "jobs": ("http", "worker.py"),
                "http": ("jobs", "worker.py"),
            },
        ),
        (
            repository / "api/src",
            typescript_dependencies,
            {"shared": ("app", "modules", "infrastructure"), "infrastructure": ("app", "modules")},
        ),
        (
            repository / "frontend/src",
            typescript_dependencies,
            {"shared": ("app", "features")},
        ),
    )
    for root, dependencies, forbidden in roots:
        graph = dependencies(root)
        validate_boundaries(graph, root, forbidden)
        validate_cycles(graph)
        print(f"Architecture verified: {root.relative_to(repository)} ({len(graph)} modules)")


if __name__ == "__main__":
    main()
