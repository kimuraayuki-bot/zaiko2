//==========================================
// Stock.gs
// 在庫の直接調整
//==========================================

const STOCK_SHEET_MATERIALS = '🫘｜材料一覧';
const STOCK_SHEET_ITEMS = '🥤｜物品一覧';
const STOCK_SHEET_HISTORY = '📦｜履歴';

function updateStockDirectly(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = (data.category === '材料') ? STOCK_SHEET_MATERIALS : STOCK_SHEET_ITEMS;
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) return 'エラー: シートが見つかりません';
  if (!data || !data.name) return 'エラー: 入力が不正です';
  const newQty = Number(data.newQty);
  if (!isFinite(newQty) || newQty < 0) return 'エラー: 数量が不正です';

  const values = sheet.getDataRange().getValues();
  let targetRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === data.name) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) return 'エラー: アイテムが見つかりません';
  const currentQty = Number(values[targetRow - 1][11]) || 0;
  const diff = newQty - currentQty;
  if (diff === 0) return `${data.name} の在庫に変更はありません`;

  const historySheet = ss.getSheetByName(STOCK_SHEET_HISTORY);
  if (!historySheet) return 'エラー: 履歴シートが見つかりません';
  historySheet.appendRow([
    new Date(),
    data.category,
    data.name,
    '在庫調整',
    diff,
    values[targetRow - 1][12] || '',
    '直接調整',
    ''
  ]);

  return `${data.name} の在庫を ${newQty} に更新しました`;
}
