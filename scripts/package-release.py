"""Package built assets and an AI-ready source folder, without vault data."""
import argparse
import json
from pathlib import Path
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    assert json.loads((root / "package.json").read_text())["version"] == version
    assets = ["main.js", "manifest.json", "styles.css"]
    assert all((root / name).is_file() for name in assets)
    args.output.mkdir(parents=True, exist_ok=True)
    install_zip = args.output / f"edit-history-install-{version}.zip"
    source_zip = args.output / f"edit-history-ai-ready-full-folder-{version}.zip"
    with zipfile.ZipFile(install_zip, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in assets:
            archive.write(root / name, f"edit-history/{name}")
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode().split("\0")
    names = set(names + assets)
    with zipfile.ZipFile(source_zip, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(names):
            if not name or name.startswith("releases/") or not (root / name).is_file():
                continue
            assert Path(name).name not in ("data.json", ".env")
            archive.write(root / name, f"obsidian-edit-history/{name}")
    for target in (install_zip, source_zip):
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
            top = "edit-history" if target == install_zip else "obsidian-edit-history"
            assert json.loads(archive.read(f"{top}/manifest.json"))["version"] == version
        print(target.resolve())


if __name__ == "__main__":
    main()
