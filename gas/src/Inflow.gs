//==========================================
// Inflow.gs
// 入庫関連
//==========================================

function analyzeReceiptAI(base64) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です');
  if (!base64) throw new Error('レシート画像データが空です');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  const payload = {
    contents: [{
      parts: [
        { text: 'レシート画像から商品名(name)と数量(qty)のみをJSON配列で返してください。' },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            qty: { type: 'NUMBER' }
          },
          required: ['name', 'qty']
        }
      }
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('AI APIエラー: ' + res.getContentText());
  }

  const jsonResponse = JSON.parse(res.getContentText());
  const resultText = jsonResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!resultText) {
    throw new Error('AI応答の解析に失敗しました');
  }

  const parsed = JSON.parse(resultText);
  if (!Array.isArray(parsed)) {
    throw new Error('AI応答形式が不正です');
  }
  return parsed;
}

function processAIInflow(dataList) {
  const initial = getInitialData().masterAll;
  let applied = 0;
  let skipped = 0;

  (dataList || []).forEach(d => {
    const targetName = String(d.targetName || d.name || '').trim();
    const qty = Number(d.qty);
    if (!targetName || !isFinite(qty) || qty <= 0) {
      skipped++;
      return;
    }

    const m = initial.find(x => x.name === targetName);
    if (!m) {
      skipped++;
      return;
    }

    const inputUnit = String(d.inputUnit || d.unit || m.unit || '').trim() || m.unit;
    let changeAmount = 0;
    try {
      changeAmount = convertQtyToBase(m.name, qty, inputUnit, m.unit);
    } catch (e) {
      skipped++;
      return;
    }

    appendToLog([new Date(), m.category, m.name, '入庫', changeAmount, m.unit, 'AI解析入庫', '']);
    applied++;
  });

  return skipped > 0
    ? `${applied}件の入庫を登録しました（${skipped}件は未登録/無効のためスキップ）`
    : `${applied}件の入庫を登録しました`;
}

function processInflowFromUI(d) {
  if (!d || !d.name) return 'エラー: 入力が不正です';
  const initial = getInitialData().masterAll;
  const m = initial.find(x => x.name === d.name);
  if (!m) return 'エラー: マスタが見つかりません';
  const qty = Number(d.qty);
  if (!isFinite(qty) || qty <= 0) return 'エラー: 数量が不正です';

  let changeAmount = 0;
  if (d.isSet) {
    changeAmount = qty * (Number(m.uQty) || 1);
  } else {
    const inputUnit = d.inputUnit || m.unit;
    changeAmount = convertQtyToBase(m.name, qty, inputUnit, m.unit);
  }

  appendToLog([new Date(), m.category, m.name, '入庫', changeAmount, m.unit, d.memo || '手動入庫', '']);
  return `入庫登録: ${d.name} (+${changeAmount}${m.unit})`;
}
