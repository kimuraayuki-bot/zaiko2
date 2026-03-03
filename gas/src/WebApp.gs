//==========================================
// WebApp.gs
// HTML表示とマスタ取得・保存
//==========================================

const WEBAPP_SHEET_MATERIALS = '🫘｜材料一覧';
const WEBAPP_SHEET_ITEMS = '🥤｜物品一覧';
const WEBAPP_SHEET_RECIPES = '☕｜商品一覧';
const WEBAPP_SHEET_HISTORY = '📦｜履歴';
const WEBAPP_SHEET_AUTH = '🔐｜認証メール';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_OAUTH_CLIENT_ID =
  PropertiesService.getScriptProperties().getProperty('GOOGLE_OAUTH_CLIENT_ID') || '';
const SESSION_TTL_SEC = 60 * 60;

function doGet(e) {
  const sessionToken = e && e.parameter ? String(e.parameter.st || '') : '';
  const session = sessionToken ? getSessionFromToken_(sessionToken, true) : null;
  if (!session) {
    return createUnauthorizedHtml_();
  }
  return buildAppHtml_(sessionToken);
}

function doPost(e) {
  const bootstrapSessionToken = e && e.parameter ? String(e.parameter.bootstrapSessionToken || '') : '';
  if (bootstrapSessionToken) {
    const session = getSessionFromToken_(bootstrapSessionToken, true);
    if (!session) {
      return createUnauthorizedHtml_();
    }
    return buildAppHtml_(bootstrapSessionToken);
  }

  const request = parseJsonRequest_(e);
  if (!request.ok) {
    return jsonResponse_({
      status: 401,
      ok: false,
      code: 'invalid_json',
      message: 'invalid request body'
    });
  }

  const idToken = String(request.data.idToken || '');
  const action = String(request.data.action || '');
  const payload = request.data.payload && typeof request.data.payload === 'object' ? request.data.payload : {};

  if (action === 'revokeSession') {
    revokeSession_(String(payload.sessionToken || ''));
    return jsonResponse_({
      status: 200,
      ok: true,
      data: {
        revoked: true
      }
    });
  }

  if (!idToken) {
    return jsonResponse_({
      status: 401,
      ok: false,
      code: 'missing_token',
      message: 'id token is required'
    });
  }

  const verifyResult = verifyGoogleIdToken_(idToken);
  if (!verifyResult.ok) {
    return jsonResponse_({
      status: 401,
      ok: false,
      code: verifyResult.code || 'unauthorized',
      message: 'authentication failed'
    });
  }

  if (!isAllowedEmail_(verifyResult.email)) {
    return jsonResponse_({
      status: 403,
      ok: false,
      code: 'forbidden',
      message: 'permission denied'
    });
  }

  if (action === 'createSession') {
    const session = createSession_(verifyResult.email);
    return jsonResponse_({
      status: 200,
      ok: true,
      email: verifyResult.email,
      data: {
        ok: true,
        now: new Date().toISOString(),
        sessionToken: session.token,
        expiresIn: session.expiresIn
      }
    });
  }

  if (action === 'ping') {
    return jsonResponse_({
      status: 200,
      ok: true,
      email: verifyResult.email,
      data: {
        ok: true,
        now: new Date().toISOString()
      }
    });
  }

  return jsonResponse_({
    status: 400,
    ok: false,
    code: 'unknown_action',
    message: 'unknown action'
  });
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function buildAppHtml_(sessionToken) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.sessionToken = String(sessionToken || '');
  return template
    .evaluate()
    .setTitle('Cafe Inventory Smart')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function createUnauthorizedHtml_() {
  const deny = HtmlService.createHtmlOutput(
    '<!doctype html><html><body><h3>401 Unauthorized</h3><p>Session is missing or expired.</p></body></html>'
  );
  deny.setTitle('Unauthorized');
  deny.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return deny;
}

function parseJsonRequest_(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return { ok: false };
    return { ok: true, data: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : 'parse_error'
    };
  }
}

function verifyGoogleIdToken_(idToken) {
  if (!GOOGLE_OAUTH_CLIENT_ID) return { ok: false, code: 'server_misconfigured' };

  let res;
  try {
    res = UrlFetchApp.fetch(
      GOOGLE_TOKENINFO_URL + '?id_token=' + encodeURIComponent(idToken),
      {
        method: 'get',
        muteHttpExceptions: true
      }
    );
  } catch (err) {
    return { ok: false, code: 'tokeninfo_unreachable' };
  }

  if (res.getResponseCode() !== 200) return { ok: false, code: 'token_invalid' };

  let tokenInfo;
  try {
    tokenInfo = JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    return { ok: false, code: 'token_parse_failed' };
  }

  const aud = String(tokenInfo.aud || '');
  if (aud !== GOOGLE_OAUTH_CLIENT_ID) return { ok: false, code: 'aud_mismatch' };

  const iss = String(tokenInfo.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    return { ok: false, code: 'iss_invalid' };
  }

  const exp = Number(tokenInfo.exp || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!isFinite(exp) || exp <= nowSec) return { ok: false, code: 'token_expired' };

  const emailVerified = String(tokenInfo.email_verified || '').toLowerCase() === 'true';
  if (!emailVerified) return { ok: false, code: 'email_not_verified' };

  const email = String(tokenInfo.email || '').toLowerCase();
  if (!email) return { ok: false, code: 'email_missing' };

  return { ok: true, email: email };
}

function readAllowedEmails_() {
  const sheet = ensureAuthSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getDisplayValues()
    .map(function(row) { return String(row[0] || '').trim().toLowerCase(); })
    .filter(function(email) { return email; });
}

function isAllowedEmail_(email) {
  const allowList = readAllowedEmails_();
  if (allowList.length === 0) return false;
  return allowList.indexOf(String(email || '').toLowerCase()) !== -1;
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function createSession_(email) {
  const token =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');
  const cacheKey = 'sess:' + token;
  const session = {
    email: String(email || '').toLowerCase(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + (SESSION_TTL_SEC * 1000)
  };
  CacheService.getScriptCache().put(cacheKey, JSON.stringify(session), SESSION_TTL_SEC);
  return { token: token, expiresIn: SESSION_TTL_SEC };
}

function getSessionFromToken_(token, touch) {
  if (!token) return null;
  const cacheKey = 'sess:' + String(token);
  const raw = CacheService.getScriptCache().get(cacheKey);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (!session || !session.email) return null;
    if (Number(session.expiresAt || 0) <= Date.now()) {
      CacheService.getScriptCache().remove(cacheKey);
      return null;
    }
    if (touch) {
      session.expiresAt = Date.now() + (SESSION_TTL_SEC * 1000);
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(session), SESSION_TTL_SEC);
    }
    return session;
  } catch (err) {
    return null;
  }
}

function revokeSession_(token) {
  if (!token) return;
  CacheService.getScriptCache().remove('sess:' + String(token));
}

function requireSession_(sessionToken) {
  const session = getSessionFromToken_(sessionToken, true);
  if (!session) {
    throw new Error('セッションが切れました。再ログインしてください。');
  }
  return session;
}

function appendToLogInternal_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName(WEBAPP_SHEET_HISTORY);
  if (!historySheet) {
    throw new Error('履歴シートが見つかりません');
  }
  historySheet.appendRow(data);
}

function getInitialData(sessionToken) {
  requireSession_(sessionToken);
  return getInitialDataInternal_();
}

function getInitialDataInternal_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  const fetch = (sheetName, category) => {
    const s = ss.getSheetByName(sheetName);
    if (!s) return [];
    return s.getDataRange().getValues().slice(1).map(r => {
      const name = r[0];
      const thresholdRaw = r[1];
      const thresholdNum = Number(thresholdRaw);
      const thresholdUnit = String(r[2] || r[12] || '').trim();
      const unit = String(r[12] || '').trim();
      let thresholdBaseQty = thresholdNum;
      if (isFinite(thresholdNum) && thresholdUnit && unit) {
        try {
          thresholdBaseQty = convertQtyToBase(name, thresholdNum, thresholdUnit, unit);
        } catch (e) {
          thresholdBaseQty = thresholdNum;
        }
      }
      return {
        name: name,
        threshold: thresholdRaw,
        thresholdUnit: thresholdUnit || unit,
        thresholdBaseQty: thresholdBaseQty,
        unit: unit,
        uName: r[3],
        uQty: r[4],
        supplier: r[6],
        method: r[7],
        url: r[8],
        stdQty: r[9],
        currentQty: r[11],
        category: category
      };
    }).filter(x => x.name);
  };

  const mat = fetch(WEBAPP_SHEET_MATERIALS, '材料');
  const item = fetch(WEBAPP_SHEET_ITEMS, '物品');
  const convMap = getItemConversionsMap();
  mat.forEach(x => {
    x.unitConversions = getUnitOptionsForItem(x.name, x.unit, convMap);
    x.unitOptions = x.unitConversions.map(o => o.unit);
  });
  item.forEach(x => {
    x.unitConversions = getUnitOptionsForItem(x.name, x.unit, convMap);
    x.unitOptions = x.unitConversions.map(o => o.unit);
  });

  const recipes = ss.getSheetByName(WEBAPP_SHEET_RECIPES)?.getDataRange().getValues().slice(1).map(r => {
    const items = [];
    for (let i = 2; i < r.length; i += 3) {
      const name = r[i];
      const qty = r[i + 1];
      const unit = r[i + 2];
      if (name && qty !== '') items.push({ name: name, qty: qty, unit: unit || '' });
    }
    return { name: r[0], num: r[1], items: items };
  }).filter(x => x.name) || [];

  const shopName = props.getProperty('SHOP_NAME') || 'Cafe Inventory Smart';
  const shopStaff = props.getProperty('STAFF_NAME') || '担当者';

  return {
    materials: mat,
    items: item,
    masterAll: mat.concat(item),
    recipes: recipes,
    masterWithUnits: mat.concat(item),
    shop: { name: shopName, staff: shopStaff },
    shopName: shopName,
    shopStaff: shopStaff
  };
}

function saveMasterGAS(d, sheetName, sessionToken) {
  requireSession_(sessionToken);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  let rowIdx = data.findIndex(r => r[0] === d.oldName || r[0] === d.name) + 1;
  const targetRow = rowIdx > 0 ? rowIdx : Math.max(sheet.getLastRow() + 1, 2);
  const formula = "=SUMIF('" + WEBAPP_SHEET_HISTORY + "'!C:C, A" + targetRow + ", '" + WEBAPP_SHEET_HISTORY + "'!E:E)";

  const rowData = [
    d.name, d.threshold, (d.thresholdUnit || d.unit), d.uName, d.uQty, d.unit,
    d.supplier, d.method, d.url, d.stdQty, 'セット', formula, d.unit
  ];

  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
  return 'マスタを保存しました';
}

function deleteMasterGAS(name, sheetName, sessionToken) {
  requireSession_(sessionToken);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const idx = sheet.getDataRange().getValues().findIndex(r => r[0] === name) + 1;
  if (idx > 0) sheet.deleteRow(idx);
  return '削除しました';
}

function saveShopSettings(d, sessionToken) {
  requireSession_(sessionToken);
  const p = PropertiesService.getScriptProperties();
  p.setProperty('SHOP_NAME', d.name);
  p.setProperty('STAFF_NAME', d.staff);
  return '店舗情報を保存しました';
}

function getAllowedEmailSettings(sessionToken) {
  requireSession_(sessionToken);
  const sheet = ensureAuthSheet_();
  const lastRow = sheet.getLastRow();
  const emails = lastRow < 2
    ? []
    : sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues().map(function(row) {
        return {
          email: String(row[0] || '').trim().toLowerCase(),
          createdAt: row[1] || '',
          note: row[2] || ''
        };
      }).filter(function(row) { return row.email; });

  return { emails: emails };
}

function addAllowedEmail(email, note, sessionToken) {
  requireSession_(sessionToken);
  const normalized = normalizeAllowedEmail_(email);
  if (!normalized) throw new Error('メールアドレスを入力してください');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureAuthSheet_();
    const values = readAllowedEmails_();
    if (values.indexOf(normalized) !== -1) {
      throw new Error('そのメールアドレスはすでに登録されています');
    }

    sheet.appendRow([
      normalized,
      Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
      String(note || '').trim()
    ]);
    return '認証メールを追加しました';
  } finally {
    lock.releaseLock();
  }
}

function removeAllowedEmail(email, sessionToken) {
  requireSession_(sessionToken);
  const normalized = normalizeAllowedEmail_(email);
  if (!normalized) throw new Error('削除対象のメールアドレスが不正です');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureAuthSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('登録済みメールアドレスがありません');

    const values = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim().toLowerCase() === normalized) {
        sheet.deleteRow(i + 2);
        return '認証メールを削除しました';
      }
    }
    throw new Error('対象のメールアドレスが見つかりません');
  } finally {
    lock.releaseLock();
  }
}

function ensureAuthSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(WEBAPP_SHEET_AUTH);
  if (!sheet) {
    sheet = ss.insertSheet(WEBAPP_SHEET_AUTH);
  }

  const header = [['email', 'createdAt', 'note']];
  const current = sheet.getRange(1, 1, 1, 3).getDisplayValues();
  if (current[0].join('|') !== header[0].join('|')) {
    sheet.getRange(1, 1, 1, 3).setValues(header);
  }
  return sheet;
}

function normalizeAllowedEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
