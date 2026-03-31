function asString(value, max = 200) {
  return String(value == null ? '' : value).slice(0, max);
}

function asBoolean(value) {
  return Boolean(value);
}

function asNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function asIsoDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeDraft(item) {
  return {
    id: asString(item?.id || `d_${Date.now()}`, 80),
    title: asString(item?.title, 160),
    content: asString(item?.content, 600),
    words: asNumber(item?.words, 0, 2000000, 0),
    createdAt: asIsoDate(item?.createdAt),
    novelId: asString(item?.novelId, 80),
    chapterNumber: asNumber(item?.chapterNumber, 1, 100000, 1),
  };
}

function normalizeChapter(item, index) {
  const number = asNumber(item?.number, 1, 100000, index + 1);
  return {
    id: asString(item?.id || `c_${Date.now()}_${index + 1}`, 80),
    number,
    title: asString(item?.title || `第${number}章`, 160),
    content: asString(item?.content, 300000),
    words: asNumber(item?.words, 0, 2000000, 0),
    createdAt: asIsoDate(item?.createdAt),
    updatedAt: asIsoDate(item?.updatedAt),
  };
}

function normalizeNovel(item, index) {
  const chapters = Array.isArray(item?.chapters)
    ? item.chapters.slice(0, 600).map((chapter, chapterIndex) => normalizeChapter(chapter, chapterIndex))
    : [];

  return {
    id: asString(item?.id || `n_${Date.now()}_${index + 1}`, 80),
    title: asString(item?.title || '未命名小说', 160),
    category: asString(item?.category || '成长', 20),
    createdAt: asIsoDate(item?.createdAt),
    updatedAt: asIsoDate(item?.updatedAt),
    uploaded: asBoolean(item?.uploaded),
    uploadedAt: item?.uploadedAt ? asIsoDate(item.uploadedAt) : null,
    coverImage: asString(item?.coverImage || '', 1000),
    chapters,
  };
}

function normalizeReadMinutes(input) {
  if (!input || typeof input !== 'object') return {};
  const result = {};
  Object.entries(input).forEach(([bookId, minutes]) => {
    const key = asString(bookId, 80);
    if (!key) return;
    result[key] = asNumber(minutes, 0, 500000, 0);
  });
  return result;
}

function normalizeUserState(input) {
  const source = input && typeof input === 'object' ? input : {};
  const drafts = Array.isArray(source.drafts)
    ? source.drafts.slice(0, 500).map((draft) => normalizeDraft(draft))
    : [];
  const novels = Array.isArray(source.novels)
    ? source.novels.slice(0, 120).map((novel, index) => normalizeNovel(novel, index))
    : [];

  return {
    selectedCategory: asString(source.selectedCategory || '全部', 20),
    selectedBookId: asString(source.selectedBookId || '', 80),
    readMinutes: normalizeReadMinutes(source.readMinutes),
    draftTitle: asString(source.draftTitle || '', 160),
    draftContent: asString(source.draftContent || '', 200000),
    drafts,
    novels,
    activeNovelId: asString(source.activeNovelId || '', 80),
    activeChapterNumber: asNumber(source.activeChapterNumber, 1, 100000, 1),
    updatedAt: asIsoDate(source.updatedAt),
  };
}

module.exports = {
  normalizeUserState,
};
