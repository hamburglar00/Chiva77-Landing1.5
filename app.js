/************************************************************
 * ✅ CONFIG (editás solo esto)
 ************************************************************/
const LANDING_CONFIG = {
  BRAND_NAME: "",
  MODE: "ads", // "ads" | "normal"
  SERVICE_BASE: "/api/phones-pool",

  // Fallback extremo si todo falla (opcional)
  EMERGENCY_FALLBACK_NUMBER: "5491169789243",
  EMERGENCY_FALLBACK_NAME: "Soporte",

  PROMO: { ENABLED: true, LANDING_TAG: "CH1" },

  UI: {
    CLICK_GET_NUMBER_DEADLINE_MS: 2000
  },

  GEO: { ENABLED: true, PROVIDER_URL: "https://ipapi.co/json/", TIMEOUT_MS: 900 }
};

/************************************************************
 * ✅ helpers
 ************************************************************/
function fetchWithTimeout(url,opt={},ms=3000){
  const ctrl=new AbortController();const id=setTimeout(()=>ctrl.abort(),ms);
  return fetch(url,{...opt,signal:ctrl.signal}).finally(()=>clearTimeout(id));
}
function normalizePhoneDigits(raw){ return String(raw||"").replace(/\D+/g,"").trim(); }
function generateUUID(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==="x"?r:r&0x3|0x8;return v.toString(16)})}
function getDeviceType(){const ua=navigator.userAgent;if(/mobile/i.test(ua))return"mobile";if(/tablet|ipad|playbook|silk/i.test(ua))return"tablet";return"desktop";}

const qs=new URLSearchParams(location.search);
const getQueryParam=p=>qs.get(p);
const getCookie=name=>{const m=document.cookie.match(new RegExp("(^| )"+name+"=([^;]+)"));return m&&m[2];};

function getFbc(){
  const c=getCookie("_fbc");
  if(c){localStorage.setItem("stored_fbc",c);return c;}
  const s=localStorage.getItem("stored_fbc");if(s)return s;
  const fbclid=getQueryParam("fbclid");if(!fbclid)return;
  const fbc=`fb.1.${Date.now()}.${fbclid}`;localStorage.setItem("stored_fbc",fbc);return fbc;
}
function getFbp(){
  const c=getCookie("_fbp");
  if(c){localStorage.setItem("stored_fbp",c);return c;}
  const s=localStorage.getItem("stored_fbp");if(s)return s;
  const n=`fb.1.${Date.now()}.${Math.floor(Math.random()*1e10)}`;
  localStorage.setItem("stored_fbp",n);return n;
}
function getOrCreateExternalId(){
  let id=localStorage.getItem("external_id");
  if(!id){id=typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():generateUUID();localStorage.setItem("external_id",id);}
  return id;
}

/************************************************************
 * ✅ GEO
 ************************************************************/
async function detectarGeo(){
  if(!LANDING_CONFIG.GEO?.ENABLED) return { city:null, region:null, country:null };
  const timeoutMs=Number(LANDING_CONFIG.GEO.TIMEOUT_MS||900);
  try{
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),timeoutMs);
    const res=await fetch(LANDING_CONFIG.GEO.PROVIDER_URL,{signal:ctrl.signal,cache:"no-store"});
    clearTimeout(t);
    if(!res.ok) throw 0;
    const d=await res.json();
    return { city:d.city||null, region:d.region||d.region_code||null, country:d.country||d.country_code||null };
  }catch{
    return { city:null, region:null, country:null };
  }
}

/************************************************************
 * ✅ Mensaje
 ************************************************************/
function buildMensaje(promo_code, botName){
  const variantes = [
    n => `Hola! Vi este anuncio, me pasás info?`,
    n => `Hola! Vi el anuncio, podrías darme más info?`,
    n => `Buenas! Me contás un poco más del anuncio?`,
    n => `Hola! Quisiera saber más sobre lo que ofrecen.`,
    n => `Buenas! Me das más detalles por favor?`,
    n => `Hola! Estoy interesado, me contás cómo funciona?`,
    n => `Hola! Vi tu publicación, podrías ampliarme la info?`,
    n => `Holaaa! Me llamó la atención el anuncio, me contás más?`,
    n => `Hola! Vi tu publicidad, cómo es para registrarse?`,
    n => `Buenas! Me das información sobre cómo empezar?`
  ];
  const base = variantes[Math.floor(Math.random()*variantes.length)](botName || "Soporte");
  return promo_code ? `${base} ${promo_code}` : base;
}

/************************************************************
 * ✅ API pool (PREWARM)
 ************************************************************/
let __pickedPromise = null;
let __pickedResult = null;

function pickNextRoundRobin(arr, key="b300_rr_idx"){
  const n = arr.length;
  if (!n) return null;
  let i = parseInt(localStorage.getItem(key) || "0", 10);
  if (!Number.isFinite(i) || i < 0) i = 0;
  const picked = arr[i % n];
  localStorage.setItem(key, String((i + 1) % n));
  return picked;
}

async function getNumberFromApi(){
  const url = `${LANDING_CONFIG.SERVICE_BASE}`;
  const res = await fetchWithTimeout(
    url,
    { headers:{ "Cache-Control":"no-store" } },
    Number(LANDING_CONFIG.UI.CLICK_GET_NUMBER_DEADLINE_MS||2000)
  );
  if(!res.ok) throw new Error("HTTP "+res.status);
  const data = await res.json();
  const list = Array.isArray(data?.numbers) ? data.numbers : [];
  const cleanList = list.map(normalizePhoneDigits).filter(n => /^\d{8,17}$/.test(n));
  if(!cleanList.length) throw new Error("NO_NUMBERS_IN_POOL");
  const number = pickNextRoundRobin(cleanList) || cleanList[0];
  return { number, name: LANDING_CONFIG.BRAND_NAME, meta: data };
}

function prewarmNumber(){
  if(!__pickedPromise) __pickedPromise = getNumberFromApi();
  return __pickedPromise;
}

/************************************************************
 * ✅ CLICK: redirect ASAP, tracking after (no await)
 ************************************************************/
async function contactarWhatsApp({ source="main_button", customText=null } = {}){
  if (window.__waInFlight) return;
  window.__waInFlight = true;

  let picked;
  if (__pickedResult) {
    picked = __pickedResult;
  } else {
    try {
      picked = await (__pickedPromise || prewarmNumber());
    } catch (e) {
      picked = {
        number: LANDING_CONFIG.EMERGENCY_FALLBACK_NUMBER,
        name: LANDING_CONFIG.EMERGENCY_FALLBACK_NAME,
        meta: { emergency: true, error: String(e?.message || e) }
      };
    }
  }

  const cleanPhone = normalizePhoneDigits(picked?.number);
  if(!/^\d{8,17}$/.test(cleanPhone)){
    window.__waInFlight = false;
    return;
  }

  const uuidSegment = generateUUID().replace(/-/g,"").slice(0,12);
  const promo_code = LANDING_CONFIG.PROMO.ENABLED ? `${LANDING_CONFIG.PROMO.LANDING_TAG}-${uuidSegment}` : "";

  const mensaje = (customText && String(customText).trim())
    ? (promo_code ? `${String(customText).trim()} ${promo_code}` : String(customText).trim())
    : buildMensaje(promo_code, picked?.name);

  const event_id = generateUUID();
  try{
    if (window.fbq){
      fbq("track","Contact",{
        em: window.userEmail || undefined,
        ph: window.userPhone || undefined,
        fn: window.userFn,
        ln: window.userLn,
        external_id: window.externalId,
        content_name: "Botón WhatsApp",
        content_category: "LeadGen",
        source: source,
        method: "Click",
        event_source: "LandingPage",
        utm_campaign: getQueryParam("utm_campaign") || undefined,
        promo_code: promo_code || undefined,
        device_type: getDeviceType(),
        brand: LANDING_CONFIG.BRAND_NAME || undefined
      },{ eventID: event_id });
    }
  }catch{}

  (async ()=>{
    const geo = await detectarGeo();
    const payload = {
      event_name:"Contact",
      event_id,
      external_id: getOrCreateExternalId(),
      event_source_url: location.href,
      fbp: getFbp(),
      fbc: getFbc(),
      email: getQueryParam("em") || getQueryParam("email"),
      phone: getQueryParam("ph") || getQueryParam("phone"),
      fn: getQueryParam("fn") || undefined,
      ln: getQueryParam("ln") || undefined,
      utm_campaign:getQueryParam("utm_campaign"),
      telefono_asignado: cleanPhone,
      device_type: getDeviceType(),
      promo_code,
      source,
      brand: LANDING_CONFIG.BRAND_NAME,
      mode: LANDING_CONFIG.MODE,
      geo_city: geo.city || "",
      geo_region: geo.region || "",
      geo_country: geo.country || "",
      api_meta: picked?.meta || null
    };
    try{
      fetch("/api/xz3v2q",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
        keepalive:true
      });
    }catch{}
  })();

  window.location.assign(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`);
}

/************************************************************
 * ✅ UI wiring
 ************************************************************/
function setButtonReady(btn){
  if(!btn) return;
  btn.removeAttribute("aria-disabled");
  btn.classList.remove("wa-btn-loading");
  const span = btn.querySelector("span");
  if(span) span.textContent = "¡Contactar ya!";
}

document.addEventListener("DOMContentLoaded",()=>{
  const btn = document.getElementById("whatsappButton");
  if(btn){
    btn.setAttribute("aria-disabled","true");
    btn.classList.add("wa-btn-loading");
    const span = btn.querySelector("span");
    if(span) span.textContent = "Preparando...";
    btn.addEventListener("click",(e)=>{
      e.preventDefault();
      if(btn.getAttribute("aria-disabled")==="true") return;
      contactarWhatsApp({ source:"main_button" });
    });
  }

  prewarmNumber()
    .then((picked)=>{ __pickedResult = picked; setButtonReady(btn); })
    .catch((e)=>{
      __pickedResult = {
        number: LANDING_CONFIG.EMERGENCY_FALLBACK_NUMBER,
        name: LANDING_CONFIG.EMERGENCY_FALLBACK_NAME,
        meta: { emergency: true, error: String(e?.message||e) }
      };
      setButtonReady(btn);
    });

  function resetAfterReturn(){
    window.__waInFlight=false;
  }
  window.addEventListener("pageshow", resetAfterReturn);
  window.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") resetAfterReturn(); });
});
