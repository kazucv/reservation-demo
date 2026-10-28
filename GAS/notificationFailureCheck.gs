// Manual, demo-only setup. No reservation is created by this function.
function armDemoNotificationFailureOnce() {
  if (SHEET_ID !== '15JK9k0MkUVjq1znn6GHi8E3L-zyi6H-8MxsfxVCq3xQ' ||
      CALENDAR_ID !== 'b57dcd69b7d8e60267488712be9345f9702c8dafd7bcfc563d9d03f538104b8d@group.calendar.google.com') {
    throw new Error('デモ用の保存先ではないため中止しました。');
  }
  PropertiesService.getScriptProperties().setProperty('DEMO_NOTICE_FAILURE_ONCE', String(Date.now() + 10 * 60 * 1000));
  console.log('10分以内の次の予約・キャンセル・再予約で、本人通知を1回だけ失敗扱いにします。予約自体は正常に保存されます。');
}
function cancelDemoNotificationFailure() {
  PropertiesService.getScriptProperties().deleteProperty('DEMO_NOTICE_FAILURE_ONCE');
  console.log('通知失敗テストを解除しました。');
}
