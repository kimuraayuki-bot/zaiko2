//==========================================
// Outflow.gs
// 出庫関連
//==========================================

function analyzeSalesCSV(csvData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recipes = ss.getSheetByName('☕｜商品一覧').getDataRange().getValues();
  const source = String(csvData || '');
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(line => line !== '');
  if (!lines || lines.length === 0) return { summary: [], reductions: {} };
  const delim = (lines[0].split('\t').length > lines[0].split(',').length) ? '\t' : ',';
  const rows = (delim === '\t')
    ? lines.map(line => line.split('\t'))
    : Utilities.parseCsv(source);
  if (!rows || rows.length === 0) return { summary: [], reductions: {} };

  const normalize = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  const header = (rows[0] || []).map(normalize);
  const findIdx = (cands, fallbackIdx) => {
    const normalizedCands = cands.map(normalize).sort((a, b) => b.length - a.length);
    const idx = header.findIndex(h => normalizedCands.some(c => h === c || h.includes(c)));
    return idx >= 0 ? idx : fallbackIdx;
  };

  const idxProductNum = findIdx(['商品番号', '商品コード', 'sku', 'itemsku', 'itemvariationsku', 'variationid', '商品id'], 3);
  const idxProductName = findIdx(['商品名', '商品', '品名', 'item', 'itemname', 'menuitemname'], 4);
  const idxSalesQty = findIdx(['数量', '売上数', '販売数', '販売商品数', '件数', 'qty', 'quantity'], 5);
  const idxRefundQty = findIdx(['払い戻し数', '払戻済商品', '払戻済商品（一部払戻分除く）', 'refundqty', 'refundedquantity'], -1);
  const idxType = findIdx(['取引種別', '取引タイプ', 'タイプ', '種別', '支払/払戻', 'eventtype', 'transactiontype', 'saletype'], -1);
  const idxStatus = findIdx(['ステータス', '状態', 'status'], -1);
  const idxMemo = findIdx(['メモ', '備考', 'note', 'memo'], -1);
  const hasRefundMark = v => /(払い戻し|返金|返品|refund|return|void|cancel)/i.test(String(v || ''));
  const toNum = v => {
    if (typeof v === 'number') return v;
    const s = String(v || '').replace(/,/g, '').replace(/[^\d.-]/g, '');
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  };

  const recipeByNum = {};
  recipes.slice(1).forEach(r => {
    const num = String(r[1] || '').trim();
    if (num) recipeByNum[num] = r;
  });

  let salesSummary = [];
  let reductions = {};

  rows.forEach((row, index) => {
    if (index === 0 || row.length === 0) return;
    const productNum = String(row[idxProductNum] || '').replace(/"/g, '').trim();
    const productName = String(row[idxProductName] || '').replace(/"/g, '').trim();
    const salesQty = toNum(row[idxSalesQty]);
    const refundQty = (idxRefundQty >= 0) ? toNum(row[idxRefundQty]) : 0;
    const isRefundRow =
      (isFinite(salesQty) && salesQty < 0) ||
      (isFinite(refundQty) && refundQty !== 0) ||
      (idxType >= 0 && hasRefundMark(row[idxType])) ||
      (idxStatus >= 0 && hasRefundMark(row[idxStatus])) ||
      (idxMemo >= 0 && hasRefundMark(row[idxMemo]));
    if (!productNum) return;
    if (!isFinite(salesQty) || salesQty <= 0 || isRefundRow) return;

    const recipe = recipeByNum[productNum];
    if (!recipe) return;
    salesSummary.push({ num: productNum, name: productName, qty: salesQty });

    for (let i = 2; i < recipe.length; i += 3) {
      const matName = recipe[i];
      const matQty = recipe[i + 1];
      const matUnit = recipe[i + 2];
      if (matName && matQty) {
        if (!reductions[matName]) reductions[matName] = { qty: 0, unit: matUnit };
        reductions[matName].qty += (Number(matQty) * salesQty);
      }
    }
  });

  return { summary: salesSummary, reductions: reductions };
}

function registerOutflowFinal(reductionData) {
  const date = new Date();
  const initial = getInitialData().masterAll;
  let count = 0;
  let skipped = 0;

  for (let name in reductionData) {
    const item = reductionData[name];
    const m = initial.find(x => x.name === name);
    const category = m ? m.category : '材料';

    let baseQty = Number(item.qty) || 0;
    let baseUnit = item.unit || '';
    if (m) {
      try {
        baseQty = convertQtyToBase(name, item.qty, item.unit || m.unit, m.unit);
        baseUnit = m.unit;
      } catch (e) {
        skipped++;
        continue;
      }
    }

    if (!isFinite(baseQty) || baseQty <= 0) {
      skipped++;
      continue;
    }

    appendToLog([date, category, name, '出庫', -baseQty, baseUnit, 'Square売上連携', '']);
    count++;
  }

  return skipped > 0
    ? `${count}件の出庫を登録しました（${skipped}件は未登録/無効のためスキップ）`
    : `${count}件の出庫を登録しました`;
}
