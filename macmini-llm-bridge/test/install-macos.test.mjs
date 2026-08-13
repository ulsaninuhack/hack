import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const installer = readFileSync(new URL('../scripts/install-macos.sh', import.meta.url), 'utf8');

test('LaunchAgent PATH includes the selected Node and Codex binary directories', () => {
  assert.match(installer, /node_dir=\$\(dirname "\$node_bin"\)/);
  assert.match(installer, /codex_dir=\$\(dirname "\$codex_bin"\)/);
  assert.match(
    installer,
    /<key>PATH<\/key><string>\$node_dir:\$codex_dir:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin<\/string>/,
  );
});

test('installer waits for launchd to unregister the previous service before bootstrapping', () => {
  assert.match(
    installer,
    /launchctl bootout "\$user_domain\/\$label"[^\n]*\n+sleep 1\n+launchctl bootstrap "\$user_domain" "\$plist"/,
  );
});

test('Funnel is mounted on a dedicated path so existing root services are preserved', () => {
  assert.match(
    installer,
    /bridge_funnel_path=\$\{CODEX_BRIDGE_FUNNEL_PATH:-\/incheon-care-codex-bridge}/,
  );
  assert.match(
    installer,
    /"\$tailscale_bin" funnel --bg --yes --set-path "\$bridge_funnel_path" "\$bridge_port"/,
  );
  assert.doesNotMatch(installer, /"\$tailscale_bin" funnel --bg --yes "\$bridge_port"/);
});
