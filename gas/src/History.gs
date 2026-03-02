//==========================================
// History.gs
// 履歴シートへの書き込み
//==========================================

function appendToLog(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('📦｜履歴');
  if (!historySheet) {
    throw new Error('履歴シートが見つかりません');
  }
  historySheet.appendRow(data);
}
