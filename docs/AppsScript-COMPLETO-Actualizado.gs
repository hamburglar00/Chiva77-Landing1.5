/*********************************************
 * CONFIGURACIÓN - CH1
 *********************************************/
const CONFIG = {
  ACCESS_TOKEN: 'EAANTjQZAZAldUBQqZA80gYz1TxctLvyTJZBdTckJUR0Abb3rwkQWyzZAmCF6Cw2xVyLIn0bDk1ZCZByHhn6j6ZCJ3ZCqsTVu9xm6AhMFD1sJhWA7DODRZCF0aZCusgYtVXpkgn90Y35pyVtOQb7kq6NnkXb1nD5ZAoeNb9Ncp2lhmF4QbZCZBswzLlcUcsBiVwip8jzQiBegZDZD',
  PIXEL_ID: '1849164609062818',
  EVENT_SOURCE_URL: 'https://geraganamos.vercel.app/',
  CURRENCY: 'ARS',
  SHEET_NAME: 'Leads',
  API_VERSION: 'v20.0',
  ENABLE_LOGS: true
};

const API_URL = `https://graph.facebook.com/${CONFIG.API_VERSION}/${CONFIG.PIXEL_ID}/events`;


/**********************************************************
 * doPost: 2 entradas previas + entrada simple por phone
 * A) Payload de la landing -> append estado "contact" (NO CAPI)
 * B) JSON { action: "LEAD" | "PURCHASE", ... } -> CAPI
 * C) JSON simple { phone, amount } -> append + CAPI (nuevo)
 **********************************************************/
function doPost(e) {
  const params = JSON.parse(e.postData?.contents || '{}');

  // C) Modo simple: { phone, amount } sin "action"
  if (!params.action && params.phone && params.amount) {
    return handleSimplePurchase(params); // nuevo
  }

  if (params.action === 'LEAD')     return handleActionLead(params);
  if (params.action === 'PURCHASE') return handleActionPurchase(params);

  return registrarLeadDesdeLanding(params);
}

/**********************************************************
 * A) Registrar contacto desde la landing (append SIN enviar Lead)
 **********************************************************/
function registrarLeadDesdeLanding(p) {
  const sheet   = getLeadsSheet();
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const nowIso  = new Date().toISOString();

  const norm = s => String(s || "").trim();
  const row = Array(headers.length).fill('');

  setIfExists(row, headers, "phone", sanitizePhone(p.phone));
  setIfExists(row, headers, "email", norm(p.email));
  setIfExists(row, headers, "fn", norm(p.fn));
  setIfExists(row, headers, "ln", norm(p.ln));

  setIfExists(row, headers, "ct", norm(p.ct || p.geo_city || ""));
  setIfExists(row, headers, "st", norm(p.st || p.geo_region || ""));
  setIfExists(row, headers, "zip", norm(p.zip));
  setIfExists(row, headers, "country", norm(p.country || p.geo_country || ""));

  setIfExists(row, headers, "fbp", p.fbp);
  setIfExists(row, headers, "fbc", p.fbc);

  setIfExists(row, headers, "event_id", p.event_id);
  setIfExists(row, headers, "event_time", Math.floor(Date.now() / 1000));
  setIfExists(row, headers, "timestamp", nowIso);

  setIfExists(row, headers, "clientIP", p.clientIP || "");
  setIfExists(row, headers, "agentuser", p.agentuser || "");
  setIfExists(row, headers, "device_type", p.device_type || "");
  setIfExists(row, headers, "geo_city", p.geo_city || "");
  setIfExists(row, headers, "geo_region", p.geo_region || "");
  setIfExists(row, headers, "geo_country", p.geo_country || "");

  setIfExists(row, headers, "estado", "contact");
  setIfExists(row, headers, "valor", "");
  setIfExists(row, headers, "lead_status_meta_CAPI (Apps Script)", "");
  setIfExists(row, headers, "purchase_status_meta_CAPI (Apps Script)", "");
  setIfExists(row, headers, "observaciones", "");
  setIfExists(row, headers, "external_id", norm(p.external_id || ""));
  setIfExists(row, headers, "utm_campaign", norm(p.utm_campaign || ""));
  setIfExists(row, headers, "telefono_asignado", norm(p.telefono_asignado || ""));
  setIfExists(row, headers, "promo_code", norm(p.promo_code || ""));
  setIfExists(row, headers, "event_source_url", p.event_source_url || CONFIG.EVENT_SOURCE_URL);

  sheet.appendRow(row);

  escribirLog('doPost', 'INFO', 'Nuevo contacto registrado (landing, sin CAPI)', JSON.stringify(p));
  return textOut("Success");
}

/**********************************************************
 * B1) ACTION: LEAD (upsert por promo_code + enviar Lead)
 **********************************************************/
function handleActionLead(p) {
  const required = ["promo_code", "phone"];
  if (!hasAll(p, required)) {
    escribirLog('handleActionLead', 'ERROR', 'Faltan parámetros', JSON.stringify(p));
    return textOut("Faltan parámetros: promo_code y phone requeridos");
  }

  const sheet   = getLeadsSheet();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const iPromo  = headers.indexOf("promo_code");
  const iEstado = headers.indexOf("estado");
  const iPhone  = headers.indexOf("phone");

  let updatedRow = -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][iPromo] || "") == p.promo_code) {
      if (iPhone  !== -1) sheet.getRange(i + 1, iPhone  + 1).setValue(sanitizePhone(p.phone));
      if (iEstado !== -1) sheet.getRange(i + 1, iEstado + 1).setValue("lead");
      updatedRow = i + 1;
      break;
    }
  }

  if (updatedRow === -1) {
    const row = Array(headers.length).fill('');
    setIfExists(row, headers, "promo_code", p.promo_code);
    setIfExists(row, headers, "phone", sanitizePhone(p.phone));
    setIfExists(row, headers, "estado", "lead");
    setIfExists(row, headers, "timestamp", new Date().toISOString());
    setIfExists(row, headers, "event_source_url", CONFIG.EVENT_SOURCE_URL);
    setIfExists(row, headers, "lead_status_meta_CAPI (Apps Script)", "");
    sheet.appendRow(row);
    updatedRow = sheet.getLastRow();
  }

  escribirLog('handleActionLead', 'INFO', 'LEAD actualizado/creado', JSON.stringify(p));
  enviarLeadParaFila(sheet, headers, updatedRow);
  return textOut("Fila LEAD procesada");
}

/**********************************************************
 * B2) ACTION: PURCHASE (siempre llega con promo_code)
 * - Si el phone no existe → primera compra (Purchase)
 * - Si el phone ya existe → recompra (Purchase_Repeat)
 *   ⇒ Copia todos los datos del registro previo (fbp, fbc, geo, user, etc.)
 *   ⇒ Crea un event_id nuevo
 **********************************************************/
function handleActionPurchase(p) {
  const required = ["promo_code", "phone", "amount"];
  if (!hasAll(p, required)) {
    escribirLog('handleActionPurchase', 'ERROR', 'Faltan parámetros', JSON.stringify(p));
    return textOut("Faltan parámetros: promo_code, phone, amount");
  }

  const sheet   = getLeadsSheet();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  const cleanPhone = sanitizePhone(p.phone);
  const prevCount  = countPurchasesEnviadosByPhone(cleanPhone, sheet, headers, -1);

  // Índices clave
  const iPhone = headers.indexOf("phone");
  const iPromo = headers.indexOf("promo_code");
  const iEstado = headers.indexOf("estado");
  const iValor = headers.indexOf("valor");
  const iObs = headers.indexOf("observaciones");
  const iSrcUrl = headers.indexOf("event_source_url");

  // buscar fila previa del mismo teléfono (última ocurrencia)
  let src = -1;
  for (let r = data.length - 1; r >= 1; r--) {
    const phPrev = String(data[r][iPhone] || "").replace(/\D/g, "");
    if (phPrev === cleanPhone) { src = r; break; }
  }

  // primera compra → actualiza o crea fila existente
  if (prevCount === 0) {
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][iPromo] || "") === p.promo_code) { targetRow = i + 1; break; }
    }

    if (targetRow === -1) {
      const row = Array(headers.length).fill('');
      setIfExists(row, headers, "promo_code", p.promo_code);
      setIfExists(row, headers, "phone", cleanPhone);
      setIfExists(row, headers, "estado", "purchase");
      setIfExists(row, headers, "valor", p.amount);
      setIfExists(row, headers, "timestamp", new Date().toISOString());
      setIfExists(row, headers, "event_source_url", p.event_source_url || CONFIG.EVENT_SOURCE_URL);
      sheet.appendRow(row);
      targetRow = sheet.getLastRow();
    } else {
      if (iEstado !== -1) sheet.getRange(targetRow, iEstado + 1).setValue("purchase");
      if (iValor !== -1) sheet.getRange(targetRow, iValor + 1).setValue(p.amount);
      if (iSrcUrl !== -1) sheet.getRange(targetRow, iSrcUrl + 1).setValue(p.event_source_url || CONFIG.EVENT_SOURCE_URL);
      if (iObs !== -1) sheet.getRange(targetRow, iObs + 1).setValue("");
    }

    const ok = enviarPurchaseParaFila(sheet, headers, targetRow);
    return textOut(ok ? "Primera compra enviada (Purchase)" : "Error al enviar primera compra");
  }

  // recompra → crea nueva fila con toda la identidad heredada
  const row = Array(headers.length).fill('');

  // copiar datos completos del registro previo si existe
  if (src !== -1) {
    for (let c = 0; c < headers.length; c++) {
      const col = headers[c];
      if (["event_id","event_time","lead_status_meta_CAPI (Apps Script)",
     "purchase_status_meta_CAPI (Apps Script)","observaciones",
     "valor","estado"].includes(col)) continue;
      row[c] = data[src][c];
    }
  }

  // completar campos actualizados
  setIfExists(row, headers, "promo_code", p.promo_code);
  setIfExists(row, headers, "phone", cleanPhone);
  setIfExists(row, headers, "estado", "purchase");
  setIfExists(row, headers, "valor", p.amount);
  setIfExists(row, headers, "timestamp", new Date().toISOString());
  setIfExists(row, headers, "event_id", generateEventId());
  setIfExists(row, headers, "event_time", Math.floor(Date.now() / 1000));
  setIfExists(row, headers, "event_source_url", p.event_source_url || CONFIG.EVENT_SOURCE_URL);
  setIfExists(row, headers, "observaciones", "");

  sheet.appendRow(row);
  const newRow = sheet.getLastRow();

  const ok = enviarPurchaseParaFila(sheet, headers, newRow);
  return textOut(ok ? "Recompra enviada (Purchase_Repeat)" : "Error al enviar recompra");
}

/**********************************************************
 * C) Entrada simple por phone: { phone, amount }
 **********************************************************/
function handleSimplePurchase(p) {
  const required = ["phone", "amount"];
  if (!hasAll(p, required)) {
    escribirLog('handleSimplePurchase', 'ERROR', 'Faltan parámetros', JSON.stringify(p));
    return textOut("Faltan parámetros: phone y amount");
  }

  const sheet   = getLeadsSheet();
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getDataRange().getValues();

  const cleanPhone = sanitizePhone(p.phone);

  const iPhone = headers.indexOf("phone");
  const iFbp   = headers.indexOf("fbp");
  const iFbc   = headers.indexOf("fbc");
  const iExt   = headers.indexOf("external_id");
  const iIP    = headers.indexOf("clientIP");
  const iUA    = headers.indexOf("agentuser");
  const iSrc   = headers.indexOf("event_source_url");
  const iEmail = headers.indexOf("email");
  const iFn    = headers.indexOf("fn");
  const iLn    = headers.indexOf("ln");
  const iCt    = headers.indexOf("ct");
  const iSt    = headers.indexOf("st");
  const iZip   = headers.indexOf("zip");
  const iCtry  = headers.indexOf("country");

  const row = Array(headers.length).fill('');
  setIfExists(row, headers, "phone", cleanPhone);
  setIfExists(row, headers, "valor", p.amount);
  setIfExists(row, headers, "estado", "purchase");
  setIfExists(row, headers, "timestamp", new Date().toISOString());
  setIfExists(row, headers, "event_source_url", p.event_source_url || CONFIG.EVENT_SOURCE_URL);
  setIfExists(row, headers, "purchase_status_meta_CAPI (Apps Script)", "");
  setIfExists(row, headers, "observaciones", "");

  let src = -1;
  for (let r = data.length - 1; r >= 1; r--) {
    const phPrev = String(data[r][iPhone] || "").replace(/\D/g,"");
    if (phPrev === cleanPhone) { src = r; break; }
  }

  if (src !== -1) {
    if (iFbp   !== -1) setIfExists(row, headers, "fbp",        data[src][iFbp]);
    if (iFbc   !== -1) setIfExists(row, headers, "fbc",        data[src][iFbc]);
    if (iExt   !== -1) setIfExists(row, headers, "external_id",data[src][iExt]);
    if (iIP    !== -1) setIfExists(row, headers, "clientIP",   data[src][iIP]);
    if (iUA    !== -1) setIfExists(row, headers, "agentuser",  data[src][iUA]);
    if (iSrc   !== -1 && !row[iSrc]) setIfExists(row, headers, "event_source_url", data[src][iSrc]);
    if (iEmail !== -1) setIfExists(row, headers, "email",   data[src][iEmail]);
    if (iFn    !== -1) setIfExists(row, headers, "fn",      data[src][iFn]);
    if (iLn    !== -1) setIfExists(row, headers, "ln",      data[src][iLn]);
    if (iCt    !== -1) setIfExists(row, headers, "ct",      data[src][iCt]);
    if (iSt    !== -1) setIfExists(row, headers, "st",      data[src][iSt]);
    if (iZip   !== -1) setIfExists(row, headers, "zip",     data[src][iZip]);
    if (iCtry  !== -1) setIfExists(row, headers, "country", data[src][iCtry]);
  }

  sheet.appendRow(row);
  const newRow = sheet.getLastRow();

  const ok = enviarPurchaseParaFila(sheet, headers, newRow);
  return textOut(ok ? "Evento Purchase enviado" : "Error al enviar Purchase");
}


/**********************************************************
 * Enviar Lead para una fila (1-based)
 * Actualizado: zp, normForMeta, client_user_agent fallback
 **********************************************************/
function enviarLeadParaFila(sheet, headers, row) {
  const idx = nameIndex(headers, [
    "email","phone","fn","ln","ct","st","zip","country",
    "fbp","fbc","event_id","event_time","clientIP","agentuser",
    "external_id","event_source_url","lead_status_meta_CAPI (Apps Script)"
  ]);

  const prev = idx["lead_status_meta_CAPI (Apps Script)"] === -1
    ? ""
    : String(sheet.getRange(row, idx["lead_status_meta_CAPI (Apps Script)"] + 1).getValue() || "").toLowerCase();
  if (prev === "enviado") return true;

  const v = (name) => idx[name] === -1 ? "" : sheet.getRange(row, idx[name] + 1).getValue();

  const userData = {
    ...(v("email")      ? { em: hash(String(v("email")).trim().toLowerCase()) } : {}),
    ...(v("phone")      ? { ph: hash(sanitizePhone(v("phone"))) } : {}),
    ...(v("fn")         ? { fn: hash(String(v("fn")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ln")         ? { ln: hash(String(v("ln")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ct")         ? { ct: hash(normForMeta(v("ct"), "ct")) } : {}),
    ...(v("st")         ? { st: hash(normForMeta(v("st"), "ct")) } : {}),
    ...(v("zip")        ? { zp: hash(normForMeta(v("zip"), "zp")) } : {}),
    ...(v("country")    ? { country: hash(normForMeta(v("country"), "country")) } : {}),
    ...(v("fbp")        ? { fbp: v("fbp") } : {}),
    ...(v("fbc")        ? { fbc: v("fbc") } : {}),

    ...(v("clientIP") ? (() => {
      let ip = String(v("clientIP")).trim();
      if (ip.includes(':')) return { client_ip_address: ip };
      ip = ip.replace(/[^\d.]/g, '');
      if (!ip.includes('.') && ip.length === 12) {
        ip = ip.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1.$2.$3.$4');
      }
      if (!ip.includes('.') && ip.length >= 8 && ip.length <= 11) {
        const m = ip.match(/\d{1,3}/g);
        ip = m ? m.join('.') : ip;
      }
      return ip ? { client_ip_address: ip } : {};
    })() : {}),

    ...(v("agentuser") || "Unknown" ? { client_user_agent: v("agentuser") || "Unknown" } : {}),
    ...(v("external_id")? { external_id: hash(v("external_id")) } : {})
  };

  const eventId   = v("event_id") || generateEventId();
  const eventTime = Math.floor(Date.now() / 1000);
  const srcUrl    = v("event_source_url") || CONFIG.EVENT_SOURCE_URL;

  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: eventTime,
      event_id: eventId,
      action_source: 'website',
      event_source_url: srcUrl,
      user_data: userData
    }]
  };

  try {
    const response = UrlFetchApp.fetch(`${API_URL}?access_token=${CONFIG.ACCESS_TOKEN}`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200) {
      setRowLeadSuccess(sheet, headers, row, `✅ Lead OK`);
      return true;
    } else {
      setRowLeadError(sheet, headers, row, `Error Meta Lead: ${body}`);
      return false;
    }
  } catch (err) {
    setRowLeadError(sheet, headers, row, `Error de red Lead: ${err.message}`);
    return false;
  }
}


/**********************************************************
 * Enviar Purchase para una fila (1-based)
 * Actualizado: zp, normForMeta, client_user_agent fallback
 **********************************************************/
function enviarPurchaseParaFila(sheet, headers, row) {
  const idx = nameIndex(headers, [
    "email","phone","fn","ln","ct","st","zip","country",
    "fbp","fbc","event_id","event_time","clientIP","agentuser",
    "external_id","valor","event_source_url","purchase_status_meta_CAPI (Apps Script)","observaciones"
  ]);

  const v = (name) => idx[name] === -1 ? "" : sheet.getRange(row, idx[name] + 1).getValue();

  const amount = parseFloat(v("valor")) || 0;
  if (amount <= 0) {
    setRowPurchaseError(sheet, headers, row, "Monto inválido para Purchase");
    return false;
  }

  const phone = sanitizePhone(v("phone"));
  const prevCount = countPurchasesEnviadosByPhone(phone, sheet, headers, row);

  const eventName = "Purchase";
  const successMsg = (prevCount === 0) ? "✅ Purchase OK" : "✅ Purchase Repeat OK";

  const customData = {
    currency: CONFIG.CURRENCY,
    value: amount
  };
  if (prevCount > 0) customData.purchase_type = "repeat";

  const userData = {
    ...(v("email")      ? { em: hash(String(v("email")).trim().toLowerCase()) } : {}),
    ...(phone           ? { ph: hash(phone) } : {}),
    ...(v("fn")         ? { fn: hash(String(v("fn")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ln")         ? { ln: hash(String(v("ln")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ct")         ? { ct: hash(normForMeta(v("ct"), "ct")) } : {}),
    ...(v("st")         ? { st: hash(normForMeta(v("st"), "ct")) } : {}),
    ...(v("zip")        ? { zp: hash(normForMeta(v("zip"), "zp")) } : {}),
    ...(v("country")    ? { country: hash(normForMeta(v("country"), "country")) } : {}),
    ...(v("fbp")        ? { fbp: v("fbp") } : {}),
    ...(v("fbc")        ? { fbc: v("fbc") } : {}),
    ...(v("clientIP") ? (() => {
      let ip = String(v("clientIP")).trim();
      if (ip.includes(':')) return { client_ip_address: ip };
      ip = ip.replace(/[^\d.]/g, '');
      if (!ip.includes('.') && ip.length === 12) {
        ip = ip.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1.$2.$3.$4');
      }
      if (!ip.includes('.') && ip.length >= 8 && ip.length <= 11) {
        const m = ip.match(/\d{1,3}/g);
        ip = m ? m.join('.') : ip;
      }
      return ip ? { client_ip_address: ip } : {};
    })() : {}),

    ...(v("agentuser") || "Unknown" ? { client_user_agent: v("agentuser") || "Unknown" } : {}),
    ...(v("external_id")? { external_id: hash(v("external_id")) } : {})
  };

  const eventId   = v("event_id") || generateEventId();
  const eventTime = Math.floor(Date.now() / 1000);
  const srcUrl    = v("event_source_url") || CONFIG.EVENT_SOURCE_URL;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: "website",
      event_source_url: srcUrl,
      user_data: userData,
      custom_data: customData
    }]
  };

  escribirLog('enviarPurchaseParaFila', 'DEBUG', 'Payload Meta', JSON.stringify(payload));

  try {
    const response = UrlFetchApp.fetch(`${API_URL}?access_token=${CONFIG.ACCESS_TOKEN}`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    escribirLog('enviarPurchaseParaFila', 'DEBUG', 'Respuesta Meta', body);

    if (code === 200) {
      setRowPurchaseSuccess(sheet, headers, row, successMsg);
      return true;
    } else {
      setRowPurchaseError(sheet, headers, row, `Error Meta: ${body}`);
      return false;
    }
  } catch (err) {
    setRowPurchaseError(sheet, headers, row, `Error de red: ${err.message}`);
    return false;
  }
}


/**********************************************************
 * Batch opcional (cron de respaldo para Purchases)
 **********************************************************/
function revisarYEnviarCompras() {
  const sheet   = getLeadsSheet();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  const idx = nameIndex(headers, ["estado","valor","purchase_status_meta_CAPI (Apps Script)"]);
  for (let i = 1; i < data.length; i++) {
    const estado = (idx.estado === -1 ? "" : String(data[i][idx.estado] || "").toLowerCase());
    const valor  = (idx.valor  === -1 ? "" : data[i][idx.valor]);
    const status = (idx["purchase_status_meta_CAPI (Apps Script)"] === -1 ? "" : String(data[i][idx["purchase_status_meta_CAPI (Apps Script)"]] || "").toLowerCase());

    if (estado !== 'purchase') continue;
    if (!valor) continue;
    if (status === 'enviado') continue;

    enviarPurchaseParaFila(sheet, headers, i + 1);
  }
}

/**********************************************************
 * Helpers
 **********************************************************/
function sanitizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function normForMeta(value, type) {
  if (!value || String(value).trim() === "") return "";
  const v = String(value).trim().toLowerCase();
  if (type === "ct") {
    return v.replace(/[\s\p{P}\p{S}]/gu, "");
  }
  if (type === "zp") {
    return String(v).replace(/\D/g, "").slice(0, 12);
  }
  if (type === "country") {
    const countryMap = {
      "argentina": "ar", "ar": "ar",
      "estados unidos": "us", "usa": "us", "us": "us",
      "méxico": "mx", "mexico": "mx", "mx": "mx",
      "españa": "es", "espana": "es", "es": "es",
      "colombia": "co", "co": "co",
      "chile": "cl", "cl": "cl",
      "perú": "pe", "peru": "pe", "pe": "pe",
      "uruguay": "uy", "uy": "uy",
      "paraguay": "py", "py": "py",
      "brasil": "br", "brazil": "br", "br": "br"
    };
    return countryMap[v] || (v.length === 2 ? v : "");
  }
  return v;
}

function countPurchasesEnviadosByPhone(phone, sheet, headers, currentRow) {
  const target = sanitizePhone(phone);
  if (!target) return 0;
  const data = sheet.getDataRange().getValues();
  const iPhone  = headers.indexOf('phone');
  const iStatus = headers.indexOf('purchase_status_meta_CAPI (Apps Script)');
  let count = 0;
  for (let r = 1; r < data.length; r++) {
    const rowNum = r + 1;
    if (rowNum === currentRow) continue;
    const ph = sanitizePhone(iPhone === -1 ? "" : data[r][iPhone]);
    const st = String(iStatus === -1 ? "" : data[r][iStatus] || "").toLowerCase();
    if (ph && ph === target && st === 'enviado') count++;
  }
  return count;
}

function getLeadsSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
}
function textOut(msg) {
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}
function hasAll(o, keys) {
  return keys.every(k => o[k] !== undefined && o[k] !== null && String(o[k]).toString().trim() !== "");
}
function setIfExists(row, headers, name, value) {
  const idx = headers.indexOf(name);
  if (idx !== -1 && value !== undefined) row[idx] = value;
}
function nameIndex(headers, names) {
  if (Array.isArray(names)) {
    const res = {};
    names.forEach(n => res[n] = headers.indexOf(n));
    return res;
  }
  return headers.indexOf(names);
}

function setRowPurchaseSuccess(sheet, headers, row, msg) {
  const iStatus = headers.indexOf('purchase_status_meta_CAPI (Apps Script)');
  const iObs    = headers.indexOf('observaciones');
  if (iStatus !== -1) sheet.getRange(row, iStatus + 1).setValue('enviado');
  if (iObs    !== -1) sheet.getRange(row, iObs + 1).setValue(msg);
}
function setRowPurchaseError(sheet, headers, row, msg) {
  const iStatus = headers.indexOf('purchase_status_meta_CAPI (Apps Script)');
  const iObs    = headers.indexOf('observaciones');
  if (iStatus !== -1) sheet.getRange(row, iStatus + 1).setValue('error');
  if (iObs    !== -1) sheet.getRange(row, iObs + 1).setValue(msg);
}

function setRowLeadSuccess(sheet, headers, row, msg) {
  const iStatus = headers.indexOf('lead_status_meta_CAPI (Apps Script)');
  const iObs    = headers.indexOf('observaciones');
  if (iStatus !== -1) sheet.getRange(row, iStatus + 1).setValue('enviado');
  if (iObs    !== -1) sheet.getRange(row, iObs + 1).setValue(msg);
}
function setRowLeadError(sheet, headers, row, msg) {
  const iStatus = headers.indexOf('lead_status_meta_CAPI (Apps Script)');
  const iObs    = headers.indexOf('observaciones');
  if (iStatus !== -1) sheet.getRange(row, iStatus + 1).setValue('error');
  if (iObs    !== -1) sheet.getRange(row, iObs + 1).setValue(msg);
}

function generateEventId() {
  return Utilities.getUuid();
}

function hash(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value).trim().toLowerCase(), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}
function getSafeEventTime(t) {
  const now = Math.floor(Date.now() / 1000);
  const parsed = Math.floor(new Date(t).getTime() / 1000);
  return (!isNaN(parsed) && parsed > now - 604800 && parsed <= now) ? parsed : now;
}
function escribirLog(funcion, nivel, mensaje, detalle = '') {
  if (!CONFIG.ENABLE_LOGS) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("Logs") || ss.insertSheet("Logs");
  if (logSheet.getLastRow() === 0) logSheet.appendRow(["Timestamp","Función","Nivel","Mensaje","Detalle"]);
  logSheet.appendRow([new Date().toISOString(), funcion, nivel, mensaje, detalle]);
}

/*************************************************
 * Reportes
 *************************************************/
function generarEstadisticasGeoDispositivo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stats = ss.getSheetByName("Estadisticas") || ss.insertSheet("Estadisticas");
  stats.clear();

  const leads = ss.getSheetByName(CONFIG.SHEET_NAME);
  const data = leads.getDataRange().getValues();
  const headers = data[0];

  const indices = {
    ciudad: headers.indexOf("geo_city"),
    region: headers.indexOf("geo_region"),
    device: headers.indexOf("device_type"),
    valor: headers.indexOf("valor")
  };

  const total = Math.max(0, data.length - 1);

  const agrupar = (idx) => {
    const result = {};
    for (let i = 1; i < data.length; i++) {
      const key = idx === -1 ? 'Sin dato' : (data[i][idx] || 'Sin dato');
      const val = parseFloat(indices.valor === -1 ? 0 : (data[i][indices.valor] || 0)) || 0;
      if (!result[key]) result[key] = { count: 0, total: 0 };
      result[key].count++;
      result[key].total += val;
    }
    return result;
  };

  const escribir = (titulo, datos, col, incluirTotal) => {
    const encabezados = ["", "Cantidad", "Porcentaje", ...(incluirTotal ? ["Total ARS"] : [])];
    stats.getRange(1, col).setValue(titulo);
    stats.getRange(2, col, 1, encabezados.length).setValues([encabezados]);
    stats.getRange(2, col, 1, encabezados.length).setFontWeight("bold").setBackground("#d9ead3");

    let rows = [];
    let sumaTotal = 0;

    for (const key in datos) {
      const d = datos[key];
      const porc = total > 0 ? ((d.count / total) * 100).toFixed(1) + "%" : "0%";
      if (incluirTotal) sumaTotal += d.total;
      rows.push(incluirTotal ? [key, d.count, porc, d.total] : [key, d.count, porc]);
    }

    if (incluirTotal) rows.sort((a, b) => b[3] - a[3]);
    else rows.sort((a, b) => b[1] - a[1]);

    if (rows.length > 0) {
      stats.getRange(3, col, rows.length, encabezados.length).setValues(rows);
      stats.getRange(3, col, rows.length, encabezados.length).setBorder(true, true, true, true, true, true);
      if (incluirTotal) {
        const totalRow = 3 + rows.length;
        stats.getRange(totalRow, col, 1, encabezados.length).setValues([["TOTAL", "", "", sumaTotal]]);
        stats.getRange(totalRow, col + 3).setNumberFormat('"$"#,##0.00');
      }
      if (incluirTotal) stats.getRange(3, col + 3, rows.length).setNumberFormat('"$"#,##0.00');
    } else {
      stats.getRange(3, col).setValue("Sin datos");
    }

    stats.autoResizeColumns(col, encabezados.length);
  };

  escribir("Ciudad", agrupar(indices.ciudad), 1, true);
  escribir("Región", agrupar(indices.region), 6, true);
  escribir("Dispositivo", agrupar(indices.device), 11, false);
}

function generarAnaliticas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaLeads = ss.getSheetByName(CONFIG.SHEET_NAME);
  const hojaAnal = ss.getSheetByName("Analiticas") || ss.insertSheet("Analiticas");
  hojaAnal.clear();

  const encabezados = ["utm_campaign", "Contactos", "Cargas", "% de carga", "Total ARS"];
  hojaAnal.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);

  const datos = hojaLeads.getDataRange().getValues();
  const hdrs = datos.shift();

  const idxUtm   = hdrs.indexOf("utm_campaign");
  const idxPhone = hdrs.indexOf("phone");
  const idxEst   = hdrs.indexOf("estado");
  const idxVal   = hdrs.indexOf("valor");

  const conteo = {};

  datos.forEach(row => {
    const utm = idxUtm === -1 ? "no_utm" : (row[idxUtm] || "no_utm");
    const ph  = idxPhone === -1 ? "" : row[idxPhone];
    const est = String(idxEst === -1 ? "" : (row[idxEst] || '')).toLowerCase();
    const val = parseFloat(idxVal === -1 ? 0 : (row[idxVal] || 0)) || 0;

    if (!conteo[utm]) conteo[utm] = { contactos: 0, inicios: 0, cargas: 0, total: 0 };

    if (ph !== null && ph !== undefined && String(ph).trim() !== "") conteo[utm].contactos++;
    if (est === "lead" || est === "purchase") conteo[utm].inicios++;
    if (est === "purchase") { conteo[utm].cargas++; conteo[utm].total += val; }
  });

  const filas = Object.entries(conteo)
    .map(([utm, v]) => {
      const porcentajeCarga = v.inicios > 0 ? (v.cargas / v.inicios) : 0;
      return [utm, v.contactos, v.cargas, porcentajeCarga, v.total];
    })
    .sort((a, b) => b[4] - a[4]);

  if (filas.length > 0) {
    hojaAnal.getRange(2, 1, filas.length, encabezados.length).setValues(filas);

    const totalContactos = Object.values(conteo).reduce((s, v) => s + v.contactos, 0);
    const totalCargas    = Object.values(conteo).reduce((s, v) => s + v.cargas, 0);
    const totalInicios   = Object.values(conteo).reduce((s, v) => s + v.inicios, 0);
    const totalArs       = Object.values(conteo).reduce((s, v) => s + v.total, 0);
    const porcentajeTotal= totalInicios > 0 ? (totalCargas / totalInicios) : 0;

    hojaAnal.appendRow(["TOTAL", totalContactos, totalCargas, porcentajeTotal, totalArs]);
    const totalRow = filas.length + 2;
    hojaAnal.getRange(totalRow, 4).setNumberFormat("0.0%");
    hojaAnal.getRange(totalRow, 5).setNumberFormat('"$"#,##0.00');
  }

  hojaAnal.getRange(2, 4, Math.max(0, hojaAnal.getLastRow() - 1)).setNumberFormat("0.0%");
  hojaAnal.getRange(2, 5, Math.max(0, hojaAnal.getLastRow() - 1)).setNumberFormat('"$"#,##0.00');

  const totalFilas = hojaAnal.getLastRow();
  if (totalFilas > 0) {
    const rango = hojaAnal.getRange(1, 1, totalFilas, encabezados.length);
    rango.setBorder(true, true, true, true, true, true);
    hojaAnal.getRange(1, 1, 1, encabezados.length).setFontWeight("bold").setBackground("#cfe2f3");
    hojaAnal.autoResizeColumns(1, encabezados.length);
  }
}
