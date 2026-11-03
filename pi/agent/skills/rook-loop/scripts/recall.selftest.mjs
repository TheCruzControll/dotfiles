// recall.selftest.mjs: the checks behind `node recall.mjs --self-test`. No network, no files.
// recall.mjs hands in what it tests, so it exports nothing and stays a script. Run that, not this file.

import assert from 'node:assert/strict';

export function selfTest({ QUOTED, HIDDEN, MAX_SHOWN, MAX_TEXT, isRemote, oneLine, safeText, redact, cut, printable, pathKey, isInside, claudeFolder, quoted, plain, withoutContext, leaves, blocks, codexEvent, describe, field, keepNewest }) {
  const hides = [
    `STRIPE_SECRET=${'sk_live_'}FAKEFIXTURE123`,
    `${'sk-ant-'}api03-FAKEFIXTURE`,
    `${'ghp_'}FAKEFAKEFAKEFAKEFAKE`,
    `${'github_pat_'}11FAKE_FAKEFAKE`,
    `${'AKIA'}FAKEFAKEFAKEFAKE`,
    `xoxb-${'1234'}-FAKEFAKE`,
    `eyJhbGciOiJI.${'eyJzdWIiOiIx'}.c2lnbmF0dXJl`,
    'Authorization: Bearer abc123',
    `curl -H ${JSON.stringify('Authorization: Basic dXNlcjpwYXNz')}`,
    'postgres://admin:hunter2pass@db.local/shop',
    `printf ${'AIza'}SyFAKEFAKEFAKEFAKEFAKEFAKE`,
    `${'hf_'}FAKEFAKEFAKEFAKEFAKE`,
    `${'gsk_'}FAKEFAKEFAKEFAKEFAKE`,
    `${'xai-'}FAKEFAKEFAKEFAKEFAKE`,
    `${'pplx-'}FAKEFAKEFAKEFAKEFAKE`,
    `${'re_'}FAKEFAKE_FAKEFAKEFAKEFAKEFAKE`,
    `${'pypi-'}FAKEFAKEFAKEFAKEFAKE`,
    `${'SG.'}FAKEFAKEFAKEFAKEFAKE.FAKEFAKEFAKEFAKEFAKE`,
    `${'123456789'}:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE`,
    `-----BEGIN RSA-PSS ${'PRIVATE'} KEY-----`,
    `https://hooks.slack.com/services/${'T000'}/B000/FAKE`,
    'https://x.blob.core.windows.net/c?sv=1&sig=FAKEFAKE',
    'password: `x`',
    "'password' => 'x'",
    "define('DB_PASSWORD','x')",
    'os.environ["API_KEY"] = "x"',
    'mysql --password x',
    'gh --token=x',
    'curl -u ana:x https://example.com',
    'Pwd=x;',
    'PASS=x',
    'GPG_PASSPHRASE=x',
    'hasło: x',
    '{"Authorization":"Basic x"}',
    '{"authorization":"bearer x"}',
    'Cookie: sessionid=x',
    'PASSWORD=ab&x',
    'PASSWORD=ab,x',
    'PASSWORD=ab;x',
    'postgres://a:b/c@d@db.local/shop',
    `\u001b[32m${'ghp_'}FAKEFAKEFAKEFAKEFAKE\u001b[0m`,
    `\\u001b[1;33m${'ghp_'}FAKEFAKEFAKEFAKEFAKE`,
    `\\x1b[0m${'sk-ant-'}api03-FAKEFIXTURE`,
    `\\u000a${'AKIA'}FAKEFAKEFAKEFAKE`,
    `MY_TOKEN_${'ghp_'}FAKEFAKEFAKEFAKEFAKE`,
    'TOKEN\\u003dx',
    '\\u0022password\\u0022:\\u0022x\\u0022',
    '{"name":"API_KEY","value":"x"}',
    '{"Name":"DB_PASSWORD","Value":"x"}',
    '{"auth":"dXNlcjpwYXNz"}',
    '//registry.npmjs.org/:_auth=dXNlcjpwYXNz',
    `hooks.slack.com\\/services\\/${'T000'}\\/B000\\/FAKE`,
    'bearer abcdefghijklmnop1234',
    `https://${'FAKEFAKEFAKEFAKE1234'}@github.com/a`,
    `${'GOCSPX-'}FAKEFAKEFAKEFAKEFAKE`,
    `${'ya29.'}FAKEFAKEFAKEFAKEFAKE`,
    `${'sbp_'}FAKEFAKEFAKEFAKEFAKE`,
    `${'lin_api_'}FAKEFAKEFAKEFAKEFAKE`,
    `${'ntn_'}FAKEFAKEFAKEFAKEFAKE`,
    `${'AGE-SECRET-KEY-1'}FAKEFAKE`,
    `${'LS0tLS1CRUdJTi'}BQUklWQVRFIEtFWS0tLS0t`,
  ];
  for (const text of hides) assert.ok(redact(text).includes(HIDDEN), text);
  // Nothing of the value is left after a hidden part: an escaped quote does not end it.
  for (const text of ['{"password":"ab\\"LEFT"}', '{\\"password\\":\\"ab\\\\\\"LEFT\\"}', "password='ab\\'LEFT'", '--token "ab\\"LEFT"', '{"name":"API_KEY","value":"LEFT"}', `hooks.slack.com\\/services\\/${'T000'}\\/B000\\/LEFT`]) {
    assert.ok(!redact(text).includes('LEFT'), text);
  }
  assert.equal(redact("password='C:\\pw\\' next"), `password=${HIDDEN} next`);
  // An escape inside a value does not end it, and a value ending in a backslash does not swallow the next name.
  for (const text of ['{"password":"ab\\u0022LEFT"}', '{"secret":"ab\\u000aLEFT"}', '{"token":"one\\u000aLEFT"}', "password='ab\\u0027LEFT'", 'password=ab\\u0022LEFT', '--password ab\\u0027LEFT', 'Cookie: a=1\\u000aLEFT', 'curl -u bob:ab\\u0022LEFT', 'https://u:ab\\u000aLEFT@h.test', 'PASSWORD="C:\\dir\\" API_KEY="abc LEFT"', "-e PASS='C:\\x\\' -e API_KEY='long LEFT'"]) {
    assert.ok(!redact(text).includes('LEFT'), text);
  }
  // A value ending in a backslash does not hide the next one, however the next name is written.
  for (const text of ['{password:"C:\\\\",token:"two words LEFT"}', 'password: "C:\\\\"\ntoken: "two words LEFT"', 'DB_PASS=\\"C:\\\\\\\\\\"\\nAPI_KEY=\\"two words LEFT\\"\\n', '$env:PASS="C:\\x\\"; $env:API_KEY="two words LEFT"', 'mysql --password "C:\\x\\" --token "two words LEFT"', 'f({password:"C:\\\\",apiKey:"two words LEFT"})']) {
    assert.ok(!redact(text).includes('LEFT'), text);
  }
  // Escaped quotes around a value, and a mark in the text, hide no less.
  for (const text of ['{"Env":"PASSWORD=\\u0022two words LEFT\\u0022"}', 'password: \\u0022two words LEFT\\u0022', '--token=\\u0027two words LEFT\\u0027', 'token=\\x22two words LEFT\\x22', `\\u0022password\\u0022: \\u0022aa ${'ghp_'}FAKEFAKEFAKEFAKEFAKE LEFT\\u0022`, 'API_KEY\\u003d"aaa bbb LEFT"', 'Cookie\\u003a a=1; token=abc; LEFT=2', `password="aa ${HIDDEN} LEFT"`, `Cookie: a=1 ${HIDDEN} LEFT=2`, `-----BEGIN ${'PRIVATE'} KEY-----\nAAAA\n${HIDDEN}\nLEFT\n-----END ${'PRIVATE'} KEY-----`]) {
    assert.ok(!redact(text).includes('LEFT'), text);
  }
  for (const text of ['{\\"auth\\":\\"LEFT\\"}', '{"name":"auth","value":"LEFT"}', "'auth' => 'LEFT'", '"auth"="LEFT"', '"auth": LEFT', '["auth","LEFT"]']) {
    assert.ok(!redact(text).includes('LEFT'), text);
  }
  // Around a hidden part, the text comes back as written, with its escapes.
  assert.equal(redact('a\\u003db PASSWORD\\u003dx c\\u0026d'), `a\\u003db PASSWORD\\u003d${HIDDEN} c\\u0026d`);
  // Text with no secret stays as written, and a mark is not hidden again.
  for (const text of ['C:\\x0a\\y', 'look for x1b and \\u003d here', 'dim_customer_sk_abcdefgh', 'row_rk_partition_value', 'bearer authentication-mechanism', '"auth": true', '"auth": {"user": 1}', 'mailto://long.mailing.list.name.x@h.test']) {
    assert.equal(redact(text), text);
  }
  assert.equal(redact(`API_KEY: ${HIDDEN}`), `API_KEY: ${HIDDEN}`);
  assert.ok(!redact(`\u001b[2K\u001b[1G${'ghp_'}FAKEFAKEFAKEFAKEFAKE`).includes('FAKE'));
  assert.ok(!redact(`\\b${'ghp_'}FAKEFAKEFAKEFAKEFAKE`).includes('FAKE'));
  assert.equal(redact('ssh://git@github.com/a'), 'ssh://git@github.com/a');
  // Inside JSON that was printed as text: a line break is a backslash and an n, a quote has backslashes.
  for (const text of [`a\\n${'ghp_'}FAKEFAKEFAKEFAKEFAKE`, `\\n${'AKIA'}FAKEFAKEFAKEFAKE`, '{\\\\\\"password\\\\\\":\\\\\\"x\\\\\\"}']) {
    assert.ok(redact(text).includes(HIDDEN), text);
  }
  assert.ok(!redact('PASSWORD=ab&x').includes('&x'));
  assert.ok(!redact('postgres://a:b/c@d@db.local/shop').includes('b/c'));
  assert.equal(redact(`${'PWD'}=/home/ana`), `${'PWD'}=/home/ana`);
  assert.ok(!redact(hides[0]).includes('FAKEFIXTURE'));
  assert.ok(!redact('postgres://admin:hunter2pass@db.local/shop').includes('hunter2pass'));
  assert.equal(redact('API_KEY=abc'), `API_KEY=${HIDDEN}`);
  assert.equal(redact('password: "two words"'), `password: ${HIDDEN}`);
  assert.equal(redact("db_pass = 'x y'"), `db_pass = ${HIDDEN}`);
  assert.equal(redact('{"api_key": "abc"}'), `{"api_key": ${HIDDEN}}`);
  assert.equal(redact('{\\"api_key\\": \\"abc\\"}'), `{\\"api_key\\": ${HIDDEN}}`);
  const pem = `-----BEGIN ${'PRIVATE'} KEY-----\nabc\ndef\n-----END ${'PRIVATE'} KEY-----`;
  assert.equal(redact(`a ${pem} b`), `a ${HIDDEN} b`);
  assert.equal(redact(`a -----BEGIN ${'PRIVATE'} KEY-----\nabc`), `a ${HIDDEN}`);
  for (const text of ['primary key: uuid', 'max_tokens: 1500', 'the date format is ISO 8601', 'task_description: fix it', 'Basic authentication']) {
    assert.equal(redact(text), text);
  }

  // Compound separators and type hints, a value with no closing quote, a value next to its own quotes or
  // inside a quoted pair, and a value that does not start with its quote.
  const E = '\u001b';
  for (const text of [
    'password := "LEFT"', 'password == "LEFT"', 'password ?= "LEFT"', 'password += "LEFT"', 'api_key ||= "LEFT"', 'password: str = "LEFT"', 'const token: string = "LEFT"', 'password <- "LEFT"', 'token := LEFT',
    'password="LEFT', "API_KEY='LEFT", 'token=`LEFT', '{"password":"LEFT', 'password="a\nLEFT"',
    '"POSTGRES_PASSWORD=a LEFT"', 'docker run -e "TOKEN=x LEFT"', 'Environment="API_KEY=x LEFT"', 'Server=x;Password=a LEFT;Database=y', 'PASSWORD=ab"LEFT', 'password: two LEFT', 'export API_TOKEN=one LEFT', '  db_password: two LEFT',
    'password = b"LEFT"', 'SECRET_KEY = r"LEFT"', 'password = SecretStr("LEFT")', '"password": ["a LEFT"]', '"password":{"value":"a LEFT"}', 'API_KEY = os.getenv("X") or "LEFT"',
    // A name and its value apart.
    'password: |\n  LEFT\n  moreLEFT', 'password:\n  - LEFT', '- name: API_KEY\n  value: LEFT', '{"value":"LEFT","name":"API_KEY"}', '{"Name":"/prod/db/token","Type":"SecureString","Value":"LEFT"}', 'password:          LEFT', 'some_token =             "LEFT"',
    // No separator at all.
    'machine x.test login bob password LEFT', 'password LEFT', "CREATE ROLE a WITH PASSWORD 'LEFT'", "ALTER USER a IDENTIFIED BY 'LEFT'", '<password>LEFT</password>', '<property name="password" value="LEFT"/>', 'ENV API_KEY LEFT', 'set -gx API_KEY "LEFT"', 'setx API_KEY LEFT', 'variable "token" {\n  default = "LEFT"\n}',
    // A colour code, or a written line break, in front of a rule.
    `password${E}[0m: LEFT`, `"password"${E}[0m: ${E}[0;32m"LEFT"`, `${E}[31mpostgres://u:LEFT@h`, `${E}[33mCookie: a=LEFT`, `${E}[32mPwd=LEFT`, '\\e[31mpostgres://u:LEFT@h', '\\r\\nCookie: a=LEFT', 'text\\nBearer LEFTabcdefghijklmnop0',
    // Cookie and Authorization in any quoting, and any scheme.
    '{"Cookie":"sessionid=LEFT"}', 'Cookie: "a=LEFT"', 'Cookie: a="x LEFT"', 'headers["Cookie"] = "a=LEFT"', '("Cookie", "a=LEFT")', 'curl -b "session=LEFT"', 'curl --cookie a=LEFT',
    'Authorization: Bot LEFT', 'Authorization: Negotiate LEFT', 'Authorization: ApiKey LEFT', 'Authorization: `Basic LEFT`', "'Authorization' => 'Basic LEFT'", '("Authorization", "Basic LEFT")', 'headers["Authorization"] = "Basic LEFT"', 'proxy_set_header Authorization "Basic LEFT"',
    // URLs.
    'redis://:LEFT@h:6379', 'rediss://:LEFT@h', 'postgres:\\/\\/a:LEFT@h', `postgres://a:${'x'.repeat(150)}LEFT@h`, 'postgres://a:LEFT\\u0040h',
    'let secret: &str = "LEFT";', 'token = x + "LEFT"', 'const apiKey = y || "LEFT"', 'password:\n    two LEFT', "KEY='{\n \"private_key_id\":\"LEFT\"\n}'", 'password "LEFT"', 'set(password, "LEFT")',
    'aws configure set aws_secret_access_key LEFT', 'git config --global github.token LEFT', 'npm config set _auth LEFT', '<entry key="password">LEFT</entry>', '<param name="secret">LEFT</param>',
    'Authorization Basic LEFT', 'X-Auth: LEFT', '-H "x-auth: LEFT"', 'Bearer LEFTabcd1', '[36mpassword[0m: LEFT', '"SecretString": "LEFT"', 'X-Amz-Signature=LEFT', '&Signature=LEFT',
    '//u:LEFT@h/x', 'user:LEFT@tcp(127.0.0.1:3306)/db', 'u/LEFT@//h:1521/svc', 'h:5432:db:u:LEFT',
    // Flags, and the programs that take a password with no flag name.
    '--client-secret LEFT', '--secret-key LEFT', '--access-key LEFT', '--private-key LEFT', '--api_key LEFT', '--proxy-password LEFT', '--auth LEFT', '--bearer LEFT', '-token LEFT', '-password LEFT', '--password\tLEFT', '--token\nLEFT', '--password \\\n  LEFT', 'mysql -u a -pLEFT db', 'sshpass -p LEFT ssh x', 'docker login -p LEFT r.test', 'curl --user=u:LEFT x', 'curl -uu:LEFT x', 'curl -u "u:two LEFT" x',
  ]) {
    assert.ok(!redact(text).includes('LEFT'), text);
  }
  // More key shapes.
  for (const text of [
    `${'xapp-'}1-A0-1234-FAKEFAKEFAKEFAKE`, `${'dckr_pat_'}FAKEFAKEFAKEFAKEFAKE`, `${'hvs.'}FAKEFAKEFAKEFAKEFAKE`, `${'sntrys_'}FAKEFAKEFAKEFAKEFAKE`, `${'glsa_'}FAKEFAKEFAKEFAKEFAKE`, `${'glrt-'}FAKEFAKEFAKEFAKEFAKE`, `${'ATATT'}FAKEFAKEFAKEFAKEFAKE`, `${'sq0atp-'}FAKEFAKEFAKEFAKEFAKE`,
    `${'doo_v1_'}FAKEFAKEFAKEFAKEFAKE`, `${'dp.pt.'}FAKEFAKEFAKEFAKEFAKE`, `${'vercel_'}FAKEFAKEFAKEFAKEFAKE`, `${'rubygems_'}FAKEFAKEFAKEFAKEFAKE`, `${'lin_oauth_'}FAKEFAKEFAKEFAKEFAKE`, `${'sb_secret_'}FAKEFAKEFAKEFAKEFAKE`, `${'pat-na1-'}FAKEFAKEFAKEFAKEFAKE`,
    `${'secret_'}${'FAKE'.repeat(8)}`, `FAKEFAKEFAKEFA${'.atlasv1.'}${'FAKE'.repeat(8)}`, `${'SK'}${'0a'.repeat(16)}`, `${'LTAI'}FAKEFAKEFAKEFAKE`, `${'1//0'}FAKEFAKEFAKEFAKEFAKE`, `${'key-'}${'0a'.repeat(16)}`,
    `https://discord.com/api/webhooks/123456/FAKEFAKEFAKEFAKE`, `${'eyJ'}FAKEFAKEFAKE.${'eyJ'}FAKEFAKEFAKE`, `${'eyJ'}FAKEFAKEFAKE.FAKEFAKEFAKE.a.FAKEFAKEFAKE.b`,
  ]) {
    assert.ok(!redact(text).includes('FAKE'), text);
  }
  // A regression each: a value that ends at an escape only the third view reads, a name given as a list, a URL
  // with one escaped slash, and a token used as a field's name under a name that says it is secret.
  for (const text of ['x token=ab\\u0020LEFT', 'x --token=ab\\u0060LEFT', 'postgres:/\\/u:LEFT@h']) assert.ok(!redact(text).includes('LEFT'), text);
  assert.ok(!redact(plain({ Name: ['token'], Value: 'a LEFT' })).includes('LEFT'));
  assert.ok(!redact(leaves({ tokens: { LEFT: 'bob' } })).includes('LEFT'));
  // Commands and sentences that only look like the files the rules read.
  for (const text of ['git checkout -b fix/arsenal-ports-solid', 'git clone -b main x', 'password reset is broken on mobile', 'the login page needs a password field', 'set token expiry to one hour', 'default password policy', 'config secret rotation', 'a.json:3:http://x.test:8080/y', 'tool --bypass cache']) {
    assert.equal(redact(text), text);
  }
  assert.ok(!redact('curl -b "session=LEFT" x').includes('LEFT'));
  assert.ok(plain({ name: 'token_utils.ts', text: 'const a = 1' }).includes('const a = 1'));
  assert.ok(plain({ command: ['passwd', 'alice'] }).includes('alice'));
  // Text with no secret still prints as written.
  for (const text of ['token bucket algorithm', 'a password reset page', 'cookie banners are annoying, sadly', 'authorization, which is hard', 'name: api_gateway', 'value: 3', 'mysql -h db -P 3306', 'curl -s https://example.test/a']) {
    assert.equal(redact(text), text);
  }
  // A run too long for the regular expressions hides the text, and ends nothing.
  assert.equal(redact(`${'ghp_'}${'a'.repeat(7000000)}`).includes('aaaa'), false);

  // A tool's arguments, and event shapes this script does not know: a value keeps its name, so the name can hide it.
  for (const value of [
    { selector: '#password', value: 'LEFT' }, { element: 'Password field', text: 'LEFT' }, { label: 'Password', value: 'LEFT' }, { header: 'Authorization', val: 'LEFT' }, { name: 'API_KEY', val: 'LEFT' },
    { headers: [['Authorization', 'Basic LEFT']] }, { pwd: 'LEFT' }, { basicAuth: 'u:LEFT' }, { password_confirmation: 'LEFT' },
  ]) {
    assert.ok(!redact(plain(value)).includes('LEFT'), JSON.stringify(value));
  }
  for (const value of [{ env: { API_TOKEN: 'LEFT' } }, { command: ['tool', '--token', 'LEFT'] }, { password: 'two LEFT' }, { nested: [{ name: 'API_KEY', value: 'LEFT' }] }]) {
    assert.ok(!redact(leaves(value)).includes('LEFT'), JSON.stringify(value));
  }
  assert.equal(leaves({ a: 'one', n: 3, b: [' ', 'two'], c: null }), 'a: one\nb: two');
  assert.equal(leaves(7), '');
  assert.ok(!field('password=LEFT').includes('LEFT'));

  // Long hostile text stays fast: every shape is anchored on a fixed start.
  for (const text of ['a-'.repeat(1 << 20), 'eyJ-'.repeat(1 << 18), 'eyJ_'.repeat(1 << 18), 'token='.repeat(1 << 19), '-----BEGIN KEY-----'.repeat(1 << 16), `"${'key'.repeat(1 << 19)}`, 'http://a:'.repeat(1 << 16), `${'/'.repeat(1 << 16)}x`, 'token="'.repeat(1 << 18), 'token="\\"'.repeat(1 << 17), 'token=\\"\\\\"'.repeat(1 << 16), `token="${'\\"'.repeat(1 << 19)}`, "token='".repeat(1 << 18), `token='${"\\'".repeat(1 << 19)}`, '--token "\\"'.repeat(1 << 16), '[32m'.repeat(1 << 18), 'sk-'.repeat(1 << 19), '_ghp_'.repeat(1 << 18), 'http://aaaaaaaaaaaaaaaaaaaaaa'.repeat(1 << 15), '\\u003d'.repeat(1 << 18), '\\'.repeat(1 << 22), `${HIDDEN} `.repeat(1 << 17), 'token=a '.repeat(1 << 19), '\\u0022token=a '.repeat(1 << 17)]) {
    const started = Date.now();
    redact(text);
    assert.ok(Date.now() - started < 6000, text.slice(0, 12));
  }
  // A value and a name that may sit near each other, many times over: one pass, not one look for each.
  for (const text of [`key ${'value='.repeat(1 << 16)}`, `token ${'{value:12,name:3},'.repeat(1 << 14)}`, `key ?${'value=1&'.repeat(1 << 15)}`, `key:x${'key'.repeat(21)} `.repeat(1 << 13)]) {
    const startedPairs = Date.now();
    redact(text);
    assert.ok(Date.now() - startedPairs < 3000, text.slice(0, 16));
  }
  // An opening quote with every count of backslashes: each one needs its own closing quote.
  const openers = Array.from({ length: 1 << 15 }, (_, i) => `password=${'\\'.repeat(i % 80)}"x `).join('');
  const startedQuotes = Date.now();
  redact(openers);
  assert.ok(Date.now() - startedQuotes < 3000, `${Date.now() - startedQuotes} ms`);
  assert.equal(pathKey(`/a${'/'.repeat(1 << 16)}`), '/a');

  assert.equal(safeText('a\u001b[2J\u202eb\r\nc\td'), 'a\\u{1b}[2J\\u{202e}b\nc\td');
  for (const c of [0xe0100, 0xfe00, 0x3164, 0xfff9, 0x180e, 0x34f, 0x1d173]) {
    assert.ok(safeText(`a${String.fromCodePoint(c)}b`).includes(`\\u{${c.toString(16)}}`));
  }
  assert.equal(oneLine('a\nb'), 'a\\u{a}b');

  const long = printable(`${'x'.repeat(5000)} needle ${'y'.repeat(5000)}`, ['needle'], MAX_TEXT, 'f:1');
  assert.ok(long.includes('needle'));
  assert.ok(long.length < MAX_TEXT + 40);
  assert.ok(long.endsWith('…open f:1 (recall.mjs --at)'));
  const page = printable(quoted(`${'x'.repeat(5000)} needle ${'y'.repeat(5000)}`), ['needle'], MAX_TEXT, 'f:1');
  assert.ok(page.startsWith(QUOTED));
  assert.ok(printable('z'.repeat(5000), [], MAX_TEXT, 'f\u202e:1').includes('f\\u{202e}:1'));
  assert.equal(printable('short', ['short'], MAX_TEXT, 'f:1'), 'short');
  assert.ok(!/[\ud800-\udbff]$/.test(cut('a😀b', 0, 2)));

  assert.ok(isInside('/a/shop/sub', '/a/shop'));
  assert.ok(isInside('/a/shop', '/a/shop/'));
  assert.ok(!isInside('/a/shop-admin', '/a/shop'));
  assert.equal(claudeFolder('/home/ana/my.shop'), '-home-ana-my-shop');

  const opts = { thinking: false };
  assert.equal(blocks([{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'y' }], opts), 'y');
  assert.equal(blocks([{ type: 'thinking', thinking: 'x' }], { thinking: true }), 'x');
  assert.equal(codexEvent('event_msg', { type: 'agent_reasoning', text: 'x' }, opts).text, '');
  assert.equal(codexEvent('response_item', { type: 'reasoning', summary: [{ text: 'x' }] }, opts).text, '');
  assert.ok(describe({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'out' }] } }, opts).text.startsWith(QUOTED));
  assert.ok(describe({ timestamp: 't', type: 'response_item', payload: { type: 'function_call_output', output: 'out' } }, opts).text.startsWith(QUOTED));
  assert.equal(describe({ type: 'user', message: { role: 'user', content: 'hello' } }, opts).text, 'hello');
  assert.equal(withoutContext(' <system-reminder> the date </system-reminder>'), '');
  assert.equal(withoutContext('<system-reminder>x</system-reminder>\nmy words').trim(), 'my words');
  assert.equal(withoutContext('why is there a <system-reminder> here'), 'why is there a <system-reminder> here');
  assert.equal(withoutContext('<system-reminder> never closed'), '');
  assert.equal(plain({ command: 'ls', env: { API_KEY: 'x y' }, max_tokens: 5 }), `command: ls\nAPI_KEY: ${HIDDEN}\nmax_tokens: 5`);
  assert.equal(plain({ env: [{ name: 'API_KEY', value: 'x y' }], auth: 'x y', password: ['x y'], secrets: { foo: 'x y' }, tokens: 5 }), `name: API_KEY\nvalue: ${HIDDEN}\nauth: ${HIDDEN}\npassword: ${HIDDEN}\n${HIDDEN}\ntokens: 5`);
  assert.ok(!redact(plain({ args: ['--token', 'LEFT'] })).includes('LEFT'));
  for (const input of [{ args: ['--password', 'two words LEFT'] }, { headers: { Authorization: 'AWS4-HMAC-SHA256 Signature=LEFT' } }, { key: 'API_KEY', value: 'x LEFT' }, { Key: 'API_TOKEN', Value: 'x LEFT' }, { name: 'API_KEY', text: 'x LEFT' }, { name: 'Authorization', value: 'Basic LEFT' }, { name: 'Cookie', value: 'a=LEFT' }]) {
    assert.ok(!redact(plain(input)).includes('LEFT'), JSON.stringify(input));
  }
  assert.ok(!/123456|4242/.test(redact(plain({ pass: 123456, auth: 12345678, secrets: { stripe: 4242 } }))));
  assert.ok(redact(blocks([{ type: 'tool_use', name: 'Bash', input: { command: `a\n${'ghp_'}FAKEFAKEFAKEFAKEFAKE` } }], opts)).includes(HIDDEN));
  assert.ok(isRemote('\\\\host\\share\\a.jsonl'));
  assert.ok(isRemote('//host/share/a.jsonl'));
  assert.ok(!isRemote('/home/ana/a.jsonl'));

  const kept = [];
  for (let i = 0; i < 50; i += 1) keepNewest(kept, { time: new Date(i * 1000).toISOString() }, () => String(i));
  assert.equal(kept.length, MAX_SHOWN);
  assert.deepEqual([kept[0].text, kept.at(-1).text], ['30', '49']);

  console.log('self-test ok');
}
