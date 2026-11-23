import io
import json
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")
FAKE_CLI = """
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.SILJANG_TEST_CALLS, args.join(' ') + '\\n');
if (args[0] === 'whoami') {
  const loggedIn = process.env.SILJANG_TEST_LOGIN === 'true';
  console.log(JSON.stringify({ loggedIn, authType: 'OAuth Token', email: 'owner@example.test' }));
  process.exitCode = loggedIn ? 0 : 1;
} else if (args[0] === '--version') {
  console.log('4.158.0');
} else if (args[0] === 'deploy') {
  console.error('Error: [code: 1000] Bearer synthetic-session-secret https://example.test owner@example.test '
    + process.env.CLOUDFLARE_ACCOUNT_ID + ' ' + (process.env.CLOUDFLARE_API_TOKEN || ''));
  process.exitCode = 1;
}
"""


@unittest.skipUnless(POWERSHELL and shutil.which("node"), "PowerShell and Node are required")
class AcademyWranglerTests(unittest.TestCase):
    def run_with_fake_ssh(self, script, args=(), *, logged_in=False, local_token=None):
        real_popen = subprocess.Popen
        calls = []
        with tempfile.TemporaryDirectory() as temp:
            cli = Path(temp) / "siljang-tools/node_modules/wrangler/wrangler-dist/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text(FAKE_CLI, encoding="utf-8")
            log = Path(temp) / "commands"
            env = {
                "SILJANG_TEST_CALLS": str(log),
                "SILJANG_TEST_LOGIN": str(logged_in).lower(),
                "CLOUDFLARE_ACCOUNT_ID": "synthetic-account",
                "CLOUDFLARE_API_TOKEN": "caller-only-credential",  # check-no-keys: allow 합성 시험 값
                "SILJANG_STORAGE_PROBE_URL": "https://example.test/api/healthz",
            }

            def fake_ssh(command, *popen_args, **kwargs):
                self.assertEqual(command[0], "ssh")
                self.assertIn("academy-pc", command)
                child_env = dict(os.environ, LOCALAPPDATA=temp, USERPROFILE=temp)
                child_env.pop("CLOUDFLARE_API_TOKEN")
                if local_token:
                    child_env["CLOUDFLARE_API_TOKEN"] = local_token
                shell_args = command[command.index("powershell") + 1:]
                process = real_popen([POWERSHELL, *shell_args], *popen_args, env=child_env, **kwargs)
                calls.append(process)
                if process.stdin:
                    write = process.stdin.write

                    def check_payload(payload):
                        self.assertNotIn("caller-only-credential", payload.decode())
                        self.assertNotIn("token", json.loads(payload))
                        return write(payload)

                    process.stdin.write = check_payload
                return process

            output = io.StringIO()
            with patch.dict(os.environ, env), patch.object(subprocess, "Popen", fake_ssh):
                with patch.object(sys, "argv", [str(script), *args]), redirect_stdout(output):
                    with self.assertRaises(SystemExit) as stopped:
                        runpy.run_path(str(script), run_name="__main__")
            for call in calls:
                if call.stdout:
                    call.stdout.close()
            return stopped.exception.code, output.getvalue(), log.read_text().splitlines() if log.exists() else []

    def test_unauthenticated_storage_stops_before_deploy(self):
        code, output, commands = self.run_with_fake_ssh(HERE / "run-native.py")
        self.assertEqual(code, 1)
        self.assertEqual(commands, ["whoami --json"])
        self.assertIn("학원컴에 Cloudflare 로그인이 없음", json.loads(output.splitlines()[0])["message"])

    def test_storage_deploy_diagnostics_mask_local_credentials(self):
        code, output, commands = self.run_with_fake_ssh(
            HERE / "run-native.py", logged_in=True,
            local_token="academy-only-credential",  # check-no-keys: allow 합성 시험 값
        )
        self.assertEqual(code, 1)
        self.assertEqual(commands, ["whoami --json", "--version", "deploy --config peer.json"])
        result = next(row for row in map(json.loads, output.splitlines()) if row["event"] == "deploy_result")
        self.assertEqual(result["apiCode"], "1000")
        for secret in ("academy-only-credential", "synthetic-session-secret", "example.test", "synthetic-account"):
            self.assertNotIn(secret, output)

    def test_unauthenticated_webp_stops_before_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            input_dir = Path(temp) / "input"
            input_dir.mkdir()
            (input_dir / "manifest.json").write_text(json.dumps([{"name": f"case-{i}"} for i in range(20)]))
            script = HERE.parent / "webp-orientation-2026-11/existing-run.py"
            code, output, commands = self.run_with_fake_ssh(script, (
                "--bundle", str(Path(temp) / "missing.js"),
                "--input", str(input_dir),
                "--source", "a" * 40,
                "--output", str(Path(temp) / "output"),
            ))
        self.assertEqual(code, 1)
        self.assertEqual(commands, ["whoami --json"])
        self.assertIn("학원컴에 Cloudflare 로그인이 없음", json.loads(output.splitlines()[0])["message"])


if __name__ == "__main__":
    unittest.main()
