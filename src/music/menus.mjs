// Rasadino Music — stage 4 navigation only. No external requests or persistent writes.
// All callback values are ASCII, whitelisted, and below Telegram's 64-byte limit.
const LANGUAGES = Object.freeze({
  fa: "🇮🇷 فارسی",
  us: "🇺🇸 انگلیسی آمریکایی"
});

const GENRES = Object.freeze({
  fa: Object.freeze([
    ["pop", "پاپ"],
    ["rock", "راک"],
    ["rap", "رپ و هیپ‌هاپ"],
    ["traditional", "سنتی"],
    ["fusion", "تلفیقی"],
    ["electronic", "الکترونیک"],
    ["nostalgia", "نوستالژی"],
    ["all", "همه ژانرها"]
  ]),
  us: Object.freeze([
    ["pop", "Pop"],
    ["rock", "Rock"],
    ["hiphop", "Hip-Hop / Rap"],
    ["rnb", "R&B / Soul"],
    ["country", "Country"],
    ["electronic", "Electronic"],
    ["jazz", "Jazz / Blues"],
    ["all", "All Genres"]
  ])
});

const TYPES = Object.freeze([
  ["today", "🔥 ترندهای امروز"],
  ["new", "🆕 جدیدترین آهنگ‌ها"],
  ["classic", "🏆 برترین آهنگ‌های تمام دوران"],
  ["week", "📈 محبوب‌ترین آهنگ‌های هفته"],
  ["hidden", "💎 آثار کمترشناخته‌شده"],
  ["smart", "🤖 انتخاب هوشمند رصدینو"]
]);

const COUNTS = Object.freeze([1, 3, 5, 10]);
const COUNT_LABELS = Object.freeze({1: "۱", 3: "۳", 5: "۵", 10: "۱۰"});

const button = (label, callback) => ({text: label, callback_data: callback});
const compact = (items, width = 2) => {
  const rows = [];
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width));
  return rows;
};

function footer(back) {
  return [
    [button("⬅️ بازگشت", back), button("🏠 منوی اصلی", "main:menu")],
    [button("❌ بستن", "menu:close")]
  ];
}

function view(text, rows) {
  return {text, keyboard: {inline_keyboard: rows}};
}

function genreLabel(lang, genre) {
  if (!Object.hasOwn(GENRES, lang)) return null;
  return GENRES[lang].find(([id]) => id === genre)?.[1] ?? null;
}

function typeLabel(kind) {
  return TYPES.find(([id]) => id === kind)?.[1] ?? null;
}

export function musicMenuView(action = "music:home") {
  if (action === "music:home") {
    return view(
      "🎧 رصد موزیک\n\nزبان موسیقی را انتخاب کن.\n\nℹ️ این بخش در مرحله طراحی منو است؛ هنوز آهنگی جست‌وجو یا ارسال نمی‌شود.",
      [
        [button(LANGUAGES.fa, "music:lang:fa")],
        [button(LANGUAGES.us, "music:lang:us")],
        ...footer("main:menu")
      ]
    );
  }

  if (typeof action !== "string" || action.length > 64) return null;
  const parts = action.split(":");
  if (parts[0] !== "music") return null;

  if (parts[1] === "lang" && parts.length === 3) {
    const lang = parts[2];
    if (!Object.hasOwn(GENRES, lang)) return null;
    const note = lang === "us"
      ? "\nآثار انگلیسی‌زبان هنرمندان آمریکایی در اولویت خواهند بود."
      : "";
    return view(
      "🎧 رصد موزیک\n🌍 زبان: " + LANGUAGES[lang] + "\n\nژانر موردنظر را انتخاب کن." + note,
      [
        ...compact(GENRES[lang].map(([id, label]) =>
          button(label, "music:genre:" + lang + ":" + id))),
        ...footer("music:home")
      ]
    );
  }

  if (parts[1] === "genre" && parts.length === 4) {
    const [, , lang, genre] = parts;
    const name = genreLabel(lang, genre);
    if (!name) return null;
    return view(
      "🎧 رصد موزیک\n🌍 زبان: " + LANGUAGES[lang] +
      "\n🎼 ژانر: " + name + "\n\nنوع پیشنهاد را انتخاب کن.",
      [
        ...TYPES.map(([id, label]) => [button(label, "music:type:" + lang + ":" + genre + ":" + id)]),
        ...footer("music:lang:" + lang)
      ]
    );
  }

  if (parts[1] === "type" && parts.length === 5) {
    const [, , lang, genre, kind] = parts;
    const name = genreLabel(lang, genre);
    const recommended = typeLabel(kind);
    if (!name || !recommended) return null;
    return view(
      "🎧 رصد موزیک\n🌍 زبان: " + LANGUAGES[lang] +
      "\n🎼 ژانر: " + name + "\n📌 نوع: " + recommended +
      "\n\nتعداد آهنگ‌ها را انتخاب کن.\nپیش‌فرض: ۵ آهنگ.",
      [
        ...compact(COUNTS.map(n => button(
          n === 5 ? "۵ آهنگ ⭐ پیش‌فرض" : COUNT_LABELS[n] + " آهنگ",
          "music:preview:" + lang + ":" + genre + ":" + kind + ":" + n
        ))),
        ...footer("music:genre:" + lang + ":" + genre)
      ]
    );
  }

  if (parts[1] === "preview" && parts.length === 6) {
    const [, , lang, genre, kind, countText] = parts;
    const name = genreLabel(lang, genre);
    const recommended = typeLabel(kind);
    const count = Number(countText);
    if (!name || !recommended || !COUNTS.includes(count) || String(count) !== countText) return null;
    return view(
      "🎧 خلاصه انتخاب رصد موزیک\n\n🌍 زبان: " + LANGUAGES[lang] +
      "\n🎼 ژانر: " + name + "\n📌 نوع: " + recommended +
      "\n🎵 تعداد: " + count + " آهنگ" +
      "\n\n🧪 منو آماده آزمایش است؛ اتصال به منابع موسیقی و ارسال پیشنهاد در مراحل بعد انجام می‌شود.\nهیچ آهنگی ارسال نشده و هیچ اشتراک روزانه‌ای فعال نشده است.",
      [
        [button("🔁 تغییر تعداد", "music:type:" + lang + ":" + genre + ":" + kind)],
        ...footer("music:genre:" + lang + ":" + genre)
      ]
    );
  }
  return null;
}

export {GENRES, TYPES, COUNTS};
