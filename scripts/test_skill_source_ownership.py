import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("ownership", Path(__file__).with_name("skill_source_ownership.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class OwnershipTests(unittest.TestCase):
    def test_tracked_definitions_rejected_and_generated_files_allowed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            subprocess.run(["git", "init", "-q", temp], check=True)
            (root / ".gitignore").write_text("generated/\n")
            (root / "business.py").write_text("pass\n")
            (root / "generated").mkdir()
            (root / "generated/SKILL.md").write_text("generated")
            (root / "SKILL.md").write_text("untracked")
            subprocess.run(["git", "-C", temp, "add", ".gitignore", "business.py"], check=True)
            self.assertEqual(module.violations(root), [])
            for name in ["SKILL.md", "folder with spaces/skill.md"]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("definition")
                subprocess.run(["git", "-C", temp, "add", name], check=True)
            self.assertEqual(set(module.violations(root)), {"SKILL.md", "folder with spaces/skill.md"})

if __name__ == "__main__":
    unittest.main()
