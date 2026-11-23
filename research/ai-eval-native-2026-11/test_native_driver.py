"""Windows PowerShell에서 인증·출력 가림·결과 거절/정리를 실제로 실행한다. 모델은 모의뿐이다."""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

SOURCE = Path(__file__).with_name('run_native.py')
TREE = ast.parse(SOURCE.read_text(encoding='utf-8'))
DRIVER = next(ast.literal_eval(n.value) for n in TREE.body if isinstance(n, ast.Assign)
              and any(isinstance(t, ast.Name) and t.id == 'ps' for t in n.targets))


@unittest.skipUnless(sys.platform == 'win32', 'Windows PowerShell 실행은 Windows CI에서 확인')
class NativeDriver(unittest.TestCase):
    def run_driver(self, probe='clean', node_missing=False, version_mismatch=False):
        bundle = Path(os.environ['SILJANG_NATIVE_TEST_BUNDLE']).read_bytes()
        with tempfile.TemporaryDirectory(prefix='siljang-auth-test-') as folder:
            root = Path(folder)
            trial = root / ('siljang-native-eval-' + uuid.uuid4().hex)
            trial.mkdir()
            (trial / 'eval.mjs').write_bytes(bundle)
            source = DRIVER.replace("-ne 'v22.23.4'", "-ne 'v0.0.0'") if version_mismatch else DRIVER
            (trial / 'driver.ps1').write_text(source, encoding='utf-8-sig')
            appdata = root / 'appdata'
            if not node_missing:
                native_node = appdata / 'siljang-tools/node-v22.23.4-win-x64/node.exe'
                native_node.parent.mkdir(parents=True)
                shutil.copy2(shutil.which('node'), native_node)
            env = dict(os.environ, TEMP=str(root), TMP=str(root), LOCALAPPDATA=str(appdata))
            payload = {'real': False, 'nativeAuthProbe': probe, 'bundleSha256': hashlib.sha256(bundle).hexdigest()}
            result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
                                     '-ExecutionPolicy', 'Bypass', '-File', str(trial / 'driver.ps1')],
                                    input=(json.dumps(payload)+'\n').encode('utf-8'), capture_output=True, env=env, timeout=60)
            output = result.stdout.decode('utf-8-sig', errors='replace')
            events = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
            self.assertFalse(trial.exists(), '자기 시험 폴더는 성공/실패 모두 정리해야 함')
            self.assertNotIn('example-native-canary-', output)
            return result.returncode, output, events

    def test_mock_134_uses_native_key_branch_redacts_stdout_and_returns_artifacts(self):
        code, output, events = self.run_driver()
        self.assertEqual(code, 0, output)
        self.assertIn('native_auth_probe_stdout=[credential]', output)
        self.assertIn('모드 mock', output)
        artifacts = {x['name']: base64.b64decode(x['data'], validate=True) for x in events if x['event'] == 'artifact'}
        self.assertEqual(set(artifacts), {'run.json', 'results.jsonl', 'checkpoint.json', 'summary.md', 'review.md'})
        self.assertEqual(len(artifacts['results.jsonl'].splitlines()), 134)
        self.assertEqual(json.loads(artifacts['checkpoint.json'])['run']['mode'], 'mock')
        self.assertTrue(any(x.get('cliExit') == 0 for x in events))

    def test_key_in_artifact_is_refused_before_any_artifact_leaves(self):
        code, output, events = self.run_driver('artifact-rejection')
        self.assertEqual(code, 2, output)
        self.assertIn('native_auth_probe_stdout=[credential]', output)
        self.assertTrue(any(x.get('code') == 'credential_in_artifact_refused' for x in events))
        self.assertFalse(any(x['event'] == 'artifact' for x in events))

    def test_missing_node_keeps_numbered_error_code_and_cleans_folder(self):
        code, output, events = self.run_driver(node_missing=True)
        self.assertEqual(code, 2, output)
        self.assertTrue(any(x.get('code') == 'node22_missing' for x in events))

    def test_wrong_node_version_keeps_numbered_error_code_and_cleans_folder(self):
        code, output, events = self.run_driver(version_mismatch=True)
        self.assertEqual(code, 2, output)
        self.assertTrue(any(x.get('code') == 'node22_version_mismatch' for x in events))


if __name__ == '__main__':
    unittest.main()
