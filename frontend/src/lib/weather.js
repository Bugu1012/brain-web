const CITY_KEY = "brain.weatherCity";

export function getCity() { return localStorage.getItem(CITY_KEY) || "厦门"; }
export function setCity(c) { if (c && c.trim()) localStorage.setItem(CITY_KEY, c.trim()); }

const WMO = {
  0: ["晴", "☀️"], 1: ["基本晴", "🌤️"], 2: ["多云", "⛅"], 3: ["阴", "☁️"],
  45: ["雾", "🌫️"], 48: ["雾凇", "🌫️"],
  51: ["毛毛雨", "🌦️"], 53: ["毛毛雨", "🌦️"], 55: ["毛毛雨", "🌧️"],
  56: ["冻毛毛雨", "🌧️"], 57: ["冻毛毛雨", "🌧️"],
  61: ["小雨", "🌧️"], 63: ["中雨", "🌧️"], 65: ["大雨", "🌧️"],
  66: ["冻雨", "🌧️"], 67: ["冻雨", "🌧️"],
  71: ["小雪", "🌨️"], 73: ["中雪", "🌨️"], 75: ["大雪", "❄️"], 77: ["米雪", "❄️"],
  80: ["阵雨", "🌦️"], 81: ["阵雨", "🌧️"], 82: ["强阵雨", "⛈️"],
  85: ["阵雪", "🌨️"], 86: ["阵雪", "❄️"],
  95: ["雷雨", "⛈️"], 96: ["雷雨伴冰雹", "⛈️"], 99: ["雷雨伴冰雹", "⛈️"],
};

export function weatherText(code) { return WMO[code] || ["未知", "🌡️"] ; }

async function fetchWithTimeout(url, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { signal: c.signal }); }
  finally { clearTimeout(t); }
}

export async function fetchWeather(city) {
  let j;
  try {
    const r = await fetchWithTimeout("/weather?city=" + encodeURIComponent(city), 20000);
    if (!r.ok) throw new Error("门户天气接口失败 " + r.status);
    j = await r.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "天气请求超时（20s）" : "天气请求失败：" + e.message);
  }
  if (!j.ok) throw new Error(j.msg || "天气不可用");
  return j;
}
