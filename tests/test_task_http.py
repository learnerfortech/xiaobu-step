"""Production browser transport/Store exercised against a temporary LAN server.

This verifies HTTP and save semantics through Node, not browser rendering.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from browser_task_planning import Acceptance, REPO


class StoreHttpTests(unittest.TestCase):
    def test_material_rich_task_can_be_rescheduled_through_store(self):
        script = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const [origin, day, future] = process.argv.slice(1);
const writes = [];
const window = {
  APP_CONFIG: { TRANSPORT: 'lan', API_PREFIX: '/lan/family/', today: () => day },
  addEventListener() {}
};
const context = vm.createContext({
  window, location: new URL(origin + '/index.html?transport=lan'),
  document: { hidden: false, addEventListener() {} },
  URL, Response, AbortController, crypto: webcrypto,
  fetch: async (url, options) => {
    if (options?.method === 'POST') writes.push({
      path: new URL(url).pathname,
      bytes: Buffer.byteLength(options.body),
      body: JSON.parse(options.body)
    });
    return fetch(url, options);
  },
  setTimeout, clearTimeout, setInterval() {}, console
});
for (const file of ['api/lan-transport.js', 'api/adapters.js', 'state/store.js']) {
  vm.runInContext(fs.readFileSync('frontend/js/' + file, 'utf8'), context, { filename: file });
}
(async () => {
  const materials = Array.from({ length: 18 }, (_, i) => ({
    kind: 'exercise', title: '合成练习 ' + (i + 1),
    url: 'https://example.org/exercise-' + i + '.pdf?note=' + 'x'.repeat(1900)
  }));
  const store = window.Store;
  const created = await store.create({
    child_id: 'child_a', title: '合成大材料任务', first_step: '先看对应练习',
    work_type: 'school', task_kind: 'reading', planned_day: day,
    due_day: future, original_requirement: '只验证保存与调整日期。', materials
  });
  assert.equal(created.result, 'saved', JSON.stringify(created));
  const task = store.find('parent', 'child_a', created.op.body.id);
  assert.ok(task);
  const updated = await store.update(task, { planned_day: future });
  assert.equal(updated.result, 'saved', JSON.stringify(updated));
  const readback = await window.API.TaskAdapter.readback('parent', { day, child_id: 'child_a' }, task.id);
  assert.equal(readback.status, 200);
  const saved = readback.data.tasks[0];
  assert.equal(saved.planned_day, future);
  assert.equal(saved.due_day, future);
  assert.equal(saved.original_requirement, task.original_requirement);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.materials)), materials);
  assert.equal(saved.version, task.version + 1);
  assert.equal(store.pendingFor(updated.op.key), undefined);
  assert.deepEqual(writes.map(x => x.path), ['/lan/family/parent/create', '/lan/family/parent/update']);
  assert.ok(writes.every(x => x.bytes > 32768 && x.bytes < 512 * 1024));
  assert.deepEqual(writes[1].body.materials, materials);
  console.log(JSON.stringify({ create_bytes: writes[0].bytes, update_bytes: writes[1].bytes, result: 'saved' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
        with tempfile.TemporaryDirectory(prefix='xiaobu-store-http-') as temp:
            acceptance = Acceptance(Path(temp), Path(temp) / 'unused-screenshots')
            try:
                result = subprocess.run(
                    ['node', '-e', script, acceptance.origin, acceptance.day, acceptance.future],
                    cwd=REPO, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                receipt = json.loads(result.stdout.strip())
                self.assertEqual(receipt['result'], 'saved')
                self.assertGreater(receipt['create_bytes'], 32768)
                self.assertGreater(receipt['update_bytes'], 32768)
            finally:
                acceptance.close()


if __name__ == '__main__':
    unittest.main()
