"""학원컴 평가의 호출 기기 키 비전달과 사전 확인 계약. 실제 SSH/모델은 호출하지 않는다."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(os.environ.get('SILJANG_NATIVE_TEST_SOURCE', str(Path(__file__).with_name('run_native.py'))))
SENTINEL = 'synthetic-key-in-caller'


class KeepInput(io.BytesIO):
    def close(self):
        pass


class NativeAuth(unittest.TestCase):
    def run_case(self, caller_key, native_missing=False):
        calls = []
        stream = KeepInput()

        def run(command, **kwargs):
            calls.append((command, kwargs.get('input')))
            if command[0] == 'ssh':
                return subprocess.CompletedProcess(command, 2 if native_missing else 0,
                    stdout=b'{"event":"native_openai_key_missing"}\n' if native_missing else
                    b'{"folder":"C:/Users/Synthetic/AppData/Local/Temp/siljang-native-eval-11111111111111111111111111111111"}\n', stderr=b'')
            self.assertEqual(command[0], 'scp')
            return subprocess.CompletedProcess(command, 0, stdout=b'', stderr=b'')

        class Process:
            stdin = stream
            stdout = io.BytesIO(b'{"event":"native_eval_finished","cliExit":0}\n')
            stderr = io.BytesIO()

            def wait(self):
                return 0

        output = io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'eval.mjs').write_text('export const synthetic = true;')
            (root / 'checkpoint.json').write_text('{}')
            argv = [str(SCRIPT), '--bundle', str(root / 'eval.mjs'), '--resume-from', str(root), '--out', str(root / 'out'), '--real']
            environment = {} if caller_key is None else {'OPENAI_API_KEY': caller_key}
            with patch.object(sys, 'argv', argv), patch.dict(os.environ, environment, clear=True), \
                 patch('subprocess.run', side_effect=run), patch('subprocess.Popen', return_value=Process()), \
                 contextlib.redirect_stdout(output):
                try:
                    runpy.run_path(str(SCRIPT), run_name='__main__')
                except SystemExit as result:
                    code = result.code
                else:
                    code = 0
        return code, output.getvalue(), calls, stream.getvalue()

    def test_real_mode_does_not_require_a_key_in_caller(self):
        code, _, calls, payload = self.run_case(None)
        self.assertEqual(code, 0)
        self.assertEqual([command[0] for command, _ in calls], ['ssh', 'scp'])
        records = [json.loads(line) for line in payload.splitlines()]
        self.assertEqual(set(records[1]), {'real', 'bundleSha256'})

    def test_caller_key_never_enters_transport(self):
        code, output, calls, payload = self.run_case(SENTINEL)
        self.assertEqual(code, 0)
        self.assertNotIn(SENTINEL, output)
        self.assertNotIn(SENTINEL.encode(), payload)
        for _, sent in calls:
            if sent:
                self.assertNotIn(SENTINEL.encode(), sent)

    def test_native_key_absence_stops_before_public_transfer(self):
        code, output, calls, payload = self.run_case(SENTINEL, native_missing=True)
        self.assertEqual(code, 2)
        self.assertIn('native_openai_key_missing', output)
        self.assertEqual([command[0] for command, _ in calls], ['ssh'])
        self.assertEqual(payload, b'')


if __name__ == '__main__':
    unittest.main()
