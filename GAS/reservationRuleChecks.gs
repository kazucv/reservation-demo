// Temporary, manual rule checks for the demo project only.
// Calls the production parser and rule validator, never reservation write handlers.
function runReservationRuleChecks() {
  const demoSheet = '15JK9k0MkUVjq1znn6GHi8E3L-zyi6H-8MxsfxVCq3xQ';
  const demoCalendar = 'b57dcd69b7d8e60267488712be9345f9702c8dafd7bcfc563d9d03f538104b8d@group.calendar.google.com';
  if (SHEET_ID !== demoSheet || CALENDAR_ID !== demoCalendar) {
    throw new Error('デモ用のシート・カレンダーではありません。実行を中止しました。');
  }
  if (typeof validateReservationRules_ !== 'function') throw new Error('予約ルール検証版の apiFlow.gs が必要です。');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  const results = [];
  const uid = '__DEMO_RULE_CHECK_ONLY__';
  try {
    const todayKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const base = new Date(`${todayKey}T00:00:00Z`);
    function dateKey(date) { return date.toISOString().slice(0, 10); }
    function shifted(days) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + days); return d; }
    function slot(date, time) { return dateKey(date).replaceAll('-', '') + '_' + time; }
    function record(name, result, expectedCode) {
      const pass = expectedCode ? result.ok === false && result.code === expectedCode : result.ok === true;
      const row = { name, result: pass ? 'PASS' : 'FAIL', expected: expectedCode || 'allowed', actual: result.code || (result.ok ? 'allowed' : result.message) };
      results.push(row);
      console.log(JSON.stringify(row));
    }
    function check(name, id, expectedCode, rows) {
      const parsed = parseSlotId_(id);
      const result = parsed.ok ? validateReservationRules_(parsed, uid, rows || []) : parsed;
      record(name, result, expectedCode);
    }
    // These must reject before reading holiday data or attempting any write.
    check('開始時刻を過ぎた日時', slot(shifted(-1), '09:00〜10:00'), 'slot_started');
    record('存在しない日付', parseSlotId_(`${base.getUTCFullYear()}0230_09:00〜10:00`), 'date_invalid');
    record('不正な時刻', parseSlotId_(slot(shifted(7), '25:00〜26:00')), 'slot_invalid');
    const far = new Date(base); far.setUTCMonth(far.getUTCMonth() + 7);
    check('6か月の受付期間外', slot(far, '09:00〜10:00'), 'day_too_far');

    // Find an actual business day using the same final validator, with an empty synthetic reservation list.
    let candidate = null;
    const lead = Math.max(1, Number(MIN_DAYS_AHEAD) || 0);
    for (let offset = lead; offset < lead + 35; offset++) {
      const d = shifted(offset);
      const rule = WEEKDAY_RULES[d.getUTCDay()] || 'ok';
      if (rule === 'none') continue;
      let ranges = rule === 'am' ? TIME_SLOTS_AM : rule === 'pm' ? TIME_SLOTS_PM : [].concat(TIME_SLOTS_AM || [], TIME_SLOTS_PM || []);
      if (!ranges || !ranges.length) continue;
      const parsed = parseSlotId_(slot(d, ranges[0]));
      if (!parsed.ok) continue;
      const test = validateReservationRules_(parsed, uid, []);
      if (test.ok) { candidate = { d, parsed, id: slot(d, ranges[0]) }; break; }
      if (test.code === 'rules_unavailable') throw new Error('営業設定を読み取れません。設定を確認してください。');
    }
    if (!candidate) throw new Error('検証できる営業日が見つかりません。営業設定・受付期間をご確認ください。');
    check('正常な営業日・時間は受付可能', candidate.id, null);
    let badTime = '23:00〜23:30';
    if ([].concat(TIME_SLOTS_AM || [], TIME_SLOTS_PM || []).includes(badTime)) badTime = '00:01〜00:02';
    check('設定されていない時間枠', slot(candidate.d, badTime), 'slot_invalid');

    // Test weekday restrictions that actually exist in the current demo settings.
    let closedDone = false, periodDone = false;
    for (let offset = lead; offset < lead + 14; offset++) {
      const d = shifted(offset), rule = WEEKDAY_RULES[d.getUTCDay()];
      if (!closedDone && rule === 'none') {
        check('曜日ルールの休業日', slot(d, '09:00〜10:00'), 'day_closed'); closedDone = true;
      }
      const opposite = rule === 'am' ? TIME_SLOTS_PM : rule === 'pm' ? TIME_SLOTS_AM : [];
      const permitted = rule === 'am' ? TIME_SLOTS_AM : rule === 'pm' ? TIME_SLOTS_PM : [];
      const blocked = (opposite || []).find(t => !(permitted || []).includes(t));
      if (!periodDone && blocked) {
        check('午前のみ・午後のみの制限', slot(d, blocked), 'slot_invalid'); periodDone = true;
      }
    }
    if (!closedDone) results.push({ name: '曜日ルールの休業日', result: 'SKIP', reason: '該当設定なし' });
    if (!periodDone) results.push({ name: '午前午後の制限', result: 'SKIP', reason: '該当設定なし' });
    if (Number(MAX_RESERVATIONS) > 0 && Number(MAX_RESERVATIONS) <= 1000) {
      const fixtures = Array.from({ length: Number(MAX_RESERVATIONS) }, () => {
        const row = []; row[COL.USER_ID] = uid; row[COL.DATE] = candidate.parsed.dateStr; row[COL.STATUS] = STATUS_RESERVED; return row;
      });
      check('予約上限に達している場合', candidate.id, 'reservation_limit', fixtures);
      fixtures.forEach(row => { row[COL.STATUS] = STATUS_CANCELED; });
      check('キャンセル済みは予約上限に含めない', candidate.id, null, fixtures);
    } else results.push({ name: '予約上限', result: 'SKIP', reason: '無制限または検証件数の範囲外' });
    const summary = { pass: results.filter(x => x.result === 'PASS').length, fail: results.filter(x => x.result === 'FAIL').length, skip: results.filter(x => x.result === 'SKIP').length };
    console.log('予約ルール検証結果: ' + JSON.stringify(summary));
    if (summary.fail) throw new Error('FAILがあります。実行ログを確認してください。');
    return summary;
  } finally { lock.releaseLock(); }
}
