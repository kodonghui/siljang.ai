"""실제 age를 쓰는 백업 경계 시험. 데이터와 키는 임시 합성 값이다."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("backup.py")
AGE = os.environ.get("AGE_BIN", "age")
KEYGEN = str(Path(AGE).with_name("age-keygen")) if "/" in AGE else "age-keygen"
PAYLOAD = b"PGDMP\x00synthetic-order-consent-payment\x00" * 128


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.key = self.root / "identity"
        subprocess.run([KEYGEN, "-o", str(self.key)], check=True, capture_output=True)
        recipient = subprocess.check_output([KEYGEN, "-y", str(self.key)], text=True).strip()
        self.capture = self.root / "capture.json"
        self.dump = self.root / "pg_dump"
        self.dump.write_text(
            "#!/usr/bin/env python3\nimport json, os, sys\n"
            "json.dump({'args':sys.argv[1:],'database':os.environ.get('PGDATABASE')},"
            f"open({str(self.capture)!r},'w'))\n"
            f"sys.stdout.buffer.write({PAYLOAD!r})\n"
        )
        self.dump.chmod(0o700)
        self.output = self.root / "public.dump.age"
        self.env = {**os.environ, "AGE_BIN": AGE, "PG_DUMP_BIN": str(self.dump),
                    "BACKUP_DATABASE_URL": "postgresql://synthetic:private-value@localhost/example",
                    "BACKUP_AGE_RECIPIENT": recipient}

    def run_backup(self):
        return subprocess.run([sys.executable, "-I", str(SCRIPT), str(self.output)],
                              env=self.env, capture_output=True, timeout=20)

    def assert_failed_closed(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())
        self.assertNotIn(b"private-value", result.stdout + result.stderr)
        self.assertNotIn(b"synthetic-order", result.stdout + result.stderr)
        self.assertFalse(list(self.root.glob(".backup-*")))

    def test_real_encryption_and_private_permissions(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        encrypted = self.output.read_bytes()
        self.assertTrue(encrypted.startswith(b"age-encryption.org/v1"))
        self.assertNotIn(b"synthetic-order", encrypted)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        plain = subprocess.check_output([AGE, "-d", "-i", str(self.key), str(self.output)])
        self.assertEqual(plain, PAYLOAD)
        capture = json.loads(self.capture.read_text())
        self.assertEqual(capture["database"], self.env["BACKUP_DATABASE_URL"])
        self.assertNotIn(self.env["BACKUP_DATABASE_URL"], capture["args"])
        for option in ["--format=custom", "--schema=public", "--no-owner", "--no-privileges"]:
            self.assertIn(option, capture["args"])

    def test_dump_failure_leaves_no_public_artifact_or_diagnostics(self):
        with self.dump.open("a") as out:
            out.write("sys.stderr.write('private-value synthetic-order');sys.exit(1)\n")
        self.assert_failed_closed(self.run_backup())

    def test_encryption_failure_leaves_no_artifact(self):
        failing = self.root / "bad-age"
        failing.write_text("#!/bin/sh\necho private-value >&2\nexit 1\n")
        failing.chmod(0o700)
        self.env["AGE_BIN"] = str(failing)
        self.assert_failed_closed(self.run_backup())

    def test_missing_connection_fails_before_dump(self):
        del self.env["BACKUP_DATABASE_URL"]
        self.assert_failed_closed(self.run_backup())
        self.assertFalse(self.capture.exists())

    def test_invalid_recipient_fails_before_dump(self):
        self.env["BACKUP_AGE_RECIPIENT"] = "--plaintext"
        self.assert_failed_closed(self.run_backup())
        self.assertFalse(self.capture.exists())

    def test_existing_artifact_is_never_overwritten(self):
        self.output.write_bytes(b"previous-backup")
        result = self.run_backup()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.output.read_bytes(), b"previous-backup")
        self.assertFalse(self.capture.exists())

    def test_output_symlink_is_never_followed(self):
        target = self.root / "target"
        target.write_bytes(b"keep")
        self.output.symlink_to(target)
        self.assertNotEqual(self.run_backup().returncode, 0)
        self.assertEqual(target.read_bytes(), b"keep")

    def test_wrong_key_and_tampering_are_rejected(self):
        self.assertEqual(self.run_backup().returncode, 0)
        other = self.root / "other"
        subprocess.run([KEYGEN, "-o", str(other)], check=True, capture_output=True)
        self.assertNotEqual(subprocess.run([AGE, "-d", "-i", str(other), str(self.output)],
                                          capture_output=True).returncode, 0)
        data = bytearray(self.output.read_bytes())
        data[-1] ^= 1
        self.output.write_bytes(data)
        self.assertNotEqual(subprocess.run([AGE, "-d", "-i", str(self.key), str(self.output)],
                                          capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
