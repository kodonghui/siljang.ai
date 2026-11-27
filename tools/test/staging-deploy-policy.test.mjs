import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const workflow = readFileSync(new URL('../../.github/workflows/app.yml', import.meta.url), 'utf8');
test('복구는 명시적 수동 main 실행에만 허용하고 기본 배포는 strict를 유지한다', () => {
  assert.match(workflow, /recover_dashboard_conflict:\s*\n\s*description:[^\n]*\n\s*type: boolean\s*\n\s*default: false/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.recover_dashboard_conflict == true/);
  assert.match(workflow, /strict=\(--strict\)\s*\n\s*if \[\[ "\$RECOVER_CONFLICT" == true \]\]; then strict=\(\); fi/);
  assert.match(workflow, /--domain "\$SILJANG_STAGING_DOMAIN" "\$\{strict\[@\]\}" --keep-vars/);
  assert.match(workflow, /wrangler\.storage-batches\.jsonc --env staging \\\s*\n\s*--strict/);
});
