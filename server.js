const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { UserStateStore } = require("./src/services/user-state-store");
const { normalizeUserState } = require("./src/services/state-normalizer");
const { ChapterCache } = require("./src/services/chapter-cache");
const { ReaderTtsService } = require("./src/services/tts-service");
const { createFileSessionStore } = require("./src/services/file-session-store");
require("dotenv").config();

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function readSecretFromDefaultPath() {
  const secretPath = path.join(os.homedir(), ".secondme", "client_secret");
  try {
    return fs.readFileSync(secretPath, "utf8").trim();
  } catch {
    return "";
  }
}

function readClientSecret() {
  if (process.env.SECONDME_CLIENT_SECRET && process.env.SECONDME_CLIENT_SECRET.trim()) {
    return process.env.SECONDME_CLIENT_SECRET.trim();
  }
  return readSecretFromDefaultPath();
}

const ACCESS_TOKEN_COOKIE_NAME = "secondme_access_token";
const STATIC_ASSET_VERSION = "20260331-5";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStateStore = new Map();

function parseCookieHeader(cookieHeader) {
  const cookies = {};
  const source = String(cookieHeader || "");
  if (!source) return cookies;
  const pairs = source.split(";");
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    if (!key) continue;
    const rawValue = pair.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

function clearExpiredOAuthState(now = Date.now()) {
  for (const [key, value] of oauthStateStore.entries()) {
    if (!value || !Number.isFinite(value.createdAt) || now - value.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStateStore.delete(key);
    }
  }
}

function getOAuthClientFingerprint(req) {
  const ua = String(req?.headers?.["user-agent"] || "").trim().slice(0, 320);
  const lang = String(req?.headers?.["accept-language"] || "").trim().slice(0, 120);
  const ip =
    String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() ||
    String(req?.socket?.remoteAddress || "").trim();
  return crypto
    .createHash("sha256")
    .update(`${ua}|${lang}|${ip}`)
    .digest("hex")
    .slice(0, 32);
}

function rememberOAuthState(state, redirectUri, req, returnTo = "/app") {
  const token = String(state || "").trim();
  if (!token) return;
  clearExpiredOAuthState();
  oauthStateStore.set(token, {
    redirectUri: String(redirectUri || "").trim(),
    createdAt: Date.now(),
    clientFingerprint: getOAuthClientFingerprint(req),
    returnTo: normalizeReturnPath(returnTo, "/app"),
  });
}

function consumeOAuthState(state) {
  const token = String(state || "").trim();
  if (!token) return null;
  const entry = oauthStateStore.get(token);
  if (!entry) return null;
  oauthStateStore.delete(token);
  if (!Number.isFinite(entry.createdAt) || Date.now() - entry.createdAt > OAUTH_STATE_TTL_MS) {
    return null;
  }
  return entry;
}

function readCookie(req, name) {
  const cookies = parseCookieHeader(req?.headers?.cookie);
  return String(cookies[name] || "");
}

function getRequestAccessToken(req) {
  const sessionToken = req.session?.tokens?.accessToken;
  if (sessionToken) return String(sessionToken);
  const cookieToken = readCookie(req, ACCESS_TOKEN_COOKIE_NAME);
  if (cookieToken && req.session) {
    req.session.tokens = {
      ...(req.session.tokens || {}),
      accessToken: cookieToken,
    };
  }
  return cookieToken;
}

function setAccessTokenCookie(req, res, accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) return;
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

function clearAccessTokenCookie(req, res) {
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function withAssetVersion(assetPath) {
  const source = String(assetPath || "").trim();
  if (!source) return "";
  const joiner = source.includes("?") ? "&" : "?";
  return `${source}${joiner}v=${STATIC_ASSET_VERSION}`;
}

function parseBoundedInt(input, fallback, min, max) {
  const parsed = Number.parseInt(String(input || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function normalizeReturnPath(input, fallback = "/app") {
  const source = String(input || "").trim();
  if (!source) return fallback;
  if (!source.startsWith("/")) return fallback;
  if (source.startsWith("//")) return fallback;
  if (source.includes("\r") || source.includes("\n")) return fallback;
  return source;
}

function buildGeneratedImageUrl({ kind = "panel", seed = "default", title = "", subtitle = "", w, h } = {}) {
  // 对于书籍封面和阅读页面的背景图片，使用基于内容的现实图片
  if (kind === "cover" || kind === "storyCover" || kind === "sportsFootball" || kind === "sportsBasketball" || 
      kind === "readerTop" || kind === "readerToc" || kind === "readerBody" || kind === "readerFooter" || kind === "scene") {
    // 生成一个描述，结合标题、副标题和类别
    let description = title;
    if (subtitle) {
      description += ` ${subtitle}`;
    }
    // 根据类型添加适当的描述词
    if (kind === "sportsFootball") {
      description += " football match stadium players action";
    } else if (kind === "sportsBasketball") {
      description += " basketball game court players action";
    } else if (kind === "readerTop") {
      description += " book reading top header realistic scene";
    } else if (kind === "readerToc") {
      description += " book table of contents realistic scene";
    } else if (kind === "readerBody") {
      description += " book reading page realistic scene";
    } else if (kind === "readerFooter") {
      description += " book chapter navigation footer realistic scene";
    } else if (kind === "scene") {
      // 根据seed判断场景类型，生成更适合的描述
      if (seed === "app-creator") {
        description += " creative writing studio workspace inspiration desk books";
      } else if (seed === "app-persona") {
        description += " personality analysis lab psychology colorful dynamic visualization";
      } else if (seed === "panel-creator") {
        description += " writing desk creative workspace books notes inspiration";
      } else if (seed === "panel-persona") {
        description += " psychology lab personality traits analysis colorful charts";
      } else {
        description += " book reading space realistic scene";
      }
    } else {
      description += " book cover realistic scene";
    }
    
    // 使用图片生成API
    const imageSize = w && h ? `${w}x${h}` : "600x900";
    const encodedDescription = encodeURIComponent(description);
    return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodedDescription}&image_size=landscape_16_9`;
  }
  
  // 对于其他类型，继续使用原来的SVG生成
  const params = new URLSearchParams();
  params.set("kind", String(kind));
  params.set("seed", String(seed));
  if (title) params.set("title", String(title));
  if (subtitle) params.set("subtitle", String(subtitle));
  if (w) params.set("w", String(w));
  if (h) params.set("h", String(h));
  return `/assets/generated-image?${params.toString()}`;
}

function createHashValue(input) {
  const digest = crypto.createHash("sha256").update(String(input || "seed")).digest();
  return digest.readUInt32BE(0);
}

function renderGeneratedImageSvg({ kind, seed, title, subtitle, width, height }) {
  const hash = createHashValue(`${kind}:${seed}`);
  const hueA = hash % 360;
  const hueB = (hueA + 34 + (hash % 67)) % 360;
  const hueC = (hueA + 160 + (hash % 79)) % 360;
  const titleText = String(title || "99小说").slice(0, 22);
  const subtitleText = String(subtitle || "").slice(0, 28);
  const labelMap = {
    cover: "NOVEL COVER",
    storyCover: "STORY PORTRAIT",
    sportsFootball: "FOOTBALL STORY",
    sportsBasketball: "BASKETBALL STORY",
    scene: "READER UNIVERSE",
    hero: "TODAY MIRROR",
    store: "BOOK STORE",
    reading: "CURRENT READING",
    creator: "WRITING STUDIO",
    persona: "PERSONA LAB",
    fortune: "DAILY FORTUNE",
    readerTop: "READING HEADER",
    readerToc: "TABLE OF CONTENT",
    readerBody: "CHAPTER SPACE",
    readerFooter: "CHAPTER NAV",
    comicPanel: "COMIC PANEL",
    comicTop: "COMIC STORY",
    animeCover: "ANIME COMIC",
    landing: "WELCOME",
  };
  const label = labelMap[kind] || "99 NOVEL";
  const safeLabel = escapeXml(label);
  const safeTitle = escapeXml(titleText);
  const safeSubtitle = escapeXml(subtitleText);
  const titleSize =
    kind === "cover" || kind === "storyCover"
      ? Math.max(40, Math.round(width * 0.068))
      : Math.max(34, Math.round(width * 0.04));
  const subtitleSize = Math.max(16, Math.round(titleSize * 0.34));
  const labelSize = Math.max(13, Math.round(titleSize * 0.26));
  const marginX = Math.round(width * 0.085);
  const baseY = Math.round(height * 0.72);
  const cardY = Math.round(height * 0.6);
  const cardH = Math.round(height * 0.32);
  const circleA = Math.max(110, Math.round(width * 0.2));
  const circleB = Math.max(95, Math.round(width * 0.16));
  const isAnime = kind === "animeCover" || kind === "comicPanel" || kind === "comicTop";
  const isFootball = kind === "sportsFootball";
  const isBasketball = kind === "sportsBasketball";
  const animeCenterX = Math.round(width * 0.72);
  const animeCenterY = Math.round(height * 0.44);
  const animeFaceR = Math.round(Math.min(width, height) * 0.13);
  const animeLayer = isAnime
    ? `
  <g opacity="0.96">
    <ellipse cx="${animeCenterX}" cy="${animeCenterY}" rx="${animeFaceR}" ry="${Math.round(animeFaceR * 1.08)}" fill="rgba(255,234,220,.95)" />
    <path d="M ${animeCenterX - animeFaceR * 1.4} ${animeCenterY - animeFaceR * 0.4}
      C ${animeCenterX - animeFaceR * 1.2} ${animeCenterY - animeFaceR * 1.6},
        ${animeCenterX + animeFaceR * 1.4} ${animeCenterY - animeFaceR * 1.6},
        ${animeCenterX + animeFaceR * 1.5} ${animeCenterY - animeFaceR * 0.3}
      C ${animeCenterX + animeFaceR * 1.1} ${animeCenterY + animeFaceR * 1.7},
        ${animeCenterX - animeFaceR * 1.3} ${animeCenterY + animeFaceR * 1.7},
        ${animeCenterX - animeFaceR * 1.4} ${animeCenterY - animeFaceR * 0.4} Z"
      fill="rgba(37,52,88,.64)" />
    <ellipse cx="${animeCenterX - animeFaceR * 0.34}" cy="${animeCenterY - animeFaceR * 0.08}" rx="${animeFaceR * 0.18}" ry="${animeFaceR * 0.12}" fill="rgba(55,84,132,.95)" />
    <ellipse cx="${animeCenterX + animeFaceR * 0.34}" cy="${animeCenterY - animeFaceR * 0.08}" rx="${animeFaceR * 0.18}" ry="${animeFaceR * 0.12}" fill="rgba(55,84,132,.95)" />
    <circle cx="${animeCenterX - animeFaceR * 0.29}" cy="${animeCenterY - animeFaceR * 0.11}" r="${animeFaceR * 0.05}" fill="rgba(246,250,255,.9)" />
    <circle cx="${animeCenterX + animeFaceR * 0.38}" cy="${animeCenterY - animeFaceR * 0.11}" r="${animeFaceR * 0.05}" fill="rgba(246,250,255,.9)" />
    <path d="M ${animeCenterX - animeFaceR * 0.27} ${animeCenterY + animeFaceR * 0.36}
      Q ${animeCenterX} ${animeCenterY + animeFaceR * 0.56}
      ${animeCenterX + animeFaceR * 0.27} ${animeCenterY + animeFaceR * 0.36}"
      stroke="rgba(210,92,118,.86)" stroke-width="${Math.max(3, Math.round(width * 0.004))}" fill="none" stroke-linecap="round" />
  </g>`
    : "";
  const footballLayer = isFootball
    ? `
  <g opacity="0.94">
    <rect x="${Math.round(width * 0.07)}" y="${Math.round(height * 0.16)}" width="${Math.round(width * 0.86)}" height="${Math.round(height * 0.46)}" rx="${Math.round(width * 0.02)}" fill="rgba(56,140,94,.28)" stroke="rgba(233,255,239,.35)" stroke-width="${Math.max(2, Math.round(width * 0.0035))}" />
    <line x1="${Math.round(width * 0.5)}" y1="${Math.round(height * 0.16)}" x2="${Math.round(width * 0.5)}" y2="${Math.round(height * 0.62)}" stroke="rgba(245,255,248,.34)" stroke-width="${Math.max(2, Math.round(width * 0.003))}" />
    <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.39)}" r="${Math.round(width * 0.065)}" fill="none" stroke="rgba(245,255,248,.34)" stroke-width="${Math.max(2, Math.round(width * 0.003))}" />
    <circle cx="${Math.round(width * 0.22)}" cy="${Math.round(height * 0.21)}" r="${Math.round(width * 0.018)}" fill="rgba(255,255,255,.54)" />
    <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.22)}" r="${Math.round(width * 0.018)}" fill="rgba(255,255,255,.46)" />
    <circle cx="${Math.round(width * 0.34)}" cy="${Math.round(height * 0.34)}" r="${Math.round(width * 0.05)}" fill="rgba(255,224,204,.95)" />
    <rect x="${Math.round(width * 0.302)}" y="${Math.round(height * 0.385)}" width="${Math.round(width * 0.078)}" height="${Math.round(height * 0.14)}" rx="${Math.round(width * 0.015)}" fill="rgba(234,85,58,.92)" />
    <rect x="${Math.round(width * 0.304)}" y="${Math.round(height * 0.52)}" width="${Math.round(width * 0.028)}" height="${Math.round(height * 0.092)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,236,225,.92)" />
    <rect x="${Math.round(width * 0.35)}" y="${Math.round(height * 0.52)}" width="${Math.round(width * 0.028)}" height="${Math.round(height * 0.1)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,236,225,.92)" />
    <circle cx="${Math.round(width * 0.65)}" cy="${Math.round(height * 0.33)}" r="${Math.round(width * 0.05)}" fill="rgba(255,224,204,.95)" />
    <rect x="${Math.round(width * 0.612)}" y="${Math.round(height * 0.378)}" width="${Math.round(width * 0.082)}" height="${Math.round(height * 0.145)}" rx="${Math.round(width * 0.015)}" fill="rgba(58,96,232,.92)" />
    <rect x="${Math.round(width * 0.615)}" y="${Math.round(height * 0.52)}" width="${Math.round(width * 0.03)}" height="${Math.round(height * 0.102)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,236,225,.92)" />
    <rect x="${Math.round(width * 0.662)}" y="${Math.round(height * 0.52)}" width="${Math.round(width * 0.03)}" height="${Math.round(height * 0.1)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,236,225,.92)" />
    <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.57)}" r="${Math.round(width * 0.03)}" fill="rgba(255,255,255,.95)" />
    <path d="M ${Math.round(width * 0.485)} ${Math.round(height * 0.556)} L ${Math.round(width * 0.515)} ${Math.round(height * 0.584)}" stroke="rgba(34,52,86,.88)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" />
  </g>`
    : "";
  const basketballLayer = isBasketball
    ? `
  <g opacity="0.95">
    <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.16)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.46)}" rx="${Math.round(width * 0.02)}" fill="rgba(173,98,42,.26)" stroke="rgba(255,236,216,.34)" stroke-width="${Math.max(2, Math.round(width * 0.0035))}" />
    <line x1="${Math.round(width * 0.5)}" y1="${Math.round(height * 0.16)}" x2="${Math.round(width * 0.5)}" y2="${Math.round(height * 0.62)}" stroke="rgba(255,236,216,.34)" stroke-width="${Math.max(2, Math.round(width * 0.003))}" />
    <path d="M ${Math.round(width * 0.2)} ${Math.round(height * 0.62)} Q ${Math.round(width * 0.5)} ${Math.round(height * 0.46)} ${Math.round(width * 0.8)} ${Math.round(height * 0.62)}" fill="none" stroke="rgba(255,236,216,.3)" stroke-width="${Math.max(2, Math.round(width * 0.003))}" />
    <circle cx="${Math.round(width * 0.34)}" cy="${Math.round(height * 0.35)}" r="${Math.round(width * 0.048)}" fill="rgba(255,225,207,.95)" />
    <rect x="${Math.round(width * 0.302)}" y="${Math.round(height * 0.395)}" width="${Math.round(width * 0.082)}" height="${Math.round(height * 0.14)}" rx="${Math.round(width * 0.015)}" fill="rgba(54,121,246,.92)" />
    <rect x="${Math.round(width * 0.304)}" y="${Math.round(height * 0.53)}" width="${Math.round(width * 0.03)}" height="${Math.round(height * 0.1)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,238,228,.92)" />
    <rect x="${Math.round(width * 0.352)}" y="${Math.round(height * 0.53)}" width="${Math.round(width * 0.03)}" height="${Math.round(height * 0.1)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,238,228,.92)" />
    <circle cx="${Math.round(width * 0.64)}" cy="${Math.round(height * 0.34)}" r="${Math.round(width * 0.048)}" fill="rgba(255,225,207,.95)" />
    <rect x="${Math.round(width * 0.602)}" y="${Math.round(height * 0.39)}" width="${Math.round(width * 0.082)}" height="${Math.round(height * 0.145)}" rx="${Math.round(width * 0.015)}" fill="rgba(237,98,60,.92)" />
    <rect x="${Math.round(width * 0.604)}" y="${Math.round(height * 0.532)}" width="${Math.round(width * 0.03)}" height="${Math.round(height * 0.1)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,238,228,.92)" />
    <rect x="${Math.round(width * 0.652)}" y="${Math.round(height * 0.532)}" width="${Math.round(width * 0.03)}" height="${Math.round(height * 0.098)}" rx="${Math.round(width * 0.01)}" fill="rgba(255,238,228,.92)" />
    <circle cx="${Math.round(width * 0.52)}" cy="${Math.round(height * 0.28)}" r="${Math.round(width * 0.032)}" fill="rgba(244,146,70,.96)" />
    <path d="M ${Math.round(width * 0.487)} ${Math.round(height * 0.276)} C ${Math.round(width * 0.515)} ${Math.round(height * 0.24)}, ${Math.round(width * 0.542)} ${Math.round(height * 0.32)}, ${Math.round(width * 0.552)} ${Math.round(height * 0.292)}" stroke="rgba(89,51,23,.8)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" fill="none" />
    <path d="M ${Math.round(width * 0.42)} ${Math.round(height * 0.44)} Q ${Math.round(width * 0.5)} ${Math.round(height * 0.08)} ${Math.round(width * 0.72)} ${Math.round(height * 0.2)}" stroke="rgba(255,210,164,.6)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" fill="none" stroke-dasharray="${Math.max(7, Math.round(width * 0.013))} ${Math.max(6, Math.round(width * 0.011))}" />
  </g>`
    : "";
  const isStoryCover = kind === "storyCover" || kind === "cover";
  const storyThemeSource = `${titleText} ${subtitleText}`;
  let storyTheme = "generic";
  if (/悬疑|推理|疑案|追凶|真相/.test(storyThemeSource)) storyTheme = "suspense";
  else if (/科幻|星|量子|轨道|意识/.test(storyThemeSource)) storyTheme = "scifi";
  else if (/治愈|慢|温暖|重逢|回信/.test(storyThemeSource)) storyTheme = "healing";
  else if (/现实|都市|职场|日程|纪事/.test(storyThemeSource)) storyTheme = "city";
  else if (/奇幻|王座|远征|誓约|群岛/.test(storyThemeSource)) storyTheme = "fantasy";
  else if (/情感|告白|心事|情书|重逢/.test(storyThemeSource)) storyTheme = "romance";
  else if (/历史|古|旧朝|行旅|风物/.test(storyThemeSource)) storyTheme = "history";
  else if (/成长|启程|生长|练习|自述/.test(storyThemeSource)) storyTheme = "growth";

  const storyObjectLayer =
    storyTheme === "suspense"
      ? `
    <rect x="${Math.round(width * 0.58)}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.24)}" height="${Math.round(height * 0.2)}" rx="${Math.round(width * 0.012)}" fill="rgba(32,45,66,.6)" />
    <line x1="${Math.round(width * 0.6)}" y1="${Math.round(height * 0.24)}" x2="${Math.round(width * 0.78)}" y2="${Math.round(height * 0.33)}" stroke="rgba(255,209,163,.7)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" />
    <circle cx="${Math.round(width * 0.46)}" cy="${Math.round(height * 0.28)}" r="${Math.round(width * 0.05)}" fill="none" stroke="rgba(255,220,190,.85)" stroke-width="${Math.max(3, Math.round(width * 0.005))}" />
    <line x1="${Math.round(width * 0.5)}" y1="${Math.round(height * 0.32)}" x2="${Math.round(width * 0.56)}" y2="${Math.round(height * 0.39)}" stroke="rgba(255,220,190,.85)" stroke-width="${Math.max(3, Math.round(width * 0.004))}" />`
      : storyTheme === "scifi"
        ? `
    <ellipse cx="${Math.round(width * 0.67)}" cy="${Math.round(height * 0.23)}" rx="${Math.round(width * 0.16)}" ry="${Math.round(height * 0.055)}" fill="rgba(163,228,255,.36)" />
    <rect x="${Math.round(width * 0.6)}" y="${Math.round(height * 0.25)}" width="${Math.round(width * 0.14)}" height="${Math.round(height * 0.13)}" rx="${Math.round(width * 0.016)}" fill="rgba(24,46,86,.62)" />
    <circle cx="${Math.round(width * 0.53)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.014)}" fill="rgba(214,240,255,.95)" />
    <circle cx="${Math.round(width * 0.81)}" cy="${Math.round(height * 0.16)}" r="${Math.round(width * 0.011)}" fill="rgba(214,240,255,.86)" />`
        : storyTheme === "healing"
          ? `
    <rect x="${Math.round(width * 0.62)}" y="${Math.round(height * 0.22)}" width="${Math.round(width * 0.16)}" height="${Math.round(height * 0.24)}" rx="${Math.round(width * 0.012)}" fill="rgba(150,96,52,.54)" />
    <rect x="${Math.round(width * 0.58)}" y="${Math.round(height * 0.38)}" width="${Math.round(width * 0.26)}" height="${Math.round(height * 0.03)}" rx="${Math.round(width * 0.01)}" fill="rgba(247,220,189,.8)" />
    <circle cx="${Math.round(width * 0.7)}" cy="${Math.round(height * 0.19)}" r="${Math.round(width * 0.032)}" fill="rgba(255,237,222,.85)" />`
          : storyTheme === "city"
            ? `
    <rect x="${Math.round(width * 0.58)}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.08)}" height="${Math.round(height * 0.26)}" fill="rgba(33,53,79,.6)" />
    <rect x="${Math.round(width * 0.67)}" y="${Math.round(height * 0.16)}" width="${Math.round(width * 0.07)}" height="${Math.round(height * 0.3)}" fill="rgba(40,64,97,.56)" />
    <rect x="${Math.round(width * 0.76)}" y="${Math.round(height * 0.24)}" width="${Math.round(width * 0.06)}" height="${Math.round(height * 0.22)}" fill="rgba(30,47,71,.62)" />
    <line x1="${Math.round(width * 0.1)}" y1="${Math.round(height * 0.46)}" x2="${Math.round(width * 0.9)}" y2="${Math.round(height * 0.46)}" stroke="rgba(255,231,210,.28)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" />`
            : storyTheme === "fantasy"
              ? `
    <path d="M ${Math.round(width * 0.65)} ${Math.round(height * 0.44)} L ${Math.round(width * 0.73)} ${Math.round(height * 0.17)} L ${Math.round(width * 0.81)} ${Math.round(height * 0.44)} Z" fill="rgba(57,42,74,.62)" />
    <rect x="${Math.round(width * 0.71)}" y="${Math.round(height * 0.44)}" width="${Math.round(width * 0.04)}" height="${Math.round(height * 0.06)}" fill="rgba(77,58,99,.68)" />
    <path d="M ${Math.round(width * 0.5)} ${Math.round(height * 0.5)} L ${Math.round(width * 0.56)} ${Math.round(height * 0.2)} L ${Math.round(width * 0.62)} ${Math.round(height * 0.5)} Z" fill="rgba(241,218,170,.88)" />`
              : storyTheme === "romance"
                ? `
    <path d="M ${Math.round(width * 0.65)} ${Math.round(height * 0.21)} C ${Math.round(width * 0.61)} ${Math.round(height * 0.15)}, ${Math.round(width * 0.54)} ${Math.round(height * 0.18)}, ${Math.round(width * 0.56)} ${Math.round(height * 0.25)} C ${Math.round(width * 0.58)} ${Math.round(height * 0.31)}, ${Math.round(width * 0.65)} ${Math.round(height * 0.34)}, ${Math.round(width * 0.65)} ${Math.round(height * 0.34)} C ${Math.round(width * 0.65)} ${Math.round(height * 0.34)}, ${Math.round(width * 0.72)} ${Math.round(height * 0.31)}, ${Math.round(width * 0.74)} ${Math.round(height * 0.25)} C ${Math.round(width * 0.76)} ${Math.round(height * 0.18)}, ${Math.round(width * 0.69)} ${Math.round(height * 0.15)}, ${Math.round(width * 0.65)} ${Math.round(height * 0.21)} Z" fill="rgba(255,146,172,.9)" />
    <line x1="${Math.round(width * 0.63)}" y1="${Math.round(height * 0.34)}" x2="${Math.round(width * 0.58)}" y2="${Math.round(height * 0.44)}" stroke="rgba(255,196,207,.88)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" />`
                : storyTheme === "history"
                  ? `
    <rect x="${Math.round(width * 0.58)}" y="${Math.round(height * 0.22)}" width="${Math.round(width * 0.24)}" height="${Math.round(height * 0.24)}" fill="rgba(131,97,58,.54)" />
    <rect x="${Math.round(width * 0.56)}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.28)}" height="${Math.round(height * 0.03)}" fill="rgba(208,168,113,.74)" />
    <line x1="${Math.round(width * 0.62)}" y1="${Math.round(height * 0.22)}" x2="${Math.round(width * 0.62)}" y2="${Math.round(height * 0.46)}" stroke="rgba(226,196,148,.6)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" />
    <line x1="${Math.round(width * 0.7)}" y1="${Math.round(height * 0.22)}" x2="${Math.round(width * 0.7)}" y2="${Math.round(height * 0.46)}" stroke="rgba(226,196,148,.6)" stroke-width="${Math.max(2, Math.round(width * 0.0028))}" />`
                  : storyTheme === "growth"
                    ? `
    <rect x="${Math.round(width * 0.6)}" y="${Math.round(height * 0.4)}" width="${Math.round(width * 0.18)}" height="${Math.round(height * 0.06)}" rx="${Math.round(width * 0.01)}" fill="rgba(244,226,203,.82)" />
    <path d="M ${Math.round(width * 0.59)} ${Math.round(height * 0.4)} Q ${Math.round(width * 0.67)} ${Math.round(height * 0.24)} ${Math.round(width * 0.76)} ${Math.round(height * 0.4)}" fill="none" stroke="rgba(255,232,192,.72)" stroke-width="${Math.max(2, Math.round(width * 0.003))}" />`
                    : `
    <circle cx="${Math.round(width * 0.68)}" cy="${Math.round(height * 0.24)}" r="${Math.round(width * 0.05)}" fill="rgba(255,228,206,.76)" />
    <rect x="${Math.round(width * 0.6)}" y="${Math.round(height * 0.32)}" width="${Math.round(width * 0.2)}" height="${Math.round(height * 0.12)}" rx="${Math.round(width * 0.012)}" fill="rgba(48,66,98,.56)" />`;
  const storyLayer = isStoryCover
    ? `
  <g opacity="0.96">
    <rect x="${Math.round(width * 0.07)}" y="${Math.round(height * 0.14)}" width="${Math.round(width * 0.86)}" height="${Math.round(height * 0.46)}" rx="${Math.round(width * 0.025)}" fill="rgba(22,28,42,.28)" />
    ${storyObjectLayer}
    <circle cx="${Math.round(width * 0.27)}" cy="${Math.round(height * 0.31)}" r="${Math.round(width * 0.044)}" fill="rgba(255,226,206,.96)" />
    <path d="M ${Math.round(width * 0.22)} ${Math.round(height * 0.36)} Q ${Math.round(width * 0.27)} ${Math.round(height * 0.34)} ${Math.round(width * 0.32)} ${Math.round(height * 0.36)} L ${Math.round(width * 0.34)} ${Math.round(height * 0.57)} Q ${Math.round(width * 0.27)} ${Math.round(height * 0.61)} ${Math.round(width * 0.2)} ${Math.round(height * 0.57)} Z" fill="rgba(42,63,95,.92)" />
    <circle cx="${Math.round(width * 0.41)}" cy="${Math.round(height * 0.33)}" r="${Math.round(width * 0.04)}" fill="rgba(255,221,198,.94)" />
    <path d="M ${Math.round(width * 0.37)} ${Math.round(height * 0.37)} Q ${Math.round(width * 0.41)} ${Math.round(height * 0.35)} ${Math.round(width * 0.46)} ${Math.round(height * 0.37)} L ${Math.round(width * 0.48)} ${Math.round(height * 0.56)} Q ${Math.round(width * 0.41)} ${Math.round(height * 0.6)} ${Math.round(width * 0.35)} ${Math.round(height * 0.56)} Z" fill="rgba(210,106,72,.9)" />
    <ellipse cx="${Math.round(width * 0.29)}" cy="${Math.round(height * 0.3)}" rx="${Math.round(width * 0.06)}" ry="${Math.round(height * 0.03)}" fill="rgba(42,53,80,.65)" />
    <ellipse cx="${Math.round(width * 0.43)}" cy="${Math.round(height * 0.32)}" rx="${Math.round(width * 0.055)}" ry="${Math.round(height * 0.028)}" fill="rgba(51,62,90,.6)" />
  </g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hueA} 70% 52%)" />
      <stop offset="52%" stop-color="hsl(${hueB} 68% 58%)" />
      <stop offset="100%" stop-color="hsl(${hueC} 62% 48%)" />
    </linearGradient>
    <radialGradient id="lightA" cx="30%" cy="18%" r="62%">
      <stop offset="0%" stop-color="rgba(255,255,255,.56)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0)" />
    </radialGradient>
    <radialGradient id="lightB" cx="78%" cy="76%" r="48%">
      <stop offset="0%" stop-color="rgba(255,224,193,.44)" />
      <stop offset="100%" stop-color="rgba(255,224,193,0)" />
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)" />
  <rect width="${width}" height="${height}" fill="url(#lightA)" />
  <rect width="${width}" height="${height}" fill="url(#lightB)" />
  <circle cx="${Math.round(width * 0.2)}" cy="${Math.round(height * 0.24)}" r="${circleA}" fill="rgba(255,255,255,.13)" />
  <circle cx="${Math.round(width * 0.84)}" cy="${Math.round(height * 0.78)}" r="${circleB}" fill="rgba(255,255,255,.12)" />
  <path d="M0 ${Math.round(height * 0.66)} C ${Math.round(width * 0.25)} ${Math.round(height * 0.54)}, ${Math.round(width * 0.52)} ${Math.round(height * 0.78)}, ${width} ${Math.round(height * 0.62)} L ${width} ${height} L 0 ${height} Z" fill="rgba(78,45,29,.12)" />
  ${animeLayer}
  ${storyLayer}
  ${footballLayer}
  ${basketballLayer}
  <rect x="${Math.round(width * 0.05)}" y="${cardY}" width="${Math.round(width * 0.9)}" height="${cardH}" rx="${Math.round(width * 0.028)}" fill="rgba(255,255,255,.16)" />
  <text x="${marginX}" y="${baseY - Math.round(titleSize * 1.4)}" fill="rgba(255,248,240,.96)" font-size="${labelSize}" letter-spacing="1.2" font-family="Noto Serif SC, serif">${safeLabel}</text>
  <text x="${marginX}" y="${baseY}" fill="#fffdf8" font-size="${titleSize}" font-weight="700" font-family="Noto Serif SC, serif">${safeTitle}</text>
  <text x="${marginX}" y="${baseY + Math.round(subtitleSize * 1.9)}" fill="rgba(255,245,235,.95)" font-size="${subtitleSize}" font-family="Noto Serif SC, serif">${safeSubtitle}</text>
</svg>`;
}

const NOVEL_TOTAL_WORDS = 1000000;
const NOVEL_CHAPTER_WORD_TARGET = 1000;
const NOVEL_CHAPTER_COUNT = Math.ceil(NOVEL_TOTAL_WORDS / NOVEL_CHAPTER_WORD_TARGET);
const TOC_PAGE_SIZE = 120;
const BOOKS_PER_CATEGORY = 20;

const BOOK_CATEGORY_TEMPLATES = [
  {
    category: "悬疑",
    mood: "高压推理",
    coverQuery: "mystery noir detective",
    blurbTheme: "连环案件与隐秘组织的交锋",
    keywords: ["旧码头", "指纹档案", "密室录像", "匿名电话", "深夜追踪", "反向证词"],
    titleHeads: ["雾港", "暗巷", "沉默", "逆光", "零点"],
    titleTails: ["疑案录", "回声局", "追凶令", "真相簿"],
    authorPool: ["森川", "闻舟", "陆湛", "季闻", "苏棠", "迟越", "冯执", "程让"],
    palette: ["#2a304f", "#46508d", "#7f78c4"],
  },
  {
    category: "科幻",
    mood: "想象开阔",
    coverQuery: "science fiction space cyberpunk",
    blurbTheme: "意识科技与文明边界的实验",
    keywords: ["神经云", "轨道城", "时空回环", "量子日志", "意识映射", "星际信标"],
    titleHeads: ["星渊", "霓虹", "深空", "回路", "零域"],
    titleTails: ["纪年", "观测站", "跃迁录", "边界集"],
    authorPool: ["寂河", "尘歌", "顾祁", "遥川", "林弦", "宋烬", "柏舟", "裴南"],
    palette: ["#153b63", "#1c6ea4", "#62a8e2"],
  },
  {
    category: "治愈",
    mood: "温暖细腻",
    coverQuery: "cozy bookstore rain street",
    blurbTheme: "普通人的遗憾与和解",
    keywords: ["雨巷邮局", "旧明信片", "街角咖啡", "黄昏公交", "慢时光", "重逢信件"],
    titleHeads: ["枫桥", "微光", "晚风", "木窗", "暖橘"],
    titleTails: ["慢邮", "小记", "回信", "季节书"],
    authorPool: ["渡柳", "姜禾", "云栀", "沈溪", "许宁", "程意", "唐温", "阮知"],
    palette: ["#8f6a43", "#c38f5c", "#f0cda0"],
  },
  {
    category: "现实",
    mood: "都市成长",
    coverQuery: "city life urban street",
    blurbTheme: "都市节奏下的选择与成长",
    keywords: ["合租公寓", "夜班地铁", "项目复盘", "会议室", "天台夜谈", "职场抉择"],
    titleHeads: ["南城", "深夜", "白昼", "回环", "旧街"],
    titleTails: ["日程簿", "练习册", "纪事", "生长录"],
    authorPool: ["许念", "周闻", "顾然", "叶汐", "韩湛", "沈晗", "易初", "何柚"],
    palette: ["#3f5749", "#5c8a69", "#9cb7a0"],
  },
  {
    category: "奇幻",
    mood: "史诗宏大",
    coverQuery: "epic fantasy kingdom sword",
    blurbTheme: "王权、遗迹与远征",
    keywords: ["海神遗物", "王座试炼", "群岛航线", "古老契约", "裂谷祭坛", "龙骨舰队"],
    titleHeads: ["潮汐", "王座", "风暴", "群岛", "星火"],
    titleTails: ["远征史", "遗物录", "誓约书", "王冠篇"],
    authorPool: ["惊砚", "白祁", "燕迟", "陆珩", "谢辞", "池渊", "顾戎", "祁宁"],
    palette: ["#5e2f2f", "#9a4646", "#cf7f68"],
  },
  {
    category: "情感",
    mood: "情绪共鸣",
    coverQuery: "romance emotional portrait",
    blurbTheme: "亲密关系中的误解与告白",
    keywords: ["未寄情书", "旧友重逢", "冬夜街灯", "沉默对话", "错位时差", "心事旁白"],
    titleHeads: ["冬枝", "回信", "月色", "余温", "旧梦"],
    titleTails: ["情书", "心事簿", "重逢篇", "告白记"],
    authorPool: ["芷寒", "闻栀", "简夏", "苏槿", "宁遥", "顾言", "祁沫", "温禾"],
    palette: ["#75314a", "#b44f77", "#e39bc0"],
  },
  {
    category: "历史",
    mood: "厚重沉浸",
    coverQuery: "historical ancient painting china",
    blurbTheme: "时代浪潮中的人物命运",
    keywords: ["古道驿站", "壁画残卷", "边城烽火", "史册残页", "行旅画师", "旧朝传闻"],
    titleHeads: ["山海", "长川", "边城", "故卷", "青灯"],
    titleTails: ["临摹录", "行旅记", "旧朝志", "风物编"],
    authorPool: ["澄砚", "沈澈", "温故", "顾谙", "许衡", "贺山", "唐牧", "谢澜"],
    palette: ["#5a4a32", "#8b734d", "#c8a874"],
  },
  {
    category: "成长",
    mood: "自我突破",
    coverQuery: "youth growth sunrise",
    blurbTheme: "在试错中完成自我重建",
    keywords: ["晨光跑道", "成长日记", "第一次发布", "自我表达", "社交练习", "破茧时刻"],
    titleHeads: ["向光", "新芽", "破晓", "初页", "远途"],
    titleTails: ["生长记", "练习册", "启程篇", "自述录"],
    authorPool: ["栖云", "顾青", "林枝", "沈初", "纪野", "唐渺", "闻夏", "苏禾"],
    palette: ["#2f4f66", "#5484a3", "#88b3cf"],
  },
];

function buildBookLibrary() {
  const books = [];
  let serial = 1;

  BOOK_CATEGORY_TEMPLATES.forEach((template) => {
    for (let index = 1; index <= BOOKS_PER_CATEGORY; index += 1) {
      const head = template.titleHeads[(index - 1) % template.titleHeads.length];
      const tail = template.titleTails[Math.floor((index - 1) / template.titleHeads.length)];
      const title = `${head}${tail}`;
      const author = template.authorPool[(index - 1) % template.authorPool.length];
      const keyA = template.keywords[(index - 1) % template.keywords.length];
      const keyB = template.keywords[index % template.keywords.length];
      const keyC = template.keywords[(index + 1) % template.keywords.length];
      const keyD = template.keywords[(index + 2) % template.keywords.length];

      books.push({
        id: `b${String(serial).padStart(3, "0")}`,
        title,
        author,
        category: template.category,
        mood: template.mood,
        blurb: `${template.blurbTheme}。第${index}册从“${keyA}”展开，牵引出“${keyB}”与“${keyC}”的连锁冲突。`,
        excerpt: `试读：${title}里，主角在“${keyA}”与“${keyD}”之间做出第一道选择，命运自此偏转。`,
        keywords: [keyA, keyB, keyC, keyD],
        cover: `linear-gradient(160deg,${template.palette[0]} 0%,${template.palette[1]} 55%,${template.palette[2]} 100%)`,
        coverImage: buildGeneratedImageUrl({
          kind: "storyCover",
          seed: `book-${serial}-${keyA}-${keyB}`,
          title,
          subtitle: `${template.category} · ${template.mood} · ${keyA}`,
          w: 600,
          h: 900,
        }),
      });

      serial += 1;
    }
  });

  return books;
}

function buildFeaturedSportsBooks() {
  return [
    {
      id: "sp001",
      title: "终场逆风：双锋纪元",
      author: "岚川",
      category: "成长",
      mood: "绿茵热战",
      blurb:
        "欧冠淘汰赛夜，C罗与姆巴佩在同一条锋线重组节奏。老将经验与极速冲刺交错，球队在终场前完成从0:2到3:2的逆风翻盘。",
      excerpt:
        "试读：第1章里，C罗在更衣室给出最后一段战术提醒，姆巴佩在雨夜草皮上完成第一脚反越位冲刺，比赛从这一刻开始失控。",
      keywords: ["C罗", "姆巴佩", "欧冠夜", "逆风翻盘", "点球线", "终场绝杀"],
      cover: "linear-gradient(160deg,#0f5b3f 0%,#1d8f63 55%,#3ec794 100%)",
      coverImage: buildGeneratedImageUrl({
        kind: "sportsFootball",
        seed: "featured-football-c7-mbappe",
        title: "终场逆风",
        subtitle: "C罗 × 姆巴佩",
        w: 600,
        h: 900,
      }),
    },
    {
      id: "sp002",
      title: "弧顶回声：双核时刻",
      author: "闻澄",
      category: "现实",
      mood: "硬地攻防",
      blurb:
        "赛季关键战，库里与哈登在同城系列赛中展开节奏博弈。一个拉开空间疯狂三分，一个利用节拍拆解防线，胜负悬到最后24秒。",
      excerpt:
        "试读：第1章里，库里在弧顶连续两次无球反跑，哈登立刻用一次后撤步回应，球馆在倒计时声里被彻底点燃。",
      keywords: ["库里", "哈登", "弧顶三分", "后撤步", "季后赛", "最后一攻"],
      cover: "linear-gradient(160deg,#5f2a19 0%,#c06928 55%,#f0a25c 100%)",
      coverImage: buildGeneratedImageUrl({
        kind: "sportsBasketball",
        seed: "featured-basketball-curry-harden",
        title: "弧顶回声",
        subtitle: "库里 × 哈登",
        w: 600,
        h: 900,
      }),
    },
  ];
}

const FEATURED_SPORTS_BOOKS = buildFeaturedSportsBooks();
const BOOK_LIBRARY = [...FEATURED_SPORTS_BOOKS, ...buildBookLibrary()];
const CORE_CATEGORY_ORDER = BOOK_CATEGORY_TEMPLATES.map((item) => item.category);

const READER_CHAPTER_PREFIX = [
  "潮声里的线索",
  "未寄出的证词",
  "逆光中的名字",
  "沉默之后",
  "夜色与回音",
  "桥下的火种",
  "失落航标",
  "回廊尽头",
  "雾中灯塔",
  "终局前夜",
];

const READER_CHAPTER_SUFFIX = [
  "初现",
  "破局",
  "再访",
  "疑云",
  "交错",
  "反击",
  "追索",
  "改写",
  "告白",
  "余响",
];

function seededRandom(seedText) {
  let seed = 0;
  const source = String(seedText || "seed");
  for (let i = 0; i < source.length; i += 1) {
    seed = (seed * 31 + source.charCodeAt(i)) >>> 0;
  }
  if (seed === 0) seed = 2166136261;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function pickOne(random, list) {
  if (!Array.isArray(list) || list.length === 0) return "";
  return list[Math.floor(random() * list.length)];
}

function parseChapterNumber(input, max) {
  const raw = Number.parseInt(String(input || "1"), 10);
  if (!Number.isFinite(raw)) return 1;
  if (raw < 1) return 1;
  if (raw > max) return max;
  return raw;
}

function parsePageNumber(input, max, fallback) {
  const raw = Number.parseInt(String(input || ""), 10);
  if (!Number.isFinite(raw)) return fallback;
  if (raw < 1) return 1;
  if (raw > max) return max;
  return raw;
}

function countReadableCharacters(text) {
  return String(text || "").replace(/\s+/g, "").length;
}

function getBookById(bookId) {
  const normalized = String(bookId || "");
  return BOOK_LIBRARY.find((item) => item.id === normalized) || null;
}

function getChapterTitle(book, chapterNumber) {
  const prefix = READER_CHAPTER_PREFIX[(chapterNumber - 1) % READER_CHAPTER_PREFIX.length];
  const suffix = READER_CHAPTER_SUFFIX[(chapterNumber + book.id.length) % READER_CHAPTER_SUFFIX.length];
  return `第${chapterNumber}章 ${prefix}·${suffix}`;
}

function generateChapterContent(book, chapterNumber) {
  const random = seededRandom(`${book.id}:${chapterNumber}`);
  const title = getChapterTitle(book, chapterNumber);
  
  // 为体育小说定制内容
  if (book.id === "sp001") { // 终场逆风：C罗与姆巴佩的双锋时代
    const names = ["C罗", "姆巴佩", "教练", "队友", "记者", "球迷"];
    const places = ["更衣室", "训练场", "球场", "新闻发布会", "酒店", "机场"];
    const actions = ["完成了一记精彩的射门", "传出了一脚精准的传球", "做出了一次关键的防守", "制定了新的战术", "接受了媒体的采访", "与队友进行了深入的交流"];
    const emotions = ["激动", "紧张", "兴奋", "疲惫", "坚定", "自信"];
    const obstacles = ["对手的严密防守", "伤病的困扰", "外界的质疑", "裁判的判罚", "天气的影响", "体能的消耗"];
    const keyObjects = book.keywords && book.keywords.length ? book.keywords : ["C罗", "姆巴佩", "欧冠", "逆风翻盘", "点球", "终场绝杀"];
    
    const paragraphs = [];
    let currentWords = 0;
    while (currentWords < NOVEL_CHAPTER_WORD_TARGET) {
      const sentenceCount = 5 + Math.floor(random() * 3);
      const sentences = [];
      for (let i = 0; i < sentenceCount; i += 1) {
        const who = pickOne(random, names);
        const place = pickOne(random, places);
        const action = pickOne(random, actions);
        const emotion = pickOne(random, emotions);
        const obstacle = pickOne(random, obstacles);
        const clue = pickOne(random, keyObjects);
        const sentence = `${who}在${place}${action}，尽管面临${obstacle}的挑战，但他依然保持着${emotion}的状态，为了团队的胜利而努力。`;
        sentences.push(sentence);
      }
      const paragraph = sentences.join("");
      paragraphs.push(paragraph);
      currentWords += countReadableCharacters(paragraph);
    }
    
    const chapterStartWord = (chapterNumber - 1) * NOVEL_CHAPTER_WORD_TARGET + 1;
    const chapterEndWord = Math.min(chapterNumber * NOVEL_CHAPTER_WORD_TARGET, NOVEL_TOTAL_WORDS);
    
    return {
      title,
      paragraphs,
      chapterWordCount: currentWords,
      chapterStartWord,
      chapterEndWord,
    };
  } else if (book.id === "sp002") { // 弧顶回声：库里与哈登的火力博弈
    const names = ["库里", "哈登", "教练", "队友", "记者", "球迷"];
    const places = ["更衣室", "训练场", "球场", "新闻发布会", "酒店", "机场"];
    const actions = ["投进了一记三分球", "突破上篮得分", "助攻队友得分", "抢断对手", "盖帽", "制定了新的战术"];
    const emotions = ["激动", "紧张", "兴奋", "疲惫", "坚定", "自信"];
    const obstacles = ["对手的严密防守", "伤病的困扰", "外界的质疑", "裁判的判罚", "天气的影响", "体能的消耗"];
    const keyObjects = book.keywords && book.keywords.length ? book.keywords : ["库里", "哈登", "弧顶三分", "后撤步", "季后赛", "最后一攻"];
    
    const paragraphs = [];
    let currentWords = 0;
    while (currentWords < NOVEL_CHAPTER_WORD_TARGET) {
      const sentenceCount = 5 + Math.floor(random() * 3);
      const sentences = [];
      for (let i = 0; i < sentenceCount; i += 1) {
        const who = pickOne(random, names);
        const place = pickOne(random, places);
        const action = pickOne(random, actions);
        const emotion = pickOne(random, emotions);
        const obstacle = pickOne(random, obstacles);
        const clue = pickOne(random, keyObjects);
        const sentence = `${who}在${place}${action}，尽管面临${obstacle}的挑战，但他依然保持着${emotion}的状态，为了团队的胜利而努力。`;
        sentences.push(sentence);
      }
      const paragraph = sentences.join("");
      paragraphs.push(paragraph);
      currentWords += countReadableCharacters(paragraph);
    }
    
    const chapterStartWord = (chapterNumber - 1) * NOVEL_CHAPTER_WORD_TARGET + 1;
    const chapterEndWord = Math.min(chapterNumber * NOVEL_CHAPTER_WORD_TARGET, NOVEL_TOTAL_WORDS);
    
    return {
      title,
      paragraphs,
      chapterWordCount: currentWords,
      chapterStartWord,
      chapterEndWord,
    };
  } else {
    // 通用小说内容生成
    const names = ["林昭", "许沅", "顾屿", "姜南", "季川", "温黎", "周序", "沈遥"];
    const places = [
      "旧城区档案馆",
      "海边栈桥",
      "深夜地铁站",
      "北岸书店",
      "风暴观测台",
      "长街转角",
      "城南天台",
      "灯塔边的石阶",
    ];
    const actions = [
      "追查那条被删掉的线索",
      "比对昨夜留下的坐标",
      "在沉默中重新组织证词",
      "把真相写进新的章节",
      "沿着潮声继续前行",
      "对抗不断收紧的误解",
      "说出迟到多年的答案",
      "尝试改写结局的走向",
    ];
    const emotions = [
      "紧张却笃定",
      "迟疑却勇敢",
      "疲惫却清醒",
      "慌乱却不退",
      "沉默却坚定",
      "克制却炽热",
    ];
    const obstacles = [
      "突如其来的停电",
      "被篡改的时间戳",
      "封存多年的旧案",
      "来自内层网络的干扰",
      "匿名人递来的反向证据",
      "队友之间短暂的失联",
      "一封改写语义的邮件",
      "无法解释的回声坐标",
    ];
    const keyObjects = book.keywords && book.keywords.length ? book.keywords : ["线索", "记录", "笔记", "回声"];
    
    const paragraphs = [];
    let currentWords = 0;
    while (currentWords < NOVEL_CHAPTER_WORD_TARGET) {
      const sentenceCount = 5 + Math.floor(random() * 3);
      const sentences = [];
      for (let i = 0; i < sentenceCount; i += 1) {
        const who = pickOne(random, names);
        const place = pickOne(random, places);
        const action = pickOne(random, actions);
        const emotion = pickOne(random, emotions);
        const obstacle = pickOne(random, obstacles);
        const clue = pickOne(random, keyObjects);
        const sentence = `${who}在${place}再一次提到“${clue}”，他知道眼前的${obstacle}并非偶然，于是带着${emotion}的克制把${action}拆成更细的步骤。`;
        sentences.push(sentence);
      }
      const paragraph = sentences.join("");
      paragraphs.push(paragraph);
      currentWords += countReadableCharacters(paragraph);
    }
    
    const chapterStartWord = (chapterNumber - 1) * NOVEL_CHAPTER_WORD_TARGET + 1;
    const chapterEndWord = Math.min(chapterNumber * NOVEL_CHAPTER_WORD_TARGET, NOVEL_TOTAL_WORDS);
    
    return {
      title,
      paragraphs,
      chapterWordCount: currentWords,
      chapterStartWord,
      chapterEndWord,
    };
  }
}

function createReadingSnippet(paragraphs) {
  const firstParagraph = Array.isArray(paragraphs) && paragraphs.length ? String(paragraphs[0]) : "";
  const trimmed = firstParagraph.replace(/\s+/g, "").trim();
  if (!trimmed) return "你已开始阅读，继续进入章节查看完整内容。";
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 120)}...`;
}

function createConfig() {
  const apiBase = trimTrailingSlash(
    process.env.SECONDME_API_BASE_URL || "https://api.mindverse.com/gate/lab"
  );
  const explicitBaseUrl = trimTrailingSlash(process.env.APP_BASE_URL || "");
  const vercelBaseUrl = process.env.VERCEL_URL
    ? `https://${trimTrailingSlash(process.env.VERCEL_URL)}`
    : "";
  const appBaseUrl = explicitBaseUrl || vercelBaseUrl;
  const normalizedScope = String(process.env.SECONDME_SCOPE || "userinfo")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const mcpAuthMode = String(process.env.MCP_AUTH_MODE || "bearer_token").trim();

  return {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "::",
    appBaseUrl,
    clientId: process.env.SECONDME_CLIENT_ID || "8614994a-75b1-4394-a765-ba9b321a553a",
    clientSecret: readClientSecret(),
    redirectUri:
      process.env.SECONDME_REDIRECT_URI ||
      (appBaseUrl ? `${appBaseUrl}/api/auth/callback` : "http://localhost:3000/api/auth/callback"),
    scope: normalizedScope.join(" "),
    scopeList: normalizedScope,
    oauthUrl: process.env.SECONDME_OAUTH_URL || "https://go.second.me/oauth/",
    tokenEndpoint:
      process.env.SECONDME_TOKEN_ENDPOINT || `${apiBase}/api/oauth/token/code`,
    userInfoEndpoint:
      process.env.SECONDME_USERINFO_ENDPOINT || `${apiBase}/api/secondme/user/info`,
    integration: {
      schemaVersion: "1",
      skillKey: process.env.SECONDME_SKILL_KEY || "novel-persona-card",
      skillDisplayName:
        process.env.SECONDME_SKILL_DISPLAY_NAME || "99小说 - 你的心情写照",
      skillDescription:
        process.env.SECONDME_SKILL_DESCRIPTION ||
        "获取用户资料、阅读/写作画像与可分享创作信息的个人名片能力。",
      timeoutMs: parseBoundedInt(process.env.MCP_TIMEOUT_MS, 12000, 1000, 45000),
      authMode:
        mcpAuthMode === "none" ||
        mcpAuthMode === "bearer_token" ||
        mcpAuthMode === "header_template"
          ? mcpAuthMode
          : "bearer_token",
    },
  };
}

function buildAuthUrl(config, state, redirectUri) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
  });
  return `${config.oauthUrl}${config.oauthUrl.includes("?") ? "&" : "?"}${params.toString()}`;
}

async function fetchSecondMeUserProfile(accessToken, config) {
  const userResp = await fetch(config.userInfoEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await userResp.json().catch(() => null);
  return {
    ok: userResp.ok && payload && payload.code === 0,
    status: userResp.status,
    payload,
    profile: payload && payload.code === 0 ? payload.data : null,
  };
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countTextChars(text) {
  return String(text || "").replace(/\s+/g, "").length;
}

function countPattern(text, pattern) {
  const matched = String(text || "").match(pattern);
  return matched ? matched.length : 0;
}

function countKeyword(text, words) {
  const source = String(text || "").toLowerCase();
  return words.reduce((sum, item) => {
    const token = String(item || "").trim();
    if (!token) return sum;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = source.match(new RegExp(escaped, "gi"));
    return sum + (matched ? matched.length : 0);
  }, 0);
}

function getUserStateKeyFromProfile(profile, fallback = "") {
  const profileKey = String(
    profile?.userId || profile?.route || profile?.name || ""
  ).trim();
  if (profileKey) return profileKey;
  return String(fallback || "").trim();
}

function parseBearerToken(req) {
  const authHeader =
    req.headers.authorization ||
    req.headers.Authorization ||
    req.headers["x-authorization"] ||
    "";
  const matched = String(authHeader).match(/^Bearer\s+(.+)$/i);
  if (matched && matched[1]) return String(matched[1]).trim();
  const tokenHeader = req.headers.token || req.headers["x-access-token"] || "";
  if (tokenHeader) return String(tokenHeader).trim();
  return "";
}

function resolvePublicBaseUrl(req, config) {
  if (config.appBaseUrl) return trimTrailingSlash(config.appBaseUrl);
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.headers.host || `${config.host}:${config.port}`;
  return trimTrailingSlash(`${protocol}://${host}`);
}

function resolveAuthRedirectUri(req, config) {
  const host = String(req.headers.host || "").trim().toLowerCase();
  const isLocalHost =
    host.startsWith("localhost:") ||
    host === "localhost" ||
    host.startsWith("127.0.0.1:") ||
    host === "127.0.0.1" ||
    host.startsWith("[::1]:") ||
    host === "[::1]";
  if (isLocalHost) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    const protocol = forwardedProto || req.protocol || "http";
    return `${protocol}://${host}/api/auth/callback`;
  }
  return `${resolvePublicBaseUrl(req, config)}/api/auth/callback`;
}

function summarizeReadingFromState(statePayload) {
  const readMinutes = statePayload?.readMinutes && typeof statePayload.readMinutes === "object"
    ? statePayload.readMinutes
    : {};
  const uploadedCategoryMap = new Map();
  const novels = Array.isArray(statePayload?.novels) ? statePayload.novels : [];
  novels.forEach((novel) => {
    if (!novel?.id) return;
    uploadedCategoryMap.set(`u-${novel.id}`, String(novel.category || "成长"));
  });
  const categoryMinutes = {};
  let totalMinutes = 0;
  Object.entries(readMinutes).forEach(([bookId, minutes]) => {
    const normalizedMinutes = Math.max(0, Number(minutes) || 0);
    if (!normalizedMinutes) return;
    totalMinutes += normalizedMinutes;
    const libraryBook = BOOK_LIBRARY.find((item) => item.id === bookId);
    const category =
      libraryBook?.category || uploadedCategoryMap.get(bookId) || "其他";
    categoryMinutes[category] = Number(categoryMinutes[category] || 0) + normalizedMinutes;
  });
  const sortedCategories = Object.entries(categoryMinutes).sort((a, b) => b[1] - a[1]);
  const topCategory = sortedCategories[0]?.[0] || "";
  const topCategoryMinutes = Number(sortedCategories[0]?.[1] || 0);
  const activeCategoryCount = sortedCategories.length;
  const categoryWeight = {};
  Object.entries(categoryMinutes).forEach(([category, minutes]) => {
    categoryWeight[category] = totalMinutes ? Number(minutes) / totalMinutes : 0;
  });
  return {
    totalMinutes,
    categoryMinutes,
    categoryWeight,
    topCategory,
    topCategoryMinutes,
    activeCategoryCount,
  };
}

function summarizeWritingFromState(statePayload) {
  const novels = Array.isArray(statePayload?.novels) ? statePayload.novels : [];
  const chapterTexts = novels.flatMap((novel) =>
    (Array.isArray(novel?.chapters) ? novel.chapters : []).map((chapter) =>
      String(chapter?.content || "")
    )
  );
  const draftTitle = String(statePayload?.draftTitle || "");
  const draftContent = String(statePayload?.draftContent || "");
  const latestDraft = `${draftTitle}\n${draftContent}`.trim();
  const sampledText = [...chapterTexts.slice(-30), latestDraft].join("\n");
  const wordCount =
    chapterTexts.reduce((sum, text) => sum + countTextChars(text), 0) +
    countTextChars(latestDraft);
  const quoteCount = countPattern(sampledText, /[“”"「」『』]/g);
  const dialogueDensity = quoteCount / Math.max(countTextChars(sampledText), 1);
  return {
    wordCount,
    dialogueDensity: clampValue(dialogueDensity * 100, 0, 1),
    draftCount: novels.reduce(
      (sum, novel) =>
        sum + (Array.isArray(novel?.chapters) ? novel.chapters.length : 0),
      0
    ),
    creativeKeywords: countKeyword(sampledText, [
      "星",
      "梦",
      "海",
      "光",
      "影",
      "雾",
      "荒原",
      "时空",
    ]),
    empathyWords: countKeyword(sampledText, [
      "理解",
      "陪伴",
      "拥抱",
      "温柔",
      "想念",
      "守护",
      "心事",
    ]),
    socialWords: countKeyword(sampledText, [
      "我们",
      "朋友",
      "一起",
      "对话",
      "分享",
      "团队",
    ]),
    negativeWords: countKeyword(sampledText, [
      "焦虑",
      "崩溃",
      "绝望",
      "失控",
      "孤独",
      "烦躁",
    ]),
  };
}

function derivePersonaType(traits) {
  const sorted = [...traits].sort((a, b) => b.value - a.value);
  const first = sorted[0]?.key || "";
  const second = sorted[1]?.key || "";
  const key = `${first}-${second}`;
  const map = {
    "openness-conscientiousness": "远见策展者",
    "openness-agreeableness": "共情造梦者",
    "conscientiousness-openness": "结构创想家",
    "conscientiousness-stability": "稳态执行者",
    "agreeableness-openness": "温暖观察者",
    "agreeableness-conscientiousness": "治愈编排师",
    "extraversion-openness": "舞台叙事者",
    "extraversion-agreeableness": "社交点灯人",
    "stability-conscientiousness": "平衡掌舵者",
    "stability-agreeableness": "宁静陪伴者",
  };
  return map[key] || "多面叙事者";
}

function deriveSummary(traits, readStats, writingStats) {
  const top = [...traits].sort((a, b) => b.value - a.value)[0];
  const readSignal =
    readStats.totalMinutes > 0
      ? `阅读上你在“${readStats.topCategory || "多分类"}”投入最多（${readStats.topCategoryMinutes} 分钟），总阅读 ${readStats.totalMinutes} 分钟。`
      : "当前阅读样本较少，建议先连续阅读 20 分钟以上。";
  const writeSignal =
    writingStats.wordCount > 0
      ? `写作上累计 ${writingStats.wordCount} 字、草稿 ${writingStats.draftCount} 条，对话表达强度 ${Math.round(
          writingStats.dialogueDensity * 100
        )}%。`
      : "当前写作样本较少，建议先写 200 字以上再看画像。";
  return `你当前最突出的特质是“${top?.label || "综合画像"}”。${readSignal}${writeSignal}`;
}

function buildDailyFortune(traits, readStats, writingStats) {
  const readingDepth = clampValue(readStats.totalMinutes / 180, 0, 1);
  const readingFocus = readStats.totalMinutes
    ? clampValue(readStats.topCategoryMinutes / readStats.totalMinutes, 0, 1)
    : 0;
  const readingDiversity = clampValue(readStats.activeCategoryCount / 5, 0, 1);
  const writingVolume = clampValue(writingStats.wordCount / 1200, 0, 1);
  const writingConsistency = clampValue(writingStats.draftCount / 6, 0, 1);
  const writingExpression = clampValue(
    (writingStats.dialogueDensity +
      clampValue(writingStats.creativeKeywords / 10, 0, 1)) /
      2,
    0,
    1
  );
  const emotionBalance = clampValue(
    0.55 + (writingStats.empathyWords - writingStats.negativeWords) * 0.06,
    0,
    1
  );
  const score = Math.round(
    clampValue(
      32 +
        readingDepth * 20 +
        readingFocus * 8 +
        readingDiversity * 6 +
        writingVolume * 18 +
        writingConsistency * 8 +
        writingExpression * 12 +
        emotionBalance * 12,
      0,
      99
    )
  );
  let level = "平稳";
  if (score >= 82) level = "大吉";
  else if (score >= 64) level = "中吉";
  else if (score <= 36) level = "收敛";
  let advice = "适合补设定和修文，把细节打磨得更有质感。";
  if (writingVolume < 0.2) advice = "先写 200-300 字热身段落，再推进主线，今天状态会更稳。";
  else if (readingDepth < 0.2) advice = "先连续阅读 20 分钟同类题材，再进入写作，灵感会更集中。";
  else if (emotionBalance < 0.4) advice = "今天宜放慢节奏，先整理情绪和大纲，再推进正文。";
  else if (level === "大吉") advice = "适合开新坑或发布新章节，读者反馈概率更高。";
  else if (level === "中吉") advice = "适合推进主线情节，保持节奏就会有亮点。";
  else if (level === "收敛") advice = "建议先读后写，用阅读校准节奏，再推进关键章节。";
  return {
    level,
    score,
    text: `基于你的阅读习惯（${readStats.totalMinutes} 分钟，偏好 ${
      readStats.topCategory || "未形成偏好"
    }）和写作习惯（${writingStats.wordCount} 字，${writingStats.draftCount} 条草稿），今日创作势能为 ${score}/100。`,
    advice,
  };
}

function buildPersonalitySnapshot(statePayload) {
  const readStats = summarizeReadingFromState(statePayload);
  const writingStats = summarizeWritingFromState(statePayload);

  const openness = clampValue(
    35 +
      (readStats.categoryWeight.科幻 || 0) * 16 +
      (readStats.categoryWeight.奇幻 || 0) * 14 +
      (readStats.categoryWeight.历史 || 0) * 10 +
      writingStats.creativeKeywords * 3 +
      Math.min(writingStats.wordCount / 70, 18),
    0,
    99
  );
  const conscientiousness = clampValue(
    30 +
      Math.min(readStats.totalMinutes / 8, 24) +
      Math.min((Array.isArray(statePayload?.drafts) ? statePayload.drafts.length : 0) * 6, 24) +
      Math.min(writingStats.wordCount / 95, 18),
    0,
    99
  );
  const extraversion = clampValue(
    28 +
      writingStats.dialogueDensity * 22 +
      writingStats.socialWords * 4 +
      (readStats.categoryWeight.现实 || 0) * 11,
    0,
    99
  );
  const agreeableness = clampValue(
    34 +
      (readStats.categoryWeight.情感 || 0) * 16 +
      (readStats.categoryWeight.治愈 || 0) * 14 +
      writingStats.empathyWords * 4,
    0,
    99
  );
  const emotionalStability = clampValue(
    42 +
      (readStats.categoryWeight.治愈 || 0) * 14 +
      (readStats.categoryWeight.成长 || 0) * 12 -
      writingStats.negativeWords * 3 +
      Math.min(readStats.totalMinutes / 20, 8),
    0,
    99
  );

  const traits = [
    { key: "openness", label: "开放性", value: Math.round(openness) },
    { key: "conscientiousness", label: "责任感", value: Math.round(conscientiousness) },
    { key: "extraversion", label: "外向表达", value: Math.round(extraversion) },
    { key: "agreeableness", label: "宜人性", value: Math.round(agreeableness) },
    { key: "stability", label: "情绪稳定", value: Math.round(emotionalStability) },
  ];

  return {
    traits,
    displayTraits: traits.filter((item) => item.key !== "agreeableness"),
    personaType: derivePersonaType(traits),
    summary: deriveSummary(traits, readStats, writingStats),
    fortune: buildDailyFortune(traits, readStats, writingStats),
    reading: readStats,
    writing: writingStats,
  };
}

function renderLandingPage({ hasClientSecret, isLoggedIn }) {
  const ctaHref = isLoggedIn ? "/app" : "/auth/login";
  const ctaLabel = isLoggedIn ? "继续进入" : "走进书屋";
  const warning = hasClientSecret
    ? ""
    : `<p class="warn">配置缺失，请先检查 Client Secret。</p>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>走进书屋</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&family=Noto+Serif+SC:wght@400;500;700&display=swap");
    :root {
      --ink: #fcf2e7;
      --ink-soft: #f4d9bc;
      --warm: #ff6d21;
      --warm-deep: #dd4e08;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Noto Serif SC", "Source Han Serif SC", "PingFang SC", serif;
      overflow: hidden;
      background: #2a1a10;
    }
    .backdrop {
      position: fixed;
      inset: -3%;
      background:
        radial-gradient(140% 100% at 70% 10%, rgba(255, 186, 132, .24), transparent 55%),
        linear-gradient(125deg, rgba(38, 20, 10, .34), rgba(84, 42, 20, .2)),
        url("https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=bookstore interior warm cozy lighting bookshelf novels reading space&image_size=landscape_16_9")
          kind: "landing",
          seed: "landing-scene",
          title: "99小说",
          subtitle: "走进书屋",
          w: 2000,
          h: 1400,
        })}");
      background-size: cover;
      background-position: center center;
      filter: saturate(108%) contrast(101%) brightness(1.04);
      transform: scale(1.08);
      animation: drift 26s ease-in-out infinite alternate;
      z-index: 0;
    }
    .grain {
      position: fixed;
      inset: 0;
      background-image:
        radial-gradient(rgba(255,255,255,.12) .5px, transparent .5px),
        radial-gradient(rgba(255,186,120,.08) .5px, transparent .5px);
      background-size: 3px 3px, 5px 5px;
      opacity: .36;
      animation: grain 12s steps(8) infinite;
      z-index: 1;
      pointer-events: none;
    }
    .hero {
      position: relative;
      z-index: 2;
      min-height: 100vh;
      display: grid;
      place-items: center;
      text-align: center;
      padding: 24px;
    }
    .flagline {
      display: inline-block;
      padding: 7px 13px;
      border-radius: 999px;
      border: 1px solid rgba(255, 213, 170, .6);
      font-size: 12px;
      color: var(--ink-soft);
      letter-spacing: .34px;
      margin: 0;
      backdrop-filter: blur(2px);
      background: rgba(40, 16, 8, .33);
      animation: fadeInUp 1s ease-out;
    }
    .title {
      margin: 14px 0 0;
      font-family: "ZCOOL XiaoWei", serif;
      font-size: clamp(52px, 11vw, 124px);
      line-height: 1;
      letter-spacing: 1px;
      text-shadow: 0 6px 36px rgba(0,0,0,.48);
      animation: fadeInUp 1s ease-out .2s both;
    }
    .actions {
      margin-top: 26px;
      animation: fadeInUp 1s ease-out .4s both;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      border-radius: 999px;
      padding: 13px 30px;
      font-size: 16px;
      color: #fff;
      background: linear-gradient(135deg, var(--warm), var(--warm-deep));
      box-shadow: 0 10px 28px rgba(255, 103, 28, 0.38);
      transition: transform .24s ease, box-shadow .24s ease;
      animation: pulse 2s ease-in-out infinite;
    }
    .cta:hover {
      transform: translateY(-2px);
      box-shadow: 0 16px 32px rgba(255, 103, 28, 0.44);
      animation: none;
    }
    .book-echo {
      position: absolute;
      bottom: clamp(24px, 5vw, 48px);
      left: 50%;
      transform: translateX(-50%);
      display: grid;
      gap: 8px;
      opacity: .7;
      pointer-events: none;
      animation: fadeInUp 1s ease-out .6s both;
    }
    .warn {
      margin-top: 14px;
      color: #ffd6ba;
      font-size: 13px;
      animation: fadeInUp 1s ease-out .8s both;
    }
    .book-echo span {
      width: min(48vw, 260px);
      height: 8px;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(255,185,138,.58), rgba(255,124,43,.18));
      animation: float 4s ease-in-out infinite;
    }
    .book-echo span:nth-child(2) { animation-delay: .6s; width: min(46vw, 232px); }
    .book-echo span:nth-child(3) { animation-delay: 1.2s; width: min(44vw, 210px); }
    .warn {
      margin-top: 14px;
      color: #ffd6ba;
      font-size: 13px;
    }
    @keyframes drift {
      from { transform: scale(1.06) translate3d(0, 0, 0); }
      to { transform: scale(1.14) translate3d(-1.4%, -1%, 0); }
    }
    @keyframes grain {
      0% { transform: translate(0,0); }
      20% { transform: translate(-2%, 3%); }
      40% { transform: translate(2%, -1%); }
      60% { transform: translate(-1%, 2%); }
      80% { transform: translate(1%, -2%); }
      100% { transform: translate(0,0); }
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 10px 28px rgba(255, 103, 28, 0.38);
      }
      50% {
        box-shadow: 0 14px 36px rgba(255, 103, 28, 0.48);
      }
    }
    @media (max-width: 760px) {
      .hero { padding: 16px; }
      .book-echo { bottom: 20px; }
      .cta { min-width: 200px; }
    }
  </style>
</head>
<body>
  <div class="backdrop"></div>
  <div class="grain"></div>
  <main class="hero">
    <section>
      <p class="flagline">用书籍来展现自我</p>
      <h1 class="title">走进书屋</h1>
      <div class="actions">
        <a class="cta" href="${ctaHref}">${ctaLabel}</a>
      </div>
      ${warning}
    </section>
    <div class="book-echo"><span></span><span></span><span></span></div>
  </main>
</body>
</html>`;
}

function renderAuthErrorPage(title, message) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#fff8f2; color:#3d2517; font-family:"Noto Serif SC","PingFang SC",serif; padding:16px; }
    .card { max-width:680px; width:100%; background:#fff; border:1px solid #f1d6bf; border-radius:16px; padding:18px; box-shadow:0 14px 30px rgba(120,63,28,.12); }
    h1 { margin:0 0 8px; font-size:24px; }
    p { margin:0; line-height:1.75; color:#7a5845; }
    a { display:inline-block; margin-top:14px; text-decoration:none; color:#fff; background:#ff6b1f; border-radius:999px; padding:9px 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">返回首页</a>
  </div>
</body>
</html>`;
}

function renderPlainProfilePage(payload) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SecondMe 用户信息</title>
  <style>
    body { margin:0; background:#fffaf6; color:#2f1d12; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    .wrap { max-width:920px; margin:28px auto; padding:0 16px; }
    pre { background:#1f1f27; color:#e8ecff; border-radius:12px; padding:12px; overflow:auto; }
    a { color:#cc4f10; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>SecondMe 用户信息响应</h1>
    <p><a href="/app">进入小说主页</a></p>
    <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
  </div>
</body>
</html>`;
}

function renderStorePage(bootstrap) {
  const library = Array.isArray(bootstrap?.library) ? bootstrap.library : [];
  const profile = bootstrap?.profile || {};
  const reading = bootstrap?.reading || {};
  const firstBookId = library[0]?.id || "";
  const readBookId = reading?.lastBookId || firstBookId;
  const safeReadHref = readBookId
    ? `/read/${encodeURIComponent(readBookId)}?chapter=${Math.max(1, Number(reading?.lastChapter || 1))}`
    : "/creator";
  const footballNovelHref = "/read/sp001?chapter=1";
  const basketballNovelHref = "/read/sp002?chapter=1";
  const displayName = String(profile?.name || profile?.userId || "书友").trim();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>99小说 · 书城</title>
  <link rel="stylesheet" href="${withAssetVersion("/assets/store.css")}" />
</head>
<body
  style="
    --store-scene:url('${buildGeneratedImageUrl({
      kind: "scene",
      seed: "store-scene-dark",
      title: "99小说",
      subtitle: "书城",
      w: 2200,
      h: 1400,
    })}');
    --store-banner-a:url('${buildGeneratedImageUrl({
      kind: "sportsFootball",
      seed: "store-promo-football",
      title: "终场逆风",
      subtitle: "C罗 × 姆巴佩",
      w: 1200,
      h: 1600,
    })}');
    --store-banner-b:url('${buildGeneratedImageUrl({
      kind: "sportsBasketball",
      seed: "store-promo-basketball",
      title: "弧顶回声",
      subtitle: "库里 × 哈登",
      w: 1200,
      h: 1600,
    })}');
  "
>
  <div class="store-bg" aria-hidden="true"></div>
  <div class="store-mask" aria-hidden="true"></div>
  <div class="store-shell">
    <header class="store-topbar">
      <div class="search-wrap">
        <input id="storeSearch" type="search" placeholder="开启书荒求救130亿，系统眼红了" />
      </div>
      <a class="ghost-btn" href="/auth/logout">退出</a>
    </header>

    <nav id="storeMainTabs" class="main-tabs" aria-label="书城模块导航">
      <button class="main-tab active" type="button" data-tab="推荐">推荐</button>
      <button class="main-tab" type="button" data-tab="小说">小说</button>
      <button class="main-tab" type="button" data-tab="听书">听书</button>
    </nav>

    <section class="quick-links" aria-label="功能快捷跳转">
      <span class="welcome">欢迎回来，${escapeHtml(displayName)}</span>
      <a id="readShortcut" class="quick-link warm" href="${safeReadHref}">阅读</a>
      <a class="quick-link" href="/persona">人格分析</a>
      <a class="quick-link" href="/creator">创作台</a>
    </section>

    <main class="store-scroll">
      <section class="ranking-panel">
        <div class="panel-headline">
          <h2 id="storeRankTitle">推荐榜</h2>
          <div id="storeCategoryTabs" class="sub-tabs"></div>
        </div>
        <div id="rankColumns" class="rank-columns"></div>
      </section>

      <section class="promo-grid">
        <a class="promo-card promo-a" href="${footballNovelHref}">
          <span>终场逆风：C罗与姆巴佩的双锋时代</span>
        </a>
        <a class="promo-card promo-b" href="${basketballNovelHref}">
          <span>弧顶回声：库里与哈登的火力博弈</span>
        </a>
      </section>
    </main>
  </div>

  <script id="bootstrap-data" type="application/json">${safeJsonForScript(bootstrap)}</script>
  <script src="${withAssetVersion("/assets/store.js")}" defer></script>
</body>
</html>`;
}

function renderAppPage(bootstrap, workspaceMode = "creator") {
  const mode = ["creator", "persona"].includes(String(workspaceMode || ""))
    ? String(workspaceMode)
    : "creator";
  const pageTitle = mode === "creator" ? "99小说 · 创作台" : "99小说 · 人格分析";
  const pageSubtitle = mode === "creator" ? "创作台" : "人格分析";
  const sceneSeed = mode === "creator" ? "app-creator" : "app-persona";
  const scenePrompt = mode === "creator" ? "writing studio creative workspace inspiration" : "personality analysis lab dynamic colorful psychology";
  
  // 为不同页面设置不同的颜色主题
  let colorVariables = "";
  if (mode === "creator") {
    colorVariables = `
      --bg-cream: #f8f3e9;
      --bg-warm: #f0e6d2;
      --ink-main: #2c1a10;
      --ink-soft: #755340;
      --brand: #ff7a3c;
      --brand-deep: #e25a10;
      --brand-soft: #ffd9c0;
      --card: #fffefc;
      --line: #e8d5c0;
      --mint: #4d9d7f;
      --sky: #5a89d0;
      --shadow: 0 18px 45px rgba(145, 75, 25, 0.15);
    `;
  } else {
    colorVariables = `
      --bg-cream: #f0f5f9;
      --bg-warm: #e6f0f8;
      --ink-main: #1a2a3a;
      --ink-soft: #6b7c8e;
      --brand: #4a90e2;
      --brand-deep: #357abd;
      --brand-soft: #b8d4f2;
      --card: #ffffff;
      --line: #d0d9e3;
      --mint: #4db8a1;
      --sky: #5486c0;
      --shadow: 0 18px 45px rgba(65, 105, 225, 0.15);
    `;
  }
  
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <link rel="stylesheet" href="${withAssetVersion("/assets/app.css")}" />
  <style>
    :root {
      ${colorVariables}
      --scene-image: url('${buildGeneratedImageUrl({
        kind: "scene",
        seed: sceneSeed,
        title: "99小说",
        subtitle: pageSubtitle,
        w: 2200,
        h: 1500,
      })}');
      --panel-creator-image: url('${buildGeneratedImageUrl({
        kind: "scene",
        seed: "panel-creator",
        title: "创作台",
        subtitle: "创意写作空间",
        w: 2200,
        h: 1500,
      })}');
      --panel-persona-image: url('${buildGeneratedImageUrl({
        kind: "scene",
        seed: "panel-persona",
        title: "人格分析",
        subtitle: "心理特质分析",
        w: 2200,
        h: 1500,
      })}');
    }
  </style>
</head>
<body data-workspace-mode="${escapeHtml(mode)}">
  <div class="app-shell">
    <header class="topbar rise-in">
      <div class="brand">
        <span class="brand-dot" aria-hidden="true"></span>
        <div>
          <h1>99小说 · 创作台</h1>
          <p>在这里开始你的创作之旅</p>
        </div>
      </div>
      <nav class="header-actions">
        <a class="chip ${mode === "creator" ? "active" : ""}" href="/creator">创作台</a>
        <a class="chip ${mode === "persona" ? "active" : ""}" href="/persona">人格分析</a>
        <a class="chip warm" href="/app">返回书城</a>
      </nav>
    </header>
    <a class="corner-logout fade-in" href="/auth/logout">退出</a>

    <main class="main-grid">
      <section class="left-stack">
        <article class="hero-card rise-in">
          <div class="hero-main">
            <p class="eyebrow">今日创作灵感</p>
            <h2 id="welcomeTitle" style="display:none;"></h2>
            <p id="heroSubtitle">从你今天的阅读与写作中，拼出更立体的自己。</p>
            <div class="hero-fortune">
              <p id="fortuneText" class="hero-fortune-text"></p>
              <p id="fortuneAdvice" class="hero-fortune-advice"></p>
            </div>
          </div>
          <div class="hero-badges">
            <span id="todayDate" class="badge"></span>
            <span id="fortuneBadge" class="badge warm"></span>
          </div>
        </article>

        <article class="panel store-panel rise-in delay-1">
          <div class="panel-head">
            <h3>书城</h3>
            <div class="search-box">
              <input id="searchInput" type="search" placeholder="搜索书名、作者、关键词" />
            </div>
          </div>
          <div id="categoryChips" class="category-row"></div>
          <div id="bookGrid" class="book-grid"></div>
        </article>

        <article class="panel reading-stage rise-in delay-2">
          <div class="panel-head">
            <h3>当前阅读</h3>
            <button id="startReadBtn" class="cta">进入阅读</button>
          </div>
          <h4 id="bookTitle"></h4>
          <p id="bookMeta" class="meta"></p>
          <p id="bookExcerpt" class="excerpt"></p>
          <div id="habitTags" class="habit-tags"></div>
        </article>
      </section>

      <section class="right-stack">
        <article class="panel creator-panel rise-in delay-1">
          <div class="panel-head">
            <h3>创作台</h3>
            <button id="saveDraftBtn" class="cta secondary">保存章节</button>
          </div>
          <div class="creator-row">
            <input id="novelTitleInput" class="title-input" type="text" placeholder="新建小说名称" />
            <select id="novelCategorySelect" class="title-input">
              <option value="悬疑">悬疑</option>
              <option value="科幻">科幻</option>
              <option value="治愈">治愈</option>
              <option value="现实">现实</option>
              <option value="奇幻">奇幻</option>
              <option value="情感">情感</option>
              <option value="历史">历史</option>
              <option value="成长">成长</option>
            </select>
            <button id="createNovelBtn" class="chip warm">创建小说</button>
          </div>
          <div class="creator-row">
            <select id="novelSelect" class="title-input"></select>
            <select id="chapterSelect" class="title-input chapter-select"></select>
            <button id="createChapterBtn" class="chip warm" type="button">新建章节</button>
          </div>
          <input id="draftTitleInput" class="title-input" type="text" placeholder="章节标题（例如：第一章 雨夜来信）" />
          <textarea id="draftEditor" placeholder="在这里写这一章的正文内容..."></textarea>
          <div class="write-meta">
            <span id="wordCount">0 字</span>
            <span id="analysisHint">写作越具体，人格画像越准确</span>
          </div>
          <div class="creator-row creator-actions">
            <button id="uploadNovelBtn" class="chip ghost">上传到书城（需 >20 章）</button>
          </div>
          <div class="saved-mini">
            <section class="saved-col">
              <h5>已保存小说</h5>
              <div id="savedNovelsMini" class="saved-mini-list"></div>
            </section>
            <section class="saved-col">
              <h5>已保存章节</h5>
              <div id="savedChaptersMini" class="saved-mini-list"></div>
            </section>
          </div>
          <div id="draftList" class="draft-list"></div>
        </article>

        <article class="panel persona-panel rise-in delay-2">
          <div class="panel-head">
            <div class="persona-titleline">
              <h3>人格分析</h3>
              <span id="personaType"></span>
            </div>
            <button id="analyzeBtn" class="chip warm">立即分析</button>
          </div>
          <p id="personaSummary" class="persona-summary"></p>
          <div id="personaDetailCards" class="persona-detail-cards"></div>
          <div id="traitRows" class="trait-rows"></div>
          <div class="persona-visuals">
            <div class="persona-chart" id="personaChart"></div>
            <div class="persona-insights" id="personaInsights"></div>
          </div>
        </article>
      </section>
    </main>
  </div>

  <script id="bootstrap-data" type="application/json">${safeJsonForScript(bootstrap)}</script>
  <script src="${withAssetVersion("/assets/app.js")}" defer></script>
</body>
</html>`;
}

function renderReaderPage({
  book,
  chapterNumber,
  tocPage,
  chapterTitle,
  chapterParagraphs,
  chapterWordCount,
  chapterStartWord,
  chapterEndWord,
}) {
  const totalChapters = NOVEL_CHAPTER_COUNT;
  const totalTocPages = Math.ceil(totalChapters / TOC_PAGE_SIZE);
  const defaultTocPage = Math.ceil(chapterNumber / TOC_PAGE_SIZE);
  const safeTocPage = parsePageNumber(tocPage, totalTocPages, defaultTocPage);
  const tocStart = (safeTocPage - 1) * TOC_PAGE_SIZE + 1;
  const tocEnd = Math.min(tocStart + TOC_PAGE_SIZE - 1, totalChapters);
  const progress = Math.round((chapterNumber / totalChapters) * 100);

  function chapterHref(targetChapter) {
    const targetPage = Math.ceil(targetChapter / TOC_PAGE_SIZE);
    return `/read/${encodeURIComponent(book.id)}?chapter=${targetChapter}&page=${targetPage}`;
  }

  const prevHref = chapterNumber > 1 ? chapterHref(chapterNumber - 1) : "";
  const nextHref = chapterNumber < totalChapters ? chapterHref(chapterNumber + 1) : "";
  const prevTocHref =
    safeTocPage > 1
      ? `/read/${encodeURIComponent(book.id)}?chapter=${chapterNumber}&page=${safeTocPage - 1}`
      : "";
  const nextTocHref =
    safeTocPage < totalTocPages
      ? `/read/${encodeURIComponent(book.id)}?chapter=${chapterNumber}&page=${safeTocPage + 1}`
      : "";

  const chapterCatalog = Array.from({ length: tocEnd - tocStart + 1 }, (_, index) => {
    const itemNumber = tocStart + index;
    const active = itemNumber === chapterNumber ? "active" : "";
    const itemTitle = getChapterTitle(book, itemNumber);
    return `<a class="toc-item ${active}" href="${chapterHref(itemNumber)}">
      <span>第${itemNumber}章</span>
      <small>${escapeHtml(itemTitle.replace(/^第\d+章\s*/, ""))}</small>
    </a>`;
  }).join("");

  const contentHtml = chapterParagraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(book.title)} · ${escapeHtml(chapterTitle)}</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&family=Noto+Serif+SC:wght@400;500;700&display=swap");
    * { box-sizing: border-box; }
    :root {
      --ink: #fcf2e7;
      --ink-soft: #f4d9bc;
      --warm: #ff6d21;
      --warm-deep: #dd4e08;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      margin: 0;
      font-family: "Noto Serif SC", "PingFang SC", serif;
      color: var(--ink);
      background: #2a1a10;
      --reader-topbar-image: url("${buildGeneratedImageUrl({
        kind: "readerTop",
        seed: `${book.id}-top`,
        title: book.title,
        subtitle: book.category,
        w: 1800,
        h: 900,
      })}");
      --reader-toc-image: url("${buildGeneratedImageUrl({
        kind: "readerToc",
        seed: `${book.id}-toc`,
        title: "目录跳转",
        subtitle: book.category,
        w: 1400,
        h: 1200,
      })}");
      --reader-chapter-image: url("${buildGeneratedImageUrl({
        kind: "readerBody",
        seed: `${book.id}-chapter-bg`,
        title: chapterTitle,
        subtitle: `第${chapterNumber}章`,
        w: 2000,
        h: 1300,
      })}");
      --reader-footer-image: url("${buildGeneratedImageUrl({
        kind: "readerFooter",
        seed: `${book.id}-nav`,
        title: "章节导航",
        subtitle: book.title,
        w: 1800,
        h: 600,
      })}");
    }
    .reader-bg {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(120% 80% at 80% 10%, rgba(173, 216, 230, .12), transparent 56%),
        linear-gradient(120deg, rgba(248, 249, 250, .9), rgba(245, 246, 247, .9)),
        url("${buildGeneratedImageUrl({
          kind: "scene",
          seed: `reader-scene-${book.id}`,
          title: book.title,
          subtitle: "阅读空间",
          w: 2200,
          h: 1400,
        })}");
      background-size: cover;
      background-position: center;
      filter: saturate(92%) contrast(96%);
      transform: scale(1.03);
      animation: readerSceneDrift 36s ease-in-out infinite alternate;
      z-index: 0;
    }
    .reader-vignette {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(80% 75% at 50% 45%, rgba(255, 255, 255, .16), transparent 70%),
        radial-gradient(120% 100% at 50% 100%, rgba(51, 51, 51, .08), transparent 80%);
      pointer-events: none;
      z-index: 0;
    }
    .reader-shell {
      height: 100vh;
      min-height: 100vh;
      height: 100dvh;
      min-height: 100svh;
      padding:
        max(12px, env(safe-area-inset-top))
        max(12px, env(safe-area-inset-right))
        max(12px, env(safe-area-inset-bottom))
        max(12px, env(safe-area-inset-left));
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 10px;
      overflow: hidden;
      position: relative;
      z-index: 1;
    }
    .reader-topbar {
      border: 1px solid rgba(255, 213, 170, .6);
      border-radius: 14px;
      background: rgba(40, 16, 8, .33);
      backdrop-filter: blur(2px);
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      position: relative;
      isolation: isolate;
      overflow: hidden;
    }
    .reader-topbar::before,
    .reader-topbar::after,
    .toc-panel::before,
    .toc-panel::after,
    .chapter-panel::before,
    .chapter-panel::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .reader-topbar::before,
    .toc-panel::before,
    .chapter-panel::before {
      z-index: 0;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transform: scale(1.03);
      filter: saturate(108%) contrast(96%);
      animation: readerPanelDrift 30s ease-in-out infinite alternate;
    }
    .reader-topbar::after,
    .toc-panel::after,
    .chapter-panel::after {
      z-index: 0;
      background:
        linear-gradient(150deg, rgba(40, 16, 8, .7) 0%, rgba(84, 42, 20, .6) 58%, rgba(100, 50, 25, .7) 100%);
    }
    .reader-topbar::before {
      background-image: var(--reader-topbar-image);
      background-position: center;
      background-size: cover;
      opacity: .34;
    }
    .reader-topbar > *,
    .toc-panel > *,
    .chapter-panel > * {
      position: relative;
      z-index: 1;
    }
    .book-info h1 {
      margin: 0;
      font-family: "ZCOOL XiaoWei", serif;
      font-size: clamp(23px, 2.4vw, 30px);
      line-height: 1.2;
      word-break: break-word;
      overflow-wrap: anywhere;
      color: var(--ink);
      text-shadow: 0 2px 8px rgba(0,0,0,.4);
    }
    .book-info p {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--ink-soft);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn {
      text-decoration: none;
      border-radius: 999px;
      border: 1px solid rgba(255, 213, 170, .6);
      background: rgba(40, 16, 8, .33);
      color: var(--ink);
      padding: 7px 11px;
      font-size: 12px;
      line-height: 1.2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(2px);
    }
    .btn:hover {
      background: rgba(60, 24, 12, .4);
    }
    .btn.primary {
      background: linear-gradient(135deg, var(--warm), var(--warm-deep));
      color: #fff;
      border-color: transparent;
      box-shadow: 0 10px 28px rgba(255, 103, 28, 0.38);
    }
    .btn.primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 16px 32px rgba(255, 103, 28, 0.44);
    }
    .reader-grid {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(100px, 10vw) minmax(0, 1fr);
      gap: 10px;
      overflow: hidden;
    }
    .toc-panel,
    .chapter-panel {
      border: 1px solid rgba(255, 213, 170, .6);
      border-radius: 14px;
      background: rgba(40, 16, 8, .33);
      min-height: 0;
      overflow: hidden;
      position: relative;
      isolation: isolate;
      backdrop-filter: blur(2px);
    }
    .toc-panel {
      display: flex;
      flex-direction: column;
    }
    .toc-panel::before {
      background-image: var(--reader-toc-image);
      background-position: center;
      background-size: cover;
      opacity: .3;
    }
    .toc-panel::after {
      background:
        linear-gradient(160deg, rgba(255, 255, 255, .95) 0%, rgba(248, 249, 250, .9) 55%, rgba(245, 246, 247, .92) 100%);
    }
    .toc-head {
      flex: 0 0 auto;
      padding: 10px 11px;
      border-bottom: 1px solid rgba(255, 213, 170, .3);
      display: grid;
      gap: 4px;
    }
    .toc-head strong {
      font-size: 14px;
      color: var(--ink);
    }
    .toc-head span {
      font-size: 12px;
      color: var(--ink-soft);
      line-height: 1.35;
    }
    .toc-pager {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .hint {
      font-size: 12px;
      color: var(--ink-soft);
    }
    .toc-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px;
      display: grid;
      gap: 6px;
      align-content: start;
    }
    .toc-item {
      text-decoration: none;
      border: 1px solid rgba(255, 213, 170, .3);
      border-radius: 10px;
      background: rgba(40, 16, 8, .33);
      padding: 7px 8px;
      color: var(--ink);
      display: grid;
      gap: 1px;
      backdrop-filter: blur(2px);
    }
    .toc-item:hover {
      background: rgba(60, 24, 12, .4);
    }
    .toc-item span {
      font-size: 12px;
      font-weight: 600;
    }
    .toc-item small {
      font-size: 11px;
      color: var(--ink-soft);
      line-height: 1.3;
    }
    .toc-item.active {
      border-color: var(--warm);
      background: rgba(255, 109, 33, .2);
      color: var(--ink);
    }
    .chapter-panel {
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    .chapter-panel::before {
      background-image: var(--reader-chapter-image);
      background-position: center;
      background-size: cover;
      opacity: .3;
    }
    .chapter-panel::after {
      background:
        linear-gradient(150deg, rgba(255, 255, 255, .95) 0%, rgba(248, 249, 250, .9) 56%, rgba(245, 246, 247, .92) 100%);
    }
    .chapter-head {
      padding: 12px 14px 8px;
      border-bottom: 1px solid rgba(255, 213, 170, .3);
      display: grid;
      gap: 5px;
    }
    .chapter-head h2 {
      margin: 0;
      font-family: "ZCOOL XiaoWei", serif;
      font-size: clamp(24px, 2.5vw, 30px);
      line-height: 1.2;
      overflow-wrap: anywhere;
      color: var(--ink);
      text-shadow: 0 2px 8px rgba(0,0,0,.4);
    }
    .chapter-head p {
      margin: 0;
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .chapter-middle {
      min-height: 0;
      overflow: hidden;
      padding: 10px 12px;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
    .chapter-body {
      min-height: 0;
      overflow-y: auto;
      height: 100%;
      padding: 14px;
      line-height: 1.95;
      font-size: 17px;
      color: var(--reader-paper-text, #333333);
      --reader-paper-overlay: linear-gradient(145deg, rgba(255, 255, 255, .78), rgba(248, 249, 250, .72));
      background:
        var(--reader-paper-overlay),
        url("${buildGeneratedImageUrl({
          kind: "readerBody",
          seed: `${book.id}-chapter-${chapterNumber}`,
          title: chapterTitle,
          subtitle: "Chapter",
          w: 1600,
          h: 1200,
        })}");
      background-size: cover;
      background-position: center;
    }
    .chapter-body p {
      margin: 0 0 1em;
      text-indent: 2em;
    }
    .reading-tools {
      min-height: 0;
      overflow-y: auto;
      display: grid;
      gap: 10px;
      align-content: start;
      padding-right: 2px;
    }
    .tool-card {
      border: 1px solid #dee2e6;
      border-radius: 12px;
      background: rgba(255, 255, 255, .92);
      padding: 9px;
      display: grid;
      gap: 7px;
    }
    .tool-card h4 {
      margin: 0;
      font-size: 13px;
      color: #495057;
      line-height: 1.2;
      font-weight: 700;
    }
    .tool-select {
      width: 100%;
      border: 1px solid #ced4da;
      border-radius: 9px;
      background:
        linear-gradient(45deg, transparent 50%, #6c757d 50%) calc(100% - 14px) calc(50% - 2px) / 6px 6px no-repeat,
        linear-gradient(135deg, #6c757d 50%, transparent 50%) calc(100% - 10px) calc(50% - 2px) / 6px 6px no-repeat,
        #ffffff;
      color: #495057;
      font-size: 13px;
      line-height: 1.3;
      padding: 7px 26px 7px 9px;
      outline: none;
      appearance: none;
    }
    .tool-select:focus {
      border-color: #80bdff;
      box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.18);
    }
    .tool-hint {
      margin: 0;
      font-size: 12px;
      line-height: 1.35;
      color: #6c757d;
    }
    .chapter-nav {
      border-top: 1px solid rgba(255, 213, 170, .3);
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      background:
        linear-gradient(155deg, rgba(40, 16, 8, .7), rgba(84, 42, 20, .6)),
        var(--reader-footer-image);
      background-size: cover;
      background-position: center;
    }
    .jump-form {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-wrap: nowrap;
      font-size: 12px;
      color: var(--ink-soft);
    }
    .jump-form input {
      width: 100px;
      border: 1px solid rgba(255, 213, 170, .3);
      border-radius: 8px;
      padding: 5px 7px;
      font-size: 12px;
      background: rgba(40, 16, 8, .5);
      color: var(--ink);
      outline: none;
    }
    .jump-form input:focus {
      border-color: var(--warm);
      box-shadow: 0 0 0 3px rgba(255, 109, 33, .2);
    }
    @keyframes readerSceneDrift {
      from { transform: scale(1.06) translate3d(0, 0, 0); }
      to { transform: scale(1.14) translate3d(-1.4%, -1%, 0); }
    }
    @keyframes readerPanelDrift {
      0% {
        transform: scale(1.03) translate3d(0, 0, 0);
      }
      50% {
        transform: scale(1.07) translate3d(-1.2%, 1%, 0);
      }
      100% {
        transform: scale(1.06) translate3d(1.1%, -0.9%, 0);
      }
    }
    @media (max-width: 1260px) {
      .reader-shell {
        padding:
          max(10px, env(safe-area-inset-top))
          max(10px, env(safe-area-inset-right))
          max(10px, env(safe-area-inset-bottom))
          max(10px, env(safe-area-inset-left));
      }
      .reader-grid {
        grid-template-columns: minmax(100px, 10vw) minmax(0, 1fr);
      }
      .chapter-middle {
        grid-template-columns: minmax(0, 1fr);
      }
      .chapter-body {
        font-size: 16.2px;
      }
    }
    @media (max-width: 1040px) {
      .reader-grid {
        grid-template-columns: minmax(100px, 10vw) minmax(0, 1fr);
      }
      .chapter-middle {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(0, 1fr) auto;
        padding: 9px 10px;
      }
      .reading-tools {
        overflow: visible;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .chapter-body {
        font-size: 16px;
        line-height: 1.9;
      }
      .chapter-head h2 {
        font-size: clamp(22px, 3.5vw, 28px);
      }
    }
    @media (max-width: 860px) {
      .reader-shell {
        padding:
          max(8px, env(safe-area-inset-top))
          max(8px, env(safe-area-inset-right))
          max(8px, env(safe-area-inset-bottom))
          max(8px, env(safe-area-inset-left));
        gap: 8px;
      }
      .reader-grid {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(0, 1fr) minmax(178px, 34vh);
      }
      .chapter-panel {
        order: 1;
      }
      .toc-panel {
        order: 2;
      }
      .chapter-head {
        padding: 10px 11px 7px;
      }
      .chapter-head p {
        font-size: 12px;
      }
      .chapter-body {
        font-size: 16.4px;
        line-height: 1.86;
        padding: 12px;
      }
      .jump-form input {
        width: 88px;
      }
    }
    @media (max-width: 640px) {
      .reader-topbar {
        padding: 9px 10px;
      }
      .book-info h1 {
        font-size: clamp(20px, 6.2vw, 27px);
      }
      .book-info p {
        font-size: 12px;
      }
      .btn {
        font-size: 12px;
        padding: 7px 10px;
      }
      .reading-tools {
        grid-template-columns: 1fr;
      }
      .tool-card {
        padding: 8px;
      }
      .tool-select {
        font-size: 12px;
      }
      .tool-hint {
        font-size: 11px;
      }
      .chapter-nav {
        padding: 9px 10px;
      }
      .jump-form {
        flex-wrap: wrap;
        row-gap: 4px;
      }
      .reader-grid {
        grid-template-rows: minmax(0, 1fr) minmax(160px, 33vh);
      }
      .toc-head strong {
        font-size: 13px;
      }
      .toc-head span {
        font-size: 11px;
      }
      .toc-item span {
        font-size: 11px;
      }
      .toc-item small {
        font-size: 10px;
      }
    }
    @media (max-width: 860px) and (orientation: landscape) {
      .reader-grid {
        grid-template-columns: minmax(196px, 30vw) minmax(0, 1fr);
        grid-template-rows: 1fr;
      }
      .toc-panel {
        order: 1;
      }
      .chapter-panel {
        order: 2;
      }
      .chapter-middle {
        grid-template-columns: minmax(0, 1fr) minmax(172px, 31%);
        grid-template-rows: 1fr;
      }
      .reading-tools {
        grid-template-columns: 1fr;
      }
      .chapter-body {
        font-size: 15.5px;
      }
    }
  </style>
</head>
<body>
  <div class="reader-bg"></div>
  <div class="reader-vignette"></div>
  <div class="reader-shell">
    <header class="reader-topbar">
      <div class="book-info">
        <h1>${escapeHtml(book.title)}</h1>
        <p>${escapeHtml(book.author)} · ${escapeHtml(book.category)} · ${NOVEL_TOTAL_WORDS.toLocaleString("en-US")} 字长篇</p>
      </div>
      <div class="top-actions">
        <a class="btn" href="/app">返回书城</a>
        <a class="btn" href="/auth/logout">退出</a>
      </div>
    </header>

    <main class="reader-grid">
      <aside class="toc-panel">
        <div class="toc-head">
          <strong>目录跳转</strong>
          <span>共 ${totalChapters.toLocaleString("en-US")} 章 · 当前进度 ${progress}%</span>
          <span>目录页 ${safeTocPage.toLocaleString("en-US")} / ${totalTocPages.toLocaleString("en-US")} · 显示 ${tocStart.toLocaleString("en-US")} - ${tocEnd.toLocaleString("en-US")} 章</span>
          <div class="toc-pager">
            ${
              prevTocHref
                ? `<a class="btn" href="${prevTocHref}">上一页目录</a>`
                : `<span class="hint">已是第一页目录</span>`
            }
            ${
              nextTocHref
                ? `<a class="btn" href="${nextTocHref}">下一页目录</a>`
                : `<span class="hint">已是最后一页目录</span>`
            }
          </div>
        </div>
        <div class="toc-list">${chapterCatalog}</div>
      </aside>

      <section class="chapter-panel">
        <div class="chapter-head">
          <h2>${escapeHtml(chapterTitle)}</h2>
          <p>章节体量约 ${chapterWordCount.toLocaleString("en-US")} 字 · 全书进度 ${chapterStartWord.toLocaleString("en-US")} - ${chapterEndWord.toLocaleString("en-US")} 字</p>
        </div>
        <div class="chapter-middle">
          <article class="chapter-body" id="chapterBody">${contentHtml}</article>
        </div>
        <div class="chapter-nav">
          <div>
            ${prevHref ? `<a class="btn primary" href="${prevHref}">上一章</a>` : `<span class="hint">已是第一章</span>`}
          </div>
          <form class="jump-form" method="GET" action="/read/${encodeURIComponent(book.id)}">
            <label for="chapterInput">跳到</label>
            <input id="chapterInput" type="number" name="chapter" min="1" max="${totalChapters}" value="${chapterNumber}" />
            <button class="btn" type="submit">跳转</button>
          </form>
          <div>
            ${nextHref ? `<a class="btn primary" href="${nextHref}">下一章</a>` : `<span class="hint">已是最后一章</span>`}
          </div>
        </div>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const chapterBody = document.getElementById("chapterBody");
      if (!chapterBody) return;


    })();
  </script>
</body>
</html>`;
}

const config = createConfig();
const app = express();
const secureCookie = process.env.NODE_ENV === "production";
const isServerlessEnv = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const runtimeDataDir = isServerlessEnv
  ? path.join(os.tmpdir(), "99xiaoshuo")
  : path.join(__dirname, "data");
const FileSessionStore = createFileSessionStore(session);
const sessionStore = new FileSessionStore({
  filePath: path.join(runtimeDataDir, "sessions.json"),
});
const chapterCache = new ChapterCache(Number(process.env.CHAPTER_CACHE_SIZE || 1200));
const userStateStore = new UserStateStore(path.join(runtimeDataDir, "user-state.json"));
const ttsService = new ReaderTtsService({
  cacheDir: path.join(runtimeDataDir, "tts-cache"),
  publicMount: "/assets/tts",
});

function flushPersistentStores() {
  try {
    if (typeof sessionStore.flushNow === "function") sessionStore.flushNow();
  } catch {
    // noop
  }
  try {
    if (typeof userStateStore.flushNow === "function") userStateStore.flushNow();
  } catch {
    // noop
  }
}

["SIGINT", "SIGTERM", "beforeExit"].forEach((eventName) => {
  process.on(eventName, flushPersistentStores);
});

function getUserStateKey(req) {
  const profile = req.session?.profile || {};
  const tokens = req.session?.tokens || {};
  const profileKey = getUserStateKeyFromProfile(profile);
  if (profileKey) return profileKey;
  const tokenKey = String(tokens.userId || tokens.openId || tokens.uid || "").trim();
  if (tokenKey) return tokenKey;
  return String(req.sessionID || "").trim();
}

const MCP_TOOL_DEFINITIONS = [
  {
    name: "get_user_profile",
    description: "获取当前 SecondMe 用户的基础资料。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_persona_snapshot",
    description: "基于阅读与写作习惯计算人格画像与今日运势。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_uploaded_novels",
    description: "列出当前用户已上传到书城的小说与章节统计。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "save_note_archive",
    description: "保存一条写作手记到存档。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 120 },
        content: { type: "string", maxLength: 12000 },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
];

function getToolNames() {
  return MCP_TOOL_DEFINITIONS.map((item) => item.name);
}

async function resolveMcpContext(req, options = {}) {
  const allowSessionFallback = options.allowSessionFallback !== false;
  const authMode = config.integration.authMode;
  const sessionProfile = req.session?.profile || null;
  const sessionToken = getRequestAccessToken(req);
  const bearerToken = parseBearerToken(req);

  if (authMode === "none") {
    const profile = sessionProfile || { userId: "anonymous", name: "Anonymous" };
    const stateKey = getUserStateKeyFromProfile(profile, req.sessionID || "anonymous");
    const currentState = userStateStore.get(stateKey);
    return {
      ok: true,
      profile,
      stateKey,
      statePayload: normalizeUserState(currentState?.state || {}),
      tokenSource: "none",
    };
  }

  const effectiveToken =
    bearerToken || (allowSessionFallback && sessionToken ? String(sessionToken) : "");
  if (!effectiveToken) {
    return {
      ok: false,
      status: 401,
      error: "missing bearer token",
    };
  }

  const profileResult = await fetchSecondMeUserProfile(effectiveToken, config);
  if (!profileResult.ok || !profileResult.profile) {
    return {
      ok: false,
      status: 401,
      error: "invalid bearer token",
      upstreamStatus: profileResult.status,
      upstreamPayload: profileResult.payload,
    };
  }

  const resolvedProfile = profileResult.profile;
  const stateKey = getUserStateKeyFromProfile(
    resolvedProfile,
    getUserStateKey(req)
  );
  const currentState = userStateStore.get(stateKey);
  return {
    ok: true,
    profile: resolvedProfile,
    stateKey,
    statePayload: normalizeUserState(currentState?.state || {}),
    tokenSource: bearerToken ? "bearer" : "session",
  };
}

function toMcpTextContent(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return [{ type: "text", text }];
}

async function executeTool(req, toolName, args = {}) {
  const context = await resolveMcpContext(req, { allowSessionFallback: true });
  if (!context.ok) return context;

  const nowIso = new Date().toISOString();
  if (toolName === "get_user_profile") {
    return {
      ok: true,
      status: 200,
      data: {
        profile: {
          userId: context.profile?.userId || "",
          name: context.profile?.name || "",
          route: context.profile?.route || "",
          bio: context.profile?.bio || "",
        },
        tokenSource: context.tokenSource,
        fetchedAt: nowIso,
      },
    };
  }

  if (toolName === "get_persona_snapshot") {
    const persona = buildPersonalitySnapshot(context.statePayload);
    return {
      ok: true,
      status: 200,
      data: {
        profile: {
          userId: context.profile?.userId || "",
          name: context.profile?.name || "",
        },
        personaType: persona.personaType,
        summary: persona.summary,
        traits: persona.displayTraits,
        fortune: persona.fortune,
        reading: {
          totalMinutes: persona.reading.totalMinutes,
          topCategory: persona.reading.topCategory || "未形成偏好",
          topCategoryMinutes: persona.reading.topCategoryMinutes,
          activeCategoryCount: persona.reading.activeCategoryCount,
        },
        writing: {
          wordCount: persona.writing.wordCount,
          draftCount: persona.writing.draftCount,
          dialogueDensityPercent: Math.round(persona.writing.dialogueDensity * 100),
        },
        generatedAt: nowIso,
      },
    };
  }

  if (toolName === "list_uploaded_novels") {
    const novels = Array.isArray(context.statePayload?.novels)
      ? context.statePayload.novels
      : [];
    const uploaded = novels
      .filter((novel) => Boolean(novel?.uploaded))
      .map((novel) => ({
        id: novel.id || "",
        title: novel.title || "未命名小说",
        category: novel.category || "成长",
        chapterCount: Array.isArray(novel.chapters) ? novel.chapters.length : 0,
        uploadedAt: novel.uploadedAt || null,
        updatedAt: novel.updatedAt || null,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      );
    return {
      ok: true,
      status: 200,
      data: {
        count: uploaded.length,
        novels: uploaded,
        fetchedAt: nowIso,
      },
    };
  }

  if (toolName === "save_note_archive") {
    const titleRaw = String(args?.title || "").trim();
    const contentRaw = String(args?.content || "").trim();
    if (!contentRaw) {
      return {
        ok: false,
        status: 400,
        error: "content is required",
      };
    }
    const title = titleRaw || `手记 ${nowIso.slice(0, 10)}`;
    const nextState = normalizeUserState({
      ...context.statePayload,
      draftTitle: title.slice(0, 160),
      draftContent: contentRaw.slice(0, 200000),
      updatedAt: nowIso,
      drafts: [
        {
          id: `mcp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
          title: title.slice(0, 160),
          content: contentRaw.slice(0, 600),
          words: countTextChars(contentRaw),
          createdAt: nowIso,
          novelId: "",
          chapterNumber: 1,
        },
        ...(Array.isArray(context.statePayload?.drafts)
          ? context.statePayload.drafts
          : []),
      ].slice(0, 500),
    });
    userStateStore.set(context.stateKey, nextState);
    return {
      ok: true,
      status: 200,
      data: {
        message: "note archived",
        title: title.slice(0, 160),
        words: countTextChars(contentRaw),
        savedAt: nowIso,
      },
    };
  }

  return {
    ok: false,
    status: 404,
    error: `tool not found: ${toolName}`,
  };
}

function buildIntegrationManifest(req) {
  const baseUrl = resolvePublicBaseUrl(req, config);
  const mcpEndpoint = `${baseUrl}/mcp`;
  const manifest = {
    schemaVersion: config.integration.schemaVersion,
    skill: {
      key: config.integration.skillKey,
      displayName: config.integration.skillDisplayName,
      description: config.integration.skillDescription,
      keywords: ["小说", "人格分析", "阅读", "写作", "SecondMe"],
    },
    prompts: {
      activationShort: "读取用户阅读写作画像并生成名片洞察",
      activationLong:
        "调用 99 小说工具，获取用户资料、上传书籍与人格分析信息，输出可分享的个人名片摘要。",
      systemSummary:
        "这是一个聚焦阅读与写作人格镜像的工具集，可用于个人名片展示和创作建议。",
    },
    actions: [
      {
        name: "readProfile",
        description: "读取用户基础资料",
        toolName: "get_user_profile",
        payloadTemplate: {},
        displayHint: "用户资料",
      },
      {
        name: "readPersona",
        description: "读取人格画像和今日运势",
        toolName: "get_persona_snapshot",
        payloadTemplate: {},
        displayHint: "人格分析",
      },
      {
        name: "listNovels",
        description: "查看已上传小说列表",
        toolName: "list_uploaded_novels",
        payloadTemplate: {},
        displayHint: "创作成果",
      },
    ],
    mcp: {
      endpoint: mcpEndpoint,
      timeoutMs: config.integration.timeoutMs,
      toolAllow: getToolNames(),
      headersTemplate: {},
      authMode: config.integration.authMode,
    },
    oauth: {
      appId: config.clientId,
      requiredScopes: config.scopeList,
    },
    envBindings: {
      release: {
        enabled: true,
        endpoint: mcpEndpoint,
      },
    },
  };

  return {
    manifest,
    endpoints: {
      mcp: mcpEndpoint,
      tools: `${baseUrl}/api/integration/tools`,
      execute: `${baseUrl}/api/integration/execute`,
      healthz: `${baseUrl}/healthz`,
    },
  };
}

app.get("/assets/generated-image", (req, res) => {
  const kind = String(req.query.kind || "panel").slice(0, 32);
  const seed = String(req.query.seed || "seed").slice(0, 120);
  const title = String(req.query.title || "99小说");
  const subtitle = String(req.query.subtitle || "你的心情写照");
  const isCover =
    kind === "cover" ||
    kind === "storyCover" ||
    kind === "animeCover" ||
    kind === "sportsFootball" ||
    kind === "sportsBasketball";
  const defaultWidth = isCover ? 600 : 1800;
  const defaultHeight = isCover ? 900 : 1200;
  const width = parseBoundedInt(req.query.w, defaultWidth, 320, 4096);
  const height = parseBoundedInt(req.query.h, defaultHeight, 240, 4096);
  const svg = renderGeneratedImageSvg({ kind, seed, title, subtitle, width, height });
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.status(200).send(svg);
});

app.use("/assets", express.static(path.join(__dirname, "public")));
app.use("/assets/tts", express.static(ttsService.cacheDir));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "10mb" }));
if (secureCookie) app.set("trust proxy", 1);
app.use(
  session({
    name: "secondme_demo_session",
    store: sessionStore,
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);
app.use((req, res, next) => {
  const sessionToken = String(req.session?.tokens?.accessToken || "").trim();
  const cookieToken = readCookie(req, ACCESS_TOKEN_COOKIE_NAME);
  if (sessionToken && sessionToken !== cookieToken) {
    setAccessTokenCookie(req, res, sessionToken);
  }
  next();
});

app.get("/healthz", (req, res) => {
  const baseUrl = resolvePublicBaseUrl(req, config);
  res.json({
    ok: true,
    app: "99xiaoshuo-secondme-demo",
    chapterCacheSize: chapterCache.size,
    ttsProvider: ttsService.getCapabilities().provider,
    mcpEndpoint: `${baseUrl}/mcp`,
    integrationTools: getToolNames().length,
    now: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.send(
    renderLandingPage({
      hasClientSecret: Boolean(config.clientSecret),
      isLoggedIn: Boolean(getRequestAccessToken(req)),
    })
  );
});

app.get("/auth/login", (req, res) => {
  if (!config.clientId || !config.clientSecret) {
    res.status(500).send(renderAuthErrorPage("配置缺失", "SECONDME_CLIENT_ID 或 SECONDME_CLIENT_SECRET 缺失。"));
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = resolveAuthRedirectUri(req, config);
  const returnTo = normalizeReturnPath(req.query.return || req.query.next, "/app");
  const authUrl = buildAuthUrl(config, state, redirectUri);
  rememberOAuthState(state, redirectUri, req, returnTo);

  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      oauthStateStore.delete(state);
      res
        .status(500)
        .send(renderAuthErrorPage("会话重建失败", regenerateError.message || "未知错误"));
      return;
    }
    req.session.oauthState = state;
    req.session.oauthRedirectUri = redirectUri;
    req.session.oauthReturnTo = returnTo;
    req.session.save((saveError) => {
      if (saveError) {
        oauthStateStore.delete(state);
        res.status(500).send(renderAuthErrorPage("会话保存失败", saveError.message || "未知错误"));
        return;
      }
      res.redirect(authUrl);
    });
  });
});

app.get("/api/auth/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      res.status(400).send(renderAuthErrorPage("授权失败", String(error)));
      return;
    }
    if (!code) {
      res.status(400).send(renderAuthErrorPage("回调参数错误", "缺少 code 参数。"));
      return;
    }
    const stateToken = String(state || "").trim();
    const sessionState = String(req.session?.oauthState || "").trim();
    const sessionStateMatched = Boolean(stateToken && sessionState && stateToken === sessionState);
    const fallbackStateEntry = consumeOAuthState(stateToken);
    const fallbackStateMatched = Boolean(
      fallbackStateEntry && fallbackStateEntry.clientFingerprint === getOAuthClientFingerprint(req)
    );
    if (!sessionStateMatched && !fallbackStateMatched) {
      res.status(400).send(
        renderAuthErrorPage(
          "State 校验失败",
          "请重新发起登录，避免 CSRF 风险。建议使用同一地址完成登录与回调（如 http://localhost:3000）。"
        )
      );
      return;
    }

    const redirectUriForToken =
      req.session.oauthRedirectUri || fallbackStateEntry?.redirectUri || config.redirectUri;
    const returnToPath = normalizeReturnPath(
      req.session.oauthReturnTo || fallbackStateEntry?.returnTo,
      "/app"
    );
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: redirectUriForToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    console.log('请求 token 端点:', config.tokenEndpoint);
    console.log('请求参数:', body.toString());
    const tokenResp = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    console.log('token 响应状态:', tokenResp.status);
    console.log('token 响应头:', Object.fromEntries(tokenResp.headers));
    const tokenJson = await tokenResp.json().catch((error) => {
      console.error('解析 token 响应失败:', error);
      return null;
    });
    console.log('token 响应体:', tokenJson);

    if (!tokenResp.ok || !tokenJson || tokenJson.code !== 0) {
      res
        .status(502)
        .send(
          renderAuthErrorPage(
            "换取 token 失败",
            `HTTP ${tokenResp.status}，请检查回调地址和应用配置。响应: ${JSON.stringify(tokenJson)}`
          )
        );
      return;
    }

    const accessToken =
      String(tokenJson?.data?.accessToken || tokenJson?.data?.access_token || "").trim();
    if (!accessToken) {
      res
        .status(502)
        .send(renderAuthErrorPage("换取 token 失败", "返回数据缺少 accessToken。"));
      return;
    }

    req.session.oauthState = null;
    req.session.oauthRedirectUri = null;
    req.session.oauthReturnTo = null;
    req.session.tokens = {
      ...(tokenJson.data || {}),
      accessToken,
    };
    req.session.tokenFetchedAt = new Date().toISOString();
    setAccessTokenCookie(req, res, accessToken);

    const profileResult = await fetchSecondMeUserProfile(accessToken, config);
    if (profileResult.ok) {
      req.session.profile = profileResult.profile;
      req.session.profileFetchedAt = new Date().toISOString();
    }

    res.redirect(returnToPath);
  } catch (error) {
    res.status(500).send(renderAuthErrorPage("回调异常", error.message || String(error)));
  }
});

app.get("/api/profile", async (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ code: 401, message: "not logged in" });
    return;
  }

  const forceRefresh = String(req.query.refresh || "") === "1";
  if (!forceRefresh && req.session.profile) {
    res.json({
      code: 0,
      data: req.session.profile,
      source: "session",
      fetchedAt: req.session.profileFetchedAt || null,
    });
    return;
  }

  const profileResult = await fetchSecondMeUserProfile(accessToken, config);
  if (!profileResult.ok) {
    res.status(502).json({
      code: 502,
      message: "failed to fetch user profile",
      status: profileResult.status,
      upstream: profileResult.payload,
    });
    return;
  }

  req.session.profile = profileResult.profile;
  req.session.profileFetchedAt = new Date().toISOString();
  res.json({
    code: 0,
    data: req.session.profile,
    source: "upstream",
    fetchedAt: req.session.profileFetchedAt,
  });
});

app.get("/api/secondme/user/info", (req, res) => {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(307, `/api/profile${query}`);
});

app.get("/api/integration/manifest", (req, res) => {
  res.json({
    code: 0,
    data: buildIntegrationManifest(req),
  });
});

app.get("/api/integration/tools", (req, res) => {
  res.json({
    code: 0,
    data: {
      tools: MCP_TOOL_DEFINITIONS,
      fetchedAt: new Date().toISOString(),
    },
  });
});

app.post("/api/integration/execute", async (req, res) => {
  const toolName = String(req.body?.toolName || req.body?.name || "").trim();
  const args =
    req.body?.args && typeof req.body.args === "object"
      ? req.body.args
      : req.body?.arguments && typeof req.body.arguments === "object"
        ? req.body.arguments
        : {};
  if (!toolName) {
    res.status(400).json({ code: 400, message: "toolName is required" });
    return;
  }

  const result = await executeTool(req, toolName, args);
  if (!result.ok) {
    res.status(result.status || 400).json({
      code: result.status || 400,
      message: result.error || "tool execute failed",
      detail: result.upstreamPayload || null,
    });
    return;
  }

  res.status(200).json({
    code: 0,
    data: result.data,
  });
});

app.post("/mcp", async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const method = String(payload.method || "").trim();
  const hasId = Object.prototype.hasOwnProperty.call(payload, "id");
  const id = hasId ? payload.id : null;

  const writeResult = (result) => {
    if (!hasId) {
      res.status(204).end();
      return;
    }
    res.json({
      jsonrpc: "2.0",
      id,
      result,
    });
  };

  const writeError = (code, message, data = null) => {
    if (!hasId) {
      res.status(204).end();
      return;
    }
    res.status(200).json({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        data,
      },
    });
  };

  if (!method) {
    writeError(-32600, "Invalid Request", { detail: "method is required" });
    return;
  }

  if (method === "initialize") {
    writeResult({
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "99xiaoshuo-mcp",
        version: "1.0.0",
      },
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    res.status(204).end();
    return;
  }

  if (method === "ping") {
    writeResult({});
    return;
  }

  if (method === "tools/list") {
    writeResult({
      tools: MCP_TOOL_DEFINITIONS,
    });
    return;
  }

  if (method === "tools/call") {
    const params = payload.params && typeof payload.params === "object" ? payload.params : {};
    const toolName = String(params.name || "").trim();
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    if (!toolName) {
      writeError(-32602, "Invalid params", { detail: "params.name is required" });
      return;
    }
    const result = await executeTool(req, toolName, args);
    if (!result.ok) {
      writeError(-32001, result.error || "tool execute failed", {
        status: result.status || 400,
        detail: result.upstreamPayload || null,
      });
      return;
    }
    writeResult({
      content: toMcpTextContent(result.data),
      isError: false,
    });
    return;
  }

  writeError(-32601, "Method not found", { method });
});

app.get("/api/state", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ code: 401, message: "not logged in" });
    return;
  }
  const stateKey = getUserStateKey(req);
  const entry = userStateStore.get(stateKey);
  res.json({
    code: 0,
    data: entry?.state || {},
    updatedAt: entry?.updatedAt || null,
  });
});

app.put("/api/state", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ code: 401, message: "not logged in" });
    return;
  }

  try {
    const normalizedState = normalizeUserState(req.body || {});
    const stateKey = getUserStateKey(req);
    userStateStore.set(stateKey, normalizedState);
    res.json({
      code: 0,
      message: "saved",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: "invalid state payload",
      detail: error.message || String(error),
    });
  }
});

app.get("/api/tts/capabilities", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ code: 401, message: "not logged in" });
    return;
  }
  res.json({
    code: 0,
    data: ttsService.getCapabilities(),
  });
});

app.post("/api/tts/page", async (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ code: 401, message: "not logged in" });
    return;
  }

  try {
    const style = String(req.body?.style || "").trim().toLowerCase();
    const text = String(req.body?.text || "").trim();
    const result = await ttsService.synthesizePage({ style, text });
    if (!result.ok) {
      res.status(200).json({
        code: 0,
        data: result,
      });
      return;
    }
    res.json({
      code: 0,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: "tts synthesize failed",
      detail: error.message || String(error),
    });
  }
});

app.get("/auth/logout", (req, res) => {
  clearAccessTokenCookie(req, res);
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/me", async (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.redirect("/");
    return;
  }
  const profileResult = await fetchSecondMeUserProfile(accessToken, config);
  if (profileResult.ok) {
    req.session.profile = profileResult.profile;
    req.session.profileFetchedAt = new Date().toISOString();
  }
  res.status(profileResult.ok ? 200 : 502).send(renderPlainProfilePage(profileResult.payload));
});

app.get("/read/:bookId", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.redirect(`/auth/login?return=${encodeURIComponent(req.originalUrl || "/app")}`);
    return;
  }

  const book = getBookById(req.params.bookId);
  if (!book) {
    res.status(404).send(renderAuthErrorPage("书籍不存在", "未找到对应书籍，请返回书城重新选择。"));
    return;
  }

  const chapterNumber = parseChapterNumber(req.query.chapter, NOVEL_CHAPTER_COUNT);
  const requestedPage = req.query.page;
  const totalTocPages = Math.ceil(NOVEL_CHAPTER_COUNT / TOC_PAGE_SIZE);
  const defaultTocPage = Math.ceil(chapterNumber / TOC_PAGE_SIZE);
  const tocPage = parsePageNumber(requestedPage, totalTocPages, defaultTocPage);
  let chapter = chapterCache.get(book.id, chapterNumber);
  if (!chapter) {
    chapter = generateChapterContent(book, chapterNumber);
    chapterCache.set(book.id, chapterNumber, chapter);
  }
  const readMinutesByBook = { ...(req.session?.reading?.readMinutesByBook || {}) };
  readMinutesByBook[book.id] = Number(readMinutesByBook[book.id] || 0) + 10;
  req.session.reading = {
    lastBookId: book.id,
    lastBookTitle: book.title,
    lastChapter: chapterNumber,
    lastChapterTitle: chapter.title,
    lastExcerpt: createReadingSnippet(chapter.paragraphs),
    readMinutesByBook,
    updatedAt: new Date().toISOString(),
  };

  res.send(
    renderReaderPage({
      book,
      chapterNumber,
      tocPage,
      chapterTitle: chapter.title,
      chapterParagraphs: chapter.paragraphs,
      chapterWordCount: chapter.chapterWordCount,
      chapterStartWord: chapter.chapterStartWord,
      chapterEndWord: chapter.chapterEndWord,
    })
  );
});

app.get("/comic/:comicId", (req, res) => {
  res.redirect("/app");
});

function buildAppBootstrap(req) {
  const profile = req.session?.profile || {};
  return {
    appName: "99小说-你的心情写照",
    categories: ["全部", ...CORE_CATEGORY_ORDER],
    profile: {
      userId: profile.userId || "",
      name: profile.name || "",
      bio: profile.bio || "",
      route: profile.route || "",
    },
    library: BOOK_LIBRARY,
    reading: req.session?.reading || null,
    fetchedAt: req.session?.profileFetchedAt || null,
  };
}

app.get("/app", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.redirect(`/auth/login?return=${encodeURIComponent(req.originalUrl || "/app")}`);
    return;
  }
  res.send(renderStorePage(buildAppBootstrap(req)));
});

app.get("/workspace", (req, res) => {
  res.redirect("/creator");
});

app.get("/creator", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.redirect(`/auth/login?return=${encodeURIComponent(req.originalUrl || "/creator")}`);
    return;
  }
  res.send(renderAppPage(buildAppBootstrap(req), "creator"));
});

app.get("/persona", (req, res) => {
  const accessToken = getRequestAccessToken(req);
  if (!accessToken) {
    res.redirect(`/auth/login?return=${encodeURIComponent(req.originalUrl || "/persona")}`);
    return;
  }
  res.send(renderAppPage(buildAppBootstrap(req), "persona"));
});

if (!process.env.VERCEL && !process.env.NOW_REGION) {
  app.listen(config.port, config.host, () => {
    console.log(`[secondme-demo] running on http://${config.host}:${config.port}`);
    console.log(`[secondme-demo] client_id=${config.clientId}`);
    console.log(`[secondme-demo] redirect_uri(default)=${config.redirectUri}`);
    console.log(
      `[secondme-demo] client_secret=${config.clientSecret ? "loaded" : "missing"}`
    );
  });
}

module.exports = app;
