// Synthetic metadata only: no real access tokens, external requests or writes.
function runLineLoginAuthChecks() {
  const expected = String(PropertiesService.getScriptProperties().getProperty('LINE_LOGIN_CHANNEL_ID') || '').trim();
  if (!/^\d+$/.test(expected)) throw new Error('先に LINE_LOGIN_CHANNEL_ID を設定してください。');
  const valid = { client_id: expected, expires_in: 3600, scope: 'openid profile' };
  const cases = [
    ['対象チャネル・有効期限・権限が正常', valid, true],
    ['別チャネルを拒否', { ...valid, client_id: expected + '9' }, false],
    ['期限切れを拒否', { ...valid, expires_in: 0 }, false],
    ['負の有効期限を拒否', { ...valid, expires_in: -1 }, false],
    ['有効期限が欠落した応答を拒否', { client_id: expected, scope: 'profile' }, false],
    ['プロフィール権限なしを拒否', { ...valid, scope: 'openid' }, false],
    ['空の応答を拒否', null, false]
  ];
  let pass = 0;
  for (const [name, metadata, accepted] of cases) {
    const result = validateLineTokenMetadata_(metadata, expected);
    const ok = result.ok === accepted;
    console.log((ok ? 'PASS: ' : 'FAIL: ') + name);
    if (ok) pass++;
  }
  const summary = { pass, fail: cases.length - pass };
  console.log('LINEチャネル判定検証: ' + JSON.stringify(summary));
  if (summary.fail) throw new Error('判定検証でFAILがあります。');
  return summary;
}
